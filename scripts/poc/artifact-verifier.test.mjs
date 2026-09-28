import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyArtifact, verifiedSnapshot } from "./artifact-verifier.mjs";
import { evaluateProject } from "./process-model.mjs";
import { localPolicySha256 } from "./policy.mjs";

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
      verifiedAtCommits: {}, validTransitionRecordIds: [], validCompletionRecordIds: [], invalidRecords: [] });
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

  it("blocks a Git-backed P1 review with heading-only requirements and rejects heading-only design", async () => {
    const { root, sha256 } = await fixture();
    const requirement = "REQ- AC- PROP- 受入条件 非機能 未確定";
    const design = "検証戦略 設計書目次";
    const flow = "# Synthetic flow\n";
    await writeFile(join(root, "requirements.md"), requirement);
    await writeFile(join(root, "design.md"), design);
    await writeFile(join(root, "flow.md"), flow);
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    execFileSync("git", ["-C", root, "add", "requirements.md", "design.md", "flow.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "heading-only specifications"], { env });
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const processDefinition = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
    const at = "2026-09-27T00:00:00.000Z";
    const event = (/** @type {string} */ recordId, /** @type {string} */ kind,
      /** @type {Record<string, unknown>} */ payload) =>
      ({ schemaVersion: 1, recordId, projectId: "sample", kind, recordedAt: at, payload });
    const submission = (/** @type {string} */ recordId, /** @type {string} */ phase,
      /** @type {string} */ artifactId, /** @type {string} */ path, /** @type {string} */ content) =>
      event(recordId, "artifact.submitted", { phase, artifactId, generation: 0, targetCommit: commit,
        path, sha256: createHash("sha256").update(content).digest("hex") });
    const records = [
      event("created", "project.created", { processSha256: processDefinition._source.sha256,
        processCommit: processDefinition._source.tag, policySha256: localPolicySha256,
        targetRepoId: "approval-workflow", targetCommit: commit, fixtureId: "approval-workflow" }),
      event("constitution", "artifact.submitted", { phase: "P0", artifactId: "constitution", generation: 0,
        targetCommit: commit, path: "constitution.md", sha256 }),
      event("to-p1", "phase.transitioned", { from: "P0", to: "P1", generation: 0,
        subjectCommit: commit, policySha256: localPolicySha256, artifactRecordIds: ["constitution"],
        reviewRecordId: null, decisionRecordIds: [] }),
      submission("req", "P1", "requirement_spec", "requirements.md", requirement),
      submission("flow", "P1", "business_flow_prototype", "flow.md", flow),
      event("review", "phase.review_requested", { phase: "P1", generation: 0,
        artifactRecordIds: ["req", "flow"], policySha256: localPolicySha256 }),
      event("decision", "gate.local_decision", { gateId: "customer_approval", phase: "P1", generation: 0,
        reviewRecordId: "review", outcome: "approved", simulated: true, role: "customer", reason: "synthetic",
        expiresAt: "2026-12-31T00:00:00.000Z" }),
    ];
    const snapshot = verifiedSnapshot(root, records, commit, "approval-workflow");
    expect(snapshot.invalidRecords.map((item) => item.recordId)).toContain("req");
    const state = evaluateProject(records, processDefinition, localPolicySha256, snapshot, "2026-09-27T12:00:00.000Z");
    expect(state.canTransition).toBe(false);
    expect(state.missing).toContain("artifact:requirement_spec:unverified");
    const designSnapshot = verifiedSnapshot(root,
      [submission("design", "P2", "design_spec", "design.md", design)], commit, "approval-workflow");
    expect(designSnapshot.invalidRecords.map((item) => item.recordId)).toContain("design");
  }, 60_000);

  it("rejects TODO task content and a task definition for a different listed task", async () => {
    const { root } = await fixture();
    const controls = "AC-001: acceptance\nPROP-001: property\n依存: none\n" +
      "allow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n";
    const list = `TASK-001: listed task\n${controls}`;
    const definition = `TASK-002: different task\n${controls}`;
    const todo = `TASK-003: TODO\nAC-003: TODO\nPROP-003: TODO\n依存: TODO\n` +
      "allow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n";
    await writeFile(join(root, "task-list.md"), list);
    await writeFile(join(root, "task-definition.md"), definition);
    await writeFile(join(root, "todo.md"), todo);
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    execFileSync("git", ["-C", root, "add", "task-list.md", "task-definition.md", "todo.md"], { env });
    execFileSync("git", ["-C", root, "commit", "-qm", "task controls"], { env });
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const submitted = (/** @type {string} */ recordId, /** @type {string} */ artifactId,
      /** @type {string} */ path, /** @type {string} */ content) => ({ recordId, kind: "artifact.submitted",
      payload: { phase: "P3", generation: 0, artifactId, targetCommit: commit, path,
        sha256: createHash("sha256").update(content).digest("hex") } });
    const records = [submitted("list", "task_list", "task-list.md", list),
      submitted("definition", "task_definition", "task-definition.md", definition),
      submitted("todo", "task_definition", "todo.md", todo)];
    const todoResult = verifiedSnapshot(root, [records[2]], commit, "approval-workflow");
    expect(todoResult.invalidRecords[0]?.reason).toMatch(/TASK|TODO|構造/);
    const mismatch = verifiedSnapshot(root, records.slice(0, 2), commit, "approval-workflow");
    expect(mismatch.verifiedRecordIds).toContain("list");
    expect(mismatch.verifiedRecordIds).not.toContain("definition");
    expect(mismatch.invalidRecords[0]?.reason).toMatch(/TASK ID/);
  }, 60_000);
});
