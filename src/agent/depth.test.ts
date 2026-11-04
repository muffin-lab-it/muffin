/**
 * ✍️ 깊이별 금융 규칙 테스트 (@kani-market). 지시문은 문자열이라 "들어가야 할 말이 들어갔는지" 를 확인합니다.
 * 규칙을 더하면 그 규칙의 핵심 단어를 여기에 한 줄 더하세요. 실제 리포트 차이는 `pnpm eval --set common --depth all` 로 봅니다.
 */
import { describe, expect, it } from "vitest";
import { byDepth, depthInstructions, financeRules, modeRules } from "./depth";
import { depths } from "./schema";

describe("byDepth", () => {
  it("세 깊이 모두 규칙이 있고 서로 다르다", () => {
    for (const d of depths) expect(byDepth[d]).toContain("[설명 깊이");
    expect(new Set(depths.map((d) => byDepth[d])).size).toBe(3);
  });

  it("Easy 는 쉬운 설명과 선택적 용어 병기, Deep Dive 는 기간 비교와 상충 요인", () => {
    expect(byDepth.easy).toContain("쉬운 설명을 먼저");
    expect(byDepth.easy).toContain("이해에 도움이 될 때만 괄호로 병기");
    expect(byDepth.easy).toContain("비유");
    expect(byDepth.deep).toContain("기간 비교");
    expect(byDepth.deep).toContain("상충");
  });

  it("Easy 는 금융 용어를 풀어 설명하되 수치와 단위를 유지한다", () => {
    for (const term of ["퍼센트포인트", "bp는 금리 변화폭을 나타내는 단위", "1bp = 0.01%p", "지난해 같은 달과 비교", "지난달과 비교", "가격이 오르내리는 폭", "분배금까지 고려한 수익률", "재투자 등 산정 조건", "정확한 수치와 원본 단위를 생략하거나 잘못 바꾸지 않습니다"]) {
      expect(byDepth.easy).toContain(term);
    }
    expect(byDepth.easy).toMatch(/원본 단위를 유지하면서[^.\n]*쉬운 우리말로 설명/);
    expect(byDepth.easy).toContain("리포트 수치의 직접 환산을 허용하지 않습니다");
  });

  it("Standard 는 첫 등장 설명과 균형을, Deep Dive 는 전문용어와 해석 한계를 요구한다", () => {
    expect(byDepth.standard).toContain("첫 등장 때 한 번 짧게 설명");
    expect(byDepth.standard).toContain("수익률 · 비교 기간 · 단위 · 주요 위험");
    expect(byDepth.standard).toContain("인과관계를 과도하게 단정하지 않습니다");
    expect(byDepth.deep).toContain("bp · %p · YoY · MoM · Total Return");
    expect(byDepth.deep).toContain("기준일 · 비교 기간 · 원본 단위 · 데이터 한계");
    expect(byDepth.deep).toContain("근거 없는 정밀함이나 과도한 확신");
  });
});

