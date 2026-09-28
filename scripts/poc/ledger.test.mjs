import { afterEach, describe, expect, it } from "vitest";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRecord, initializeLedger, readLedger } from "./ledger.mjs";

/** @type {string[]} */
const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jsix-ledger-"));
  roots.push(root);
  await initializeLedger(root);
  return root;
}

/** @param {string} recordId @param {string=} kind */
function event(recordId, kind = "project.created") {
  return {
    schemaVersion: 1,
    recordId,
    projectId: "sample",
    kind,
    recordedAt: "2026-09-27T00:00:00.000Z",
    payload: { processSha256: "a".repeat(64), policySha256: "b".repeat(64),
      processCommit: "c".repeat(40), targetRepoId: "approval-workflow",
      targetCommit: "d".repeat(40), fixtureId: "approval-workflow" },
  };
}

/** @param {string} root @param {string[]} args @param {string=} input */
function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], { input, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" } }).trim();
}

/** @param {string} root @param {string} oldHead @param {string|null} body */
function forgeCommit(root, oldHead, body) {
  const treeInput = body === null ? "" : `100644 blob ${git(root, ["hash-object", "-w", "--stdin"], body)}\trecord.json\n`;
  const tree = git(root, ["mktree"], treeInput);
  const commit = git(root, ["commit-tree", tree, "-p", oldHead], "forged\n");
  git(root, ["update-ref", "refs/heads/poc-ledger", commit, oldHead]);
}

describe("private Git ledger", () => {
  it("appends and reconstructs an ordered chain after reopening", async () => {
    const root = await fixture();
    const first = await appendRecord(root, null, event("r1"));
    const second = await appendRecord(root, first.head, event("r2", "artifact.submitted"));
    const reopened = await readLedger(root);
    expect(reopened.head).toBe(second.head);
    expect(reopened.records.map((record) => record.recordId)).toEqual(["r1", "r2"]);
    expect(reopened.records[1]?.previousCommit).toBe(first.head);
    expect(reopened.records[1]?.previousRecordHash).toBe(reopened.records[0]?.recordHash);
  });

  it("rejects stale expected heads and duplicate record IDs", async () => {
    const root = await fixture();
    const first = await appendRecord(root, null, event("r1"));
    await expect(appendRecord(root, null, event("r2"))).rejects.toThrow(/期待|stale/);
    await expect(appendRecord(root, first.head, event("r1"))).rejects.toThrow(/重複/);
    expect((await readLedger(root)).records).toHaveLength(1);
  });

  it("holds operations when a lock survives or another writer owns it", async () => {
    const root = await fixture();
    await writeFile(join(root, ".git", "poc-operation.lock"), "stale");
    await expect(appendRecord(root, null, event("r1"))).rejects.toThrow(/lock|照合/);
    expect((await readLedger(root)).records).toHaveLength(0);
  });

  it("rejects unknown schemas and malformed hashes without changing the ref", async () => {
    const root = await fixture();
    await expect(appendRecord(root, null, { ...event("r1"), schemaVersion: 2 })).rejects.toThrow(/schema/);
    await expect(appendRecord(root, null, { ...event("r1"), payload: { processSha256: "bad" } })).rejects.toThrow(/SHA|hash/);
    expect((await readLedger(root)).head).toBeNull();
  });

  it("does not let a caller inject chain fields", async () => {
    const root = await fixture();
    await expect(appendRecord(root, null, { ...event("r1"), previousCommit: "f".repeat(40) })).rejects.toThrow(/連鎖|system/);
    expect((await readLedger(root)).head).toBeNull();
  });

  it("permits at most one of two concurrent writers from the same head", async () => {
    const root = await fixture();
    const results = await Promise.allSettled([
      appendRecord(root, null, event("left")), appendRecord(root, null, event("right")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await readLedger(root)).records).toHaveLength(1);
  });

  it("stops replay for a saved unknown schema, corrupt hash, or missing record", async () => {
    for (const change of ["schema", "hash", "missing"]) {
      const root = await fixture();
      const state = await appendRecord(root, null, event("r1"));
      const record = JSON.parse(git(root, ["show", `${state.head}:record.json`]));
      if (change === "schema") record.schemaVersion = 2;
      if (change === "hash") record.recordHash = "0".repeat(64);
      forgeCommit(root, state.head, change === "missing" ? null : JSON.stringify(record));
      await expect(readLedger(root)).rejects.toThrow();
    }
  });

  it("retains the operation lock when Git updated the ref but reported failure", async () => {
    const root = await fixture();
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const wrapper = join(root, "git");
    await writeFile(wrapper, `#!/bin/sh\nif [ "$3" = "update-ref" ]; then\n  "$REAL_GIT" "$@"\n  exit 42\nfi\nexec "$REAL_GIT" "$@"\n`);
    await chmod(wrapper, 0o700);
    const originalPath = process.env.PATH;
    const originalGit = process.env.REAL_GIT;
    process.env.PATH = `${root}:${originalPath}`;
    process.env.REAL_GIT = realGit;
    try { await expect(appendRecord(root, null, event("r1"))).rejects.toThrow(/ref更新結果が不明/); }
    finally { process.env.PATH = originalPath; if (originalGit === undefined) delete process.env.REAL_GIT;
      else process.env.REAL_GIT = originalGit; }
    expect((await readLedger(root)).records).toHaveLength(1);
    expect(await readFile(join(root, ".git", "poc-operation.lock"), "utf8")).toBe("");
    await expect(appendRecord(root, (await readLedger(root)).head, event("r2"))).rejects.toThrow(/lock/);
  });

  it("releases the operation lock after a known pre-ref write failure", async () => {
    const root = await fixture();
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const wrapper = join(root, "git");
    await writeFile(wrapper, `#!/bin/sh\nif [ "$3" = "hash-object" ]; then exit 42; fi\nexec "$REAL_GIT" "$@"\n`);
    await chmod(wrapper, 0o700);
    const originalPath = process.env.PATH;
    const originalGit = process.env.REAL_GIT;
    process.env.PATH = `${root}:${originalPath}`;
    process.env.REAL_GIT = realGit;
    try { await expect(appendRecord(root, null, event("r1"))).rejects.toThrow(); }
    finally { process.env.PATH = originalPath; if (originalGit === undefined) delete process.env.REAL_GIT;
      else process.env.REAL_GIT = originalGit; }
    expect((await readLedger(root)).head).toBeNull();
    await expect(access(join(root, ".git", "poc-operation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
