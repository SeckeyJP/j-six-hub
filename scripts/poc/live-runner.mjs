import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { syntheticHoldout, syntheticRedTest } from "./fake-runner.mjs";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const commitPattern = /^[0-9a-f]{40,64}$/;
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "J-SIX Hub PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
  GIT_COMMITTER_NAME: "J-SIX Hub PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };

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
    const value = /** @type {any} */ (error);
    const output = String(value?.stdout ?? "") + String(value?.stderr ?? "");
    return { status: "failed", failureCode: output.includes("ERR_ASSERTION") ? "ERR_ASSERTION" : "unknown" };
  }
}

/** Prepare reviewed tests, hide the hold-out with sparse checkout, and expose the Red commit to one CLI edit. */
/** @param {{repo:string,worktreeRoot:string,runId:string,baseCommit:string}} input */
export async function prepareLiveTdd({ repo, worktreeRoot, runId, baseCommit }) {
  if (!idPattern.test(runId) || !commitPattern.test(baseCommit) || git(repo, ["rev-parse", "HEAD"]) !== baseCommit) {
    throw new Error("live runのIDまたは対象commitが不正です");
  }
  await mkdir(worktreeRoot, { recursive: true });
  const worktree = join(worktreeRoot, runId);
  git(repo, ["worktree", "add", "--detach", worktree, baseCommit]);
  await mkdir(join(worktree, "tests"), { recursive: true });
  await writeFile(join(worktree, "tests/holdout.test.mjs"), syntheticHoldout);
  git(worktree, ["add", "--", "tests/holdout.test.mjs"]); git(worktree, ["commit", "-qm", "Hub hold-out checkpoint"]);
  const holdoutCommit = git(worktree, ["rev-parse", "HEAD"]);
  await writeFile(join(worktree, "tests/approval.test.mjs"), syntheticRedTest);
  git(worktree, ["add", "--", "tests/approval.test.mjs"]); git(worktree, ["commit", "-qm", "Hub Red checkpoint"]);
  const redCommit = git(worktree, ["rev-parse", "HEAD"]);
  const red = testRun(worktree, ["tests/approval.test.mjs"]);
  if (red.status !== "failed" || red.failureCode !== "ERR_ASSERTION") throw new Error("意図したRed失敗を観測できません");
  git(worktree, ["sparse-checkout", "init", "--no-cone"]);
  git(worktree, ["sparse-checkout", "set", "src/", "tests/approval.test.mjs"]);
  return { worktree, runId, baseCommit, steps: [
    { id: "holdout", commit: holdoutCommit, owner: "hub", visibility: "excluded-during-cli" },
    { id: "red", commit: redCommit, owner: "hub", test: { status: "expected_failure", failureCode: red.failureCode } },
  ] };
}

/** Finalize the one permitted edit and create an honest no-change Refactor checkpoint. */
/** @param {{worktree:string,runId:string,baseCommit:string,steps:any[]}} prepared */
export function finalizeLiveTdd(prepared) {
  const { worktree } = prepared;
  const changed = git(worktree, ["status", "--porcelain"]).split("\n").filter(Boolean);
  if (changed.length !== 1 || !changed[0]?.endsWith(" src/approval.mjs")) throw new Error("CLI差分が許可した実装1ファイルを外れました");
  git(worktree, ["add", "--", "src/approval.mjs"]); git(worktree, ["commit", "-qm", "CLI Green candidate"]);
  const greenCommit = git(worktree, ["rev-parse", "HEAD"]);
  git(worktree, ["sparse-checkout", "disable"]);
  const green = testRun(worktree, ["tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  if (green.status !== "passed") throw new Error("Green候補の可視・hold-outテストが失敗しました");
  try { execFileSync("git", ["-C", worktree, "diff", "--check", `${greenCommit}^`, greenCommit],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch { throw new Error("Refactor必要性検査で差分形式の問題を検出しました"); }
  git(worktree, ["commit", "--allow-empty", "-qm", "Hub Refactor checkpoint: no change"]);
  const refactorCommit = git(worktree, ["rev-parse", "HEAD"]);
  const refactor = testRun(worktree, ["tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  if (refactor.status !== "passed" || git(worktree, ["rev-parse", `${greenCommit}^{tree}`]) !==
    git(worktree, ["rev-parse", `${refactorCommit}^{tree}`])) throw new Error("no-change Refactor再検証が不正です");
  return { mode: "live", runId: prepared.runId, baseCommit: prepared.baseCommit, candidateCommit: refactorCommit,
    steps: [...prepared.steps,
      { id: "green", commit: greenCommit, owner: "cli", test: green },
      { id: "refactor", commit: refactorCommit, owner: "hub", outcome: "no_change",
        sourceCommit: greenCommit, criteria: "fixed-synthetic-g1-and-tests", test: refactor }] };
}
