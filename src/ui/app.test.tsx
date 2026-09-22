import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";
import { controlPointsOf } from "../replay/narrate";

const TOTAL = program.timeline.length;
const NOTICE = "リプレイ（実際の AI は動作していません）";

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
}

afterEach(() => {
  window.location.hash = "";
});

const ROUTES = ["#/", ...program.projects.flatMap((p) => ["board", "tasks", "gates", "approvals", "evidence"].map((s) => `#/p/${p.id}/${s}`))];

describe("共通レイアウト", () => {
  it.each(ROUTES)("AC-001: %s にリプレイの表示がある", (hash) => {
    renderAt(hash);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("REQ-014: プロセス定義の出典を表示する", () => {
    renderAt("#/");
    const credit = screen.getByText(/CC BY 4.0/);
    expect(credit).toHaveTextContent(processDef._source.tag);
  });

  it("Program が説明用の架空のまとまりであることを示す", () => {
    renderAt("#/");
    expect(screen.getByRole("banner")).toHaveTextContent(program.program.name);
    expect(within(screen.getByRole("banner")).getByText("架空")).toBeInTheDocument();
  });
});

describe("案件のナビゲーション", () => {
  it("左の一覧に全案件があり、選ぶと Phase ボードを開く", async () => {
    renderAt("#/");
    const nav = screen.getByRole("navigation", { name: "案件" });
    for (const p of program.projects) expect(within(nav).getByRole("link", { name: new RegExp(p.name) })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("link", { name: /月次請求書発行/ }));
    expect(window.location.hash).toBe("#/p/monthly-billing/board");
  });

  it("選んだ案件の画面を切り替えられる", async () => {
    renderAt("#/p/approval-workflow/board");
    await userEvent.click(screen.getByRole("link", { name: "承認" }));
    expect(window.location.hash).toBe("#/p/approval-workflow/approvals");
  });

  it("REQ-016: 架空の案件の画面には常に架空と表示する", () => {
    renderAt("#/p/order-integration/board");
    expect(screen.getByRole("main")).toHaveTextContent("この案件は架空のシナリオです");
  });
});

describe("再生操作", () => {
  it("AC-003: 1イベント進めて戻すと、元と同じ表示になる", async () => {
    renderAt("#/p/approval-workflow/board");
    const next = screen.getByRole("button", { name: "1イベント進む" });
    await userEvent.click(next);
    await userEvent.click(next);
    const before = screen.getByRole("main").textContent;
    await userEvent.click(next);
    await userEvent.click(screen.getByRole("button", { name: "1イベント戻る" }));
    expect(screen.getByRole("main").textContent).toBe(before);
  });

  it("キー操作と位置の表示", async () => {
    renderAt("#/");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");
    expect(screen.getByText(`1 / ${TOTAL}`)).toBeInTheDocument();
    await userEvent.keyboard("{End}");
    expect(screen.getByText(`${TOTAL} / ${TOTAL}`)).toBeInTheDocument();
  });

  it("スライダーに統制ポイントの印を付ける", () => {
    renderAt("#/");
    const marks = within(screen.getByRole("group", { name: "再生操作" })).getAllByTestId("control-mark");
    expect(marks).toHaveLength(controlPointsOf(program, processDef).size);
  });
});

describe("いま起きたこと", () => {
  it("REQ-019: 再生位置の出来事を説明し、統制ポイントでは Hub の統制を示す", async () => {
    renderAt("#/");
    const key = [...controlPointsOf(program, processDef).keys()][0]!;
    const index = program.timeline.findIndex((t) => t.key === key) + 1;
    for (let i = 0; i < index; i += 1) await userEvent.keyboard("{ArrowRight}");
    const now = screen.getByRole("region", { name: "いま起きたこと" });
    expect(now).toHaveTextContent("Hub の判断");
  });

  it("再生前は操作の案内を出す", () => {
    renderAt("#/");
    expect(screen.getByRole("region", { name: "いま起きたこと" })).toHaveTextContent("▶");
  });
});
