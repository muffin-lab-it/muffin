/**
 * 데이터 소스 후보를 빠르게 찔러봅니다. tool 을 만들기 전에 "응답이 어떻게 생겼나" 볼 때 씁니다.
 *
 *   pnpm probe "https://api.frankfurter.app/latest?from=USD&to=KRW"
 *   pnpm probe "https://api.stlouisfed.org/fred/series?series_id=DGS10&api_key=$FRED_API_KEY&file_type=json"
 *   pnpm probe "<URL>" --header "Authorization: Bearer $NEWS_API_KEY"
 *   pnpm probe "<URL>" --save src/tools/fx/fixture.json
 *
 * URL 이나 헤더 안의 $이름 은 .env.local 의 값으로 바뀝니다. 키를 터미널에 직접 치지 마세요.
 */
import { writeFileSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 없어도 됨
}

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
if (!url) {
  console.error('사용법: pnpm probe "<URL>" [--header "Key: Value"] [--save 경로]');
  process.exit(1);
}

function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function fillEnv(s: string): string {
  return s.replace(/\$([A-Z0-9_]+)/g, (_, k) => {
    const v = process.env[k];
    if (!v) console.error(`경고: 환경 변수 ${k} 가 비어 있습니다 (.env.local 확인)`);
    return v ?? "";
  });
}

const headers: Record<string, string> = {};
const h = opt("header");
if (h) {
  const [k, ...rest] = h.split(":");
  headers[k.trim()] = fillEnv(rest.join(":").trim());
}

async function main() {
  const started = Date.now();
  const res = await fetch(fillEnv(url!), { headers, signal: AbortSignal.timeout(10_000) });
  const type = res.headers.get("content-type") ?? "(없음)";
  const body = await res.text();
  console.log(`상태: ${res.status} ${res.statusText}   ${Date.now() - started}ms`);
  console.log(`형식: ${type}`);
  console.log(`크기: ${body.length} chars\n`);

  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // JSON 이 아니면 그대로
  }
  console.log(pretty.length > 3000 ? pretty.slice(0, 3000) + "\n… (잘림)" : pretty);

  const save = opt("save");
  if (save) {
    writeFileSync(save, pretty.endsWith("\n") ? pretty : pretty + "\n");
    console.log(`\n저장: ${save}`);
  }
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error("실패:", err instanceof Error ? err.message : err);
  process.exit(1);
});
