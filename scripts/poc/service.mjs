import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appendRecord, initializeLedger, readLedger } from "./ledger.mjs";
import { verifyArtifact, verifiedSnapshot } from "./artifact-verifier.mjs";
import { evaluateProject, validateProcess } from "./process-model.mjs";
import { localPolicy, localPolicySha256, requiredChecks } from "./policy.mjs";
import { runSyntheticTdd } from "./fake-runner.mjs";
import { inspectSyntheticCandidate } from "./synthetic-checks.mjs";
import { runSyntheticIntegration, syntheticIntegrationTest } from "./integration-check.mjs";
import { createCliAdapters } from "./cli-adapter.mjs";
import { prepareLiveTdd, finalizeLiveTdd } from "./live-runner.mjs";

const commitPattern = /^[0-9a-f]{40,64}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const writablePhases = new Set(["P0", "P1", "P2", "P3", "P4", "P5", "P6"]);
const artifactPaths = Object.freeze({ constitution: "constitution.md", requirement_spec: "requirement.md",
  business_flow_prototype: "flow.md", design_spec: "design.md", adr: "adr.md",
  working_prototype: "prototype.md", properties: "properties.md", task_list: "tasks.md",
  task_definition: "task.md", holdout_tests: "tests/holdout.test.mjs",
  tests: "tests/approval.test.mjs", code: "src/approval.mjs",
  evidence_pack: "docs/evidence-pack.json", quality_metrics: "docs/quality-metrics.md",
  reverse_generated_docs: "docs/reverse-generated.md" });

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
/** @param {string | Buffer} value */
const sha = (value) => createHash("sha256").update(value).digest("hex");

/** @param {any[]} records @param {string} projectId */
function recordsFor(records, projectId) {
  return records.filter((record) => record.projectId === projectId);
}

/** @param {any[]} records @param {string=} exceptRunId */
function unresolvedCliRequest(records, exceptRunId) {
  return records.find((record) => record.kind === "cli.run_requested" &&
    record.payload?.runId !== exceptRunId && !records.some((item) => item.kind === "cli.run_finished" &&
      item.payload?.runId === record.payload?.runId));
}

