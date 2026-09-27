import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    payload: { processSha256: "a".repeat(64), policySha256: "b".repeat(64) },
  };
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
});
