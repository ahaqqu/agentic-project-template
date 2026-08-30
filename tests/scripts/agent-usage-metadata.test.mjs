import { describe, expect, it } from "vitest";
import {
  captureFingerprint,
  computeUsageTotals,
  mergeUsageIntoMetadata,
  ownedUsageKeys,
  parseHookPayload,
  serializeMetadata,
  USAGE_ROWS_SQL,
} from "../../scripts/agent-usage-metadata/lib.mjs";

const SESSION = "sess_subagent_agent_test";
const AGENT_ID = "agent_test";

function row(over = {}) {
  return {
    provider_id: "ollama",
    model_id: "glm-5.3:cloud",
    status: "completed",
    started_at: 1000,
    completed_at: 6000,
    duration_ms: 5000,
    input_tokens: 100,
    output_tokens: 10,
    reasoning_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 50,
    computed_total_tokens: 162,
    ...over,
  };
}

function metadataText(over = {}) {
  return JSON.stringify({
    agentId: AGENT_ID,
    childSessionId: SESSION,
    status: "completed",
    ...over,
  });
}

describe("parseHookPayload", () => {
  it("accepts a Stop payload with a session id", () => {
    const raw = JSON.stringify({ hook_event_name: "Stop", session_id: SESSION });
    expect(parseHookPayload(raw)).toEqual({ ok: true, event: "Stop", sessionId: SESSION });
  });

  it("accepts a TaskOutput PostToolUse payload and normalizes the agent id", () => {
    const withPrefix = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "TaskOutput",
      tool_use_id: "call_1",
      tool_input: { task_id: AGENT_ID },
    });
    expect(parseHookPayload(withPrefix)).toEqual({ ok: true, event: "task-output", agentId: AGENT_ID });
    const bareId = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "TaskOutput",
      tool_use_id: "call_1",
      tool_input: { task_id: "test" },
    });
    expect(parseHookPayload(bareId)).toEqual({ ok: true, event: "task-output", agentId: "agent_test" });
  });

  it("accepts an Agent PostToolUse payload as a dispatch-completion capture", () => {
    const raw = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Agent",
      tool_use_id: "call_9",
      tool_input: { subagent_type: "implementer" },
    });
    expect(parseHookPayload(raw)).toEqual({ ok: true, event: "agent-dispatch", toolUseId: "call_9" });
  });

  it("rejects non-JSON, non-object, unknown events, and missing fields", () => {
    expect(parseHookPayload("not json").ok).toBe(false);
    expect(parseHookPayload("[1,2]").ok).toBe(false);
    expect(parseHookPayload(JSON.stringify({ hook_event_name: "PostToolUse", session_id: SESSION })).ok).toBe(false);
    expect(parseHookPayload(JSON.stringify({ hook_event_name: "Stop" })).ok).toBe(false);
    expect(parseHookPayload(JSON.stringify({ hook_event_name: "Stop", session_id: 7 })).ok).toBe(false);
    expect(
      parseHookPayload(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "TaskOutput", tool_use_id: "c", tool_input: {} })).ok,
    ).toBe(false);
    expect(
      parseHookPayload(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "c", tool_input: {} })).ok,
    ).toBe(false);
  });
});

describe("computeUsageTotals", () => {
  it("sums token columns and request counts across rows", () => {
    const rows = [
      row(),
      row({ status: "error", input_tokens: 30, output_tokens: 0, reasoning_tokens: 0, cache_read_input_tokens: 0, completed_at: null }),
    ];
    const totals = computeUsageTotals(SESSION, rows, "2026-08-30T00:00:00.000Z");
    expect(totals.requestCount).toBe(2);
    expect(totals.completedRequestCount).toBe(1);
    expect(totals.inputTokens).toBe(130);
    expect(totals.outputTokens).toBe(10);
    expect(totals.reasoningTokens).toBe(2);
    expect(totals.cacheReadInputTokens).toBe(50);
    expect(totals.computedTotalTokens).toBe(324);
  });

  it("computes wall time from earliest started to latest completed", () => {
    const rows = [
      row({ started_at: 1000, completed_at: 6000 }),
      row({ started_at: 3000, completed_at: 9000 }),
    ];
    expect(computeUsageTotals(SESSION, rows, "x").wallTimeMs).toBe(8000);
  });

  it("zero wall time when nothing completed", () => {
    expect(computeUsageTotals(SESSION, [row({ status: "running", completed_at: null })], "x").wallTimeMs).toBe(0);
  });

  it("breaks usage down per model", () => {
    const rows = [row(), row({ model_id: "kimi-k2.7-code:cloud" })];
    const totals = computeUsageTotals(SESSION, rows, "x");
    expect(totals.models).toHaveLength(2);
    expect(totals.models[0].requestCount).toBe(1);
  });
});

