# OpsPilot HANDOFF

> 학습 프로젝트. 핵심 = **Personal Memory** (Apple Notes 의미검색). 두뇌는 Claude, OpsPilot은 검색·읽기 툴 제공.
> 설계 철학: **사실(개수/검색결과)만 제시, 비즈니스 판단은 사용자.**

## 완료

- **MCP 서버 (Node+TS, stdio)** — `~/Library/Application Support/Claude/claude_desktop_config.json` 의 `mcpServers.opspilot` 에 등록. 소스 수정 후 `npm run build` → Claude 재시작 필요(dist 실행).
- **활성 툴 4개:** `hello`, `sync_notes`, `search_memory`, `get_note`
  - `sync_notes`: Apple Notes → sources + memory_fts(trigram 키워드) + note_embeddings(의미검색). 증분(해시 변경분만 재임베딩). 폴더 필터로 개인 "메모" 제외, 일 폴더(i2message/OpsPilot 등)만.
  - `search_memory`: 의미검색(청크단위→노트별 최고청크, 관련도 컷오프) + Ollama 없으면 키워드 폴백. 스니펫 반환.
  - `get_note`: 제목 부분일치로 노트 전문 반환 (search로 찾고 이걸로 통째로 읽기).
- **Apple Notes 추출:** NoteStore.sqlite → gunzip + protobuf(`document(2)→note(3)→note_text(2)`) 로 본문. **표**는 `ZMERGEABLEDATA1`(CRDT protobuf) 재귀 harvest로 셀 텍스트 추출→본문 `[표]` 섹션 붙임. 코드블록은 본문 인라인이라 자동 포함. `￼`/`�` 정제. 이미지/스캔은 OCR 필요→미지원.
- **의미검색:** Ollama `nomic-embed-text`(274MB, **유지**). task prefix(`search_query:`/`search_document:`) 적용, `/api/embed`+truncate. 청킹(~1200자 overlap).
- **로컬 LLM RAG 실험 → 접음:** qwen2.5:7b RAG(`ask_memory`) 붙였으나 환각 심해 품질 미달. **qwen 4.7GB 삭제.** ask_memory 툴 비활성(index.ts 등록 해제), 코드는 `src/context/ask.ts`·CLI `ask`·`ollama.chat()` 보존.
- **메일/브리핑 기능:** `src/_legacy/`로 이관 + tsconfig exclude (빌드·실행 안 됨, 코드 보존). 복원법 `src/_legacy/README.md`.
- **CLI:** `node dist/cli.js {search|note|sync|ask}`. Leader Key 래퍼 `bin/opspilot-search.sh` 있으나 Leader Key 경로는 보류(Claude가 두뇌라 raw 검색보다 나음).
- **전역 prettier hook:** `~/.claude/settings.json` PostToolUse(Write|Edit) → `npx --yes prettier --write --ignore-unknown`. 작동 확인됨.

## 현재 상태

- **FDA:** node 바이너리(`~/.nvm/versions/node/v24.16.0/bin/node`)를 전체 디스크 접근에 **직접** 등록해야 Notes/Mail 읽힘 (Claude 앱 FDA만으론 자식 node가 상속 못 받음).
- **Ollama:** `brew services`로 로그인 시 자동 실행. nomic만 설치됨. 끄면 search_memory가 키워드로 폴백.
- **아키텍처 방향:** Claude Desktop을 두뇌로 사용 중(회사계정). Phase 5 완전격리(Ollama 로컬 + 별도 호스트 Raycast 등 + Claude config에서 OpsPilot 제거)는 **미완**.

## 블로커

- **데이터 위생:** OpsPilot 관련 대화를 붙여넣은 노트("0710 노트 정리", "protobuf 추출은 완전합니다...")가 검색을 오염(모든 질문에 매칭). → 이 메타 노트들을 인덱싱 제외 폴더로 옮기거나 EXCLUDED_FOLDERS 조정 필요.
- **Claude 재시작 필요:** 최신 dist 반영(ask_memory 제거, 표/청킹/컷오프). 재시작 전 sync_notes 돌리면 구코드로 재인덱싱될 수 있음.

## 다음 할 일

- (택1) **데이터 위생 정리** — 메타 노트 인덱싱 제외.
- (택1) **메일도 memory_fts/의미검색 인덱싱** (ref_kind='mail') — 메모+메일 통합검색.
- (택1) **며칠 실사용** 후 부족한 점 판단.
- **global CLAUDE.md 정리** — 정체성/코딩규칙 배치 논의함. 결론: 코딩 행동 바꾸는 것만 CLAUDE.md, 장식성(자격증 나열 등) 덜어내 토큰 절약. 데스크탑 "지침"은 채팅용, CLAUDE.md는 Code용(별개 채널).
- (여유 시) 긴 노트 청킹 품질 개선, Phase 5 격리(로컬 두뇌/별도 호스트).
