// Program（複数案件のまとまり）と案件（data/projects.json、ADR-0003）
import type { HubEvent } from "./events";

export interface ProgramMeta {
  name: string;
  fictional: boolean;
  note: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  summary: string;
  team: string;
  fictional: boolean;
}

export interface ProjectData extends ProjectMeta {
  events: HubEvent[];
}

/** 全案件を1本にした時間軸の1項目 */
export interface TimelineItem {
  key: string;
  project: string;
  event: HubEvent;
}

export interface ProgramData {
  program: ProgramMeta;
  projects: ProjectData[];
  timeline: TimelineItem[];
}
