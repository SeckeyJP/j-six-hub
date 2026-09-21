import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import { replay } from "./replay";
import { replayProgram } from "./program";

describe("replayProgram", () => {
  it("n までに含まれる各案件のイベントで、案件ごとの状態を計算する", () => {
    const n = 100;
    const s = replayProgram(program, processDef, n);
    expect(s.n).toBe(n);
    expect(s.current).toEqual(program.timeline[n - 1]);
    for (const p of program.projects) {
      const k = program.timeline.slice(0, n).filter((t) => t.project === p.id).length;
      expect(s.projects[p.id]).toEqual(replay(p.events, processDef, k));
    }
  });

  it("n=0 では current が無い", () => {
    expect(replayProgram(program, processDef, 0).current).toBeNull();
  });
});
