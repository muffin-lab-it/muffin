# Promptfoo 평가 (`scripts/promptfoo/`)

고정 질문 세트(`scripts/questions/*.json`)를 [Promptfoo](https://www.promptfoo.dev/) 로 돌려 리포트 품질을 지표별 통과율로 냅니다. 채점은 `pnpm eval` 과 같은 코드(`scripts/scoring.ts`)와 근거 판정(`src/agent/judge.ts`)을 그대로 부르므로 두 평가의 기준이 같습니다. 매주 금요일 GitHub Action(`.github/workflows/eval.yml`)이 돌리고, 기준 아래로 떨어진 지표가 있으면 실행이 실패로 표시됩니다. 리더가 관리합니다.

| 파일 | 하는 일 |
|---|---|
| `promptfooconfig.yaml` | 설정. provider · 테스트 · 동시 실행 수 · **지표별 최소 통과율(`metadata.thresholds`)** |
| `provider.ts` | 질문 하나를 받아 다섯 단계(`research`)를 마감 없이 끝까지 돌리고 리포트 · 분류 · tool 호출 · 다시 쓰기 횟수를 돌려줌 |
| `tests.ts` | 질문 세트를 읽어 질문마다 테스트 하나와 지표를 만듦. 세트 · 깊이 · 근거 판정 여부는 환경 변수로 |
| `asserts.ts` | 지표 하나 = 함수 하나. `{ pass, score, reason }` 을 돌려줌 |
| `summary.ts` | promptfoo 결과 JSON → 지표별 통과율 · 질문별 표 · 틀린 이유 (markdown). 기준과 지난 결과와 비교 |
| `run.ts` | `pnpm eval:promptfoo`. promptfoo 를 고정 버전으로 `pnpm dlx` 해 돌리고 요약을 `docs/eval/promptfoo/` 에 남김 |
| `runner.ts` | run.ts 의 순수 부분: 명령줄 · 환경 변수 · "이번 실행이 제대로 끝났는가" 판단 (promptfoo 버전도 여기) |
| `promptfoo.test.ts` | 모델 없이 도는 테스트 (테스트 생성 · 채점 함수 · 요약 · 실행 판단) |

## 돌리기

```bash
pnpm eval:promptfoo                        # 모든 세트, 질문마다 적힌 depth 로 (실제 키 필요, .env.local)
pnpm eval:promptfoo --set common,etf       # 세트 고르기
pnpm eval:promptfoo --depth all            # 세 깊이 모두
pnpm eval:promptfoo --no-judge             # 근거 판정(모델 호출) 없이
pnpm eval:promptfoo --concurrency 1        # 동시에 돌리는 질문 수 (기본 2)
pnpm eval:promptfoo --baseline x.json      # 나란히 볼 결과를 직접 지정 (기본 latest.json)
pnpm dlx promptfoo@0.125.1 view            # 질문별 리포트 전문 · 채점 이유를 브라우저에서
```

결과는 `docs/eval/promptfoo/<날짜-시각>.md` 와 `.json` 에 쌓이고(gitignore), 가장 최근 것이 `latest.md` · `latest.json` 입니다. 다음 실행은 `latest.json` 을 "지난 번" 으로 읽어 나란히 보여 줍니다. 기준 아래 지표나 오류가 있으면 exit 1 입니다. 요약 머리에는 쓴 모델(작성 단계)과 토큰 합계도 적습니다.

## 모델 비교

같은 세트를 모델만 바꿔 돌리고 기본 모델 결과와 나란히 봅니다. `--model` 은 조사 · 작성 모델을 모든 깊이에서 바꾸고(`OPENAI_MODEL` · `OPENAI_MODEL_DEEP`), `--small-model` 은 분류 · 정제(`OPENAI_MODEL_SMALL`)를 바꿉니다. 근거 판정(채점자)은 `OPENAI_MODEL_JUDGE` 로만 바뀌므로 비교하는 동안 그대로입니다. `--tag` 를 붙이면 결과 파일 이름에 들어가고 `latest.json` 은 갱신하지 않습니다 (주간 비교 기준을 흐리지 않게).

```bash
pnpm eval:promptfoo                                                              # 기본 모델 (luna · deep 은 sol · 분류 · 정제 mini)
pnpm eval:promptfoo --model gpt-6-sol --tag sol --baseline docs/eval/promptfoo/<기본 결과>.json
pnpm eval:promptfoo --model gpt-5.4-mini --tag mini --baseline docs/eval/promptfoo/<기본 결과>.json
```

비교 열 이름이 기준 파일 이름으로 바뀌고, 머리줄에 양쪽의 평균 시간 · 모델 · 토큰이 나옵니다. 같은 시각에 돌려야 데이터(환율 · 뉴스)가 같습니다.

레포 루트에서 돌려야 합니다 (질문 세트 경로 `scripts/questions` 가 루트 기준). promptfoo 0.125.1 은 Node 22.22 이상을 요구합니다 (경고만 나오고 멈추지는 않음).

## 지표

| 지표 | 보는 것 | 통과 조건 | 재지 않는 질문 |
|---|---|---|---|
| 의도 일치 `intent` | 📋 분류의 `intent` 가 세트의 정답과 같은가 | 같음 | |
| tool 선택 `tools` | 🔍 조사가 `expectTools` 를 모두 불렀는가. 범위 밖 질문은 하나도 안 불렀는가 | 모두 호출 / 호출 0 | `expectTools` 가 없고 범위 밖도 아닌 질문 |
| 숫자 검증 `numbers` | ✅ 검증에서 뺀 숫자가 없는가. 점수는 남은 숫자(✓ · C)의 비율. 숫자가 없는 리포트(뉴스 현황 · 판단 요청)는 통과 | 제거 0 | 범위 밖 |
| 지어낸 번호 없음 `refs` | 장부에 없는 번호를 인용하지 않았는가 | 0개 | |
| 원인 근거 `why` | 원인마다 근거가 있는가 (`basis` none 이 0). 점수는 📊 · 📰 비율 | none 0 | 범위 밖 |
| 근거 판정 `judge` | 원인마다 인용한 장부가 주장을 뒷받침하는가 (모델, `judge.ts`). 점수는 supported 비율 | contradicted 0 · 빠뜨림 0 | 범위 밖, `--no-judge` |
| 권유 없음 `advice` | 매수 · 매도 같은 권유 표현이 남지 않았는가 | 0개 | |
| 검증 통과 `verification` | `verification.status` 가 pass 인가 (partial 은 뺀 항목이 있음) | pass | |
| 다시 쓰기 없음 `rewrites` | 검증 실패로 작성이 다시 쓰지 않았는가 | 0회 | |
| 55초 안 `latency` | 리포트 하나에 걸린 시간이 서비스 마감(`TIME_BUDGET_MS`) 안인가 (promptfoo 내장) | 55초 이하 | |

지표마다 통과율 = 통과한 질문 / 그 지표를 잰 질문. 기준(`promptfooconfig.yaml` 의 `metadata.thresholds`)보다 낮으면 ❌ 입니다. 처음 기준은 2026-11-03 common 세트에서 잰 수치 아래로 잡았고, 지시문을 고쳐 수치가 오르면 기준도 올립니다. 지시문을 고치기 전에 현재 수치를 먼저 기록합니다 (README "품질 측정").

질문을 더하는 방법은 `scripts/questions/README.md` 입니다. 세트 파일만 고치면 다음 실행에 바로 들어갑니다.

## GitHub Action

`.github/workflows/eval.yml` 이 매주 금요일 09:00(KST) 에 전부 돌리고, Actions 탭에서 "Weekly eval → Run workflow" 로 세트 · 깊이를 골라 바로 돌릴 수도 있습니다.

- 요약은 실행 페이지의 Summary 에, `docs/eval/promptfoo/` 전체는 Artifacts 에 90일 남습니다.
- 지난 실행의 `latest.json` 을 cache 로 넘겨 "지난 번" 열을 채웁니다.
- 기준 아래 지표나 오류가 있으면 실행이 실패(빨강)로 표시되고 GitHub 알림이 옵니다.
- 필요한 Secrets (Settings → Secrets and variables → Actions): `OPENAI_API_KEY`, `FRED_API_KEY`, `ECOS_API_KEY`, `DATA_GO_KR_KEY`. 환율(Frankfurter)과 뉴스는 키가 없습니다.

## promptfoo 를 package.json 에 넣지 않은 이유

promptfoo 0.125.1 은 의존 패키지 536개, 약 680MB 입니다. 넣으면 팀원 모두의 `pnpm install` 과 모든 PR 의 CI 가 그만큼 느려지는데, 쓰는 사람은 리더와 주간 Action 뿐입니다. 그래서 `run.ts` 가 `pnpm dlx promptfoo@0.125.1` 로 버전을 고정해 부릅니다 (첫 실행만 내려받고 그 뒤는 pnpm 저장소에서 바로). 버전을 올릴 때는 `runner.ts` 의 `PROMPTFOO_VERSION` 과 이 README 를 함께 고칩니다.

## 결과 JSON 에서 쓰는 것

`summary.ts` 는 promptfoo 출력 JSON 의 `results.results[]` 만 봅니다: `vars`(질문 id · 깊이), `latencyMs`, `error`, `gradingResult.componentResults[]`(지표마다 `pass` · `score` · `reason` · `assertion.metric`). 설정의 `metadata.thresholds` 는 출력 JSON 의 `config` 에 그대로 들어와 기준으로 읽습니다.
