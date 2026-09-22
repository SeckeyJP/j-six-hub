import { useEffect, useMemo } from "react";
import { controlPointsOf, highlightKey, narrate } from "./replay/narrate";
import { replayProgram } from "./replay/program";
import { replay } from "./replay/replay";
import type { ProgramData } from "./types/program";
import type { ProcessDefinition } from "./types/process";
import type { Route } from "./ui/route";
import { firstHighlight, nextControl } from "./ui/control-nav";
import { HelpTip, Tour, useGuide } from "./ui/guide";
import { HISTORY_SCREEN } from "./ui/labels";
import { NowCard } from "./ui/now-card";
import { PlayerBar } from "./ui/player-bar";
import { FictionalBadge } from "./ui/provenance-badge";
import { buildHash, parseRoute } from "./ui/route";
import { Home } from "./ui/screens/home";
import { ProjectScreen } from "./ui/screens/project";
import { Sidebar } from "./ui/sidebar";
import { Timeline } from "./ui/timeline";
import { useHashRoute } from "./ui/use-hash-route";
import { usePlayer, type Player } from "./ui/use-player";

export const REPLAY_NOTICE = "リプレイ（実際の AI は動作していません）";

export interface AppProps {
  data: ProgramData;
  process: ProcessDefinition;
  /** 初回表示でガイドツアーを始めるか（テストでは止める） */
  guideAutoStart?: boolean;
}

export function App({ data, process, guideAutoStart = true }: AppProps) {
  const hash = useHashRoute();
  const route = parseRoute(hash);
  const player = usePlayer(data.timeline.length, route.n);
  const guide = useGuide(guideAutoStart);
  useUrlPosition(route, player.n);
  const state = useMemo(() => replayProgram(data, process, player.n), [data, process, player.n]);
  const controlPoints = useMemo(() => controlPointsOf(data, process), [data, process]);
  const nextStop = useMemo(() => nextControl(data.timeline, controlPoints, player.n), [data.timeline, controlPoints, player.n]);
  const highlight = useMemo(() => firstHighlight(data.timeline, controlPoints, highlightKey(data, process)), [data, process, controlPoints]);
  useKeyboard(player);

  const current = state.current;
  const currentProject = current ? (data.projects.find((p) => p.id === current.project) ?? null) : null;
  const narration = useMemo(() => {
    if (!current || !currentProject) return null;
    const k = currentProject.events.indexOf(current.event);
    return narrate(current.event, replay(currentProject.events, process, k), state.projects[current.project]!, process);
  }, [current, currentProject, process, state]);

  const selected = route.kind === "project" ? data.projects.find((p) => p.id === route.id) : undefined;
  // 狭い画面では右の欄を出さず、履歴を本文として開く（REQ-028）
  const historyView = route.kind === "project" && route.screen === HISTORY_SCREEN;
  const timeline = (
    <Timeline
      data={data}
      process={process}
      n={player.n}
      controlPoints={controlPoints}
      projectId={selected?.id ?? null}
      inMain={historyView}
      help={<HelpTip id="timeline" />}
      legendHelp={<HelpTip id="legend" />}
    />
  );

  return (
    <div className="shell">
      <header className="topbar">
        <p className="brand">
          <span className="logo">◆</span> J-SIX Hub
        </p>
        <p className="replay-notice" role="note">
          {REPLAY_NOTICE}
        </p>
        <p className="tagline" data-testid="tagline">
          AI エージェントの開発を、工程・品質検査・承認で統制する管理画面
        </p>
        <p className="program">
          <span data-testid="program-name">{data.program.name}</span> <FictionalBadge />
        </p>
        <button type="button" className="guide-button" onClick={guide.start} aria-label="使い方を開く">
          ？ 使い方
        </button>
      </header>
      <Sidebar data={data} state={state} route={route} help={<HelpTip id="projects" />} />
      <main>
        <NowCard
          item={current}
          project={currentProject}
          narration={narration}
          n={player.n}
          total={data.timeline.length}
          nextControl={nextStop}
          onSeek={player.seek}
          help={<HelpTip id="now" />}
        />
        <div data-guide="screen">
          {historyView ? (
            timeline
          ) : selected ? (
            <ProjectScreen
              project={selected}
              screen={route.kind === "project" ? route.screen : "board"}
              state={state.projects[selected.id]!}
              process={process}
              help={<HelpTip id="screen" />}
            />
          ) : (
            <section aria-labelledby="screen-title">
              <h2 id="screen-title">
                すべてのプロジェクト <HelpTip id="screen" />
              </h2>
              <Home data={data} state={state} process={process} />
            </section>
          )}
        </div>
        <p className="credit">
          Phase・ゲートの定義: J-SIX プロセス定義 {process._source.tag}（{process._source.repository}、{process._source.license}）。
          出来事: J-SIX の examples（approval-workflow・monthly-billing）の実行記録から抽出した実測と、記録の無い部分を組み立てた再構成。受発注連携は架空。
        </p>
      </main>
      {!historyView && timeline}
      <footer className="playerbar">
        <PlayerBar player={player} timeline={data.timeline} controlPoints={controlPoints} nextControl={nextStop} help={<HelpTip id="player" />} />
      </footer>
      <Tour guide={guide} highlight={highlight} onSeek={player.seek} />
    </div>
  );
}

/** 再生位置を URL に反映する（履歴は汚さない。REQ-026） */
function useUrlPosition(route: Route, n: number): void {
  useEffect(() => {
    const next = buildHash(route, n);
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [route, n]);
}

/** Space: 再生／一時停止、← →: 1件、Home / End: 先頭 / 末尾。入力欄・ボタンにフォーカスがあるときは使わない */
function useKeyboard(player: Player) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") return;
      const actions: Record<string, () => void> = {
        " ": player.toggle,
        ArrowRight: () => player.step(1),
        ArrowLeft: () => player.step(-1),
        Home: player.first,
        End: player.last,
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);
}
