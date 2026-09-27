import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPocService } from "./service.mjs";
import { localPolicySha256 } from "./policy.mjs";

const process = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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
  const content = {
    "constitution.md": "# Synthetic constitution\n",
    "requirement.md": "REQ-001: case\nAC-001: check\nPROP-001: property\n受入条件: observed\n非機能: local\n未確定: なし\n",
    "flow.md": "# Synthetic flow\n",
  };
  for (const [path, body] of Object.entries(content)) await writeFile(join(repo, path), body);
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "baseline"]);
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const service = createPocService({ ledgerRoot, process, fixtures: {
    synthetic: { repo, repoId: "synthetic" },
  } });
  await service.initialize();
  return { repo, ledgerRoot, commit, content, service };
}

const hash = (body) => createHash("sha256").update(body).digest("hex");
const common = (head, projectId, generation, targetCommit) => ({ expectedHead: head, projectId,
  generation, targetCommit, policySha256: localPolicySha256 });

describe("localhost service commands", () => {
  it("replays a synthetic project through P0 and P1 with real Git evidence", async () => {
    const { service, commit, content, ledgerRoot, repo } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    expect(result.project.phase).toBe("P0");
    result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"]) });
    expect(result.project.canTransition).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P1");
    for (const [artifactId, path] of [["requirement_spec", "requirement.md"], ["business_flow_prototype", "flow.md"]]) {
      result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
        artifactId, path, sha256: hash(content[path]) });
    }
    result = await service.execute({ type: "review.request", ...common(result.head, projectId, 0, commit) });
    expect(result.project.missing).toContain("decision:customer_approval/customer_approval:missing-or-expired");
    result = await service.execute({ type: "decision.record", ...common(result.head, projectId, 0, commit),
      outcome: "approved", role: "customer", reason: "Synthetic review", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(result.project.canTransition).toBe(true);
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    expect(result.project.phase).toBe("P2");
    const restored = createPocService({ ledgerRoot, process, fixtures: { synthetic: { repo, repoId: "synthetic" } } });
    await restored.initialize();
    expect((await restored.detail(projectId)).project.phase).toBe("P2");
  });

  it("rejects stale writes, foreign commits and invalid paths, then invalidates old decisions on reopen", async () => {
    const { service, commit, content } = await fixture();
    let result = await service.execute({ type: "project.create", fixtureId: "synthetic",
      expectedHead: null, targetCommit: commit, policySha256: localPolicySha256 });
    const projectId = result.project.projectId;
    const oldHead = result.head;
    result = await service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"]) });
    await expect(service.execute({ type: "artifact.submit", ...common(oldHead, projectId, 0, commit),
      artifactId: "constitution", path: "constitution.md", sha256: hash(content["constitution.md"]) })).rejects.toThrow(/stale|期待/);
    await expect(service.execute({ type: "artifact.submit", ...common(result.head, projectId, 0, commit),
      artifactId: "constitution", path: "../outside", sha256: hash(content["constitution.md"]) })).rejects.toThrow();
    await expect(service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, "a".repeat(40)) })).rejects.toThrow();
    result = await service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) });
    result = await service.execute({ type: "phase.reopen", ...common(result.head, projectId, 0, commit),
      phase: "P0", reason: "Synthetic requirement change" });
    expect(result.project.phase).toBe("P0");
    expect(result.project.generation).toBe(1);
    await expect(service.execute({ type: "phase.transition", ...common(result.head, projectId, 0, commit) })).rejects.toThrow(/世代/);
  });
});
