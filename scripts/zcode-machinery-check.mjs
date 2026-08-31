#!/usr/bin/env bun
// zcode-machinery-check.mjs — structural gate for the .zcode/ machinery
// (issue #125: `.zcode/` is template-owned via template-sync.json `overwrite`,
// so every fork inherits the hook wiring and the role files — and the gate
// verifies the inheritance actually landed after a sync).
//
// Hard failures (checked here, enforced by both `bun run template-gate` and
// `bun run zcode:preflight`):
//   1. `.zcode/config.json` hook wiring matches the template's expected shape:
//      the PreToolUse iteration-guardrail hook and the PostToolUse
//      usage-telemetry + guardrail hooks are present and enabled, so a fork
//      cannot silently run unguarded (the guardrail) or unmeasured
//      (telemetry) after a sync.
//   2. Every role file in `.zcode/agents/` (README.md excluded) carries a
//      concrete `model:` pin — `builtin:<providerId>/<model>` or the client's
//      custom-provider scheme `custom:<uuid>:<model>`; `inherit`, `lite`, a
//      bare model id, or an absent pin fails. The gate recognizes both pin
//      shapes unquoted and quoted (ZCode's agent editor rewrites role files
//      with quoted values on save — PR #130). `thoughtLevel:` is
//      client-managed: ZCode writes `enabled` (or drops the field) when it
//      rewrites a role file, so the gate requires only that the field is
//      unambiguous (no duplicate keys), never a specific value.
//
// Deliberately NOT here: whether a pin resolves in the *local* ZCode provider
// config (`~/.zcode/v2/config.json`). That is environment-dependent — CI has
// no client config — so provider resolution is a visible drift *warning*
// reported by scripts/zcode-pin-check.mjs, never a hard gate failure.
//
// Synchronous on purpose: scripts/template-sync/commands.mjs embeds this
// check in the synchronous `check` command. Test suite:
// tests/scripts/zcode-machinery-check.test.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Reasoning variants the harness historically validated `thoughtLevel:`
 * against. ZCode now owns this field — its agent editor pins `enabled` (an
 * opaque client knob) or drops the field entirely when saving a role file —
 * so the gate no longer enforces a value set; kept exported for the pin
 * checker's reporting. */
export const THOUGHT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Roles the manager dispatches. Kept as the dispatch registry for tooling;
 * no gate rule keys off it anymore (thoughtLevel is client-managed). */
export const DISPATCHED_ROLES = new Set([
  "implementer",
  "senior-implementer",
  "reviewer",
  "thermo-nuclear-review-subagent",
  "thermo-nuclear-code-quality-review-subagent",
  "assistant-manager",
]);

/** Provider ids of known-stale, non-caching channels a committed pin must
 * not name (review A3 on PR #127): the shape check is the only CI-visible
 * layer, and a committed stale-channel pin is always a mistake — the
 * sanctioned per-fork mechanism is the user-scope override
 * ~/.zcode/agents/<role>.md, which no static gate can see. Extend this set
 * when the sanctioned channel changes again. */
export const STALE_PROVIDER_IDS = new Set(["ollama"]);

/** Hardcoded per-field frontmatter patterns — a RegExp built from the `key`
 * argument would trip semgrep's non-literal-regexp rule, and there are only
 * two fields to read. Line-bounded (`[ \t]*` + `(.*)`) so an empty field
 * value stays empty instead of `\s*` capturing the next frontmatter line;
 * global so duplicated keys are all visible (YAML resolves last-wins). */
const FRONTMATTER_FIELDS = {
  model: /^model:[ \t]*(.*)[ \t]*$/gm,
  thoughtLevel: /^thoughtLevel:[ \t]*(.*)[ \t]*$/gm,
};

const GUARDRAIL_HOOK = "scripts/iteration-guardrail/hook.mjs";
const USAGE_HOOK = "scripts/agent-usage-metadata/hook.mjs";

/** A concrete model ref the client can resolve without a session default:
 * either `<providerId>/<model>` (builtin-style, e.g.
 * builtin:zai-start-plan/GLM-5.3-Flash — any ref with a `/` separator) or
 * ZCode's custom-provider scheme `custom:<uuid>:<model>` (no `/`; the
 * client maps the uuid to a configured custom provider — PR #130's pins).
 * `inherit`/`lite` are handled by the caller, before this check. */
function isConcreteModelRef(model) {
  return model.includes("/") || /^custom:[^:]+:.+$/.test(model);
}

