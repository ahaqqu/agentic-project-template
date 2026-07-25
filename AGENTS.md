# AGENTS.md

Task guardrails for AI agents. Read before implementation. For philosophy and rationale, see `docs/ARCHITECTURE.md`.

## Universal

- When writing business logic, you MUST use adapters in `packages/infra`. You MUST NEVER access `env.*` bindings directly.
- When adding a dependency, you MUST verify free-tier compatibility. You MUST NEVER add paid services to the critical path.
- When writing SQL, you MUST use only standard features. You MUST NEVER use SQLite-specific or D1-specific extensions.
- When implementing sync, you MUST use Tinybase MergeableStore CRDT. You MUST NEVER hand-roll last-write-wins.
- When adding user-facing strings, you MUST externalize for `en` and `id`. You MUST NEVER hardcode copy.
- When logging, you MUST use the Logger adapter with structured JSON. You MUST NEVER use `console.log`.
- When storing session data, you MUST use D1. You MUST NEVER use KV for write-path operations.

## Routes

- When adding a route, you MUST define the Zod schema in `packages/shared-zod` before implementation.
- When defining a route, you MUST use `@hono/zod-openapi` on shared schemas. The route MUST be under `/v1/`.
- When adding a route, you MUST regenerate the OpenAPI spec. Docs at `/docs` MUST NOT drift.

## Schema Changes

- When changing the database schema, you MUST write a Drizzle migration in `packages/db-schema/migrations/`.
- When changing the database schema, you MUST write a client migration in `apps/web/src/lib/migrations/`.
- When changing the database schema, you MUST bump `SCHEMA_VERSION` in `packages/sync-protocol`.
- When changing merge logic, you MUST add property tests for idempotency, commutativity, and delete propagation. See `.agents/skills/writing-tests/SKILL.md` for patterns.
- When writing tests, you MUST follow the patterns in `.agents/skills/writing-tests/SKILL.md`. Use Vitest for unit tests, fast-check for property tests, and Playwright-BDD for user-facing flows.

## Components

- When adding a component, you SHOULD use shadcn/ui primitives or follow the same custom pattern.
- When adding a component, you MUST wrap all user-facing strings with i18n.
- When formatting dates, numbers, or currency, you MUST use the `Intl` API.
- When styling, you MUST use Tailwind CSS only. You MUST NEVER use runtime CSS-in-JS.

## Sync

- When writing sync logic, you MUST make all writes optimistic into MergeableStore. The UI MUST react immediately.
- When writing sync logic, you MUST persist changes to IndexedDB in the same tick.
- When writing sync logic, you MUST batch via `POST /v1/sync`. You MUST NEVER use polling loops.
- When handling sync failures, you MUST retry with exponential backoff. You MUST stop on permanent errors.
- When sending sync requests, you MUST include `schemaVersion` and `clientVersion`.
- When implementing merge logic, you MUST make it idempotent, commutative, and propagate deletes.
- When handling multi-tab, you MUST elect a single leader. Peers MUST receive state via BroadcastChannel.

## Adapters

- When adding an adapter, you MUST define the interface in `packages/infra/` first.
- When implementing an adapter, you MUST inject via env vars. Business logic MUST NEVER import Cloudflare-specific types.

## Payments

See `.agents/skills/payment-integration/SKILL.md` for detailed payment, webhook, and entitlement guidance.

- When adding a payment integration, you MUST use the Payments adapter interface. You MUST NEVER call provider APIs directly.
- When writing webhook handlers, you MUST verify signatures before JSON parsing.
- When writing webhook handlers, you MUST make them idempotent.
- When gating premium features, you MUST check entitlements via ConfigStore at the edge.

## Security

- When validating input, you MUST use Zod at every external boundary.
- When handling secrets, you MUST use `wrangler secret`. You MUST NEVER commit secrets to the repo.
- When setting headers, you MUST apply `secure-headers` middleware and lock CORS to known origins.

## Definition of Done

- [ ] All CI gates green (via the `vp` Vite+ task runner — see `docs/ARCHITECTURE.md` §14): `vp check`, `vp test`, coverage > 80%, `size-limit`, security scans.
- [ ] Contracts written before implementation.
- [ ] API or UI changes: BDD tests added covering the user-facing flow.
- [ ] Schema changes: server migration + client migration + `SCHEMA_VERSION` bump.
- [ ] New routes: zod-openapi contract defined; docs regenerate cleanly.
- [ ] No new paid dependency in the critical path.
- [ ] Nothing sensitive in the diff.
- [ ] Architectural changes documented in PR description.
