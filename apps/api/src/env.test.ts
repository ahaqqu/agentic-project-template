import { describe, expect, it } from "vitest";
import { resolveEnvName } from "./env";

describe("resolveEnvName", () => {
  it("maps known values", () => {
    expect(resolveEnvName("staging")).toBe("staging");
    expect(resolveEnvName("production")).toBe("production");
    expect(resolveEnvName("development")).toBe("development");
  });

  it("defaults unknown to development", () => {
    expect(resolveEnvName(undefined)).toBe("development");
    expect(resolveEnvName("local")).toBe("development");
  });
});
