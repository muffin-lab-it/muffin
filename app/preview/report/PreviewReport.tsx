"use client";

import { useState } from "react";
import { ReportHelp } from "@/app/components/ReportHelp";
import { ReportView } from "@/app/components/ReportView";
import { reportSchema, type Area } from "@/src/agent/schema";
import fixture from "@/src/agent/fixtures/report.v2.sample.json";
import styles from "./preview.module.css";

const samples = {
  fx: { name: "환율", question: fixture.input.question, headline: "원달러 환율이 한 달 사이 2% 올랐어요.", titles: ["해외 결제와 여행", "달러 자산의 원화 가치", "수입 상품의 가격"], reasons: ["두 나라의 금리 차이가 환율과 어떻게 연결되는지 살펴보세요.", "주식 거래와 외환 시장의 연결을 알아보세요.", "다른 통화에서도 비슷한 흐름이 나타나는지 비교해 보세요.", "환율 변화가 생활 물가로 이어지는 과정을 알아보세요."] },
  rate: { name: "금리", question: "기준금리가 그대로면 내 생활에는 어떤 영향이 있어?", headline: "기준금리가 같아도 대출·예금 금리는 달라질 수 있어요.", label: "한국 기준금리", value: "3.00%", change: "30일 0.00%p", amount: 3, tool: "rates", source: "한국은행", summary: "한국 기준금리는 3.00%로 30일 전과 같아요. 실제 예금과 대출 금리는 은행의 조달 비용과 상품 조건도 함께 반영해 정해져요.", titles: ["대출 이자", "예금과 적금"], impacts: ["변동금리 대출은 계약의 금리 변경 주기와 기준 지표를 함께 살펴보세요.", "같은 기준금리 아래에서도 가입 기간과 우대 조건에 따라 이자가 달라질 수 있어요."], topics: ["기준금리와 대출금리의 차이", "고정금리와 변동금리"], reasons: ["내 대출금리를 구성하는 요소를 이해할 수 있어요.", "금리가 바뀔 때 계약별로 어떤 차이가 생기는지 알아보세요."] },
  macro: { name: "물가", question: "물가 상승률이 낮아지면 장보기도 저렴해지는 거야?", headline: "물가 상승률이 낮아져도 가격이 내려간 것은 아니에요.", label: "소비자물가 상승률", value: "2.1%", change: "", amount: 2.1, tool: "macro_cpi", source: "통계청", summary: "소비자물가 상승률은 1년 전과 비교한 가격의 변화예요. 상승률이 둔화됐다는 것은 가격이 더 천천히 오르고 있다는 뜻일 수 있어요.", titles: ["장보기 예산", "내가 느끼는 물가"], impacts: ["전체 상승률과 자주 구매하는 식품의 가격 변화를 함께 살펴보세요.", "내 소비에서 비중이 큰 품목이 오르면 전체 지표보다 부담이 크게 느껴질 수 있어요."], topics: ["소비자물가와 생활물가", "물가와 금리의 관계"], reasons: ["내 지출과 가까운 물가 지표를 찾아보세요.", "물가에 따라 금리 논의가 달라지는 배경을 알아보세요."] },
  etf: { name: "ETF", question: "ETF 가격을 볼 때 무엇을 함께 확인해야 해?", headline: "ETF는 가격과 함께 추종 지수·비용도 살펴보세요.", label: "지수형 ETF 가격", value: "35,000원", change: "30일 +1.20%", amount: 35000, tool: "etf", source: "거래소 시세", summary: "ETF 가격은 추종하는 자산의 움직임을 반영해요. 같은 유형의 상품을 비교할 때는 추종 지수, 보수와 거래 가격의 차이를 함께 확인할 수 있어요.", titles: ["내가 보유한 자산", "상품 비교"], impacts: ["ETF 이름보다 실제로 어떤 자산과 지수를 담는지 확인해 보세요.", "가격만으로 상품을 판단하기보다 비용과 구성 자산을 나란히 살펴보세요."], topics: ["ETF 괴리율이란", "총보수와 실제 비용"], reasons: ["거래 가격과 자산 가치가 왜 다른지 이해해 보세요.", "비용 항목을 비교하는 방법을 알아보세요."] },
  news: { name: "경제뉴스", question: "금리 동결 뉴스에서 어떤 점을 읽어야 해?", headline: "동결 여부와 함께 결정의 배경을 읽어보세요.", label: "기사에 인용된 기준금리", value: "3.00%", change: "", amount: 3, tool: "news", source: "경제 기사", summary: "기준금리 동결 소식은 현재 수준을 유지했다는 뜻이에요. 기사에서 물가와 경기 판단, 앞으로 주목하는 지표를 구분해 읽으면 맥락을 이해하기 쉬워요.", titles: ["뉴스 읽기", "생활과 연결하기"], impacts: ["이미 발표된 결정과 향후 전망을 나누어 읽어보세요.", "기사의 금리 수치가 내 예금·대출 상품에 그대로 적용되는 것은 아니에요."], topics: ["금리 결정에서 보는 경제지표", "정책 발표와 시장 반응"], reasons: ["결정의 배경에 어떤 데이터가 쓰이는지 살펴보세요.", "발표 내용과 시장의 해석을 구분해 보세요."] },
};

