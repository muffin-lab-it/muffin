import type { Evidence, Report } from "@/src/agent/schema";

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

export function EvidenceReference({ evidenceId, evidence }: {
  evidenceId: string | null;
  evidence: Evidence[];
}) {
  const entry = evidence.find((item) => item.id === evidenceId);
  if (!entry) {
    return (
      <p className="evidence-missing">
        {evidenceId ? `${evidenceId} · 근거를 찾을 수 없음` : "근거 번호 없음 · 원본을 대조할 수 없습니다."}
      </p>
    );
  }
  return (
    <details className="evidence-detail">
      <summary>원본 보기 · {entry.id}</summary>
      <div className="evidence-content">
        <p className="evidence-title">{entry.label}</p>
        <p><SourceLink url={entry.source.url} name={entry.source.name} /></p>
        <p>출처 기준일: {entry.source.asOf || "제공되지 않음"}</p>
        <p className="report-muted">도구 응답에서 추린 핵심 값입니다.</p>
        {Object.keys(entry.values).length > 0 ? (
          <dl className="evidence-values">
            {Object.entries(entry.values).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
            ))}
          </dl>
        ) : <p className="evidence-missing">공개된 원본 값이 없습니다.</p>}
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
    </details>
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
      <summary>검증이 한 일 보기</summary>
      <div className="evidence-content">
        <p className="report-muted">규칙: 숫자는 tool 이 돌려준 장부 값과 하나하나 대조하고, 장부에 없는 숫자와 투자 권유 표현은 뺍니다. 계산값은 계산 도구의 결과(C 번호)이고, 기사 보도는 기사 제목의 숫자라 공식 데이터는 아닙니다.</p>
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

export function ReportVerification({ report }: { report: Report }) {
  const verification = report.verification;
  const skipped = verification.status === "skipped";
  const labels = { skipped: "검사 미실행", partial: "일부 확인 필요", pass: "검사 통과" };
  return (
    <section className="report-verification" aria-label="리포트 검증 상태">
      <div className="verification-heading">
        <h2>이 리포트의 확인 범위</h2>
        <span className={`report-badge status-${verification.status}`}>{labels[verification.status]}</span>
      </div>
      {skipped ? (
        <p>이 리포트는 검증기를 거치지 않았습니다. 숫자와 원인 설명을 출처에서 직접 확인해 주세요.</p>
      ) : (
        <>
          <p>숫자 {verification.numbers.total}개 중 값 대조 {verification.numbers.verified}개 · 계산값 {verification.numbers.derived}개 · 기사 보도 {verification.numbers.reported ?? 0}개 · 미검증 {verification.numbers.unverified}개</p>
          <p className="report-muted">값 대조는 인용한 원본 값과의 일치 검사입니다. 날짜·단위·지표의 의미와 원인 관계 전체의 정확성을 보장하지 않습니다.</p>
          <p className="report-muted">권유 표현 패턴 감지 {verification.advice}건 · 수정 {verification.revisions}회 · 제외 항목 {verification.removed.length}개</p>
          <VerificationDetail report={report} />
        </>
      )}
      <p className="report-disclosure">{report.disclosure}</p>
      {report.notice && <p className="report-notice">{report.notice}</p>}
    </section>
  );
}
