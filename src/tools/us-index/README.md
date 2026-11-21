# 미국 지수 tool (`get_us_stock_index`)

S&P 500 · 나스닥 종합 · 나스닥 100 · 다우존스의 최신 종가, 전일 대비, 지정 기간 변화를 돌려줍니다. 담당: 리더.

- 출처: FRED (세인트루이스 연준). series 는 `SP500` · `NASDAQCOM` · `NASDAQ100` · `DJIA`. 예: https://fred.stlouisfed.org/series/SP500
- 키: `FRED_API_KEY` (금리 tool 과 같은 키)
- 하루 이틀 늦게 올라오는 일별 종가입니다. 당일 · 장중 값은 없습니다. 전일 대비는 직전 거래일 종가로 계산합니다.
- 레지스트리(`muffinTools`)에는 넣지 않습니다. 질문이 지수를 물으면 코드가 직접 부릅니다 (`src/agent/index-quote.ts`).

```
pnpm tool src/tools/us-index/run.ts "나스닥 종합" 30
```

`fixture.json` 은 S&P 500 2026-10-05 ~ 2026-11-18 실제 응답입니다 (키는 들어 있지 않습니다).
