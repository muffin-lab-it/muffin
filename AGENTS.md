<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 머핀랩 프로젝트 규칙 (Claude Code · Codex 공통)

이 레포에서 작업할 때는 아래를 먼저 읽고 따른다.

- 브랜치 · 커밋 · PR 규칙: `CONTRIBUTING.md`. `main` 에 직접 커밋하거나 push 하지 않는다. 작업 전에 `git switch main && git pull origin main` 후 `feat/<tool>-<내용>` 브랜치를 만든다.
- 커밋 메시지는 `feat:` `fix:` `docs:` `test:` `chore:` + 한국어 한 줄. 커밋 메시지에 Co-Authored-By 등 도구 서명을 넣지 않는다.
- 새 tool 은 `src/tools/_template` 을 복사해서 만든다. `defineTool` (`src/tools/define.ts`) 로 정의하고 `name / description / parameters / execute` 를 채우며 반환값에 `source` 를 포함한다. 외부 호출은 `src/lib/http.ts` 의 `fetchJson` / `fetchText` 를 쓴다. execute 는 실패 시 throw 한다 (try/catch 로 삼키지 않는다). 규격은 `src/tools/types.ts`, 예제는 `README.md` 의 "Tool 만들기 가이드".
- 테스트는 fixture 기반(`fetch` 를 `fixture.json` 으로 대체)으로 작성해 API 키 없이 `pnpm test` 가 통과해야 한다. 실제 API 호출은 `run.ts` 로만 한다.
- `.env.local`, API 키, 비밀값은 절대 커밋하지 않는다. 키는 `process.env` 로만 읽는다.
- `src/tools/index.ts` (레지스트리), `src/tools/define.ts`, `src/lib/http.ts`, `src/lib/api.ts`, `src/agent/`, `pnpm-workspace.yaml`, `tsconfig.json`, `eslint.config.mjs`, `.github/`, `vercel.json` 은 리더만 수정한다. 라이브러리 추가(`package.json`)는 Discord 에 먼저 공유한 뒤 본인 PR 에 포함하고 PR 본문에 적는다. 프론트 작업은 `app/` 안에서, 백엔드 작업은 `app/api/` 와 `src/lib/history.ts` 에서 한다.
- 화면은 리더에게 받은 `.env.local` 의 실제 키로 개발한다. `MUFFIN_MOCK=1` 은 키가 막혔을 때만 쓰는 비상용이다. 리포트 데이터 모양은 `src/agent/schema.ts`, API 호출은 `src/lib/api.ts` 의 `createReport`, 저장은 `src/lib/history.ts` 만 쓴다. 팀원 작업은 자기 `src/tools/<이름>/` 폴더와 평가 질문 파일 `scripts/questions/<영역>.json` 안에서 끝낸다.
- PR 을 올리기 전에 `pnpm lint && pnpm typecheck && pnpm test` 를 통과시킨다. PR 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 형식을 따른다.
- 리포트에 매수/매도 등 투자 권유 표현을 생성하지 않는다.

## Code Review Rules

Codex 리뷰(`codex review`, PR 의 `@codex review`)는 아래를 우선 확인한다. 형식과 lint 는 CI 가 본다.

### 비밀값
- API 키·토큰이 코드, fixture, 문서, 에러 메시지에 들어가면 지적한다. 안전한 방법: `process.env` 로 읽고, 외부 호출 에러는 `src/lib/http.ts` 의 `HttpError` 처럼 쿼리스트링을 지운다.

### Tool 실패와 출처
- tool `execute` 가 실패를 빈 배열·기본값으로 반환하면 지적한다. 안전한 방법: throw 하면 `defineTool` 이 모델에 실패를 알리고 리포트 `dataGaps` 에 드러난다.
- `source.url` 이 실제 응답과 무관하거나 지어낸 주소면 지적한다.

### 투자 권유
- 리포트 instruction, tool description, 화면 문구에 매수·매도·비중 확대 같은 권유 표현이 생기면 지적한다. 안전한 방법: 사실·원인·영향만 쓰고 판단은 사용자에게 둔다.

### 리더 전용 파일
- 리더가 아닌 사람의 PR 이 위 "리더만 수정한다" 목록의 파일을 바꾸면 지적한다. 라이브러리 추가는 PR 본문에 이유가 있는지 본다.
