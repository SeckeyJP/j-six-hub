import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { events, processDef } from "../../data";
import { replay } from "../../replay/replay";
import { Screen } from ".";

const END = events.length;
const show = (route: string, n: number) =>
  render(<Screen route={route} state={replay(events, processDef, n)} events={events} process={processDef} />);

describe("タスク", () => {
  it("投入前はタスクが無いことを示す", () => {
    show("/tasks", 0);
    expect(screen.getByText("タスクはまだ投入されていません")).toBeInTheDocument();
  });

  it("REQ-007: タスクの状態・工程・サブエージェントの履歴を表示する", () => {
    show("/tasks", END);
    const task = screen.getByRole("region", { name: "TASK-AW-002" });
    expect(task).toHaveTextContent("合格");
    const steps = within(task).getByRole("list", { name: "TDD の工程" });
    const p4 = processDef.phases.find((p) => p.id === "P4")!;
    expect(within(steps).getAllByRole("listitem").map((li) => li.textContent)).toEqual(p4.steps);
    const agents = within(task).getByRole("table", { name: "サブエージェントの実行" });
    for (const a of ["holdout-test-writer", "red-agent", "green-agent", "refactor-agent", "scope-judge"]) {
      expect(agents).toHaveTextContent(a);
    }
  });

  it("ゲートの判定記録が無いタスクはそのことを示す", () => {
    show("/tasks", END);
    expect(screen.getByRole("region", { name: "2026-06 初版 / ID なし" })).toHaveTextContent("ゲート記録なし");
  });
});

describe("ゲート", () => {
  it("判定前は判定が無いことを示す", () => {
    show("/gates", 0);
    expect(screen.getByText("ゲートの判定はまだありません")).toBeInTheDocument();
  });

  it("REQ-008: 判定ごとに起動元・結果・回数・層とチェックの結果を表示する", () => {
    show("/gates", END);
    const blocked = screen
      .getAllByRole("article")
      .find((a) => a.textContent?.includes("traceability") && a.textContent.includes("ブロック"))!;
    expect(blocked).toBeDefined();
    expect(blocked).toHaveTextContent("15 回");
    expect(blocked).toHaveTextContent("Stop hook");
    const layerName = processDef.gates.find((g) => g.id === "task_quality_gate")!.layers.find((l) => l.id === "G2")!.name;
    expect(blocked).toHaveTextContent(`G2 ${layerName}`);
    expect(blocked).toHaveTextContent("❌ 未達");
  });
});

describe("承認", () => {
  it("REQ-009: 無効な承認を理由とともに区別する", () => {
    show("/approvals", END);
    const rows = within(screen.getByRole("table", { name: "承認の記録" })).getAllByRole("row").slice(1);
    const aiRows = rows.filter((r) => r.textContent?.includes("AI"));
    expect(aiRows.length).toBe(2);
    for (const r of aiRows) {
      expect(r).toHaveTextContent("無効");
      expect(r).toHaveTextContent("人間");
    }
    expect(rows.filter((r) => r.textContent?.includes("有効")).length).toBeGreaterThan(0);
  });

  it("承認ごとに実測／再構成を示す", () => {
    show("/approvals", END);
    const rows = within(screen.getByRole("table", { name: "承認の記録" })).getAllByRole("row").slice(1);
    for (const r of rows) expect(r.textContent).toMatch(/実測|再構成/);
  });
});

describe("証跡", () => {
  it("生成前は証跡パッケージが無いことを示す", () => {
    show("/evidence", 0);
    expect(screen.getByText("証跡パッケージはまだ生成されていません")).toBeInTheDocument();
  });

  it("REQ-012: 生成結果と J-SIX のファイルへのリンク、承認の状況を表示する", () => {
    show("/evidence", END);
    const pack = screen.getByRole("article", { name: "TASK-AW-002 の証跡パッケージ" });
    expect(pack).toHaveTextContent("通過");
    const link = within(pack).getByRole("link", { name: /J-SIX リポジトリで開く/ });
    expect(link.getAttribute("href")).toMatch(
      /^https:\/\/github\.com\/SeckeyJP\/j-six\/tree\/[0-9a-f]{7}\/examples\/approval-workflow\/reports\/evidence\/TASK-AW-002$/,
    );
    const approval = screen.getByRole("region", { name: "品質基準達成判定" });
    expect(approval).toHaveTextContent("承認済み");
  });
});
