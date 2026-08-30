// Pure logic for the iteration-guardrail hook (issue #98).
//
// Invariant this module protects (must hold even though its owner is a
// guardrail meant to protect others):
//   A deny may fire ONLY on confident evidence of repeated FAILED verification
//   cycles in the current session. It must never fire on distinct-progress
//   work (a different failure, or any successful verification, resets the
//   counters), it must fail OPEN on its own internal errors (a broken
//   guardrail must never trap an agent), and every deny must carry the full
//   stuck-report escalation instruction (issue #94 format).
//
// Everything here is deterministic and pure: state + event in, next state +
// optional deny out. No I/O, no clocks, no randomness — the counting logic is
// testable in isolation and cannot be made non-deterministic by the caller.
//
// Progress model (issue #94, "Escalation guardrail on iterations"):
// - One cycle = a fix attempt (an Edit/Write) + a verification rerun.
// - The stuck signal is the SAME failure recurring after a fix attempt, or a
//   rerun with NO state change between cycles (a bare retry: any output
//   difference is flake, not progress).
// - Both counters reset on a successful verification: a success is evidence
//   the loop converges, so the budget restarts. This is what makes the caps
//   progress-based rather than a raw per-session count that would brick long
//   legitimate sessions.

import { createHash } from "node:crypto";

export const DEFAULT_SAME_FAILURE_CAP = 3;
export const DEFAULT_DISTINCT_FAILURE_CAP = 8;

// Verification commands, as substring regexes over the Bash command line.
export const DEFAULT_VERIFICATION_PATTERNS = [
  "\\bbun run (check|test|typecheck|lint)\\b",
  "\\bbun test\\b",
  "\\bbunx? (vitest|jest|playwright|tsc|eslint|prettier|pyright|mypy|pytest)\\b",
  "\\b(npm|pnpm|yarn) (run |)(test|check|typecheck|lint)\\b",
  "\\bvitest\\b",
  "\\bpytest\\b",
  "\\bgo test\\b",
  "\\bcargo (test|check|clippy)\\b",
  "\\bmake (test|check|lint)\\b",
  "\\bgh pr checks?\\b",
];

export function defaultConfig() {
  return {
    sameFailureCap: DEFAULT_SAME_FAILURE_CAP,
    distinctFailureCap: DEFAULT_DISTINCT_FAILURE_CAP,
    verificationPatterns: [...DEFAULT_VERIFICATION_PATTERNS],
  };
}

function isPositiveInt(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function compilePatterns(patterns) {
  if (!Array.isArray(patterns)) return null;
  const compiled = [];
  for (const p of patterns) {
    if (typeof p !== "string" || p.length === 0) continue;
    try {
      // Repo-owned config is the same trust boundary as the hook command
      // wiring itself (arbitrary code); inputs are short command lines.
      compiled.push(new RegExp(p, "i")); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    } catch {
      // Invalid pattern: skip it (fail-open), caller logs.
      continue;
    }
  }
  return compiled;
}

// Validate + clamp a config object into the internal shape. Never throws:
// any invalid field falls back to its default (fail-open), and the result
// reports which fields were replaced so the caller can log the degradation.
export function normalizeConfig(raw) {
  const config = defaultConfig();
  const degraded = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config, degraded: ["config is not an object"] };
  }
  if (raw.sameFailureCap !== undefined) {
    if (isPositiveInt(raw.sameFailureCap)) config.sameFailureCap = raw.sameFailureCap;
    else degraded.push("sameFailureCap");
  }
  if (raw.distinctFailureCap !== undefined) {
    if (isPositiveInt(raw.distinctFailureCap)) config.distinctFailureCap = raw.distinctFailureCap;
    else degraded.push("distinctFailureCap");
  }
  if (raw.verificationPatterns !== undefined) {
    const compiled = compilePatterns(raw.verificationPatterns);
    if (compiled && compiled.length > 0) config.verificationPatterns = compiled;
    else degraded.push("verificationPatterns");
  }
  return { config, degraded };
}

export function isVerificationCommand(command, config) {
  if (typeof command !== "string" || command.trim().length === 0) return false;
  return config.verificationPatterns.some((re) => re.test(command));
}

export function emptyState() {
  return {
    // Consecutive failed cycles with the SAME failure signature (or bare
    // retries with no state change, which count as the same failure).
    sameFailStreak: 0,
    // Failed verification cycles since the last successful verification.
    failCyclesSinceSuccess: 0,
    lastSignature: null,
    lastCommand: null,
    lastFailurePreview: null,
    lastVerificationFailed: false,
    // Whether an Edit/Write happened since the last verification run.
    editSinceLastVerification: false,
  };
}

// Defensive shape check for state loaded from disk. Anything not matching is
// discarded (the caller starts from emptyState) — corrupted state must never
// produce a deny.
const NULLABLE_STRING_KEYS = ["lastSignature", "lastCommand", "lastFailurePreview"];

export function isValidState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return false;
  const ref = emptyState();
  return Object.keys(ref).every((key) => {
    const value = state[key];
    if (NULLABLE_STRING_KEYS.includes(key)) {
      return value === null || typeof value === "string";
    }
    return typeof value === typeof ref[key];
  });
}

