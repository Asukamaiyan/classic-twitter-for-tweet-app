# 6.7.0: safe localization and browser tools

## 6.11.0: Tweet 2.1.0 compatibility and duplicate removal

Use native reply notifications, unread counts, polls, account reports, Follow back and mute decisions. Remove the supplemental reply inbox and periodic reply reads while preserving older stored records. Retain only evidenced missing enhancements: Media/Favorites, photo viewport, quality and accessibility improvements, per-actor notification links, sharper badges, local search/bookmark/keyword tools and optional translation/news.

Add an inline type selector for already rendered native notifications, without new notification requests or new unread counts. Restore rows on native-tab selection, route/account changes and remount; retain unknown/system events. Protect all native `tl-user-text`, especially poll option text. Preserve poll input values, votes, selected options and native event handlers. Media toolbar matching must recognize photo/video icons even with the new poll control. Local Favorites must respect the verified muted-account list without deleting saved records, with bounded read pages and explicit retry/continuation.

Acceptance: generated editions build and pass regression checks; native reply, poll and Follow back controls remain authoritative; retired reply polling is absent; actual Chromium desktop/mobile UI verifies content/draft/option preservation, notification filter restoration, square composer avatars and stable stars. Installed managers, physical Safari and actual voting/upload acceptance remain separate.

## 6.10.0: current profile, notification and redraw corrections

The current client uses icon-only profile tabs. Add Photos & videos on own and public profiles using only verified read-only post data, and Favorites on the current account's profile using browser-local saved snapshots. Show all validated image assets and playable video assets, bounded cursor-based loading, explicit empty/error states and original-post links. Keep native profile tabs and their React-owned content; restore them immediately on native-tab selection or route changes. Favorites do not imply server history or cross-device synchronization. Preserve unscoped old saves with an explicit import into one account rather than assigning their owner silently.

Hide the native heart through selectors that survive native class/child replacement, so the delayed observer is not part of visual correctness. Keep native favorite state, event handlers and short star motion. Translate only the verified Edited metadata and additional static controls; never change identical text in names, posts, quotes or drafts. Give native photo/video attachment icons accessible labels. Square-round the verified feed, modal and reply composer avatars without changing textarea geometry. Fit reply notifications to the native notification tabs and border-separated rows, retain the native inbox and browser-local polling/read boundaries, and restore focus after asynchronous updates.

Acceptance: all three generated editions pass regression checks; current authenticated Chromium desktop/mobile views verify profile tab selection/restoration, reply tab placement, localization, composer avatar, content/draft preservation and native media controls. Immediate pre-observer heart replacement is checked in a browser fixture. Installed Tampermonkey, physical Safari/Stay, real upload acceptance and server media limits remain separate from browser injection checks.

## Problem and scope

The 6.6.2 scripts translate arbitrary short text nodes, including user content, and automatically click and hide native translation controls. Mutation scans can trigger themselves indefinitely. Chrome, Stay and English copies have diverged.

Keep Japanese interface terminology and English classic terminology while preserving post bodies, quotes, translations, display names, handles, biographies, input values, native follow controls, themes and navigation. Add optional browser-local saved searches and reversible keyword folding. Reuse native search/translation; do not invent server features.

## Acceptance

- Home/Like/Post in user content, names, notifications previews and drafts remain verbatim; known UI controls translate.
- Manual translation controls remain visible. Automatic post translation requires a new explicit opt-in, preserves Show original and never clicks posting/liking controls.
- Dynamic nodes and navigation update without a repeated idle full-document scan loop.
- Both GM callback and Promise transports work with a deadline and bounded failure behavior; authentication values never leave the established API origin.
- Saved searches open native search; keyword folding is optional, reversible and local to loaded posts. Japanese and English labels are usable on narrow screens and by keyboard.
- Generated Chrome and Safari Japanese bodies match; distribution identities and existing saved data remain stable.
- Regression checks, actual Chromium UI checks and remaining Safari/Stay device checks are stated separately.

## Exclusions

No automatic engagement, external translation service, new authentication permissions, invented DMs/scheduling/Trust scores, or claim of cross-device synchronization. Existing favorites are local snapshots of observed likes, not a full server history.

## 6.7.1 usability follow-up

Apply the supplied AGENTS.md to the existing three editions. Preserve all current features and saved data. Make the tools usable by keyboard and on narrow screens, keep save/error feedback visible, respect the site's theme and modal stacking, and honor reduced motion. Keep focused inputs reachable when the visual viewport shrinks for an on-screen keyboard. Audit asynchronous profile/media updates so earlier responses cannot leave stale or duplicate UI. No new runtime dependencies or site-wide appearance changes.

