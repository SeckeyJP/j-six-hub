import { useState, type ReactNode } from "react";
import type { ControlKind } from "../replay/narrate";
import type { HubEvent } from "../types/events";
import type { ProgramData } from "../types/program";
import type { ProcessDefinition } from "../types/process";
import { ACTOR_ICON, ACTOR_KIND } from "./labels";
import { FictionalBadge, ProvenanceBadge } from "./provenance-badge";

const SOURCE: Record<HubEvent["source"]["kind"], string> = {
  git: "Git のコミット",
  session: "Claude Code のセッション記録",
  report: "証跡・ゲートの記録",
  reconstruction: "再構成（記録なし）",
};

const CONTROL_LABEL: Record<ControlKind, string> = {
  gate_stopped: "ゲートで停止",
  invalid_approval: "無効な承認",
  deviation: "逸脱",
  violation: "順序違反",
};

/** 出来事の記録（REQ-020, REQ-021）。新しい順。統制ポイントを目立たせ、絞り込める */
export function Timeline({
  data,
  process,
  n,
  controlPoints,
  projectId,
  help,
  legendHelp,
}: {
  data: ProgramData;
  process: ProcessDefinition;
  n: number;
  controlPoints: Map<string, ControlKind[]>;
  projectId: string | null;
  help?: ReactNode;
  legendHelp?: ReactNode;
}) {
  const [onlyControl, setOnlyControl] = useState(false);
  const [onlyProject, setOnlyProject] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const roleName = (id?: string) => (id ? (process.roles.find((r) => r.id === id)?.name ?? id) : null);

  const items = data.timeline
    .slice(0, n)
    .filter((t) => !onlyControl || controlPoints.has(t.key))
    .filter((t) => !onlyProject || !projectId || t.project === projectId)
    .reverse();

  return (
    <aside className="timeline" aria-label="出来事の記録" data-guide="timeline">
      <h2>出来事の記録 {help}</h2>
      <section aria-label="凡例" className="legend" data-guide="legend">
        <span><ProvenanceBadge value="measured" /> 記録から抽出</span>
        <span><ProvenanceBadge value="reconstructed" /> 記録が無く組み立て</span>
        <span><FictionalBadge /> 架空の案件</span>
        <span>{ACTOR_ICON.human} 人間</span>
        <span>{ACTOR_ICON.ai} AI</span>
        <span>{ACTOR_ICON.system} Hub</span>
        <span><span className="flag">⚑</span> 統制ポイント</span>
        {legendHelp}
      </section>
      <div className="filters">
        <label>
          <input type="checkbox" checked={onlyControl} onChange={(e) => setOnlyControl(e.target.checked)} />
          統制ポイントだけ
        </label>
        {projectId && (
          <label>
            <input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />
            この案件だけ
          </label>
        )}
      </div>
      {items.length === 0 && <p className="muted">まだ出来事はありません。</p>}
      <ol aria-label="出来事" className="events">
        {items.map((t) => {
          const e = t.event;
          const p = projects.get(t.project)!;
          const kinds = controlPoints.get(t.key);
          const expanded = open === t.key;
          return (
            <li key={t.key} data-key={t.key} className={kinds ? "control" : undefined}>
              <button type="button" className="event-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.key)}>
                <span className="event-time">{e.timestamp.slice(5, 16).replace("T", " ")}</span>
                <span className="project-chip" data-project={p.id}>{p.name}</span>
                <span className="event-actor" title={ACTOR_KIND[e.actor.kind]}>{ACTOR_ICON[e.actor.kind]}</span>
                <span className="event-summary">{e.summary}</span>
                <span className="event-badges">
                  {kinds && <span className="flag" title={kinds.map((k) => CONTROL_LABEL[k]).join("・")}>⚑ {kinds.map((k) => CONTROL_LABEL[k]).join("・")}</span>}
                  <ProvenanceBadge value={e.provenance} />
                  {p.fictional && <FictionalBadge />}
                </span>
              </button>
              {expanded && (
                <dl className="event-detail">
                  <dt>時刻</dt>
                  <dd>{e.timestamp.replace("T", " ").replace("Z", " UTC")}</dd>
                  <dt>Phase / タスク</dt>
                  <dd>{e.phase ?? "—"} / {e.task ?? "—"}</dd>
                  <dt>実行者</dt>
                  <dd>{[ACTOR_KIND[e.actor.kind], roleName(e.actor.role), e.actor.name].filter(Boolean).join(" / ")}</dd>
                  <dt>出典</dt>
                  <dd>{SOURCE[e.source.kind]}{e.source.ref ? `（${e.source.ref}）` : ""}</dd>
                  {e.basis && (
                    <>
                      <dt>再構成の根拠</dt>
                      <dd className="basis">{e.basis}</dd>
                    </>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
