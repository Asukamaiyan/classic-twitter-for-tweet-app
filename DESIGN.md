# Implementation boundaries

Source templates in `src/ja.js` and `src/en.js` embed shared network, runtime and local-tools modules at build time. Greasy Fork receives self-contained files without remote code loading. A build check ensures all three distributions remain reproducible.

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
