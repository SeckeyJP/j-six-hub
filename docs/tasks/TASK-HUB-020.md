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

## 2026-09-29 検証記録

- 実装・fake adapter検証: `typecheck`、`lint`、`build`、localhost待受と長時間service統合を除く40ファイル302テストが通過した。CLIの単回確認、失敗時再試行禁止、非公開ログhash、hold-outを外したGreen実行、15検査、証跡欠落時の `evidence_unknown` をservice統合テスト1件（他7件skip）で通過確認した。
- Codex実session: ChatGPT認証、固定CLI、禁止環境変数なし、共通制御hash一致を確認後、読取smokeを1回だけ要求・起動した。管理サンドボックス内でCodex app-server初期化が `Operation not permitted` となり `failed`。同一案件世代では再試行せず、編集runも起動していない。
- Claude Code実session: 利用者はsubscription枠と追加クレジット不使用を確認したが、CLIの `auth status` が未ログインだったためpreflightで `subscription-auth-unconfirmed` とし、要求保存・process起動とも0件にした。
- 環境制約: この検証セッションではlocalhost待受も `EPERM` のため、HTTP境界テストと今回の画面再起動は未実行。直前の同一版ではP4画面と中央モニタをブラウザ確認済みだが、実CLI成功を示すものではない。

したがって、実装と合成検査経路は検証済みだが、AC-LE-02の「両CLIのsubscriptionログインによる読取smoke成功」と実編集runは未達である。通常のローカル端末でClaude Codeへ再ログインし、各providerに新しい案件世代またはfixtureを用意した上で、別のレビュー済み検証計画として実施する。
