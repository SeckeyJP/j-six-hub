import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import { replayProgram } from "../replay/program";
import { Sidebar } from "./sidebar";

const END = program.timeline.length;
const show = (n: number, route: Parameters<typeof Sidebar>[0]["route"] = { kind: "home", n: null }) =>
  render(<Sidebar data={program} state={replayProgram(program, processDef, n)} route={route} />);

const row = (name: string) => screen.getByRole("link", { name: new RegExp(name) });

describe("左ナビ", () => {
  it("見出しと一覧の文言を言い換える", () => {
    show(END);
    expect(screen.getByRole("navigation", { name: "プロジェクト" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 全プロジェクト一覧" })).toBeInTheDocument();
  });

  it("停止の件数をバッジで出す（0 件でも場所を確保する）", () => {
    show(END);
    const aw = row("申請承認ワークフロー");
    expect(within(aw).getByTestId("stop-badge")).toHaveTextContent("停止");
    const zero = show(0);
    const badge = within(zero.getByRole("link", { name: /申請承認ワークフロー/ })).getByTestId("stop-badge");
    expect(badge.className).toContain("is-empty");
  });

  it("現在の工程と実測の割合を1行で出す", () => {
    show(END);
    const mb = row("月次請求書発行");
    expect(mb).toHaveTextContent("P6 ドキュメント生成");
    expect(mb).toHaveTextContent("実測 34/50");
  });

  it("選んだプロジェクトの画面一覧に、件数を添える", () => {
    const k = program.timeline.findIndex((t) => t.key.startsWith("approval-workflow:") && t.event.type === "requirements.updated" && (t.event.payload?.added as string[])?.includes("REQ-011")) + 1;
    show(k, { kind: "project", id: "approval-workflow", screen: "board", n: null });
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).getByRole("link", { name: /要件⇔テスト対応/ })).toHaveTextContent("2");
    expect(within(nav).getByRole("link", { name: /品質検査/ })).toHaveTextContent(/\d/);
  });
});
