# 公開チェックリスト（METABOLISM v0.2.2）

公開用ビルド：**v0.2.2**。`public/` の各ファイルの SHA-256 は `docs/MANIFEST_v0.2.2.sha256` に記録してあります。
公開前・公開後に `python3 dev/tools/verify_manifest.py` を実行し、「すべて一致」になることを確認してください（ファイルが意図せず変わっていないことの確認）。

> v0.2.2 では、代謝の計算・ゲームバランス・セーブの形式の変更は行いません（公開物の整理だけ：使われていない `og-image.jpg`・`favicon.svg` の削除と版の表示。v0.2.1 ではホーム画面から独立したアプリとして開くための manifest と meta タグを追加）。チェックで不具合が見つかった場合は、内容と影響を記録して判断します（下の「不具合の記録」）。

---

## A. 公開前（開発者の手元）
- [x] 作者名・連絡先・ライセンスを決め、README に記入し、`LICENSE`（GPL-3.0）を置いた（2026-10-17）
- [ ] **`python3 dev/tests/pre_release.py` → 「すべて成功」（必須。1つでも失敗したら公開しない。以下の自動テストを順に実行する）**
- [ ] `python3 dev/tools/verify_manifest.py` → すべて一致
- [ ] `python3 dev/tests/version_check.py` → 「すべて v<版> でそろっている」（表示・JS・CHANGELOG・最新の MANIFEST・README・この文書などの版が一致し、`public/` が MANIFEST と一致）
- [ ] 新しい版の `docs/MANIFEST_v<版>.sha256` を `python3 dev/tools/make_manifest.py v<版>` で作った。過去の版の MANIFEST は変更していない（`git diff --stat docs/MANIFEST_*` に新しい版の1件だけ）
- [ ] 自動テスト（必須）：`node dev/tests/run_tests.js`・`node dev/tests/v020_tests.js`・`node dev/tests/savecode_tests.js`・`node dev/tests/text_lint.js`・`python3 dev/tests/manifest_tests.py`・`python3 dev/tests/ui_smoke.py public/index.html` → すべて成功（`pre_release.py` がまとめて実行する）
- [ ] GitHub の「Keep my email addresses private」を有効にした（コミットに個人のメールアドレスを残さない）
- [ ] リポジトリを **Public** で作成し、トップに README・LICENSE が表示される（GitHub が「GPL-3.0 license」と認識している）

## B. 実機での確認（公開前に `public/index.html` を直接開くか、プレビュー URL で）
各端末で、次の操作をして ✓ を付けます。

| 確認する操作 | iPhone（Safari） | Android（Chrome） | PC Chrome / Edge | PC Firefox | Mac Safari |
|---|---|---|---|---|---|
| 1. 初回に「遊び方」が開き、「閉じる」で閉じる | | | | | |
| 2. 「グルコースを入れる」・図のグルコースのタップで、数字が増え、流れが動く | | | | | |
| 3. 研究タブで研究を買える | | | | | |
| 4. タブ（細胞・研究・記録・詳細）を切り替えられる | | | | | |
| 5. ⓘ・点線の下線の言葉で説明カードが開き、閉じられる | | | | | |
| 6. 画面が横にずれない・文字が切れない（縦向き） | | | | | |
| 7. ヘッダの「?」で遊び方が開く | | | | | |
| 8. ブラウザ（アプリ）を閉じて開き直すと続きから | | | | | |
| 9. 詳細タブ「新しい細胞で再開」で確認が出て、再開できる | | | | | |
| 10. 横向きにしても操作できる（狭いのは既知の制約） | | | | | |
| 11. 詳細タブ「書き出す」→「コピーする」で文字列がコピーされる（できないときは選んで手でコピーできる） | | | | | |
| 12. 別の端末・ブラウザの「読み込む」に貼り付けて、同じ進み具合で再開できる | | | | | |
| 13. 読み込んだあと「読み込む前に戻す」で元に戻る | | | | | |
| 14. v0.1.2 で遊んでいたブラウザで開くと、続きから遊べる（研究・研究ポイントがそのまま） | | | | | |
| 15. 研究タブのグルコース輸送体に「最大輸送能力」と「いま入っている速さ」が出る | | | | | |

気づいたこと（端末名・OS の版・内容）：

