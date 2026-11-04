/**
 * /admin "상용 AI 상태" 패널의 데이터. 리더 관리.
 * OpenAI 상태 페이지(status.openai.com, incident.io)가 Statuspage 호환 JSON 을 키 없이 줍니다. 전체 상태 한 줄 · 구성 요소별 상태 · 진행 중 장애를 읽어
 * 우리가 쓰는 것(Responses · Agents · Chat Completions)과 Codex 만 고릅니다. 외부 페이지가 "정상" 이어도 우리 호출이 느릴 수 있어,
 * 화면에서는 runs 표의 최근 1시간 실측(src/lib/admin.ts 의 windowStats)과 나란히 둡니다 — 금융권이 벤더 상태와 자체 측정을 같이 보는 방식.
 */
import type { Health } from "./admin";

export const OPENAI_SUMMARY_URL = "https://status.openai.com/api/v2/summary.json";
/** 상태 페이지를 기다리는 시간. 넘기면 "읽지 못함" 으로 그리고 화면 나머지는 그대로 */
export const STATUS_TIMEOUT_MS = 4_000;
/** 상태 페이지의 구성 요소 이름 그대로. 우리가 쓰는 API 와, 리뷰 · 초안에 쓰는 Codex */
export const WATCHED_COMPONENTS = ["Responses", "Agents", "Chat Completions", "Codex in ChatGPT Desktop"] as const;

export type Indicator = "none" | "minor" | "major" | "critical" | "maintenance";
export type VendorComponent = { name: string; status: string };
export type VendorIncident = { name: string; impact: string; status: string; updatedAt: string; url?: string };
export type VendorStatus =
  | { ok: true; vendor: "OpenAI"; indicator: Indicator; description: string; components: VendorComponent[]; incidents: VendorIncident[]; updatedAt: string; fetchedAt: string; ms: number }
  | { ok: false; vendor: "OpenAI"; error: string; fetchedAt: string };

const indicators = new Set<Indicator>(["none", "minor", "major", "critical", "maintenance"]);

/** 전체 상태 → 상태등. none 정상, minor · maintenance 주의, major · critical 장애 */
export function healthOfIndicator(indicator: Indicator): Health {
  return indicator === "none" ? "ok" : indicator === "minor" || indicator === "maintenance" ? "warn" : "bad";
}

/** 구성 요소 상태 → 상태등 */
export function healthOfComponent(status: string): Health {
  if (status === "operational") return "ok";
  if (status === "degraded_performance" || status === "under_maintenance") return "warn";
  if (status === "partial_outage" || status === "major_outage") return "bad";
  return "idle";
}

export const componentStatusLabels: Record<string, string> = {
  operational: "정상",
  degraded_performance: "성능 저하",
  partial_outage: "일부 장애",
  major_outage: "장애",
  under_maintenance: "점검",
};
export const impactLabels: Record<string, string> = { none: "영향 없음", minor: "경미", major: "중대", critical: "심각", maintenance: "점검" };
export const incidentStatusLabels: Record<string, string> = { investigating: "조사 중", identified: "원인 파악", monitoring: "지켜보는 중", resolved: "해결", postmortem: "사후 분석" };

type Summary = {
  page?: { updated_at?: string };
  status?: { indicator?: string; description?: string };
  components?: { name?: string; status?: string }[];
  incidents?: { name?: string; impact?: string; status?: string; updated_at?: string; shortlink?: string }[];
};

/** 상태 페이지 JSON 에서 우리가 보는 것만 뽑습니다. 모양이 다르면 throw */
export function parseSummary(json: unknown): Pick<Extract<VendorStatus, { ok: true }>, "indicator" | "description" | "components" | "incidents" | "updatedAt"> {
  const s = json as Summary;
  const indicator = s?.status?.indicator;
  if (typeof indicator !== "string" || !indicators.has(indicator as Indicator)) throw new Error("상태 페이지 응답 모양이 다릅니다 (status.indicator 없음)");
  const all = Array.isArray(s.components) ? s.components : [];
  // 같은 이름이 둘 이상이면(Login 처럼) 첫 번째만. 우리가 보는 순서대로
  const components = WATCHED_COMPONENTS.flatMap((name) => {
    const c = all.find((x) => x?.name === name);
    return c && typeof c.status === "string" ? [{ name, status: c.status }] : [];
  });
  const incidents = (Array.isArray(s.incidents) ? s.incidents : []).flatMap((i) =>
    typeof i?.name === "string" ? [{ name: i.name, impact: i.impact ?? "none", status: i.status ?? "", updatedAt: i.updated_at ?? "", ...(i.shortlink ? { url: i.shortlink } : {}) }] : [],
  );
  return { indicator: indicator as Indicator, description: s.status?.description ?? "", components, incidents, updatedAt: s.page?.updated_at ?? "" };
}

/** OpenAI 상태를 읽습니다. 실패(시간 초과 · 모양 다름)해도 throw 하지 않고 ok: false 로 돌려줍니다 */
export async function loadVendorStatus(fetchImpl: typeof fetch = fetch, now = new Date()): Promise<VendorStatus> {
  const fetchedAt = now.toISOString();
  const t0 = Date.now();
  try {
    const res = await fetchImpl(OPENAI_SUMMARY_URL, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS), cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseSummary(await res.json());
    return { ok: true, vendor: "OpenAI", ...parsed, fetchedAt, ms: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? (err.name === "TimeoutError" ? `${STATUS_TIMEOUT_MS / 1000}초 안에 답하지 않음` : err.message) : String(err);
    return { ok: false, vendor: "OpenAI", error: message, fetchedAt };
  }
}

/** 장애 영향(impact) → 상태등. 모르는 값은 idle */
export function healthOfImpact(impact: string): Health {
  return indicators.has(impact as Indicator) ? healthOfIndicator(impact as Indicator) : "idle";
}

/**
 * 벤더 상태와 우리 실측을 합친 한 줄 판단. 벤더가 장애면 그것이 먼저고, 벤더가 정상이어도 우리 호출이 많이 실패하면 우리 쪽을 보라고 합니다.
 * 실측은 요청이 3건은 돼야 봅니다 (1~2건은 우연).
 */
export function vendorVerdict(vendor: VendorStatus, lastHour: { total: number; ok: number; avgMs: number | null }, slowMs = 45_000): { health: Health; text: string } {
  const enough = lastHour.total >= 3;
  const failing = enough && lastHour.ok / lastHour.total < 0.85;
  const slow = enough && lastHour.avgMs !== null && lastHour.avgMs > slowMs;
  if (vendor.ok && healthOfIndicator(vendor.indicator) === "bad") return { health: "bad", text: "OpenAI 장애 진행 중" };
  if (failing) return { health: "bad", text: vendor.ok && vendor.indicator === "none" ? "상태 페이지는 정상인데 우리 호출이 실패함 · 키 · 코드 확인" : "우리 호출 실패 많음" };
  if (vendor.ok && healthOfIndicator(vendor.indicator) === "warn") return { health: "warn", text: "OpenAI 일부 저하" };
  if (slow) return { health: "warn", text: "응답 느림" };
  if (!vendor.ok) return { health: enough ? "ok" : "idle", text: enough ? "상태 페이지는 못 읽었지만 우리 호출은 정상" : "상태 페이지를 못 읽음 · 실측 부족" };
  return { health: enough ? "ok" : "idle", text: enough ? "정상" : "정상 (최근 1시간 요청 적음)" };
}
