import type { ScreenProps } from "./project";
import { TASK_STATUS } from "../labels";

export function Tasks({ state, process }: ScreenProps) {
  if (state.tasks.length === 0) return <p>タスクはまだ投入されていません</p>;
  const steps = process.phases.find((p) => p.mode === "per_task")?.steps ?? [];
  return (
    <div className="stack">
      {state.tasks.map((t) => {
        const headingId = `task-${t.dispatchedAt}`;
        return (
          <section key={t.dispatchedAt} aria-labelledby={headingId} className="card">
            <h3 id={headingId}>
              {t.label}
              {t.team && <span className="team"> — {t.team}</span>}
            </h3>
            <p className={`status-pill task-${t.status}`}>
              {TASK_STATUS[t.status]}
              {!t.gateRecorded && t.status === "passed" && "（ゲート記録なし。品質ゲート導入前）"}
            </p>
            <ol className="steps" aria-label="TDD の工程">
              {steps.map((s) => (
                <li key={s} aria-current={t.step === s ? "step" : undefined}>
                  {s}
                </li>
              ))}
            </ol>
            {t.agents.length > 0 && (
              <table aria-label="サブエージェントの実行">
                <thead>
                  <tr>
                    <th>サブエージェント</th>
                    <th>工程</th>
                    <th>開始</th>
                    <th>終了</th>
                  </tr>
                </thead>
                <tbody>
                  {t.agents.map((a) => (
                    <tr key={a.startedBy}>
                      <td>{a.agent}</td>
                      <td>{a.step ?? "—"}</td>
                      <td>{a.startedBy}</td>
                      <td>{a.finishedBy ?? "実行中"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
