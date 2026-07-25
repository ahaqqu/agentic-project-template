import { test, fc } from "@fast-check/vitest";
import { expect } from "vitest";
import { mergeRows, type Row } from "./merge";

const rowArb: fc.Arbitrary<Row> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 32 }),
  done: fc.boolean(),
  deleted: fc.option(fc.constant(true), { nil: undefined }),
});

test.prop([fc.array(rowArb, { maxLength: 20 })])("merge is idempotent", (rows) => {
  const once = mergeRows([], rows);
  const twice = mergeRows(once, rows);
  expect(twice).toEqual(once);
});

test.prop([
  fc.array(rowArb, { maxLength: 10 }),
  fc.array(rowArb, { maxLength: 10 }),
])("merge is commutative", (a, b) => {
  const ab = mergeRows(a, b);
  const ba = mergeRows(b, a);
  const sort = (xs: Row[]) =>
    [...xs].sort((x, y) => x.id.localeCompare(y.id));
  expect(sort(ab)).toEqual(sort(ba));
});

test.prop([rowArb])("delete beats concurrent update", (row) => {
  const live: Row = { id: row.id, title: row.title, done: row.done };
  const update: Row = { ...live, title: `${live.title}-upd` };
  const del: Row = { ...live, deleted: true };
  const merged = mergeRows([update], [del]);
  expect(merged.find((r) => r.id === row.id)).toBeUndefined();
});
