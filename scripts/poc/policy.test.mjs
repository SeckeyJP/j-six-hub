import { describe, expect, it } from "vitest";
import { localPolicy, localPolicySha256, validateArtifactStructure } from "./policy.mjs";

describe("versioned local PoC policy", () => {
  it("has a stable version and fingerprint separate from J-SIX process", () => {
    expect(localPolicy.schemaVersion).toBe(1);
    expect(localPolicy.id).toBe("single-pc-developer-journey-v6");
    expect(localPolicySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(localPolicy.artifactRules).toHaveProperty("requirement_spec");
  });

  it("checks core agreement structure without treating a filename as evidence", () => {
    const requirement = "REQ-001: synthetic requirement\nAC-001: observable acceptance\nPROP-001: property\n" +
      "受入条件: acceptance text\n非機能: local-only operation\n未確定: なし\n";
    expect(validateArtifactStructure("requirement_spec", requirement, localPolicy)).toEqual([]);
    expect(validateArtifactStructure("requirement_spec", "# Empty", localPolicy)).toContain("REQ-");
    expect(validateArtifactStructure("requirement_spec", "REQ- AC- PROP- 受入条件 非機能 未確定", localPolicy))
      .toContain("requirement:REQ:missing-or-empty");
    expect(validateArtifactStructure("design_spec", "検証戦略 設計書目次", localPolicy))
      .toContain("design:検証戦略:missing-or-empty");
    expect(validateArtifactStructure("design_spec", "検証戦略: unit and hold-out checks\n設計書目次: API, operations\n", localPolicy))
      .toEqual([]);
    expect(validateArtifactStructure("constitution", "project rules", localPolicy)).toEqual([]);
    expect(validateArtifactStructure("constitution", "", localPolicy)).toContain("content:empty");
    expect(validateArtifactStructure("constitution", "  \n\t", localPolicy)).toContain("content:empty");
    expect(validateArtifactStructure("task_list", "AC- PROP- allow deny 依存", localPolicy)).toContain("task:allow:missing-or-invalid");
    expect(validateArtifactStructure("task_definition", "AC- PROP- allow deny", localPolicy)).toContain("task:hold-out:missing-or-invalid");
    const task = "TASK-001: synthetic task\nAC-001: acceptance\nPROP-001: property\n依存: TASK-000\n" +
      "allow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: unit,lint\n";
    expect(validateArtifactStructure("task_definition", task, localPolicy)).toEqual([]);
    const todo = task.replace("synthetic task", "TODO").replace("acceptance", "TODO")
      .replace("property", "TODO").replace("TASK-000", "TODO");
    expect(validateArtifactStructure("task_definition", todo, localPolicy)).toContain("task:TASK:missing-or-invalid");
    expect(validateArtifactStructure("task_definition", todo, localPolicy)).toContain("task:dependencies:missing-or-invalid");
    const multiple = task + "TASK-002: second task\n";
    expect(validateArtifactStructure("task_list", multiple, localPolicy)).toContain("task:multiple-definitions:unimplemented");
  });
});
