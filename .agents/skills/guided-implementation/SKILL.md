---
name: guided-implementation
description: Use when implementing a plan. Read AGENTS.md for guardrails.
---

# Guided Implementation

Use this skill when implementing a plan that is unclear, complex, or may affect architecture.

## Before writing code

1. Read the plan.
2. Read `AGENTS.md` for normative guardrails.
3. Analyze the plan against guardrails:
   - When adding a route, verify `/v1/` prefix and zod-openapi contract.
   - When touching an external service, verify adapter in `packages/infra`.
   - When adding a dependency, verify free-tier compatibility.
   - When changing the database, verify both server and client migrations.
   - When touching sync, verify CRDT merge and idempotency.
   - When adding UI, verify i18n for `en` + `id`.
4. List implementation steps: contracts → tests → implementation → validation.
5. Highlight deviations. Do not start until the user confirms.

## During implementation

- Write contracts (Zod schemas, types) before implementation.
- Write tests before or alongside implementation.
- When deviating from the plan, pause and ask for approval.
- When touching architecture, pause and ask for approval.

## After implementation

- Run the project CI gate locally: `vp check && vp test && vp size-limit`. `vp` is the Vite+ task runner; run `vp help` if the command format differs. If no `vp` binary is available, see `docs/ARCHITECTURE.md` §14 for tooling to scaffold.
- Verify against `AGENTS.md` Definition of Done.
- Report what was implemented and what changed from the plan.
