import { HealthResponseSchema, type HealthResponse } from "@app/contracts";
import { SCHEMA_VERSION } from "@app/local-first";
import * as v from "valibot";
import type { RequestContext } from "../lib/context";

export function buildHealth(ctx: RequestContext): HealthResponse {
  const body: HealthResponse = {
    status: "ok",
    env: ctx.envName,
    schemaVersion: SCHEMA_VERSION,
    message: "Hello World",
  };
  const parsed = v.parse(HealthResponseSchema, body);
  ctx.logger.info("health.ok", { schemaVersion: parsed.schemaVersion });
  return parsed;
}
