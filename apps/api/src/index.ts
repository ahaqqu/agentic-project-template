import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { resolveEnvName, type WorkerBindings } from "./env";
import { createRequestContext } from "./lib/context";
import { buildHealth } from "./routes/health";

type Vars = {
  correlationId: string;
};

const api = new Hono<{ Bindings: WorkerBindings; Variables: Vars }>();

api.use("*", secureHeaders());
api.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Correlation-Id"],
  }),
);

api.use("*", async (c, next) => {
  const id = c.req.header("X-Correlation-Id") ?? crypto.randomUUID();
  c.set("correlationId", id);
  c.header("X-Correlation-Id", id);
  await next();
});

api.get("/v1/health", (c) => {
  const ctx = createRequestContext(
    resolveEnvName(c.env.APP_ENV),
    c.get("correlationId"),
  );
  return c.json(buildHealth(ctx));
});

api.get("/openapi.json", (c) =>
  c.json({
    openapi: "3.1.0",
    info: { title: "Agentic Template API", version: "1.0.0" },
    paths: {
      "/v1/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "env", "schemaVersion", "message"],
                    properties: {
                      status: { const: "ok" },
                      env: {
                        enum: ["development", "staging", "production"],
                      },
                      schemaVersion: { type: "integer" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }),
);

api.get("/docs", (c) =>
  c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>API Docs</title></head>
<body><h1>Agentic Template API</h1>
<p><a href="/openapi.json">OpenAPI</a> · <a href="/v1/health">Health</a></p>
</body></html>`),
);

function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/v1/") ||
    pathname === "/openapi.json" ||
    pathname === "/docs"
  );
}

export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    // ExecutionContext from workers runtime; kept loose for root tsc without CF types.
    ctx: unknown,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      return api.fetch(request, env, ctx as never);
    }
    return env.ASSETS.fetch(request);
  },
};
