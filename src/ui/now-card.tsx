import type { ReactNode } from "react";
import type { Narration } from "../replay/narrate";
import type { ProjectData, TimelineItem } from "../types/program";
import { FictionalBadge, ProvenanceBadge } from "./provenance-badge";

const EMPTY_TEXT = "下の ▶ で再生、→ キーで1つずつ進めます。3つの案件の出来事が、起きた順に再生されます。";

/**
 * 再生位置の出来事を平易な文で説明する（REQ-019）。
 * 再生中に下の画面が上下に動かないよう、出来事の内容に依らず同じ欄を同じ高さで描画する（REQ-022）。
 * 長い文は行数を制限し、全文は title で読めるようにする。
 */
export function NowCard({
  item,
  project,
  narration,
  help,
}: {
  item: TimelineItem | null;
  project: ProjectData | null;
  narration: Narration | null;
  help?: ReactNode;
}) {
  const ready = item && narration && project;
  const detail = ready ? narration.detail.filter(Boolean).join(" ") : "";
  const control = ready ? narration.control : null;
  return (
    <section aria-label="いま起きたこと" className={`now ${control ? "now-control" : ""}`} data-guide="now">
      <h2>いま起きたこと {help}</h2>
      <p className="now-meta" data-slot="meta">
        {ready && (
          <>
            <span className="project-chip" data-project={project.id}>{project.name}</span>
            {project.fictional && <FictionalBadge />}
            <ProvenanceBadge value={item.event.provenance} />
            {item.event.phase && <span className="phase-chip">{item.event.phase}</span>}
          </>
        )}
      </p>
      <p className={`now-headline clamp ${ready ? "" : "now-empty"}`} data-slot="headline" title={ready ? narration.headline : EMPTY_TEXT}>
        {ready ? narration.headline : EMPTY_TEXT}
      </p>
      <p className="now-detail clamp" data-slot="detail" title={detail}>
        {detail}
      </p>
      <p className={`now-hub clamp ${control ? "" : "is-empty"}`} data-slot="hub" title={control ?? ""}>
        {control && (
          <>
            <strong>Hub の統制：</strong>
            {control}
          </>
        )}
      </p>
    </section>
  );
}
