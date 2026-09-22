import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { GUIDE_STEPS, GUIDE_STORAGE_KEY } from "./guide";

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "#/";
});
afterEach(() => vi.restoreAllMocks());

const renderApp = (auto = true) => render(<App data={program} process={processDef} guideAutoStart={auto} />);
const tour = () => screen.queryByRole("dialog", { name: "ガイド" });

describe("ガイドツアー", () => {
  it("AC-008: 初回に始まり、次へで全ステップを進め、最後に閉じる", async () => {
    renderApp();
    for (const [i, step] of GUIDE_STEPS.entries()) {
      const d = tour()!;
      expect(d).toHaveTextContent(step.title);
      expect(d).toHaveTextContent(`${i + 1} / ${GUIDE_STEPS.length}`);
      const last = i === GUIDE_STEPS.length - 1;
      await userEvent.click(within(d).getByRole("button", { name: last ? "終わる" : "次へ" }));
    }
    expect(tour()).toBeNull();
  });

  it("戻るで前のステップに戻る", async () => {
    renderApp();
    await userEvent.click(within(tour()!).getByRole("button", { name: "次へ" }));
    await userEvent.click(within(tour()!).getByRole("button", { name: "戻る" }));
    expect(tour()).toHaveTextContent(GUIDE_STEPS[0]!.title);
  });

  it("閉じたら2回目以降は自動で始まらない", async () => {
    const { unmount } = renderApp();
    await userEvent.click(within(tour()!).getByRole("button", { name: "閉じる" }));
    expect(window.localStorage.getItem(GUIDE_STORAGE_KEY)).toBe("1");
    unmount();
    renderApp();
    expect(tour()).toBeNull();
  });

  it("上部の「ガイド」ボタンで開き直せる", async () => {
    renderApp(false);
    expect(tour()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "ガイドを開く" }));
    expect(tour()).toHaveTextContent(GUIDE_STEPS[0]!.title);
  });

  it("Escape で閉じる", async () => {
    renderApp();
    await userEvent.keyboard("{Escape}");
    expect(tour()).toBeNull();
  });

  it("ブラウザの保存領域が使えなくても表示は壊れない", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderApp();
    expect(tour()).not.toBeNull();
    await userEvent.click(within(tour()!).getByRole("button", { name: "閉じる" }));
    expect(tour()).toBeNull();
  });

  it("各ステップの対象のエリアが画面にある", () => {
    window.location.hash = "#/p/approval-workflow/board";
    const { container } = renderApp(false);
    for (const step of GUIDE_STEPS) expect(container.querySelector(`[data-guide="${step.id}"]`)).not.toBeNull();
  });
});

describe("？の説明（REQ-018）", () => {
  it("見出しの？で、そのエリアの説明を表示し、もう一度押すと閉じる", async () => {
    renderApp(false);
    const step = GUIDE_STEPS.find((s) => s.id === "timeline")!;
    const button = screen.getByRole("button", { name: `${step.title}の説明` });
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: step.title })).toHaveTextContent(step.text);
    await userEvent.click(button);
    expect(screen.queryByRole("dialog", { name: step.title })).toBeNull();
  });

  it("Escape で説明を閉じる", async () => {
    renderApp(false);
    const step = GUIDE_STEPS.find((s) => s.id === "projects")!;
    await userEvent.click(screen.getByRole("button", { name: `${step.title}の説明` }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: step.title })).toBeNull();
  });
});
