import type { ReactNode } from "react";
import type { ProgramState } from "../replay/program";
import type { ProgramData } from "../types/program";
import { SCREENS } from "./labels";
import { FictionalBadge } from "./provenance-badge";
import type { Route } from "./route";
import { alertsOf } from "./screens/home";

/** 左の案件ナビ。案件ごとに Phase の進み具合と注意の数を小さく示す */
export function Sidebar({ data, state, route, help }: { data: ProgramData; state: ProgramState; route: Route; help?: ReactNode }) {
  const selected = route.kind === "project" ? route.id : null;
  return (
    <div className="sidebar" data-guide="projects">
      <nav aria-label="案件">
        <h2>案件 {help}</h2>
        <a href="#/" className="nav-home" aria-current={route.kind === "home" ? "page" : undefined}>
          すべての案件（一覧）
        </a>
        <ul>
          {data.projects.map((p) => {
            const s = state.projects[p.id]!;
            const alerts = alertsOf(s);
            const total = alerts.violations + alerts.stopped + alerts.openDeviations + alerts.invalidApprovals;
            return (
              <li key={p.id} className={selected === p.id ? "selected" : undefined}>
                <a href={`#/p/${p.id}/board`} aria-current={selected === p.id ? "true" : undefined}>
                  <span className="project-name">
                    <span className="project-dot" data-project={p.id} />
                    {p.name}
                  </span>
                  <span className="badge-slot">{p.fictional && <FictionalBadge />}</span>
                  <span className="mini-phases" aria-hidden="true" data-slot="phases">
                    {s.phases.map((ph) => (
                      <span key={ph.id} className={`mini status-${ph.status}`} />
                    ))}
                  </span>
                  {/* 注意が無いときも場所を確保し、再生中に項目の高さを変えない（REQ-022） */}
                  <span className={`alert-count ${total > 0 ? "" : "is-empty"}`} title="注意点の数" data-slot="alerts">
                    ⚑ {total}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      {selected && (
        <nav aria-label="画面" className="screen-nav">
          <h2>この案件の画面</h2>
          {SCREENS.map((sc) => (
            <a key={sc.id} href={`#/p/${selected}/${sc.id}`} aria-current={route.kind === "project" && route.screen === sc.id ? "page" : undefined}>
              {sc.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
