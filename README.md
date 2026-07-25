# Agentic Project Template

A working full-stack starter for building products with AI agents — not an empty scaffold.

You get a deployable Hello World (Cloudflare Workers + React PWA), architecture rules, and a skill pipeline that takes features from idea → ship.

## Purpose

Build local-first, free-tier-friendly products where agents can implement safely and consistently.

| Goal | How |
|---|---|
| Cheap to run | Cloudflare free tier; no paid deps on the critical path |
| Works offline | Tinybase CRDT client store; sync is opportunistic |
| Fast & small | &lt;200 KB gzipped JS; Tailwind; PWA |
| Agent-ready | Small files, Zod contracts, adapters, CI gates |
| Quality by default | Contracts-first, tests, coverage &gt;80% |

Philosophy: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)  
Agent rules: [`AGENTS.md`](AGENTS.md)  
Code map: [`CONTEXT.md`](CONTEXT.md)

## Stack

| Layer | Choice |
|---|---|
| Edge | Cloudflare Workers + static assets |
| API | Hono (`/v1/*`) |
| Web | React 19 + TanStack Query + Tailwind + PWA |
| Contracts | Zod (`packages/shared-zod`) |
| State | Tinybase MergeableStore |
| Data | Drizzle + D1-ready schema |
| Infra | Adapters in `packages/infra` (Logger, …) |
| Tooling | Bun, Vitest, Wrangler |

```
apps/api          Worker + /v1/health + serves web assets
apps/web          Hello World PWA (en + id)
packages/*        shared-zod, sync-protocol, infra, db-schema
.agents/skills/   agent workflows
```

## Setup a new project

This repo **is** the project. Copy it, then make it yours.

### 1. Create the repo

```bash
# from a copy/fork/template use of this repository
cd your-new-project
bun install
```

### 2. Rename

- `package.json` → project name  
- `apps/api/wrangler.toml` → `name = "your-app"`  
- Package scope `@app/*` if you want a different org name  

### 3. Cloudflare credentials

Create a gitignored `.env` in the repo root:

```bash
CLOUDFLARE_ACCOUNT_ID=…
CLOUDFLARE_API_TOKEN=…   # needs Workers Scripts:Edit (+ Account Settings:Read)
```

Never commit secrets. Runtime secrets: `wrangler secret put …`

### 4. Verify

```bash
bun run check
bun run test
bun run build
bun run size-limit
bun run dev          # local: wrangler dev
bun run deploy       # production Worker
```

Smoke after deploy:

- `https://<your-worker>.workers.dev/` — web app  
- `https://<your-worker>.workers.dev/v1/health` — API  

Optional: `bun run deploy:staging` or `bun run deploy:temp` (preview account).

### 5. Point agents at the docs

Agents should read, in order:

1. `AGENTS.md` — must-follow rules  
2. `docs/ARCHITECTURE.md` — why  
3. `CONTEXT.md` — where code lives  
4. `.agents/skills/*` — how to run each phase  

## Develop a product

Do **not** invent a new monorepo. Extend this one. One vertical slice at a time.

### Feature flow

```
grill-with-docs   → sharpen design, ADRs, glossary
to-spec           → user-facing spec
to-tickets        → tracer-bullet tickets (vertical slices)
plan-review       → architecture check (BLOCK / FLAG / NOTE)
guided-implementation → contracts → tests → code
writing-tests     → unit, property, BDD
pr-creation       → DoD + PR
code-review       → guardrails
ship              → staging → prod
```

Branches when needed: `diagnosing-bugs`, `payment-integration`.

### Implementation rules (short)

- Business logic uses `packages/infra` adapters — never `env.*` directly  
- New API: Zod in `shared-zod` → route under `/v1/`  
- User copy: `en` + `id` via i18n helpers  
- Logging: Logger adapter only  
- Schema change: server migration + client migration + `SCHEMA_VERSION`  
- Files ≤300 lines, ≤5 direct deps  
- Gates green before PR: `check`, `test`, `size-limit`

### Day-to-day commands

| Command | Use |
|---|---|
| `bun run dev` | Local Worker + assets |
| `bun run check` | Typecheck |
| `bun run test` | Unit + property tests + coverage |
| `bun run build` | Web dist + Worker bundle |
| `bun run size-limit` | Bundle budget |
| `bun run deploy` | Deploy to Cloudflare |
| `bun run deploy:staging` | Staging env |

### Definition of done

See checklist in `AGENTS.md`. Roughly: contracts first, tests for the slice, no secrets in git, no new paid critical-path deps, CI green.

## Docs index

| Doc | Role |
|---|---|
| `docs/ARCHITECTURE.md` | Principles and stack rationale |
| `AGENTS.md` | Normative guardrails + DoD |
| `CONTEXT.md` | Module map for agents |
| `adr/` | Decision records |
| `.agents/skills/` | Step-by-step agent skills |
