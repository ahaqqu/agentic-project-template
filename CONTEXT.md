# CONTEXT

Mental model for agents working in this repo.

## What this is

Working Hello World monorepo implementing `docs/ARCHITECTURE.md`. Not a prose-only template.

## Layout

- `apps/api` — Hono Worker; owns `/v1/*`, `/docs`, `/openapi.json`; forwards other paths to `ASSETS`
- `apps/web` — React 19 PWA (en/id Hello World + health panel)
- `packages/shared-zod` — contracts (e.g. `HealthResponseSchema`)
- `packages/sync-protocol` — `SCHEMA_VERSION`, `mergeRows` (+ property tests)
- `packages/infra` — `createLogger` adapter (no `console.log` in business logic)
- `packages/db-schema` — Drizzle `greetings` table (ready for D1 binding)

## Gates

`bun run check` · `bun run test` · `bun run build` · `bun run size-limit`

## Deploy

`bun run deploy` (login) or `bun run deploy:temp` (preview account)
