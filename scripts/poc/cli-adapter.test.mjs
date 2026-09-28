import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCliAdapters, spawnBounded } from "./cli-adapter.mjs";

/** @type {string[]} */ const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
/** @param {string|Buffer} value */ const sha = (value) => createHash("sha256").update(value).digest("hex");
const smokeSummary = JSON.stringify({ status: "ok", file: "src/approval.mjs", hook: "denied" });
const codexSummaryEvent = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: smokeSummary } });

/** @param {Record<string,any>} [overrides] */
async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "jsix-cli-adapter-")); roots.push(root);
  const codex = join(root, "codex"); const claude = join(root, "claude"); const hook = join(root, "hook.json");
  await writeFile(codex, "#!/bin/sh\n"); await writeFile(claude, "#!/bin/sh\n"); await chmod(codex, 0o700); await chmod(claude, 0o700);
  await writeFile(hook, "fixed hook\n");
  /** @type {any[]} */ const calls = [];
  /** @param {any} input */
  const runProcess = (input) => {
    calls.push(input);
    const auth = input.args[0] === "login" ? "Logged in using ChatGPT" :
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" });
    const workload = input.executable.endsWith("codex") ?
      `{"type":"thread.started","thread_id":"t-1"}\n${codexSummaryEvent}\n{"type":"item.completed","item":{"type":"command_execution","command":"git config --list","status":"denied","exit_code":1,"aggregated_output":"blocked by PreToolUse"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n` :
      `${JSON.stringify({ type: "system", session_id: "s-1" })}\n{"type":"hook_response","hook_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git config --list"},"decision":"deny"}\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "s-1", result: smokeSummary })}\n`;
    const output = input.args[0] === "--version" ? `${providerVersion(input.executable)}\n` :
      input.args[0] === "exec" || input.args[0] === "-p" ? workload : auth;
    return { promise: Promise.resolve({ code: 0, signal: null, stdout: output,
      stderr: "", overflow: false, timedOut: false, cancelled: false }), cancel() {} };
  };
  /** @param {string} executable */
  const providerVersion = (executable) => executable.endsWith("codex") ? "codex-cli 0.test" : "claude 0.test";
  const adapters = createCliAdapters({ executables: { codex, claude },
    controls: { files: [{ path: hook, sha256: sha("fixed hook\n") }], codexTrusted: true },
    runProcess, env: {}, home: root, now: () => new Date("2026-09-28T03:00:00Z"), ...overrides });
  /** @param {any} provider */ const confirmation = (provider) => ({ provider, subscriptionOnly: true,
    additionalCreditsDisabled: true, confirmedAt: "2026-09-28T02:59:00Z" });
  return { root, hook, calls, adapters, confirmation };
}

