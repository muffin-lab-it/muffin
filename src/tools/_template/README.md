# _template (샘플: USD/KRW 환율)

새 tool 을 만들 때 이 폴더를 복사해서 시작합니다. 아래 항목을 자기 tool 에 맞게 채우세요.

## 데이터 소스
- 이름: Frankfurter (ECB reference rates)
- URL: https://www.frankfurter.app
- 키: 불필요
- 호출 제한: 명시된 제한 없음
- 갱신 주기: ECB 고시 기준 평일 1회

## 키 발급 방법
- 없음. 키가 필요한 소스면 여기에 발급 절차와 `.env.local` 변수명을 적습니다.

## 입력 / 출력
- 입력: `base`(USD/EUR/JPY), `quote`(KRW/USD)
- 출력: `data.pair`, `data.rate`, `data.asOf` + `source`

## 단독 실행
```bash
pnpm tool src/tools/_template/run.ts --base USD --quote KRW
```

## 테스트
```bash
pnpm test src/tools/_template
```
