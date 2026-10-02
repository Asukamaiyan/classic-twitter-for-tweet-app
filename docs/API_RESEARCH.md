# Tweet.app API / userscript enhancement research

Verified 2026-09-26 (JST). Read-only research; no signed-in session, API requests, account actions, or private data access.

## Evidence boundary

Tweet.app is Operation Bluebird's independent service, not X. Its [official site](https://tweet.app/) links the application at app.tweet.app. The site's Trust Dial presentation explicitly says it is an illustration and the trust system is not yet live; do not build features on an assumption that these scores are available.

No public developer portal, supported external API specification, OAuth registration, SDK, or rate-limit contract was located in domain-restricted searches of tweet.app / bluebird.social or the official site's navigation. This is **not proof that no API exists**. The shipped browser client visibly calls a first-party API, which is different from a supported developer API.

Inspected the public JavaScript asset referenced directly by the application's HTML:

- URL: https://app.tweet.app/assets/index-DCFw2ga2.js
- Public asset was downloaded for local analysis; that temporary copy is not distributed in this repository.
- Bytes: 1,656,389
- SHA-256: `8ec6038a2a88b5255e1bb8ad8df425c38cad8063bffe8aa7cc7f80bbdfdc500f`
- API base embedded in client: `https://api.tweet.app`; signup base: `https://signup.tweet.app`.
- Client integrates Firebase authentication/App Check. Do not copy session credentials or wrap token acquisition just to add presentation features.

The following are **client-code observations, not endpoint availability or authenticated acceptance tests**. No guessed endpoints were queried.

## Existing client functionality

| Area | Routes/capabilities visible in current bundle | Consequence for enhancement scope |
|---|---|---|
| Posts | `/api/posts`, `/api/posts/{id}`, replies, likes/likers, repost, report, edit/delete; feed cursor/limit and following scope | Posting and interaction already exist; reuse native UI. |
| Translation | `POST /api/posts/{id}/translate` with `targetLang`; native show-original/show-translation controls; target derived from browser language | UI localization must preserve original post text and native translation controls. Do not call a second translation service automatically. |
| Users | Follow/unfollow, follower/following lists, account mute/mute-status/muted list | Account mute is already implemented; local keyword filtering is a different possible addition. |
| Search | `/api/search?q=…&limit=…&sort=…`; Top/Latest/People/Photos/Hashtags tabs | Advanced X operators are not established. Never advertise `from:`, date operators, etc. as supported without evidence. |
| Search history | Browser storage key `EXPLORE_RECENT_SEARCHES`; retains up to 8 searches | Permanent pinned searches could supplement history; ordinary recent search is not missing. |
| Discovery | Trending/followed hashtags, suggestions, news headlines | Avoid duplicating native discovery. |
| Notifications/settings | Notification list/read/unread count; user settings; dark/light theme | These are native functions, not missing enhancements. |
| Composer | 280 UTF-16 `.length`/`maxLength`; media upload; mention/tag suggestions | Do not silently change the native limit. Nonintrusive text tools can use the existing composer. |
| Navigation | `/feed`, `/explore`, `/notifications`, `/profile`, `/settings`, `/post/:id`, `/user/:username`, `/hashtag/:tag` | Bookmarks can store a validated existing permalink. Search query deep-link support was not established from the bundle. |

No post-bookmark, saved-post collection, multi-post draft, scheduled post, direct-message, or account-list API/UI was identified in this inspected bundle. This narrower statement is defensible; a blanket claim that Tweet lacks all of them is not.

## Practical additions

