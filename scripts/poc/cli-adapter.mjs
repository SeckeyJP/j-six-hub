import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename } from "node:path";

const outputLimit = 256 * 1024;
const confirmationTtlMs = 5 * 60 * 1000;
const forbiddenEnv = Object.freeze({
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_BASE_URL"],
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
    "AWS_BEARER_TOKEN_BEDROCK", "GOOGLE_APPLICATION_CREDENTIALS", "AZURE_API_KEY"],
});
const definitions = Object.freeze({
  codex: Object.freeze({ adapterId: "codex-subscription-v1", executableName: "codex" }),
  claude: Object.freeze({ adapterId: "claude-subscription-v1", executableName: "claude" }),
});

/** @typedef {"codex"|"claude"} Provider */
/** @typedef {"smoke"|"edit"} RunKind */
/** @typedef {{promise:Promise<any>,cancel:()=>void}} ProcessTask */
/** @param {string|Buffer} value */
const sha = (value) => createHash("sha256").update(value).digest("hex");

/** @param {NodeJS.ProcessEnv} source @param {Provider} provider */
function sanitizedEnvironment(source, provider) {
  const result = { ...source };
  for (const key of Object.keys(result)) {
    if (forbiddenEnv[provider].includes(key) || /^(OPENAI|CODEX|ANTHROPIC|CLAUDE_CODE_USE_|AWS_|GOOGLE_|AZURE_).*(?:KEY|TOKEN|PROVIDER|BASE_URL|USE_)/.test(key)) {
      delete result[key];
    }
  }
  return result;
}

/** @param {string} value @param {string} home */
function sanitize(value, home) {
  return value.replaceAll(home, "<home>")
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{16,}\b/g, "<redacted-secret>")
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]{12,}/gi, "Bearer <redacted-secret>");
}

/** @param {Provider} provider @param {string} output */
function normalizedAuth(provider, output) {
  if (provider === "codex") return { authenticated: /Logged in using ChatGPT/i.test(output), method: "chatgpt" };
  try {
    const body = JSON.parse(output);
    const method = String(body.authMethod ?? body.auth_method ?? "").toLowerCase();
    const apiProvider = String(body.apiProvider ?? body.api_provider ?? "").toLowerCase();
    const subscription = body.subscriptionType ?? body.subscription_type ?? null;
    return { authenticated: body.loggedIn === true && method === "claude.ai" && apiProvider === "firstparty" && !!subscription,
      method: "claude.ai-subscription" };
  } catch { return { authenticated: false, method: "unknown" }; }
}

/** Run a bounded process without a shell. The returned controller is used by the local cancel endpoint. */
/** @param {{executable:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,input:string,timeoutMs:number,onStart?:(pid:number)=>void}} inputOptions @returns {ProcessTask} */
export function spawnBounded({ executable, args, cwd, env, input, timeoutMs, onStart = () => {} }) {
  /** @type {import("node:child_process").ChildProcessWithoutNullStreams|null} */ let child = null;
  /** @type {NodeJS.Timeout|undefined} */ let timer;
  let timedOut = false;
  let cancelled = false;
  const promise = new Promise((resolve, reject) => {
    child = spawn(executable, args, { cwd, env, shell: false, detached: true,
      stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let overflow = false;
    /** @param {"stdout"|"stderr"} field @param {Buffer} chunk */
    const collect = (field, chunk) => {
      const current = field === "stdout" ? stdout : stderr;
      if (current.length + chunk.length > outputLimit) overflow = true;
      const next = Buffer.concat([current, chunk]).subarray(0, outputLimit);
      if (field === "stdout") stdout = next; else stderr = next;
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.once("error", reject);
    child.once("spawn", () => { onStart(child?.pid ?? 0); child?.stdin.end(input); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"),
        overflow, timedOut, cancelled });
    });
    timer = setTimeout(() => { timedOut = true; try { if (child?.pid) process.kill(-child.pid, "SIGTERM"); }
      catch { /* The child already exited. */ } }, timeoutMs);
  });
  return { promise, cancel() { cancelled = true; if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); }
    catch { /* The child already exited. */ } } } };
}

