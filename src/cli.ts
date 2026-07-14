#!/usr/bin/env node
// OpsPilot CLI — MCP 없이 커맨드로 직접 실행 (Leader Key / Raycast / Alfred / cron 등에서 호출).
//   node dist/cli.js search "<검색어>"
//   node dist/cli.js note "<노트 제목>"
//   node dist/cli.js sync
import { initDb } from "./db/init.js";
import { syncNotes } from "./notes/sync.js";
import { searchMemory, getNote } from "./context/search.js";
import { askMemory } from "./context/ask.js";

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const arg = rest.join(" ").trim();
  const db = initDb();

  try {
    switch (cmd) {
      case "search": {
        if (!arg) {
          console.error("사용법: opspilot search <검색어>");
          process.exitCode = 1;
          return;
        }
        console.log(await searchMemory(db, arg, 8));
        return;
      }
      case "ask": {
        if (!arg) {
          console.error("사용법: opspilot ask <질문>");
          process.exitCode = 1;
          return;
        }
        console.log(await askMemory(db, arg));
        return;
      }
      case "note": {
        if (!arg) {
          console.error("사용법: opspilot note <노트 제목>");
          process.exitCode = 1;
          return;
        }
        console.log(getNote(db, arg));
        return;
      }
      case "sync": {
        const r = await syncNotes(db);
        console.log(
          `🧠 노트 ${r.indexed}개 인덱싱 (임베딩 신규 ${r.embedded}·${r.embedChunks}청크 / 스킵 ${r.embedSkipped})` +
            (r.embedError ? `\n⚠️ ${r.embedError}` : "")
        );
        return;
      }
      default:
        console.error("명령: ask <질문> | search <검색어> | note <제목> | sync");
        process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(`오류: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
