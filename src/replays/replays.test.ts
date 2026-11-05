import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replayMeta, replaySchema } from "../lib/replay";
import { replays } from "./index";
import manifest from "./manifest.json";

// 녹화 파일 전부: 형식 · 파일 이름 = id · 권유 표현 0 · 이벤트 시간 순 · index · manifest 와 일치
const dir = __dirname;
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json").sort();

describe("src/replays 녹화 파일", () => {
  it("파일마다 replaySchema 를 통과하고 이름이 id 와 같으며 권유 표현이 없다", () => {
    for (const f of files) {
      const r = replaySchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      expect(`${r.id}.json`).toBe(f);
      expect(r.report.verification.advice).toBe(0);
      const ts = r.events.map((e) => e.t);
      expect([...ts].sort((a, b) => a - b)).toEqual(ts);
      expect(JSON.stringify(r)).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    }
  });

  it("index.ts 와 manifest.json 은 파일 목록과 같다 (pnpm replay:record --check 로 다시 생성)", () => {
    // 파일 이름 정렬과 id 정렬이 다를 수 있어("a-b.json" 과 "a.json") id 로 맞춰 비교
    const ids = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(Object.keys(replays).sort()).toEqual(ids);
    const expected = ids
      .map((id) => replayMeta(replaySchema.parse(replays[id])))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    expect(manifest).toEqual(expected);
  });
});
