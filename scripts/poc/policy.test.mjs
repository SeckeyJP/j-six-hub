import { describe, expect, it } from "vitest";
import { localPolicy, localPolicySha256, validateArtifactStructure } from "./policy.mjs";

describe("versioned local PoC policy", () => {
  it("has a stable version and fingerprint separate from J-SIX process", () => {
    expect(localPolicy.schemaVersion).toBe(1);
    expect(localPolicy.id).toBe("single-pc-developer-journey-v3");
    expect(localPolicySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(localPolicy.artifactRules).toHaveProperty("requirement_spec");
  });

  it("checks core agreement structure without treating a filename as evidence", () => {
    expect(validateArtifactStructure("requirement_spec", "# REQ-001\n受入条件 AC-001\nPROP-001\n非機能\n未確定", localPolicy)).toEqual([]);
    expect(validateArtifactStructure("requirement_spec", "# Empty", localPolicy)).toContain("REQ-");
    expect(validateArtifactStructure("constitution", "project rules", localPolicy)).toEqual([]);
    expect(validateArtifactStructure("constitution", "", localPolicy)).toContain("content:empty");
    expect(validateArtifactStructure("constitution", "  \n\t", localPolicy)).toContain("content:empty");
    expect(validateArtifactStructure("task_list", "AC- PROP- allow deny 依存", localPolicy)).toContain("task:allow:missing-or-invalid");
    expect(validateArtifactStructure("task_definition", "AC- PROP- allow deny", localPolicy)).toContain("task:hold-out:missing-or-invalid");
    const task = "TASK-001: synthetic task\nAC-001: acceptance\nPROP-001: property\n依存: TASK-000\n" +
      "allow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: unit,lint\n";
    expect(validateArtifactStructure("task_definition", task, localPolicy)).toEqual([]);
  });
});
