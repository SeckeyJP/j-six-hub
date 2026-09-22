import type { ProgramData, ProgramMeta, ProjectMeta, TimelineItem } from "../types/program";
import { parseEvents } from "./events";

interface Manifest {
  program: ProgramMeta;
  projects: ProjectMeta[];
}

/** 案件ごとの events.jsonl を読み、全案件を時刻順の1本の時間軸にする（同時刻は案件の並び順、次に seq） */
export function buildProgram(manifest: Manifest, rawById: Record<string, string>): ProgramData {
  const projects = manifest.projects.map((meta) => {
    const raw = rawById[meta.id];
    if (raw === undefined) throw new Error(`案件 ${meta.id} のイベント（events.jsonl）が無い`);
    return { ...meta, events: parseEvents(raw) };
  });
  const order = new Map(projects.map((p, i) => [p.id, i]));
  const timeline: TimelineItem[] = projects
    .flatMap((p) => p.events.map((event) => ({ key: `${p.id}:${event.id}`, project: p.id, event })))
    .sort(
      (a, b) =>
        a.event.timestamp.localeCompare(b.event.timestamp) ||
        order.get(a.project)! - order.get(b.project)! ||
        a.event.seq - b.event.seq,
    );
  return { program: manifest.program, projects, timeline };
}
