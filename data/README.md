# リプレイ用データ

J-SIX Hub の画面で再生する出来事（イベント）。方針は [ADR-0001](../docs/adr/0001-replay-event-data.md)（形式と抽出）と
[ADR-0003](../docs/adr/0003-multi-project-and-fictional-scenario.md)（複数案件と架空の案件）を参照。

| ファイル | 内容 |
|---|---|
| `projects.json` | Program（説明用の架空のまとまり）と案件の一覧 |
| `projects/<案件ID>/events.jsonl` | 案件のイベント（1行1イベント）。`tools/extract_events.py` が生成する。**直接編集しない** |
| `projects/<案件ID>/sources.json` | 抽出の対象（コミット・承認欄・セッション・証跡・ゲート失敗の履歴）。実データの案件のみ |
| `projects/<案件ID>/reconstructed.json` | 再構成イベント（手書き）。各イベントに根拠（`basis`）を書く |
| `events.schema.json` | イベントの形式（JSON Schema） |

## 案件

| 案件 | 種類 | 件数 | 出どころ |
|---|---|---|---|
| approval-workflow（申請承認ワークフロー） | 実データ | 82（実測 62 / 再構成 20） | J-SIX `examples/approval-workflow`。Git のコミットと承認欄、Claude Code のセッション記録、証跡パッケージ |
| monthly-billing（月次請求書発行） | 実データ | 46（実測 30 / 再構成 16） | J-SIX `examples/monthly-billing`。Git のコミット、ゲート失敗の履歴（`reports/gate-history.jsonl`）、証跡パッケージ |
| order-integration（受発注連携） | **架空** | 32（全件 再構成） | 複数ベンダー・Interface Contract 違反・エスカレーション・ローカル退避を説明するために作ったシナリオ |

画面は全案件のイベントを時刻順に1本にして再生する。

## 実測と再構成

すべてのイベントに `provenance` が付いている。

- **`measured`（実測）**：記録から抽出したもの。`source` の種類は次のとおり
  - `git`：J-SIX リポジトリのコミットと、コミット時点の文書の承認欄
  - `session`：Claude Code のセッション記録（著者の手元にのみある。短縮 ID を記載）
  - `report`：証跡パッケージ、ゲート失敗の履歴
- **`reconstructed`（再構成）**：記録が無いため組み立てたもの。`basis` に根拠がある。主に次のもの
  - Hub 固有の出来事（案件の登録、プロセス定義・憲法の版の固定、タスク投入）
  - 人間の承認（記録上は未承認、または AI が承認欄に書き込んでいる）
  - 逸脱とその回収（出来事は記録にあるが、Hub の逸脱として扱うのは解釈）
  - 架空の案件のすべて（根拠に「架空のシナリオ」と書く）

### 画面で見せたい統制の場面

実測のもの：
- approval-workflow：要件を足した直後、トレーサビリティ検査が「テストの無い要件」で AI の作業終了を15回止めた。AI が承認欄に承認を書き込んだ。P5 の承認前に P6 が始まった（順序違反）
- monthly-billing：AI が許可範囲外の hold-out テストを変更し、G1 スコープ検査で止められた。G3 の指摘による修正が5回続いた。要求の承認前に設計まで書かれていた（順序違反）

架空のもの（受発注連携）：
- ベンダー B の AI が他社の API 契約を変えようとして止められ、契約の所有者が却下した
- テストが続けて失敗し、担当者がローカルで直して、同じゲートを通して戻した

当時の Plugin には不具合があり（J-SIX `docs/plugin-field-test-01.md` §3）、ブロックの回数はその影響を受けている。

## セッション記録から持ち出したもの

時刻、Skill 名、サブエージェントの種類、ツール呼び出しの件数、品質ゲートの判定の各行。
プロンプト・応答・ツールの入出力の本文は含めていない。ローカルのパスとメールアドレスは除去している（`tools/tests/test_events_data.py` で検査）。

## 再生成

approval-workflow はセッション記録が必要なため、著者の手元でのみ実行できる。

```bash
git -C ../j-six fetch origin pull/4/head:refs/replay/pr-4 pull/5/head:refs/replay/pr-5 pull/18/head:refs/replay/pr-18
python3 tools/extract_events.py --jsix-repo ../j-six --sessions ~/.claude/projects/<approval-workflow の作業ディレクトリ>
python3 tools/extract_events.py ... --check   # 既存の events.jsonl と一致するか
```
