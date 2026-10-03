# TASK-HUB-020 検証記録（2026-09-29）

[TASK-HUB-020](TASK-HUB-020.md) の実装時に残した検証結果と作成者による状況のまとめ。受入条件と変更許可範囲は TASK-HUB-020.md を正とし、ここには評価と事実の記録だけを置く。

## 2026-09-29 検証記録

- 実装・fake adapter検証: provider別JSONL終端schemaと構造化Hook拒否、固定allowlist環境、有限の強制停止、全案件共通dispatch slot、request/claim/start/finish台帳、正規化manifest、P6証跡再照合、G1成功後だけの `no_change` 判定を実装した。
- 停止境界: 直接のCLI processが先に終了してもprocess groupの強制停止と残存確認を続ける。共通指示書とHook起動スクリプトも各preflightのhash照合対象とし、画面の取消操作はローカルprocessを確認できる `started` 状態だけに表示する。
- 完了境界: 正常終了した直接processが子孫を残した場合も停止・残存確認を終えるまで枠を解放しない。smokeは固定JSON結果を検証し、保存する合算UTF-8ログと同じ内容をhash化する。再起動後の未照合runは `unknown` として投影する。
- 検査境界: 候補実行の前後で可視テスト・hold-outのhashとclean treeを照合し、実行時改変を拒否する。version/auth補助processもtimeout・cancel・出力超過・停止未確認のない正常終了だけをpreflight成功とする。
- smoke境界: 未コミット差分だけでなく対象HEADの変更も拒否する。画面は実行状態・証跡欠落を区別し、正規化した停止理由を表示する。
- 補助process・空ログ境界: version/authの停止未確認を全案件共通の `stop_unconfirmed` へ伝播し、回収したprocess結果は空出力でもmode 0600のログを保存する。
- 検査完了境界: coverage・hold-out実行後にも保護テストhashとclean treeを再照合する。CLIの成功終端はイベント列の末尾に限定し、終端後に始まる未完了turnを拒否する。
- 補助process監査: preflightで起動したversion／auth statusの各processについて、引数、開始・終了時刻、終了code、signal、timeout・cancel・出力超過・停止未確認の有無、出力byte数を非公開manifestの `preflight.helpers` に保存する。生の出力はaccount情報を含み得るため保存しない。spawn・待機自体が失敗した場合もその呼出しを記録する（2026-09-30）。
- 復旧境界: Hub再起動後の未確定runと停止未確認runに、記録pid・process groupの不在、対象repoのclean／投入時commit一致、残存worktreeのHEAD・差分をHubが照合し、操作者の停止・外部作用確認と理由を伴う `cli.run_recovered` を追記する操作を設けた。履歴は保持し、復旧後だけ全案件の投入保留と差戻し拒否を解除する。復旧したrunの世代はCLI証跡の不足として残し、差戻し後の新世代で再開する（2026-09-29）。
- `typecheck`、`lint`、`build` が通過した。service/server以外41ファイル330件が通過した。再起動後の状態回帰とsmoke中commit拒否は各対象1件が通過し、他のserviceテストは各実行でskipした。
- 条件付きcoverageは修正前のservice/server除外結果で statements 63.22%、branches 52.34%、functions 68.98%、lines 64.32%。除外したservice/serverを0%として含むため、プロジェクト品質閾値には使わない。対象を含むserviceテスト結果を別に記録する。
- Codex実session: ChatGPT認証、固定CLI、禁止環境変数なし、共通制御hash一致を確認後、読取smokeを1回だけ要求・起動した。管理サンドボックス内でCodex app-server初期化が `Operation not permitted` となり `failed`。同一案件世代では再試行せず、編集runも起動していない。
- Claude Code実session: 利用者はsubscription枠と追加クレジット不使用を確認したが、CLIの `auth status` が未ログインだったためpreflightで `subscription-auth-unconfirmed` とし、要求保存・process起動とも0件にした。
- 環境制約: この検証セッションではlocalhost待受も `EPERM` のため、HTTP境界テストと今回の画面再起動は未実行。直前の同一版ではP4画面と中央モニタをブラウザ確認済みだが、実CLI成功を示すものではない。

したがって、実装と合成検査経路は検証済みだが、AC-LE-02の「両CLIのsubscriptionログインによる読取smoke成功」と実編集runは未達である。通常のローカル端末でClaude Codeへ再ログインし、各providerに新しい案件世代またはfixtureを用意した上で、別のレビュー済み検証計画として実施する。

## 2026-10-03 追記

- 補助process監査の補正: `--version`／auth status の補助processで spawn・待機自体が失敗した場合、adapter が例外を再送出して非公開 manifest と台帳結果まで到達しない経路が独立レビューで再現された。失敗した呼出しを `error: spawn-or-wait-failed` の監査項目として残したうえで preflight を `helper-spawn-or-wait-failed` で保留し、manifest と `cli.run_finished` が保存されるよう修正した。adapter と service の決定論的テストを追加した。実CLIでの全工程成功は引き続き未検証。
