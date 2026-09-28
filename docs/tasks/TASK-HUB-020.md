# TASK-HUB-020: subscription CLIを使う中央実行adapter

**要件**: REQ-LE-001〜007、AC-LE-02〜06、REQ-JR-003、007、009、013

**出どころ**: 親workspace WS-024。単一PC・公開合成fixture限定。

## 受入条件

- CodexはChatGPT、Claude Codeはclaude.ai subscription認証だけを各workload直前に確認し、API key・代替provider・課金条件不明・Hook不成立ではspawnしない
- 各providerの初回上限を読取smoke 1回＋編集1回に固定し、失敗を再試行やfake結果へ置換しない
- Hub固定のhold-out／Red、CLI Green、Hubの `no_change` Refactor checkpointを実commitと検査結果へ結び付ける
- 要求保存後にshellを介さず専用worktreeで起動し、boundedな非公開ログとhash、状態、停止理由を台帳・画面から追跡できる
- 既存fake経路、15検査、候補受入れ、localhost境界、公開リプレイ分離を維持する

## 変更許可範囲

- `scripts/poc/**`
- `poc-ui/**`
- `README.md`
- `docs/tasks/**`

## 対象外

- 企業実案件、正式承認、強いOS分離、課金設定の独立な技術証明、公開リプレイへの実ログ混入
