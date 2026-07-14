// OpsPilot — Working Context 데이터 모델 (Phase 0)
// 모든 enum은 SQLite CHECK 제약과 값이 1:1로 일치해야 함 (db/schema.sql 참고)

// ────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────

/** 업무 상태. 전이: IN_PROGRESS → WAITING_REPLY → DONE, ON_HOLD 는 언제든 가능 */
export enum WorkItemStatus {
  IN_PROGRESS = "IN_PROGRESS",   // 진행중
  WAITING_REPLY = "WAITING_REPLY", // 답변대기
  ON_HOLD = "ON_HOLD",           // 보류
  DONE = "DONE",                 // 완료
}

/** 누가 다음 행동을 쥐고 있는가 (Working Context의 핵심 축) */
export enum WaitingOn {
  ME = "ME",                   // 내가 처리해야 함
  COUNTERPART = "COUNTERPART", // 내가 상대를 기다림
  NONE = "NONE",
}

/** 우선순위 — 수동 지정 */
export enum Priority {
  HIGH = "HIGH",
  MED = "MED",
  LOW = "LOW",
}

/** 원본 데이터 종류 */
export enum SourceType {
  MAIL = "MAIL",
  NOTE = "NOTE",
  CASE = "CASE",   // Salesforce Support Case 등 (Phase 5)
  EVENT = "EVENT", // Calendar (Phase 5)
}

/** 로그 이벤트 타입 (구조화된 히스토리) */
export enum LogEventType {
  CREATED = "CREATED",
  STATUS_CHANGE = "STATUS_CHANGE",   // from/to 사용
  WAITING_CHANGE = "WAITING_CHANGE", // from/to 사용
  PRIORITY_CHANGE = "PRIORITY_CHANGE", // from/to 사용
  NOTE_ADDED = "NOTE_ADDED",         // detail 사용
  SOURCE_LINKED = "SOURCE_LINKED",   // detail 사용
  COMPLETED = "COMPLETED",
  REOPENED = "REOPENED",
}

// ────────────────────────────────────────────────────────────
// Entities
// ────────────────────────────────────────────────────────────

/** ISO 8601 문자열 (예: "2026-07-10T09:00:00+09:00") */
export type ISODateTime = string;
/** ISO date (예: "2026-07-11") */
export type ISODate = string;

/** work_item 히스토리 한 줄. from/to/detail 은 type 에 따라 선택적으로 채움 */
export interface LogEntry {
  at: ISODateTime;
  type: LogEventType;
  from?: string;   // STATUS/WAITING/PRIORITY_CHANGE
  to?: string;     // STATUS/WAITING/PRIORITY_CHANGE
  detail?: string; // NOTE_ADDED, SOURCE_LINKED 등
}

/** 프로젝트의 중심 오브젝트 */
export interface WorkItem {
  id: string;
  title: string;
  description?: string;
  customer?: string;            // 고객/계정, nullable
  status: WorkItemStatus;
  waitingOn: WaitingOn;
  nextAction?: string;
  priority: Priority;           // 수동
  due?: ISODate;                // nullable
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;    // DONE 일 때만
  log: LogEntry[];
  // source_refs 는 저장하지 않고 sources 에서 linked_item_id 로 조회하여 도출
}

/** 이번 주 목표 (work_item 여러 개와 N:M) */
export interface Goal {
  id: string;
  title: string;
  week: string;                 // ISO week, 예: "2026-W28"
  linkedItemIds: string[];
}

/** 원본 참조 (정제된 메타데이터만 보관) */
export interface Source {
  id: string;
  type: SourceType;
  externalId?: string;          // Apple Mail message id 등
  title: string;                // 메일 제목 / 메모 제목
  from?: string;                // 메일 발신자
  timestamp: ISODateTime;       // 수신/수정 시각
  threadId?: string;            // 메일 스레드
  replied?: boolean;            // 완료 판정 신호 (메일)
  linkedItemId?: string;        // 연결된 work_item (단방향 FK)
}

export interface Meta {
  owner: string;
  lastSyncedAt: ISODateTime;
}

/** 런타임에서 조립되는 전체 컨텍스트 (DB에는 분해되어 저장됨) */
export interface WorkingContext {
  meta: Meta;
  workItems: WorkItem[];
  goals: Goal[];
  sources: Source[];
}
