import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@app/infra";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  it("returns ok Hello World payload", () => {
    const sink = vi.fn();
    const result = buildHealth({
      envName: "production",
      correlationId: "test-id",
      logger: createLogger({}, sink),
    });
    expect(result).toEqual({
      status: "ok",
      env: "production",
      schemaVersion: 1,
      message: "Hello World",
    });
    expect(sink).toHaveBeenCalledOnce();
  });
});
