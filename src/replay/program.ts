// 全案件の時間軸で、再生位置 n までに含まれるイベントから案件ごとの状態を計算する（design-spec §6.1）
import type { ProgramData, TimelineItem } from "../types/program";
import type { ProcessDefinition } from "../types/process";
import { replay } from "./replay";
import type { HubState } from "./state";

export interface ProgramState {
  n: number;
  total: number;
  current: TimelineItem | null;
  projects: Record<string, HubState>;
}

export function replayProgram(data: ProgramData, process: ProcessDefinition, n: number): ProgramState {
  const count = Math.max(0, Math.min(n, data.timeline.length));
  const seen = new Map<string, number>();
  for (const item of data.timeline.slice(0, count)) seen.set(item.project, (seen.get(item.project) ?? 0) + 1);
  const projects: Record<string, HubState> = {};
  for (const p of data.projects) projects[p.id] = replay(p.events, process, seen.get(p.id) ?? 0);
  return { n: count, total: data.timeline.length, current: data.timeline[count - 1] ?? null, projects };
}
