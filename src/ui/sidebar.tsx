import type { ReactNode } from "react";
import type { ProgramState } from "../replay/program";
import type { HubState } from "../replay/state";
import type { ProgramData } from "../types/program";
import { HISTORY_SCREEN, PHASE_STATUS, SCREENS } from "./labels";
import { FictionalBadge } from "./provenance-badge";
import type { Route } from "./route";
import { alertsOf } from "./screens/home";

/** 狭い画面では履歴を右の欄ではなく別画面として開く（広い画面ではチップを出さない） */
const SCREEN_LINKS = [...SCREENS, { id: HISTORY_SCREEN, label: "履歴" }];

/** 画面ごとに添える件数（0 のときは出さない） */
function screenCount(id: string, s: HubState): number {
  if (id === "traceability") return s.traceability.untraced.length;
  if (id === "gates") return alertsOf(s).stopped;
  if (id === "approvals") return s.approvals.filter((a) => !a.valid).length;
  return 0;
}

function currentLine(p: { events: unknown[] }, s: HubState, measured: number): string {
  const phase = [...s.phases].reverse().find((x) => x.status === "in_progress" && x.mode !== "continuous")
    ?? [...s.phases].reverse().find((x) => x.status !== "not_started");
  const where = phase ? `${phase.id} ${phase.name} ${PHASE_STATUS[phase.status]}` : "未登録";
  return `${where} ・ 実測 ${measured}/${p.events.length}`;
}

/** 左のプロジェクトナビ。工程の進み具合と、検査停止・未達の回数を添える */
export function Sidebar({ data, state, route, help }: { data: ProgramData; state: ProgramState; route: Route; help?: ReactNode }) {
  const selected = route.kind === "project" ? route.id : null;
  const selectedState = selected ? state.projects[selected] : undefined;
  return (
    <div className="sidebar" data-guide="projects">
      <nav aria-label="プロジェクト">
        <h2>プロジェクト {help}</h2>
        <a href="#/" className="nav-home" aria-current={route.kind === "home" ? "page" : undefined}>
          ← 全プロジェクト一覧
        </a>
        <ul>
          {data.projects.map((p) => {
            const s = state.projects[p.id]!;
            const stopped = alertsOf(s).stopped;
            const measured = p.events.filter((e) => e.provenance === "measured").length;
            return (
              <li key={p.id} className={selected === p.id ? "selected" : undefined}>
                <a href={`#/p/${p.id}/board`} aria-current={selected === p.id ? "true" : undefined}>
                  <span className="project-head">
                    <span className="project-name">
                      <span className="project-dot" data-project={p.id} />
                      {p.name}
                    </span>
                    {/* 0 件でも場所を確保し、再生中に高さを変えない（REQ-022） */}
                    <span className={`stop-badge ${stopped > 0 ? "" : "is-empty"}`} data-testid="stop-badge">
                      停止 {stopped}
                    </span>
                  </span>
                  <span className="badge-slot">{p.fictional && <FictionalBadge />}</span>
                  <span className="mini-phases" aria-hidden="true" data-slot="phases">
                    {s.phases.map((ph) => (
                      <span key={ph.id} className={`mini status-${ph.status}`} />
                    ))}
                  </span>
                  <span className="project-line" data-slot="line">
                    {currentLine(p, s, measured)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      {selected && selectedState && (
        <nav aria-label="画面" className="screen-nav">
          <h2>{data.projects.find((p) => p.id === selected)?.name} の画面</h2>
          {SCREEN_LINKS.map((sc) => {
            const count = screenCount(sc.id, selectedState);
            return (
              <a
                key={sc.id}
                href={`#/p/${selected}/${sc.id}`}
                className={sc.id === HISTORY_SCREEN ? "to-history" : undefined}
                aria-current={route.kind === "project" && route.screen === sc.id ? "page" : undefined}
              >
                <span>{sc.label}</span>
                {count > 0 && <span className="screen-count">{count}</span>}
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}