describe("financeRules", () => {
  it("금리 수준과 차이, 상대 변동률을 구분하고 검증된 환산값만 병기한다", () => {
    for (const rule of ["금리 수준은 %", "금리 수준 간 차이는 %p 또는 bp", "비교 대상 금리와 비교 방향"]) {
      expect(financeRules).toContain(rule);
    }
    expect(financeRules).toMatch(/상대적인 변동률\(%\)[^.\n]*금리 수준의 차이를 혼동하지 않습니다/);
    expect(financeRules).toContain("작성 규칙의 원본 단위 유지 원칙을 따릅니다");
    expect(financeRules).toMatch(/원본 단위와 수치를[^.\n]*대체하지 않습니다/);
    expect(financeRules).toMatch(/다른 단위의 수치는 검증된 데이터로 장부에 함께 제공된 경우에만[^.\n]*보조적으로 병기/);
    expect(financeRules).toMatch(/작성 단계에서 직접 계산하거나 단위를 환산하지 않습니다/);
  });

  it("원/달러 방향과 원인을 구분하고 다른 통화쌍으로 일반화하지 않는다", () => {
    for (const rule of ["달러당 원화 금액", "다른 통화쌍에 이 기준을 그대로 적용하지 않습니다"]) {
      expect(financeRules).toContain(rule);
    }
    expect(financeRules).toMatch(/상승은 달러 대비 원화 약세/);
    expect(financeRules).toMatch(/하락은 달러 대비 원화 강세/);
    expect(financeRules).not.toMatch(/상승은 달러 대비 원화 강세|하락은 달러 대비 원화 약세/);
    expect(financeRules).toMatch(/변동 방향과 변동 원인을 구분합니다/);
    expect(financeRules).toMatch(/동시 움직임만으로[^.\n]*원인을 확정하지 않습니다/);
  });

  it("ETF 성과의 산정 조건과 실제 비교 기간을 구분한다", () => {
    for (const rule of ["가격 기준 수익률과 분배금 재투자를 포함한 총수익률", "일간 등락률과 기간 수익률", "기준일 · 비교 시작일 · 종료일 · 수익률 산정 기간", "실제 확보된 데이터 기간이 요청 기간과 다르면", "분배금 · 수수료 · 세금 · 환율 효과", "임의로 가정하지 않습니다", "없는 날짜나 기간은 추정하지 않고 dataGaps"]) {
      expect(financeRules).toContain(rule);
    }
    expect(financeRules).toMatch(/가격 기준 수익률과[^.\n]*총수익률을 구분합니다/);
    expect(financeRules).toMatch(/일간 등락률과 기간 수익률을 혼동하지 않습니다/);
  });

  it("물가 지수와 상승률, YoY 와 MoM 및 상승률 둔화를 구분한다", () => {
    for (const rule of ["물가 지수 수준과 물가상승률", "전년 동월 대비(YoY)", "전월 대비(MoM)", "관측월과 계절조정 여부", "물가상승률 둔화를 물가 수준 하락으로 표현하지 않습니다"]) {
      expect(financeRules).toContain(rule);
    }
    expect(financeRules).toMatch(/물가 지수 수준과 물가상승률을 구분/);
    expect(financeRules).toMatch(/전년 동월 대비\(YoY\)와 전월 대비\(MoM\)를 혼동하지 않습니다/);
  });

  it("사실과 해석 및 전망을 구분하고 새로운 예측이나 인과 단정을 제한한다", () => {
    for (const rule of ["확인된 사실 · 데이터에 대한 해석 · 미래 전망", "상관관계를 인과관계로 단정하지 않습니다", "출처 · 전망 시점(발표 시점과 대상 기간) · 전제조건", "근거 없는 예측값이나 확률을 새로 생성하지 않습니다", "전망을 관측된 사실이나 확정된 원인으로 쓰지 않습니다"]) {
      expect(financeRules).toContain(rule);
    }
    expect(financeRules).toMatch(/확인된 사실[^.\n]*데이터에 대한 해석[^.\n]*미래 전망을 문장에서 구분합니다/);
    expect(financeRules).toMatch(/증거 장부에 없는 구체적인 숫자는[^.\n]*사용하지 않습니다/);
    expect(financeRules).toMatch(/기사 본문에서 확인했더라도[^.\n]*숫자를 임의로 옮겨 적지 않습니다/);
    expect(financeRules).toMatch(/기사 제목 등 확인된 근거가 뒷받침하면[^.\n]*수치를 생략한 정성적 표현/);
    expect(financeRules).toContain("사용자 질문에 포함된 가정값은 외부 관측값과 구분합니다");
  });

  it("관련된 손실 가능성과 불확실성을 설명하고 보장이나 위험 문구 반복을 제한한다", () => {
    for (const rule of ["과거 수익률을 미래 수익률의 보장으로 표현하지 않습니다", "상품과 질문에 관련된 손실 가능성 및 불확실성", "근거 없이 안전성이나 원금 보장을 단정하지 않습니다", "관련성이 없는 위험 문구를 기계적으로 반복하지 않습니다"]) {
      expect(financeRules).toContain(rule);
    }
  });
});

describe("depthInstructions", () => {
  it("세 깊이 모두 선택한 깊이 규칙과 금융 공통 규칙을 정확히 한 번 조합한다", () => {
    expect(financeRules.trim()).not.toBe("");
    for (const depth of depths) {
      const result = depthInstructions(depth);
      expect(result).toBe([byDepth[depth], financeRules].join("\n\n"));
      expect(result.split(financeRules)).toHaveLength(2);
      expect(result.match(/\[설명 깊이:/g)).toHaveLength(1);
      expect(result.match(/\[금융 공통 작성 규칙\]/g)).toHaveLength(1);
    }
  });

  it("판단 요청 모드면 판단을 대신하지 않는다는 규칙이 붙는다", () => {
    for (const depth of depths) {
      const result = depthInstructions(depth, "decision_facts");
      expect(result).toBe([byDepth[depth], financeRules, modeRules.decision_facts].join("\n\n"));
      expect(result.split(financeRules)).toHaveLength(2);
      expect(result.match(/\[모드: 판단 요청\]/g)).toHaveLength(1);
    }
    expect(depthInstructions("standard", "research")).not.toContain("[모드: 판단 요청]");
    expect(modeRules.decision_facts).toContain("판단을 대신하지 않습니다");
  });
});
