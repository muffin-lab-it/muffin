/** 실제 API 호출과 원응답 fixture 수집. 키와 요청 URL은 출력하거나 저장하지 않는다. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { execute, parameters, type Input } from "./index";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 키 누락은 execute에서 안내한다.
}

type Fixture = Record<string, {
  input: Input;
  capturedAt: string;
  response: unknown;
}>;

function parseArgs(argv: string[]): Map<string, string> {
  const values = new Set(["country", "indicator", "month", "months"]);
  const flags = new Set(["sample", "save-fixture", "check-fixture"]);
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    const name = option.slice(2);
    if (!option.startsWith("--") || (!values.has(name) && !flags.has(name))) {
      throw new Error(`알 수 없는 옵션: ${option}`);
    }
    if (args.has(name)) {
      throw new Error(`중복 옵션: ${option}`);
    }
    if (values.has(name)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new Error(`${option} 뒤에 값을 입력하세요.`);
      }
      args.set(name, value);
    } else {
      args.set(name, "true");
    }
  }
  if (args.has("save-fixture") && args.has("check-fixture")) {
    throw new Error("저장과 비교 옵션은 동시에 사용할 수 없습니다.");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = parameters.parse({
    country: args.get("country") ?? "KR",
    indicator: args.get("indicator") ?? "cpi",
    endMonth: !args.has("month") || args.get("month") === "latest"
      ? null
      : args.get("month"),
    months: Number(args.get("months") ?? 1),
  });
  if (args.has("sample")) {
    if (input.country !== "KR") {
      throw new Error("--sample은 ECOS(KR)에서만 사용할 수 있습니다.");
    }
    process.env.ECOS_API_KEY = "sample";
  }
  const capture = args.has("save-fixture") || args.has("check-fixture");
  if (capture && input.endMonth === null) {
    throw new Error("fixture 저장·비교 시 재현 가능한 종료 월을 --month YYYYMM으로 지정하세요.");
  }
  const responses: unknown[] = [];
  const originalFetch = globalThis.fetch;
  if (capture) {
    globalThis.fetch = async (...fetchArgs) => {
      const response = await originalFetch(...fetchArgs);
      if (response.ok) {
        responses.push(await response.clone().json());
      }
      return response;
    };
  }
  try {
    const result = await execute(input);
    console.log(JSON.stringify(result, null, 2));
    if (!capture) {
      return;
    }
    if (responses.length !== 1) {
      throw new Error("fixture 수집 응답 수가 예상과 다릅니다.");
    }
    updateFixture(input, responses[0], args.has("check-fixture"));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** 단독 실행에서 원응답을 저장하거나 비교한다. */
function updateFixture(input: Input, response: unknown, check: boolean) {
  const path = fileURLToPath(new URL("./fixture.json", import.meta.url));
  const fixture: Fixture = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const caseId = `${input.country}_${input.indicator}`;
  if (check) {
    const expected = fixture[caseId];
    // FRED 조회일 메타데이터만 제외하며 값·날짜·응답 범위는 모두 비교한다.
    const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) =>
      input.country === "US" && (key === "realtime_start" || key === "realtime_end")
        ? undefined
        : item));
    if (
      !expected ||
      !isDeepStrictEqual(expected.input, input) ||
      !isDeepStrictEqual(normalize(expected.response), normalize(response))
    ) {
      throw new Error("실제 응답과 fixture가 다릅니다. 입력 기간·자료 개정 여부를 확인하세요. 파일은 변경하지 않았습니다.");
    }
    console.log(`${caseId} fixture 일치. 파일은 변경하지 않았습니다.`);
  } else {
    fixture[caseId] = {
      input,
      capturedAt: new Date().toISOString(),
      response
    };
    const serialized = JSON.stringify(fixture, null, 2) + "\n";
    // 응답에 인증정보가 반사되는 경우 저장을 중단한다.
    for (const key of [process.env.ECOS_API_KEY, process.env.FRED_API_KEY]) {
      if (
        key &&
        key !== "sample" &&
        [key, encodeURIComponent(key)].some(secret => serialized.includes(secret))
      ) {
        throw new Error("응답에 인증정보가 포함되어 fixture를 저장하지 않았습니다.");
      }
    }
    writeFileSync(path, serialized);
    console.log(`${caseId} 실제 원응답을 fixture.json에 저장했습니다.`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Macro 실행 실패");
  process.exitCode = 1;
});
