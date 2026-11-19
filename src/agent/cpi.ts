/**
 * 물가 원인 후보 (리더, 11/19). 환율의 원인 지도(movement.ts)처럼, 물가 질문에는 품목군별 등락률 · 기여도(get_macro_indicators cpi_categories)를
 * 작성에게 "원인 후보" 로 건넵니다. 기여도가 큰 품목군은 총지수 변화를 구성하는 요인이라 데이터 근거(basis data)로 쓸 수 있습니다.
 * 왜 그 품목군이 올랐는지(기후 · 환율 · 정책)는 이 자료로 알 수 없으므로 뉴스 근거가 있을 때만 덧붙이게 합니다.
 * 11/19 페르소나 테스트: 20명 중 11명이 "왜 올랐어" 에 원인 0개를 지적했고, 그중 물가가 가장 많았습니다.
 */
import { ledgerLine } from "./movement";
import type { Evidence } from "./schema";

/** why 에 쓰라고 권하는 품목군 수 (기여도 큰 순) */
export const TOP_CATEGORIES = 3;

/**
 * 질문이 묻는 비교 기준 (Codex 리뷰 2건 반영).
 *  1. "전월 대비 · 지난달보다" 처럼 비교를 명시한 말이 먼저입니다. "작년 10월 물가가 전월 대비 왜 올랐어?" 의 "작년" 은 관측 시점이지 비교 기준이 아닙니다.
 *  2. 명시한 비교가 없으면 "지난달 · 이번 달" 같은 달 낱말이 있을 때 전월 대비, 그 밖("최근 · 요즘 · 왜 올랐어")은 전년 같은 달 대비.
 */
export type CpiBasis = "yoy" | "mom";
const EXPLICIT_MOM = /(전월|전달|지난\s*달|저번\s*달|한\s*달\s*전)\s*(대비|보다|에\s*비해|과\s*비교|와\s*비교)/;
const EXPLICIT_YOY = /(전년\s*(동월|같은\s*달)?|작년\s*(같은\s*달|동월)?|지난\s*해|1\s*년\s*전)\s*(대비|보다|에\s*비해|과\s*비교|와\s*비교)/;
/** 등락률의 변화(둔화 · 가속 · 상승 폭 축소)를 묻는 질문인지. 품목군 기여도는 "지금 등락률의 구성" 이지 "등락률이 왜 바뀌었나" 의 근거가 아닙니다 (Codex 리뷰) */
export function isRateChangeQuestion(question: string): boolean {
  return /둔화|가속|상승\s*폭|오름\s*폭|하락\s*폭|(상승률|물가\s*상승률|인플레이션)[^.?!]{0,12}(낮아|높아|줄|늘|떨어|꺾|완화|진정)/.test(question);
}

export function cpiBasisFor(question: string): CpiBasis {
  if (EXPLICIT_MOM.test(question)) return "mom";
  if (EXPLICIT_YOY.test(question)) return "yoy";
  return /지난\s*달|전월|이번\s*달|한\s*달\s*전|저번\s*달|월간/.test(question) ? "mom" : "yoy";
}

const FIELDS = {
  yoy: { pct: "yoyPct", contribution: "contributionPp", sum: "contributionSumPp", label: "전년 같은 달 대비" },
  mom: { pct: "momPct", contribution: "momContributionPp", sum: "momContributionSumPp", label: "전월 대비" },
} as const;

/** 기준(전년 · 전월)에 맞는 기여도로, 총지수가 움직인 방향으로 많이 보탠 순 */
export function rankCategories(categories: Evidence[], basis: CpiBasis, total: Evidence | undefined): Evidence[] {
  const f = FIELDS[basis];
  const falling = Number(total?.values[f.pct] ?? 0) < 0;
  return categories
    .filter((e) => typeof e.values[f.contribution] === "number")
    .sort((a, b) => (falling ? 1 : -1) * (Number(a.values[f.contribution]) - Number(b.values[f.contribution])));
}

