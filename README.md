# Agentic Project Template

A working full-stack TypeScript starter: Cloudflare Workers + React PWA + AI agent skills.
Clone is optional — this repo **is** the project. Hello World deploys to Cloudflare.

Philosophy and rationale: `docs/ARCHITECTURE.md`. Agent guardrails: `AGENTS.md`.

## Structure

```
.
├── apps/
│   ├── api/                 # Hono Worker (/v1/*)
│   └── web/                 # React 19 PWA
├── packages/
│   ├── shared-zod/          # Client ↔ server contracts
│   ├── db-schema/           # Drizzle schema + migrations
│   ├── sync-protocol/       # SCHEMA_VERSION, sync types
│   └── infra/               # Adapters (Logger, …)
├── docs/
│   └── ARCHITECTURE.md
├── adr/                     # Architecture decision records
├── AGENTS.md
└── .agents/skills/          # Agent skill suite
```

## Principles (CI-gated)

1. **Cost** — Cloudflare free tier
2. **Local-first** — Tinybase MergeableStore CRDT
3. **Performance** — &lt;200 KB gzipped
4. **Cross-Platform** — PWA
5. **Polished** — en + id, a11y
6. **Secure** — Zod, Better Auth, secure headers
7. **Observable** — structured Logger adapter
8. **Maintainable** — adapters, standard SQL
9. **Available** — graceful degradation
10. **Reliable** — contracts-first, &gt;80% coverage
11. **Reproducible** — Nix flake (optional) + lockfiles
12. **Agentic** — ≤300-line files, ≤5 direct deps

## Stack

| Layer | Choice |
|---|---|
| Platform | Cloudflare Workers + D1 + R2 |
| API | Hono + zod-openapi |
| Client | React 19 + TanStack Router + TanStack Query |
| State | Tinybase MergeableStore |
| UI | Tailwind CSS |
| Auth | Better Auth (stub until needed) |
| Testing | Vitest + fast-check |
| Tooling | Vite+ (`vp`) + Bun |

## Skill flow

```
grill-with-docs → to-spec → to-tickets → plan-review
        → guided-implementation → writing-tests → pr-creation
        → code-review → ship
```

Branches: `diagnosing-bugs`, `payment-integration`, `writing-great-skills`.

There is **no bootstrap skill**. The monorepo is already scaffolded and runnable.

## Quick start

```bash
bun install
bun run check
bun run test
bun run build
bun run dev          # local API + web
bun run deploy       # requires `wrangler login`
```

## Prerequisites

- Bun
- Cloudflare account + `wrangler login` (for deploy)
- Optional: Nix (`nix develop`) for a pinned shell
