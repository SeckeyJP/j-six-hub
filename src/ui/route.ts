export type Route = ({ kind: "home" } | { kind: "project"; id: string; screen: string }) & {
  /** URL に含まれる再生位置（?n=）。無ければ null */
  n: number | null;
};

function parseN(query: string | undefined): number | null {
  if (!query) return null;
  const value = new URLSearchParams(query).get("n");
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** `#/` は案件一覧、`#/p/<案件ID>/<画面>` は案件の画面。`?n=` で再生位置を受け取る（REQ-026） */
export function parseRoute(route: string): Route {
  const [path, query] = route.split("?");
  const n = parseN(query);
  const m = /^\/p\/([^/]+)(?:\/([^/]+))?/.exec(path ?? "");
  if (!m) return { kind: "home", n };
  return { kind: "project", id: m[1]!, screen: m[2] ?? "board", n };
}

/** 再生位置を含む hash を組み立てる */
export function buildHash(route: Route, n: number): string {
  const path = route.kind === "project" ? `/p/${route.id}/${route.screen}` : "/";
  return `#${path}?n=${n}`;
}
