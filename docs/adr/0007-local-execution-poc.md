# ADR-0007: 単一 PC PoC の制御処理を公開リプレイから分ける

## ステータス

提案中（要求・設計 Spec の独立レビュー前、実装前）

## 日付

2026-09-27

## コンテキスト（背景）

現行の公開 Pages は静的リプレイであり、AI の実行・承認保存・候補取込みを行わない。J-SIX 本体の[ADR-0009](https://github.com/SeckeyJP/j-six/blob/main/docs/control-plane/adr/0009-local-cli-execution-poc.md)は、同じ PC の Hub 制御プロセスがローカル Codex／Claude Code CLI を選択起動する限定的 PoC を提案した。この機能を公開 SPA に混ぜると、再構成イベントと実 run の区別や、公開環境への実行機能の混入が起きる。

## 判断（Decision）

- PoC はこのリポジトリ内のローカル TypeScript/Node 制御処理として設計し、判定ロジック、非公開 Git 記録、worktree、CLI adapter、独立検査、localhost 読取画面をモジュールとして分ける。既存の `src/replay/`、`data/events.jsonl`、公開 Pages の再生機能は変更しない。コード着手は専用[要求 Spec](../specs/local-execution-requirement-spec.md)と[Design Spec](../specs/local-execution-design-spec.md)の独立レビュー後とする。
- 正本は公開 repo とは別の、リモートを持たない非公開ローカル Git 記録先。run 専用 worktree と候補 ref は別の repo/ref に置く。許可・実行要求の保存と再読込を確認する前に CLI を起動しない。保存・反映の途中失敗は `unknown` として照合する。
- CLI は保存済み ChatGPT／`claude.ai` サブスクリプション認証を使い、API キー・Agent SDK・追加クレジットへの自動切替をしない。各 run 前に認証方式、環境、上限・課金条件を確認し、不明なら停止する。run ごとにどちらか一方を選び、モデル間の自動振分けはしない。
- 決定論的検査は worker の出力や候補側設定をそのまま採用せず、固定した方針から実行する。Hub 判定は検査結果や人間承認を自己発行しない。ローカルの確認記録を本人認証済み承認として扱わない。同一 OS ユーザーのため、権限・証跡の強い分離は未証明と表示する。

## 理由（Rationale）

最初の縦断検証に必要な実行・記録・取込みの経路を作りながら、現在公開している説明用リプレイをそのまま維持できる。ローカル Git により構想の D1 を守り、run の状態を再起動後に再構築できる。一方、同じ OS ユーザーによる試作を本番の中央統制と誤認しない範囲に限定する。

## 検討した代替案

| 案 | 利点 | 採用しない理由 |
|---|---|---|
| 公開 SPA に CLI 起動を組み込む | 画面が1つ | Pages からローカル子プロセスを安全に起動できず、リプレイと実 run を混同する |
| 別の開発者 API／SDK と DB 正本を使う | 統合と照会が容易 | サブスクリプション枠の条件と Git 正本に反する |
| 手動 CLI の結果だけをリプレイへ投入 | 既存コードの変更が少ない | Hub による投入前の許可・保存・復旧を検証できない |

## 影響（Consequences）

ローカル制御処理と公開 SPA の二つの実行経路を維持し、データ源・画面・検証を分ける必要がある。Git ref の競合・部分完了と CLI の結果不明を試験し、再送できない作用は保留する。PoC の成功は企業の実 PJ、複数ベンダー、強い隔離、性能・ROI の証拠にならない。

## 関連

- J-SIX の ADR-0001、0005〜0009、実行・判定契約 R1〜R8
- [専用要求 Spec](../specs/local-execution-requirement-spec.md)、[Design Spec](../specs/local-execution-design-spec.md)
- 既存リプレイの[要求 Spec](../specs/requirement-spec.md)、[Design Spec](../specs/design-spec.md)
