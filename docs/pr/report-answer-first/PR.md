## 무엇을

리포트 첫 화면에서 안내·검증 때문에 답과 숫자가 밀리던 구조를 질문 → 한 문장 답 → 핵심 숫자·변화 → 기준일·출처로 정리했습니다. 요약은 연보라 영역, 숫자는 옅은 회색 카드로 구분하고 본문·출처의 글씨 크기와 대비를 높였습니다. 모바일에서는 머핀을 요약 문장 아래 중앙에 크게 배치하고 읽는 법을 숫자 묶음 아래로 배치합니다.

PC에서는 출처·추천·검증을 본문으로 펼쳐 표시하고, 폰(화면 600px 이하)에서는 기본 접힘으로 둡니다. 주의점은 하단 토글로 유지합니다. 원인 주장과 근거 수치는 숫자 다음에 표시합니다. 보관·PDF 버튼의 기존 보라색 스타일을 복원하고, 후속 추천은 지원 도구로 조회 가능한 질문 목록에서 골라 해당 관심 영역으로 연결합니다.

작성 규칙은 Easy 비교 질문만 숫자 최대 3개를 허용하고 Deep 최소 4개는 유지합니다. 비교 입력값, CPI 전월/전년 라벨, 외화 구매·매도 관점을 보강하고 물가 기여도 근사치 설명을 정리했습니다. `depth.ts` 및 `cpi.ts` 변경은 담당자 검토가 필요합니다. 스키마·Agent 이름은 변경하지 않았습니다.

생활 영향·추천·차트 요약은 개별 카드에 옅은 배경과 테두리를 살리고, 바깥 섹션·안내에는 배경을 더하지 않아 3중 중첩 색칠을 피했습니다.

머리말 Today's Muffin·갓 구운 오늘의 리포트를 복원하고 PC 머핀을 키웠습니다. 제목 크기를 통일하고 출처 주제 버튼·카드 여백을 줄였으며 검증의 회색 배경을 복원했습니다. 레이아웃은 칸 너비 560px 기준(제목 20px·그림 하단), 접힘은 화면 너비 600px 기준으로 분리했습니다.

## 왜

핵심 숫자가 안내에 묻힌다는 리더 피드백과 모바일 가독성·카드 경계·머핀 위치에 대한 후속 피드백을 반영합니다.

## 테스트 방법

- [x] `pnpm lint && pnpm typecheck && pnpm test`와 같은 프로젝트 실행 파일을 Node로 실행: ESLint, TypeScript, Vitest 전체 72개 파일 / 1,009개 테스트 통과
- [x] 로컬 고정 예시: PC 1440px, 모바일 390·360px, 넓은 화면 안 496px 두 열
- [x] 금리 3개 카드, 외화 하락 표시, CPI 전월/전년 라벨, 긴 제목·숫자 5개 확인
- [x] 근거 클릭 → 계산 탭 이동, 도움말 열기·닫기, 추천 → 홈 질문·관심 영역 전달 확인
- [x] 이번 QA에서 실제 금융 API·유료 모델 생성 호출 없음
- PDF 버튼은 브라우저 인쇄를 사용합니다. PDF 파일 저장과 실제 모델의 추천 질문 생성 성공은 이번 브라우저 QA에서 실행하지 않았습니다.
- 기존 실제 평가의 엔화 단위 검증 오인·금리 계산 방향 불일치는 이번 변경으로 해결됐다고 주장하지 않습니다.

## Codex 활용

- 맡긴 일: 정보 위계·반응형 디자인 구현, 작성 규칙 보완, 고정 데이터 미리보기, 최초 As-is 기록, 요구사항 QA
- 리뷰: 로컬 diff·자동 테스트·브라우저 QA. 별도 Codex review는 미실행
- 리뷰가 잡은 것:
  1. 브라우저 폭은 넓어도 리포트 칸이 좁으면 제목이 깨짐 → container query 적용
  2. 새 미리보기에서 보관·PDF 버튼 누락 → 공통 액션 복원 및 저장 재조회
  3. 개념 키워드를 추천해 조회 질문이 모호함 → 지원 질문 목록 및 올바른 area 연결

## 체크리스트

- [x] API 키·비밀값 추가 없음
- [x] tool 호출·계산 로직은 유지, macro README와 근사치 문구 동기화
- [x] 최초 원본 커밋 `fa57b15` 및 SHA256 기록
- [ ] 담당자 최종 디자인 및 공통 파일 리뷰

## 스크린샷

화면 확인용 고정 데이터입니다. As-is는 수정 전 최초 `fa57b15`이며 중간 시안이 아닙니다.

### 최초 원본 기록

[원래 데이터의 PC 화면](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/asis-original-desktop.jpg) · [원래 데이터의 모바일 화면](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/asis-original-mobile.jpg)

### 같은 금리 예시 비교

| PC As-is | 최종 PC |
| --- | --- |
| ![As-is](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/asis-rate-desktop.jpg?raw=true) | ![To-be](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/tobe-rate-desktop.jpg?raw=true) |

| 모바일 As-is | 최종 모바일 |
| --- | --- |
| ![As-is](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/asis-rate-mobile.jpg?raw=true) | ![To-be](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/tobe-rate-mobile.jpg?raw=true) |

[전체 요구사항 QA와 확인 방법](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/README.md) · [496px 두 열](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/tobe-narrow-columns.jpg) · [360px 외화 예시](https://github.com/muffin-lab-it/muffin/blob/feat/web-report-answer-first/docs/pr/report-answer-first/tobe-fx-mobile.jpg)
