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

/**
 * z-score. value 가 series 의 평균에서 표준편차 몇 배 떨어져 있는지 (표본 표준편차).
 * 유의성 게이트("평소 범위의 움직임인가")에 쓸 예정이고, 장부에 시계열이 올라오면 tool op 로 노출합니다.
 */
export function zScore(series: number[], value: number): number {
  assertFinite("value", value);
  if (series.length < 2) throw new Error("z-score 는 관측값이 2개 이상 필요합니다");
  for (const x of series) assertFinite("series", x);
  const mean = series.reduce((s, x) => s + x, 0) / series.length;
  const variance = series.reduce((s, x) => s + (x - mean) ** 2, 0) / (series.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) throw new Error("표준편차가 0 이면 z-score 를 구할 수 없습니다");
  return round((value - mean) / sd);
}
