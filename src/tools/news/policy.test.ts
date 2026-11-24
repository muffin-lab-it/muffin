import { afterEach, describe, expect, it, vi } from "vitest";
import { approveDateIso, fetchPolicyNews, isEconomicPolicy, parsePolicyNews } from "./policy";
import { execute } from "./index";

/** 11/24 실제 응답 모양 (CDATA 안 HTML 본문, 날짜는 MM/DD/YYYY 한국 시간) */
const item = (id: number, title: string, minister: string, body: string, date = "11/23/2026 17:47:00") => `<NewsItem><NewsItemId>${id}</NewsItemId><ApproveDate>${date}</ApproveDate><Title><![CDATA[${title}]]></Title><SubTitle1><![CDATA[부제 ${id}<br>둘째 줄]]></SubTitle1><DataContents><![CDATA[<p>${body}</p><br><p>둘째 문단</p>]]></DataContents><MinisterCode>${minister}</MinisterCode><OriginalUrl>https://www.korea.kr/news/policyNewsView.do?newsId=${id}&amp;call_from=openData</OriginalUrl></NewsItem>`;
const ok = (items: string[]) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>0</resultCode><resultMsg>NORMAL_SERVICE</resultMsg></header><body>${items.join("")}</body></response>`;
const long = "정부가 산업·기업 간 양극화를 완화하기 위해 국가 대규모 프로젝트에 중소기업 참여를 확대하고 상생협력을 강화하는 방안 마련에 착수했다. ".repeat(3);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("정책브리핑 정책뉴스 (11/24, 다섯째 소스 policy)", () => {
  it("응답을 기사로 바꾼다: 출처는 '정책브리핑(부처)', 부처가 없으면 '정책브리핑', 날짜는 한국 시간, 본문은 부제 + 본문 글자", () => {
    const [a, b] = parsePolicyNews(ok([item(148976330, "산업·기업 간 격차 줄인다", "산업통상부", long), item(148976331, "김장철 원산지 점검", "", "본문")]));
    expect(a).toMatchObject({ title: "산업·기업 간 격차 줄인다", publisher: "정책브리핑(산업통상부)", source: "policy", publishedAt: "2026-11-23T08:47:00.000Z", url: "https://www.korea.kr/news/policyNewsView.do?newsId=148976330&call_from=openData" });
    expect(a!.description).toMatch(/^부제 148976330\n둘째 줄\n정부가 산업/);
    expect(a!.description).not.toMatch(/<|&lt;/);
    expect(b!.publisher).toBe("정책브리핑");
    expect(approveDateIso("bad")).toBeNull();
  });

  it("결과 코드가 0 이 아니면 그 이유로 던진다 (4일 넘게 부르면 THREE_DAYS_OVER_ERROR)", () => {
    expect(() => parsePolicyNews(`<response><header><resultCode>98</resultCode><resultMsg>THREE_DAYS_OVER_ERROR</resultMsg></header><body></body></response>`)).toThrow("정책브리핑 응답 오류: THREE_DAYS_OVER_ERROR");
  });

  it("최근 4일과 그 앞 4일을 따로 받아(한 번에 4일까지) 합치고, 키는 DATA_GO_KR_KEY 를 쓴다. 키가 없으면 던진다", async () => {
    vi.stubEnv("DATA_GO_KR_KEY", "test-key");
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: string | URL) => {
      const url = new URL(String(req));
      calls.push(url);
      return new Response(ok(url.searchParams.get("startDate") === "20261121" ? [item(1, "최근 경제 소식", "재정경제부", long)] : [item(2, "지난 소식", "산업통상부", long)]));
    }));
    const articles = await fetchPolicyNews(3_000, Date.parse("2026-11-24T03:00:00Z"));
    expect(calls.map((u) => [u.searchParams.get("startDate"), u.searchParams.get("endDate")])).toEqual([["20261121", "20261124"], ["20261117", "20261120"]]);
    expect(calls.every((u) => u.searchParams.get("serviceKey") === "test-key" && u.hostname === "apis.data.go.kr")).toBe(true);
    expect(articles.map((a) => a.title)).toEqual(["최근 경제 소식", "지난 소식"]);
    vi.stubEnv("DATA_GO_KR_KEY", "");
    await expect(fetchPolicyNews(3_000)).rejects.toThrow("DATA_GO_KR_KEY");
  });

  it("검색어가 없을 때 남기는 것은 경제 부처이거나 경제 낱말이 든 기사", () => {
    const a = (title: string, publisher: string) => ({ title, publisher, url: "https://www.korea.kr/news/policyNewsView.do?newsId=1", publishedAt: "2026-11-23T00:00:00.000Z", source: "policy" as const });
    expect(isEconomicPolicy(a("이 부총리 \"올해 3%대 후반 성장 가능\"", "정책브리핑(재정경제부)"))).toBe(true);
    expect(isEconomicPolicy(a("수출 호조 이어져", "정책브리핑(해양수산부)"))).toBe(true);
    expect(isEconomicPolicy(a("내달 4일까지 김장철 수산물 원산지 특별 점검", "정책브리핑(해양수산부)"))).toBe(false);
  });

  it("뉴스 tool: policy 를 고르면 본문이 함께 오고, 출처 표시 메모가 붙는다. 실패하면 다른 소스는 그대로", async () => {
    vi.stubEnv("DATA_GO_KR_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async (req: string | URL) => {
      const url = new URL(String(req));
      if (url.hostname === "apis.data.go.kr") return new Response(ok([item(3, "물가 안정 대책 발표", "재정경제부", long)]));
      throw new Error(`예상하지 않은 URL: ${url}`);
    }));
    const result = await execute({ sources: ["policy"], query: "물가 대책", limit: 3, content: "body" });
    expect(result.data.articles).toHaveLength(1);
    expect(result.data.articles[0]).toMatchObject({ publisher: "정책브리핑(재정경제부)", source: "policy", body: { status: "available" } });
    expect(result.data.articles[0]).not.toHaveProperty("description");
    expect(result.note).toContain("정책브리핑 기사는 공공누리 1유형 자료로, 출처(정책브리핑 · 부처)를 밝혀");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<response><header><resultCode>30</resultCode><resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg></header></response>`)));
    await expect(execute({ sources: ["policy"], query: null, limit: 3, content: "list" })).rejects.toThrow(/SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  });
});
