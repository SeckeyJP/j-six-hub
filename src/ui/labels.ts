// 画面に出す日本語のラベル
import type { PhaseStatus, TaskStatus } from "../replay/state";

export const PHASE_STATUS: Record<PhaseStatus, string> = {
  not_started: "未着手",
  in_progress: "進行中",
  approved: "承認済み",
};

export const TASK_STATUS: Record<TaskStatus, string> = {
  waiting: "待機",
  running: "実行中",
  gate_checking: "ゲート判定中",
  passed: "合格",
  failed: "不合格",
  escalated: "人の判断待ち",
  local_fallback: "ローカル作業へ切替",
};

export const OUTCOME: Record<string, string> = {
  passed: "通過",
  blocked: "ブロック",
  failed: "未達",
};

export const CHECK_STATUS: Record<string, string> = {
  passed: "✅ 通過",
  failed: "❌ 未達",
  skipped: "⏭ 未実行",
};

export const TRIGGER: Record<string, string> = {
  stop_hook: "作業終了時の自動チェック",
  evidence_pack: "監査記録の作成",
  ci: "CI（外側のループ）",
  gate_run: "検査の実行",
};

// 画面の用語は言い換える（REQ-027）。プロセス定義由来の名前（Phase 名・ゲート名・G1〜G4）は変えない
export const SCREENS = [
  { id: "board", label: "工程ボード" },
  { id: "requirements", label: "要求" },
  { id: "tasks", label: "AI の作業" },
  { id: "gates", label: "品質検査" },
  { id: "approvals", label: "承認" },
  { id: "traceability", label: "要件⇔テスト対応" },
  { id: "evidence", label: "監査記録" },
] as const;

/** 履歴の画面 ID。SCREENS には入れない（本文に出すのは履歴そのもので、案件の画面ではない） */
export const HISTORY_SCREEN = "history";

export const ACTOR_KIND = { human: "人間", ai: "AI", system: "Hub" } as const;
export const ACTOR_ICON = { human: "👤", ai: "🤖", system: "⚙" } as const;
