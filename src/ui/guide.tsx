// ガイドツアー（REQ-017）と各エリアの「？」の説明（REQ-018）。説明文は1か所にまとめ、両方で使う。
import { useEffect, useLayoutEffect, useState } from "react";

export const GUIDE_STORAGE_KEY = "jsix-hub.guide-seen";

type Side = "below" | "above" | "left" | "right";

export interface GuideStep {
  id: string;
  title: string;
  text: string;
  side: Side;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "projects",
    title: "案件の管理",
    text: "Hub が管理する案件の一覧です。案件ごとに、7つの工程（Phase）の進み具合を小さなバーで、統制が働いた回数を ⚑ で示します。案件を選ぶと、その案件の画面を開けます。",
    side: "right",
  },
  {
    id: "player",
    title: "再生",
    text: "再生バーで出来事を再生します。▶ で再生、◀ と ▶| で1つずつ戻したり進めたりできます（← → キーも使えます）。スライダーに付いた赤い印は、Hub の統制が働いた出来事の位置です。",
    side: "above",
  },
  {
    id: "now",
    title: "いま起きたこと",
    text: "再生位置の出来事を、平易な言葉で説明します。赤い帯が付いているときは、Hub が工程のルールに沿って作業を止めた、承認を認めなかった、といった統制が働いた場面です。",
    side: "below",
  },
  {
    id: "screen",
    title: "案件の状態",
    text: "選んだ案件の状態を表示します。Phase ボード（工程の進み）・タスク（AI の作業）・ゲート（品質の検査）・承認・証跡を切り替えられます。どれも、再生位置までの出来事から計算した状態です。",
    side: "below",
  },
  {
    id: "timeline",
    title: "出来事の記録",
    text: "これまでに起きた出来事が、新しい順に並びます。行を押すと、いつ・誰が・何を根拠にした出来事かを確かめられます。「統制ポイントだけ」で、統制が働いた出来事に絞れます。",
    side: "left",
  },
  {
    id: "legend",
    title: "実測・再構成・架空",
    text: "「実測」は Git やセッション記録など実際の記録から取り出した出来事、「再構成」は記録が無いため組み立てた出来事（根拠付き）、「架空」は説明のために作った案件です。これはリプレイで、実際の AI は動いていません。",
    side: "left",
  },
];

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
  } catch {
    // 保存できない環境（プライベートブラウズ等）では、次回もツアーが始まるだけ
  }
}

export function useGuide(autoStart: boolean) {
  const [step, setStep] = useState<number | null>(() => (autoStart && !readSeen() ? 0 : null));
  const close = () => {
    writeSeen();
    setStep(null);
  };
  return {
    step,
    start: () => setStep(0),
    next: () => setStep((s) => (s === null || s >= GUIDE_STEPS.length - 1 ? s : s + 1)),
    prev: () => setStep((s) => (s === null || s <= 0 ? s : s - 1)),
    close,
  };
}

export type Guide = ReturnType<typeof useGuide>;

export interface Viewport {
  width: number;
  height: number;
}

/** 吹き出しのおおよその高さ（内容が2〜4行のとき） */
const BUBBLE_HEIGHT = 190;
const NARROW = 760;
const GAP = 12;

/**
 * 狭い画面では左右に出す余地が無いため、対象の下（入らなければ上）に出す。
 * どちらにも入らない場合は、広い側に出して対象への重なりを最小にする。
 */
export function resolveSide(rect: DOMRect, vp: Viewport, preferred: Side): Side {
  if (vp.width >= NARROW) return preferred;
  // 対象が画面より大きい場合はどこに出しても重なるため、画面下端に寄せて対象の上部を見せる
  if (rect.height > vp.height * 0.6) return "below";
  if (rect.bottom + BUBBLE_HEIGHT + GAP <= vp.height) return "below";
  if (rect.top - BUBBLE_HEIGHT - GAP >= 0) return "above";
  return vp.height - rect.bottom >= rect.top ? "below" : "above";
}

export function placeBubble(rect: DOMRect | null, vp: Viewport, side: Side): { top: number; left: number; width: number; height: number } {
  const width = Math.min(352, vp.width - 16);
  const height = BUBBLE_HEIGHT;
  const clampX = (x: number) => Math.max(8, Math.min(x, vp.width - width - 8));
  const clampY = (y: number) => Math.max(8, Math.min(y, Math.max(8, vp.height - height - 8)));
  if (!rect) return { top: 80, left: clampX(80), width, height };
  switch (side) {
    case "right":
      return { top: clampY(rect.top + 16), left: clampX(rect.right + GAP), width, height };
    case "left":
      return { top: clampY(rect.top + 16), left: clampX(rect.left - width - GAP), width, height };
    case "above":
      return { top: Math.max(8, Math.min(rect.top - height - GAP, vp.height - height - 8)), left: clampX(rect.left + 16), width, height };
    default:
      // 画面からはみ出す場合は下端に寄せる
      return { top: clampY(rect.bottom + GAP), left: clampX(rect.left + 16), width, height };
  }
}

/** ツアー：対象のエリアを強調し、その横に吹き出しを出す */
export function Tour({ guide }: { guide: Guide }) {
  const current = guide.step === null ? null : GUIDE_STEPS[guide.step]!;
  const [pos, setPos] = useState<{ top: number; left: number; width: number; side: Side }>({ top: 80, left: 80, width: 352, side: "below" });

  useLayoutEffect(() => {
    if (!current) return;
    const target = document.querySelector(`[data-guide="${current.id}"]`);
    target?.classList.add("tour-target");
    target?.scrollIntoView?.({ block: "nearest" });
    const update = () => {
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const rect = target?.getBoundingClientRect() ?? null;
      const side = rect ? resolveSide(rect, vp, current.side) : current.side;
      const box = placeBubble(rect, vp, side);
      setPos({ top: box.top, left: box.left, width: box.width, side });
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      target?.classList.remove("tour-target");
      window.removeEventListener("resize", update);
    };
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") guide.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, guide]);

  if (!current || guide.step === null) return null;
  const last = guide.step === GUIDE_STEPS.length - 1;
  return (
    <>
      <div className="tour-backdrop" onClick={guide.close} />
      <div role="dialog" aria-label="ガイド" className="bubble tour" data-side={pos.side} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
        <div className="bubble-actions">
          <span className="step">{`${guide.step + 1} / ${GUIDE_STEPS.length}`}</span>
          <button type="button" onClick={guide.close}>閉じる</button>
          {guide.step > 0 && <button type="button" onClick={guide.prev}>戻る</button>}
          <button type="button" className="primary" onClick={last ? guide.close : guide.next}>
            {last ? "終わる" : "次へ"}
          </button>
        </div>
      </div>
    </>
  );
}

/** 見出しの横の「？」。押すとそのエリアの説明を吹き出しで出す */
export function HelpTip({ id }: { id: string }) {
  const step = GUIDE_STEPS.find((s) => s.id === id);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!step) return null;
  return (
    <span className="help-wrap">
      <button type="button" className="help" aria-label={`${step.title}の説明`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ?
      </button>
      {open && (
        <span role="dialog" aria-label={step.title} className="bubble help-bubble" data-side="below">
          <strong>{step.title}</strong>
          <span className="help-text">{step.text}</span>
        </span>
      )}
    </span>
  );
}
