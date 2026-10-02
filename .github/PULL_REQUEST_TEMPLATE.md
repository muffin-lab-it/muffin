## 무엇을
<!-- 예: [fx] 환율 변동률 계산 추가 -->

## 왜

## 테스트 방법
- [ ] `pnpm test src/tools/<이름>` 통과
- [ ] `pnpm tool src/tools/<이름>/run.ts ...` 로 실제 응답 확인 (로컬)

## 체크리스트
- [ ] `fixture.json` 에 실제 응답 샘플 저장
- [ ] API 키는 `process.env` 로만 접근, 하드코딩 없음
- [ ] 외부 API 실패 시 명확히 throw (빈 값 반환 금지)
- [ ] `fetch` 타임아웃 8초
- [ ] `source.url` 이 실제로 열리는 링크
- [ ] tool 폴더 `README.md` 갱신
- [ ] Codex 리뷰 1회 반영

## 스크린샷 (화면 변경 시)
