import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayer } from "./use-player";

describe("usePlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("0 から始まり、1つ進む・戻る", () => {
    const { result } = renderHook(() => usePlayer(10));
    expect(result.current.n).toBe(0);
    act(() => result.current.step(1));
    act(() => result.current.step(1));
    act(() => result.current.step(-1));
    expect(result.current.n).toBe(1);
  });

  it("位置は 0〜total に収める", () => {
    const { result } = renderHook(() => usePlayer(3));
    act(() => result.current.seek(99));
    expect(result.current.n).toBe(3);
    act(() => result.current.step(-99));
    expect(result.current.n).toBe(0);
  });

  it("先頭・末尾へ移動する", () => {
    const { result } = renderHook(() => usePlayer(5));
    act(() => result.current.last());
    expect(result.current.n).toBe(5);
    act(() => result.current.first());
    expect(result.current.n).toBe(0);
  });

  it("再生すると速度 ×1 で1秒に1件進み、末尾で止まる", () => {
    const { result } = renderHook(() => usePlayer(2));
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.n).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.n).toBe(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.playing).toBe(false);
  });

  it("速度 ×4 では 250ms ごとに進む", () => {
    const { result } = renderHook(() => usePlayer(10));
    act(() => result.current.setSpeed(4));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.n).toBe(4);
  });

  it("一時停止すると進まない", () => {
    const { result } = renderHook(() => usePlayer(10));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.n).toBe(1);
  });

  it("末尾で再生すると先頭から始める", () => {
    const { result } = renderHook(() => usePlayer(2));
    act(() => result.current.last());
    act(() => result.current.play());
    expect(result.current.n).toBe(0);
    expect(result.current.playing).toBe(true);
  });
});
