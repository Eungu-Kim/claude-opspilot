# _legacy (비활성 코드)

메일/브리핑 관련 기능. **tsconfig `exclude` 에 걸려 빌드되지 않고, 서버에도 등록되지 않음** →
프로그램 실행 시 절대 돌지 않음. 참고용으로 코드만 보존.

| 파일 | 원래 툴 |
|---|---|
| `mail/envelope.ts` | Apple Mail Envelope Index 읽기 (안읽음/받은편지함) |
| `mail/sync.ts` | `sync_mail` — 받은편지함 → sources |
| `context/get.ts` | `get_context` — Working Context 요약 |
| `context/brief.ts` | `morning_brief` — 아침 브리핑(안읽은 메일 개수) |

## 되살리려면
1. 이 폴더의 파일들을 `src/mail/`, `src/context/` 로 되돌린다.
2. `tsconfig.json` 의 `exclude` 에서 `src/_legacy` 제거.
3. `src/index.ts` 에 import + `server.tool(...)` 등록 복원 (git 히스토리 참고).

> 비활성 사유: Personal Memory(노트 의미검색)로 방향 집중. 메일/브리핑은 안 쓰기로 함(2026-07-10).
> 단 `sources` 테이블은 노트도 사용하므로 스키마에 유지됨.
