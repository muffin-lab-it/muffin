/**
 * 고정 질문 세트의 형식과 로더. 파일은 scripts/questions/<세트>.json, 작성 방법은 같은 폴더의 README.md.
 * eval 스크립트와 테스트(questions.test.ts)가 같은 스키마를 쓰므로, 형식이 틀리면 `pnpm test` 가
 * 어느 파일의 어디가 틀렸는지 알려 줍니다. 팀원은 자기 영역 파일만 고치면 됩니다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { areas, depths, intents } from "../../src/agent/schema";

/** 레포 루트에서 실행한다고 가정합니다 (pnpm eval, pnpm test). */
export const QUESTIONS_DIR = "scripts/questions";

/** 세트 이름 = 파일 이름. 영역 세트는 그 tool 담당자, common 은 리더, decision 은 권유 유도 질문. */
export const setNames = [...areas, "common", "decision"] as const;

export const questionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)+$/, "소문자 · 숫자 · 하이픈만. 예: fx-status-1"),
  question: z.string().trim().min(5, "질문은 5자 이상"),
  area: z.enum(areas).nullable(),
  intent: z.enum(intents),
  depth: z.enum(depths).default("standard"),
  /** 조사가 꼭 불러야 하는 tool 이름 (src/tools/<이름>/index.ts 의 name). 없으면 [] */
  expectTools: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export const questionSetSchema = z.object({
  set: z.enum(setNames),
  owner: z.string().regex(/^@[A-Za-z0-9-]+$/, "GitHub 핸들. 예: @seoyoung23"),
  questions: z.array(questionSchema).min(1),
});

export type Question = z.infer<typeof questionSchema>;
export type QuestionSet = z.infer<typeof questionSetSchema>;

export function listQuestionFiles(dir = QUESTIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

/** 파일 하나를 읽고 검사합니다. 틀리면 파일 이름과 위치가 담긴 Error 를 던집니다. */
export function loadQuestionSet(path: string): QuestionSet {
  const name = basename(path, ".json");
  if (!existsSync(path)) {
    throw new Error(`${path}: 파일이 없습니다. 세트 이름은 ${setNames.join(", ")} 중 하나입니다`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: JSON 이 아닙니다 (${err instanceof Error ? err.message : String(err)})`);
  }

  const parsed = questionSetSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(루트)"}: ${i.message}`).join("; ");
    throw new Error(`${path}: ${where}`);
  }

  const set = parsed.data;
  if (set.set !== name) throw new Error(`${path}: set("${set.set}") 은 파일 이름("${name}") 과 같아야 합니다`);
  const seen = new Set<string>();
  for (const q of set.questions) {
    if (!q.id.startsWith(`${name}-`)) throw new Error(`${path}: id "${q.id}" 는 "${name}-" 로 시작해야 합니다`);
    if (seen.has(q.id)) throw new Error(`${path}: id "${q.id}" 가 중복입니다`);
    seen.add(q.id);
  }
  return set;
}

export function loadAllQuestionSets(dir = QUESTIONS_DIR): QuestionSet[] {
  return listQuestionFiles(dir).map(loadQuestionSet);
}
