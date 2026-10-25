# News Tool — 국내 경제 뉴스 RSS

국내 경제 뉴스의 제목·발행 시각·언론사·링크를 RSS에서 조회합니다. `content=body`에서는 연합뉴스·한국경제 **공개 기사 페이지**의 본문 추출도 시도합니다. Google News는 목록·검색 결과만 제공하며, 본문을 확보한 것으로 표시하지 않습니다.

## 주요 기능

- 연합뉴스·한국경제 경제 RSS와 Google News 한국어 경제 검색 RSS 지원
- 소스별 URL과 변환 함수를 `sources.ts`에 분리
- 날짜를 ISO 8601로 표준화하고, 불완전한 항목 제외, 중복 제거, 최신순 정렬
- 일부 소스 실패 시 성공한 기사와 `failedSources`를 함께 반환. 전부 실패하거나 반환할 기사가 없으면 오류 발생
- 기사마다 클릭 가능한 `source` 기록
- RSS 수집(`rss.ts`, `sources.ts`)과 본문 추출(`body.ts`) 분리. `body` 모드는 실패 후보를 제외하고 다음 RSS 후보로 보충
- 유료 기사 표시를 확인하면 본문 수집을 중단하고 `access_restricted` 반환

## 데이터 소스와 이용 조건

10/17 리더 의견: HTML은 구조 변경 가능성이 커 유지보수·안정성 문제 때문에 스크래핑을 금지했으나, News Tool은 우선 진행하고 이후 고도화하기로 했습니다. 이는 기술 개선 방향이며 HTML 추출의 안정성이 확보됐다는 뜻은 아닙니다.

10/19 리더 검토: RSS 수집과 공개 기사 본문 추출을 개발·비상업 범위에서 허용. 실제 서비스 공개 전 이용 조건 재확인.

| 소스 | RSS URL | API Key | 호출 제한 | 갱신 주기 | 확인된 제한 |
|---|---|---|---|---|---|
| 연합뉴스 경제 | https://www.yna.co.kr/rss/economy.xml | 실제 무인증 요청 성공 | 미확인 | 미확인 | RSS의 `copyright`에 무단 전재·재배포 및 **AI 학습·활용 금지** 명시 |
| 한국경제 경제 | https://www.hankyung.com/feed/economy | 실제 무인증 요청 성공 | 미확인 | 미확인 | RSS에 저작권 보유 표기. 공개 기사와 유료 기사가 섞여 있음. [콘텐츠 제휴 안내](https://company.hankyung.com/dotcom/partnership/contents/)는 앱 등에서 사용 시 사전 협의 필요 |
| Google News 국내 경제 검색 | https://news.google.com/rss/search?q=%EA%B2%BD%EC%A0%9C&hl=ko&gl=KR&ceid=KR%3Ako | 실제 무인증 요청 성공 | 미확인 | 미확인 | RSS의 `copyright`가 개인적·비상업적 피드 리더 표시 용도 외 사용을 금지 |

2026-10-17에 세 주소가 HTTP 200과 RSS XML을 반환하는 것을 확인했습니다. 공개 기사 HTML의 기술적 추출 가능성과 **AI 서비스 이용 권한은 별개**입니다. 위 리더 검토는 팀 내부 개발 범위의 결정이며 언론사·Google의 별도 이용 허락을 대신하지 않습니다. 연합뉴스 기사에는 무단 전재·재배포 및 AI 학습·활용 금지가 표시됩니다. 한국경제 유료 기사에는 사전 허가 없는 AI 학습 활용 금지가 표시됩니다. 운영 배포 전에는 각 소스의 RSS 및 전문을 AI 입력·결과 표시·저장·상업적 용도로 쓸 수 있는지 확인해야 합니다. 허락이 필요한 경우 얻은 뒤 사용하거나 허용된 데이터 소스로 교체해야 합니다. **현재 구현은 개발·테스트용이며, 권한 확인 전 실제 서비스에서 전문을 AI 분석에 입력하면 안 됩니다.**

