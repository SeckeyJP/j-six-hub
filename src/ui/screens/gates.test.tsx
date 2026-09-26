import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../../data";
import { replay } from "../../replay/replay";
import { Gates } from "./gates";

describe("ゲート判定とタスク投入の対応表示", () => {
  it("対象実行が特定できない合格を完了済みの判定として見せない", () => {
    const state = replay([], processDef, 0);
    state.evaluations.push({
      eventId: "ev-late", gate: "task_quality_gate", trigger: "ci", outcome: "passed", count: 1,
      results: [], task: "TASK-1", taskDispatchedAt: null, phase: "P4", provenance: "measured",
    });
    render(<Gates project={program.projects[0]!} state={state} process={processDef} />);
    expect(screen.getByText(/対象実行未特定.*タスク完了には未使用/)).toBeInTheDocument();
  });
});