/**
 * 품목군 장부 항목. 한 번의 tool 호출(같은 E 번호 앞부분, E2-1 · E2-2 …)이 한 묶음이고, 묶음이 여럿이면(다른 월 · 같은 월 중복 조회)
 * 관측 월이 가장 최근인 묶음, 같으면 나중 호출을 씁니다 (Codex 리뷰). total 은 총지수 항목, categories 는 총지수가 움직인 방향으로 기여도가 큰 순
 * (총지수가 내렸으면 가장 많이 끌어내린 품목군부터).
 */
export function cpiCategoryEntries(evidence: Evidence[]): { total?: Evidence; categories: Evidence[] } {
  const entries = evidence.filter((e) => e.values.indicator === "cpi_categories");
  const groups = new Map<string, Evidence[]>();
  for (const e of entries) {
    const call = e.id.split("-")[0]!;
    groups.set(call, [...(groups.get(call) ?? []), e]);
  }
  const monthOf = (group: Evidence[]) => String(group.find((e) => e.values.category === "총지수")?.values.month ?? group[0]?.values.month ?? "");
  const picked = [...groups.values()].reduce<Evidence[] | undefined>((best, group) => (!best || monthOf(group) >= monthOf(best) ? group : best), undefined) ?? [];
  const total = picked.find((e) => e.values.category === "총지수");
  const falling = Number(total?.values.yoyPct ?? 0) < 0;
  const categories = picked
    .filter((e) => e !== total && typeof e.values.contributionPp === "number")
    .sort((a, b) => (falling ? 1 : -1) * (Number(a.values.contributionPp) - Number(b.values.contributionPp)));
  return { total, categories };
}

/** 정제가 뺐더라도 원인 후보로 다시 보는 품목군 항목 id (droppedNote 의 "쓰지 않은 자료" 에서 뺍니다) */
export function cpiRescuedRefs(evidence: Evidence[], dropped: Set<string>): Set<string> {
  const { total, categories } = cpiCategoryEntries(evidence);
  return new Set([total, ...categories].filter((e): e is Evidence => !!e && dropped.has(e.id)).map((e) => e.id));
}

