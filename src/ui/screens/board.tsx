import type { ScreenProps } from "./project";
import { PHASE_STATUS } from "../labels";

/** Phase ボード：工程を左から右へ並べ、各 Phase の出口のゲートを示す */
export function Board({ state, process }: ScreenProps) {
  const openDeviations = state.deviations.filter((d) => d.closedBy === null);
  return (
    <>
      <p className="lead">
        工程（Phase）は左から右へ進みます。各 Phase の出口にはゲート 🚪 があり、人の承認や機械の検査を通らないと次へ進めません。
      </p>
      <div className="pipeline">
        {state.phases.map((p) => {
          const gate = process.gates.find((g) => g.id === p.gateId);
          const headingId = `phase-${p.id}`;
          return (
            <section key={p.id} aria-labelledby={headingId} className={`phase-card status-${p.status}`}>
              <h3 id={headingId}>
                {p.id} {p.name}
              </h3>
              <p className={`status-pill status-${p.status}`}>
                {PHASE_STATUS[p.status]}
                {p.mode === "continuous" && "（継続）"}
              </p>
              {/* 表示しないときも場所を確保し、再生中にカードの高さを変えない（REQ-022） */}
              <p className={`warn reopened ${p.reopened && p.status !== "approved" ? "" : "is-empty"}`} data-slot="reopened">
                ↩ 逆戻りで再開
              </p>
              <p className="gate">🚪 {gate ? gate.name : "ゲートなし"}</p>
              {gate && gate.layers.length > 1 && (
                <ol className="layers">
                  {gate.layers.map((l) => (
                    <li key={l.id}>
                      {l.id} {l.name}
                      {l.optional && "（任意）"}
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
          <h3 id="violations-title">順序違反</h3>
          {state.violations.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            <ul>
              {state.violations.map((v) => (
                <li key={v.eventId} className="warn">
                  {v.phase} の作業が、{v.missing.join("・")} の承認より前に始まった（{v.eventId}）
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="deviations-title" className="note-card">
          <h3 id="deviations-title">対応中の逸脱</h3>
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
