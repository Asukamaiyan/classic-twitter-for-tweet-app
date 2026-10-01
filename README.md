# Classic Twitter for tweet.app

**6.12.0** · 非公式ユーザースクリプト。昔のTwitter風の青い表示と星のお気に入りを追加します。日本語版は操作UIを日本語化し、英語版はClassic Twitterの用語に揃えます。本文・名前・下書き・サイトのテーマは保持します。

## 導入・更新

環境と言語を選び、**1本だけ有効化**してください。

| 環境 | 日本語 | English |
|---|---|---|
| PC Chrome + Tampermonkey | [Chrome版](https://greasyfork.org/ja/scripts/594601) | [Chrome](https://greasyfork.org/en/scripts/594603) |
| Safari + Stay | [Safari版](https://greasyfork.org/ja/scripts/594602) | [Safari](https://greasyfork.org/en/scripts/598237) |
| Android Firefox + Tampermonkey | [Android版](https://greasyfork.org/ja/scripts/598236) | [Android](https://greasyfork.org/en/scripts/598238) |

**Chrome / Android：** Tampermonkeyを追加 → 上のページの「インストール」→ [tweet.app](https://app.tweet.app/)を再読み込み。更新も同じボタンです。Chromeは初回に拡張機能の詳細で「ユーザースクリプトを許可」をオンにしてください。Android用Tampermonkeyは[Mozilla公式ページ](https://addons.mozilla.org/en-US/android/addon/tampermonkey/)から追加します。通常のAndroid版Chromeは対応していません。

**Safari：** 下の「コードURL」をコピー → Stayのリンク追加に貼り付け → 有効化。初回はSafariの拡張設定でStayを許可してください。更新も同じURLを再取り込みし、tweet.appを再読み込みます。

- [日本語SafariのコードURL](https://update.greasyfork.org/scripts/594602/Classic%20Twitter%20for%20tweetapp%20-%20Japanese.user.js)
- [English Safari code URL](https://update.greasyfork.org/scripts/598237/Classic%20Twitter%20for%20tweetapp%20-%20English%20Safari.user.js)

## 主な機能

- 星のお気に入り、四角に近いアイコン、スマホ・PCに合わせた表示と短い動き。「便利ツール」で標準表示に戻せます。
- 通知の種類フィルター、通知アイコンごとのプロフィール移動、鮮明なバッジ。標準の返信通知・投票・フォローバック操作を使います。
- 写真の複数選択とスライド、プロフィールの写真・動画／お気に入り欄。Safari版は写真・動画の長押しで配信ファイル情報を表示します。
- 保存した検索・投稿リンク、任意のキーワードで折りたたみ、日本／世界ニュース、手動・任意の自動翻訳。自動翻訳は初期状態でオフです。

お気に入りはこのブラウザ内でログインアカウント別に保存し、ミュート一覧を確認してから表示します。便利ツールの設定・保存検索・保存投稿は同じブラウザのアカウント間で共通です。端末間の同期はなく、サイトデータを消すと失われます。過去の全お気に入り履歴は取得できません。

画像・動画の投稿上限とサイト翻訳の制限はtweet.app側の条件に従います。4K HDRの保持は保証できません。端末内翻訳は対応するPC版Chromeで利用できます。実機Android＋Tampermonkey、Safari＋Stayでの導入・操作は未検証です。

[変更履歴](CHANGELOG.md) · [API調査](docs/API_RESEARCH.md) · [検証記録](docs/VALIDATION.md)

## English quick start

Choose **one edition** from the table above.

- **Desktop Chrome / Android Firefox:** Add Tampermonkey → open the edition page → **Install** → reload tweet.app. Use the same button to update. On Chrome, enable **Allow User Scripts** in the extension details once. Standard Android Chrome is unsupported.
- **Safari:** Copy the **English Safari code URL** above → paste into Stay’s link import → enable it. Allow Stay in Safari’s extension settings once. To update, import the same URL again and reload tweet.app.

Post text, names, drafts and the site theme stay intact. Favorites are browser-local and account-specific; other saved tools are shared within this browser. Data does not sync across devices. Upload/translation limits and retained 4K HDR depend on Tweet. Physical Android/Tampermonkey and Safari/Stay acceptance remain unverified.

## 開発

```sh
npm ci
npm run check
```

日本語・英語の元は`src/ja.js`と`src/en.js`です。共通モジュールと`scripts/distributions.cjs`から6版を生成・検査します。配布ファイルを直接編集せず、`npm run build`で生成してください。[設計](DESIGN.md)・[受け入れ条件](PRD.md)も参照してください。

MIT License. Not affiliated with Tweet, Operation Bluebird, Twitter or X.