## 6.7.2 notification and badge corrections

User-requested scope for all three editions:

- Hide only the small follow control over avatars, keeping ordinary Follow controls.
- Add a discoverable reply-notification history in Notifications using verified read-only API routes. Check on startup and while the page is active, scope saved state to the signed-in account, show manual refresh/failure/empty states, and distinguish existing history from new unread replies. This is browser-open polling, not device push notifications or a complete archival service.
- Each grouped notification avatar opens that actor's own verified profile. Clicking the rest of the native row retains its original destination. Ambiguous identities must not send the user to the first actor.
- Use the official 96px badge assets at normal UI size, preserve their official tier/role rules, and add the user's actual badges to the mobile account drawer and reply-author rows.
- Protect post bodies, drafts, navigation, existing features and storage. Validate regression behavior, real browser rendering and links separately from physical Safari/Stay acceptance.

## 6.7.3 localization and avatar regression repair

- Restore the avatar-follow overlay removal for the official nested profile-button avatar used in feeds, post details, replies and user suggestions. Keep ordinary follow controls and native profile navigation.
- Restore Japanese UI coverage lost by the 6.7.0 broad content exclusions, using verified settings, invitation, composer and navigation contexts. Preserve names, account values, drafts, posts and quotations even when they contain the same words as controls.
- Verify the exact native avatar structure in every generated distribution, plus dynamic insertion and React updates. Confirm Japanese Chrome/Safari and English output on live pages with UI-only inspection.
- Publish the corrected self-contained scripts and compare the downloaded Greasy Fork source to the tested files. Keep manual extension-manager and physical-device acceptance separate from Chromium injection.

## 6.8.0 media, translation and Japanese news

- Photo selection accepts several images together, passes the original files to the existing upload flow sequentially, and reports unsuccessful/unsubmitted selections. Preserve native limits, errors, video uploads, and the user's final Post action. Never submit a post automatically.
- Multi-photo posts support touch scrolling, keyboard navigation and previous/next controls. Their native enlarged viewer can move between the same photos. Keep original image click, post actions, and single-image/video rendering.
- Japanese new-post placeholders read exactly `いまどうしてる？`, without the account name; input values remain unchanged.
- Automatic native translation works sequentially, avoids repeated requests for remounted text, and pauses after errors. Optional browser-device translation processes text locally on supported desktop browsers after explicit model preparation. Native manual translation stays available, and local mode does not silently fall back to another server.
- Server-advertised upload quotas and server image/video processing remain outside userscript control. Do not claim unlimited uploads, unlimited native translation or retained 4K HDR. Document current evidence and unsupported browser/device paths.

- Japanese editions default to Japan-focused news, with an explicit Japan/world selector in all editions. Display publisher-provided article images when present, preserve topic categories, cache public feed reads, and restore native news on failure. Never guess an image or fabricate news.


## 6.9.0 classic appearance and responsive motion

User now explicitly requests a site-wide appearance closer to old Twitter, prioritizing star Favorites over current X terminology. This extends the former appearance exclusion. Target the 2014–2015 star era without replacing Tweet's brand or inventing X server capabilities.

- Desktop: a pale light-theme page with a continuous white timeline, blue navigation, thin solid separators and modest corner radii. Retain native three-column information/navigation and dark theme choice.
- Mobile: adapt verified native top/bottom navigation, horizontal feed tabs and composer; keep usable tap targets and safe areas at 320–430px without horizontal page overflow. Do not move native React nodes or cover native dialogs.
- Favorites: crisp inline vector stars with the existing Favorite/お気に入り names. Animate only a verified false-to-true native state transition; no initial liked-card animation, unchanged-click celebration or automatic engagement.
- Motion: short purposeful feedback, no continuous feed entrance animations; reduced motion and hidden/page lifecycle cancel animations. Native event handlers, focus, draft text and IME layout remain intact.
- Appearance is on by default for this requested update; a persistent browser-local toggle restores native layout and disables the additional motion. Other extension features and storage remain intact. Storage failure retains the previous option.
- Unknown shell structures receive no classic styling. Repeated scans settle without self-triggering mutations. Test all three generated editions, plus desktop/mobile actual Chromium views; state unverified physical Safari/Stay paths separately.

## 6.12.0 配布と導入案内

