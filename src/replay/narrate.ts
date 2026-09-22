// 「いま起きたこと」と「Hub が何を統制したか」を平易な文にする（design-spec §6.3）。
// Phase・ゲート・役割・逸脱の名前はプロセス定義から引く。
import type { GateResult, HubEvent } from "../types/events";
import type { ProgramData } from "../types/program";
import type { ProcessDefinition } from "../types/process";
import { replay } from "./replay";
import type { HubState } from "./state";

export type ControlKind = "gate_stopped" | "invalid_approval" | "deviation" | "violation" | "untraced_requirement";

export interface Narration {
  headline: string;
  detail: string[];
  /** Hub が統制したこと（統制ポイントでなければ null） */
  control: string | null;
  kinds: ControlKind[];
}

/** このイベントを適用したときに起きた統制 */
export function controlKinds(ev: HubEvent, before: HubState, after: HubState): ControlKind[] {
  const kinds: ControlKind[] = [];
  const outcome = ev.payload?.outcome;
  if (ev.type === "gate.evaluated" && (outcome === "blocked" || outcome === "failed")) kinds.push("gate_stopped");
  if (ev.type === "hook.blocked") kinds.push("gate_stopped");
  if (ev.type === "gate.approved" && after.approvals.at(-1)?.valid === false) kinds.push("invalid_approval");
  if (ev.type === "deviation.opened") kinds.push("deviation");
  if (after.violations.length > before.violations.length) kinds.push("violation");
  if (after.traceability.untraced.length > before.traceability.untraced.length) kinds.push("untraced_requirement");
  return kinds;
}

/** 全案件の統制ポイント（時間軸のキー → 種類） */
export function controlPointsOf(data: ProgramData, process: ProcessDefinition): Map<string, ControlKind[]> {
  const points = new Map<string, ControlKind[]>();
  for (const p of data.projects) {
    let before = replay(p.events, process, 0);
    p.events.forEach((ev, i) => {
      const after = replay(p.events, process, i + 1);
      const kinds = controlKinds(ev, before, after);
      if (kinds.length > 0) points.set(`${p.id}:${ev.id}`, kinds);
      before = after;
    });
  }
  return points;
}

/** 全案件のうち、ゲートまたは Hook が実際に作業を停止した位置だけを返す。 */
export function stopPointsOf(data: ProgramData, process: ProcessDefinition): Map<string, ControlKind[]> {
  return new Map([...controlPointsOf(data, process)].filter(([, kinds]) => kinds.includes("gate_stopped")));
}

/**
 * ガイドで案内する「見どころ」のキー。
 * 要件を追加した結果テストが無い状態になった場面のうち、**すでに要件とテストの対応がある**
 * ところへ追加したものを選ぶ（最初の登録時は対応表がまだ無く、統制の例として分かりにくいため）。
 */
export function highlightKey(data: ProgramData, process: ProcessDefinition): string | null {
  let fallback: string | null = null;
  for (const p of data.projects) {
    let before = replay(p.events, process, 0);
    for (let i = 0; i < p.events.length; i += 1) {
      const ev = p.events[i]!;
      const after = replay(p.events, process, i + 1);
      if (controlKinds(ev, before, after).includes("untraced_requirement")) {
        const key = `${p.id}:${ev.id}`;
        if (before.traceability.entries.length > 0) return key;
        fallback ??= key;
      }
      before = after;
    }
  }
  return fallback;
}

const STEP_TEXT: Record<string, string> = {
  holdout: "hold-out 受入テスト（実装を担当する AI からは見えないテスト）を書く",
  red: "Red：まず失敗するテストを書く",
  green: "Green：テストを通す最小限の実装をする",
  refactor: "Refactor：動作を変えずにコードを整理する",
  G3: "G3：別の AI が「頼んだ範囲の変更か・要件を満たすか」を判定する",
};

