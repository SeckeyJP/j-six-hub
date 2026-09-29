import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPocService } from "./service.mjs";

const here = resolve(process.cwd(), "poc-ui");
const maxBody = 64 * 1024;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'" };

/** @param {unknown} a @param {unknown} b */
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {any} body @param {string=} contentType @param {Record<string,string>=} extra */
function send(res, status, body, contentType = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(status, { ...headers, ...extra, "Content-Type": contentType });
  res.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

/** @param {import('node:http').IncomingMessage} req */
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
    throw new Error("JSON Content-Typeが必要です");
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBody) throw new Error("要求bodyが大きすぎます");
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON objectが必要です");
  return body;
}

/** @param {string} pathname @param {Record<string,any>} body */
function mappedCommand(pathname, body) {
  if (pathname === "/api/projects") return { ...body, type: "project.create" };
  const match = /^\/api\/projects\/([0-9a-f-]{36})\/(artifacts|review-requests|decisions|transitions|reopen|complete)$/.exec(pathname);
  if (!match) return null;
  const type = /** @type {Record<string,string>} */ ({ artifacts: "artifact.submit", "review-requests": "review.request",
    decisions: "decision.record", transitions: "phase.transition", reopen: "phase.reopen",
    complete: "phase.complete" })[match[2] ?? ""];
  return { ...body, projectId: match[1], type };
}

/** @param {unknown} error */
function safeMessage(error) {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 300 && !/\n|\r|git -C|\/Users\/|\/home\//.test(value) ? value :
    "操作を保留しました。ローカルサーバーの状態を確認してください";
}

/** @param {{service:ReturnType<typeof createPocService>,port?:number}} options */
export async function startPocServer({ service, port = 0 }) {
  await service.initialize();
  const session = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    const bound = /** @type {import('node:net').AddressInfo} */ (server.address());
    const origin = `http://127.0.0.1:${bound.port}`;
    const host = `127.0.0.1:${bound.port}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin)) {
      send(res, 403, { error: "Host/Originが一致しません" }); return;
    }
    let pathname;
    try { pathname = new URL(req.url ?? "/", origin).pathname; }
    catch { send(res, 400, { error: "URLが不正です" }); return; }
    if (req.method === "GET" && pathname === "/") {
      const html = (await readFile(join(here, "workbench.html"), "utf8")).replace("__CSRF__", csrf);
      send(res, 200, html, "text/html; charset=utf-8", { "Set-Cookie": `jsix_poc=${session}; HttpOnly; SameSite=Strict; Path=/` });
      return;
    }
    if (req.method === "GET" && ["/workbench.js", "/workbench.css", "/run-state.mjs"].includes(pathname)) {
      const content = await readFile(join(here, pathname.slice(1)), "utf8");
      send(res, 200, content, pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
      return;
    }
    const cookie = (req.headers.cookie ?? "").split(";").map((part) => part.trim())
      .find((part) => part.startsWith("jsix_poc="))?.slice("jsix_poc=".length);
    if (!equal(cookie, session)) { send(res, 403, { error: "ローカルセッションがありません" }); return; }
    if (req.method === "POST" && (!equal(req.headers["x-csrf-token"], csrf) || req.headers.origin !== origin)) {
      send(res, 403, { error: "CSRF token/Originが一致しません" }); return;
    }
    try {
      if (req.method === "GET" && pathname === "/api/projects") {
        send(res, 200, await service.list()); return;
      }
      const detailMatch = /^\/api\/projects\/([0-9a-f-]{36})$/.exec(pathname);
      if (req.method === "GET" && detailMatch) {
        send(res, 200, await service.detail(detailMatch[1] ?? "")); return;
      }
      const body = req.method === "POST" ? await jsonBody(req) : null;
      const command = body ? mappedCommand(pathname, body) : null;
      if (command) { send(res, 200, await service.execute(command)); return; }
      const action = /^\/api\/projects\/([0-9a-f-]{36})\/(fake-runs|accept-candidates|integration|deliverables|cli-confirm|cli-smoke|cli-edit|cli-cancel|cli-recover)$/.exec(pathname);
      if (body && action) {
        const input = { ...body, projectId: action[1] };
        if (action[2] === "cli-confirm") { send(res, 200, await service.confirmSubscription(input)); return; }
        if (action[2] === "cli-smoke" || action[2] === "cli-edit") {
          send(res, 200, await service.runCli({ ...input, kind: action[2] === "cli-smoke" ? "smoke" : "edit" })); return;
        }
        if (action[2] === "cli-cancel") { send(res, 200, await service.cancelCli(input)); return; }
        if (action[2] === "cli-recover") { send(res, 200, await service.recoverCli(input)); return; }
        const operation = action[2] === "fake-runs" ? service.runFake :
          action[2] === "accept-candidates" ? service.acceptCandidate :
            action[2] === "integration" ? service.runIntegration : service.prepareDeliverables;
        send(res, 200, await operation(input)); return;
      }
      send(res, 404, { error: "未対応の操作です" });
    } catch (error) {
      const message = safeMessage(error);
      const status = /stale|古い|変わりました|競合/.test(message) ? 409 :
        message.startsWith("操作を保留") ? 503 : 400;
      send(res, status, { error: message });
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen(undefined));
  });
  return { server, url: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}` };
}

if (process.argv[1] && import.meta.url.startsWith("file:") &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--config");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--config にローカルPoC設定JSONを指定してください");
  const path = resolve(process.argv[index + 1] ?? "");
  const config = JSON.parse(await readFile(path, "utf8"));
  const definition = JSON.parse(await readFile(resolve(".cache/process.json"), "utf8"));
  const service = createPocService({ ...config, process: definition });
  const { url } = await startPocServer({ service, port: config.port ?? 0 });
  process.stdout.write(`J-SIX Hub ローカルPoC: ${url}\n`);
}
