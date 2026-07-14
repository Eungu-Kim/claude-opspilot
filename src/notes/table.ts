import { gunzipSync } from "node:zlib";

// Apple Notes 표는 ZMERGEABLEDATA1(gzip된 CRDT protobuf)에 저장됨.
// 완전한 표 구조 복원(CRDT 파싱)은 복잡하므로, 검색용으로 protobuf 를 재귀적으로 걸어
// "사람이 쓴 셀 텍스트"만 harvest 하고 구조 토큰(UUID/CRDT키/타입명)은 필터링한다.

const STRUCTURAL = new Set([
  "identity", "self", "crRows", "crColumns", "cellColumns", "cellRows",
  "UUIDIndex", "crTableColumnDirection",
]);

function isJunk(s: string): boolean {
  if (s.length < 2) return true;
  if (/[￼�]/.test(s)) return true; // 객체 자리표시자 / 깨진 인코딩
  if (!/\p{L}/u.test(s)) return true; // 글자 없음 → 프레이밍('0"','0!' 등)
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(s)) return true; // UUID
  if (/^com\.apple/.test(s)) return true; // 타입 식별자
  if (/^(cr|CR)[A-Za-z]/.test(s)) return true; // CRTable*, crRows...
  if (STRUCTURAL.has(s)) return true;
  return false;
}

function readVarint(b: Buffer, p: number): [number, number] {
  let r = 0n;
  let s = 0n;
  let x: number;
  do {
    x = b[p++];
    r |= BigInt(x & 0x7f) << s;
    s += 7n;
  } while (x & 0x80 && s < 64n);
  return [Number(r), p];
}

function harvest(buf: Buffer, out: string[], depth: number): void {
  let p = 0;
  while (p < buf.length) {
    let tag: number;
    try {
      [tag, p] = readVarint(buf, p);
    } catch {
      break;
    }
    const wt = tag & 7;
    if (wt === 2) {
      let len: number;
      [len, p] = readVarint(buf, p);
      if (len < 0 || p + len > buf.length) break;
      const v = buf.subarray(p, p + len);
      p += len;
      const str = v.toString("utf8");
      const printable =
        [...str].filter((c) => c >= " " || c === "\n").length / (str.length || 1);
      if (printable >= 0.95) {
        const t = str.trim();
        if (!isJunk(t)) out.push(t);
      } else if (printable < 0.6 && depth < 8) {
        harvest(v, out, depth + 1); // 중첩 메시지로 보이면 재귀
      }
    } else if (wt === 0) {
      [, p] = readVarint(buf, p);
    } else if (wt === 5) {
      p += 4;
    } else if (wt === 1) {
      p += 8;
    } else break;
  }
}

/** 표 ZMERGEABLEDATA1(gzip) → 셀 텍스트만 추출 (검색용, 구조 잡음 필터) */
export function extractTableText(zdata: Buffer | null): string {
  if (!zdata || zdata.length < 2 || zdata[0] !== 0x1f || zdata[1] !== 0x8b) return "";
  let buf: Buffer;
  try {
    buf = gunzipSync(zdata);
  } catch {
    return "";
  }
  const out: string[] = [];
  harvest(buf, out, 0);
  return [...new Set(out)].join(" ");
}
