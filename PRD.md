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
