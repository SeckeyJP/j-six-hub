import type { HubState } from "../../replay/state";
import type { HubEvent } from "../../types/events";
import type { ProcessDefinition } from "../../types/process";
import { Board } from "./board";
import { Home } from "./home";

export interface ScreenProps {
  state: HubState;
  events: HubEvent[];
  process: ProcessDefinition;
}

export const ROUTES = [
  { path: "/", label: "案件一覧", component: Home },
  { path: "/board", label: "Phase ボード", component: Board },
  { path: "/tasks", label: "タスク", component: Placeholder },
  { path: "/gates", label: "ゲート", component: Placeholder },
  { path: "/approvals", label: "承認", component: Placeholder },
  { path: "/evidence", label: "証跡", component: Placeholder },
] as const;

export function Screen({ route, ...props }: ScreenProps & { route: string }) {
  const r = ROUTES.find((x) => x.path === route) ?? ROUTES[0];
  const Component = r.component;
  return (
    <section aria-labelledby="screen-title">
      <h2 id="screen-title">{r.label}</h2>
      <Component {...props} />
    </section>
  );
}

function Placeholder({ state }: ScreenProps) {
  return <p>{state.n} 件目までを適用した状態</p>;
}
