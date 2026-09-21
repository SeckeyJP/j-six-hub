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

各タスクの定義（受入条件と変更許可範囲）は個別のファイルに置く。
