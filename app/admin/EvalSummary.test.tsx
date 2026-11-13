import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvalSummary } from "./EvalSummary";

const markdown = `# 리포트 평가 (Promptfoo) 2026-11-13 06:03

✅ 모든 지표가 기준 안

질문 19개 (오류 0), 리포트 평균 19.1초

## 지표별 통과율

| 지표 | 통과 | 통과율 | 기준 | 지난 번 | 상태 |
|---|---|---|---|---|---|
| 의도 일치 | 17/19 | 89% | 80% | 100% (-11p) | ✅ |
| tool 선택 | 18/18 | 100% | 80% | 100% (±0p) | ✅ |

## 실패 항목

- etf-status-3 · 의도 일치: 분류 compare · 정답 status
- **etf-compare-1** · 검증 통과: 검증 partial, 뺀 항목 2개
`;

describe("EvalSummary (평가 요약 markdown 그리기)", () => {
  it("제목 · 문단 · 표 · 목록을 그리고 표의 구분줄은 뺀다", () => {
    const $ = load(renderToStaticMarkup(<EvalSummary markdown={markdown} />));
    expect($("h3").text()).toBe("리포트 평가 (Promptfoo) 2026-11-13 06:03");
    expect($("h4").map((_, el) => $(el).text()).get()).toEqual(["지표별 통과율", "실패 항목"]);
    expect($("p").first().text()).toBe("✅ 모든 지표가 기준 안");
    expect($("table th").map((_, el) => $(el).text()).get()).toEqual(["지표", "통과", "통과율", "기준", "지난 번", "상태"]);
    expect($("table tbody tr")).toHaveLength(2);
    expect($("table tbody tr").first().find("td").map((_, el) => $(el).text()).get()).toEqual(["의도 일치", "17/19", "89%", "80%", "100% (-11p)", "✅"]);
    expect($("ul li")).toHaveLength(2);
    expect($("ul li").last().text()).toBe("etf-compare-1 · 검증 통과: 검증 partial, 뺀 항목 2개");
  });

  it("markdown 속 HTML 은 글자로만 보여 준다", () => {
    const html = renderToStaticMarkup(<EvalSummary markdown={"## <img src=x onerror=alert(1)>\n\n| a |\n|---|\n| <b>x</b> |"} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
  });

  it("빈 요약은 빈 상자", () => {
    const $ = load(renderToStaticMarkup(<EvalSummary markdown="" />));
    expect($("div").children()).toHaveLength(0);
  });
});
