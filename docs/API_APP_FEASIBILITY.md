# Tweet 最新 API・重複機能・独立アプリ可否の確認

確認日: 2026-10-07 JST。6.22.0では公開の公式HTML・JavaScript・CSS・Service Worker・media config・公式サイト/規約を調査。6.23.0ではユーザーの許可に基づき、ログイン済みの公式画面を操作して読み取り通信・consoleも確認した。以下では公開sourceと認証済み画面の観測を区別する。認証値・アカウント識別子・投稿本文を保存せず、投稿/アップロード/お気に入り/フォロー/通知権限の変更は行っていない。独立アプリの認証・書き込み受理テストではない。

## 6.23.0 ログイン済み画面の再確認

画面上のバージョンは **2.2.3**、build `1791314488`。標準画面の移動でGET `/api/posts`、`/api/posts/{postId}`、`/api/posts/{postId}/replies` の成功とschemaを確認した。返信には親投稿と別の `createdAt` があり、確認した値の形式はタイムゾーン付きISO文字列。詳細・返信の通信にはAuthorizationとApp Checkがあり、証跡にはheaderの有無だけをbooleanで保存した。token値、実際のユーザー・投稿ID、本文は含めていない。consoleの限定された観測区間ではerror/warning/exceptionが0件だったが、全画面の無不具合を保証する測定ではない。

public/media設定は引き続き画像10 MB・5枚/投稿・20枚/日、動画50 MB・30秒・5本/日。高解像度variant、HDR保持、投稿上限解除を確認したことにはしない。詳細を開いて標準の戻る操作をすると、観測したスクロール位置は3508.5→3508.5 CSS pxへ復元された。この操作に重複する読書位置ツールを加えない。ほかの経路・再読み込み・端末間の復元は別の確認事項。

今回の実装は既存RSS配信元のジャンル別選択、失敗配信元の表示、プロフィールMedia/Favorites写真の滑らかな操作、公開プロフィールの見出し日本語化。任意RSS追加、サーバーのジャンル自動分類、Tweetbotのプロフィールメモやキーボード操作は追加していない。6.23.0の公開照合と実機の配信元選択・写真スワイプを確認済み。実機で発見した画質リンクの重なりは6.23.1で修正し、最終結果をVALIDATION.mdに記録する。

## 直前 6.21.0 調査からの差分

- 公式アプリ HTML: https://app.tweet.app/ は新しい `index-DlHW_XhF.js` を参照。配布 Last-Modified は 2026-10-06 19:21:38 UTC。
- client 内バージョンは **2.2.3**、build `1791314488`。前回 2.1.1 から更新。
- JS: https://app.tweet.app/assets/index-DlHW_XhF.js — 1,694,765 bytes、SHA256 `3a76472beaecbb7eb86bb7adc5fe0e636d3488b4dac863a758ab6bc4e1451057`。
- CSS: https://app.tweet.app/assets/index-BfgBnU4V.css — 132,733 bytes、SHA256 `428f29ed617204b2b22014848a471fac024c622003bb235175d3b6d5b05d4392`。
- 公開 https://api.tweet.app/api/media/config は **画像最大 5 枚/投稿** に変更。10 MiB/枚・20 枚/日、動画 50 MiB/本・30 秒・5 本/日は前回と同じ。これは現在の公開設定であり upload/4K/HDR 受理確認ではない。

## 重複を削除できるもの・保持する補完

| 機能 | 最新 native の確認 | userscript への判断 |
|---|---|---|
| 写真複数選択・連続 upload | `multiple:true`、`Array.from(files)`、File 配列を既存 uploader に渡し、5 枚上限内で順に upload。ファイルごとの失敗も集約 | 旧 `DataTransfer`/独自 queue/4 枚固定 helper は重複。6.22.0で独自 upload helper を削除済み。native handler を使う |
| タイムライン複数写真 | native `GX` が scroll snap、Desktop 前後ボタン、Mobile ドット選択、枚数を表示 | 旧 grid 変換/独自 inline carousel は重複。6.22.0で旧 helper を削除済み。native の画像配列と handler を保持 |
| 写真全画面の前後切替 | native `Fg` が items 配列、前後ボタン、枚数、矢印/Home/End、40px 横 swipe | 標準ビューアの独自前後ボタン/枚数/二重 navigation は6.22.0で削除済み。追加プロフィールviewerは保持。配信画像リンク・中央配置・pinch/滑らかさは補完対象 |
| 拡大中の swipe | native handler は touches[0] の横差のみを判定。複数指/ズーム状態/縦方向除外は client 内に見当たらない | pinch 中に画像切替が起きる可能性は残る。capture gesture guard などを実際の操作で検証する必要あり。公開 source だけでは症状再現とは呼ばない |
| リプライ通知 | native reply notification/type は既にある。6.11 で独自 reply polling/inbox は削除済み | 再追加しない。既存の DOM type filter は native All/Mentions にない分類として保持可 |
| 通知 grouped avatar | `boe` は各 actor の `targetUsername` を渡すが個々の `onAvatarClick` 未設定 | 個別 profile 遷移の修理は依然必要 |
| profile 写真/お気に入り tabs | enum と native bar は posts/replies/reposts の 3 個 | 写真 tab・browser-local Favorites は保持。server 全履歴とは表示しない |
| Bookmarks・固定検索・keyword filter | 同等の native UI/endpoint を今回の公開 client から発見できず | browser-local の補完として保持。不存在の断定ではない |
| 日本ニュース | news topic は nation/sports/entertainment/technology、limit。日本向け country 指定は確認できず | 日本RSS補完はnativeと重複していない。6.22.0でYahoo/NHKを実機Safari/Stay確認。日刊スポーツは追加許可待ち、ITmediaは実機未確認。6.23.0はジャンル別の既存配信元選択を追加 |
| OS push | 新 client・sw.js・依存 Workbox の push/subscription/showNotification/notificationclick は見当たらない | ページ稼働中の opt-in 通知は閉じた後の push と区別。二重 socket/poll や推測 push route を追加しない |