## C. 公開直後（`https://<名前>.pages.dev`）
- [ ] ページが開き、タイトル「METABOLISM — 代謝のインクリメンタルゲーム」、ヘッダに「v0.2.2」
- [ ] `https://<名前>.pages.dev/LICENSE.txt` で GPL-3.0 の全文が出る（トップ画面が出る場合は、古い版のファイルが登録されている）
- [ ] 初回に「遊び方」が開く。再読み込みすると開かない
- [ ] 開発者ツール →「ネットワーク」：読み込みが自サイトのファイルだけ（index.html・style.css・js 6つ・favicon.ico・icon-192.png・manifest.webmanifest）
- [ ] `https://<名前>.pages.dev/ogp.png` が画像として開く。`index.html` の `og:url`・`og:image` の住所が、実際の公開URLと同じ
- [ ] `https://<名前>.pages.dev/og-image.jpg`・`/favicon.svg` を開くと、画像ではなくゲームのトップ画面が出る（v0.2.2 の削除が公開に反映されている）
- [ ] SNS のプレビューに古い画像（`og-image.jpg` の版）が出るときは、各サービスのキャッシュを確かめる（X は投稿画面のプレビュー、Facebook は Sharing Debugger の「もう一度スクレイピング」）
- [ ] X・LINE・Discord などに公開URLを貼ると、タイトル・説明文・画像（METABOLISM のバナー）のプレビューが出る（X は投稿画面のプレビュー、Facebook は Sharing Debugger でも確かめられる）
- [ ] iPhone の Safari で「ホーム画面に追加」すると、M のアイコンになる。ブラウザのタブにも M のアイコンが出る
- [ ] `https://<名前>.pages.dev/manifest.webmanifest` が JSON（`application/manifest+json`）で開く（トップ画面の HTML が出る場合は、manifest が登録されていない）
- [ ] iPhone：ホーム画面の古い METABOLISM を削除してから、Safari で開き直して「ホーム画面に追加」。追加の画面に「Webアプリとして開く」が出て、オンになっている（iOS は追加した時点の情報を覚えるため、古いアイコンのままでは変わらない）
- [ ] iPhone：ホーム画面のアイコンから開くと、画面下に URL バーが出ず、独立したアプリとして開く。名前が「METABOLISM」
- [ ] iPhone：ホーム画面のアプリは Safari と保存領域が別。Safari の進み具合を使うときは、Safari の詳細タブ「書き出す」→ ホーム画面のアプリの「読み込む」で移せる
- [ ] 開発者ツール →「コンソール」：エラー（CSP 違反を含む）がない
- [ ] `curl -I https://<名前>.pages.dev/` で `Content-Security-Policy`・`X-Content-Type-Options`・`X-Frame-Options`・`Referrer-Policy`・`Permissions-Policy` が付いている
- [ ] `https://<名前>.pages.dev/_headers` を開くと、設定ファイルの中身ではなくゲームのトップ画面が出る（Cloudflare Pages は 404.html がないとき、存在しない住所にトップページを返す。設定ファイルは配信されない）
- [ ] `https://<名前>.pages.dev/?debug=1` 以外では、詳細タブに「計算の健全性」が出ない
- [ ] 詳細タブ「このゲームについて」に作者・ライセンスが出る。「GNU General Public License v3.0」で LICENSE.txt が、「CC BY-NC-SA 4.0」で説明ページが、note のリンクでプロフィールが開く
- [ ] スマートフォン実機で B の 1〜3・8 をもう一度

## D. 公開後しばらく（1日〜1週間）
- [ ] 1時間ほど閉じてから開くと「留守のあいだの … を進めました」
- [ ] 遊んでくれた人からの不具合報告を確認する（連絡先を載せた場合）
- [ ] Cloudflare のダッシュボードで、デプロイが「Success」のまま
- [ ] 公開を確認したら、git のタグ `v<版>` を公開した版のコミットに付けた（GitHub の「Releases」→「Draft a new release」）
- [ ] 公開サイトを Cloudflare の「Rollback to this deployment」で戻した場合は、GitHub の `main` も正常な版にそろえた（[DEPLOY.md](DEPLOY.md) の「5. 公開した版を戻すとき」）
- [ ] 独自ドメインに移す場合は早めに（保存がドメインごとに別になるため）

## 不具合の記録
| 日付 | 端末・ブラウザ | 内容 | 影響（遊べない／表示のみ 等） | 対応 |
|---|---|---|---|---|
| | | | | |
