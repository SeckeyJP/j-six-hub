// リプレイの状態（design-spec §3.1）。画面はこれを表示するだけ。
import type { GateResult, Provenance } from "../types/events";
import type { PhaseId } from "../types/process";

export type PhaseStatus = "not_started" | "in_progress" | "approved";

export interface PhaseView {
  id: PhaseId;
  name: string;
  mode: "continuous" | "sequential" | "per_task";
  gateId: string | null;
  gateName: string | null;
  status: PhaseStatus;
  /** Phase 逆戻りで開き直したか */
  reopened: boolean;
  /** 最後に開き直したイベントの seq（per_task の Phase は、これより後に投入したタスクで完了を判定する） */
  reopenedAt: number | null;
  /** 承認済みにしたイベント（per_task の Phase ではタスクの完了で承認済みになるため null のことがある） */
  approvedBy: string | null;
}

export type TaskStatus = "waiting" | "running" | "gate_checking" | "passed" | "failed";

export interface AgentRun {
  agent: string;
  step: string | null;
  startedBy: string;
  finishedBy: string | null;
}

export interface TaskView {
  /** タスク ID。記録に ID が無いタスクは null */
  id: string | null;
  label: string;
  iteration: string;
  /** 投入したイベントの seq */
  dispatchedAt: number;
  status: TaskStatus;
  step: string | null;
  agents: AgentRun[];
  /** ゲートの判定記録があるか（2026-06 初版は品質ゲート導入前のため無い） */
  gateRecorded: boolean;
}

export interface Evaluation {
  eventId: string;
  gate: string | null;
  trigger: string | null;
  outcome: string;
  count: number;
  results: GateResult[];
  task: string | null;
  phase: PhaseId | null;
  provenance: Provenance;
}

export interface ApprovalView {
  eventId: string;
  gate: string;
  gateName: string;
  phase: PhaseId | null;
  actorKind: "human" | "ai" | "system";
  role: string | null;
  roleRecorded: boolean;
  valid: boolean;
  reason: string | null;
  provenance: Provenance;
}

export interface DeviationView {
  kind: string;
  name: string;
  openedBy: string;
  closedBy: string | null;
  phase: PhaseId | null;
}

export interface Violation {
  eventId: string;
  phase: PhaseId;
  /** 承認済みでなかった前の Phase */
  missing: PhaseId[];
}

export interface ProjectView {
  name: string;
  processVersion: string | null;
  constitution: string | null;
}

export interface HubState {
  n: number;
  current: string | null;
  iteration: string | null;
  project: ProjectView | null;
  phases: PhaseView[];
  tasks: TaskView[];
  evaluations: Evaluation[];
  approvals: ApprovalView[];
  deviations: DeviationView[];
  violations: Violation[];
  counts: Record<Provenance, number>;
}
