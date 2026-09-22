import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import type { HubEvent } from "../types/events";
import { controlKinds, controlPointsOf, narrate } from "./narrate";
import { replay } from "./replay";

const byId = (id: string) => program.projects.find((p) => p.id === id)!;

function at(projectId: string, pred: (e: HubEvent) => boolean) {
  const events = byId(projectId).events;
  const k = events.findIndex(pred);
  expect(k).toBeGreaterThanOrEqual(0);
  const ev = events[k]!;
  return { ev, before: replay(events, processDef, k), after: replay(events, processDef, k + 1) };
}

describe("controlKinds（統制ポイント）", () => {
  it("ゲートの停止・未達", () => {
    const { ev, before, after } = at("monthly-billing", (e) => e.type === "gate.evaluated" && e.payload?.outcome === "failed");
    expect(controlKinds(ev, before, after)).toContain("gate_stopped");
  });

  it("無効な承認", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "gate.approved" && e.actor.kind === "ai");
    expect(controlKinds(ev, before, after)).toContain("invalid_approval");
  });

  it("逸脱の開始", () => {
    const { ev, before, after } = at("order-integration", (e) => e.type === "deviation.opened" && e.payload?.deviation === "interface_contract_violation");
    expect(controlKinds(ev, before, after)).toContain("deviation");
  });

  it("順序違反の発生", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "ai.session.started" && e.payload?.skill === "doc-reverse-gen");
    expect(controlKinds(ev, before, after)).toContain("violation");
  });

  it("通常の作業は統制ポイントではない", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "commit.created");
    expect(controlKinds(ev, before, after)).toEqual([]);
  });

  it("AC-010: 全案件の統制ポイントを一度に求める", () => {
    const points = controlPointsOf(program, processDef);
    const keys = [...points.keys()];
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      const item = program.timeline.find((t) => t.key === key)!;
      expect(["gate.evaluated", "gate.approved", "deviation.opened", "ai.session.started", "commit.created", "task.dispatched", "ai.agent.started", "hook.blocked"]).toContain(item.event.type);
    }
  });
});

describe("narrate（いま起きたこと）", () => {
  it("AC-009: G1 スコープ検査での停止を説明し、Hub の統制を述べる", () => {
    const { ev, before, after } = at("monthly-billing", (e) => e.type === "gate.evaluated" && JSON.stringify(e.payload).includes("scope"));
    const n = narrate(ev, before, after, processDef);
    expect(n.headline).toMatch(/品質ゲート.*止め/);
    expect(n.detail.join("")).toMatch(/許可範囲外/);
    expect(n.control).toMatch(/Hub/);
  });

  it("AI が書き込んだ承認は、承認として扱わないことを説明する", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "gate.approved" && e.actor.kind === "ai");
    const n = narrate(ev, before, after, processDef);
    expect(n.headline).toMatch(/AI/);
    expect(n.control).toMatch(/人間/);
  });

  it("有効な承認では、どの Phase が承認済みになったかを述べる", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "gate.approved" && e.actor.kind === "human");
    const n = narrate(ev, before, after, processDef);
    const gate = processDef.gates.find((g) => g.id === ev.payload?.gate)!;
    expect(n.headline).toContain(gate.name);
    expect(n.control).toBeNull();
  });

  it("Phase 逆戻りでは、戻り先以降を承認し直すことを述べる", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "deviation.opened" && e.payload?.deviation === "phase_rollback");
    const n = narrate(ev, before, after, processDef);
    expect(n.headline).toMatch(/P1/);
    expect(n.control).toMatch(/承認/);
  });

  it("サブエージェントの工程を平易に説明する", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "ai.agent.started" && e.payload?.step === "red");
    const n = narrate(ev, before, after, processDef);
    expect(n.detail.join("")).toMatch(/失敗するテスト/);
  });

  it("順序違反が起きたら、Hub の指摘として述べる", () => {
    const { ev, before, after } = at("approval-workflow", (e) => e.type === "ai.session.started" && e.payload?.skill === "doc-reverse-gen");
    const n = narrate(ev, before, after, processDef);
    expect(n.control).toMatch(/順序違反/);
  });

  it("タスクの割り当てでは担当のチームを述べる", () => {
    const { ev, before, after } = at("order-integration", (e) => e.type === "task.dispatched");
    const n = narrate(ev, before, after, processDef);
    expect(n.headline).toMatch(/ベンダー/);
  });
});
