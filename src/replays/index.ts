// 생성 파일: scripts/replay/record.ts 가 다시 만듭니다. 손으로 고치지 마세요. 녹화 형식은 src/lib/replay.ts 의 replaySchema.
import r0 from "./etf-decision.json";
import r1 from "./etf-decision-deep.json";
import r2 from "./etf-decision-easy.json";
import r3 from "./fx-cause.json";
import r4 from "./fx-cause-deep.json";
import r5 from "./fx-cause-easy.json";
import r6 from "./rate-compare.json";

export const replays: Record<string, unknown> = {
  "etf-decision": r0,
  "etf-decision-deep": r1,
  "etf-decision-easy": r2,
  "fx-cause": r3,
  "fx-cause-deep": r4,
  "fx-cause-easy": r5,
  "rate-compare": r6,
};
