import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifiedSnapshot } from "./artifact-verifier.mjs";
import { evaluateProject } from "./process-model.mjs";
import { localPolicySha256 } from "./policy.mjs";

const processDefinition = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
const now = "2026-09-27T12:00:00.000Z";
/** @type {string[]} */
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("passed artifact validity across real Git commits", () => {
  it("allows unrelated work while holding a changed requirement until reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-journey-"));
    roots.push(root);
    const env = { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
    const git = (/** @type {string[]} */ args) => execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" }).trim();
    const hash = (/** @type {string} */ content) => createHash("sha256").update(content).digest("hex");
    /** @type {Record<string, string>} */
    const files = {
      "constitution.md": "# Synthetic constitution\n",
      "requirements.md": "REQ-001 AC-001 PROP-001 受入条件 非機能 未確定\n",
      "flow.md": "# Synthetic workflow\n",
    };
    git(["init", "-q"]);
    for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
    git(["add", "."]); git(["commit", "-qm", "baseline"]);
    const baseline = git(["rev-parse", "HEAD"]);
    /** @type {any[]} */
    const records = [];
    const record = (/** @type {string} */ id, /** @type {string} */ kind, /** @type {Record<string, unknown>} */ payload) => {
      records.push({ schemaVersion: 1, recordId: id, projectId: "sample", kind, recordedAt: now, payload });
    };
    const submit = (/** @type {string} */ id, /** @type {string} */ phase,
      /** @type {string} */ artifactId, /** @type {string} */ path, /** @type {string} */ commit) => {
      const content = files[path];
      if (content === undefined) throw new Error(`fixture file missing: ${path}`);
      record(id, "artifact.submitted", { phase, artifactId, generation: 0,
        targetCommit: commit, path, sha256: hash(content) });
    };
    const transition = (/** @type {string} */ id, /** @type {string} */ from, /** @type {string} */ to,
      /** @type {string} */ subjectCommit, /** @type {string[]} */ artifactRecordIds,
      /** @type {string|null} */ reviewRecordId, /** @type {string[]} */ decisionRecordIds) => {
      record(id, "phase.transitioned", { from, to, generation: 0, subjectCommit,
        artifactRecordIds, reviewRecordId, decisionRecordIds, policySha256: localPolicySha256 });
    };
    record("created", "project.created", { processSha256: processDefinition._source.sha256,
      processCommit: processDefinition._source.tag, policySha256: localPolicySha256,
      targetRepoId: "approval-workflow", targetCommit: baseline, fixtureId: "approval-workflow" });
    submit("constitution", "P0", "constitution", "constitution.md", baseline);
    transition("to-p1", "P0", "P1", baseline, ["constitution"], null, []);
    submit("req", "P1", "requirement_spec", "requirements.md", baseline);
    submit("flow", "P1", "business_flow_prototype", "flow.md", baseline);
    record("review-p1", "phase.review_requested", { phase: "P1", generation: 0,
      artifactRecordIds: ["req", "flow"], policySha256: localPolicySha256 });
    record("decision-p1", "gate.local_decision", { gateId: "customer_approval", phase: "P1", generation: 0,
      reviewRecordId: "review-p1", outcome: "approved", simulated: true, role: "customer",
      reason: "synthetic", expiresAt: "2026-12-31T00:00:00.000Z" });
    transition("to-p2", "P1", "P2", baseline, ["req", "flow"], "review-p1", ["decision-p1"]);
    Object.assign(files, {
      "design.md": "検証戦略 設計書目次\n", "adr.md": "# Synthetic ADR\n",
      "prototype.md": "# Working prototype\n", "properties.md": "# Properties\n",
    });
    for (const path of ["design.md", "adr.md", "prototype.md", "properties.md"]) {
      const content = files[path];
      if (content === undefined) throw new Error(`fixture file missing: ${path}`);
      await writeFile(join(root, path), content);
    }
    git(["add", "."]); git(["commit", "-qm", "unrelated phase two work"]);
    const unrelated = git(["rev-parse", "HEAD"]);
    for (const [id, path] of /** @type {[string,string][]} */ ([["design_spec", "design.md"], ["adr", "adr.md"],
      ["working_prototype", "prototype.md"], ["properties", "properties.md"]])) {
      submit(id, "P2", id, path, unrelated);
    }
    record("review-p2", "phase.review_requested", { phase: "P2", generation: 0,
      artifactRecordIds: ["design_spec", "adr", "working_prototype", "properties"],
      policySha256: localPolicySha256 });
    record("decision-p2", "gate.local_decision", { gateId: "design_review", phase: "P2", generation: 0,
      reviewRecordId: "review-p2", outcome: "approved", simulated: true, role: "architect",
      reason: "synthetic", expiresAt: "2026-12-31T00:00:00.000Z" });
    const valid = verifiedSnapshot(root, records, unrelated, "approval-workflow");
    expect(evaluateProject(records, processDefinition, localPolicySha256, valid, now).canTransition).toBe(true);
    files["requirements.md"] = "REQ-002 AC-002 PROP-002 受入条件 非機能 未確定\n";
    await writeFile(join(root, "requirements.md"), files["requirements.md"]);
    git(["add", "requirements.md"]); git(["commit", "-qm", "changed requirement"]);
    const changed = git(["rev-parse", "HEAD"]);
    const current = verifiedSnapshot(root, records, changed, "approval-workflow");
    expect(current.verifiedRecordIds).toContain("req");
    expect(current.currentRecordIds).not.toContain("req");
    expect(evaluateProject(records, processDefinition, localPolicySha256, current, now).missing)
      .toContain("passed-artifact:req:changed");
  });
});
