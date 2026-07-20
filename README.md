# OpsPilot

Apple Notes에 쌓인 업무 기록을 검색하고 이어서 볼 수 있는 개인용 MCP 서버.

- 일반적인 할 일 관리나 브리핑보다, 과거에 작성하거나 정리해 둔 내용 검색에 초점
- 검색 결과와 건수처럼 확인 가능한 정보만 제공
- 답장 여부나 우선순위 같은 판단은 사용자 책임

## 제공 도구

| 도구            | 용도                                                              |
| --------------- | ----------------------------------------------------------------- |
| `hello`         | MCP 연결 및 DB 상태 확인                                          |
| `sync_notes`    | Apple Notes를 `sources`, `memory_fts`, `note_embeddings`에 동기화 |
| `search_memory` | 관련 메모를 의미 기반으로 검색하고 스니펫 반환                    |
| `get_note`      | 제목 및 내용 일부로 노트 전문 조회                                |

- 기본 흐름: `search_memory`로 후보 검색 → `get_note`로 전체 내용 확인

## 동작 방식

### 검색 대상

- Apple Notes 본문 텍스트 인덱싱
- 코드블록은 본문 텍스트에 포함되므로 자동 검색 대상
- 표 셀은 `ZMERGEABLEDATA1`의 CRDT protobuf를 재귀적으로 읽어 수집
- 이미지와 스캔 문서는 OCR 미지원으로 검색 대상 제외
- 잠긴 노트, 암호화 노트, Recently Deleted 노트 제외
- 개인 용도의 기본 폴더 제외, `i2message`, `OpsPilot` 등 업무 폴더만 인덱싱
- 제외 목록: `EXCLUDED_FOLDERS` 상수

### 의미 검색과 폴백

- 기본 검색: 로컬 Ollama `nomic-embed-text` 임베딩(768차원)
- `note_embeddings`에 노트별 정규화 벡터와 텍스트 해시 저장
- 텍스트 해시 기준으로 변경된 노트만 재임베딩
- Apple Notes `ZIDENTIFIER` UUID 기준 멱등 동기화
- Ollama 미사용 시 키워드 검색으로 자동 폴백
  - 3자 이상: trigram FTS
  - 2자 이하: `LIKE`
- 임베딩 API: `/api/embed`, `truncate: true`
- 긴 노트: 앞 2,048토큰만 임베딩
- 향후 보완: 노트 단위 임베딩 대신 청킹 도입

### Notes 데이터 읽기

- 원본 DB: `~/Library/Group Containers/group.com.apple.notes/`의 `NoteStore.sqlite`
- 라이브 DB, `-wal`, `-shm` 파일 복사 후 읽기 전용 조회
- 본문 추출: `ZICNOTEDATA.ZDATA` gzip 해제 후 protobuf `document(2) → note(3) → note_text(2)` 최소 파싱
- 파싱 실패 시 바이트 정제 방식으로 폴백
- 해당 경로는 macOS TCC 보호 대상이라 Full Disk Access(FDA) 필요
- Claude 앱에 FDA를 부여해도 자식 프로세스에 권한이 전달되지 않는 환경 존재
- 필요 시 사용하는 `node` 바이너리를 FDA 목록에 직접 추가

## 구성

```text
src/
  index.ts          MCP 서버 진입점(stdio) 및 도구 등록
  types.ts          Working Context 데이터 모델
  db/
    schema.sql      SQLite DDL
    init.ts         DB 연결, 스키마 적용, meta 초기화
  embed/
    ollama.ts       Ollama 임베딩 및 코사인 유사도 계산
  notes/
    notestore.ts    NoteStore.sqlite 조회, gzip/protobuf 텍스트 추출
    sync.ts         Notes 동기화 및 증분 임베딩
  context/
    search.ts       의미 검색과 키워드 폴백
  _legacy/          빌드에서 제외된 이전 메일/브리핑 코드
data/opspilot.db    런타임 생성 파일(gitignore)
```

## 로컬 모델 관련 정책

- 응답 생성과 판단: MCP 서버가 아닌 호출 AI 클라이언트 담당
- OpsPilot 역할: 검색과 원문 조회
- `ask_memory`, `src/context/ask.ts`, CLI `ask`: 코드만 보존하고 현재 빌드·실행 대상에서 제외
- 제외 사유: 로컬 `qwen2.5:7b` 기반 응답 품질 미달
- 복원: `ollama pull qwen2.5:7b` 실행 후 등록 복원
- 의미 검색에는 `nomic-embed-text`만 필요

```bash
brew install ollama
brew services start ollama
ollama pull nomic-embed-text
```

- 이전 메일/브리핑 도구: `sync_mail`, `morning_brief`, `get_context`
- 현재 위치: `src/_legacy/`
- 상태: 빌드 제외, 코드 보존
- 복원 방법: `src/_legacy/README.md` 참고

## 실행

```bash
npm install
npm run build
npm start
node scripts/smoke.mjs
```

- `npm run build`: TypeScript를 `dist`로 컴파일하고 `schema.sql` 복사

## Claude Desktop 연결

- 설정 파일: `~/Library/Application Support/Claude/claude_desktop_config.json`
- 등록 위치: `mcpServers.opspilot`
- Claude Desktop은 `dist` 실행
- 소스 수정 후 필요 절차

```bash
npm run build
```

- 빌드 완료 후 Claude Desktop 재시작

## 실행 예시

- **동기화 현황 확인**
  - 요청: `메모 동기화 해줘`
  - 응답: `메모 16개 동기화 완료. 신규 2개 · 폴더1: 13개(+2) · 폴더2: 2개 · 폴더3: 1개`

- **기록에 없는 URL·링크 확인**
  - 요청: `메모장에 CI 호출 API의 직접 URL이나 관련 자료 링크가 있던가?`
  - 응답: `확인된 메모 기준으로 직접 URL이나 공식 문서 링크는 기록 없음. 기록된 내용: ...`

- **흐릿한 기술 기억 복원**
  - 요청: `CI에서 Dimension하고 하나 더 있는데 뭐였지?`
  - 응답: `다른 하나는 Measure. Dimension은 분류 기준, Measure는 값을 계산하거나 결정하는 값`

- **특정 폴더의 노트 전문 조회**
  - 요청: `OpsPilot 폴더에서 개인 기억에 관한 내용 전문 가져와줘`
  - 응답: `🧠 OpsPilot(가칭) 메모의 Personal Memory 전문 · 3. Personal Memory 목적 ...`

- **날짜 기준 작업 진행 상황 확인**
  - 요청: `6월 26일 마무리하면서 작성한 문서에서 내가 어떤 부분까지 진행했는지 알 수 있어?`
  - 응답: `6월 26일 기준, 구현 완료보다 설계 확정·영향도 검증까지 진행한 상태. 진행 범위: ...`

## 이후 계획

- Ollama와 별도 호스트(Raycast)로 이전해 Claude 계정과 분리
- 이메일을 `memory_fts`에 추가하고 `ref_kind='mail'`로 의미 검색 지원
