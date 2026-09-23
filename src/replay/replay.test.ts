import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { processDef, program } from "../data";
import type { HubEvent } from "../types/events";
import { replay } from "./replay";

const realEvents = program.projects.find((p) => p.id === "approval-workflow")!.events;

// --- 合成イベントの組み立て ---------------------------------------------------

let seq = 0;
function ev(partial: Partial<HubEvent> & Pick<HubEvent, "type">): HubEvent {
  seq += 1;
  return {
    seq,
    id: `ev-${String(seq).padStart(4, "0")}`,
    timestamp: `2026-09-19T04:${String(seq).padStart(2, "0")}:00Z`,
    iteration: "it",
    phase: null,
    task: null,
    actor: { kind: "system", role: "automation" },
    summary: "s",
    provenance: "measured",
    source: { kind: "git", ref: "x" },
    ...partial,
  };
}

function run(list: HubEvent[], n = list.length) {
  return replay(list, processDef, n);
}

const phase = (state: ReturnType<typeof replay>, id: string) => state.phases.find((p) => p.id === id)!;

const approve = (gate: string, actor: HubEvent["actor"] = { kind: "human", role: "gatekeeper" }) =>
  ev({ type: "gate.approved", actor, payload: { gate } });

// --- 初期状態と件数 -----------------------------------------------------------

describe("初期状態", () => {
  it("n=0 ではすべての Phase が未着手で、件数は 0", () => {
    const s = run([ev({ type: "project.registered", phase: "P0" })], 0);
    expect(s.n).toBe(0);
    expect(s.current).toBeNull();
    expect(s.phases.map((p) => p.status)).toEqual(Array(7).fill("not_started"));
    expect(s.counts).toEqual({ measured: 0, reconstructed: 0 });
  });

  it("Phase はプロセス定義の順と名前で並ぶ", () => {
    const s = run([], 0);
    expect(s.phases.map((p) => [p.id, p.name, p.gateName])).toEqual(
      processDef.phases.map((p) => [p.id, p.name, processDef.gates.find((g) => g.id === p.gate)?.name ?? null]),
    );
  });

  it("n はイベント数の範囲に収める", () => {
    const list = [ev({ type: "project.registered", phase: "P0" })];
    expect(run(list, 5).n).toBe(1);
    expect(run(list, -1).n).toBe(0);
  });

  it("実測・再構成の件数を数える", () => {
    const list = [
      ev({ type: "project.registered", phase: "P0", provenance: "reconstructed", basis: "b", source: { kind: "reconstruction" } }),
      ev({ type: "commit.created", phase: "P1" }),
    ];
    expect(run(list).counts).toEqual({ measured: 1, reconstructed: 1 });
  });
});

// --- 案件と版 -----------------------------------------------------------------

describe("案件の登録と版の固定", () => {
  it("登録で案件を作り、P0（継続）を進行中にする", () => {
    const s = run([ev({ type: "project.registered", phase: "P0", payload: { project: "demo" } })]);
    expect(s.project?.name).toBe("demo");
    expect(phase(s, "P0").status).toBe("in_progress");
  });

  it("プロセス定義と憲法の版を記録する", () => {
    const s = run([
      ev({ type: "project.registered", phase: "P0", payload: { project: "demo" } }),
      ev({ type: "process.pinned", phase: "P0", payload: { version: "process-v0.1.0" } }),
      ev({ type: "constitution.pinned", phase: "P0", payload: { commit: "abc", path: "CLAUDE.md" } }),
    ]);
    expect(s.project?.processVersion).toBe("process-v0.1.0");
    expect(s.project?.constitution).toBe("abc:CLAUDE.md");
  });
});

// --- Phase の状態と順序違反 ---------------------------------------------------

