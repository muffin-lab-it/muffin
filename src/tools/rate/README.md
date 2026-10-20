# Rate Tool (한국·미국·주요국 금리 조회)

한국은행 ECOS, 미국 FRED, BIS API를 이용해 한국 기준금리, 미국 주요 금리, 주요 7개국 정책금리를 조회하는 Tool입니다. Tool 이름은 `get_rate_data` 하나입니다.

최근 30일, 90일, 365일의 금리 수준과 변동폭을 확인할 수 있으며, 결과는 공통 ToolResult 형식으로 반환합니다.

## 데이터 소스
1. 한국은행 ECOS (경제통계시스템)
    - 이름: 한국은행 경제통계시스템(ECOS)
    - URL: https://ecos.bok.or.kr
    - API: StatisticSearch
    - 통계코드: 722Y001
    - 항목코드: 0101000
    - 조회 지표: 한국은행 기준금리 (BOK)
    - 키: 필요 (ECOS_API_KEY)
    - 호출 제한: 한국은행 API 이용 정책에 따름
    - 갱신 주기: 한국은행 기준금리 통계 갱신 기준
2. 미국 FRED (Federal Reserve Economic Data)
    - 이름: Federal Reserve Bank of St. Louis (FRED)
    - URL: https://fred.stlouisfed.org
    - API: fred/series/observations
    - 조회 지표:
        - DGS10: 미국 국채 10년물 금리
        - DFF: 미국 실효 연방기금금리
    - 키: 필요 (FRED_API_KEY)
    - 호출 제한: FRED API 이용 정책에 따름(분당 120회)
    - 갱신 주기: 각 시계열의 데이터 발표 및 업데이트 일정에 따름
