import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareLiveTdd, finalizeLiveTdd } from "./live-runner.mjs";
import { syntheticGreenCode } from "./fake-runner.mjs";

const taskDefinition = "allow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\n";

/** @type {string[]} */ const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
/** @param {string} repo @param {string[]} args */
function git(repo, args) { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8",
  env: { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
    GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" } }).trim(); }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jsix-live-run-")); roots.push(root); const repo = join(root, "repo");
  await mkdir(join(repo, "src"), { recursive: true }); git(repo, ["init", "-q"]);
  await writeFile(join(repo, "src/approval.mjs"), "export function approve(amount, limit) { return false; }\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "base"]);
  return { root, repo, baseCommit: git(repo, ["rev-parse", "HEAD"]) };
}

describe("live TDD checkpoints", () => {
  it("keeps hold-out absent during CLI edit and records a no-change refactor as a distinct commit", async () => {
    const { root, repo, baseCommit } = await fixture();
    const prepared = await prepareLiveTdd({ repo, worktreeRoot: join(root, "runs"), runId: "live-1", baseCommit });
    expect(() => execFileSync("test", ["-e", join(prepared.worktree, "tests/holdout.test.mjs")])).toThrow();
    await writeFile(join(prepared.worktree, "src/approval.mjs"), syntheticGreenCode);
    const result = finalizeLiveTdd(prepared, taskDefinition);
    expect(result.steps.map((step) => step.id)).toEqual(["holdout", "red", "green", "refactor"]);
    expect(new Set(result.steps.map((step) => step.commit)).size).toBe(4);
    expect(result.steps[3]).toMatchObject({ owner: "hub", outcome: "no_change", sourceCommit: result.steps[2].commit });
    expect(git(prepared.worktree, ["rev-parse", `${result.steps[2].commit}^{tree}`]))
      .toBe(git(prepared.worktree, ["rev-parse", `${result.steps[3].commit}^{tree}`]));
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseCommit);
  });

  it("rejects test tampering and does not create a Green checkpoint", async () => {
    const { root, repo, baseCommit } = await fixture();
    const prepared = await prepareLiveTdd({ repo, worktreeRoot: join(root, "runs"), runId: "live-2", baseCommit });
    await writeFile(join(prepared.worktree, "tests/approval.test.mjs"), "// tampered\n");
    await expect(Promise.resolve().then(() => finalizeLiveTdd(prepared, taskDefinition))).rejects.toThrow(/許可した実装1ファイル/);
  });

  it("does not create a no-change checkpoint when a fixed G1 criterion fails", async () => {
    const { root, repo, baseCommit } = await fixture();
    const prepared = await prepareLiveTdd({ repo, worktreeRoot: join(root, "runs"), runId: "live-3", baseCommit });
    await writeFile(join(prepared.worktree, "src/approval.mjs"), `${syntheticGreenCode}// child_process\n`);
    expect(() => finalizeLiveTdd(prepared, taskDefinition)).toThrow(/sast/);
    expect(git(prepared.worktree, ["log", "-1", "--pretty=%s"])).toBe("CLI Green candidate");
  });
});
