// 로컬 Ollama 클라이언트. 회사 데이터가 기기 밖으로 나가지 않음.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.OPSPILOT_EMBED_MODEL ?? "nomic-embed-text";
const CHAT_MODEL = process.env.OPSPILOT_CHAT_MODEL ?? "qwen2.5:7b";

// 페이로드 상한(HTTP 낭비 방지). 토큰 컨텍스트 초과는 Ollama truncate:true 가 처리.
const MAX_CHARS = 8000;

/** nomic-embed-text 는 task prefix 필수 — 없으면 변별력이 크게 떨어짐 */
export type EmbedKind = "query" | "document";

/** 텍스트 → 임베딩 벡터. kind 에 따라 nomic prefix 부여. Ollama 오류 시 throw. */
export async function embed(text: string, kind: EmbedKind = "document"): Promise<number[]> {
  const prefix = kind === "query" ? "search_query: " : "search_document: ";
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: prefix + text.slice(0, MAX_CHARS),
      truncate: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama 임베딩 실패 (HTTP ${res.status}). 'brew services start ollama' 확인.`);
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  const vec = data.embeddings?.[0];
  if (!vec?.length) throw new Error("Ollama 임베딩 응답이 비어있음");
  return vec;
}

/** 로컬 챗 모델로 추론. RAG 답변 생성용. Ollama 오류 시 throw. */
export async function chat(system: string, user: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options: { temperature: 0 },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama 챗 실패 (HTTP ${res.status}). 모델(${CHAT_MODEL}) 설치 확인: 'ollama pull ${CHAT_MODEL}'`
    );
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content?.trim() ?? "";
}

/** 단위벡터로 정규화 → 코사인 유사도를 내적으로 계산 가능 */
export function normalize(v: number[]): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** 정규화된 두 벡터의 내적(=코사인 유사도) */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Ollama 서버 응답 확인 */
export async function isAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
