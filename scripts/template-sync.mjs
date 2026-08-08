#!/usr/bin/env bun
// template-sync — keep a project forked from this template in sync with it.
//
// Commands:
//   init                      add + fetch the "upstream" remote (run once)
//   check (alias: gate)       fail if template-owned files drifted from the
//                             last synced template ref (CI gate)
//   update [--ref=X] [--branch=Y]
//                             merge the latest template release; --branch
//                             creates/updates Y before merging (sync branch)
//   finish                    complete an update after resolving conflicts
//
// Ownership model (template-sync.json):
//   overwrite  must stay identical to the last synced ref; `check` enforces
//              it, `update` refuses to merge while drifted, and merges always
//              take the template version of these paths.
//   merge      upstream changes merge normally; projects may extend them.
//   unlisted   project-owned; never synced.
//
// The gate is inert in the template repo itself (origin == upstream).
// The last synced ref is recorded in .template-sync.state (project-owned).

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const MANIFEST = "template-sync.json";
const STATE_FILE = ".template-sync.state";
const PENDING_FILE = ".template-sync.pending";

const git = (args) =>
  spawnSync("git", ["--no-pager", ...args], { cwd: ROOT, encoding: "utf8" });

const gitOk = (args) => git(args).status === 0;

const gitOut = (args) => {
  const r = git(args);
  return r.status === 0 ? r.stdout.trim() : null;
};

const fail = (msg) => {
  console.error(`template-sync: ${msg}`);
  process.exit(1);
};

const manifest = () => {
  try {
    const raw = JSON.parse(readFileSync(`${ROOT}/${MANIFEST}`, "utf8"));
    if (
      typeof raw.upstream !== "string" ||
      !Array.isArray(raw.overwrite) ||
      !Array.isArray(raw.merge)
    ) {
      throw new Error("expected string 'upstream', arrays 'overwrite' and 'merge'");
    }
    return raw;
  } catch (err) {
    fail(`cannot read ${MANIFEST}: ${err.message}`);
  }
};

const normalizeUrl = (url) =>
  url
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\//, "https://")
    .replace(/\.git$/, "");

const upstreamUrl = () => process.env.TEMPLATE_SYNC_UPSTREAM || manifest().upstream;

const isTemplateRepo = () => {
  const origin = gitOut(["remote", "get-url", "origin"]);
  return Boolean(origin && normalizeUrl(origin) === normalizeUrl(upstreamUrl()));
};

const ensureRemote = () => {
  if (gitOk(["remote", "get-url", "upstream"])) return true;
  if (isTemplateRepo()) return true;
  const r = git(["remote", "add", "upstream", upstreamUrl()]);
  if (r.status !== 0) fail(`git remote add upstream failed:\n${r.stderr}`);
  console.log(`template-sync: added upstream remote (${upstreamUrl()})`);
  return true;
};

const fetchUpstream = () => {
  if (isTemplateRepo()) return true;
  const r = git(["fetch", "--tags", "--quiet", "upstream"]);
  if (r.status !== 0) fail(`git fetch upstream failed:\n${r.stderr}`);
  return true;
};

// Default ref: newest v* tag (explicit releases), else main (unreleased).
const resolveRef = (arg) => {
  if (arg) return arg;
  const tags = gitOut(["tag", "--sort=-v:refname", "-l", "v*"]);
  return tags ? tags.split("\n")[0] : "main";
};

const resolveCommit = (ref) =>
  gitOut(["rev-parse", "--verify", `refs/remotes/upstream/${ref}^{commit}`]) ??
  gitOut(["rev-parse", "--verify", `refs/tags/${ref}^{commit}`]);

const overwritePaths = () => manifest().overwrite;

const isOverwritePath = (p) =>
  overwritePaths().some((e) => p === e || p.startsWith(e.endsWith("/") ? e : `${e}/`));

// Drift: tracked changes plus untracked files under overwrite paths,
// compared against a baseline commit (the last synced template ref).
const drift = (baseline) => {
  const paths = overwritePaths();
  if (!paths.length) return [];
  const changed = git(["diff", "--name-status", baseline, "--", ...paths]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...paths]);
  const lines = changed.status === 0 && changed.stdout
    ? changed.stdout.trim().split("\n")
    : [];
  const extra = untracked.status === 0 && untracked.stdout
    ? untracked.stdout.trim().split("\n").map((p) => `A\t${p}`)
    : [];
  return [...lines, ...extra];
};

const readState = () => {
  try {
    const lines = readFileSync(`${ROOT}/${STATE_FILE}`, "utf8").split("\n");
    const get = (k) => {
      const l = lines.find((line) => line.startsWith(`${k} `));
      return l ? l.slice(k.length + 1) : null;
    };
    const ref = get("ref");
    const commit = get("commit");
    return ref && commit ? { ref, commit } : null;
  } catch {
    return null;
  }
};

