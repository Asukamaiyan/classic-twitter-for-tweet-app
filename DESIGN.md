# Implementation boundaries

Source templates in `src/ja.js` and `src/en.js` embed shared network, runtime and local-tools modules at build time. Greasy Fork receives self-contained files without remote code loading. A build check ensures all three distributions remain reproducible.

Localization uses structural UI allowlists and content exclusions. Notification action fragments are handled within each row so neighboring actors and previews cannot be merged. React retains ownership of its controls and text containers.

The observer disconnects during synchronous patches, coalesces mutations and observes only relevant text/attributes. Asynchronous profile patches are idempotent. No three-second full-document polling. Background reply checks pause when hidden and remain read-only.

The shared network module accepts GET requests to the established API origin only, handles callback/Promise userscript managers, closes authentication databases, bounds waiting and backs off failed profile lookups. It does not create credentials or log tokens.

Local tools store only user-entered search/filter settings. Native search is populated through ordinary input events. Keyword filters fold already-rendered post content with an explicit reveal control; they do not change server notifications or recommendations. Native post translation stays under user control and follows the service's browser-language behavior.

The 6.7.1 tools panel remains non-modal. Its trigger precedes the panel in DOM order, opening moves focus to its close control, and Escape returns focus to the trigger. A fixed header and status footer surround the scrolling form sections. Verified tweet.app theme tokens supply surface, input, text and feedback colors; z-index stays below native z-50 dialogs. A short local entrance transition is disabled under reduced motion. VisualViewport resize/scroll updates panel bounds without changing page zoom or native navigation.
