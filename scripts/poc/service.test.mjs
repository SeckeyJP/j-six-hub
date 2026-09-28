import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPocService } from "./service.mjs";
import { localPolicySha256 } from "./policy.mjs";
import { syntheticGreenCode } from "./fake-runner.mjs";

const processDefinition = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
/** @type {string[]} */
const roots = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); }, 60_000);

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", env: { ...globalThis.process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" },
  }).trim();
}

/** @param {{cli?:boolean,beforeAuth?:()=>Promise<void>,beforeWorkload?:()=>Promise<void>}} [options] */
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "jsix-service-"));
  roots.push(root);
  const repo = join(root, "fixture");
  const ledgerRoot = join(root, "ledger");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(repo));
  await mkdir(join(repo, "src"));
  git(repo, ["init", "-q"]);
  const content = /** @type {Record<string,string>} */ ({
    "constitution.md": "# Synthetic constitution\n",
    "requirement.md": "REQ-001: case\nAC-001: check\nPROP-001: property\n受入条件: observed\n非機能: local\n未確定: なし\n",
    "flow.md": "# Synthetic flow\n",
    "invalid.md": "REQ-001: only one required field\n",
    "design.md": "検証戦略: hold-out and unit tests\n設計書目次: interface, operation\n",
    "adr.md": "# Synthetic decision\n",
    "prototype.md": "# Synthetic working prototype\n",
    "properties.md": "# Synthetic properties\n",
    "tasks.md": "TASK-001: synthetic change\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
    "task.md": "TASK-001: synthetic change\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
    "src/approval.mjs": "export function approve(amount, limit) { return false; }\n",
    "src/approval-route.mjs": "import { approve } from \"./approval.mjs\";\nexport function handleApproval(request) {\n  const { amount, limit } = request ?? {};\n  if (!Number.isFinite(amount) || !Number.isFinite(limit)) {\n    return { status: 400, body: { approved: false, error: \"invalid request\" } };\n  }\n  return { status: 200, body: { approved: approve(amount, limit) } };\n}\n",
  });
  content["tasks.md"] = "TASK-001: synthetic change\nREQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n";
  content["task.md"] = content["tasks.md"] ?? "";
  for (const [path, body] of Object.entries(content)) await writeFile(join(repo, path), body);
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "baseline"]);
  const commit = git(repo, ["rev-parse", "HEAD"]);
  let cli;
  /** @type {any[]} */ const cliCalls = [];
  if (options.cli) {
    const codex = join(root, "codex"); const claude = join(root, "claude"); const hook = join(root, "hook.json");
    await writeFile(codex, "fixed executable\n"); await writeFile(claude, "fixed executable\n"); await writeFile(hook, "fixed hook\n");
    cli = { executables: { codex, claude }, controls: { files: [{ path: hook, sha256: hash("fixed hook\n") }], codexTrusted: true },
      env: {}, home: root, runProcess(/** @type {any} */ input) {
        cliCalls.push(input);
        const provider = input.executable.endsWith("codex") ? "codex" : "claude";
        const first = input.args[0];
        let promise;
        if (first === "--version") promise = Promise.resolve({ code: 0, signal: null,
          stdout: `${provider} 0.test`, stderr: "", overflow: false, timedOut: false, cancelled: false });
        else if (first === "login" || first === "auth") promise = (async () => { await options.beforeAuth?.(); return {
          code: 0, signal: null, stdout: provider === "codex" ? "Logged in using ChatGPT" : JSON.stringify({ loggedIn: true,
            authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }),
          stderr: "", overflow: false, timedOut: false, cancelled: false }; })();
        else promise = (async () => { await input.onStart?.(12345); if (input.input.includes("TASK-001")) {
          await writeFile(join(input.cwd, "src/approval.mjs"), syntheticGreenCode);
        } await options.beforeWorkload?.(); const summary = JSON.stringify({ status: "ok", file: "src/approval.mjs", hook: "denied" });
        const stdout = provider === "codex" ?
          `${JSON.stringify({ type: "thread.started", thread_id: "t-1" })}\n${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: summary } })}\n{"type":"item.completed","item":{"type":"command_execution","command":"git config --list","status":"denied","exit_code":1,"aggregated_output":"blocked by PreToolUse"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n` :
          `${JSON.stringify({ type: "system", session_id: "s-1" })}\n{"type":"hook_response","hook_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git config --list"},"decision":"deny"}\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "s-1", result: summary })}\n`;
        return { code: 0, signal: null, stdout,
          stderr: "", overflow: false, timedOut: false, cancelled: false }; })();
        return { promise, cancel() {} };
      } };
  }
  const service = createPocService({ ledgerRoot, process: processDefinition, fixtures: {
    synthetic: { repo, repoId: "synthetic" },
  }, cli });
  await service.initialize();
  return { repo, ledgerRoot, commit, content, service, cliCalls, cli };
}

