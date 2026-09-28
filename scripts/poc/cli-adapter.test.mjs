import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCliAdapters } from "./cli-adapter.mjs";

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
    const workload = '{"type":"thread.started"}\n{"type":"item.completed","command":"git config --list","status":"denied"}\n';
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
        const output = input.args[0] === "--version" ? "codex-cli 0.test" : auth ? "Logged in using ChatGPT" : '{"type":"done"}\n';
        return { promise: Promise.resolve({ code: 0, signal: null, stdout: output,
          stderr: "", overflow: false, timedOut: false, cancelled: false }), cancel() {} }; } });
    const result = await adapters.run({ provider: "codex", kind: "smoke", worktree: base.root,
      prompt: "fixed", confirmation: base.confirmation("codex") });
    expect(result.state).toBe("hook_unobserved"); expect(calls).toHaveLength(3);
  });
});
