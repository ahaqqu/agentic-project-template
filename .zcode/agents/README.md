# Role agents (ZCode adapter layer)

These files are the ZCode adapter layer for the manager-orchestrated workflow
in `.agents/skills/manager/SKILL.md`. Each role the manager dispatches
(`implementer`, `reviewer`, `assistant-manager`) is a defined subagent whose
body carries its operating persona and completion criterion. The `reviewer`
is itself a coordinator: it internally dispatches two sub-reviewers
(`thermo-nuclear-review-subagent` for security/correctness,
`thermo-nuclear-code-quality-review-subagent` for code quality) following the
`thermos-with-comments` skill.

These files are the **only** harness-specific part of the workflow. The skills
in `.agents/skills/` are intentionally harness-agnostic so forks can run the
same pipeline in other agent harnesses (including DeepSeek-family CLIs) by
supplying their own role-agent definitions.

## Model selection

Model pinning is **opt-in per role**. All template agents ship with no
`model:` field, so each role inherits the session default — this costs
nothing to run.

To pin a model for a role, add `model: <providerId>/<modelName>` to its
frontmatter. Resolution order (used by ZCode):

1. **User override:** `~/.zcode/agents/<role>.md` (wins — best place for
   personal model choices that shouldn't be committed to the repo).
2. **Project override:** `<repo>/.zcode/agents/<role>.md` (edit the files in
   this directory to commit a per-project choice).
3. **Template default:** inherit the session model (no `model:` field).

The two sub-reviewer agents are children of `reviewer`: pinning a model on
`reviewer` changes the coordinator and the default inherited by the
sub-reviewers; pin a sub-reviewer's own file only when you want it on a
different model than the coordinator.

Recognized `model:` values:

- `inherit` — explicitly inherit the session default (equivalent to omitting).
- `lite` — the harness's configured lite model (cheaper tier; intended for
  auxiliary roles like `assistant-manager`).
- `<providerId>/<modelName>` — a concrete provider/model ref, e.g.
  `d5585e04-940a-41f6-a9ec-320bb4fccd7e/deepseek-v4-flash:0731-cloud`.
- A bare `<modelName>` resolved against the session's default provider.

An invalid or unreachable `model:` falls back to the session default; it does
not hard-fail. Check agent discoverability in ZCode via
**Settings → Subagents**.

### Suggested defaults per role

| Role | Agent file | Suggested tier |
| --- | --- | --- |
| manager | (the session's own model — the manager is the session agent) | strongest available |
| implementer (A) | `implementer.md` | strong — does most of the work |
| reviewer (B) | `reviewer.md` (coordinator; its two sub-reviewers inherit) | strong for depth; different model from A catches more |
| assistant-manager (C) | `assistant-manager.md` | lite/cheap — fact-finding only |

## Adapting to another harness (e.g. DeepSeek)

The workflow in `.agents/skills/manager/SKILL.md` relies on exactly these
capabilities, which any harness must supply to run it end-to-end:

1. A subagent/Task tool with named `subagent_type` + background dispatch.
2. Agent-definition files per role (this directory) with a per-role model
   field.
3. `gh` CLI access (subagents use `gh` for PR and comment operations).

To run on a Claude-Code-compatible or other harness, create the **same-named
role agents** in that harness's agent-definition directory, translating the
frontmatter model key to that harness's convention. **DeepSeek support is
documented but unverified** — no DeepSeek CLI is currently installed, so this
recipe has not been validated against it.

