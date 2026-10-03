# 6.7.0: safe localization and browser tools

## 6.11.0: Tweet 2.1.0 compatibility and duplicate removal

Use native reply notifications, unread counts, polls, account reports, Follow back and mute decisions. Remove the supplemental reply inbox and periodic reply reads while preserving older stored records. Retain only evidenced missing enhancements: Media/Favorites, photo batch selection and carousel, per-actor notification links, sharper badges, local search/bookmark/keyword tools and optional translation/news.

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
