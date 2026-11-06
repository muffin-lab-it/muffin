"use client";

import type { ReactNode } from "react";
import type { Evidence, Report } from "@/src/agent/schema";
import { ReportEvidenceLink, ReportSectionLink, useEvidenceTarget } from "./ReportEvidenceScope";

/** 장부나 저장 기록에서 온 URL도 웹 주소인 경우에만 링크로 표시합니다. */
export function SourceLink({ url, name }: { url: string; name: string }) {
  let safe = false;
  try {
    const parsed = new URL(url);
    safe = parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    // 주소가 없거나 잘못되었어도 출처명과 기준일은 보존합니다.
  }
  return safe ? (
    <a href={url} target="_blank" rel="noopener noreferrer">{name}</a>
  ) : (
    <span>{name} <small className="report-muted">(연결 가능한 출처 주소 없음)</small></span>
  );
}

export function EvidenceReference({ evidenceId, evidence, label = "자료 출처 자세히 보기", children }: {
  children?: ReactNode;
  label?: string;
  evidenceId: string | null;
  evidence: Evidence[];
}) {
  const entry = evidence.find((item) => item.id === evidenceId);
  const targetId = useEvidenceTarget(evidenceId ?? "missing");
  if (!entry) {
    return (
      <>
      {children}
      <p className="evidence-missing">
        {evidenceId ? `${evidenceId} · 근거를 찾을 수 없음` : "근거 번호 없음 · 원본을 대조할 수 없습니다."}
      </p>
      </>
    );
  }
  if (targetId) return <ReportEvidenceLink targetId={targetId} label={label} className={children ? "metric-value-link" : ""}>{children}</ReportEvidenceLink>;
  return (
    <details className="evidence-detail">
      <summary>출처·기준일 보기</summary>
      <EvidenceContent entry={entry} evidence={evidence} />
    </details>
  );
}

export function EvidenceRecord({ entry, evidence }: { entry: Evidence; evidence: Evidence[] }) {
  const id = useEvidenceTarget(entry.id);
  return <div className="evidence-record" id={id ?? undefined} tabIndex={-1}><EvidenceContent entry={entry} evidence={evidence} /></div>;
}

