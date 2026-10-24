# 公開手順（GitHub ＋ Cloudflare Pages）

METABOLISM はビルド不要の静的サイトです。`public/` フォルダの中身をそのまま配信します。

## 0. 公開前に決めること
- [x] 作者名・連絡先・ライセンス（決定済み：こんにゃくお爺さん／note のプロフィール／プログラム GPL-3.0・解説文は CC BY-NC-SA 4.0。[作者名とライセンスの決定.md](作者名とライセンスの決定.md)）
- [ ] **`python3 dev/tests/pre_release.py` が「すべて成功」**（必須。MANIFEST の照合・版のそろい具合・各種の自動テスト・画面操作の試験をまとめて実行する。1つでも失敗したら公開しない）
- [x] リポジトリは**公開（Public）**にする（決定済み）。作る前に GitHub の設定 →「Emails」→「Keep my email addresses private」を有効にし、コミットに個人のメールアドレスが残らないようにする
- [x] サイトの名前（`<名前>.pages.dev` になる。決定済み：konnyaku-metabolism）
  - 共有プレビュー（OGP）の住所は `https://konnyaku-metabolism.pages.dev/` で書いてある。別の名前・独自ドメインにするときは、`public/index.html` の `canonical`・`og:url`・`og:image` の3か所を同じ住所に直す。公開ファイルが変わるので、**新しい版として公開し**、新しい版の `docs/MANIFEST_v<版>.sha256` を `python3 dev/tools/make_manifest.py v<版>` で作る（過去の版の MANIFEST は書き換えない。「4. 更新するとき」）

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
- [ ] `https://<名前>.pages.dev` が開き、タイトルが「METABOLISM — 代謝のインクリメンタルゲーム」、ヘッダに「v0.2.2」
- [ ] 初回に「遊び方」が開く。2回目からは開かない
- [ ] ブラウザの開発者ツール →「ネットワーク」で、読み込みが自サイトのファイルだけ（index.html・css・js 6つ・favicon.ico・icon-192.png・manifest.webmanifest）
- [ ] 開発者ツール →「コンソール」にエラー（CSP 違反を含む）がない
- [ ] レスポンスヘッダーに `Content-Security-Policy` などが付いている（`curl -I https://<名前>.pages.dev/`）
- [ ] `https://<名前>.pages.dev/_headers` を開くと、設定ファイルの中身ではなくゲームのトップ画面が出る（Cloudflare Pages は 404.html がないとき、存在しない住所にトップページを返す。設定ファイルは配信されない）
- [ ] スマートフォン実機（iPhone の Safari、Android の Chrome）で：グルコースを入れる、研究を買う、タブを切り替える、用語カードを開く・閉じる、アプリを閉じて開き直すと続きから
- [ ] PC（Chrome・Edge・Firefox・Safari のうち手元にあるもの）で同じ操作
- [ ] 1時間ほど閉じてから開くと「留守のあいだの … を進めました」

## 4. 更新するとき
1. ファイルを直して `git commit`・`git push` すると、自動で公開し直される。
2. 版を上げたときは、次の場所を同じ版にする。
   - `public/index.html` の `id="ver"`・`id="about-ver"`、`public/js/ui.js` の `VERSION`（`APP_VERSION` に改名してもよい。検査はどちらの名前も読む）
   - `CHANGELOG.md` の先頭の項
   - `README.md` の冒頭、`docs/RELEASE_CHECKLIST.md`・`docs/KNOWN_LIMITATIONS.md` の見出し、この文書の「3. 公開後の確認」の版
   - `dev/tests/text_lint.js`・`dev/tests/release_check.py` は、版を `public/index.html` から読むので書き換えは要らない（版を直書きすると `version_check.py` が失敗する）。`ui.js` の版の名前を変えるときは、`text_lint.js`・`version_check.py` の読み取りも同時に直す
   そのあと `python3 dev/tools/make_manifest.py v<版>` で `docs/MANIFEST_v<版>.sha256` を作り、`python3 dev/tests/version_check.py` が「すべて v<版> でそろっている」になることを確かめる。`verify_manifest.py` は最新の版（SemVer の数値順。v0.2.10 は v0.2.9 より新しい）の MANIFEST を自動で選ぶので、書き換えは要らない。過去の版の MANIFEST は書き換えない。
3. 公開する版ごとに、`ui.js` の版（`VERSION`）・`CHANGELOG.md`・`docs/MANIFEST_v<版>.sha256`・git のタグ `v<版>` の4つを同じ版にそろえる（v0.2.1 から。タグは公開を確定したときに付ける：`git tag v<版> && git push origin v<版>`、または GitHub の「Releases」→「Draft a new release」でタグを作る）。
4. **ファイルを削除するときは、「Add files via upload」ではなく、GitHub の画面でファイルを開いて「Delete file」を使うか、`git rm` を使う**（アップロードでは削除が反映されない。v0.2.0 で `favicon.svg` が残ったのはこのため）。
5. セーブの形式を変えるときは、`public/js/sim.js` の `SAVE_VERSION` を上げ、移行（MIGRATIONS）を追加する。保存場所の名前（`metabolism.save.v1`）は変えない（変えると、これまでの保存が読めなくなる）。

## 5. 公開した版を戻すとき（ロールバック）
GitHub の `main` を正本とし、公開サイトは常に `main` と同じ状態にする。

1. **ふだんの戻し方**：GitHub 側で、正常だった版に戻す新しいコミットを作る。
   - git を使う場合：`git revert <戻したいコミット>`（複数あれば新しい順に）、または `git checkout v<正常な版> -- public` で正常な版の `public/` を取り出し、余分なファイルを `git rm` してコミットする。
   - GitHub の画面だけで行う場合：正常な版のファイルをアップロードし直すだけでは、その後に**追加されたファイルが消えない**。追加されたファイルは「Delete file」で削除する（github.dev ならまとめて削除できる）。
   - どちらの場合も、`python3 dev/tools/verify_manifest.py v<正常な版>` が「すべて一致」になることを確かめる。
2. **緊急の戻し方**：遊べないなど急ぐときは、Cloudflare のダッシュボード →「Deployments」→ 正常だったデプロイの「…」→「Rollback to this deployment」で、公開サイトだけをすぐに戻す。**このままでは GitHub と公開サイトが食い違う**ので、続けて 1 を行い、GitHub の `main` を正常な版にそろえる（そろえたあとの自動の公開で、公開サイトも `main` と同じになる）。
3. 戻した版にはタグを付け直さない（元の版のタグがそのまま正しい）。不具合を直した版は、新しい版として公開する。
4. セーブは端末の中にあり、サイトを戻しても消えない。セーブの形式（`SAVE_VERSION`）を上げた版を戻すと、新しい形式のセーブを古い版が読めない場合があるので、セーブの形式を変える版はとくに慎重に公開する。

## 6. 独自ドメインを使う場合（任意）
Cloudflare Pages のプロジェクト →「Custom domains」で追加する。**ドメインが変わると保存が別になる**ため、独自ドメインに移すなら、多くの人が遊び始める前に行うのがよい。