describe("Phase の状態", () => {
  it("作業のイベントで未着手の Phase を進行中にする", () => {
    const s = run([ev({ type: "commit.created", phase: "P1" })]);
    expect(phase(s, "P1").status).toBe("in_progress");
  });

  it("有効な承認で承認済みにし、承認したイベントを記録する", () => {
    const list = [ev({ type: "commit.created", phase: "P1" }), approve("customer_approval", { kind: "human", role: "customer" })];
    const s = run(list);
    expect(phase(s, "P1").status).toBe("approved");
    expect(phase(s, "P1").approvedBy).toBe(list[1]!.id);
  });

  it("承認済みの Phase で作業があっても承認済みのまま", () => {
    const s = run([
      ev({ type: "commit.created", phase: "P1" }),
      approve("customer_approval", { kind: "human", role: "customer" }),
      ev({ type: "commit.created", phase: "P1" }),
    ]);
    expect(phase(s, "P1").status).toBe("approved");
  });

  it("前の Phase が承認済みでないのに後の Phase で作業すると順序違反を記録する", () => {
    const list = [ev({ type: "commit.created", phase: "P1" }), ev({ type: "commit.created", phase: "P3" })];
    const s = run(list);
    expect(s.violations).toEqual([{ eventId: list[1]!.id, phase: "P3", missing: ["P1", "P2"] }]);
  });

  it("P0 は順序違反の判定に含めない", () => {
    const s = run([ev({ type: "commit.created", phase: "P1" })]);
    expect(s.violations).toEqual([]);
  });
});

// --- 承認 ---------------------------------------------------------------------

describe("承認の有効性", () => {
  it("AI が書き込んだ承認は無効で、Phase を承認済みにしない", () => {
    const s = run([ev({ type: "commit.created", phase: "P1" }), approve("customer_approval", { kind: "ai", role: "ai_agent" })]);
    expect(phase(s, "P1").status).toBe("in_progress");
    expect(s.approvals[0]).toMatchObject({ gate: "customer_approval", phase: "P1", valid: false });
    expect(s.approvals[0]!.reason).toMatch(/人間/);
  });

  it("人間でも承認者の役割に含まれなければ無効", () => {
    const s = run([approve("customer_approval", { kind: "human", role: "architect" })]);
    expect(s.approvals[0]).toMatchObject({ valid: false });
    expect(s.approvals[0]!.reason).toMatch(/承認者の役割/);
  });

  it("役割が記録されていない人間の承認は有効（役割未記録として示す）", () => {
    const s = run([approve("customer_approval", { kind: "human" })]);
    expect(s.approvals[0]).toMatchObject({ valid: true, roleRecorded: false });
    expect(phase(s, "P1").status).toBe("approved");
  });
});

// --- 逸脱 ---------------------------------------------------------------------

describe("逸脱", () => {
  it("Phase 逆戻りでは戻り先を作業中にし、既承認の後続工程は再承認待ちとして残す", () => {
    const list = [
      ev({ type: "project.registered", phase: "P0" }),
      approve("customer_approval", { kind: "human", role: "customer" }),
      approve("design_review"),
      ev({ type: "deviation.opened", phase: "P2", payload: { deviation: "phase_rollback", to_phase: "P1" } }),
    ];
    const s = run(list);
    expect(phase(s, "P0").status).toBe("in_progress");
    expect(phase(s, "P1")).toMatchObject({ status: "in_progress", reopened: true, needsReapproval: true, approvedBy: list[1]!.id });
    expect(phase(s, "P2")).toMatchObject({ status: "approved", reopened: true, needsReapproval: true, approvedBy: list[2]!.id });
    expect(["P3", "P4", "P5", "P6"].map((id) => [phase(s, id).status, phase(s, id).reopened, phase(s, id).needsReapproval])).toEqual(
      Array(4).fill(["not_started", false, false]),
    );
    expect(phase(s, "P1").approvedBy).toBe(list[1]!.id);
  });

  it("再承認待ちの前工程を通らずに後続工程を始めると順序違反にする", () => {
    const list = [
      approve("customer_approval", { kind: "human", role: "customer" }),
      approve("design_review"),
      ev({ type: "deviation.opened", phase: "P2", payload: { deviation: "phase_rollback", to_phase: "P1" } }),
      ev({ type: "commit.created", phase: "P3" }),
    ];
    expect(run(list).violations.at(-1)).toMatchObject({ phase: "P3", missing: ["P1", "P2"] });
  });

  it("開始参照のない終了は、候補が複数なら閉じない", () => {
    const list = [
      ev({ type: "deviation.opened", payload: { deviation: "escalation" } }),
      ev({ type: "deviation.opened", payload: { deviation: "escalation" } }),
      ev({ type: "deviation.closed", payload: { deviation: "escalation" } }),
    ];
    const s = run(list);
    expect(s.deviations.map((d) => [d.openedBy, d.closedBy])).toEqual([
      [list[0]!.id, null],
      [list[1]!.id, null],
    ]);
  });

  it("逸脱の名前をプロセス定義から引く", () => {
    const s = run([ev({ type: "deviation.opened", payload: { deviation: "phase_rollback", to_phase: "P1" } })]);
    expect(s.deviations[0]!.name).toBe(processDef.deviations.find((d) => d.id === "phase_rollback")!.name);
  });
});

