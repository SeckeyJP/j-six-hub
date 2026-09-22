// 品質検査が停止した場面への移動（REQ-025）
import type { ControlKind } from "../replay/narrate";
import type { TimelineItem } from "../types/program";

/** 現在位置 n より後で、最初に統制が働いた位置（1 始まり）。無ければ null */
export function nextControl(timeline: TimelineItem[], points: Map<string, ControlKind[]>, n: number): number | null {
  for (let i = n; i < timeline.length; i += 1) {
    if (points.has(timeline[i]!.key)) return i + 1;
  }
  return null;
}

/** 見どころ（narrate.highlightKey）の再生位置。無ければ最初の統制ポイント */
export function firstHighlight(timeline: TimelineItem[], points: Map<string, ControlKind[]>, key: string | null): number | null {
  if (key) {
    const i = timeline.findIndex((t) => t.key === key);
    if (i >= 0) return i + 1;
  }
  return nextControl(timeline, points, 0);
}
