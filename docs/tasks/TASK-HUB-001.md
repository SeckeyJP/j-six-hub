# TASK-HUB-001: 基盤

**要件**: REQ-005, REQ-014

## 受入条件

- `npm run build` が静的ファイルを `dist/` に出力する
- `npm test` が Vitest を実行する。`npm run lint`・`npm run typecheck` が通る
- プロセス定義の取得スクリプトが、SHA-256 が一致しない内容を拒否する（テストで確認）
- `data/events.jsonl` を読み込み、型付きのイベント列にする（行の欠落・不正な JSON はエラー）
- CI で型検査・lint・テスト・ビルドを実行する

## 変更許可範囲（allow）

- `package.json`
- `package-lock.json`
- `tsconfig*.json`
- `vite.config.ts`
- `eslint.config.js`
- `index.html`
- `process.lock.json`
- `scripts/**`
- `src/data/**`
- `src/types/**`
- `src/main.tsx`
- `src/test/**`
- `.github/workflows/app.yml`
- `.gitignore`
- `CLAUDE.md`

## 変更禁止（deny）

- `data/**`（イベントは抽出スクリプトの生成物）
- `LICENSE`
