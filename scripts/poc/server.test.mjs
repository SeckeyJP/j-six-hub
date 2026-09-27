import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { createPocService } from "./service.mjs";
import { startPocServer } from "./server.mjs";

const definition = JSON.parse(readFileSync(join(process.cwd(), ".cache/process.json"), "utf8"));
/** @type {{root:string,server:import('node:http').Server}[]} */
const opened = [];
afterEach(async () => Promise.all(opened.splice(0).map(async ({ root, server }) => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
})));

/** @param {string} repo @param {string[]} args */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "PoC", GIT_AUTHOR_EMAIL: "poc@localhost",
      GIT_COMMITTER_NAME: "PoC", GIT_COMMITTER_EMAIL: "poc@localhost" } }).trim();
}

async function running() {
  const root = await mkdtemp(join(tmpdir(), "jsix-http-"));
  const repo = join(root, "repo"); await mkdir(repo);
  git(repo, ["init", "-q"]);
  await writeFile(join(repo, "constitution.md"), "# Synthetic constitution\n");
  git(repo, ["add", "."]); git(repo, ["commit", "-qm", "fixture"]);
  const service = createPocService({ ledgerRoot: join(root, "ledger"), process: definition,
    fixtures: { synthetic: { repo, repoId: "synthetic" } } });
  const result = await startPocServer({ service });
  opened.push({ root, server: result.server });
  return result.url;
}

describe("local-only HTTP boundary", () => {
  it("requires a browser session and CSRF/Origin for writes", async () => {
    const url = await running();
    expect((await fetch(`${url}/api/projects`)).status).toBe(403);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    const cookie = page.headers.get("set-cookie")?.split(";")[0] ?? "";
    const csrf = /name="csrf-token" content="([0-9a-f]+)"/.exec(await page.text())?.[1] ?? "";
    expect(cookie).toMatch(/^jsix_poc=/);
    expect(csrf).toMatch(/^[0-9a-f]{64}$/);
    const list = await fetch(`${url}/api/projects`, { headers: { Cookie: cookie } });
    const bootstrap = await list.json();
    expect(bootstrap.fixtures[0].fixtureId).toBe("synthetic");
    const body = JSON.stringify({ fixtureId: "synthetic", expectedHead: null,
      targetCommit: bootstrap.fixtures[0].targetCommit, policySha256: bootstrap.policySha256 });
    const baseHeaders = { Cookie: cookie, Origin: url, "Content-Type": "application/json" };
    expect((await fetch(`${url}/api/projects`, { method: "POST", headers: baseHeaders, body })).status).toBe(403);
    expect((await fetch(`${url}/api/projects`, { method: "POST",
      headers: { ...baseHeaders, "X-CSRF-Token": csrf, Origin: "http://evil.invalid" }, body })).status).toBe(403);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(`${url}/api/projects`, { method: "POST", headers: {
        ...baseHeaders, "X-CSRF-Token": csrf, Host: "evil.invalid", "Content-Length": Buffer.byteLength(body),
      } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject); req.end(body);
    });
    expect(badHost).toBe(403);
    expect((await fetch(`${url}/api/projects`, { method: "POST",
      headers: { ...baseHeaders, "X-CSRF-Token": csrf, "Content-Type": "text/plain" }, body })).status).toBe(400);
    const created = await fetch(`${url}/api/projects`, { method: "POST",
      headers: { ...baseHeaders, "X-CSRF-Token": csrf }, body });
    expect(created.status).toBe(200);
    expect((await created.json()).project.phase).toBe("P0");
  }, 30_000);
});