/** Trimmed value of every occurrence of a frontmatter field, in file order.
 * Empty occurrences are dropped, so an empty `key:` counts as absent. A
 * YAML double- or single-quoted scalar (ZCode's agent editor quotes values
 * on save, e.g. model: "custom:<uuid>:<model>") is unquoted before the
 * quote characters are part of the value the gate compares. */
function fieldValues(frontmatter, key) {
  const pattern = FRONTMATTER_FIELDS[key];
  if (!pattern) throw new Error(`unsupported frontmatter key "${key}"`);
  return [...frontmatter.matchAll(pattern)]
    .map((m) => m[1].trim().replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").trim())
    .filter((v) => v.length > 0);
}

/** A hook counts as wired when some event entry declares it, enabled, under
 * the given event/matcher — matched by the hook script path in its args.
 * The template wires hooks as "${ZCODE_PROJECT_DIR}/<script>", so the arg
 * matches on the script path suffix (or an exact bare path). */
function argsInvokeHook(args, hookScript) {
  return (args ?? []).some(
    (a) => typeof a === "string" && (a === hookScript || a.endsWith(`/${hookScript}`)),
  );
}

function hookWired(config, event, matcher, hookScript) {
  for (const entry of config?.hooks?.events?.[event] ?? []) {
    if (entry.matcher !== matcher) continue;
    for (const hook of entry.hooks ?? []) {
      if (hook.enabled !== false && argsInvokeHook(hook.args, hookScript)) {
        return true;
      }
    }
  }
  return false;
}

/** Hook-wiring shape check (issue #125 task 3a). Every miss is one actionable
 * error naming the event/matcher/script so a fork can restore the wiring via
 * `bun run template-sync update` (`.zcode/` is template-owned). */
export function checkHookWiring(config, configPath) {
  const errors = [];
  const restore = `restore the template wiring with 'bun run template-sync update' (.zcode/ is template-owned), or re-enable the hook in ${configPath}`;
  if (config?.hooks?.enabled !== true) {
    errors.push(
      `${configPath}: hooks.enabled is not true — no hook runs at all; ${restore}`,
    );
  }
  const expected = [
    ["PreToolUse", "Bash", GUARDRAIL_HOOK, "iteration guardrail (verification-loop caps)"],
    ["PostToolUse", "Bash", GUARDRAIL_HOOK, "iteration guardrail (verification outcome recording)"],
    ["PostToolUse", "Edit|Write", GUARDRAIL_HOOK, "iteration guardrail (fix-attempt recording)"],
    ["PostToolUseFailure", "Bash", GUARDRAIL_HOOK, "iteration guardrail (failed-verification recording)"],
    ["PostToolUse", "Agent", USAGE_HOOK, "usage telemetry (dispatch completed)"],
    ["PostToolUse", "TaskOutput", USAGE_HOOK, "usage telemetry (result collected)"],
  ];
  for (const [event, matcher, script, purpose] of expected) {
    if (!hookWired(config, event, matcher, script)) {
      errors.push(
        `${configPath}: ${event}/${matcher} hook for ${script} is missing or disabled — the ${purpose} never runs; ${restore}`,
      );
    }
  }
  return errors;
}

/** Role-file structural check (issue #125, relaxed on PR #130): concrete
 * `model:` pin; `thoughtLevel:` checked for duplicate-key ambiguity only
 * (client-managed field). Returns { errors, role } — role is the resolved
 * pin record for provider resolution, or null when the file is not
 * checkable. */
export function checkRoleFile(file, rolesDir) {
  const role = file.replace(/\.md$/, "");
  const path = join(rolesDir, file);
  const errors = [];
  const fix = `restore .zcode/agents/${file} via 'bun run template-sync update' (.zcode/ is template-owned); a fork re-pins a model via the user-scope override ~/.zcode/agents/${file}, never by editing the project file`;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return {
      errors: [`cannot read ${path} (${error.code ?? error.message}) — ${fix}`],
      role: null,
    };
  }
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? null;
  if (frontmatter === null) {
    return {
      errors: [`${path}: no frontmatter block — ${fix}`],
      role: null,
    };
  }

  const modelValues = fieldValues(frontmatter, "model");
  const model = modelValues.at(-1) ?? null;
  if (modelValues.length > 1) {
    errors.push(
      `${path}: ${modelValues.length} model fields — YAML resolves duplicate keys last-wins, so the pin is ambiguous; delete all but one`,
    );
  }
  if (model === null) {
    errors.push(
      `${path}: no model: pin — the template ships concrete pins on the caching channel (issue #125); ${fix}`,
    );
  } else if (model === "inherit" || model === "lite") {
    errors.push(
      `${path}: model pin "${model}" is not a concrete ref — the template ships concrete pins (issue #125); pin builtin:<providerId>/<model> or the client's custom-provider scheme custom:<uuid>:<model>; ${fix}`,
    );
  } else if (!isConcreteModelRef(model)) {
    errors.push(
      `${path}: model pin "${model}" is a bare model id — ZCode resolves it against the session default provider, which no static gate can verify; pin builtin:<providerId>/<model> or custom:<uuid>:<model>; ${fix}`,
    );
  } else if (
    model.includes("/") &&
    STALE_PROVIDER_IDS.has(model.split("/")[0])
  ) {
    errors.push(
      `${path}: model pin "${model}" names a known-stale, non-caching channel ("${model.split("/")[0]}") — the template pins the caching channel (issue #125); re-pin it, or use the user-scope override ~/.zcode/agents/${file} which no sync touches`,
    );
  }

  const levelValues = fieldValues(frontmatter, "thoughtLevel");
  let thoughtLevel = null;
  if (levelValues.length > 1) {
    errors.push(
      `${path}: ${levelValues.length} thoughtLevel fields — YAML resolves duplicate keys last-wins, so the pin is ambiguous; delete all but one`,
    );
  }
  thoughtLevel = levelValues.at(-1) ?? null;
  // No value-set or exact-value rule: thoughtLevel is client-managed —
  // ZCode's agent editor pins `enabled` (its own knob) or drops the
  // field entirely when it rewrites a role file (PR #130), and which
  // reasoning variants are valid is the harness's concern, not a static
  // gate's. Only the duplicate-key ambiguity above hard-fails.

  return {
    errors,
    role:
      model !== null && isConcreteModelRef(model)
        ? { role, file, model, thoughtLevel }
        : null,
  };
}

