# タスク一覧（P3）

要求: [requirement-spec.md](../specs/requirement-spec.md) / 設計: [design-spec.md](../specs/design-spec.md)

| ID | タスク | 要件 | 依存 |
|---|---|---|---|
| [TASK-HUB-001](TASK-HUB-001.md) | 基盤：Vite・React・TypeScript・Vitest・ESLint、プロセス定義の取得と検証、イベントの読み込み、CI | REQ-005, REQ-014 | — |
| [TASK-HUB-002](TASK-HUB-002.md) | リプレイの計算（`replay`） | REQ-004, 009, 010, 011 / PROP-001〜004 / AC-004, 005 | 001 |
| [TASK-HUB-003](TASK-HUB-003.md) | 共通レイアウト・再生操作・イベントの一覧 | REQ-001, 002, 003, 014 / AC-001〜003 | 002 |
| [TASK-HUB-004](TASK-HUB-004.md) | 画面：案件一覧・Phase ボード | REQ-005, 006, 010, 011, 013 / AC-006 | 003 |
| [TASK-HUB-005](TASK-HUB-005.md) | 画面：タスク・ゲート・承認・証跡 | REQ-007, 008, 009, 012 | 003 |
| [TASK-HUB-006](TASK-HUB-006.md) | GitHub Pages への公開 | — | 004, 005 |
| [TASK-HUB-007](TASK-HUB-007.md) | 複数案件のデータ（monthly-billing・架空の受発注連携）と抽出の拡張 | REQ-015, 016 | — |
| [TASK-HUB-008](TASK-HUB-008.md) | 複数案件のリプレイ・タスク状態の追加・統制ポイント・説明文 | REQ-015, 019, 020 / AC-009, 010 | 007 |
| [TASK-HUB-009](TASK-HUB-009.md) | 画面の作り直し（案件一覧・左の案件ナビ・出来事の記録・再生バー） | REQ-015, 016, 020, 021 / AC-007 | 008 |
| [TASK-HUB-010](TASK-HUB-010.md) | ガイドツアーと「？」の説明 | REQ-017, 018 / AC-008 | 009 |
| [TASK-HUB-011](TASK-HUB-011.md) | 再生中の配置のがたつきを無くす | REQ-022 | 009 |
| [TASK-HUB-012](TASK-HUB-012.md) | 要求・トレーサビリティのデータ抽出 | REQ-023, 024 | 007 |
| [TASK-HUB-013](TASK-HUB-013.md) | 要求・トレーサビリティの画面 | REQ-023, 024 / AC-011, 012 | 012 |

各タスクの定義（受入条件と変更許可範囲）は個別のファイルに置く。
