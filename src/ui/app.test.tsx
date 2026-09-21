import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { events, processDef } from "../data";

const ROUTES = ["#/", "#/board", "#/tasks", "#/gates", "#/approvals", "#/evidence"];

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App events={events} process={processDef} />);
}

afterEach(() => {
  window.location.hash = "";
});

describe("共通レイアウト", () => {
  it.each(ROUTES)("AC-001: %s にリプレイの表示がある", (hash) => {
    renderAt(hash);
    expect(screen.getByText("リプレイ（実際の AI は動作していません）")).toBeInTheDocument();
  });

  it("REQ-014: プロセス定義の出典（J-SIX・ライセンス・版）を表示する", () => {
    renderAt("#/");
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("J-SIX");
    expect(footer).toHaveTextContent("CC BY 4.0");
    expect(footer).toHaveTextContent(processDef._source.tag);
  });

  it("ナビゲーションで画面を切り替える", async () => {
    renderAt("#/");
    await userEvent.click(screen.getByRole("link", { name: "承認" }));
    expect(window.location.hash).toBe("#/approvals");
  });
});

describe("再生操作", () => {
  it("AC-003: 1イベント進めて戻すと、元と同じ表示になる", async () => {
    renderAt("#/");
    const next = screen.getByRole("button", { name: "1イベント進む" });
    await userEvent.click(next);
    await userEvent.click(next);
    const before = screen.getByRole("main").textContent + screen.getByRole("complementary").textContent;
    await userEvent.click(next);
    await userEvent.click(screen.getByRole("button", { name: "1イベント戻る" }));
    expect(screen.getByRole("main").textContent + screen.getByRole("complementary").textContent).toBe(before);
  });

  it("位置を n / 全件で表示する", async () => {
    renderAt("#/");
    expect(screen.getByText(`0 / ${events.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "末尾へ" }));
    expect(screen.getByText(`${events.length} / ${events.length}`)).toBeInTheDocument();
  });

  it("キー操作: → で進み、← で戻り、End で末尾、Home で先頭", async () => {
    renderAt("#/");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");
    expect(screen.getByText(`1 / ${events.length}`)).toBeInTheDocument();
    await userEvent.keyboard("{End}");
    expect(screen.getByText(`${events.length} / ${events.length}`)).toBeInTheDocument();
    await userEvent.keyboard("{Home}");
    expect(screen.getByText(`0 / ${events.length}`)).toBeInTheDocument();
  });

  it("速度を選べる", async () => {
    renderAt("#/");
    await userEvent.click(screen.getByRole("radio", { name: "×16" }));
    expect(screen.getByRole("radio", { name: "×16" })).toBeChecked();
  });
});

describe("イベントの一覧", () => {
  it("REQ-002: 各イベントに実測／再構成のラベルがある", async () => {
    renderAt("#/");
    await userEvent.keyboard("{End}");
    const list = within(screen.getByRole("complementary")).getAllByRole("listitem");
    expect(list).toHaveLength(events.length);
    for (const item of list) expect(item.textContent).toMatch(/実測|再構成/);
  });

  it("AC-002: 再構成のイベントを選ぶと根拠を表示する", async () => {
    renderAt("#/");
    await userEvent.keyboard("{End}");
    const target = events.find((e) => e.provenance === "reconstructed")!;
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`${target.id}`) }));
    const detail = screen.getByRole("region", { name: "イベントの詳細" });
    expect(detail).toHaveTextContent(target.basis!);
  });

  it("n 件目までのイベントだけを表示する", async () => {
    renderAt("#/");
    await act(async () => {
      await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    });
    expect(within(screen.getByRole("complementary")).getAllByRole("listitem")).toHaveLength(3);
  });
});
