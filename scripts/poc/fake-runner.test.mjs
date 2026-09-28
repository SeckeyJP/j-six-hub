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
      taskDefinition: "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: values within limit\nPROP-001: bounded\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
      requirementSpec: "REQ-001: bounded approval\nAC-001: values within limit\nPROP-001: bounded\n" });
    expect(inspection.checks.map((check) => `${check.layer}/${check.id}`)).toEqual([
      "G1/build", "G1/typecheck", "G1/lint", "G1/format", "G1/sast", "G1/secrets",
      "G1/deps", "G1/scope", "G1/interface_contract", "G2/tests", "G2/coverage",
      "G2/mutation", "G2/test_tamper", "G2/holdout", "G2/traceability",
    ]);
    expect(inspection.checks.filter((check) => check.result !== "passed").map((check) => check.id)).toEqual([]);
    expect(inspection.checks.every((check) => check.evidence.output.length <= 16 * 1024 &&
      check.evidence.definitionVersion === "hub-fixed-synthetic-checks-v4")).toBe(true);
    expect(inspection.candidateCommit).toBe(refactor);
    const forbiddenTest = await inspectSyntheticCandidate({ repo, worktreeRoot: join(root, "runs"), run: result,
      taskDefinition: "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: values within limit\nPROP-001: bounded\n依存: none\nallow: src/**\ndeny: tests/**\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
      requirementSpec: "REQ-001: bounded approval\nAC-001: values within limit\nPROP-001: bounded\n" });
    expect(forbiddenTest.checks.find((check) => check.id === "scope")?.result).toBe("failed");
    expect(forbiddenTest.checks.filter((check) => check.layer === "G2").every((check) => check.result === "not_run")).toBe(true);
    await writeFile(join(worktree, "tests/holdout.test.mjs"), "// weakened\n");
    git(worktree, ["add", "tests/holdout.test.mjs"]); git(worktree, ["commit", "-qm", "tamper holdout"]);
    await expect(inspectSyntheticCandidate({ repo, worktreeRoot: join(root, "runs"), run: result,
      taskDefinition: "TASK-001: bounded approval\nallow: src/**\ndeny: tests/holdout.test.mjs\n",
      requirementSpec: "REQ-001: bounded approval\n" })).rejects.toThrow(/候補HEAD/);
  }, 30_000);

  it("retains all required results and marks G2 not run when G1 fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-g1-fail-")); roots.push(root);
    const repo = join(root, "fixture"); await mkdir(repo); await mkdir(join(repo, "src"));
    git(repo, ["init", "-q"]);
    await writeFile(join(repo, "src/approval.mjs"), "export const approve = (amount, limit) => false;\n");
    git(repo, ["add", "."]); git(repo, ["commit", "-qm", "incompatible baseline"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    const worktreeRoot = join(root, "runs");
    const run = await runSyntheticTdd({ repo, worktreeRoot, runId: "g1-fail", baseCommit: baseline });
    const result = await inspectSyntheticCandidate({ repo, worktreeRoot, run,
      taskDefinition: "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
      requirementSpec: "REQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n" });
    expect(result.checks).toHaveLength(15);
    expect(result.checks.find((check) => check.id === "interface_contract")?.result).toBe("failed");
    expect(result.checks.filter((check) => check.layer === "G2").every((check) => check.result === "not_run")).toBe(true);
  }, 30_000);

  it("rejects a passing candidate that weakens the previously fixed hold-out", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-tamper-run-")); roots.push(root);
    const repo = join(root, "fixture"); await mkdir(repo); await mkdir(join(repo, "src"));
    git(repo, ["init", "-q"]);
    await writeFile(join(repo, "src/approval.mjs"), "export function approve(amount, limit) { return false; }\n");
    git(repo, ["add", "."]); git(repo, ["commit", "-qm", "stub baseline"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    const worktreeRoot = join(root, "runs");
    const original = await runSyntheticTdd({ repo, worktreeRoot, runId: "original", baseCommit: baseline });
    const green = original.steps[2]?.commit;
    if (!green) throw new Error("Green commit missing");
    const tampered = join(worktreeRoot, "tampered");
    git(repo, ["worktree", "add", "--detach", tampered, green]);
    const finalCode = git(join(worktreeRoot, "original"), ["show", `${original.candidateCommit}:src/approval.mjs`]) + "\n";
    await writeFile(join(tampered, "src/approval.mjs"), finalCode);
    await writeFile(join(tampered, "tests/holdout.test.mjs"),
      "import { test } from \"node:test\";\ntest(\"REQ-001 / PROP-001: weak hold-out\", () => {});\n");
    git(tampered, ["add", "."]); git(tampered, ["commit", "-qm", "weaken hold-out"]);
    const candidateCommit = git(tampered, ["rev-parse", "HEAD"]);
    const run = { ...original, runId: "tampered", candidateCommit,
      steps: [...original.steps.slice(0, 3), { id: "refactor", commit: candidateCommit,
        test: { status: "passed", failureCode: null } }] };
    const result = await inspectSyntheticCandidate({ repo, worktreeRoot, run,
      taskDefinition: "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**,tests/**\ndeny: secrets/**\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
      requirementSpec: "REQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n" });
    expect(result.checks.find((check) => check.id === "test_tamper")?.result).toBe("failed");
  }, 30_000);

  it("does not call an already green baseline a Red step", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-not-red-")); roots.push(root);
    const repo = join(root, "fixture"); await mkdir(repo); await mkdir(join(repo, "src"));
    git(repo, ["init", "-q"]);
    await writeFile(join(repo, "src/approval.mjs"),
      "export function approve(amount, limit) { return amount >= 0 && amount <= limit; }\n");
    git(repo, ["add", "."]); git(repo, ["commit", "-qm", "already green baseline"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    await expect(runSyntheticTdd({ repo, worktreeRoot: join(root, "runs"),
      runId: "already-green", baseCommit: baseline })).rejects.toThrow(/Red失敗/);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(baseline);
  }, 30_000);

  it("revalidates preserved TDD evidence after an accepted candidate is reopened", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-revalidate-")); roots.push(root);
    const repo = join(root, "fixture"); await mkdir(repo); await mkdir(join(repo, "src"));
    git(repo, ["init", "-q"]);
    await writeFile(join(repo, "src/approval.mjs"), "export function approve(amount, limit) { return false; }\n");
    git(repo, ["add", "."]); git(repo, ["commit", "-qm", "stub baseline"]);
    const baseline = git(repo, ["rev-parse", "HEAD"]);
    const worktreeRoot = join(root, "runs");
    const original = await runSyntheticTdd({ repo, worktreeRoot, runId: "original", baseCommit: baseline });
    const originalWorktree = join(worktreeRoot, "original");
    await mkdir(join(originalWorktree, "docs"));
    await writeFile(join(originalWorktree, "docs/check-evidence.json"),
      JSON.stringify({ schemaVersion: 1, runId: original.runId, steps: original.steps }) + "\n");
    git(originalWorktree, ["add", "docs/check-evidence.json"]);
    git(originalWorktree, ["commit", "-qm", "accept synthetic evidence"]);
    git(repo, ["merge", "--ff-only", git(originalWorktree, ["rev-parse", "HEAD"])]);
    const accepted = git(repo, ["rev-parse", "HEAD"]);
    const rerun = await runSyntheticTdd({ repo, worktreeRoot, runId: "after-reopen", baseCommit: accepted });
    expect(rerun.mode).toBe("fake-revalidation");
    expect(rerun.candidateCommit).toBe(accepted);
    expect(rerun.steps).toEqual(original.steps);
    const inspection = await inspectSyntheticCandidate({ repo, worktreeRoot, run: rerun,
      taskDefinition: "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
      requirementSpec: "REQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n" });
    expect(inspection.checks.every((check) => check.result === "passed")).toBe(true);
  }, 30_000);
});
