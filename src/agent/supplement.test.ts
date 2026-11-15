import { describe, expect, it, vi } from "vitest";
import { ResearchContext } from "./context";
import type { Evidence } from "./schema";
import { ensureOtherPairs, type InvokableTool } from "./supplement";

const usd: Evidence = {
  id: "E1",
  tool: "get_fx_krw_rate",
  label: "환율 확인 · Frankfurter v2",
  values: { pair: "USD/KRW", unit: "KRW per 1 USD", rate: 1335.29, asOf: "2026-11-15", "comparison.rate": 1413.2, "comparison.asOf": "2026-08-17", change: -77.91, changePct: -5.51 },
  source: { name: "Frankfurter v2", url: "https://api.frankfurter.dev/v2/rates", asOf: "2026-11-15" },
};
const fxTool = (invoke = vi.fn(async () => "ok")): InvokableTool & { invoke: ReturnType<typeof vi.fn> } => ({ name: "get_fx_krw_rate", invoke });

describe("ensureOtherPairs: 환율 원인 질문의 다른 통화를 코드가 채운다", () => {
  it("장부에 없는 통화만 같은 days 로 환율 tool 을 부른다 (조사와 같은 래퍼라 장부 · step 에 남음)", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([usd]);
    const tool = fxTool();
    const missing = await ensureOtherPairs(ctx, "최근 90일간 환율이 왜 움직였어?", "fx", [tool]);
    expect(missing).toEqual([{ currency: "EUR", days: 90 }, { currency: "JPY", days: 90 }]);
    expect(tool.invoke).toHaveBeenCalledTimes(2);
    expect(tool.invoke.mock.calls.map((c) => c[1])).toEqual(['{"currency":"EUR","days":90}', '{"currency":"JPY","days":90}']);
    // 래퍼에 넘기는 실행 문맥은 같은 장부를 가리킨다
    expect(tool.invoke.mock.calls[0]![0].context).toBe(ctx);
  });

  it("환율 tool 이 없거나, 잴 대상이 없거나, 이미 다 있으면 아무것도 부르지 않는다", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([usd]);
    expect(await ensureOtherPairs(ctx, "최근 90일간 환율이 왜 움직였어?", "fx", [{ name: "get_rate_data", invoke: vi.fn() }])).toEqual([]);
    expect(await ensureOtherPairs(new ResearchContext(), "최근 90일간 환율이 왜 움직였어?", "fx", [fxTool()])).toEqual([]);
    const full = new ResearchContext();
    full.addEvidence([usd, { ...usd, id: "E2", values: { ...usd.values, pair: "EUR/KRW" } }, { ...usd, id: "E3", values: { ...usd.values, pair: "JPY(100)/KRW" } }]);
    const tool = fxTool();
    expect(await ensureOtherPairs(full, "최근 90일간 환율이 왜 움직였어?", "fx", [tool])).toEqual([]);
    expect(tool.invoke).not.toHaveBeenCalled();
  });

  it("tool 호출이 실패해도 throw 하지 않는다 (래퍼가 error step 을 남기고 리포트는 이어짐)", async () => {
    const ctx = new ResearchContext();
    ctx.addEvidence([usd]);
    const tool = fxTool(vi.fn(async () => { throw new Error("Frankfurter 503"); }));
    await expect(ensureOtherPairs(ctx, "환율이 왜 움직여?", "fx", [tool])).resolves.toHaveLength(2);
  });
});
