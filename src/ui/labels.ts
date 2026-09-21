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
  escalated: "エスカレーション中",
  local_fallback: "ローカル退避中",
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
  stop_hook: "Stop hook（作業終了時）",
  evidence_pack: "証跡パッケージ生成",
  ci: "CI（外側のループ）",
  gate_run: "ゲートの実行",
};

export const SCREENS = [
  { id: "board", label: "Phase ボード" },
  { id: "tasks", label: "タスク" },
  { id: "gates", label: "ゲート" },
  { id: "approvals", label: "承認" },
  { id: "evidence", label: "証跡" },
] as const;

export const ACTOR_KIND = { human: "人間", ai: "AI", system: "Hub" } as const;
export const ACTOR_ICON = { human: "👤", ai: "🤖", system: "⚙" } as const;
