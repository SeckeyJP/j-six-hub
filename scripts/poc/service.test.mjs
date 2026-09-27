import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPocService } from "./service.mjs";
import { localPolicySha256 } from "./policy.mjs";

const processDefinition = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
/** @type {string[]} */
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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
  });
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
  }, 60_000);

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
});
