/** 한국·미국 CPI / 실업률의 월별 관측값과 전월·전년 동월 변화를 반환한다. */
import { z } from "zod";
import { fetchJson } from "../../lib/http";
import { defineTool } from "../define";
import type { ToolResult } from "../types";

// 입력 규격: 국가·지표·종료 월·조회 개월 수
const monthSchema = z.string().regex(/^(19|20)\d{2}(0[1-9]|1[0-2])$/, "월은 YYYYMM 형식이어야 합니다.");

export const parameters = z.object({
  country: z.enum(["KR", "US"]).describe("KR 한국, US 미국. 다른 국가는 지원하지 않음"),
  indicator: z.enum(["cpi", "unemployment"]).describe("cpi 소비자물가지수, unemployment 실업률"),
  endMonth: monthSchema.nullable().describe("종료 월 YYYYMM. null이면 실제 최신 관측 월 조회"),
  months: z.number().int().min(1).max(60).describe("연속 월 수. 최신값 1, 요즘 3, 최근 흐름 6. 명시된 사용자 기간 우선"),
});

export type Input = z.infer<typeof parameters>;

type Series = {
  name: string;
  code: string;
  items: string[];
  unit: string;
  seasonalAdjustment: "seasonally_adjusted" | "not_seasonally_adjusted";
};

// 국가별 소스와 지표 정의
const SERIES: Record<Input["country"], Record<Input["indicator"], Series>> = {
  KR: {
    cpi: {
      name: "소비자물가지수 총지수",
      code: "901Y009",
      items: ["0"],
      unit: "2020=100",
      seasonalAdjustment: "not_seasonally_adjusted"
    },
    unemployment: {
      name: "실업률",
      code: "901Y027",
      items: ["I61BC", "I28B"],
      unit: "%",
      seasonalAdjustment: "seasonally_adjusted"
    },
  },
  US: {
    cpi: {
      name: "소비자물가지수 총지수",
      code: "CPIAUCSL",
      items: [],
      unit: "1982-1984=100",
      seasonalAdjustment: "seasonally_adjusted"
    },
    unemployment: {
      name: "실업률",
      code: "UNRATE",
      items: [],
      unit: "%",
      seasonalAdjustment: "seasonally_adjusted"
    },
  },
};

const LATEST_LOOKBACK_MONTHS = 24;
const MAX_ROWS = 1000;

type Observation = {
  month: string;
  value: number | null;
};

type Comparison = {
  month: string;
  value: number | null;
  change: number | null;
};

export type Point = {
  month: string;
  value: number;
  previousMonth: Comparison;
  previousYear: Comparison;
};

export type MacroData = {
  country: Input["country"];
  indicator: Input["indicator"];
  indicatorName: string;
  seriesCode: string;
  frequency: "monthly";
  unit: string;
  seasonalAdjustment: Series["seasonalAdjustment"];
  changeUnit: "percent" | "percentage_points";
  changeFormula: string;
  requestedEndMonth: string | null;
  period: {
    from: string;
    to: string;
    months: number;
  };
  latest: Point;
  observations: Point[];
};

const ecosSchema = z.object({
  StatisticSearch: z.object({
    list_total_count: z.number().int().nonnegative(),
    row: z.array(z.object({
      STAT_CODE: z.string(),
      ITEM_CODE1: z.string(),
      ITEM_CODE2: z.string().nullable().optional(),
      ITEM_CODE3: z.string().nullable().optional(),
      ITEM_CODE4: z.string().nullable().optional(),
      TIME: monthSchema,
      UNIT_NAME: z.string().min(1),
      DATA_VALUE: z.string(),
    })),
  })
});

const fredSchema = z.object({
  count: z.number().int().nonnegative(),
  observations: z.array(z.object({
    date: z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])-01$/),
    value: z.string()
  })),
});

export async function execute(rawInput: Input): Promise<ToolResult<MacroData>> {
  const input = parameters.parse(rawInput);
  const today = currentMonth();
  const end = input.endMonth ?? today;
  if (end > today) {
    throw new Error("미래 월은 조회할 수 없습니다.");
  }
  const from = shiftMonth(
    end,
    -(input.months - 1 + 12 + (input.endMonth === null ? LATEST_LOOKBACK_MONTHS - 1 : 0))
  );
  if (!monthSchema.safeParse(from).success) {
    throw new Error("비교 기간을 포함한 조회 범위는 1900년 이후여야 합니다.");
  }
  const keyName = input.country === "KR" ? "ECOS_API_KEY" : "FRED_API_KEY";
  const key = process.env[keyName]?.trim();
  if (!key) {
    throw new Error(`.env.local에 ${keyName}를 입력해 주세요.`);
  }
  const series = SERIES[input.country][input.indicator];
  const rows = await fetchObservations(input, series, from, end, key);
  return toResult(input, series, rows, from, end, today);
}

