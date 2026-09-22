import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { controlPointsOf, highlightKey } from "../replay/narrate";
import { GUIDE_STEPS } from "./guide";
import { firstHighlight } from "./control-nav";

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "#/";
});

const tour = () => screen.getByRole("dialog", { name: "ガイド" });

describe("ガイド（4ステップ）", () => {
  it("4ステップで、1枚目は目的の説明（対象のエリアを指さない）", () => {
    expect(GUIDE_STEPS).toHaveLength(4);
    expect(GUIDE_STEPS[0]!.id).toBe("intro");
    expect(GUIDE_STEPS[0]!.target).toBeNull();
    for (const s of GUIDE_STEPS.slice(1)) expect(s.target).toBeTruthy();
  });

  it("1枚目に「再生である」ことと見どころの3点を出す", () => {
    render(<App data={program} process={processDef} />);
    const d = tour();
    expect(d).toHaveTextContent("再生");
    expect(d).toHaveTextContent("AI は動いていません");
    expect(within(d).getAllByRole("listitem")).toHaveLength(3);
  });

  it("「見どころへ移動」で、テスト未対応の要件が生じた場面へ移動してツアーを閉じる", async () => {
    render(<App data={program} process={processDef} />);
    await userEvent.click(within(tour()).getByRole("button", { name: /見どころへ移動/ }));
    const n = firstHighlight(program.timeline, controlPointsOf(program, processDef), highlightKey(program, processDef))!;
    expect(screen.getByRole("status")).toHaveTextContent(`${n} / ${program.timeline.length}`);
    expect(screen.queryByRole("dialog", { name: "ガイド" })).toBeNull();
  });

  it("各ステップの対象のエリアが画面にある", () => {
    const { container } = render(<App data={program} process={processDef} guideAutoStart={false} />);
    for (const s of GUIDE_STEPS) {
      if (s.target) expect(container.querySelector(`[data-guide="${s.target}"]`)).not.toBeNull();
    }
  });
});
