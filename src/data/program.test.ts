import { describe, expect, it } from "vitest";
import { buildProgram } from "./program";
import { program } from "./index";

const line = (seq: number, ts: string) =>
  JSON.stringify({ seq, id: `ev-${String(seq).padStart(4, "0")}`, timestamp: ts, type: "commit.created",
    actor: { kind: "human" }, summary: "s", provenance: "measured", source: { kind: "git" } });

const manifest = {
  program: { name: "P", fictional: true, note: "n" },
  projects: [
    { id: "a", name: "A", summary: "", team: "", fictional: false },
    { id: "b", name: "B", summary: "", team: "", fictional: true },
  ],
};

describe("buildProgram", () => {
  it("全案件のイベントを時刻順の1本の時間軸にする（同時刻は案件の並び順）", () => {
    const p = buildProgram(manifest, {
      a: `${line(1, "2026-09-20T01:00:00Z")}\n${line(2, "2026-09-20T03:00:00Z")}\n`,
      b: `${line(1, "2026-09-20T02:00:00Z")}\n${line(2, "2026-09-20T03:00:00Z")}\n`,
    });
    expect(p.timeline.map((t) => t.key)).toEqual(["a:ev-0001", "b:ev-0001", "a:ev-0002", "b:ev-0002"]);
    expect(p.projects.map((x) => x.events.length)).toEqual([2, 2]);
  });

  it("イベントの無い案件は失敗する", () => {
    expect(() => buildProgram(manifest, { a: line(1, "2026-09-20T01:00:00Z") })).toThrow(/b/);
  });
});

describe("同梱データ", () => {
  it("3件の案件を読み、架空は受発注連携だけ", () => {
    expect(program.projects.map((p) => p.id)).toEqual(["approval-workflow", "monthly-billing", "order-integration"]);
    expect(program.projects.filter((p) => p.fictional).map((p) => p.id)).toEqual(["order-integration"]);
    expect(program.timeline.length).toBe(program.projects.reduce((a, p) => a + p.events.length, 0));
  });
});