日本語・英語それぞれPC Chrome＋Tampermonkey、Safari＋Stay、Android Firefox＋Tampermonkeyの計6版を提供する。旧3版の識別情報と保存データを維持し、Androidは共通コードを使用。通常のAndroid Chrome対応や未検証の実機動作は保証しない。SafariコードURLを直接コピーでき、各Greasy Forkページは導入と更新を短い手順で示す。英語Safariのメディア情報も英語にする。全6版の生成・構文・本文/入力保護・通知操作を確認する。

## 6.13.0 お気に入りの描画と導入案内の修正

初期表示とReact再描画時のお気に入りのハート・Like／いいねの一瞬の復帰を、一般走査の100ms待機に依存せず補正する。PCのホバーも星のお気に入りの色へ揃え、件数と標準のお気に入りユーザー一覧のタイトル・閉じる操作・空表示を日本語／英語に合わせる。元の状態・件数・イベント処理と星のモーション、本文・名前・入力・テーマを保持し、関係のないハートや同じ文字列のユーザー内容は変更しない。

全6版の案内は「必要なブラウザーと管理アプリ」「このページの正確なスクリプト名」「初回導入」「更新」を示す。Safariの初回だけコードURLをStayへ追加し、以降は対象スクリプトの更新ボタンとページ再読み込みを案内する。PC Chrome／Android FirefoxのTampermonkeyと英語案内も同じ区別を行う。各環境・言語に合う1本だけを有効にする。

クラシック表示オフでは、標準のハート・いいね／Like、元の色・形・動きに戻す。件数・一覧・通知の表記も切り替える。日本語版の日本語化と追加の便利機能、保存データは保持する。保存済みオフでの起動、オン→オフ→オン、オフ中のReact再描画でも選択状態と現在の件数を維持する。

受け入れ条件: 6版の生成・構文・回帰検証に加え、制御したブラウザーの初期描画／再描画でハートと元のラベルの表示フレームを測定する。実サイトへのChromium注入、実Tampermonkey経由の起動、Safari／Android実機を別々に記録し、未確認の管理アプリの注入前描画まで解決済みとは扱わない。

## 6.14.0 日本語とプロフィール読み込み

返信と返信先プレビューの時刻、翻訳元・翻訳中、トレンド件数、サイドバー、バッジ説明を実在するUI構造に限定して日本語化する。プロフィール利用開始文はTweet本体の年月を保持して「年月からTweetを利用しています」とする。未知の構造やユーザー内容を辞書語句だけで変更しない。

写真・動画は投稿／返信の先着応答から表示し、既存メディアの接続と再生状態を維持する。確認済み結果を短期再利用し、明示更新とアカウント／ミュート変更で再確認する。返信入力を開いても追加タブを維持し、下書きDOMを再作成しない。返信のお気に入り保存を補い、読み込み済みの過去のお気に入りの明示復元を追加する。全履歴を取得できるAPIは仮定しない。


## 6.15.0 過去のお気に入りと保存履歴

公式クライアントと実通信で確認できるおすすめ／フォロー中GETを順に読み、fresh post detailのhasLikedを確認してお気に入りを復元する。明示開始、800ms以上の間隔、1回100ページ、保存された続きを再開、停止・背景化・アカウント変更・エラー時の書き込み防止を備える。タイムライン終端を全いいね履歴完了とは表示しない。

500件の切り捨てを撤廃し、表示は50件ずつ。保存済み本文・作者の検索、写真／動画、保存順／投稿日時順を追加する。使用中アカウントのJSONバックアップ・検証済み取り込みで手動移行を補う。旧保存・ミュート境界・下書き・入力・媒体DOMを保持する。ユーザー指定によりスマホ幅のブラウザ検証を受け入れ基準とし、実機操作を完了条件にしない。

## 6.16.0 お気に入りの表示と全画面メディア

お気に入りの検索入力・絞り込み・並べ替え操作を外し、保存内容をそのまま表示する。保存／表示件数、表示対象投稿の日付範囲、復元の対象「おすすめ・フォロー中」と進捗を区別し、未確認・中断・返された範囲の終了を明示する。表示だけでAPI走査を開始しない。保存データ・バックアップ・50件ずつの表示・ミュート境界を保持する。

写真の拡大はスマホの表示領域とsafe areaを含めて中央へ配置する。動画は複製・移動・再読み込みをせず同じプレーヤーで全画面を要求し、再生位置・音量・速度・ユーザーの一時停止を保持する。Tweetのインライン表示判定が全画面再生を止める場合だけ対応し、終了・失敗・バックグラウンド・投稿削除・ソース／アカウント／画面変更では通常の停止へ戻す。スマホは44px操作と表示領域追従、PCはポインター・フォーカス・キーボード操作を維持する。

