# Classic Twitter for tweet.app

**6.18.0** · 非公式ユーザースクリプト。昔のTwitter風の青い表示と星のお気に入りを追加します。日本語版は操作UIを日本語化し、英語版はClassic Twitterの用語に揃えます。本文・名前・下書き・サイトのテーマは保持します。

**配布状況:** 6.18.0を検証中。Greasy Forkの全6版を更新予定です。

## 導入・更新

必要なのは、**ブラウザ＋スクリプト管理アプリ／拡張機能＋このスクリプト1本**です。環境と言語を選んでください。

| 環境 | 日本語 | English |
|---|---|---|
| PC Chrome + Tampermonkey | [Chrome版](https://greasyfork.org/ja/scripts/594601) | [Chrome](https://greasyfork.org/en/scripts/594603) |
| Safari + Stay | [Safari版](https://greasyfork.org/ja/scripts/594602) | [Safari](https://greasyfork.org/en/scripts/598237) |
| Android Firefox + Tampermonkey | [Android版](https://greasyfork.org/ja/scripts/598236) | [Android](https://greasyfork.org/en/scripts/598238) |

### PC Chrome

**必要なもの：** PC版Chrome、[Tampermonkey](https://www.tampermonkey.net/index.php?browser=chrome)、上の表のChrome版。入るスクリプト名は日本語が **Classic Twitter for tweet.app - Japanese**、英語が **Classic Twitter for tweet.app - English** です。

1. ChromeにTampermonkeyを追加。
2. 上の表から日本語／英語のChrome版を開き、**「スクリプトをインストール」** → Tampermonkeyの確認画面でも **「インストール」**。
3. Chromeの拡張機能 → Tampermonkeyの「詳細」→ **「ユーザースクリプトを許可」** をオン。
4. [tweet.app](https://app.tweet.app/)を開く／再読み込み。

**更新：** Tampermonkeyのメニュー → **「UserScript の更新を確認」** → 更新があれば案内に従って適用 → tweet.appを再読み込み。

### Safari

**必要なもの：** Safari、[Stay for Safari](https://apps.apple.com/app/id1591620171)、上の表のSafari版。入るスクリプト名は日本語が **Classic Twitter for tweet.app - Japanese**、英語が **Classic Twitter for tweet.app - English Safari** です。

1. Stayを入れ、Safariの「拡張機能」でStayをオンにしてtweet.appへのアクセスを許可。
2. 下の日本語／英語の **コードURLのリンクをコピー**（コード本文のコピーは不要）。
3. Stayの **「リンクから追加」** に貼り付けて保存し、ライブラリでこのスクリプトを有効化。
4. Safariでtweet.appを開く／再読み込み。

- [日本語SafariのコードURL](https://update.greasyfork.org/scripts/594602/Classic%20Twitter%20for%20tweetapp%20-%20Japanese.user.js)
- [English Safari code URL](https://update.greasyfork.org/scripts/598237/Classic%20Twitter%20for%20tweetapp%20-%20English%20Safari.user.js)

**更新：** Stayで対象スクリプトの **「更新」ボタン** を押す → tweet.appを再読み込み。

### Android Firefox

**必要なもの：** [Android版Firefox](https://www.mozilla.org/ja/firefox/browsers/mobile/android/)、[Tampermonkey](https://addons.mozilla.org/en-US/android/addon/tampermonkey/)、上の表のAndroid版。入るスクリプト名は日本語が **Classic Twitter for tweet.app - Japanese Android**、英語が **Classic Twitter for tweet.app - English Android** です。

1. Android版FirefoxにTampermonkeyを追加。
2. Firefoxで上の表の日本語／英語のAndroid版を開き、**「スクリプトをインストール」** → Tampermonkeyの確認画面でも **「インストール」**。
3. Firefoxの拡張機能でTampermonkeyをオンにし、Tampermonkey内でこのスクリプトを有効化。その後tweet.appを開く／再読み込み。

**更新：** Tampermonkeyのメニュー → **「UserScript の更新を確認」** → 更新があれば案内に従って適用 → tweet.appを再読み込み。通常のAndroid版Chromeではこの拡張機能は使えません。

**有効にするのは1本だけ。別の版へ切り替えるときは、前の版を無効にしてください。**

6.18.0では、投稿の一部が変わるたびに全画面を調べ直す処理を減らしました。非表示中は一般の画面監視を止め、復帰時に更新します。星の即時表示、日時、日本語化、通知アイコンの個別リンクを維持します。

## 主な機能

- 星のお気に入り、四角に近いアイコン、スマホ・PCに合わせた表示と短い動き。「便利ツール」で標準表示に戻せます。
- 投稿と確認できた返信の経過時間を更新し、詳細・写真動画・お気に入りに投稿日時を表示。ブラウザの時間帯を使い、編集日時や親投稿の日時を混ぜません。日時不明や曖昧な返信は推測しません。
- 通知の種類フィルター、通知アイコンごとのプロフィール移動、鮮明なバッジ。標準の返信通知・投票・フォローバック操作を使います。
- 写真の複数選択とスライド、プロフィールの写真・動画／お気に入り欄。拡大写真は画面中央に表示し、動画の全画面操作は同じプレーヤー・再生位置・音量を維持します。Safari版は写真・動画の長押しで配信ファイル情報を表示します。
- 保存した検索・投稿リンク、任意のキーワードで折りたたみ、日本／世界ニュース、手動・任意の自動翻訳。自動翻訳は初期状態でオフです。

便利ツールの「クラシック表示」をオフにすると、ハート・いいね表記・元の色や形に戻ります。日本語化と便利機能は引き続き利用できます。

過去のお気に入りは **「便利ツール」→「過去の投稿から探す」**。おすすめ・フォロー中を過去へ順に確認し、1回100ページまで。画面を開いたまま使い、**「一時停止」「続きから探す」**で再開できます。サーバーで現在のお気に入り状態を確認して保存しますが、サービスが返すタイムラインの範囲なので、全履歴の取得は保証できません。今の画面の分だけなら「読み込み済みのお気に入りを復元」（1回40件まで）も使えます。

プロフィールの **「お気に入り」** では、検索入力を置かず、保存件数・表示件数・投稿の日付範囲・復元の確認範囲と進捗、50件ずつの表示、**JSONバックアップ・取り込み**ができます。保存データはアカウント別。同じアカウントの別ブラウザへはJSONで手動移行できます。取り込みはTweet上の星・いいね状態を変更しません。500件を超えた古い保存を自動削除する制限を撤廃しました。ブラウザの保存容量を超えた場合は一時保持になるので、閉じる前にバックアップしてください。

動画の拡大ボタンはスマホで常に見える44pxの操作、PCではポインター・キーボードのフォーカスに合わせた表示です。一時停止中の動画は全画面にしても再生を開始しません。

お気に入りはミュート一覧を確認してから表示します。便利ツールの設定・保存検索・保存投稿は同じブラウザのアカウント間で共通です。自動同期はなく、サイトデータを消すと失われます。

画像・動画の投稿上限とサイト翻訳の制限はtweet.app側の条件に従います。4K HDRの保持は保証できません。端末内翻訳は対応するPC版Chromeで利用できます。実機Android＋Tampermonkey、Safari＋Stayでの導入・操作は未検証です。

[変更履歴](CHANGELOG.md) · [API調査](docs/API_RESEARCH.md) · [検証記録](docs/VALIDATION.md)

## English quick start

You need **a browser, a userscript manager, and one English script** from the table above.

| Browser | Manager | Script name |
|---|---|---|
| Desktop Chrome | [Tampermonkey](https://www.tampermonkey.net/index.php?browser=chrome) | Classic Twitter for tweet.app - English |
| Safari | [Stay for Safari](https://apps.apple.com/app/id1591620171) | Classic Twitter for tweet.app - English Safari |
| Android Firefox | [Tampermonkey for Firefox Android](https://addons.mozilla.org/en-US/android/addon/tampermonkey/) | Classic Twitter for tweet.app - English Android |

**Desktop Chrome / Android Firefox**

1. Add Tampermonkey to the browser. On Android, use [Firefox for Android](https://www.mozilla.org/en-US/firefox/browsers/mobile/android/).
2. Open the matching English edition above → **Install this script** → confirm **Install** in Tampermonkey.
3. On Chrome, open Tampermonkey’s extension Details and enable **Allow User Scripts**. On Firefox, enable Tampermonkey in Extensions settings, then enable this script inside Tampermonkey.
4. Open or reload tweet.app in that browser.

**Update:** Tampermonkey’s menu → **Check for userscript updates** → apply an available update when prompted → reload tweet.app. Standard Android Chrome cannot run this extension.

**Safari**

1. Install Stay, enable it in Safari’s Extensions settings and allow access to tweet.app.
2. Copy the link to **English Safari code URL** above; you do not need to copy the code itself.
3. Paste it into Stay’s link import → save → enable the script in Library.
4. Open or reload tweet.app in Safari.

**Update:** Press the script’s **Update** button in Stay, then reload tweet.app.

**Enable only one edition. Disable the previous edition when switching.**

Turn off **Use classic appearance** in Tools to restore hearts, Like wording and Tweet’s original colors and shapes. Other tools remain available.

Post and verified reply ages update as time passes. Creation dates use your browser’s time zone, with dates and clock times in conversation details and local Media/Favorites. Edit dates and parent-post dates are kept separate; unknown or ambiguous reply times are not guessed.

Use Tools → Search older posts to recover currently confirmed Favorites through older For you/Following pages (up to 100 pages per run; pause/continue while the tab is visible). This covers returned timelines and cannot guarantee your entire history. Your profile displays saved Favorites directly, without search/filter/sort controls. It shows counts, saved Tweet date range, recovery coverage and progress, with same-account JSON backups/import. There is no 500-record eviction; storage failures require a backup before closing. Post text, names, drafts and the site theme stay intact. Favorites are browser-local and account-specific; other saved tools are shared within this browser. Data does not sync automatically across devices. Upload/translation limits and retained 4K HDR depend on Tweet. Physical Android/Tampermonkey and Safari/Stay acceptance remain unverified.

## 開発

```sh
npm ci
npm run check
```

日本語・英語の元は`src/ja.js`と`src/en.js`です。共通モジュールと`scripts/distributions.cjs`から6版を生成・検査します。配布ファイルを直接編集せず、`npm run build`で生成してください。[設計](DESIGN.md)・[受け入れ条件](PRD.md)も参照してください。

Greasy Forkの説明は実際の配布ID・コードURLを記録した`docs/DISTRIBUTIONS.json`と、配布ファイルの`@name`から生成します。

```sh
node scripts/greasyfork-info.cjs --output-dir /tmp/classic-twitter-greasyfork-info
```

個別版は `node scripts/greasyfork-info.cjs ja-safari`、全6版をJSONで取得する場合は `node scripts/greasyfork-info.cjs --json` を使います。

MIT License. Not affiliated with Tweet, Operation Bluebird, Twitter or X.
