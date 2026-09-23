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
| approval-workflow（申請承認ワークフロー） | 実データ | 86（実測 66 / 再構成 20） | J-SIX `examples/approval-workflow`。Git のコミットと承認欄、Claude Code のセッション記録、証跡パッケージ |
| monthly-billing（月次請求書発行） | 実データ | 50（実測 34 / 再構成 16） | J-SIX `examples/monthly-billing`。Git のコミット、ゲート失敗の履歴（`reports/gate-history.jsonl`）、証跡パッケージ |
| order-integration（受発注連携） | **架空** | 40（全件 再構成） | 複数ベンダー・Interface Contract 違反・エスカレーション・ローカル退避を説明するために作ったシナリオ |

画面は全案件のイベントを時刻順に1本にして再生する。

## 実測と再構成

すべてのイベントに `provenance` が付いている。

- **`measured`（実測）**：記録から抽出したもの。`source` の種類は次のとおり
  - `git`：J-SIX リポジトリのコミットと、コミット時点の文書の承認欄
  - `session`：Claude Code のセッション記録（著者の手元にのみある。短縮 ID を記載）
  - `report`：証跡パッケージ、ゲート失敗の履歴
- **`reconstructed`（再構成）**：記録が無いため組み立てたもの。`basis` に根拠がある。主に次のもの
  - Hub 固有の出来事（案件の登録、プロセス定義・憲法の版の固定、タスク投入）
  - 人間の承認（本人の承認操作・時刻が確認できない記録を補完）
  - 逸脱とその回収（出来事は記録にあるが、Hub の逸脱として扱うのは解釈）
  - 架空の案件のすべて（根拠に「架空のシナリオ」と書く）

### 画面で見せたい統制の場面

元記録から抽出したもの（当時 Hub は動作していない）：

- approval-workflow：要求の追加、承認欄の記載、トレーサビリティ検査による作業終了のブロック15回。承認欄の主体を AI とする属性は抽出時の補足情報であり、認証された操作記録ではない。
- monthly-billing：G1 スコープ検査が許可範囲外の hold-out テストへの変更を指摘した記録、G3 の再判定要求の記録。変更主体や各指摘後の修正成功は、これらの記録だけでは断定しない。

再生モデル上の解釈・構想：

- 要件とテストの対応、承認の有効性、Phase の順序判定はイベント列と固定したプロセス定義から計算する。
- P5 承認前の P6 開始などの判定には再構成した人間承認の時刻が含まれる。実際に無承認で作業したことの証明ではない。
- 「構想」と付いた説明は将来の Hub が想定する動作であり、元の開発で Hub が実施した統制ではない。

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


## 例外の開始と終了

新しい `deviation.closed` には `payload.opened_by` で開始イベントの ID を指定する。
開始・終了の種類、task、iteration が一致し、開始が未終了である場合だけ適用する。
開始時のタスク投入イベントを実行の識別子として保持するため、同じタスク ID の再投入と区別できる。
参照のない既存データは同じ種類・タスク・周・実行で未終了の候補が一意の場合だけ対応付ける。
曖昧な終了や二重終了を別の開始へ割り当てない。収録済み生成物を直接編集する必要はない。
詳細は [ADR-0004](../docs/adr/0004-deviation-correlation.md) を参照。

## 公開済みの実物へのリンク

`artifact-links.json` は公開 Git の実物への索引（生成物、直接編集しない）。
元ファイルの本文は転載しない。方針は [ADR-0005](../docs/adr/0005-public-artifact-links.md)。
仕様・コード・テストなどは固定コミットで参照する。親コミットの仕様・タスク定義は「参考（作業前）」であり、AI の実際の入力とは断定しない。
元のセッション記録やレポートの実ファイルは公開が確認できていないためリンクしない。
公開された抽出結果が存在しても、元ファイルが公開されているとは限らない。

```bash
# 上記の PR 履歴を fetch 済みの J-SIX を指定する。生成時は gh の API で公開を確認する。
python3 tools/build_artifact_links.py --jsix-repo ../j-six
# ローカルの Git から再計算して照合する（公開 API の再検証はしない）
python3 tools/build_artifact_links.py --jsix-repo ../j-six --check
```

CI の Python テストは、索引が現在のイベント列と一致すること、架空案件にリンクがないことを検査する。
再生成には非公開セッションは不要。リンク先の将来の削除までは保証しない。
