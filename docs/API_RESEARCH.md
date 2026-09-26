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
