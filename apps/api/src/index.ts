import * as Sentry from "@sentry/cloudflare";
import {
  createMemoryConfigStore,
  createMemoryObjectStore,
  createR2ObjectStore,
} from "@app/infra";
import { SCHEMA_VERSION } from "@app/sync-protocol";
import { createApi } from "./app";
import type { WorkerBindings } from "./env";

const api = createApi();

function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/v1/") ||
    pathname === "/openapi.json" ||
    pathname === "/docs"
  );
}

const handler = {
  async fetch(
    request: Request,
    env: WorkerBindings,
    ctx: unknown,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      try {
        return await api.fetch(request, env, ctx as never);
      } catch (err) {
        Sentry.captureException(err);
        if (err instanceof Error && err.message === "db_unbound") {
          return Response.json({ error: "db_unbound" }, { status: 503 });
        }
        return Response.json({ error: "internal" }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: unknown, env: WorkerBindings): Promise<void> {
    const store = env.BUCKET
      ? createR2ObjectStore(env.BUCKET)
      : createMemoryObjectStore();
    const config = createMemoryConfigStore();
    const stamp = new Date().toISOString();
    await store.put(
      `backups/${stamp}.json`,
      JSON.stringify({
        at: stamp,
        schemaVersion: SCHEMA_VERSION,
        flag: await config.get("backup"),
      }),
    );
  },
};

// Errors-only Sentry. Passthrough when SENTRY_DSN is unset: `enabled: false`
// means the SDK client stays disabled — nothing is captured or sent.
export default Sentry.withSentry(
  (env: WorkerBindings) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.APP_ENV ?? "development",
    tracesSampleRate: 0,
  }),
  handler,
);
