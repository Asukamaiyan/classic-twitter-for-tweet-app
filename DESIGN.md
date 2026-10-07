# Implementation boundaries

Source templates in `src/ja.js` and `src/en.js` embed shared network, runtime and local-tools modules at build time. Greasy Fork receives self-contained files without remote code loading. A build check ensures all six distributions remain reproducible.

Localization uses structural UI allowlists and content exclusions. Notification action fragments are handled within each row so neighboring actors and previews cannot be merged. React retains ownership of its controls and text containers.

The observer disconnects during synchronous patches, coalesces mutations and observes only relevant text/attributes. Asynchronous profile patches are idempotent. No three-second full-document polling. Background reply checks pause when hidden and remain read-only.

The shared network module accepts GET requests to the established API origin only, handles callback/Promise userscript managers, closes authentication databases, bounds waiting and backs off failed profile lookups. It does not create credentials or log tokens.

Local tools store only user-entered search/filter settings. Native search is populated through ordinary input events. Keyword filters fold already-rendered post content with an explicit reveal control; they do not change server notifications or recommendations. Native post translation stays under user control and follows the service's browser-language behavior.

The 6.7.1 tools panel remains non-modal. Its trigger precedes the panel in DOM order, opening moves focus to its close control, and Escape returns focus to the trigger. A fixed header and status footer surround the scrolling form sections. Verified tweet.app theme tokens supply surface, input, text and feedback colors; z-index stays below native z-50 dialogs. A short local entrance transition is disabled under reduced motion. VisualViewport resize/scroll updates panel bounds without changing page zoom or native navigation.


Version 6.7.2 embeds three additional shared modules: `navigation`, `replies`, and `badges`. Native avatar follow overlays are hidden by their verified Uo structure; ordinary follow controls remain. Notification avatars receive real profile anchors, with capture handlers stopping only the parent row's navigation. Handles come from native ARIA metadata or uniquely matching notification actors, never from display-name guesses.

The reply inbox uses authenticated GET routes from the official client. UID-scoped state separates accounts; a new inbox seeds historical replies as read and only later replies become unread. Startup and visible-page restoration trigger the same throttled checker as the 90-second interval. Latest own posts and own reply wrappers are merged, limited to 24 threads, then polled in batches of six with cursor continuation. The inline disclosure follows the visible Notifications header and never covers native rows. It retains native notification counters and does not call mark-read APIs. Browser-local read updates preserve other-tab acknowledgements.

Official badge PNGs use the verified 96px variant while preserving 18/24px layout. Supplemental drawer and reply badges follow the native membership hierarchy; account/author identity is rechecked after profile retrieval. Existing native badges are retained and upgraded without duplication. Failed image loads fall back to official/native sources. Profile controls, names and post bodies keep their original ownership and actions.


Version 6.7.3 repairs two regressions introduced by earlier narrowing: official Uo avatars can be direct images or images inside a direct native profile button, and static settings/help UI can share truncation/paragraph classes with user content. Overlay detection now handles both confirmed avatar forms without accepting arbitrary descendant images. Localization uses contextual exceptions for verified settings rows, invitation help and native composer placeholders; it does not restore unrestricted page-wide dynamic replacement. Distribution startup fixtures include the real nested profile-button structure.


Version 6.8.0 adds shared media, translation and Japanese-news modules. Photo batches serialize original File objects through the verified native image input; they wait for successful ready previews, preserve server/native errors, and never submit posts. Gallery enhancement keeps native image elements/click handlers and applies scroll-snap with accessible controls only to the observed multi-image grid. No resolution/HDR or quota spoofing is introduced.

Native automatic translation waits for the previous operation, bounds pending work, deduplicates attempts and backs off on error. Optional on-device translation uses browser capability detection and user-triggered model preparation. Its output is a separate owned region, and unavailable models do not fall back to a remote translator. Translation remains opt-in.

Japan news uses an explicit, reversible region selector. Public RSS requests omit authentication; bounded caches and error backoff avoid repeated fetching during DOM scans. Only valid HTTPS article/image URLs are rendered through DOM APIs. Native news nodes remain owned by React and are hidden only after a successful Japanese-feed response, then restored on failure or world selection. Generated editions declare the same narrowly scoped public-feed connection permission.