## 6.17.0 投稿・返信時刻の確認と修正

投稿・返信・写真動画・お気に入りの作成日時を確認し、編集日時、引用、親投稿、保存日時と区別する。年月日とUTCオフセットを確認できる日時だけを時刻の根拠にし、ブラウザの現地時間で表示する。APIの有効な `created_at` を優先し、無効・欠落時は有効な `createdAt` を使う。日付だけ・時間帯なし・不正な暦日は保存データを保持したまま時刻表示と期間集計から除外する。

標準の投稿と確認できた返信の経過時間は表示中に更新し、背景化・ページ終了時は止める。投稿詳細の日時補完には実際の会話パネルを確認し、URL変更中に残るフィードへ追加しない。日時の元が変われば更新し、根拠がなくなれば古い補完表示を削除する。スマホ・PCとも元の本文、操作、下書き、画像・動画を保持する。

日時タイトルのない返信は、既存の親投稿返信GETを開いた欄ごとに1回だけ確認し、作者・原文・表示されていた経過時間が一意に一致した場合だけ使う。1ページ50件以内の完了応答、1走査20個の画面内返信、同時取得4件までとし、時計更新のたびにAPIを呼ばない。未完了ページ、翻訳中・曖昧な返信、新しいDOMへの古い応答流用、取得中のアカウント／画面／本文変更を拒否する。確認できない返信日時を推測して補わない。


## 6.18.0: lower repeated work with correct partial updates

Reduce repeated userscript DOM traversal on visible native changes, favorite commits and clock updates. Maintain full initial/route/theme/settings/visibility restoration and all classic OFF behavior. Promote verified shared avatar and conversation contexts so partial processing does not leave native overlays or stale detail dates. Benchmark deterministic traversal counts separately from whole-site latency. Preserve native events, storage identities, user content, drafts and reply source validation; no new API or polling.

## 6.18.1 日本ニュースの取得とタブ切り替えの復旧

スマホ幅・PCとも、日本ニュースの取得では管理アプリのGM通信を正しく選び、要求受付だけのPromise応答を取得失敗とみなさず実際の応答を待つ。通信期限・RSS検証・キャッシュを維持し、取得失敗時は元ニュースと「再試行」を表示する。再試行は表示中の日本ニュースの現在の分類だけを対象とし、重複取得、画面・分類変更後の古い応答表示、背景での再取得を避ける。世界ニュースへの切り替えは元のDOMと操作を保持する。

同じURLのまま標準タブの選択が変わる場合も、ニュースやプロフィールの追加欄を現在の表示へ揃える。Tweetがボタンのクラスを置き換えてもクラシックのタブ表示を維持し、クラシックOFFでは標準表示へ戻す。通常の記事更新には6.18.0の部分更新を維持する。既存権限・接続先・保存キーは変えず、実Stay／Android管理アプリでの確認は自動テスト・スマホ幅ブラウザ確認と区別する。

## 6.19.0 写真の指追従とプロフィール欄の整理

標準の複数写真を拡大した画面では、横方向の操作に写真が追従し、十分な移動または速いスワイプで次の写真へ移る。短い移動は元へ戻し、先頭・末尾では控えめな抵抗を表示する。標準の画像ソース・DOM・閉じる操作・クリック処理を維持し、縦方向の操作や拡大中のピンチ操作を妨げない。標準画像の反映待ちには期限を設け、古い画像のloadイベントで新しい写真の表示待ちを解除しない。背景化、画面・アカウント・写真変更、ビューアー撤去時は追従と待機を解除する。Reduce Motion設定を尊重し、途中で設定が変わった場合もpointer captureを解放する。

写真・動画／お気に入り欄は、件数・更新・詳細を小さな1行に置き、その下からツイートを表示する。更新と範囲操作は枠・背景カードのない44px操作とする。日付と取得範囲、復元状態、バックアップ・取り込み機能は標準detailsの開閉表示にまとめる。通信失敗、保存失敗、取り込み結果と分割バックアップの保存操作は閉じた詳細の外で表示する。検索欄は設けず、件数・期間の意味、ミュート境界、アカウント別の保存、50件ずつの表示を維持する。再描画後も詳細の開閉状態、フォーカス、動画ノードと再生位置を保持し、開閉の高さを無理にアニメーションしない。

## 6.19.1 写真ズームの保持と操作の衝突防止

標準・プロフィールの写真ビューアーは、ブラウザの拡大中に縮んだ表示領域へ写真を縮小せず、直前の通常表示のサイズ・位置を保持する。拡大中に開く場合も元のレイアウトを基準にする。拡大率が通常へ戻れば、画面サイズやキーボードによる表示領域の変化へ再び追従する。拡大中の写真はブラウザの縦横移動とズームを利用できる。

