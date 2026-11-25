"use client";

import { useId, useRef } from "react";

export function ReportHelp({ numbers = false }: { numbers?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  return <>
    <button ref={trigger} className="report-help-button" type="button" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">{numbers ? "ⓘ 숫자 읽는 법" : "ⓘ 리포트 읽는 법"}</button>
    <dialog ref={dialog} className="report-help-dialog" aria-labelledby={titleId} onClose={() => trigger.current?.focus()} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }}>
      <div className="report-help-heading"><h2 id={titleId}>{numbers ? "숫자로 금융 이해하기" : "리포트 읽는 법"}</h2><button type="button" aria-label="읽는 법 닫기" onClick={() => dialog.current?.close()}>×</button></div>
      {numbers ? <div className="number-help"><p>질문과 관련된 수치를 변화량·기준일과 함께 읽어보세요.</p><p><strong className="tone-up">빨강 · 상승</strong> / <strong className="tone-down">파랑 · 하락</strong> / <strong className="tone-flat">회색 · 변화 없음 또는 비교값 없음</strong></p><div className="report-help-glossary"><strong>예: 금리 3.00% → 3.25%</strong><p>30일 전보다 0.25%p 올랐다는 뜻이에요. 같은 기간의 다른 나라 금리도 확인하면 금리 차이가 커졌는지 비교할 수 있어요.</p></div><p>기간과 기준일이 같은지 먼저 살펴보고, 서로 관련된 지표를 함께 비교해 보세요.</p></div> : <ol className="report-help-steps">
        {/* 11/24 가독성: 영역마다 붙어 있던 안내 문장을 여기로 모았습니다 */}
        <li><strong>먼저, 한입 요약과 숫자</strong><p>궁금했던 변화와 주요 수치를 빠르게 살펴보세요. 숫자 아래에는 변화량과 기준일이 있고, 빨강은 오름 · 파랑은 내림이에요.</p></li>
        <li><strong>이어서, 배경 · 생활 영향 · 차트</strong><p>무엇이 변화와 관련되는지, 내 소비와 자산에는 어떻게 이어지는지 읽어 보세요. 원인 앞의 배지는 근거 수준이에요: 데이터 인용은 공개된 데이터, 보도 기반은 기사 · 보도자료, 근거 부족은 직접 뒷받침하는 자료가 없는 AI 해석이에요. 차트에서는 날짜에 따른 흐름을 보고, 보라색 띠와 아래 막대로 지금 값이 평소 범위 안인지 볼 수 있어요. 차트의 빨간 점은 그날 나온 관련 기사예요.</p></li>
        <li><strong>더 궁금하면, 근거 보기</strong><p>숫자의 &apos;근거 보기&apos; 나 &apos;출처로 이동&apos; 을 누르면 아래 &apos;출처와 원본 데이터&apos; 가 펼쳐지며 그 값이 표시돼요. 원본과 맞춰 본 결과(값 대조 · 계산값 · 기사 보도)와 자료 기준도 거기서 볼 수 있어요. 기사는 &apos;기사 보기&apos; 로 바로 열려요.</p></li>
        <li><strong>끝으로, 이어서 알아볼까요</strong><p>머핀랩이 추천하는 연관 질문이에요. 고르면 질문이 채워져요.</p></li>
      </ol>}
      <div className="report-help-glossary"><strong>%와 %p</strong><p>%는 비율, %p는 두 비율의 차이를 나타내요. 금리가 3%에서 4%가 되면 1%p 오른 거예요.</p></div>
      <button type="button" className="report-help-done" onClick={() => dialog.current?.close()}>알겠어요</button>
    </dialog>
  </>;
}
