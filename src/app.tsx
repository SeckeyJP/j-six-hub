import { useEffect, useMemo } from "react";
import { replay } from "./replay/replay";
import type { HubEvent } from "./types/events";
import type { ProcessDefinition } from "./types/process";
import { EventList } from "./ui/event-list";
import { ReplayControls } from "./ui/replay-controls";
import { ROUTES, Screen } from "./ui/screens";
import { useHashRoute } from "./ui/use-hash-route";
import { usePlayer, type Player } from "./ui/use-player";

export const REPLAY_NOTICE = "リプレイ（実際の AI は動作していません）";

export function App({ events, process }: { events: HubEvent[]; process: ProcessDefinition }) {
  const player = usePlayer(events.length);
  const route = useHashRoute();
  const state = useMemo(() => replay(events, process, player.n), [events, process, player.n]);
  useKeyboard(player);

  return (
    <div className="app">
      <header>
        <h1>J-SIX Hub</h1>
        <p className="replay-notice" role="note">
          {REPLAY_NOTICE}
        </p>
        <ReplayControls player={player} />
        <nav aria-label="画面">
          {ROUTES.map((r) => (
            <a key={r.path} href={`#${r.path}`} aria-current={route === r.path ? "page" : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <Screen route={route} state={state} events={events} process={process} />
      </main>
      <EventList events={events} n={player.n} />
      <footer>
        <p>
          Phase・ゲートの定義: J-SIX プロセス定義 {process._source.tag}（{process._source.repository}、{process._source.license}）。
          イベント: J-SIX examples/approval-workflow の実行記録から抽出した実測と、記録の無い部分を組み立てた再構成。
        </p>
      </footer>
    </div>
  );
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
