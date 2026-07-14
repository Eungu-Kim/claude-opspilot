import type Database from "better-sqlite3";
import { chat, isAvailable } from "../embed/ollama.js";
import { retrieveChunks } from "./search.js";

// "사실만 제시" 철학 유지 — 발췌 근거로만 답하고, 없으면 없다고 하고, 출처를 표기.
const SYSTEM = `너는 사용자의 과거 업무 메모 검색 도우미다. 오직 아래 [메모 발췌]에 실제로 적힌 내용만으로 답한다.

절대 규칙(위반 금지):
1. 발췌에 없는 정보는 한 글자도 추가하지 마라. 너의 일반 지식으로 보충하는 것을 엄격히 금지한다 (예: '전형적인 기술 스택'을 상상해서 채우지 마라).
2. 목록을 물으면 발췌에 실제로 나온 항목만 그대로 나열해라. 없는 항목을 지어내지 마라.
3. 발췌로 답할 수 없으면 다른 말 없이 "메모에서 찾지 못했습니다"라고만 답해라.
4. 각 항목/사실 뒤에 출처 노트 제목을 (제목) 형식으로 표기해라.

결론부터, 간결하게.`;

/**
 * Personal Memory RAG — 질문 임베딩으로 관련 노트 청크를 찾고,
 * 로컬 Ollama 챗 모델이 그 발췌만 근거로 답변을 생성한다.
 */
export async function askMemory(
  db: Database.Database,
  question: string,
  k = 8
): Promise<string> {
  const q = question.trim();
  if (!q) return "질문을 입력하세요.";
  if (!(await isAvailable())) {
    return "Ollama 서버 미응답 — 'brew services start ollama' 확인 필요.";
  }

  const { hits } = await retrieveChunks(db, q, k);
  if (hits.length === 0) {
    return "임베딩된 노트가 없습니다. sync_notes 를 먼저 실행하세요.";
  }

  const context = hits
    .map((h) => `[노트: ${h.title}]\n${h.chunk}`)
    .join("\n\n---\n\n");
  const answer = await chat(SYSTEM, `[메모 발췌]\n${context}\n\n[질문] ${q}`);

  const sources = [...new Set(hits.map((h) => h.title))]
    .map((t) => `- ${t}`)
    .join("\n");
  return `${answer}\n\n---\n📎 근거 노트:\n${sources}`;
}
