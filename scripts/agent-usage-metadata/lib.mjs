// Pure logic for the agent-usage-metadata hook (issue #95).
//
// Contract (external boundaries this module guards):
// 1. Hook stdin payload (ZCode workspace-hook runtime, `Stop` event): a JSON
//    object that MUST carry `hook_event_name: "Stop"` and `session_id`; the
//    session id identifies a subagent child session
//    (`sess_subagent_agent_<agentId>`). Anything else is rejected — the hook
//    is a no-op unless both fields validate.
// 2. Telemetry rows: objects shaped like rows of the `model_usage` table in
//    ~/.zcode/cli/db/db.sqlite (snake_case token columns + status/timestamps).
// 3. Agent metadata.json: a JSON object; usage keys are ADDED/REPLACED, every
//    pre-existing key is preserved verbatim. Unparseable or mismatched
//    metadata aborts the update (never corrupts the file).

const USAGE_SOURCE = "scripts/agent-usage-metadata";
const USAGE_KEYS = ["usage", "usageCaptures"];

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Parse + validate the hook payload. Returns {ok:true, sessionId} or
// {ok:false, reason} — never throws.
export function parseHookPayload(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "payload is not valid JSON" };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, reason: "payload is not a JSON object" };
  }
  if (payload.hook_event_name !== "Stop") {
    return {
      ok: false,
      reason: `unsupported hook_event_name: ${String(payload.hook_event_name)}`,
    };
  }
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { ok: false, reason: "payload has no session_id" };
  }
  return { ok: true, sessionId };
}

// Query text for model_usage rows of one session. Kept here so the SQL and
// the row-shape contract stay next to the code that consumes the rows.
export const USAGE_ROWS_SQL = `
  select provider_id, model_id, status, started_at, completed_at, duration_ms,
         input_tokens, output_tokens, reasoning_tokens,
         cache_creation_input_tokens, cache_read_input_tokens,
         computed_total_tokens
  from model_usage where session_id = ?`;

function intOrZero(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

// Sum raw model_usage rows into the usage totals. Pure: rows in, totals out.
export function computeUsageTotals(sessionId, rows, capturedAt) {
  const models = new Map();
  let wallStart = Infinity;
  let wallEnd = 0;
  let completedRequestCount = 0;
  const totals = {
    sessionId,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    computedTotalTokens: 0,
    requestCount: rows.length,
    completedRequestCount: 0,
    wallTimeMs: 0,
  };
  for (const row of rows) {
    totals.inputTokens += intOrZero(row.input_tokens);
    totals.outputTokens += intOrZero(row.output_tokens);
    totals.reasoningTokens += intOrZero(row.reasoning_tokens);
    totals.cacheCreationInputTokens += intOrZero(row.cache_creation_input_tokens);
    totals.cacheReadInputTokens += intOrZero(row.cache_read_input_tokens);
    totals.computedTotalTokens += intOrZero(row.computed_total_tokens);
    if (row.status === "completed") {
      completedRequestCount += 1;
      const start = intOrZero(row.started_at);
      const end = intOrZero(row.completed_at);
      if (start > 0) wallStart = Math.min(wallStart, start);
      if (end > 0) wallEnd = Math.max(wallEnd, end);
    }
    const modelKey = `${row.provider_id ?? "?"}/${row.model_id ?? "?"}`;
    const model = models.get(modelKey) ?? {
      model: modelKey,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    model.requestCount += 1;
    model.inputTokens += intOrZero(row.input_tokens);
    model.outputTokens += intOrZero(row.output_tokens);
    models.set(modelKey, model);
  }
  totals.completedRequestCount = completedRequestCount;
  totals.wallTimeMs =
    wallEnd > wallStart && wallStart !== Infinity ? wallEnd - wallStart : 0;
  totals.models = [...models.values()].sort((a, b) => b.requestCount - a.requestCount);
  totals.capturedAt = capturedAt;
  totals.capturedBy = USAGE_SOURCE;
  return totals;
}

// Stable fingerprint of one capture: used to keep usageCaptures append-only
// history idempotent across repeated Stop events for the same session state.
export function captureFingerprint(totals) {
  return [
    totals.requestCount,
    totals.completedRequestCount,
    totals.inputTokens,
    totals.outputTokens,
    totals.computedTotalTokens,
  ].join(":");
}

// Build the next metadata.json content. Pure and total: it either returns a
// full replacement document (all pre-existing keys preserved) or throws on a
// guard violation — the caller must treat a throw as "do not write".
// - metadataText: the current file content (string) — MUST parse.
// - expectedChildSessionId: the payload session id — MUST match the record's
//   childSessionId so a scan collision can never write foreign usage.
export function mergeUsageIntoMetadata(metadataText, totals) {
  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch (e) {
    throw new Error(`metadata.json is not valid JSON: ${e.message}`);
  }
  if (!isPlainObject(metadata)) {
    throw new Error("metadata.json is not a JSON object");
  }
  if (metadata.childSessionId !== totals.sessionId) {
    throw new Error(
      `metadata childSessionId ${JSON.stringify(metadata.childSessionId)} does not match payload session_id ${JSON.stringify(totals.sessionId)}`,
    );
  }
  const existingCaptures = Array.isArray(metadata.usageCaptures)
    ? metadata.usageCaptures.filter(isPlainObject)
    : [];
  const fingerprint = captureFingerprint(totals);
  const captures = [
    ...existingCaptures.filter((c) => c.fingerprint !== fingerprint),
    {
      capturedAt: totals.capturedAt,
      fingerprint,
      requestCount: totals.requestCount,
      completedRequestCount: totals.completedRequestCount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadInputTokens: totals.cacheReadInputTokens,
      wallTimeMs: totals.wallTimeMs,
    },
  ];
  return { ...metadata, usage: totals, usageCaptures: captures };
}

export function serializeMetadata(metadata) {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

// Which usage keys this hook owns: a caller can strip them to restore the
// pre-hook document. Exported so the ownership stays explicit.
export function ownedUsageKeys() {
  return [...USAGE_KEYS];
}
