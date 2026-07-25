export type AppEnvName = "development" | "staging" | "production";

export type WorkerBindings = {
  ASSETS: { fetch: typeof fetch };
  APP_ENV?: string;
};

export function resolveEnvName(raw: string | undefined): AppEnvName {
  if (raw === "staging" || raw === "production" || raw === "development") {
    return raw;
  }
  return "development";
}
