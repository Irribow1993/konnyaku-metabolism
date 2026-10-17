# 公開手順（GitHub ＋ Cloudflare Pages）

METABOLISM はビルド不要の静的サイトです。`public/` フォルダの中身をそのまま配信します。

## 0. 公開前に決めること
- [x] 作者名・連絡先・ライセンス（決定済み：こんにゃくお爺さん／note のプロフィール／プログラム GPL-3.0・解説文は CC BY-NC-SA 4.0。[作者名とライセンスの決定.md](作者名とライセンスの決定.md)）
- [ ] `python3 dev/tools/verify_manifest.py` で、公開用ビルドが固定した最終候補のままか確認
- [x] リポジトリは**公開（Public）**にする（決定済み）。作る前に GitHub の設定 →「Emails」→「Keep my email addresses private」を有効にし、コミットに個人のメールアドレスが残らないようにする
- [ ] サイトの名前（`<名前>.pages.dev` になる。例：metabolism-game）

## 1. GitHub にリポジトリを作る
1. GitHub にログインし、右上の「+」→「New repository」。
2. Repository name（例：`metabolism`）を入力。**Public** を選ぶ。Description（任意）：「生化学がテーマのインクリメンタルゲーム」。「Add a README」は付けない（同梱の README を使う）。
3. 作成後、手元で ZIP を展開したフォルダ（`metabolism/`）に移動して：
   ```
   git init
   git add .
   git commit -m "METABOLISM v0.1.0"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/metabolism.git
   git push -u origin main
   ```
   コマンドを使わない場合は、リポジトリの画面で「uploading an existing file」から、展開したフォルダの中身をドラッグして登録してもよい（フォルダ構成ごと）。
4. 公開の区切りとしてタグを付ける（任意）：`git tag v0.1.0 && git push origin v0.1.0`

## 2. Cloudflare Pages に接続する
1. Cloudflare のダッシュボード →「Workers & Pages」→「Create」→「Pages」→「Connect to Git」。
2. GitHub と連携し、作ったリポジトリを選ぶ。
3. ビルドの設定：
   | 項目 | 値 |
   |---|---|
   | Framework preset | None |
   | Build command | （空欄） |
   | Build output directory | `public` |
   | Root directory | （空欄＝リポジトリのいちばん上） |
4. 「Save and Deploy」。数十秒で `https://<名前>.pages.dev` に公開される。
5. 以後、`main` ブランチに push するたびに自動で公開し直される。別のブランチに push すると、プレビュー用の URL が作られる（本番とは保存が別になる）。

### Git を使わない方法（Direct Upload）
「Pages」→「Upload assets」で、`public/` フォルダの中身をアップロードしてもよい。`_headers` も一緒にアップロードすること。

## 3. 公開後の確認（チェックリスト）

> 最新のチェックリストは [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)（実機確認の表・公開直後・公開後しばらく・不具合の記録）。下は要約。
- [ ] `https://<名前>.pages.dev` が開き、タイトルが「METABOLISM — 代謝のインクリメンタルゲーム」、ヘッダに「v0.1.0」
- [ ] 初回に「遊び方」が開く。2回目からは開かない
- [ ] ブラウザの開発者ツール →「ネットワーク」で、読み込みが自サイトのファイルだけ（index.html・css・js 5つ・favicon.svg）
- [ ] 開発者ツール →「コンソール」にエラー（CSP 違反を含む）がない
- [ ] レスポンスヘッダーに `Content-Security-Policy` などが付いている（`curl -I https://<名前>.pages.dev/`）
- [ ] `https://<名前>.pages.dev/_headers` を開くと、設定ファイルの中身ではなくゲームのトップ画面が出る（Cloudflare Pages は 404.html がないとき、存在しない住所にトップページを返す。設定ファイルは配信されない）
- [ ] スマートフォン実機（iPhone の Safari、Android の Chrome）で：グルコースを入れる、研究を買う、タブを切り替える、用語カードを開く・閉じる、アプリを閉じて開き直すと続きから
- [ ] PC（Chrome・Edge・Firefox・Safari のうち手元にあるもの）で同じ操作
- [ ] 1時間ほど閉じてから開くと「留守のあいだの … を進めました」

## 4. 更新するとき
1. ファイルを直して `git commit`・`git push` すると、自動で公開し直される。
2. 版を上げたときは、`public/index.html` の `id="ver"`・`id="about-ver"`、`public/js/ui.js` の `VERSION`、CHANGELOG.md を更新する。
3. セーブの形式を変えるときは、`public/js/sim.js` の `SAVE_VERSION` を上げ、移行（MIGRATIONS）を追加する。保存場所の名前（`metabolism.save.v1`）は変えない（変えると、これまでの保存が読めなくなる）。

## 5. 独自ドメインを使う場合（任意）
Cloudflare Pages のプロジェクト →「Custom domains」で追加する。**ドメインが変わると保存が別になる**ため、独自ドメインに移すなら、多くの人が遊び始める前に行うのがよい。
