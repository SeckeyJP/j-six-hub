import type { ReactNode } from "react";
import type { Narration } from "../replay/narrate";
import type { ProjectData, TimelineItem } from "../types/program";
import { FictionalBadge, ProvenanceBadge } from "./provenance-badge";

/** 再生位置の出来事を平易な文で説明する（REQ-019） */
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
  return (
    <section aria-label="いま起きたこと" className={`now ${narration?.control ? "now-control" : ""}`} data-guide="now">
      <h2>
        いま起きたこと {help}
      </h2>
      {!item || !narration || !project ? (
        <p className="now-empty">下の ▶ で再生、→ キーで1つずつ進めます。3つの案件の出来事が、起きた順に再生されます。</p>
      ) : (
        <>
          <p className="now-meta">
            <span className="project-chip" data-project={project.id}>{project.name}</span>
            {project.fictional && <FictionalBadge />}
            <ProvenanceBadge value={item.event.provenance} />
            {item.event.phase && <span className="phase-chip">{item.event.phase}</span>}
          </p>
          <p className="now-headline">{narration.headline}</p>
          {narration.detail.filter(Boolean).map((d, i) => (
            <p key={i} className="now-detail">{d}</p>
          ))}
          {narration.control && (
            <p className="now-hub">
              <strong>Hub の統制：</strong>
              {narration.control}
            </p>
          )}
        </>
      )}
    </section>
  );
}
