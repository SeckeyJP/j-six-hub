import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import type { HubEvent } from "../types/events";
import { replay } from "./replay";

const project = (id: string) => program.projects.find((p) => p.id === id)!;
const indexOf = (id: string, pred: (e: HubEvent) => boolean) => project(id).events.findIndex(pred);
const at = (id: string, n: number) => replay(project(id).events, processDef, n);

describe("要求（REQ・PROP）", () => {
  it("登録前は空", () => {
    expect(at("approval-workflow", 0).requirements).toEqual({ items: [], properties: [], added: [], updatedBy: null });
  });

  it("requirements.updated でその時点の一覧と、直前に追加された ID を持つ", () => {
    const k = indexOf("approval-workflow", (e) => e.type === "requirements.updated");
    const s = at("approval-workflow", k + 1);
    expect(s.requirements.items.map((r) => r.id)).toEqual(
      ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010"].map((n) => `REQ-${n}`),
    );
    expect(s.requirements.added).toEqual(s.requirements.items.map((r) => r.id));
    expect(s.requirements.properties.length).toBeGreaterThan(0);
    expect(s.requirements.updatedBy).toBe(project("approval-workflow").events[k]!.id);
  });

  it("AC-011: Spec 改訂の直後は REQ-011・REQ-012 が追加として残る", () => {
    const events = project("approval-workflow").events;
    const k = events.findIndex((e) => e.type === "requirements.updated" && (e.payload?.added as string[])?.includes("REQ-011"));
    const s = at("approval-workflow", k + 1);
    expect(s.requirements.added).toEqual(["REQ-011", "REQ-012"]);
    expect(s.requirements.items).toHaveLength(12);
  });
});

describe("トレーサビリティ", () => {
  it("traceability.updated で対応表を持ち、テストの無い要件を数える", () => {
    const events = project("approval-workflow").events;
    const k = events.findIndex((e) => e.type === "traceability.updated");
    const s = at("approval-workflow", k + 1);
    expect(s.traceability.entries).toHaveLength(10);
    expect(s.traceability.untraced).toEqual([]);
  });

  it("AC-012: Spec 改訂の直後は REQ-011・REQ-012 がテストなし、TASK-AW-002 の後に解消する", () => {
    const events = project("approval-workflow").events;
    const specK = events.findIndex((e) => e.type === "requirements.updated" && (e.payload?.added as string[])?.includes("REQ-011"));
    const mid = at("approval-workflow", specK + 1);
    expect(mid.traceability.untraced).toEqual(["REQ-011", "REQ-012"]);
    const end = at("approval-workflow", events.length);
    expect(end.traceability.untraced).toEqual([]);
    expect(end.traceability.entries).toHaveLength(12);
  });

  it("架空の案件でも、テストの無い要件を示す", () => {
    const events = project("order-integration").events;
    const k = events.findIndex((e) => e.type === "traceability.updated");
    expect(at("order-integration", k + 1).traceability.untraced).toEqual(["REQ-004"]);
    expect(at("order-integration", events.length).traceability.untraced).toEqual([]);
  });
});
