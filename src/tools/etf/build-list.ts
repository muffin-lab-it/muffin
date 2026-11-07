/**
 * ETF 이름 → 종목코드 목록(`etf-list.json`)을 공공데이터포털에서 새로 받습니다. 실제 API 를 부르므로 로컬에서만 씁니다.
 * 새 ETF 가 상장되거나 이름이 바뀌었을 때 한 번씩 돌리고 결과 파일을 커밋합니다.
 *
 *   pnpm tool src/tools/etf/build-list.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRows, SOURCE_NAME, todayKst, shiftDays } from "./index";
import type { EtfListFile } from "./names";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local 이 없으면 DATA_GO_KR_KEY 가 없다는 오류로 실패합니다.
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("DATA_GO_KR_KEY 가 설정되지 않았습니다 (.env.local 확인)");
  const today = todayKst();
  // 공개가 T+1 이라 어제부터 거슬러 올라가며 행이 있는 첫 영업일을 씁니다.
  for (let back = 1; back <= 10; back++) {
    const basDt = shiftDays(today, -back);
    const rows = await fetchRows({ key, deadline: Date.now() + 30_000 }, { basDt, numOfRows: "3000" });
    if (rows.length === 0) continue;
    const items = [...new Map(rows.map((r) => [r.srtnCd, r.itmsNm])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
    const file: EtfListFile = { updatedAt: `${basDt.slice(0, 4)}-${basDt.slice(4, 6)}-${basDt.slice(6)}`, source: SOURCE_NAME, items };
    writeFileSync(join(import.meta.dirname, "etf-list.json"), `${JSON.stringify(file, null, 0).replace(/\],\[/g, "],\n[")}\n`);
    console.log(`${file.updatedAt} 기준 ${items.length}개 저장`);
    return;
  }
  throw new Error("최근 10일에 ETF 시세가 없습니다");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