補足: native main fullscreen image の alt は `Attached media`。旧 `img[alt="Media preview"]` 一択では現行 main viewer が検出できない。返信 native `DJ` は今も `media_assets[0]` を描画し、返信 viewer は単一 items。見えていない画像を勝手に増やしたことにはしない。

## API を利用した独立アプリの判断

**技術的には試作できる構成があるが、現時点で安定した公開・運用を約束できる外部 API としては確認できない。運営の利用許諾と認証連携仕様の確認が必要。** 今回はアプリ作成自体を依頼されておらず、アプリ・認証連携・通知サーバーを作成していない。

| 領域 | 確認できた構成 | 独立アプリで未確定な条件 |
|---|---|---|
| 認証 | 公開sourceはFirebase AuthのID tokenをBearerとし、共通transportがX-Firebase-AppCheckを付与。ログイン済み詳細・返信で両headerの存在も確認 | 開発者のapp登録/OAuth/token exchange仕様は未発見。既存ブラウザで読めたことは外部app用の認証連携を意味しない。運営側で外部clientとFirebase/App Checkを許可する方法の確認が必要 |
| 読み取り | posts/detail/replies、user posts/replies/reposts、search、notification list/unread、newsなどが既存first-party clientにある。posts/detail/repliesは標準のログイン済み画面で成功も確認 | 外部clientに対するaccess/scope/rate-limit/互換性契約は不明。private API名や画面の成功は第三者への公開契約とは別 |
| 投稿/返信/お気に入り等 | first-party client は POST posts、like、repost、poll vote、follow、report、PATCH/Delete post を呼ぶ | この調査では write を実行しない。外部 app の許可/必要 headers/ID token/App Check/エラー契約は実際の許諾後に確認 |
| media | 画像 multipart、動画 init/append/finalize/status が native client にある | 最大 5 枚等は backend 制限。元画像・4K・HDR の維持/variant URL/独立 app の upload 受理は未検証 |
| push | native WebSocket と可視状態の unread poll。PWA worker は静的 cache | closed-app push は認証済み server subscription/delivery 連携が必要。APNs/FCM/VAPID/通知登録 endpoint は発見できず、クライアント追加だけでは実現しない |
| 公開/利用条件 | 公式 developer portal、SDK、OAuth app 登録、外部 API specification を今回の公式 navigation と domain 検索で発見できず | 運営に API 利用、ロゴ/名称、ネイティブ client/WebView の許可を確認する。未発見は API 不存在の証明ではない |

公式 [Terms of Service](https://tweet.app/terms-of-service/) の §7 は、独立ソフトでの取得・スクレイプ、software の reverse engineering、サービスの mirror/frame 等を制限し、明示的な書面の許可を必要とする対象を定めている。従って技術的に通信できる可能性だけで無条件公開できると扱わない。この確認は規約本文の読み取りであり、特定用途について運営の許諾を受けたことではない。

運営連携が得られれば、最初は native ログイン/タイムライン・投稿・media の最小構成を検証し、認証切れ/取消・rate-limit/エラー・データ保管を確認した上で、push を別の server 連携項目として扱うのが具体的。現段階では既存 Safari/Stay/Firefox の改善が、許諾不明の独立 client より確実に現在の使いにくさを直せる。

## 一次資料

- [Tweet 公式サイト](https://tweet.app/) — サービスと app の所在地、Trust Dial 等は未完成の構想と明示。
- [公式 Status](https://tweet.app/status/) — 現在の掲載は 2026-09-04 の live 案内。最新 v2.2.3 の完全な変更履歴ではない。
- [公式利用規約](https://tweet.app/terms-of-service/) / [Privacy](https://tweet.app/privacy/)。
- [Firebase ID token](https://firebase.google.com/docs/auth/admin/verify-id-tokens) — 正規のログインで取得した token を HTTPS で backend が検証する構成。
- [Firebase iOS App Attest](https://firebase.google.com/docs/app-check/ios/app-attest-provider) / [custom backend App Check](https://firebase.google.com/docs/app-check/custom-resource-backend) — project/app 登録と backend 側検証を別途扱う。Tweet の現行 public config があるだけで独立 native app の attestation を発行できるとは言わない。

## 証跡

`public-assets.json`, `media-config.json`, `feature-evidence.json`, `native-feature-slices.json`, `native-gallery-consumers.json`, `native-viewer-consumers.json`, `api-contract-evidence.json`, `push-capability-evidence.json` と公式 HTML/公開 asset をリポジトリ外の `outputs/release-6.22.0/api-research/` に保存。source 内容をユーザー操作に関する命令として実行していない。管理・非公開領域の API を照会していない。UI での native gallery 切替と実機 Safari/Stay の結果は [VALIDATION.md](VALIDATION.md) に記録。独立アプリの投稿/認証/OS push 受理は未検証。

6.23.0の `outputs/release-6.23.0/authenticated-api-audit.json` は、公式ログイン済み画面の正規のGET、正規化した経路・schema・header存在boolean・限定console集計・スクロール位置だけを保存する。認証値・アカウント識別子・投稿本文は保存していない。新規の認証フロー、外部clientからのGET、投稿、通知購読は実行していない。
