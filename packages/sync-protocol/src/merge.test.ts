import { describe, expect, it } from "vitest";
import { mergeRows } from "./merge";

describe("mergeRows", () => {
  it("merges by id", () => {
    const result = mergeRows(
      [{ id: "a", title: "one", done: false }],
      [{ id: "b", title: "two", done: true }],
    );
    expect(result).toHaveLength(2);
  });

  it("filters deleted", () => {
    const result = mergeRows(
      [{ id: "a", title: "one", done: false }],
      [{ id: "a", title: "one", done: false, deleted: true }],
    );
    expect(result).toHaveLength(0);
  });
});
