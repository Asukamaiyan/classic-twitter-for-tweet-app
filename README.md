# Classic Twitter for tweet.app

非公式のユーザースクリプトです。tweet.app の操作UIを日本語化し、お気に入りを星で表示します。英語版は Classic Twitter の用語に揃えます。サイトのテーマ設定は変更しません。

## インストール・更新

現在の版は **6.7.0** です。使う環境に合った **1本だけ** を有効にしてください。

| 環境 | Greasy Fork | ファイル |
|---|---|---|
| Chrome + Tampermonkey／日本語 | [日本語 Chrome版](https://greasyfork.org/ja/scripts/594601) | `classic-twitter-ja.user.js` |
| Safari + Stay／日本語 | [日本語 Safari版](https://greasyfork.org/ja/scripts/594602) | `classic-twitter-ja-safari.user.js` |
| English | [English version](https://greasyfork.org/en/scripts/594603) | `classic-twitter-en.user.js` |

Greasy Forkで更新し、[tweet.app](https://app.tweet.app/) を再読み込みしてください。既存のスクリプト名とnamespaceを維持しています。重複する旧版やテスト版は無効にしてください。ニュース試験版はこのリリースの対象外です。

## 6.7.0 の変更

- 投稿本文、引用、翻訳結果、表示名、自己紹介、入力中の文章をUI翻訳から除外。
- 通知の文章だけを翻訳し、別の通知の名前と混ぜないよう修正。
- 自動翻訳を初期状態でOFFに変更。右下の「便利ツール」で明示的にONにできます。サイトの翻訳はブラウザの言語設定に従います。手動の「翻訳を表示」「原文を表示」は常に利用できます。
- 画面を何度も走査する処理を整理し、スクリプト自身の変更による無限の再処理を防止。
- 現行サイトのお気に入り状態を正しく判定。ネイティブのフォロー操作・引用リンク・ブランド表示を保持。
- Chrome／Stayの通信方法を共通化。タイムアウト、認証情報の更新、失敗時の待機、IndexedDB接続の終了に対応。
- Safari版の画像・動画情報表示は維持。タッチ操作の実機受け入れは検証記録を参照してください。

## 便利ツール

右下の「便利ツール」／「Tools」から利用します。

- **保存した検索**：よく使う検索語を最大20件保存。クリックするとサイト本来の検索画面で検索します。
- **キーワードで折りたたむ**：任意にON。読み込まれた投稿本文が語句に一致すると折りたたみ、「この投稿を表示」で戻せます。通知やサーバーの検索結果を削除するものではありません。
- **保存した投稿**：投稿詳細画面でURLと任意のメモを最大50件保存。いいねを付けずに後から開けます。本文やメディアは保存しません。

設定・保存内容はこのブラウザのtweet.app内に保存されます。同じブラウザの別アカウントにも共通で、別端末への同期はありません。ブラウザのサイトデータを消すと失われます。

従来のお気に入り一覧は、観測できた「いいね」のローカル控えです。サーバー上の全履歴ではありません。現在のフィードでは確実な投稿URLを得られない場合があり、その場合は誤った引用投稿を保存せずスキップします。確実に保存する場合は投稿詳細の「保存した投稿」を使ってください。元のいいね操作自体が非公開になるわけではありません。

## APIと対応範囲

[API調査](docs/API_RESEARCH.md) に、実際の公式クライアントで確認できた機能と補完機能の境界を記載しています。外部開発者向けの公開API仕様は確認できていません。翻訳、アカウントミュート、検索、Following、テーマなどは既にサイト本体の機能です。

追加の便利ツールはAPIを呼ばず、現在表示されている画面とブラウザ保存領域だけを使います。従来の表示名・返信通知補完はtweet.appの既存APIへの読み取り通信を使います。ログイン用トークンを作者や第三者のサーバーへ送りません。サーバー側DM、予約投稿、端末間同期を追加するものではありません。

## 開発・検証

```sh
npm ci
npm run check
```

`src/ja.js` と `src/en.js` が翻訳の元です。通信、便利ツール、実行制御、表示処理は共有します。Safari版は日本語版と同じ元から生成し、メディア情報表示だけを追加します。配布ファイルは手で編集せず `npm run build` で生成してください。リモートのJavaScript読み込みはありません。

[設計](DESIGN.md)・[受け入れ条件](PRD.md)・[検証結果](docs/VALIDATION.md) を参照してください。自動テストやChromium内の検証と、実際のChrome+Tampermonkey／iPhone Safari+Stayでの受け入れは区別しています。

バグ報告にはブラウザ・スクリプト版・画面名・操作手順を記載してください。認証情報や非公開の投稿内容を含めないでください。

## English

Version 6.7.0 limits terminology changes to interface controls. Post bodies, quotes, names, bios, drafts and native manual translation controls are preserved. Automatic translation is off until explicitly enabled in **Tools**; the native translator follows the browser language.

Tools provides browser-local saved searches, optional reversible keyword filters, and saved post links from a post detail page. Saved data is shared by accounts in this browser and is not synced across devices. See the validation record for tested environments and the remaining physical Safari/Stay checks.

MIT License. Not affiliated with Tweet, Operation Bluebird, Twitter or X.
