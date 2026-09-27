# 6.7.0: safe localization and browser tools

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
