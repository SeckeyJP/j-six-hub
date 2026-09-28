import { execFileSync } from "node:child_process";

export const syntheticIntegrationTest = `import { test } from "node:test";
import { strict as assert } from "node:assert";
import { handleApproval } from "../src/approval-route.mjs";
test("REQ-001 / PROP-001: request entry is wired to approval policy", () => {
  assert.deepEqual(handleApproval({ amount: 5, limit: 10 }), { status: 200, body: { approved: true } });
  assert.deepEqual(handleApproval({ amount: 12, limit: 10 }), { status: 200, body: { approved: false } });
  assert.deepEqual(handleApproval({ amount: -1, limit: 10 }), { status: 200, body: { approved: false } });
  assert.deepEqual(handleApproval({ amount: "5", limit: 10 }),
    { status: 400, body: { approved: false, error: "invalid request" } });
});
`;

/** Execute the synthetic request-entry integration. @param {string} repo */
export function runSyntheticIntegration(repo) {
  try {
    return execFileSync(process.execPath,
      ["--test", "tests/approval.test.mjs", "tests/holdout.test.mjs", "tests/integration.test.mjs"],
      { cwd: repo, encoding: "utf8", timeout: 30_000, maxBuffer: 512 * 1024,
        stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error("結合・E2E検査が失敗しました。結果不明として保留します", { cause: error });
  }
}
