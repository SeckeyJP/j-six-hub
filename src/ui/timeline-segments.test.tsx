import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import { controlPointsOf } from "../replay/narrate";
import { Timeline } from "./timeline";

const points = controlPointsOf(program, processDef);
const END = program.timeline.length;
const show = (projectId: string | null = null) =>
  render(<Timeline data={program} process={processDef} n={END} controlPoints={points} projectId={projectId} />);
const rows = () => within(screen.getByRole("list", { name: "出来事" })).getAllByRole("listitem");

describe("履歴（絞り込みと行）", () => {
  it("見出しを「履歴」にし、件数を添える", () => {
    show();
    expect(screen.getByRole("complementary", { name: "履歴" })).toBeInTheDocument();
    expect(screen.getByText(`新しい順 ・ ${END} 件`)).toBeInTheDocument();
  });

  it("絞り込みを件数付きのセグメントにする", async () => {
    show("monthly-billing");
    const group = screen.getByRole("group", { name: "絞り込み" });
    expect(within(group).getByRole("button", { name: `すべて ${END}` })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(group).getByRole("button", { name: `⚑ 統制に関わる記録 ${points.size}` }));
    expect(rows()).toHaveLength(points.size);
    const mb = program.projects.find((p) => p.id === "monthly-billing")!;
    await userEvent.click(within(group).getByRole("button", { name: `このプロジェクト ${mb.events.length}` }));
    expect(rows()).toHaveLength(mb.events.length);
  });

  it("統制の行に種類を出す", () => {
    show();
    const control = rows().filter((r) => r.classList.contains("control"));
    expect(control.length).toBe(points.size);
    expect(control.some((r) => r.textContent?.includes("検査で停止"))).toBe(true);
  });

  it("再構成の行に根拠の冒頭を出す", () => {
    show();
    const reconstructed = rows().find((r) => r.textContent?.includes("再構成"))!;
    expect(within(reconstructed).getByTestId("basis-preview").textContent).toMatch(/^根拠: /);
  });

  it("凡例からアクターの絵文字を外す", () => {
    show();
    const legend = screen.getByRole("region", { name: "凡例" });
    expect(legend).toHaveTextContent("実測");
    expect(legend).toHaveTextContent("架空");
    expect(legend.textContent).not.toContain("人間");
  });
});
