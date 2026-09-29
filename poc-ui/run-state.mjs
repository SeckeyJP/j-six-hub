/** @param {string} state */
export function canCancelCliRun(state) {
  return state === "started";
}

/** Hub rechecks the recorded pid and target Git; a live controller in this process is cancelled instead.
 * @param {string} state
 */
export function canRecoverCliRun(state) {
  return ["unknown", "claimed", "cancel_requested", "stop_unconfirmed"].includes(state);
}

/** @param {string} reason */
export function explainCliEvidence(reason) {
  const [, runId = "不明", state = "unknown"] = reason.split(":");
  /** @type {Record<string,string>} */ const messages = {
    evidence_unknown: "非公開ログが欠落またはhash不一致",
    started: "CLIを実行中",
    claimed: "CLI投入claim後の状態を確認中",
    unknown: "CLIの停止・結果を要確認",
    held: "CLI preflightで保留",
    timed_out: "CLIがtimeout",
    cancelled: "CLI取消済み",
    cancel_requested: "CLI取消処理を確認中",
    stop_unconfirmed: "CLI停止を確認できないため全投入を保留",
    failed: "CLI processが失敗",
    invalid_events: "CLI event形式が不正",
    hook_unobserved: "共通Hook拒否を確認できない",
    output_limit: "CLI出力上限を超過",
    inspection_failed: "候補検査が失敗",
    recovered: "停止照合後に復旧記録済み。この世代は差戻しが必要",
  };
  return `${messages[state] ?? `CLI状態 ${state}`} (run ${runId})`;
}
