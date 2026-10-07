# Tweet 最新 API・重複機能・独立アプリ可否の確認

確認日時: 2026-10-07 18:00 JST 前後。公開の公式 HTML・JavaScript・CSS・Service Worker・media config・公式サイト/規約を読み取り。認証セッション、トークン、アカウント固有データは取得せず、投稿/アップロード/お気に入り/フォロー/通知権限の変更は行っていない。これは公開 client 観察であり、独立アプリの認証・書き込み受理テストではない。

## 直前 6.21.0 調査からの差分

- 公式アプリ HTML: https://app.tweet.app/ は新しい `index-DlHW_XhF.js` を参照。配布 Last-Modified は 2026-10-06 19:21:38 UTC。
- client 内バージョンは **2.2.3**、build `1791314488`。前回 2.1.1 から更新。
- JS: https://app.tweet.app/assets/index-DlHW_XhF.js — 1,694,765 bytes、SHA256 `3a76472beaecbb7eb86bb7adc5fe0e636d3488b4dac863a758ab6bc4e1451057`。
- CSS: https://app.tweet.app/assets/index-BfgBnU4V.css — 132,733 bytes、SHA256 `428f29ed617204b2b22014848a471fac024c622003bb235175d3b6d5b05d4392`。
- 公開 https://api.tweet.app/api/media/config は **画像最大 5 枚/投稿** に変更。10 MiB/枚・20 枚/日、動画 50 MiB/本・30 秒・5 本/日は前回と同じ。これは現在の公開設定であり upload/4K/HDR 受理確認ではない。

## 重複を削除できるもの・保持する補完

| 機能 | 最新 native の確認 | userscript への判断 |
|---|---|---|
| 写真複数選択・連続 upload | `multiple:true`、`Array.from(files)`、File 配列を既存 uploader に渡し、5 枚上限内で順に upload。ファイルごとの失敗も集約 | 旧 `DataTransfer`/独自 queue/4 枚固定 helper は重複。native handler を使い、独自 upload helper は削除できる |
| タイムライン複数写真 | native `GX` が scroll snap、Desktop 前後ボタン、Mobile ドット選択、枚数を表示 | 旧 grid 変換/独自 inline carousel は重複。native の画像配列と handler を保持 |
| 写真全画面の前後切替 | native `Fg` が items 配列、前後ボタン、枚数、矢印/Home/End、40px 横 swipe | 独自前後ボタン/枚数/二重 navigation は削除対象。高画質リンク・中央配置・pinch/滑らかさは補完対象 |
| 拡大中の swipe | native handler は touches[0] の横差のみを判定。複数指/ズーム状態/縦方向除外は client 内に見当たらない | pinch 中に画像切替が起きる可能性は残る。capture gesture guard などを実際の操作で検証する必要あり。公開 source だけでは症状再現とは呼ばない |
| リプライ通知 | native reply notification/type は既にある。6.11 で独自 reply polling/inbox は削除済み | 再追加しない。既存の DOM type filter は native All/Mentions にない分類として保持可 |
| 通知 grouped avatar | `boe` は各 actor の `targetUsername` を渡すが個々の `onAvatarClick` 未設定 | 個別 profile 遷移の修理は依然必要 |
| profile 写真/お気に入り tabs | enum と native bar は posts/replies/reposts の 3 個 | 写真 tab・browser-local Favorites は保持。server 全履歴とは表示しない |
| Bookmarks・固定検索・keyword filter | 同等の native UI/endpoint を今回の公開 client から発見できず | browser-local の補完として保持。不存在の断定ではない |
| 日本ニュース | news topic は nation/sports/entertainment/technology、limit。日本向け country 指定は確認できず | 日本 RSS 補完は native と重複していない。Yahoo/NHK は実機 Safari/Stay で表示を確認。日刊スポーツは追加許可待ち、ITmedia は実機未確認 |
| OS push | 新 client・sw.js・依存 Workbox の push/subscription/showNotification/notificationclick は見当たらない | ページ稼働中の opt-in 通知は閉じた後の push と区別。二重 socket/poll や推測 push route を追加しない |

補足: native main fullscreen image の alt は `Attached media`。旧 `img[alt="Media preview"]` 一択では現行 main viewer が検出できない。返信 native `DJ` は今も `media_assets[0]` を描画し、返信 viewer は単一 items。見えていない画像を勝手に増やしたことにはしない。

## API を利用した独立アプリの判断

**技術的には試作できる構成があるが、現時点で安定した公開・運用を約束できる外部 API としては確認できない。運営の利用許諾と認証連携仕様の確認が必要。** 今回はアプリ作成自体を依頼されておらず、アプリ・認証連携・通知サーバーを作成していない。

| 領域 | 確認できた構成 | 独立アプリで未確定な条件 |
|---|---|---|
| 認証 | Firebase Auth の ID token を Bearer として first-party fetcher に渡し、共通 transport は X-Firebase-AppCheck を付与 | 開発者の app 登録/OAuth/token exchange 仕様は未発見。ブラウザ token をコピーして恒久的に使用しない。運営側で外部 client と Firebase/App Check を許可する方法の確認が必要 |
| 読み取り | posts/detail/replies、user posts/replies/reposts、search、notification list/unread、news などが既存 first-party client にある | 外部 client に対する access/scope/rate-limit/互換性契約は不明。private API 名が存在することと第三者に公開された API は別 |
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