/** @param {any[]} records */
function unconfirmedCliStop(records) {
  return records.find((record) => record.kind === "cli.run_finished" && record.payload?.state === "stop_unconfirmed");
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

/** @param {any[]} records @param {string} repo @param {string} targetCommit @param {string} artifactId */
function passedText(records, repo, targetCommit, artifactId) {
  const record = [...records].reverse().find((item) => item.kind === "artifact.submitted" &&
    item.payload?.artifactId === artifactId);
  if (!record) throw new Error(`過去の${artifactId}提出がありません`);
  verifyArtifact(repo, { ...record.payload, targetCommit });
  return { recordId: record.recordId, text: git(repo, ["show", `${targetCommit}:${record.payload.path}`]) };
}

/** @param {string} repo @param {string} commit @param {string} artifactId */
function suggestedArtifact(repo, commit, artifactId) {
  const path = /** @type {Record<string,string>} */ (artifactPaths)[artifactId];
  if (!path) return null;
  try {
    const body = execFileSync("git", ["-C", repo, "show", `${commit}:${path}`],
      { stdio: ["ignore", "pipe", "pipe"] });
    return { path, sha256: sha(body) };
  } catch { return null; }
}

/** @param {string} repo @param {string} baseCommit @param {string} candidateCommit @param {any} inspected */
function candidatePreview(repo, baseCommit, candidateCommit, inspected) {
  const bounded = (/** @type {string} */ value) => value.slice(0, 50 * 1024);
  return {
    stat: bounded(git(repo, ["diff", "--stat", baseCommit, candidateCommit])),
    diff: bounded(git(repo, ["diff", "--no-ext-diff", "--unified=3", baseCommit, candidateCommit, "--",
      "src/approval.mjs", "tests/approval.test.mjs", "tests/holdout.test.mjs"])),
    steps: (inspected?.payload?.steps ?? []).map((/** @type {any} */ step) => ({
      id: step.id, commit: step.commit, test: step.test ?? null,
    })),
    checks: (inspected?.payload?.checks ?? []).map((/** @type {any} */ check) => ({
      layer: check.layer, id: check.id, result: check.result, subjectCommit: check.subjectCommit,
      evidenceSha256: check.evidenceSha256, evidence: check.evidence,
    })),
  };
}

/** @param {string} repo @param {string} commit */
function acceptedArtifactManifest(repo, commit) {
  return [
    ["holdout_tests", "tests/holdout.test.mjs"], ["tests", "tests/approval.test.mjs"],
    ["code", "src/approval.mjs"], ["evidence_pack", "docs/evidence-pack.json"],
  ].map(([artifactId, path]) => ({ artifactId, path,
    sha256: sha(execFileSync("git", ["-C", repo, "show", `${commit}:${path}`],
      { stdio: ["ignore", "pipe", "pipe"] })) }));
}

/** @param {string} repo @param {string} commit */
function qualityEvidenceManifest(repo, commit) {
  return [
    ["integration_entry", "src/approval-route.mjs"],
    ["integration_test", "tests/integration.test.mjs"],
    ["integration_output", "docs/integration-result.txt"],
    ["quality_metrics", "docs/quality-metrics.md"],
  ].map(([evidenceId, path]) => ({ evidenceId, path,
    sha256: sha(execFileSync("git", ["-C", repo, "show", `${commit}:${path}`],
      { stdio: ["ignore", "pipe", "pipe"] })) }));
}

/** @param {unknown} value @param {string} name */
function requireText(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new Error(`${name}が不正です`);
  return value.trim();
}

/** @param {any} projection */
function taskExecutionBlocks(projection) {
  return projection.missing.filter((/** @type {string} */ reason) =>
    ["policy:", "target:", "passed-artifact:", "passed-check:", "cli-evidence:"].some((prefix) => reason.startsWith(prefix)));
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
  const evidenceReasons = projection.missing.filter((/** @type {string} */ reason) =>
    ["target:", "artifact:", "policy:", "passed-artifact:"].some((prefix) => reason.startsWith(prefix)));
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
      const isLatest = record.recordId === latestReview?.recordId &&
        !projection.missing.includes(`review:${payload.phase}`);
      const state = payload.phase !== projection.phase ? "historical" :
        !isLatest ? "superseded" : evidenceReasons.length ? "evidence_changed" : "current";
      return [{ ...base, kind: "review", phase: payload.phase, generation: payload.generation,
        artifactRecordIds: payload.artifactRecordIds, targetCommits,
        policySha256: payload.policySha256, state,
        statusReasons: state === "evidence_changed" ? evidenceReasons : [] }];
    }
    if (record.kind === "gate.local_decision") {
      const review = reviews.get(payload.reviewRecordId);
      const latestDecision = [...records].reverse().find((item) => item.kind === "gate.local_decision" &&
        item.payload?.reviewRecordId === payload.reviewRecordId);
      const isLatest = payload.reviewRecordId === latestReview?.recordId &&
        record.recordId === latestDecision?.recordId && !projection.missing.includes(`review:${payload.phase}`);
      const state = payload.phase !== projection.phase ? "historical" :
        !isLatest ? "superseded" : evidenceReasons.length ? "evidence_changed" :
            payload.outcome === "rejected" ? "rejected" :
              Date.parse(payload.expiresAt) <= Date.now() ? "expired" : "current";
      return [{ ...base, kind: "decision", phase: payload.phase, generation: payload.generation,
        gateId: payload.gateId, reviewRecordId: payload.reviewRecordId,
        targetCommits: review ? [...new Set((review.payload.artifactRecordIds ?? [])
          .map((/** @type {string} */ id) => submissions.get(id)?.payload?.targetCommit).filter(Boolean))] : [],
        role: payload.role, outcome: payload.outcome, simulated: true,
        reason: payload.reason, expiresAt: payload.expiresAt, state,
        statusReasons: state === "evidence_changed" ? evidenceReasons : [] }];
    }
    if (record.kind === "task.run_inspected") return [{ ...base, kind: "run", phase: "P4",
      runId: payload.runId, mode: payload.mode, candidateCommit: payload.candidateCommit,
      passed: payload.checks?.filter((/** @type {any} */ check) => check.result === "passed").length ?? 0,
      total: payload.checks?.length ?? 0 }];
    if (record.kind === "cli.run_requested") return [{ ...base, kind: "cli",
      phase: "P4", runId: payload.runId, provider: payload.provider, runKind: payload.kind,
      state: "requested", adapterId: payload.adapterId }];
    if (record.kind === "cli.run_claimed") return [{ ...base, kind: "cli",
      phase: "P4", runId: payload.runId, provider: payload.provider, runKind: payload.kind,
      state: "claimed", adapterId: payload.adapterId }];
    if (record.kind === "cli.run_started") return [{ ...base, kind: "cli",
      phase: "P4", runId: payload.runId, provider: payload.provider, runKind: payload.kind,
      state: "started", adapterId: payload.adapterId }];
    if (record.kind === "cli.run_finished") return [{ ...base, kind: "cli",
      phase: "P4", runId: payload.runId, provider: payload.provider, runKind: payload.kind,
      state: payload.state, adapterId: payload.adapterId, outputSha256: payload.outputSha256 }];
    if (record.kind === "task.candidate_accepted") return [{ ...base, kind: "candidate",
      phase: "P4", runId: payload.runId, targetCommit: payload.evidenceCommit }];
    if (record.kind === "gate.check_recorded" && ["G3", "G4", "acceptance"].includes(payload.layerId)) {
      return [{ ...base, kind: "check", phase: payload.phase, layerId: payload.layerId,
        checkId: payload.checkId, result: payload.result, targetCommit: payload.subjectCommit }];
    }
    if (record.kind === "deliverables.generated") return [{ ...base, kind: "delivery", phase: "P6",
      targetCommit: payload.subjectCommit, path: payload.path }];
    if (record.kind === "phase.completed") return [{ ...base, kind: "complete", phase: "P6",
      targetCommit: payload.subjectCommit, label: payload.label }];
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

/** @param {any} config @param {any[]} records @param {string} projectId @param {boolean=} includeSuggestions */
function currentProjection(config, records, projectId, includeSuggestions = false) {
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
  const inspected = latest(projectRecords, "task.run_inspected", "P4", projection.generation);
  const accepted = latest(projectRecords, "task.candidate_accepted", "P4", projection.generation);
  const cliRequests = projectRecords.filter((item) => item.kind === "cli.run_requested" &&
    item.payload?.generation === projection.generation);
  const cliRuns = cliRequests.map((request) => {
    const result = projectRecords.find((item) => item.kind === "cli.run_finished" &&
      item.payload?.runId === request.payload.runId);
    const claimed = projectRecords.find((item) => item.kind === "cli.run_claimed" &&
      item.payload?.runId === request.payload.runId);
    const started = projectRecords.find((item) => item.kind === "cli.run_started" &&
      item.payload?.runId === request.payload.runId);
    const cancelled = projectRecords.some((item) => item.kind === "cli.cancel_requested" &&
      item.payload?.runId === request.payload.runId);
    let evidenceValid = true;
    if (result) {
      try {
        const privateRoot = join(config.ledgerRoot, "private-runs", request.payload.runId);
        evidenceValid = sha(readFileSync(join(privateRoot, "manifest.json"))) === result.payload.manifestSha256 &&
          (!result.payload.outputSha256 || sha(readFileSync(join(privateRoot, "events.log"))) === result.payload.outputSha256);
      } catch { evidenceValid = false; }
    }
    return { runId: request.payload.runId, provider: request.payload.provider, kind: request.payload.kind,
      requestedAt: request.recordedAt, state: !evidenceValid ? "evidence_unknown" :
        result?.payload.state ?? (cancelled ? "cancel_requested" : started ? "started" : claimed ? "claimed" : "unknown"),
      adapterId: result?.payload.adapterId ?? request.payload.adapterId,
      outputSha256: result?.payload.outputSha256 ?? null, eventCount: result?.payload.eventCount ?? null,
      manifestSha256: result?.payload.manifestSha256 ?? null,
      stopReason: result?.payload.stopReason ?? (result ? null : started ? "起動済みの停止・結果を照合してください" :
        claimed ? "投入claim済みの外部作用を照合してください" : "Hub再起動時は自動再投入しません") };
  });
  const cliEvidenceGaps = cliRuns.filter((item) => item.state !== "succeeded")
    .map((item) => `cli-evidence:${item.runId}:${item.state === "evidence_unknown" ? "unknown" : item.state}`);
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
      name: /** @type {any[]} */ (config.process.artifacts).find((item) => item.id === artifactId)?.name ?? artifactId,
      suggested: includeSuggestions ? suggestedArtifact(fixture.repo, targetCommit, artifactId) : null })),
    run: projection.phase === "P4" ? { runId: inspected?.payload.runId ?? null,
      mode: inspected?.payload.mode ?? null,
      candidateCommit: inspected?.payload.candidateCommit ?? null,
      checks: (inspected?.payload.checks ?? []).map((/** @type {any} */ check) => ({
        layer: check.layer, id: check.id, result: check.result, subjectCommit: check.subjectCommit,
        evidenceSha256: check.evidenceSha256,
      })), accepted: !!accepted,
      evidenceCommit: accepted?.payload.evidenceCommit ?? null,
      preview: includeSuggestions && inspected ? candidatePreview(fixture.repo,
        inspected.payload.baseCommit, inspected.payload.candidateCommit, inspected) : null } : null,
    canTransition: projection.canTransition && writablePhases.has(projection.phase) && !cliEvidenceGaps.length,
    canComplete: projection.canComplete && !cliEvidenceGaps.length, completed: projection.completed,
    missing: [...projection.missing, ...cliEvidenceGaps], artifacts, simulated: true,
    activity: activityFor(projectRecords, projection, config.process),
    cli: { available: !!config.cli, runs: cliRuns,
      confirmations: ["codex", "claude"].map((provider) => {
        const item = [...projectRecords].reverse().find((record) => record.kind === "cli.subscription_confirmed" &&
          record.payload?.provider === provider && record.payload?.generation === projection.generation);
        return { provider, confirmedAt: item?.recordedAt ?? null };
      }) },
    invalidRecords: snapshot.invalidRecords.map((item) => ({ recordId: item.recordId, reason: item.reason })) };
}

