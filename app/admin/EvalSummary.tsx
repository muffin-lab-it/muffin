import type { ReactNode } from "react";
import styles from "./admin.module.css";

/**
 * evals.summary(주간 평가가 남긴 markdown)를 라이브러리 없이 그립니다 (리더, 11/13).
 * GitHub Actions 실행 페이지는 로그인하지 않으면 요약이 안 보여서, 같은 내용을 /admin 안에서 바로 읽게 합니다.
 * scripts/promptfoo/run.ts 가 만드는 요약은 제목(#) · 문단 · 표(|) · 목록(- ) 네 가지뿐이라 그 넷만 다룹니다. 글자는 React 가 그대로 escape 합니다.
 */
export function EvalSummary({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  const text = (s: string) => s.replace(/\*\*/g, "").trim();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trimStart().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => text(c));
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells); // |---|---| 구분줄은 뺍니다
        i += 1;
      }
      const [head, ...body] = rows;
      if (head) {
        blocks.push(
          <div key={blocks.length} className={styles.evalSummaryTable}>
            <table className={styles.evalTable}>
              <thead>
                <tr>{head.map((c, j) => <th key={j}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }
    const heading = /^(#+)\s*(.*)$/.exec(line);
    if (heading) {
      blocks.push(heading[1]!.length <= 1 ? <h3 key={blocks.length}>{text(heading[2]!)}</h3> : <h4 key={blocks.length}>{text(heading[2]!)}</h4>);
      i += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) {
        items.push(text(lines[i]!.slice(2)));
        i += 1;
      }
      blocks.push(<ul key={blocks.length}>{items.map((t, j) => <li key={j}>{t}</li>)}</ul>);
      continue;
    }
    blocks.push(<p key={blocks.length}>{text(line)}</p>);
    i += 1;
  }
  return <div className={styles.evalSummary}>{blocks}</div>;
}
