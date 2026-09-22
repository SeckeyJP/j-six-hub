// 統制ポイント（Hub が止めた場面）への移動（REQ-025）
import type { ControlKind } from "../replay/narrate";
import type { TimelineItem } from "../types/program";

/** 現在位置 n より後で、最初に統制が働いた位置（1 始まり）。無ければ null */
export function nextControl(timeline: TimelineItem[], points: Map<string, ControlKind[]>, n: number): number | null {
  for (let i = n; i < timeline.length; i += 1) {
    if (points.has(timeline[i]!.key)) return i + 1;
  }
  return null;
}

/** ガイドで案内する「見どころ」。テストの無い要件が生じた最初の場面 */
export function firstHighlight(timeline: TimelineItem[], points: Map<string, ControlKind[]>): number | null {
  for (let i = 0; i < timeline.length; i += 1) {
    if (points.get(timeline[i]!.key)?.includes("untraced_requirement")) return i + 1;
  }
  return nextControl(timeline, points, 0);
}
