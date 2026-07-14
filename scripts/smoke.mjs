// 스모크: Personal Memory (표 검색 + 전문 읽기 포함)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

console.log("tools:", (await client.listTools()).tools.map((t) => t.name));

console.log("\n--- sync_notes ---");
console.log((await client.callTool({ name: "sync_notes", arguments: {} })).content[0].text);

// 표 안에 있던 내용 검색 (예: "Journey Builder", "Marketing Cloud")
for (const q of ["Journey Builder", "Core Cloud 지원 내용"]) {
  console.log(`\n--- search_memory("${q}") [표 내용] ---`);
  console.log((await client.callTool({ name: "search_memory", arguments: { query: q, limit: 2 } })).content[0].text);
}

console.log("\n--- get_note('OpsPilot') [전문] ---");
const full = (await client.callTool({ name: "get_note", arguments: { title: "OpsPilot" } })).content[0].text;
console.log("전문 길이:", full.length, "자");
console.log(full.slice(0, 250), "…");

await client.close();
