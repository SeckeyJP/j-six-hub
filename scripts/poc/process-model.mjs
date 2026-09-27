const sha256 = /^[0-9a-f]{64}$/;
const commitId = /^[0-9a-f]{40,64}$/;
const supportedKinds = new Set([
  "project.created", "artifact.submitted", "phase.review_requested", "gate.check_recorded",
  "gate.local_decision", "phase.transitioned", "phase.reopened",
]);

/** @param {string} value */
function instant(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("日時の形式が不正です");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const milliText = match[7] ?? "0";
  const zone = match[8] ?? "Z";
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59) throw new Error("日時の値が不正です");
  let offset = 0;
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) throw new Error("日時の時差が不正です");
    offset = (zoneHour * 60 + zoneMinute) * (zone[0] === "+" ? 1 : -1);
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, Number((milliText ?? "0").padEnd(3, "0"))) - offset * 60_000;
}

/** @param {any} process @param {string} pinnedSha256 */
export function validateProcess(process, pinnedSha256) {
  if (!sha256.test(pinnedSha256) || process?._source?.sha256 !== pinnedSha256 || process.schema_version !== 1) {
    throw new Error("固定プロセス版・schemaが一致しません");
  }
  const phases = /** @type {any[]} */ (process.phases);
  const gates = /** @type {any[]} */ (process.gates);
  const artifacts = /** @type {any[]} */ (process.artifacts);
  const machines = /** @type {any[]} */ (process.state_machines);
  if (!Array.isArray(phases) || !Array.isArray(gates) || !Array.isArray(process.transitions) ||
    !Array.isArray(artifacts) || !Array.isArray(machines)) {
    throw new Error("プロセスのPhase/Gate/遷移が不足しています");
  }
  const artifactIds = new Set(artifacts.map((item) => item.id));
  if (!artifactIds.size || artifactIds.size !== artifacts.length) throw new Error("artifact IDが不正です");
  for (const kind of ["phase", "task"]) {
    const machine = machines.find((item) => item.id === kind);
    if (!machine || !Array.isArray(machine.states) || !Array.isArray(machine.transitions) ||
      !/** @type {any[]} */ (machine.states).some((item) => item.id === machine.initial)) throw new Error(`state machine ${kind}が不正です`);
    const states = new Set(/** @type {any[]} */ (machine.states).map((item) => item.id));
    if (states.size !== machine.states.length || /** @type {any[]} */ (machine.transitions).some((item) => !states.has(item.from) || !states.has(item.to))) {
      throw new Error(`state machine ${kind}の遷移が不正です`);
    }
  }
  const phaseIds = phases.map((phase) => phase.id);
  if (new Set(phaseIds).size !== phaseIds.length || phaseIds.length < 2) throw new Error("Phase IDが不正です");
  const gateById = Object.fromEntries(gates.map((gate) => [gate.id, gate]));
  /** @type {Record<string, any>} */
  const gateByPhase = {};
  for (const phase of phases) {
    if (!Array.isArray(phase.outputs) || !phase.outputs.length ||
      /** @type {string[]} */ (phase.outputs).some((id) => !artifactIds.has(id))) {
      throw new Error(`Phase ${phase.id}のoutputs/artifactが不正です`);
    }
    if (phase.gate) {
      const gate = gateById[phase.gate];
      if (!gate || gate.phase !== phase.id || !Array.isArray(gate.layers)) throw new Error(`Phase ${phase.id}のgateが不正です`);
      gateByPhase[phase.id] = gate;
    } else gateByPhase[phase.id] = null;
  }
  for (let index = 1; index < phases.length - 1; index += 1) {
    const from = phases[index];
    const to = phases[index + 1];
    if (!/** @type {any[]} */ (process.transitions).some((item) => item.from === from.id && item.to === to.id &&
      item.condition === (from.mode === "per_task" ? "all_tasks_done" : from.gate))) {
      throw new Error(`定義済み遷移 ${from.id}→${to.id} がありません`);
    }
  }
  if (!commitId.test(process._source?.tag)) throw new Error("固定process参照commitが不正です");
  return { phases, phaseIds, gates: gateByPhase, processCommit: process._source.tag };
}