function EvidenceContent({ entry, evidence }: { entry: Evidence; evidence: Evidence[] }) {
  return (
      <div className="evidence-content">
        <p className="evidence-title">{entry.label}</p>
        <p className="evidence-help">{entry.lineage
          ? "여러 자료를 조합한 계산값이에요. 아래 계산 내역에서 사용한 자료를 확인하세요."
          : "리포트 작성에 참고한 원본 값이에요. 출처를 누르면 원문에서 맥락을 확인할 수 있어요."}</p>
        <div className="evidence-source">
          <p><SourceLink url={entry.source.url} name={entry.source.name} /></p>
          <p><strong>기준일</strong> {entry.source.asOf || "제공되지 않음"}</p>
        </div>
        {Object.keys(entry.values).length > 0 ? (
          <dl className="evidence-values">
            {Object.entries(entry.values).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
        ) : <p className="evidence-missing">공개된 원본 값이 없습니다.</p>}
        <p className="evidence-id">근거 번호: {entry.id}</p>
        {entry.lineage && (
          <div className="evidence-lineage">
            <p>계산 연산: {entry.lineage.op}</p>
            <p>입력 근거: {entry.lineage.inputs.length > 0 ? entry.lineage.inputs.map((id) => (
              evidence.some((item) => item.id === id) ? id : `${id} (근거를 찾을 수 없음)`
            )).join(", ") : "제공되지 않음"}</p>
            <p className="report-muted">계산 계보 표시만으로 재계산 검증을 보장하지 않습니다.</p>
          </div>
        )}
      </div>
  );
}

const checkLabels = { verified: "값 대조", derived: "계산값", reported: "기사 보도", unverified: "미검증" } as const;
const policyLabels = { exact: "정확히 일치", rounded: "표기 반올림과 일치", scaled: "단위를 환산해 일치", tolerance: "허용 오차 0.1% 안에서 일치" } as const;

/** 숫자 카드 하나를 검증이 어떻게 확인했는지 한 줄 */
export function numberCheckDetail(n: Report["numbers"][number], evidence: Evidence[]): string {
  const entry = evidence.find((e) => e.id === n.ref);
  const ref = n.ref ?? "근거 번호 없음";
  if (n.check === "verified") return n.match ? `${ref} 의 ${n.match.key} 값과 ${policyLabels[n.match.policy]}` : `${ref} 의 장부 값과 일치`;
  if (n.check === "derived") {
    const lineage = entry?.lineage;
    return lineage ? `${ref} 계산값 (${lineage.op} ← ${lineage.inputs.join(", ")})${n.match ? ` · ${n.match.key} 와 ${policyLabels[n.match.policy]}` : ""}` : `${ref} 계산값`;
  }
  if (n.check === "reported") {
    const where = n.match ? `${ref} 의 ${n.match.key.replace(/#text$/, "")} 와 ${policyLabels[n.match.policy]}` : `${ref} 기사 제목에 나온 숫자`;
    return `${where} (보도일 뿐 공식 데이터로 확인한 것이 아님)`;
  }
  return "검증기를 거치지 않았거나 대조하지 못함";
}

/**
 * 검증이 한 일을 풀어 보여 줍니다 (숫자마다 어느 장부 값과 어떤 규칙으로 맞았는지 · 원인의 근거 종류 · 다시 쓰기 · 제외한 항목 수).
 * 데이터는 모두 검증기(src/agent/verify.ts)가 리포트에 적어 둔 것이고 화면은 읽기만 합니다.
 */
export function VerificationDetail({ report }: { report: Report }) {
  const v = report.verification;
  return (
    <details className="evidence-detail verification-detail">
      <summary>숫자를 어떻게 확인했나요?</summary>
      <div className="evidence-content">
        <p className="evidence-help">각 숫자가 어떤 원본 값과 맞았는지 확인하는 기록이에요. 아래에서 관심 있는 숫자의 이름을 찾아보세요.</p>
        <dl className="verification-guide">
          <div><dt>값 대조</dt><dd>인용한 자료의 값과 맞춰 보았어요.</dd></div>
          <div><dt>계산값</dt><dd>자료를 조합한 계산 결과를 사용했어요.</dd></div>
          <div><dt>기사 보도</dt><dd>기사에 나온 숫자예요. 공식 통계 확인과는 달라요.</dd></div>
          <div><dt>미검증</dt><dd>원본 값과의 대조가 확인되지 않았어요.</dd></div>
        </dl>
        {report.numbers.length > 0 ? (
          <ol className="verification-list">
            {report.numbers.map((n, i) => (
              <li key={i}>
                <b>{n.label}</b> {n.value} → <span className={`report-badge check-${n.check}`}>{checkLabels[n.check]}</span> {numberCheckDetail(n, report.evidence)}
              </li>
            ))}
          </ol>
        ) : (
          <p className="report-muted">숫자 카드가 없습니다.</p>
        )}
        <p>원인 {report.why.length}개: 데이터 인용 {v.why.data} · 보도 기반 {v.why.news} · 근거 부족 {v.why.none}</p>
        <p>
          다시 쓰기 {v.revisions}회{v.revisionSkipped ? " · 마감이 가까워 다시 쓰지 않고 걸린 항목을 바로 뺐습니다" : ""} · 검사 후 제외 {v.removed.length}개
          {v.removed.length > 0 ? " (아래 「검사 후 제외한 항목」)" : ""}
        </p>
      </div>
    </details>
  );
}

export function ReportReadingNotice({ report }: { report: Report }) {
  return (
    <div className="report-reading-notice">
      {report.verification.status === "skipped" && (
        <p><strong>검사 미실행</strong> · 숫자와 원인 설명을 출처에서 직접 확인해 주세요.</p>
      )}
      {report.verification.status === "partial" && (
        <div className="verification-notice">
          <strong>일부 확인 필요</strong>
          <ul>
            {report.verification.removed.length > 0 && <li>검사 과정에서 제외하거나 조정한 항목이 {report.verification.removed.length}개 있어요.</li>}
            {report.verification.advice > 0 && <li>권유로 해석될 수 있는 표현이 {report.verification.advice}건 남아 있어요.</li>}
            {report.verification.removed.length === 0 && report.verification.advice === 0 && <li>저장된 검사 결과가 부분 확인 상태예요. 구체적인 사유는 기록에서 확인해 주세요.</li>}
          </ul>
          <p>인용한 자료는 <ReportSectionLink name="sources" label="출처와 근거" />, 처리 내역은 <ReportSectionLink name="verification" label="리포트 상세 정보" />에서 확인하세요.</p>
        </div>
      )}
      {report.notice && <p className="report-notice">{report.notice}</p>}
    </div>
  );
}

export function ReportVerification({ report }: { report: Report }) {
  const verification = report.verification;
  const skipped = verification.status === "skipped";
  const labels = { skipped: "검사 미실행", partial: "일부 확인 필요", pass: "검사 통과" };
  return (
    <section className="report-verification" aria-label="리포트 검증 상태">
      <div className="verification-heading">
        <h2>1. 검사 결과 읽기</h2>
        <span className={`report-badge status-${verification.status}`}>{labels[verification.status]}</span>
      </div>
      {skipped ? (
        <p>이 리포트는 검증기를 거치지 않았습니다. 숫자와 원인 설명을 출처에서 직접 확인해 주세요.</p>
      ) : (
        <>
          <p className="evidence-help">총 {verification.numbers.total}개 숫자를 아래 방식으로 확인했어요. 이 분류는 정보의 최신 여부를 뜻하지 않아요.</p>
          <dl className="verification-stats">
            <div><dt>값 대조</dt><dd>{verification.numbers.verified}개</dd></div>
            <div><dt>계산값</dt><dd>{verification.numbers.derived}개</dd></div>
            <div><dt>기사 보도</dt><dd>{verification.numbers.reported ?? 0}개</dd></div>
            <div><dt>미검증</dt><dd>{verification.numbers.unverified}개</dd></div>
          </dl>
          <p className="report-muted">값 대조는 인용한 원본 값과의 일치 검사입니다. 날짜·단위·지표의 의미와 원인 관계 전체의 정확성을 보장하지 않습니다.</p>
          <p className="report-muted">권유 표현 패턴 감지 {verification.advice}건 · 수정 {verification.revisions}회 · 제외 항목 {verification.removed.length}개</p>
          <VerificationDetail report={report} />
        </>
      )}
    </section>
  );
}
