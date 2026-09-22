import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { GUIDE_STEPS } from "./guide";

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
}

afterEach(() => {
  window.location.hash = "";
});

const ROUTES = ["#/?n=176", "#/p/approval-workflow/board?n=176", "#/p/order-integration/board?n=176", "#/p/approval-workflow/history?n=176"];

describe("用語（REQ-027）", () => {
  it.each(ROUTES)("%s の画面に「案件」が出ない", (hash) => {
    const { container } = renderAt(hash);
    expect(container.textContent).not.toContain("案件");
  });

  it("一覧の見出しと案内文をプロジェクトで通す", () => {
    renderAt("#/");
    expect(screen.getByRole("heading", { name: /すべてのプロジェクト/ })).toBeInTheDocument();
  });

  it("再生前の案内文もプロジェクトで通す", () => {
    renderAt("#/?n=0");
    expect(screen.getByRole("region", { name: "いま起きたこと" })).toHaveTextContent("3つのプロジェクト");
  });

  it("工程ボードの導入文と見出しを、画面の用語に揃える", () => {
    const { container } = renderAt("#/p/approval-workflow/board?n=176");
    const lead = container.querySelector(".lead")!;
    expect(lead.textContent).toContain("品質検査");
    expect(within(container).getByRole("heading", { name: "対応中の例外処理" })).toBeInTheDocument();
    expect(within(container).getByRole("heading", { name: "工程の順序違反" })).toBeInTheDocument();
  });

  it("順序違反は「P1 の承認前に P2 が始まった」の形で書く", () => {
    const { container } = renderAt("#/p/monthly-billing/board?n=176");
    const text = container.querySelector(".note-card .warn")?.textContent ?? "";
    expect(text).toMatch(/の承認前に .+ が始まった/);
  });
});

describe("トップバー", () => {
  it("このシステムが何かを1行で示す", () => {
    renderAt("#/");
    const banner = screen.getByRole("banner");
    expect(within(banner).getByTestId("tagline").textContent).toMatch(/工程.*検査.*承認/);
  });

  it("使い方を開くボタンにする", () => {
    renderAt("#/");
    expect(screen.getByRole("button", { name: "使い方を開く" })).toHaveTextContent("使い方");
  });

  it("Program 名から「（説明用）」を外す（架空のバッジで足りる）", () => {
    renderAt("#/");
    const banner = screen.getByRole("banner");
    expect(within(banner).getByTestId("program-name").textContent).not.toContain("説明用");
  });
});

describe("ガイドの文", () => {
  it("左ナビの説明を、いまの表示（停止 n）に合わせる", () => {
    const projects = GUIDE_STEPS.find((s) => s.id === "projects")!;
    expect(projects.text).toContain("停止");
    expect(projects.text).not.toContain("⚑ で示します");
  });
});
