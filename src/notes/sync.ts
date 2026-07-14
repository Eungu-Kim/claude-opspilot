import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readNotes } from "./notestore.js";
import { chunkText } from "./chunk.js";
import { embed, normalize, isAvailable } from "../embed/ollama.js";

export interface NotesSyncResult {
  indexed: number;
  byFolder: Record<string, number>;
  embedded: number; // 이번에 새로/갱신 임베딩한 노트 수
  embedChunks: number; // 생성된 청크 수
  embedSkipped: number; // 변경 없어 스킵한 노트 수
  embedError: string | null; // Ollama 문제 시 메시지
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/**
 * Apple Notes → sources(type=NOTE) + memory_fts(키워드) + note_embeddings(의미검색).
 * 임베딩은 텍스트 해시가 바뀐 노트만 재계산(증분). Ollama 미실행 시 키워드까지는 정상.
 */
export async function syncNotes(db: Database.Database): Promise<NotesSyncResult> {
  const notes = readNotes();

  const upsertSrc = db.prepare(
    `INSERT INTO sources (id, type, external_id, title, timestamp)
     VALUES (@id, 'NOTE', @extId, @title, @ts)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, timestamp = excluded.timestamp`
  );
  const delFts = db.prepare("DELETE FROM memory_fts WHERE ref_kind = 'note' AND ref_id = ?");
  const insFts = db.prepare(
    "INSERT INTO memory_fts (ref_kind, ref_id, title, body) VALUES ('note', ?, ?, ?)"
  );

  // 1) 키워드 인덱스 + sources (동기, 트랜잭션)
  const byFolder: Record<string, number> = {};
  db.transaction((rows: typeof notes) => {
    for (const n of rows) {
      upsertSrc.run({
        id: `note_${n.id}`,
        extId: n.id,
        title: n.title,
        ts: new Date(n.modified * 1000).toISOString(),
      });
      delFts.run(n.id);
      insFts.run(n.id, n.title, n.text);
      const f = n.folder ?? "(폴더 없음)";
      byFolder[f] = (byFolder[f] ?? 0) + 1;
    }
  })(notes);

  // 2) 임베딩 (증분, 청크 단위). Ollama 없으면 스킵하고 키워드만.
  let embedded = 0;
  let embedChunks = 0;
  let embedSkipped = 0;
  let embedError: string | null = null;

  if (!(await isAvailable())) {
    embedError = "Ollama 서버 미응답 — 키워드 검색만 인덱싱됨 ('brew services start ollama' 확인)";
  } else {
    const getHash = db.prepare(
      "SELECT hash FROM note_embeddings WHERE ref_id = ? LIMIT 1"
    );
    const delChunks = db.prepare("DELETE FROM note_embeddings WHERE ref_id = ?");
    const insChunk = db.prepare(
      `INSERT INTO note_embeddings (ref_id, chunk_idx, hash, chunk_text, dim, vector, updated_at)
       VALUES (@ref, @idx, @hash, @text, @dim, @vec, @at)`
    );

    let errors = 0;
    let lastErr = "";
    for (const n of notes) {
      // 해시 앞 'v2:' = 임베딩 방식 버전. nomic prefix 도입으로 기존 임베딩 무효화.
      const h = sha1(`v2:${n.title}\n${n.text}`);
      const existing = getHash.get(n.id) as { hash: string } | undefined;
      if (existing?.hash === h) {
        embedSkipped++;
        continue;
      }
      const chunks = chunkText(n.text);
      try {
        // 노트별로 모아서 성공 시에만 교체 (부분 실패로 인덱스 깨짐 방지)
        const rows: {
          ref: string; idx: number; hash: string; text: string; dim: number; vec: Buffer; at: string;
        }[] = [];
        const now = new Date().toISOString();
        for (let i = 0; i < chunks.length; i++) {
          const vec = normalize(await embed(`${n.title}\n${chunks[i]}`, "document"));
          rows.push({
            ref: n.id, idx: i, hash: h, text: chunks[i],
            dim: vec.length, vec: Buffer.from(vec.buffer), at: now,
          });
        }
        db.transaction(() => {
          delChunks.run(n.id);
          for (const r of rows) insChunk.run(r);
        })();
        embedded++;
        embedChunks += rows.length;
      } catch (e) {
        errors++;
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (errors > 0) {
      embedError = `${errors}건 임베딩 실패(나머지는 진행됨): ${lastErr}`;
    }
  }

  db.prepare("UPDATE meta SET last_synced_at = ? WHERE id = 1").run(
    new Date().toISOString()
  );

  return {
    indexed: notes.length,
    byFolder,
    embedded,
    embedChunks,
    embedSkipped,
    embedError,
  };
}
