# Design Spec — J-SIX Hub リプレイ型サンプル

**版**: 1.0 | **日付**: 2026-09-22 | **Phase**: P2 | 要求: [requirement-spec.md](requirement-spec.md)

---

## 1. アーキテクチャ

```
[ビルド時]
  scripts/fetch-process.mjs ── J-SIX process-v0.1.0 の yaml を取得
        │                      process.lock.json の SHA-256 と照合 → .cache/process.json
        ▼
[ブラウザ]
  data/events.jsonl ─┐
  process.json ──────┤
                     ▼
  src/replay/  （React に依存しない。純粋関数）
     replay(events, process, n) → HubState
                     ▼
  src/ui/    （HubState を表示するだけ）
     レイアウト・再生操作・各画面
```

技術スタックは [ADR-0002](../adr/0002-web-app-stack.md)。

## 2. データ

### 2.1 入力

- **イベント**：`data/events.jsonl`（[ADR-0001](../adr/0001-replay-event-data.md)、`data/events.schema.json`）
- **プロセス定義**：J-SIX `process/jsix-process.yaml`（`process-v0.1.0`）。使うのは `phases`・`gates`（層・チェック・承認者の役割）・`roles`・`check_kinds`・`deviations`・`state_machines`

### 2.2 取り込みの手順（プロセス定義）

1. `process.lock.json` の `tag` と `path` から URL（raw.githubusercontent.com）を組み立てて取得する
2. 取得した内容の SHA-256 が `sha256` と一致しなければ失敗する（改変・取り違えの検出）
3. YAML を JSON に変換して `.cache/process.json` に置く（コミットしない）。キャッシュがありハッシュが一致すれば取得しない

## 3. リプレイの計算（`src/replay/`）

### 3.1 HubState

| 項目 | 内容 |
|---|---|
| `n` | 適用したイベント数 |
| `current` | n 件目のイベント（無ければ null） |
| `iteration` | 直近のイベントの一周の名前 |
| `project` | 登録された案件、固定したプロセス定義の版、憲法の版 |
| `phases[]` | プロセス定義の順に、Phase の ID・名前・ゲート・状態（`not_started` / `in_progress` / `approved`）・逆戻りで開き直したか |
| `tasks[]` | タスクの ID（無ければ「ID なし」）・状態・現在の工程・サブエージェントの履歴・ゲート記録の有無 |
| `evaluations[]` | ゲートの判定（`gate.evaluated`）。起動元・結果・回数・層ごとの結果 |
| `approvals[]` | 承認（`gate.approved`）。有効か・無効ならその理由 |
| `deviations[]` | 逸脱。種類・開いたイベント・閉じたイベント |
| `violations[]` | 順序違反。違反したイベントと、承認されていなかった Phase |
| `counts` | 実測・再構成の件数 |

### 3.2 規則

`replay` は空の状態から先頭 n 件を順に適用する（REQ-004）。各イベントの扱いは次のとおり。

| イベント | 状態への反映 |
|---|---|
| `project.registered` | 案件を登録する。P0（`mode: continuous`）を進行中にする |
| `process.pinned` / `constitution.pinned` | 版を記録する |
| 作業のイベント（`commit.created`・`ai.*`・`gate.evaluated`・`hook.blocked`・`task.dispatched`）で `phase` があるもの | その Phase が未着手なら進行中にする。承認済みならそのまま。**P1 以降で、それより前の Phase（P0 を除く）に承認済みでないものがあれば順序違反を記録する**（REQ-011） |
| `gate.approved` | ゲートの Phase を求める。**有効な承認**（実行者が人間で、役割が記録されていればゲートの承認者の役割に含まれる）なら Phase を承認済みにする。人間でなければ無効（理由「承認者は人間の役割に限られる」）、役割が承認者に含まれなければ無効（REQ-009） |
| `deviation.opened` | 逸脱を開く。`phase_rollback` なら `to_phase` 以降（P0 を除く）を進行中に戻し、開き直した印を付ける（REQ-010） |
| `deviation.closed` | 同じ種類で開いている逸脱のうち最後のものを閉じる |
| `task.dispatched` | タスクを待機で作る。ID が無いタスクは「一周名 / ID なし」で識別する |
| `ai.session.started`（task あり） | タスクを実行中にする |
| `ai.agent.started`（task あり） | 現在の工程を `payload.step` にする。G3 なら判定中にする |
| `commit.created`（task あり） | 工程を記録する。task が無く P4 のコミットなら、同じ一周の ID なしタスクを「合格（ゲート記録なし）」にする |
| `gate.evaluated` | 判定を記録する。task があれば、`passed` で合格、それ以外で不合格にする |

**per_task の Phase（P4）**は、タスクが1件以上あり全タスクが合格したとき承認済みとみなす（プロセス定義の遷移 `all_tasks_done`）。

### 3.3 Property の実装方針

| PROP | 方針 |
|---|---|
| PROP-001・002 | 実データと、実データから作った乱数のイベント列で、任意の n と操作列について検証する（PBT。ライブラリは fast-check） |
| PROP-003 | 任意の n について、承認済みの非 per_task Phase に有効な承認があるかを検証する |
| PROP-004 | 任意の n について `counts.measured + counts.reconstructed === n` |

## 4. 画面

### 4.1 共通レイアウト

| 領域 | 内容 |
|---|---|
| 上部 | タイトル、**リプレイの表示（常時。REQ-001）**、再生操作（REQ-003） |
| ナビゲーション | 案件一覧 / Phase ボード / タスク / ゲート / 承認 / 証跡 |
| 右側 | イベントの一覧（n 件目まで。新しい順）。各行に実測／再構成のラベル（REQ-002）。選ぶと詳細と根拠を表示 |
| 下部 | プロセス定義の出典（J-SIX、CC BY 4.0、版。REQ-014）、データの出典 |

### 4.2 画面一覧（hash ルーティング）

| パス | 画面 | 要件 |
|---|---|---|
| `#/` | 案件一覧 | REQ-013 |
| `#/board` | Phase ボード（Phase の状態・ゲート・順序違反・開いている逸脱） | REQ-005, 006, 010, 011 |
| `#/tasks` | タスクボードと AI の実行タイムライン | REQ-007 |
| `#/gates` | ゲート結果 | REQ-008 |
| `#/approvals` | 承認 | REQ-009 |
| `#/evidence` | 証跡パッケージ | REQ-012 |

### 4.3 再生操作

| 操作 | ボタン | キー |
|---|---|---|
| 再生 / 一時停止 | ▶ / ⏸ | Space |
| 1イベント進む / 戻る | ⏭ / ⏮ | → / ← |
| 先頭 / 末尾へ | ⏪ / ⏩ | Home / End |
| 位置の移動 | スライダー | — |
| 速度 | ×1 / ×4 / ×16（×1 は1秒に1イベント） | — |

## 5. 品質ゲートの設定

- 型検査（`tsc --noEmit`）、ESLint、Vitest を CI で実行する
- カバレッジと mutation score の閾値は置かない（ADR-0002）。最初のリリースで計測する

## 承認

| 役割 | 氏名 | 日付 | 承認 |
|---|---|---|---|
| 著者 | | | ☐ |

（承認は PR のレビュー・マージで行い、ここには AI が記入しない）