// --- タスク -------------------------------------------------------------------

describe("タスク", () => {
  const T = "TASK-AW-002";

  it("投入で待機、セッション開始で実行中、サブエージェントで工程、G3 で判定中", () => {
    const list = [
      ev({ type: "task.dispatched", phase: "P4", task: T }),
      ev({ type: "ai.session.started", phase: "P4", task: T }),
      ev({ type: "ai.agent.started", phase: "P4", task: T, payload: { agent: "red-agent", step: "red" } }),
    ];
    expect(run(list, 1).tasks[0]).toMatchObject({ id: T, status: "waiting" });
    expect(run(list, 2).tasks[0]).toMatchObject({ status: "running" });
    expect(run(list, 3).tasks[0]).toMatchObject({ status: "running", step: "red" });
    const judged = run([...list, ev({ type: "ai.agent.started", phase: "P4", task: T, payload: { agent: "scope-judge", step: "G3" } })]);
    expect(judged.tasks[0]).toMatchObject({ status: "gate_checking", step: "G3" });
    expect(judged.tasks[0]!.agents.map((a) => a.agent)).toEqual(["red-agent", "scope-judge"]);
  });

  it("ゲートの判定でタスクを合格・不合格にする", () => {
    const blocked = ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "blocked", results: [] } });
    const passed = ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "passed", results: [] } });
    const list = [ev({ type: "task.dispatched", phase: "P4", task: T }), blocked, passed];
    expect(run(list, 2).tasks[0]!.status).toBe("failed");
    expect(run(list, 3).tasks[0]!.status).toBe("passed");
  });

  it("全タスクが合格したら per_task の P4 を承認済み（完了）にする", () => {
    const s = run([
      ev({ type: "task.dispatched", phase: "P4", task: T }),
      ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "passed", results: [] } }),
    ]);
    expect(phase(s, "P4").status).toBe("approved");
  });

  it("承認済みの P4 で同じタスクを再実行すると、合格を再評価するまで完了にしない", () => {
    const list = [
      ev({ type: "task.dispatched", phase: "P4", task: T }),
      ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "passed", results: [] } }),
      ev({ type: "ai.session.started", phase: "P4", task: T }),
    ];
    expect(phase(run(list), "P4").status).toBe("in_progress");
    const rerunPassed = [...list, ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "passed", results: [] } })];
    expect(phase(run(rerunPassed), "P4").status).toBe("approved");
  });

  it("承認済みの P4 に追加したタスクが失敗したら未完了に戻り、合格後に完了する", () => {
    const list = [
      ev({ type: "task.dispatched", phase: "P4", task: T }),
      ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "passed", results: [] } }),
      ev({ type: "task.dispatched", phase: "P4", task: "TASK-AW-003" }),
      ev({ type: "gate.evaluated", phase: "P4", task: "TASK-AW-003", payload: { outcome: "failed", results: [] } }),
    ];
    expect(phase(run(list), "P4").status).toBe("in_progress");
    const addedPassed = [...list, ev({ type: "gate.evaluated", phase: "P4", task: "TASK-AW-003", payload: { outcome: "passed", results: [] } })];
    expect(phase(run(addedPassed), "P4").status).toBe("approved");
  });

  it("ID の無いタスクは P4 のコミットで「合格（ゲート記録なし）」にする", () => {
    const s = run([
      ev({ type: "task.dispatched", phase: "P4", iteration: "2026-06 初版" }),
      ev({ type: "commit.created", phase: "P4", iteration: "2026-06 初版", payload: { artifacts: ["holdout_tests"] } }),
    ]);
    expect(s.tasks[0]!.status).toBe("waiting"); // コードを含まないコミットでは完了にしない
    const done = run([
      ev({ type: "task.dispatched", phase: "P4", iteration: "2026-06 初版" }),
      ev({ type: "commit.created", phase: "P4", iteration: "2026-06 初版", payload: { artifacts: ["code", "tests"] } }),
    ]);
    expect(done.tasks[0]).toMatchObject({ id: null, label: "2026-06 初版 / ID なし", status: "passed", gateRecorded: false });
    expect(phase(done, "P4").status).toBe("approved");
  });

  it("逆戻りで再承認待ちになった P4 は、前の周に合格したタスクでは再承認されない", () => {
    const s = run([
      ev({ type: "task.dispatched", phase: "P4", iteration: "2026-06 初版" }),
      ev({ type: "commit.created", phase: "P4", iteration: "2026-06 初版", payload: { artifacts: ["code"] } }),
      ev({ type: "deviation.opened", payload: { deviation: "phase_rollback", to_phase: "P1" } }),
    ]);
    expect(phase(s, "P4")).toMatchObject({ status: "approved", needsReapproval: true });
    const done = run([
      ev({ type: "task.dispatched", phase: "P4", iteration: "2026-06 初版" }),
      ev({ type: "commit.created", phase: "P4", iteration: "2026-06 初版", payload: { artifacts: ["code"] } }),
      ev({ type: "deviation.opened", payload: { deviation: "phase_rollback", to_phase: "P1" } }),
      ev({ type: "task.dispatched", phase: "P4", task: T }),
      ev({ type: "gate.evaluated", phase: "P4", task: T, payload: { outcome: "passed", results: [] } }),
    ]);
    expect(phase(done, "P4").status).toBe("approved");
  });

  it("投入時の担当（チーム・ベンダー）を記録する", () => {
    const s = run([ev({ type: "task.dispatched", phase: "P4", task: T, payload: { team: "ベンダー A" } })]);
    expect(s.tasks[0]!.team).toBe("ベンダー A");
  });

  it("エスカレーション・契約違反・ローカル退避でタスクの状態を変え、閉じたら実行中に戻す", () => {
    const base = [ev({ type: "task.dispatched", phase: "P4", task: T })];
    const open = (kind: string) => ev({ type: "deviation.opened", phase: "P4", task: T, payload: { deviation: kind } });
    expect(run([...base, open("escalation")]).tasks[0]!.status).toBe("escalated");
    expect(run([...base, open("interface_contract_violation")]).tasks[0]!.status).toBe("escalated");
    expect(run([...base, open("local_fallback")]).tasks[0]!.status).toBe("local_fallback");
    const closed = run([...base, open("local_fallback"), ev({ type: "deviation.closed", phase: "P4", task: T, payload: { deviation: "local_fallback" } })]);
    expect(closed.tasks[0]!.status).toBe("running");
  });

  it("コミットで工程を記録する", () => {
    const s = run([
      ev({ type: "task.dispatched", phase: "P4", task: T }),
      ev({ type: "commit.created", phase: "P4", task: T, payload: { step: "green", sha: "abc" } }),
    ]);
    expect(s.tasks[0]).toMatchObject({ step: "green" });
  });
});

