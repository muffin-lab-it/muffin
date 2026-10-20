## 무엇을
<!-- 예: [fx] 환율 변동률 계산 추가 -->

## 왜

## 테스트 방법
- [ ] `pnpm lint && pnpm typecheck && pnpm test` 통과
- [ ] (tool) `pnpm tool src/tools/<이름>/run.ts ...` 로 실제 응답 확인 (로컬)
- [ ] (화면·API) `pnpm dev` 에서 직접 눌러 확인

## Codex 활용
<!-- 발표 때 "Codex 로 무엇을 했는지" 의 근거가 됩니다. 짧게라도 채워 주세요 -->
- 맡긴 일: <!-- 구현 / 테스트 / 리뷰 / 문서 중 해당하는 것 + 한 줄. 예: 구현 — _template 주고 FX tool 초안 -->
- 리뷰: <!-- `codex review --base main` / PR 의 `@codex review` 중 받은 것 -->
- 리뷰가 잡은 것: <!-- 1~3개. 반영했으면 ✅, 안 했으면 ❌ + 이유. 없었으면 "지적 없음" -->
  1.

## 체크리스트
- [ ] API 키는 `process.env` 로만 접근, 하드코딩 없음
- [ ] (tool) `fixture.json` 에 실제 응답 샘플 저장 (못 넣으면 tool README 에 이유)
- [ ] (tool) 외부 API 실패 시 명확히 throw (빈 값 반환 금지)
- [ ] (tool) 외부 호출은 `fetchJson` / `fetchText` 사용
- [ ] (tool) `source.url` 이 실제로 열리는 링크
- [ ] (tool) tool 폴더 `README.md` 갱신

## 스크린샷 (화면 변경 시)
