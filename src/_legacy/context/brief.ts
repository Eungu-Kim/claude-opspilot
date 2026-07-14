import type Database from "better-sqlite3";
import { getUnreadInbox } from "../mail/envelope.js";

/**
 * Morning Brief — 사실(개수)만 제시. 비즈니스 판단(답장/우선순위)은 사용자 몫.
 *
 *   좋은 아침입니다.
 *   📅 오늘 일정 N건
 *   📮 확인해야 할 메일 N건   (= 안읽은 메일 개수)
 *   📝 오늘 해야 하는 메모 N건
 */
export function buildMorningBrief(_db: Database.Database): string {
  const unread = getUnreadInbox(50).length;

  // Calendar / Notes 는 아직 미연동 → null 이면 "(연동 예정)" 표시
  const events: number | null = null;
  const notes: number | null = null;

  const fmt = (n: number | null) => (n === null ? "— (연동 예정)" : `${n}건`);

  return [
    "좋은 아침입니다 ☀️",
    "",
    `📅 오늘 일정 ${fmt(events)}`,
    `📮 확인해야 할 메일 ${fmt(unread)}`,
    `📝 오늘 해야 하는 메모 ${fmt(notes)}`,
  ].join("\n");
}
