# etf (국내 ETF 시세)

국내 상장 ETF 의 최신 시세와 최근 N일 기간 변화를 조회합니다. tool 이름은 `get_etf_kr_price` 입니다.

## 데이터 소스
- 이름: 금융위원회_증권상품시세정보 (공공데이터포털, 원천 KRX)
- URL: https://www.data.go.kr/data/15094806/openapi.do
- 엔드포인트: `https://apis.data.go.kr/1160100/GetSecuritiesProductInfoService_V2/getETFPriceInfo_V2`
  - 오퍼레이션 이름에도 `_V2` 가 붙습니다. 빼면 `NO_OPENAPI_SERVICE_ERROR` 가 납니다.
  - 구버전(`/service/GetSecuritiesProductInfoService/getETFPriceInfo`)은 새로 발급한 키로는 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 가 납니다.
- 키: 필요 (`DATA_GO_KR_KEY`)
- 호출 제한: 개발계정 10,000회/일. tool 한 번 호출에 API 를 1~3번 부릅니다.
- 갱신 주기: 영업일 1회, T+1 (다음 영업일 오후 1시 이후)
- 이용 조건: 공공누리 제4유형 (출처표시, 상업적 이용금지, 변경금지)
- 범위: 한국거래소 상장 ETF 전체. 해외 지수를 추종하는 국내 상장 ETF(예: TIGER 미국S&P500)는 포함되고, 미국 거래소 상장 ETF(SPY 등)는 없습니다.

## 키 발급 방법
1. 공공데이터포털(data.go.kr) 로그인
2. "금융위원회_증권상품시세정보" 검색 → 활용신청 (개발계정, 자동승인)
3. 마이페이지 → 일반 인증키를 `.env.local` 에 넣기 (Encoding/Decoding 아무거나)

```
DATA_GO_KR_KEY=발급받은키
```

## 입력 / 출력
- 입력
  - `query`: ETF 이름(운용사명+공백+상품명, 예: `KODEX 200`) 또는 6자리 종목코드(예: `069500`)
  - `days`: 기간 변화를 볼 일수, 1~365 (달력 기준)
- 출력 `data`
  - `etf`: `code`, `isin`, `name`, `baseIndex`(기초지수명)
  - `latest`: 최신 기준일의 `close`, `change`, `changePct`, `nav`, `premiumPct`(괴리율), `open`, `high`, `low`, `volume`, `tradeValue`, `netAssets`(순자산총액, 원), `listedShares`, `indexClose`
  - `period`: `from`, `to`, `tradingDays`, `closeFrom`·`indexCloseFrom`(기간 시작일 종가 · 지수), `returnPct`, `high`, `low`, `indexReturnPct`, `trackingDiffPp`(ETF 수익률 − 지수 수익률, %p)
- 계산값(`premiumPct`, `returnPct`, `indexReturnPct`, `trackingDiffPp`)은 반올림하지 않습니다. 반올림은 리포트 표기와 검증기가 합니다.
- `source.asOf` 는 최신 기준일입니다.

## 증거 장부 (evidence)
`evidenceOf` 가 장부에 올릴 핵심 값을 고릅니다. 리포트의 숫자가 이 값을 인용하고(E1…), 검증기(`src/agent/verify.ts`)가 대조합니다.
- 키는 `data` 경로 그대로입니다 (`latest.close`, `period.returnPct` …). 검증기는 키 이름으로 단위와 역할을 판단합니다.
  - `Pct` → %, `Pp` → %p. 추적 차이를 `0.76%` 로 적으면 걸리고 `0.76%p` 로 적어야 맞습니다.
  - `From` 으로 끝나는 키(`period.closeFrom`)는 비교 시점 값입니다. 기간 시작일(`period.from`)로 인용해야 합니다.
- 종목코드 · ISIN 은 올리지 않습니다 (`069500` 이 숫자 69500 으로 대조 후보에 섞임). 값이 없는(`null`) 항목도 뺍니다.

## 동작 방식
1. `query` 가 6자리 코드면 `likeSrtnCd` 로 기간 조회
2. 아니면 받아 둔 이름 목록(`etf-list.json`)에서 코드를 찾음 (API 없음, 아래 "이름 목록")
   - 하나로 정해지면: 그 코드로 기간 조회 (API 1번)
   - 여러 개에 걸리면: 후보 목록을 담아 실패 (API 없음)
   - 목록에 없거나 그 코드의 시세가 없으면: 3번으로
