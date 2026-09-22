import type { ReactNode } from "react";
import type { HubState } from "../../replay/state";
import type { ProjectData } from "../../types/program";
import type { ProcessDefinition } from "../../types/process";
import { SCREENS } from "../labels";
import { Approvals } from "./approvals";
import { Board } from "./board";
import { Evidence } from "./evidence";
import { Gates } from "./gates";
import { Requirements } from "./requirements";
import { Tasks } from "./tasks";
import { Traceability } from "./traceability";

export interface ScreenProps {
  project: ProjectData;
  state: HubState;
  process: ProcessDefinition;
}

const COMPONENTS = {
  board: Board,
  requirements: Requirements,
  tasks: Tasks,
  gates: Gates,
  approvals: Approvals,
  traceability: Traceability,
  evidence: Evidence,
} as const;

export function ProjectScreen({ screen, help, ...props }: ScreenProps & { screen: string; help?: ReactNode }) {
  const def = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];
  const Component = COMPONENTS[def.id];
  return (
    <section aria-labelledby="screen-title" className="project-screen">
      <h2 id="screen-title">
        {props.project.name} — {def.label} {help}
      </h2>
      {props.project.fictional && (
        <p className="fictional-note">このプロジェクトは架空のシナリオです（全イベントが再構成）。複数ベンダーと Interface Contract の統制を説明するために作りました。</p>
      )}
      {!props.state.project ? <p className="muted">このプロジェクトはまだ登録されていません。再生を進めてください。</p> : <Component {...props} />}
    </section>
  );
}