/** @param {string} body */
const hash = (body) => createHash("sha256").update(body).digest("hex");
/** @param {string|null} head @param {string} projectId @param {number} generation @param {string} targetCommit */
const common = (head, projectId, generation, targetCommit) => ({ expectedHead: head, projectId,
  generation, targetCommit, policySha256: localPolicySha256 });

function deferred() {
  /** @type {()=>void} */ let resolve = () => {};
  const promise = new Promise((done) => { resolve = () => done(undefined); });
  return { promise, resolve };
}

/** @param {any} service @param {string} commit @param {Record<string,string>} content @param {string|null=} expectedHead */
async function advanceToP4(service, commit, content, expectedHead = null) {
  let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
    expectedHead, targetCommit: commit, policySha256: localPolicySha256 });
  const id = result.project.projectId;
  const phases = /** @type {Record<string,[string,string][]>} */ ({
    P0: [["constitution", "constitution.md"]],
    P1: [["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]],
    P2: [["design_spec", "design.md"], ["adr", "adr.md"], ["working_prototype", "prototype.md"], ["properties", "properties.md"]],
    P3: [["task_list", "tasks.md"], ["task_definition", "task.md"]],
  });
  for (const phase of ["P0", "P1", "P2", "P3"]) {
    for (const [artifactId, path] of phases[phase] ?? []) result = await service.execute({ type: "artifact.submit",
      ...common(result.head, id, 0, commit), artifactId, path, sha256: hash(content[path] ?? "") });
    if (phase !== "P0") {
      result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
      result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
        outcome: "approved", role: phase === "P1" ? "customer" : phase === "P2" ? "architect" : "gatekeeper",
        reason: "Synthetic CLI setup", expiresAt: "2099-01-01T00:00:00.000Z" });
    }
    result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
  }
  return result;
}

