---
name: pr-creation
description: Use when creating a pull request. Validate against AGENTS.md Definition of Done.
---

# PR Creation

Use this skill when creating a pull request.

## Before creating the PR

1. Create a branch from `main`.
2. Run the project CI gate locally: `bun run check && bun run test && bun run size-limit`. Fix failures until green.
3. Read `AGENTS.md`. Validate code against the Definition of Done.
4. Do not read `docs/ARCHITECTURE.md`.
5. If this PR addresses one or more GitHub issues (tickets published via the `to-tickets` skill to a GitHub tracker), gather their numbers/URLs from the current branch context, the `to-tickets` output, or the local `.scratch/<feature-slug>/issues/` files. You will need them for the PR description.

## Validation

Follow the Definition of Done in `AGENTS.md`:

- All CI gates green.
- Contracts written before implementation.
- API or UI changes: BDD tests added.
- Schema changes: server migration (raw SQL in `apps/api/migrations/`) + client migration (in `packages/local-first`) + `SCHEMA_VERSION` bump.
- New routes: Valibot contract in `packages/contracts` (`@app/contracts`) + `hono-openapi` route definition; `/openapi.json` regenerates from the same definitions.
- No new paid dependency in the critical path.
- Nothing sensitive in the diff.
- Architectural changes documented in PR description.
- Human-review gate stated if triggered: destructive migration, new dependency, auth change.

## PR title

```
<type>(<scope>): <short summary>
```

Type: `feat` · `fix` · `refactor` · `docs` · `chore`
Scope: resource or route touched
Max 72 characters

## PR description

```markdown
## Summary
Concise summary of changes, not a file list.

## Closes
Closes #123, #124. When the PR is merged, GitHub auto-closes these issues.
- Use the keyword `Closes` (or `Fixes` / `Resolves`) followed by the issue number, e.g. `Closes #123`.
- List every issue this PR fully resolves. Do not list issues that are only partially addressed — those need a comment, not auto-close.
- If this PR does not address a tracked issue, write `None`.

## Architecture
Architectural changes, or `None`.

## Backend
Backend changes with test proof, or `None`.

## Frontend
Frontend changes with test proof, or `None`.

## Security Review
Security implications, or `None`.

## Performance Review
Performance implications, or `None`.

## Acceptance Criteria
Checklist from AGENTS.md Definition of Done.

## Documentation
Docs updated: `AGENTS.md` / `adr/`, or `None`.

## Limitations & Warnings
Any limitations, or `None`.
```

## Rules

- You MUST NEVER merge your own PR. Submit for human review only.
- You MUST NOT create a PR with a dirty working tree.
- You MUST create a PR even for trivial changes.

## GitHub issues — auto-close on merge

When this PR addresses one or more GitHub issues, the PR description MUST link them so they close automatically on merge.

- Use one of GitHub's recognized closing keywords: `Closes`, `Fixes`, or `Resolves` — capitalized or lowercase, both work. Prefer `Closes` for new work and `Fixes` for bugs.
- Format: `Closes #123` (or `owner/repo#123` if the issue lives in a different repo).
- Place the keyword on its own line in the `## Closes` section of the PR description, one issue per line. GitHub only auto-closes when the keyword appears in the PR description (not in commit messages, branch names, or PR comments).
- One PR can close multiple issues — list every one. Conversely, do not reference an issue in the `## Closes` section unless this PR fully resolves it; partially addressed issues belong in a PR comment, not the closing list.
- If the issue lives in a different repository, use the cross-repo form `Closes org/repo#123` and confirm the target repo accepts cross-repo closing references.
- If this PR does not address a tracked issue, write `None` in the `## Closes` section. Never omit the section.