/** @param {any[]} records @param {any} model @param {{repoId:string,commit:string,baseCommitVerified:boolean,verifiedRecordIds:string[],currentRecordIds:string[]}} snapshot */
function projectPosition(records, model, snapshot) {
  const first = records[0];
  if (first?.kind !== "project.created") throw new Error("project.createdが先頭にありません");
  if (!sha256.test(first.payload?.processSha256) || !sha256.test(first.payload?.policySha256) ||
    !commitId.test(first.payload?.processCommit) || first.payload.processCommit !== model.processCommit ||
    !commitId.test(first.payload?.targetCommit) ||
    typeof first.payload?.targetRepoId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(first.payload.targetRepoId) ||
    typeof first.payload.fixtureId !== "string" || !first.payload.fixtureId.trim()) {
    throw new Error("案件作成recordの対象repo・基準commit・process版・合成題材が不正です");
  }
  const ids = new Set();
  let phase = model.phaseIds[0];
  let generation = 0;
  let previousTime = -Infinity;
  for (const [index, record] of records.entries()) {
    const recordedTime = instant(record.recordedAt);
    if (recordedTime < previousTime) throw new Error("record時刻の順序が不正です");
    previousTime = recordedTime;
    if (record.schemaVersion !== 1 || !supportedKinds.has(record.kind) ||
      !record.recordId || ids.has(record.recordId) || record.projectId !== first.projectId) {
      throw new Error("record schema・種別・ID・projectが不正です");
    }
    if (index > 0 && record.kind === "project.created") throw new Error("project.createdが重複しています");
    ids.add(record.recordId);
    const source = /** @type {any[]} */ (model.phases).find((item) => item.id === phase);
    const gate = model.gates[phase];
    if (record.kind === "artifact.submitted") {
      if (record.payload?.phase !== phase) throw new Error("現在Phase以外の提出は逆戻りが必要です");
      if (record.payload.generation !== generation) throw new Error("提出recordの世代が不正です");
      if (!/** @type {string[]} */ (source.outputs).includes(record.payload.artifactId)) throw new Error("未知の成果物artifactです");
      if (!commitId.test(record.payload.targetCommit) || !sha256.test(record.payload.sha256) ||
        typeof record.payload.path !== "string" || !record.payload.path) throw new Error("提出recordの対象版が不正です");
    }
    if (record.kind === "phase.review_requested" &&
      (!gate || record.payload?.phase !== phase || record.payload?.generation !== generation)) {
      throw new Error("審査要求の現在Phase・世代が不正です");
    }
    if (record.kind === "gate.local_decision" &&
      (!gate || record.payload?.phase !== phase || record.payload?.generation !== generation ||
        record.payload?.gateId !== gate.id)) throw new Error("模擬判断の現在Phase・世代が不正です");
    if (record.kind === "gate.check_recorded") {
      const layer = /** @type {any[]} */ (gate?.layers ?? []).find((item) => item.id === record.payload?.layerId);
      if (!gate || record.payload?.phase !== phase || record.payload?.generation !== generation ||
        record.payload?.gateId !== gate.id || !/** @type {any[]} */ (layer?.checks ?? []).some((item) => item.id === record.payload?.checkId)) {
        throw new Error("検査recordのPhase・ゲート・チェックが不正です");
      }
    }
    if (record.kind === "phase.transitioned") {
      if (snapshot.baseCommitVerified !== true) throw new Error("基準commitがGit未検証のため遷移履歴を再生できません");
      const next = model.phaseIds[model.phaseIds.indexOf(phase) + 1];
      if (record.payload?.from !== phase || record.payload.to !== next || record.payload.generation !== generation) {
        throw new Error(`定義外または古いPhase遷移です: ${phase}→${record.payload?.to}`);
      }
      const before = records.slice(0, index);
      const submissions = before.filter((item) => item.kind === "artifact.submitted" &&
        item.payload?.phase === phase && item.payload?.generation === generation);
      const active = /** @type {string[]} */ (source.outputs).map((artifactId) =>
        [...submissions].reverse().find((item) => item.payload?.artifactId === artifactId));
      if (active.some((item) => !item || !sha256.test(item.payload.sha256) || !commitId.test(item.payload.targetCommit))) {
        throw new Error(`Phase ${phase}の提出証拠が不足しています`);
      }
      const activeIds = active.map((item) => item.recordId).sort();
      if (active.some((item) => !snapshot.verifiedRecordIds.includes(item.recordId))) {
        throw new Error(`Phase ${phase}の過去提出がGit未検証です`);
      }
      if (active.some((item) => item.payload.targetCommit !== record.payload.subjectCommit) ||
        record.payload.policySha256 !== first.payload.policySha256 ||
        JSON.stringify([...(record.payload.artifactRecordIds ?? [])].sort()) !== JSON.stringify(activeIds)) {
        throw new Error(`Phase ${phase}の遷移対象版・提出集合・方針が一致しません`);
      }
      if (gate) {
        const review = [...before].reverse().find((item) => item.kind === "phase.review_requested" &&
          item.payload?.phase === phase && item.payload?.generation === generation);
        if (!review || active.some((item) => before.indexOf(item) >= before.indexOf(review)) ||
          review.payload.policySha256 !== first.payload.policySha256 ||
          JSON.stringify([...(review.payload.artifactRecordIds ?? [])].sort()) !== JSON.stringify(activeIds) ||
          record.payload.reviewRecordId !== review.recordId ||
          gateGaps(gate, before, review, generation, record.recordedAt).length) {
          throw new Error(`Phase ${phase}のゲート証拠が不足しています`);
        }
        const decisions = before.filter((item) => item.kind === "gate.local_decision" &&
          item.payload?.gateId === gate.id && item.payload?.reviewRecordId === review.recordId &&
          item.payload?.generation === generation && before.indexOf(item) > before.indexOf(review));
        const latest = decisions.at(-1);
        if (!latest || JSON.stringify(record.payload.decisionRecordIds) !== JSON.stringify([latest.recordId])) {
          throw new Error(`Phase ${phase}の判断record参照が一致しません`);
        }
      } else if (record.payload.reviewRecordId !== null ||
        JSON.stringify(record.payload.decisionRecordIds) !== "[]") {
        throw new Error(`Phase ${phase}には承認ゲートがありません`);
      }
      phase = next;
    }
    if (record.kind === "phase.reopened") {
      const target = record.payload?.phase;
      if (!model.phaseIds.includes(target) || model.phaseIds.indexOf(target) >= model.phaseIds.indexOf(phase) ||
        record.payload.generation !== generation + 1 || !record.payload.reason) {
        throw new Error("Phase逆戻りの対象・世代・理由が不正です");
      }
      phase = target;
      generation += 1;
    }
  }
  return { phase, generation, first };
}

