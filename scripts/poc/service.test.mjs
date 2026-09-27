import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPocService } from "./service.mjs";
import { localPolicySha256 } from "./policy.mjs";

const processDefinition = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
/** @type {string[]} */
const roots = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", env: { ...globalThis.process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" },
  }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "jsix-service-"));
  roots.push(root);
  const repo = join(root, "fixture");
  const ledgerRoot = join(root, "ledger");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(repo));
  await mkdir(join(repo, "src"));
  git(repo, ["init", "-q"]);
  const content = /** @type {Record<string,string>} */ ({
    "constitution.md": "# Synthetic constitution\n",
    "requirement.md": "REQ-001: case\nAC-001: check\nPROP-001: property\n受入条件: observed\n非機能: local\n未確定: なし\n",
    "flow.md": "# Synthetic flow\n",
    "invalid.md": "REQ-001: only one required field\n",
    "design.md": "検証戦略: hold-out and unit tests\n設計書目次: interface, operation\n",
    "adr.md": "# Synthetic decision\n",
    "prototype.md": "# Synthetic working prototype\n",
    "properties.md": "# Synthetic properties\n",
    "tasks.md": "TASK-001: synthetic change\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: unit,lint\n",
    "task.md": "TASK-001: synthetic change\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**\ndeny: secrets/**\nhold-out: tests/holdout.test.ts\nrequired-checks: unit,lint\n",
    "src/approval.mjs": "export function approve(amount, limit) { return false; }\n",
  });
  content["tasks.md"] = "TASK-001: synthetic change\nREQ-001: bounded approval\nAC-001: observable\nPROP-001: bounded\n依存: none\nallow: src/**,tests/approval.test.mjs\ndeny: tests/holdout.test.mjs\nhold-out: tests/holdout.test.mjs\nrequired-checks: unit,lint\n";
  content["task.md"] = content["tasks.md"] ?? "";
  for (const [path, body] of Object.entries(content)) await writeFile(join(repo, path), body);
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "baseline"]);
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const service = createPocService({ ledgerRoot, process: processDefinition, fixtures: {
    synthetic: { repo, repoId: "synthetic" },
  } });
  await service.initialize();
  return { repo, ledgerRoot, commit, content, service };
}

/** @param {string} body */
const hash = (body) => createHash("sha256").update(body).digest("hex");
/** @param {string|null} head @param {string} projectId @param {number} generation @param {string} targetCommit */
const common = (head, projectId, generation, targetCommit) => ({ expectedHead: head, projectId,
  generation, targetCommit, policySha256: localPolicySha256 });

