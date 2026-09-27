import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { appendRecord, initializeLedger, readLedger } from "./ledger.mjs";
import { verifyArtifact, verifiedSnapshot } from "./artifact-verifier.mjs";
import { evaluateProject, validateProcess } from "./process-model.mjs";
import { localPolicySha256 } from "./policy.mjs";

const commitPattern = /^[0-9a-f]{40,64}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const writablePhases = new Set(["P0", "P1", "P2", "P3"]);

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** @param {string} repo */
function head(repo) {
  const value = git(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!commitPattern.test(value)) throw new Error("対象Git HEADが不正です");
  return value;
}

/** @param {any[]} records @param {string} projectId */
function recordsFor(records, projectId) {
  return records.filter((record) => record.projectId === projectId);
}

/** @param {any[]} records @param {string} kind @param {string} phase @param {number} generation */
function latest(records, kind, phase, generation) {
  return [...records].reverse().find((record) => record.kind === kind &&
    record.payload?.phase === phase && record.payload?.generation === generation);
}

/** @param {any[]} records @param {string} phase @param {number} generation @param {string[]} outputs */
function activeArtifacts(records, phase, generation, outputs) {
  return outputs.map((artifactId) => latest(records.filter((record) =>
    record.payload?.artifactId === artifactId), "artifact.submitted", phase, generation));
}

/** @param {unknown} value @param {string} name */
function requireText(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new Error(`${name}が不正です`);
  return value.trim();
}

/** Show only reviewed fields from the ledger, never arbitrary payloads.
 * @param {any[]} records @param {any} projection @param {any} process @returns {any[]}
 */
function activityFor(records, projection, process) {
  const phases = process.phases.map((/** @type {any} */ phase) => phase.id);
  const reviews = new Map(records.filter((item) => item.kind === "phase.review_requested")
    .map((item) => [item.recordId, item]));
  const submissions = new Map(records.filter((item) => item.kind === "artifact.submitted")
    .map((item) => [item.recordId, item]));
  const latestReview = latest(records, "phase.review_requested", projection.phase, projection.generation);
  let replayPhase = phases[0];
  const activity = /** @type {any[]} */ (records.map((record) => {
    const payload = record.payload ?? {};
    const base = { recordId: record.recordId, recordedAt: record.recordedAt };
    if (record.kind === "phase.transitioned") {
      replayPhase = payload.to;
      return [{ ...base, kind: "transition", from: payload.from, to: payload.to,
        generation: payload.generation, targetCommit: payload.subjectCommit }];
    }
    if (record.kind === "phase.reopened") {
      const from = replayPhase;
      replayPhase = payload.phase;
      return [{ ...base, kind: "reopen", from, to: payload.phase,
        generation: payload.generation, reason: payload.reason,
        invalidatedPhases: phases.slice(phases.indexOf(payload.phase), phases.indexOf(from) + 1) }];
    }
    if (record.kind === "phase.review_requested") {
      const targetCommits = [...new Set((payload.artifactRecordIds ?? [])
        .map((/** @type {string} */ id) => submissions.get(id)?.payload?.targetCommit).filter(Boolean))];
      const state = payload.phase !== projection.phase ? "historical" :
          record.recordId === latestReview?.recordId && !projection.missing.includes(`review:${payload.phase}`) ? "current" : "superseded";
      return [{ ...base, kind: "review", phase: payload.phase, generation: payload.generation,
        artifactRecordIds: payload.artifactRecordIds, targetCommits,
        policySha256: payload.policySha256, state }];
    }
    if (record.kind === "gate.local_decision") {
      const review = reviews.get(payload.reviewRecordId);
      const latestDecision = [...records].reverse().find((item) => item.kind === "gate.local_decision" &&
        item.payload?.reviewRecordId === payload.reviewRecordId);
      const state = payload.phase !== projection.phase ? "historical" :
          payload.reviewRecordId !== latestReview?.recordId || record.recordId !== latestDecision?.recordId ||
          projection.missing.includes(`review:${payload.phase}`) ? "superseded" :
            payload.outcome === "rejected" ? "rejected" :
              Date.parse(payload.expiresAt) <= Date.now() ? "expired" : "current";
      return [{ ...base, kind: "decision", phase: payload.phase, generation: payload.generation,
        gateId: payload.gateId, reviewRecordId: payload.reviewRecordId,
        targetCommits: review ? [...new Set((review.payload.artifactRecordIds ?? [])
          .map((/** @type {string} */ id) => submissions.get(id)?.payload?.targetCommit).filter(Boolean))] : [],
        role: payload.role, outcome: payload.outcome, simulated: true,
        reason: payload.reason, expiresAt: payload.expiresAt, state }];
    }
    return [];
  }).flat());
  for (const [index, item] of activity.entries()) {
    if (!["review", "decision", "transition"].includes(item.kind)) continue;
    const affectedPhase = item.kind === "transition" ? item.from : item.phase;
    if (activity.slice(index + 1).some((later) => later.kind === "reopen" &&
      later.invalidatedPhases.includes(affectedPhase))) item.state = "invalidated";
  }
  return activity;
}

