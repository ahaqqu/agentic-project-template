# Overhaul Plan: Skill/Doc Coherence & Agentic Workflow

Tracking issue for the full overhaul of `.agents/skills`, `AGENTS.md`, `README.md`, and supporting tooling to match the current `docs/ARCHITECTURE.md` / `CONTEXT.md` reality, plus a new orchestration skill and convenience scripts.

## Context

- Target repo: `agentic-project-template`.
- Current stack (post-remediation): Valibot contracts in `packages/contracts` (`@app/contracts`), Hono + `hono-openapi`, custom LWW-element-set CRDT in `packages/local-first` (`@app/local-first`), raw-SQL migrations in `apps/api/migrations/`, Cloudflare free-tier adapters in `packages/infra` (`@app/infra`).
- Problem: several skills still reference the old Zod / `packages/shared-zod` / `@hono/zod-openapi` / Tinybase / Drizzle stack, which will mislead agents.
- Goal: make every skill coherent with the architecture, and improve the agentic developer flow with an explicit orchestration skill, an `openapi:check` convenience script, and clear docs.

## Principles

- Single source of truth: `docs/ARCHITECTURE.md` and `AGENTS.md`. Skills must not contradict them.
- Minimal, targeted edits. Preserve existing leading words and skill style where possible.
- No new paid dependencies. No changes to business logic unless required by tooling.
- Every doc/tool change must be verifiable by a gate or a manual step in this plan.

## Workstreams

### WS1 — Skill drift remediation

Update the following skills so their guardrails, examples, and checklists match the repo:

1. **`code-review/SKILL.md`**
   - Replace "Zod" / `packages/shared-zod` / `@hono/zod-openapi` with Valibot / `@app/contracts` / `hono-openapi`.
   - Replace "Tinybase MergeableStore CRDT" with custom LWW-element-set CRDT in `packages/local-first`.
   - Replace "Drizzle migrations" with raw SQL migrations in `apps/api/migrations/` + client migrations in `packages/local-first`.
   - Keep the philosophy-alignment structure; update only the outdated claims.

2. **`pr-creation/SKILL.md`**
   - Replace "zod-openapi contract defined" with Valibot + `hono-openapi` route definition.
   - Replace "Drizzle migrations" with raw SQL migration + client migration + `SCHEMA_VERSION` bump.
   - Keep the PR title/body template.

3. **`writing-tests/SKILL.md`**
   - Replace property-test examples importing `createMergeableStore` from `tinybase` with examples using `mergeNotes` from `@app/local-first`.
   - Update "Zod schema" wording to "Valibot schema" in unit-test patterns.
   - Keep the layer-decision table aligned with ARCHITECTURE.md §10.

4. **`ship/SKILL.md`**
   - Fix smoke-test example to match the Notes feature (e.g., `POST /v1/auth/anonymous` + notes sync/health) instead of generic widgets.
   - Replace "zod-openapi schema" with "hono-openapi / Valibot definitions".
   - Remove or correct the `wrangler secret put DATABASE_URL` line; D1 is a `wrangler.toml` binding, not a secret.

5. **`plan-review/SKILL.md` and `grill-with-docs/SKILL.md`**
   - Replace "Zod" with "Valibot" / "`@app/contracts`" in checklists and glossary wording.
   - Keep the architecture-principle checklists intact.

### WS2 — New orchestration skill

Create `.agents/skills/agentic-workflow/SKILL.md`:

- **User-invoked only** (`disable-model-invocation: true`).
- Trigger phrase: when the user asks "agentic workflow".
- Purpose: map the recommended end-to-end agent pipeline to concrete skill names.
- Body:
  - State the pipeline: `grill-with-docs` → `to-spec` → `to-tickets` → `plan-review` → `guided-implementation` → `writing-tests` → `pr-creation` → `code-review` → `ship`.
  - Explain when to skip/loop back (e.g., trivial fixes skip `grill-with-docs`/`to-spec`/`to-tickets`; bug fixes start with `diagnosing-bugs`).
  - Reference `AGENTS.md` Definition of Done and `docs/ARCHITECTURE.md` §14 tooling.
  - Provide a one-paragraph "start here" for each phase.
- Do **not** duplicate the full content of each linked skill; only reference them.

### WS3 — Doc/tooling pointers

1. **`README.md`**
   - Keep the existing pipeline diagram (`grill-with-docs → ... → ship`).
   - Add a sentence: "To see the full agentic workflow, invoke the `agentic-workflow` skill."

2. **`AGENTS.md`**
   - In the orchestration/phase sections, replace the flat "See `.agents/skills/...`" list with a brief note pointing to the `agentic-workflow` skill for sequencing.
   - Ensure the orchestration pointer does not break the existing phase structure.

3. **`docs/ARCHITECTURE.md`** quota monitoring
   - Add a clarifying sentence under §1 Free-tier constraints: "Quota monitoring remains a manual runbook (`docs/QUOTA.md`) because Cloudflare free-tier analytics do not expose an API that supports an automated CI gate at this time."

### WS4 — Convenience tooling

Add a `bun run openapi:check` script:

- Script: `scripts/openapi-check.mjs`.
- Implementation: import the built Hono app from `apps/api/src/app.ts`, extract the generated `/openapi.json` document, write it to a temp file or stdout, and compare with `apps/api/public/openapi.json` if it exists; otherwise verify the document parses and contains expected routes.
  - If a route-coverage test already exists and is reliable, the script can delegate to it.
  - Must be agent-runnable and fast (<5 s).
- Add to root `package.json` scripts.
- Do **not** add it to `ci.yml` unless it is proven green first.

### WS5 — Verification

After all edits:

1. Run `bun install` if `package.json` changed.
2. Run:
   - `bun run check`
   - `bun run test`
   - `bun run size-limit`
   - `bun run agentic-limits`
   - `bun run truth`
   - `bun run e2e`
   - `bun run openapi:check` (new)
3. Grep for residual outdated terms in `.agents/skills` and `docs`:
   - `Zod`, `zod-openapi`, `packages/shared-zod`, `tinybase`, `Tinybase`, `MergeableStore`, `Drizzle`, `drizzle`.
4. Confirm no new files exceed 300 lines / 5 imports outside tests/index barrels.

## Definition of Done

- [ ] Every skill updated in WS1 no longer contains outdated stack references.
- [ ] New `agentic-workflow` skill exists and is user-invoked only.
- [ ] `README.md` and `AGENTS.md` point to the orchestration skill.
- [ ] `docs/ARCHITECTURE.md` clarifies the manual quota runbook.
- [ ] `bun run openapi:check` exists and runs green.
- [ ] All CI gates pass locally.
- [ ] Residual drift grep returns zero matches in `.agents/skills` and `docs`.

## Tracking

Use the in-session todo list. Each workstream moves from `in_progress` to `completed` only after its files are edited and, where applicable, its gate passes.

## Notes / Decisions

- `payment-integration/SKILL.md` is **kept as-is** per user instruction; it is a forward-looking guide for consuming projects. Add no new note.
- `opencode.json` is **not** created; skills live as `SKILL.md` files and the orchestration skill is user-invoked only.
- No changes to business logic, schema, or migrations are required for this overhaul.