실제 응답의 기사 제목·본문·RSS 원문은 공개 저장소에 넣지 않았습니다. 팀 공통 [Tool 만들기 가이드](../../../README.md)의 “실제 API 응답을 fixture에 저장” 규칙에 대한 **예외**입니다. 연합뉴스의 [콘텐츠 저작권 고지](https://www.yna.co.kr/view/AKR20260324096100011), 한국경제의 [콘텐츠 제휴 안내](https://company.hankyung.com/dotcom/partnership/contents/), Google News RSS 자체의 이용 문구를 확인했지만, 원본 응답을 공개 GitHub에 재배포할 허락은 확인하지 못했습니다. 따라서 `fixture.json`은 실제 XML 필드 배치를 본뜬 **합성 데이터**만 담고, 실제 응답은 로컬 `run.ts`로 검증합니다. 기사 제목뿐 아니라 RSS 원문 일부도 허락 전에는 fixture로 커밋하지 않습니다.

2026-10-17에 세 RSS를 다시 호출해 HTTP 200과 구조를 확인했습니다. 연합뉴스 120개 항목은 `title`·`description`에 CDATA를 사용하고 `guid`·`dc:creator`를 포함했으며, 일부에는 `media:content`가 있었습니다. 한국경제 50개 항목은 `title`·`author`가 CDATA이고 `description`은 없었습니다. Google News 100개 항목은 `source`의 텍스트와 `url` 속성, `guid`, HTML이 이스케이프된 `description`을 포함했습니다. 발행일은 두 언론사에서 `+0900`, Google News에서 `GMT` 형식이었습니다. 확인한 항목에서는 제목·링크·발행일 누락이 없었으며, 누락 필드 처리는 합성 예외 사례로만 테스트합니다. `fixture.json`의 `*ObservedShape` 값은 이 필드 구조를 재현하되 모든 기사 내용·URL ID·날짜 값은 합성입니다. 현재 피드 구조는 이후 변경될 수 있습니다.

## 입력과 출력

모든 입력 필드는 필수입니다.

| 입력 | 의미 |
|---|---|
| `sources` | `yonhap`, `hankyung`, `google` 중 1~3개. 중복 입력은 한 번만 조회 |
| `query` | 검색어 또는 `null`. Google News는 RSS 검색 질의로 사용하며 `null`이면 **경제**로 검색. 다른 피드는 받은 최신 기사 **제목만** 필터링 |
| `limit` | `list`에서는 반환 목록 상한, `body`에서는 본문 확보 목표. 1~10, Agent 호출 시 필수. 보통 5건 권장 |
| `content` | `list` 또는 `body`. `body`는 공개 기사 본문 추출을 시도 |

`data.articles[]`에는 `title`, `url`, `publisher`, `publishedAt`(ISO 8601), `source`(소스 ID), `body`가 있습니다. `list`에서는 `{status:"not_requested"}`, `body`에서는 **확보에 성공한 기사만** `{status:"available",text}`로 들어갑니다. 실패는 `failedCount`, `failureCounts`, `failedArticles`(최대 10건 예시)에 집계됩니다. `requestedCount`, `collectedCount`, `missingCount`, `inspectedCount`, `resultStatus`(`complete`/`partial`), `stopReason`도 반환합니다. `count`는 `articles.length`와 같습니다. RSS 소스 장애는 별도 `failedSources`에 기록합니다. `source[]`는 실제 반환 기사와 같은 순서의 `{ name, url, asOf }`입니다.

```json
{
  "data": {
    "articles": [{ "title": "합성 경제 기사", "url": "https://www.yna.co.kr/view/AKRTEST001", "publisher": "연합뉴스", "publishedAt": "2026-10-17T00:00:00.000Z", "source": "yonhap", "body": { "status": "available", "text": "합성 본문입니다." } }],
    "count": 1, "requestedCount": 2, "collectedCount": 1, "missingCount": 1,
    "inspectedCount": 2, "failedCount": 1, "failureCounts": { "access_restricted": 1 },
    "failedArticles": [{ "source": "hankyung", "url": "https://www.hankyung.com/article/TEST002", "reason": "access_restricted" }],
    "resultStatus": "partial", "stopReason": "feed_exhausted", "bodyStatus": "partial", "failedSources": []
  },
  "source": [{ "name": "연합뉴스", "url": "https://www.yna.co.kr/view/AKRTEST001", "asOf": "2026-10-17T00:00:00.000Z" }]
}
```

예시는 실제 기사가 아닌 합성 데이터입니다. Google News의 `url`은 중계 링크이며 원문 링크가 아닙니다. Google만 선택한 `body` 요청처럼 본문 확보가 0건이면 실패 이유 집계와 함께 `execute`가 throw합니다. 일부 확보했다면 `partial` 결과로 성공 기사만 사용할 수 있습니다.

`body.status=available`은 현재 공개 HTML의 지정 본문 영역에서 텍스트를 읽었다는 뜻입니다. 원고 전체와 문장별로 대조해 전문의 완전성을 보증하는 표시는 아닙니다. 사진·표의 정보는 텍스트 본문에서 빠질 수 있습니다.

부분 실패는 `data.failedSources`와 `note`에 명시합니다. 요청한 모든 소스가 실패하거나 결과가 없으면 `execute`가 throw합니다. 유효한 피드에서 검색어와 일치하는 제목이 없는 경우도 결과 없음 오류로 처리합니다.

## 증거 장부와 평가 질문

`newsTool`의 `evidence` 훅은 반환한 `data.articles`와 같은 순서·개수로 기사별 메타데이터를 만듭니다. `source`도 같은 기사 배열에서 생성하므로 각 기사의 제목·언론사·발행일·출처가 대응합니다. 기사 1건은 공통 래퍼가 `E1`, 여러 건은 `E1-1`, `E1-2`처럼 번호를 붙입니다 (숫자는 해당 조사에서의 호출 순서에 따라 달라집니다).

- 장부 값은 `title`, `publisher`, `publishedAt`, `body` 네 필드입니다. `body`에는 본문 텍스트 대신 상태만 기록합니다. `list`는 `not_requested`, `body` 모드에서 반환한 성공 기사는 `available`입니다.
- 본문은 짧더라도 장부에 넣지 않고 기존 `data`에만 유지합니다. 본문 실패 후보는 장부 성공 항목에 포함하지 않습니다. Google News는 목록의 메타데이터·중계 출처만 기록하며 본문 미지원 정책은 그대로입니다.
- evidence는 보도 내용의 출처를 추적하는 기록이며, 기사 속 숫자나 보도된 원인을 독립적으로 검증한 경제 통계·인과관계로 바꾸지 않습니다. 기존의 “기사 속 수치는 별도 검증이 필요합니다” 주의 문구도 장부에 유지됩니다. 다만 현재 공통 숫자 검증기는 제목 안의 금융 숫자도 대조 후보로 읽으므로, **제목과의 숫자 일치와 공식 통계 검증을 구분하는 정책은 리더와 확인해야 합니다.** 이번 변경은 공통 검증기 동작을 바꾸지 않습니다.

평가 질문은 [`scripts/questions/news.json`](../../../scripts/questions/news.json)에 `@Kangsohee` 담당으로 현황 2개·원인 2개·비교 2개를 기록합니다. 현재 RSS의 기사와 실제 확보한 본문 안에서 답하도록 범위를 정하고, 원인 질문은 보도된 주장과 검증된 인과관계를 구분하며 자료 부족을 명시하는지 평가합니다. `common.json`의 주간 금리 현황 요약과는 범위를 구분합니다.

## 기사 수량·기간·성능 정책

- `run.ts`의 기본 `limit`는 **5**입니다. Agent 입력은 기존 Tool 규칙에 따라 모든 필드가 필수라 기본값 없이 `limit`를 명시합니다. 리더는 출처 수와 AI 처리 시간·비용을 고려해 **보통 5건**, 최대 **10건**을 요청하도록 안내했습니다.
- 별도 날짜 필터나 고정 조회 기간은 없습니다. 선택한 RSS의 **현재 제공 항목**만 대상으로 발행일 내림차순 정렬합니다. 피드가 제공하지 않는 과거 기사까지 찾지 않습니다.
- `body`는 직접 언론사 후보를 Google보다 먼저 검사하고, 성공한 본문이 `limit`에 닿으면 멈춥니다. 후보는 최대 `min(60, max(15, limit×3))`건 검사합니다. 후보 부족·기한 도달·후보 상한 도달 시 가능한 본문만 `partial`로 반환합니다. 같은 URL은 한 건으로 취급합니다. Google 중계 기사가 같은 언론사의 직접 기사와 제목이 같으면 직접 기사를 우선합니다. 서로 다른 URL의 직접 기사는 제목이 같아도 유지합니다.
- RSS 요청은 각각 3초, 본문 요청은 각각 최대 2.5초, 본문 동시 요청은 최대 4개입니다. Tool 내부 처리 예산은 8.5초, 공통 `defineTool` 제한은 10초입니다. RSS XML과 기사 HTML은 각각 100만 자, 기사 본문은 1건 1.2만 자·전체 응답 8만 자를 넘으면 실패 후보로 집계합니다. HTML/XML 크기는 `fetchText`가 문자열로 읽은 **뒤** 검사하므로 전송 중 바이트 상한은 아닙니다.
- RSS별 기사 수 배분은 고정하지 않습니다. 성공한 소스의 현재 피드 항목을 합쳐 후보를 구성하며, 특정 소스가 실패하면 다른 소스의 후보를 계속 사용합니다. 언론사 호출 제한과 RSS 갱신 주기는 **미확인**입니다.

## 단독 실행과 테스트

```bash
pnpm tool src/tools/news/run.ts --sources yonhap,hankyung --limit 5 --content body --summary
pnpm tool src/tools/news/run.ts --sources google --query 환율 --limit 5 --content list --summary
pnpm test src/tools/news
pnpm test scripts/questions
pnpm lint
pnpm typecheck
pnpm test
```

`run.ts`만 실제 RSS와 기사 HTML을 호출합니다. `--summary`는 본문을 출력하지 않고 상태·글자 수·문단 수만 출력합니다. 자동 테스트는 `fixture.json`의 합성 RSS·HTML을 사용해 `fetch`를 대체하므로 API Key와 외부 네트워크가 필요하지 않습니다. `query` 없이 Google News를 선택하면 기본 검색어는 `경제`입니다.

## 소스 추가·교체

`sources.ts`에서 URL 생성 함수와 소스별 변환 함수를 추가하거나 바꿉니다. 본문 지원 언론사는 `body.ts`의 호스트·경로 검증과 추출 함수를 별도로 추가합니다. 소스 ID를 `sourceIds`에 등록하고 새 XML·HTML 형태의 **합성 fixture**와 테스트를 추가합니다. 공통 RSS 파서와 Tool 계약은 `rss.ts`·`index.ts`에서 유지합니다. 소스를 바꿀 때는 실제 응답, 본문 구조, 이용 조건을 다시 확인합니다.

## 알려진 제약과 Agent 연결

- 발행처 피드에서는 서버 검색 기능이 확인되지 않아, **현재 RSS에 포함된 제목**만 검색합니다. 과거 기사 전체 검색은 제공하지 않습니다.
- Google News 검색 결과는 여러 언론사 기사와 중계 링크를 섞어 반환할 수 있습니다.
- Google News 중계 링크 5건을 검증했지만 직접 리디렉션·canonical에서 원문 URL을 확인한 사례는 0건입니다. 제목 검색 결과를 원문 주소로 자동 확정하지 않습니다. Google 기사 본문은 `original_url_unresolved`입니다.
- 한국경제 RSS에는 유료 기사가 포함됩니다. HTTP 200이나 일부 문장이 보여도 유료 표시가 있으면 `access_restricted`로 처리합니다.
- HTML 구조 변경 시 `structure_changed`, HTTP 오류 시 `http_error`, 타임아웃 시 `timeout`으로 집계합니다. 현재 본문 추출기는 자동 구조 감지 기능이 없습니다.
- 공통 `fetchText`는 `redirect` 옵션을 제공합니다. News Tool의 **기사 본문 요청**에는 `redirect: "error"`를 적용해 리디렉션을 따라가지 않고 실패시킵니다. 이는 목적지를 검사하는 기능이 아니라 리디렉션 자체를 거부하는 기능입니다. 기존 HTTPS 호스트·경로 허용 목록 검사와 요청 전 쿼리·fragment 제거는 유지하며, RSS 수집은 공통 헬퍼의 기본값 `"follow"`를 유지합니다.
- 정상 기사라도 다른 주소로 리디렉션되면 본문을 확보하지 못합니다. fetch의 거부 오류는 기존 `http_error`로 집계하며 다른 후보로 보충합니다. 부족하면 `partial`, 본문 확보가 0건이면 오류를 반환합니다. 리디렉션 오류를 일반 네트워크 오류와 별도 사유로 구분하지는 않습니다.
- 기사 URL이 달라도 같은 내용이 재발행되면 중복으로 남을 수 있습니다. 정확한 원문 ID가 없는 Google 중계 기사는 같은 언론사·제목의 직접 RSS 기사와 비교해 제외합니다.
- RSS 제목은 기사 본문이나 수치의 정확성을 보증하지 않습니다. Agent 리포트에서 수치는 다른 신뢰 가능한 데이터와 대조해야 합니다.
- 호출 제한, 갱신 주기, 운영 배포 허용 여부는 **미확인**입니다.

## 후속 작업과 담당

- News Tool 담당: HTML 구조 변경과 본문 추출 실패 사례를 점검하고, 첫·마지막 문단을 포함한 추출 정확도와 언론사별 파서의 유지보수성을 개선합니다. 공식 데이터 제공 방식 또는 이용이 허용된 대체 소스도 검토합니다. 현재는 자동 구조 복구를 제공하지 않습니다.
- 소영 리더 담당: PR 최종 리뷰·Merge, Agent 연결과 공통 HTTP 헬퍼 유지보수를 담당합니다. 공통 헬퍼의 `redirect: "error"` 옵션은 제공된 상태입니다.
- News Tool 담당: 해당 옵션을 기사 **본문 요청**에 적용했습니다. 합성 fixture 테스트에서는 정상 요청의 옵션 전달, 리디렉션 거부 오류의 실패 집계·자동 보충·부분 성공을 검증합니다. fetch mock이 실제 리디렉션을 수행하는 것은 아니므로 거부 오류를 명시적으로 재현합니다. 향후 언론사의 정상 리디렉션 증가와 본문 확보율 변화도 점검해야 합니다.
- 다운로드 중 응답 크기 제한도 미해결 보안 문제입니다. 현재 제한은 `fetchText`가 응답 전체를 받은 뒤 적용됩니다. 공통 헬퍼 개선의 담당·방식은 아직 확정되지 않았으며 운영 연결 전에 결정해야 합니다.
- Agent 연결 뒤에는 `resultStatus`, `missingCount`, `failureCounts`를 드러내고 성공 기사만 분석에 사용하며, 기사별 출처와 리포트 수치·설명을 QA해야 합니다. 팀 내부 개발 허용은 언론사의 AI 서비스 이용 허락을 대신하지 않습니다.
- News Tool 밖의 파일·공통 설정·새 라이브러리·공통 HTTP 또는 Agent 코드 변경, 팀 규칙과 충돌하는 구현, 보안·이용 조건 문제나 리더 결정이 필요한 사항은 작업 전에 담당자에게 알리고 사용자가 Discord 공유를 완료했는지 확인합니다. `cheerio`·`fast-xml-parser` 추가와 현재 pnpm 설치 오류는 이미 리더에게 공유됐습니다. 향후 새 의존성은 이유와 영향 범위를 사전 공유한 뒤 추가합니다.
