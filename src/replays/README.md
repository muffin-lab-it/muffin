# 리플레이 녹화 (리더)

시연에서 OpenAI · 외부 API 를 부르지 않고 실제 실행을 다시 보여 주기 위한 녹화입니다. 형식은 `src/lib/replay.ts` 의 `replaySchema`, 설명은 README 의 "리플레이 모드".

- 녹화: `pnpm replay:record --question "KODEX 200 지금 사도 돼?" --area etf --depth standard --id etf-decision` (실제 OpenAI · tool 호출, `.env.local` 필요). 결과는 `<id>.json`, 목록 `manifest.json` 과 `index.ts` 는 자동으로 다시 만들어집니다.
- 확인: `pnpm replay:record --check` 가 모든 파일을 검사합니다 (`pnpm test` 도 같은 검사를 합니다). 권유 표현이 남은 리포트는 녹화하지 않습니다.
- 재생: `/replay` 화면, 또는 `POST /api/report/stream` 에 `{ "replay": "<id>", "speed": 2 }`.
- 녹화는 그때의 실제 데이터입니다. 재생 화면과 리포트 상단에 녹화 시각을 밝힙니다.
