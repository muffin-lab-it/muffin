/**
 * Agent 없이 tool 만 단독 실행합니다. 실제 API 를 호출하므로 로컬에서만 씁니다.
 *
 *   pnpm tool src/tools/us-index/run.ts "S&P 500" 30
 */
import { execute, parameters } from "./index";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없으면 FRED_API_KEY 가 없다는 오류로 실패합니다.
}

const [index = "S&P 500", days = "30"] = process.argv.slice(2);
execute(parameters.parse({ index, days: Number(days) }))
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
