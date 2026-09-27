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
  payload: { processSha256, policySha256, targetCommit: artifactCommit, fixtureId: "approval-workflow" },
};

const snapshot = { commit: artifactCommit, verifiedRecordIds: ["constitution", "req", "flow", "req-v2"] };

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
    const records = [created, submitted("constitution", "P0", "constitution"), {
      schemaVersion: 1, recordId: "to-p1", projectId: "sample", kind: "phase.transitioned",
      recordedAt: "2026-09-27T00:00:00.000Z", payload: { from: "P0", to: "P1", generation: 0 },
    }, submitted("req", "P1", "requirement_spec"), submitted("flow", "P1", "business_flow_prototype")];
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
      { schemaVersion: 1, recordId: "fake-p4", projectId: "sample", kind: "phase.transitioned",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { from: "P0", to: "P4", generation: 0 } }];
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/遷移/);
  });

  it("rejects a structurally ordered transition without prior phase evidence", () => {
    const records = [created, { schemaVersion: 1, recordId: "forged", projectId: "sample",
      kind: "phase.transitioned", recordedAt: "2026-09-27T00:00:00.000Z",
      payload: { from: "P0", to: "P1", generation: 0 } }];
    expect(() => evaluateProject(records, process, policySha256, snapshot)).toThrow(/証拠|提出/);
  });

  it("keeps P1 blocked when a decision expired or its review was superseded", () => {
    /** @type {any[]} */
    const records = [created, submitted("constitution", "P0", "constitution"),
      { schemaVersion: 1, recordId: "to-p1", projectId: "sample", kind: "phase.transitioned",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { from: "P0", to: "P1", generation: 0 } },
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
      { schemaVersion: 1, recordId: "to-p1", projectId: "sample", kind: "phase.transitioned",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { from: "P0", to: "P1", generation: 0 } },
      submitted("req", "P1", "requirement_spec"), submitted("flow", "P1", "business_flow_prototype"),
      { schemaVersion: 1, recordId: "review", projectId: "sample", kind: "phase.review_requested",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { phase: "P1", generation: 0,
          artifactRecordIds: ["req", "flow"], policySha256 } },
      { schemaVersion: 1, recordId: "decision", projectId: "sample", kind: "gate.local_decision",
        recordedAt: "2026-09-27T00:00:00.000Z", payload: { gateId: "customer_approval", phase: "P1", generation: 0,
          reviewRecordId: "review", outcome: "approved", simulated: true, role: "customer", reason: "合成",
          expiresAt: "2026-12-31T00:00:00.000Z" } },
      { schemaVersion: 1, recordId: "to-p2", projectId: "sample", kind: "phase.transitioned",
        recordedAt: "2026-09-27T12:00:00.000Z", payload: { from: "P1", to: "P2", generation: 0 } }];
    expect(evaluateProject(records, process, policySha256, snapshot).phase).toBe("P2");
    records.push({ schemaVersion: 1, recordId: "reopen", projectId: "sample", kind: "phase.reopened",
      recordedAt: "2026-09-27T13:00:00.000Z", payload: { phase: "P1", generation: 1, reason: "要求差戻し" } });
    const reopened = evaluateProject(records, process, policySha256, snapshot);
    expect(reopened.phase).toBe("P1");
    expect(reopened.generation).toBe(1);
    expect(reopened.canTransition).toBe(false);
    expect(reopened.missing).toContain("artifact:requirement_spec");
  });
});