const signed = (v: unknown, unit: string) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}${unit}`;

/**
 * 작성 입력에 덧붙이는 [물가 원인 후보]. 품목군 자료가 없으면 빈 문자열. shown 은 작성이 보는 사실 목록의 id (null 이면 장부 전체).
 * 질문이 전월 대비를 물으면 전월 기여도, 아니면 전년 같은 달 대비 기여도를 기준으로 삼습니다 (Codex 리뷰: 전월 질문에 전년 기여도를 원인으로 쓰지 않게).
 */
export function cpiCauseNote(evidence: Evidence[], shown: Set<string> | null, question = ""): string {
  const { total, categories: byYear } = cpiCategoryEntries(evidence);
  if (byYear.length === 0) return "";
  const basis = cpiBasisFor(question);
  const f = FIELDS[basis];
  const categories = rankCategories(byYear, basis, total);
  if (categories.length === 0) return "";
  const month = String(categories[0]!.values.month ?? "");
  const monthText = /^\d{6}$/.test(month) ? `${month.slice(0, 4)}년 ${Number(month.slice(4))}월` : month;
  const falling = Number(total?.values[f.pct] ?? 0) < 0;
  const move = falling ? "하락" : "상승";
  const word = (v: unknown) => (Number(v) < 0 ? "내렸" : "올랐");
  const totalText = total
    ? `전년 같은 달보다 ${signed(total.values.yoyPct, "%")} ${word(total.values.yoyPct)}고, 전월보다 ${signed(total.values.momPct, "%")} ${word(total.values.momPct)}습니다 (${total.id})`
    : "움직였습니다";
  const lines = [
    `[물가 원인 후보] 소비자물가 총지수는 ${monthText} 기준 ${totalText}. 이 질문은 ${f.label} 기준으로 답합니다. 그 기준의 품목군별 기여도(가중치 ÷ 1000 × 등락률, 근사)를 총지수 ${move}에 많이 보탠 순서로 적었습니다.`,
    ...categories.slice(0, TOP_CATEGORIES).map((e) => `- ${e.values.category}: ${f.label} ${signed(e.values[f.pct], "%")} · 기여 ${signed(e.values[f.contribution], "%p")} · 가중치 ${e.values.weight} (${e.id})`),
  ];
  const rest = categories.slice(TOP_CATEGORIES);
  if (rest.length) lines.push(`- 나머지 ${rest.length}개 품목군: ${rest.map((e) => `${e.values.category} ${signed(e.values[f.contribution], "%p")} (${e.id})`).join(", ")}`);
  if (total && typeof total.values[f.sum] === "number") lines.push(`- 12개 기여도 합 ${signed(total.values[f.sum], "%p")} (총지수 등락률과의 차이는 근사 오차)`);
  if (isRateChangeQuestion(question)) {
    // 둔화 · 가속 질문: 지금 등락률의 구성만 말하고, 등락률이 왜 바뀌었는지는 모른다고 적게 합니다
    lines.push(
      "규칙:",
      "- 이 질문은 등락률이 왜 바뀌었는지(둔화 · 가속)를 묻습니다. 위 기여도는 지금 등락률을 구성하는 품목군이지, 등락률 변화의 원인이 아닙니다 (기여도가 가장 커도 그 기여가 줄었을 수 있음).",
      `- why 에는 위 품목군을 "지금 ${move}을 구성하는 요인" 으로만 쓰고(basis data, refs), 둔화 · 가속의 원인이라고 쓰지 않습니다. 둔화 · 가속 원인은 품목군별 기여도 변화 자료가 없어 확인할 수 없다고 dataGaps 에 적습니다.`,
      "- 뉴스 장부가 둔화 · 가속 배경을 말할 때만 news 근거로 덧붙이고, 제목에 없는 원인은 추정하지 않습니다.",
      "- caveats 에 \"품목군 기여도는 가중치 × 등락률의 근사치로 통계청 공식 기여도와 소수점 차이가 날 수 있음\" 을 한 줄 적습니다.",
    );
    const unseenRate = shown ? [total, ...categories].filter((e): e is Evidence => !!e && !shown.has(e.id)) : [];
    if (unseenRate.length) lines.push("", "[덧붙인 장부 항목] 정제가 사실 목록에 넣지 않은 품목군 항목입니다. 원인 후보의 숫자는 이 값을 씁니다.", ...unseenRate.map(ledgerLine));
    return lines.join("\n");
  }
  lines.push(
    "규칙:",
    `- why 에 위 상위 ${TOP_CATEGORIES}개 안의 품목군을 "데이터" 근거(basis data, refs 에 그 id)로 씁니다. 등락률 · 기여도 숫자는 장부 값 그대로 쓰고, 그 품목군이 총지수 ${move}의 얼마를 차지했는지로 설명합니다.`,
    `- 두 기준(전년 같은 달 · 전월)을 섞지 않고, 문장에 어느 기준인지 적습니다. 장부의 다른 기준 값(${basis === "yoy" ? "momPct · momContributionPp" : "yoyPct · contributionPp"})은 이 질문의 원인으로 쓰지 않습니다.`,
    `- 총지수와 반대로 움직인 품목군은 ${move} 원인이 아니라 "상쇄한 요인" 으로만 적습니다. 등락률이 커도 기여도가 작은 품목군은 원인으로 올리지 않습니다 (가중치가 작음).`,
    "- 품목군 가격이 왜 올랐는지(기후 · 환율 · 정책 등)는 이 자료로 알 수 없습니다. 뉴스 장부가 같은 품목을 말할 때만 news 근거로 덧붙이고, 제목에 없는 원인은 추정하지 않습니다.",
    "- caveats 에 \"품목군 기여도는 가중치 × 등락률의 근사치로 통계청 공식 기여도와 소수점 차이가 날 수 있음\" 을 한 줄 적습니다.",
    "- 품목군 자료가 있으면 why 를 비우지 않습니다.",
  );
  const unseen = shown ? [total, ...categories].filter((e): e is Evidence => !!e && !shown.has(e.id)) : [];
  if (unseen.length) lines.push("", "[덧붙인 장부 항목] 정제가 사실 목록에 넣지 않은 품목군 항목입니다. 원인 후보의 숫자는 이 값을 씁니다.", ...unseen.map(ledgerLine));
  return lines.join("\n");
}
