import { describe, expect, it } from "vitest";
import { canCancelCliRun } from "../../poc-ui/run-state.mjs";

describe("CLI run actions", () => {
  it("offers cancellation only while the local process is running", () => {
    expect(canCancelCliRun("started")).toBe(true);
    for (const state of ["claimed", "unknown", "cancel_requested", "succeeded", "failed", "stop_unconfirmed"]) {
      expect(canCancelCliRun(state)).toBe(false);
    }
  });
});
