# J-SIX Hub（リプレイ型サンプル）

> **これはリプレイです。実際の AI は動作していません。** J-SIX Hub は構想段階であり、実装された製品ではありません。

J-SIX Hub は、[J-SIX](https://github.com/SeckeyJP/j-six) の工程（Phase・ゲート・証跡）を中央で管理し、AI エージェントの実行もその管理下に置くことで、複数チーム・複数ベンダーでもプロセス適合性が保たれる開発基盤の構想です。構想文書は J-SIX の [`docs/control-plane/`](https://github.com/SeckeyJP/j-six/tree/main/docs/control-plane) にあります。

本リポジトリは、この構想を説明するための **リプレイ型サンプル** です。J-SIX を実際に回した記録を、Hub の管理画面として時系列に再生します。

この公開リプレイとは別に、単一 PC の中央実行型 PoC を段階的に構築しています。[単一runの要求](docs/specs/local-execution-requirement-spec.md)・[設計](docs/specs/local-execution-design-spec.md)・[ADR](docs/adr/0007-local-execution-poc.md)と、[全工程の要求](docs/specs/developer-journey-requirement-spec.md)・[設計](docs/specs/developer-journey-design-spec.md)・[ADR](docs/adr/0008-developer-workbench.md)に基づき、固定process・非公開Git台帳・成果物照合と、**Phase 0〜6の合成案件 dry run を行う localhost 開発者画面／中央監視／書込API**を実装しています。P4 の候補生成は固定 fake adapter、または subscription 認証の Codex／Claude Code CLI adapter で行い、G1/G2 と P5 の検査はHubがローカルで実行します。CLI adapter は実装済みですが、実CLIによる成功実証は未達です。公開ページは引き続きAIを動かさず、企業の実案件への適用も対象外です。

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

Node 22以上とGitを使用します。初回に次を実行します。`.local-poc/` はGit除外のローカル保存先で、`poc:init` は既存の合成repoを上書きしません。既に初期化済みなら `--name` で新しい案件用fixtureを作れます。

```bash
npm ci
npm run poc:init
npm run poc:dev -- --config .local-poc/config.json
# 既存の .local-poc がある場合の新規一巡
npm run poc:init -- --name journey-1
npm run poc:dev -- --config .local-poc/config-journey-1.json
# subscription CLI adapterも固定する場合（合成fixture限定）
npm run poc:init -- --name cli-journey --enable-cli
npm run poc:dev -- --config .local-poc/config-cli-journey.json
```

表示された `http://127.0.0.1:<port>` を開きます。案件作成後、P0〜P3 の合成文書を順に提出し、審査要求とローカル模擬判断を記録します。相対pathと SHA-256 は対象 Git commit から画面に候補が表示されます。P4 は固定合成 TDD runを実行し、候補差分、TDD commit、15件の検査結果と実出力を確認してから候補を受け入れます。受入れ時には検査証跡本文を `docs/check-evidence.json`、その参照と要約を `docs/evidence-pack.json` に保存します。承認済み候補と異なる成果物の再提出ではP4を通過できません。P5 は要求入口から承認方針へ結線するシナリオを実行し、入口モジュール・結合テスト・実行出力・品質指標のpath/hashを固定して品質記録を提出します。これらが現在版から欠落・変更した場合はP6の納品・完了を保留します。P6 は逆生成文書を作成・提出して完了を記録します。各Phaseの不足理由と中央監視の履歴を確認してください。模擬判断は**単一利用者のローカル模擬**で、正式な顧客承認ではありません。

`--enable-cli` は、このMacの固定されたCodex／Claude Code実行ファイル、マシン共通Hookと信頼設定のhashをローカル設定へ記録します。P4で各workloadの直前に、account画面でsubscription利用枠があり追加クレジット／extra usageを使わないことを確認してから、provider別の単回確認を記録します。不明ならCLIを起動しません。初回上限は各providerにつき読取smoke 1回と小さな合成編集1回で、失敗しても同じ案件世代で再試行しません。読取smokeは副作用のない `git config --list` が共通Hookで拒否されることを実sessionで確認します。編集時はhold-outをsparse checkoutから外し、候補生成後に復元してHubが検査します。同じOSユーザーからの強い秘匿やsubscription請求の技術的保証を意味しません。Hub再起動で結果が未確定になったrunや停止未確認のrunは、Hubが記録pidの不在、対象repoの無変更、残存worktreeを照合し、操作者が停止と外部作用の確認・理由を入力した場合だけ復旧記録を追記します。履歴は消さず、そのrunの世代は差戻しが必要です。

非公開台帳と合成repoは `.local-poc/` 内で分離され、サーバーは127.0.0.1だけにbindします。対象repoは設定済みのfixture IDから選び、ブラウザから任意のディレクトリを指定できません。CLIのbounded eventログは台帳外の `ledger*/private-runs/<run-id>/events.log` にmode 0600で保存し、7日後または案件削除時に運用者が削除します。削除後や欠落時はhashだけで内容を再検証できないため、証跡状態を `unknown` として候補を再利用しません。自動削除処理はこのPoCでは未実装です。G1のSAST・依存検査は固定合成題材に限る限定チェックで、汎用スキャナ相当ではありません。G3 は方針に従う明示省略であり PASS ではなく最大 L3、企業の受入試験・顧客検収は未検証です。既存のリプレイ画面とデータはこのローカル画面には接続しません。

Phase・ゲートの定義は、ビルド時に J-SIX のプロセス定義（固定commit `1101258e5aec249273fcc5d546db0341d456e1be`）を取得し、`process.lock.json` のハッシュと照合してから使います。技術スタックは [ADR-0002](docs/adr/0002-web-app-stack.md)、台帳形式は [ADR-0009](docs/adr/0009-local-git-ledger.md)、要求と設計は [`docs/specs/`](docs/specs/) にあります。

## ライセンス

- 本リポジトリ: [MIT](LICENSE)
- 画面に組み込む J-SIX のプロセス定義: CC BY 4.0（J-SIX, H.Sekita）
