import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename } from "node:path";

const outputLimit = 256 * 1024;
const confirmationTtlMs = 5 * 60 * 1000;
const stopGraceMs = 750;
const forceSettleMs = 1_500;
const childEnvAllowlist = Object.freeze(["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR",
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
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

/** @param {NodeJS.ProcessEnv} source */
function sanitizedEnvironment(source) {
  /** @type {NodeJS.ProcessEnv} */ const result = {};
  for (const key of childEnvAllowlist) if (typeof source[key] === "string") result[key] = source[key];
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
/** @param {{executable:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,input:string,timeoutMs:number,onStart?:(pid:number)=>void|Promise<void>}} inputOptions @returns {ProcessTask} */
export function spawnBounded({ executable, args, cwd, env, input, timeoutMs, onStart = () => {} }) {
  /** @type {import("node:child_process").ChildProcessWithoutNullStreams|null} */ let child = null;
  /** @type {NodeJS.Timeout|undefined} */ let timer;
  /** @type {NodeJS.Timeout|undefined} */ let killTimer;
  /** @type {NodeJS.Timeout|undefined} */ let settleTimer;
  let timedOut = false;
  let cancelled = false;
  let outputLimited = false;
  /** @type {(reason:"timeout"|"cancel"|"output")=>void} */ let stop = () => {};
  const promise = new Promise((resolve, reject) => {
    let settled = false; let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let overflow = false;
    /** @param {number|null} code @param {NodeJS.Signals|null} signal @param {boolean=} stopUnconfirmed */
    const finish = (code, signal, stopUnconfirmed = false) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(settleTimer);
      resolve({ code, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"),
        overflow, timedOut, cancelled, stopUnconfirmed });
    };
    /** @param {"timeout"|"cancel"|"output"} reason */
    const requestStop = (reason) => {
      if (reason === "timeout") timedOut = true;
      if (reason === "cancel") cancelled = true;
      if (reason === "output") outputLimited = true;
      try { if (child?.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
      killTimer ??= setTimeout(() => {
        try { if (child?.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
      }, stopGraceMs);
      settleTimer ??= setTimeout(() => {
        child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy(); child?.unref();
        finish(null, null, true);
      }, forceSettleMs);
    };
    stop = requestStop;
    child = spawn(executable, args, { cwd, env, shell: false, detached: true,
      stdio: ["pipe", "pipe", "pipe"] });
    /** @param {"stdout"|"stderr"} field @param {Buffer} chunk */
    const collect = (field, chunk) => {
      const current = field === "stdout" ? stdout : stderr;
      if (current.length + chunk.length > outputLimit) overflow = true;
      const next = Buffer.concat([current, chunk]).subarray(0, outputLimit);
      if (field === "stdout") stdout = next; else stderr = next;
      if (overflow && !outputLimited) requestStop("output");
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.once("error", (error) => { if (!settled) {
      settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(settleTimer); reject(error);
    } });
    child.once("spawn", async () => {
      try { await onStart(child?.pid ?? 0); child?.stdin.end(input); }
      catch { requestStop("cancel"); }
    });
    child.once("close", (code, signal) => finish(code, signal));
    timer = setTimeout(() => requestStop("timeout"), timeoutMs);
  });
  return { promise, cancel() { if (!cancelled) stop("cancel"); } };
}

const allowedEvents = Object.freeze({
  codex: new Set(["thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.updated", "item.completed", "error"]),
  claude: new Set(["system", "assistant", "user", "result", "stream_event", "hook_started", "hook_response"]),
});

/** @param {any} event */
function codexHookDenied(event) {
  if (event?.type !== "item.completed") return false;
  const item = event.item;
  const nonzero = Number.isInteger(Number(item?.exit_code)) && Number(item.exit_code) !== 0;
  const denied = ["failed", "denied", "blocked"].includes(item?.status) || nonzero;
  return item?.type === "command_execution" && item.command === "git config --list" && denied &&
    /(?:PreToolUse|denied|blocked|拒否)/i.test(item.aggregated_output ?? "");
}

/** @param {any} event */
function claudeHookDenied(event) {
  return event?.type === "hook_response" && event.hook_name === "PreToolUse" &&
    event.tool_name === "Bash" && event.tool_input?.command === "git config --list" &&
    ["deny", "denied", "blocked"].includes(event.decision);
}

/** @param {Provider} provider @param {string} stdout @param {RunKind} kind */
function validateEvents(provider, stdout, kind) {
  const lines = stdout.split(/\r?\n/).filter(Boolean); const events = [];
  for (const line of lines) {
    let event; try { event = JSON.parse(line); } catch { return { ok: false, reason: "malformed-jsonl", count: events.length, hookObserved: false, identifiers: {} }; }
    if (!event || typeof event !== "object" || Array.isArray(event) || !allowedEvents[provider].has(event.type)) {
      return { ok: false, reason: "unknown-event", count: events.length, hookObserved: false, identifiers: {} };
    }
    events.push(event);
  }
  const terminal = provider === "codex" ? events.filter((event) => event.type === "turn.completed" &&
    event.usage && ["input_tokens", "output_tokens"].every((field) => Number.isSafeInteger(event.usage[field]) && event.usage[field] >= 0)) :
    events.filter((event) => event.type === "result" && event.is_error === false && event.subtype === "success" &&
      typeof event.session_id === "string" && typeof event.result === "string");
  const failed = events.some((event) => event.type === "error" || event.type === "turn.failed" ||
    event.type === "result" && (event.is_error === true || event.subtype === "error"));
  const hookObserved = kind !== "smoke" || events.some(provider === "codex" ? codexHookDenied : claudeHookDenied);
  const identifiers = {};
  for (const event of events) {
    if (!identifiers.sessionId && typeof (event.thread_id ?? event.session_id) === "string") identifiers.sessionId = event.thread_id ?? event.session_id;
    if (!identifiers.model && typeof event.model === "string") identifiers.model = event.model;
  }
  return { ok: lines.length > 0 && terminal.length === 1 && !failed, reason: failed ? "provider-error" :
    terminal.length !== 1 ? "terminal-event-missing-or-duplicate" : null,
  count: events.length, hookObserved, identifiers };
}

/** @param {{executables:Record<Provider,string>,controls:{files:{path:string,sha256:string}[],codexTrusted:boolean},runProcess?:(input:any)=>ProcessTask,now?:()=>Date,env?:NodeJS.ProcessEnv,home?:string}} options */
export function createCliAdapters(options) {
  const now = options.now ?? (() => new Date());
  const sourceEnv = options.env ?? process.env;
  const home = options.home ?? process.env.HOME ?? "";
  const runProcess = options.runProcess ?? ((/** @type {any} */ input) => spawnBounded(input));
  const executionEnvironment = () => ({
    ...sanitizedEnvironment(sourceEnv), ...(home ? { HOME: home } : {}),
  });

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
      env: executionEnvironment(), input: "", timeoutMs: 15_000 });
    const versionOutcome = await versionTask.promise;
    const version = (versionOutcome.stdout + versionOutcome.stderr).trim().slice(0, 120);
    if (versionOutcome.code !== 0 || !version) return { ok: false, reason: "cli-version-unconfirmed", spawnAllowed: false };
    const authArgs = provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"];
    const auth = runProcess({ executable, args: authArgs, cwd: home,
      env: executionEnvironment(), input: "", timeoutMs: 15_000 });
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

  /** @param {{provider:Provider,kind:RunKind,worktree:string,prompt:string,checked:any,timeoutMs?:number,onStart?:(pid:number)=>void|Promise<void>,onController?:(task:ProcessTask)=>void}} input */
  async function runAfterPreflight({ provider, kind, worktree, prompt, checked, timeoutMs = 120_000, onStart, onController }) {
    if (!checked.ok) return { state: "held", preflight: checked, process: null };
    const startedAt = now().toISOString();
    const invocation = command(provider, kind, worktree);
    const task = runProcess({ ...invocation, cwd: worktree, env: executionEnvironment(),
      input: prompt, timeoutMs, onStart });
    onController?.(task);
    const outcome = await task.promise;
    const raw = sanitize(outcome.stdout + outcome.stderr, home);
    const parsed = validateEvents(provider, outcome.stdout, kind);
    const state = outcome.stopUnconfirmed ? "stop_unconfirmed" : outcome.cancelled ? "cancelled" : outcome.timedOut ? "timed_out" :
      outcome.overflow ? "output_limit" : outcome.code !== 0 ? "failed" :
        !parsed.ok ? "invalid_events" : !parsed.hookObserved ? "hook_unobserved" : "succeeded";
    return { state, preflight: checked, process: { startedAt, finishedAt: now().toISOString(),
      exitCode: outcome.code, signal: outcome.signal, jsonEvents: parsed.count, hookObserved: parsed.hookObserved,
      eventValidation: parsed.reason, identifiers: parsed.identifiers, stopUnconfirmed: !!outcome.stopUnconfirmed,
      outputSha256: sha(raw), output: raw.slice(0, outputLimit), adapterId: definitions[provider].adapterId,
      provider, kind, promptSha256: sha(prompt), args: invocation.args.map((arg) => arg === worktree ? "<worktree>" : arg) } };
  }

  /** @param {{provider:Provider,kind:RunKind,worktree:string,prompt:string,confirmation:any,timeoutMs?:number,onStart?:(pid:number)=>void|Promise<void>,onController?:(task:ProcessTask)=>void}} input */
  async function run(input) {
    const checked = await preflight(input.provider, input.confirmation);
    return runAfterPreflight({ ...input, checked });
  }

  return { definitions, preflight, run, runAfterPreflight, command };
}

export { forbiddenEnv, childEnvAllowlist, outputLimit, confirmationTtlMs, stopGraceMs, forceSettleMs };
