import Database from "better-sqlite3";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  readdirSync,
  existsSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";

/** Envelope Index 에서 읽어온 원시 메일 한 건 */
export interface RawMail {
  rowid: number;
  rfcId: string | null; // RFC Message-ID (<...@...>), 멱등성 키
  sender: string | null;
  subject: string | null;
  dateReceived: number; // Unix epoch 초
  isRead: number; // 0/1
  unsub: number | null; // unsubscribe_type (>0 이면 광고 신호)
  conversationId: number;
}

/**
 * ~/Library/Mail/V{n}/MailData/Envelope Index 경로 탐색.
 * 여러 V 버전이 있으면 가장 최신(숫자 큰) 것 선택.
 */
function findEnvelopeIndex(): string | null {
  const mailRoot = join(homedir(), "Library", "Mail");
  if (!existsSync(mailRoot)) return null;

  const versions = readdirSync(mailRoot)
    .filter((n) => /^V\d+$/.test(n))
    .sort((a, b) => parseInt(b.slice(1), 10) - parseInt(a.slice(1), 10));

  for (const v of versions) {
    const p = join(mailRoot, v, "MailData", "Envelope Index");
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 라이브 Envelope Index 를 임시 폴더로 복사(원본 + -wal + -shm)한 뒤 read-only 로 열어
 * fn 에 넘긴다. 조회가 끝나면 복사본을 정리. 라이브 DB 는 절대 건드리지 않음.
 */
function withEnvelopeDb<T>(fn: (db: Database.Database) => T): T {
  const src = findEnvelopeIndex();
  if (!src) {
    throw new Error(
      "Envelope Index를 찾을 수 없습니다. Full Disk Access 권한과 Apple Mail 계정 설정을 확인하세요."
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), "opspilot-mail-"));
  const dst = join(tmp, "ei.sqlite");
  copyFileSync(src, dst);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(src + suffix)) copyFileSync(src + suffix, dst + suffix);
  }

  try {
    const db = new Database(dst); // 복사본이라 read-write 로 열어 WAL 자동 병합
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** INBOX mailbox ROWID 목록 (Gmail 라벨/표준 IMAP 모두 url 이 .../INBOX) */
function inboxIds(db: Database.Database): number[] {
  return (
    db.prepare("SELECT ROWID AS id FROM mailboxes WHERE url LIKE '%/INBOX'").all() as {
      id: number;
    }[]
  ).map((r) => r.id);
}

const SELECT_COLS = `m.ROWID              AS rowid,
       g.message_id_header  AS rfcId,
       a.address            AS sender,
       s.subject            AS subject,
       m.date_received      AS dateReceived,
       m.read               AS isRead,
       m.unsubscribe_type   AS unsub,
       m.conversation_id    AS conversationId`;

const JOINS = `LEFT JOIN message_global_data g ON g.ROWID = m.global_message_id
   LEFT JOIN addresses a          ON a.ROWID = m.sender
   LEFT JOIN subjects s           ON s.ROWID = m.subject`;

// Gmail(라벨) + 표준 IMAP(mailbox 직접) 둘 다 커버하는 INBOX 소속 조건
function inboxWhere(ids: number[]): string {
  const ph = ids.map(() => "?").join(",");
  return `( m.mailbox IN (${ph}) OR m.ROWID IN (SELECT message_id FROM labels WHERE mailbox_id IN (${ph})) )`;
}

/** 받은편지함 메일을 sinceEpoch 이후로 조회 (sync_mail 용) */
export function readInboxMessages(sinceEpoch: number): RawMail[] {
  return withEnvelopeDb((db) => {
    const ids = inboxIds(db);
    if (ids.length === 0) return [];
    return db
      .prepare(
        `SELECT ${SELECT_COLS}
           FROM messages m
           ${JOINS}
          WHERE m.deleted = 0 AND m.date_received >= ? AND ${inboxWhere(ids)}
          ORDER BY m.date_received DESC`
      )
      .all(sinceEpoch, ...ids, ...ids) as RawMail[];
  });
}

/** 받은편지함의 안읽은 메일 전체 조회 (Morning Brief 핵심 지표, 실시간) */
export function getUnreadInbox(limit = 50): RawMail[] {
  return withEnvelopeDb((db) => {
    const ids = inboxIds(db);
    if (ids.length === 0) return [];
    return db
      .prepare(
        `SELECT ${SELECT_COLS}
           FROM messages m
           ${JOINS}
          WHERE m.deleted = 0 AND m.read = 0 AND ${inboxWhere(ids)}
          ORDER BY m.date_received DESC
          LIMIT ?`
      )
      .all(...ids, ...ids, limit) as RawMail[];
  });
}
