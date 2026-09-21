// 同梱するデータ。案件の一覧は data/projects.json、イベントは data/projects/<案件ID>/events.jsonl、
// プロセス定義はビルド時に取得した固定版（ADR-0002, ADR-0003）。
import manifest from "../../data/projects.json";
import processJson from "../../.cache/process.json";
import type { ProcessDefinition } from "../types/process";
import { buildProgram } from "./program";

const files = import.meta.glob<string>("../../data/projects/*/events.jsonl", {
  query: "?raw",
  import: "default",
  eager: true,
});
const rawById = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => [path.split("/").at(-2) as string, raw]),
);

export const program = buildProgram(manifest, rawById);
export const processDef = processJson as unknown as ProcessDefinition;
