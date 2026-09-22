import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import { controlPointsOf, highlightKey } from "../replay/narrate";
import { firstHighlight, nextControl } from "./control-nav";

const points = controlPointsOf(program, processDef);
const positions = program.timeline
  .map((t, i) => (points.has(t.key) ? i + 1 : null))
  .filter((x): x is number => x !== null);

describe("nextControl", () => {
  it("現在位置より後で、最初に Hub が止めた場面の位置を返す", () => {
    expect(nextControl(program.timeline, points, 0)).toBe(positions[0]);
    expect(nextControl(program.timeline, points, positions[0]!)).toBe(positions[1]);
  });

  it("以降に無ければ null", () => {
    expect(nextControl(program.timeline, points, program.timeline.length)).toBeNull();
    expect(nextControl(program.timeline, points, positions.at(-1)!)).toBeNull();
  });
});

describe("firstHighlight", () => {
  it("見どころは、対応表がある状態に要件を追加した場面（最初の登録ではない）", () => {
    const n = firstHighlight(program.timeline, points, highlightKey(program, processDef))!;
    const item = program.timeline[n - 1]!;
    expect(points.get(item.key)).toContain("untraced_requirement");
    expect(item.event.type).toBe("requirements.updated");
    expect(item.event.payload?.added).toEqual(["REQ-011", "REQ-012"]);
    expect(n).toBeGreaterThan(40);
  });
});
