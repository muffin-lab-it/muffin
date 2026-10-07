<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 머핀랩 프로젝트 규칙 (Claude Code · Codex 공통)

이 레포에서 작업할 때는 아래를 먼저 읽고 따른다.

- 브랜치 · 커밋 · PR 규칙: `CONTRIBUTING.md`. `main` 에 직접 커밋하거나 push 하지 않는다. 작업 전에 `git switch main && git pull origin main` 후 `feat/<tool>-<내용>` 브랜치를 만든다.
- 커밋 메시지는 `feat:` `fix:` `docs:` `test:` `chore:` + 한국어 한 줄. 커밋 메시지에 Co-Authored-By 등 도구 서명을 넣지 않는다.
- 새 tool 은 `src/tools/_template` 을 복사해서 만든다. `name / description / parameters / execute` 를 채우고 반환값에 `source` 를 포함한다. 규격은 `src/tools/types.ts`, 예제는 `README.md` 의 "Tool 만들기 가이드".
- 테스트는 fixture 기반(`fetch` 를 `fixture.json` 으로 대체)으로 작성해 API 키 없이 `pnpm test` 가 통과해야 한다. 실제 API 호출은 `run.ts` 로만 한다.
- `.env.local`, API 키, 비밀값은 절대 커밋하지 않는다. 키는 `process.env` 로만 읽는다.
- `src/tools/index.ts` (레지스트리) 와 `src/agent/` 는 리더만 수정한다. 팀원 작업은 자기 `src/tools/<이름>/` 폴더 안에서 끝낸다.
- PR 을 올리기 전에 `pnpm lint && pnpm typecheck && pnpm test` 를 통과시킨다. PR 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 형식을 따른다.
- 리포트에 매수/매도 등 투자 권유 표현을 생성하지 않는다.
