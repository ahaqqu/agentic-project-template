import { describe, expect, it } from "vitest";
import { getStore } from "./store";

describe("getStore", () => {
  it("returns singleton with schema and greeting", () => {
    const a = getStore();
    const b = getStore();
    expect(a).toBe(b);
    expect(a.getValue("schemaVersion")).toBe(1);
    expect(a.getValue("greeting")).toBe("Hello World");
  });
});
