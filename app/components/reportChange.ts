import type { ChangeDetail } from "@/src/agent/schema";

/** 360~372일 전은 "1년 전" 으로 (백엔드 change.ts 가 basis 에 "365일 전과 비교" 처럼 일수를 그대로 적음, 11/22 운영 확인) */
export function yearlyBasis(text: string): string {
  return text.replace(/(?:36\d|37[0-2])일 전/g, "1년 전");
}

/** 기간과 수치가 명시된 변화만 풀어 씁니다. 알 수 없는 형식은 원문을 보존합니다. */
export function reportChange(raw: string, detail?: ChangeDetail) {
  if (detail) {
    const value = detail.value;
    const basis = yearlyBasis(detail.basis || (detail.days !== undefined ? `${detail.days}일 전과 비교` : "비교 시점과 비교"));
    return {
      text: value === 0 ? `${basis}해 변화가 없어요` : `${basis}해 ${Math.abs(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${detail.unit} ${value > 0 ? "상승" : "하락"}`,
      direction: value > 0 ? "up" : value < 0 ? "down" : "flat",
    };
  }
  const match = raw.trim().match(/^(?:(\d+)일\s+)?([+−-]?\d+(?:\.\d+)?)\s*(%p|%)$/);
  if (!match) return { text: raw, direction: "flat" };
  const value = Number(match[2].replace("−", "-"));
  const period = match[1] ? yearlyBasis(`${match[1]}일 전`) : "비교 시점";
  return {
    text: value === 0 ? `${period}과 같아요` : `${period}보다 ${Math.abs(value)}${match[3]} ${value > 0 ? "상승" : "하락"}`,
    direction: value > 0 ? "up" : value < 0 ? "down" : "flat",
  };
}
