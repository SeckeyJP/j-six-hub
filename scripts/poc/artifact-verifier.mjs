import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute, posix } from "node:path";
import { validateArtifactStructure } from "./policy.mjs";

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

/** @param {string} repo @param {any[]} records @param {string} commit */
export function verifiedSnapshot(repo, records, commit) {
  const verifiedRecordIds = [];
  const invalidRecords = [];
  // A recorded transition remains provisional until its historical Git blobs can be rechecked.
  for (const record of records) {
    if (record.kind !== "artifact.submitted") continue;
    try {
      verifyArtifact(repo, record.payload);
      const content = git(repo, ["show", `${record.payload.targetCommit}:${record.payload.path}`]).toString("utf8");
      const gaps = validateArtifactStructure(record.payload.artifactId, content);
      if (gaps.length) throw new Error(`artifact構造が不足しています: ${gaps.join(", ")}`);
      verifiedRecordIds.push(record.recordId);
    } catch (error) {
      invalidRecords.push({ recordId: record.recordId, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { commit, verifiedRecordIds, invalidRecords };
}
