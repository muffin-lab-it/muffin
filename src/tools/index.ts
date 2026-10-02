/**
 * Tool 레지스트리. 리더만 수정합니다.
 * 팀원 tool 이 머지되면 여기에 한 줄 추가하면 Agent 가 사용합니다.
 */
import { sampleTool } from "./_template";
// import { fxTool } from "./fx";
// import { etfTool } from "./etf";
// import { newsTool } from "./news";
// import { rateTool } from "./rate";
// import { macroTool } from "./macro";

export const muffinTools = [
  sampleTool, // 첫 실제 tool 이 머지되면 제거
  // fxTool, etfTool, newsTool, rateTool, macroTool,
];
