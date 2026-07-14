# OpsPilot

운영자의 업무 컨텍스트를 기억하고 이어주는 AI 워크벤치 (MCP 서버). **학습 프로젝트.**

## 핵심: Personal Memory

기성 할일/브리핑 앱과 경쟁하지 않는다. 차별점은 **"과거의 나" 검색** — 방대하고
중구난방인 Apple Notes(직접 쓴 것 + AI가 정리해 붙여넣은 것)에서 특정 내용을
전문검색으로 찾아준다. 기성 앱이 못 하는 것.

**설계 철학: 사실(개수/검색결과)만 제시, 비즈니스 판단(답장 여부·우선순위)은 사용자.**

## 활성 툴 (4개)

| 툴 | 설명 |
|---|---|
| `hello` | 연결/DB 상태 확인 |
| `sync_notes` | Apple Notes → sources + memory_fts + note_embeddings 인덱싱 |
| `search_memory` | 메모 의미검색 ("과거의 나" 찾기) — 스니펫 반환 |
| `get_note` | 노트 전문(全文) 읽기 (제목 부분일치). search_memory 로 찾고 이걸로 통째로 읽음 |

**두뇌 = Claude.** 검색·읽기(retrieval)는 OpsPilot 툴이, 추론은 Claude 가. 로컬 LLM 추론
(`ask_memory` / `src/context/ask.ts` / CLI `ask`)은 코드 보존하되 비활성 — 로컬 7B(qwen)가
환각이 심해 품질 미달이었음. `ollama pull qwen2.5:7b` + 등록 복원 시 되살아남.
**임베딩용 `nomic-embed-text`(274MB)만 유지** (의미검색에 필요, Ollama 서버 실행 유지).

**검색 대상 콘텐츠:** 본문 텍스트 + **코드블록**(인라인 텍스트라 자동 포함) + **표 셀**
(`ZMERGEABLEDATA1` CRDT protobuf 재귀 harvest, 구조 잡음 필터). 이미지/스캔은 OCR 필요 → 미지원.

> 메일/브리핑 툴(`sync_mail`, `morning_brief`, `get_context`)은 안 쓰기로 하여
> **`src/_legacy/` 로 이관 + 빌드 제외**. 코드만 보존, 실행 안 됨. 복원법은 `src/_legacy/README.md`.

### Personal Memory 구현
- **소스:** Apple Notes `NoteStore.sqlite` (`~/Library/Group Containers/group.com.apple.notes/`).
  라이브 DB + -wal + -shm 복사 후 read-only 조회. **FDA 필요.**
- **본문 추출:** `ZICNOTEDATA.ZDATA` 는 gzip+protobuf. gunzip 후
  `document(2)→note(3)→note_text(2)` 최소 파싱으로 텍스트 추출(실패 시 바이트 정제 폴백).
  잠긴/암호화 노트·Recently Deleted 제외.
- **폴더 필터:** 기본 "메모(Notes)" 등 개인 폴더 제외, 일 폴더(i2message/OpsPilot 등)만 인덱싱
  (`EXCLUDED_FOLDERS` 상수).
- **의미검색 (핵심):** **Ollama 로컬** `nomic-embed-text`(768차원) 임베딩 → 코사인 유사도.
  키워드 일치 없이 "의미"로 검색. `note_embeddings` 테이블에 정규화 벡터 + 텍스트 해시(증분 재임베딩).
  Ollama 미실행 시 키워드(trigram FTS / 2자 이하 LIKE)로 자동 폴백. 멱등 기준 = ZIDENTIFIER(UUID).
- **Ollama:** `brew install ollama && brew services start ollama && ollama pull nomic-embed-text`.
  임베딩은 `/api/embed` + `truncate:true` (긴 한국어 컨텍스트 초과 500 방지). ⚠️ 긴 노트는 앞 2048토큰만 임베딩(추후 청킹).

## 구조

```
src/
  index.ts          MCP 서버 진입점 (stdio) + 툴 등록
  types.ts          Working Context 데이터 모델
  db/
    schema.sql      SQLite DDL (sources / memory_fts[trigram] / note_embeddings ...)
    init.ts         DB 연결 + 스키마 적용 + meta 시딩
  embed/
    ollama.ts       로컬 임베딩(nomic-embed-text) + 코사인
  notes/
    notestore.ts    NoteStore.sqlite 읽기 + gunzip/protobuf 텍스트 추출
    sync.ts         sync_notes (키워드 + 증분 임베딩)
  context/
    search.ts       search_memory (의미검색 + 키워드 폴백)
  _legacy/          [빌드 제외] 메일/브리핑 코드 보존 (mail/, context/brief|get)
data/opspilot.db    런타임 생성 (gitignore)
```

## 실행

```bash
npm install
npm run build            # tsc → dist, schema.sql 복사
npm start                # node dist/index.js (stdio MCP 서버)
node scripts/smoke.mjs   # MCP 클라이언트 스모크 테스트
```

## Claude Desktop 연결

`~/Library/Application Support/Claude/claude_desktop_config.json` 의 `mcpServers.opspilot` 에 등록됨.
**소스 수정 후 반드시 `npm run build` → Claude Desktop 재시작** (dist 를 실행하므로).

### Full Disk Access (필수)
`~/Library/Mail`, `~/Library/Group Containers/...notes` 는 TCC 보호.
⚠️ Claude 앱에 FDA 를 줘도 자식 node 가 상속 못 받는 경우가 있음 →
**node 바이너리(`~/.nvm/.../bin/node`)를 FDA 목록에 직접 추가**해야 함.

## 향후

- 격리(회사계정 무관) 완성: Phase 5 에서 Ollama(로컬) + 별도 호스트(Raycast) 로 이전,
  Claude Desktop config 에서 OpsPilot 제거.
- Personal Memory 확장: 메일도 memory_fts 인덱싱(ref_kind='mail'), 임베딩 기반 의미검색.
