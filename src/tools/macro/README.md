# macro (한국·미국 CPI / 실업률)

한국·미국의 CPI·실업률과 최근 N개월의 전월·전년 동월 변화를 조회합니다. Tool 이름은 `get_macro_indicators`입니다.

## 파일 구성과 읽는 순서

| 파일 | 역할 |
|---|---|
| `index.ts` | 입력 규격 → 지표 설정 → 응답 타입·검증 → 조회·결과 변환 → 유틸 함수 → Tool 등록 |
| `run.ts` | 실행 옵션 해석 → 실제 API 조회 → 샘플 저장·비교 |
| `index.test.ts` | 공통 샘플 준비 → 정상 조회 → 기간·결측 처리 → 입력·응답 검증과 키 보호 |
| `fixture.json` | 한국·미국 CPI·실업률 네 조합의 실제 API 응답 샘플 |
| `README.md` | 데이터 소스, 입력·출력, 실행 및 테스트 방법 |

처음 읽을 때는 이 문서의 입력·출력을 확인한 뒤 `index.ts`의 `execute`에서 조회 흐름을 따라가면 됩니다.

## 데이터 소스

| 국가·지표 | 소스·통계 코드 | 단위 | 계절조정 |
|---|---|---|---|
| 한국 CPI | ECOS `901Y009 / 0` | 2020=100 | 원계열 |
| 한국 실업률 | ECOS `901Y027 / I61BC / I28B` | % | 계절조정 |
| 미국 CPI | FRED / BLS `CPIAUCSL` | 1982–1984=100 | 계절조정 |
| 미국 실업률 | FRED / BLS `UNRATE` | % | 계절조정 |