/** @param {any} gate @param {any[]} records @param {any} review @param {number} generation @param {string} now */
function gateGaps(gate, records, review, generation, now) {
  if (!gate) return [];
  const layers = /** @type {any[]} */ (gate.layers);
  if (gate.scope === "task") return layers.flatMap((layer) => /** @type {any[]} */ (layer.checks)
    .map((check) => `check:${layer.id}/${check.id}:unimplemented`));
  const missing = [];
  for (const layer of layers) {
    for (const check of layer.checks) {
      if (check.kind !== "human_approval") {
        missing.push(`check:${check.id}:unimplemented`);
        continue;
      }
      const reviewIndex = review ? records.findIndex((item) => item.recordId === review.recordId) : -1;
      const decision = [...records.slice(reviewIndex + 1)].reverse().find((item) => item.kind === "gate.local_decision" &&
        item.payload?.gateId === gate.id && item.payload?.generation === generation &&
        item.payload?.reviewRecordId === review?.recordId);
      let timeValid = false;
      if (decision?.payload?.expiresAt) {
        try {
          const issued = instant(decision.recordedAt);
          const expires = instant(decision.payload.expiresAt);
          const current = instant(now);
          timeValid = issued <= current && expires > issued && expires > current;
        } catch { timeValid = false; }
      }
      if (!decision || decision.payload.outcome !== "approved" || decision.payload.simulated !== true ||
        !check.approver_roles.includes(decision.payload.role) || !decision.payload.reason ||
        !timeValid) {
        missing.push(`decision:${gate.id}/${check.id}:missing-or-expired`);
      }
    }
  }
  return missing;
}

