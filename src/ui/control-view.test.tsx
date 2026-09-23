import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app";
import { processDef, program } from "../data";

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(<App data={program} process={processDef} guideAutoStart={false} />);
}

afterEach(() => {
  window.location.hash = "";
});

const card = (container: HTMLElement, phase: string) =>
  [...container.querySelectorAll(".phase-card")].find((c) => c.querySelector(".phase-id")?.textContent === phase) as HTMLElement;

describe("工程ボードのカードに統制を出す", () => {
  it("その工程の検査停止・未達の件数を出す", () => {
    const { container } = renderAt("#/p/monthly-billing/board?n=176");
    const p4 = card(container, "P4");
    expect(within(p4).getByTestId("mark-stopped")).toHaveTextContent(/検査で停止 \d+/);
  });

  it("順序違反のあった工程に印を付ける", () => {
    const { container } = renderAt("#/p/monthly-billing/board?n=176");
    const marked = [...container.querySelectorAll(".phase-card")].filter((c) => {
      const m = c.querySelector('[data-testid="mark-violation"]');
      return m !== null && !m.className.includes("is-empty");
    });
    expect(marked.length).toBeGreaterThan(0);
  });

  it("いまの工程に「いまここ」を出す（1つだけ）", () => {
    const { container } = renderAt("#/p/approval-workflow/board?n=46");
    const here = [...container.querySelectorAll('[data-testid="mark-here"]')].filter((e) => !e.className.includes("is-empty"));
    expect(here).toHaveLength(1);
  });

  it("件数が 0 でも欄を残す（高さを変えない。REQ-022）", () => {
    const early = renderAt("#/p/monthly-billing/board?n=100").container;
    const late = renderAt("#/p/monthly-billing/board?n=176").container;
    const slots = (c: HTMLElement) => [...c.querySelectorAll(".phase-card")].map((x) => x.querySelector('[data-slot="marks"]')!.children.length);
    expect(slots(early)).toEqual(slots(late));
  });
});

describe("順序違反から履歴へ", () => {
  it("出来事の ID を押すと、履歴のその行が開く", async () => {
    const { container } = renderAt("#/p/monthly-billing/board?n=176");
    const link = within(container).getByRole("button", { name: /ev-\d+/ });
    const id = link.textContent!.trim();
    await userEvent.setup({ delay: null }).click(link);
    const row = screen.getByTestId(`event-monthly-billing:${id}`);
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("いま起きたことの meta", () => {
  it("Phase は記号と名前で出す", () => {
    renderAt("#/p/approval-workflow/board?n=46");
    const meta = screen.getByRole("region", { name: "いま起きたこと" }).querySelector('[data-slot="meta"]')!;
    expect(meta.textContent).toContain("P1 要求の合意");
  });

  it("実行者を出す", () => {
    renderAt("#/p/approval-workflow/board?n=46");
    const meta = screen.getByRole("region", { name: "いま起きたこと" }).querySelector('[data-slot="meta"]')!;
    expect(meta.querySelector('[data-testid="meta-actor"]')!.textContent).toMatch(/人間|AI|システム/);
  });
});
