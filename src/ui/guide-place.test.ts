import { describe, expect, it } from "vitest";
import { GUIDE_STEPS, placeBubble, resolveSide } from "./guide";

const rect = (top: number, height: number, left = 0, width = 300) =>
  ({ top, height, left, width, right: left + width, bottom: top + height }) as DOMRect;

describe("吹き出しの向き", () => {
  it("広い画面では、ステップに決めた向きを使う", () => {
    for (const s of GUIDE_STEPS) expect(resolveSide(rect(100, 200), { width: 1440, height: 900 }, s.side)).toBe(s.side);
  });

  it("狭い画面では左右に出さず、対象の下（入らなければ上）に出す", () => {
    const vp = { width: 390, height: 844 };
    expect(resolveSide(rect(60, 200), vp, "right")).toBe("below");
    expect(resolveSide(rect(600, 200), vp, "left")).toBe("above");
  });

  it("上にも下にも入らない場合は、対象に重ならない側（広い方）に出す", () => {
    const vp = { width: 390, height: 500 };
    expect(resolveSide(rect(250, 200), vp, "right")).toBe("above");
    expect(resolveSide(rect(0, 200), vp, "right")).toBe("below");
  });

  it("対象が画面より大きいときは、下端に寄せて対象の上部を見せる", () => {
    const vp = { width: 390, height: 844 };
    const tall = rect(100, 700);
    expect(resolveSide(tall, vp, "left")).toBe("below");
    const pos = placeBubble(tall, vp, "below");
    expect(pos.top + pos.height).toBeLessThanOrEqual(vp.height - 8);
  });
});

describe("吹き出しの位置", () => {
  const vp = { width: 390, height: 844 };

  it("画面からはみ出さない", () => {
    for (const side of ["below", "above", "left", "right"] as const) {
      const pos = placeBubble(rect(100, 200, 10, 370), vp, side);
      expect(pos.left).toBeGreaterThanOrEqual(8);
      expect(pos.left + pos.width).toBeLessThanOrEqual(vp.width - 8);
      expect(pos.top).toBeGreaterThanOrEqual(8);
    }
  });

  it("幅は画面に収め、広い画面では既定の幅にする", () => {
    expect(placeBubble(rect(100, 100), vp, "below").width).toBeLessThanOrEqual(vp.width - 16);
    expect(placeBubble(rect(100, 100), { width: 320, height: 640 }, "below").width).toBe(304);
    expect(placeBubble(rect(100, 100), { width: 1440, height: 900 }, "below").width).toBe(352);
  });

  it("下に出すときは対象の下、上に出すときは対象の上に置く", () => {
    const r = rect(300, 120);
    expect(placeBubble(r, vp, "below").top).toBeGreaterThanOrEqual(r.bottom);
    const above = placeBubble(r, vp, "above");
    expect(above.top + above.height).toBeLessThanOrEqual(r.top);
  });

  it("対象が無いときも画面内に置く", () => {
    const pos = placeBubble(null, vp, "below");
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.left).toBeGreaterThanOrEqual(8);
  });
});

describe("ガイドの文言", () => {
  it("配置に依存する言葉（左・右・下の）を使わない", () => {
    for (const s of GUIDE_STEPS) {
      expect(s.text, s.id).not.toMatch(/左|右|下の|上の/);
    }
  });
});
