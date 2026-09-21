# J-SIX Hub（リプレイ型サンプル）

> **これはリプレイです。実際の AI は動作していません。** J-SIX Hub は構想段階であり、実装された製品ではありません。

J-SIX Hub は、[J-SIX](https://github.com/SeckeyJP/j-six) の工程（Phase・ゲート・証跡）を中央で管理し、AI エージェントの実行もその管理下に置くことで、複数チーム・複数ベンダーでもプロセス適合性が保たれる開発基盤の構想です。構想文書は J-SIX の [`docs/control-plane/`](https://github.com/SeckeyJP/j-six/tree/main/docs/control-plane) にあります。

本リポジトリは、この構想を説明するための **リプレイ型サンプル** です。J-SIX を実際に一周した記録（`examples/approval-workflow`）を、Hub の管理画面として時系列に再生します。

**公開ページ**: https://seckeyjp.github.io/j-six-hub/

## 見られるもの

- Phase ボード：Phase ごとの状態とゲート。前の Phase の承認前に後の Phase が始まった場合は順序違反として表示
- タスク：TDD の工程（hold-out → Red → Green → Refactor）と、担当したサブエージェント
- ゲート：品質ゲートの判定。Spec に要件を足した直後、テストの無い要件を理由に AI の作業終了が 15 回止められた記録など
- 承認：AI が承認欄に書き込んだ承認は無効として扱う
- 証跡：証跡パッケージの生成結果と、J-SIX リポジトリの該当ファイルへのリンク

## 実測と再構成

すべてのイベントに **実測**（Git・Claude Code のセッション記録・証跡パッケージから抽出）か **再構成**（記録が無いため組み立てたもの）のラベルがあり、再構成には根拠を付けています。当時 Hub は存在しなかったため、Hub 固有の出来事と人間の承認の多くは再構成です。詳細は [`data/README.md`](data/README.md) と [ADR-0001](docs/adr/0001-replay-event-data.md)。

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
