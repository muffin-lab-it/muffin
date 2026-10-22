/**
 * Agent 없이 tool 만 단독 실행합니다. 실제 API 를 호출하므로 로컬에서만 씁니다.
 *
 *   pnpm tool src/tools/rate/run.ts                          # 전체 지표, 90일
 *   pnpm tool src/tools/rate/run.ts --days=365               # 전체 지표, 365일
 *   pnpm tool src/tools/rate/run.ts --series=JP --days=30    # 한 지표만
 *   pnpm tool src/tools/rate/run.ts --series=BIS --days=365  # BIS 7개국만 (키 불필요)
 */
import { execute, parameters } from "./index";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없어도 키가 필요 없는 tool 은 동작합니다.
}

const ALL_SERIES = parameters.shape.series.options;
const BIS_SERIES = ["JP", "GB", "CA", "AU", "CH", "CN", "BR"] as const;

function getArgument(name: string): string | undefined {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument?.split("=", 2)[1];
}

async function main() {
  const days = Number(getArgument("days") ?? "90");
  const seriesArg = getArgument("series");
  const series = seriesArg === undefined ? ALL_SERIES : seriesArg === "BIS" ? BIS_SERIES : [seriesArg];

  for (const item of series) {
    console.log(`${item} 금리 조회 시작`);

    // 스키마로 검증해 숫자 days(30/90/365)와 지원 지표만 통과시킵니다.
    const input = parameters.parse({ series: item, days });
    const result = await execute(input);

    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
