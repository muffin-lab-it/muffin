import styles from "./FinanceFloaters.module.css";

/**
 * 머핀 둘레에 두둥실 떠 있는 금융 그림 (11/25 사용자: 초기 시안처럼 동전 · 차트 카드 · 은행 · 반짝이). 홈과 진행 화면이 같이 씁니다.
 * 꾸밈이라 읽기 도구에는 숨기고, 움직임 줄이기 설정이면 멈춰 있습니다
 */
export function FinanceFloaters({ variant = "home" }: { variant?: "home" | "progress" }) {
  return (
    <div className={`${styles.floaters} ${styles[variant]}`} aria-hidden="true">
      <span className={`${styles.floater} ${styles.floatCoin}`}>
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#f6c453" /><circle cx="24" cy="24" r="17" fill="#f9d77a" stroke="#e5a92e" strokeWidth="2" /><text x="24" y="31" textAnchor="middle" fontSize="20" fontWeight="800" fill="#c98a12">$</text></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatCard} ${styles.floatPie}`}>
        <svg viewBox="0 0 64 40"><circle cx="16" cy="20" r="11" fill="#e7dcf8" /><path d="M16 20 L16 9 A11 11 0 0 1 26.5 23 Z" fill="#8b5cf6" /><rect x="32" y="13" width="24" height="4" rx="2" fill="#d9d3e6" /><rect x="32" y="22" width="18" height="4" rx="2" fill="#e8e3f0" /></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatCard} ${styles.floatLine}`}>
        <svg viewBox="0 0 72 44"><line x1="8" y1="38" x2="64" y2="38" stroke="#e5def0" strokeWidth="2" /><path d="M8 33 L22 25 L32 29 L46 16 L60 10" fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M53 8 L60 10 L58 17" fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatCard} ${styles.floatBank}`}>
        <svg viewBox="0 0 40 40"><path d="M20 7 L33 14 H7 Z" fill="#8b5cf6" /><rect x="9.5" y="16" width="4" height="12" rx="1" fill="#a78bfa" /><rect x="18" y="16" width="4" height="12" rx="1" fill="#a78bfa" /><rect x="26.5" y="16" width="4" height="12" rx="1" fill="#a78bfa" /><rect x="7" y="30" width="26" height="4" rx="1.5" fill="#8b5cf6" /></svg>
      </span>
      <span className={`${styles.floater} ${styles.floatBars}`}>
        <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="21" fill="#8b5cf6" /><rect x="12" y="24" width="5" height="9" rx="1.5" fill="#fff" /><rect x="19.5" y="18" width="5" height="15" rx="1.5" fill="#fff" /><rect x="27" y="12" width="5" height="21" rx="1.5" fill="#fff" /></svg>
      </span>
      <span className={`${styles.spark} ${styles.spark1}`} /><span className={`${styles.spark} ${styles.spark2}`} /><span className={`${styles.spark} ${styles.spark3}`} />
    </div>
  );
}
