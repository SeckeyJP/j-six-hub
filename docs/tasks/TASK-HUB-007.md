# TASK-HUB-007: 複数案件のデータと抽出の拡張

**要件**: REQ-015, 016

## 受入条件

- data/projects.json と案件ごとのイベントがある
- 架空の案件の全イベントが再構成で、根拠に「架空」とある（テストで検査）
- monthly-billing のゲート失敗の履歴を抽出する

## 変更許可範囲（allow）

- `data/**`
- `tools/**`
- `docs/adr/0003-*.md`

## 変更禁止（deny）

- `LICENSE`
