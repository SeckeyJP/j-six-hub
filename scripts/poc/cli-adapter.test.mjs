import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCliAdapters, spawnBounded } from "./cli-adapter.mjs";

/** @type {string[]} */ const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
/** @param {string|Buffer} value */ const sha = (value) => createHash("sha256").update(value).digest("hex");

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
      '{"type":"thread.started","thread_id":"t-1"}\n{"type":"item.completed","item":{"type":"command_execution","command":"git config --list","status":"denied","exit_code":1,"aggregated_output":"blocked by PreToolUse"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n' :
      '{"type":"system","session_id":"s-1"}\n{"type":"hook_response","hook_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git config --list"},"decision":"deny"}\n{"type":"result","subtype":"success","is_error":false,"session_id":"s-1","result":"ok"}\n';
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

  it("does not accept a smoke run without an observed real-session hook denial", async () => {
    const base = await fixture();
    /** @type {any[]} */ const calls = [];
    const adapters = createCliAdapters({ executables: { codex: join(base.root, "codex"), claude: join(base.root, "claude") },
      controls: { files: [{ path: base.hook, sha256: sha("fixed hook\n") }], codexTrusted: true }, env: {}, home: base.root,
      now: () => new Date("2026-09-28T03:00:00Z"), runProcess(/** @type {any} */ input) { calls.push(input); const auth = input.args[0] === "login";
        const output = input.args[0] === "--version" ? "codex-cli 0.test" : auth ? "Logged in using ChatGPT" :
          '{"type":"thread.started"}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n';
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output,
          stderr: "", overflow: false, timedOut: false, cancelled: false }), cancel() {} }; } });
    const result = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe("hook_unobserved"); expect(calls).toHaveLength(3);
  });

  it.each([
    ["agent claim", '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"git config --list denied by PreToolUse"}}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n', "hook_unobserved"],
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

  it("escalates a timeout to SIGKILL and settles within a finite grace", async () => {
    const started = Date.now();
    const task = spawnBounded({ executable: process.execPath,
      args: ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], cwd: process.cwd(),
      env: { PATH: process.env.PATH }, input: "", timeoutMs: 50 });
    const result = await task.promise;
    expect(result.timedOut).toBe(true); expect(Date.now() - started).toBeLessThan(2_000);
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
