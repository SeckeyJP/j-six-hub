import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { controlPointsOf } from "../replay/narrate";
import { nextControl } from "./control-nav";

const points = controlPointsOf(program, processDef);

const renderApp = () => {
  window.location.hash = "#/";
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
};

afterEach(() => {
  window.location.hash = "";
});

describe("AC-013: 次の停止へ", () => {
  it("押すと、現在位置より後で最初に Hub が止めた場面へ移動する", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "次の停止へ" }));
    const expected = nextControl(program.timeline, points, 0)!;
    expect(screen.getByText(`${expected} / ${program.timeline.length}`)).toBeInTheDocument();
  });

  it("以降に停止が無ければ押せない", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "末尾へ" }));
    expect(screen.getByRole("button", { name: "次の停止へ" })).toBeDisabled();
  });
});
