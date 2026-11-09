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
        <li><strong>먼저, 한입 요약과 숫자</strong><p>궁금했던 변화와 주요 수치를 빠르게 살펴보세요. 숫자 아래 날짜는 해당 자료가 가리키는 시점이에요.</p></li>
        <li><strong>이어서, 배경과 생활 영향</strong><p>무엇이 변화와 관련되는지, 내 생활에는 어떻게 이어지는지 읽어보세요.</p></li>
        <li><strong>더 궁금하면, 정확한 데이터로 보는 금융</strong><p>숫자나 설명을 누르면 아래에서 관련 자료가 선택돼요. 환율·금리 등의 칩을 바꾸면서 해설과 원본 값을 비교할 수 있어요.</p></li>
      </ol>}
      <div className="report-help-glossary"><strong>%와 %p</strong><p>%는 비율, %p는 두 비율의 차이를 나타내요. 금리가 3%에서 4%가 되면 1%p 오른 거예요.</p></div>
      <button type="button" className="report-help-done" onClick={() => dialog.current?.close()}>알겠어요</button>
    </dialog>
  </>;
}
