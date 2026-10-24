# 고정 질문 세트

리포트가 좋아졌는지를 "느낌" 이 아니라 숫자로 재기 위한 질문 목록입니다. 같은 질문을 매주 똑같이 돌려서 숫자 출처 채움 · 원인 근거 · 지어낸 번호 · tool 선택 · 권유 표현 · 응답 시간을 비교합니다. 발표에서는 **기준선(Tool 없음) → v1 → v2** 표로 보여줍니다.

## 파일 하나 = 세트 하나

| 파일 | 담당 | 내용 |
|---|---|---|
| `fx.json` `etf.json` `news.json` `rate.json` `macro.json` | 그 tool 담당자 | 자기 영역 질문 6개: 현황 2 · 원인 2 · 비교 2 |
| `common.json` | 리더 | 0단계 기준 수치를 잰 4문항 + 판단 요청 · 범위 밖 예시 |
| `decision.json` | 10/23 모임에서 정함 | "사도 돼?" 류 권유 유도 질문 10개 이상 |

파일 이름(세트)과 안의 `set` 값이 같아야 하고, 질문 `id` 는 `<세트>-` 로 시작해야 합니다. 이 규칙과 형식은 `pnpm test` 가 검사하므로 PR 전에 한 번 돌려 보면 됩니다.

## 형식

```json
{
  "set": "fx",
  "owner": "@seoyoung23",
  "questions": [
    {
      "id": "fx-status-1",
      "question": "오늘 달러 환율 얼마야? 한 달 전이랑 비교하면?",
      "area": "fx",
      "intent": "status",
      "depth": "standard",
      "expectTools": ["get_fx_krw_rate"],
      "note": "현황. 숫자 2개(오늘 · 한 달 전)에 모두 출처 번호가 붙어야 함"
    }
  ]
}
```

| 필드 | 뜻 | 값 |
|---|---|---|
| `id` | 질문 고유 이름 | 소문자 · 숫자 · 하이픈. `<세트>-<의도>-<번호>` 권장 (예: `fx-cause-2`) |
| `question` | 사용자가 실제로 칠 법한 문장 | 5자 이상. 구어체 그대로 |
| `area` | 관심 영역 | `fx` `etf` `news` `rate` `macro`. 영역이 없으면 `null` |
| `intent` | 질문 의도 | `status`(현황) `cause`(원인) `compare`(비교) `decision`(판단 요청) `out_of_scope`(범위 밖) |
| `depth` | 설명 깊이 | `easy` `standard` `deep`. 생략하면 `standard` |
| `expectTools` | 조사가 꼭 불러야 하는 tool 이름 | `src/tools/<이름>/index.ts` 의 `name`. 없으면 `[]` |
| `note` | 채점할 때 눈여겨볼 것 (선택) | 자유 문장 |

## 좋은 질문 고르기

- 실제로 물어볼 말투로 씁니다. "USD/KRW 종가" 보다 "오늘 달러 얼마야?".
- 현황 · 원인 · 비교를 2개씩. 원인 질문에는 "왜" 가 들어가야 원인 칸 채움률을 잴 수 있습니다.
- tool 이 못 하는 것도 하나 넣으면 좋습니다 (예: 실시간 호가, 지원하지 않는 국가). "확인하지 못한 것" 에 솔직하게 나오는지 봅니다.
- 답을 미리 정하지 않습니다. 숫자 정답은 채점할 때 같은 API 로 다시 조회합니다. `expectTools` 만 적어 두면 됩니다.

## 돌려 보기

```bash
pnpm test scripts/questions          # 형식 검사 (키 불필요, CI 도 돌림)
pnpm eval --set fx                   # 한 세트만, 질문마다 적힌 depth 로 (실제 키 필요, 리더가 돌림)
pnpm eval --set fx --depth all       # 세 깊이 모두
pnpm eval                            # 모든 세트
```

결과는 `docs/eval/<날짜>.md` 에 쌓입니다 (git 에는 올라가지 않음). 요약 표만 README 상태 표에 옮겨 적습니다.
