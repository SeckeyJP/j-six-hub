// イベント列の先頭 n 件を適用した Hub の状態を計算する（design-spec §3.2）。
// 純粋関数。呼び出しの履歴に依らず、同じ入力には同じ状態を返す（PROP-001）。
import type { GateResult, HubEvent } from "../types/events";
import type { Gate, PhaseId, ProcessDefinition } from "../types/process";
import type { ApprovalView, HubState, PhaseView, TaskView } from "./state";

/** Phase の状態を変える「作業」のイベント */
const WORK_TYPES = new Set([
  "commit.created",
  "ai.session.started",
  "ai.session.finished",
  "ai.agent.started",
  "ai.agent.finished",
  "gate.evaluated",
  "hook.blocked",
  "task.dispatched",
]);

type Ctx = { state: HubState; process: ProcessDefinition; gates: Map<string, Gate> };

export function replay(events: HubEvent[], process: ProcessDefinition, n: number): HubState {
  const count = Math.max(0, Math.min(n, events.length));
  const ctx: Ctx = { state: initialState(process, count), process, gates: new Map(process.gates.map((g) => [g.id, g])) };
  for (const ev of events.slice(0, count)) apply(ctx, ev);
  return ctx.state;
}

function initialState(process: ProcessDefinition, n: number): HubState {
  const gateName = new Map(process.gates.map((g) => [g.id, g.name]));
  return {
    n,
    current: null,
    iteration: null,
    project: null,
    phases: process.phases.map((p) => ({
      id: p.id,
      name: p.name,
      mode: p.mode,
      gateId: p.gate,
      gateName: p.gate ? (gateName.get(p.gate) ?? null) : null,
      status: "not_started",
      reopened: false,
      reopenedAt: null,
      approvedBy: null,
    })),
    tasks: [],
    evaluations: [],
    approvals: [],
    deviations: [],
    violations: [],
    counts: { measured: 0, reconstructed: 0 },
  };
}

function apply(ctx: Ctx, ev: HubEvent): void {
  const { state } = ctx;
  state.current = ev.id;
  state.iteration = ev.iteration ?? state.iteration;
  state.counts[ev.provenance] += 1;
  if (WORK_TYPES.has(ev.type) && ev.phase) startWork(state, ev.phase, ev.id);

  switch (ev.type) {
    case "project.registered":
      state.project = { name: str(ev.payload?.project) ?? "(名称なし)", processVersion: null, constitution: null };
      setStatus(state, "P0", "in_progress");
      break;
    case "process.pinned":
      if (state.project) state.project.processVersion = str(ev.payload?.version);
      break;
    case "constitution.pinned":
      if (state.project) state.project.constitution = `${str(ev.payload?.commit)}:${str(ev.payload?.path)}`;
      break;
    case "gate.approved":
      applyApproval(ctx, ev);
      break;
    case "deviation.opened":
      openDeviation(ctx, ev);
      updateTask(state, ev, (t) => {
        const kind = str(ev.payload?.deviation);
        if (kind === "local_fallback") t.status = "local_fallback";
        else if (kind === "escalation" || kind === "interface_contract_violation") t.status = "escalated";
      });
      break;
    case "deviation.closed":
      closeDeviation(state, ev);
      updateTask(state, ev, (t) => {
        if (t.status === "escalated" || t.status === "local_fallback") t.status = "running";
      });
      break;
    case "task.dispatched":
      state.tasks.push(newTask(ev));
      break;
    case "ai.session.started":
      updateTask(state, ev, (t) => (t.status = "running"));
      break;
    case "ai.agent.started":
      updateTask(state, ev, (t) => startAgent(t, ev));
      break;
    case "ai.agent.finished":
      updateTask(state, ev, (t) => finishAgent(t, ev));
      break;
    case "commit.created":
      applyCommit(state, ev);
      break;
    case "gate.evaluated":
      applyEvaluation(state, ev);
      break;
  }
  completePerTaskPhases(state);
}

// --- Phase --------------------------------------------------------------------

function phaseOf(state: HubState, id: PhaseId): PhaseView | undefined {
  return state.phases.find((p) => p.id === id);
}

function setStatus(state: HubState, id: PhaseId, status: PhaseView["status"]): void {
  const p = phaseOf(state, id);
  if (p) p.status = status;
}

function startWork(state: HubState, id: PhaseId, eventId: string): void {
  const p = phaseOf(state, id);
  if (!p) return;
  if (p.mode !== "continuous") {
    const index = state.phases.indexOf(p);
    const missing = state.phases
      .slice(0, index)
      .filter((q) => q.mode !== "continuous" && q.status !== "approved")
      .map((q) => q.id);
    if (missing.length > 0) state.violations.push({ eventId, phase: id, missing });
  }
  if (p.status === "not_started") p.status = "in_progress";
}

function completePerTaskPhases(state: HubState): void {
  for (const p of state.phases) {
    if (p.mode !== "per_task" || p.status === "approved") continue;
    // 逆戻りで開き直した後は、その後に投入したタスクだけで判定する（前の周の合格で完了にしない）
    const tasks = state.tasks.filter((t) => t.dispatchedAt > (p.reopenedAt ?? 0));
    if (tasks.length > 0 && tasks.every((t) => t.status === "passed")) p.status = "approved";
  }
}

