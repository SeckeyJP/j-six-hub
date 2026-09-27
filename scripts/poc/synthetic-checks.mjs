import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const hubRoot = process.cwd();
const sha = (/** @type {string | Buffer} */ data) => createHash("sha256").update(data).digest("hex");
const commitPattern = /^[0-9a-f]{40,64}$/;

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** @param {string} cwd @param {string} executable @param {string[]} args */
function run(cwd, executable, args) {
  try {
    const output = execFileSync(executable, args, { cwd, encoding: "utf8", timeout: 30_000,
      maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output };
  } catch (error) {
    const value = /** @type {any} */ (error);
    return { ok: false, output: String(value?.stdout ?? "") + String(value?.stderr ?? "") };
  }
}

/** @param {string} taskDefinition @param {string} field */
function field(taskDefinition, field) {
  const value = new RegExp(`^${field}:[ \\t]*([^\\r\\n]+)$`, "m").exec(taskDefinition)?.[1]?.trim();
  if (!value) throw new Error(`P3の${field}がありません`);
  return value;
}

/** @param {string} path @param {string} pattern */
function matches(path, pattern) {
  return pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -3) + "/") : path === pattern;
}

/** @param {string} worktree @param {any[]} steps */
function assertStepHistory(worktree, steps) {
  const expected = ["holdout", "red", "green", "refactor"];
  if (JSON.stringify(steps.map((step) => step.id)) !== JSON.stringify(expected) ||
    new Set(steps.map((step) => step.commit)).size !== 4 ||
    steps.some((step) => !commitPattern.test(step.commit))) throw new Error("TDD履歴が不足・重複しています");
  for (let index = 1; index < steps.length; index += 1) {
    if (git(worktree, ["rev-parse", `${steps[index].commit}^`]) !== steps[index - 1].commit) {
      throw new Error("TDD commitの順序・系列が不正です");
    }
  }
  if (steps[1].test?.status !== "expected_failure" || steps[1].test?.failureCode !== "ERR_ASSERTION" ||
    steps[2].test?.status !== "passed" || steps[3].test?.status !== "passed") {
    throw new Error("Red/Green/Refactorの実結果が不足しています");
  }
}

/** Independent deterministic checks for the fixed synthetic fixture only.
 * @param {{repo:string,worktreeRoot:string,run:any,taskDefinition:string,requirementSpec:string}} input
 */