/** @param {{executables:Record<Provider,string>,controls:{files:{path:string,sha256:string}[],codexTrusted:boolean},runProcess?:(input:any)=>ProcessTask,now?:()=>Date,env?:NodeJS.ProcessEnv,home?:string}} options */
export function createCliAdapters(options) {
  const now = options.now ?? (() => new Date());
  const sourceEnv = options.env ?? process.env;
  const home = options.home ?? process.env.HOME ?? "";
  const runProcess = options.runProcess ?? ((/** @type {any} */ input) => spawnBounded(input));

  /** @param {Provider} provider */
  async function inspectControls(provider) {
    if (provider === "codex" && !options.controls.codexTrusted) return { ok: false, reason: "hook-trust-unknown" };
    for (const file of options.controls.files) {
      try {
        if (sha(await readFile(file.path)) !== file.sha256) return { ok: false, reason: `control-hash-changed:${basename(file.path)}` };
      } catch { return { ok: false, reason: `control-unreadable:${basename(file.path)}` }; }
    }
    return { ok: true, reason: null };
  }

  /** @param {Provider} provider @param {any} confirmation */
  async function preflight(provider, confirmation) {
    const definition = definitions[provider];
    if (!definition) return { ok: false, reason: "unknown-provider", spawnAllowed: false };
    const executable = options.executables[provider];
    if (!executable || basename(executable) !== definition.executableName) return { ok: false, reason: "executable-not-fixed", spawnAllowed: false };
    try { await realpath(executable); } catch { return { ok: false, reason: "executable-unreadable", spawnAllowed: false }; }
    const present = forbiddenEnv[provider].filter((/** @type {string} */ name) => Object.hasOwn(sourceEnv, name));
    if (present.length) return { ok: false, reason: "api-or-provider-environment-present", present, spawnAllowed: false };
    const controls = await inspectControls(provider);
    if (!controls.ok) return { ok: false, reason: controls.reason, spawnAllowed: false };
    const confirmedAt = Date.parse(confirmation?.confirmedAt ?? "");
    const age = now().getTime() - confirmedAt;
    if (confirmation?.provider !== provider || confirmation?.subscriptionOnly !== true ||
      confirmation?.additionalCreditsDisabled !== true || !Number.isFinite(confirmedAt) || age < 0 || age > confirmationTtlMs) {
      return { ok: false, reason: "subscription-confirmation-missing-or-expired", spawnAllowed: false };
    }
    const versionTask = runProcess({ executable, args: ["--version"], cwd: home,
      env: sanitizedEnvironment(sourceEnv, provider), input: "", timeoutMs: 15_000 });
    const versionOutcome = await versionTask.promise;
    const version = (versionOutcome.stdout + versionOutcome.stderr).trim().slice(0, 120);
    if (versionOutcome.code !== 0 || !version) return { ok: false, reason: "cli-version-unconfirmed", spawnAllowed: false };
    const authArgs = provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"];
    const auth = runProcess({ executable, args: authArgs, cwd: home,
      env: sanitizedEnvironment(sourceEnv, provider), input: "", timeoutMs: 15_000 });
    const outcome = await auth.promise;
    const normalized = normalizedAuth(provider, outcome.stdout + outcome.stderr);
    if (outcome.code !== 0 || !normalized.authenticated) {
      return { ok: false, reason: "subscription-auth-unconfirmed", authMethod: normalized.method, spawnAllowed: false };
    }
    return { ok: true, reason: null, spawnAllowed: true, provider, adapterId: definition.adapterId,
      executableVersion: version, authMethod: normalized.method, environmentPresent: [],
      controls: "matched", confirmation: "operator-asserted", checkedAt: now().toISOString() };
  }

  /** @param {Provider} provider @param {RunKind} kind @param {string} worktree */
  function command(provider, kind, worktree) {
    if (provider === "codex") return { executable: options.executables.codex,
      args: ["exec", "--json", "--ephemeral", "--sandbox", kind === "smoke" ? "read-only" : "workspace-write", "-C", worktree, "-"] };
    return { executable: options.executables.claude,
      args: ["-p", "--verbose", "--output-format", "stream-json", "--include-hook-events",
        "--no-session-persistence", "--permission-prompts", "none", "--permission-mode",
        kind === "smoke" ? "dontAsk" : "acceptEdits", "--allowedTools",
        kind === "smoke" ? "Read,Bash" : "Read,Edit,Write,Bash"] };
  }

  /** @param {{provider:Provider,kind:RunKind,worktree:string,prompt:string,confirmation:any,timeoutMs?:number,onStart?:(pid:number)=>void,onController?:(task:ProcessTask)=>void}} input */
  async function run({ provider, kind, worktree, prompt, confirmation, timeoutMs = 120_000, onStart, onController }) {
    const checked = await preflight(provider, confirmation);
    if (!checked.ok) return { state: "held", preflight: checked, process: null };
    const startedAt = now().toISOString();
    const invocation = command(provider, kind, worktree);
    const task = runProcess({ ...invocation, cwd: worktree, env: sanitizedEnvironment(sourceEnv, provider),
      input: prompt, timeoutMs, onStart });
    onController?.(task);
    const outcome = await task.promise;
    const raw = sanitize(outcome.stdout + outcome.stderr, home);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const jsonEvents = lines.reduce((/** @type {number} */ count, /** @type {string} */ line) => {
      try { JSON.parse(line); return count + 1; } catch { return count; }
    }, 0);
    const hookObserved = kind !== "smoke" || (/git config --list/i.test(raw) && /(?:denied|blocked|PreToolUse|not allowed|拒否)/i.test(raw));
    const state = outcome.cancelled ? "cancelled" : outcome.timedOut ? "timed_out" :
      outcome.overflow ? "output_limit" : outcome.code !== 0 ? "failed" :
        jsonEvents === 0 ? "invalid_events" : !hookObserved ? "hook_unobserved" : "succeeded";
    return { state, preflight: checked, process: { startedAt, finishedAt: now().toISOString(),
      exitCode: outcome.code, signal: outcome.signal, jsonEvents, hookObserved,
      outputSha256: sha(raw), output: raw.slice(0, outputLimit), adapterId: definitions[provider].adapterId,
      provider, kind, args: invocation.args.map((arg) => arg === worktree ? "<worktree>" : arg) } };
  }

  return { definitions, preflight, run, command };
}

export { forbiddenEnv, outputLimit, confirmationTtlMs };
