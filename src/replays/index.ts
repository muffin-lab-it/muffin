// 생성 파일: scripts/replay/record.ts 가 다시 만듭니다. 손으로 고치지 마세요. 녹화 형식은 src/lib/replay.ts 의 replaySchema.
import r0 from "./etf-basket.json";
import r1 from "./etf-decision.json";
import r2 from "./etf-decision-deep.json";
import r3 from "./etf-decision-easy.json";
import r4 from "./fx-cause.json";
import r5 from "./fx-cause-deep.json";
import r6 from "./fx-cause-easy.json";
import r7 from "./macro-cause.json";
import r8 from "./macro-cause-deep.json";
import r9 from "./rate-compare.json";
import r10 from "./rate-kospi.json";
import r11 from "./rate-trend.json";

export const replays: Record<string, unknown> = {
  "etf-basket": r0,
  "etf-decision": r1,
  "etf-decision-deep": r2,
  "etf-decision-easy": r3,
  "fx-cause": r4,
  "fx-cause-deep": r5,
  "fx-cause-easy": r6,
  "macro-cause": r7,
  "macro-cause-deep": r8,
  "rate-compare": r9,
  "rate-kospi": r10,
  "rate-trend": r11,
};