describe("mergeUsageIntoMetadata", () => {
  const totals = computeUsageTotals(SESSION, [row()], "2026-08-30T00:00:00.000Z");

  it("preserves pre-existing keys and adds usage keys", () => {
    const next = mergeUsageIntoMetadata(metadataText(), totals);
    expect(next.agentId).toBe(AGENT_ID);
    expect(next.status).toBe("completed");
    expect(next.usage.inputTokens).toBe(100);
    expect(next.usageCaptures).toHaveLength(1);
  });

  it("is idempotent: re-capture with the same totals does not duplicate history", () => {
    const once = mergeUsageIntoMetadata(metadataText(), totals);
    const twice = mergeUsageIntoMetadata(serializeMetadata(once), totals);
    expect(twice.usageCaptures).toHaveLength(1);
    expect(twice.usage).toEqual(totals);
  });

  it("accumulates across resumed subagents: new rows grow the totals", () => {
    const first = mergeUsageIntoMetadata(metadataText(), totals);
    const resumedTotals = computeUsageTotals(
      SESSION,
      [row(), row({ input_tokens: 200, output_tokens: 20, started_at: 90000, completed_at: 95000 })],
      "2026-08-30T00:01:00.000Z",
    );
    const second = mergeUsageIntoMetadata(serializeMetadata(first), resumedTotals);
    expect(second.usage.requestCount).toBe(2);
    expect(second.usage.inputTokens).toBe(300);
    expect(second.usageCaptures).toHaveLength(2);
    expect(captureFingerprint(resumedTotals)).not.toBe(captureFingerprint(totals));
  });

  it("throws on unparseable metadata instead of writing", () => {
    expect(() => mergeUsageIntoMetadata("{corrupt", totals)).toThrow(/not valid JSON/);
  });

  it("throws when the record does not belong to the usage session", () => {
    expect(() =>
      mergeUsageIntoMetadata(metadataText({ childSessionId: "sess_subagent_agent_other" }), totals),
    ).toThrow(/does not match/);
  });

  it("throws when metadata is not an object", () => {
    expect(() => mergeUsageIntoMetadata("[1]", totals)).toThrow(/not a JSON object/);
  });
});

describe("usage row SQL", () => {
  it("filters by session id placeholder and selects the token columns", () => {
    expect(USAGE_ROWS_SQL).toContain("session_id = ?");
    expect(USAGE_ROWS_SQL).toContain("cache_read_input_tokens");
    expect(USAGE_ROWS_SQL).toContain("from model_usage");
  });
});

describe("ownedUsageKeys", () => {
  it("declares exactly the keys the hook owns", () => {
    expect(ownedUsageKeys()).toEqual(["usage", "usageCaptures"]);
  });
});

// End-to-end guard checks: run the real hook entrypoint as a subprocess the
// same way the workspace-hook runtime does (payload JSON on stdin).
import { describe as describe2, expect as expect2, it as it2, beforeAll as beforeAll2, afterAll as afterAll2 } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync as mkd2, mkdirSync as mkdir2, copyFileSync as copy2, writeFileSync as write2, readFileSync as read2, rmSync as rm2 } from "node:fs";
import { tmpdir as tmp2 } from "node:os";
import { join as join2 } from "node:path";
import { DatabaseSync as DB } from "node:sqlite";
import { fileURLToPath } from "node:url";

const HOOK = join2(process.cwd(), "scripts/agent-usage-metadata/hook.mjs");

