# J-SIX Hub（リプレイ型サンプル）

> **これはリプレイです。実際の AI は動作していません。** J-SIX Hub は構想段階であり、実装された製品ではありません。

J-SIX Hub は、[J-SIX](https://github.com/SeckeyJP/j-six) の工程（Phase・ゲート・証跡）を中央で管理し、AI エージェントの実行もその管理下に置くことで、複数チーム・複数ベンダーでもプロセス適合性が保たれる開発基盤の構想です。構想文書は J-SIX の [`docs/control-plane/`](https://github.com/SeckeyJP/j-six/tree/main/docs/control-plane) にあります。

本リポジトリは、この構想を説明するための **リプレイ型サンプル** です。J-SIX を実際に回した記録を、Hub の管理画面として時系列に再生します。

この公開リプレイとは別に、単一 PC の中央実行型 PoC を段階的に構築しています。[単一runの要求](docs/specs/local-execution-requirement-spec.md)・[設計](docs/specs/local-execution-design-spec.md)・[ADR](docs/adr/0007-local-execution-poc.md)と、[全工程の要求](docs/specs/developer-journey-requirement-spec.md)・[設計](docs/specs/developer-journey-design-spec.md)・[ADR](docs/adr/0008-developer-workbench.md)に基づき、固定process・非公開Git台帳・成果物照合と、**Phase 0〜3のlocalhost開発者画面／中央監視／書込API**を実装しています。Phase 4のCodex／Claude Code CLI、実検査、Phase 5〜6の完了操作と全工程一巡は未実装です。公開ページは引き続きAIを動かさず、企業の実案件への適用も対象外です。

**公開ページ**: https://seckeyjp.github.io/j-six-hub/ （初回はガイドツアーが始まります。上部の「ガイド」でいつでも開き直せます）

## 案件

| 案件 | 種類 |
|---|---|
| 申請承認ワークフロー | 実データ（J-SIX `examples/approval-workflow`） |
| 月次請求書発行 | 実データ（J-SIX `examples/monthly-billing`） |
| 受発注連携 | **架空**（複数ベンダー・Interface Contract を説明するためのシナリオ） |

3件を束ねる Program も説明用の架空のまとまりです。3件の出来事は、起きた順に1本の時間軸で再生されます。

## 画面

- **左：案件の管理**：案件ごとの工程（Phase）の進み具合と、統制が働いた回数
- **中央：いま起きたこと**：再生位置の出来事と、再生モデル上の解釈・構想で想定する動作を平易な文で説明
- **中央：案件の状態**：Phase ボード・要求（REQ / PROP）・タスク・ゲート・承認・トレーサビリティ・証跡
- **右：出来事の記録**：新しい順の一覧。凡例、統制ポイントの強調と絞り込み、各出来事の出典と根拠
- **下：再生**：再生・一時停止・1つずつの移動・速度。統制ポイントの位置をスライダー上に表示

元記録の検査停止・未達、再生モデル上の承認・順序判定、架空案件で想定する契約違反の回収を見られます。当時 Hub は動作していません。イベントの「実測／再構成」と、説明欄の「解釈・構想」は別の区分です。承認時刻には再構成が含まれるため、順序判定を実際の無承認の証明として扱いません。詳しくは [データの根拠と限界](data/README.md#実測と再構成) を参照してください。

## 実測と再構成

すべての出来事に **実測**（Git・Claude Code のセッション記録・証跡・ゲートの記録から抽出）か **再構成**（記録が無いため組み立てたもの）のラベルがあり、再構成には根拠を付けています。当時 Hub は存在しなかったため、Hub 固有の出来事と人間の承認の多くは再構成です。詳細は [`data/README.md`](data/README.md)、[ADR-0001](docs/adr/0001-replay-event-data.md)、[ADR-0003](docs/adr/0003-multi-project-and-fictional-scenario.md)。

## 開発

```bash
npm ci
npm run dev        # 開発サーバー
npm test           # テスト
npm run poc:test   # ローカルPoCの工程・台帳・API境界のテスト
npm run build      # dist/ に出力
```

## ローカル開発者ワークベンチ（合成案件のみ）

Node 22以上とGitを使用します。初回に次を実行します。`.local-poc/` はGit除外のローカル保存先で、`poc:init` は既存の保存先を上書きしません。

```bash
npm ci
npm run poc:init
npm run poc:dev -- --config .local-poc/config.json
```

表示された `http://127.0.0.1:<port>` を開きます。案件作成後、外部エディタで `.local-poc/synthetic-project` の成果物を作成・コミットし、ブラウザへGit commit内の相対pathとファイル内容SHA-256を提出します。例えば `git -C .local-poc/synthetic-project show HEAD:CLAUDE.md | shasum -a 256` でP0のhashを確認できます。各Phaseの必要な成果物と不足理由は画面に表示します。審査・判断は**単一利用者のローカル模擬**です。判断の対象commit、世代、台帳refを確認して進めてください。

非公開台帳と合成repoは `.local-poc/` 内で分離され、サーバーは127.0.0.1だけにbindします。対象repoは設定済みのfixture IDから選び、ブラウザから任意のディレクトリを指定できません。P3からP4までは進めますが、P4のCLI・品質ゲートが未実装のため、そこで停止します。既存のリプレイ画面とデータはこのローカル画面には接続しません。

Phase・ゲートの定義は、ビルド時に J-SIX のプロセス定義（固定commit `1101258e5aec249273fcc5d546db0341d456e1be`）を取得し、`process.lock.json` のハッシュと照合してから使います。技術スタックは [ADR-0002](docs/adr/0002-web-app-stack.md)、台帳形式は [ADR-0009](docs/adr/0009-local-git-ledger.md)、要求と設計は [`docs/specs/`](docs/specs/) にあります。

## ライセンス

- 本リポジトリ: [MIT](LICENSE)
- 画面に組み込む J-SIX のプロセス定義: CC BY 4.0（J-SIX, H.Sekita）