// --- ゲートの判定 -------------------------------------------------------------

describe("ゲートの判定", () => {
  it("判定を記録し、回数を引き継ぐ", () => {
    const e = ev({
      type: "gate.evaluated",
      phase: "P1",
      payload: { gate: "task_quality_gate", trigger: "stop_hook", outcome: "blocked", count: 15, results: [{ layer: "G2", check: "traceability", status: "failed", summary: "x" }] },
    });
    const s = run([e]);
    expect(s.evaluations).toEqual([
      expect.objectContaining({ eventId: e.id, trigger: "stop_hook", outcome: "blocked", count: 15, task: null, phase: "P1" }),
    ]);
  });
});

// --- 実データ（受入条件） -----------------------------------------------------

describe("実データ: approval-workflow", () => {
  const indexOf = (pred: (e: HubEvent) => boolean) => realEvents.findIndex(pred) + 1;
  const all = replay(realEvents, processDef, realEvents.length);

  it("AC-004: AI が承認を書き込んだ直後、P1 は承認済みにならず、無効な承認として残る", () => {
    const n = indexOf((e) => e.type === "gate.approved" && e.actor.kind === "ai" && e.payload?.gate === "customer_approval");
    expect(n).toBeGreaterThan(0);
    const s = replay(realEvents, processDef, n);
    expect(phase(s, "P1").status).toBe("in_progress");
    expect(s.approvals.at(-1)).toMatchObject({ gate: "customer_approval", valid: false });
  });

  it("AC-005: 設計レビュー後の Phase 逆戻りで、P1 を作業中にし、既承認の工程を再承認待ちにする", () => {
    const n = indexOf((e) => e.type === "deviation.opened" && e.payload?.deviation === "phase_rollback");
    const s = replay(realEvents, processDef, n);
    expect(phase(s, "P1")).toMatchObject({ status: "in_progress", needsReapproval: true });
    expect(s.phases.filter((p) => p.id !== "P1" && p.needsReapproval).every((p) => p.status === "approved" && p.reopened)).toBe(true);
  });

  it("最後まで再生すると P1〜P6 が承認済みで、TASK-AW-002 は合格", () => {
    expect(all.phases.filter((p) => p.id !== "P0").every((p) => p.status === "approved")).toBe(true);
    expect(all.tasks.find((t) => t.id === "TASK-AW-002")?.status).toBe("passed");
  });

  it("P5 の承認より前に P6 の作業が始まったことを順序違反として検出する", () => {
    expect(all.violations).toHaveLength(1);
    const v = all.violations[0]!;
    expect(v.phase).toBe("P6");
    expect(v.missing).toEqual(["P5"]);
    expect(realEvents.find((e) => e.id === v.eventId)?.payload?.skill).toBe("doc-reverse-gen");
  });

  it("どの案件でも、最後まで再生するとサブエージェントの実行がすべて終了している", () => {
    for (const p of program.projects) {
      const s = replay(p.events, processDef, p.events.length);
      const running = s.tasks.flatMap((t) => t.agents.filter((a) => a.finishedBy === null).map((a) => `${p.id}/${t.label}/${a.agent}`));
      expect(running).toEqual([]);
    }
  });

  it("逸脱はすべて閉じている", () => {
    expect(all.deviations.length).toBeGreaterThan(0);
    expect(all.deviations.every((d) => d.closedBy !== null)).toBe(true);
  });
});

