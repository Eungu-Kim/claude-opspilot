import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initDb, DB_PATH } from "./db/init.js";
import { syncNotes } from "./notes/sync.js";
import { searchMemory, getNote } from "./context/search.js";
// 로컬 LLM 추론(ask_memory)은 비활성 — Claude 를 두뇌로 사용. 코드는 src/context/ask.js 에 보존.
// 되살리려면: `ollama pull qwen2.5:7b` 후 아래 import 와 ask_memory 툴 등록 복원.
// import { askMemory } from "./context/ask.js";
// 메일/브리핑 기능은 src/_legacy/ 로 이관(빌드·등록 제외). 되살리려면 import + 툴 등록 복원.

// ⚠️ stdio 트랜스포트는 stdout 을 JSON-RPC 로만 씀.
//    로그는 반드시 stderr(console.error) 로 출력할 것. stdout 오염 시 연결 깨짐.
const db = initDb();
console.error(`[opspilot] DB ready at ${DB_PATH}`);

const server = new McpServer({
  name: "opspilot",
  version: "0.0.1",
});

// Phase 0 완료 기준: 연결 확인용 hello 툴
server.tool(
  "hello",
  "OpsPilot 서버 연결/DB 상태 확인용 툴",
  {
    name: z.string().optional().describe("인사할 이름 (선택)"),
  },
  async ({ name }) => {
    const meta = db
      .prepare("SELECT owner, last_synced_at FROM meta WHERE id = 1")
      .get() as { owner: string; last_synced_at: string } | undefined;

    const who = name ?? meta?.owner ?? "운영자";
    const text = [
      `👋 안녕하세요, ${who}님. OpsPilot 서버가 살아있습니다.`,
      `- owner: ${meta?.owner ?? "미설정"}`,
      `- last_synced_at: ${meta?.last_synced_at ?? "미설정"}`,
      `- db: ${DB_PATH}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// [비활성] sync_mail / get_context / morning_brief 는 src/_legacy/ 로 이관됨.

// Apple Notes 동기화 + 전문검색 인덱싱 (Personal Memory)
server.tool(
  "sync_notes",
  "Apple Notes 를 읽어 Personal Memory 전문검색 인덱스에 저장",
  {},
  async () => {
    const r = await syncNotes(db);
    const breakdown = Object.entries(r.byFolder)
      .map(([f, c]) => `  - ${f}: ${c}`)
      .join("\n");
    let embedLine = `🔢 임베딩: 신규 ${r.embedded}개 노트 (${r.embedChunks}청크) / 스킵 ${r.embedSkipped}`;
    if (r.embedError) embedLine += `\n⚠️ ${r.embedError}`;
    const text = `🧠 노트 ${r.indexed}개 인덱싱 완료 (폴더별)\n${breakdown}\n${embedLine}`;
    return { content: [{ type: "text", text }] };
  }
);

// Personal Memory 검색 — "과거의 나" 찾기
server.tool(
  "search_memory",
  "메모(Personal Memory)에서 특정 내용을 전문검색으로 찾기",
  {
    query: z.string().describe("검색어 (3자 이상)"),
    limit: z.number().int().positive().optional().describe("최대 결과 수 (기본 10)"),
  },
  async ({ query, limit }) => {
    return { content: [{ type: "text", text: await searchMemory(db, query, limit ?? 10) }] };
  }
);

// [비활성] ask_memory — 로컬 LLM(qwen) RAG. Claude 를 두뇌로 쓰기로 하여 등록 해제.
//   코드는 src/context/ask.ts 에 보존. 되살리려면 qwen 재설치 + 아래 등록 복원.
//   server.tool("ask_memory", ..., async ({question}) => ({content:[{type:"text",text:await askMemory(db,question)}]}))

// 노트 전문 읽기 — search_memory(스니펫) 로 찾은 뒤 통째로 확인
server.tool(
  "get_note",
  "노트 전문(全文)을 제목으로 읽기 (search_memory 는 스니펫만 주므로 전체 내용은 이걸로)",
  {
    title: z.string().describe("노트 제목 (부분 일치 가능)"),
  },
  async ({ title }) => {
    return { content: [{ type: "text", text: getNote(db, title) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[opspilot] MCP server connected via stdio");
