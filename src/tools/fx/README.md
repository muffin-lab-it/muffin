# FX Tool

USD, EUR, JPY의 KRW 기준환율과 지정 기간의 변동을 조회하는 Tool입니다.

## 데이터 출처

- 기본 제공자: [Frankfurter v2](https://frankfurter.dev/)
- 대체 제공자: [한국은행 ECOS](https://ecos.bok.or.kr/api/) `731Y001` 일별 주요국 통화의 대원화환율
- 인증: Frankfurter는 API Key 불필요. Frankfurter 요청이 실패했을 때만 `ECOS_API_KEY`가 설정돼 있으면 ECOS로 대체 조회합니다.
- 요청 시간 제한: Frankfurter와 ECOS는 각각 최대 4초 동안 조회합니다. Tool 전체 제한(10초) 안에 대체 조회까지 시도하기 위한 값입니다.
- 호출 제한: [공식 FAQ](https://frankfurter.dev/#faq)에 따르면 일·월간 quota는 없지만 남용 방지를 위한 rate limiting이 적용됩니다. 필요한 통화와 기간만 조회합니다.
- 사용 endpoint: `GET /v2/rates?base={currency}&quotes=krw&from={YYYY-MM-DD}&to={YYYY-MM-DD}`
- ECOS 항목: USD `0000001`, JPY(100엔) `0000002`, EUR `0000003`. ECOS의 JPY 값은 이미 100엔 기준이므로 다시 환산하지 않습니다.
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

ECOS fallback을 실제로 검증하려면 `.env.local`에 발급받은 키를 넣고 Frankfurter를 사용할 수 없는 네트워크 조건에서 실행합니다. API 키는 URL 경로에 포함되므로 응답·로그·fixture에 기록하지 않습니다.

```bash
pnpm exec tsx src/tools/fx/run.ts --currency=USD --days=30
```

## 테스트

```bash
pnpm test src/tools/fx/index.test.ts
```
