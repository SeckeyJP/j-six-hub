import { describe, expect, it } from "vitest";
import { canCancelCliRun, canRecoverCliRun, explainCliEvidence } from "../../poc-ui/run-state.mjs";

describe("CLI run actions", () => {
  it("offers cancellation only while the local process is running", () => {
    expect(canCancelCliRun("started")).toBe(true);
    for (const state of ["claimed", "unknown", "cancel_requested", "succeeded", "failed", "stop_unconfirmed"]) {
      expect(canCancelCliRun(state)).toBe(false);
    }
  });

  it("offers recovery only for runs without a live controller or with an unconfirmed stop", () => {
    for (const state of ["unknown", "claimed", "cancel_requested", "stop_unconfirmed"]) expect(canRecoverCliRun(state)).toBe(true);
    for (const state of ["started", "succeeded", "failed", "recovered", "held"]) expect(canRecoverCliRun(state)).toBe(false);
  });

  it.each([
    ["recovered", "復旧記録済み"],
    ["held", "preflightで保留"], ["timed_out", "timeout"], ["started", "実行中"],
    ["evidence_unknown", "ログが欠落"], ["unknown", "停止・結果を要確認"],
  ])("explains %s without calling every state a missing log", (state, message) => {
    expect(explainCliEvidence(`cli-evidence:run-1:${state}`)).toContain(message);
  });
});
