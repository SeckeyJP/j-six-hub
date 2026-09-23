import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { processDef, program } from "../data";
import { controlPointsOf, narrate } from "../replay/narrate";
import { replay } from "../replay/replay";
import { NowCard } from "./now-card";

const points = controlPointsOf(program, processDef);
const aw = program.projects.find((p) => p.id === "approval-workflow")!;

function show(pred: (k: string) => boolean, onSeek = vi.fn()) {
  const k = aw.events.findIndex((e) => pred(`${aw.id}:${e.id}`));
  const item = program.timeline.find((t) => t.event === aw.events[k])!;
  const n = program.timeline.indexOf(item) + 1;
  const narration = narrate(aw.events[k]!, replay(aw.events, processDef, k), replay(aw.events, processDef, k + 1), processDef);
  render(
    <NowCard
      process={processDef}
      item={item}
      project={aw}
      narration={narration}
      n={n}
      total={program.timeline.length}
      nextControl={n + 5}
      onSeek={onSeek}
    />,
  );
  return { n, onSeek };
}

const band = () => screen.getByTestId("now-band");

describe("いま起きたこと（ヘッダ帯）", () => {
  it("実測の停止では赤帯に元記録の検査停止・未達を出す", () => {
    show((key) => points.get(key)?.includes("gate_stopped") ?? false);
    expect(band()).toHaveTextContent("元記録の検査停止・未達");
    expect(band().className).toContain("band-control");
  });

  it("停止ではない統制記録を、Hub が止めた場面とは表示しない", () => {
    show((key) => points.get(key)?.includes("invalid_approval") ?? false);
    expect(band()).toHaveTextContent("再生モデル上の判定");
    expect(band()).not.toHaveTextContent("Hub が止めた場面");
  });

  it("通常の出来事では「通常の出来事」を出す", () => {
    show((key) => !points.has(key));
    expect(band()).toHaveTextContent("通常の出来事");
    expect(band().className).not.toContain("band-control");
  });

  it("ヘッダ帯に再生位置と時刻を出す", () => {
    const { n } = show((key) => !points.has(key));
    expect(band()).toHaveTextContent(`${n} / ${program.timeline.length}`);
    expect(band()).toHaveTextContent(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  });

  it("統制の場面では「解釈・構想」と、次の停止へ移動する導線を出す", async () => {
    const { onSeek } = show((key) => points.get(key)?.includes("gate_stopped") ?? false);
    const judge = screen.getByTestId("now-judge");
    expect(judge).toHaveTextContent("解釈・構想");
    await userEvent.click(within(judge).getByRole("button", { name: /次の停止/ }));
    expect(onSeek).toHaveBeenCalledWith(expect.any(Number));
  });

  it("再生前は案内を出し、帯は通常の表示にする", () => {
    render(<NowCard item={null} project={null} narration={null} process={processDef} n={0} total={10} nextControl={3} onSeek={vi.fn()} />);
    expect(band()).toHaveTextContent("通常の出来事");
    expect(screen.getByRole("region", { name: "いま起きたこと" })).toHaveTextContent("▶");
  });
});
