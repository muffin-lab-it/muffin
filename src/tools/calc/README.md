# calc (🧮 계산 tool · `calc_metrics`)

모델이 산술을 하지 않게 하기 위한 tool 입니다. ✂️ 정제 Agent(`src/agent/edit.ts`)만 씁니다. 리더가 관리합니다.

## 무엇을 하나

장부(증거 번호가 붙은 tool 결과)의 두 값을 가리키면 계산해서 **C 번호**로 장부에 올립니다. 리포트는 C 번호를 인용하고, 검증은 그 숫자를 `derived`(계산값)로 표시합니다. 원본 보기에는 어느 E 번호로 계산했는지(`lineage`)가 보입니다.

| op | 계산 | 결과 단위 | 예 |
|---|---|---|---|
| `pct_change` | (b − a) / \|a\| × 100 | % | 30일 전 환율 → 오늘 환율 변동률 |
| `diff` | b − a | 입력과 같은 단위 | 오늘 환율 − 30일 전 환율 (원) |
| `pp_diff` | b − a | %p | 미국 정책금리 − 한국 기준금리 |

값은 **장부에서만** 읽습니다. 숫자를 직접 넘길 수 없고, 없는 id · 키를 가리키면 실패합니다. 평균 · 시계열 · z-score 는 장부에 시계열이 올라오면 추가합니다 (순수 함수는 `metrics.ts` 에 있음).

## 정제 Agent 가 부르는 모양

```json
{ "op": "pp_diff", "a": { "ref": "E2", "key": "rate" }, "b": { "ref": "E3", "key": "rate" }, "label": "한미 기준금리 차이" }
```

- `a` 는 기준(빼는 쪽), `b` 는 비교 값. 키 이름은 정제 입력의 `[증거 장부]` 에 보이는 `values` 의 키 그대로 (`rate`, `comparison.rate`, `latest.close` …).
- 성공하면 모델은 `{ id: "C1", data: { value: 0.88, unit: "%p", formula: "E3.rate 3.88 − E2.rate 3 = 0.88%p" … } }` 를 받습니다. 사실 목록에는 `{ ref: "C1", fact: "한미 기준금리 차이 0.88%p (2026-10-16)" }` 처럼 적습니다.
- 실패하면 `calc_metrics 호출 실패: 장부에 없는 id E9` 같은 메시지를 받고 C 번호는 쓰지 않습니다. 추측하지 말고 그 계산은 빼면 됩니다.

## 장부에 올라가는 값

검증기(`src/agent/verify.ts`)가 키 이름으로 단위를 추정하므로 키가 정해져 있습니다.

| op | values | 리포트 표기 예 |
|---|---|---|
| `pct_change` | `{ changePct, from, to }` | `2.00%` |
| `diff` | `{ change, from, to, unit? }` | `27.30원` |
| `pp_diff` | `{ changePp, from, to, unit: "%" }` | `0.88%p` (from · to 는 `3.00%`, `3.88%`) |

장부 라벨은 `계산 · <label>` (예: `계산 · 한미 기준금리 차이`), `note` 에 식이 남습니다 (`E3.rate 3.88 − E2.rate 3 = 0.88%p`). 출처 url 이 없으므로 리포트의 출처 목록에는 들어가지 않고 `evidence` 에만 남습니다. `asOf` 는 두 입력 중 더 최근 기준일입니다.

## 테스트

```bash
pnpm test src/tools/calc
```

Agent 없이 쓰려면 `ResearchContext` 를 만들어 `addEvidence` 한 뒤 `execute(input, ctx)` 를 부릅니다 (`index.test.ts` 참고). 실제 API 를 부르지 않으므로 `run.ts` 는 없습니다.
