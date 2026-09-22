import { describe, expect, it } from "vitest";
import { buildHash, parseRoute } from "./route";

describe("parseRoute", () => {
  it("案件一覧", () => {
    expect(parseRoute("/")).toEqual({ kind: "home", n: null });
  });

  it("プロジェクトの画面", () => {
    expect(parseRoute("/p/monthly-billing/gates")).toEqual({ kind: "project", id: "monthly-billing", screen: "gates", n: null });
  });

  it("AC-014: 再生位置を ?n= で受け取る", () => {
    expect(parseRoute("/p/x/board?n=46")).toEqual({ kind: "project", id: "x", screen: "board", n: 46 });
    expect(parseRoute("/?n=7")).toEqual({ kind: "home", n: 7 });
  });

  it("数でない・負の n は無視する", () => {
    expect(parseRoute("/p/x/board?n=abc").n).toBeNull();
    expect(parseRoute("/p/x/board?n=-3").n).toBeNull();
  });
});

describe("buildHash", () => {
  it("再生位置を含む hash を組み立てる", () => {
    expect(buildHash({ kind: "project", id: "x", screen: "board", n: null }, 46)).toBe("#/p/x/board?n=46");
    expect(buildHash({ kind: "home", n: null }, 0)).toBe("#/?n=0");
  });
});