3. `itmsNm`(정확 일치)으로 기간 조회
4. 없으면 최근 10일 범위에서 `likeItmsNm`(부분 일치)으로 후보를 찾음
   - 후보 1개: 그 코드로 기간 조회
   - 여러 개: 후보 목록(최대 10개)을 담아 실패 → Agent 가 정확한 이름이나 코드로 다시 부름
   - 0개: 입력 형식을 안내하며 실패

참고로 `srtnCd` 파라미터는 무시되고 전체 종목이 돌아오므로 코드 조회는 `likeSrtnCd` 를 씁니다. 이름은 대소문자를 구분합니다(`kodex 200` 은 0건).

## 이름 목록 (`etf-list.json`)
- 국내 상장 ETF 전체의 `[종목코드, 이름]` 목록입니다 (2026-11-05 기준 1,184개). 이름 질문의 API 호출을 최대 3번에서 1번으로 줄이고, 표기가 달라도 찾게 하려는 것입니다.
- 찾을 때 맞추는 표기 (`names.ts`)
  - 공백 · 대소문자 · 끝의 "ETF": `KODEX200`, `kodex 200 etf` → `KODEX 200`
  - 한글 · 예전 브랜드: 코덱스 → KODEX, 타이거 → TIGER, KBSTAR → RISE, KINDEX → ACE, ARIRANG → PLUS, KOSEF → KIWOOM 등
  - 앞에 붙은 운용사: `삼성 KODEX 200`, `미래에셋 TIGER 200`
  - 상품명 단어: NASDAQ → 나스닥, 에스앤피 → S&P, 해외 지수 ETF 의 "미국" 생략(`TIGER S&P500` → `TIGER 미국S&P500`)
- 새로 받기: `pnpm tool src/tools/etf/build-list.ts` (최근 영업일 전체 ETF 를 받아 파일을 다시 씀). 새 ETF 상장이나 이름 변경이 있을 때 돌리고 커밋합니다. 목록에 없는 ETF 도 API 이름 조회로 찾으므로, 목록이 조금 오래돼도 동작합니다.
- 미국 거래소 상장 ETF(SPY, QQQ 등)는 목록에 없어서 API 조회까지 간 뒤 "찾지 못했습니다" 로 실패합니다.

## 응답 없는 요청 다시 보내기
- 공공데이터포털은 새 연결의 약 4번 중 1번 이상을 연결만 받고 응답하지 않습니다 (2026-11-05 실측: 정상 응답은 0.6초 안, 멈추면 10초를 기다려도 안 옴).
- 그래서 요청마다 2초(`ATTEMPT_TIMEOUT_MS`)만 기다리고, 시간 초과 · 연결 실패 · 5xx 면 새 연결로 최대 4번(`MAX_ATTEMPTS`) 보냅니다.
- 4xx · 결과 코드 오류(호출 한도 등) · "찾지 못함" 은 다시 보내도 같아서 한 번만 보냅니다.
- 한 번 실행(이름 → 후보 → 코드, 최대 3단계)은 11초(`EXECUTE_BUDGET_MS`) 안에서만 다시 보내고, tool 제한 시간은 12초입니다.
- 실측: 2초 × 4번으로 30번 실행해 30번 성공 (다시 보내서 성공 2번, 가장 오래 걸린 것 6.7초).

## 주의
- 기간 수익률은 분배금을 뺀 가격 수익률입니다.
- 조회 기간에 관측값이 2개 미만이면 `closeFrom`, `indexCloseFrom`, `returnPct`, `indexReturnPct`, `trackingDiffPp` 는 비교 데이터 부족을 나타내는 `null` 입니다.
- 기초지수가 TR(배당 재투자) 지수인지 PR(가격) 지수인지에 따라 추적 차이가 달라질 수 있습니다.
- 해외 지수 추종 ETF(예: TIGER 미국S&P500)는 기초지수가 달러 등 현지 통화 기준입니다. 환헤지(H)가 없는 상품은 `trackingDiffPp` 에 환율 변동이 섞입니다.
- 공공데이터포털 키는 URL 쿼리로 보내야 해서, 실패 메시지에서는 `serviceKey` 값을 `****` 로 가립니다.
- 공공데이터포털이 해외 IP 를 막을 수 있어, Vercel 배포 시 Function 리전을 `icn1`(서울)로 두고 실제 호출을 확인해야 합니다.

## 단독 실행
```bash
pnpm tool src/tools/etf/run.ts --query "KODEX 200" --days 30
pnpm tool src/tools/etf/run.ts --query 069500 --days 7
```

## 테스트
```bash
pnpm test src/tools/etf
```
