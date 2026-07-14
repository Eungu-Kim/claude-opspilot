-- OpsPilot — Working Context SQLite 스키마 (Phase 0)
-- SQLite 에는 네이티브 enum 이 없으므로 TEXT + CHECK 제약으로 구현.
-- CHECK 값은 types.ts 의 enum 과 반드시 일치해야 함.

PRAGMA foreign_keys = ON;

-- ────────────────────────────────────────────────────────────
-- meta : 단일 행 (id=1 고정)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  owner          TEXT NOT NULL,
  last_synced_at TEXT NOT NULL
);

-- ────────────────────────────────────────────────────────────
-- work_items : 중심 오브젝트
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_items (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  customer     TEXT,
  status       TEXT NOT NULL
                 CHECK (status IN ('IN_PROGRESS','WAITING_REPLY','ON_HOLD','DONE')),
  waiting_on   TEXT NOT NULL
                 CHECK (waiting_on IN ('ME','COUNTERPART','NONE')),
  next_action  TEXT,
  priority     TEXT NOT NULL
                 CHECK (priority IN ('HIGH','MED','LOW')),
  due          TEXT,               -- ISO date, nullable
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT                 -- DONE 일 때만
);

-- Morning Brief / Wrap-up 조회 최적화
CREATE INDEX IF NOT EXISTS idx_wi_waiting_status ON work_items (waiting_on, status);
CREATE INDEX IF NOT EXISTS idx_wi_due            ON work_items (due);
CREATE INDEX IF NOT EXISTS idx_wi_completed      ON work_items (completed_at);

-- ────────────────────────────────────────────────────────────
-- work_item_logs : 구조화된 히스토리 (diff / Wrap-up 근거)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_item_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  at           TEXT NOT NULL,
  type         TEXT NOT NULL
                 CHECK (type IN ('CREATED','STATUS_CHANGE','WAITING_CHANGE',
                                 'PRIORITY_CHANGE','NOTE_ADDED','SOURCE_LINKED',
                                 'COMPLETED','REOPENED')),
  from_value   TEXT,               -- *_CHANGE 계열
  to_value     TEXT,               -- *_CHANGE 계열
  detail       TEXT                -- NOTE_ADDED, SOURCE_LINKED 등
);

CREATE INDEX IF NOT EXISTS idx_log_item ON work_item_logs (work_item_id, at);
CREATE INDEX IF NOT EXISTS idx_log_at   ON work_item_logs (at);

-- ────────────────────────────────────────────────────────────
-- goals + goal_links (N:M)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  week  TEXT NOT NULL             -- 예: '2026-W28'
);

CREATE TABLE IF NOT EXISTS goal_links (
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  PRIMARY KEY (goal_id, work_item_id)
);

-- ────────────────────────────────────────────────────────────
-- sources : 메일 / 메모 / (추후) 케이스·이벤트
-- work_item 과는 linked_item_id 단방향 FK 로 연결
-- ────────────────────────────────────────────────────────────
-- 사실(fact)만 저장. 답장 필요 여부 등 비즈니스 판단은 저장하지 않음 (사용자 몫).
CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL
                   CHECK (type IN ('MAIL','NOTE','CASE','EVENT')),
  external_id    TEXT,
  title          TEXT NOT NULL,
  from_addr      TEXT,
  timestamp      TEXT NOT NULL,
  thread_id      TEXT,
  is_read        INTEGER,          -- 0/1 (사실: 읽음 여부)
  linked_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_src_linked ON sources (linked_item_id);
CREATE INDEX IF NOT EXISTS idx_src_thread ON sources (thread_id);

-- ────────────────────────────────────────────────────────────
-- FTS5 : Personal Memory 전문검색
-- work_items 와 sources 를 한 인덱스에 모아 검색
-- ────────────────────────────────────────────────────────────
-- trigram 토크나이저: 한국어/혼합 텍스트 부분 문자열 검색에 강함 (min 3자).
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  ref_kind,        -- 'note' | 'mail' | 'work_item'
  ref_id UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);
-- 사용: sync 시 애플리케이션에서 memory_fts 동기화(ref_kind+ref_id 단위 delete→insert).
-- 검색:  SELECT ref_id FROM memory_fts WHERE memory_fts MATCH '"FieldDefinition"';

-- ────────────────────────────────────────────────────────────
-- note_embeddings : 의미검색용 벡터 (Ollama nomic-embed-text, 768차원)
-- 노트당 여러 청크(chunk). vector 는 정규화된 Float32Array BLOB.
-- hash(노트 전체 텍스트) 로 증분 재임베딩 판단(변경 시 해당 노트 청크 전부 재생성).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_embeddings (
  ref_id     TEXT NOT NULL,      -- ZIDENTIFIER (memory_fts.ref_id / sources.external_id 와 동일)
  chunk_idx  INTEGER NOT NULL,   -- 노트 내 청크 순번
  hash       TEXT NOT NULL,      -- 노트 전체 텍스트 해시 (변경 감지)
  chunk_text TEXT NOT NULL,      -- 청크 원문 (검색 스니펫용)
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ref_id, chunk_idx)
);