describe("localhost service commands", () => {
  it("runs one smoke and one live edit with single-use confirmations and real Hub inspection", async () => {
    const { service, commit, content, cliCalls, ledgerRoot } = await fixture({ cli: true });
    let result = await advanceToP4(service, commit, content);
    const id = result.project.projectId;
    await expect(service.runCli({ ...common(result.head, id, 0, commit), provider: "codex", kind: "smoke" }))
      .rejects.toThrow(/確認/);
    expect(cliCalls).toHaveLength(0);
    result = await service.confirmSubscription({ ...common(result.head, id, 0, commit), provider: "codex" });
    const smoke = await service.runCli({ ...common(result.head, id, 0, commit), provider: "codex", kind: "smoke" });
    expect(smoke.cliRun.state).toBe("succeeded");
    await expect(service.runCli({ ...common(smoke.head, id, 0, commit), provider: "codex", kind: "edit" }))
      .rejects.toThrow(/単回使用/);
    result = await service.confirmSubscription({ ...common(smoke.head, id, 0, commit), provider: "codex" });
    const edited = await service.runCli({ ...common(result.head, id, 0, commit), provider: "codex", kind: "edit" });
    expect(edited.cliRun.state).toBe("succeeded");
    expect(edited.cliRun.checks).toHaveLength(15);
    expect(edited.cliRun.checks.filter((item) => item.result !== "passed")
      .map((item) => ({ id: item.id, result: item.result, output: item.evidence.output }))).toEqual([]);
    expect(edited.project.run?.mode).toBe("live");
    expect(edited.project.run?.accepted).toBe(false);
    expect(edited.project.cli.runs.map((item) => `${item.provider}/${item.kind}/${item.state}`))
      .toEqual(["codex/smoke/succeeded", "codex/edit/succeeded"]);
    const logPath = join(ledgerRoot, "private-runs", edited.cliRun.runId, "events.log");
    const manifest = JSON.parse(readFileSync(join(ledgerRoot, "private-runs", edited.cliRun.runId, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ schemaVersion: 1, provider: "codex", kind: "edit",
      preflight: { spawnAllowed: true, authMethod: "chatgpt", controls: "matched" },
      process: { eventValidation: null, stopUnconfirmed: false }, result: { state: "succeeded" } });
    expect(manifest.startRecordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(manifest.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    const log = readFileSync(logPath);
    await unlink(logPath);
    const missingEvidence = await service.detail(id);
    expect(missingEvidence.project.cli.runs.at(-1)?.state).toBe("evidence_unknown");
    expect(missingEvidence.project.missing).toContain(`cli-evidence:${edited.cliRun.runId}:unknown`);
    await writeFile(logPath, log, { mode: 0o600 });
    await expect(service.runCli({ ...common(edited.head, id, 0, commit), provider: "codex", kind: "edit" }))
      .rejects.toThrow(/回数上限|確認/);
  }, 300_000);

  it("keeps one global dispatch slot and reconstructs a pending run after restart", async () => {
    const gate = deferred();
    const { service, commit, content, cliCalls, ledgerRoot, repo, cli } = await fixture({ cli: true,
      beforeWorkload: () => gate.promise });
    let current = await advanceToP4(service, commit, content); const id = current.project.projectId;
    let second = await advanceToP4(service, commit, content, current.head); const secondId = second.project.projectId;
    current = await service.detail(id);
    current = await service.confirmSubscription({ ...common(current.head, id, 0, commit), provider: "codex" });
    const running = service.runCli({ ...common(current.head, id, 0, commit), provider: "codex", kind: "smoke" });
    try {
      await vi.waitFor(() => expect(cliCalls.filter((call) => call.args[0] === "exec")).toHaveLength(1), { timeout: 20_000 });
      const restored = createPocService({ ledgerRoot, process: processDefinition,
        fixtures: { synthetic: { repo, repoId: "synthetic" } }, cli });
      await restored.initialize();
      const pending = await restored.detail(id);
      expect((await service.detail(id)).project.cli.runs.at(-1)?.state).toBe("started");
      expect(pending.project.cli.runs.at(-1)?.state).toBe("unknown");
      expect(pending.project.cli.runs.at(-1)?.stopReason).toMatch(/停止・結果を照合/);
      await expect(restored.cancelCli({ ...common(pending.head, id, 0, commit),
        runId: pending.project.cli.runs.at(-1)?.runId })).rejects.toThrow(/確認できません/);
      second = await restored.detail(secondId);
      await expect(restored.runCli({ ...common(second.head, secondId, 0, commit), provider: "claude", kind: "smoke" }))
        .rejects.toThrow(/未確定/);
      expect(cliCalls.filter((call) => call.args[0] === "-p")).toHaveLength(0);
    } finally { gate.resolve(); }
    expect((await running).cliRun.state).toBe("succeeded");
  }, 150_000);

  it("blocks project reopen and detects an external HEAD change before workload spawn", async () => {
    const gate = deferred();
    const { service, commit, content, cliCalls, repo } = await fixture({ cli: true, beforeAuth: () => gate.promise });
    let current = await advanceToP4(service, commit, content); const id = current.project.projectId;
    current = await service.confirmSubscription({ ...common(current.head, id, 0, commit), provider: "codex" });
    const pendingRun = service.runCli({ ...common(current.head, id, 0, commit), provider: "codex", kind: "smoke" });
    try {
      await vi.waitFor(() => expect(cliCalls.filter((call) => call.args[0] === "login")).toHaveLength(1), { timeout: 20_000 });
      const pending = await service.detail(id);
      await expect(service.execute({ type: "phase.reopen", ...common(pending.head, id, 0, commit), phase: "P3",
        reason: "Synthetic change during preflight" })).rejects.toThrow(/未確定/);
      expect(cliCalls.filter((call) => call.args[0] === "exec")).toHaveLength(0);
      await writeFile(join(repo, "external-change.md"), "changed during preflight\n");
      git(repo, ["add", "external-change.md"]); git(repo, ["commit", "-qm", "external change during preflight"]);
    } finally { gate.resolve(); }
    await expect(pendingRun).rejects.toThrow(/対象Git commit|変わりました/);
    expect(cliCalls.filter((call) => call.args[0] === "exec")).toHaveLength(0);
  }, 90_000);

  it("replays a synthetic project through P0 to P4 with real Git evidence", async () => {
    const { service, commit, content, ledgerRoot, repo } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    expect(result.project.phase).toBe("P0");
    result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    expect(result.project.canTransition).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P1");
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    expect(result.project.missing).toContain("decision:customer_approval/agreement_maturity:missing-or-expired");
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "customer", reason: "Synthetic review", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(result.project.canTransition).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P2");
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([
      ["design_spec", "design.md"], ["adr", "adr.md"],
      ["working_prototype", "prototype.md"], ["properties", "properties.md"],
    ])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "architect", reason: "Synthetic design review", expiresAt: "2099-01-01T00:00:00.000Z" });
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P3");
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([
      ["task_list", "tasks.md"], ["task_definition", "task.md"],
    ])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "gatekeeper", reason: "Synthetic scope review", expiresAt: "2099-01-01T00:00:00.000Z" });
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P4");
    expect(result.project.canTransition).toBe(false);
    expect(result.project.missing).toContain("task:candidate-not-accepted");
    await writeFile(join(repo, "constitution.md"), "# Changed constitution\n");
    git(repo, ["add", "constitution.md"]); git(repo, ["commit", "-qm", "change passed constitution"]);
    let blocked = await service.detail(projectId);
    expect(blocked.project.missing.some((reason) => reason.startsWith("passed-artifact:"))).toBe(true);
    await expect(service.runFake({ ...common(blocked.head, projectId, 0, blocked.project.targetCommit) }))
      .rejects.toThrow(/再確認/);
    expect((await service.detail(projectId)).head).toBe(blocked.head);
    await writeFile(join(repo, "constitution.md"), content["constitution.md"] ?? "");
    git(repo, ["add", "constitution.md"]); git(repo, ["commit", "-qm", "restore passed constitution"]);
    blocked = await service.detail(projectId);
    expect(blocked.project.missing.some((reason) => reason.startsWith("passed-artifact:"))).toBe(false);
    result = /** @type {{head:string,project:any}} */ (blocked);
    const restored = createPocService({ ledgerRoot, process: processDefinition, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    await restored.initialize();
    expect((await restored.detail(projectId)).project.phase).toBe("P4");
    await expect(restored.execute({ type: "phase.transition",
      ...common(result.head, projectId, 0, blocked.project.targetCommit) }))
      .rejects.toThrow(/遷移条件/);
    result = await restored.execute({ type: "phase.reopen",
      ...common(result.head, projectId, 0, blocked.project.targetCommit),
      phase: "P3", reason: "Synthetic task revision" });
    expect(result.project.phase).toBe("P3");
    expect(result.project.generation).toBe(1);
    expect(result.project.activity.filter((item) => item.kind === "decision" && item.phase === "P1")
      .map((item) => item.state)).toEqual(["historical"]);
    expect(result.project.activity.filter((item) => item.kind === "decision" && item.phase === "P3")
      .map((item) => item.state)).toEqual(["invalidated"]);
  }, 180_000);

  it("rejects stale writes, foreign commits and invalid paths, then invalidates old decisions on reopen", async () => {
    const { service, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    const oldHead = result.head;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    await expect(service.execute({ type: "artifact.submit", ...common(oldHead, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") })).rejects.toThrow(/stale|期待/);
    await expect(service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "../outside", sha256: hash(content["constitution.md"] ?? "") })).rejects.toThrow();
    await expect(service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, "a".repeat(40)) })).rejects.toThrow();
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "phase.reopen", ...common(result.head, projectId, 0, commit),
      phase: "P0", reason: "Synthetic requirement change" });
    expect(result.project.phase).toBe("P0");
    expect(result.project.generation).toBe(1);
    await expect(service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) })).rejects.toThrow(/世代/);
  });

  it("rejects structurally invalid evidence and serializes competing writers", async () => {
    const { service, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    const command = { type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") };
    const writes = await Promise.allSettled([service.execute(command), service.execute(command)]);
    expect(writes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const refreshed = await service.detail(projectId);
    expect(refreshed.project.artifacts[0]?.verified).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(refreshed.head, projectId, 0, commit) });
    await expect(service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "requirement_spec", path: "invalid.md", sha256: hash(content["invalid.md"] ?? "") }))
      .rejects.toThrow(/構造/);
  });

  it("projects rejection, expiry, resubmission and reopen reasons without arbitrary ledger payload", async () => {
    const { service, commit, content, ledgerRoot, repo } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const id = result.project.projectId;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
    const reviewId = [...result.project.activity].reverse().find((item) => item.kind === "review")?.recordId;
    result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
      outcome: "rejected", role: "customer", reason: "REQ-001を見直す", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect([...result.project.activity].reverse().find((item) => item.kind === "decision")).toMatchObject({
      reviewRecordId: reviewId, outcome: "rejected", role: "customer", reason: "REQ-001を見直す",
      state: "rejected", targetCommits: [commit], simulated: true,
    });
    expect(result.project.canTransition).toBe(false);
    const clockStart = Date.now() + 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(clockStart));
    result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
      outcome: "approved", role: "customer", reason: "修正を確認", expiresAt: new Date(clockStart + 60_000).toISOString() });
    expect(result.project.activity.filter((item) => item.kind === "decision").map((item) => item.state))
      .toEqual(["superseded", "current"]);
    vi.setSystemTime(new Date(clockStart + 120_000));
    let restored = createPocService({ ledgerRoot, process: processDefinition, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    expect([...(await restored.detail(id)).project.activity].reverse().find((item) => item.kind === "decision")?.state).toBe("expired");
    expect((await restored.detail(id)).project.canTransition).toBe(false);
    result = await restored.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
      artifactId: "requirement_spec", path: "requirement.md", sha256: hash(content["requirement.md"] ?? "") });
    expect([...result.project.activity].reverse().find((item) => item.kind === "review")?.state).toBe("superseded");
    result = await restored.execute({ type: "phase.reopen", ...common(result.head, id, 0, commit),
      phase: "P0", reason: "条件変更のため再合意" });
    const activity = result.project.activity;
    expect([...activity].reverse().find((item) => item.kind === "reopen")).toMatchObject({
      from: "P1", to: "P0", reason: "条件変更のため再合意", invalidatedPhases: ["P0", "P1"],
    });
    expect(activity.filter((item) => item.kind === "decision").every((item) => item.state === "invalidated")).toBe(true);
    restored = createPocService({ ledgerRoot, process: processDefinition, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    expect((await restored.detail(id)).project.activity).toEqual(activity);
    expect(JSON.stringify(activity)).not.toContain("/var/");
  }, 60_000);

  it("holds only the project whose Git ancestry is unknown while listing healthy projects", async () => {
    const { repo, ledgerRoot, commit, content } = await fixture();
    const betaRepo = join(ledgerRoot, "beta-fixture");
    await mkdir(betaRepo, { recursive: true });
    git(betaRepo, ["init", "-q"]);
    await writeFile(join(betaRepo, "constitution.md"), content["constitution.md"] ?? "");
    git(betaRepo, ["add", "."]); git(betaRepo, ["commit", "-qm", "beta baseline"]);
    const betaCommit = git(betaRepo, ["rev-parse", "HEAD"]);
    const service = createPocService({ ledgerRoot, process: processDefinition, fixtures: {
      synthetic: { repo, repoId: "synthetic" }, beta: { repo: betaRepo, repoId: "beta" },
    } });
    await service.initialize();
    let alpha = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const alphaId = alpha.project.projectId;
    alpha = await service.execute({ type: "artifact.submit", ...common(alpha.head, alphaId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    alpha = await service.execute({ type: "phase.transition", ...common(alpha.head, alphaId, 0, commit) });
    alpha = await service.execute({ type: "phase.reopen", ...common(alpha.head, alphaId, 0, commit),
      phase: "P0", reason: "再提出" });
    const beta = await service.execute({ type: "project.create", fixtureId: "beta",
      expectedHead: alpha.head, targetCommit: betaCommit, policySha256: localPolicySha256 });
    git(repo, ["checkout", "--orphan", "unrelated"]);
    git(repo, ["commit", "-qm", "unrelated root"]);
    const listing = await service.list();
    expect(listing.projects.find((item) => item.projectId === alphaId)).toMatchObject({
      verified: false, phase: null, canTransition: false,
      missing: ["target:verification-unknown"],
    });
    expect(listing.projects.find((item) => item.projectId === beta.project.projectId)).toMatchObject({
      verified: true, phase: "P0", targetCommit: betaCommit,
    });
    expect(listing.fixtures.find((item) => item.fixtureId === "beta")?.verified).toBe(true);
    await expect(service.execute({ type: "phase.transition", ...common(beta.head, alphaId, 1,
      git(repo, ["rev-parse", "HEAD"])) })).rejects.toThrow(/基準commit|系列/);
    await rm(repo, { recursive: true, force: true });
    const missingRepo = await service.list();
    expect(missingRepo.fixtures.find((item) => item.fixtureId === "synthetic")?.verified).toBe(false);
    expect(missingRepo.projects.find((item) => item.projectId === beta.project.projectId)?.verified).toBe(true);
  }, 60_000);

  it("marks the current review and decision for recheck after a Git artifact changes or disappears", async () => {
    const { service, repo, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const id = result.project.projectId;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
    result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
      outcome: "approved", role: "customer", reason: "合成要求を確認", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(result.project.activity.filter((item) => ["review", "decision"].includes(item.kind)).map((item) => item.state))
      .toEqual(["current", "current"]);
    const changedBody = `${content["requirement.md"]}REQ-002: changed\n`;
    await writeFile(join(repo, "requirement.md"), changedBody);
    git(repo, ["add", "requirement.md"]); git(repo, ["commit", "-qm", "change requirement"]);
    let changed = await service.detail(id);
    expect(changed.project.canTransition).toBe(false);
    expect(changed.project.activity.filter((item) => ["review", "decision"].includes(item.kind)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "review", state: "evidence_changed",
        statusReasons: expect.arrayContaining(["target:commit-changed"]) }),
      expect.objectContaining({ kind: "decision", state: "evidence_changed" })]));
    await rm(join(repo, "requirement.md"));
    git(repo, ["add", "-A"]); git(repo, ["commit", "-qm", "remove requirement"]);
    changed = await service.detail(id);
    expect(changed.project.activity.filter((item) => item.kind === "decision").at(-1)?.state).toBe("evidence_changed");
    await writeFile(join(repo, "requirement.md"), changedBody);
    git(repo, ["add", "-A"]); git(repo, ["commit", "-qm", "restore requirement"]);
    const newCommit = git(repo, ["rev-parse", "HEAD"]);
    for (const [artifactId, path, body] of /** @type {[string,string,string][]} */ ([
      ["requirement_spec", "requirement.md", changedBody],
      ["business_flow_prototype", "flow.md", content["flow.md"] ?? ""],
    ])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, newCommit),
        artifactId, path, sha256: hash(body) });
    }
    expect(result.project.activity.filter((item) => ["review", "decision"].includes(item.kind)).map((item) => item.state))
      .toEqual(["superseded", "superseded"]);
    await expect(service.execute({ type: "phase.transition", ...common(result.head, id, 0, newCommit) }))
      .rejects.toThrow(/遷移条件/);
  }, 60_000);

  it("records a fixed fake TDD run and real G1/G2 checks before candidate acceptance", async () => {
    const { service, commit, content, repo, ledgerRoot } = await fixture({ cli: true });
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const id = result.project.projectId;
    /** @type {Record<string,[string,string][]>} */
    const byPhase = {
      P0: [["constitution", "constitution.md"]],
      P1: [["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]],
      P2: [["design_spec", "design.md"], ["adr", "adr.md"], ["working_prototype", "prototype.md"], ["properties", "properties.md"]],
      P3: [["task_list", "tasks.md"], ["task_definition", "task.md"]],
    };
    for (const phase of ["P0", "P1", "P2", "P3"]) {
      for (const [artifactId, path] of byPhase[phase] ?? []) {
        result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
          artifactId, path, sha256: hash(content[path] ?? "") });
      }
      if (phase !== "P0") {
        result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
        const role = phase === "P1" ? "customer" : "gatekeeper";
        result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
          outcome: "approved", role, reason: `Synthetic ${phase}`, expiresAt: "2099-01-01T00:00:00.000Z" });
      }
      result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
    }
    expect(result.project.phase).toBe("P4");
    result = await service.confirmSubscription({ ...common(result.head, id, 0, commit), provider: "codex" });
    const smoke = await service.runCli({ ...common(result.head, id, 0, commit), provider: "codex", kind: "smoke" });
    expect(smoke.cliRun.state).toBe("succeeded");
    const smokeManifest = join(ledgerRoot, "private-runs", smoke.cliRun.runId, "manifest.json");
    const smokeManifestBody = readFileSync(smokeManifest);
    result = smoke;
    const generated = await service.runFake({ ...common(result.head, id, 0, commit) });
    expect(generated.run.mode).toBe("fake");
    expect(generated.run.checks).toHaveLength(15);
    expect(generated.run.checks.every((item) => item.result === "passed")).toBe(true);
    expect(generated.project.phase).toBe("P4");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(commit);
    const accepted = await service.acceptCandidate({ ...common(generated.head, id, 0, commit),
      runId: generated.run.runId });
    expect(accepted.project.phase).toBe("P4");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(accepted.candidateCommit);
    expect(accepted.project.targetCommit).toBe(accepted.candidateCommit);
    const evidencePack = JSON.parse(readFileSync(join(repo, "docs/evidence-pack.json"), "utf8"));
    expect(evidencePack.checkEvidence.path).toBe("docs/check-evidence.json");
    expect(evidencePack.checkEvidence.sha256).toBe(hash(readFileSync(join(repo, "docs/check-evidence.json"), "utf8")));
    expect(JSON.parse(readFileSync(join(repo, "docs/check-evidence.json"), "utf8")).checks[0].evidence.command)
      .toBe("node --check src/approval.mjs");
    expect(accepted.project.missing.some((reason) => reason.includes("unimplemented"))).toBe(false);
    let current = /** @type {{head:string,project:any}} */ (accepted);
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([
      ["holdout_tests", "tests/holdout.test.mjs"], ["tests", "tests/approval.test.mjs"],
      ["code", "src/approval.mjs"], ["evidence_pack", "docs/evidence-pack.json"],
    ])) {
      current = await service.execute({ type: "artifact.submit", ...common(current.head, id, 0, accepted.candidateCommit),
        artifactId, path, sha256: hash(readFileSync(join(repo, path), "utf8")) });
    }
    current = await service.execute({ type: "review.request", ...common(current.head, id, 0, accepted.candidateCommit) });
    expect(current.project.canTransition).toBe(true);
    current = await service.execute({ type: "phase.transition", ...common(current.head, id, 0, accepted.candidateCommit) });
    expect(current.project.phase).toBe("P5");
    const quality = await service.runIntegration(common(current.head, id, 0, current.project.targetCommit));
    expect(quality.integration.result).toBe("passed");
    current = await service.execute({ type: "artifact.submit", ...common(quality.head, id, 0, quality.project.targetCommit),
      artifactId: "quality_metrics", path: "docs/quality-metrics.md",
      sha256: hash(readFileSync(join(repo, "docs/quality-metrics.md"), "utf8")) });
    current = await service.execute({ type: "review.request", ...common(current.head, id, 0, current.project.targetCommit) });
    current = await service.execute({ type: "decision.record", ...common(current.head, id, 0, current.project.targetCommit),
      outcome: "approved", role: "gatekeeper", reason: "Synthetic quality judgement with gaps",
      expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(current.project.canTransition).toBe(true);
    current = await service.execute({ type: "phase.transition", ...common(current.head, id, 0, current.project.targetCommit) });
    expect(current.project.phase).toBe("P6");
    const integrationTest = readFileSync(join(repo, "tests/integration.test.mjs"), "utf8");
    const integrationOutput = readFileSync(join(repo, "docs/integration-result.txt"), "utf8");
    await unlink(join(repo, "tests/integration.test.mjs"));
    await unlink(join(repo, "docs/integration-result.txt"));
    git(repo, ["add", "-A"]); git(repo, ["commit", "-qm", "remove quality evidence"]);
    let changedEvidence = await service.detail(id);
    expect(changedEvidence.project.missing.some((reason) => reason.startsWith("passed-check:"))).toBe(true);
    await expect(service.prepareDeliverables(common(changedEvidence.head, id, 0, changedEvidence.project.targetCommit)))
      .rejects.toThrow(/証跡/);
    await writeFile(join(repo, "tests/integration.test.mjs"), integrationTest);
    await writeFile(join(repo, "docs/integration-result.txt"), integrationOutput);
    git(repo, ["add", "-A"]); git(repo, ["commit", "-qm", "restore quality evidence"]);
    changedEvidence = await service.detail(id);
    expect(changedEvidence.project.missing.some((reason) => reason.startsWith("passed-check:"))).toBe(false);
    await unlink(smokeManifest);
    let missingCliEvidence = await service.detail(id);
    await expect(service.prepareDeliverables(common(missingCliEvidence.head, id, 0, missingCliEvidence.project.targetCommit)))
      .rejects.toThrow(/証跡/);
    await writeFile(smokeManifest, smokeManifestBody, { mode: 0o600 });
    current = /** @type {{head:string,project:any}} */ (await service.detail(id));
    const delivery = await service.prepareDeliverables(common(current.head, id, 0, current.project.targetCommit));
    current = await service.execute({ type: "artifact.submit", ...common(delivery.head, id, 0, delivery.project.targetCommit),
      artifactId: "reverse_generated_docs", path: "docs/reverse-generated.md",
      sha256: hash(readFileSync(join(repo, "docs/reverse-generated.md"), "utf8")) });
    current = await service.execute({ type: "review.request", ...common(current.head, id, 0, current.project.targetCommit) });
    current = await service.execute({ type: "decision.record", ...common(current.head, id, 0, current.project.targetCommit),
      outcome: "approved", role: "customer", reason: "Synthetic deliverable review only",
      expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(current.project.canComplete).toBe(true);
    await unlink(smokeManifest);
    missingCliEvidence = await service.detail(id);
    expect(missingCliEvidence.project.canComplete).toBe(false);
    expect(missingCliEvidence.project.missing).toContain(`cli-evidence:${smoke.cliRun.runId}:unknown`);
    await expect(service.execute({ type: "phase.complete",
      ...common(missingCliEvidence.head, id, 0, missingCliEvidence.project.targetCommit) })).rejects.toThrow(/完了条件/);
    await writeFile(smokeManifest, smokeManifestBody, { mode: 0o600 });
    current = /** @type {{head:string,project:any}} */ (await service.detail(id));
    expect(current.project.canComplete).toBe(true);
    current = await service.execute({ type: "phase.complete", ...common(current.head, id, 0, current.project.targetCommit) });
    expect(current.project.completed).toBe(true);
    const restored = createPocService({ ledgerRoot, process: processDefinition,
      fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    await restored.initialize();
    expect((await restored.detail(id)).project.completed).toBe(true);
    await writeFile(join(repo, "after-completion.md"), "Synthetic later change\n");
    git(repo, ["add", "after-completion.md"]); git(repo, ["commit", "-qm", "later synthetic change"]);
    const changed = await restored.detail(id);
    expect(changed.project.completed).toBe(false);
    expect(changed.project.missing).toContain("completion:target-changed-reopen-required");
    const reopened = await restored.execute({ type: "phase.reopen",
      ...common(changed.head, id, 0, changed.project.targetCommit), phase: "P4",
      reason: "Revalidate after completion change" });
    expect(reopened.project.phase).toBe("P4");
    expect(reopened.project.generation).toBe(1);
    const rerun = await restored.runFake(common(reopened.head, id, 1, reopened.project.targetCommit));
    expect(rerun.run.mode).toBe("fake-revalidation");
    expect(rerun.project.run?.mode).toBe("fake-revalidation");
    expect(rerun.run.candidateCommit).toBe(reopened.project.targetCommit);
    const reaccepted = await restored.acceptCandidate({ ...common(rerun.head, id, 1, reopened.project.targetCommit),
      runId: rerun.run.runId });
    expect(reaccepted.project.phase).toBe("P4");
    expect(reaccepted.project.run?.accepted).toBe(true);
    current = reaccepted;
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([
      ["holdout_tests", "tests/holdout.test.mjs"], ["tests", "tests/approval.test.mjs"],
      ["code", "src/approval.mjs"], ["evidence_pack", "docs/evidence-pack.json"],
    ])) {
      current = await restored.execute({ type: "artifact.submit",
        ...common(current.head, id, 1, current.project.targetCommit), artifactId, path,
        sha256: hash(readFileSync(join(repo, path), "utf8")) });
    }
    current = await restored.execute({ type: "review.request",
      ...common(current.head, id, 1, current.project.targetCommit) });
    expect(current.project.canTransition).toBe(true);
    current = await restored.execute({ type: "phase.transition",
      ...common(current.head, id, 1, current.project.targetCommit) });
    expect(current.project.phase).toBe("P5");
  }, 720_000);
});
