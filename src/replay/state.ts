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
  /** 逆戻り後、以前の承認を使わずに承認を取り直す必要があるか */
  needsReapproval: boolean;
  /** 最後に開き直したイベントの seq（per_task の Phase は、これより後に投入したタスクで完了を判定する） */
  reopenedAt: number | null;
  /** 承認済みにしたイベント（per_task の Phase ではタスクの完了で承認済みになるため null のことがある） */
  approvedBy: string | null;
}

export type TaskStatus = "waiting" | "running" | "gate_checking" | "passed" | "failed" | "escalated" | "local_fallback";

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
  /** 担当のチーム・ベンダー（記録があれば） */
  team: string | null;
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
  /** 対応が一意に決まった投入 seq。null の判定はタスク完了に使用しない */
  taskDispatchedAt: number | null;
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
  /** 開始時に対応付けたタスク実行。投入イベントの seq */
  taskDispatchedAt: number | null;
  task: string | null;
  iteration: string;
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

export interface Requirement {
  id: string;
  title: string;
  detail: string;
}

export interface PropertyItem {
  id: string;
  requirements: string[];
  property: string;
}

export interface RequirementsView {
  items: Requirement[];
  properties: PropertyItem[];
  /** 直前の更新で追加された ID */
  added: string[];
  updatedBy: string | null;
}

export interface TraceEntry {
  id: string;
  title: string;
  tests: string[];
  code: string[];
  adr: string[];
}

export interface TraceabilityView {
  entries: TraceEntry[];
  properties: { id: string; tests: string[] }[];
  /** テストが対応していない要件（要求にあるがテストが無い、または対応表に無い） */
  untraced: string[];
  updatedBy: string | null;
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
  requirements: RequirementsView;
  traceability: TraceabilityView;
  counts: Record<Provenance, number>;
}
