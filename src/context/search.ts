import type Database from "better-sqlite3";
import { embed, normalize, dot, isAvailable } from "../embed/ollama.js";

interface Hit {
  refId: string;
  title: string;
  snip: string;
  ts: string | null;
}

/** BLOB(Buffer) → Float32Array (4바이트 정렬 보장 위해 복사) */
function toVec(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

/** 검색어 주변을 잘라 스니펫 생성 (LIKE 폴백용) */
function makeSnippet(body: string, q: string): string {
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return body.slice(0, 80).replace(/\n+/g, " ").trim();
  const start = Math.max(0, idx - 30);
  const end = Math.min(body.length, idx + q.length + 40);
  return (
    (start > 0 ? "… " : "") +
    body.slice(start, end).replace(/\n+/g, " ").trim() +
    (end < body.length ? " …" : "")
  );
}

function render(header: string, rows: Hit[], q: string): string {
  if (rows.length === 0) return `"${q}" 검색 결과 없음.`;
  const lines: string[] = [header, ""];
  for (const r of rows) {
    const d = r.ts?.slice(0, 10) ?? "";
    lines.push(`### ${r.title} ${d ? `(${d})` : ""}`);
    lines.push(r.snip.replace(/\n+/g, " ").trim());
    lines.push("");
  }
  return lines.join("\n");
}

export interface Retrieved {
  refId: string;
  title: string;
  chunk: string; // 매칭된 청크 원문
  score: number;
  ts: string | null;
}

const ABS_FLOOR = 0.45;
const REL_MARGIN = 0.15;

/**
 * 의미 검색 코어: 쿼리 임베딩 → 노트별 최고 점수 청크 → 관련도 컷오프.
 * search_memory(표시)와 ask_memory(RAG)가 공유.
 */
export async function retrieve(
  db: Database.Database,
  query: string,
  k: number
): Promise<{ hits: Retrieved[]; top: number }> {
  const qvec = normalize(await embed(query, "query"));

  const rows = db
    .prepare("SELECT ref_id AS refId, chunk_text AS chunk, vector FROM note_embeddings")
    .all() as { refId: string; chunk: string; vector: Buffer }[];
  if (rows.length === 0) return { hits: [], top: 0 };

  const best = new Map<string, { score: number; chunk: string }>();
  for (const r of rows) {
    const score = dot(qvec, toVec(r.vector));
    const cur = best.get(r.refId);
    if (!cur || score > cur.score) best.set(r.refId, { score, chunk: r.chunk });
  }

  const all = [...best.entries()]
    .map(([refId, v]) => ({ refId, ...v }))
    .sort((a, b) => b.score - a.score);
  const top = all.length ? all[0].score : 0;
  const kept = all.filter((r) => r.score >= ABS_FLOOR && r.score >= top - REL_MARGIN);
  const ranked = (kept.length ? kept : all.slice(0, 1)).slice(0, k);

  const metaStmt = db.prepare(
    "SELECT title, timestamp FROM sources WHERE external_id = ? AND type = 'NOTE'"
  );
  const hits = ranked.map((s) => {
    const m = metaStmt.get(s.refId) as { title: string; timestamp: string } | undefined;
    return {
      refId: s.refId,
      title: m?.title ?? s.refId,
      chunk: s.chunk,
      score: s.score,
      ts: m?.timestamp ?? null,
    };
  });
  return { hits, top };
}

/**
 * RAG 용 청크 단위 top-K 검색 (노트별 집계 없이 개별 청크). 같은 노트의 여러 청크가
 * 들어올 수 있어, 특정 질문에 딱 맞는 문단(예: 표 청크)을 놓치지 않는다.
 */
export async function retrieveChunks(
  db: Database.Database,
  query: string,
  k: number
): Promise<{ hits: Retrieved[]; top: number }> {
  const qvec = normalize(await embed(query, "query"));
  const rows = db
    .prepare("SELECT ref_id AS refId, chunk_text AS chunk, vector FROM note_embeddings")
    .all() as { refId: string; chunk: string; vector: Buffer }[];
  if (rows.length === 0) return { hits: [], top: 0 };

  const metaStmt = db.prepare(
    "SELECT title, timestamp FROM sources WHERE external_id = ? AND type = 'NOTE'"
  );
  const scored = rows
    .map((r) => {
      const m = metaStmt.get(r.refId) as { title: string; timestamp: string } | undefined;
      return {
        refId: r.refId,
        title: m?.title ?? r.refId,
        chunk: r.chunk,
        score: dot(qvec, toVec(r.vector)),
        ts: m?.timestamp ?? null,
      };
    })
    .sort((a, b) => b.score - a.score);

  return { hits: scored.slice(0, k), top: scored[0]?.score ?? 0 };
}

/** 의미검색(표시용) — retrieve 결과를 스니펫으로 렌더 */
async function semanticSearch(
  db: Database.Database,
  q: string,
  limit: number
): Promise<string> {
  const { hits, top } = await retrieve(db, q, limit);
  if (hits.length === 0) {
    return "임베딩된 노트가 없습니다. sync_notes 를 먼저 실행하세요.";
  }
  const rendered: Hit[] = hits.map((h) => ({
    refId: h.refId,
    title: `${h.title}  ·  유사도 ${h.score.toFixed(3)}`,
    snip: h.chunk.replace(/\n+/g, " ").slice(0, 160).trim() + " …",
    ts: h.ts,
  }));
  const header =
    top < ABS_FLOOR
      ? `🔎 "${q}" 의미검색 — 관련성 높은 결과 없음 (최고 유사도 ${top.toFixed(3)}). 근접 결과:`
      : `🔎 "${q}" 의미검색 ${rendered.length}건`;
  return render(header, rendered, q);
}

/** 키워드 검색: trigram FTS(3자+) 또는 LIKE 폴백(2자 이하) */
function keywordSearch(db: Database.Database, q: string, limit: number): string {
  let rows: Hit[];
  if (q.length >= 3) {
    const ftsQuery = `"${q.replace(/"/g, '""')}"`;
    rows = db
      .prepare(
        `SELECT m.ref_id AS refId, m.title AS title,
                snippet(memory_fts, 3, '《', '》', ' … ', 12) AS snip,
                s.timestamp AS ts
           FROM memory_fts m
           LEFT JOIN sources s ON s.external_id = m.ref_id AND s.type = 'NOTE'
          WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, limit) as Hit[];
  } else {
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const raw = db
      .prepare(
        `SELECT m.ref_id AS refId, m.title AS title, m.body AS body, s.timestamp AS ts
           FROM memory_fts m
           LEFT JOIN sources s ON s.external_id = m.ref_id AND s.type = 'NOTE'
          WHERE m.ref_kind = 'note' AND m.body LIKE ? ESCAPE '\\' LIMIT ?`
      )
      .all(like, limit) as { refId: string; title: string; body: string; ts: string | null }[];
    rows = raw.map((r) => ({ refId: r.refId, title: r.title, snip: makeSnippet(r.body, q), ts: r.ts }));
  }
  return render(`🔎 "${q}" 키워드 검색 ${rows.length}건`, rows, q);
}

/**
 * Personal Memory 검색 — 의미검색 우선, Ollama 미실행/오류 시 키워드로 폴백.
 */
export async function searchMemory(
  db: Database.Database,
  query: string,
  limit = 10
): Promise<string> {
  const q = query.trim();
  if (!q) return "검색어를 입력하세요.";

  if (await isAvailable()) {
    try {
      return await semanticSearch(db, q, limit);
    } catch {
      // 임베딩 실패 → 키워드로 폴백
    }
  }
  return keywordSearch(db, q, limit);
}

/**
 * 노트 전문(全文) 읽기. search_memory 는 스니펫만 주므로,
 * 특정 노트 내용을 통째로 봐야 할 때 사용 (검색 → 읽기 2단계).
 * 제목(부분 일치)으로 찾는다. 여러 개면 목록을 반환해 좁히게 함.
 */
export function getNote(db: Database.Database, query: string): string {
  const q = query.trim();
  if (!q) return "노트 제목이나 키워드를 입력하세요.";

  const rows = db
    .prepare(
      `SELECT external_id AS refId, title, timestamp
         FROM sources
        WHERE type = 'NOTE' AND title LIKE ? ESCAPE '\\'
        ORDER BY timestamp DESC`
    )
    .all(`%${q.replace(/[%_]/g, "\\$&")}%`) as {
    refId: string;
    title: string;
    timestamp: string | null;
  }[];

  if (rows.length === 0) {
    return `"${q}" 제목의 노트를 못 찾음. search_memory 로 먼저 검색해 제목을 확인하세요.`;
  }
  if (rows.length > 1) {
    const list = rows
      .map((r) => `- ${r.title} (${r.timestamp?.slice(0, 10) ?? ""})`)
      .join("\n");
    return `"${q}" 매칭 노트 ${rows.length}개 — 제목을 더 구체적으로 지정하세요:\n${list}`;
  }

  const r = rows[0];
  const body = db
    .prepare("SELECT body FROM memory_fts WHERE ref_kind = 'note' AND ref_id = ?")
    .get(r.refId) as { body: string } | undefined;

  return `# ${r.title}${r.timestamp ? ` (${r.timestamp.slice(0, 10)})` : ""}\n\n${
    body?.body ?? "(본문 없음)"
  }`;
}
