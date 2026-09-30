# Classic Twitter for tweet.app

非公式のユーザースクリプトです。tweet.app の操作UIを日本語化し、お気に入りを星で表示します。英語版は Classic Twitter の用語に揃えます。サイトのテーマ設定は変更しません。

## インストール・更新

バージョン **6.8.1** です。使う環境に合った **1本だけ** を有効にしてください。

| 環境 | Greasy Fork | ファイル |
|---|---|---|
| Chrome + Tampermonkey／日本語 | [日本語 Chrome版](https://greasyfork.org/ja/scripts/594601) | `classic-twitter-ja.user.js` |
| Safari + Stay／日本語 | [日本語 Safari版](https://greasyfork.org/ja/scripts/594602) | `classic-twitter-ja-safari.user.js` |
| English | [English version](https://greasyfork.org/en/scripts/594603) | `classic-twitter-en.user.js` |

Greasy Forkで更新し、[tweet.app](https://app.tweet.app/) を再読み込みしてください。既存のスクリプト名とnamespaceを維持しています。重複する旧版やテスト版は無効にしてください。日本ニュース機能は本体へ統合しました。旧ニュース試験版は無効にしてください。

## 6.8.1 の修正（2026-09-30）

- 端末内翻訳の処理中にタブを離れた場合、戻った後に未表示の翻訳を再開。完了済みの結果を再利用し、重複実行を防ぎます。手動の原文選択・訳文を閉じた状態・失敗後の待機は保持します。
- 日本ニュースは画面を開いている間、15分のキャッシュ期限で見出しを更新。世界ニュース・別画面・バックグラウンドでは更新を止め、戻った時に期限切れなら再取得します。
- 9月30日の公式クライアントとメディア設定を再確認。通常表示／拡大表示の写真切り替え、アイコンの＋非表示、本文・下書き保持を実画面で確認しました。

## 6.8.0 の改善

- **写真をまとめて選択**：複数ファイルを1枚ずつ既存の添付処理へ渡し、完了を待って次へ進みます。失敗や上限で止まった残りの枚数を表示し、最終的な投稿は利用者が行います。
- **写真を横にスライド**：投稿に表示されている複数写真をスワイプ、矢印、キーボードで切り替えます。元の画像を開く操作は維持します。
- **投稿欄**：日本語版は名前を省いた「いまどうしてる？」に変更。入力中の文章は変更しません。
- **翻訳エラーを抑制**：サイトの自動翻訳を1件ずつ実行し、同じ文章の重複要求を防ぎ、エラー時に一時停止します。手動翻訳と原文表示は引き続き利用できます。
- **端末内翻訳**：対応するPC版Chromeでは便利ツールで選択できます。元言語のモデルを「準備」してから有効にします。tweet.appの翻訳APIを使わず、本文を別の翻訳サーバーへ送信しません。Safari／モバイルやAPI非対応環境では利用できません。
- **日本のニュース**：ニュース／スポーツ／エンタメ／テクノロジーで日本・世界を切り替え。日本語版は日本が初期設定です。配信元の画像がある記事には画像を表示し、取得失敗時は元のニュースを残します。

画像枚数・ファイルサイズ・長さ・1日あたりの投稿枠やサーバーでの再圧縮は、tweet.appが決める条件です。**無制限の投稿、無制限のサイト翻訳、4K HDRの保持は実装・保証していません。** 4Kの元ファイルでも、サーバー出力で解像度やHDRが維持されるとは限りません。端末内翻訳にもモデル・対応言語・端末資源の条件があります。

最新の検証範囲と公開先の照合結果は[検証記録](docs/VALIDATION.md)を参照してください。

## 6.7.3 の修正

- ホーム・投稿詳細・返信・おすすめユーザーで再表示されていた、アイコン上の「＋」フォローボタンを非表示にしました。通常のフォローボタンとアイコンからのプロフィール移動は維持します。
- 設定・招待の説明、操作状態、入力欄の案内など、UI保護の範囲を広げた際に英語へ戻った箇所を修正します。投稿本文・表示名・入力中の文章は引き続き変更しません。
- 実際のプロフィールボタン内に画像が入った構造を、3配布版の起動テストにも追加しました。

## 6.7.2 の改善

- アイコンに重なる小さなフォローボタンを非表示。プロフィールなどの通常のフォローボタンは利用できます。
- 通知欄の各アイコンから、それぞれの本人のプロフィールへ移動。名前だけで移動先を推測しません。
- 通知欄に「リプライ通知」を追加。過去の返信も履歴として表示し、新着だけを未読にします。再確認・すべて既読の操作に対応。
- 公式バッジ画像を96×96pxに変更し、表示サイズを維持。スマホのプロフィールメニューと返信の作者名にも表示します。

リプライ通知は、**このタブを表示している間**、最新24件の自分の投稿・返信を対象に90秒ごとに順番に確認します。1回最大6スレッドを確認するため、表示に数分かかる場合があります。履歴・既読状態はこのブラウザ内でアカウント別に保存します。サイトを閉じている間のプッシュ通知や全期間の通知を提供するものではありません。

## 6.7.1 の改善

- 便利ツールの開閉・Tab移動・入力エラー時のフォーカスを改善。保存結果はスクロールしても下部に表示します。
- 本体のダイアログを遮らない表示順、44px以上のボタン、ライト／ダークテーマの色、短い開閉表示に調整。「動きを減らす」設定を尊重します。
- 画面内キーボードで表示領域が縮んだとき、ツールの位置と高さを補正します。実機Safariの受け入れは未検証です。
- 別タブで保存内容が変わっていた場合、古いタブからの上書きを止めて入力中の内容を保持します。案内が出たら入力を控えてから再読み込みしてください。
- プロフィール移動後の古いFounder Number残留、Safariの連続長押しによる情報シート重複・閉じた後の再表示を修正しました。

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

保存検索・投稿保存・キーワード機能は現在表示されている画面とブラウザ保存領域だけを使います。日本ニュースはYahoo!ニュースの公開RSSを認証情報なしで取得します。自動翻訳は選択したエンジンを使います。表示名・バッジ・通知アイコン・返信通知の補完はtweet.appの既存APIへの読み取り通信を使います。ログイン用トークンを作者や第三者のサーバーへ送りません。サーバー側DM、予約投稿、端末間同期を追加するものではありません。

## 開発・検証

```sh
npm ci
npm run check
```

`src/ja.js` と `src/en.js` が翻訳の元です。通信、便利ツール、実行制御、表示処理は共有します。Safari版は日本語版と同じ元から生成し、メディア情報表示だけを追加します。配布ファイルは手で編集せず `npm run build` で生成してください。リモートのJavaScript読み込みはありません。

[設計](DESIGN.md)・[受け入れ条件](PRD.md)・[検証結果](docs/VALIDATION.md) を参照してください。自動テストやChromium内の検証と、実際のChrome+Tampermonkey／iPhone Safari+Stayでの受け入れは区別しています。

バグ報告にはブラウザ・スクリプト版・画面名・操作手順を記載してください。認証情報や非公開の投稿内容を含めないでください。

## English

Version 6.8.1 resumes unfinished on-device translation after returning to the tab and refreshes Japanese news at the 15-minute cache deadline while visible. Background tabs, world news and unrelated routes do not trigger refresh requests.

Version 6.8.0 adds multiple-photo selection, a swipeable photo gallery, safer sequential automatic translation, optional desktop Chrome on-device translation, and Japan/world news with feed-provided images. The three distributions share the same modules. Actual Tampermonkey installation and physical Safari/Stay acceptance remain unverified. Server upload quotas, native translation quotas and preservation of 4K HDR cannot be removed or guaranteed by this userscript. Safari/mobile do not gain Chrome built-in AI support.

Version 6.7.3 fixes avatar-follow overlays that remained on feeds, post details, replies and user suggestions because the avatar was nested inside a profile button. Regular Follow buttons and profile navigation remain available. Japanese UI coverage in settings and invitations is restored while preserving user content.

Version 6.7.2 adds individual notification-avatar profile links, a browser-local reply inbox, and official high-resolution badges beside reply authors and mobile account names. Tiny avatar follow overlays are hidden; regular Follow buttons remain. Reply checks run in batches every 90 seconds while this tab is visible, covering the latest 24 own posts/replies. This is not background push notification delivery. Reply history is stored separately per account.

The script limits terminology changes to interface controls. Post bodies, quotes, names, bios, drafts and native manual translation controls are preserved. Automatic translation is off until explicitly enabled in **Tools**; the native translator follows the browser language.

Tools provides browser-local saved searches, optional reversible keyword filters, and saved post links from a post detail page. Saved data is shared by accounts in this browser and is not synced across devices. See the validation record for tested environments and the remaining physical Safari/Stay checks.

MIT License. Not affiliated with Tweet, Operation Bluebird, Twitter or X.
