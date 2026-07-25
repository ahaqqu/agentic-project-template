export type Row = {
  id: string;
  title: string;
  done: boolean;
  deleted?: boolean | undefined;
};

/** Deterministic merge: last non-deleted wins by id; delete always wins. */
export function mergeRows(a: Row[], b: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const row of [...a, ...b]) {
    const prev = map.get(row.id);
    if (!prev) {
      map.set(row.id, row);
      continue;
    }
    if (row.deleted || prev.deleted) {
      map.set(row.id, { ...row, ...prev, deleted: true, done: false });
      continue;
    }
    map.set(row.id, row);
  }
  return [...map.values()].filter((r) => !r.deleted);
}
