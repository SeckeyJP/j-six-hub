import { createHash } from "node:crypto";

// These are additional checks for the synthetic local PoC, not gates added to the J-SIX definition.
export const localPolicy = Object.freeze({
  schemaVersion: 1,
  id: "single-pc-developer-journey-v5",
  artifactRules: {
    requirement_spec: ["REQ-", "AC-", "PROP-", "受入条件", "非機能", "未確定"],
    design_spec: ["検証戦略", "設計書目次"],
    task_list: ["AC-", "PROP-", "allow", "deny", "依存", "hold-out", "required-checks"],
    task_definition: ["AC-", "PROP-", "allow", "deny", "依存", "hold-out", "required-checks"],
    quality_metrics: ["要求充足", "欠陥", "未検証"],
    reverse_generated_docs: ["逆生成", "納品物"],
  },
  unimplementedChecks: ["task_quality_gate", "integration_tests"],
  simulatedHumanDecision: true,
});

export const localPolicySha256 = createHash("sha256").update(JSON.stringify(localPolicy)).digest("hex");

/** @param {string} value */
function safeTaskPath(value) {
  return !!value && value !== "none" && value !== "TODO" && value !== "..." &&
    !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") &&
    value.split("/").every((part) => !!part && part !== "." && part !== ".." &&
      /^[A-Za-z0-9._*-]+$/.test(part));
}

/** @param {string} content */
function taskGaps(content) {
  const missing = [];
  for (const marker of ["TASK", "AC", "PROP"]) {
    if (!hasFilledField(content, marker)) missing.push(`task:${marker}:missing-or-invalid`);
  }
  if (!hasFilledField(content, "依存", true)) missing.push("task:dependencies:missing-or-invalid");
  if (taskIds(content).length !== 1) missing.push("task:multiple-definitions:unimplemented");
  for (const field of ["allow", "deny", "hold-out"]) {
    const value = new RegExp(`^${field}:[ \\t]*(\\S[^\\r\\n]*)$`, "m").exec(content)?.[1]?.trim();
    if (!value || !value.split(",").map((part) => part.trim()).every(safeTaskPath)) {
      missing.push(`task:${field}:missing-or-invalid`);
    }
  }
  const checks = /^required-checks:[ \t]*(\S[^\r\n]*)$/m.exec(content)?.[1]?.trim();
  if (!checks || !checks.split(",").map((part) => part.trim())
    .every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && !["none", "TODO"].includes(part))) {
    missing.push("task:required-checks:missing-or-invalid");
  }
  return missing;
}

/** @param {string} content @param {string} field @param {boolean=} allowNone */
function hasFilledField(content, field, allowNone = false) {
  const pattern = ["REQ", "AC", "PROP", "TASK"].includes(field)
    ? `^${field}-[0-9]+:[ \\t]*(\\S[^\\r\\n]*)$`
    : `^${field}[：:][ \\t]*(\\S[^\\r\\n]*)$`;
  const value = new RegExp(pattern, "m").exec(content)?.[1]?.trim();
  if (!value || /^(?:TODO|TBD|未定|未記入|\.\.\.|-|なし|none)$/i.test(value) &&
    !(allowNone && /^(?:なし|none)$/i.test(value))) return false;
  return true;
}

/** @param {string} content */
export function taskIds(content) {
  return [...content.matchAll(/^TASK-[0-9]+:/gm)].map((match) => match[0].slice(0, -1));
}

/** @param {string} content */
function requirementGaps(content) {
  return ["REQ", "AC", "PROP", "受入条件", "非機能", "未確定"]
    .filter((field) => !hasFilledField(content, field, field === "未確定"))
    .map((field) => `requirement:${field}:missing-or-empty`);
}

/** @param {string} content */
function designGaps(content) {
  return ["検証戦略", "設計書目次"]
    .filter((field) => !hasFilledField(content, field))
    .map((field) => `design:${field}:missing-or-empty`);
}

/** @param {string} artifactId @param {string} content @param {typeof localPolicy} policy */
export function validateArtifactStructure(artifactId, content, policy = localPolicy) {
  if (policy.schemaVersion !== 1) throw new Error("未知のPoC方針schemaです");
  const required = /** @type {Record<string, string[]>} */ (policy.artifactRules)[artifactId] ?? [];
  if (typeof content !== "string" || !content.trim()) return ["content:empty", ...required];
  const missing = required.filter((token) => !content.includes(token));
  if (["task_list", "task_definition"].includes(artifactId)) missing.push(...taskGaps(content));
  if (artifactId === "requirement_spec") missing.push(...requirementGaps(content));
  if (artifactId === "design_spec") missing.push(...designGaps(content));
  return missing;
}
