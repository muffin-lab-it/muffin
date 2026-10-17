/** 실제 RSS 호출용 로컬 스크립트. API 키는 필요하지 않습니다. */
import { execute, parameters } from "./index";
import { sourceIds } from "./sources";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main() {
  const started = performance.now();
  const rawSources = option("sources")?.split(",") ?? [...sourceIds];
  const input = parameters.parse({
    sources: rawSources,
    query: option("query") ?? null,
    limit: Number(option("limit") ?? "5"),
    content: option("content") ?? "list",
  });
  const result = await execute(input);
  if (process.argv.includes("--summary")) {
    console.log(JSON.stringify({
      count: result.data.count,
      requestedCount: result.data.requestedCount,
      collectedCount: result.data.collectedCount,
      missingCount: result.data.missingCount,
      inspectedCount: result.data.inspectedCount,
      failedCount: result.data.failedCount,
      failureCounts: result.data.failureCounts,
      resultStatus: result.data.resultStatus,
      stopReason: result.data.stopReason,
      elapsedMs: Math.round(performance.now() - started),
      bodyStatus: result.data.bodyStatus,
      failedSources: result.data.failedSources,
      articles: result.data.articles.map(({ source, publisher, url, body }) => ({
        source, publisher, url, bodyStatus: body.status,
        ...(body.status === "available" ? { characters: body.text.length, paragraphs: body.text.split("\n\n").length } : {}),
        ...(body.status === "unavailable" ? { reason: body.reason, detail: body.detail } : {}),
      })),
    }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
