# TASK-HUB-006: GitHub Pages への公開

**要件**: —

## 受入条件

- main への push で GitHub Pages にデプロイされる
- 公開 URL で approval-workflow の一周を再生できる

## 変更許可範囲（allow）

- `.github/workflows/pages.yml`
- `vite.config.ts`
- `README.md`

## 変更禁止（deny）

- `data/**`（イベントは抽出スクリプトの生成物）
- `LICENSE`
