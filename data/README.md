# リプレイ用データ

J-SIX の `examples/approval-workflow`（申請承認ワークフロー）の実行記録を、Hub の画面で再生するためのイベント列。
方針は [ADR-0001](../docs/adr/0001-replay-event-data.md) を参照。

| ファイル | 内容 |
|---|---|
| `events.jsonl` | イベント列（1行1イベント、再生順）。`tools/extract_events.py` が生成する。**直接編集しない** |
| `events.schema.json` | イベントの形式（JSON Schema） |
| `sources.json` | 抽出の対象（コミット・承認欄・セッション・証跡パッケージ） |
| `reconstructed.json` | 再構成イベント（手書き）。各イベントに根拠（`basis`）を書く |

## 実測と再構成

すべてのイベントに `provenance` が付いている。

- **`measured`（実測）**：記録から抽出したもの。出どころは `source` にある
  - `git`：J-SIX リポジトリのコミットと、コミット時点の文書の承認欄
  - `session`：Claude Code のセッション記録（著者の手元にのみある。短縮 ID を記載）
  - `report`：`reports/evidence/` の証跡パッケージ
- **`reconstructed`（再構成）**：記録が無いため組み立てたもの。`basis` に根拠がある。主に次のもの
  - Hub 固有の出来事（案件の登録、プロセス定義・憲法の版の固定、タスク投入）。当時 Hub は存在しなかった
  - 人間の承認。記録上は未承認、または AI が承認欄に書き込んでいる
  - 逸脱とその回収（Phase 逆戻り、エスカレーション）。出来事は記録にあるが、Hub の逸脱として扱うのは解釈である

## 内容

| 一周 | 期間 | 記録の細かさ |
|---|---|---|
| 2026-06 初版 | 2026-06-15 | squash された1コミットだけ。Phase ごとの時刻は無く、同じ時刻に並ぶイベントの順序は Phase の順に並べた。品質ゲート G1〜G4（J-SIX v2.1）より前なので、ゲートの判定記録は無い |
| 2026-09 変更対応 | 2026-09-19 | Skill 7本の実行。設計レビュー → Spec 改訂 → TASK-AW-002 の TDD（hold-out / Red / Green / Refactor）→ 証跡 → トレーサビリティ → 品質メトリクス → 逆生成。時刻はコミットとセッション記録から実測 |

含めていないもの：2026-09-10 の mutation testing と性質テストの追加（ケーススタディ #2）、2026-09-19 午前の非機能要件の書式移行、
Plugin 本体の修正コミット、Plugin の読み込みに失敗した実行（成果物は破棄された）。

### 画面で見せたい統制の場面（いずれも実測）

- Spec に REQ-011/012・PROP-007〜009 を追加した直後、トレーサビリティ検査が「テストの無い要件」で AI の作業終了を15回止めた
- AI が要求 Spec・Design Spec の承認欄に承認を書き込んだ（Hub では人間の承認として受け付けない）
- TDD の各工程が別のサブエージェント（hold-out・Red・Green・Refactor・scope-judge）で実行された
- ドキュメントの変更で G3 の判定が古くなり、ゲートが再判定を求めた

いずれも当時の Plugin の不具合（J-SIX `docs/plugin-field-test-01.md` §3）を含む記録であり、ブロックの回数は不具合の影響を受けている。

## セッション記録から持ち出したもの

時刻、Skill 名、サブエージェントの種類、ツール呼び出しの件数、品質ゲートの判定の各行。
プロンプト・応答・ツールの入出力の本文は含めていない。ローカルのパスとメールアドレスは除去している（`tools/tests/test_events_data.py` で検査）。

## 再生成

セッション記録が必要なため、著者の手元でのみ実行できる。

```bash
git -C ../j-six fetch origin pull/5/head:refs/replay/pr-5
python3 tools/extract_events.py --jsix-repo ../j-six --sessions ~/.claude/projects/<approval-workflow の作業ディレクトリ>
python3 tools/extract_events.py ... --check   # 既存の events.jsonl と一致するか
```
