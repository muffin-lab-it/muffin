/**
 * Agent 없이 tool 만 단독 실행합니다. 실제 API 를 호출하므로 로컬에서만 씁니다.
 *
 *   pnpm tool src/tools/rate/run.ts
 */
import { execute } from "./index";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없어도 키가 필요 없는 tool 은 동작합니다.
}


async function main() {
  const days = "90" as const;

  const series = ["BOK", "DGS10", "DFF"] as const;

  for (const item of series) {
    console.log(`${item} 금리 조회 시작`);

    const result = await execute({
      series: item,
      days,
    });

    console.log(JSON.stringify(result, null, 2));
  }
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