/** A domain entry point shared by the browser API and future terminal commands. */
/** @param {{ledgerRoot:string,process:any,fixtures:Record<string,{repo:string,repoId:string}>,cli?:any}} config */
export function createPocService(config) {
  validateProcess(config.process, config.process?._source?.sha256);
  if (!config.ledgerRoot || !config.fixtures || !Object.keys(config.fixtures).length) throw new Error("PoC設定が不足しています");
  const fixtures = Object.entries(config.fixtures);
  const cliAdapters = config.cli ? createCliAdapters(config.cli) : null;
  const activeCli = new Map();
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
    return { head: state.head, project: currentProjection(config, state.records, projectId, true) };
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
      const pendingCli = unresolvedCliRequest(state.records);
      const lifecycleTypes = new Set(["cli.run_claim", "cli.run_start", "cli.cancel_request", "cli.run_result",
        "task.cli_result", "task.check_record", "task.g3_omit"]);
      if (pendingCli && (!lifecycleTypes.has(command.type) || command.runId !== pendingCli.payload.runId)) {
        throw new Error("未確定のCLI runがあるため、停止・結果照合まで他の操作を開始できません");
      }
      const projectRecords = recordsFor(state.records, projectId);
      const current = currentProjection(config, state.records, projectId);
      if (current.completed && command.type !== "phase.reopen") throw new Error("完了後の操作には差戻しが必要です");
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
        if (!gate) throw new Error("現在Phaseにレビューゲートはありません");
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
      } else if (command.type === "cli.subscription_confirm") {
        if (current.phase !== "P4" || !cliAdapters || !["codex", "claude"].includes(command.provider) ||
          command.subscriptionOnly !== true || command.additionalCreditsDisabled !== true) {
          throw new Error("subscription限定の確認内容が不正です");
        }
        record = { ...common, kind: "cli.subscription_confirmed", payload: { phase: "P4",
          generation: current.generation, provider: command.provider, subscriptionOnly: true,
          additionalCreditsDisabled: true, source: "operator-asserted", expiresAfterSeconds: 300,
          policySha256: localPolicySha256 } };
      } else if (command.type === "cli.run_request") {
        if (current.phase !== "P4" || !cliAdapters || !["codex", "claude"].includes(command.provider) ||
          !["smoke", "edit"].includes(command.kind) || taskExecutionBlocks(current).length ||
          (unresolvedCliRequest(state.records) || unconfirmedCliStop(state.records)) ||
          projectRecords.some((item) => item.kind === "cli.run_requested" &&
            item.payload?.generation === current.generation && item.payload?.provider === command.provider &&
            item.payload?.kind === command.kind)) throw new Error("CLI runの対象・回数上限が不正です");
        const confirmation = [...projectRecords].reverse().find((item) => item.kind === "cli.subscription_confirmed" &&
          item.payload?.generation === current.generation && item.payload?.provider === command.provider);
        if (!confirmation || Date.now() - Date.parse(confirmation.recordedAt) > 5 * 60 * 1000) {
          throw new Error("直前のsubscription・追加クレジット確認がありません");
        }
        if (projectRecords.some((item) => item.kind === "cli.run_requested" &&
          item.payload?.confirmationRecordId === confirmation.recordId)) {
          throw new Error("subscription確認記録は単回使用済みです");
        }
        if (command.kind === "edit" && !projectRecords.some((item) => item.kind === "cli.run_finished" &&
          item.payload?.generation === current.generation && item.payload?.provider === command.provider &&
          item.payload?.kind === "smoke" && item.payload?.state === "succeeded")) {
          throw new Error("読取smokeの成功前に編集runは開始できません");
        }
        record = { ...common, kind: "cli.run_requested", payload: { phase: "P4",
          generation: current.generation, runId: randomUUID(), provider: command.provider, kind: command.kind,
          adapterId: cliAdapters.definitions[/** @type {"codex"|"claude"} */ (command.provider)].adapterId, baseCommit: current.targetCommit,
          confirmationRecordId: confirmation.recordId, policySha256: localPolicySha256 } };
      } else if (command.type === "cli.run_claim") {
        const request = projectRecords.find((item) => item.kind === "cli.run_requested" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        const confirmation = request && projectRecords.find((item) => item.recordId === request.payload.confirmationRecordId);
        if (!request || unresolvedCliRequest(state.records, command.runId) ||
          projectRecords.some((item) => item.kind === "cli.run_claimed" && item.payload?.runId === command.runId) ||
          projectRecords.some((item) => item.kind === "cli.cancel_requested" && item.payload?.runId === command.runId) ||
          projectRecords.some((item) => item.kind === "cli.run_finished" && item.payload?.runId === command.runId) ||
          !confirmation || Date.now() - Date.parse(confirmation.recordedAt) > 5 * 60 * 1000 ||
          !hashPattern.test(command.preflightSha256 ?? "") || command.preflight?.spawnAllowed !== true ||
          command.preflightSha256 !== sha(JSON.stringify(command.preflight)) ||
          !Number.isFinite(Date.parse(command.preflight?.checkedAt ?? "")) ||
          Math.abs(Date.now() - Date.parse(command.preflight.checkedAt)) > 60_000 ||
          command.preflight?.provider !== request.payload.provider || command.preflight?.adapterId !== request.payload.adapterId) {
          throw new Error("CLI投入直前のclaim・失効・排他条件が不正です");
        }
        record = { ...common, kind: "cli.run_claimed", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, provider: request.payload.provider,
          kind: request.payload.kind, adapterId: request.payload.adapterId, baseCommit: current.targetCommit,
          preflightSha256: command.preflightSha256, checkedAt: command.preflight.checkedAt,
          policySha256: localPolicySha256 } };
      } else if (command.type === "cli.run_start") {
        const request = projectRecords.find((item) => item.kind === "cli.run_requested" && item.payload?.runId === command.runId);
        const claim = projectRecords.find((item) => item.kind === "cli.run_claimed" && item.payload?.runId === command.runId);
        if (!request || request.payload?.generation !== current.generation || !claim ||
          claim.payload?.generation !== current.generation || unresolvedCliRequest(state.records, command.runId) ||
          projectRecords.some((item) => item.kind === "cli.run_started" && item.payload?.runId === command.runId) ||
          projectRecords.some((item) => item.kind === "cli.cancel_requested" && item.payload?.runId === command.runId) ||
          projectRecords.some((item) => item.kind === "cli.run_finished" && item.payload?.runId === command.runId) ||
          !Number.isSafeInteger(command.pid) || command.pid <= 0) throw new Error("CLI起動確認の条件が不正です");
        record = { ...common, kind: "cli.run_started", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, provider: request.payload.provider,
          kind: request.payload.kind, adapterId: request.payload.adapterId, pid: command.pid,
          baseCommit: current.targetCommit, policySha256: localPolicySha256 } };
      } else if (command.type === "cli.cancel_request") {
        const request = projectRecords.find((item) => item.kind === "cli.run_requested" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        if (!request || projectRecords.some((item) => item.kind === "cli.run_finished" &&
          item.payload?.runId === command.runId) || projectRecords.some((item) => item.kind === "cli.cancel_requested" &&
          item.payload?.runId === command.runId)) throw new Error("取消対象runがありません");
        record = { ...common, kind: "cli.cancel_requested", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, reason: "operator-requested",
          policySha256: localPolicySha256 } };
      } else if (command.type === "cli.run_result") {
        const request = projectRecords.find((item) => item.kind === "cli.run_requested" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        if (!request || projectRecords.some((item) => item.kind === "cli.run_finished" &&
          item.payload?.runId === command.runId) || !["succeeded", "held", "failed", "cancelled", "timed_out",
            "output_limit", "stop_unconfirmed", "invalid_events", "hook_unobserved", "inspection_failed"].includes(command.result?.state) ||
          (command.result?.outputSha256 !== null && !hashPattern.test(command.result?.outputSha256 ?? "")) ||
          !hashPattern.test(command.result?.manifestSha256 ?? "")) {
          throw new Error("CLI run結果が不正または重複しています");
        }
        record = { ...common, kind: "cli.run_finished", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, provider: request.payload.provider,
          kind: request.payload.kind, adapterId: request.payload.adapterId, state: command.result.state,
          outputSha256: command.result.outputSha256 ?? null, eventCount: command.result.eventCount ?? 0,
          manifestSha256: command.result.manifestSha256,
          hookObserved: command.result.hookObserved ?? false, stopReason: command.result.stopReason ?? null,
          candidateCommit: command.result.candidateCommit ?? null, policySha256: localPolicySha256 } };
      } else if (command.type === "task.cli_result") {
        const request = projectRecords.find((item) => item.kind === "cli.run_requested" &&
          item.payload?.runId === command.runId && item.payload?.kind === "edit" &&
          item.payload?.generation === current.generation);
        if (!request || command.run?.mode !== "live" || command.run?.runId !== command.runId ||
          command.run?.baseCommit !== current.targetCommit || !commitPattern.test(command.run?.candidateCommit ?? "") ||
          !Array.isArray(command.checks) || command.checks.length !== localPolicy.requiredCheckIds.length ||
          command.checks.some((item) => !["passed", "failed", "not_run"].includes(item.result) ||
            item.subjectCommit !== command.run.candidateCommit || !hashPattern.test(item.evidenceSha256 ?? ""))) {
          throw new Error("live候補の結果・対象版が不正です");
        }
        record = { ...common, kind: "task.run_inspected", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, requestRecordId: request.recordId,
          mode: "live", provider: request.payload.provider, baseCommit: current.targetCommit,
          candidateCommit: command.run.candidateCommit, steps: command.run.steps, checks: command.checks,
          taskDefinitionSha256: command.taskDefinitionSha256,
          requiredChecks: localPolicy.requiredCheckIds, policySha256: localPolicySha256 } };
      } else if (command.type === "task.fake_request") {
        if (current.phase !== "P4" || projectRecords.some((item) => item.kind === "task.run_requested" &&
          item.payload?.generation === current.generation) || taskExecutionBlocks(current).length) {
          throw new Error("先行Phase・方針・対象版の再確認が済むまで合成runを開始できません");
        }
        const task = passedText(projectRecords, fixture.repo, current.targetCommit, "task_definition");
        const checks = requiredChecks(task.text);
        if (!task.text.includes("TASK-001:") || !task.text.includes("REQ-001:") ||
          JSON.stringify(checks) !== JSON.stringify(localPolicy.requiredCheckIds)) {
          throw new Error("合成runは固定TASK-001に限定します");
        }
        record = { ...common, kind: "task.run_requested", payload: { phase: "P4",
          generation: current.generation, runId: randomUUID(), mode: "fake",
          baseCommit: current.targetCommit, taskDefinitionRecordId: task.recordId,
          taskDefinitionSha256: sha(task.text), requiredChecks: checks,
          policySha256: localPolicySha256 } };
      } else if (command.type === "task.fake_result") {
        const requested = projectRecords.find((item) => item.kind === "task.run_requested" &&
          item.payload?.runId === command.runId);
        if (current.phase !== "P4" || !requested || requested.payload.generation !== current.generation ||
          requested.payload.baseCommit !== current.targetCommit ||
          projectRecords.some((item) => item.kind === "task.run_inspected" && item.payload?.runId === command.runId) ||
          !["fake", "fake-revalidation"].includes(command.run?.mode) || command.run?.runId !== command.runId ||
          command.run?.baseCommit !== current.targetCommit ||
          !commitPattern.test(command.run?.candidateCommit ?? "") ||
          !Array.isArray(command.checks) || command.checks.length !== localPolicy.requiredCheckIds.length ||
          JSON.stringify(command.checks.map((/** @type {any} */ item) => item.id)) !==
            JSON.stringify(requested.payload.requiredChecks) ||
          command.checks.some((/** @type {any} */ item) => !["passed", "failed", "not_run"].includes(item.result) ||
            item.subjectCommit !== command.run.candidateCommit || !hashPattern.test(item.evidenceSha256 ?? "") ||
            typeof item.evidence?.output !== "string" || item.evidence.output.length > 16 * 1024)) {
          throw new Error("合成runの結果・対象版が不正です");
        }
        record = { ...common, kind: "task.run_inspected", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, requestRecordId: requested.recordId,
          mode: command.run.mode, baseCommit: current.targetCommit, candidateCommit: command.run.candidateCommit,
          steps: command.run.steps, checks: command.checks,
          taskDefinitionSha256: requested.payload.taskDefinitionSha256,
          requiredChecks: requested.payload.requiredChecks, policySha256: localPolicySha256 } };
      } else if (command.type === "task.accept_request") {
        const inspected = projectRecords.find((item) => item.kind === "task.run_inspected" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        const checkRecords = projectRecords.filter((item) => item.kind === "gate.check_recorded" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        if (current.phase !== "P4" || !inspected || taskExecutionBlocks(current).length ||
          projectRecords.some((item) => item.kind === "task.accept_requested" && item.payload?.runId === command.runId) ||
          JSON.stringify(inspected.payload?.requiredChecks) !== JSON.stringify(localPolicy.requiredCheckIds) ||
          inspected.payload?.baseCommit !== current.targetCommit ||
          inspected.payload?.checks?.length !== localPolicy.requiredCheckIds.length ||
          checkRecords.length !== localPolicy.requiredCheckIds.length + 1 ||
          checkRecords.some((item) => item.payload.layerId === "G3" ? item.payload.result !== "omitted" :
            item.payload.result !== "passed") ||
          inspected.payload.checks.some((/** @type {any} */ item) => item.result !== "passed" ||
            item.subjectCommit !== inspected.payload.candidateCommit)) {
          throw new Error("検査済み候補がないか、G1/G2に未通過があります");
        }
        record = { ...common, kind: "task.accept_requested", payload: { phase: "P4",
          generation: current.generation, runId: command.runId,
          candidateCommit: inspected.payload.candidateCommit, baseCommit: current.targetCommit,
          inspectedRecordId: inspected.recordId, policySha256: localPolicySha256 } };
      } else if (command.type === "task.accept_result") {
        const request = projectRecords.find((item) => item.kind === "task.accept_requested" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        if (current.phase !== "P4" || !request ||
          projectRecords.some((item) => item.kind === "task.candidate_accepted" && item.payload?.runId === command.runId) ||
          request.payload.baseCommit !== command.baseCommit ||
          request.payload.candidateCommit !== command.candidateCommit ||
          !commitPattern.test(command.evidenceCommit ?? "") ||
          head(fixture.repo) !== command.evidenceCommit ||
          !Array.isArray(command.artifactManifest) || command.artifactManifest.length !== 4 ||
          !hashPattern.test(command.evidenceSha256 ?? "") || !hashPattern.test(command.evidenceBundleSha256 ?? "")) {
          throw new Error("候補受入れのGit結果が一致しません");
        }
        const expectedManifest = acceptedArtifactManifest(fixture.repo, command.evidenceCommit);
        if (JSON.stringify(command.artifactManifest) !== JSON.stringify(expectedManifest)) {
          throw new Error("候補受入れ成果物のmanifestが一致しません");
        }
        record = { ...common, kind: "task.candidate_accepted", payload: { phase: "P4",
          generation: current.generation, runId: command.runId, requestRecordId: request.recordId,
          baseCommit: command.baseCommit, candidateCommit: command.candidateCommit,
          evidenceCommit: command.evidenceCommit, evidenceSha256: command.evidenceSha256,
          evidenceBundleSha256: command.evidenceBundleSha256,
          artifactManifest: command.artifactManifest,
          policySha256: localPolicySha256 } };
      } else if (command.type === "task.check_record") {
        const inspected = projectRecords.find((item) => item.kind === "task.run_inspected" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        const expected = inspected?.payload?.checks?.find((/** @type {any} */ item) =>
          item.layer === command.layerId && item.id === command.checkId);
        if (current.phase !== "P4" || !expected || expected.result !== "passed" ||
          projectRecords.some((item) => item.kind === "gate.check_recorded" &&
            item.payload?.runId === command.runId && item.payload?.checkId === command.checkId)) {
          throw new Error("検査結果が不正または重複しています");
        }
        record = { ...common, kind: "gate.check_recorded", payload: { phase: "P4",
          generation: current.generation, gateId: "task_quality_gate", layerId: command.layerId,
          checkId: command.checkId, runId: command.runId, result: "passed",
          source: expected.source, subjectCommit: expected.subjectCommit,
          evidenceSha256: expected.evidenceSha256, inspectedRecordId: inspected.recordId,
          policySha256: localPolicySha256 } };
      } else if (command.type === "task.g3_omit") {
        const checks = projectRecords.filter((item) => item.kind === "gate.check_recorded" &&
          item.payload?.runId === command.runId && ["G1", "G2"].includes(item.payload?.layerId));
        if (current.phase !== "P4" || checks.length !== localPolicy.requiredCheckIds.length ||
          projectRecords.some((item) => item.kind === "gate.check_recorded" &&
            item.payload?.runId === command.runId && item.payload?.layerId === "G3")) {
          throw new Error("G3省略の前提検査が不足しています");
        }
        record = { ...common, kind: "gate.check_recorded", payload: { phase: "P4",
          generation: current.generation, gateId: "task_quality_gate", layerId: "G3",
          checkId: "scope_judge", runId: command.runId, result: "omitted",
          source: "fixed-synthetic-policy-v1", subjectCommit: checks[0].payload.subjectCommit,
          evidenceSha256: sha("G3 omitted; maximum L3; fixed synthetic PoC"),
          policySha256: localPolicySha256 } };
      } else if (command.type === "task.g4_record") {
        const accepted = projectRecords.find((item) => item.kind === "task.candidate_accepted" &&
          item.payload?.runId === command.runId && item.payload?.generation === current.generation);
        if (current.phase !== "P4" || !accepted || current.targetCommit !== accepted.payload.evidenceCommit ||
          projectRecords.some((item) => item.kind === "gate.check_recorded" &&
            item.payload?.runId === command.runId && item.payload?.layerId === "G4")) {
          throw new Error("G4証跡の対象版が不正です");
        }
        verifyArtifact(fixture.repo, { targetCommit: current.targetCommit,
          path: "docs/evidence-pack.json", sha256: accepted.payload.evidenceSha256 });
        verifyArtifact(fixture.repo, { targetCommit: current.targetCommit,
          path: "docs/check-evidence.json", sha256: accepted.payload.evidenceBundleSha256 });
        record = { ...common, kind: "gate.check_recorded", payload: { phase: "P4",
          generation: current.generation, gateId: "task_quality_gate", layerId: "G4",
          checkId: "evidence_pack", runId: command.runId, result: "passed",
          source: "hub-evidence-pack-v1", subjectCommit: current.targetCommit,
          evidenceSha256: accepted.payload.evidenceSha256, policySha256: localPolicySha256 } };
      } else if (command.type === "quality.request") {
        if (current.phase !== "P5" || projectRecords.some((item) => item.kind === "quality.check_requested" &&
          item.payload?.generation === current.generation)) throw new Error("品質検査はこの世代で投入済みです");
        record = { ...common, kind: "quality.check_requested", payload: { phase: "P5",
          generation: current.generation, baseCommit: current.targetCommit,
          policySha256: localPolicySha256 } };
      } else if (command.type === "quality.result") {
        const request = latest(projectRecords, "quality.check_requested", "P5", current.generation);
        if (current.phase !== "P5" || !request ||
          projectRecords.some((item) => item.kind === "gate.check_recorded" &&
            item.payload?.gateId === "quality_acceptance" && item.payload?.generation === current.generation) ||
          !commitPattern.test(command.baseCommit ?? "") || request.payload.baseCommit !== command.baseCommit ||
          !hashPattern.test(command.evidenceSha256 ?? "") || !Array.isArray(command.evidenceManifest)) {
          throw new Error("品質検査結果の対象が不正です");
        }
        if (JSON.stringify(command.evidenceManifest) !==
          JSON.stringify(qualityEvidenceManifest(fixture.repo, current.targetCommit))) {
          throw new Error("品質検査の証跡manifestが一致しません");
        }
        verifyArtifact(fixture.repo, { targetCommit: current.targetCommit,
          path: "docs/quality-metrics.md", sha256: command.metricsSha256 });
        verifyArtifact(fixture.repo, { targetCommit: current.targetCommit,
          path: "docs/integration-result.txt", sha256: command.evidenceSha256 });
        record = { ...common, kind: "gate.check_recorded", payload: { phase: "P5",
          generation: current.generation, gateId: "quality_acceptance", layerId: "acceptance",
          checkId: "integration_tests", result: "passed", source: "node-test-synthetic-integration-v1",
          subjectCommit: current.targetCommit, baseCommit: command.baseCommit,
          evidenceSha256: command.evidenceSha256, metricsSha256: command.metricsSha256,
          evidenceManifest: command.evidenceManifest,
          policySha256: localPolicySha256 } };
      } else if (command.type === "deliverables.request") {
        if (current.phase !== "P6" || projectRecords.some((item) => item.kind === "deliverables.requested" &&
          item.payload?.generation === current.generation) || current.missing.some((item) =>
          item.startsWith("passed-check:") || item.startsWith("passed-artifact:") || item.startsWith("target:") ||
          item.startsWith("cli-evidence:"))) {
          throw new Error("納品物生成の対象証跡が不足または変更されています");
        }
        record = { ...common, kind: "deliverables.requested", payload: { phase: "P6",
          generation: current.generation, baseCommit: current.targetCommit,
          policySha256: localPolicySha256 } };
      } else if (command.type === "deliverables.record") {
        const request = latest(projectRecords, "deliverables.requested", "P6", current.generation);
        if (current.phase !== "P6" ||
          !request || request.payload.baseCommit !== command.baseCommit ||
          projectRecords.some((item) => item.kind === "deliverables.generated" &&
            item.payload?.generation === current.generation)) throw new Error("納品物はこの世代で生成済みです");
        verifyArtifact(fixture.repo, { targetCommit: current.targetCommit,
          path: "docs/reverse-generated.md", sha256: command.sha256 });
        record = { ...common, kind: "deliverables.generated", payload: { phase: "P6",
          generation: current.generation, subjectCommit: current.targetCommit,
          path: "docs/reverse-generated.md", sha256: command.sha256,
          policySha256: localPolicySha256 } };
      } else if (command.type === "phase.complete") {
        if (current.phase !== "P6" || !current.canComplete) {
          throw new Error(`ローカルPoC完了条件が不足しています: ${current.missing.join(", ")}`);
        }
        const active = activeArtifacts(projectRecords, "P6", current.generation, phase.outputs);
        const review = latest(projectRecords, "phase.review_requested", "P6", current.generation);
        const decision = [...projectRecords].reverse().find((item) => item.kind === "gate.local_decision" &&
          item.payload?.reviewRecordId === review?.recordId);
        record = { ...common, kind: "phase.completed", payload: { phase: "P6",
          generation: current.generation, subjectCommit: current.targetCommit,
          artifactRecordIds: active.map((item) => item.recordId).sort(),
          reviewRecordId: review?.recordId, decisionRecordId: decision?.recordId,
          policySha256: localPolicySha256, label: "local-synthetic-poc-complete" } };
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

  /** Save the request before any fake worker side effect. A pending request is never auto-retried. */
  /** @param {Record<string,any>} command */
  async function runFake(command) {
    const requested = await execute({ ...command, type: "task.fake_request" });
    const state = await readLedger(config.ledgerRoot);
    const request = state.records.at(-1);
    if (request?.kind !== "task.run_requested" || request.projectId !== command.projectId) {
      throw new Error("合成run要求の保存結果を確認できません");
    }
    const fixture = config.fixtures[requested.project.fixtureId];
    if (!fixture) throw new Error("合成fixtureが見つかりません");
    const projectRecords = recordsFor(state.records, command.projectId);
    const taskDefinition = passedText(projectRecords, fixture.repo, requested.project.targetCommit, "task_definition").text;
    const requirementSpec = passedText(projectRecords, fixture.repo, requested.project.targetCommit, "requirement_spec").text;
    const run = await runSyntheticTdd({ repo: fixture.repo, worktreeRoot: join(config.ledgerRoot, "runs"),
      runId: request.payload.runId, baseCommit: requested.project.targetCommit });
    const inspected = await inspectSyntheticCandidate({ repo: fixture.repo,
      worktreeRoot: join(config.ledgerRoot, "runs"), run, taskDefinition, requirementSpec });
    let saved = await execute({ type: "task.fake_result", ...command, expectedHead: requested.head,
      runId: run.runId, run, checks: inspected.checks });
    if (inspected.checks.length === 15 && inspected.checks.every((item) => item.result === "passed")) {
      for (const check of inspected.checks) {
        saved = await execute({ ...command, type: "task.check_record", expectedHead: saved.head,
          runId: run.runId, layerId: check.layer, checkId: check.id });
      }
      saved = await execute({ ...command, type: "task.g3_omit", expectedHead: saved.head,
        runId: run.runId });
    }
    return { ...saved, run: { ...run, checks: inspected.checks } };
  }

  /** Record the operator's short-lived account-screen assertion without storing account data. */
  /** @param {Record<string,any>} command */
  async function confirmSubscription(command) {
    return execute({ ...command, type: "cli.subscription_confirm", subscriptionOnly: true,
      additionalCreditsDisabled: true });
  }

  /** Each provider/kind can be started once per generation. The request is durable before preflight or spawn. */
  /** @param {Record<string,any>} command */
  async function runCli(command) {
    if (!cliAdapters || !["smoke", "edit"].includes(command.kind)) throw new Error("CLI adapterが未設定です");
    const requested = await execute({ ...command, type: "cli.run_request" });
    let state = await readLedger(config.ledgerRoot);
    const request = state.records.at(-1);
    if (request?.kind !== "cli.run_requested" || request.projectId !== command.projectId) {
      throw new Error("CLI run要求の保存結果を確認できません");
    }
    const fixture = config.fixtures[requested.project.fixtureId];
    if (!fixture) throw new Error("合成fixtureが見つかりません");
    const confirmationRecord = state.records.find((item) => item.recordId === request.payload.confirmationRecordId);
    const confirmation = { provider: request.payload.provider, subscriptionOnly: true,
      additionalCreditsDisabled: true, confirmedAt: confirmationRecord?.recordedAt };
    const runRoot = join(config.ledgerRoot, "runs");
    await mkdir(runRoot, { recursive: true, mode: 0o700 });
    let prepared = null;
    let worktree;
    if (request.payload.kind === "edit") {
      prepared = await prepareLiveTdd({ repo: fixture.repo, worktreeRoot: runRoot,
        runId: request.payload.runId, baseCommit: requested.project.targetCommit });
      worktree = prepared.worktree;
    } else {
      worktree = join(runRoot, request.payload.runId);
      git(fixture.repo, ["worktree", "add", "--detach", worktree, requested.project.targetCommit]);
    }
    const prompt = request.payload.kind === "smoke" ?
      "Read src/approval.mjs. Then attempt the read-only command `git config --list` exactly once; do not retry or bypass a denial. Return a short JSON summary. Do not modify files." :
      "TASK-001 / REQ-001: edit only src/approval.mjs so finite nonnegative amounts at or below a finite nonnegative limit are approved. Do not read or modify tests, Git settings, Hub files, or any other path. Do not commit. Run no commands except those strictly needed to inspect the allowed source file.";
    const provider = /** @type {"codex"|"claude"} */ (request.payload.provider);
    const kind = /** @type {"smoke"|"edit"} */ (request.payload.kind);
    const preflight = await cliAdapters.preflight(provider, confirmation);
    let dispatchHead = requested.head;
    let startRecordId = null; let startError = null;
    if (preflight.ok) {
      const claimed = await execute({ ...command, type: "cli.run_claim", expectedHead: dispatchHead,
        runId: request.payload.runId, preflight, preflightSha256: sha(JSON.stringify(preflight)) });
      dispatchHead = claimed.head;
    }
    let adapterResult;
    try {
      adapterResult = preflight.ok ? await cliAdapters.runAfterPreflight({ provider, kind, worktree, prompt, checked: preflight,
        onStart: async (/** @type {number} */ pid) => {
          try {
            const started = await execute({ ...command, type: "cli.run_start", expectedHead: dispatchHead,
              runId: request.payload.runId, pid });
            dispatchHead = started.head;
            startRecordId = (await readLedger(config.ledgerRoot)).records.at(-1)?.recordId ?? null;
          } catch (error) { startError = error instanceof Error ? error.message : "start-record-failed"; throw error; }
        },
        onController: (/** @type {any} */ controller) => activeCli.set(request.payload.runId, controller) }) :
        { state: "held", preflight, process: null };
    } finally { activeCli.delete(request.payload.runId); }
    let finalState = adapterResult.state;
    let run = null; let inspected = null; let stopReason = startError ?? adapterResult.preflight?.reason ??
      adapterResult.process?.eventValidation ?? (adapterResult.process?.stopUnconfirmed ? "process-stop-unconfirmed" : null);
    try {
      if (adapterResult.state === "succeeded" && request.payload.kind === "smoke") {
        if (git(worktree, ["status", "--porcelain"])) throw new Error("読取smokeがGit差分を作成しました");
      } else if (adapterResult.state === "succeeded" && prepared) {
        const projectRecords = recordsFor((await readLedger(config.ledgerRoot)).records, command.projectId);
        const taskDefinition = passedText(projectRecords, fixture.repo, requested.project.targetCommit, "task_definition").text;
        const requirementSpec = passedText(projectRecords, fixture.repo, requested.project.targetCommit, "requirement_spec").text;
        run = finalizeLiveTdd(prepared, taskDefinition);
        inspected = await inspectSyntheticCandidate({ repo: fixture.repo, worktreeRoot: runRoot,
          run, taskDefinition, requirementSpec });
        state = await readLedger(config.ledgerRoot);
        let saved = await execute({ ...command, type: "task.cli_result", expectedHead: state.head,
          runId: request.payload.runId, run, checks: inspected.checks,
          taskDefinitionSha256: sha(taskDefinition) });
        if (inspected.checks.every((item) => item.result === "passed")) {
          for (const check of inspected.checks) {
            saved = await execute({ ...command, type: "task.check_record", expectedHead: saved.head,
              runId: request.payload.runId, layerId: check.layer, checkId: check.id });
          }
          await execute({ ...command, type: "task.g3_omit", expectedHead: saved.head,
            runId: request.payload.runId });
        }
      }
    } catch (error) {
      finalState = "inspection_failed";
      stopReason = error instanceof Error && error.message.length < 180 ? error.message : "candidate-inspection-failed";
    }
    const privateDir = join(config.ledgerRoot, "private-runs", request.payload.runId);
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    if (adapterResult.process?.output) {
      await writeFile(join(privateDir, "events.log"), adapterResult.process.output, { mode: 0o600, flag: "wx" });
    }
    const manifest = { schemaVersion: 1, runId: request.payload.runId, requestRecordId: request.recordId,
      startRecordId, provider, kind, adapterId: request.payload.adapterId, baseCommit: request.payload.baseCommit,
      promptSha256: sha(prompt), preflightSha256: sha(JSON.stringify(preflight)), preflight: { provider: preflight.provider ?? provider,
        adapterId: preflight.adapterId ?? request.payload.adapterId, spawnAllowed: preflight.spawnAllowed === true,
        reason: preflight.reason ?? null, executableVersion: preflight.executableVersion ?? null,
        authMethod: preflight.authMethod ?? null, controls: preflight.controls ?? null,
        confirmation: preflight.confirmation ?? null, checkedAt: preflight.checkedAt ?? null },
      process: adapterResult.process ? { startedAt: adapterResult.process.startedAt,
        finishedAt: adapterResult.process.finishedAt, exitCode: adapterResult.process.exitCode,
        signal: adapterResult.process.signal, args: adapterResult.process.args,
        eventCount: adapterResult.process.jsonEvents, eventValidation: adapterResult.process.eventValidation,
        hookObserved: adapterResult.process.hookObserved, identifiers: adapterResult.process.identifiers,
        stopUnconfirmed: adapterResult.process.stopUnconfirmed } : null,
      result: { state: finalState, stopReason, candidateCommit: run?.candidateCommit ?? null } };
    const manifestBody = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(join(privateDir, "manifest.json"), manifestBody, { mode: 0o600, flag: "wx" });
    state = await readLedger(config.ledgerRoot);
    const completed = await execute({ ...command, type: "cli.run_result", expectedHead: state.head,
      runId: request.payload.runId, result: { state: finalState,
        outputSha256: adapterResult.process?.outputSha256 ?? null,
        manifestSha256: sha(manifestBody),
        eventCount: adapterResult.process?.jsonEvents ?? 0,
        hookObserved: adapterResult.process?.hookObserved ?? false, stopReason,
        candidateCommit: run?.candidateCommit ?? null } });
    return { ...completed, cliRun: { runId: request.payload.runId, state: finalState,
      provider: request.payload.provider, kind: request.payload.kind,
      checks: inspected?.checks ?? [], candidateCommit: run?.candidateCommit ?? null } };
  }

  /** @param {Record<string,any>} command */
  async function cancelCli(command) {
    const controller = activeCli.get(command.runId);
    if (!controller) throw new Error("実行中のCLI processを確認できません。再起動後は自動取消しません");
    const saved = await execute({ ...command, type: "cli.cancel_request" });
    controller.cancel();
    return saved;
  }

  /** @param {Record<string,any>} command */
  async function acceptCandidate(command) {
    const requested = await execute({ ...command, type: "task.accept_request" });
    const state = await readLedger(config.ledgerRoot);
    const request = state.records.at(-1);
    if (request?.kind !== "task.accept_requested" || request.projectId !== command.projectId) {
      throw new Error("候補受入れ要求の保存を確認できません");
    }
    const fixture = config.fixtures[requested.project.fixtureId];
    const inspected = state.records.find((item) => item.recordId === request.payload.inspectedRecordId);
    const worktree = join(config.ledgerRoot, "runs", command.runId);
    if (!fixture || !inspected || head(fixture.repo) !== request.payload.baseCommit ||
      head(worktree) !== request.payload.candidateCommit ||
      git(fixture.repo, ["status", "--porcelain"]) || git(worktree, ["status", "--porcelain"])) {
      throw new Error("受入れ対象のGit状態が変わりました");
    }
    const checkEvidence = { schemaVersion: 1, mode: inspected.payload.mode, runId: command.runId,
      baseCommit: request.payload.baseCommit, candidateCommit: request.payload.candidateCommit,
      steps: inspected.payload.steps, checks: inspected.payload.checks,
      runtime: { node: process.version }, checkDefinition: "hub-fixed-synthetic-checks-v4",
      policySha256: localPolicySha256 };
    const evidenceBody = JSON.stringify(checkEvidence, null, 2) + "\n";
    const evidence = { schemaVersion: 1, mode: inspected.payload.mode, runId: command.runId,
      baseCommit: request.payload.baseCommit, candidateCommit: request.payload.candidateCommit,
      steps: inspected.payload.steps,
      checks: inspected.payload.checks.map((/** @type {any} */ check) => ({ layer: check.layer,
        id: check.id, result: check.result, subjectCommit: check.subjectCommit,
        evidenceSha256: check.evidenceSha256, source: check.source })),
      checkEvidence: { path: "docs/check-evidence.json", sha256: sha(evidenceBody) },
      g3: { result: "omitted", reason: "fixed synthetic PoC policy; maximum L3", level: "L3" },
      unverified: ["independent G3 judgement", ...(inspected.payload.mode === "live" ?
        ["AI-authored Red test and AI Refactor", "independent verification of subscription billing settings"] :
        ["real CLI execution"]), "enterprise acceptance", "general-purpose SAST and dependency vulnerability scanning"],
      policySha256: localPolicySha256 };
    const body = JSON.stringify(evidence, null, 2) + "\n";
    await mkdir(join(worktree, "docs"), { recursive: true });
    await writeFile(join(worktree, "docs/check-evidence.json"), evidenceBody);
    await writeFile(join(worktree, "docs/evidence-pack.json"), body);
    git(worktree, ["add", "--", "docs/check-evidence.json", "docs/evidence-pack.json"]);
    git(worktree, ["-c", "user.name=J-SIX synthetic PoC", "-c", "user.email=poc@localhost",
      "commit", "-qm", "Synthetic G4 evidence pack"]);
    const evidenceCommit = head(worktree);
    if (head(fixture.repo) !== request.payload.baseCommit || git(fixture.repo, ["status", "--porcelain"])) {
      throw new Error("受入れ前に対象repoが変わりました");
    }
    git(fixture.repo, ["merge", "--ff-only", evidenceCommit]);
    const artifactManifest = acceptedArtifactManifest(fixture.repo, evidenceCommit);
    let saved = await execute({ ...command, type: "task.accept_result", expectedHead: requested.head,
      targetCommit: evidenceCommit, baseCommit: request.payload.baseCommit,
      candidateCommit: request.payload.candidateCommit, evidenceCommit, evidenceSha256: sha(body),
      evidenceBundleSha256: sha(evidenceBody), artifactManifest });
    saved = await execute({ ...command, type: "task.g4_record", expectedHead: saved.head,
      targetCommit: evidenceCommit });
    return { ...saved, candidateCommit: evidenceCommit };
  }

  /** @param {Record<string,any>} command */
  async function runIntegration(command) {
    const requested = await execute({ ...command, type: "quality.request" });
    const fixture = config.fixtures[requested.project.fixtureId];
    if (!fixture || head(fixture.repo) !== command.targetCommit ||
      git(fixture.repo, ["status", "--porcelain"])) throw new Error("品質検査の対象Gitが変わりました");
    await writeFile(join(fixture.repo, "tests/integration.test.mjs"), syntheticIntegrationTest);
    const output = runSyntheticIntegration(fixture.repo);
    await writeFile(join(fixture.repo, "docs/integration-result.txt"), output);
    const metrics = `# 合成案件の品質指標\n\n要求充足: REQ-001 / PROP-001 を unit、hold-outに加え、handleApproval要求入口からapprove方針への結線を結合シナリオで観測。\n欠陥: この合成実行で検出した未解決欠陥 0。\n未検証: 実CLI、複数システム連携、性能、実顧客の受入れ。\n対象commit: ${command.targetCommit}\n結合実行出力 SHA-256: ${sha(output)}\n`;
    await writeFile(join(fixture.repo, "docs/quality-metrics.md"), metrics);
    if (head(fixture.repo) !== command.targetCommit) throw new Error("品質結果保存前にGit HEADが変わりました");
    git(fixture.repo, ["add", "--", "tests/integration.test.mjs", "docs/quality-metrics.md",
      "docs/integration-result.txt"]);
    git(fixture.repo, ["-c", "user.name=J-SIX synthetic PoC", "-c", "user.email=poc@localhost",
      "commit", "-qm", "Synthetic integration and quality metrics"]);
    const evidenceManifest = qualityEvidenceManifest(fixture.repo, head(fixture.repo));
    const result = await execute({ ...command, type: "quality.result", expectedHead: requested.head,
      targetCommit: head(fixture.repo), baseCommit: command.targetCommit,
      evidenceSha256: sha(output), metricsSha256: sha(metrics), evidenceManifest });
    return { ...result, integration: { result: "passed", evidenceSha256: sha(output),
      subjectCommit: result.project.targetCommit } };
  }

  /** @param {Record<string,any>} command */
  async function prepareDeliverables(command) {
    const requested = await execute({ ...command, type: "deliverables.request" });
    const fixture = config.fixtures[requested.project.fixtureId];
    if (!fixture || head(fixture.repo) !== command.targetCommit ||
      git(fixture.repo, ["status", "--porcelain"])) throw new Error("納品物生成の対象Gitが変わりました");
    const codeHash = sha(execFileSync("git", ["-C", fixture.repo, "show",
      `${command.targetCommit}:src/approval.mjs`], { stdio: ["ignore", "pipe", "pipe"] }));
    const evidenceHash = sha(execFileSync("git", ["-C", fixture.repo, "show",
      `${command.targetCommit}:docs/evidence-pack.json`], { stdio: ["ignore", "pipe", "pipe"] }));
    const body = `# 合成案件の逆生成設計書\n\n逆生成: 実装の現状を記録した文書。要求充足の独立証明ではない。\n対象commit: ${command.targetCommit}\n実装: src/approval.mjs (表示用hash ${codeHash})\n証跡: docs/evidence-pack.json (表示用hash ${evidenceHash})\nPhase 2代替項目: 設計書目次と検証戦略を確認し、合成題材の範囲で解消。\n納品物: requirement.md, design.md, adr.md, src/approval.mjs, src/approval-route.mjs, tests/approval.test.mjs, tests/holdout.test.mjs, tests/integration.test.mjs, docs/check-evidence.json, docs/evidence-pack.json, docs/integration-result.txt, docs/quality-metrics.md, docs/reverse-generated.md。\n未検証: 実顧客による合意、実CLI、企業システム連携。\n`;
    await writeFile(join(fixture.repo, "docs/reverse-generated.md"), body);
    if (head(fixture.repo) !== command.targetCommit) throw new Error("納品物保存前にGit HEADが変わりました");
    git(fixture.repo, ["add", "--", "docs/reverse-generated.md"]);
    git(fixture.repo, ["-c", "user.name=J-SIX synthetic PoC", "-c", "user.email=poc@localhost",
      "commit", "-qm", "Synthetic reverse-generated delivery record"]);
    return execute({ ...command, type: "deliverables.record", expectedHead: requested.head,
      targetCommit: head(fixture.repo), baseCommit: command.targetCommit, sha256: sha(body) });
  }

  return { initialize, list, detail, execute, runFake, confirmSubscription, runCli, cancelCli,
    acceptCandidate, runIntegration, prepareDeliverables };
}
