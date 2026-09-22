import type { ScreenProps } from "./project";

/** 要求の画面：その時点の要件（REQ）と性質（PROP）。直前の更新で追加されたものを示す（REQ-023） */
export function Requirements({ state }: ScreenProps) {
  const { items, properties, added } = state.requirements;
  if (items.length === 0) return <p className="muted">要求はまだ登録されていません</p>;
  const isNew = new Set(added);
  return (
    <>
      <p className="lead">
        要件（REQ）は顧客と合意した業務ルール、性質（PROP）は入力空間全体で成り立つべき性質です。
        どちらもテストコードに ID を書き込み、対応をトレーサビリティで機械的に確かめます。
      </p>
      <table aria-label="要件（REQ）">
        <thead>
          <tr>
            <th>要件</th>
            <th>内容</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className={isNew.has(r.id) ? "added" : undefined}>
              <td>
                {r.id} {isNew.has(r.id) && <span className="tag-added">追加</span>}
              </td>
              <td>{r.title}</td>
              <td className="muted">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {properties.length > 0 && (
        <table aria-label="性質（PROP）">
          <thead>
            <tr>
              <th>性質</th>
              <th>対応する要件</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id} className={isNew.has(p.id) ? "added" : undefined}>
                <td>{p.id}</td>
                <td>{p.requirements.join("・") || "—"}</td>
                <td className="muted">{p.property}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
