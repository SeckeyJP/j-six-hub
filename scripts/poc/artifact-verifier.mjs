import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute, posix } from "node:path";
import { taskIds, validateArtifactStructure } from "./policy.mjs";

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

/** @param {string} path */
function assertRelativePath(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") ||
    path.includes("\0") || path.includes("\n") || path.startsWith("-") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    posix.normalize(path) !== path) throw new Error("artifact pathが不正です");
}

/** @param {string} repo @param {{targetCommit:string,path:string,sha256:string}} artifact */
export function verifyArtifact(repo, artifact) {
  const { targetCommit, path, sha256 } = artifact;
  if (!/^[0-9a-f]{40,64}$/.test(targetCommit) || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("artifact commit/SHA hashが不正です");
  }
  assertRelativePath(path);
  let resolved;
  try { resolved = git(repo, ["rev-parse", "--verify", `${targetCommit}^{commit}`]).toString("utf8").trim(); }
  catch (error) { throw new Error("artifact対象commitを確認できません", { cause: error }); }
  if (resolved !== targetCommit) throw new Error("artifact対象commitが一致しません");
  const entries = git(repo, ["ls-tree", "-rz", targetCommit, "--", path]).toString("utf8").split("\0").filter(Boolean);
  const match = entries.find((entry) => entry.slice(entry.indexOf("\t") + 1) === path);
  if (!match) throw new Error("artifact pathが対象commitにありません");
  const [mode, type, object] = match.slice(0, match.indexOf("\t")).split(" ");
  if (!mode || !object || !["100644", "100755"].includes(mode) || type !== "blob") {
    throw new Error("artifact symlink/modeは許可しません");
  }
  const actual = createHash("sha256").update(git(repo, ["cat-file", "blob", object])).digest("hex");
  if (actual !== sha256) throw new Error("artifact内容のSHA hashが一致しません");
  return true;
}

/** @param {string} repo @param {string} targetCommit @param {string} content */
function verifyEvidenceReference(repo, targetCommit, content) {
  let pack;
  try { pack = JSON.parse(content); } catch (error) { throw new Error("evidence pack JSONが不正です", { cause: error }); }
  if (pack?.schemaVersion !== 1 || pack?.checkEvidence?.path !== "docs/check-evidence.json" ||
    !/^[0-9a-f]{64}$/.test(pack?.checkEvidence?.sha256 ?? "")) {
    throw new Error("evidence packの検査証跡参照が不正です");
  }
  verifyArtifact(repo, { targetCommit, path: pack.checkEvidence.path, sha256: pack.checkEvidence.sha256 });
}

/** @param {string} repo @param {string} targetCommit @param {any[]} manifest */
function verifyEvidenceManifest(repo, targetCommit, manifest) {
  if (!Array.isArray(manifest) || manifest.length !== 4 ||
    new Set(manifest.map((item) => item?.evidenceId)).size !== manifest.length) {
    throw new Error("品質検査の証跡manifestが不正です");
  }
  for (const item of manifest) {
    if (typeof item?.evidenceId !== "string") throw new Error("品質検査の証跡IDが不正です");
    verifyArtifact(repo, { targetCommit, path: item.path, sha256: item.sha256 });
  }
}

