import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { processDef, program } from "../data";
import { controlPointsOf, narrate } from "../replay/narrate";
import { replay } from "../replay/replay";
import { replayProgram } from "../replay/program";
import { NowCard } from "./now-card";
import { Sidebar } from "./sidebar";
import { Home } from "./screens/home";
import { ProjectScreen } from "./screens/project";

// REQ-022: 再生中に配置が動かないよう、出来事の内容に依らず同じ構造で描画する。
// 高さそのものは jsdom では測れないため、ここでは構造（欄の有無）が変わらないことを確かめ、
// 実際の位置・大きさは公開前にブラウザで計測する（TASK-HUB-011）。

const shape = (el: Element) => [...el.querySelectorAll("[data-slot]")].map((e) => e.getAttribute("data-slot"));

describe("いま起きたこと", () => {
  const aw = program.projects[0]!;
  const points = controlPointsOf(program, processDef);
  const renderAt = (k: number) => {
    const item = program.timeline.find((t) => t.project === aw.id && t.event === aw.events[k])!;
    const n = narrate(aw.events[k]!, replay(aw.events, processDef, k), replay(aw.events, processDef, k + 1), processDef);
    return render(<NowCard item={item} project={aw} narration={n} />).container;
  };

  it("再生前・通常の出来事・統制ポイントで、欄の構成が同じ", () => {
    const empty = render(<NowCard item={null} project={null} narration={null} />).container;
    const normal = renderAt(aw.events.findIndex((e) => e.type === "commit.created"));
    const controlIndex = aw.events.findIndex((e) => points.has(`${aw.id}:${e.id}`));
    const control = renderAt(controlIndex);
    expect(shape(empty)).toEqual(["meta", "headline", "detail", "hub"]);
    expect(shape(normal)).toEqual(shape(empty));
    expect(shape(control)).toEqual(shape(empty));
  });

  it("全文は title で読める", () => {
    const k = aw.events.findIndex((e) => points.has(`${aw.id}:${e.id}`));
    const c = renderAt(k);
    expect(c.querySelector('[data-slot="hub"]')!.getAttribute("title")).toMatch(/Hub/);
  });
});

describe("案件ナビと案件カード", () => {
  const stateAt = (n: number) => replayProgram(program, processDef, n);

  it("登録前と最後で、ナビの項目の欄が同じ", () => {
    const route = { kind: "home" } as const;
    const before = render(<Sidebar data={program} state={stateAt(0)} route={route} />).container;
    const after = render(<Sidebar data={program} state={stateAt(program.timeline.length)} route={route} />).container;
    expect(shape(before)).toEqual(shape(after));
  });

  it("登録前と最後で、案件カードの欄が同じ", () => {
    const before = render(<Home data={program} state={stateAt(0)} process={processDef} />).container;
    const after = render(<Home data={program} state={stateAt(program.timeline.length)} process={processDef} />).container;
    expect(shape(before)).toEqual(shape(after));
  });
});

describe("Phase ボード", () => {
  it("逆戻りの前後で、Phase カードの欄が同じ", () => {
    const aw = program.projects[0]!;
    const k = aw.events.findIndex((e) => e.type === "deviation.opened" && e.payload?.deviation === "phase_rollback");
    const at = (n: number) =>
      render(<ProjectScreen project={aw} screen="board" state={replay(aw.events, processDef, n)} process={processDef} />).container;
    expect(shape(at(k))).toEqual(shape(at(k + 1)));
    expect(shape(at(k + 1))).toContain("reopened");
  });
});

describe("いま起きたことの案内文", () => {
  it("配置に依存する言葉を使わない", () => {
    const { container } = render(<NowCard item={null} project={null} narration={null} />);
    expect(container.querySelector('[data-slot="headline"]')!.textContent).not.toMatch(/下の|右の|左の/);
  });
});
