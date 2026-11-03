/**
 * 🧮 계산의 순수 함수. 장부 · 모델과 무관하게 숫자만 받아 숫자를 돌려주므로 테스트가 쉽습니다.
 * 부동소수 꼬리(0.8799999)를 없애기 위해 결과는 소수 6자리로 반올림합니다. 검증기는 표기 자릿수 반올림을 허용하므로 리포트의 0.88%p 와 맞습니다.
 */

export function round(x: number, digits = 6): number {
  const m = 10 ** digits;
  return Math.round((x + Number.EPSILON) * m) / m;
}

function assertFinite(name: string, x: number) {
  if (typeof x !== "number" || !Number.isFinite(x)) throw new Error(`${name} 가 숫자가 아닙니다: ${String(x)}`);
}

/** 변동률 (%). from → to 로 바뀐 비율. from 이 0 이면 정의되지 않으므로 throw. */
export function pctChange(from: number, to: number): number {
  assertFinite("from", from);
  assertFinite("to", to);
  if (from === 0) throw new Error("기준 값(from)이 0 이면 변동률을 구할 수 없습니다");
  return round(((to - from) / Math.abs(from)) * 100);
}

/** 차이. to − from. 두 값의 단위가 같아야 합니다 (원 − 원, 포인트 − 포인트). */
export function diff(from: number, to: number): number {
  assertFinite("from", from);
  assertFinite("to", to);
  return round(to - from);
}

/** 퍼센트포인트 차이 (%p). 두 값이 모두 % 일 때만 뜻이 있습니다 (3.88% − 3.00% = 0.88%p). */
export function ppDiff(from: number, to: number): number {
  return diff(from, to);
}

/** 표본 표준편차. 관측값이 2개 미만이거나 모두 같으면 정의되지 않으므로 throw. */
export function stdev(series: number[]): number {
  if (series.length < 2) throw new Error("표준편차는 관측값이 2개 이상 필요합니다");
  for (const x of series) assertFinite("series", x);
  const mean = series.reduce((s, x) => s + x, 0) / series.length;
  const sd = Math.sqrt(series.reduce((s, x) => s + (x - mean) ** 2, 0) / (series.length - 1));
  if (sd === 0) throw new Error("표준편차가 0 이면 평소 폭을 정할 수 없습니다");
  return sd;
}

/**
 * 유의성 게이트의 z-score (src/agent/movement.ts). 이번 변화율 move(%)가 평소 폭의 몇 배인지이고, 부호는 move 를 따릅니다.
 * 평소 폭 = 기준 기간 하루 변화율(daily, %)의 표본 표준편차 × √steps. 하루하루의 변화가 서로 무관하다고 볼 때
 * 하루 변화가 steps 번 쌓이면 보통 이만큼 움직입니다 (steps 는 이번 변화가 걸친 관측 수).
 * 기준 기간의 평균 변화(추세)는 빼지 않습니다. 평소 폭은 "원인 없이도 생기는 흔들림" 의 크기이고, 꾸준히 한쪽으로 가는 움직임은
 * 설명할 원인이 있는 움직임이라 크게 잡히는 것이 맞습니다. 90일 평균 변화는 흔들림이 커서 빼면 판정도 흔들립니다.
 */
export function movementZ(move: number, daily: number[], steps: number): { z: number; typical: number } {
  assertFinite("move", move);
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`관측 수(steps)는 1 이상의 정수여야 합니다: ${String(steps)}`);
  const typical = stdev(daily) * Math.sqrt(steps);
  return { z: round(move / typical), typical: round(typical) };
}