// --- 承認 ---------------------------------------------------------------------

function applyApproval(ctx: Ctx, ev: HubEvent): void {
  const gateId = str(ev.payload?.gate) ?? "";
  const gate = ctx.gates.get(gateId);
  const approvers = new Set(gate?.layers.flatMap((l) => l.checks.flatMap((c) => c.approver_roles ?? [])) ?? []);
  const role = ev.actor.role ?? null;
  let reason: string | null = null;
  if (!gate) reason = `プロセス定義にゲート ${gateId} が無い`;
  else if (ev.actor.kind !== "human") reason = "承認者は人間の役割に限られる（AI・システムによる承認は無効）";
  else if (role !== null && !approvers.has(role)) reason = `承認者の役割（${role}）がこのゲートの承認者に含まれない`;

  const approval: ApprovalView = {
    eventId: ev.id,
    gate: gateId,
    gateName: gate?.name ?? gateId,
    phase: gate?.phase ?? null,
    actorKind: ev.actor.kind,
    role,
    roleRecorded: role !== null,
    valid: reason === null,
    reason,
    provenance: ev.provenance,
  };
  ctx.state.approvals.push(approval);
  if (approval.valid && gate) {
    const p = phaseOf(ctx.state, gate.phase);
    if (p) {
      p.status = "approved";
      p.approvedBy = ev.id;
    }
  }
}

// --- 逸脱 ---------------------------------------------------------------------

function openDeviation(ctx: Ctx, ev: HubEvent): void {
  const kind = str(ev.payload?.deviation) ?? "unknown";
  const name = ctx.process.deviations.find((d) => d.id === kind)?.name ?? kind;
  ctx.state.deviations.push({ kind, name, openedBy: ev.id, closedBy: null, phase: ev.phase ?? null });
  if (kind !== "phase_rollback") return;
  const to = str(ev.payload?.to_phase);
  const from = ctx.state.phases.findIndex((p) => p.id === to);
  if (from < 0) return;
  for (const p of ctx.state.phases.slice(from)) {
    if (p.mode === "continuous") continue;
    p.status = "in_progress";
    p.reopened = true;
    p.reopenedAt = ev.seq;
    p.approvedBy = null;
  }
}

function closeDeviation(state: HubState, ev: HubEvent): void {
  const kind = str(ev.payload?.deviation);
  const open = [...state.deviations].reverse().find((d) => d.kind === kind && d.closedBy === null);
  if (open) open.closedBy = ev.id;
}

// --- タスク -------------------------------------------------------------------

function newTask(ev: HubEvent): TaskView {
  const iteration = ev.iteration ?? "";
  return {
    id: ev.task ?? null,
    label: ev.task ?? `${iteration} / ID なし`,
    team: str(ev.payload?.team),
    iteration,
    dispatchedAt: ev.seq,
    status: "waiting",
    step: null,
    agents: [],
    gateRecorded: false,
  };
}

function updateTask(state: HubState, ev: HubEvent, fn: (t: TaskView) => void): void {
  if (!ev.task) return;
  const t = state.tasks.find((x) => x.id === ev.task);
  if (t) fn(t);
}

function startAgent(t: TaskView, ev: HubEvent): void {
  const step = str(ev.payload?.step);
  t.agents.push({ agent: str(ev.payload?.agent) ?? "?", step, startedBy: ev.id, finishedBy: null });
  t.step = step ?? t.step;
  t.status = step === "G3" ? "gate_checking" : "running";
}

function finishAgent(t: TaskView, ev: HubEvent): void {
  const agent = str(ev.payload?.agent);
  const run = [...t.agents].reverse().find((a) => a.agent === agent && a.finishedBy === null);
  if (run) run.finishedBy = ev.id;
}

function applyCommit(state: HubState, ev: HubEvent): void {
  if (ev.task) {
    updateTask(state, ev, (t) => (t.step = str(ev.payload?.step) ?? t.step));
    return;
  }
  const artifacts = Array.isArray(ev.payload?.artifacts) ? (ev.payload.artifacts as unknown[]) : [];
  if (ev.phase !== "P4" || !artifacts.includes("code")) return;
  // ID の無いタスク（初版）は、コードを含むコミットで完了とみなす。ゲートの判定記録は無い
  for (const t of state.tasks) {
    if (t.id === null && t.iteration === ev.iteration && t.status !== "passed") {
      t.status = "passed";
      t.gateRecorded = false;
    }
  }
}

function applyEvaluation(state: HubState, ev: HubEvent): void {
  const outcome = str(ev.payload?.outcome) ?? "unknown";
  state.evaluations.push({
    eventId: ev.id,
    gate: str(ev.payload?.gate),
    trigger: str(ev.payload?.trigger),
    outcome,
    count: typeof ev.payload?.count === "number" ? ev.payload.count : 1,
    results: Array.isArray(ev.payload?.results) ? (ev.payload.results as GateResult[]) : [],
    task: ev.task ?? null,
    phase: ev.phase ?? null,
    provenance: ev.provenance,
  });
  updateTask(state, ev, (t) => {
    t.status = outcome === "passed" ? "passed" : "failed";
    t.gateRecorded = true;
  });
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
