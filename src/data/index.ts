// 同梱するデータ。イベントは data/events.jsonl、プロセス定義はビルド時に取得した固定版。
import eventsText from "../../data/events.jsonl?raw";
import processJson from "../../.cache/process.json";
import type { ProcessDefinition } from "../types/process";
import { parseEvents } from "./events";

export const events = parseEvents(eventsText);
export const processDef = processJson as unknown as ProcessDefinition;