3. BIS Central bank policy rates (WS_CBPOL)
    - 이름: BIS Central bank policy rates (WS_CBPOL)
    - URL: https://data.bis.org/topics/CBPOL
    - API: https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.{국가}?startPeriod=...&endPeriod=...&format=csv
    - 응답 형식: CSV
    - 조회 주기: 일별(`D`)만 사용 (월별 `M` 미지원)
    - 키: 불필요
    - 지원 국가 (그 외 국가는 지원하지 않음, 인도 IN 제외)

        | series | 국가 | indicator | 중앙은행 | BIS 시계열 |
        |---|---|---|---|---|
        | JP | 일본 | 일본 정책금리 | 일본은행(Bank of Japan) | D.JP |
        | GB | 영국 | 영국 정책금리 | 영란은행(Bank of England) | D.GB |
        | CA | 캐나다 | 캐나다 정책금리 | 캐나다은행(Bank of Canada) | D.CA |
        | AU | 호주 | 호주 정책금리 | 호주중앙은행(RBA, Reserve Bank of Australia) | D.AU |
        | CH | 스위스 | 스위스 정책금리 | 스위스국립은행(Swiss National Bank) | D.CH |
        | CN | 중국 | 중국 1년 만기 LPR | 중국인민은행(People's Bank of China) | D.CN |
        | BR | 브라질 | 브라질 정책금리 | 브라질중앙은행(Banco Central do Brasil) | D.BR |

    - 국가마다 정책금리 지표의 정의가 다릅니다 (예: 중국은 1년 LPR, 브라질은 SELIC 목표금리). `data.definition`을 함께 확인합니다.
    - 중국 indicator는 BIS COMPILATION의 현재 정의(`From 20 Aug 2019 onwards: Loan Prime Rate (1 year)`)에 맞춘 것입니다.

## 키 발급 방법
1. ECOS API 키
    - 한국은행 경제통계시스템(https://ecos.bok.or.kr)에 접속합니다.
    - Open API 이용 안내에서 인증키를 신청·발급받습니다.
    - 프로젝트 루트의 .env.local에 ECOS_API_KEY를 설정합니다.
2. FRED API 키
    - FRED API 안내(https://fred.stlouisfed.org/docs/api/api_key.html)에 접속합니다.
    - 계정 로그인 후 API 키를 발급받습니다.
    - 프로젝트 루트의 .env.local에 FRED_API_KEY를 설정합니다.
3. BIS: 키가 필요 없습니다.
4. .env.local 설정:
    - ECOS_API_KEY=your_ecos_api_key
    - FRED_API_KEY=your_fred_api_key

## 입력 / 출력
- 입력
    - `series`: 조회 금리 지표 (BOK / DGS10 / DFF / JP / GB / CA / AU / CH / CN / BR)
    - `days`: 비교 기간, **숫자** `30` / `90` / `365` 중 하나 (문자열 `"90"`은 거부)
    - 예: `{ "series": "JP", "days": 90 }`
- 출력 (공통)
    - data.indicator: 금리 지표 이름
    - data.rate: 최신 관측 금리
    - data.unit: 금리 단위 (`%`로 통일, ECOS의 `연%` 포함)
    - data.asOf: 최신 관측일 (YYYY-MM-DD)
    - data.comparisonDate: 비교 관측일 (YYYY-MM-DD)
    - data.comparisonRate: 비교 관측 금리
    - data.changePp: 금리 변동폭(%p)
    - data.changeBp: 금리 변동폭(bp)
    - data.requestedDays: 요청 기간
    - data.observationCount: 비교 관측일부터 최신 관측일까지의 유효 관측값 수
        - BIS는 국가별 관측 주기가 달라 직접 비교하기 어렵습니다. 중국·브라질은 주말 값까지 채워져 365일 기준 약 360~366개, 나머지는 영업일만 있어 약 255~262개입니다.
    - source: 데이터 제공기관, 출처 URL, 기준일
    - note: 지표 해석 관련 참고사항
- 출력 (BIS 추가 필드)
    - data.country: 국가 코드
    - data.centralBank: 중앙은행 명칭 (Tool이 정한 고정값)
    - data.daysSinceLatest: 오늘(한국 시간)과 최신 관측일의 차이(일). 항상 제공
    - data.stale: 최신 관측일이 14일을 초과해 오래되면 `true`. 이때 note 맨 앞에 경고 문구가 붙습니다
    - data.title: BIS `TITLE`
    - data.definition: BIS `COMPILATION` 원문 (정책금리 정의와 시기별 변경 이력, 앞뒤 공백만 정리하고 자르지 않음)
    - data.supplementaryInfo: BIS `SUPP_INFO_BREAKS` 원문 (없으면 null)
    - data.sourceRef: BIS `SOURCE_REF` 원문. BIS가 밝힌 원자료 제공처이며 `centralBank`와 다를 수 있습니다 (예: BR은 `Central Bank of Brazil`)
- 금리 변동폭 계산
    - changePp = 최신 금리 - 비교 금리
    - changeBp = changePp × 100
- 비교 기준일 (ECOS·FRED·BIS 공통)
    - 최신 관측일에서 요청 기간(days)만큼 이전 날짜의 값과 비교합니다.
    - 그날 값이 없으면(주말·휴일·결측) 직전 관측일 값을 사용합니다.
    - 비교할 과거 관측값이 없으면 임의로 계산하지 않고 에러를 던집니다.
    - 조회 기간: ECOS·FRED는 요청 기간 + 14일, BIS는 요청 기간 + 30일
        - BIS는 국가별 마지막 관측일이 늦을 수 있어(예: 호주) 최신 관측일이 오래돼도 N일 전 비교값이 조회 범위 안에 들어오도록 여유를 더 둡니다.
        - 한계: 최신 관측일이 오늘보다 L일 늦으면 비교값을 찾을 수 있는 구간은 약 (30 − L)일입니다. 연말 연휴처럼 결측이 4일가량 이어질 수 있어, **약 26일을 넘게 지연되면** stale 결과 대신 "비교 가능한 금리 데이터가 없습니다" 오류가 날 수 있습니다. 지연이 (요청 기간 + 30)일을 넘으면 조회 기간에 관측값이 없어 BIS가 404를 돌려줍니다. 두 경우 모두 값을 추정하지 않고 오류로 처리합니다.
- 결측값 처리
    - ECOS의 `""`, `" "`, `null`과 FRED의 `"."`, `""`, `null`은 0%가 아니라 제외합니다.
    - BIS는 아래 조건을 모두 만족하는 행만 사용합니다.
        - `FREQ` = `D`, `REF_AREA` = 요청 국가
        - `OBS_STATUS` = `A` (정상). 주말·휴일 결측(`OBS_VALUE=NaN`, `OBS_STATUS=M`) 등 그 외 상태는 제외
        - `TIME_PERIOD`가 실제로 존재하는 YYYY-MM-DD 날짜
        - `OBS_VALUE`가 숫자 (빈 값·공백·`NaN`·문자는 제외). **0%는 유효한 값** (예: 스위스)
    - 같은 `TIME_PERIOD`가 여러 번 오면 응답의 마지막 유효 행 하나만 사용합니다. 금리값과 title·definition·sourceRef 등 설명은 항상 같은 행에서 가져오고, 관측값 수도 한 번만 셉니다.
- BIS CSV 파싱
    - `parseCsv()`가 RFC 4180 규칙으로 따옴표 안의 쉼표·줄바꿈, 이스케이프된 따옴표(`""`), LF·CRLF를 처리합니다.
    - 컬럼은 헤더 이름으로 찾습니다. 필수 컬럼(`FREQ`, `REF_AREA`, `TIME_PERIOD`, `OBS_VALUE`, `OBS_STATUS`)이 없거나 행의 컬럼 수가 헤더와 다르면 형식 오류로 에러를 던집니다.
- 오류 처리
    - BIS HTTP 오류는 `BIS API 요청 실패 (상태코드)`로 던집니다. 404는 조회 기간에 관측값이 없거나 시계열이 없는 경우입니다.
    - 빈 응답, 형식 오류, 유효한 관측값 없음도 에러로 던집니다.
    - 타임아웃은 공통 규칙을 따릅니다 (fetch 8초, Tool 10초).

## fixture
- `fixture.json`은 테스트 전용 샘플입니다. 실제 서비스는 fixture를 쓰지 않고 ECOS·FRED·BIS 공식 API에서 데이터를 조회합니다.
- 실제 API 응답(2026-10 조회)의 구조와 필드명은 그대로 두고, 테스트에 필요한 관측값만 골라 `{ ecos, fred, bis }`에 담았습니다.
    - 관측값: 최신값, 30·90·365일 비교값, 결측값, 비교 기준일 전후의 경계 사례
    - ecos: 한국은행 기준금리 7건 (기준금리 인상일 포함)
    - fred: DGS10 10건 (휴일 `"."` 2건 포함)
    - bis: 7개국 CSV 헤더 + 관측 행 총 30건 (국가별 4~5건)
        - CA에는 실제 주말 결측 행(`NaN`, `M`), CH에는 0% 관측값이 있습니다
        - 국가별 최신 행만 `COMPILATION`·`SUPP_INFO_BREAKS` 원문을 담고, 나머지 행은 이 두 컬럼을 비웠습니다
- 중복 관측일, 쉼표·따옴표·줄바꿈이 섞인 CSV, 잘못된 날짜·금리값 같은 특수 사례는 `index.test.ts` 안에서 직접 만듭니다.
- BIS 테스트는 URL의 `startPeriod ~ endPeriod` 범위 행만 돌려주는 mock으로 실제 API의 조회 범위를 흉내 냅니다.

## 단독 실행
```bash
pnpm tool src/tools/rate/run.ts                          # 전체 지표, 90일
pnpm tool src/tools/rate/run.ts --series=JP --days=30    # 한 지표만
pnpm tool src/tools/rate/run.ts --series=BIS --days=365  # BIS 7개국 (키 불필요)
```

## 테스트
```bash
pnpm test src/tools/rate
```
