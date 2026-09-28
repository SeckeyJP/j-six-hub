import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSyntheticIntegration, syntheticIntegrationTest } from "./integration-check.mjs";

/** @type {string[]} */
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("synthetic integration check", () => {
  it("fails when the request entry is wired incorrectly even though approve is correct", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsix-integration-")); roots.push(root);
    await mkdir(join(root, "src")); await mkdir(join(root, "tests"));
    await writeFile(join(root, "src/approval.mjs"),
      "export function approve(amount, limit) { return Number.isFinite(amount) && amount >= 0 && amount <= limit; }\n");
    await writeFile(join(root, "src/approval-route.mjs"),
      "export function handleApproval() { return { status: 200, body: { approved: true } }; }\n");
    await writeFile(join(root, "tests/approval.test.mjs"), "import { test } from 'node:test'; test('unit', () => {});\n");
    await writeFile(join(root, "tests/holdout.test.mjs"), "import { test } from 'node:test'; test('holdout', () => {});\n");
    await writeFile(join(root, "tests/integration.test.mjs"), syntheticIntegrationTest);
    expect(() => runSyntheticIntegration(root)).toThrow(/結合・E2E検査/);
  });
});
