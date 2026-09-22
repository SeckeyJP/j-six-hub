import type { ScreenProps } from "./project";
import { PHASE_STATUS } from "../labels";
import type { HubState } from "../../replay/state";
import type { PhaseId } from "../../types/process";

/** その工程で Hub が止めた件数・順序違反の件数（REQ-010） */
function marksOf(state: HubState, phase: PhaseId) {
  return {
    stopped: state.evaluations.filter((e) => e.phase === phase && (e.outcome === "blocked" || e.outcome === "failed")).length,
    violations: state.violations.filter((v) => v.phase === phase).length,
  };
}

/** 工程ボード：工程を左から右へ並べ、各 Phase の出口の品質検査と、そこで働いた統制を示す */
export function Board({ state, process, onOpenEvent }: ScreenProps) {
  const openDeviations = state.deviations.filter((d) => d.closedBy === null);
  // 逆戻り後の再承認待ちではなく、実際に作業している工程を示す
  const here = [...state.phases].reverse().find((p) => p.status === "in_progress" && p.mode !== "continuous")?.id
    ?? [...state.phases].reverse().find((p) => p.status !== "not_started")?.id
    ?? null;
  return (
    <>
      <p className="lead">
        工程（Phase）は左から右へ進みます。各 Phase の出口には品質検査 🚪 があり、機械の検査と人の承認を通らないと次へ進めません。
      </p>
      <div className="pipeline">
        {state.phases.map((p) => {
          const gate = process.gates.find((g) => g.id === p.gateId);
          const marks = marksOf(state, p.id);
          const headingId = `phase-${p.id}`;
          return (
            <section key={p.id} aria-labelledby={headingId} className={`phase-card status-${p.status}`}>
              <h3 id={headingId}>
                {/* 狭い画面では記号・名前・状態を横1行に並べるため、要素を分ける */}
                <span className="phase-id">{p.id}</span> <span className="phase-name">{p.name}</span>
              </h3>
              <p className={`status-pill status-${p.status}`}>
                {PHASE_STATUS[p.status]}
                {p.mode === "continuous" && "（継続）"}
              </p>
              {/* 印が無いときも場所を確保し、再生中にカードの高さを変えない（REQ-022） */}
              <p className="phase-marks" data-slot="marks">
                <span className={`phase-mark here ${here === p.id ? "" : "is-empty"}`} data-testid="mark-here">
                  ● いまここ
                </span>
                <span className={`phase-mark stop ${marks.stopped > 0 ? "" : "is-empty"}`} data-testid="mark-stopped" title={`この工程で Hub が作業を止めた回数: ${marks.stopped}`}>
                  ⚑ 検査で停止 {marks.stopped}
                </span>
                <span className={`phase-mark violation ${marks.violations > 0 ? "" : "is-empty"}`} data-testid="mark-violation" title={`前の工程の承認前に始まった回数: ${marks.violations}`}>
                  ⚠ 順序違反 {marks.violations}
                </span>
                <span
                  className={`phase-mark reopened ${p.needsReapproval ? "" : "is-empty"}`}
                  data-testid="mark-reopened"
                  title="Phase 逆戻り後に再承認が必要な工程"
                >
                  ↩ 再承認待ち
                </span>
              </p>
              <p className="gate">🚪 {gate ? gate.name : "ゲートなし"}</p>
              {gate && gate.layers.length > 1 && (
                <ol className="layers">
                  {gate.layers.map((l) => (
                    <li key={l.id}>
                      <span className="layer-id">{l.id}</span>
                      <span className="layer-name">
                        {" "}
                        {l.name}
                        {l.optional && "（任意）"}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
      <div className="board-notes">
        <section aria-labelledby="violations-title" className="note-card">
          <h3 id="violations-title">工程の順序違反</h3>
          {state.violations.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            <ul>
              {state.violations.map((v) => (
                <li key={v.eventId} className="warn">
                  {v.missing.join("・")} の承認前に {v.phase} が始まった（
                  <button type="button" className="link-event" onClick={() => onOpenEvent?.(v.eventId)}>
                    {v.eventId}
                  </button>
                  ）
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="deviations-title" className="note-card">
          <h3 id="deviations-title">対応中の例外処理</h3>
          {openDeviations.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            <ul>
              {openDeviations.map((d) => (
                <li key={d.openedBy}>
                  {d.name}（{d.phase ?? "—"}、{d.openedBy}）
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
