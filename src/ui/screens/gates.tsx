import type { ScreenProps } from ".";
import { ProvenanceBadge } from "../provenance-badge";
import { CHECK_STATUS, OUTCOME, TRIGGER } from "../labels";

export function Gates({ state, process }: ScreenProps) {
  if (state.evaluations.length === 0) return <p>ゲートの判定はまだありません</p>;
  return (
    <div className="stack">
      {[...state.evaluations].reverse().map((ev) => {
        const gate = process.gates.find((g) => g.id === ev.gate);
        const layers = [...new Set(ev.results.map((r) => r.layer))];
        return (
          <article key={ev.eventId} className={`card outcome-${ev.outcome}`}>
            <h3>
              <ProvenanceBadge value={ev.provenance} />
              {TRIGGER[ev.trigger ?? ""] ?? ev.trigger} — {OUTCOME[ev.outcome] ?? ev.outcome}
              {ev.count > 1 && `（同じ内容で ${ev.count} 回）`}
            </h3>
            <p className="meta">
              {ev.eventId} / {gate?.name ?? ev.gate} / Phase {ev.phase ?? "—"} / タスク {ev.task ?? "—"}
            </p>
            {layers.map((layerId) => {
              const layer = gate?.layers.find((l) => l.id === layerId);
              return (
                <table key={layerId} aria-label={`${layerId} の結果`}>
                  <caption>
                    {layerId} {layer?.name ?? ""}
                  </caption>
                  <tbody>
                    {ev.results
                      .filter((r) => r.layer === layerId)
                      .map((r, i) => (
                        <tr key={i}>
                          <td>{r.check ?? "（層全体）"}</td>
                          <td>{CHECK_STATUS[r.status]}</td>
                          <td>{r.summary}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              );
            })}
          </article>
        );
      })}
    </div>
  );
}