export async function inspectSyntheticCandidate({ repo, worktreeRoot, run: candidate, taskDefinition, requirementSpec }) {
  const worktree = resolve(worktreeRoot, candidate.runId);
  const steps = candidate.steps;
  if (!commitPattern.test(candidate.baseCommit) || !commitPattern.test(candidate.candidateCommit) ||
    git(repo, ["rev-parse", "HEAD"]) !== candidate.baseCommit ||
    git(worktree, ["rev-parse", "HEAD"]) !== candidate.candidateCommit) throw new Error("候補HEAD・基準commitが一致しません");
  assertStepHistory(worktree, steps);
  if (steps[3].commit !== candidate.candidateCommit ||
    git(worktree, ["rev-parse", `${steps[0].commit}^`]) !== candidate.baseCommit) {
    throw new Error("候補とTDD履歴の対象commitが一致しません");
  }
  const code = await readFile(join(worktree, "src/approval.mjs"), "utf8");
  const unit = await readFile(join(worktree, "tests/approval.test.mjs"), "utf8");
  const holdout = await readFile(join(worktree, "tests/holdout.test.mjs"), "utf8");
  const source = "hub-fixed-synthetic-checks-v1";
  /** @type {{layer:string,id:string,result:string,source:string,subjectCommit:string,evidenceSha256:string}[]} */
  const checks = [];
  /** @param {string} layer @param {string} id @param {boolean} passed @param {string} evidence */
  function record(layer, id, passed, evidence) {
    checks.push({ layer, id, result: passed ? "passed" : "failed", source,
      subjectCommit: candidate.candidateCommit, evidenceSha256: sha(evidence) });
  }
  const build = run(worktree, process.execPath, ["--check", "src/approval.mjs"]);
  record("G1", "build", build.ok, build.output);
  const typecheck = run(worktree, process.execPath, [join(hubRoot, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--allowJs", "--checkJs", "--strict", "--skipLibCheck", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--target", "ES2022", "src/approval.mjs"]);
  record("G1", "typecheck", typecheck.ok, typecheck.output);
  const lint = run(worktree, process.execPath, [join(hubRoot, "node_modules/eslint/bin/eslint.js"),
    "--no-config-lookup", "-c", join(hubRoot, "eslint.config.js"), "src/approval.mjs"]);
  record("G1", "lint", lint.ok, lint.output);
  record("G1", "format", [code, unit, holdout].every((body) => body.endsWith("\n") &&
    !body.includes("\r") && !/[\t ]+$/m.test(body)), sha(code + unit + holdout));
  record("G1", "sast", !/\beval\s*\(|\bnew\s+Function\s*\(|\bchild_process\b/.test(code), code);
  record("G1", "secrets", !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}\b/.test(code + unit + holdout),
    code + unit + holdout);
  record("G1", "deps", !/\bfrom\s+["'](?!\.\.?\/|node:)[^"']+["']/.test(code + unit + holdout),
    code + unit + holdout);
  const allow = field(taskDefinition, "allow").split(",").map((item) => item.trim());
  const deny = field(taskDefinition, "deny").split(",").map((item) => item.trim());
  const changed = git(worktree, ["diff", "--name-only", steps[1].commit, steps[3].commit]).split("\n").filter(Boolean);
  record("G1", "scope", changed.length > 0 && changed.every((path) =>
    allow.some((pattern) => matches(path, pattern)) && !deny.some((pattern) => matches(path, pattern))), changed.join("\n"));
  const baselineCode = git(worktree, ["show", `${candidate.baseCommit}:src/approval.mjs`]);
  record("G1", "interface_contract", /export function approve\(amount, limit\)/.test(code) &&
    /export function approve\(amount, limit\)/.test(baselineCode), code);
  if (checks.some((check) => check.result !== "passed")) return { candidateCommit: candidate.candidateCommit, checks };
  const tests = run(worktree, process.execPath, ["--test", "tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  record("G2", "tests", tests.ok, tests.output);
  const coverage = run(worktree, process.execPath, ["--experimental-test-coverage", "--test",
    "tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  const coverageRow = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/.exec(coverage.output);
  record("G2", "coverage", coverage.ok && !!coverageRow && Number(coverageRow[1]) >= 80 &&
    Number(coverageRow[2]) >= 75, coverage.output);
  const mutationRoot = await mkdtemp(join(tmpdir(), "jsix-mutation-"));
  let mutant;
  try {
    await mkdir(join(mutationRoot, "src")); await mkdir(join(mutationRoot, "tests"));
    mutant = code.replace("amount <= limit", "amount >= limit");
    await writeFile(join(mutationRoot, "src/approval.mjs"), mutant);
    await writeFile(join(mutationRoot, "tests/approval.test.mjs"), unit);
    await writeFile(join(mutationRoot, "tests/holdout.test.mjs"), holdout);
    const result = run(mutationRoot, process.execPath, ["--test", "tests/approval.test.mjs", "tests/holdout.test.mjs"]);
    record("G2", "mutation", mutant !== code && !result.ok && result.output.includes("ERR_ASSERTION"), result.output);
  } finally { await rm(mutationRoot, { recursive: true, force: true }); }
  const holdoutPath = field(taskDefinition, "hold-out");
  const holdoutSame = holdoutPath === "tests/holdout.test.mjs" &&
    git(worktree, ["rev-parse", `${steps[0].commit}:${holdoutPath}`]) ===
      git(worktree, ["rev-parse", `${steps[3].commit}:${holdoutPath}`]);
  const redSame = git(worktree, ["rev-parse", `${steps[1].commit}:tests/approval.test.mjs`]) ===
    git(worktree, ["rev-parse", `${steps[3].commit}:tests/approval.test.mjs`]);
  record("G2", "test_tamper", holdoutSame && redSame, `${holdoutSame}:${redSame}`);
  const holdoutTest = run(worktree, process.execPath, ["--test", "tests/holdout.test.mjs"]);
  record("G2", "holdout", holdoutTest.ok, holdoutTest.output);
  const traceIds = ["REQ-001", "PROP-001"];
  record("G2", "traceability", traceIds.every((id) => requirementSpec.includes(id) &&
    taskDefinition.includes(id) && unit.includes(id) && holdout.includes(id)),
  `${requirementSpec}\n${taskDefinition}\n${sha(unit)}\n${sha(holdout)}`);
  return { candidateCommit: candidate.candidateCommit, checks };
}