- URL: [한국은행 ECOS](https://ecos.bok.or.kr/api/), [FRED](https://fred.stlouisfed.org/)
- 엔드포인트: ECOS `StatisticSearch`, FRED `/fred/series/observations`
- 키: 한국 `ECOS_API_KEY`, 미국 `FRED_API_KEY`. 조회할 국가의 키만 필요합니다.
- 호출: 국가·지표 한 조합당 API 1회. 요청별 타임아웃 8초, 자동 재시도 없음.
- 갱신 주기: 월별. 지표마다 발표 시점이 다르고 과거 값이 개정될 수 있습니다.
- 이용 조건·호출 한도: ECOS 발급 안내와 [FRED 약관](https://fred.stlouisfed.org/docs/api/terms_of_use.html) 확인. FRED 한도 초과(429)는 오류로 전달합니다.
- 범위: 한국·미국 CPI·실업률. 다른 국가·지표와 분기 집계는 제공하지 않습니다.

## 키 발급 방법

1. 한국: [ECOS Open API](https://ecos.bok.or.kr/api/)에서 인증키 신청.
2. 미국: FRED 로그인 후 [API 키 신청](https://fred.stlouisfed.org/docs/api/api_key.html).
3. 프로젝트 루트 `.env.local`에 설정. 실제 키와 파일은 Git에 올리지 않습니다.

```dotenv
ECOS_API_KEY=발급받은키
FRED_API_KEY=발급받은키
```

## 입력 / 출력

입력은 네 필드 모두 필수입니다.

| 입력 | 의미 |
|---|---|
| `country` | `KR` 한국, `US` 미국 |
| `indicator` | `cpi` 소비자물가지수, `unemployment` 실업률 |
| `endMonth` | 종료 월 `YYYYMM`. `null`이면 최신 관측 월 |
| `months` | 조회할 연속 월 수, 1~60 |

- 출력 `data`: 국가·지표·통계 코드·단위·계절조정·변화 단위·계산식.
- `period`: 실제 조회 기간 `from`, `to`, `months`.
- `observations`: 월별 `month`, `value`, `previousMonth`, `previousYear`. 각 비교는 `month`, `value`, `change`로 구성됩니다.
- `latest`: 조회 기간 마지막 월의 관측값과 비교 정보.
- `source`: 출처 이름·링크·`asOf`. `asOf`는 마지막 관측 월의 첫날 표기이며 발표일이 아닙니다.
- `note`: 해석 시 주의사항.

## 동작 방식

1. 국가·지표에 따라 ECOS 또는 FRED에서 비교용 과거 자료까지 함께 조회합니다.
2. `endMonth`가 있으면 해당 월을 사용하고, `null`이면 서울 현재 월을 포함한 최근 24개월에서 마지막 유효 관측 월을 찾습니다.
3. 요청한 N개월을 월순으로 반환하고 전월·전년 동월 변화를 계산합니다. CPI는 `(현재 / 비교 값 - 1) × 100`, 실업률은 `현재 - 비교 값`입니다.
4. 요청 구간에 결측이 있으면 실패합니다. 비교용 과거 월만 없으면 해당 비교값과 변화는 `null`입니다.

Agent는 사용자 지정 기간을 우선하며, 기간이 없으면 최신값 1개월·‘요즘’ 3개월·‘최근 흐름’ 6개월을 선택하도록 안내합니다.

## 주의

- CPI 값은 지수, 변화는 %입니다. 실업률 값은 %, 변화는 %포인트입니다.
- 한국 CPI는 원계열, 미국 CPI는 계절조정입니다. 국가별 지수 수준을 직접 비교하지 않으며 한국의 전월 변화에는 계절성이 포함됩니다.
- 국가별 실업률 조사 정의와 지표별 최신 관측 월이 다를 수 있습니다. 비교 시 실제 기준 월을 확인합니다.
- `null`은 0이 아닙니다. 최근 3개월은 달력 분기와 다르며 수치만으로 변화 원인을 단정하지 않습니다.
- 오류 메시지에서 API 키를 가립니다. Agent 등록과 Vercel 배포 검증은 별도입니다.

## 단독 실행

```bash
pnpm tool src/tools/macro/run.ts --country KR --indicator cpi --month 202509 --months 6
pnpm tool src/tools/macro/run.ts --country US --indicator unemployment --months 3
```

CLI 기본값은 한국·CPI·최신 관측 월·1개월입니다. `--month latest`는 월 생략과 같습니다.

## 테스트

```bash
pnpm test src/tools/macro
```

실제 키 없이 `fixture.json`의 네 조합 응답으로 테스트합니다. 단독 실행 명령에 `--save-fixture` 또는 `--check-fixture`를 붙이면 샘플 저장·비교가 가능합니다. 종료 월을 지정해야 하며 두 옵션은 함께 사용할 수 없습니다.

## 지출목적별 품목군 (`indicator: "cpi_categories"`, 11/19 리더 추가)

물가가 "왜" 올랐는지에 데이터 근거를 주기 위한 조회입니다. 한국만 지원하고 `months` 는 무시합니다.

- 호출: ECOS `StatisticSearch` 4회 — 총지수(`901Y009 / 0`)로 최신 관측 월과 전년 동월 · 전월 값, 그 세 달의 전체 항목(581행)에서 한 글자 코드(지출목적별 12개 품목군)만 사용.
- 출력: `total`(지수 · 전년 동월 지수 · 전월 지수 · 등락률 yoyPct · momPct %), `categories[]`(코드 · 이름 · 가중치 · 지수 · 전년 동월 · 전월 지수 · 등락률 % · 기여도 %p 두 기준)를 전년 동월 기여도 큰 순으로, `contributionSumPp` · `momContributionSumPp`(12개 합).
- 기여도 = 가중치 ÷ 1000 × 등락률 (근사). 가중치는 ECOS 가 주는 2020년 기준값(12개 합 1000)이라 코드에 숫자를 두지 않습니다. 통계청 공식 기여도와 소수점 차이가 날 수 있고 12개 합도 총지수 등락률과 소폭 다릅니다 (note 에 적음).
- 출처 · 장부: 총지수 + 품목군 13개를 출처로 돌려 장부에 `E5-1`(총지수) `E5-2`…(품목군) 로 올라갑니다. 품목군 하나라도 빠지면 throw.
- 에이전트: 물가 원인 질문이면 조사 뒤 코드가 이 조회를 보강하고(`src/agent/supplement.ts`), 작성에게 [물가 원인 후보] 로 건넵니다(`src/agent/cpi.ts`).
- 에이전트는 질문이 "지난달 · 전월 · 이번 달" 이면 전월 기여도, 아니면 전년 같은 달 기여도를 원인 후보 기준으로 삼습니다 (`cpiBasisFor`).
- fixture: `KR_cpi_categories` — 전체 항목 응답(최신 · 전년 동월 · 전월)은 한 글자 코드 13행만 저장하고 `list_total_count` 도 13 으로 맞췄습니다.
