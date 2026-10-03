import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const commitPattern = /^[0-9a-f]{40,64}$/;
const runPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "J-SIX synthetic PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
  GIT_COMMITTER_NAME: "J-SIX synthetic PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };

export const syntheticHoldout = `import { test } from "node:test";
import { strict as assert } from "node:assert";
import { approve } from "../src/approval.mjs";
test("REQ-001 / PROP-001: malformed and negative amounts cannot pass", () => {
  assert.equal(approve(-1, 10), false);
  assert.equal(approve(Number.NaN, 10), false);
  assert.equal(approve(5, -1), false);
});
`;
export const syntheticRedTest = `import { test } from "node:test";
import { strict as assert } from "node:assert";
import { approve } from "../src/approval.mjs";
test("REQ-001 / PROP-001: bounded approval", () => {
  assert.equal(approve(5, 10), true);
  assert.equal(approve(12, 10), false);
});
`;
export const syntheticGreenCode = `/** REQ-001 / PROP-001: approve a finite nonnegative amount within a finite limit.
 * @param {number} amount @param {number} limit
 */
export function approve(amount, limit) {
  return Number.isFinite(amount) && Number.isFinite(limit) &&
    amount >= 0 && limit >= 0 && amount <= limit;
}
`;
export const syntheticRefactorCode = `/** REQ-001 / PROP-001: approve a finite nonnegative amount within a finite limit.
 * @param {number} amount @param {number} limit
 */
export function approve(amount, limit) {
  const validNumbers = [amount, limit].every(Number.isFinite);
  return validNumbers && amount >= 0 && limit >= 0 && amount <= limit;
}
`;

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** @param {string} worktree @param {string[]} paths */
function testRun(worktree, paths) {
  try {
    execFileSync(process.execPath, ["--test", ...paths], { cwd: worktree, encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 256 * 1024 });
    return { status: "passed", failureCode: null };
  } catch (error) {
    const output = /** @type {any} */ (error)?.stdout ?? "";
    return { status: "failed", failureCode: output.includes("ERR_ASSERTION") ? "ERR_ASSERTION" : "unknown" };
  }
}

/** Fixed synthetic candidate generator. It does not invoke an AI CLI or issue gate results.
 * @param {{repo:string,worktreeRoot:string,runId:string,baseCommit:string}} options
 */
export async function runSyntheticTdd({ repo, worktreeRoot, runId, baseCommit }) {
  if (!runPattern.test(runId) || !commitPattern.test(baseCommit) || git(repo, ["rev-parse", "HEAD"]) !== baseCommit) {
    throw new Error("合成runのIDまたは対象commitが不正です");
  }
  await mkdir(worktreeRoot, { recursive: true });
  const worktree = join(worktreeRoot, runId);
  git(repo, ["worktree", "add", "--detach", worktree, baseCommit]);
  try {
    const prior = JSON.parse(git(worktree, ["show", `${baseCommit}:docs/check-evidence.json`]));
    const steps = prior?.steps;
    if (!Array.isArray(steps) || steps.length !== 4) throw new Error("過去のTDD履歴がありません");
    const rechecked = testRun(worktree, ["tests/approval.test.mjs", "tests/holdout.test.mjs"]);
    if (rechecked.status !== "passed") throw new Error("差戻し後の再検証テストが失敗しました");
    return { mode: "fake-revalidation", runId, baseCommit, steps, candidateCommit: baseCommit,
      revalidation: { status: "passed", preservedTddRunId: prior.runId } };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof Error && /過去のTDD履歴|再検証/.test(error.message)) throw error;
    // The initial synthetic fixture has no prior evidence and follows the full TDD path below.
  }
  await mkdir(join(worktree, "tests"));
  /** @type {{id:string,commit:string,test?:{status:string,failureCode:string|null}}[]} */
  const steps = [];
  /** @param {string} id @param {string[]} paths */
  function commit(id, paths) {
    git(worktree, ["add", "--", ...paths]);
    git(worktree, ["commit", "-qm", `Synthetic ${id}`]);
    return git(worktree, ["rev-parse", "HEAD"]);
  }
  await writeFile(join(worktree, "tests/holdout.test.mjs"), syntheticHoldout);
  steps.push({ id: "holdout", commit: commit("holdout", ["tests/holdout.test.mjs"]) });
  await writeFile(join(worktree, "tests/approval.test.mjs"), syntheticRedTest);
  const redCommit = commit("red", ["tests/approval.test.mjs"]);
  const red = testRun(worktree, ["tests/approval.test.mjs"]);
  if (red.status !== "failed" || red.failureCode !== "ERR_ASSERTION") throw new Error("意図したRed失敗を観測できません");
  steps.push({ id: "red", commit: redCommit, test: { status: "expected_failure", failureCode: red.failureCode } });
  await writeFile(join(worktree, "src/approval.mjs"), syntheticGreenCode);
  const greenCommit = commit("green", ["src/approval.mjs"]);
  const green = testRun(worktree, ["tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  if (green.status !== "passed") throw new Error("合成Greenの実テストが失敗しました");
  steps.push({ id: "green", commit: greenCommit, test: green });
  await writeFile(join(worktree, "src/approval.mjs"), syntheticRefactorCode);
  const refactorCommit = commit("refactor", ["src/approval.mjs"]);
  const refactor = testRun(worktree, ["tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  if (refactor.status !== "passed") throw new Error("合成Refactorの実テストが失敗しました");
  steps.push({ id: "refactor", commit: refactorCommit, test: refactor });
  return { mode: "fake", runId, baseCommit, steps, candidateCommit: refactorCommit };
}
