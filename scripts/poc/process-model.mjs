const sha256 = /^[0-9a-f]{64}$/;
const commitId = /^[0-9a-f]{40,64}$/;
const supportedKinds = new Set([
  "project.created", "artifact.submitted", "phase.review_requested", "gate.check_recorded",
  "gate.local_decision", "phase.transitioned", "phase.reopened",
]);

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
  return { phases, phaseIds, gates: gateByPhase };
}

/** @param {any[]} records @param {any} model */
function projectPosition(records, model) {
  const first = records[0];
  if (first?.kind !== "project.created") throw new Error("project.createdが先頭にありません");
  const ids = new Set();
  let phase = model.phaseIds[0];
  let generation = 0;
  for (const [index, record] of records.entries()) {
    if (record.schemaVersion !== 1 || !supportedKinds.has(record.kind) ||
      !record.recordId || ids.has(record.recordId) || record.projectId !== first.projectId) {
      throw new Error("record schema・種別・ID・projectが不正です");
    }
    if (index > 0 && record.kind === "project.created") throw new Error("project.createdが重複しています");
    ids.add(record.recordId);
    if (record.kind === "phase.transitioned") {
      const next = model.phaseIds[model.phaseIds.indexOf(phase) + 1];
      if (record.payload?.from !== phase || record.payload.to !== next || record.payload.generation !== generation) {
        throw new Error(`定義外または古いPhase遷移です: ${phase}→${record.payload?.to}`);
      }
      const before = records.slice(0, index);
      const source = /** @type {any[]} */ (model.phases).find((item) => item.id === phase);
      const submissions = before.filter((item) => item.kind === "artifact.submitted" &&
        item.payload?.phase === phase && item.payload?.generation === generation);
      const active = /** @type {string[]} */ (source.outputs).map((artifactId) =>
        [...submissions].reverse().find((item) => item.payload?.artifactId === artifactId));
      if (active.some((item) => !item || !sha256.test(item.payload.sha256) || !commitId.test(item.payload.targetCommit))) {
        throw new Error(`Phase ${phase}の提出証拠が不足しています`);
      }
      const gate = model.gates[phase];
      if (gate) {
        const review = [...before].reverse().find((item) => item.kind === "phase.review_requested" &&
          item.payload?.phase === phase && item.payload?.generation === generation);
        const ids = active.map((item) => item.recordId).sort();
        if (!review || active.some((item) => before.indexOf(item) >= before.indexOf(review)) ||
          review.payload.policySha256 !== first.payload.policySha256 ||
          JSON.stringify([...(review.payload.artifactRecordIds ?? [])].sort()) !== JSON.stringify(ids) ||
          gateGaps(gate, before, review, generation, record.recordedAt).length) {
          throw new Error(`Phase ${phase}のゲート証拠が不足しています`);
        }
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
      if (!decision || decision.payload.outcome !== "approved" || decision.payload.simulated !== true ||
        !check.approver_roles.includes(decision.payload.role) || !decision.payload.reason ||
        !decision.payload.expiresAt || decision.payload.expiresAt <= now) {
        missing.push(`decision:${gate.id}/${check.id}:missing-or-expired`);
      }
    }
  }
  return missing;
}

/**
 * Pure projection. The snapshot must come from a separate Git verifier; an unverified claim is never a pass.
 * @param {any[]} records @param {any} process @param {string} policySha256
 * @param {{commit:string,verifiedRecordIds:string[]}} snapshot @param {string=} now
 */
export function evaluateProject(records, process, policySha256, snapshot, now = new Date().toISOString()) {
  if (!Array.isArray(records) || !records.length) throw new Error("案件recordがありません");
  const model = validateProcess(process, records[0]?.payload?.processSha256);
  const { phase, generation, first } = projectPosition(records, model);
  const current = model.phases.find((item) => item.id === phase);
  const nextPhase = model.phaseIds[model.phaseIds.indexOf(phase) + 1] ?? null;
  const gate = model.gates[phase];
  const missing = [];
  if (!sha256.test(policySha256) || first.payload.policySha256 !== policySha256) missing.push("policy:changed");
  if (!commitId.test(snapshot?.commit) || !Array.isArray(snapshot?.verifiedRecordIds)) missing.push("target:unverified");
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