Version 6.9.0 embeds `classic` and `motion` shared modules. Classic styling uses markers attached only to the verified Tweet root/grid/main, native navigation, feed tabs, composer shell, primary article/avatar and action bar. Native React structure and handlers stay in place. Markers are reconciled idempotently and removed on OFF or unknown structure; styles use native light/dark theme tokens with classic #55acee blue and #ffac33 favorite gold. Composer textarea metrics stay native because its mentions overlay must stay aligned.

The visual target is the 2014–2015 star era: clear continuous timeline, thin solid rules, restrained corners and square-rounded author avatars, combined with Tweet's current responsive navigation. Main width and native sidebars are preserved. The new local appearance option uses its own versioned key, leaving favorite/reply/news/search/filter/bookmark settings untouched. It can be turned off without reloading or changing the site's theme setting.

Favorite icons are inline SVG inside an owned, aria-hidden `.ct-star` span. The original native SVG remains present with its handler-owning button and count; only its rendering is hidden. Shared state tracking animates actual false→true changes with a short 280ms scale/rotation, using Web Animations capability detection, and cancels at OFF, reduced motion or background lifecycle changes. Repeated scans and initial already-liked state do not animate. Native handlers determine the favorite result; the extension never submits engagement.

Motion study: [yui540 motion 1](https://yui540.com/motions/1) informed brief, staged feedback rather than persistent loading motion. Timing is adapted to the existing product: small star response and short color/press feedback. No remote code or artwork is copied, and no feed-wide animation delays reading or scrolling.


Version 6.10.0 makes visual correctness independent of the coalesced observer. Stable native favorite test IDs hide direct heart SVGs and provide a CSS vector fallback if React removes the motion span; native ARIA/classes determine the immediate star fill, gold and count color. Notification hearts retain their SVG node but render through a vector mask scoped to the confirmed 28px native icon structure. Verified native composer avatar selectors provide the same protection against replacement while classic appearance is enabled.

The profile module uses the current icon-only three-tab structure and the direct native identity paragraph. It adds inline Media and own-account Favorites without moving React nodes. Original selection and timeline display are restored on native tab/route changes. Media uses bounded first-party GET pages, valid HTTPS assets, native video controls without autoplay and a keyboard-accessible image dialog. UID, route, sequence and username checks discard obsolete responses. Favorites use UID-scoped storage, preserve unscoped older data behind explicit import, and retain in-memory data if storage fails.

The favorite capture module resolves a permalink-less feed card by its exact author, creation time and original body against at most three read-only author-post pages. It rejects ambiguous/deleted/reposted matches. Capture generation, current account and native state are rechecked after the asynchronous read. A short button-local observer reconciles late optimistic native rollbacks; it sends no favorite requests. Known detail cards retain their own native attachment snapshots.

Reply history is shown through an added tab in the verified native notification bar, with an inline disclosure fallback for unknown layouts. Native inbox nodes are hidden reversibly only while that tab is selected. Full-width rows use existing theme tokens, separate avatar/author/reply/parent links and official badge metadata. Background polling and native unread/read boundaries are unchanged.

Version 6.11.0 supersedes the supplemental reply design: Tweet 2.1.0 supplies native replies and correct unread counts. The entire reply module, periodic reads, extra tab and badge are removed. Old storage is retained without migration or deletion. Native notifications remain React-owned; the additional type selector sets a single reversible attribute on verified event wrappers, including expanded Follow back rows, without changing content, fetching notifications, marking read or moving event nodes. Unknown/system icons stay visible; native-tab/route/account/remount changes reset the selector. If the filter panel is detached or moved, hidden rows are restored before the controls are recreated.

Native polls and `tl-user-text` are structural localization boundaries. Static legend/control/metadata text is translated while options, selected radio values, duration values and native handlers stay unchanged. Photo/video upload controls are identified by their verified direct SVG icons, rather than a two-button count. Notification avatar navigation and permanent SVG star masks cover the new border wrapper structure while excluding native expanded follower controls. Profile Media rejects explicit MUTED records, and local Favorites checks the verified muted-account list before showing saved snapshots, preserving all stored data.

## 6.12.0 六つの配布版

`scripts/distributions.cjs`を配布一覧の唯一の定義とし、build・syntax check・配布統合テストが共有する。ja/en共通モジュールを保持し、Safariだけ両言語のメディア情報を追加。新しいAndroid配布は別名の同じcoreである。既存3版の名前・namespaceを変更しない。メディア情報は翻訳済み文言を非同期更新のキーにせず、内部の意味を示す固定キーを使う。導入案内の順序は対象環境、追加方法、更新方法、短い機能説明と詳細へのリンクとする。

## 6.13.0 描画前のお気に入り補正と説明の生成

両言語の起動末尾で、DOMContentLoadedを待つ前に共通のお気に入りCSSと専用MutationObserverを準備する。HTMLルートがまだなければdocument直下の追加だけを待つ。CSSは安定した標準test IDを使い、直接／入れ子のハートSVGを描画せず20pxの星を提供する。PCホバーと標準の選択状態は金色へ統一し、元のSVG・ボタン・イベント処理を残す。

専用observerは、変更元に近い対象ボタン・件数・確認済み一覧ダイアログと、追加された部分内の対象だけを次の描画前に補正する。一般の100ms待機を使わず、無関係なbody変更で全画面を再走査しない。自身の補正中は切断し、複数版が同時に読まれても専用observerを重複させない。削除されたCSSとbfcache復帰を処理する。入力・ユーザー本文・拡張の独自UIは対象外で、一覧ラベルは標準ヘッダーと閉じるボタンの組合せを確認してから変更する。

`scripts/greasyfork-info.cjs`は`docs/DISTRIBUTIONS.json`の既存ID・URLと配布コードの`@name`、packageのversionから6版の説明を生成する。必要な管理アプリと対象スクリプト名を先に表示し、初回と更新を分ける。StayのコードURL追加は初回のみ、更新は対象スクリプトの更新ボタンと再読み込みとする。管理アプリの実際の注入タイミングや実機の描画はこの設計だけでは保証しない。

クラシック用の星・通知マスク・色はHTMLの表示設定へスコープする。切替の保存後にレイアウト・モーション・アイコンを同期し、オフでは作成した星と追加クラスを除去する。テキスト・属性・プレースホルダーは元値と最後の書込みを記録し、Reactやユーザーが変更した値を上書きせず復帰する。日本語版のいいね表記と日本語化を保持し、英語版は標準用語へ戻す。オフではモーション停止用の上書きも解除して標準のtransitionを残す。

## 6.14.0 限定した翻訳と先着表示

日本語化はnative返信ヘッダー、親プレビュー、翻訳メタデータ、aside見出し、badge assetを識別してから行う。Reactが管理するテキストノードを保持する。作者と時刻の間に拡張バッジが挿入されても、確認済みの補助要素だけを許して時刻を認識する。

Mediaの2つのGETは並行開始し、それぞれUID・route・sequenceを照合して表示する。既存行は取り外さず差分で更新する。完全なミュート確認と成功したMediaだけを30秒キャッシュし、明示更新・アカウント変更・native mute操作で破棄する。復元機能は便利ツールの説明と独立ボタンにまとめ、処理中・部分復元・通信失敗を既存status欄に表示する。過去全履歴を示す表示にはしない。


## 6.15.0 Favorites archive and recovery

Keep historical recovery in Tools with a visible progress/status, Pause, Continue and Restart. Network work is explicit, paced, foreground-only and resumable per UID. Fresh post details verify hasLiked and canonical original IDs; feed coverage is described accurately.

Use an inline, wrapping archive toolbar in the own-profile Favorites panel: text/author search, media selector, date order, JSON backup/import. Reuse the toolbar and existing media rows to retain IME, focus and playback; render progressive 50-row batches. Retain all stored records until actual quota, preserve temporary memory and offer backup before closing. Imports merge only the same UID, validate the entire bounded schema, and keep existing snapshots first.

## 6.16.0 Direct Favorites and media continuity

Favorites become a plain account-local saved timeline. Compact read-only metadata separates retained/displayed counts, dates of visible eligible Tweets and feed recovery coverage. History events update text while reusing rows and video nodes; this view never starts a scan. Existing backup and progressive rendering remain.

Native and profile photo stages use a centered, contained layout with safe-area padding and visible-viewport tracking. Contained native viewers keep their modal boundary. Video fullscreen targets the existing video element and never reparents, clones, seeks or starts a paused clip. A per-element pause guard is active only for an actual, visible, same-source/context fullscreen playing session; native pause events remain authoritative. Exit/denial/context changes restore the exact method descriptor. Touch and pointer/focus feedback are separate; no global player or intersection-observer replacement is introduced.

## 6.17.0 Creation-time ownership and clocks

The embedded `timestamps` module accepts calendar-valid, explicit-zone ISO creation strings. It normalizes fractional precision to three digits for native Date construction while preserving the original API string in saved records. API alias selection prefers valid `created_at`, then valid `createdAt`. Detail creation nodes must belong to the same article's native author header. Edited tooltips, quoted content and nested articles cannot supply that source. Conversation dates require the actual Back-header/scroll/reply-footer panel; route text alone is insufficient. Existing stamps update or disappear when their verified source changes.

A bounded shared clock updates each native timestamp's existing text node at minute boundaries without rewriting post content or native handlers. It follows each edition's locale, uses the browser's time zone for dates, stops while hidden or after pagehide, and resumes on the supported page lifecycle. Profile Media/Favorites show local dates and clock times; unknown dates are omitted from time rendering and range calculations, with undated media items retained at the end. Existing legacy backup values remain importable without being assigned an invented time zone.

The `reply-times` module supplies verified creation strings for native reply spans lacking ISO titles. It reads the established parent-replies route once per opened native container, accepts only a complete page of at most 50 records, and requires a unique author/original-body/initial-age match. Work is bounded to 20 visible candidates per scan and four simultaneous reads. Existing nodes from the request's initial snapshot may use its complete response for 60 seconds; newly inserted nodes cannot inherit an older reply's timestamp. UID, route, container, body, author and latest expected native/owned label are rechecked. A previously invalidated bound node cannot rebind from that old cache. Each clock write records its own label; subsequent clock refreshes require no GET. Unknown, translated, incomplete or ambiguous replies keep native presentation without fabricated creation dates.


## 6.18.0: scoped native mutation processing

The general observer merges changed roots, prioritizes an own article, promotes verified shared UI contexts and falls back to a single document scan for broad changes. Ignore script-owned output only with value/source/parent checks. Favorite repair remains its separate immediate observer; hidden pages suspend the general observer. Classic markers recompute only the affected native article on the stable shell/theme path; full cleanup still runs on OFF and shell/theme changes. Date formatters and article clock sources are cached; stale reply candidates are rejected before author/body parsing. Active Favorites render once through the profile-tab reconciliation path.

## 6.18.1 Manager transport and native view reconciliation

News and media HEAD requests resolve legacy `GM_xmlhttpRequest` or the manager's sandbox `GM.xmlHttpRequest` binding before using the existing fallback. Promise acknowledgements without an HTTP response do not settle a request; the actual callback/Promise response or bounded failure does. Existing URL/response validation, anonymous external requests and request limits remain. Failed Japanese news loads expose a small Retry action beside Japan/World. It clears only the current topic's backoff after rechecking visibility, route, region, mount and native target; in-flight requests remain deduplicated. Completion reconciles the current target rather than retaining a previously selected panel, while failure or World restores the original native news nodes.

The runtime observes native tab/navigation selection attributes and verifies the feed's sticky native tab group before promoting a same-URL view change to one full reconciliation. Script-owned UI, articles, editable fields and user text do not qualify. Ordinary article updates retain scoped processing and hidden-page suspension. Classic CSS also targets direct native buttons inside a verified classic tab group, so React's complete class replacement cannot briefly remove the classic tab style before reconciliation. This selector remains under the classic shell and disappears with classic OFF.

## 6.19.0 Photo gestures and compact profile controls

The verified native photo stage gains a temporary, aria-hidden three-pane presentation layer while retaining its original image and native handlers. Horizontal gesture intent locks after direction checks; frame-batched `translate3d` follows the pointer. A 220ms transform transition settles a committed slide or returns a short/edge drag to its starting position. The native thumbnail click commits the selected image. The presentation waits for that destination's own load/error event with bounded cleanup; an unrelated old image load cannot release it. A separate 1600ms native-commit deadline restores controls when the native selection does not arrive. Pointer capture has a touch fallback; vertical movement, multiple touches and zoomed viewports preserve their normal handling. Reduced motion disables the extra presentation and releases capture if changed during a gesture. Context identity includes route/search, account and the full photo-source list. Backgrounding, removal or changed context clears frames, timers, capture and the layer. Inline gallery resize handling realigns only after an actual width change, avoiding height-only scroll restarts.

Media/Favorites reuse a single unframed toolbar with compact counts, a Refresh text control and native `details`/`summary`. Full count explanations remain in accessible labels and titles; existing date/read ranges, history progress, backup/import and storage ownership text live inside the disclosure. Errors, storage warnings and multipart backup actions remain outside it. Native disclosure state and existing controls survive metadata updates; unchanged Tweets reuse their original row/image/video nodes. Every text action and summary has a 44px target and a focus-visible outline. Empty/failure states remain readable status messages, with explicit retry after failed reads and wrapping for long messages. The local profile photo dialog retains its existing single-image implementation.

## 6.19.1 Photo zoom and viewer validity

The shared `photo-viewport` module holds each dialog's last unzoomed bounds in a WeakMap. Both native and profile fitting call it with their own CSS-variable prefix. At `VisualViewport.scale > 1.001`, resize/scroll events retain those dimensions and offsets instead of fitting to the shrinking visual viewport; ordinary scale restores visible-viewport tracking, including keyboard changes. Opening for the first time while zoomed uses the layout width, visual height multiplied by scale and zero offsets. Only changed CSS values are written.

Native photo motion rechecks zoom during drag and release. A second pointer/touch cancels the current motion and keeps a pinch flag until every touch ends; pointer cancellation, lost capture, hidden pages and pagehide clear the appropriate state. Zoom or viewport changes also release active presentation/capture. A zoomed native stage allows `pan-x pan-y pinch-zoom`, while normal carousel mode retains `pan-y pinch-zoom`. The existing native image, handlers and bounded selection commit remain authoritative.

The profile viewer records its trigger, gallery and normalized ordered source list. After a profile render commits, disconnected triggers/galleries or changed source lists close the viewer and detach its viewport/window callbacks. Reused rows, dates and progress do not close it. Close returns focus to a connected trigger or the selected profile tab when the trigger is gone; route/account/pagehide cleanup retains the same lifecycle. This change does not replace the single-image profile dialog or alter saved records.

## 6.20.0 News transport and parallel publisher feeds

This implementation is in progress. The news transport accepts a bounded textual `response` when `responseText` is unavailable, while retaining real HTTP success and final URL checks. Manager Promise receipts with status zero and no body leave the request pending for its actual callback/deadline. Legacy callback and modern Promise/binding paths remain; no session credentials are used for external publisher reads.

Each existing topic retains Yahoo and gains one exact public publisher endpoint: current NHK domestic RSS, Nikkan sports/entertainment Atom or ITmedia technology RSS. Parse the verified RSS/Atom structures into the same bounded article model, with source-specific article/image allowlists and publisher attribution. Reject unverified URLs and XML entities. Feed requests run in parallel per topic; successful arrivals reconcile bounded results immediately, and failure of a different feed does not remove them. All-source failure leaves the native container visible and exposes Retry. World, detached targets, hidden pages and changed selections retain existing native restoration and stale-completion guards.

The inspected Atom alternate links, image enclosures and optional article sections are validated against the declared publisher; ITmedia's singular and plural article paths are accepted. Images remain feed-provided, without article/OGP fetches. Up to 50 entries per feed are examined and ten combined articles are displayed. The existing 15-minute session-cache key remains, with publisher-feed count validation invalidating older Yahoo-only entries so the new feeds are read. Partial completion has loading/failure status and Retry without losing valid articles. Persist only finished topic entries; reject old loading entries on reload so another topic cannot strand an incomplete cached list.

Only `news.web.nhk`, `www.nikkansports.com` and `rss.itmedia.co.jp` are added to the six distribution connection metadata. Existing grants, identities, storage keys, safe localization and native content/actions remain. Tests and browser/public validation will be recorded after source completion; public Stay source inspection does not establish a user's actual Safari/Stay response shape. The status-zero Promise receipt regression is synthetic and is not attributed to Stay's inspected non-Promise XHR bridge.

## 6.21.0 Delivered media, profile whitespace and optional alerts

Use the common photo-quality helper in the verified native and local profile viewers. A compact 44px link opens the unchanged delivered HTTPS source with `noopener noreferrer`; a read-only label follows the loaded image dimensions. Reject unsafe URLs and dimensions from an earlier `currentSrc` or incomplete load. Detach the source observer and load/error callbacks when the image is replaced or the dialog closes. Video resolution joins the existing fullscreen tools and follows metadata, resize and source invalidation without changing the video node, source, playback or native controls. These are access and presentation features; no original-file, higher HD rendition or retained 4K/HDR contract was established.

Prepare at most three supplied gallery images—the current photo and its immediate neighbors—with `decode()`. Reuse prepared nodes for the existing frame-batched swipe layer only after the current and destination images are ready; otherwise preserve the native photo and its native selection path. Viewer/context changes, removal, backgrounding, zoom and reduced motion clear preparation, and late promises cannot revive it. Preparation does not manufacture a larger source or alter upload processing.

The bio patch identifies the current verified profile structure and adds one scoped `white-space:pre-wrap; overflow-wrap:anywhere` class. It preserves the native text and links and removes its old marker when the profile changes. Editable fields, post bodies and unknown layouts remain outside the target.

Browser alerts are off by default and enabled through an explicit Tools switch and permission gesture. The account-scoped preference and an exclusive `navigator.locks` owner prevent another account or simultaneous tabs from receiving duplicate alerts. Read only the verified native notification badge; a reliable count increase triggers a generic notice without author/body previews. Existing service-worker notification support may be used, but no worker is registered, no Push subscription is created and no notification API polling or userscript grant is added. Release pending work and ownership on disabling, account changes or page suspension. This page-open notification design does not claim delivery after the page closes or the OS suspends it; support, permission and failure states are visible in Tools. Physical OS delivery remains a separate validation step.


## 6.22.0 Native photo ownership after Tweet 2.2.3

Native multiple-file selection, uploads, inline scroll snap, slide buttons/dots/counters and fullscreen keyboard navigation now own their behavior. Remove the old batch queue and inline-control conversion rather than creating a parallel state machine. Keep only verified viewer fitting, delivered-source information, bounded preparation and gesture presentation; commit through the native previous/next action once. Source changes during motion cancel old presentation. Native counters must agree with the gallery index/count before binding, and dialog close/removal clears pending bindings so a single reply photo cannot inherit an earlier gallery with the same URL.

Enlarge native dot buttons to 44px without changing their visual dots or click handlers. Restore markers when the native gallery becomes invalid or is removed. Retain icon-only upload accessible names using the current verified toolbar/input structure; do not alter FileList, multiple, upload controls or submit actions. Japanese photo labels and native upload summary/limits are structurally scoped and preserve image captions, native elements and file-name suffixes.

Stay-compatible GET requests register final completion to release bridge listeners. Timeout/error/success settle once; a later completion cannot overwrite a result. News keeps native fallback and Retry, and another publisher's failure cannot remove already retrieved headlines. Current App Store Stay and the old public bridge are different evidence; physical Safari validation is required to attribute a reported iPhone error.

## 6.23.0 Publisher choice and profile-photo dragging

Keep Japan/World controls and a compact native `details` disclosure labelled Publishers. Each existing news topic exposes only its two verified publishers, with a visible topic legend, named checkboxes, 44px label targets and a minimum of one selection. RSS category determines the topic; this is not arbitrary feed import or text-based classification. Preserve disclosure state, native news nodes and drafts. Storage errors leave the previous selection intact; source generations and cache identity reject older requests after a selection change, including A→B→A. Status text names failed selected publishers and preserves successful articles. Safari alone offers a site-permission check without asserting that every failure has that cause.

The owned profile Media/Favorites dialog now uses the same restrained 220ms horizontal settling as the native-feed enhancement. A temporary, aria-hidden three-pane layer follows dragging with `requestAnimationFrame`; the original image, quality link, counter, buttons and keys remain. Prepare no more than the current photo and its two neighbors. Fill a previously empty pane only after its live decode completes; a direction reversal towards an undecoded neighbor keeps the center image visible. If the destination remains unavailable at release, retain the original image and allow a bounded 1600ms readiness wait. A late result cannot change the photo after expiry, close or context changes. Keep vertical gestures and browser pinch/pan, cancel on zoom, reduced-motion changes and page lifecycle changes, and remove capture, frames, timers and listeners during cleanup.

Actually viewed references were the official [Tweetbot timeline tips](https://tapbots.com/support/tweetbot6/tips/timeline), [Tweetbot miscellaneous tips](https://tapbots.com/support/tweetbot6/tips/misc) and [Ivory filter-state explanation](https://tapbots.com/support/ivory/general/timeline_missing_posts). Visible source state and short interaction paths informed the design; profile fullscreen photo swiping is this userscript’s improvement, not a reference-page specification. Tweetbot's historic profile notes, keyboard commands and read-position controls are not implemented by this release. The observed native detail-back flow already restores the reading position, so it receives no extra control. [Tweetbot's official memorial](https://tapbots.com/tweetbot/) distinguishes the discontinued Twitter client from current Mastodon client Ivory.


## 6.23.1 Profile-photo footer spacing

The delivered-image link and dimensions sit 8px above the 60px profile-photo navigation row, including the bottom safe area. This selector applies only to the profile viewer. Native controls, image fit and gesture geometry remain unchanged.