const writeState = (ref, commit) => {
  writeFileSync(`${ROOT}/${STATE_FILE}`, `ref ${ref}\ncommit ${commit}\n`);
};

const readPending = () => {
  try {
    return readFileSync(`${ROOT}/${PENDING_FILE}`, "utf8").trim() || null;
  } catch {
    return null;
  }
};

const clearPending = () => {
  try {
    rmSync(`${ROOT}/${PENDING_FILE}`);
  } catch {
    // nothing pending
  }
};

// Baseline for drift checks: the last synced ref, or the default ref when
// the project has never synced.
const baseline = () => {
  const state = readState();
  if (state) {
    const commit = gitOut(["rev-parse", "--verify", `${state.commit}^{commit}`]);
    if (commit) return { ref: state.ref, commit };
  }
  const ref = resolveRef(null);
  const commit = resolveCommit(ref);
  if (!commit) fail(`upstream ref "${ref}" not found — run 'bun run template-sync init' first`);
  return { ref, commit };
};

const usage = () => {
  console.log(`template-sync — sync a forked project with the template upstream.

Usage: bun run template-sync <command> [--ref=X] [--branch=Y]

  init      add and fetch the "upstream" remote (run once per project)
  check     gate: fail if template-owned files drifted from the last synced ref
  update    merge the latest template release (v* tag, or --ref=X)
  finish    complete an update after resolving merge conflicts

template-sync.json declares ownership: 'overwrite' paths are template-owned
and enforced; 'merge' paths inherit changes; unlisted paths are project-owned.`);
};

const cmdInit = () => {
  if (isTemplateRepo()) {
    console.log("template-sync: this repo is the template itself; nothing to init");
    return 0;
  }
  if (gitOk(["remote", "get-url", "upstream"])) {
    console.log(`template-sync: upstream already configured (${gitOut(["remote", "get-url", "upstream"])})`);
    return 0;
  }
  ensureRemote();
  const r = git(["fetch", "--tags", "--quiet", "upstream"]);
  if (r.status !== 0) fail(`git fetch upstream failed:\n${r.stderr}`);
  console.log("template-sync: upstream fetched. Next: bun run template-sync update");
  return 0;
};

const cmdCheck = () => {
  if (isTemplateRepo()) {
    console.log("template-sync: this repo is the template itself; gate skipped");
    return 0;
  }
  ensureRemote();
  fetchUpstream();
  const base = baseline();
  const violations = drift(base.commit);
  if (violations.length) {
    console.error(
      `template-sync: gate failed — template-owned files drifted from ${base.ref} (${base.commit.slice(0, 8)}):\n` +
        violations.join("\n") +
        "\nRestore or remove them; these paths are template-owned. If they look like upstream " +
        "changes you have not synced yet, run: bun run template-sync update",
    );
    return 1;
  }
  console.log(`template-sync: gate OK — template-owned files match ${base.ref} (${base.commit.slice(0, 8)})`);
  return 0;
};

