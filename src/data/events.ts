import type { HubEvent } from "../types/events";

/**
 * events.jsonl を読む。形式の詳細は data/events.schema.json（抽出側の CI で検査済み）。
 * ここでは再生が壊れる不備（不正な行、連番の欠け、ラベルの欠落）だけを確かめる。
 */
export function parseEvents(text: string): HubEvent[] {
  const events: HubEvent[] = [];
  text.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") return;
    let ev: HubEvent;
    try {
      ev = JSON.parse(raw) as HubEvent;
    } catch {
      throw new Error(`events.jsonl の ${i + 1} 行目が JSON として読めない`);
    }
    if (ev.seq !== events.length + 1) {
      throw new Error(`seq が連番でない: ${ev.seq}（期待 ${events.length + 1}）`);
    }
    if (ev.provenance !== "measured" && ev.provenance !== "reconstructed") {
      throw new Error(`${ev.id}: provenance が不正: ${String(ev.provenance)}`);
    }
    if (ev.provenance === "reconstructed" && !ev.basis) {
      throw new Error(`${ev.id}: 再構成イベントに basis（根拠）がない`);
    }
    events.push(ev);
  });
  return events;
}