/** @param {string} repo @param {any[]} records @param {string} commit @param {string} repoId */
export function verifiedSnapshot(repo, records, commit, repoId) {
  if (typeof repoId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(repoId)) {
    throw new Error("対象repo IDが不正です");
  }
  /** @type {string[]} */
  const verifiedRecordIds = [];
  /** @type {string[]} */
  const currentRecordIds = [];
  /** @type {{recordId:string,reason:string}[]} */
  const invalidRecords = [];
  /** @type {Record<string, string[]>} */
  const verifiedAtCommits = {};
  /** @type {string[]} */
  const validTransitionRecordIds = [];
  /** @type {string[]} */
  const validCompletionRecordIds = [];
  /** @type {string[]} */
  const verifiedCheckRecordIds = [];
  /** @type {string[]} */
  const currentCheckRecordIds = [];
  /** @type {Map<string,string>} */
  const verifiedContent = new Map();
  let baseCommitVerified = false;
  const baseline = records.find((record) => record.kind === "project.created")?.payload?.targetCommit;
  if (/^[0-9a-f]{40,64}$/.test(baseline)) {
    try {
      const resolved = git(repo, ["rev-parse", "--verify", `${baseline}^{commit}`]).toString("utf8").trim();
      const current = git(repo, ["rev-parse", "--verify", `${commit}^{commit}`]).toString("utf8").trim();
      if (resolved === baseline && current === commit) {
        git(repo, ["merge-base", "--is-ancestor", baseline, commit]);
        baseCommitVerified = true;
      }
    } catch { /* Missing, non-commit, or unrelated baseline is never evidence. */ }
  }
  // A recorded transition remains provisional until its historical Git blobs can be rechecked.
  for (const record of records) {
    if (record.kind !== "artifact.submitted") continue;
    try {
      verifyArtifact(repo, record.payload);
      const content = git(repo, ["show", `${record.payload.targetCommit}:${record.payload.path}`]).toString("utf8");
      if (record.payload.artifactId === "evidence_pack") {
        verifyEvidenceReference(repo, record.payload.targetCommit, content);
      }
      const gaps = validateArtifactStructure(record.payload.artifactId, content);
      if (gaps.length) throw new Error(`artifact構造が不足しています: ${gaps.join(", ")}`);
      verifiedRecordIds.push(record.recordId);
      verifiedContent.set(record.recordId, content);
      try {
        if (record.payload.targetCommit !== commit) {
          verifyArtifact(repo, { ...record.payload, targetCommit: commit });
          if (record.payload.artifactId === "evidence_pack") {
            verifyEvidenceReference(repo, commit,
              git(repo, ["show", `${commit}:${record.payload.path}`]).toString("utf8"));
          }
        }
        currentRecordIds.push(record.recordId);
      } catch { /* Historical evidence remains valid, but its current premise has changed. */ }
    } catch (error) {
      invalidRecords.push({ recordId: record.recordId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const p3Generations = new Set(records.filter((item) => item.kind === "artifact.submitted" &&
    item.payload?.phase === "P3").map((item) => item.payload.generation));
  for (const generation of p3Generations) {
    const submitted = records.filter((item) => item.kind === "artifact.submitted" &&
      item.payload?.phase === "P3" && item.payload?.generation === generation);
    const list = [...submitted].reverse().find((item) => item.payload.artifactId === "task_list");
    const definition = [...submitted].reverse().find((item) => item.payload.artifactId === "task_definition");
    if (!list || !definition || !verifiedContent.has(list.recordId) || !verifiedContent.has(definition.recordId)) continue;
    if (taskIds(verifiedContent.get(list.recordId) ?? "")[0] !== taskIds(verifiedContent.get(definition.recordId) ?? "")[0]) {
      for (const ids of [verifiedRecordIds, currentRecordIds]) {
        const index = ids.indexOf(definition.recordId);
        if (index >= 0) ids.splice(index, 1);
      }
      invalidRecords.push({ recordId: definition.recordId, reason: "task_listとtask_definitionのTASK IDが一致しません" });
    }
  }
  for (const record of records) {
    if (record.kind !== "gate.check_recorded" || record.payload?.phase !== "P5" ||
      record.payload?.checkId !== "integration_tests") continue;
    try {
      verifyEvidenceManifest(repo, record.payload.subjectCommit, record.payload.evidenceManifest);
      verifiedCheckRecordIds.push(record.recordId);
      try {
        verifyEvidenceManifest(repo, commit, record.payload.evidenceManifest);
        currentCheckRecordIds.push(record.recordId);
      } catch { /* The historical check is valid but its current evidence changed. */ }
    } catch (error) {
      invalidRecords.push({ recordId: record.recordId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  let previousTransitionCommit = baseline;
  for (const [index, record] of records.entries()) {
    if (record.kind !== "phase.transitioned") continue;
    const subjectCommit = record.payload?.subjectCommit;
    if (!baseCommitVerified || !/^[0-9a-f]{40,64}$/.test(subjectCommit)) continue;
    try {
      const resolved = git(repo, ["rev-parse", "--verify", `${subjectCommit}^{commit}`]).toString("utf8").trim();
      if (resolved !== subjectCommit) continue;
      git(repo, ["merge-base", "--is-ancestor", previousTransitionCommit, subjectCommit]);
      git(repo, ["merge-base", "--is-ancestor", subjectCommit, commit]);
      verifiedAtCommits[subjectCommit] = records.slice(0, index).filter((item) =>
        item.kind === "artifact.submitted" && verifiedRecordIds.includes(item.recordId) && (() => {
          try {
            return item.payload.targetCommit === subjectCommit ||
              verifyArtifact(repo, { ...item.payload, targetCommit: subjectCommit });
          } catch { return false; }
        })()).map((item) => item.recordId);
      previousTransitionCommit = subjectCommit;
      validTransitionRecordIds.push(record.recordId);
    } catch { /* Unverified transition commits are not replay evidence. */ }
  }
  for (const record of records) {
    if (record.kind !== "phase.completed") continue;
    const subject = record.payload?.subjectCommit;
    if (!baseCommitVerified || !/^[0-9a-f]{40,64}$/.test(subject)) continue;
    try {
      if (git(repo, ["rev-parse", "--verify", `${subject}^{commit}`]).toString("utf8").trim() !== subject) continue;
      git(repo, ["merge-base", "--is-ancestor", baseline, subject]);
      git(repo, ["merge-base", "--is-ancestor", subject, commit]);
      validCompletionRecordIds.push(record.recordId);
    } catch { /* A missing or unrelated completion is not replay evidence. */ }
  }
  return { repoId, commit, baseCommitVerified, verifiedRecordIds, currentRecordIds,
    verifiedAtCommits, verifiedCheckRecordIds, currentCheckRecordIds,
    validTransitionRecordIds, validCompletionRecordIds, invalidRecords };
}
