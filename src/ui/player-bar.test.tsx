import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { program } from "../data";
import { PlayerBar } from "./player-bar";
import { shortName } from "./timeline";
import type { Player } from "./use-player";

function player(over: Partial<Player> = {}): Player {
  return {
    n: 10,
    total: program.timeline.length,
    playing: false,
    speed: 1,
    seek: () => {},
    step: () => {},
    first: () => {},
    last: () => {},
    toggle: () => {},
    setSpeed: () => {},
    ...over,
  } as Player;
}

const show = (over: Partial<Player> = {}) =>
  render(<PlayerBar player={player(over)} timeline={program.timeline} controlPoints={new Map()} nextControl={null} />);

describe("再生バー", () => {
  it("速度はセグメントで選ぶ（押されているものが分かる）", () => {
    show();
    const speed = screen.getByRole("group", { name: "速度" });
    const x1 = within(speed).getByRole("button", { name: "×1" });
    expect(x1).toHaveAttribute("aria-pressed", "true");
    expect(within(speed).getByRole("button", { name: "×4" })).toHaveAttribute("aria-pressed", "false");
  });

  it("速度のセグメントを押すと切り替わる", async () => {
    const seen: number[] = [];
    show({ setSpeed: (s: number) => seen.push(s) });
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "×4" }));
    expect(seen).toEqual([4]);
  });

  it("スライダーの両端に、記録の最初と最後の日付を出す", () => {
    show();
    const first = program.timeline[0]!.event.timestamp.slice(0, 10);
    const last = program.timeline.at(-1)!.event.timestamp.slice(0, 10);
    expect(screen.getByTestId("track-start")).toHaveTextContent(first);
    expect(screen.getByTestId("track-end")).toHaveTextContent(last);
  });

  it("1つ戻る / 1つ進むの字形を揃える", () => {
    show();
    expect(screen.getByRole("button", { name: "1イベント戻る" })).toHaveTextContent("❙◀");
    expect(screen.getByRole("button", { name: "1イベント進む" })).toHaveTextContent("▶❙");
  });
});

describe("履歴のプロジェクト名の略し方", () => {
  it("末尾の語を落として短くする", () => {
    expect(shortName("申請承認ワークフロー")).toBe("申請承認");
    expect(shortName("月次請求書発行")).toBe("月次請求書");
    expect(shortName("受発注連携")).toBe("受発注");
  });

  it("当てはまらない名前はそのまま", () => {
    expect(shortName("社内システム")).toBe("社内システム");
  });
});
