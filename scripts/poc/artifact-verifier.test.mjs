import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyArtifact, verifiedSnapshot } from "./artifact-verifier.mjs";

/** @type {string[]} */
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jsix-artifact-"));
  roots.push(root);
  const git = (/** @type {string[]} */ args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" },
  }).trim();
  git(["init", "-q"]);
  await writeFile(join(root, "constitution.md"), "synthetic constitution\n");
  await writeFile(join(root, "requirements.md"), "# Empty\n");
  await symlink("constitution.md", join(root, "alias.md"));
  git(["add", "constitution.md", "alias.md", "requirements.md"]);
  git(["commit", "-qm", "synthetic fixture"]);
  return { root, commit: git(["rev-parse", "HEAD"]),
    sha256: createHash("sha256").update("synthetic constitution\n").digest("hex") };
}

describe("Git artifact verifier", () => {
  it("verifies the exact committed blob and makes a record-bound snapshot", async () => {
    const { root, commit, sha256 } = await fixture();
    const submitted = { recordId: "constitution-v1", kind: "artifact.submitted",
      payload: { artifactId: "constitution", targetCommit: commit, path: "constitution.md", sha256 } };
    expect(verifyArtifact(root, submitted.payload)).toBe(true);
    expect(verifiedSnapshot(root, [submitted], commit)).toEqual({ commit, verifiedRecordIds: ["constitution-v1"], invalidRecords: [] });
  });

  it("rejects wrong hashes, path traversal, and symlink entries", async () => {
    const { root, commit, sha256 } = await fixture();
    expect(() => verifyArtifact(root, { targetCommit: commit, path: "constitution.md", sha256: "0".repeat(64) })).toThrow(/SHA|hash/);
    expect(() => verifyArtifact(root, { targetCommit: commit, path: "../constitution.md", sha256 })).toThrow(/path/);
    expect(() => verifyArtifact(root, { targetCommit: commit, path: "alias.md", sha256 })).toThrow(/symlink|mode/);
  });

  it("keeps a structurally incomplete requirement spec out of the verified set", async () => {
    const { root, commit } = await fixture();
    const sha256 = createHash("sha256").update("# Empty\n").digest("hex");
    const record = { recordId: "req", kind: "artifact.submitted", payload: {
      artifactId: "requirement_spec", targetCommit: commit, path: "requirements.md", sha256,
    } };
    const snapshot = verifiedSnapshot(root, [record], commit);
    expect(snapshot.verifiedRecordIds).toEqual([]);
    expect(snapshot.invalidRecords[0]?.reason).toMatch(/構造|REQ-/);
  });
});
