import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localPolicy } from "./policy.mjs";
const hubRoot = process.cwd();
const sha = (/** @type {string | Buffer} */ data) => createHash("sha256").update(data).digest("hex");
const commitPattern = /^[0-9a-f]{40,64}$/;
const evidenceLimit = 16 * 1024;
const definitionVersion = "hub-fixed-synthetic-checks-v4";

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
  if (steps[3].outcome === "no_change" && (steps[3].owner !== "hub" ||
    steps[3].sourceCommit !== steps[2].commit || steps[3].criteria !== "fixed-synthetic-g1-and-tests" ||
    !/^[0-9a-f]{64}$/.test(steps[3].criteriaEvidenceSha256 ?? "") ||
    !steps[3].criteriaResults || Object.values(steps[3].criteriaResults).some((result) => result !== true) ||
    git(worktree, ["rev-parse", `${steps[2].commit}^{tree}`]) !== git(worktree, ["rev-parse", `${steps[3].commit}^{tree}`]))) {
    throw new Error("no-change Refactor checkpointが不正です");
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
  const originalBase = git(worktree, ["rev-parse", `${steps[0].commit}^`]);
  if (["fake", "live"].includes(candidate.mode)) {
    if (steps[3].commit !== candidate.candidateCommit || originalBase !== candidate.baseCommit) {
      throw new Error("候補とTDD履歴の対象commitが一致しません");
    }
    if (candidate.mode === "live" && (steps[3].outcome !== "no_change" || steps[2].owner !== "cli")) {
      throw new Error("live TDD履歴の担当・Refactor判定が不正です");
    }
  } else if (candidate.mode === "fake-revalidation") {
    if (candidate.candidateCommit !== candidate.baseCommit ||
      git(worktree, ["merge-base", "--is-ancestor", steps[3].commit, candidate.baseCommit]) !== "" ||
      ["src/approval.mjs", "tests/approval.test.mjs", "tests/holdout.test.mjs"].some((path) =>
        git(worktree, ["rev-parse", `${steps[3].commit}:${path}`]) !==
          git(worktree, ["rev-parse", `${candidate.baseCommit}:${path}`]))) {
      throw new Error("再検証対象と保存済みTDD履歴が一致しません");
    }
  } else {
    throw new Error("未知の合成run modeです");
  }
  const code = await readFile(join(worktree, "src/approval.mjs"), "utf8");
  const unit = await readFile(join(worktree, "tests/approval.test.mjs"), "utf8");
  const holdout = await readFile(join(worktree, "tests/holdout.test.mjs"), "utf8");
  const toolVersions = /** @type {Record<string,string>} */ ({
    node: process.version,
    git: git(repo, ["--version"]),
    typescript: JSON.parse(await readFile(join(hubRoot, "node_modules/typescript/package.json"), "utf8")).version,
    eslint: JSON.parse(await readFile(join(hubRoot, "node_modules/eslint/package.json"), "utf8")).version,
    hub: definitionVersion,
  });
  const source = definitionVersion;
  /** @type {{layer:string,id:string,result:string,source:string,subjectCommit:string,evidenceSha256:string,evidence:{output:string,command:string,tool:string,toolVersion:string,definitionVersion:string}}[]} */
  const checks = [];
  /** @param {string} value */
  const sanitize = (value) => value.split(worktree).join("<worktree>").split(hubRoot).join("<hub>")
    .replace(/(?:\/private)?\/var\/folders\/[^\s]+\/jsix-mutation-[^\s/]+/g, "<mutation-worktree>");
  /** @param {string} layer @param {string} id @param {"passed"|"failed"|"not_run"} result @param {string} output @param {string} command @param {string=} tool */
  function record(layer, id, result, output, command, tool = "hub") {
    const bounded = sanitize(output).slice(0, evidenceLimit);
    checks.push({ layer, id, result, source, subjectCommit: candidate.candidateCommit,
      evidenceSha256: sha(bounded), evidence: { output: bounded, command, tool,
        toolVersion: toolVersions[tool] ?? definitionVersion, definitionVersion } });
  }
  const build = run(worktree, process.execPath, ["--check", "src/approval.mjs"]);
  record("G1", "build", build.ok ? "passed" : "failed", build.output, "node --check src/approval.mjs", "node");
  const typecheck = run(worktree, process.execPath, [join(hubRoot, "node_modules/typescript/bin/tsc"),
    "--ignoreConfig", "--noEmit", "--allowJs", "--checkJs", "--strict", "--skipLibCheck", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--target", "ES2022", "src/approval.mjs"]);
  record("G1", "typecheck", typecheck.ok ? "passed" : "failed", typecheck.output,
    "tsc --ignoreConfig --noEmit --allowJs --checkJs --strict src/approval.mjs", "typescript");
  const lint = run(worktree, process.execPath, [join(hubRoot, "node_modules/eslint/bin/eslint.js"),
    "--no-config-lookup", "-c", join(hubRoot, "eslint.config.js"), "src/approval.mjs"]);
  record("G1", "lint", lint.ok ? "passed" : "failed", lint.output,
    "eslint --no-config-lookup -c <hub>/eslint.config.js src/approval.mjs", "eslint");
  const formatOk = [code, unit, holdout].every((body) => body.endsWith("\n") &&
    !body.includes("\r") && !/[\t ]+$/m.test(body));
  record("G1", "format", formatOk ? "passed" : "failed",
    `newline-and-whitespace=${formatOk}; contentSha256=${sha(code + unit + holdout)}`, "hub format rule");
  const sastOk = !/\beval\s*\(|\bnew\s+Function\s*\(|\bchild_process\b/.test(code);
  record("G1", "sast", sastOk ? "passed" : "failed", `fixed-pattern-scan=${sastOk}; sourceSha256=${sha(code)}`,
    "hub fixed SAST patterns");
  const secretsOk = !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{20,}\b/.test(code + unit + holdout);
  record("G1", "secrets", secretsOk ? "passed" : "failed",
    `fixed-secret-scan=${secretsOk}; contentSha256=${sha(code + unit + holdout)}`, "hub fixed secret patterns");
  const depsOk = !/\bfrom\s+["'](?!\.\.?\/|node:)[^"']+["']/.test(code + unit + holdout);
  record("G1", "deps", depsOk ? "passed" : "failed",
    `external-dependency-scan=${depsOk}; contentSha256=${sha(code + unit + holdout)}`, "hub dependency rule");
  const allow = field(taskDefinition, "allow").split(",").map((item) => item.trim());
  const deny = field(taskDefinition, "deny").split(",").map((item) => item.trim());
  const changed = git(worktree, ["diff", "--name-only", originalBase, steps[3].commit]).split("\n")
    .filter(Boolean).filter((path) => !localPolicy.hubOwnedTaskPaths.includes(path));
  const scopeOk = changed.length > 0 && changed.every((path) =>
    allow.some((pattern) => matches(path, pattern)) && !deny.some((pattern) => matches(path, pattern)));
  record("G1", "scope", scopeOk ? "passed" : "failed", changed.join("\n"),
    "git diff --name-only <baseline> <refactor>; exclude policy hubOwnedTaskPaths", "git");
  const baselineCode = git(worktree, ["show", `${originalBase}:src/approval.mjs`]);
  const interfaceOk = /export function approve\(amount, limit\)/.test(code) &&
    /export function approve\(amount, limit\)/.test(baselineCode);
  record("G1", "interface_contract", interfaceOk ? "passed" : "failed",
    `baseline=${/export function approve\(amount, limit\)/.test(baselineCode)}; candidate=${/export function approve\(amount, limit\)/.test(code)}`,
    "hub fixed interface rule");
  if (checks.some((check) => check.result !== "passed")) {
    for (const id of localPolicy.requiredCheckIds.slice(checks.length)) {
      record("G2", id, "not_run", "Blocked because one or more G1 checks failed.", "not run");
    }
    return { candidateCommit: candidate.candidateCommit, checks };
  }
  const tests = run(worktree, process.execPath, ["--test", "tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  record("G2", "tests", tests.ok ? "passed" : "failed", tests.output,
    "node --test tests/approval.test.mjs tests/holdout.test.mjs", "node");
  const coverage = run(worktree, process.execPath, ["--experimental-test-coverage", "--test",
    "tests/approval.test.mjs", "tests/holdout.test.mjs"]);
  const coverageRow = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/.exec(coverage.output);
  const coverageOk = coverage.ok && !!coverageRow && Number(coverageRow[1]) >= 80 && Number(coverageRow[2]) >= 75;
  record("G2", "coverage", coverageOk ? "passed" : "failed", coverage.output,
    "node --experimental-test-coverage --test tests/approval.test.mjs tests/holdout.test.mjs", "node");
  const mutationRoot = await mkdtemp(join(tmpdir(), "jsix-mutation-"));
  let mutant;
  try {
    await mkdir(join(mutationRoot, "src")); await mkdir(join(mutationRoot, "tests"));
    mutant = code.replace("amount <= limit", "amount >= limit");
    await writeFile(join(mutationRoot, "src/approval.mjs"), mutant);
    await writeFile(join(mutationRoot, "tests/approval.test.mjs"), unit);
    await writeFile(join(mutationRoot, "tests/holdout.test.mjs"), holdout);
    const result = run(mutationRoot, process.execPath, ["--test", "tests/approval.test.mjs", "tests/holdout.test.mjs"]);
    const mutationOk = mutant !== code && !result.ok && result.output.includes("ERR_ASSERTION");
    record("G2", "mutation", mutationOk ? "passed" : "failed", result.output,
      "fixed mutation: amount <= limit to amount >= limit; node --test", "node");
  } finally { await rm(mutationRoot, { recursive: true, force: true }); }
  const holdoutPath = field(taskDefinition, "hold-out");
  const holdoutSame = holdoutPath === "tests/holdout.test.mjs" &&
    git(worktree, ["rev-parse", `${steps[0].commit}:${holdoutPath}`]) ===
      git(worktree, ["rev-parse", `${steps[3].commit}:${holdoutPath}`]);
  const redSame = git(worktree, ["rev-parse", `${steps[1].commit}:tests/approval.test.mjs`]) ===
    git(worktree, ["rev-parse", `${steps[3].commit}:tests/approval.test.mjs`]);
  record("G2", "test_tamper", holdoutSame && redSame ? "passed" : "failed",
    `holdoutUnchanged=${holdoutSame}; redTestUnchanged=${redSame}`, "git blob identity checks", "git");
  const holdoutTest = run(worktree, process.execPath, ["--test", "tests/holdout.test.mjs"]);
  record("G2", "holdout", holdoutTest.ok ? "passed" : "failed", holdoutTest.output,
    "node --test tests/holdout.test.mjs", "node");
  const traceIds = ["REQ-001", "PROP-001"];
  const traceOk = traceIds.every((id) => requirementSpec.includes(id) &&
    taskDefinition.includes(id) && unit.includes(id) && holdout.includes(id));
  record("G2", "traceability", traceOk ? "passed" : "failed",
    `ids=${traceIds.join(",")}; matched=${traceOk}; unitSha256=${sha(unit)}; holdoutSha256=${sha(holdout)}`,
    "hub fixed traceability rule");
  return { candidateCommit: candidate.candidateCommit, checks };
}