/** A project-specific verification failure must not hide healthy projects.
 * @param {any[]} records @param {string} projectId
 */
function heldProject(records, projectId) {
  const created = recordsFor(records, projectId)[0];
  return { projectId, fixtureId: created?.kind === "project.created" ? created.payload.fixtureId : null,
    phase: null, phaseName: "Git・工程照合不能", generation: null, verified: false,
    canTransition: false, missing: ["target:verification-unknown"],
    holdReason: "対象Gitまたは工程記録を照合できません。fixture、HEAD、基準commit系列を確認してください。",
    simulated: true };
}

/** @param {any} config @param {any[]} records @param {string} projectId */
function currentProjection(config, records, projectId) {
  const projectRecords = recordsFor(records, projectId);
  const created = projectRecords[0];
  if (created?.kind !== "project.created") throw new Error("案件が見つかりません");
  const fixture = config.fixtures[created.payload.fixtureId];
  if (!fixture || fixture.repoId !== created.payload.targetRepoId) throw new Error("固定fixtureの対応が変わりました");
  const targetCommit = head(fixture.repo);
  const snapshot = verifiedSnapshot(fixture.repo, projectRecords, targetCommit, fixture.repoId);
  const projection = evaluateProject(projectRecords, config.process, localPolicySha256, snapshot);
  const phaseDefinition = /** @type {any[]} */ (config.process.phases).find((item) => item.id === projection.phase);
  const gateDefinition = /** @type {any[]} */ (config.process.gates).find((item) => item.id === projection.gate);
  const outputs = /** @type {string[]} */ (phaseDefinition.outputs);
  const artifacts = activeArtifacts(projectRecords, projection.phase, projection.generation, outputs)
    .map((record, index) => ({ artifactId: outputs[index], recordId: record?.recordId ?? null,
      path: record?.payload.path ?? null, sha256: record?.payload.sha256 ?? null,
      verified: record ? snapshot.currentRecordIds.includes(record.recordId) : false }));
  return { projectId, fixtureId: created.payload.fixtureId, targetRepoId: fixture.repoId,
    targetCommit, baseCommit: created.payload.targetCommit, policySha256: localPolicySha256,
    processSha256: created.payload.processSha256, phase: projection.phase,
    phaseName: phaseDefinition.name, generation: projection.generation, verified: true,
    nextPhase: projection.nextPhase, gate: projection.gate,
    approverRoles: /** @type {any[]} */ (gateDefinition?.layers ?? []).flatMap((layer) => layer.checks)
      .filter((check) => check.kind === "human_approval")
      .flatMap((check) => check.approver_roles) ?? [],
    priorPhases: /** @type {any[]} */ (config.process.phases).slice(0, config.process.phases.findIndex((/** @type {any} */ item) => item.id === projection.phase))
      .map((item) => ({ id: item.id, name: item.name })),
    requiredArtifacts: outputs.map((artifactId) => ({ id: artifactId,
      name: /** @type {any[]} */ (config.process.artifacts).find((item) => item.id === artifactId)?.name ?? artifactId })),
    canTransition: projection.canTransition && writablePhases.has(projection.phase),
    missing: projection.missing, artifacts, simulated: true,
    activity: activityFor(projectRecords, projection, config.process),
    invalidRecords: snapshot.invalidRecords.map((item) => ({ recordId: item.recordId, reason: item.reason })) };
}

