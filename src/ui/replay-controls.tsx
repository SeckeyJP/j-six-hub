import { SPEEDS, type Player } from "./use-player";

export function ReplayControls({ player }: { player: Player }) {
  const { n, total, playing } = player;
  return (
    <div className="controls" role="group" aria-label="再生操作">
      <button type="button" onClick={player.first} aria-label="先頭へ">⏪</button>
      <button type="button" onClick={() => player.step(-1)} aria-label="1イベント戻る">⏮</button>
      <button type="button" onClick={player.toggle} aria-label={playing ? "一時停止" : "再生"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button type="button" onClick={() => player.step(1)} aria-label="1イベント進む">⏭</button>
      <button type="button" onClick={player.last} aria-label="末尾へ">⏩</button>
      <input
        type="range"
        min={0}
        max={total}
        value={n}
        onChange={(e) => player.seek(Number(e.target.value))}
        aria-label="再生位置"
      />
      <output className="position">{`${n} / ${total}`}</output>
      <fieldset className="speed">
        <legend>速度</legend>
        {SPEEDS.map((s) => (
          <label key={s}>
            <input type="radio" name="speed" checked={player.speed === s} onChange={() => player.setSpeed(s)} />×{s}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