function stripAnsi(text) {
  // biome-ignore lint: ESC escape is intentional.
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

// Erase volatile tokens (durations, timestamps, temp paths) so two runs of
// the same failing command produce the same signature; then collapse
// whitespace and keep the tail (failure summaries live at the end).
export function normalizeOutput(text) {
  if (typeof text !== "string") return "";
  return stripAnsi(text)
    .replace(/\b\d+(?:\.\d+)?m?s\b/g, "<t>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, "<ts>")
    .replace(/\/tmp\/[\w./-]+/g, "<tmp>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-2000);
}

export function normalizeCommand(command) {
  return typeof command === "string" ? command.replace(/\s+/g, " ").trim() : "";
}

// Deterministic failure identity: normalized command + normalized output.
export function failureSignature(command, outputText) {
  const digest = createHash("sha256")
    .update(normalizeCommand(command))
    .update("\n")
    .update(normalizeOutput(outputText))
    .digest("hex");
  return digest.slice(0, 16);
}

const FAIL_STATUSES = ["failed", "timed_out"];

// Narrow the runtime-owned Bash tool_response (unknown at the contract
// boundary) into "success" | "failed" | "indeterminate". Indeterminate
// outcomes (cancelled, backgrounded, spawn errors, unrecognized shapes) are
// never counted — an uncounted outcome can only make the guardrail quieter,
// never deny without evidence.
export function outcomeFromToolResponse(toolResponse) {
  const r = toolResponse;
  if (r === null || typeof r !== "object" || Array.isArray(r)) return "indeterminate";
  if (r.timedOut === true) return "failed";
  const status = typeof r.status === "string" ? r.status : undefined;
  if (status === "cancelled" || status === "backgrounded" || status === "spawn_error") {
    return "indeterminate";
  }
  if (status === "completed" || status === undefined) {
    if (typeof r.exitCode === "number" && r.exitCode !== 0) return "failed";
    return "success";
  }
  if (FAIL_STATUSES.includes(status)) return "failed";
  return "indeterminate";
}

const FAILURE_PREVIEW_MAX = 300;

function previewOf(outputText) {
  const normalized = normalizeOutput(outputText);
  return normalized.length > FAILURE_PREVIEW_MAX
    ? `${normalized.slice(0, FAILURE_PREVIEW_MAX)}…`
    : normalized;
}

// Apply one finished verification attempt. Returns the next state; never
// mutates the input. Bare retries (no Edit/Write since the previous
// verification) count toward the same-failure streak regardless of output —
// nothing changed, so a different result is flake, not progress.
export function applyVerificationResult(state, { command, outcome, outputText }) {
  const next = { ...state };
  if (outcome === "success") {
    // A success is progress evidence: reset both counters (see module header).
    return {
      ...emptyState(),
      // Keep the last command context for observability in logs.
      lastCommand: normalizeCommand(command) || null,
    };
  }
  if (outcome !== "failed") return state; // indeterminate: no evidence, no change
  const signature = failureSignature(command, outputText);
  const sameFailure =
    (state.lastVerificationFailed && !state.editSinceLastVerification) ||
    signature === state.lastSignature;
  next.sameFailStreak = sameFailure ? state.sameFailStreak + 1 : 1;
  next.failCyclesSinceSuccess = state.failCyclesSinceSuccess + 1;
  next.lastSignature = signature;
  next.lastCommand = normalizeCommand(command) || null;
  next.lastFailurePreview = previewOf(outputText);
  next.lastVerificationFailed = true;
  next.editSinceLastVerification = false;
  return next;
}

export function applyStateChange(state) {
  return { ...state, editSinceLastVerification: true };
}

// The deny decision. Fires only while the run is in a verified failing loop
// (lastVerificationFailed) AND a cap is exceeded. Distinct-progress work
// (a success, or a different failure) resets the relevant counter, so a deny
// is always backed by repeated same-context evidence.
export function evaluateDeny(state, config) {
  if (!state.lastVerificationFailed) return null;
  if (state.sameFailStreak >= config.sameFailureCap) {
    return {
      cap: "sameFailureCap",
      count: state.sameFailStreak,
      limit: config.sameFailureCap,
    };
  }
  if (state.failCyclesSinceSuccess >= config.distinctFailureCap) {
    return {
      cap: "distinctFailureCap",
      count: state.failCyclesSinceSuccess,
      limit: config.distinctFailureCap,
    };
  }
  return null;
}

// The stuck-report escalation instruction carried by EVERY deny (issue #94
// format). The receiver must be able to act without re-deriving the history.
export function buildDenyReason(state, config, breach) {
  return [
    `ITERATION GUARDRAIL: verification-loop cap reached (${breach.cap}: ${breach.count} failed cycles >= limit ${breach.limit}). Escalate now — do not rerun verification.`,
    "",
    "This workspace hook blocks verification reruns after repeated FAILED cycles for the same problem in this session. To continue, stop looping and send the manager a stuck-report containing exactly:",
    "1. Invariant under test — the property the work must protect, stated so the receiver can verify it.",
    "2. Exact current failure — the verification command and the precise error output (last recorded signature: " +
      `${state.lastSignature ?? "unknown"}, command: ${state.lastCommand ?? "unknown"}).`,
    "3. Attempted fixes — every fix attempt you made, each with its outcome.",
    "4. Ruled-out hypotheses — what you already eliminated and how.",
    "5. Checkpoint commit ref — commit your work to the branch FIRST, then record the ref here (escalation must never lose work).",
    "",
    "Last recorded failure (truncated): " + (state.lastFailurePreview ?? "unknown"),
    "",
    `Caps are configurable in scripts/iteration-guardrail/config.json (sameFailureCap: ${config.sameFailureCap}, distinctFailureCap: ${config.distinctFailureCap}); a fresh session dispatched with a different approach starts with clean counters.`,
    "",
    "Never fake done: the completion criterion is unchanged — a PR must exist and all its checks must be green. Do not report success without that evidence; report the stuck-report instead.",
  ].join("\n");
}

// The exact JSON a PreToolUse hook prints (exit 0) to deny the tool call.
// Shape verified against the ZCode runtime: hookSpecificOutput.permissionDecision
// "deny" blocks the call and permissionDecisionReason becomes the tool error
// the agent sees.
export function buildDenyOutput(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}
