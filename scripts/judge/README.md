# 근거 판정 보정 세트 (`scripts/judge/`)

근거 판정(`src/agent/judge.ts`, 3단계)은 리포트의 원인(why) 문장마다 "인용한 장부 항목이 이 주장을 뒷받침하는가" 를 작은 모델이 판정합니다. 이 폴더는 그 판정이 사람 판단과 얼마나 맞는지 재는 **정답 세트**입니다. 지금은 평가(`pnpm eval`)에서만 판정하고, 여기서 보정한 뒤 실행 중에도 켭니다 (README "근거 판정").

## 세 가지 판정

| 판정 | 뜻 | 예 |
|---|---|---|
| `supported` | 인용한 장부 항목의 값이나 기사 제목이 주장의 내용과 방향을 직접 뒷받침 | "미국 금리가 한국보다 높다" 에 미국 3.88% · 한국 3.00% |
| `contradicted` | 인용한 장부 항목이 주장과 반대이거나 맞지 않음 | "환율이 올랐다" 인데 `changePct` 가 -0.93 / "인상했다" 인데 제목은 "동결" |
| `unsupported` | 인용한 장부 항목만으로는 알 수 없음 | "외국인 매도 때문" 인데 장부엔 환율 값만 있음 / 기사 제목이 관련은 있지만 주장까지는 안 함 / 전망을 사실처럼 씀 |

- 숫자가 정확히 맞는지는 검증기(`verify.ts`)의 몫이라 여기서는 보지 않습니다. 방향과 내용만 봅니다.
- 세상에서 맞는 말이어도 장부가 보여 주지 않으면 `unsupported` 입니다.
- `basis` 가 `none` 인 원인은 판정 대상이 아니라 세트에 넣지 않습니다.

## 쌍 형식 (`pairs.json`)

```json
{
  "id": "fx-direction-down-1",
  "area": "fx",
  "claim": "원·달러 환율은 최근 30일 동안 올랐습니다.",
  "evidence": "USD/KRW 30일 변동",
  "basis": "data",
  "refs": ["E1"],
  "ledger": [{ "id": "E1", "tool": "get_fx_krw_rate", "label": "환율 확인 · Frankfurter v2", "values": { "changePct": -0.93 }, "source": { "name": "Frankfurter v2", "url": "…", "asOf": "2026-11-03" } }],
  "expected": "contradicted",
  "note": "changePct -0.93 으로 내렸음",
  "source": "docs/eval/2026-11-03-0407.md#요즘 원달러 환율이 왜 이렇게 움직여? [standard]"
}
```

- `id`: `<영역>-<무엇>-<번호>`, 소문자 · 숫자 · 하이픈.
- `claim` · `evidence` · `basis` · `refs`: 리포트의 why 항목 그대로. `evidence` 는 작성이 적은 설명이라 판정 근거가 아닙니다.
- `ledger`: `refs` 가 가리키는 장부 항목(리포트 `evidence` 배열의 항목 그대로). `refs` 에 있는 id 는 모두 `ledger` 에 있어야 합니다.
- `source.url` 은 실제 응답 주소를 그대로 둡니다 (Google News 중계 링크도 그대로). 기사 주소를 지어 넣지 않습니다. 실제 기사가 아닌 예시 제목을 쓸 때는 `source.name` 을 `예시 기사 (실제 기사 아님)`, `url` 을 빈 문자열로 두고 쌍의 `source` 에도 그렇게 적습니다. 판정 모델에는 `label` · 기준일 · `values` · `note` 만 보이고 `source.name` · `url` 은 보이지 않습니다.
- `expected`: 사람이 매긴 정답. `note` 에 이유 한 문장.
- 형식이 틀리면 `pnpm test` 가 어느 쌍의 어디가 틀렸는지 알려 줍니다 (`pairs.test.ts`).

## 쌍 모으기

1. `pnpm eval` 을 돌리면 `docs/eval/<날짜-시각>.pairs.json` 에 그 평가의 원인 문장이 **후보**로 쌓입니다 (같은 형식, `expected` 는 `null`, `judged` 에 모델의 판정과 이유).
2. 후보를 읽고 `expected` 를 매깁니다. 모델 판정과 다르면 더 좋은 쌍입니다. `note` 에 이유를 쓰고 `judged` 는 지웁니다.
3. `pairs.json` 에 붙입니다. 영역별 금융 판단은 그 영역 담당 팀원이 매기는 것이 정확합니다.

지금 들어 있는 98쌍(2026-11-05)은 셋으로 나뉩니다. 리더가 11/3 에 만든 씨앗 28쌍(`source: seed`), 11/4~5 전체 평가(19문항 × 세 깊이)의 실제 원인 문장 38쌍(`source: docs/eval/…`), 그 실제 장부 위에 주장만 바꿔 만든 변형 32쌍(`source` 끝에 `변형(flip|over|sup|…)`: flip 은 방향을 뒤집어 contradicted, over 는 장부에 없는 원인을 더해 unsupported, sup 은 제목 그대로 옮겨 supported). 라벨은 전부 리더가 매겼고, 후보를 보고 라벨을 쓰는 흐름은 `pnpm judge:draft` 입니다 (아래). 처음 28쌍 설명: 리더가 2026-11-03 에 만든 씨앗(`source: seed`)입니다. 뉴스 쌍 가운데 2쌍(`news-contradicted-1` · `news-causal-title-1`)은 11/3 common 평가의 장부 항목을 그대로 옮긴 실제 기사이고, 나머지 뉴스 쌍 6개는 지어낸 예시 제목(`예시 기사`)입니다. 목표는 150~200쌍이고, 영역 5개 × 판정 3가지가 고루 있어야 합니다.

