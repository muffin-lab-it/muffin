# 국내 지수 tool (`get_kr_stock_index`)

코스피 · 코스닥 · 코스피 200 · 코스닥 150 의 최신 종가, 전일 대비, 지정 기간 변화를 돌려줍니다. 담당: 리더.

- 출처: 금융위원회 지수시세정보 (공공데이터포털, 원천 KRX). https://www.data.go.kr/data/15094807/openapi.do
- 키: `DATA_GO_KR_KEY` (ETF tool 과 같은 키. 포털에서 "금융위원회_지수시세정보" 활용신청이 되어 있어야 합니다)
- 다음 영업일 오후에 공개되는 자료라 최신 값은 직전 영업일 종가입니다. 당일 · 장중 값은 없습니다.
- 레지스트리(`muffinTools`)에는 넣지 않습니다. 질문이 지수를 물으면 코드가 직접 부릅니다 (`src/agent/index-quote.ts`).

```
pnpm tool src/tools/kr-index/run.ts 코스닥 30
```

`fixture.json` 은 코스피 2026-10-12 ~ 2026-11-19 실제 응답입니다 (키는 들어 있지 않습니다).