// --- Property -----------------------------------------------------------------

const nArb = fc.integer({ min: 0, max: realEvents.length });

describe("Property", () => {
  it("PROP-001: どの位置を経由しても、同じ n の状態は同じ（決定性）", () => {
    fc.assert(
      fc.property(fc.array(nArb, { maxLength: 8 }), nArb, (visits, n) => {
        const expected = replay(realEvents, processDef, n);
        for (const v of visits) replay(realEvents, processDef, v);
        expect(replay(realEvents, processDef, n)).toEqual(expected);
      }),
      { numRuns: 50 },
    );
  });

  it("PROP-002: n 件目までの状態は、それより後のイベントに依存しない", () => {
    fc.assert(
      fc.property(nArb, fc.integer(), (n, salt) => {
        const tail = realEvents.slice(n).map((e, i) => ({ ...e, type: ["commit.created", "deviation.opened", "gate.approved"][Math.abs(i + salt) % 3] ?? e.type, phase: "P6" as const }));
        expect(replay([...realEvents.slice(0, n), ...tail], processDef, n)).toEqual(replay(realEvents, processDef, n));
      }),
      { numRuns: 50 },
    );
  });

  it("PROP-003: 承認済みの（per_task でない）Phase には、有効な承認がある", () => {
    const perTask = new Set(processDef.phases.filter((p) => p.mode !== "sequential").map((p) => p.id));
    fc.assert(
      fc.property(nArb, (n) => {
        const s = replay(realEvents, processDef, n);
        for (const p of s.phases) {
          if (p.status !== "approved" || perTask.has(p.id)) continue;
          const a = s.approvals.find((x) => x.eventId === p.approvedBy);
          expect(a?.valid).toBe(true);
          expect(a?.phase).toBe(p.id);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("PROP-004: 実測と再構成の件数の合計は n", () => {
    fc.assert(
      fc.property(nArb, (n) => {
        const s = replay(realEvents, processDef, n);
        expect(s.counts.measured + s.counts.reconstructed).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});


describe("逸脱の対応付け（R03）", () => {
  const open = (task: string, iteration = "it", kind = "escalation") => ev({ type: "deviation.opened", task, iteration, payload: { deviation: kind } });
  const close = (task: string, openedBy?: string, iteration = "it", kind = "escalation") => ev({ type: "deviation.closed", task, iteration, payload: { deviation: kind, ...(openedBy ? { opened_by: openedBy } : {}) } });
  const dispatch = (task: string, iteration = "it") => ev({ type: "task.dispatched", task, iteration });

  it("別タスクの同種例外を閉じず、該当タスクだけ再開する", () => {
    const a = open("TASK-XX-001"), b = open("TASK-XX-002");
    const end = close("TASK-XX-001");
    const s = run([dispatch(a.task!), dispatch(b.task!), a, b, end]);
    expect(s.deviations.map((d) => d.closedBy)).toEqual([end.id, null]);
    expect(s.tasks.map((t) => t.status)).toEqual(["running", "escalated"]);
  });

  it("同タスクの重複例外は開始IDで区別し、二重終了で他の例外を閉じない", () => {
    const a = open("TASK-XX-001"), b = open(a.task!);
    const end = close(a.task!, a.id);
    const s = run([dispatch(a.task!), a, b, end, close(a.task!, a.id)]);
    expect(s.deviations.map((d) => d.closedBy)).toEqual([end.id, null]);
    expect(s.tasks[0]!.status).toBe("escalated");
  });

  it.each(["別タスク", "別周", "存在しない参照"])("%s の終了は状態を変更しない", (mode) => {
    const a = open("TASK-XX-001");
    const end = close(mode === "別タスク" ? "TASK-XX-002" : a.task!, mode === "存在しない参照" ? "ev-9999" : a.id, mode === "別周" ? "other" : "it");
    const s = run([dispatch(a.task!), a, end]);
    expect(s.deviations[0]!.closedBy).toBeNull();
    expect(s.tasks[0]!.status).toBe("escalated");
  });

  it("同一IDの別周を区別する", () => {
    const a = open("TASK-XX-001"), b = open(a.task!, "next");
    const end = close(a.task!, b.id, "next");
    const s = run([dispatch(a.task!), a, dispatch(a.task!, "next"), b, end]);
    expect(s.deviations.map((d) => d.closedBy)).toEqual([null, end.id]);
    expect(s.tasks.map((t) => t.status)).toEqual(["escalated", "running"]);
  });

  it("ローカル退避を閉じても他の未解消例外があれば判断待ちに戻す", () => {
    const a = open("TASK-XX-001"), b = open(a.task!, "it", "local_fallback");
    const s = run([dispatch(a.task!), a, b, close(a.task!, b.id, "it", "local_fallback")]);
    expect(s.tasks[0]!.status).toBe("escalated");
  });
});


it("以前の実行の例外終了を、同一周の再投入タスクへ適用しない", () => {
  const first = ev({ type: "task.dispatched", task: "TASK-XX-001" });
  const a = ev({ type: "deviation.opened", task: first.task, payload: { deviation: "escalation" } });
  const second = ev({ type: "task.dispatched", task: first.task });
  const b = ev({ type: "deviation.opened", task: first.task, payload: { deviation: "escalation" } });
  const end = ev({ type: "deviation.closed", task: first.task, payload: { deviation: "escalation", opened_by: a.id } });
  const s = run([first, a, second, b, end]);
  expect(s.tasks.map((t) => t.status)).toEqual(["running", "escalated"]);
  expect(s.deviations.map((d) => d.closedBy)).toEqual([end.id, null]);
});
