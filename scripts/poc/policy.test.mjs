import { describe, expect, it } from "vitest";
import { localPolicy, localPolicySha256, validateArtifactStructure } from "./policy.mjs";

describe("versioned local PoC policy", () => {
  it("has a stable version and fingerprint separate from J-SIX process", () => {
    expect(localPolicy.schemaVersion).toBe(1);
    expect(localPolicy.id).toBe("single-pc-developer-journey-v2");
    expect(localPolicySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(localPolicy.artifactRules).toHaveProperty("requirement_spec");
  });

  it("checks core agreement structure without treating a filename as evidence", () => {
    expect(validateArtifactStructure("requirement_spec", "# REQ-001\n受入条件 AC-001\nPROP-001\n非機能\n未確定", localPolicy)).toEqual([]);
    expect(validateArtifactStructure("requirement_spec", "# Empty", localPolicy)).toContain("REQ-");
    expect(validateArtifactStructure("constitution", "project rules", localPolicy)).toEqual([]);
    expect(validateArtifactStructure("constitution", "", localPolicy)).toContain("content:empty");
    expect(validateArtifactStructure("constitution", "  \n\t", localPolicy)).toContain("content:empty");
  });
});
