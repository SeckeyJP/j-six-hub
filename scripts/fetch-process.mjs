// ビルド・テストの前に、固定した版のプロセス定義を取得して .cache/process.json に置く。
// キャッシュがあり、元の YAML のハッシュが一致すれば取得しない。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rawUrl, verifyContent, yamlToProcess } from "./process-lock.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(join(root, "process.lock.json"), "utf8"));
const cacheDir = join(root, ".cache");
const yamlPath = join(cacheDir, "jsix-process.yaml");

async function cachedText() {
  try {
    const text = await readFile(yamlPath, "utf8");
    verifyContent(text, lock);
    return text;
  } catch {
    return null;
  }
}

let text = await cachedText();
if (text === null) {
  const res = await fetch(rawUrl(lock));
  if (!res.ok) throw new Error(`プロセス定義を取得できない: ${res.status} ${rawUrl(lock)}`);
  text = await res.text();
  verifyContent(text, lock);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(yamlPath, text, "utf8");
}

const doc = yamlToProcess(text);
const meta = { repository: lock.repository, tag: lock.tag, sha256: lock.sha256, license: lock.license };
await writeFile(join(cacheDir, "process.json"), JSON.stringify({ ...doc, _source: meta }), "utf8");
console.log(`プロセス定義 ${lock.tag}（${lock.sha256.slice(0, 12)}）を .cache/process.json に用意した`);
