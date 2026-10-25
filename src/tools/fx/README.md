# FX Tool

USD, EUR, JPY의 KRW 기준환율과 지정 기간의 변동을 조회하는 Tool입니다.

## 데이터 출처

- 제공자: [Frankfurter v2](https://frankfurter.dev/)
- 인증: API Key 불필요
- 호출 제한: [공식 FAQ](https://frankfurter.dev/#faq)에 따르면 일·월간 quota는 없지만 남용 방지를 위한 rate limiting이 적용됩니다. 필요한 통화와 기간만 조회합니다.
- 사용 endpoint: `GET /v2/rates?base={currency}&quotes=krw&from={YYYY-MM-DD}&to={YYYY-MM-DD}`
- 데이터 특성: Frankfurter v2의 일별 mid-market 집계입니다. ECB 고시 환율과 값·기준일이 다를 수 있으며, 실시간 환전 호가나 매수·매도 가격이 아닙니다.

## 입력

| 필드 | 타입 | 범위 | 설명 |
| --- | --- | --- | --- |
| `currency` | `USD \| EUR \| JPY` | 필수 | 기준 통화 |
| `days` | `number` | 1~365 | 변동 비교 기간 |

## 출력

- `pair`, `unit`: 통화쌍과 환율 단위. 예: `USD/KRW`, `KRW per 1 USD`. JPY는 국내 관행에 따라 `JPY(100)/KRW`, `KRW per 100 JPY`로 반환합니다.
- `rate`, `asOf`: API가 반환한 최신 기준환율과 기준일
- `comparison`: 최신 기준일에서 요청한 기간 이전(이하)인 값 중 가장 가까운 기준환율과 기준일
- `change`, `changePct`: 비교값·최신 기준환율의 차이와 변화율
- `source`: 실제 조회한 Frankfurter v2 URL과 데이터 기준일

주말·공휴일·당일 집계 전에도 비교할 수 있도록 요청 기간보다 14일 넓게 조회합니다. 비교 기준일 이전 데이터가 없으면 오류를 반환합니다.

## 실행

실제 Frankfurter API 호출은 `run.ts`에서만 수행합니다. 테스트는 `fixture.json`을 사용하는 mock 기반 검증입니다.

```bash
pnpm exec tsx src/tools/fx/run.ts --currency=USD --days=30
```

## 테스트

```bash
pnpm test src/tools/fx/index.test.ts
```