describe("localhost service commands", () => {
  it("replays a synthetic project through P0 to P4 with real Git evidence", async () => {
    const { service, commit, content, ledgerRoot, repo } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    expect(result.project.phase).toBe("P0");
    result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    expect(result.project.canTransition).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P1");
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    expect(result.project.missing).toContain("decision:customer_approval/agreement_maturity:missing-or-expired");
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "customer", reason: "Synthetic review", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(result.project.canTransition).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P2");
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([
      ["design_spec", "design.md"], ["adr", "adr.md"],
      ["working_prototype", "prototype.md"], ["properties", "properties.md"],
    ])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "architect", reason: "Synthetic design review", expiresAt: "2099-01-01T00:00:00.000Z" });
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P3");
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([
      ["task_list", "tasks.md"], ["task_definition", "task.md"],
    ])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "gatekeeper", reason: "Synthetic scope review", expiresAt: "2099-01-01T00:00:00.000Z" });
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P4");
    expect(result.project.canTransition).toBe(false);
    expect(result.project.missing.some((reason) => reason.includes("unimplemented"))).toBe(true);
    const restored = createPocService({ ledgerRoot, process: processDefinition, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    await restored.initialize();
    expect((await restored.detail(projectId)).project.phase).toBe("P4");
    await expect(restored.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) }))
      .rejects.toThrow(/未実装/);
    result = await restored.execute({ type: "phase.reopen", ...common(result.head, projectId, 0, commit),
      phase: "P3", reason: "Synthetic task revision" });
    expect(result.project.phase).toBe("P3");
    expect(result.project.generation).toBe(1);
    expect(result.project.activity.filter((item) => item.kind === "decision" && item.phase === "P1")
      .map((item) => item.state)).toEqual(["historical"]);
    expect(result.project.activity.filter((item) => item.kind === "decision" && item.phase === "P3")
      .map((item) => item.state)).toEqual(["invalidated"]);
  }, 180_000);

  it("rejects stale writes, foreign commits and invalid paths, then invalidates old decisions on reopen", async () => {
    const { service, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    const oldHead = result.head;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    await expect(service.execute({ type: "artifact.submit", ...common(oldHead, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") })).rejects.toThrow(/stale|期待/);
    await expect(service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "../outside", sha256: hash(content["constitution.md"] ?? "") })).rejects.toThrow();
    await expect(service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, "a".repeat(40)) })).rejects.toThrow();
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "phase.reopen", ...common(result.head, projectId, 0, commit),
      phase: "P0", reason: "Synthetic requirement change" });
    expect(result.project.phase).toBe("P0");
    expect(result.project.generation).toBe(1);
    await expect(service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) })).rejects.toThrow(/世代/);
  });

  it("rejects structurally invalid evidence and serializes competing writers", async () => {
    const { service, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    const command = { type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") };
    const writes = await Promise.allSettled([service.execute(command), service.execute(command)]);
    expect(writes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const refreshed = await service.detail(projectId);
    expect(refreshed.project.artifacts[0]?.verified).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(refreshed.head, projectId, 0, commit) });
    await expect(service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "requirement_spec", path: "invalid.md", sha256: hash(content["invalid.md"] ?? "") }))
      .rejects.toThrow(/構造/);
  });

  it("projects rejection, expiry, resubmission and reopen reasons without arbitrary ledger payload", async () => {
    const { service, commit, content, ledgerRoot, repo } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const id = result.project.projectId;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
    const reviewId = [...result.project.activity].reverse().find((item) => item.kind === "review")?.recordId;
    result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
      outcome: "rejected", role: "customer", reason: "REQ-001を見直す", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect([...result.project.activity].reverse().find((item) => item.kind === "decision")).toMatchObject({
      reviewRecordId: reviewId, outcome: "rejected", role: "customer", reason: "REQ-001を見直す",
      state: "rejected", targetCommits: [commit], simulated: true,
    });
    expect(result.project.canTransition).toBe(false);
    const clockStart = Date.now() + 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(clockStart));
    result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
      outcome: "approved", role: "customer", reason: "修正を確認", expiresAt: new Date(clockStart + 60_000).toISOString() });
    expect(result.project.activity.filter((item) => item.kind === "decision").map((item) => item.state))
      .toEqual(["superseded", "current"]);
    vi.setSystemTime(new Date(clockStart + 120_000));
    let restored = createPocService({ ledgerRoot, process: processDefinition, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    expect([...(await restored.detail(id)).project.activity].reverse().find((item) => item.kind === "decision")?.state).toBe("expired");
    expect((await restored.detail(id)).project.canTransition).toBe(false);
    result = await restored.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
      artifactId: "requirement_spec", path: "requirement.md", sha256: hash(content["requirement.md"] ?? "") });
    expect([...result.project.activity].reverse().find((item) => item.kind === "review")?.state).toBe("superseded");
    result = await restored.execute({ type: "phase.reopen", ...common(result.head, id, 0, commit),
      phase: "P0", reason: "条件変更のため再合意" });
    const activity = result.project.activity;
    expect([...activity].reverse().find((item) => item.kind === "reopen")).toMatchObject({
      from: "P1", to: "P0", reason: "条件変更のため再合意", invalidatedPhases: ["P0", "P1"],
    });
    expect(activity.filter((item) => item.kind === "decision").every((item) => item.state === "invalidated")).toBe(true);
    restored = createPocService({ ledgerRoot, process: processDefinition, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    expect((await restored.detail(id)).project.activity).toEqual(activity);
    expect(JSON.stringify(activity)).not.toContain("/var/");
  }, 60_000);

  it("holds only the project whose Git ancestry is unknown while listing healthy projects", async () => {
    const { repo, ledgerRoot, commit, content } = await fixture();
    const betaRepo = join(ledgerRoot, "beta-fixture");
    await mkdir(betaRepo, { recursive: true });
    git(betaRepo, ["init", "-q"]);
    await writeFile(join(betaRepo, "constitution.md"), content["constitution.md"] ?? "");
    git(betaRepo, ["add", "."]); git(betaRepo, ["commit", "-qm", "beta baseline"]);
    const betaCommit = git(betaRepo, ["rev-parse", "HEAD"]);
    const service = createPocService({ ledgerRoot, process: processDefinition, fixtures: {
      synthetic: { repo, repoId: "synthetic" }, beta: { repo: betaRepo, repoId: "beta" },
    } });
    await service.initialize();
    let alpha = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const alphaId = alpha.project.projectId;
    alpha = await service.execute({ type: "artifact.submit", ...common(alpha.head, alphaId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    alpha = await service.execute({ type: "phase.transition", ...common(alpha.head, alphaId, 0, commit) });
    alpha = await service.execute({ type: "phase.reopen", ...common(alpha.head, alphaId, 0, commit),
      phase: "P0", reason: "再提出" });
    const beta = await service.execute({ type: "project.create", fixtureId: "beta",
      expectedHead: alpha.head, targetCommit: betaCommit, policySha256: localPolicySha256 });
    git(repo, ["checkout", "--orphan", "unrelated"]);
    git(repo, ["commit", "-qm", "unrelated root"]);
    const listing = await service.list();
    expect(listing.projects.find((item) => item.projectId === alphaId)).toMatchObject({
      verified: false, phase: null, canTransition: false,
      missing: ["target:verification-unknown"],
    });
    expect(listing.projects.find((item) => item.projectId === beta.project.projectId)).toMatchObject({
      verified: true, phase: "P0", targetCommit: betaCommit,
    });
    expect(listing.fixtures.find((item) => item.fixtureId === "beta")?.verified).toBe(true);
    await expect(service.execute({ type: "phase.transition", ...common(beta.head, alphaId, 1,
      git(repo, ["rev-parse", "HEAD"])) })).rejects.toThrow(/基準commit|系列/);
    await rm(repo, { recursive: true, force: true });
    const missingRepo = await service.list();
    expect(missingRepo.fixtures.find((item) => item.fixtureId === "synthetic")?.verified).toBe(false);
    expect(missingRepo.projects.find((item) => item.projectId === beta.project.projectId)?.verified).toBe(true);
  }, 60_000);

  it("marks the current review and decision for recheck after a Git artifact changes or disappears", async () => {
    const { service, repo, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const id = result.project.projectId;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"] ?? "") });
    result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
    for (const [artifactId, path] of /** @type {[string,string][]} */ ([["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
        artifactId, path, sha256: hash(content[path] ?? "") });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
    result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
      outcome: "approved", role: "customer", reason: "合成要求を確認", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(result.project.activity.filter((item) => ["review", "decision"].includes(item.kind)).map((item) => item.state))
      .toEqual(["current", "current"]);
    const changedBody = `${content["requirement.md"]}REQ-002: changed\n`;
    await writeFile(join(repo, "requirement.md"), changedBody);
    git(repo, ["add", "requirement.md"]); git(repo, ["commit", "-qm", "change requirement"]);
    let changed = await service.detail(id);
    expect(changed.project.canTransition).toBe(false);
    expect(changed.project.activity.filter((item) => ["review", "decision"].includes(item.kind)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "review", state: "evidence_changed",
        statusReasons: expect.arrayContaining(["target:commit-changed"]) }),
      expect.objectContaining({ kind: "decision", state: "evidence_changed" })]));
    await rm(join(repo, "requirement.md"));
    git(repo, ["add", "-A"]); git(repo, ["commit", "-qm", "remove requirement"]);
    changed = await service.detail(id);
    expect(changed.project.activity.filter((item) => item.kind === "decision").at(-1)?.state).toBe("evidence_changed");
    await writeFile(join(repo, "requirement.md"), changedBody);
    git(repo, ["add", "-A"]); git(repo, ["commit", "-qm", "restore requirement"]);
    const newCommit = git(repo, ["rev-parse", "HEAD"]);
    for (const [artifactId, path, body] of /** @type {[string,string,string][]} */ ([
      ["requirement_spec", "requirement.md", changedBody],
      ["business_flow_prototype", "flow.md", content["flow.md"] ?? ""],
    ])) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, newCommit),
        artifactId, path, sha256: hash(body) });
    }
    expect(result.project.activity.filter((item) => ["review", "decision"].includes(item.kind)).map((item) => item.state))
      .toEqual(["superseded", "superseded"]);
    await expect(service.execute({ type: "phase.transition", ...common(result.head, id, 0, newCommit) }))
      .rejects.toThrow(/遷移条件/);
  }, 60_000);

  it("records a fixed fake TDD run and real G1/G2 checks before candidate acceptance", async () => {
    const { service, commit, content, repo } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const id = result.project.projectId;
    /** @type {Record<string,[string,string][]>} */
    const byPhase = {
      P0: [["constitution", "constitution.md"]],
      P1: [["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]],
      P2: [["design_spec", "design.md"], ["adr", "adr.md"], ["working_prototype", "prototype.md"], ["properties", "properties.md"]],
      P3: [["task_list", "tasks.md"], ["task_definition", "task.md"]],
    };
    for (const phase of ["P0", "P1", "P2", "P3"]) {
      for (const [artifactId, path] of byPhase[phase] ?? []) {
        result = await service.execute({ type: "artifact.submit", ...common(result.head, id, 0, commit),
          artifactId, path, sha256: hash(content[path] ?? "") });
      }
      if (phase !== "P0") {
        result = await service.execute({ type: "review.request", ...common(result.head, id, 0, commit) });
        const role = phase === "P1" ? "customer" : "gatekeeper";
        result = await service.execute({ type: "decision.record", ...common(result.head, id, 0, commit),
          outcome: "approved", role, reason: `Synthetic ${phase}`, expiresAt: "2099-01-01T00:00:00.000Z" });
      }
      result = await service.execute({ type: "phase.transition", ...common(result.head, id, 0, commit) });
    }
    expect(result.project.phase).toBe("P4");
    const generated = await service.runFake({ ...common(result.head, id, 0, commit) });
    expect(generated.run.mode).toBe("fake");
    expect(generated.run.checks).toHaveLength(15);
    expect(generated.run.checks.every((item) => item.result === "passed")).toBe(true);
    expect(generated.project.phase).toBe("P4");
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(commit);
  }, 180_000);
});
