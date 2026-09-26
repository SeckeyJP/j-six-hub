import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../../data";
import { replay } from "../../replay/replay";
import { Evidence } from "./evidence";

describe("証跡画面の承認状態", () => {
  for (const id of ["approval-workflow", "monthly-billing"]) {
    it(`${id}: 逆戻り後の旧承認を現在の承認と表示しない`, () => {
      const project = program.projects.find((p) => p.id === id)!;
      const n = project.events.findIndex((_, i) => {
        const p = replay(project.events, processDef, i + 1).phases.find((x) => x.id === "P5")!;
        return p.needsReapproval && p.approvedBy !== null;
      }) + 1;
      expect(n).toBeGreaterThan(0);
      const state = replay(project.events, processDef, n);
      const { container } = render(<Evidence project={project} state={state} process={processDef} />);
      const review = container.querySelector("#review-title")!.parentElement!;
      expect(review.textContent).toContain("再承認待ち");
      expect(review.textContent).toContain("以前の承認");
      expect(review.textContent).toContain(state.phases.find((p) => p.id === "P5")!.approvedBy);
    });
  }
});
