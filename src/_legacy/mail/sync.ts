import type Database from "better-sqlite3";
import { readInboxMessages } from "./envelope.js";

export interface SyncResult {
  synced: number;
  unread: number;
}

/**
 * 받은편지함 최근 days 일을 Envelope Index 에서 읽어 sources 테이블에 멱등 저장.
 * 사실(발신자/제목/시각/읽음)만 저장 — 답장 필요 여부 등 판단은 하지 않음.
 * external_id = RFC Message-ID (없으면 rowid 폴백) → 재실행해도 중복 없음.
 */
export function syncMail(db: Database.Database, days: number): SyncResult {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const mails = readInboxMessages(since);

  const upsert = db.prepare(
    `INSERT INTO sources
       (id, type, external_id, title, from_addr, timestamp, thread_id, is_read)
     VALUES
       (@id, 'MAIL', @externalId, @title, @fromAddr, @timestamp, @threadId, @isRead)
     ON CONFLICT(id) DO UPDATE SET
       title     = excluded.title,
       from_addr = excluded.from_addr,
       timestamp = excluded.timestamp,
       thread_id = excluded.thread_id,
       is_read   = excluded.is_read`
  );

  let unread = 0;
  const run = db.transaction((rows: typeof mails) => {
    for (const m of rows) {
      const extId = m.rfcId ?? `rowid:${m.rowid}`;
      if (!m.isRead) unread++;
      upsert.run({
        id: `mail_${extId}`,
        externalId: extId,
        title: m.subject ?? "(제목 없음)",
        fromAddr: m.sender ?? "",
        timestamp: new Date(m.dateReceived * 1000).toISOString(),
        threadId: String(m.conversationId),
        isRead: m.isRead ?? 0,
      });
    }
  });
  run(mails);

  db.prepare("UPDATE meta SET last_synced_at = ? WHERE id = 1").run(
    new Date().toISOString()
  );

  return { synced: mails.length, unread };
}
