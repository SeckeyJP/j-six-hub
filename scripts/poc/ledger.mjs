import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const ref = "refs/heads/poc-ledger";
const zeroSha = "0".repeat(40);
/** @param {string} value */
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** @param {string} root @param {string[]} args @param {string=} input */
function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "J-SIX Hub PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "J-SIX Hub PoC", GIT_COMMITTER_EMAIL: "poc@localhost" },
  }).trim();
}

/** @param {string} root */
export async function initializeLedger(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await stat(join(root, ".git"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "ENOENT") throw error;
    git(root, ["init", "-q"]);
  }
  if (git(root, ["remote"])) throw new Error("非公開台帳にremoteがあるため保留します");
}

/** @param {unknown} value @param {boolean=} allowSystem */
function assertRecord(value, allowSystem = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("recordが不正です");
  const record = /** @type {Record<string, any>} */ (value);
  if (record.schemaVersion !== 1) throw new Error("未知のrecord schemaです");
  for (const field of ["recordId", "projectId", "kind", "recordedAt"]) {
    if (typeof record[field] !== "string" || !record[field]) throw new Error(`record ${field}が不正です`);
  }
  if (!record.payload || typeof record.payload !== "object") throw new Error("record payloadが不正です");
  if (!allowSystem && ["previousCommit", "previousRecordHash", "recordHash"].some((key) => key in record)) {
    throw new Error("record連鎖のsystem fieldは入力できません");
  }
  for (const key of ["processSha256", "policySha256", "sha256"]) {
    const hash = record.payload[key];
    if (hash !== undefined && !/^[0-9a-f]{64}$/.test(hash)) throw new Error(`record ${key} SHA/hashが不正です`);
  }
  if (record.kind === "project.created" &&
      (!record.payload.processSha256 || !record.payload.policySha256 ||
        !/^[0-9a-f]{40,64}$/.test(record.payload.processCommit) ||
        !/^[0-9a-f]{40,64}$/.test(record.payload.targetCommit) ||
        typeof record.payload.targetRepoId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(record.payload.targetRepoId) ||
        typeof record.payload.fixtureId !== "string" || !record.payload.fixtureId.trim())) {
    throw new Error("作成recordの対象repo・基準commit・process版・合成題材が不足しています");
  }
  return record;
}

/** @param {string} root */
function headOf(root) {
  const lines = git(root, ["for-each-ref", "--format=%(refname) %(objectname)", ref]).split("\n");
  const exact = lines.find((line) => line.startsWith(`${ref} `));
  return exact ? exact.slice(ref.length + 1) : null;
}

/** @param {string} root */
export async function readLedger(root) {
  const head = headOf(root);
  if (!head) return { head: null, records: [] };
  const commits = git(root, ["rev-list", "--reverse", head]).split("\n");
  /** @type {Record<string, any>[]} */
  const records = [];
  const ids = new Set();
  let previousCommit = null;
  let previousRecordHash = null;
  for (const commit of commits) {
    const parents = git(root, ["rev-list", "--parents", "-n", "1", commit]).split(" ");
    if (parents.length > 2 || (parents[1] ?? null) !== previousCommit) throw new Error("台帳のGit親commitが不正です");
    const record = assertRecord(JSON.parse(git(root, ["show", `${commit}:record.json`])), true);
    if (record.previousCommit !== previousCommit || record.previousRecordHash !== previousRecordHash) {
      throw new Error("台帳の前record連鎖が不正です");
    }
    const { recordHash, ...body } = record;
    if (recordHash !== sha256(JSON.stringify(body))) throw new Error("台帳record hashが不正です");
    if (ids.has(record.recordId)) throw new Error("台帳record IDが重複しています");
    ids.add(record.recordId);
    records.push(record);
    previousCommit = commit;
    previousRecordHash = recordHash;
  }
  if (headOf(root) !== head) throw new Error("台帳refが再読込中に変化しました");
  return { head, records };
}

/** @param {string} root @param {string|null} expectedHead @param {unknown} input */
export async function appendRecord(root, expectedHead, input) {
  const lockPath = join(root, ".git", "poc-operation.lock");
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === "EEXIST") {
      throw new Error("操作lockが残っています。外部状態を照合して手動復旧してください", { cause: error });
    }
    throw error;
  }
  let releaseLock = true;
  try {
    const state = await readLedger(root);
    if (state.head !== expectedHead) throw new Error("期待old SHAと台帳refが異なります（stale）");
    const record = assertRecord(input);
    if (state.records.some((item) => item.recordId === record.recordId)) throw new Error("record IDが重複しています");
    const body = { ...record, previousCommit: state.head,
      previousRecordHash: state.records.at(-1)?.recordHash ?? null };
    const finalRecord = { ...body, recordHash: sha256(JSON.stringify(body)) };
    const blob = git(root, ["hash-object", "-w", "--stdin"], JSON.stringify(finalRecord) + "\n");
    const tree = git(root, ["mktree"], `100644 blob ${blob}\trecord.json\n`);
    const parents = state.head ? ["-p", state.head] : [];
    const commit = git(root, ["commit-tree", tree, ...parents], `record ${record.recordId}\n`);
    try { git(root, ["update-ref", ref, commit, state.head ?? zeroSha]); }
    catch (error) { releaseLock = false; throw new Error("ref更新結果が不明です。lockを維持して照合してください", { cause: error }); }
    let verified;
    try { verified = await readLedger(root); }
    catch (error) { releaseLock = false; throw error; }
    if (verified.head !== commit || verified.records.at(-1)?.recordHash !== finalRecord.recordHash) {
      releaseLock = false;
      throw new Error("更新後の再読込が一致しません。lockを維持して照合してください");
    }
    return verified;
  } finally {
    await handle.close();
    if (releaseLock) await unlink(lockPath);
  }
}
