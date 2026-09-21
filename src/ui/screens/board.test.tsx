import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { events, processDef } from "../../data";
import { replay } from "../../replay/replay";
import type { HubEvent } from "../../types/events";
import { Screen } from ".";

const at = (n: number) => replay(events, processDef, n);
const nOf = (pred: (e: HubEvent) => boolean) => events.findIndex(pred) + 1;

function show(route: string, n: number) {
  return render(<Screen route={route} state={at(n)} events={events} process={processDef} />);
}

describe("案件一覧", () => {
  it("登録前は案件が無いことを示す", () => {
    show("/", 0);
    expect(screen.getByText("案件はまだ登録されていません")).toBeInTheDocument();
  });

  it("REQ-013: 案件・プロセス定義の版・実測と再構成の件数を示す", () => {
    show("/", events.length);
    const card = screen.getByRole("article", { name: "approval-workflow" });
    expect(card).toHaveTextContent("process-v0.1.0");
    const measured = events.filter((e) => e.provenance === "measured").length;
    expect(card).toHaveTextContent(`実測 ${measured} 件`);
    expect(card).toHaveTextContent(`再構成 ${events.length - measured} 件`);
    expect(within(card).getByRole("link", { name: "Phase ボードを開く" })).toHaveAttribute("href", "#/board");
  });
});

describe("Phase ボード", () => {
  it("AC-006: Phase 名とゲート名がプロセス定義と一致する", () => {
    show("/board", 0);
    const cols = screen.getAllByRole("region", { name: /^P\d/ });
    expect(cols.map((c) => within(c).getByRole("heading").textContent)).toEqual(
      processDef.phases.map((p) => `${p.id} ${p.name}`),
    );
    for (const p of processDef.phases) {
      const col = screen.getByRole("region", { name: new RegExp(`^${p.id} `) });
      const gate = processDef.gates.find((g) => g.id === p.gate);
      expect(col).toHaveTextContent(gate ? gate.name : "ゲートなし");
    }
  });

  it("P4 のゲートの層をプロセス定義から表示する", () => {
    show("/board", 0);
    const p4 = screen.getByRole("region", { name: /^P4 / });
    const gate = processDef.gates.find((g) => g.phase === "P4")!;
    for (const layer of gate.layers) expect(p4).toHaveTextContent(`${layer.id} ${layer.name}`);
  });

  it("状態を日本語で表示する", () => {
    show("/board", events.length);
    expect(screen.getByRole("region", { name: /^P1 / })).toHaveTextContent("承認済み");
    expect(screen.getByRole("region", { name: /^P0 / })).toHaveTextContent("進行中");
  });

  it("REQ-010: 逆戻りで開き直した Phase と、開いている逸脱を表示する", () => {
    show("/board", nOf((e) => e.type === "deviation.opened" && e.payload?.deviation === "phase_rollback"));
    expect(screen.getByRole("region", { name: /^P3 / })).toHaveTextContent("逆戻りで再開");
    const open = screen.getByRole("region", { name: "開いている逸脱" });
    expect(open).toHaveTextContent("Phase 逆戻り");
  });

  it("REQ-011: 順序違反を表示する", () => {
    show("/board", events.length);
    const v = screen.getByRole("region", { name: "順序違反" });
    expect(v).toHaveTextContent("P6");
    expect(v).toHaveTextContent("P5");
  });

  it("順序違反が無ければ、無いことを示す", () => {
    show("/board", 5);
    expect(screen.getByRole("region", { name: "順序違反" })).toHaveTextContent("なし");
  });
});
