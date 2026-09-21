// J-SIX のプロセス定義を、版（タグ）を指定して取り込むための関数。
// 取得した内容は process.lock.json の SHA-256 と照合し、一致しなければ使わない（ADR-0002）。
import { createHash } from "node:crypto";
import { parse } from "yaml";

/** @param {{repository: string, tag: string, path: string}} lock */
export function rawUrl(lock) {
  return `https://raw.githubusercontent.com/${lock.repository}/${lock.tag}/${lock.path}`;
}

/**
 * @param {string} text
 * @param {{sha256: string, tag: string}} lock
 */
export function verifyContent(text, lock) {
  const actual = createHash("sha256").update(text, "utf8").digest("hex");
  if (actual !== lock.sha256) {
    throw new Error(
      `プロセス定義の SHA-256 が一致しない（${lock.tag}）: 期待 ${lock.sha256} / 実際 ${actual}。` +
        "版を上げる場合は process.lock.json のタグとハッシュを更新すること",
    );
  }
}

/** @param {string} text */
export function yamlToProcess(text) {
  // YAML 1.2 で読む。1.1 では `on:` などが真偽値になり、キーが壊れる
  const doc = parse(text, { version: "1.2" });
  if (doc?.schema_version !== 1) {
    throw new Error(`対応していない schema_version: ${doc?.schema_version}`);
  }
  return doc;
}
