import type { ProgramState } from "../../replay/program";
import type { HubState } from "../../replay/state";
import type { ProgramData } from "../../types/program";
import type { ProcessDefinition } from "../../types/process";
import { PHASE_STATUS } from "../labels";
import { FictionalBadge } from "../provenance-badge";

export interface Alerts {
  violations: number;
  stopped: number;
  openDeviations: number;
  invalidApprovals: number;
}

export function alertsOf(s: HubState): Alerts {
  return {
    violations: s.violations.length,
    stopped: s.evaluations.filter((e) => e.outcome === "blocked" || e.outcome === "failed").length,
    openDeviations: s.deviations.filter((d) => d.closedBy === null).length,
    invalidApprovals: s.approvals.filter((a) => !a.valid).length,
  };
}

/** プロジェクト一覧（Program の概観。REQ-013, REQ-015） */
export function Home({ data, state, process }: { data: ProgramData; state: ProgramState; process: ProcessDefinition }) {
  return (
    <div className="home">
      <p className="lead">
        Hub は、複数のプロジェクトの工程（Phase）・承認・品質検査・監査記録を横断して管理します。
        プロジェクトをまたいで「どこまで進んだか」「どこで Hub が止めたか」を一目で見られます。
      </p>
      <div className="project-cards">
        {data.projects.map((p) => {
          const s = state.projects[p.id]!;
          const a = alertsOf(s);
          const measured = p.events.filter((e) => e.provenance === "measured").length;
          const currentPhase = [...s.phases].reverse().find((ph) => ph.status !== "not_started");
          return (
            <article key={p.id} aria-label={p.name} className={`project-card ${p.fictional ? "fictional" : ""}`} data-project={p.id}>
              <div className="card-head">
                <h3>{p.name}</h3>
                {p.fictional && <FictionalBadge />}
              </div>
              <p className="muted">{p.team}</p>
              <p className="summary">{p.summary}</p>
              {/* 登録の前後で欄の構成を変えず、再生中にカードの高さを変えない（REQ-022） */}
              <ol className="phase-bar" aria-label="Phase の進み具合" data-slot="phases">
                {s.phases.map((ph) => (
                  <li key={ph.id} data-testid="phase-seg" className={`seg status-${ph.status}`} title={`${ph.id} ${ph.name}: ${PHASE_STATUS[ph.status]}`}>
                    {ph.id}
                  </li>
                ))}
              </ol>
              <p className="muted status-line clamp" data-slot="status">
                {!s.project
                  ? "まだ登録されていません"
                  : `いま：${currentPhase ? `${currentPhase.id} ${currentPhase.name}（${PHASE_STATUS[currentPhase.status]}）` : "—"} ／ 一周：${s.iteration}`}
              </p>
              <ul className="alerts" data-slot="alerts">
                {a.stopped > 0 && <li>⚑ 検査で停止 {a.stopped}</li>}
                {a.invalidApprovals > 0 && <li>⚑ 無効な承認 {a.invalidApprovals}</li>}
                {a.violations > 0 && <li>⚑ 工程の順序違反 {a.violations}</li>}
                {a.openDeviations > 0 && <li>⚑ 対応中の例外処理 {a.openDeviations}</li>}
              </ul>
              <div className="card-foot">
                <span className="muted">
                  {p.fictional ? `全 ${p.events.length} 件が架空（再構成）` : `実測 ${measured} 件 / 再構成 ${p.events.length - measured} 件`}
                </span>
                <a href={`#/p/${p.id}/board`}>開く →</a>
              </div>
            </article>
          );
        })}
      </div>
      <p className="muted small">
        「{data.program.name}」は、3つのプロジェクトを束ねた説明用の架空のまとまりです。プロセス定義: {process._source.tag}
      </p>
    </div>
  );
}