describe2("hook.mjs failure paths (AC2)", () => {
  let env;
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "TaskOutput",
    tool_use_id: "call_probe",
    tool_input: { task_id: "agent_probe" },
  });

  beforeAll2(() => {
    env = mkd2(join2(tmp2(), "hook-guard-"));
    mkdir2(join2(env, "agents", "sess_parent", "agent_probe"), { recursive: true });
    copy2(
      new URL("../../scripts/agent-usage-metadata/hook.mjs", import.meta.url).pathname,
      join2(env, "hook.mjs"),
    );
    copy2(
      new URL("../../scripts/agent-usage-metadata/lib.mjs", import.meta.url).pathname,
      join2(env, "lib.mjs"),
    );
    // Real DB with one usage row for the child session.
    const db = new DB(join2(env, "db.sqlite"));
    db.exec(`create table model_usage (id text primary key, session_id text, provider_id text, model_id text, status text,
      started_at integer, completed_at integer, duration_ms integer, input_tokens integer, output_tokens integer,
      reasoning_tokens integer, cache_creation_input_tokens integer, cache_read_input_tokens integer, computed_total_tokens integer)`);
    db.prepare("insert into model_usage values ('r1','sess_subagent_agent_probe','p','m','completed',1000,6000,5000,100,10,2,0,50,162)").run();
    db.close();
  });
  afterAll2(() => rm2(env, { recursive: true, force: true }));

  function runHook(extraEnv) {
    return spawnSync("bun", [join2(env, "hook.mjs")], {
      input: payload,
      encoding: "utf8",
      env: {
        ...process.env,
        ZCODE_AGENTS_DIR: join2(env, "agents"),
        ZCODE_DB_PATH: join2(env, "db.sqlite"),
        ZCODE_AGENT_USAGE_LOG: join2(env, "hook.log"),
        ...extraEnv,
      },
    });
  }

  it2("corrupt metadata.json: never written into; skip is logged; bytes unchanged", () => {
    const metaPath = join2(env, "agents", "sess_parent", "agent_probe", "metadata.json");
    const corrupt = '{"childSessionId": "sess_subagent_agent_probe", CORRUPT';
    write2(metaPath, corrupt);
    const r = runHook({});
    // An unparseable record must never be written into: the capture is
    // skipped with an observable log line and the file keeps its bytes.
    expect2(r.status).toBe(0);
    expect2(r.stderr).toContain("skip_no_agent_record");
    expect2(read2(metaPath, "utf8")).toBe(corrupt);
  });

  it2("missing telemetry DB: exits 1, logs, metadata untouched", () => {
    const metaPath = join2(env, "agents", "sess_parent", "agent_probe", "metadata.json");
    const valid = JSON.stringify({ agentId: "agent_probe", childSessionId: "sess_subagent_agent_probe", status: "completed" });
    write2(metaPath, valid);
    const r = runHook({ ZCODE_DB_PATH: join2(env, "missing.sqlite") });
    expect2(r.status).toBe(1);
    expect2(r.stderr).toContain("error_db");
    expect2(read2(metaPath, "utf8")).toBe(valid);
  });

  it2("happy path: usage lands in metadata and repeats are idempotent", () => {
    const metaPath = join2(env, "agents", "sess_parent", "agent_probe", "metadata.json");
    const first = runHook({});
    expect2(first.status).toBe(0);
    expect2(first.stderr).toContain("usage_recorded");
    const after1 = read2(metaPath, "utf8");
    const once = JSON.parse(after1);
    expect2(once.usage.inputTokens).toBe(100);
    expect2(once.usageCaptures).toHaveLength(1);
    const second = runHook({});
    expect2(second.status).toBe(0);
    const rerun = JSON.parse(read2(metaPath, "utf8"));
    // Same DB state: same fingerprint, still one capture entry, same totals
    // (capturedAt is the only field allowed to move).
    expect2(rerun.usageCaptures).toHaveLength(1);
    expect2(rerun.usageCaptures[0].fingerprint).toBe(once.usageCaptures[0].fingerprint);
    expect2(rerun.usage.inputTokens).toBe(100);
  });
});
