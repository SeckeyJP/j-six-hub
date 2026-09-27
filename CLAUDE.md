# CLAUDE.md — J-SIX Hub

> このファイルは Claude Code がセッション開始時に自動読込するプロジェクト憲法です。
> J-SIX (Japanese SI Transformation) プロセスに基づいています。
> J-SIX の `templates/claude-md/base.md` と `web-app.md` から作成しました。
> Hub 自体を J-SIX で開発し、その記録をケーススタディにします（J-SIX `docs/control-plane/` の ADR を参照）。現行の公開物はリプレイ型サンプルです。別に、単一 PC の中央実行型 PoC と開発者が Phase 0〜6 を進めるローカル画面を設計していますが、まだ実装していません。

---

## プロジェクト概要

- **システム名**: J-SIX Hub（公開リプレイ型サンプル／未実装の単一 PC 中央実行・全工程 PoC）
- **目的**: 公開リプレイは J-SIX 実行記録を再生して構想を説明する。単一 PC PoC は、開発者が合成案件を Phase 0〜6 まで進め、Hub が成果物・ゲート・AI 投入と受入れを管理する設計を検証する
- **主要ステークホルダー**: 著者（H.Sekita / GitHub: SeckeyJP）、記事・論文の読者
- **開発体制**: 著者1名 + AI 開発支援。PoC の作業 CLI は run ごとに Codex／Claude Code の一方を選ぶ
- **J-SIX Stage**: Stage 3（J-SIX）
- **ライセンス**: MIT（J-SIX 本体は CC BY 4.0。ライセンスが違うので J-SIX の文書をこのリポジトリへ転載しない）

### 技術スタック

- **公開リプレイの構成**: 静的 SPA、バックエンドなし、GitHub Pages で公開
- **単一 PC PoC の構成**: ローカル制御プロセス、非公開 Git 記録先、作業用 worktree、CLI adapter、独立検査、localhost 開発者ワークベンチ・中央監視を設計中。公開 Pages に実行機能を載せない
- **言語・フレームワーク・テストツール**: TypeScript 6.0 / React 19 / Vite 8 / Vitest + Testing Library（[ADR-0002](docs/adr/0002-web-app-stack.md)）
- **DB**: リプレイはなし（`data/events.jsonl` を読み込む）。PoC の正本も非公開のローカル Git とし、別 DB 正本を作らない
- **CI/CD**: GitHub Actions

### 主要ドキュメントの場所

- リプレイ要求／Design Spec: `docs/specs/requirement-spec.md`、`docs/specs/design-spec.md`
- 単一 PC PoC 要求／Design Spec: `docs/specs/local-execution-requirement-spec.md`、`docs/specs/local-execution-design-spec.md`。独立レビュー後にコード着手
- 全工程の開発者体験: `docs/specs/developer-journey-requirement-spec.md`、`docs/specs/developer-journey-design-spec.md`、`docs/adr/0008-developer-workbench.md`。単一runのSpecに追加する未実装の設計。これらも独立レビュー・gate通過後にコード着手
- ADR（Hub 固有）: `docs/adr/`
- 構想・決定事項（D1〜D9）: J-SIX リポジトリ `docs/control-plane/`
- リプレイ用データ: `data/`（M3 で作成）
- プロセス定義: J-SIX リポジトリ `process/jsix-process.yaml` を **タグまたはコミット SHA を指定して** 取り込む

---

## ビルド・テスト・実行コマンド

```bash
# リプレイ用データの抽出スクリプト（Python 3.9 以上・標準ライブラリのみ。docs/adr/0001）
python3 -m pip install jsonschema pytest     # テスト用
python3 -m pytest tools/tests -q              # 抽出スクリプトとデータの検査
python3 tools/extract_events.py --jsix-repo ../j-six --sessions <セッション記録のディレクトリ>   # 再生成（著者の手元のみ）
python3 tools/extract_events.py --jsix-repo ../j-six --project monthly-billing  # 公開元記録だけの案件
python3 tools/extract_events.py --jsix-repo ../j-six --refresh-evidence        # 私的セッションを再抽出せず report イベントだけ更新

# Web アプリ（TypeScript + React + Vite。docs/adr/0002）
npm ci                 # 依存インストール
npm run dev            # 開発サーバー
npm test               # Vitest（事前に固定版のプロセス定義を取得・検証する）
npm run typecheck      # 型検査
npm run lint           # ESLint
npm run build          # dist/ に静的ファイルを出力
```

> **重要**: テストは必ず実行して通ることを確認してからコミットすること。
> 上記は現行リプレイのコマンド。単一 PC PoC の実行器と試験コマンドは未実装であり、専用 Spec と ADR のレビュー後に追加する。

---

## 変えてはいけない決定事項

J-SIX `docs/control-plane/adr/` の ADR に従う。変更が必要だと考えた場合は、実装前に人間に提案すること。特に以下を守る。