async function fetchObservations(
  input: Input,
  series: Series,
  from: string,
  to: string,
  key: string
): Promise<Observation[]> {
  let url: string;
  if (input.country === "KR") {
    url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/${MAX_ROWS}/${series.code}/M/${from}/${to}/${series.items.join("/")}`;
  } else {
    const query = new URLSearchParams({
      series_id: series.code,
      api_key: key,
      file_type: "json",
      units: "lin",
      sort_order: "asc",
      observation_start: isoMonth(from),
      observation_end: isoMonth(to),
      limit: String(MAX_ROWS),
    });
    url = `https://api.stlouisfed.org/fred/series/observations?${query}`;
  }
  try {
    const raw = await fetchJson<unknown>(url);
    if (input.country === "KR") {
      const apiError = z.object({
        RESULT: z.object({
          CODE: z.string(),
          MESSAGE: z.string()
        })
      }).safeParse(raw);
      if (apiError.success) {
        throw new Error(`ECOS ${apiError.data.RESULT.CODE}: ${apiError.data.RESULT.MESSAGE}`);
      }
      const parsed = ecosSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("ECOS 응답 구조가 올바르지 않습니다.");
      }
      const { row, list_total_count: count } = parsed.data.StatisticSearch;
      if (count !== row.length) {
        throw new Error("ECOS 응답이 잘렸거나 관측값 수가 일치하지 않습니다.");
      }
      return row.map(r => {
        const items = [r.ITEM_CODE1, r.ITEM_CODE2, r.ITEM_CODE3, r.ITEM_CODE4].filter(
          v => v != null && v !== ""
        );
        if (r.STAT_CODE !== series.code || items.join("/") !== series.items.join("/")) {
          throw new Error("ECOS 요청과 다른 통계 또는 항목입니다.");
        }
        if (r.UNIT_NAME !== series.unit) {
          throw new Error("ECOS 단위 또는 기준연도가 지표 정의와 다릅니다.");
        }
        return {
          month: r.TIME,
          value: numericValue(r.DATA_VALUE, input.indicator)
        };
      });
    }
    const apiError = z.object({
      error_code: z.number(),
      error_message: z.string()
    }).safeParse(raw);
    if (apiError.success) {
      throw new Error(`FRED ${apiError.data.error_code}: ${apiError.data.error_message}`);
    }
    const parsed = fredSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("FRED 응답 구조가 올바르지 않습니다.");
    }
    if (parsed.data.count !== parsed.data.observations.length) {
      throw new Error("FRED 응답이 잘렸거나 관측값 수가 일치하지 않습니다.");
    }
    return parsed.data.observations.map(r => ({
      month: r.date.slice(0, 7).replace("-", ""),
      value: numericValue(r.value, input.indicator)
    }));
  } catch (error) {
    // ECOS는 경로에 키가 있다. HTTP/업무 오류 모두 키를 지운 새 Error로 다시 던진다.
    let message = error instanceof Error ? error.message : "API 요청 실패";
    const secrets = [
      encodeURIComponent(key),
      new URLSearchParams({ k: key }).toString().slice(2),
      key,
    ];

    for (const secret of secrets) {
      message = message.replaceAll(secret, "[REDACTED]");
    }
    throw new Error(message);
  }
}

