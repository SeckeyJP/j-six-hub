import type { ScreenProps } from "./project";
import { ProvenanceBadge } from "../provenance-badge";

const ACTOR = { human: "人間", ai: "AI", system: "システム" } as const;

export function Approvals({ state, process }: ScreenProps) {
  if (state.approvals.length === 0) return <p>承認の記録はまだありません</p>;
  const roleName = (id: string | null) => (id ? (process.roles.find((r) => r.id === id)?.name ?? id) : "役割未記録");
  return (
    <table aria-label="承認の記録">
      <caption>主体・役割には抽出時の補足情報、承認時刻には再構成が含まれます。有効・無効は再生モデル上の判定であり、本人の認証済み操作を証明しません。</caption>
      <thead>
        <tr>
          <th>イベント</th>
          <th>ゲート</th>
          <th>承認した者</th>
          <th>判定</th>
        </tr>
      </thead>
      <tbody>
        {state.approvals.map((a) => (
          <tr key={a.eventId} className={a.valid ? undefined : "warn"}>
            <td>
              <ProvenanceBadge value={a.provenance} /> {a.eventId}
            </td>
            <td>
              {a.phase} {a.gateName}
            </td>
            <td>
              {ACTOR[a.actorKind]}（{roleName(a.role)}）
            </td>
            <td>{a.valid ? "有効" : `無効: ${a.reason}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
