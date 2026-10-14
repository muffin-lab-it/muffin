/**
 * Tool 레지스트리. 리더만 수정합니다.
 * 팀원 tool 이 머지되면 여기에 한 줄 추가하면 Agent 가 사용합니다.
 */
import { sampleTool } from "./_template";
import { etfTool } from "./etf";
// import { fxTool } from "./fx";
// import { newsTool } from "./news";
// import { rateTool } from "./rate";
// import { macroTool } from "./macro";

export const muffinTools = [
  sampleTool, // fx tool 이 머지되면 제거
  etfTool,
  // fxTool, newsTool, rateTool, macroTool,
];
