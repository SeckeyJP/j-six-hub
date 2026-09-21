import { describe, expect, it } from "vitest";
import { parseEvents } from "./events";
import { events, processDef } from "./index";

const line = (seq: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    seq,
    id: `ev-${String(seq).padStart(4, "0")}`,
    timestamp: "2026-09-19T04:00:00Z",
    type: "commit.created",
    actor: { kind: "human" },
    summary: "s",
    provenance: "measured",
    source: { kind: "git", ref: "abc1234" },
    ...extra,
  });

describe("parseEvents", () => {
  it("1行1イベントとして読み、空行は無視する", () => {
    const evs = parseEvents(`${line(1)}\n\n${line(2)}\n`);
    expect(evs.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("不正な JSON の行は行番号付きで失敗する", () => {
    expect(() => parseEvents(`${line(1)}\n{broken\n`)).toThrow(/2 行目/);
  });

  it("seq が 1 からの連番でなければ失敗する", () => {
    expect(() => parseEvents(`${line(1)}\n${line(3)}\n`)).toThrow(/seq/);
  });

  it("provenance が measured / reconstructed 以外なら失敗する", () => {
    expect(() => parseEvents(line(1, { provenance: "guess" }))).toThrow(/provenance/);
  });

  it("再構成イベントに basis が無ければ失敗する", () => {
    expect(() => parseEvents(line(1, { provenance: "reconstructed", source: { kind: "reconstruction" } }))).toThrow(
      /basis/,
    );
  });
});

describe("同梱データ", () => {
  it("リポジトリの events.jsonl を読める", () => {
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.seq).toBe(1);
  });

  it("固定した版のプロセス定義を読める", () => {
    expect(processDef.schema_version).toBe(1);
    expect(processDef.phases.map((p) => p.id)).toEqual(["P0", "P1", "P2", "P3", "P4", "P5", "P6"]);
  });
});
