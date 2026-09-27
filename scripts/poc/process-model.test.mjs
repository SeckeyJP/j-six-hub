import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateProject, validateProcess } from "./process-model.mjs";

const process = JSON.parse(readFileSync(join(globalThis.process.cwd(), ".cache/process.json"), "utf8"));
const policySha256 = "b".repeat(64);
const processSha256 = process._source.sha256;
const artifactCommit = "c".repeat(40);
/** @param {string} id @param {string} phase @param {string} artifactId @param {number=} generation */
const submitted = (id, phase, artifactId, generation = 0) => ({
  schemaVersion: 1,
  recordId: id,
  projectId: "sample",
  kind: "artifact.submitted",
  recordedAt: "2026-09-27T00:00:00.000Z",
  payload: { phase, artifactId, generation, targetCommit: artifactCommit, path: `${artifactId}.md`, sha256: "d".repeat(64) },
});
const created = {
  schemaVersion: 1,
  recordId: "created",
  projectId: "sample",
  kind: "project.created",
  recordedAt: "2026-09-27T00:00:00.000Z",
  payload: { processSha256, policySha256, processCommit: process._source.tag,
    targetRepoId: "approval-workflow", targetCommit: artifactCommit, fixtureId: "approval-workflow" },
};

/** @param {string} id @param {string} from @param {string} to @param {string[]} artifactRecordIds
 * @param {string|null=} reviewRecordId @param {string[]=} decisionRecordIds */
const transitioned = (id, from, to, artifactRecordIds, reviewRecordId = null, decisionRecordIds = []) => ({
  schemaVersion: 1, recordId: id, projectId: "sample", kind: "phase.transitioned",
  recordedAt: "2026-09-27T00:00:00.000Z",
  payload: { from, to, generation: 0, subjectCommit: artifactCommit, policySha256,
    artifactRecordIds, reviewRecordId, decisionRecordIds },
});

const snapshot = { repoId: "approval-workflow", commit: artifactCommit, verifiedRecordIds: ["constitution", "req", "flow", "req-v2"],
  currentRecordIds: ["constitution", "req", "flow", "req-v2"] };

/** @returns {any[]} */
function p1ReadyRecords() {
  return [created, submitted("constitution", "P0", "constitution"),
    transitioned("to-p1", "P0", "P1", ["constitution"]),
    submitted("req", "P1", "requirement_spec"), submitted("flow", "P1", "business_flow_prototype"),
    { schemaVersion: 1, recordId: "review", projectId: "sample", kind: "phase.review_requested",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P1", generation: 0,
        artifactRecordIds: ["req", "flow"], policySha256 } },
    { schemaVersion: 1, recordId: "decision", projectId: "sample", kind: "gate.local_decision",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "customer_approval", phase: "P1", generation: 0,
        reviewRecordId: "review", outcome: "approved", simulated: true, role: "customer", reason: "合成",
        expiresAt: "2026-12-31T00:00:00.000Z" } }];
}

