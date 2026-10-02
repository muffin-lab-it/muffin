/**
 * Agent 없이 tool 만 단독 실행합니다. 실제 API 를 호출하므로 로컬에서만 씁니다.
 *
 *   pnpm tool src/tools/_template/run.ts --base USD --quote KRW
 */
import { execute, parameters } from "./index";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없어도 키가 필요 없는 tool 은 동작합니다.
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

async function main() {
  const input = parameters.parse({ base: "USD", quote: "KRW", ...parseArgs(process.argv.slice(2)) });
  const result = await execute(input);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
