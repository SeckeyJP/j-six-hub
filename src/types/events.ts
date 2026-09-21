// リプレイ用イベント（data/events.schema.json）の型。
import type { PhaseId } from "./process";

export type Provenance = "measured" | "reconstructed";

export interface Actor {
  kind: "human" | "ai" | "system";
  role?: string;
  name?: string;
}

export interface GateResult {
  layer: string;
  check: string | null;
  status: "passed" | "failed" | "skipped";
  summary: string;
}

export interface HubEvent {
  seq: number;
  id: string;
  timestamp: string;
  iteration?: string;
  phase?: PhaseId | null;
  task?: string | null;
  type: string;
  actor: Actor;
  summary: string;
  payload?: Record<string, unknown>;
  provenance: Provenance;
  source: { kind: "git" | "session" | "report" | "reconstruction"; ref?: string };
  basis?: string;
}
