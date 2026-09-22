import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../../data";
import { replay } from "../../replay/replay";
import type { HubEvent } from "../../types/events";
import { ProjectScreen } from "./project";

const project = (id: string) => program.projects.find((p) => p.id === id)!;
const show = (id: string, screenName: string, n?: number) => {
  const p = project(id);
  return render(<ProjectScreen project={p} screen={screenName} state={replay(p.events, processDef, n ?? p.events.length)} process={processDef} />);
};
const afterSpecRevision = (id: string) =>
  project(id).events.findIndex((e: HubEvent) => e.type === "requirements.updated" && (e.payload?.added as string[])?.includes("REQ-011")) + 1;

describe("要求の画面", () => {
  it("要求の登録前（案件は登録済み）は、まだ無いことを示す", () => {
    const k = project("approval-workflow").events.findIndex((e) => e.type === "requirements.updated");
    show("approval-workflow", "requirements", k);
    expect(screen.getByText("要求はまだ登録されていません")).toBeInTheDocument();
  });

  it("REQ-023: その時点の要件と性質を一覧で表示する", () => {
    show("approval-workflow", "requirements");
    const reqs = within(screen.getByRole("table", { name: "要件（REQ）" })).getAllByRole("row").slice(1);
    expect(reqs).toHaveLength(12);
    expect(reqs[0]).toHaveTextContent("REQ-001");
    expect(screen.getByRole("table", { name: "性質（PROP）" })).toHaveTextContent("PROP-001");
  });

  it("AC-011: Spec 改訂の直後は、追加された要件に「追加」が付く", () => {
    show("approval-workflow", "requirements", afterSpecRevision("approval-workflow"));
    const added = within(screen.getByRole("table", { name: "要件（REQ）" }))
      .getAllByRole("row")
      .filter((r) => r.textContent?.includes("追加"));
    expect(added.map((r) => r.textContent?.slice(0, 7))).toEqual(["REQ-011", "REQ-012"]);
  });
});

describe("トレーサビリティの画面", () => {
  it("作成前（案件は登録済み）はまだ無いことを示す", () => {
    const k = project("approval-workflow").events.findIndex((e) => e.type === "traceability.updated");
    show("approval-workflow", "traceability", k);
    expect(screen.getByText("トレーサビリティはまだありません")).toBeInTheDocument();
  });

  it("REQ-024: 要件 ⇔ テスト ⇔ 実装の対応を表示する", () => {
    show("approval-workflow", "traceability");
    const rows = within(screen.getByRole("table", { name: "要件 ⇔ テスト ⇔ 実装" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toHaveTextContent("test_required_levels_by_amount");
    expect(rows[1]).toHaveTextContent("ADR-0001");
  });

  it("AC-012: テストの無い要件を目立たせ、件数を示す。解消後は 0 件", () => {
    show("approval-workflow", "traceability", afterSpecRevision("approval-workflow"));
    const warn = screen.getByRole("status");
    expect(warn).toHaveTextContent("テストが対応していない要件 2 件");
    expect(warn).toHaveTextContent("REQ-011");
    const untraced = within(screen.getByRole("table", { name: "要件 ⇔ テスト ⇔ 実装" }))
      .getAllByRole("row")
      .filter((r) => r.classList.contains("untraced"));
    expect(untraced).toHaveLength(2);
  });

  it("解消後は「すべて対応済み」と示す", () => {
    show("approval-workflow", "traceability");
    expect(screen.getByRole("status")).toHaveTextContent("すべての要件にテストが対応しています");
  });

  it("架空の案件でも同じ表示になる", () => {
    const events = project("order-integration").events;
    const k = events.findIndex((e) => e.type === "traceability.updated") + 1;
    show("order-integration", "traceability", k);
    expect(screen.getByRole("status")).toHaveTextContent("REQ-004");
  });
});
