import styles from "./admin.module.css";

/** 실행 로그를 불러오는 동안 실제 칸 모양으로 자리만 보여 줍니다. */
export default function AdminLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="실행 로그를 불러오는 중">
      <h1 className={styles.title}>실행 모니터링</h1>
      <div className={styles.skBanner} />
      <div className={styles.kpis}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.skKpi} />
        ))}
      </div>
      <div className={styles.gridMain}>
        <div className={styles.skPanel} />
        <div className={styles.skPanel} />
      </div>
    </div>
  );
}
