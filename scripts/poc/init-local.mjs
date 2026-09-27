import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(".local-poc");
const repo = join(root, "synthetic-project");
await mkdir(root);
await mkdir(repo);
const env = { ...process.env, GIT_AUTHOR_NAME: "J-SIX Hub PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
  GIT_COMMITTER_NAME: "J-SIX Hub PoC", GIT_COMMITTER_EMAIL: "poc@localhost" };
/** @param {string[]} args */
function git(args) { return execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8" }).trim(); }
git(["init", "-q"]);
await writeFile(join(repo, "CLAUDE.md"), "# 合成案件の憲法\n\n公開・合成データだけを使用する。変更はGit commitに固定し、テスト結果を確認する。\n");
git(["add", "CLAUDE.md"]);
git(["commit", "-qm", "synthetic baseline constitution"]);
const config = { ledgerRoot: join(root, "ledger"), fixtures: { synthetic: { repo, repoId: "synthetic" } } };
await writeFile(join(root, "config.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
process.stdout.write(`合成Git案件: ${repo}\n基準commit: ${git(["rev-parse", "HEAD"])}\n設定: ${join(root, "config.json")}\n`);
