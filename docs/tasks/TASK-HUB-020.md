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

- 実装・fake adapter検証: provider別JSONL終端schemaと構造化Hook拒否、固定allowlist環境、有限の強制停止、全案件共通dispatch slot、request/claim/start/finish台帳、正規化manifest、P6証跡再照合、G1成功後だけの `no_change` 判定を実装した。
- 停止境界: 直接のCLI processが先に終了してもprocess groupの強制停止と残存確認を続ける。共通指示書とHook起動スクリプトも各preflightのhash照合対象とし、画面の取消操作はローカルprocessを確認できる `started` 状態だけに表示する。
- 完了境界: 正常終了した直接processが子孫を残した場合も停止・残存確認を終えるまで枠を解放しない。smokeは固定JSON結果を検証し、保存する合算UTF-8ログと同じ内容をhash化する。再起動後の未照合runは `unknown` として投影する。
- 検査境界: 候補実行の前後で可視テスト・hold-outのhashとclean treeを照合し、実行時改変を拒否する。version/auth補助processもtimeout・cancel・出力超過・停止未確認のない正常終了だけをpreflight成功とする。
- smoke境界: 未コミット差分だけでなく対象HEADの変更も拒否する。画面は実行状態・証跡欠落を区別し、正規化した停止理由を表示する。
- 補助process・空ログ境界: version/authの停止未確認を全案件共通の `stop_unconfirmed` へ伝播し、回収したprocess結果は空出力でもmode 0600のログを保存する。
- 検査完了境界: coverage・hold-out実行後にも保護テストhashとclean treeを再照合する。CLIの成功終端はイベント列の末尾に限定し、終端後に始まる未完了turnを拒否する。
- `typecheck`、`lint`、`build` が通過した。service/server以外41ファイル330件が通過した。再起動後の状態回帰とsmoke中commit拒否は各対象1件が通過し、他のserviceテストは各実行でskipした。
- 条件付きcoverageは修正前のservice/server除外結果で statements 63.22%、branches 52.34%、functions 68.98%、lines 64.32%。除外したservice/serverを0%として含むため、プロジェクト品質閾値には使わない。対象を含むserviceテスト結果を別に記録する。
- Codex実session: ChatGPT認証、固定CLI、禁止環境変数なし、共通制御hash一致を確認後、読取smokeを1回だけ要求・起動した。管理サンドボックス内でCodex app-server初期化が `Operation not permitted` となり `failed`。同一案件世代では再試行せず、編集runも起動していない。
- Claude Code実session: 利用者はsubscription枠と追加クレジット不使用を確認したが、CLIの `auth status` が未ログインだったためpreflightで `subscription-auth-unconfirmed` とし、要求保存・process起動とも0件にした。
- 環境制約: この検証セッションではlocalhost待受も `EPERM` のため、HTTP境界テストと今回の画面再起動は未実行。直前の同一版ではP4画面と中央モニタをブラウザ確認済みだが、実CLI成功を示すものではない。

したがって、実装と合成検査経路は検証済みだが、AC-LE-02の「両CLIのsubscriptionログインによる読取smoke成功」と実編集runは未達である。通常のローカル端末でClaude Codeへ再ログインし、各providerに新しい案件世代またはfixtureを用意した上で、別のレビュー済み検証計画として実施する。
