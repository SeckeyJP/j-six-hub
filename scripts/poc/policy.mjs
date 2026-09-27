import { createHash } from "node:crypto";

// These are additional checks for the synthetic local PoC, not gates added to the J-SIX definition.
export const localPolicy = Object.freeze({
  schemaVersion: 1,
  id: "single-pc-developer-journey-v1",
  artifactRules: {
    requirement_spec: ["REQ-", "AC-", "PROP-", "受入条件", "非機能", "未確定"],
    design_spec: ["検証戦略", "設計書目次"],
    task_list: ["AC-", "PROP-", "allow", "deny", "依存"],
    task_definition: ["AC-", "PROP-", "allow", "deny"],
    quality_metrics: ["要求充足", "欠陥", "未検証"],
    reverse_generated_docs: ["逆生成", "納品物"],
  },
  unimplementedChecks: ["task_quality_gate", "integration_tests"],
  simulatedHumanDecision: true,
});

export const localPolicySha256 = createHash("sha256").update(JSON.stringify(localPolicy)).digest("hex");

/** @param {string} artifactId @param {string} content @param {typeof localPolicy} policy */
export function validateArtifactStructure(artifactId, content, policy = localPolicy) {
  if (policy.schemaVersion !== 1) throw new Error("未知のPoC方針schemaです");
  const required = /** @type {Record<string, string[]>} */ (policy.artifactRules)[artifactId] ?? [];
  return required.filter((token) => !content.includes(token));
}
