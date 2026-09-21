import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { rawUrl, verifyContent, yamlToProcess } from "./process-lock.mjs";

const lock = {
  repository: "SeckeyJP/j-six",
  tag: "process-v0.1.0",
  path: "process/jsix-process.yaml",
  sha256: "",
};

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

describe("rawUrl", () => {
  it("タグとパスから raw の URL を組み立てる", () => {
    expect(rawUrl(lock)).toBe(
      "https://raw.githubusercontent.com/SeckeyJP/j-six/process-v0.1.0/process/jsix-process.yaml",
    );
  });
});

describe("verifyContent", () => {
  it("ハッシュが一致すれば通す", () => {
    const text = "schema_version: 1\n";
    expect(() => verifyContent(text, { ...lock, sha256: sha(text) })).not.toThrow();
  });

  it("ハッシュが一致しなければ拒否する（改変・取り違えの検出）", () => {
    expect(() => verifyContent("schema_version: 2\n", { ...lock, sha256: sha("schema_version: 1\n") })).toThrow(
      /SHA-256 が一致しない/,
    );
  });
});

describe("yamlToProcess", () => {
  it("YAML 1.2 として読む（on: を真偽値にしない）", () => {
    const doc = yamlToProcess("schema_version: 1\nx:\n  on: yes\n");
    expect(doc.x).toEqual({ on: "yes" });
  });

  it("schema_version が 1 でなければ拒否する", () => {
    expect(() => yamlToProcess("schema_version: 2\n")).toThrow(/schema_version/);
  });
});
