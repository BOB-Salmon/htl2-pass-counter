# HACK THE LPIC 2 — PASS COUNTER（管理者向け）

受講者が同じ URL を開き（プロジェクターにも映す）、合格報告が入ると全員の画面で合格演出が流れるページです。
外部ライブラリ・ビルド不要の静的サイト（`index.html / style.css / app.js / config.js`）です。

## 1. フォームの準備

`docs/sheet-setup.md` のとおりに Google フォーム → 回答スプレッドシート → 「ウェブに公開（CSV）」を用意し、公開 URL を控えます。

- 質問の順番と文言（社員番号／試験／結果／スコア）は表のとおりにしてください。列名で読み取るので、`QUERY` で列を抜き出したシートでも動きます。
- 名前・社員番号・スコアは画面に出ません（社員番号は重複除去と 201/202 の突き合わせにだけ使います）。

## 2. config.js の書き方

```js
window.HTL_CONFIG = {
  csvUrl: "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=0&single=true&output=csv",
  pollSeconds: 20,            // 取得間隔（秒）
  phase: "auto",              // "auto"（日付で切替）| "201" | "202"（固定）
  phaseSwitchDate: "2026-12-07", // この日の 0:00（日本時間）から PHASE 202
  exams: [ ... ],             // 試験の開始日時と表示ラベル（カウントダウンに使用）
  milestones: [10, 25, 50, 100],
  tickerMax: 12               // 最下部のクレジットに出す件数
};
```

- `csvUrl` が空のときは `data/sample.csv` を読み、右上に「SAMPLE DATA」と出ます。
- Google 側のキャッシュで、反映まで最大 5 分ほどかかることがあります。

## 3. GitHub Pages で公開

1. このフォルダの中身をリポジトリ直下に置いて push
   ```sh
   git init
   git add index.html style.css app.js config.js data assets README.md
   git commit -m "Add pass counter"
   git branch -M main
   git remote add origin https://github.com/<組織またはユーザー>/<リポジトリ名>.git
   git push -u origin main
   ```
2. GitHub のリポジトリ → **Settings → Pages** → Source: `Deploy from a branch`、Branch: `main` / `/(root)` → Save
3. 数分後に `https://<組織またはユーザー>.github.io/<リポジトリ名>/` で公開されます（相対パスのみなのでサブパスで動きます）

⚠ **公開範囲に注意**：`assets/video/` の映像は「社外に公開しないこと」とされた社内素材です。公開リポジトリの GitHub Pages は URL を知っていれば誰でも見られます（`noindex` は検索に載らないだけ）。
可能なら GitHub Enterprise Cloud の **プライベート Pages（アクセス制御あり）** を使うか、社内の Web サーバーに同じファイル一式を置いてください。

## 4. リハーサル

- URL 末尾に `?demo=1` を付けると右上に「DEMO ▾」が出ます。
  - `PHASE AUTO / 201 / 202`：フェーズの切替（201→202 で切替演出）
  - `SIMULATE PASS / CERTIFIED / MILESTONE`：演出の再生（画面上だけ。データは書き換えません）
- 本番データで確認する場合：フォームから「テスト用の社員番号」で報告 → 20 秒以内（Google のキャッシュ次第で数分）に演出が流れます。終わったら回答シートからその行を削除してください。
- `F` キー：全画面
- 「SOUND OFF」ボタン（右上）を一度押すと、以降の演出で映像の音が鳴ります（ブラウザの制約で最初は無音です）。

## 5. 困ったとき

| 症状 | 確認すること |
|---|---|
| 下部に「更新できませんでした（再試行中）」 | `csvUrl` が「ウェブに公開」の **CSV 形式** の URL か。共有リンク（`/edit`）では読めません。前回の表示は保たれ、自動で再試行します |
| 数字が増えない | Google 側キャッシュ（最大 5 分）。試験欄が `201`/`202`、結果欄が `合格`/`不合格` になっているか（それ以外の行は無視されます） |
| 演出が二重に流れない／流れない | 一度数えた合格は、開き直しても演出しません（ブラウザの localStorage に記録）。リセットしたい場合はブラウザのサイトデータを削除 |
| 映像が出ない | `assets/video/` に `pass.mp4 / pass.webm / cert.mp4 / cert.webm` があるか。無くても黒背景で数字の演出は出ます |
| フェーズを手動で切り替えたい | `config.js` の `phase` を `"201"` または `"202"` に |

集計ルール：受験者＝その試験で報告した人、合格者＝その試験で 1 回以上「合格」を報告した人（どちらも社員番号で重複除去）、合格率＝合格者÷受験者、LPIC-2 認定＝201 と 202 の両方の合格者。
