# J-SIX Hub（リプレイ型サンプル）

> **これはリプレイです。実際の AI は動作していません。** J-SIX Hub は構想段階であり、実装された製品ではありません。

J-SIX Hub は、[J-SIX](https://github.com/SeckeyJP/j-six) の工程（Phase・ゲート・証跡）を中央で管理し、AI エージェントの実行もその管理下に置くことで、複数チーム・複数ベンダーでもプロセス適合性が保たれる開発基盤の構想です。構想文書は J-SIX の [`docs/control-plane/`](https://github.com/SeckeyJP/j-six/tree/main/docs/control-plane) にあります。

本リポジトリは、この構想を説明するための **リプレイ型サンプル** です。J-SIX を実際に回した記録を、Hub の管理画面として時系列に再生します。

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
- **中央：いま起きたこと**：再生位置の出来事と、Hub が何を統制したかを平易な文で説明
- **中央：案件の状態**：Phase ボード・タスク・ゲート・承認・証跡
- **右：出来事の記録**：新しい順の一覧。凡例、統制ポイントの強調と絞り込み、各出来事の出典と根拠
- **下：再生**：再生・一時停止・1つずつの移動・速度。統制ポイントの位置をスライダー上に表示

見られる統制の例：品質ゲートが「テストの無い要件」や「許可範囲外の変更」で AI を止める／AI が書き込んだ承認を認めない／前の工程の承認前に次の工程が始まったことを順序違反として示す／他社の API 契約を破る変更を止める（架空）

## 実測と再構成

すべての出来事に **実測**（Git・Claude Code のセッション記録・証跡・ゲートの記録から抽出）か **再構成**（記録が無いため組み立てたもの）のラベルがあり、再構成には根拠を付けています。当時 Hub は存在しなかったため、Hub 固有の出来事と人間の承認の多くは再構成です。詳細は [`data/README.md`](data/README.md)、[ADR-0001](docs/adr/0001-replay-event-data.md)、[ADR-0003](docs/adr/0003-multi-project-and-fictional-scenario.md)。

## 開発

```bash
npm ci
npm run dev        # 開発サーバー
npm test           # テスト
npm run build      # dist/ に出力
```

Phase・ゲートの定義は、ビルド時に J-SIX のプロセス定義（タグ `process-v0.1.0`）を取得し、`process.lock.json` のハッシュと照合してから使います。技術スタックは [ADR-0002](docs/adr/0002-web-app-stack.md)、要求と設計は [`docs/specs/`](docs/specs/) にあります。

## ライセンス

- 本リポジトリ: [MIT](LICENSE)
- 画面に組み込む J-SIX のプロセス定義: CC BY 4.0（J-SIX, H.Sekita）
