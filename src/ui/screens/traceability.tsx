import type { ScreenProps } from "./project";

/** トレーサビリティの画面：要件 ⇔ テスト ⇔ 実装（⇔ ADR）。テストの無い要件を目立たせる（REQ-024） */
export function Traceability({ state }: ScreenProps) {
  const { entries, untraced, properties } = state.traceability;
  if (entries.length === 0) return <p className="muted">トレーサビリティはまだありません</p>;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = state.requirements.items.length > 0 ? state.requirements.items.map((r) => byId.get(r.id) ?? { id: r.id, title: r.title, tests: [], code: [], adr: [] }) : entries;
  const bad = new Set(untraced);
  return (
    <>
      <p className="lead">
        要件がどのテストとコードで満たされているかの対応です。テストが対応していない要件があると、
        Hub の品質ゲート（G2 トレーサビリティ検査）は作業の完了を通しません。
      </p>
      <p role="status" className={untraced.length > 0 ? "trace-warn" : "trace-ok"}>
        {untraced.length > 0
          ? `⚑ テストが対応していない要件 ${untraced.length} 件：${untraced.join("・")}`
          : "✅ すべての要件にテストが対応しています"}
      </p>
      <table aria-label="要件 ⇔ テスト ⇔ 実装">
        <thead>
          <tr>
            <th>要件</th>
            <th>内容</th>
            <th>テスト</th>
            <th>実装</th>
            <th>ADR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={bad.has(e.id) ? "untraced" : undefined}>
              <td>{e.id}</td>
              <td>{e.title}</td>
              <td className="mono">{e.tests.length > 0 ? e.tests.join(", ") : "（なし）"}</td>
              <td className="mono">{e.code.length > 0 ? e.code.join(", ") : "—"}</td>
              <td>{e.adr.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {properties.length > 0 && (
        <table aria-label="性質（PROP）⇔ テスト">
          <thead>
            <tr>
              <th>性質</th>
              <th>テスト</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td className="mono">{p.tests.join(", ") || "（なし）"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