export function PreviewReport() {
  const [area, setArea] = useState<Area>("fx");
  const [saved, setSaved] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const sample = samples[area];
  const report = reportSchema.parse(fixture.report);
  report.caveats = ["표시된 환율은 은행에서 실제 환전할 때 적용되는 환율과 다를 수 있어요.", "미국 금리는 중앙은행의 목표치가 아니라 은행 간 하루짜리 거래에 실제 적용된 금리예요."];
  report.dataGaps = ["수입 업체의 달러 수요는 직접 자료로 확인되지 않았어요."];
  if (area !== "fx") {
    const item = samples[area];
    report.summary = item.summary;
    report.numbers = [{ ...report.numbers[0], label: item.label, value: item.value, change: item.change, check: area === "news" ? "reported" : "verified", ref: "E1" }];
    report.evidence = [{ ...report.evidence[0], id: "E1", tool: item.tool, label: item.label, source: { name: item.source, url: "", asOf: "2026-10-19" }, values: { value: item.amount } }];
    report.sources = [];
    report.why = [{ claim: item.summary, evidence: "", basis: area === "news" ? "news" : "data", refs: ["E1"] }];
    report.impact = item.impacts;
    report.nextTopics = item.topics;
    report.caveats = [];
    report.dataGaps = [];
    report.charts = [];
    report.notice = undefined;
  }
  function keep() {
    try {
      const key = `muffin.design-preview.${area}`;
      localStorage.setItem(key, JSON.stringify({ area, report }));
      if (!localStorage.getItem(key)) throw new Error("save");
      setSaved(previous => [...previous, area]);
      setStatus("이 브라우저에 미리보기를 보관했어요.");
    } catch { setStatus("브라우저 저장 공간을 사용할 수 없어요."); }
  }
  return <>
    <nav className={styles.tabs} aria-label="디자인 확인용 주제"><small>시안 확인</small>{(Object.keys(samples) as Area[]).map(key => <button key={key} type="button" aria-pressed={area === key} onClick={() => { setArea(key); setStatus(""); }}>{samples[key].name}</button>)}</nav>

    <p role="status" className={styles.status}>{status}</p>
    <ReportView key={area} header={<header className={styles.header}><div><p>갓 구운 오늘의 리포트</p><h1>Today&apos;s Muffin</h1><span>{sample.name} · Standard</span></div><div className={styles.headerTools}><div className={styles.actions}><button type="button" onClick={keep}>{saved.includes(area) ? "보관했어요 ✓" : "보관하기"}</button><button type="button" onClick={() => window.print()}>PDF로 담기</button></div><ReportHelp /></div></header>} report={report} headline={sample.headline} impactTitles={sample.titles} topicReasons={sample.reasons} area={area} question={sample.question} />
  </>;
}