const cmdUpdate = (flags) => {
  if (isTemplateRepo()) {
    console.log("template-sync: this repo is the template itself; nothing to sync");
    return 0;
  }
  ensureRemote();
  fetchUpstream();
  const ref = resolveRef(flags.ref);
  const commit = resolveCommit(ref);
  if (!commit) fail(`upstream ref "${ref}" not found — check 'git tag' and 'git branch -r' after a fetch`);

  const state = readState();
  if (state) {
    const syncedAt = gitOut(["rev-parse", "--verify", `${state.commit}^{commit}`]);
    if (syncedAt) {
      const violations = drift(syncedAt);
      if (violations.length) {
        console.error(
          "template-sync: refusing to merge — template-owned files drifted from the last sync " +
            `(${state.ref}, ${state.commit.slice(0, 8)}):\n` +
            violations.join("\n") +
            "\nRestore them first, then re-run update.",
        );
        return 1;
      }
    }
  }

  if (flags.branch) {
    const r = git(["checkout", "-B", flags.branch]);
    if (r.status !== 0) fail(`git checkout -B ${flags.branch} failed:\n${r.stderr}`);
  }

  writeFileSync(`${ROOT}/${PENDING_FILE}`, `${ref}\n`);
  const headBefore = gitOut(["rev-parse", "HEAD"]);
  const hasBase = gitOk(["merge-base", "HEAD", commit]);
  const merged = git([
    "merge",
    "--no-commit",
    "--no-edit",
    ...(hasBase ? [] : ["--allow-unrelated-histories"]),
    commit,
  ]);

  const merging = Boolean(gitOut(["rev-parse", "-q", "--verify", "MERGE_HEAD"]));
  if (merged.status !== 0 && !merging) {
    clearPending();
    fail(`git merge of ${commit.slice(0, 8)} failed (merge never started):\n${merged.stderr}`);
  }

  // Overwrite paths are template-owned: always take the template version.
  // restore --source replaces both index and worktree from the incoming
  // commit and works for every conflict kind (unlike checkout --theirs,
  // which is a no-op for add/add conflicts).
  const conflicted = gitOut(["diff", "--name-only", "--diff-filter=U"]) ?? "";
  const overwriteConflicts = conflicted
    .split("\n")
    .filter(Boolean)
    .filter(isOverwritePath);
  if (overwriteConflicts.length) {
    const r = git(["restore", "--source", commit, "--staged", "--worktree", "--", ...overwriteConflicts]);
    if (r.status !== 0) fail(`resolving template-owned conflicts failed:\n${r.stderr}`);
  }
  const remaining = (gitOut(["diff", "--name-only", "--diff-filter=U"]) ?? "")
    .split("\n")
    .filter(Boolean);
  if (remaining.length) {
    console.error(
      "template-sync: merge conflicts in project-owned paths:\n" +
        remaining.join("\n") +
        "\nResolve them, git add each file, then run: bun run template-sync finish",
    );
    return 1;
  }

  // No-op detection: with --no-commit git never fast-forwards, so compare
  // the merged index against HEAD instead of HEAD hashes. Aborting here is
  // safe: a no-op merge changed nothing.
  if (gitOk(["diff", "--cached", "--quiet"])) {
    if (merging) git(["merge", "--abort"]);
    writeState(ref, commit);
    git(["add", "--", STATE_FILE]);
    git(["commit", "-m", `chore: record template sync state (${ref})`]);
    clearPending();
    console.log(`template-sync: already up to date with ${ref} (${commit.slice(0, 8)})`);
    return 0;
  }

  writeState(ref, commit);
  git(["add", "--", STATE_FILE]);
  const c = merging
    ? git(["commit", "--no-edit"])
    : git(["commit", "-m", `chore: record template sync state (${ref})`]);
  if (c.status !== 0) fail(`git commit failed:\n${c.stderr}`);
  clearPending();
  const stat = git(["diff", "--stat", headBefore, "HEAD"]);
  console.log(`template-sync: merged ${ref} (${commit.slice(0, 8)})${flags.branch ? ` into ${flags.branch}` : ""}`);
  if (stat.status === 0 && stat.stdout) console.log(stat.stdout.trim());
  return 0;
};

const cmdFinish = () => {
  const pendingRef = readPending();
  if (!pendingRef) {
    console.log("template-sync: nothing pending — re-run 'bun run template-sync update' if a sync is unfinished");
    return 0;
  }
  const merging = gitOut(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (merging) {
    const conflicted = gitOut(["diff", "--name-only", "--diff-filter=U"]) ?? "";
    if (conflicted.trim()) {
      console.error("template-sync: unresolved conflicts:\n" + conflicted.trim());
      return 1;
    }
    writeState(pendingRef, merging);
    git(["add", "--", STATE_FILE]);
    const c = git(["commit", "--no-edit"]);
    if (c.status !== 0) fail(`git commit failed:\n${c.stderr}`);
  } else {
    const secondParent = gitOut(["rev-parse", "-q", "--verify", "HEAD^2"]);
    if (!secondParent) {
      console.error("template-sync: no merge in progress and HEAD is not a merge commit — nothing to finish");
      return 1;
    }
    writeState(pendingRef, secondParent);
    git(["add", "--", STATE_FILE]);
    const c2 = git(["commit", "-m", `chore: record template sync state (${pendingRef})`]);
    if (c2.status !== 0) fail(`git commit failed:\n${c2.stderr}`);
  }
  clearPending();
  console.log(`template-sync: sync finished (${pendingRef}); state recorded`);
  return 0;
};

const args = process.argv.slice(2);
const flags = { ref: null, branch: null };
for (const a of args.slice(1)) {
  if (a.startsWith("--ref=")) flags.ref = a.slice("--ref=".length);
  else if (a.startsWith("--branch=")) flags.branch = a.slice("--branch=".length);
  else {
    usage();
    process.exit(1);
  }
}

const [command] = args;
const run = {
  init: cmdInit,
  check: cmdCheck,
  gate: cmdCheck,
  update: () => cmdUpdate(flags),
  finish: cmdFinish,
};
if (!run[command]) {
  usage();
  process.exit(command ? 1 : 0);
}
process.exit(run[command]());
