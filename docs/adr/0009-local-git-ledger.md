# ADR-0009: ローカルPoCの工程recordを1 commitずつ非公開Gitに追記する

## ステータス

提案中（WS-021成果物レビュー前）

## 日付

2026-09-27

## コンテキスト（背景）

[全工程Design Spec](../specs/developer-journey-design-spec.md)と[単一run Design Spec](../specs/local-execution-design-spec.md)は、案件・提出・ゲートの履歴をローカル非公開Gitへ追記し、再起動後に投影し直すことを求める。公開リプレイのイベントJSONLと同じデータ源にはできない。

## 判断（Decision）

PoCの台帳はremoteのない専用Git repo `refs/heads/poc-ledger` に置く。1 recordを1 commitの `record.json` とし、commitのGit親、record内の前commitと前record SHA256を再生時に照合する。schema版、record ID、project ID、種別、時刻、payloadを記録する。重複ID、未知schema、不正hash、連鎖不一致では再生を止める。書込は `.git/poc-operation.lock` の原子的作成で直列化し、期待old SHA付き `git update-ref` と更新後の再読込が一致して初めて成功とする。

操作lockが残った場合は自動奪取しない。ref更新の結果や再読込が不明な場合もlockを残して手動照合する。台帳には個人情報、生ログ、認証情報、絶対パスを保存しない。成果物本体は別の対象Git repoに置き、対象commit・相対path・blob内容SHA256を照合する。symlinkとsubmoduleは提出対象にしない。

## 理由（Rationale）

Gitの親commitと期待SHAで履歴順序と通常の競合を確認できる。1 commit 1 recordなら再起動時に順番どおり再投影しやすい。操作lockは同一PCでの協力的なHub処理間を直列化する。

## 検討した代替案

| 案 | 採用しない理由 |
|---|---|
| JSONLを直接append | 期待SHAの競合判定と再起動後のGit履歴照合を別途作る必要がある |
| SQLiteを正本にする | J-SIXのGit正本方針と異なる二重正本になる |
| 公開リプレイのevents.jsonlを共用 | 再構成イベントと実際のPoC操作・生データの境界が崩れる |

## 影響（Consequences）

Git commitごとの処理は大量recordには高コストだが、単一利用者・小さな合成案件のPoCには許容する。Git履歴とSHA256は同じOSユーザーによる悪意ある履歴書換えの防止、外部CLI作用のexactly-once、真正な顧客承認を証明しない。台帳書込API、CLI投入、Phase 0〜6の完成判定は後段で別に検証する。

## 関連

- [ADR-0007](0007-local-execution-poc.md)、[ADR-0008](0008-developer-workbench.md)
- [全工程Design Spec](../specs/developer-journey-design-spec.md)