describe("subscription CLI adapters", () => {
  it.each(["codex", "claude"])("preflights immediately and uses fixed safe arguments for %s", async (provider) => {
    const { root, calls, adapters, confirmation } = await fixture();
    const result = await adapters.run({ provider: /** @type {"codex"|"claude"} */ (provider), kind: "smoke", worktree: root,
      prompt: "fixed prompt", confirmation: confirmation(provider) });
    expect(result.state).toBe("succeeded");
    expect(calls).toHaveLength(3);
    expect(calls[0].args).toEqual(["--version"]);
    expect(calls[1].args).toEqual(provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"]);
    expect(calls[2].args.join(" ")).not.toMatch(/dangerously|ignore-rules|bare|safe-mode|--model/);
    expect(calls[2].input).toBe("fixed prompt");
    expect(calls[2].shell).not.toBe(true);
    expect(calls[2].env.CUSTOM_ACCESS_TOKEN).toBeUndefined();
    expect(result.process?.outputSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["api environment", { env: { OPENAI_API_KEY: "never-read" } }, "api-or-provider-environment-present"],
    ["untrusted hook", { controls: { files: [], codexTrusted: false } }, "hook-trust-unknown"],
  ])("spawns zero workload for %s", async (_label, override, reason) => {
    const { root, calls, adapters, confirmation } = await fixture(override);
    const result = await adapters.run({ provider: "codex", kind: "edit", worktree: root,
      prompt: "fixed", confirmation: confirmation("codex") });
    expect(result.state).toBe("held"); expect(result.preflight.reason).toBe(reason); expect(calls).toHaveLength(0);
  });

  it("spawns zero workload when operator confirmation is missing or expired", async () => {
    const { root, calls, adapters } = await fixture();
    for (const confirmation of [null, { provider: "codex", subscriptionOnly: true,
      additionalCreditsDisabled: true, confirmedAt: "2026-09-28T02:00:00Z" }]) {
      const result = await adapters.run({ provider: "codex", kind: "edit", worktree: root,
        prompt: "fixed", confirmation });
      expect(result.state).toBe("held");
    }
    expect(calls).toHaveLength(0);
  });

  it("stops after auth when subscription method is not confirmed", async () => {
    const base = await fixture();
    /** @type {any[]} */ const calls = [];
    const adapters = createCliAdapters({ executables: base.adapters.definitions && {
      codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [{ path: base.hook, sha256: sha("fixed hook\n") }], codexTrusted: true }, env: {}, home: base.root,
      now: () => new Date("2026-09-28T03:00:00Z"), runProcess(/** @type {any} */ input) { calls.push(input); return { promise: Promise.resolve({
        code: 0, signal: null, stdout: input.args[0] === "--version" ? "codex-cli 0.test" : "Logged in using API key",
        stderr: "", overflow: false, timedOut: false, cancelled: false }), cancel() {} }; } });
    const result = await adapters.run({ provider: "codex", kind: "edit", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe("held"); expect(result.preflight.reason).toBe("subscription-auth-unconfirmed");
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["version timeout", "version", { timedOut: true }],
    ["auth timeout", "auth", { timedOut: true }],
    ["auth output overflow", "auth", { overflow: true }],
    ["auth stop unconfirmed", "auth", { stopUnconfirmed: true }],
  ])("does not start a workload after %s", async (_label, unhealthyStage, flags) => {
    const base = await fixture();
    /** @type {any[]} */ const calls = [];
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [{ path: base.hook, sha256: sha("fixed hook\n") }], codexTrusted: true }, env: {}, home: base.root,
      now: () => new Date("2026-09-28T03:00:00Z"), runProcess(input) {
        calls.push(input); const stage = input.args[0] === "--version" ? "version" : input.args[0] === "login" ? "auth" : "workload";
        const output = stage === "version" ? "codex-cli 0.test" : stage === "auth" ? "Logged in using ChatGPT" : "";
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output, stderr: "", overflow: false,
          timedOut: false, cancelled: false, stopUnconfirmed: false, ...(stage === unhealthyStage ? flags : {}) }), cancel() {} };
      } });
    const result = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe("held");
    expect(calls.some((call) => call.args[0] === "exec")).toBe(false);
  });

  it("does not accept a smoke run without an observed real-session hook denial", async () => {
    const base = await fixture();
    /** @type {any[]} */ const calls = [];
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [{ path: base.hook, sha256: sha("fixed hook\n") }], codexTrusted: true }, env: {}, home: base.root,
      now: () => new Date("2026-09-28T03:00:00Z"), runProcess(/** @type {any} */ input) { calls.push(input); const auth = input.args[0] === "login";
        const output = input.args[0] === "--version" ? "codex-cli 0.test" : auth ? "Logged in using ChatGPT" :
          `{"type":"thread.started"}\n${codexSummaryEvent}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n`;
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output,
          stderr: "", overflow: false, timedOut: false, cancelled: false }), cancel() {} }; } });
    const result = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe("hook_unobserved"); expect(calls).toHaveLength(3);
  });

  it.each([
    ["agent claim", `{"type":"thread.started"}\n${codexSummaryEvent}\n{"type":"item.completed","item":{"type":"agent_message","text":"git config --list denied by PreToolUse"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n`, "hook_unobserved"],
    ["broken JSON", '{"type":"thread.started"}\nnot-json\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n', "invalid_events"],
    ["unknown event", '{"type":"thread.started"}\n{"type":"invented"}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n', "invalid_events"],
    ["missing terminal", '{"type":"thread.started"}\n', "invalid_events"],
  ])("rejects %s instead of trusting output text", async (_label, workload, expected) => {
    const base = await fixture();
    /** @type {any[]} */ const calls = [];
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [{ path: base.hook, sha256: sha("fixed hook\n") }], codexTrusted: true },
      env: {}, home: base.root, now: () => new Date("2026-09-28T03:00:00Z"), runProcess(input) {
        calls.push(input); const output = input.args[0] === "--version" ? "codex-cli 0.test" :
          input.args[0] === "login" ? "Logged in using ChatGPT" : workload;
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output, stderr: "",
          overflow: false, timedOut: false, cancelled: false }), cancel() {} };
      } });
    const result = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe(expected); expect(calls).toHaveLength(3);
  });

  it.each([
    ["missing", null],
    ["non-JSON", "ok"],
    ["missing field", JSON.stringify({ status: "ok", file: "src/approval.mjs" })],
  ])("rejects a %s smoke summary", async (_label, summary) => {
    const base = await fixture();
    const events = [`{"type":"thread.started"}`];
    if (summary !== null) events.push(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: summary } }));
    events.push('{"type":"item.completed","item":{"type":"command_execution","command":"git config --list","status":"denied","exit_code":1,"aggregated_output":"blocked by PreToolUse"}}');
    events.push('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}');
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [{ path: base.hook, sha256: sha("fixed hook\n") }], codexTrusted: true }, env: {}, home: base.root,
      now: () => new Date("2026-09-28T03:00:00Z"), runProcess(input) {
        const output = input.args[0] === "--version" ? "codex-cli 0.test" :
          input.args[0] === "login" ? "Logged in using ChatGPT" : `${events.join("\n")}\n`;
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output, stderr: "",
          overflow: false, timedOut: false, cancelled: false }), cancel() {} };
      } });
    const result = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe("invalid_events"); expect(result.process?.eventValidation).toBe("smoke-result-invalid");
  });

  it("hashes the exact combined UTF-8 output that will be persisted", async () => {
    const base = await fixture();
    const stdout = "あ".repeat(60_000); const stderr = "x".repeat(180_000);
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [], codexTrusted: true }, env: {}, home: base.root, runProcess() {
        return { promise: Promise.resolve({ code: 0, signal: null, stdout, stderr,
          overflow: false, timedOut: false, cancelled: false }), cancel() {} };
      } });
    const result = await adapters.runAfterPreflight({ provider: "codex", kind: "edit", worktree: base.root,
      prompt: "fixed", checked: { ok: true } });
    expect(result.state).toBe("output_limit");
    if (!result.process) throw new Error("process result missing");
    expect(Buffer.byteLength(result.process.output)).toBeLessThanOrEqual(256 * 1024);
    expect(result.process.output).not.toContain("�");
    expect(result.process.outputSha256).toBe(sha(result.process.output));
  });

  it("passes only allowlisted environment names to helpers and workloads", async () => {
    const { root, calls, adapters, confirmation } = await fixture({ env: {
      PATH: "/bin", LANG: "C", CUSTOM_ACCESS_TOKEN: "never-forward", FEATURE_FLAG: "off",
    } });
    const result = await adapters.run({ provider: "codex", kind: "edit", worktree: root,
      prompt: "fixed", confirmation: confirmation("codex") });
    expect(result.state).toBe("succeeded");
    expect(calls.every((call) => call.env.PATH === "/bin" && call.env.LANG === "C" &&
      call.env.HOME === root && call.env.CUSTOM_ACCESS_TOKEN === undefined && call.env.FEATURE_FLAG === undefined)).toBe(true);
  });

  it.each(["machine instruction", "hook launcher"])("rechecks changed %s before the edit workload", async (_label) => {
    const base = await fixture();
    const instruction = join(base.root, "AGENTS.md"); const launcher = join(base.root, "deny-check.sh");
    await writeFile(instruction, "fixed instruction\n"); await writeFile(launcher, "fixed launcher\n");
    /** @type {any[]} */ const calls = [];
    const controls = [instruction, launcher].map((path) => ({ path,
      sha256: sha(path === instruction ? "fixed instruction\n" : "fixed launcher\n") }));
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: controls, codexTrusted: true }, env: {}, home: base.root,
      now: () => new Date("2026-09-28T03:00:00Z"), runProcess(input) {
        calls.push(input); const output = input.args[0] === "--version" ? "codex-cli 0.test" :
          input.args[0] === "login" ? "Logged in using ChatGPT" :
            `{"type":"thread.started"}\n${codexSummaryEvent}\n{"type":"item.completed","item":{"type":"command_execution","command":"git config --list","status":"denied","exit_code":1,"aggregated_output":"blocked by PreToolUse"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n`;
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output, stderr: "",
          overflow: false, timedOut: false, cancelled: false }), cancel() {} };
      } });
    const smoke = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(smoke.state).toBe("succeeded");
    await writeFile(_label === "machine instruction" ? instruction : launcher, "changed\n");
    const edit = await adapters.run({ provider: "codex", kind: "edit", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(edit.state).toBe("held"); expect(edit.preflight.reason).toMatch(/^control-hash-changed:/);
    expect(calls).toHaveLength(3);
  });

  it("escalates a timeout to SIGKILL and settles within a finite grace", async () => {
    const started = Date.now();
    const task = spawnBounded({ executable: process.execPath,
      args: ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], cwd: process.cwd(),
      env: { PATH: process.env.PATH }, input: "", timeoutMs: 50 });
    const result = await task.promise;
    expect(result.timedOut).toBe(true); expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("kills a SIGTERM-resistant descendant after the direct child exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-cli-group-")); roots.push(root);
    const pidFile = join(root, "descendant.pid");
    const descendant = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const parent = `const{spawn}=require('node:child_process');const fs=require('node:fs');` +
      `const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});` +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`;
    const task = spawnBounded({ executable: process.execPath, args: ["-e", parent], cwd: root,
      env: { PATH: process.env.PATH }, input: "", timeoutMs: 100 });
    const result = await task.promise;
    const descendantPid = Number(await readFile(pidFile, "utf8"));
    let alive = true;
    try { process.kill(descendantPid, 0); } catch { alive = false; }
    if (alive) process.kill(descendantPid, "SIGKILL");
    expect(result.timedOut).toBe(true); expect(result.stopUnconfirmed).toBe(false); expect(alive).toBe(false);
  });

  it("cleans up a descendant left by a normally exiting direct child", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-cli-normal-group-")); roots.push(root);
    const pidFile = join(root, "descendant.pid");
    const descendant = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const parent = `const{spawn}=require('node:child_process');const fs=require('node:fs');` +
      `const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});` +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();`;
    const task = spawnBounded({ executable: process.execPath, args: ["-e", parent], cwd: root,
      env: { PATH: process.env.PATH }, input: "", timeoutMs: 5_000 });
    const result = await task.promise;
    const descendantPid = Number(await readFile(pidFile, "utf8"));
    let alive = true;
    try { process.kill(descendantPid, 0); } catch { alive = false; }
    if (alive) process.kill(descendantPid, "SIGKILL");
    expect(result.code).toBe(0); expect(result.stopUnconfirmed).toBe(false); expect(alive).toBe(false);
  });

  it("bounds explicit cancellation and output overflow", async () => {
    const cancelledTask = spawnBounded({ executable: process.execPath,
      args: ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], cwd: process.cwd(),
      env: { PATH: process.env.PATH }, input: "", timeoutMs: 10_000 });
    setTimeout(() => cancelledTask.cancel(), 50);
    const cancelled = await cancelledTask.promise;
    expect(cancelled.cancelled).toBe(true);
    const overflowTask = spawnBounded({ executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(300000)); setInterval(()=>{},1000)"], cwd: process.cwd(),
      env: { PATH: process.env.PATH }, input: "", timeoutMs: 10_000 });
    const overflow = await overflowTask.promise;
    expect(overflow.overflow).toBe(true); expect(overflow.stdout.length).toBeLessThanOrEqual(256 * 1024);
  });
});