## 보정 기록

| 날짜 | 쌍 | 정확도 | supported · unsupported · contradicted 재현율 | 바꾼 것 |
|---|---|---|---|---|
| 11/3 | 28 | 98.2% | — | 씨앗만 |
| 11/5 1차 | 98 | 82.7% | 95% · 74% · 75% | 실제 평가 38 + 변형 32 추가 |
| 11/5 2차 | 98 | 95.9% | 97% · 97% · 93% | `judge.ts`: reason 을 verdict 앞에, 값 비교(코드) 줄(음수 크기 · 종가 vs NAV · 물가 둔화 · 금리 변화), 크기 비교(코드) 줄(같은 키 여러 항목), 규칙(둘 이상 사실 · 스스로 밝힌 한계 · "양립" ≠ 뒷받침 · 일반 법칙 · 반대 상태) |
| 11/5 3차 | 98 | 93.9% | 92% · 97% · 93% | Codex 지적 반영(실제 물가 키 · 견줄 수 있는 것끼리만 비교 · 같은 값은 =). 2차와의 차이는 같은 쌍이 실행마다 흔들리는 것(스스로 한계를 밝힌 주장 2쌍)이라 규칙은 더 안 늘림. `--repeat 3` 으로 흔들림을 재면 됨 |
| 11/5 4차 | 98 | 95.9% | 97% · 97% · 93% | GitHub Codex 지적 반영(실업률은 물가로 읽지 않고 %p 로, 후보 파일 여럿일 때 겹치는 id 거부). 틀린 4쌍은 2차 · 3차와 같은 경계 사례 |

1차에서 틀린 17쌍의 유형: 근거 문장은 "반대" 라고 써 놓고 verdict 는 supported(출력 순서 문제), 음수끼리의 크기(-14.36 과 -14.79)를 거꾸로 읽음, 두 가지를 말하는 주장을 한쪽만 맞아도 supported, "원인은 확인되지 않았다" 는 단서를 실패로 봄. 2차에서 남은 4쌍은 경계 사례(인과를 엄격히 본 ETF · 지수 동반 하락, "하방 압력 보도" vs 상승 제목)라 더 맞추려 규칙을 늘리지 않았습니다. 실행 중에 켜는 기준(150쌍 · 90% · contradicted 85%)에서 남은 것은 쌍 수입니다. 주간 평가나 `pnpm eval` 이 남기는 후보를 같은 흐름으로 더하면 됩니다.

## 쌍 모으기 도구

```bash
pnpm judge:draft list docs/eval/2026-11-04-1753.pairs.json        # 후보 요약 (번호 · 모델 판정 · 주장 · 장부 핵심값)
pnpm judge:draft build labels.json docs/eval/2026-11-04-1753.pairs.json > new.json   # 라벨 파일 → 쌍
```

`labels.json` 은 `{ "<후보 id>": { "expected": "…", "note": "…" } }` 이고, 같은 장부에 주장만 바꾼 변형은 `"<후보 id>#flip": { "claim": "…", "expected": "contradicted", "note": "…", "refs": ["E1"] }` 처럼 씁니다. 만든 쌍은 `pairs.json` 에 이어 붙이고 `pnpm test` 로 형식을 검사한 뒤 `pnpm judge` 로 잽니다.

후보 id 는 질문 id · 깊이 · 원인 번호로만 만들어져서, 평가 파일이 여럿이면 같은 id 가 다른 주장 · 장부로 되풀이될 수 있습니다. 그런 id 를 평문으로 가리키면 `build` 가 거부하고(라벨이 엉뚱한 주장에 붙지 않게), `"<파일>/<후보 id>"` (예: `2026-11-04-1753/fx-cause-1-easy-1`) 로 쓰면 그 파일의 후보를 가리키고 쌍 id 에도 파일 이름이 붙습니다. `list` 가 겹치는 id 를 끝에 알려 줍니다.

## 돌리기

```bash
pnpm judge                              # pairs.json 전부, 쌍마다 1번
pnpm judge --limit 20                   # 앞 20쌍만
pnpm judge --repeat 3                   # 쌍마다 3번 (같은 쌍에 다른 답이 나오는지)
pnpm judge --file docs/eval/x.json      # 다른 파일 (expected 가 있어야 함)
```

실제 OpenAI 호출이라 로컬 전용입니다 (`.env.local` 의 키). 결과는 터미널과 `docs/eval/judge-<날짜-시각>.md` 에 남습니다: 정확도, 정답별 재현율, 혼동표(정답 × 판정), 틀린 쌍과 모델의 이유.

실행 중에 켜는 기준(제안): 150쌍 이상에서 정확도 90% 이상, `contradicted` 재현율 85% 이상. 틀린 쌍을 보고 `judgeRules` 를 고친 뒤 다시 잽니다.