/**
 * Structural check of the .zcode/ machinery under `rootDir`.
 *
 * @param {string} rootDir repo root (holds .zcode/)
 * @returns {{ errors: string[], roles: {role: string, file: string, model: string, thoughtLevel: string}[] }}
 *   errors: hard-gate failures (hook wiring, role pins). roles: the
 *   structurally valid pin records, for environment-dependent resolution.
 */
export function checkZcodeMachinery(rootDir) {
  const errors = [];
  const configPath = join(rootDir, ".zcode", "config.json");
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    errors.push(
      `cannot read or parse ${configPath} (${error.code ?? error.message}) — the hook wiring that makes the guardrail and telemetry run is template-owned (.zcode/ in template-sync.json); restore it with 'bun run template-sync update'`,
    );
  }
  // A falsy parse result (JSON `null`, `false`, `0`, `""`) does not throw —
  // run the wiring check against it anyway so it produces the standard
  // "hooks.enabled is not true" failure instead of a silent pass (review A2
  // on PR #127).
  errors.push(...checkHookWiring(config ?? {}, configPath));

  const rolesDir = join(rootDir, ".zcode", "agents");
  const roles = [];
  let files;
  try {
    files = readdirSync(rolesDir).filter(
      (f) => f.endsWith(".md") && f !== "README.md",
    );
  } catch (error) {
    errors.push(
      `cannot read the roles directory ${rolesDir} (${error.code ?? error.message}) — the role profiles are template-owned (.zcode/ in template-sync.json); restore them with 'bun run template-sync update'`,
    );
    files = [];
  }
  for (const file of files) {
    const { errors: roleErrors, role } = checkRoleFile(file, rolesDir);
    errors.push(...roleErrors);
    if (role) roles.push(role);
  }
  return { errors, roles };
}

/**
 * template-gate embedding (review B2 on PR #127): run the structural gate
 * against `cwd`, log the verdict through the template-sync logger, and
 * return pass/fail. Kept here — not in commands.mjs — so the CLI
 * orchestration file stops growing with the machinery surface.
 *
 * @param {string} cwd repo root under gate (holds .zcode/)
 * @param {import("@app/infra").Logger} log
 * @returns {boolean} true when the machinery is intact
 */
export function runMachineryGate(cwd, log) {
  const { errors, roles } = checkZcodeMachinery(cwd);
  if (errors.length) {
    log.error("zcode machinery gate failed", {
      violations: errors,
      hint: "the .zcode/ machinery is template-owned: restore with 'bun run template-sync update'; a fork re-pins a model via ~/.zcode/agents/<role>.md (user-scope override)",
    });
    return false;
  }
  log.info("zcode machinery gate passed", {
    roles: roles.length,
    wiring: ".zcode/config.json hook events present and enabled",
  });
  return true;
}
