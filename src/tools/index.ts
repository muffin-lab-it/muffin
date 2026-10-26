/**
 * Tool 레지스트리. 리더만 수정합니다.
 * 팀원 tool 이 머지되면 muffinTools 에 한 줄 추가하면 🔍 조사 Agent 가 사용합니다 (📋 분류가 이 목록에서 고릅니다).
 * 🧮 계산 tool 은 데이터 tool 이 아니라 따로 두고 ✂️ 정제 Agent 만 씁니다.
 */
import { calcTool } from "./calc";
import { etfTool } from "./etf";
import { fxTool } from "./fx";
import { macroTool } from "./macro";
import { newsTool } from "./news";
import { rateTool } from "./rate";

export const muffinTools = [fxTool, etfTool, newsTool, rateTool, macroTool];
export const calcTools = [calcTool];