const DEVIATION_TEXT: Record<string, { headline: (ev: HubEvent) => string; control: string }> = {
  phase_rollback: {
    headline: (ev) => `工程を ${String(ev.payload?.to_phase ?? "")} に戻した（Phase 逆戻り）`,
    control: "Hub は戻した工程以降を「進行中」に戻す。先へ進むには、もう一度それぞれの承認を通す必要がある",
  },
  escalation: {
    headline: () => "AI の作業が進まないため、人に判断を求めた（エスカレーション）",
    control: "Hub は同じ理由で止まり続ける作業を人に知らせ、判断と対処を記録に残す",
  },
  local_fallback: {
    headline: () => "担当者が手元（ローカル）の Claude Code で作業することにした（ローカル退避）",
    control: "手元での変更も、戻すときは同じ品質ゲートを通す。ゲートを省略する抜け道にはしない",
  },
  interface_contract_violation: {
    headline: () => "他チームの API 契約（Interface Contract）を破る変更を検出した",
    control: "Hub は契約の所有者が認めない限り、この変更を通さない",
  },
};

export function narrate(ev: HubEvent, before: HubState, after: HubState, process: ProcessDefinition): Narration {
  const kinds = controlKinds(ev, before, after);
  const base = describe(ev, after, process);
  const controls = [base.control];
  if (kinds.includes("violation")) {
    const v = after.violations.at(-1)!;
    controls.push(`順序違反：${v.missing.join("・")} の承認より前に ${v.phase} の作業が始まった。Hub では承認が済むまで先の工程に進めない`);
  }
  const control = controls.filter(Boolean).join(" ／ ") || null;
  return { headline: base.headline, detail: base.detail, control, kinds };
}

function roleName(process: ProcessDefinition, id: string | undefined): string | null {
  return id ? (process.roles.find((r) => r.id === id)?.name ?? id) : null;
}

function actorLabel(ev: HubEvent, process: ProcessDefinition): string {
  if (ev.actor.name) return ev.actor.name;
  if (ev.actor.kind === "ai") return "AI";
  if (ev.actor.kind === "system") return "Hub";
  return roleName(process, ev.actor.role) ?? "担当者";
}

function failedResults(ev: HubEvent): GateResult[] {
  const results = Array.isArray(ev.payload?.results) ? (ev.payload.results as GateResult[]) : [];
  return results.filter((r) => r.status === "failed");
}

