import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const root = resolve(".local-poc");
const nameIndex = process.argv.indexOf("--name");
const name = nameIndex >= 0 ? process.argv[nameIndex + 1] : "synthetic-project";
if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) throw new Error("--name が不正です");
const repo = join(root, name);
await mkdir(root, { recursive: true });
await mkdir(repo);
const env = { ...process.env, GIT_AUTHOR_NAME: "J-SIX Hub PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
  GIT_COMMITTER_NAME: "J-SIX Hub PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
/** @param {string[]} args */
function git(args) { return execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8" }).trim(); }
git(["init", "-q"]);
await mkdir(join(repo, "src"));
const documents = {
  "constitution.md": "# 合成案件の憲法\n公開・合成データだけを使用する。変更はGit commitに固定し、テスト結果を確認する。\n",
  "requirement.md": "REQ-001: bounded approval\nAC-001: approved amounts stay within limits\nPROP-001: finite nonnegative amounts only\n受入条件: valid amount only\n非機能: local synthetic test\n未確定: なし\n",
  "flow.md": "# Synthetic approval flow\n",
  "design.md": "検証戦略: unit, hold-out, integration\n設計書目次: interface and operation\n",
  "adr.md": "# Synthetic design decision\n",
  "prototype.md": "# Synthetic working prototype\n",
  "properties.md": "# Synthetic properties\n",
  "tasks.md": "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: observable approval\nPROP-001: finite values\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
  "task.md": "TASK-001: bounded approval\nREQ-001: bounded approval\nAC-001: observable approval\nPROP-001: finite values\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: build,typecheck,lint,format,sast,secrets,deps,scope,interface_contract,tests,coverage,mutation,test_tamper,holdout,traceability\n",
  "src/approval.mjs": "export function approve(amount, limit) { return false; }\n",
  "src/approval-route.mjs": "import { approve } from \"./approval.mjs\";\nexport function handleApproval(request) {\n  const { amount, limit } = request ?? {};\n  if (!Number.isFinite(amount) || !Number.isFinite(limit)) {\n    return { status: 400, body: { approved: false, error: \"invalid request\" } };\n  }\n  return { status: 200, body: { approved: approve(amount, limit) } };\n}\n",
};
for (const [path, body] of Object.entries(documents)) await writeFile(join(repo, path), body);
git(["add", "."]);
git(["commit", "-qm", "synthetic baseline documents and task"]);
const config = /** @type {any} */ ({ ledgerRoot: join(root, name === "synthetic-project" ? "ledger" : `ledger-${name}`),
  fixtures: { synthetic: { repo, repoId: "synthetic" } } });
if (process.argv.includes("--enable-cli")) {
  const home = homedir();
  const files = [join(home, ".claude/settings.json"), join(home, ".codex/hooks.json"),
    join(home, ".codex/config.toml"), join(home, ".claude/scripts/deny_check.py")];
  const bodies = await Promise.all(files.map((path) => readFile(path)));
  config.cli = { executables: { codex: join(home, ".local/bin/codex"),
    claude: join(home, ".npm-global/bin/claude") }, controls: { files: files.map((path, index) => ({
    path, sha256: createHash("sha256").update(bodies[index] ?? Buffer.alloc(0)).digest("hex") })),
  codexTrusted: /^\[hooks\.state\]$/m.test((bodies[2] ?? Buffer.alloc(0)).toString("utf8")) &&
    (bodies[2] ?? Buffer.alloc(0)).includes(".codex/hooks.json") },
  retention: { privateRunLogsDays: 7, deleteOnProjectRemoval: true,
    missingEvidenceState: "unknown" } };
}
const configPath = join(root, name === "synthetic-project" ? "config.json" : `config-${name}.json`);
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
process.stdout.write(`合成Git案件: ${repo}\n基準commit: ${git(["rev-parse", "HEAD"])}\n設定: ${configPath}\n`);
