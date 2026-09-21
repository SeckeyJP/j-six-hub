import type { ScreenProps } from ".";

export function Home({ state, events }: ScreenProps) {
  if (!state.project) return <p>案件はまだ登録されていません</p>;
  const measured = events.filter((e) => e.provenance === "measured").length;
  const p = state.project;
  return (
    <div className="cards">
      <article aria-label={p.name} className="card">
        <h3>{p.name}</h3>
        <dl>
          <dt>プロセス定義</dt>
          <dd>{p.processVersion ?? "未固定"}</dd>
          <dt>憲法（CLAUDE.md）</dt>
          <dd>{p.constitution ?? "未固定"}</dd>
          <dt>イベント（全体）</dt>
          <dd>
            実測 {measured} 件 / 再構成 {events.length - measured} 件
          </dd>
          <dt>現在の一周</dt>
          <dd>{state.iteration}</dd>
        </dl>
        <a href="#/board">Phase ボードを開く</a>
      </article>
    </div>
  );
}
