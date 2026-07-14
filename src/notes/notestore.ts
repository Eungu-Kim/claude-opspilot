import Database from "better-sqlite3";
import { gunzipSync } from "node:zlib";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { extractTableText } from "./table.js";

/** Apple Notes 한 건 (본문 텍스트 추출 완료) */
export interface NoteRow {
  id: string; // ZIDENTIFIER (UUID) — 멱등성 키
  title: string;
  folder: string | null;
  modified: number; // Unix epoch 초
  text: string; // gunzip + 정제된 본문
}

// Core Data(2001-01-01) → Unix epoch 보정값
const COREDATA_EPOCH_OFFSET = 978307200;

const NOTESTORE = join(
  homedir(),
  "Library",
  "Group Containers",
  "group.com.apple.notes",
  "NoteStore.sqlite"
);

// 인덱싱 제외 폴더 — 기본 "메모(Notes)" 등 개인용 폴더는 검색 대상에서 뺀다.
// 일 관련 메모는 별도 폴더(i2message, OpsPilot 등)로 구분돼 있으므로 그것들만 대상.
const EXCLUDED_FOLDERS = ["Notes", "Quick Notes", "Recently Deleted"];

function normalize(s: string): string {
  return s
    .replace(/[￼�]/g, " ") // ￼ 객체 자리표시자 / � 깨진 인코딩
    .replace(/[\x00-\x08\x0e-\x1f]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** protobuf varint 읽기 → [값, 다음위치] */
function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let b: number;
  do {
    b = buf[pos++];
    result |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80 && shift < 35);
  return [result >>> 0, pos];
}

/** 최상위에서 지정 필드번호의 length-delimited(wire type 2) 값을 반환 */
function pbFindLenField(buf: Buffer, fieldNum: number): Buffer | null {
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const fn = tag >> 3;
    const wt = tag & 7;
    if (wt === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const val = buf.subarray(pos, pos + len);
      pos += len;
      if (fn === fieldNum) return val;
    } else if (wt === 0) {
      [, pos] = readVarint(buf, pos);
    } else if (wt === 5) {
      pos += 4;
    } else if (wt === 1) {
      pos += 8;
    } else break;
  }
  return null;
}

/**
 * gzip(1F8B) 이면 gunzip 후 본문 텍스트 추출.
 * 정식 경로: NoteStoreProto.document(2) → note(3) → note_text(2).
 * 파싱 실패 시 바이트 정제 휴리스틱으로 폴백. 잠긴/암호화 노트는 gzip 아님 → 빈 문자열.
 */
function extractText(zdata: Buffer | null): string {
  if (!zdata || zdata.length < 2 || zdata[0] !== 0x1f || zdata[1] !== 0x8b) {
    return "";
  }
  let buf: Buffer;
  try {
    buf = gunzipSync(zdata);
  } catch {
    return "";
  }

  try {
    const doc = pbFindLenField(buf, 2);
    const note = doc && pbFindLenField(doc, 3);
    const noteText = note && pbFindLenField(note, 2);
    if (noteText && noteText.length) {
      const t = normalize(noteText.toString("utf8"));
      if (t) return t;
    }
  } catch {
    // 폴백으로 진행
  }

  // 폴백: 전체를 텍스트로 보고 프레이밍 잡음 제거
  return normalize(buf.toString("utf8").replace(/�/g, ""));
}

/**
 * NoteStore.sqlite 를 임시 폴더로 복사(원본 + -wal + -shm) 후 read-only 조회.
 * Recently Deleted / 잠긴 노트는 제외. FDA 필요.
 */
export function readNotes(): NoteRow[] {
  if (!existsSync(NOTESTORE)) {
    throw new Error(
      "NoteStore.sqlite 를 찾을 수 없습니다. Full Disk Access 권한과 Apple Notes 사용 여부를 확인하세요."
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), "opspilot-notes-"));
  const dst = join(tmp, "ns.sqlite");
  copyFileSync(NOTESTORE, dst);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(NOTESTORE + suffix)) copyFileSync(NOTESTORE + suffix, dst + suffix);
  }

  try {
    const db = new Database(dst);
    try {
      const ph = EXCLUDED_FOLDERS.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT o.Z_PK              AS pk,
                  o.ZIDENTIFIER        AS id,
                  o.ZTITLE1            AS title,
                  f.ZTITLE2            AS folder,
                  o.ZMODIFICATIONDATE1 AS modCoreData,
                  d.ZDATA              AS data
             FROM ZICCLOUDSYNCINGOBJECT o
             JOIN ZICNOTEDATA d ON d.Z_PK = o.ZNOTEDATA
             LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON f.Z_PK = o.ZFOLDER
            WHERE o.ZNOTEDATA IS NOT NULL
              AND f.ZTITLE2 IS NOT NULL
              AND f.ZTITLE2 NOT IN (${ph})`
        )
        .all(...EXCLUDED_FOLDERS) as {
        pk: number;
        id: string | null;
        title: string | null;
        folder: string | null;
        modCoreData: number | null;
        data: Buffer | null;
      }[];

      // 노트에 속한 표(들)의 ZMERGEABLEDATA1 조회용
      const tableStmt = db.prepare(
        `SELECT ZMERGEABLEDATA1 AS d
           FROM ZICCLOUDSYNCINGOBJECT
          WHERE ZNOTE = ? AND ZTYPEUTI = 'com.apple.notes.table'
            AND ZMERGEABLEDATA1 IS NOT NULL`
      );

      const notes: NoteRow[] = [];
      for (const r of rows) {
        let text = extractText(r.data);
        if (!text || !r.id) continue; // 잠긴 노트/빈 노트 스킵

        // 표 셀 텍스트를 본문에 이어붙여 검색 대상에 포함
        const tables = tableStmt.all(r.pk) as { d: Buffer }[];
        if (tables.length) {
          const tt = tables
            .map((t) => extractTableText(t.d))
            .filter(Boolean)
            .join("\n");
          if (tt) text += `\n\n[표]\n${tt}`;
        }

        notes.push({
          id: r.id,
          title: r.title?.trim() || text.split("\n")[0].slice(0, 60),
          folder: r.folder,
          modified: Math.round((r.modCoreData ?? 0) + COREDATA_EPOCH_OFFSET),
          text,
        });
      }
      return notes;
    } finally {
      db.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
