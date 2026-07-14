import type Database from "better-sqlite3";
import { getUnreadInbox } from "../mail/envelope.js";

/**
 * 현재 Working Context 를 사실 위주로 조립 (판단 없음).
 * 뷰는 저장하지 않는다 — 매번 조회로 파생.
 */
export function getContext(db: Database.Database): string {
  const meta = db
    .prepare("SELECT owner, last_synced_at FROM meta WHERE id = 1")
    .get() as { owner: string; last_synced_at: string } | undefined;

  const mailCount = (
    db.prepare("SELECT COUNT(*) AS c FROM sources WHERE type = 'MAIL'").get() as {
      c: number;
    }
  ).c;

  const unread = getUnreadInbox(50).length;

  const openItems = db
    .prepare(
      "SELECT title FROM work_items WHERE status != 'DONE' ORDER BY updated_at DESC"
    )
    .all() as { title: string }[];

  const lines: string[] = [];
  lines.push(`# Working Context — ${meta?.owner ?? "미설정"}`);
  lines.push(`_last synced: ${meta?.last_synced_at ?? "미동기화"}_`);
  lines.push("");
  lines.push(`## 📮 메일: 안읽음 ${unread}건 (동기화된 메일 ${mailCount}건)`);
  lines.push("");
  lines.push(`## 🗂 진행 중 업무 ${openItems.length}건`);
  for (const w of openItems) lines.push(`- ${w.title}`);

  return lines.join("\n");
}
