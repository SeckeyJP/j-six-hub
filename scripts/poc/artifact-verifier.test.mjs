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
    expect(verifiedSnapshot(root, [submitted], commit, "approval-workflow")).toEqual({ repoId: "approval-workflow", commit,
      baseCommitVerified: false, verifiedRecordIds: ["constitution-v1"], currentRecordIds: ["constitution-v1"],
      verifiedAtCommits: {}, validTransitionRecordIds: [], invalidRecords: [] });
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
    const snapshot = verifiedSnapshot(root, [record], commit, "approval-workflow");
    expect(snapshot.verifiedRecordIds).toEqual([]);
    expect(snapshot.invalidRecords[0]?.reason).toMatch(/構造|REQ-/);
  });

  it("rechecks older committed artifacts while projecting a newer target commit", async () => {
    const { root, commit, sha256 } = await fixture();
    await writeFile(join(root, "next.md"), "later synthetic change\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    execFileSync("git", ["-C", root, "add", "next.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "next"], { env });
    const current = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { env, encoding: "utf8" }).trim();
    const prior = { recordId: "constitution-old", kind: "artifact.submitted", payload: {
      artifactId: "constitution", targetCommit: commit, path: "constitution.md", sha256,
    } };
    const snapshot = verifiedSnapshot(root, [prior], current, "approval-workflow");
    expect(snapshot.verifiedRecordIds).toContain("constitution-old");
    expect(snapshot.currentRecordIds).toContain("constitution-old");
  });

  it("distinguishes unrelated later edits from changes to a passed artifact", async () => {
    const { root, commit, sha256 } = await fixture();
    const record = { recordId: "constitution-old", kind: "artifact.submitted", payload: {
      artifactId: "constitution", targetCommit: commit, path: "constitution.md", sha256,
    } };
    await writeFile(join(root, "unrelated.md"), "new work\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    execFileSync("git", ["-C", root, "add", "unrelated.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "unrelated"], { env });
    const unrelated = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(verifiedSnapshot(root, [record], unrelated, "approval-workflow").currentRecordIds).toContain("constitution-old");
    await writeFile(join(root, "constitution.md"), "changed rules\n");
    execFileSync("git", ["-C", root, "add", "constitution.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "changed prior artifact"], { env });
    const changed = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const later = verifiedSnapshot(root, [record], changed, "approval-workflow");
    expect(later.verifiedRecordIds).toContain("constitution-old");
    expect(later.currentRecordIds).not.toContain("constitution-old");
  });

  it("rejects empty and whitespace-only Git blobs as submissions", async () => {
    const { root } = await fixture();
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    await writeFile(join(root, "constitution.md"), "  \n\t");
    execFileSync("git", ["-C", root, "add", "constitution.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "blank constitution"], { env });
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const sha256 = createHash("sha256").update("  \n\t").digest("hex");
    const record = { recordId: "blank", kind: "artifact.submitted", payload: {
      artifactId: "constitution", targetCommit: commit, path: "constitution.md", sha256,
    } };
    const result = verifiedSnapshot(root, [record], commit, "approval-workflow");
    expect(result.verifiedRecordIds).toEqual([]);
    expect(result.invalidRecords[0]?.reason).toMatch(/empty|空|構造/);
  });

  it("requires the project's exact baseline commit to exist and precede the current commit", async () => {
    const { root, commit } = await fixture();
    const created = (/** @type {string} */ targetCommit) => ({ kind: "project.created", payload: { targetCommit } });
    expect(verifiedSnapshot(root, [created(commit)], commit, "approval-workflow").baseCommitVerified).toBe(true);
    expect(verifiedSnapshot(root, [created("f".repeat(40))], commit, "approval-workflow").baseCommitVerified).toBe(false);
    const blob = execFileSync("git", ["-C", root, "hash-object", "constitution.md"], { encoding: "utf8" }).trim();
    expect(verifiedSnapshot(root, [created(blob)], commit, "approval-workflow").baseCommitVerified).toBe(false);
  });

  it("rejects keyword-only task files committed in Git", async () => {
    const { root } = await fixture();
    const content = "AC- PROP- allow deny 依存";
    await writeFile(join(root, "task.md"), content);
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    execFileSync("git", ["-C", root, "add", "task.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "task keywords only"], { env });
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const record = { recordId: "task", kind: "artifact.submitted", payload: {
      artifactId: "task_definition", targetCommit: commit, path: "task.md",
      sha256: createHash("sha256").update(content).digest("hex"),
    } };
    const snapshot = verifiedSnapshot(root, [record], commit, "approval-workflow");
    expect(snapshot.verifiedRecordIds).toEqual([]);
    expect(snapshot.invalidRecords[0]?.reason).toMatch(/task:allow|hold-out|required-checks/);
  });

  it("does not verify a transition that moves backward in the target Git history", async () => {
    const { root, commit: baseline } = await fixture();
    await writeFile(join(root, "later.md"), "later\n");
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    execFileSync("git", ["-C", root, "add", "later.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "later"], { env });
    const current = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const records = [
      { kind: "project.created", payload: { targetCommit: baseline } },
      { kind: "phase.transitioned", recordId: "forward", payload: { subjectCommit: current } },
      { kind: "phase.transitioned", recordId: "backward", payload: { subjectCommit: baseline } },
    ];
    expect(verifiedSnapshot(root, records, current, "approval-workflow").validTransitionRecordIds).toEqual(["forward"]);
  });
});
