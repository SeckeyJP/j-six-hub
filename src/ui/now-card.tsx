import type { ReactNode } from "react";
import type { Narration } from "../replay/narrate";
import type { ProjectData, TimelineItem } from "../types/program";
import type { ProcessDefinition } from "../types/process";
import { ACTOR_ICON, ACTOR_KIND } from "./labels";
import { FictionalBadge, ProvenanceBadge } from "./provenance-badge";

const EMPTY_TEXT = "▶ を押すと再生します（→ キーで1つずつ）。3つのプロジェクトの出来事が、起きた順に再生されます。";

/** 役割 ID をプロセス定義の名前にする（定義に無ければ ID のまま） */
function roleName(process: ProcessDefinition, id?: string): string | null {
  return id ? (process.roles.find((r) => r.id === id)?.name ?? id) : null;
}

function formatTime(ts: string): string {
  return `${ts.slice(0, 10)} ${ts.slice(11, 16)} UTC`;
}

/**
 * 再生位置の出来事を平易な文で説明する（REQ-019）。
 * 統制が働いた場面はヘッダ帯で示し、次の停止へ移動できるようにする（REQ-025）。
 * 出来事の内容に依らず同じ欄を同じ高さで描画する（REQ-022）。
 */
export function NowCard({
  item,
  project,
  narration,
  process,
  n,
  total,
  nextControl,
  onSeek,
  help,
}: {
  item: TimelineItem | null;
  project: ProjectData | null;
  narration: Narration | null;
  process: ProcessDefinition;
  n: number;
  total: number;
  nextControl: number | null;
  onSeek: (n: number) => void;
  help?: ReactNode;
}) {
  const ready = item && narration && project;
  const detail = ready ? narration.detail.filter(Boolean).join(" ") : "";
  const control = ready ? narration.control : null;
  const stopped = narration?.kinds.includes("gate_stopped") ?? false;
  return (
    <section aria-label="いま起きたこと" className={`now ${control ? "now-control" : ""}`} data-guide="now">
      <p className={`now-band ${control ? "band-control" : ""}`} data-testid="now-band">
        <span className="band-title">{stopped ? (item?.event.provenance === "measured" ? "⚑ 元記録の検査停止・未達" : "⚑ 再構成した検査停止・未達") : control ? "⚑ 再生モデル上の判定" : "通常の出来事"}</span>
        <span className="band-pos">
          {/* 狭い画面では見出しの語を隠し、位置だけを残す */}
          <span className="band-label">いま起きたこと ・ </span>
          <span className="band-n">
            {n} / {total}
          </span>
        </span>
        <span className="band-time">{item ? formatTime(item.event.timestamp) : "開始前"}</span>
        {help}
      </p>
      <div className="now-body">
        <p className="now-meta" data-slot="meta">
          {ready && (
            <>
              <span className="project-chip" data-project={project.id}>{project.name}</span>
              {project.fictional && <FictionalBadge />}
              <ProvenanceBadge value={item.event.provenance} />
              {item.event.phase && (
                <span className="phase-chip">
                  {item.event.phase} {process.phases.find((ph) => ph.id === item.event.phase)?.name}
                </span>
              )}
              <span className="meta-actor" data-testid="meta-actor" title={roleName(process, item.event.actor.role) ?? undefined}>
                {ACTOR_ICON[item.event.actor.kind]} {ACTOR_KIND[item.event.actor.kind]}
                {item.event.actor.name ? `（${item.event.actor.name}）` : ""}
              </span>
            </>
          )}
        </p>
        <p className={`now-headline clamp ${ready ? "" : "now-empty"}`} data-slot="headline" title={ready ? narration.headline : EMPTY_TEXT}>
          {ready ? narration.headline : EMPTY_TEXT}
        </p>
        <p className="now-detail clamp" data-slot="detail" title={detail}>
          {detail}
        </p>
        <p className={`now-hub ${control ? "" : "is-empty"}`} data-slot="hub" data-testid="now-judge" title={control ?? ""}>
          <strong className="judge-label">解釈・構想</strong>
          <span className="judge-text clamp">{control}</span>
          {nextControl !== null && (
            <button type="button" className="judge-next" onClick={() => onSeek(nextControl)}>
              次の停止 ({nextControl}) へ ▶
            </button>
          )}
        </p>
      </div>
    </section>
  );
}