1. **Local saved posts**: most bounded addition. Store a validated app.tweet.app `/post/{id}` URL plus optional user-saved label in userscript storage; show open/remove and export/import actions. Label as saved on this browser/device. A copy/export action must be explicit. Never harvest feed text or profile data in bulk. X has [Bookmarks](https://help.x.com/en/using-x/bookmarks); Threads web has [saved posts access](https://about.fb.com/news/2025/04/new-features-threads-web-experience/amp/).
2. **Local keyword display filter**, opt-in, off by default: inspect only already-rendered post content; collapse with a visible reason and reveal control. Keep author names, navigation, quoted text, action buttons, and composer values out of UI translation. Distinguish this feature from account mute. X offers [word/phrase filtering](https://help.x.com/en/rules-and-policies/recommendations). A userscript filter covers loaded content only and cannot change notifications, server search, or server recommendations.
3. **Pinned searches**, if native search UI behavior can be verified: locally save query strings and restore them into the native search UI. X's [advanced search](https://help.x.com/en/using-x/x-advanced-search) supports rich operators, but that does not establish Tweet support. Avoid manufacturing unsupported query syntax.
4. **Optional explicit text drafts**: save/restore on a click, handle storage failure, and never overwrite nonempty editor content. Threads supports [multiple drafts](https://about.fb.com/news/2024/08/new-threads-features-for-creators-and-businesses/amp/). Defer automatic draft capture unless account separation, replies vs new posts, discard semantics, and successful-post clearing are verified. Media drafts are outside this small change.
5. **Readability/accessibility**: optional line spacing and compact spacing scoped to known post containers; clear reset; keyboard access to extension settings; preserve caret, IME composition, focus, scrolling and original actions.

Do not add scheduled posting, DMs, server bookmarks, arbitrary full-history search, recommendation ranking, fake Trust scores, or automatic engagement through undocumented endpoints. A browser userscript cannot provide server-side availability or cross-device sync merely by adding buttons. [X exposes documented APIs](https://docs.x.com/x-api/introduction) for posts, users, DMs, lists, and other areas, while Tweet's comparable external contract was not located. Meta's official product announcement confirms a [Threads API](https://about.fb.com/news/2024/08/new-threads-features-for-creators-and-businesses/amp/); its developer page returned HTTP 429 during this research, so no endpoint-level claims are made here.

## DOM / localization notes from current bundle

Stable-looking explicit identifiers worth testing against live UI:

- `#public-tweet-input` and `#public-modal-tweet-input` (composer fields).
- `#public-tweet-submit-btn` (submit button).
- `.tweet-action-bar[data-testid="tweet-action-bar"]`.
- `[data-testid="tweet-like-action"]` and `[data-testid="tweet-up-arrow-action"]` (share).

Not every post is an `article`, and many post/profile routes use React onClick handlers rather than anchor hrefs. Do not derive post URLs from an unrelated last link, text timestamp, or a quoted post. Disable a per-post save button when the permalink cannot be reliably identified; a current-detail-page save control is a safe fallback.

Use narrowly scoped exact UI phrases, original-value bookkeeping, and reversible changes. A word such as `Home`, `Reply`, `Following`, `Top`, `Latest`, `Show original` or `Post` can also occur in user content. Regex replacement through all text nodes cannot disambiguate it. Keep editable fields and user-generated content protected even when nested inside a button/link. Preserve English mode without running Japanese replacements. Test navigation, menu labels, ARIA/title/placeholder values, node reuse, reset, and repeated MutationObserver passes in Chrome and Safari/WebKit independently.


## 6.7.2 verified reply, avatar and badge corrections (2026-09-27)

The same official client asset and live authenticated UI confirmed:

- Current-account lookup is `GET /api/user-profile/{uid}` returning `profile.username`; the bare `/api/user-profile` route is used for writes and must not be guessed as a read route.
- `GET /api/users/{username}/posts` returns `posts`; `/replies` returns wrappers with `post` and `parentPost`. A reply notification watches the user's own `post`, not an unrelated wrapper ID or notification ID.
- `GET /api/posts/{id}/replies?limit=50&cursor=…` supplies replies with author identity, text, timestamps and `nextCursor`. The additional inbox reads these routes only. No native reply notification type was identified in the inspected notification renderer.
- Native grouped notification rows render up to eight Uo avatars but do not assign their individual profile handlers. The row's representative click therefore wins. `/api/notifications` supplies verified `actorHandle`, `actorDisplayName`, `actorAvatarUrl` and `nextCursor` for identity matching.
- Official `founder`, `fighter`, `centurion`, `team-member`, `ambassador`, `wing`, and `press` badge PNGs are published at 96×96 under `/assets/{kind}-badge-96.png`. All seven returned PNG content with real 96×96 dimensions. Native low-density selection can choose the 18px source; the patch requests 96px without enlarging layout.
- Native reply author headers and the mobile Account menu omit the badge renderer. Existing profile data supplies `badges` and `foundingMemberNumber`; the supplement follows the official cumulative tier and team-role precedence.

These endpoints remain an observed first-party contract rather than a documented external API. Reply polling pauses when the tab is hidden and does not deliver OS push notifications. Live verification used the signed-in user's existing session without logging or exporting credentials.


## 6.8.0 media and translation evidence (2026-09-27)

The public first-party client bundle `index-DCFw2ga2.js` was fetched again on 2026-09-27 before publication. Its SHA-256 remained `8ec6038a2a88b5255e1bb8ad8df425c38cad8063bffe8aa7cc7f80bbdfdc500f`, matching the inspected bundle. The unauthenticated first-party [media configuration](https://api.tweet.app/api/media/config) was also re-fetched on that date and advertised the following bounds. These are current configuration values, not upload acceptance tests:

| Media | Server-advertised bounds |
|---|---|
| Images | JPEG/PNG/WebP; 10 MiB per file; four per post; 20 per user/day |
| Video | MP4/MOV; 50 MiB; 30 seconds; five per user/day |

The native client submits original image File objects to `/api/media/upload` and chunks videos through `/api/media/upload/init`, `/append`, `/finalize`, then reads `/status`. No client resolution/HDR rejection was found. No option to retain originals, select codec, preserve HDR metadata, or select 4K output was found. The production UI says videos are transcoded to H.264. Demo labels mention WebP image optimization and 720p video, but these are not a measurement of current production output. No experimental live upload or published media was created during this investigation. A file passing local size/duration checks does not prove retained 4K HDR after server processing.

The photo input lacks `multiple`; its onChange handler also reads only `files[0]`. Merely adding the HTML attribute loses subsequent files. The enhancement serializes selected photos through the established native handler and waits for its completed preview before advancing. It does not alter authentication, quota checks, accepted formats, or server requests.

Main-post photo grids render all `media_assets`; native image clicks open a single-image Media viewer with no next/previous controls. These observed grids can support a local carousel. Reply and quote renderers currently expose only `media_assets[0]`; their missing images cannot be inferred from DOM and are not advertised as complete galleries.

Native translation posts `{targetLang}` to `/api/posts/{id}/translate`. Its component replaces every exception with the same “Couldn’t translate” alert. This message alone cannot establish a quota: network, authentication, unsupported language and server failures are also possible. The previous userscript scheduled up to 40 requests 750ms apart and did not stop after an error. No documented native unlimited mode was found.

The optional device engine uses the [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api) and [Language Detector API](https://developer.chrome.com/docs/ai/language-detection). Availability is checked at runtime; model preparation requires a user action. Supported desktop browsers process translated text on device, without consuming Tweet's translation allowance. Safari/Stay and mobile do not gain this API merely by installing the script. Browser models can still be unavailable or impose input/resource limits. This is not a promise of universally unlimited translation.

### Japanese news and current validation boundary

The official client uses `/api/news/headlines?topic=nation|sports|entertainment|technology&limit=10`; no verified Japan country selector was found. The enhancement uses [Yahoo!ニュースの公式RSS案内](https://support.yahoo-net.jp/PccNews/s/article/H000011243) and the public category feeds at `https://news.yahoo.co.jp/rss/categories/{domestic,sports,entertainment,it}.xml`. Native requests are not intercepted. Feed-supplied `image`, Media RSS thumbnail/content or image-enclosure URLs are accepted only on the public Yahoo image domains. Missing or failed images remain absent rather than being replaced with unrelated pictures.

Pre-publication read-only checks on 2026-09-27 fetched all four current Yahoo category RSS feeds. Each feed contained 50 items; the shipped parser selected ten valid articles and recognized ten image URLs per category, for 40 articles and 40 image URLs in total. All selected article links used Yahoo HTTPS URLs and all publication dates parsed successfully. A representative feed image returned HTTP 200 with `image/jpeg` content (19,353 bytes). This confirms one image response, rather than claiming that all 40 images were downloaded.

A temporary injection into the actual Chromium page confirmed that the live feed-header location and six-button toolbar match the implementation. Supplying the fetched current RSS through a GM transport shim displayed ten Japanese-news articles, with five visible source images loaded at 450px width. Selecting World restored the native news contents. This verifies the rendering and fallback interaction with current feed data; the shim does not establish that cross-origin RSS requests work through an installed userscript manager.

Earlier in implementation, browser requests were blocked with `ERR_BLOCKED_BY_CLIENT`, shell requests could not resolve external hosts, and the sandbox denied a local HTTP server. Those restrictions describe the earlier test stage; subsequent pre-publication reads and the Chromium checks above supersede the earlier RSS, image-delivery and media-configuration gaps. Automated tests additionally use controlled native-DOM, RSS and browser-AI fixtures.

No real post or media upload was submitted. Server-side upload acceptance, preservation of 4K/HDR after processing, installed Tampermonkey behavior, physical Safari/Stay behavior, and actual browser-model download and translation quality remain unverified.

## 2026-09-30 compatibility review

The live HTML still referenced `index-DCFw2ga2.js`. A new download was 1,656,389 bytes and had the same SHA-256 `8ec6038a2a88b5255e1bb8ad8df425c38cad8063bffe8aa7cc7f80bbdfdc500f`. The public media configuration still advertised images at 10 MiB, four per post and 20 per day, and video at 50 MiB, 30 seconds and five per day. These remain advertised settings rather than upload acceptance results.

The three Greasy Fork distributions were still 6.8.0 and matched the repository after excluding Greasy Fork's added update metadata. In the current authenticated Chromium page, temporary injection preserved 19 post bodies and the draft value, hid all avatar-follow overlays, and moved through a real three-photo post and its native enlarged viewer. The reply inbox and 20 individually resolved notification-avatar links also remained available. Current public RSS was fetched again for all four categories; the news screen rendered ten headlines and five visible source images through the same GM transport shim described above.

Two local lifecycle bugs were reproduced independently of a client deployment: a pending on-device translation invalidated by backgrounding could remain permanently marked as attempted, and an unchanged news page had no timer to refresh at its cache deadline. Version 6.8.1 restores unfinished translation attempts without concurrent model requests and adds a single deadline timer scoped to visible Japanese news. It does not introduce new first-party API routes.


## 6.9.0 classic interface review (2026-09-30)

Re-fetched the current HTML, `index-DCFw2ga2.js` and public media configuration. The bundle remains 1,656,389 bytes with SHA-256 `8ec6038a2a88b5255e1bb8ad8df425c38cad8063bffe8aa7cc7f80bbdfdc500f`, and the advertised image/video settings remain unchanged. Live Chrome structure confirms the theme-bearing root, native 12-column grid, feed tabs, public composer, direct native avatar profile buttons, action bars and mobile navigation used for the scoped appearance markers. No new API is needed for this visual update.

Favorite motion follows the client’s visible `hasLiked`/ARIA state. The official client updates that state optimistically before its request finishes; a later server failure can roll it back. The userscript does not intercept that request, send additional favorite calls or claim server-confirmed success. “A state change animates” describes the actual boundary.

## 6.10.0 profile and native notification review (2026-09-30)

Fresh first-party HTML, bundle and CSS still reference `index-DCFw2ga2.js` and `index-eD6wHGfB.css`. The JavaScript hash is unchanged. CSS is 130,331 bytes, SHA-256 `a4b28ca73444b28b2f5c468950d941438478ceb9918fb63b82fd6b5fe22c3928`. Public media configuration retains the bounds above.

Current profile tabs are icon-only `button[role=tab]` controls labelled Tweets/Replies/Reposts. The former text-based Favorites insertion could not find this structure. Native feed cards also lack a DOM permalink, which prevented local Favorites capture. The new panel identifies a visible profile from its author header and verified current-account identity, retaining native controls and event handlers.

Media reads verified `GET /api/users/{username}/posts?limit=24&cursor=…` and `GET /api/users/{username}/replies` (`post` wrappers; the latest 100 own replies). It accepts validated `media_assets.public_url` and `thumbnail_url` plus the established legacy image field. It does not invent a media-only, Favorites-history, reply cursor, original-file or HDR API. Photo URLs may be server-processed assets; gallery expansion does not imply original resolution.

For local Favorites capture, the read-only posts route verifies exact author, ISO timestamp and original body, bounded to three pages of 50 posts with a short shared cache. Ambiguous matches are rejected. Account/route generations and native button state are rechecked after asynchronous resolution, with a 30-second observer for late optimistic rollback. No extra server engagement request is sent. Local records are scoped to UID; older unscoped records require the user's explicit ownership confirmation to import.

Native notification tabs are All/Verified/Mentions/VERA. The supplemental Replies tab uses the same inline bar and border-separated notification rows. Standard rows are restored on native-tab selection or leaving the screen. The established reply-read endpoints and polling bounds remain unchanged.

The permanent favorite CSS uses stable native `data-testid` selectors, including the adjacent count and the verified 28px notification heart structure, so React replacement does not reveal the native heart while waiting for an observer. Composer avatar rules cover the confirmed 40px feed, 48px modal and 32/40px reply structures. All changes preserve native favorite handlers, drafts and theme selection.

## 6.11.0 Tweet 2.1.0 compatibility review (2026-10-01 JST)

The current application HTML references new first-party assets. They were downloaded for read-only comparison with the previous client; these analysis copies are outside the distributed userscripts. The live sidebar also displays **v2.1.0**.

| Asset | Bytes | SHA-256 |
|---|---:|---|
| [index-9eU2xJMU.js](https://app.tweet.app/assets/index-9eU2xJMU.js) | 1,675,107 | `ef05bfa3827fc52cacadcac030eec5e7c4f069e6049ec332ed6d8cd459e04f48` |
| [index-sqQvjjxO.css](https://app.tweet.app/assets/index-sqQvjjxO.css) | 131,345 | `331d08f9c843716e1c0ef9e646d6281f0d0b1bb562c231c6632c19740f3adaf8` |

The user supplied Tweet.app's nine-item v2.1.0 announcement image. The table below distinguishes that announcement from shipped client code and read-only live UI observations. An announcement or renderer is not an acceptance test of the corresponding server operation. No post, vote, report, mute, follow or other engagement write was submitted during this review.

| Announced change | Evidence available in this review | Userscript consequence |
|---|---|---|
| Polls with two to five choices and live results | Client validation, composer and result renderer exist. Live UI exposes the poll toggle, two initial choices, Add choice and four duration values; photo/video controls become disabled while a poll is active. Actual poll submission, voting and server result changes were not tested. | Use the native poll controls. Translate their UI, preserve option text and selection, and do not create a second polling/voting feature. |
| Notifications when someone replies | Client notification enum includes `reply`, phrase `replied to your post` and its message-circle icon. The live native notification page has a reply row and All/Mentions tabs. | Remove the extension's reply discovery, independent Replies inbox, local unread indicator and 90-second polling. Retain previously saved local reply history without presenting it as current native notification state. |
| Muted accounts disappear everywhere | The client replaces a quoted post with a non-navigable placeholder when `quotedPost.status === "MUTED"`. Native mute/mute-status/muted-list routes remain present. Full exclusion across feed, search, profiles, replies and notification API responses was not independently exercised. | Use native account mute. Do not add a second account-mute mechanism. Apply the checked native mute list to browser-local Favorites snapshots, which the server cannot remove from userscript storage. |
| New navigation icons, including the Home birdhouse | Shipped SVG controls use birdhouse, search, feather and bell `data-icon` values. | Preserve the native navigation and its handlers. Classic presentation remains a local appearance option. |
| Account reporting | Native profile options/report dialog and `POST /api/users/{userId}/report` with `reasonId` and optional `details` exist in the client. Actual reporting was not submitted. | Preserve and localize native report controls; do not create another report API or submission flow. |
| Followed hashtags appear in Following | The announcement states this change. Native followed-hashtag management and the existing `/api/posts` following scope are visible in code; the inclusion/ranking of hashtag posts is a server behavior that was not separately measured. | Reuse native hashtag following and Following feed. Do not manufacture a parallel feed or ranking rule. |
| Notification badge matches notifications | The client reads `/api/notifications/unread-count` and accepts authoritative WebSocket `unreadCount` updates. Exact count correctness over all grouped/read/removed states was not independently tested. | Preserve the native count. Remove the extension's independent reply unread count; the additional filter must not alter unread status or manufacture a count. |
| Follower lists open in one tap and offer Follow back | Native follower/following dialogs and their profile navigation exist. Native follower rows and an expanded follow-notification list can render Follow back. No follow action was performed. | Preserve the native lists and follow-back action. Keep the separate notification-avatar navigation repair where ordinary grouped avatars still lack their individual profile handler. |
| No duplicate reposts; mention any handle | The announcement states the repost fix. Native repost routes, mention parsing/profile links and `/api/users/mention-suggest` are visible. Repost deduplication and notification delivery to arbitrary mentioned accounts were not tested through writes. | Preserve native repost and mention controls. Do not add a second repost request or promise server behavior from the client parser alone. |

### Native poll structure and localization boundary

The verified native routes are `GET /api/posts/{id}/poll` and `POST /api/posts/{id}/poll/vote`, whose body is `{optionId}`. Creating a poll uses the existing post route with `{poll:{options,durationHours}}`; it is not a separate creation endpoint. Choices are limited to 2–5, 25 characters each, with durations of 1, 24, 72 or 168 hours. Native validation rejects empty or duplicate choices and disallows combining a poll with media. The result renderer uses `options[].id/text/votes`, `viewerOptionId`, `totalVotes`, `resultsVisible`, `isClosed` and `closesAt`. Its visible poll refresh is bounded to a 10-second interval and pauses when the document or poll is not visible; the extension must not add another result-fetch interval.

Choice and result text appears in `.tl-user-text` spans, as do native post/reply/quote bodies. This explicit user-content marker is excluded from UI localization. Composer input values are also protected: changing placeholder or label text must not change an option such as `Home` or `Reply`. Read-only live UI checks preserved those sample values and a selected 72-hour duration. `Poll`, `Add poll`, `Remove poll`, `Choice N`, `Add choice`, `Poll length`, `Vote`, result labels and remaining-time text are UI strings rather than user content.

### Native notifications replace local reply discovery

The native notification renderer now uses only All and Mentions. Mentions selects quote/mention events and does not include ordinary replies. Additional type filters for Reply/Favorite/Retweet/Follow therefore supplement the native view without duplicating notification creation: they inspect already rendered native rows, retain their event handlers, restore rows on native-tab/route changes, and send no notification-read or engagement requests.

Ordinary rows have a direct leading 28px SVG: message-circle for replies, heart for likes, repeat-2 for reposts and user-plus for follows. These are type evidence only inside the verified native row structure; an arbitrary SVG elsewhere is not a notification. A follow row's parent also contains its expandable follow-back list and is filtered as one row. Quote/mention, VERA, badge and unknown structures remain native rather than being guessed from preview text. Grouped ordinary avatars still do not receive the individual `onAvatarClick` handler in the shipped renderer, so the verified per-avatar profile link repair remains relevant.

### Native mute list and browser-local Favorites

The native read helper accepts `GET /api/users/muted` with an optional opaque `cursor` and optional `limit`. Its native consumer leaves limit unspecified, requires a successful response with `success`, reads `users`, follows `nextCursor` and deduplicates by `userId`. User rows expose `userId`, `username`, `displayName` and `avatarUrl`. The default/maximum limit and cursor format are not documented in the shipped client and are not guessed here.

Favorites remains a UID-scoped collection of browser-local snapshots. On entering Favorites or selecting **Refresh view**, 6.11.0 reads that established mute-list route and compares normalized `username` values with saved authors. It keeps all saved bodies hidden until the complete mute list is checked, handles at most ten pages per action, and offers **Continue checking** when a cursor remains. Failed, malformed, repeated-cursor or background-invalidated results do not count as a completed check; retry is explicit. Account, route and request-sequence checks reject late responses. There is no automatic mute-list interval and no mute/unmute API write.

Muted-author snapshots and older records without a usable author handle are hidden with an explanation; their saved records are retained. Save, remove, explicit legacy import and storage-event refresh continue to use the current UID and the checked mute set. An old import button cannot claim legacy storage for a newly signed-in account. Changes to native mute settings in another tab are reflected through Refresh view or re-entering Favorites, rather than being advertised as instantly synchronized. Media results also reject explicit `status:"MUTED"` records and otherwise follow native posts/replies responses; this is not a guarantee of backend filtering across every endpoint.

### Non-duplicate enhancements and additional client observations

The new profile enum and icon-only tab bar still contain only Posts/Replies/Reposts. No native Media/Favorites-history/bookmark collection API or UI was identified in this release. Keep the verified Media tab, local Favorites, local saved posts/searches and optional keyword folding. Main-post grids still render their photo assets with a native single-image enlarged viewer; the extension's navigation/scrolling for verified visible galleries is still useful. Reply/quote renderers can expose only their first asset, so missing unseen photos must not be invented. Official badge quality and missing-name-position supplements remain scoped enhancements; the announcement does not establish equivalent native coverage at every reply or mobile account-menu position.

The current public media configuration still advertises image uploads at 10 MiB, four per post and 20 per user/day, and video at 50 MiB, 30 seconds and five per user/day. The inspected video uploader checks asynchronous processing through `GET /api/media/upload/status?media_id=…`, every two seconds for at most 150 checks, accepting ready/failed states. This is native upload handling, not evidence of unrestricted upload size, retained 4K output, original files or HDR preservation. The setup-session refresh route also belongs to the native account-setup flow and is not an enhancement feature.

The public client contains a `?debug=1` switch for Media Test Lab/staging feedback and contains administration code for account reports and other moderation operations. The debug presentation existed in the older client; inclusion of administrative routes in a shared bundle does not grant ordinary-account access. Neither is exposed as a new general userscript feature, and no administration endpoint was queried. All first-party route observations in this section remain an observed client contract rather than a documented external developer API. Final browser/distribution checks and their unverified physical Safari/Stay boundaries are recorded separately in `VALIDATION.md`.

## 6.12.0 platform distribution review (2026-10-01 JST)

[Mozilla's Android listing](https://addons.mozilla.org/en-US/android/addon/tampermonkey/) publishes Tampermonkey for Firefox Android; [Mozilla's guide](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android) explains extension installation. Android distributions target that combination. [Google's current Chrome guide](https://support.google.com/chrome_webstore/answer/2664769?hl=en) describes desktop extensions; its phone action is “Add to Desktop”, not execution on Android Chrome. Therefore ordinary Android Chrome is not a supported installation path here. New Android files use the same tested core with distinct installation names, rather than claiming a new browser API.

[Stay's official README](https://github.com/shenruisi/Stay/blob/main/README-EN.md) confirms link import, Library activation and updateURL/downloadURL support. The short Safari guide links to the actual `.user.js` download URL so readers can copy the URL into Stay; the Greasy Fork `/code` HTML page is not used as the raw script URL. [Tampermonkey's permission guide](https://www.tampermonkey.net/faq.php?q=Q209) confirms the Chrome 138+ Allow User Scripts toggle. Six locale/platform packages preserve existing identifiers, native Tweet handlers and local data. Safari media-information controls are localized for English too. This documentation check does not establish physical Android or Safari installation acceptance.

## 6.13.0 favorite rendering and installation correction (2026-10-01 JST)

The current public client [index-tsClfsnY.js](https://app.tweet.app/assets/index-tsClfsnY.js) was retained for inspection: 1,678,279 bytes, SHA-256 `438578e3eee9491ab42e43ab83d8c3d83e6dfc23ebf96289c2caca30f8f5d986`. It still renders native heart actions with pink hover styling, plus the `Liked by` dialog, `Close liked by list` control and `No likes yet.` empty state. The desktop DOM confirms native favorite-action and count controls. Version 6.13.0 changes their presentation and localized labels before the ordinary delayed scan; it retains native handlers and introduces no new API route or engagement request. The controlled initial-paint/repaint comparison and direct-site checks are recorded in `VALIDATION.md` separately from installed-manager acceptance.

Installation descriptions now distinguish first installation from updates and explicitly name the required manager and the actual edition's `@name`. Following the user's correction, Stay updates use the existing script's **Update** button, followed by a Tweet page reload; link import is only the first-installation step. Tampermonkey updates use its menu's **Check for userscript updates** / **UserScript の更新を確認** operation, as named in its [official English](https://github.com/Tampermonkey/tampermonkey/blob/master/i18n/en/messages.json) and [Japanese](https://github.com/Tampermonkey/tampermonkey/blob/master/i18n/ja/messages.json) labels. This is a documentation correction, not evidence of a completed physical Safari/Stay or Android installation.

## 6.14.0 localization, reply identity and profile loading (2026-10-02 JST)

The live Chrome client shows v2.1.1 and [index-9cXdkXL7.js](https://app.tweet.app/assets/index-9cXdkXL7.js): 1,678,279 bytes, SHA-256 `621409602148797941d4370b6e7cbc5adba4f002acef694b5deca98b2aadda35`. The public bundle differs from the 6.13 research copy only in build timestamp and the lazy admin asset name. This is not evidence of a user-facing API migration.

Native inline reply headers and parent previews have relative times without ISO titles. The main post's ISO-title guard therefore missed them; additionally, extension badge insertion separates the author from the separator. Verified native header/preview structures, permitted badge nodes and native action menus now identify only time metadata. Original post text, display names, handles, poll content and drafts remain protected. Joined uses `profile.updatedAt` in the official client: this release changes its wording while preserving that supplied month/year, without claiming the value is the true account creation date.

The client contains author posts/replies and post-specific likers routes, but no user liked-history list. Likers is restricted to a post author and cannot provide all Tweets favorited by a user. Profile Media starts posts and replies together and publishes each checked response immediately. Existing media nodes remain connected across response updates. Account-scoped successful Media results and complete mute-list checks are reused for 30 seconds. Explicit Refresh, account change and verified native Mute/Unmute controls invalidate the relevant caches. Other-tab server mute changes still require Refresh or expiry.

Inline Favorite capture derives a parent ID only from the native `inline-replies-{id}` container; it reads the existing parent replies route. Profile replies use only `wrapper.post` from the author replies route. Relative identities require a fresh complete response and one exact author/body/time-interval match; uncompleted pagination, duplicates, yearless dates or translated replies without exact identity are rejected. Native-translated main Tweets use exact author/ISO identity and store the API original body. No additional favorite/unfavorite request is sent. Native optimistic rollback and account/generation checks remain in effect.

Tools offers an explicit recovery of up to 40 already-liked native Tweets loaded on the current screen. A fresh post-detail GET must confirm `hasLiked === true` before recovery saves a record, preventing an optimistic native Like from leaving a phantom snapshot after rollback. Reads are bounded and stop starting additional requests after 45 seconds. Profile Media reads also restore verified `hasLiked === true` posts; a session removal marker prevents old cached responses from reviving a native Unlike. This recovers only encountered records, not the entire historical or cross-device Favorites list. Legacy browser-local records and their explicit ownership import are retained.


## 6.15.0 historical Favorites and console review (2026-10-02 JST)

The current public entry [index-9cXdkXL7.js](https://app.tweet.app/assets/index-9cXdkXL7.js) is unchanged from 6.14.0 (1,678,279 bytes, SHA-256 `621409602148797941d4370b6e7cbc5adba4f002acef694b5deca98b2aadda35`). The only shipped lazy application chunk is admin code; inspecting its public source did not establish a personal outgoing-like history or data-export route. No guessed API paths or database collections were queried. Domain-restricted official-site search also yielded no developer history contract; absence in searches is not proof the server lacks such data.

Read-only Chrome network inspection confirmed native `GET /api/posts?limit=20`, followed by the same route with an opaque cursor. The first two pages returned 19/20 posts with boolean hasLiked and nextCursor, with the second page reaching older timestamps. The current profile response has no liked-ID list or history counter. Native non-authentication browser storage has themes and local enhancement data, but no native liked-history key was identified. Credentials were neither exported nor logged. A longer diagnostic read attempt did not yield a usable aggregate result, so it is not counted as a completed historical retrieval.

The supported recovery scans For you and Following (`scope=following`) cursor pages, with fresh `GET /api/posts/{originalPostId ?? id}` for liked candidates. Each accepted detail must have the exact canonical ID and hasLiked===true; ordinary candidates additionally match the author. Repost wrappers may identify a different reposter and are normalized to the verified original author. All reads are sequential and separated by at least 800ms, with explicit start/pause/restart, a 100-page per-run limit, UID-scoped checkpoints, repeat-cursor detection, and rejection of late responses after stop/background/account change. Checkpoints advance only after saving a page. Errors preserve the page for retry. These are observed first-party endpoints rather than a supported developer API.

Feed exhaustion means coverage of the returned timelines. It does not establish all outgoing likes: inaccessible/deleted records, replies not encountered, filtering, retention and recommendation coverage remain unknown. The inspected Service Worker only precaches static assets and excludes API routes; no native API history cache, Firestore collection read or liked-ID database call was found. Firebase package registrations alone do not establish a usable database API. Post-specific likers only show incoming likes to an author-owned post.

The local archive removes silent 500-record eviction and separates retention from 50-row display. Search, photo/video filtering and saved/post-date order operate on local snapshots after mute checks. Explicit JSON backup/import is account-scoped and preserves existing snapshots. Import does not invoke favorite/unfavorite APIs and is not server synchronization. X [advanced search](https://help.x.com/en/using-x/x-advanced-search) and [X Pro filtering](https://help.x.com/en/using-x/advanced-postdeck-features) informed local search/filter usability; their server operators are not claimed to work on Tweet.


## 6.16.0 fullscreen and viewport evidence (2026-10-02)

The first-party client asset `https://app.tweet.app/assets/index-9cXdkXL7.js` was fetched again: 1,678,279 bytes, SHA-256 `621409602148797941d4370b6e7cbc5adba4f002acef694b5deca98b2aadda35`. It remains the same inspected v2.1.1 client. Its inline video manager ranks wrapper IntersectionObserver visibility and pauses out-of-view players; no fullscreen exemption was found. Native videos use `controls`, `playsInline`, `loop` and an object-contain layout. The native image viewer uses a header followed by a flex stage; the local profile photo viewer also previously reserved a separate bottom navigation row.

The enhancement keeps the same video node and media source. The extra action invokes standard `requestFullscreen()` directly within the click, with Safari's `webkitEnterFullscreen()` as the supported fallback. It never calls play(), seeks, changes sound/rate, clones, reparents or reloads the video. While the same visible account/route/source video is actively playing in fullscreen, its instance pause method narrowly ignores JavaScript pause calls from the inline manager. Native player pause events remain authoritative. Exit, failure, hidden tab, route/source/account change and removal restore the original instance descriptor; later page-owned method replacements are preserved. Request generations reject stale completions and queued events. This is a mitigation for the observed manager, rather than a new server API.

Standard fullscreen requires transient user activation and may be rejected; see [MDN requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen). Safari video presentation is described by [Apple's video delivery documentation](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari) and [HTML5 media control documentation](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/ControllingMediaWithJavaScript/ControllingMediaWithJavaScript.html). The actual browser fullscreen request was denied in this automation session. A clearly labeled local fullscreen-state reproduction with a real decoded 30-second WebM confirmed the same node keeps playing against the modeled inline pause manager and honors native user pause. It does not establish operating-system fullscreen acceptance in Chrome, Safari or Android.

Both native and local profile photo stages center within the full visible viewport, with symmetric safe-area padding and visualViewport resize/scroll updates. Close and carousel controls overlay the stage and retain their existing event handlers. The user requested a read-only Favorites summary: search/filter/sort controls were removed, while counts, available-record post dates, recovery feed coverage/progress, pagination and account-local JSON backup remain. No new API request or history scan starts merely by opening this summary. It still cannot guarantee all past outgoing likes.

## 6.17.0 Post and reply creation-time evidence (2026-10-02)

The retained current first-party [index-9cXdkXL7.js](https://app.tweet.app/assets/index-9cXdkXL7.js) is still 1,678,279 bytes with SHA-256 `621409602148797941d4370b6e7cbc5adba4f002acef694b5deca98b2aadda35`. Its `hd()` relative formatter computes elapsed time when React renders; inspection found no independent interval updating those labels. Native post creation uses `created_at` before `createdAt`. Main post headers expose the creation ISO in their timestamp title, while inline reply spans omit that title. Edited metadata is a separate UI marker; it is not a creation-time source.

Read-only browser inspection confirmed native `GET /api/posts/{parentId}/replies?limit=20` returns a `replies` array and an explicit `nextCursor: null` for the observed complete response. One returned reply had `createdAt: "2026-10-02T12:38:18.993Z"`, without `created_at` or `editedAt` in that record. This establishes the observed creation field for that reply, not a universal guarantee about all server records. No reply, like, edit or other engagement write was used for this investigation.

The previous enhancement searched arbitrary descendant `[title]` and `[datetime]` values and skipped an already inserted detail stamp. That permitted non-creation dates and retained stale stamps after source changes. A post URL could also exist briefly while the old feed remained mounted. The new source guard checks the same article's native author/separator/creation span, excludes Edited/quotes/nested content, and requires the actual conversation panel with a Back header, direct scroll area and reply-form footer before showing a detail date. Each verified source is refreshed; a stale unverified stamp is removed. Relative clocks update their own native text nodes while visible and suspend with page lifecycle changes.

Title-less replies use the same established parent route, with a unique original author/body/initial-age match and no parent, edit or saved-time fallback. The resolver accepts only a complete page of at most 50 replies, checks up to 20 visible candidates per scan, and permits four concurrent reads. It makes one request per opened native container; distinct inline/detail containers for the same parent can each request once. A response may bind only the initial reply-node snapshot during its first 60 seconds. New nodes, ambiguous IDs/bodies, translated replies, unfinished pagination, malformed records and stale identity/context changes are rejected. A clock-updated label is tracked separately from later native changes; an invalidated node cannot reuse its older cached creation date. Clock refreshes perform no API reads, and unresolved replies keep native presentation. This uses an observed first-party contract rather than a supported external developer API.

[MDN Date.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse) documents browser-dependent nonstandard parsing, calendar rollover differences, and the distinction between date-only UTC interpretation and timezone-less local date/time. The enhancement therefore requires an explicit offset and validates the calendar before using a creation string. [ECMAScript's Date Time String Format](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-time-string-format) specifies three-digit milliseconds. API fractions of one to nine digits are padded/truncated to that form only for Date construction; saved records retain their original string. This avoids depending on native acceptance of six-digit fractions. A simulated browser that rejects the raw six-digit form verified normalization/storage/import handling; this is not a physical Safari acceptance claim.

Profile Media/Favorites use the same valid-alias parser for dates and ordering, display browser-local dates and clock times, and retain a previously stored creation timestamp for the same post when recovery supplies no valid creation date. Ambiguous legacy strings are kept under the existing storage/backup rules but do not supply clock times or date-range values. No Japanese time zone is forced on either language edition. Physical Safari/Stay and Android/Tampermonkey timestamp behavior remains unverified; current automated and browser checks are recorded separately in `VALIDATION.md`.


## 6.18.0 performance recheck (2026-10-03 JST)

Re-fetched the official client asset `https://app.tweet.app/assets/index-9cXdkXL7.js`: 1,678,279 bytes; SHA-256 `621409602148797941d4370b6e7cbc5adba4f002acef694b5deca98b2aadda35`, unchanged from the previous verified release. The authenticated native feed was read in the in-app browser. No new API contract, upload limit change or complete outgoing-like-history endpoint is claimed.

This release reduces work in the userscript rather than changing service APIs. Existing reply GET bounds, account validation, mute checks and explicit Favorites recovery remain authoritative. Date-format caching and clock updates make no new requests; partial mutation handling retains known native layout/context checks.