- **正本は Git**。Hub が持つのは Git から再構築できる状態・承認記録・索引だけ
- **J-SIX は Hub に依存しない**。依存は Hub → J-SIX の一方向のみ
- **`jsix-process.yaml` をコピーして独自に改変しない**。Phase・ゲートの表示は yaml から生成し、ハードコードしない
- **公開リプレイであることを全画面に常時表示する**（「リプレイ（実際の AI は動作していません）」）。PoC の画面・データ源と混同しない
- **ローカルPoCの開発者ワークベンチと中央監視を公開リプレイから分離する**。開発者の提出・模擬判断はHubの書込APIを経由し、同じGit台帳から投影する。単一利用者の模擬操作を正式な顧客承認と呼ばない
- **リプレイの全イベントに provenance（`measured` 実測 / `reconstructed` 再構成）を付け、画面にも表示する**。PoC 実行イベントには実行経路・未検証範囲を別に記録する
- 架空シナリオを作る場合は全イベントを `reconstructed` とし、画面上でも架空と明示する（受発注連携と Program。docs/adr/0003）
- **単一 PC PoC のみ** J-SIX の[ADR-0009](https://github.com/SeckeyJP/j-six/blob/main/docs/control-plane/adr/0009-local-cli-execution-poc.md)に従う。Codex または Claude Code CLI のサブスクリプション認証を run ごとに使い、API キー・SDK・従量課金への自動切替をしない。Git に許可と実行要求を保存確認する前に起動しない。同一 OS ユーザーによる強い権限分離や承認の真正性を主張しない

---

## スコープ外

以下は公開リプレイでは作らない。単一 PC PoC の実行機能・開発者操作画面は、それぞれの専用要求／Design Spec と ADR の独立レビューを通過してから着手する。

- 公開ページからの実際の AI 実行
- 独自の認証・権限管理、マルチテナント、複数ベンダー運用
- 公開リプレイ用のデータベース・バックエンドサーバ
- 画面上での編集機能（閲覧とリプレイのみ）
- 閉域・Bedrock / Vertex 対応

単一 PC PoC でも開発者 API キー／Agent SDK を使った実行、企業の実 PJ データ、無人の継続運用、同一 PC の全 CLI 操作を Hub が強制管理するという主張は対象外。

---

## コーディング規約

- コメント: 「何をしているか」ではなく「なぜそうしているか」を書く
- 1関数 30行・引数4つを目安。超える場合は分割を検討
- 例外は握りつぶさない
- 命名: ファイルは kebab-case（React コンポーネントは PascalCase）、関数・変数は camelCase、型は PascalCase。インデントはスペース2

### 画面

- セマンティック HTML を優先する。キーボード操作に対応する
- 公開リプレイ画面は閲覧専用。状態は「先頭から N 番目までのイベントを適用した結果」として計算し、画面側に状態を持ち込まない
- リプレイの計算は `src/replay/`（React に依存しない純粋関数）、表示は `src/ui/`。状態管理・ルーティングのライブラリは使わない（hash ルーティング）

---

## ディレクトリ構成

```
.
├── CLAUDE.md
├── README.md
├── LICENSE
├── data/            # リプレイ用データ。projects.json（Program と案件）と projects/<案件ID>/（events.jsonl は生成物。直接編集しない）
├── tools/           # 抽出スクリプトとテスト
└── docs/
    ├── adr/         # Hub 固有の ADR
    └── specs/       # 要求 Spec / Design Spec（M4）
```

> 新規ファイルを作成する場合は、上記の構成に従うこと。不明な場合は確認を求めること。

---

## Git 運用ルール

- **main**: 公開用。直接コミットしない。`feature/xxx` / `fix/xxx` から PR で入れる
- コミットメッセージは Conventional Commits（`feat` / `fix` / `docs` / `test` / `refactor` / `chore`）
- TDD では Red（テスト追加）→ Green（実装）→ Refactor でそれぞれコミットする

---

## 品質基準

- 新規コードは TDD で書く。カバレッジ目標・mutation score の閾値は技術スタックの ADR で決める（J-SIX と同じく、根拠のない数値を置かない）
- Lint エラーはコミット前に解消する

---

## 文書・公開物のルール

- **推定は推定と明記する**。効果の数値を主張しない。構想段階の内容は「仮説」として書く
- **盛らない**。存在しない実績や未実装の機能を、実装済みのように README 等に書かない
- 出典は検証可能なものだけ。未確認の書誌情報は「要確認」と明記する
- **勤務先・所属は書かない**（公開するかは著者の判断待ち）

---

## ADR ルール

- 技術スタック・ライブラリの選定、データ形式の決定、代替案を検討して却下した場合は ADR を書く
- `docs/adr/NNNN-タイトル.md` に、J-SIX の `templates/adr/template.md` の形式で作成する

---

## セキュリティ・禁止事項

- 機密情報（API キー等）をソースコードに書かない。`.env` をコミットしない
- リプレイ用データに、CC セッション記録から個人情報・秘密情報・ローカルの絶対パスを持ち込まない。持ち出してよい項目は docs/adr/0001 に限る

### 変更禁止ファイル

- `LICENSE`

---

## CC 自律実行の範囲

- テストを先に書き、失敗を確認してからコミットする
- テストが通る最小の実装にする。先回りの実装はしない
- テストが3回連続で失敗したら人間に相談する
- 要求 Spec にない要件が必要になった場合、上記の決定事項に反しそうな場合、スコープ外に踏み込みそうな場合は、止めて人間に確認する
