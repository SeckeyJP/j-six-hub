import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ControlKind } from "../replay/narrate";
import type { HubEvent } from "../types/events";
import type { ProgramData } from "../types/program";
import type { ProcessDefinition } from "../types/process";
import { ACTOR_ICON, ACTOR_KIND } from "./labels";
import { FictionalBadge, ProvenanceBadge } from "./provenance-badge";

const SOURCE: Record<HubEvent["source"]["kind"], string> = {
  git: "Git のコミット",
  session: "Claude Code のセッション記録",
  report: "監査記録・検査の記録",
  reconstruction: "再構成（記録なし）",
};

export const CONTROL_LABEL: Record<ControlKind, string> = {
  gate_stopped: "検査で停止",
  invalid_approval: "無効な承認",
  deviation: "例外処理",
  violation: "工程の順序違反",
  untraced_requirement: "テスト未対応の要件",
};

/** プロジェクト名は履歴では短く出す */
/** 履歴の行は幅が狭いので、プロジェクト名の末尾の語を落として短くする */
export function shortName(name: string): string {
  return name.replace(/ワークフロー|発行|連携/g, "");
}

type Filter = "all" | "control" | "project";

/** 履歴（REQ-020, REQ-021）。新しい順。統制の場面を目立たせ、件数付きで絞り込める */
export function Timeline({
  data,
  process,
  n,
  controlPoints,
  projectId,
  inMain = false,
  focus = null,
  help,
  legendHelp,
}: {
  data: ProgramData;
  process: ProcessDefinition;
  n: number;
  controlPoints: Map<string, ControlKind[]>;
  projectId: string | null;
  /** 本文として開くか（狭い画面では右の欄ではなく画面として出す。REQ-028） */
  inMain?: boolean;
  /** 他の画面から開く出来事（時間軸のキーと、押した時刻） */
  focus?: { key: string; at: number } | null;
  help?: ReactNode;
  legendHelp?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useFocusRow(focus, listRef, setFilter, setOpen);
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const roleName = (id?: string) => (id ? (process.roles.find((r) => r.id === id)?.name ?? id) : null);

  const shown = data.timeline.slice(0, n);
  const counts = {
    all: shown.length,
    control: shown.filter((t) => controlPoints.has(t.key)).length,
    project: projectId ? shown.filter((t) => t.project === projectId).length : 0,
  };
  const items = shown
    .filter((t) => (filter === "control" ? controlPoints.has(t.key) : true))
    .filter((t) => (filter === "project" && projectId ? t.project === projectId : true))
    .reverse();

  const segment = (id: Filter, label: string) => (
    <button type="button" className={`segment ${filter === id ? "on" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
      {label}
    </button>
  );

  return (
    <aside className={`timeline ${inMain ? "in-main" : ""}`} aria-label="履歴" data-guide="timeline">
      <h2>
        履歴 {help}
        <span className="sub">新しい順 ・ {shown.length} 件</span>
      </h2>
      <section aria-label="凡例" className="legend" data-guide="legend">
        <span><ProvenanceBadge value="measured" /> 記録あり</span>
        <span><ProvenanceBadge value="reconstructed" /> 記録なし・根拠付き</span>
        <span><FictionalBadge /> シナリオ</span>
        {legendHelp}
      </section>
      <div className="filters" role="group" aria-label="絞り込み">
        {segment("all", `すべて ${counts.all}`)}
        {segment("control", `⚑ Hub が止めた ${counts.control}`)}
        {projectId && segment("project", `このプロジェクト ${counts.project}`)}
      </div>
      {items.length === 0 && <p className="muted">まだ出来事はありません。</p>}
      <ol aria-label="出来事" className="events" ref={listRef}>
        {items.map((t) => {
          const e = t.event;
          const p = projects.get(t.project)!;
          const kinds = controlPoints.get(t.key);
          const expanded = open === t.key;
          const index = data.timeline.indexOf(t) + 1;
          return (
            <li key={t.key} data-key={t.key} className={`${kinds ? "control" : ""} ${p.fictional ? "fictional" : ""}`}>
              <button
                type="button"
                className="event-row"
                data-testid={`event-${t.key}`}
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : t.key)}
              >
                <span className="event-head">
                  <span className="event-index">{kinds ? `⚑ ${index}` : index}</span>
                  <span className="event-time">{e.timestamp.slice(11, 16)}</span>
                  <span className="project-chip" data-project={p.id}>{shortName(p.name)}</span>
                  {p.fictional && <FictionalBadge />}
                  <span className="event-prov"><ProvenanceBadge value={e.provenance} /></span>
                </span>
                <span className="event-summary">
                  <span className="event-actor" title={ACTOR_KIND[e.actor.kind]}>{ACTOR_ICON[e.actor.kind]}</span> {e.summary}
                </span>
                {kinds && <span className="event-kind">{kinds.map((k) => CONTROL_LABEL[k]).join("・")}</span>}
                {e.basis && (
                  <span className="event-basis" data-testid="basis-preview">
                    根拠: {e.basis.slice(0, 40)}
                    {e.basis.length > 40 ? "…" : ""}
                  </span>
                )}
              </button>
              {expanded && (
                <dl className="event-detail">
                  <dt>時刻</dt>
                  <dd>{e.timestamp.replace("T", " ").replace("Z", " UTC")}</dd>
                  <dt>工程 / 作業</dt>
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

/**
 * 他の画面から渡された出来事の行を開き、見える位置まで寄せる。
 * 絞り込みで隠れているときは「すべて」に戻す（押したのに何も起きない、を避ける）。
 */
function useFocusRow(
  focus: { key: string; at: number } | null,
  listRef: React.RefObject<HTMLOListElement | null>,
  setFilter: (f: Filter) => void,
  setOpen: (k: string | null) => void,
): void {
  useEffect(() => {
    if (!focus) return;
    setOpen(focus.key);
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(focus.key)}"]`);
    if (!row) {
      setFilter("all");
      return;
    }
    const box = list?.closest<HTMLElement>(".timeline");
    // 欄の中だけを動かす（ページ全体が飛ぶと、いま見ている場所を見失う）
    if (box && box.scrollHeight > box.clientHeight) {
      box.scrollTop = Math.max(0, row.offsetTop - box.offsetTop - 16);
    } else {
      // jsdom には scrollIntoView が無い（テストでは寄せる動きは検証しない）
      row.scrollIntoView?.({ block: "nearest" });
    }
  }, [focus, listRef, setFilter, setOpen]);
}
