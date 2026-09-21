import type { ScreenProps } from ".";
import { PHASE_STATUS } from "../labels";

export function Board({ state, process }: ScreenProps) {
  const openDeviations = state.deviations.filter((d) => d.closedBy === null);
  return (
    <>
      <div className="board">
        {state.phases.map((p) => {
          const gate = process.gates.find((g) => g.id === p.gateId);
          const headingId = `phase-${p.id}`;
          return (
            <section key={p.id} aria-labelledby={headingId} className={`card phase status-${p.status}`}>
              <h3 id={headingId}>
                {p.id} {p.name}
              </h3>
              <p className={`status-${p.status}`}>
                {PHASE_STATUS[p.status]}
                {p.mode === "continuous" && "（継続）"}
              </p>
              {p.reopened && p.status !== "approved" && <p className="warn">逆戻りで再開</p>}
              <p>🚪 {gate ? gate.name : "ゲートなし"}</p>
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
      <section aria-labelledby="violations-title">
        <h3 id="violations-title">順序違反</h3>
        {state.violations.length === 0 ? (
          <p>なし</p>
        ) : (
          <ul>
            {state.violations.map((v) => (
              <li key={v.eventId} className="warn">
                {v.eventId}: {v.phase} の作業が、{v.missing.join("・")} の承認より前に始まった
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="deviations-title">
        <h3 id="deviations-title">開いている逸脱</h3>
        {openDeviations.length === 0 ? (
          <p>なし</p>
        ) : (
          <ul>
            {openDeviations.map((d) => (
              <li key={d.openedBy}>
                {d.name}（{d.openedBy}
                {d.phase ? `、${d.phase}` : ""}）
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
