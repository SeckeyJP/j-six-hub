import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";

const TOTAL = program.timeline.length;

afterEach(() => {
  window.location.hash = "";
});

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
}

describe("再生位置の URL（REQ-026）", () => {
  it("AC-014: ?n=46 で開くと 46 件目まで適用した状態になる", () => {
    renderAt("#/p/approval-workflow/board?n=46");
    expect(screen.getByRole("status")).toHaveTextContent(`46 / ${TOTAL}`);
  });

  it("範囲外の n は端に丸める", () => {
    renderAt(`#/?n=${TOTAL + 100}`);
    expect(screen.getByRole("status")).toHaveTextContent(`${TOTAL} / ${TOTAL}`);
  });

  it("再生位置を動かすと URL に反映する", async () => {
    renderAt("#/p/approval-workflow/board");
    await userEvent.click(screen.getByRole("button", { name: "1イベント進む" }));
    expect(window.location.hash).toBe("#/p/approval-workflow/board?n=1");
  });

  it("画面を切り替えても再生位置を保つ", async () => {
    renderAt("#/p/approval-workflow/board?n=46");
    const nav = screen.getByRole("navigation", { name: "画面" });
    await userEvent.click(within(nav).getByRole("link", { name: "承認" }));
    expect(window.location.hash).toContain("n=46");
    expect(screen.getByRole("status")).toHaveTextContent(`46 / ${TOTAL}`);
  });
});
