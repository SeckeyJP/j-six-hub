import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../../data";
import { replay } from "../../replay/replay";
import { replayProgram } from "../../replay/program";
import { Home } from "./home";
import { ProjectScreen } from "./project";

const END = program.timeline.length;
const project = (id: string) => program.projects.find((p) => p.id === id)!;
const showProject = (id: string, screenName: string, n?: number) => {
  const p = project(id);
  return render(<ProjectScreen project={p} screen={screenName} state={replay(p.events, processDef, n ?? p.events.length)} process={processDef} />);
};

describe("案件一覧（Program の概観）", () => {
  it("AC-007: 3件の案件を並べ、架空の案件に架空と表示する", () => {
    render(<Home data={program} state={replayProgram(program, processDef, END)} process={processDef} />);
    const cards = screen.getAllByRole("article");
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(program.projects.map((p) => p.name));
    expect(within(cards[2]!).getByText("架空")).toBeInTheDocument();
    expect(within(cards[0]!).queryByText("架空")).toBeNull();
  });

  it("各案件の進み具合（Phase ごと）と注意点を示す", () => {
    render(<Home data={program} state={replayProgram(program, processDef, END)} process={processDef} />);
    const aw = screen.getByRole("article", { name: "申請承認ワークフロー" });
    expect(within(aw).getAllByTestId("phase-seg")).toHaveLength(processDef.phases.length);
    expect(aw).toHaveTextContent("順序違反 1");
    const oi = screen.getByRole("article", { name: "受発注連携" });
    expect(oi).toHaveTextContent("ゲートで停止");
  });

  it("登録前の案件は未登録と示す", () => {
    render(<Home data={program} state={replayProgram(program, processDef, 0)} process={processDef} />);
    expect(screen.getAllByText("まだ登録されていません")).toHaveLength(program.projects.length);
  });
});

describe("Phase ボード", () => {
  it("AC-006: Phase 名とゲート名がプロセス定義と一致する", () => {
    showProject("approval-workflow", "board");
    const cols = screen.getAllByRole("region", { name: /^P\d/ });
    expect(cols.map((c) => within(c).getByRole("heading").textContent)).toEqual(processDef.phases.map((p) => `${p.id} ${p.name}`));
    for (const p of processDef.phases) {
      const gate = processDef.gates.find((g) => g.id === p.gate);
      expect(screen.getByRole("region", { name: new RegExp(`^${p.id} `) })).toHaveTextContent(gate ? gate.name : "ゲートなし");
    }
  });

  it("順序違反と開いている逸脱を示す", () => {
    showProject("approval-workflow", "board");
    expect(screen.getByRole("region", { name: "順序違反" })).toHaveTextContent("P5");
  });
});

describe("タスク", () => {
  it("担当のチームと状態、TDD の工程を示す", () => {
    showProject("order-integration", "tasks");
    const t = screen.getByRole("region", { name: /TASK-OI-002/ });
    expect(t).toHaveTextContent("ベンダー B");
    expect(t).toHaveTextContent("合格");
  });

  it("途中ではエスカレーション中・ローカル退避中を示す", () => {
    const p = project("order-integration");
    const k = p.events.findIndex((e) => e.type === "deviation.opened" && e.payload?.deviation === "local_fallback") + 1;
    showProject("order-integration", "tasks", k);
    expect(screen.getByRole("region", { name: /TASK-OI-001/ })).toHaveTextContent("ローカル作業へ切替");
  });
});

describe("ゲート・承認・証跡", () => {
  it("ゲートの停止を層とチェックごとに示す", () => {
    showProject("monthly-billing", "gates");
    const stopped = screen.getAllByRole("article").find((a) => a.textContent?.includes("許可範囲外"));
    expect(stopped).toBeDefined();
  });

  it("AI が書き込んだ承認を無効と示す", () => {
    showProject("approval-workflow", "approvals");
    const rows = within(screen.getByRole("table", { name: "承認の記録" })).getAllByRole("row").slice(1);
    expect(rows.filter((r) => r.textContent?.includes("無効"))).toHaveLength(2);
  });

  it("実データの案件は J-SIX の証跡へリンクし、架空の案件はファイルが無いことを示す", () => {
    showProject("monthly-billing", "evidence");
    expect(screen.getByRole("link", { name: /J-SIX リポジトリで開く/ }).getAttribute("href")).toMatch(
      /examples\/monthly-billing\/reports\/evidence\/TASK-MB-007$/,
    );
  });
});
