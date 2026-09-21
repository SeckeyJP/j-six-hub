import { useState } from "react";
import type { HubEvent } from "../types/events";
import { ProvenanceBadge } from "./provenance-badge";

const SOURCE: Record<HubEvent["source"]["kind"], string> = {
  git: "Git",
  session: "Claude Code のセッション記録",
  report: "証跡パッケージ",
  reconstruction: "再構成",
};

function formatTime(ts: string): string {
  return ts.replace("T", " ").replace("Z", " UTC");
}

/** n 件目までのイベント（新しい順）と、選んだイベントの詳細 */
export function EventList({ events, n }: { events: HubEvent[]; n: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const shown = events.slice(0, n);
  const detail = shown.find((e) => e.id === selected) ?? shown.at(-1) ?? null;

  return (
    <aside className="events">
      <h2>イベント</h2>
      <section aria-label="イベントの詳細" className="event-detail">
        {detail ? <EventDetail event={detail} /> : <p>▶ で再生、→ で1件ずつ進めます。</p>}
      </section>
      <ol reversed>
        {[...shown].reverse().map((e) => (
          <li key={e.id} className={e.id === detail?.id ? "selected" : undefined}>
            <ProvenanceBadge value={e.provenance} />
            <button type="button" className="event-link" onClick={() => setSelected(e.id)}>
              <span className="event-id">{e.id}</span> {e.summary}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function EventDetail({ event: e }: { event: HubEvent }) {
  return (
    <>
      <p>
        <ProvenanceBadge value={e.provenance} /> <strong>{e.summary}</strong>
      </p>
      <dl>
        <dt>時刻</dt>
        <dd>{formatTime(e.timestamp)}</dd>
        <dt>Phase / タスク</dt>
        <dd>
          {e.phase ?? "—"} / {e.task ?? "—"}
        </dd>
        <dt>実行者</dt>
        <dd>{[e.actor.kind === "human" ? "人間" : e.actor.kind === "ai" ? "AI" : "システム", e.actor.role, e.actor.name].filter(Boolean).join(" / ")}</dd>
        <dt>出典</dt>
        <dd>
          {SOURCE[e.source.kind]}
          {e.source.ref ? `（${e.source.ref}）` : ""}
        </dd>
        {e.basis && (
          <>
            <dt>再構成の根拠</dt>
            <dd className="basis">{e.basis}</dd>
          </>
        )}
      </dl>
    </>
  );
}
