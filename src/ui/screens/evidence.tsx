import type { ScreenProps } from "./project";
import { ProvenanceBadge } from "../provenance-badge";
import { OUTCOME, PHASE_STATUS } from "../labels";

const REPO = "https://github.com/SeckeyJP/j-six/tree";

export function Evidence({ project, state, process }: ScreenProps) {
  const events = project.events;
  const packs = state.evaluations.filter((e) => e.trigger === "evidence_pack");
  const reviewPhase = state.phases.find((p) => p.id === "P5");
  const reviewGate = process.gates.find((g) => g.id === reviewPhase?.gateId);
  const approval = state.approvals.find((a) => a.eventId === reviewPhase?.approvedBy);

  return (
    <>
      {packs.length === 0 ? (
        <p>証跡パッケージはまだ生成されていません</p>
      ) : (
        packs.map((ev) => {
          const commit = String(events.find((e) => e.id === ev.eventId)?.payload?.commit ?? "");
          const counts = (s: string) => ev.results.filter((r) => r.status === s).length;
          return (
            <article key={ev.eventId} aria-label={`${ev.task} の証跡パッケージ`} className="card">
              <h3>
                <ProvenanceBadge value={ev.provenance} /> {ev.task} — {OUTCOME[ev.outcome] ?? ev.outcome}
              </h3>
              <p>
                チェック {ev.results.length} 件（通過 {counts("passed")} / 未達 {counts("failed")} / 未実行 {counts("skipped")}）、
                対象コミット {commit}
              </p>
              {project.jsix_dir ? (
                <a href={`${REPO}/${commit}/${project.jsix_dir}/reports/evidence/${ev.task}`} target="_blank" rel="noreferrer">
                  J-SIX リポジトリで開く（証跡・参考所見・承認の3区分）
                </a>
              ) : (
                <p className="muted">架空のプロジェクトのため、証跡のファイルはありません。</p>
              )}
            </article>
          );
        })
      )}
      {reviewGate && reviewPhase && (
        <section aria-labelledby="review-title" className="card">
          <h3 id="review-title">{reviewGate.name}</h3>
          <p>
            {reviewPhase.id} {PHASE_STATUS[reviewPhase.status]}
            {approval && (
              <>
                {" "}
                <ProvenanceBadge value={approval.provenance} /> {approval.eventId}
              </>
            )}
          </p>
        </section>
      )}
    </>
  );
}
