/** 한국·미국 CPI·실업률의 실제 응답으로 조회·계산·오류 처리를 검증한다. API 키는 필요 없다. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunContext } from "@openai/agents";
import { ResearchContext } from "../../agent/context";
import fixture from "./fixture.json";
import { execute, macroTool, parameters, type Input } from "./index";

// 실제 원응답에서 타입을 추론한다. 오류 사례는 복사본만 수정한다.

type EcosRow = (typeof fixture.KR_cpi.response.StatisticSearch.row)[number]
  | (typeof fixture.KR_unemployment.response.StatisticSearch.row)[number];

type EcosBody = {
  StatisticSearch: {
    list_total_count: number;
    row: EcosRow[];
  };
};

type FredBody = typeof fixture.US_cpi.response;

const cases = fixture;

const krInput: Input = {
  country: "KR",
  indicator: "cpi",
  endMonth: "202509",
  months: 6
};

const usInput: Input = {
  ...krInput,
  country: "US"
};

function mockApi(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), {
    status
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function krBody(indicator: Input["indicator"] = "cpi"): EcosBody {
  return structuredClone(cases[`KR_${indicator}`].response);
}

function usBody(indicator: Input["indicator"] = "cpi"): FredBody {
  return structuredClone(cases[`US_${indicator}`].response);
}

function changeKr(
  month: string,
  changes: Partial<EcosRow>,
  indicator: Input["indicator"] = "cpi"
) {
  const body = krBody(indicator);
  Object.assign(body.StatisticSearch.row.find(r => r.TIME === month)!, changes);
  return body;
}

function changeUs(month: string, value: string, indicator: Input["indicator"] = "cpi") {
  const body = usBody(indicator);
  body.observations.find(r => r.date === `${month.slice(0, 4)}-${month.slice(4)}-01`)!.value = value;
  return body;
}

beforeEach(() => {
  vi.stubEnv("ECOS_API_KEY", "ecos-test-key");
  vi.stubEnv("FRED_API_KEY", "fred-test-key");
  vi.useFakeTimers({
    toFake: ["Date"]
  });
  vi.setSystemTime(new Date("2025-10-15T12:00:00+09:00"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("실제 응답 fixture 기반 조회", () => {
  it.each(["KR_cpi", "KR_unemployment", "US_cpi", "US_unemployment"] as const)(
    "%s: 6개월 자료·비교·출처를 한 번의 요청으로 반환한다",
    async id => {
      const sample = cases[id];
      const input = parameters.parse(sample.input);
      vi.stubEnv(input.country === "KR" ? "FRED_API_KEY" : "ECOS_API_KEY", "");
      const calls = mockApi(sample.response);
      const result = await execute(input);
      expect(result.data.period).toEqual({
        from: "202504",
        to: "202509",
        months: 6
      });
      expect(result.data.observations.map(p => p.month)).toEqual(
        ["202504", "202505", "202506", "202507", "202508", "202509"]
      );
      expect(result.data.latest).toEqual(result.data.observations[5]);
      expect(result.data.latest.previousYear.month).toBe("202409");
      expect(
        result.data.observations.every(
          p => p.previousMonth.change !== null && p.previousYear.change !== null
        )
      ).toBe(
        true
      );
      expect(result.source).toMatchObject({
        asOf: "2025-09-01"
      });
      expect(result.note).toContain("발표일·조회일이 아닙니다");
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      const url = new URL(calls.mock.calls[0][0]);
      if (input.country === "KR") {
        expect(url.pathname).toContain("/M/202404/202509/");
        expect(url.pathname).toContain(input.indicator === "cpi" ? "/901Y009/" : "/901Y027/");
        if (input.indicator === "unemployment") {
          expect(url.pathname).toMatch(/\/I61BC\/I28B$/);
        }
      } else {
        expect(url.searchParams.get("series_id")).toBe(
          input.indicator === "cpi" ? "CPIAUCSL" : "UNRATE"
        );
        expect(url.searchParams.get("observation_start")).toBe("2024-04-01");
        expect(url.searchParams.get("observation_end")).toBe("2025-09-01");
        expect(url.searchParams.get("units")).toBe("lin");
      }
    }
  );

  it("한국 CPI 지수와 변화율을 구분하고 원계열임을 표시한다", async () => {
    mockApi(krBody());
    const { data } = await execute(krInput);
    expect(data.latest).toEqual({
      month: "202509",
      value: 117.06,
      previousMonth: {
        month: "202508",
        value: 116.45,
        change: 0.52383
      },
      previousYear: {
        month: "202409",
        value: 114.65,
        change: 2.10205
      }
    });
    expect(data).toMatchObject({
      unit: "2020=100",
      changeUnit: "percent",
      seasonalAdjustment: "not_seasonally_adjusted"
    });
  });

  it("실업률 변화는 나눗셈이 아닌 %포인트 차이이다", async () => {
    mockApi(krBody("unemployment"));
    const { data } = await execute({
      ...krInput,
      indicator: "unemployment"
    });
    expect(data.latest).toEqual({
      month: "202509",
      value: 2.7,
      previousMonth: {
        month: "202508",
        value: 2.8,
        change: -0.1
      },
      previousYear: {
        month: "202409",
        value: 2.6,
        change: 0.1
      }
    });
    expect(data).toMatchObject({
      unit: "%",
      changeUnit: "percentage_points",
      seasonalAdjustment: "seasonally_adjusted"
    });
    expect(data.observations[1].previousMonth.change).toBe(0);
  });

  it("실업률 0은 유효하며 비교 기준이 0이어도 계산한다", async () => {
    mockApi(changeUs("202508", "0", "unemployment"));
    const { data } = await execute({
      ...usInput,
      indicator: "unemployment"
    });
    expect(data.latest.previousMonth).toEqual({
      month: "202508",
      value: 0,
      change: data.latest.value
    });
  });

  it("응답 순서와 관계없이 월 순으로 정렬한다", async () => {
    const body = krBody();
    body.StatisticSearch.row.reverse();
    mockApi(body);
    expect((await execute(krInput)).data.latest.month).toBe("202509");
  });
});

describe("최신 관측 월·기간·결측", () => {
  it.each(["KR", "US"] as const)("%s 최신값은 오늘이 아닌 실제 마지막 관측 월이다", async country => {
    mockApi(country === "KR" ? krBody() : usBody());
    const result = await execute({
      ...krInput,
      country,
      endMonth: null,
      months: 3
    });
    expect(result.data.period).toEqual({
      from: "202507",
      to: "202509",
      months: 3
    });
    expect(result.data.requestedEndMonth).toBeNull();
    expect(result.source).toMatchObject({
      asOf: "2025-09-01"
    });
  });

  it("최신 월 결측 기호를 건너뛰되 명시된 월은 대체하지 않는다", async () => {
    mockApi(changeUs("202509", "."));
    expect((await execute({
      ...usInput,
      endMonth: null,
      months: 3
    })).data.period.to).toBe("202508");
    await expect(execute(usInput)).rejects.toThrow("202509");
  });

  it("요청 구간 중간 결측을 건너뛰어 6개월처럼 표시하지 않는다", async () => {
    mockApi(changeKr("202507", {
      DATA_VALUE: ""
    }));
    await expect(execute(krInput)).rejects.toThrow("202507");
  });

  it("비교 월 결측은 null과 주의사항으로 전달한다", async () => {
    mockApi(changeUs("202409", "."));
    const result = await execute(usInput);
    expect(result.data.latest.previousYear).toEqual({
      month: "202409",
      value: null,
      change: null
    });
    expect(result.data.latest.previousMonth.change).not.toBeNull();
    expect(result.note).toContain("0으로 해석하지");
  });

  it("명시한 미공표 월을 이전 달로 대체하지 않는다", async () => {
    const body = krBody();
    body.StatisticSearch.row = body.StatisticSearch.row.filter(r => r.TIME >= "202405");
    body.StatisticSearch.list_total_count = body.StatisticSearch.row.length;
    mockApi(body);
    await expect(execute({
      ...krInput,
      endMonth: "202510"
    })).rejects.toThrow("202510");
  });

  it("최근 24개월에 관측값이 없으면 실패한다", async () => {
    vi.setSystemTime(new Date("2027-10-15T00:00:00+09:00"));
    const body = krBody();
    body.StatisticSearch.row = body.StatisticSearch.row.filter(r => r.TIME >= "202406");
    body.StatisticSearch.list_total_count = body.StatisticSearch.row.length;
    mockApi(body);
    await expect(execute({
      ...krInput,
      endMonth: null
    })).rejects.toThrow("최근 24개월");
  });

  it("서울 월 경계와 연도 경계를 기준으로 최신 조회 범위를 만든다", async () => {
    vi.setSystemTime(new Date("2025-12-31T16:00:00Z"));
    const calls = mockApi(usBody());
    await execute({
      ...usInput,
      endMonth: null
    });
    expect(new URL(calls.mock.calls[0][0]).searchParams.get("observation_end")).toBe(
      "2026-01-01"
    );
  });

  it("비교 월의 연도 경계를 올바르게 처리한다", async () => {
    const body = usBody();
    body.observations = body.observations.filter(r => r.date <= "2025-01-01");
    body.count = body.observations.length;
    mockApi(body);
    const { data } = await execute({
      ...usInput,
      endMonth: "202501",
      months: 1
    });
    expect(data.latest.previousMonth.month).toBe("202412");
    expect(data.latest.previousYear.month).toBe("202401");
    expect(data.latest.previousYear.value).toBeNull();
  });
});

describe("입력·응답 검증과 인증정보 보호", () => {
  it.each([
    {
      country: "JP"
    }, {
      indicator: "gdp"
    }, {
      endMonth: "202513"
    }, {
      endMonth: "202500"
    },
    {
      endMonth: "2025-09"
    }, {
      endMonth: "202509/0"
    }, {
      months: 0
    }, {
      months: 61
    }, {
      months: 1.5
    },
  ])("잘못된 입력 %j는 네트워크 전에 실패한다", async patch => {
    const calls = mockApi({});
    await expect(execute({
      ...krInput,
      ...patch
    } as Input)).rejects.toThrow();
    expect(calls).not.toHaveBeenCalled();
  });

  it("Agent 스키마는 nullable 종료 월을 포함한 모든 필드를 요구한다", () => {
    expect(parameters.safeParse({
      country: "KR",
      indicator: "cpi",
      months: 1
    }).success).toBe(false);
    expect(parameters.safeParse({
      ...krInput,
      endMonth: null
    }).success).toBe(true);
  });

  it.each(["202511", "190001"])("미래 월 또는 비교 범위 밖의 월 %s를 거부한다", async endMonth => {
    const calls = mockApi({});
    await expect(execute({
      ...krInput,
      endMonth
    })).rejects.toThrow();
    expect(calls).not.toHaveBeenCalled();
  });

  it.each(["KR", "US"] as const)("%s 키가 없으면 다른 소스로 대체하지 않는다", async country => {
    vi.stubEnv(country === "KR" ? "ECOS_API_KEY" : "FRED_API_KEY", " ");
    const calls = mockApi({});
    await expect(execute({
      ...krInput,
      country
    })).rejects.toThrow("API_KEY");
    expect(calls).not.toHaveBeenCalled();
  });

  it.each(["NaN", "Infinity", "12oops", "-1", "0"])("잘못된 CPI %s는 실패한다", async value => {
    mockApi(changeKr("202509", {
      DATA_VALUE: value
    }));
    await expect(execute(krInput)).rejects.toThrow();
  });

  it.each(["-1", "101"])("실업률 범위 밖의 값 %s는 실패한다", async value => {
    mockApi(changeUs("202509", value, "unemployment"));
    await expect(execute({
      ...usInput,
      indicator: "unemployment"
    })).rejects.toThrow();
  });

  it.each([
    {
      STAT_CODE: "wrong"
    }, {
      ITEM_CODE1: "wrong"
    }, {
      UNIT_NAME: "2015=100"
    }, {
      TIME: "202510"
    },
  ])("잘못된 ECOS 메타데이터 %j를 거부한다", async changes => {
    mockApi(changeKr("202509", changes));
    await expect(execute(krInput)).rejects.toThrow();
  });

  it("실업률의 계절조정 항목이 다르면 거부한다", async () => {
    mockApi(changeKr("202509", {
      ITEM_CODE2: "wrong"
    }, "unemployment"));
    await expect(execute({
      ...krInput,
      indicator: "unemployment"
    })).rejects.toThrow("항목");
  });

  it("중복 관측 월을 거부한다", async () => {
    const body = usBody();
    body.observations.push(body.observations[0]);
    body.count++;
    mockApi(body);
    await expect(execute(usInput)).rejects.toThrow("중복");
  });

  it.each(["KR", "US"] as const)("%s 잘린 페이지를 정상 결과로 처리하지 않는다", async country => {
    const body = country === "KR" ? krBody() : usBody();
    if ("StatisticSearch" in body) {
      body.StatisticSearch.list_total_count++;
    }
    else {
      body.count++;
    }
    mockApi(body);
    await expect(execute({
      ...krInput,
      country
    })).rejects.toThrow("잘렸거나");
  });

  it.each([{}, {
    count: 0,
    observations: []
  }])("비정상·빈 응답 %j는 실패한다", async body => {
    mockApi(body);
    await expect(execute(usInput)).rejects.toThrow();
  });

  it.each([403, 429, 503])("HTTP %s 실패 시 재시도 없이 키를 지운다", async status => {
    vi.stubEnv("ECOS_API_KEY", "secret/key+value");
    const calls = mockApi({
      error: "secret/key+value secret%2Fkey%2Bvalue"
    }, status);
    const error = await execute(krInput).catch(e => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(String(status));
    expect((error as Error).stack).not.toContain("secret");
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it.each(["KR", "US"] as const)("%s HTTP 200 업무 오류에서도 키를 지운다", async country => {
    mockApi(country === "KR"
      ? {
        RESULT: {
          CODE: "INFO-200",
          MESSAGE: "ecos-test-key 데이터 없음"
        }
      }

      : {
        error_code: 400,
        error_message: "fred-test-key invalid"
      });
    const error = await execute({
      ...krInput,
      country
    }).catch(e => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).stack).not.toContain("test-key");
  });

  it("네트워크 타임아웃을 성공으로 바꾸지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"))
    );
    await expect(execute(krInput)).rejects.toThrow("timed out");
  });

  it("defineTool 호출은 성공 결과의 출처와 실행 기록을 수집한다", async () => {
    mockApi(krBody());
    const context = new ResearchContext();
    await macroTool.invoke(new RunContext(context), JSON.stringify(krInput));
    expect(context.steps).toMatchObject([{
      tool: "get_macro_indicators",
      status: "ok"
    }]);
    expect(context.sources).toHaveLength(1);
  });
});
