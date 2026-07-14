import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/db 또는 src/db 기준 → 프로젝트 루트는 두 단계 위
const PROJECT_ROOT = join(__dirname, "..", "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const DB_PATH = join(DATA_DIR, "opspilot.db");
const SCHEMA_PATH = join(__dirname, "schema.sql");

const OWNER = "eskim";

/**
 * SQLite 연결을 열고 스키마를 적용한 뒤 meta 단일 행을 보장한다.
 * 애플리케이션 전역에서 이 커넥션 하나를 공유한다.
 */
export function initDb(): Database.Database {
  mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 3000"); // MCP 서버 + CLI 동시 접근 대비

  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);

  // meta 단일 행 보장 (id=1 고정)
  db.prepare(
    `INSERT OR IGNORE INTO meta (id, owner, last_synced_at) VALUES (1, ?, ?)`
  ).run(OWNER, new Date().toISOString());

  return db;
}

export { DB_PATH };
