import { describe, expect, it, vi } from "vitest";
import { componentStatusLabels, healthOfComponent, healthOfImpact, healthOfIndicator, loadVendorStatus, parseSummary, STATUS_TIMEOUT_MS, vendorVerdict, WATCHED_COMPONENTS, type VendorStatus } from "./admin-status";

const summary = {
  page: { id: "x", name: "OpenAI", updated_at: "2026-11-04T12:00:00Z" },
  status: { indicator: "minor", description: "Partially Degraded Service" },
  components: [
    { name: "Chat Completions", status: "operational" },
    { name: "Responses", status: "degraded_performance" },
    { name: "Login", status: "operational" },
    { name: "Agents", status: "operational" },
    { name: "Login", status: "major_outage" },
    { name: "Codex in ChatGPT Desktop", status: "operational" },
    { name: "Images", status: "operational" },
  ],
  incidents: [{ name: "Elevated errors on Responses", impact: "minor", status: "monitoring", updated_at: "2026-11-04T11:50:00Z", shortlink: "https://stspg.io/abc" }],
};

describe("OpenAI 상태 페이지 읽기", () => {
  it("우리가 보는 구성 요소만 정한 순서로 고르고, 같은 이름은 첫 번째만, 장애 목록을 함께 낸다", () => {
    const p = parseSummary(summary);
    expect(p.indicator).toBe("minor");
    expect(p.description).toBe("Partially Degraded Service");
    expect(p.components).toEqual([
      { name: "Responses", status: "degraded_performance" },
      { name: "Agents", status: "operational" },
      { name: "Chat Completions", status: "operational" },
      { name: "Codex in ChatGPT Desktop", status: "operational" },
    ]);
    expect(p.incidents).toEqual([{ name: "Elevated errors on Responses", impact: "minor", status: "monitoring", updatedAt: "2026-11-04T11:50:00Z", url: "https://stspg.io/abc" }]);
    expect(p.updatedAt).toBe("2026-11-04T12:00:00Z");
    expect(WATCHED_COMPONENTS).toHaveLength(4);
  });

  it("모양이 다르면 throw 하고, 없는 구성 요소는 빼며, 상태등은 정한 대로 매긴다", () => {
    expect(() => parseSummary({ page: {} })).toThrow("status.indicator");
    expect(parseSummary({ status: { indicator: "none" } })).toEqual({ indicator: "none", description: "", components: [], incidents: [], updatedAt: "" });
    expect(healthOfIndicator("none")).toBe("ok");
    expect(healthOfIndicator("minor")).toBe("warn");
    expect(healthOfIndicator("maintenance")).toBe("warn");
    expect(healthOfIndicator("major")).toBe("bad");
    expect(healthOfIndicator("critical")).toBe("bad");
    expect(healthOfComponent("operational")).toBe("ok");
    expect(healthOfComponent("degraded_performance")).toBe("warn");
    expect(healthOfComponent("major_outage")).toBe("bad");
    expect(healthOfComponent("whatever")).toBe("idle");
    expect(componentStatusLabels.partial_outage).toBe("일부 장애");
  });

  it("종합 판단: 벤더 장애가 먼저, 벤더 정상인데 우리 실패가 많으면 우리 쪽, 요청이 적으면 판단 보류", () => {
    const base = { ok: true as const, vendor: "OpenAI" as const, description: "", components: [], incidents: [], updatedAt: "", fetchedAt: "", ms: 10 };
    const good: VendorStatus = { ...base, indicator: "none" };
    const down: VendorStatus = { ...base, indicator: "major" };
    const degraded: VendorStatus = { ...base, indicator: "minor" };
    const unread: VendorStatus = { ok: false, vendor: "OpenAI", error: "x", fetchedAt: "" };
    expect(vendorVerdict(down, { total: 10, ok: 10, avgMs: 20_000 })).toEqual({ health: "bad", text: "OpenAI 장애 진행 중" });
    expect(vendorVerdict(good, { total: 10, ok: 5, avgMs: 20_000 }).health).toBe("bad");
    expect(vendorVerdict(good, { total: 10, ok: 5, avgMs: 20_000 }).text).toContain("우리 호출이 실패함");
    expect(vendorVerdict(degraded, { total: 10, ok: 10, avgMs: 20_000 })).toEqual({ health: "warn", text: "OpenAI 일부 저하" });
    expect(vendorVerdict(good, { total: 10, ok: 10, avgMs: 50_000 })).toEqual({ health: "warn", text: "응답 느림" });
    expect(vendorVerdict(good, { total: 10, ok: 10, avgMs: 20_000 })).toEqual({ health: "ok", text: "정상" });
    expect(vendorVerdict(good, { total: 2, ok: 1, avgMs: 20_000 }).health).toBe("idle");
    expect(vendorVerdict(unread, { total: 10, ok: 10, avgMs: 20_000 }).health).toBe("ok");
    expect(vendorVerdict(unread, { total: 0, ok: 0, avgMs: null }).health).toBe("idle");
    expect(healthOfImpact("critical")).toBe("bad");
    expect(healthOfImpact("weird")).toBe("idle");
  });

  it("loadVendorStatus 는 읽으면 ok: true, 시간 초과 · HTTP 오류 · 모양 오류면 ok: false 로 돌려주고 throw 하지 않는다", async () => {
    const calls: unknown[][] = [];
    const good = vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return new Response(JSON.stringify(summary), { status: 200 });
    });
    const got = await loadVendorStatus(good as unknown as typeof fetch, new Date("2026-11-04T12:30:00Z"));
    expect(got).toMatchObject({ ok: true, vendor: "OpenAI", indicator: "minor", fetchedAt: "2026-11-04T12:30:00.000Z" });
    expect(calls[0]?.[1]).toMatchObject({ cache: "no-store" });

    const http = vi.fn(async () => new Response("busy", { status: 503 }));
    expect(await loadVendorStatus(http as unknown as typeof fetch)).toMatchObject({ ok: false, error: "HTTP 503" });

    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    expect(await loadVendorStatus(timeout as unknown as typeof fetch)).toMatchObject({ ok: false, error: `${STATUS_TIMEOUT_MS / 1000}초 안에 답하지 않음` });

    const shape = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await loadVendorStatus(shape as unknown as typeof fetch)).toMatchObject({ ok: false });
  });
});
