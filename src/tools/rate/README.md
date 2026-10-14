# Rate Tool (한국·미국 금리 조회)

한국은행 ECOS와 미국 FRED API를 이용해 한국 기준금리 및 미국 주요 금리 데이터를 조회하는 Tool입니다.

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
    - 호출 제한: FRED API 이용 정책에 따름
    - 갱신 주기: 각 시계열의 데이터 발표 및 업데이트 일정에 따름

## 키 발급 방법
1. ECOS API 키
    - 한국은행 경제통계시스템(https://ecos.bok.or.kr)에 접속합니다.
    - Open API 이용 안내에서 인증키를 신청·발급받습니다.
    - 프로젝트 루트의 .env.local에 ECOS_API_KEY를 설정합니다.
2. FRED API 키
    - FRED API 안내(https://fred.stlouisfed.org/docs/api/api_key.html)에 접속합니다.
    - 계정 로그인 후 API 키를 발급받습니다.
    - 프로젝트 루트의 .env.local에 FRED_API_KEY를 설정합니다.
3. .env.local 설정:
    - ECOS_API_KEY=your_ecos_api_key
    - FRED_API_KEY=your_fred_api_key

## 입력 / 출력
- 입력: `series` 조회 금리 지표 (BOK / DGS10 / DFF), `days`: 조회 및 비교 기간 (30 / 90 / 365)
- 출력
data.indicator: 금리 지표 이름
data.rate: 최신 관측 금리
data.unit: 금리 단위
data.asOf: 최신 관측일
data.comparisonDate: 비교 관측일
data.comparisonRate: 비교 관측 금리
data.changePp: 금리 변동폭(%p)
data.changeBp: 금리 변동폭(bp)
data.requestedDays: 요청 기간
data.observationCount: 조회한 유효 관측값 수
source: 데이터 제공기관, 출처 URL, 기준일
note: 지표 해석 관련 참고사항
금리 변동폭 계산
changePp = 최신 금리 - 비교 금리
changeBp = changePp × 100

## 단독 실행
```bash
pnpm tool src/tools/rate/run.ts
```

## 테스트
```bash
pnpm pnpm test src/tools/rate
```
