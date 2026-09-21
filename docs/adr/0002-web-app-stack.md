# ADR-0002: Web アプリは TypeScript + React + Vite の静的 SPA とし、プロセス定義はビルド時に版を指定して取り込む

## ステータス

承認

## 日付

2026-09-22

## コンテキスト（背景）

リプレイ型サンプル（J-SIX `docs/control-plane/adr/0004`）の Web アプリを作る。前提は次のとおり。

- 静的 SPA。バックエンド・DB・認証は持たない。GitHub Pages で公開する（`CLAUDE.md` のスコープ外）
- 画面は `data/events.jsonl`（[ADR-0001](0001-replay-event-data.md)）を読み、先頭 N 件を適用した状態を表示する
- Phase・ゲートの表示は J-SIX のプロセス定義（`process/jsix-process.yaml`）から生成し、ハードコードしない。版（タグ）を指定して取り込み、コピーして改変しない
- 開発は著者1名 + CC。Hub 自体を J-SIX で開発する（TDD）

## 判断（Decision）

| 項目 | 選定 |
|---|---|
| 言語 | TypeScript 6.0 系（typescript-eslint が 7 系に未対応のため） |
| UI | React 19 |
| ビルド | Vite 8（静的ファイルを出力し GitHub Pages に置く） |
| ルーティング | URL の hash（`#/...`）。ライブラリは使わない。Pages はサーバ側でのルーティングができないため |
| 状態管理 | ライブラリは使わない。リプレイの状態は純粋関数 `replay(events, process, n)` で計算する |
| テスト | Vitest + Testing Library（jsdom）。カバレッジは `@vitest/coverage-v8` |
| Lint | ESLint + typescript-eslint + react-hooks。型検査は `tsc --noEmit` |
| プロセス定義 | ビルド・テストの前にスクリプトが J-SIX のタグ `process-v0.1.0` の yaml を取得し、`process.lock.json` に記録した SHA-256 と一致することを確かめてから JSON に変換する。取得物はリポジトリにコミットしない |
| イベント | `data/events.jsonl` をビルド時に取り込む |

**構成の原則**：リプレイの計算（イベント列 → Hub の状態）は React に依存しないモジュールにし、TDD の主な対象にする。
画面は計算結果を表示するだけにする。

## 理由（Rationale）

- React は情報と実例が最も多く、記事の読者にも馴染みがある。1人で長く保守する前提に合う
- 状態を純粋関数で計算すれば、「N 件目の状態」がどう操作してそこに来たかに依らず一意になる（リプレイの前提）。単体テストも容易
- プロセス定義をハッシュで検証してから使うことで、「版を指定して取り込み、改変しない」（J-SIX ADR-0003）を機械的に保証できる
- hash ルーティングで足りる規模のため、ルーティングのライブラリは入れない

## 検討した代替案

| 代替案 | メリット | デメリット | 却下理由 |
|---|---|---|---|
| Svelte + Vite | 出力が小さい | 情報が React より少ない | 著者の判断で React を選んだ（2026-09-22） |
| フレームワークなし（素の DOM） | 依存が最小 | 画面8つ分の描画を自前で書く | 実装量が増える |
| プロセス定義を JSON に変換してコミット | ビルドにネットワークが要らない | コピーが改変されても気づきにくい | ハッシュ検証付きの取得で「改変しない」を保証する |
| 状態管理ライブラリ（Redux 等） | 慣習がある | リプレイは読み取り専用で、状態は計算で決まる | 不要 |

## 影響（Consequences）

### ポジティブな影響

- リプレイの計算を画面から独立に検証できる
- J-SIX がプロセス定義の版を上げたときは、`process.lock.json` のタグとハッシュを更新するだけで取り込める

### ネガティブな影響（トレードオフ）

- ビルドとテストに、J-SIX リポジトリ（raw.githubusercontent.com）へのネットワーク接続が要る。取得物はローカルにキャッシュする
- プロセス定義は CC BY 4.0（J-SIX）であり、本リポジトリの MIT とは異なる。公開サイトに組み込むため、画面に出典（J-SIX、CC BY 4.0、版）を表示する

### 将来の注意事項

- カバレッジと mutation score の閾値は置かない。最初のリリースで計測してから決め、別の ADR にする（J-SIX と同じく、根拠のない数値を固定しない）
- TypeScript 7 系への移行は typescript-eslint の対応を待つ

## 関連

- [ADR-0001](0001-replay-event-data.md)（リプレイ用イベント）
- J-SIX `docs/control-plane/adr/0003-dependency-direction-and-process-as-data.md`
- J-SIX `process/README.md`（版と参照のしかた）
