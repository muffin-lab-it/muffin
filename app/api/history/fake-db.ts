/**
 * 테스트 전용: Supabase 쿼리 빌더 중 History 저장소가 쓰는 부분만 메모리에서 흉내 냅니다.
 * select · insert · delete, eq · lt · in, order · limit · range, single · maybeSingle 을 지원하고, 고유키(id) 충돌은 23505 로 돌려줍니다.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

export function createFakeDb(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const state = { failNext: undefined as string | undefined };

  function from(table: string) {
    if (table !== "reports") throw new Error(`알 수 없는 표: ${table}`);
    let op: "select" | "insert" | "delete" = "select";
    let columns: string[] | undefined;
    let inserted: Row | undefined;
    const filters: ((r: Row) => boolean)[] = [];
    let orderBy: { key: string; ascending: boolean } | undefined;
    let slice: [number, number] | undefined;
    let mode: "many" | "single" | "maybeSingle" = "many";
    let returning = false;

    const pick = (r: Row) => (columns ? Object.fromEntries(columns.map((c) => [c, r[c]])) : { ...r });

    function run(): Result {
      if (state.failNext) {
        const message = state.failNext;
        state.failNext = undefined;
        return { data: null, error: { message } };
      }
      let out: Row[];
      if (op === "insert") {
        const row = { created_at: new Date(Date.now() + rows.length).toISOString(), steps: [], ...inserted } as Row;
        if (rows.some((r) => r.id === row.id)) return { data: null, error: { message: "duplicate key", code: "23505" } };
        rows.push(row);
        out = [row];
      } else {
        out = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "delete") {
          for (const r of out) rows.splice(rows.indexOf(r), 1);
          if (!returning) return { data: null, error: null };
        }
      }
      if (orderBy) {
        const { key, ascending } = orderBy;
        out = [...out].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1) * (ascending ? 1 : -1));
      }
      if (slice) out = out.slice(slice[0], slice[1]);
      const data = out.map(pick);
      if (mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not single" } };
      if (mode === "maybeSingle") return { data: data[0] ?? null, error: null };
      return { data, error: null };
    }

    const builder = {
      select(cols = "*") {
        if (op === "select") op = "select";
        else returning = true;
        columns = cols === "*" ? undefined : cols.split(",").map((c) => c.trim());
        return builder;
      },
      insert(row: Row) {
        op = "insert";
        inserted = row;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(key: string, value: unknown) {
        filters.push((r) => r[key] === value);
        return builder;
      },
      lt(key: string, value: string) {
        filters.push((r) => String(r[key]) < value);
        return builder;
      },
      in(key: string, values: unknown[]) {
        filters.push((r) => values.includes(r[key]));
        return builder;
      },
      order(key: string, opts: { ascending: boolean }) {
        orderBy = { key, ascending: opts.ascending };
        return builder;
      },
      limit(n: number) {
        slice = [0, n];
        return builder;
      },
      range(start: number, end: number) {
        slice = [start, end + 1];
        return builder;
      },
      single() {
        mode = "single";
        return builder;
      },
      maybeSingle() {
        mode = "maybeSingle";
        return builder;
      },
      then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
      },
    };
    return builder;
  }

  return { rows, state, db: { from } };
}
