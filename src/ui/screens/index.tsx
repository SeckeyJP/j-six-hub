import type { HubState } from "../../replay/state";
import type { HubEvent } from "../../types/events";
import type { ProcessDefinition } from "../../types/process";

export interface ScreenProps {
  state: HubState;
  events: HubEvent[];
  process: ProcessDefinition;
}

export const ROUTES = [
  { path: "/", label: "案件一覧" },
  { path: "/board", label: "Phase ボード" },
  { path: "/tasks", label: "タスク" },
  { path: "/gates", label: "ゲート" },
  { path: "/approvals", label: "承認" },
  { path: "/evidence", label: "証跡" },
] as const;

export function Screen({ route, ...props }: ScreenProps & { route: string }) {
  const r = ROUTES.find((x) => x.path === route) ?? ROUTES[0];
  return (
    <section aria-labelledby="screen-title">
      <h2 id="screen-title">{r.label}</h2>
      <p>
        {props.state.n} 件目までを適用した状態（{props.state.iteration ?? "開始前"}）
      </p>
    </section>
  );
}
