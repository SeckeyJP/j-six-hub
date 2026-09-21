// J-SIX プロセス定義（process/jsix-process.yaml）のうち、画面で使う部分の型。
// 定義そのものはビルド時に固定した版を取得する（ADR-0002）。

export type PhaseId = `P${number}`;

export interface Role {
  id: string;
  name: string;
  kind: "human" | "ai" | "system";
}

export interface Check {
  id: string;
  name: string;
  kind: string;
  approver_roles?: string[];
  criteria?: string[];
  origin?: "jsix" | "hub-concept";
}

export interface GateLayer {
  id: string;
  name: string;
  optional?: boolean;
  note?: string;
  checks: Check[];
}

export interface Gate {
  id: string;
  name: string;
  phase: PhaseId;
  scope: "project" | "task";
  ordered?: boolean;
  description?: string;
  layers: GateLayer[];
}

export interface Phase {
  id: PhaseId;
  name: string;
  mode: "continuous" | "sequential" | "per_task";
  gate: string | null;
  steps?: string[];
  note?: string;
}

export interface CheckKind {
  id: string;
  name: string;
  evidence_class: "evidence" | "advisory" | "approval";
}

export interface Deviation {
  id: string;
  name: string;
}

export interface ProcessDefinition {
  schema_version: 1;
  process: { id: string; name: string; derived_from: { document: string; version: string } };
  roles: Role[];
  check_kinds: CheckKind[];
  gates: Gate[];
  phases: Phase[];
  deviations: Deviation[];
  _source: { repository: string; tag: string; sha256: string; license: string };
}
