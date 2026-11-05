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
 *
 * 후보 id 는 평가가 질문 id · 깊이 · 원인 번호로만 만들어서, 평가 파일이 여럿이면 같은 id 가 다른 주장 · 장부로 되풀이될 수 있습니다.
 * 그런 id 는 평문으로 가리키면 거부하고 "<파일>/<id>" (예: 2026-11-04-1753/fx-cause-1-easy-1) 로만 받습니다. 라벨이 다른 주장에 붙지 않게 하기 위해서입니다.
 */
import { readFileSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { Evidence } from "../../src/agent/schema";

export type Candidate = { id: string; area: string; claim: string; evidence: string; basis: "data" | "news"; refs: string[]; ledger: Evidence[]; expected: string | null; judged?: { verdict?: string; reason?: string } | null; source?: string };
export type Label = { expected: "supported" | "unsupported" | "contradicted"; note?: string; claim?: string; refs?: string[]; basis?: "data" | "news"; evidence?: string };
/** 후보 + 어느 평가 파일에서 왔는지 (파일 이름에서 .pairs.json 을 뗀 것) */
export type Loaded = Candidate & { file: string };

const KEYS = ["pair", "rate", "changePct", "changePp", "change", "asOf", "comparison.rate", "comparison.asOf", "comparisonRate", "comparisonDate", "title", "publishedAt", "indicator", "result", "op", "movePct", "typicalMovePct", "zScore", "level", "name", "latest.close", "latest.nav", "latest.premiumPct", "period.returnPct", "period.indexReturnPct", "period.trackingDiffPp", "latest.value", "latest.previousMonth.value", "latest.previousMonth.change", "latest.previousYear.change", "latest.yoy", "previousMonth.value", "previousMonth.yoy"];

function shortValues(ledger: Evidence[]): string[] {
  return ledger.map((e) => {
    const v = e.values;
    const picked = Object.fromEntries(Object.entries(v).filter(([k]) => KEYS.includes(k)));
    const shown = Object.keys(picked).length ? picked : Object.fromEntries(Object.entries(v).slice(0, 6));
    return `${e.id}[${e.tool}]: ${JSON.stringify(shown)}`;
  });
}

/** 후보 파일들을 읽습니다. 파일 이름(.pairs.json 을 뗀 것)이 후보의 이름 공간이라, 다른 폴더의 같은 이름 파일은 함께 읽지 않습니다 (키가 어느 쪽인지 알 수 없음). */
export function load(paths: string[]): Loaded[] {
  const seen = new Map<string, string>();
  return paths.flatMap((p) => {
    const file = basename(p).replace(/\.pairs\.json$/, "");
    const before = seen.get(file);
    if (before !== undefined) throw new Error(`같은 이름의 후보 파일이 둘입니다: ${before}, ${p}. 한 번에 하나만 쓰거나 이름을 바꾸세요`);
    seen.set(file, p);
    return (JSON.parse(readFileSync(p, "utf8")) as Candidate[]).map((c) => ({ ...c, file }));
  });
}

/** 여러 파일에 같은 id 로 있는 후보: id → 파일들 */
export function duplicateIds(cands: Loaded[]): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const c of cands) files.set(c.id, [...(files.get(c.id) ?? []), c.file]);
  return new Map([...files].filter(([, fs]) => fs.length > 1));
}

/** 라벨 키 "<id>" 또는 "<파일>/<id>" 로 후보를 찾습니다. 여러 파일에 있는 id 는 파일을 붙인 키로만 찾을 수 있습니다. */
export function findCandidate(key: string, cands: Loaded[]): { candidate: Loaded; namespaced: boolean } {
  const slash = key.lastIndexOf("/");
  if (slash >= 0) {
    const file = key.slice(0, slash);
    const id = key.slice(slash + 1);
    const hits = cands.filter((c) => c.file === file && c.id === id);
    if (hits.length === 0) throw new Error(`후보에 없는 키: ${key}`);
    if (hits.length > 1) throw new Error(`키 ${key} 에 해당하는 후보가 ${hits.length}개입니다. 같은 파일 안에 id 가 겹칩니다`);
    return { candidate: hits[0]!, namespaced: true };
  }
  const hits = cands.filter((c) => c.id === key);
  if (hits.length === 0) throw new Error(`후보에 없는 id: ${key}`);
  if (hits.length > 1) throw new Error(`id ${key} 가 여러 파일에 있습니다 (${hits.map((h) => h.file).join(", ")}). 라벨 키를 "<파일>/<id>" 로 쓰세요. 예: ${hits[0]!.file}/${key}`);
  return { candidate: hits[0]!, namespaced: false };
}

/** 라벨 파일 → pairs.json 모양의 쌍. 파일을 붙인 키로 찾은 후보는 쌍 id 에도 파일 이름이 붙어 서로 겹치지 않습니다. */
export function buildPairs(labels: Record<string, Label>, cands: Loaded[]) {
  return Object.entries(labels).map(([key, lab]) => {
    const [baseKey, variant] = key.split("#");
    const { candidate: c, namespaced } = findCandidate(baseKey!, cands);
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
      id: `${c.id}${namespaced ? `-${c.file}` : ""}${variant ? `-${variant}` : ""}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
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
}

function list(paths: string[]): void {
  const cands = load(paths);
  console.log(`후보 ${cands.length}개 (파일 ${paths.length}개)`);
  cands.forEach((c, i) => {
    console.log(`\n[${i}] ${c.id} (${c.file}) · ${c.area} · basis ${c.basis} · refs ${c.refs.join(",")} · 모델 ${c.judged?.verdict ?? "-"}`);
    console.log(`  주장: ${c.claim}`);
    if (c.judged?.reason) console.log(`  모델 이유: ${c.judged.reason.slice(0, 160)}`);
    for (const line of shortValues(c.ledger)) console.log(`  ${line.slice(0, 220)}`);
  });
  const dups = duplicateIds(cands);
  if (dups.size) {
    console.log(`\n⚠ 같은 id 가 여러 파일에 있습니다. 라벨 키를 "<파일>/<id>" 로 쓰세요:`);
    for (const [id, files] of dups) console.log(`  ${id}: ${files.map((f) => `${f}/${id}`).join(" · ")}`);
  }
}

function build(labelPath: string, paths: string[]): void {
  const labels = JSON.parse(readFileSync(labelPath, "utf8")) as Record<string, Label>;
  console.log(JSON.stringify(buildPairs(labels, load(paths)), null, 2));
}

const isMain = process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list" && rest.length) list(rest);
  else if (cmd === "build" && rest.length >= 2) build(rest[0]!, rest.slice(1));
  else {
    console.error("사용법: pnpm judge:draft list <후보.json> … | pnpm judge:draft build <라벨.json> <후보.json> …");
    process.exit(1);
  }
}
