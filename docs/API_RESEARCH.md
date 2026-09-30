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