describe("process projection", () => {
  it("validates the pinned process and gets gates from its data", () => {
    const model = validateProcess(process, processSha256);
    expect(model.phaseIds).toEqual(["P0", "P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(model.gates.P1.id).toBe("customer_approval");
    expect(model.gates.P4.layers.map((/** @type {any} */ layer) => layer.id)).toEqual(["G1", "G2", "G3", "G4"]);
  });

  it("rejects process definitions with unknown output IDs or missing state machines", () => {
    const badOutput = structuredClone(process);
    badOutput.phases[0].outputs = ["invented_output"];
    expect(() => validateProcess(badOutput, processSha256)).toThrow(/output|artifact/);
    const missingStates = structuredClone(process);
    missingStates.state_machines = [];
    expect(() => validateProcess(missingStates, processSha256)).toThrow(/state/);
  });

  it("blocks P0 until a verified constitution is submitted, then allows P1", () => {
    const blocked = evaluateProject([created], process, policySha256, snapshot);
    expect(blocked.phase).toBe("P0");
    expect(blocked.canTransition).toBe(false);
    expect(blocked.missing).toContain("artifact:constitution");
    const ready = evaluateProject([created, submitted("constitution", "P0", "constitution")], process, policySha256, snapshot);
    expect(ready.canTransition).toBe(true);
    expect(ready.nextPhase).toBe("P1");
    expect(ready.gate).toBeNull();
  });

  it("requires current submitted artifacts, review request and simulated gate decision in P1", () => {
    /** @type {any[]} */
    const records = [created, submitted("constitution", "P0", "constitution"),
      transitioned("to-p1", "P0", "P1", ["constitution"]),
      submitted("req", "P1", "requirement_spec"), submitted("flow", "P1", "business_flow_prototype")];
    const before = evaluateProject(records, process, policySha256, snapshot);
    expect(before.canTransition).toBe(false);
    expect(before.missing).toContain("review:P1");
    records.push({ schemaVersion: 1, recordId: "review", projectId: "sample", kind: "phase.review_requested",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P1", generation: 0, artifactRecordIds: ["req", "flow"], policySha256 } });
    records.push({ schemaVersion: 1, recordId: "decision", projectId: "sample", kind: "gate.local_decision",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "customer_approval", phase: "P1", generation: 0,
        reviewRecordId: "review", outcome: "approved", simulated: true, role: "customer", reason: "合成題材で確認", expiresAt: "2026-12-31T00:00:00.000Z" } });
    const ready = evaluateProject(records, process, policySha256, snapshot, "2026-09-27T12:00:00.000Z");
    expect(ready.canTransition).toBe(true);
    expect(ready.nextPhase).toBe("P2");
    expect(ready.gate).toBe("customer_approval");
  });

  it("invalidates old decisions when the target or policy changes", () => {
    const target = evaluateProject([created, submitted("constitution", "P0", "constitution")], process, policySha256,
      { ...snapshot, commit: "e".repeat(40) });
    expect(target.canTransition).toBe(false);
    expect(target.missing).toContain("target:commit-changed");
    const policy = evaluateProject([created, submitted("constitution", "P0", "constitution")], process, "e".repeat(64), snapshot);
    expect(policy.canTransition).toBe(false);
    expect(policy.missing).toContain("policy:changed");
  });

  it("never treats the unimplemented P4 checks as passed", () => {
    const records = [created, submitted("constitution", "P0", "constitution"),
      transitioned("fake-p4", "P0", "P4", ["constitution"])];
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/遷移/);
  });

  it("rejects a structurally ordered transition without prior phase evidence", () => {
    const records = [created, transitioned("forged", "P0", "P1", ["constitution"])];
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/証拠|提出/);
  });

  it("keeps P1 blocked when a decision expired or its review was superseded", () => {
    /** @type {any[]} */
    const records = [created, submitted("constitution", "P0", "constitution"),
      transitioned("to-p1", "P0", "P1", ["constitution"]),
      submitted("req", "P1", "requirement_spec"), submitted("flow", "P1", "business_flow_prototype"),
      { schemaVersion: 1, recordId: "review", projectId: "sample", kind: "phase.review_requested",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P1", generation: 0,
          artifactRecordIds: ["req", "flow"], policySha256 } },
      { schemaVersion: 1, recordId: "decision", projectId: "sample", kind: "gate.local_decision",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "customer_approval", phase: "P1", generation: 0,
          reviewRecordId: "review", outcome: "approved", simulated: true, role: "customer", reason: "合成",
          expiresAt: "2026-09-28T00:00:00.000Z" } }];
    expect(evaluateProject(records, process, policySha256, snapshot, "2026-09-29T00:00:00.000Z").canTransition).toBe(false);
    records.push(submitted("req-v2", "P1", "requirement_spec"));
    const changed = evaluateProject(records, process, policySha256, snapshot, "2026-09-27T12:00:00.000Z");
    expect(changed.canTransition).toBe(false);
    expect(changed.missing).toContain("review:P1");
  });

  it("moves through an approved P1 and invalidates prior approval after reopening", () => {
    /** @type {any[]} */
    const records = [created, submitted("constitution", "P0", "constitution"),
      transitioned("to-p1", "P0", "P1", ["constitution"]),
      submitted("req", "P1", "requirement_spec"), submitted("flow", "P1", "business_flow_prototype"),
      { schemaVersion: 1, recordId: "review", projectId: "sample", kind: "phase.review_requested",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P1", generation: 0,
          artifactRecordIds: ["req", "flow"], policySha256 } },
      { schemaVersion: 1, recordId: "decision", projectId: "sample", kind: "gate.local_decision",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "customer_approval", phase: "P1", generation: 0,
          reviewRecordId: "review", outcome: "approved", simulated: true, role: "customer", reason: "合成",
          expiresAt: "2026-12-31T00:00:00.000Z" } },
      transitioned("to-p2", "P1", "P2", ["req", "flow"], "review", ["decision"])];
    expect(evaluateProject(records, process, policySha256, snapshot).phase).toBe("P2");
    records.push({ schemaVersion: 1, recordId: "reopen", projectId: "sample", kind: "phase.reopened",
      recordedAt: "2026-09-27T13:00:00.000Z", payload: { phase: "P1", generation: 1, reason: "要求差戻し" } });
    const reopened = evaluateProject(records, process, policySha256, snapshot);
    expect(reopened.phase).toBe("P1");
    expect(reopened.generation).toBe(1);
    expect(reopened.canTransition).toBe(false);
    expect(reopened.missing).toContain("artifact:requirement_spec");
  });

  it("rejects a recorded transition when the historical artifact was not Git-verified", () => {
    const history = [created, submitted("constitution", "P0", "constitution"),
      transitioned("to-p1", "P0", "P1", ["constitution"])];
    expect(() => evaluateProject(history, process, policySha256, { ...snapshot, verifiedRecordIds: [] }))
      .toThrow(/未検証|照合/);
  });

  it("compares decision expiry as instants and rejects invalid timestamps", () => {
    const records = p1ReadyRecords();
    records.at(-1).payload.expiresAt = "2026-09-27T13:00:00+09:00";
    expect(evaluateProject(records, process, policySha256, snapshot, "2026-09-27T12:00:00.000Z").canTransition).toBe(false);
    records.at(-1).payload.expiresAt = "2026-09-27T12:00:00.000Z";
    expect(evaluateProject(records, process, policySha256, snapshot, "2026-09-27T12:00:00.000Z").canTransition).toBe(false);
    records.at(-1).payload.expiresAt = "not-a-date";
    expect(evaluateProject(records, process, policySha256, snapshot, "2026-09-27T12:00:00.000Z").canTransition).toBe(false);
    records.at(-1).payload.expiresAt = "2026-12-31T00:00:00.000Z";
    records.at(-1).recordedAt = "not-a-date";
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/時刻|日時/);
    records.at(-1).recordedAt = "2026-09-27T13:00:00.000Z";
    expect(evaluateProject(records, process, policySha256, snapshot, "2026-09-27T12:00:00.000Z").canTransition).toBe(false);
    records.at(-1).recordedAt = "2026-09-26T23:00:00.000Z";
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/時刻|順序/);
    expect(() => evaluateProject(p1ReadyRecords(), process, policySha256, snapshot, "not-a-date")).toThrow(/時刻|日時/);
  });

  it("requires explicit reopen before changing a passed phase or an unknown output", () => {
    const records = p1ReadyRecords();
    records.push(submitted("old-constitution-v2", "P0", "constitution"));
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/現在Phase|逆戻り/);
    const unknown = p1ReadyRecords();
    unknown.push(submitted("wrong", "P1", "invented"));
    expect(() => evaluateProject(unknown, process, policySha256, snapshot)).toThrow(/成果物|artifact/);
    const wrongGeneration = p1ReadyRecords();
    wrongGeneration.push(submitted("future", "P1", "requirement_spec", 1));
    expect(() => evaluateProject(wrongGeneration, process, policySha256, snapshot)).toThrow(/世代/);
  });

  it("rejects a transition whose pinned artifact set does not match the submissions", () => {
    const records = p1ReadyRecords();
    records.push(transitioned("to-p2", "P1", "P2", ["req"], "review", ["decision"]));
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/対象版|提出集合|証拠/);
  });

  it("keeps a completed transition replayable after its decision expires", () => {
    const records = p1ReadyRecords();
    records.at(-1).payload.expiresAt = "2026-09-28T00:00:00.000Z";
    records.push(transitioned("to-p2", "P1", "P2", ["req", "flow"], "review", ["decision"]));
    const state = evaluateProject(records, process, policySha256, snapshot, "2026-10-01T00:00:00.000Z");
    expect(state.phase).toBe("P2");
  });

  it("reaches P4 through valid prior decisions but keeps every unimplemented task check blocked", () => {
    /** @type {any[]} */
    const records = p1ReadyRecords();
    records.push(transitioned("to-p2", "P1", "P2", ["req", "flow"], "review", ["decision"]));
    for (const id of ["design_spec", "adr", "working_prototype", "properties"]) records.push(submitted(id, "P2", id));
    records.push({ schemaVersion: 1, recordId: "review-p2", projectId: "sample", kind: "phase.review_requested",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P2", generation: 0,
        artifactRecordIds: ["design_spec", "adr", "working_prototype", "properties"], policySha256 } });
    records.push({ schemaVersion: 1, recordId: "decision-p2", projectId: "sample", kind: "gate.local_decision",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "design_review", phase: "P2", generation: 0,
        reviewRecordId: "review-p2", outcome: "approved", simulated: true, role: "architect", reason: "合成",
        expiresAt: "2026-12-31T00:00:00.000Z" } });
    records.push(transitioned("to-p3", "P2", "P3", ["design_spec", "adr", "working_prototype", "properties"],
      "review-p2", ["decision-p2"]));
    records.push(submitted("task_list", "P3", "task_list"), submitted("task_definition", "P3", "task_definition"));
    records.push({ schemaVersion: 1, recordId: "review-p3", projectId: "sample", kind: "phase.review_requested",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P3", generation: 0,
        artifactRecordIds: ["task_list", "task_definition"], policySha256 } });
    records.push({ schemaVersion: 1, recordId: "decision-p3", projectId: "sample", kind: "gate.local_decision",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "task_approval", phase: "P3", generation: 0,
        reviewRecordId: "review-p3", outcome: "approved", simulated: true, role: "gatekeeper", reason: "合成",
        expiresAt: "2026-12-31T00:00:00.000Z" } });
    records.push(transitioned("to-p4", "P3", "P4", ["task_list", "task_definition"], "review-p3", ["decision-p3"]));
    const verifiedRecordIds = records.filter((item) => item.kind === "artifact.submitted").map((item) => item.recordId);
    const state = evaluateProject(records, process, policySha256, { repoId: "approval-workflow", commit: artifactCommit, verifiedRecordIds,
      currentRecordIds: verifiedRecordIds });
    expect(state.phase).toBe("P4");
    expect(state.canTransition).toBe(false);
    expect(state.missing).toContain("check:G1/build:unimplemented");
    expect(state.missing).toContain("check:G4/evidence_pack:unimplemented");
    expect(state.missing).toContain("check:G3/scope_judge:unimplemented");
  });

  it("blocks a later phase when a passed artifact changed, but accepts unrelated edits", () => {
    const records = p1ReadyRecords();
    records.push(transitioned("to-p2", "P1", "P2", ["req", "flow"], "review", ["decision"]));
    for (const id of ["design_spec", "adr", "working_prototype", "properties"]) records.push(submitted(id, "P2", id));
    records.push({ schemaVersion: 1, recordId: "review-p2", projectId: "sample", kind: "phase.review_requested",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P2", generation: 0,
        artifactRecordIds: ["design_spec", "adr", "working_prototype", "properties"], policySha256 } });
    records.push({ schemaVersion: 1, recordId: "decision-p2", projectId: "sample", kind: "gate.local_decision",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "design_review", phase: "P2", generation: 0,
        reviewRecordId: "review-p2", outcome: "approved", simulated: true, role: "architect", reason: "合成",
        expiresAt: "2026-12-31T00:00:00.000Z" } });
    const allIds = records.filter((item) => item.kind === "artifact.submitted").map((item) => item.recordId);
    const unrelated = { repoId: "approval-workflow", commit: artifactCommit, verifiedRecordIds: allIds, currentRecordIds: allIds };
    expect(evaluateProject(records, process, policySha256, unrelated).canTransition).toBe(true);
    const changedRequirement = { ...unrelated, currentRecordIds: allIds.filter((id) => id !== "req") };
    const blocked = evaluateProject(records, process, policySha256, changedRequirement);
    expect(blocked.canTransition).toBe(false);
    expect(blocked.missing).toContain("passed-artifact:req:changed");
    records.push({ schemaVersion: 1, recordId: "reopen-p1", projectId: "sample", kind: "phase.reopened",
      recordedAt: "2026-09-27T13:00:00.000Z", payload: { phase: "P1", generation: 1, reason: "要求の変更" } });
    const changedConstitution = { ...unrelated, currentRecordIds: allIds.filter((id) => id !== "constitution") };
    const reopened = evaluateProject(records, process, policySha256, changedConstitution);
    expect(reopened.missing).toContain("passed-artifact:constitution:changed");
  });

  it("rejects project creation without bound target and process identifiers", () => {
    for (const field of ["targetRepoId", "targetCommit", "processCommit", "fixtureId"]) {
      const invalid = structuredClone(created);
      delete /** @type {Record<string, unknown>} */ (invalid.payload)[field];
      expect(() => evaluateProject([invalid], process, policySha256, snapshot)).toThrow(/案件|作成|対象|process/);
    }
    const wrongProcess = structuredClone(created);
    wrongProcess.payload.processCommit = "a".repeat(40);
    expect(() => evaluateProject([wrongProcess], process, policySha256, snapshot)).toThrow(/process|版/);
    const absoluteRepo = structuredClone(created);
    absoluteRepo.payload.targetRepoId = "/tmp/private-path";
    expect(() => evaluateProject([absoluteRepo], process, policySha256, snapshot)).toThrow(/repo|対象/);
  });
});