function describe(ev: HubEvent, after: HubState, process: ProcessDefinition): { headline: string; detail: string[]; control: string | null } {
  const p = ev.payload ?? {};
  switch (ev.type) {
    case "project.registered":
      return { headline: `プロジェクト「${String(p.project)}」を Hub に登録した`, detail: ["以降、このプロジェクトの工程・承認・監査記録は Hub で一元管理される"], control: null };
    case "process.pinned":
      return { headline: `このプロジェクトが従う工程のルール（プロセス定義 ${String(p.version)}）を固定した`, detail: ["途中でルールが改訂されても、どの版で進めたかが記録に残る"], control: null };
    case "constitution.pinned":
      return { headline: "AI への指示書（憲法 CLAUDE.md）の版を固定した", detail: ["このプロジェクトの AI は、全員が同じ版の指示で動く"], control: null };
    case "task.dispatched":
      return {
        headline: `${ev.task ?? "実装タスク"} を${p.team ? `「${String(p.team)}」の` : ""} AI に割り当てた`,
        detail: ["Hub が Spec・憲法の版・変更してよいファイルの範囲を添えて渡す"],
        control: null,
      };
    case "ai.session.started":
      return { headline: `${actorLabel(ev, process)}が作業（${String(p.skill)}）を始めた`, detail: [], control: null };
    case "ai.session.finished":
      return { headline: `${actorLabel(ev, process)}が作業（${String(p.skill)}）を終えた`, detail: [], control: null };
    case "ai.agent.started":
      return { headline: `AI の担当（${String(p.agent)}）が作業を始めた`, detail: [STEP_TEXT[String(p.step)] ?? ""].filter(Boolean), control: null };
    case "ai.agent.finished":
      return { headline: `AI の担当（${String(p.agent)}）が作業を終えた`, detail: [], control: null };
    case "commit.created":
      return { headline: `${actorLabel(ev, process)}が成果物をコミットした`, detail: [ev.summary], control: null };
    case "hook.blocked":
      return {
        headline: `作業終了時のチェック（Hook）が AI を止めた${Number(p.count) > 1 ? `（${String(p.count)} 回）` : ""}`,
        detail: ["当時の Plugin の不具合で、同じ理由のブロックが繰り返された"],
        control: "同じ理由で止まり続けると、Hub は人に知らせる（エスカレーション）",
      };
    case "requirements.updated": {
      const added = Array.isArray(p.added) ? (p.added as string[]) : [];
      const count = Array.isArray(p.requirements) ? p.requirements.length : 0;
      return {
        headline: added.length > 0 ? `要求に ${added.join("・")} を追加した（全 ${count} 件）` : `要求 Spec を更新した（全 ${count} 件）`,
        detail: ["要件（REQ）はテストコードに ID を書き込み、対応を機械的に確かめる"],
        control: added.length > 0 ? "追加した要件にテストが無い間、Hub の品質ゲートは作業の完了を通さない（トレーサビリティ検査）" : null,
      };
    }
    case "traceability.updated": {
      const entries = Array.isArray(p.entries) ? (p.entries as { tests: string[] }[]) : [];
      const withTests = entries.filter((e) => (e.tests ?? []).length > 0).length;
      return {
        headline: `トレーサビリティを更新した（${withTests} / ${entries.length} 件にテストが対応）`,
        detail: [ev.summary],
        control: null,
      };
    }
    case "gate.evaluated":
      return describeGate(ev);
    case "gate.approved":
      return describeApproval(ev, after, process);
    case "deviation.opened": {
      const d = DEVIATION_TEXT[String(p.deviation)];
      return { headline: d ? d.headline(ev) : ev.summary, detail: [ev.summary], control: d?.control ?? null };
    }
    case "deviation.closed": {
      const name = process.deviations.find((x) => x.id === p.deviation)?.name ?? String(p.deviation);
      return { headline: `${name}を解消した`, detail: [ev.summary], control: null };
    }
    default:
      return { headline: ev.summary, detail: [], control: null };
  }
}

function describeGate(ev: HubEvent) {
  const p = ev.payload ?? {};
  const failed = failedResults(ev);
  if (p.outcome === "passed") {
    return { headline: "品質ゲートを通過した", detail: [ev.summary], control: null };
  }
  const count = Number(p.count) > 1 ? `（同じ理由で ${String(p.count)} 回）` : "";
  return {
    headline: `品質ゲートが作業を止めた${count}`,
    detail: failed.map((r) => `${r.layer} ${r.check ?? ""}：${r.summary}`),
    control: "Hub は工程のルールに合わない成果物を、人が見る前に機械的に止める。直すまで先へ進めない",
  };
}

function describeApproval(ev: HubEvent, after: HubState, process: ProcessDefinition) {
  const a = after.approvals.at(-1)!;
  if (!a.valid) {
    return {
      headline: ev.actor.kind === "ai" ? `AI が「${a.gateName}」の承認欄に承認を書き込んだ` : `「${a.gateName}」の承認が無効だった`,
      detail: [a.reason ?? ""],
      control: "承認できるのは人間の役割だけ（プロセス定義）。Hub はこれを承認として扱わず、工程は先へ進まない",
    };
  }
  return {
    headline: `${actorLabel(ev, process)}が「${a.gateName}」を承認した → ${a.phase} が承認済みになった`,
    detail: [ev.summary],
    control: null,
  };
}
