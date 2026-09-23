import catalog from "../../data/artifact-links.json";
import type { HubEvent } from "../types/events";
import type { ProjectMeta } from "../types/program";

interface ArtifactLink {
  role: string;
  commit: string;
  path?: string;
  label: string;
}
const linksByProject: Record<string, { events: Record<string, ArtifactLink[]> }> = catalog;
const ROLES: Record<string, string> = { source: "出典", input: "入力", output: "出力", reference: "参考（作業前）" };

/** 公開を確認した索引だけを使い、元記録の文字列からブラウザで URL を推測しない。 */
export function ArtifactLinks({ project, event }: { project: ProjectMeta; event: HubEvent }) {
  const links = project.fictional ? [] : linksByProject[project.id]?.events[event.id] ?? [];
  if (!links.length) return null;
  const item = (link: ArtifactLink) => (
    <ArtifactItem key={`${link.role}:${link.commit}:${link.path ?? ""}`} link={link} reconstructed={event.provenance === "reconstructed"} />
  );
  return (
    <section className="artifact-links" aria-label="公開済みの実物">
      <p>公開済みの実物 <span className="muted">（固定版・新しいタブ）</span></p>
      <ul>{links.slice(0, 3).map(item)}</ul>
      {links.length > 3 && <details><summary>残り {links.length - 3} 件を表示</summary><ul>{links.slice(3).map(item)}</ul></details>}
      {links.some((link) => link.role === "reference") && <p className="muted">参考は作業前の版です。AI が実際に読んだ入力かは未確認です。</p>}
      {event.provenance === "reconstructed" && <p className="muted">資料は実在しますが、この出来事自体は再構成です。</p>}
    </section>
  );
}

function ArtifactItem({ link, reconstructed }: { link: ArtifactLink; reconstructed: boolean }) {
  const path = link.path?.split("/").map(encodeURIComponent).join("/");
  const href = `https://github.com/SeckeyJP/j-six/${path ? "blob" : "commit"}/${link.commit}${path ? `/${path}` : ""}`;
  const role = `${ROLES[link.role]}${link.role === "input" && reconstructed ? "（再構成）" : ""}`;
  return (
    <li>
      <span className="muted">{role} · {link.commit.slice(0, 7)}</span>{" "}
      <a href={href} target="_blank" rel="noopener noreferrer">{link.label}<span aria-hidden="true"> ↗</span></a>
    </li>
  );
}
