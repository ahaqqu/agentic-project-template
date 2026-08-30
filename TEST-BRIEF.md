# TEST BRIEF — iteration guardrail (issue #98)

Audience: test-implementer. This brief is the specification for the suite.
You write the tests it names; a failing test means fix the test or report a
suspected production bug — never patch `scripts/iteration-guardrail/*`,
`packages/contracts/src/zcode-hook.ts`, or `.zcode/config.json`.

## Invariant under test

A deny may fire ONLY on confident evidence of repeated failed verification
cycles for the same problem in the current session. Concretely, all of:

1. It must never fire on distinct-progress work: a different failure
   signature resets the same-failure streak; any successful verification
   resets both counters.
2. It must fail OPEN on its own internal errors: corrupt state, unreadable
   config, malformed payload, missing session identity → no deny, exit 0.
3. Every deny must carry the full stuck-report escalation instruction
   (issue #94 format): invariant under test, exact current failure, attempted
   fixes with outcomes, ruled-out hypotheses, checkpoint commit ref — plus
   the "never fake done" statement (completion criterion unchanged: PR +
   `gh pr checks` green) and the checkpoint-first instruction.
4. The counting must be deterministic: identical inputs → identical
   signature/deny decision (pure functions, no clocks/randomness).

The silent failure mode this suite must make loud: a miscounting hook bricks
legitimate work (false positive) or lets a stuck loop burn unbounded tokens
without ever denying (false negative).

## Interfaces to exercise

- `scripts/iteration-guardrail/lib.mjs` — pure functions (preferred surface):
  `defaultConfig`, `normalizeConfig`, `isVerificationCommand`, `emptyState`,
  `isValidState`, `normalizeCommand`, `normalizeOutput`, `failureSignature`,
  `outcomeFromToolResponse`, `applyVerificationResult`, `applyStateChange`,
  `evaluateDeny`, `buildDenyReason`, `buildDenyOutput`.
- `scripts/iteration-guardrail/hook.mjs` — process level: `spawnSync("bun",
  ["scripts/iteration-guardrail/hook.mjs"])` with the payload JSON on stdin.
  Env overrides for tests: `ZCODE_GUARDRAIL_STATE_DIR` (fresh tmp dir per
  test), `ZCODE_GUARDRAIL_CONFIG` (fixture config). Assert: exit code always
  0 on the fail-open paths; deny = JSON on stdout with
  `hookSpecificOutput.permissionDecision === "deny"`; structured skip/error
  events on stderr.
- `packages/contracts/src/zcode-hook.ts` — `parseZcodeHookPayload(raw)` and
  `ZcodeHookPayloadSchema` (contract for the external hook-payload boundary).
  Note: this file is inside the vitest coverage include — testing it also
  keeps the coverage gate honest.
- Config fixture: `scripts/iteration-guardrail/config.json` is the shipped
  default; do not mutate it — use `ZCODE_GUARDRAIL_CONFIG` copies in tmp dirs.

Payload shapes (verified against the ZCode runtime bundle):
- `PreToolUse`: `{"hook_event_name":"PreToolUse","session_id":...,"tool_name":"Bash","tool_input":{"command":...}}`
- `PostToolUse` (Bash): adds `"tool_response":{"status":"completed|failed|timed_out|cancelled|backgrounded|spawn_error","exitCode":N,"stdout":...,"stderr":...}`
- `PostToolUse` (Edit|Write): `tool_input` irrelevant; the event itself is the fix attempt.
- `PostToolUseFailure` (Bash): adds `"error":{"message":...}` and `"is_interrupt":true` when cancelled.

## Named test cases

### A. Progress-based counting (lib.mjs, pure) — the core invariant

1. **`same-failure cap denies on the 4th attempt, not the 3rd`** — three
   identical failures (same command, same output) then `evaluateDeny` fires
   with `cap === "sameFailureCap"`; after the SECOND failure it must not
   fire. Off-by-one here either bricks early or never protects.
2. **TRAP — distinct failures never trip the same-failure cap**: 10 cycles
   where each failure has a DIFFERENT signature (an `applyStateChange` fix
   attempt between each) → `evaluateDeny` must return `null` for
   `sameFailureCap` throughout (the distinct cap at 8 is a separate rule —
   assert it is what fires, if anything).
3. **TRAP — a success resets the budget**: drive state to deny-level, apply
   one `outcome === "success"` verification, `evaluateDeny` → `null`, and
   both counters are back to 0. A cap that survives a success bricks
   legitimate convergent work.
4. **TRAP — flaky bare retry cannot evade the cap**: fail, NO edit between,
   rerun fails with a DIFFERENT output (jitter in durations/timestamps) →
   same-failure streak still increments (spec: "no state change between
   cycles" counts as the same failure). Without this, output jitter defeats
   the guardrail.
5. **A real fix attempt with a new failure is progress**: fail, edit, fail
   with different signature → streak resets to 1.
6. **distinct cap boundary**: 8 failed cycles since the last success → next
   `evaluateDeny` fires with `cap === "distinctFailureCap"`; at 7 → `null`.
7. **Interrupted/cancelled calls are never evidence**:
   `outcomeFromToolResponse` returns `"indeterminate"` for
   `status:"cancelled"|"backgrounded"|"spawn_error"`, and
   `applyVerificationResult` with an indeterminate outcome returns the state
   UNCHANGED (no counter moves). Trap: unrecognized `tool_response` shapes
   (null, string, array) must also be indeterminate — an unclassifiable
   outcome may silence the guardrail, never strengthen it.
8. **failed classification**: `exitCode !== 0` (with or without `status`),
   `status:"failed"`, `status:"timed_out"`, `timedOut:true` → `"failed"`;
   `exitCode === 0` → `"success"`.

### B. Signature determinism (lib.mjs) — "same failure" must mean the same thing

9. **Volatile tokens normalized**: two outputs differing only in durations
   (`1.23s`/`345ms`), ISO timestamps, ANSI escapes, whitespace, `/tmp/...`
   paths produce the SAME `failureSignature`; a different failing test name
   produces a DIFFERENT signature. Property-style (fast-check) is welcome
   here over generated volatile suffixes.
10. **Signature binds command + output**: same output, different command →
    different signature (rerunning a different verification command on the
    same error text is not the same cycle).

### C. Config and state hardening (lib.mjs) — fail-open inputs

11. **TRAP — caps actually read from config**: `normalizeConfig({sameFailureCap: 1, distinctFailureCap: 2, ...})` produces a config where one same-failure
    failure pair trips the deny. This is the "caps are tunable, not
    hardcoded" acceptance test.
12. **TRAP — corrupt config degrades, never crashes**: `normalizeConfig` on
    non-object, negative/zero/float caps, invalid regex patterns, empty
    pattern arrays → falls back to defaults (assert `degraded` non-empty and
    the resulting config usable). No throw anywhere.
13. **TRAP — corrupt state fails open**: `isValidState` rejects garbage
    (null, arrays, missing keys, wrong types, corrupted
    `lastSignature` number), accepts a valid round-tripped state.

### D. Deny message content (lib.mjs) — the escalation instruction

14. **TRAP — deny reason carries the full stuck-report format**: assert
    `buildDenyReason` output contains, by content (not length): the five
    numbered items (invariant under test / exact current failure / attempted
    fixes / ruled-out hypotheses / checkpoint commit ref), the
    checkpoint-first instruction, the "never fake done" statement (PR +
    checks green unchanged), which cap was breached with count and limit,
    the failure signature, and the config path for tuning.
15. **Deny JSON shape**: `buildDenyOutput` emits
    `hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason}` —
    the exact shape the runtime parses (else the deny silently no-ops).

### E. Command classification (lib.mjs)

16. **Verification commands classified**: `bun run test`, `bun run check`,
    `bunx vitest run x`, `pytest`, `go test ./...`, `gh pr checks 122`, etc.
    → true.
17. **TRAP — checkpoint duty never blocked**: `git commit -m "..."`,
    `git push`, `git worktree add ...` → false. The stuck-report protocol
    REQUIRES committing before escalating; if the hook classified git
    commands as verification, the escalation path would deadlock.
18. Empty/non-string command → false.

### F. Process-level behavior (hook.mjs via spawnSync, isolated state dir per test)

19. **End-to-end stuck loop**: seed a fresh `ZCODE_GUARDRAIL_STATE_DIR`; feed
    3 PostToolUse failures then a PreToolUse for the same command → exit 0
    with the deny JSON on stdout (reason contains the stuck-report items).
    PreToolUse after only 2 failures → no stdout deny JSON.
20. **TRAP — reset between sessions**: drive session A to deny-level, then
    PreToolUse for session B (same state dir, different `session_id`) → no
    deny, exit 0. State is keyed per session; a fresh dispatch starts clean
    (this is what makes the manager's re-dispatch ladder coherent).
21. **TRAP — fail-open on corrupted state file**: write `NOT JSON{{{` (and a
    second test with a shape-valid-JSON/wrong-shape body) into
    `<stateDir>/<session>.json`, then PreToolUse → exit 0, NO deny JSON,
    stderr carries the structured `skip_corrupt_state` event.
22. **Fail-open on malformed stdin**: `"garbage{{"`, empty stdin, valid JSON
    that fails the contract (e.g. `hook_event_name:"Stop"`) → exit 0, no
    deny output.
23. **Fail-open on missing config**: `ZCODE_GUARDRAIL_CONFIG` pointing at a
    nonexistent file → exit 0, no deny (stderr warn), caps fall back to
    defaults; a stuck loop seeded against the defaults still denies.
24. **Interrupted failure not counted**: PostToolUseFailure with
    `is_interrupt:true` → `skip_interrupted` on stderr, and a following
    PreToolUse does not deny.
25. **Non-verification command passthrough**: PreToolUse
    `git commit -m "x"` → exit 0, no stdout, no state written.
26. **Edit event records a fix attempt**: after fail → PostToolUse Edit →
    fail with different output → following PreToolUse allowed (progress),
    whereas without the Edit the same sequence denies (ties to case 4/5).
27. **PostToolUseFailure (non-interrupt) counts**: a verification command
    whose tool call errors at the harness level increments the counters —
    deny reachable without any PostToolUse event.

### G. Contract boundary (packages/contracts/src/zcode-hook.ts)

28. `parseZcodeHookPayload` accepts all three events with realistic payloads
    (including optional-field omissions) and rejects: non-object, unknown
    `hook_event_name`, `PreToolUse` without `tool_name`, non-integer junk.
    `ok:false` carries a reason string — never throws.

## How to run

- Whole suite: `bun run test` from the repo root (vitest picks up
  `tests/scripts/*.test.mjs`).
- Targeted while iterating: `bunx vitest run tests/scripts/iteration-guardrail.test.mjs`.
- After green: `bun run check` (the contracts file is typechecked by the
  root tsconfig), then the full gate chain:
  `bun run check && bun run test && bun run agentic-limits && bun run truth && bun run template-gate`.
- Local red/green loop reminder: batch edits between runs; the iteration
  guardrail itself will deny endless rerun loops in live sessions (caps:
  sameFailureCap 3, distinctFailureCap 8 — set looser via
  `ZCODE_GUARDRAIL_CONFIG` if a test seeds fewer events).

## Coverage note

`scripts/**` is outside the vitest coverage include (by design, like
`scripts/agent-usage-metadata/`); `packages/contracts/src/zcode-hook.ts` is
inside it and must stay covered by section G.
