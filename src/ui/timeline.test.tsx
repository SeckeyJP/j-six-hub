import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import { controlPointsOf } from "../replay/narrate";
import { Timeline } from "./timeline";

const points = controlPointsOf(program, processDef);
const END = program.timeline.length;

function show(n = END, projectId: string | null = null) {
  return render(<Timeline data={program} process={processDef} n={n} controlPoints={points} projectId={projectId} />);
}

const rows = () => within(screen.getByRole("list", { name: "出来事" })).getAllByRole("listitem");

describe("出来事の記録", () => {
  it("REQ-021: 凡例（実測・再構成・架空／人間・AI・Hub）を表示する", () => {
    show();
    const legend = screen.getByRole("region", { name: "凡例" });
    for (const t of ["実測", "再構成", "架空", "人間", "AI", "Hub"]) expect(legend).toHaveTextContent(t);
  });

  it("n 件目までを新しい順に表示し、各行に案件名と実測／再構成がある", () => {
    show(10);
    expect(rows()).toHaveLength(10);
    const first = program.timeline[9]!;
    const name = program.projects.find((p) => p.id === first.project)!.name;
    expect(rows()[0]).toHaveTextContent(name);
    for (const r of rows()) expect(r.textContent).toMatch(/実測|再構成/);
  });

  it("AC-010: 統制ポイントだけに絞る", async () => {
    show();
    await userEvent.click(screen.getByRole("checkbox", { name: "統制ポイントだけ" }));
    expect(rows()).toHaveLength(points.size);
  });

  it("選んだ案件だけに絞る", async () => {
    show(END, "monthly-billing");
    await userEvent.click(screen.getByRole("checkbox", { name: "この案件だけ" }));
    const mb = program.projects.find((p) => p.id === "monthly-billing")!;
    expect(rows()).toHaveLength(mb.events.length);
  });

  it("統制ポイントの行を目立たせる", () => {
    show();
    const marked = rows().filter((r) => r.classList.contains("control"));
    expect(marked).toHaveLength(points.size);
  });

  it("行を開くと出典と、再構成なら根拠を表示する", async () => {
    show();
    const target = program.timeline.find((t) => t.event.provenance === "reconstructed")!;
    const row = rows().find((r) => r.getAttribute("data-key") === target.key)!;
    await userEvent.click(within(row).getByRole("button"));
    expect(row).toHaveTextContent(target.event.basis!);
  });
});