/** 월별 자료를 공통 출력으로 변환한다. */
function toResult(
  input: Input,
  series: Series,
  rows: Observation[],
  from: string,
  end: string,
  today: string
): ToolResult<MacroData> {
  const values = new Map<string, number | null>();
  for (const row of rows) {
    if (row.month < from || row.month > end) {
      throw new Error("요청 범위 밖의 응답 월입니다.");
    }
    if (values.has(row.month)) {
      throw new Error(`중복 관측 월 ${row.month}입니다.`);
    }
    values.set(row.month, row.value);
  }
  const available = rows
    .filter(r => r.value !== null)
    .map(r => r.month)
    .sort();
  const last = input.endMonth ?? available.at(-1);
  if (!last || (input.endMonth === null && last < shiftMonth(today, -(LATEST_LOOKBACK_MONTHS - 1)))) {
    throw new Error("최근 24개월 안에 유효한 관측값이 없습니다. 종료 월을 지정해 조회하세요.");
  }
  function comparison(month: string, current: number): Comparison {
    const value = values.get(month) ?? null;
    const change = value === null
      ? null
      : input.indicator === "cpi"
        ? (current / value - 1) * 100
        : current - value;
    if (change !== null && !Number.isFinite(change)) {
      throw new Error("변화를 계산할 수 없습니다.");
    }
    return {
      month,
      value,
      change: change === null ? null : Math.round(change * 1e6) / 1e6 || 0
    };
  }
  const observations = Array.from({
    length: input.months
  }, (_, i): Point => {
    const month = shiftMonth(last, i - input.months + 1);
    const value = values.get(month);
    if (value == null) {
      throw new Error(`${month} 관측값이 없거나 결측입니다. 미공표 여부 또는 조회 기간을 확인하세요.`);
    }
    return {
      month,
      value,
      previousMonth: comparison(shiftMonth(month, -1), value),
      previousYear: comparison(shiftMonth(month, -12), value)
    };
  });
  const comparisonMissing = observations.some(
    p => p.previousMonth.value === null || p.previousYear.value === null
  );
  return {
    data: {
      country: input.country,
      indicator: input.indicator,
      indicatorName: series.name,
      seriesCode: [series.code, ...series.items].join("/"),
      frequency: "monthly",
      unit: series.unit,
      seasonalAdjustment: series.seasonalAdjustment,
      changeUnit: input.indicator === "cpi" ? "percent" : "percentage_points",
      changeFormula: input.indicator === "cpi"
        ? "(current / previous - 1) * 100"
        : "current - previous",
      requestedEndMonth: input.endMonth,
      period: {
        from: observations[0].month,
        to: last,
        months: input.months
      },
      latest: observations[observations.length - 1],
      observations,
    },
    source: {
      name: input.country === "KR"
        ? `한국은행 ECOS — ${series.name}`
        : `FRED / U.S. Bureau of Labor Statistics — ${series.code}`,
      url: input.country === "KR"
        ? "https://ecos.bok.or.kr/"
        : `https://fred.stlouisfed.org/series/${series.code}`,
      asOf: isoMonth(last),
    },
    note: "asOf는 마지막 관측 월의 첫날 표기이며 발표일·조회일이 아닙니다. 지표마다 최신 관측 월이 다를 수 있습니다. " +
      "자료 개정 및 반올림으로 공식 발표 변화와 차이가 날 수 있습니다. 변화는 소수점 6자리로 반올림합니다. " +
      (input.indicator === "cpi"
        ? "CPI는 가격 지수이며 변화의 단위는 %입니다. 한국은 원계열, 미국은 계절조정입니다. 국가별 기준연도와 조정 방식이 달라 지수 수준을 직접 비교하지 않습니다. 한국 전월 변화에는 계절성이 포함됩니다. "
        : "실업률 값은 %, 변화는 %포인트입니다. 한국·미국 모두 계절조정 계열이지만 조사 대상·정의가 다르므로 국가 간 단순 비교에 주의하세요. ") +
      (comparisonMissing
        ? "일부 비교 월 자료가 없어 해당 비교값과 변화는 null입니다. 0으로 해석하지 마세요. "
        : "") +
      "수치만으로 변화 원인을 단정하지 않습니다. 분기 집계와 투자 판단은 제공하지 않습니다.",
  };
}

// 날짜 변환과 숫자 검증

function shiftMonth(month: string, offset: number): string {
  const date = new Date(Date.UTC(
    Number(month.slice(0, 4)),
    Number(month.slice(4)) - 1 + offset,
    1
  ));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isoMonth(month: string): string {
  return `${month.slice(0, 4)}-${month.slice(4)}-01`;
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")!.value}${parts.find(p => p.type === "month")!.value}`;
}

/** 공식 결측 표기만 null로 구분하며 잘못된 숫자는 실패한다. */
function numericValue(raw: string, indicator: Input["indicator"]): number | null {
  const text = raw.trim();
  if (text === "" || text === ".") {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error("응답 숫자가 올바르지 않습니다.");
  }
  const value = Number(text);
  if (!Number.isFinite(value) || (indicator === "cpi" ? value <= 0 : value < 0 || value > 100)) {
    throw new Error("지표 값의 범위가 올바르지 않습니다.");
  }
  return value;
}

export const macroTool = defineTool({
  name: "get_macro_indicators",
  description:
    "한국(KR, ECOS)·미국(US, FRED)의 월별 CPI 또는 실업률과 전월·전년 동월 변화를 조회한다. " +
    "최신 물가·고용 또는 최근 추이를 물을 때 사용. endMonth null은 최근 24개월 안의 실제 최신 관측 월을 찾는다. " +
    "사용자가 명시한 기간을 우선하고, 기간이 없으면 최신값 months 1, '요즘' 3, '최근 흐름' 6을 선택한다. " +
    "최근 3개월은 달력 분기와 다르다. CPI 변화는 %, 실업률 변화는 %포인트. " +
    "두 지표나 두 국가가 필요하면 각각 호출하고 실제 관측 월·단위·계절조정을 밝혀 설명한다. " +
    "null 비교값은 추측하지 않는다. 다른 국가·GDP·분기 집계·원인 단정·투자 권유는 제공하지 않는다.",
  parameters,
  execute,
});
