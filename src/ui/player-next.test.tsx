import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { stopPointsOf } from "../replay/narrate";
import { nextControl } from "./control-nav";

const points = stopPointsOf(program, processDef);

const renderApp = () => {
  window.location.hash = "#/";
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
};

afterEach(() => {
  window.location.hash = "";
});

describe("AC-013: 次の停止へ", () => {
  it("押すと、現在位置より後で最初に品質検査が停止した場面へ移動する", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "次の停止へ" }));
    const expected = nextControl(program.timeline, points, 0)!;
    expect(screen.getByRole("status")).toHaveTextContent(`${expected} / ${program.timeline.length}`);
  });

  it("以降に停止が無ければ押せない", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "末尾へ" }));
    expect(screen.getByRole("button", { name: "次の停止へ" })).toBeDisabled();
  });
});
