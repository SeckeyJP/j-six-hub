import type { ReactNode } from "react";
import type { ControlKind } from "../replay/narrate";
import type { TimelineItem } from "../types/program";
import { SPEEDS, type Player } from "./use-player";

function formatTime(ts: string): string {
  return ts.slice(0, 16).replace("T", " ") + " UTC";
}

function formatDate(ts: string): string {
  return ts.slice(0, 10);
}

/** 画面下部の再生操作。スライダーの上に統制ポイントの位置を印で示す */
export function PlayerBar({
  player,
  timeline,
  controlPoints,
  nextControl,
  help,
}: {
  player: Player;
  timeline: TimelineItem[];
  controlPoints: Map<string, ControlKind[]>;
  /** 現在位置より後の、最初に Hub が止めた場面（無ければ null） */
  nextControl: number | null;
  help?: ReactNode;
}) {
  const { n, total, playing } = player;
  const current = timeline[n - 1];
  const first = timeline[0];
  const last = timeline.at(-1);
  return (
    <div className="player" role="group" aria-label="再生操作" data-guide="player">
      <div className="player-buttons">
        <button type="button" onClick={player.first} aria-label="先頭へ" title="先頭へ（Home）">⏮</button>
        <button type="button" onClick={() => player.step(-1)} aria-label="1イベント戻る" title="1つ戻る（←）">❙◀</button>
        <button type="button" className="play" onClick={player.toggle} aria-label={playing ? "一時停止" : "再生"} title="再生／一時停止（Space）">
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={() => player.step(1)} aria-label="1イベント進む" title="1つ進む（→）">▶❙</button>
        <button type="button" onClick={player.last} aria-label="末尾へ" title="末尾へ（End）">⏭</button>
        <button
          type="button"
          className="next-control"
          aria-label="次の停止へ"
          onClick={() => nextControl !== null && player.seek(nextControl)}
          disabled={nextControl === null}
          title="次に Hub が止めた場面へ移動する"
        >
          ⚑ 次の停止へ
        </button>
      </div>
      <div className="player-track">
        <div className="marks" aria-hidden="true">
          {timeline.map((t, i) =>
            controlPoints.has(t.key) ? (
              <span key={t.key} data-testid="control-mark" className="mark" style={{ left: `${((i + 1) / Math.max(total, 1)) * 100}%` }} />
            ) : null,
          )}
        </div>
        <input type="range" min={0} max={total} value={n} onChange={(e) => player.seek(Number(e.target.value))} aria-label="再生位置" />
        {/* 記録の期間が分かるよう、両端に日付を置く */}
        <p className="track-ends">
          <span data-testid="track-start">{first ? formatDate(first.event.timestamp) : ""}</span>
          <span data-testid="track-end">{last ? formatDate(last.event.timestamp) : ""}</span>
        </p>
      </div>
      <div className="player-info">
        <output className="position">{`${n} / ${total}`}</output>
        <span className="time">
          {current ? formatTime(current.event.timestamp) : "開始前"} {help}
        </span>
      </div>
      <div className="speed" role="group" aria-label="速度">
        <span className="speed-label" aria-hidden="true">速度</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`segment ${player.speed === s ? "on" : ""}`}
            aria-pressed={player.speed === s}
            onClick={() => player.setSpeed(s)}
          >
            ×{s}
          </button>
        ))}
      </div>
    </div>
  );
}