/**
 * Pure projection. The snapshot must come from a separate Git verifier; an unverified claim is never a pass.
 * @param {any[]} records @param {any} process @param {string} policySha256
 * @param {{repoId:string,commit:string,baseCommitVerified:boolean,verifiedRecordIds:string[],currentRecordIds:string[]}} snapshot @param {string=} now
 */
export function evaluateProject(records, process, policySha256, snapshot, now = new Date().toISOString()) {
  if (!Array.isArray(records) || !records.length) throw new Error("案件recordがありません");
  instant(now);
  if (!snapshot || !Array.isArray(snapshot.verifiedRecordIds) || !Array.isArray(snapshot.currentRecordIds)) {
    throw new Error("対象Gitの履歴・現在版照合結果がありません");
  }
  const model = validateProcess(process, records[0]?.payload?.processSha256);
  const { phase, generation, first } = projectPosition(records, model, snapshot);
  const current = model.phases.find((item) => item.id === phase);
  const nextPhase = model.phaseIds[model.phaseIds.indexOf(phase) + 1] ?? null;
  const gate = model.gates[phase];
  const missing = [];
  if (!sha256.test(policySha256) || first.payload.policySha256 !== policySha256) missing.push("policy:changed");
  if (snapshot.repoId !== first.payload.targetRepoId) missing.push("target:repo-mismatch");
  if (snapshot.baseCommitVerified !== true) missing.push("target:baseline-unverified");
  if (!commitId.test(snapshot?.commit) || !Array.isArray(snapshot?.verifiedRecordIds)) missing.push("target:unverified");
  /** @type {any[]} */
  let activeTransitions = [];
  for (const item of records) {
    if (item.kind === "phase.transitioned") activeTransitions.push(item);
    if (item.kind === "phase.reopened") {
      const reopenIndex = model.phaseIds.indexOf(item.payload.phase);
      activeTransitions = activeTransitions.filter((transition) =>
        model.phaseIds.indexOf(transition.payload.from) < reopenIndex);
    }
  }
  for (const transition of activeTransitions) {
    for (const id of transition.payload.artifactRecordIds) {
      if (!snapshot.currentRecordIds.includes(id)) missing.push(`passed-artifact:${id}:changed`);
    }
  }
  const submissions = records.filter((item) => item.kind === "artifact.submitted" &&
    item.payload?.phase === phase && item.payload?.generation === generation);
  const outputs = /** @type {string[]} */ (current.outputs);
  const active = outputs.map((artifactId) => [...submissions].reverse().find((item) => item.payload.artifactId === artifactId));
  for (let index = 0; index < active.length; index += 1) {
    const item = active[index];
    if (!item) { missing.push(`artifact:${outputs[index]}`); continue; }
    if (item.payload.targetCommit !== snapshot.commit) missing.push("target:commit-changed");
    if (!sha256.test(item.payload.sha256) || !snapshot.verifiedRecordIds.includes(item.recordId)) {
      missing.push(`artifact:${item.payload.artifactId}:unverified`);
    }
  }
  if (gate) {
    let review = [...records].reverse().find((item) => item.kind === "phase.review_requested" &&
      item.payload?.phase === phase && item.payload?.generation === generation);
    const currentIds = active.filter(Boolean).map((item) => item.recordId).sort();
    if (!review || active.some((item) => records.indexOf(item) >= records.indexOf(review)) ||
      review.payload.policySha256 !== policySha256 ||
      JSON.stringify([...(review.payload.artifactRecordIds ?? [])].sort()) !== JSON.stringify(currentIds)) {
      missing.push(`review:${phase}`);
      review = null;
    }
    missing.push(...gateGaps(gate, records, review, generation, now));
  }
  if (!nextPhase) missing.push("phase:final");
  return { projectId: first.projectId, phase, generation, nextPhase, gate: gate?.id ?? null,
    canTransition: missing.length === 0, missing: [...new Set(missing)] };
}
