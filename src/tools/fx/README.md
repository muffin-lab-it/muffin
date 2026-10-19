# FX Tool

USD, EUR, JPY의 KRW 기준환율과 지정 기간의 변동을 조회하는 Tool입니다.

## 데이터 출처

- 제공자: [Frankfurter v2](https://frankfurter.dev/)
- 인증: API Key 불필요
- 호출 제한: 명시된 일일 quota는 없지만, 남용 방지를 위한 rate limiting이 적용될 수 있습니다. 필요한 통화와 기간만 조회합니다.
- 사용 endpoint: `GET /v2/rates?base={currency}&quotes=krw&from={YYYY-MM-DD}&to={YYYY-MM-DD}`
- 데이터 특성: 일별 mid-market 기준환율입니다. 실시간 환전 호가나 매수·매도 가격이 아닙니다.

## 입력

| 필드 | 타입 | 범위 | 설명 |
| --- | --- | --- | --- |
| `currency` | `USD \| EUR \| JPY` | 필수 | 기준 통화 |
| `days` | `number` | 1~365 | 변동 비교 기간 |

## 출력

- `pair`: 통화쌍. 예: `USD/KRW`
- `rate`, `asOf`: API가 반환한 최신 기준환율과 기준일
- `comparison`: 조회 구간에서 API가 반환한 최초 기준환율과 기준일
- `change`, `changePct`: 최초·최신 기준환율의 차이와 변화율
- `source`: 실제 조회한 Frankfurter v2 URL과 데이터 기준일

비교 기간에 유효 데이터가 두 건 미만이면 오류를 반환합니다.

## 실행

실제 Frankfurter API 호출은 `run.ts`에서만 수행합니다. 테스트는 `fixture.json`을 사용하는 mock 기반 검증입니다.

```bash
pnpm exec tsx src/tools/fx/run.ts --currency=USD --days=30
```

## 테스트

```bash
pnpm test src/tools/fx/index.test.ts
```
