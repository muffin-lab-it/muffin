/**
 * 근거 판정 보정 세트 초안 도구 (리더). 평가가 남긴 후보(docs/eval/<stamp>.pairs.json)를 읽기 쉽게 찍고, 사람이 매긴 라벨 파일을
 * pairs.json 모양의 쌍으로 만듭니다. 11/5 에 98쌍을 만들 때 쓴 흐름입니다 (README "쌍 모으기").
 *
 *   pnpm judge:draft list docs/eval/2026-11-04-1753.pairs.json [더 많은 후보 파일]
 *       → 후보마다 번호 · 영역 · 모델 판정 · 주장 · 장부 핵심값. 이걸 보고 라벨 파일을 씁니다.
 *   pnpm judge:draft build labels.json docs/eval/2026-11-04-1753.pairs.json [...] > new-pairs.json
 *       labels.json: { "<후보 id>": { "expected": "supported|unsupported|contradicted", "note": "이유" }, ... }
 *       변형(같은 장부에 주장만 바꿈): { "<후보 id>#flip": { "claim": "바꾼 주장", "expected": "contradicted", "note": "…", "refs": ["E1"], "basis": "data" } }
 *       refs 를 주면 그 항목만 남기고, basis 를 주면 바꿉니다. 결과는 pairs.json 에 이어 붙이고 `pnpm test` 로 형식을 검사합니다.
 */
import { readFileSync } from "node:fs";
import type { Evidence } from "../../src/agent/schema";

type Candidate = { id: string; area: string; claim: string; evidence: string; basis: "data" | "news"; refs: string[]; ledger: Evidence[]; expected: string | null; judged?: { verdict?: string; reason?: string } | null; source?: string };
type Label = { expected: "supported" | "unsupported" | "contradicted"; note?: string; claim?: string; refs?: string[]; basis?: "data" | "news"; evidence?: string };

const KEYS = ["pair", "rate", "changePct", "changePp", "change", "asOf", "comparison.rate", "comparison.asOf", "comparisonRate", "comparisonDate", "title", "publishedAt", "indicator", "result", "op", "movePct", "typicalMovePct", "zScore", "level", "name", "latest.close", "latest.nav", "latest.premiumPct", "period.returnPct", "period.indexReturnPct", "period.trackingDiffPp", "latest.value", "latest.yoy", "previousMonth.value", "previousMonth.yoy"];

function shortValues(ledger: Evidence[]): string[] {
  return ledger.map((e) => {
    const v = e.values;
    const picked = Object.fromEntries(Object.entries(v).filter(([k]) => KEYS.includes(k)));
    const shown = Object.keys(picked).length ? picked : Object.fromEntries(Object.entries(v).slice(0, 6));
    return `${e.id}[${e.tool}]: ${JSON.stringify(shown)}`;
  });
}

function load(paths: string[]): Candidate[] {
  return paths.flatMap((p) => JSON.parse(readFileSync(p, "utf8")) as Candidate[]);
}

function list(paths: string[]): void {
  const cands = load(paths);
  console.log(`후보 ${cands.length}개`);
  cands.forEach((c, i) => {
    console.log(`\n[${i}] ${c.id} · ${c.area} · basis ${c.basis} · refs ${c.refs.join(",")} · 모델 ${c.judged?.verdict ?? "-"}`);
    console.log(`  주장: ${c.claim}`);
    if (c.judged?.reason) console.log(`  모델 이유: ${c.judged.reason.slice(0, 160)}`);
    for (const line of shortValues(c.ledger)) console.log(`  ${line.slice(0, 220)}`);
  });
}

function build(labelPath: string, paths: string[]): void {
  const labels = JSON.parse(readFileSync(labelPath, "utf8")) as Record<string, Label>;
  const cands = new Map(load(paths).map((c) => [c.id, c]));
  const pairs = Object.entries(labels).map(([key, lab]) => {
    const [baseId, variant] = key.split("#");
    const c = cands.get(baseId!);
    if (!c) throw new Error(`후보에 없는 id: ${baseId}`);
    let ledger = c.ledger;
    let refs = c.refs;
    let evidence = c.evidence;
    if (lab.refs) {
      refs = lab.refs;
      ledger = c.ledger.filter((e) => refs.includes(e.id));
      const missing = refs.filter((r) => !ledger.some((e) => e.id === r));
      if (missing.length) throw new Error(`${key}: refs ${missing.join(", ")} 가 장부에 없습니다`);
      evidence = lab.evidence ?? "";
    }
    return {
      id: `${baseId}${variant ? `-${variant}` : ""}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      area: c.area,
      claim: lab.claim ?? c.claim,
      evidence,
      basis: lab.basis ?? c.basis,
      refs,
      ledger,
      expected: lab.expected,
      note: lab.note ?? "",
      source: `${c.source ?? ""}${variant ? ` · 변형(${variant}): 주장만 바꿈, 장부는 실제 응답 그대로` : ""}`,
    };
  });
  console.log(JSON.stringify(pairs, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "list") list(rest);
else if (cmd === "build") build(rest[0]!, rest.slice(1));
else {
  console.error("사용법: pnpm judge:draft list <후보.json> … | pnpm judge:draft build <라벨.json> <후보.json> …");
  process.exit(1);
}
