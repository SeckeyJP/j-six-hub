import { describe, expect, it } from "vitest";
import { processDef } from "../data";
import { SCREENS, TASK_STATUS, TRIGGER } from "./labels";
import { CONTROL_LABEL } from "./timeline";

// REQ-027: 画面の用語は言い換える。ただしプロセス定義由来の名前は変えない
describe("画面の用語", () => {
  it("画面名を言い換える", () => {
    expect(SCREENS.map((s) => s.label)).toEqual([
      "工程ボード",
      "要求",
      "AI の作業",
      "品質検査",
      "承認",
      "要件⇔テスト対応",
      "監査記録",
    ]);
  });

  it("タスクの状態を言い換える", () => {
    expect(TASK_STATUS.escalated).toBe("人の判断待ち");
    expect(TASK_STATUS.local_fallback).toBe("ローカル作業へ切替");
  });

  it("検査の起動元を言い換える", () => {
    expect(TRIGGER.stop_hook).toBe("作業終了時の自動チェック");
  });

  it("統制の種類を言い換える", () => {
    expect(CONTROL_LABEL.gate_stopped).toBe("検査で停止");
    expect(CONTROL_LABEL.violation).toBe("工程の順序違反");
    expect(CONTROL_LABEL.deviation).toBe("例外処理");
  });

  it("プロセス定義由来の名前は変えない", () => {
    const names = processDef.phases.map((p) => p.name);
    expect(names).toContain("技術設計");
    expect(processDef.gates.map((g) => g.name)).toContain("4層品質ゲート（G1→G2→G3→G4）");
  });
});
