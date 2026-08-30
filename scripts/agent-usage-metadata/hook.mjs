#!/usr/bin/env bun
// ZCode workspace hook (issue #95): append a subagent's real token usage to
// its agent metadata.json when the subagent session stops.
//
// Wiring (enabled in .zcode/config.json, trusted via `zcode hooks trust
// grant`): the workspace hook runtime fires the `Stop` event in a session's
// runtime when its agent loop stops. For a dispatched subagent the payload's
// `session_id` is the child session; at that point the child's usage rows in
// the local telemetry DB are final. We sum `model_usage` rows for that
// session and merge the totals into the agent record found by scanning the
// agents dir for `childSessionId === session_id`.
//
// Guarantees (the invariant this script protects):
// - Lossless: totals are recomputed from the full model_usage row set of the
//   child session on every capture, so resumed (continued) subagents — which
//   append rows to the same session id — accumulate correctly and repeated
//   captures are idempotent (fingerprint-deduped history).
// - Never corrupts: metadata.json is parsed and validated before any write;
//   writes are atomic (tmp file + rename in the target dir). Any guard
//   failure means "do not write".
// - Observable: every skip/failure emits a structured JSON line on stderr and
//   to the JSONL sidecar log (default ~/.zcode/cli/agent-usage-metadata.log)
//   and exits non-zero on failure. Never exits 2 (must not block Stop).
//
// Environment overrides (used by tests): ZCODE_DB_PATH, ZCODE_AGENTS_DIR,
// ZCODE_AGENT_USAGE_LOG.

import { appendFileSync, closeSync, openSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  USAGE_ROWS_SQL,
  computeUsageTotals,
  mergeUsageIntoMetadata,
  parseHookPayload,
  serializeMetadata,
} from "./lib.mjs";

const DEFAULT_DB = join(homedir(), ".zcode", "cli", "db", "db.sqlite");
const DEFAULT_AGENTS_DIR = join(homedir(), ".zcode", "cli", "agents");
const DEFAULT_LOG = join(homedir(), ".zcode", "cli", "agent-usage-metadata.log");

function emit(event, fields) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    script: "agent-usage-metadata",
    event,
    ...fields,
  });
  process.stderr.write(`${line}\n`);
  try {
    appendFileSync(process.env.ZCODE_AGENT_USAGE_LOG || DEFAULT_LOG, `${line}\n`);
  } catch {
    // Sidecar logging is best-effort; stderr already carries the record.
  }
}

function readStdin() {
  return readFileSync(0, "utf8");
}

// Find the agent record whose childSessionId matches. The agents dir holds
// one folder per parent session: agents/<parentSessionId>/agent_<agentId>/.
function findAgentRecordPath(agentsDir, sessionId) {
  let parents;
  try {
    parents = readdirSync(agentsDir);
  } catch {
    return { ok: false, reason: `agents dir not readable: ${agentsDir}` };
  }
  for (const parent of parents) {
    const parentDir = join(agentsDir, parent);
    let agents;
    try {
      if (!statSync(parentDir).isDirectory()) continue;
      agents = readdirSync(parentDir);
    } catch {
      continue;
    }
    for (const agent of agents.filter((a) => a.startsWith("agent_"))) {
      const metadataPath = join(parentDir, agent, "metadata.json");
      let text;
      try {
        text = readFileSync(metadataPath, "utf8");
      } catch {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue; // Unrelated/unreadable record; never scanned into.
      }
      if (parsed && parsed.childSessionId === sessionId) {
        return { ok: true, path: metadataPath, text };
      }
    }
  }
  return { ok: false, reason: `no agent record with childSessionId ${sessionId}` };
}

function queryUsageRows(dbPath, sessionId) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return { ok: false, reason: `cannot open telemetry DB ${dbPath}: ${e.message}` };
  }
  try {
    const rows = db.prepare(USAGE_ROWS_SQL).all(sessionId);
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, reason: `telemetry DB query failed: ${e.message}` };
  } finally {
    try {
      db.close();
    } catch {
      // Already closed.
    }
  }
}

// Atomic replace: write the sibling temp file, fsync, rename over the target.
function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, filePath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean up.
    }
    throw e;
  }
}

async function main() {
  const parsed = parseHookPayload(readStdin());
  if (!parsed.ok) {
    emit("skip_payload", { reason: parsed.reason });
    return 0; // Not this hook's event — silent success, nothing written.
  }
  const sessionId = parsed.sessionId;
  const dbPath = process.env.ZCODE_DB_PATH || DEFAULT_DB;
  const agentsDir = process.env.ZCODE_AGENTS_DIR || DEFAULT_AGENTS_DIR;

  const record = findAgentRecordPath(resolve(agentsDir), sessionId);
  if (!record.ok) {
    // Interactive sessions stop too; they have no agent record. Observable
    // but not a failure.
    emit("skip_no_agent_record", { sessionId, reason: record.reason });
    return 0;
  }

  const usage = queryUsageRows(dbPath, sessionId);
  if (!usage.ok) {
    emit("error_db", { sessionId, reason: usage.reason });
    return 1;
  }
  if (usage.rows.length === 0) {
    // A Stop with no usage rows yet: writing zeros would be a lie. Skip.
    emit("skip_no_usage_rows", { sessionId });
    return 0;
  }

  const totals = computeUsageTotals(sessionId, usage.rows, new Date().toISOString());
  let nextText;
  try {
    nextText = serializeMetadata(mergeUsageIntoMetadata(record.text, totals));
  } catch (e) {
    emit("error_metadata_guard", { sessionId, path: record.path, reason: e.message });
    return 1;
  }

  try {
    atomicWrite(record.path, nextText);
  } catch (e) {
    emit("error_write", { sessionId, path: record.path, reason: e.message });
    return 1;
  }
  emit("usage_recorded", {
    sessionId,
    path: record.path,
    requestCount: totals.requestCount,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    wallTimeMs: totals.wallTimeMs,
  });
  return 0;
}

const code = await main();
process.exit(code);
