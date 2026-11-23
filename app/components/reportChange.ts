import type { ChangeDetail } from "@/src/agent/schema";

/** 360~372일 전은 "1년 전" 으로 (백엔드 change.ts 가 basis 에 "365일 전과 비교" 처럼 일수를 그대로 적음, 11/22 운영 확인) */
export function yearlyBasis(text: string): string {
  return text.replace(/(?:36\d|37[0-2])일 전/g, "1년 전");
}

/**
 * 변화량이 아니라 비교용 기준값(평소 하루 움직임 · 평소 폭 등)을 가리키는 changeDetail 은 믿지 않습니다
 * (11/23 운영: "평소(직전 90일 0.23%)의 0.74배" 가 "직전 거래일과 비교해 0.23% 상승" 으로 그려짐. 백엔드 change.ts 가 key 의 daily 를 보고 붙임).
 */
export function trustedChangeDetail(detail?: ChangeDetail): ChangeDetail | undefined {
  return detail && !/baseline|typical/i.test(detail.key) ? detail : undefined;
}

/** 기간과 수치가 명시된 변화만 풀어 씁니다. 알 수 없는 형식은 원문을 보존합니다. */
export function reportChange(raw: string, rawDetail?: ChangeDetail) {
  const detail = trustedChangeDetail(rawDetail);
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