/** A domain entry point shared by the browser API and future terminal commands. */
/** @param {{ledgerRoot:string,process:any,fixtures:Record<string,{repo:string,repoId:string}>}} config */
export function createPocService(config) {
  validateProcess(config.process, config.process?._source?.sha256);
  if (!config.ledgerRoot || !config.fixtures || !Object.keys(config.fixtures).length) throw new Error("PoC設定が不足しています");
  const fixtures = Object.entries(config.fixtures);
  for (const [fixtureId, fixture] of fixtures) {
    if (!idPattern.test(fixtureId) || !idPattern.test(fixture.repoId) || !fixture.repo) throw new Error("fixture設定が不正です");
  }

  async function initialize() {
    await initializeLedger(config.ledgerRoot);
    for (const [, fixture] of fixtures) {
      const root = await realpath(fixture.repo);
      if (git(fixture.repo, ["rev-parse", "--show-toplevel"]) !== root) throw new Error("fixtureは独立Git rootに限定します");
      head(fixture.repo);
    }
    await readLedger(config.ledgerRoot);
  }

  async function list() {
    const state = await readLedger(config.ledgerRoot);
    const ids = [...new Set(state.records.map((item) => item.projectId))];
    return { head: state.head, policySha256: localPolicySha256,
      fixtures: fixtures.map(([fixtureId, fixture]) => ({
      fixtureId, repoId: fixture.repoId,
      ...(() => { try { return { targetCommit: head(fixture.repo), verified: true }; }
        catch { return { targetCommit: null, verified: false }; } })(),
    })), projects: ids.map((id) => {
      try { return currentProjection(config, state.records, id); }
      catch { return heldProject(state.records, id); }
    }) };
  }

  /** @param {string} projectId */
  async function detail(projectId) {
    const state = await readLedger(config.ledgerRoot);
    return { head: state.head, project: currentProjection(config, state.records, projectId) };
  }

  /** @param {Record<string,any>} command */
  async function execute(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("操作形式が不正です");
    if (command.expectedHead !== null && !commitPattern.test(command.expectedHead ?? "")) throw new Error("期待台帳refが不正です");
    let projectId = command.projectId;
    const saved = await appendRecord(config.ledgerRoot, command.expectedHead, async (/** @type {{head:string|null,records:any[]}} */ state) => {
      if (command.policySha256 !== localPolicySha256) throw new Error("PoC方針hashが一致しません");
      if (command.type === "project.create") {
        const fixture = config.fixtures[command.fixtureId];
        if (!fixture || !commitPattern.test(command.targetCommit) || head(fixture.repo) !== command.targetCommit) {
          throw new Error("許可fixtureまたは基準commitが不正です");
        }
        projectId = randomUUID();
        return { schemaVersion: 1, recordId: randomUUID(), projectId, kind: "project.created",
          recordedAt: new Date().toISOString(), payload: { fixtureId: command.fixtureId,
            targetRepoId: fixture.repoId, targetCommit: command.targetCommit,
            processCommit: config.process._source.tag, processSha256: config.process._source.sha256,
            policySha256: localPolicySha256 } };
      }
      if (typeof projectId !== "string" || !projectId) throw new Error("案件IDが不足しています");
      const projectRecords = recordsFor(state.records, projectId);
      const current = currentProjection(config, state.records, projectId);
      if (!writablePhases.has(current.phase) && command.type !== "phase.reopen") {
        throw new Error("このPhaseの操作・検査は未実装です");
      }
      if (command.generation !== current.generation) throw new Error("案件世代が古いです");
      if (command.targetCommit !== current.targetCommit) throw new Error("対象Git commitが変わりました");
      const fixture = config.fixtures[current.fixtureId];
      if (!fixture) throw new Error("固定fixtureが見つかりません");
      const snapshot = verifiedSnapshot(fixture.repo, projectRecords, current.targetCommit, fixture.repoId);
      const model = validateProcess(config.process, current.processSha256);
      const phase = model.phases.find((item) => item.id === current.phase);
      const gate = model.gates[current.phase];
      const common = { schemaVersion: 1, recordId: randomUUID(), projectId,
        recordedAt: new Date().toISOString() };
      let record;
      if (command.type === "artifact.submit") {
        if (!phase.outputs.includes(command.artifactId) || !hashPattern.test(command.sha256 ?? "")) {
          throw new Error("成果物の種別またはhashが不正です");
        }
        verifyArtifact(fixture.repo, /** @type {{targetCommit:string,path:string,sha256:string}} */ (command));
        record = { ...common, kind: "artifact.submitted", payload: { phase: current.phase,
          generation: current.generation, artifactId: command.artifactId,
          targetCommit: current.targetCommit, path: command.path, sha256: command.sha256 } };
      } else if (command.type === "review.request") {
        if (!gate || current.phase === "P4") throw new Error("現在Phaseにローカル模擬レビューはありません");
        const active = activeArtifacts(projectRecords, current.phase, current.generation, phase.outputs);
        if (active.some((item) => !item || !snapshot.currentRecordIds.includes(item.recordId) ||
          item.payload.targetCommit !== current.targetCommit)) throw new Error("有効な提出物が不足しています");
        record = { ...common, kind: "phase.review_requested", payload: { phase: current.phase,
          generation: current.generation, artifactRecordIds: active.map((item) => item.recordId).sort(),
          policySha256: localPolicySha256 } };
      } else if (command.type === "decision.record") {
        if (!gate) throw new Error("現在Phaseに判断ゲートはありません");
        const review = latest(projectRecords, "phase.review_requested", current.phase, current.generation);
        if (!review || current.missing.some((item) => item.startsWith("review:") || item.startsWith("artifact:") ||
          item.startsWith("target:") || item.startsWith("passed-artifact:"))) throw new Error("有効な審査要求がありません");
        const check = /** @type {any[]} */ (gate.layers).flatMap((layer) => layer.checks)
          .find((item) => item.kind === "human_approval");
        if (!check?.approver_roles.includes(command.role) || !["approved", "rejected"].includes(command.outcome)) {
          throw new Error("模擬判断の役割または結果が不正です");
        }
        const expiresAt = requireText(command.expiresAt, "有効期限");
        if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new Error("有効期限が過ぎています");
        record = { ...common, kind: "gate.local_decision", payload: { phase: current.phase,
          generation: current.generation, gateId: gate.id, reviewRecordId: review.recordId,
          outcome: command.outcome, simulated: true, role: command.role,
          reason: requireText(command.reason, "判断理由"), expiresAt } };
      } else if (command.type === "phase.transition") {
        if (!current.canTransition) throw new Error(`遷移条件が不足しています: ${current.missing.join(", ")}`);
        const active = activeArtifacts(projectRecords, current.phase, current.generation, phase.outputs);
        const review = gate ? latest(projectRecords, "phase.review_requested", current.phase, current.generation) : null;
        const decision = gate ? [...projectRecords].reverse().find((item) => item.kind === "gate.local_decision" &&
          item.payload?.reviewRecordId === review?.recordId) : null;
        record = { ...common, kind: "phase.transitioned", payload: { from: current.phase,
          to: current.nextPhase, generation: current.generation, subjectCommit: current.targetCommit,
          artifactRecordIds: active.map((item) => item.recordId).sort(), policySha256: localPolicySha256,
          reviewRecordId: review?.recordId ?? null, decisionRecordIds: decision ? [decision.recordId] : [] } };
      } else if (command.type === "phase.reopen") {
        if (!model.phaseIds.includes(command.phase) || model.phaseIds.indexOf(command.phase) >= model.phaseIds.indexOf(current.phase)) {
          throw new Error("差戻し先Phaseが不正です");
        }
        record = { ...common, kind: "phase.reopened", payload: { phase: command.phase,
          generation: current.generation + 1, reason: requireText(command.reason, "差戻し理由") } };
      } else throw new Error("未対応の操作です");
      const proposed = [...projectRecords, record];
      const nextSnapshot = verifiedSnapshot(fixture.repo, proposed, current.targetCommit, fixture.repoId);
      if (record.kind === "artifact.submitted" && !nextSnapshot.verifiedRecordIds.includes(record.recordId)) {
        throw new Error(`成果物をGit/構造で検証できません: ${nextSnapshot.invalidRecords.find((item) => item.recordId === record.recordId)?.reason ?? "unknown"}`);
      }
      evaluateProject(proposed, config.process, localPolicySha256, nextSnapshot);
      return record;
    });
    return { head: saved.head, project: currentProjection(config, saved.records, projectId) };
  }

  return { initialize, list, detail, execute };
}
