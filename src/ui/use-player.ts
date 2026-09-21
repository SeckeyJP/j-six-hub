import { useCallback, useEffect, useState } from "react";

export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/** リプレイの再生位置。位置 n は「先頭から適用したイベント数」（0〜total） */
export function usePlayer(total: number) {
  const [n, setN] = useState(0);
  const [wantsPlay, setWantsPlay] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  // 末尾に着いたら再生中ではなくなる。状態を effect で書き換えず、位置から導く
  const playing = wantsPlay && n < total;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setN((v) => Math.min(total, v + 1)), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, total]);

  const clamp = useCallback((v: number) => Math.max(0, Math.min(total, v)), [total]);
  // 位置を手で動かしたら一時停止する
  const moveTo = (next: (v: number) => number) => {
    setWantsPlay(false);
    setN((v) => clamp(next(v)));
  };
  const play = () => {
    if (n >= total) setN(0);
    setWantsPlay(true);
  };
  const pause = () => setWantsPlay(false);

  return {
    n,
    total,
    playing,
    speed,
    setSpeed,
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    step: (d: number) => moveTo((v) => v + d),
    seek: (v: number) => moveTo(() => v),
    first: () => moveTo(() => 0),
    last: () => moveTo(() => total),
  };
}

export type Player = ReturnType<typeof usePlayer>;
