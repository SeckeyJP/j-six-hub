import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSyntheticTdd } from "./fake-runner.mjs";
import { inspectSyntheticCandidate } from "./synthetic-checks.mjs";

/** @type {string[]} */
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Synthetic PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "Synthetic PoC", GIT_COMMITTER_EMAIL: "poc@localhost" } }).trim();
}

describe("synthetic TDD worktree", () => {
  it("fixes hold-out and Red before candidate generation and preserves tests through Green/Refactor", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-fake-run-")); roots.push(root);
    const repo = join(root, "fixture"); await mkdir(repo); await mkdir(join(repo, "src"));
    git(repo, ["init", "-q"]);
    await writeFile(join(repo, "src/approval.mjs"), "export function approve(amount, limit) { return false; }\n");
    git(repo, ["add", "."]); git(repo, ["commit", "-qm", "stub baseline"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    const result = await runSyntheticTdd({ repo, worktreeRoot: join(root, "runs"),
      runId: "synthetic-001", baseCommit: baseline });
    expect(result.mode).toBe("fake");
    expect(result.steps.map((step) => step.id)).toEqual(["holdout", "red", "green", "refactor"]);
    expect(new Set(result.steps.map((step) => step.commit)).size).toBe(4);
    expect(result.steps.find((step) => step.id === "red")?.test).toMatchObject({
      status: "expected_failure", failureCode: "ERR_ASSERTION",
    });
    for (const id of ["green", "refactor"]) {
      expect(result.steps.find((step) => step.id === id)?.test?.status).toBe("passed");
    }
    const worktree = join(root, "runs", "synthetic-001");
    const [holdoutStep, redStep, , refactorStep] = result.steps;
    if (!holdoutStep || !redStep || !refactorStep) throw new Error("TDD step missing");
    const holdout = holdoutStep.commit;
    const refactor = refactorStep.commit;
    expect(git(worktree, ["rev-parse", `${holdout}:tests/holdout.test.mjs`]))
      .toBe(git(worktree, ["rev-parse", `${refactor}:tests/holdout.test.mjs`]));
    expect(git(worktree, ["rev-parse", `${redStep.commit}:tests/approval.test.mjs`]))
      .toBe(git(worktree, ["rev-parse", `${refactor}:tests/approval.test.mjs`]));
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseline);
    const inspection = await inspectSyntheticCandidate({ repo, worktreeRoot: join(root, "runs"), run: result,
      taskDefinition: "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: values within limit\nPROP-001: bounded\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: unit,lint\n",
      requirementSpec: "REQ-001: bounded approval\nAC-001: values within limit\nPROP-001: bounded\n" });
    expect(inspection.checks.map((check) => `${check.layer}/${check.id}`)).toEqual([
      "G1/build", "G1/typecheck", "G1/lint", "G1/format", "G1/sast", "G1/secrets",
      "G1/deps", "G1/scope", "G1/interface_contract", "G2/tests", "G2/coverage",
      "G2/mutation", "G2/test_tamper", "G2/holdout", "G2/traceability",
    ]);
    expect(inspection.checks.filter((check) => check.result !== "passed").map((check) => check.id)).toEqual([]);
    expect(inspection.candidateCommit).toBe(refactor);
    await writeFile(join(worktree, "tests/holdout.test.mjs"), "// weakened\n");
    git(worktree, ["add", "tests/holdout.test.mjs"]); git(worktree, ["commit", "-qm", "tamper holdout"]);
    await expect(inspectSyntheticCandidate({ repo, worktreeRoot: join(root, "runs"), run: result,
      taskDefinition: "TASK-001: bounded approval\nallow: src/**\ndeny: tests/holdout.test.mjs\n",
      requirementSpec: "REQ-001: bounded approval\n" })).rejects.toThrow(/候補HEAD/);
  }, 30_000);
});
