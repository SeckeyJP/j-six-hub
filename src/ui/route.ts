export type Route = { kind: "home" } | { kind: "project"; id: string; screen: string };

/** `#/` は案件一覧、`#/p/<案件ID>/<画面>` は案件の画面 */
export function parseRoute(route: string): Route {
  const m = /^\/p\/([^/]+)(?:\/([^/]+))?/.exec(route);
  if (!m) return { kind: "home" };
  return { kind: "project", id: m[1]!, screen: m[2] ?? "board" };
}
