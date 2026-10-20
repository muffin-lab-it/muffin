/**
 * Tool 레지스트리. 리더만 수정합니다.
 * 팀원 tool 이 머지되면 여기에 한 줄 추가하면 Agent 가 사용합니다.
 */
import { etfTool } from "./etf";
import { fxTool } from "./fx";
import { macroTool } from "./macro";
import { newsTool } from "./news";
import { rateTool } from "./rate";

export const muffinTools = [fxTool, etfTool, newsTool, rateTool, macroTool];
