/**
 * 근거 판정 보정 세트의 형식과 로더. 파일은 scripts/judge/pairs.json, 작성 방법은 같은 폴더의 README.md.
 * `pnpm judge` 와 테스트(pairs.test.ts)가 같은 스키마를 쓰므로, 형식이 틀리면 `pnpm test` 가 어디가 틀렸는지 알려 줍니다.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { judgeVerdicts } from "../../src/agent/judge";
import { areas, evidenceSchema } from "../../src/agent/schema";

/** 레포 루트에서 실행한다고 가정합니다 (pnpm judge, pnpm test). */
export const PAIRS_PATH = "scripts/judge/pairs.json";

/** 쌍 하나 = 원인 문장 하나 + 그 문장이 인용한 장부 항목 + 사람이 매긴 정답. */
export const pairSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)+$/, "소문자 · 숫자 · 하이픈만. 예: fx-direction-1"),
  area: z.enum(areas),
  /** 작성이 쓴 원인 문장 */
  claim: z.string().trim().min(2, "claim 은 2자 이상"),
  /** 작성이 적은 근거 설명. 판정은 이것이 아니라 ledger 로 합니다 */
  evidence: z.string().default(""),
  /** none 은 판정 대상이 아니라 보정 세트에 넣지 않습니다 */
  basis: z.enum(["data", "news"]),
  refs: z.array(z.string()).min(1, "refs 는 1개 이상"),
  /** refs 가 가리키는 장부 항목 (리포트 evidence 와 같은 모양) */
  ledger: z.array(evidenceSchema).min(1, "ledger 는 1개 이상"),
  /** 사람이 매긴 정답 */
  expected: z.enum(judgeVerdicts),
  /** 왜 그 정답인지 한 문장 */
  note: z.string().optional(),
  /** 어느 평가 결과에서 가져왔는지 (docs/eval/<파일>#<질문>) */
  source: z.string().optional(),
});
export type Pair = z.infer<typeof pairSchema>;

/** 파일 하나를 읽고 검사합니다. 틀리면 파일 이름과 위치가 담긴 Error 를 던집니다. */
export function loadPairs(path = PAIRS_PATH): Pair[] {
  if (!existsSync(path)) throw new Error(`${path}: 파일이 없습니다`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: JSON 이 아닙니다 (${err instanceof Error ? err.message : String(err)})`);
  }
  const parsed = z.array(pairSchema).min(1).safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(루트)"}: ${i.message}`).join("; ");
    throw new Error(`${path}: ${where}`);
  }
  const seen = new Set<string>();
  for (const pair of parsed.data) {
    if (seen.has(pair.id)) throw new Error(`${path}: id "${pair.id}" 가 중복입니다`);
    seen.add(pair.id);
    const ids = pair.ledger.map((e) => e.id);
    if (new Set(ids).size !== ids.length) throw new Error(`${path}: ${pair.id} 의 ledger 에 같은 id 가 두 번 있습니다`);
    const missing = pair.refs.filter((r) => !ids.includes(r));
    if (missing.length) throw new Error(`${path}: ${pair.id} 의 refs ${missing.join(", ")} 가 ledger 에 없습니다`);
  }
  return parsed.data;
}
