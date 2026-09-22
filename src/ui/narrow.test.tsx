import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { replayProgram } from "../replay/program";
import { Board } from "./screens/board";
import { Sidebar } from "./sidebar";

const END = program.timeline.length;
const ID = "approval-workflow";

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
}

afterEach(() => {
  window.location.hash = "";
});

describe("狭い画面：履歴を別画面として開く", () => {
  const route = (screenId: string) => ({ kind: "project", id: ID, screen: screenId, n: null }) as const;

  it("画面ナビに履歴のチップがある", () => {
    render(<Sidebar data={program} state={replayProgram(program, processDef, END)} route={route("board")} />);
    const nav = screen.getByRole("navigation", { name: "画面" });
    const link = within(nav).getByRole("link", { name: /履歴/ });
    expect(link).toHaveAttribute("href", `#/p/${ID}/history`);
  });

  it("履歴の画面では、そのチップが現在地になる", () => {
    render(<Sidebar data={program} state={replayProgram(program, processDef, END)} route={route("history")} />);
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).getByRole("link", { name: /履歴/ })).toHaveAttribute("aria-current", "page");
  });

  it("履歴の画面では、履歴が本文に1つだけ出る", () => {
    renderAt(`#/p/${ID}/history`);
    const panels = screen.getAllByRole("complementary", { name: "履歴" });
    expect(panels).toHaveLength(1);
    expect(panels[0]!.closest("main")).not.toBeNull();
  });

  it("他の画面では、履歴は本文の外に1つだけ出る", () => {
    renderAt(`#/p/${ID}/board`);
    const panels = screen.getAllByRole("complementary", { name: "履歴" });
    expect(panels).toHaveLength(1);
    expect(panels[0]!.closest("main")).toBeNull();
  });
});

describe("狭い画面：工程ボードを縦リストにできる形にする", () => {
  it("Phase の記号と名前を別の要素にする", () => {
    const state = replayProgram(program, processDef, END).projects[ID]!;
    const { container } = render(<Board project={program.projects.find((p) => p.id === ID)!} state={state} process={processDef} />);
    const card = container.querySelector(".phase-card")!;
    expect(card.querySelector(".phase-id")).toHaveTextContent("P0");
    expect(card.querySelector(".phase-name")).toHaveTextContent("憲法");
    // 見出しとしての意味は保つ（記号＋名前で1つの見出し）
    expect(within(card as HTMLElement).getByRole("heading", { level: 3 })).toHaveTextContent("P0 プロジェクト憲法策定");
  });

  it("ゲートの層は、記号と名前を別の要素にする", () => {
    const state = replayProgram(program, processDef, END).projects[ID]!;
    const { container } = render(<Board project={program.projects.find((p) => p.id === ID)!} state={state} process={processDef} />);
    const layer = container.querySelector(".layers li")!;
    expect(layer.querySelector(".layer-id")!.textContent).toMatch(/^G\d$/);
    expect(layer.querySelector(".layer-name")).not.toBeNull();
  });
});
