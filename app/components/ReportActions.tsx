"use client";
import { useState } from "react";
import { getReport, saveReport, type ReportRecord } from "@/src/lib/history";
import type { Report } from "@/src/agent/schema";
import type { ToolStep } from "@/src/agent/context";

export function ReportActions({ report, input, steps = [], savedId }: { report: Report; input: ReportRecord["input"]; steps?: ToolStep[]; savedId?: string }) {
  const [saved, setSaved] = useState(savedId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function keep() {
    setBusy(true);
    try {
      const record = await saveReport(input, report, steps, saved);
      if (!await getReport(record.id)) throw new Error("저장 확인 실패");
      setSaved(record.id);
      setMessage("보관함에 저장했어요.");
    } catch { setMessage("보관하지 못했어요. 브라우저 저장 공간을 확인하고 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <><button type="button" disabled={busy || !!saved} onClick={() => void keep()}>{saved ? "보관했어요 ✓" : busy ? "보관하는 중…" : "보관하기"}</button><button type="button" onClick={() => window.print()}>PDF로 담기</button>{message && <p role="status">{message}</p>}</>;
}