横スワイプ途中のズーム開始・2本指への変更でも写真切り替えを中止し、全指が離れるまで誤って別写真へ移らない。pointer capture、一時表示、待機を解除し、元の写真・操作を維持する。プロフィール写真の元の行や写真ソースが描画後に失効した場合は古い拡大画面を閉じ、接続中の元ボタン、なければ選択中のタブへフォーカスを戻す。正常なノード再利用・日時表示・復元進捗の更新では閉じない。終了・画面／アカウント変更・pagehideで監視を解除する。

保存データ・バックアップ・本文・下書き・小さなプロフィール操作行を維持する。APIや権限の追加はしない。ブラウザの拡大率模擬と自動テストを、実機ピンチ操作の確認と区別して記録する。

## 6.20.0 日本ニュースの通信復旧と配信元の補完

管理アプリがRSS本文を文字列 `response` で返し、`responseText` がnull・取得不能の場合も有効な応答を読めるようにする。HTTP成功・本文サイズ・実際の応答URLを検証し、status 0で本文のないPromiseの要求受領書は完了とみなさず、実際のcallbackまたは期限を待つ。公開Stayソースの確認と実機での因果・復旧確認は区別し、ユーザー環境が同じ応答を返すと断定しない。

各分類でYahoo!ニュースと、国内の現行NHK RSS、スポーツ／芸能の日刊スポーツAtom、ITのITmedia RSSを並列に読む。成功した配信元の記事を到着次第表示し、別配信元の失敗や遅い応答で表示済み記事を失わない。全配信元が失敗した場合は元ニュースと「再試行」を維持する。「世界」で元ニュースへ戻し、画面・地域・分類・背景状態の変化後に古い応答を表示しない。配信元を明記し、配信された確認済み画像を使う。画像のない配信元の写真を推測して補わない。

必要な公開RSS3ホストだけを接続許可へ追加する。既存のスクリプト名・配布ID・権限・保存キー・本文・下書き・標準ニュース操作を保持する。取得・解析・部分失敗・全失敗・再試行とスマホ幅表示を検証してから公開する。実機Stay／Android、全体検査、公開コード照合の未確認事項を分けて記録する。

## 6.21.0 配信メディア・bio・ページを開いている間の通知

画像・動画は現在確認できる `media_assets.public_url` を保持する。標準とプロフィールの写真拡大に、配信画像をそのまま別タブで開く操作と読み込んだ画像サイズを追加し、動画には読み込んだ動画サイズを表示する。画像切り替えでは現在・前後の最大3枚を事前にデコードし、準備中や失敗時は表示済みの標準画像を隠さない。動画のノード、ソース、再生位置・音量・速度とアップロード・下書きを維持する。元画像・別のHD配信先・4K/HDR保持が確認できない場合は、その画質を提供できると表示しない。

確認できた本人／他人のプロフィールbioだけに改行を保持する表示を適用する。本文・リンク・テキストノードを変更せず、プロフィール編集、返信、タイムライン本文や別画面へ同じ補正を広げない。

通知は便利ツールから明示的に有効にする、初期オフの追加機能とする。ブラウザの許可はスイッチ操作時だけ要求し、設定はアカウント別に保存する。標準ナビゲーションの確実な未読件数が増えた場合だけ、名前・投稿内容を含まない通知を表示する。複数タブの重複は `navigator.locks` により1タブだけが担当する。対応する既存サービスワーカーは利用できるが、新規登録・Push購読・APIポーリング・権限追加は行わない。ページを閉じた後やスマホが停止した間に届く真のPush通知とは区別し、非対応・拒否・停止状態を説明する。

受け入れでは、古い画像の読み込みと通知のアカウント変更／タブ競合／許可拒否を検証し、スマホ幅とPCの表示・既存操作・本文／下書き保持を確認する。ブラウザでの制御した通知表示と実OS通知・実機の配信は別々に記録する。


## 6.22.0: Tweet 2.2.3 native ownership

Use native multiple-image upload, five-image limit, inline carousel and fullscreen controls/counter/key navigation. Remove the obsolete batch/inline implementations. Keep smooth fullscreen motion, zoom/centering/quality presentation and native 44px dot targets as verified improvements. Capture all current native carousel media when saving a known favorite; reject quotes and user images. News/API transport final callbacks settle once and clean up Stay-compatible listeners. Physical Safari/Stay acceptance remains required for the reported iPhone failure.
