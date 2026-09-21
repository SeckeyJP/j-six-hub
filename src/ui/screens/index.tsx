import type { HubState } from "../../replay/state";
import type { HubEvent } from "../../types/events";
import type { ProcessDefinition } from "../../types/process";
import { Approvals } from "./approvals";
import { Board } from "./board";
import { Evidence } from "./evidence";
import { Gates } from "./gates";
import { Home } from "./home";
import { Tasks } from "./tasks";

export interface ScreenProps {
  state: HubState;
  events: HubEvent[];
  process: ProcessDefinition;
}

export const ROUTES = [
  { path: "/", label: "案件一覧", component: Home },
  { path: "/board", label: "Phase ボード", component: Board },
  { path: "/tasks", label: "タスク", component: Tasks },
  { path: "/gates", label: "ゲート", component: Gates },
  { path: "/approvals", label: "承認", component: Approvals },
  { path: "/evidence", label: "証跡", component: Evidence },
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
