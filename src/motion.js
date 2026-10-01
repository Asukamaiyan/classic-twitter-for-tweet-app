  // Local motion is limited to verified classic controls. It never dispatches
  // clicks or changes native favorite state, labels, counts or event handlers.
  const ctClassicMotion = {
    enabled: false, pageActive: true, bound: false, media: null,
    likes: new WeakMap(), running: new Map(), connectionObserver: null
  };

  function ctMotionPaused() {
    return !ctClassicMotion.enabled || !ctClassicMotion.pageActive || document.hidden ||
      ctClassicMotion.media?.matches === true;
  }

  function ctClearFavoriteMotion(button, expected, cancel = false) {
    const job = ctClassicMotion.running.get(button);
    if (!job || (expected && job !== expected)) return;
    ctClassicMotion.running.delete(button);
    clearTimeout(job.timer);
    if (cancel) { try { job.animation.cancel(); } catch {} }
    if (!ctClassicMotion.running.size) {
      ctClassicMotion.connectionObserver?.disconnect();
      ctClassicMotion.connectionObserver = null;
    }
  }

  function ctStopClassicMotion() {
    for (const [button, job] of ctClassicMotion.running) ctClearFavoriteMotion(button, job, true);
    // Returning from a hidden tab, reduced motion or OFF is a fresh baseline,
    // not a new favorite action to replay.
    ctClassicMotion.likes = new WeakMap();
  }

  function ctSyncClassicMotion() {
    const paused = ctMotionPaused();
    const classicPaused = ctClassicMotion.enabled && paused;
    const classes = document.documentElement.classList;
    if (classes.contains('ct-classic-motion-enabled') !== ctClassicMotion.enabled) classes.toggle('ct-classic-motion-enabled', ctClassicMotion.enabled);
    if (classes.contains('ct-classic-motion-paused') !== classicPaused) classes.toggle('ct-classic-motion-paused', classicPaused);
    if (paused) ctStopClassicMotion();
  }

  function ctBindClassicMotion() {
    if (ctClassicMotion.bound) return;
    ctClassicMotion.bound = true;
    try { ctClassicMotion.media = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null; } catch {}
    const change = () => { ctStopClassicMotion(); ctSyncClassicMotion(); };
    if (typeof ctClassicMotion.media?.addEventListener === 'function') ctClassicMotion.media.addEventListener('change', change);
    else ctClassicMotion.media?.addListener?.(change);
    document.addEventListener('visibilitychange', change);
    window.addEventListener('pagehide', () => { ctClassicMotion.pageActive = false; change(); });
    window.addEventListener('pageshow', () => {
      // The normal initial pageshow can arrive after the first runtime scan.
      // Keep that baseline; only an actual return from pagehide needs a reset.
      if (ctClassicMotion.pageActive) return;
      ctClassicMotion.pageActive = true;
      change();
    });
  }

  function ctInstallClassicMotionStyle() {
    if (document.getElementById('ct-classic-motion-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-classic-motion-style';
    const controls = ':is(.ct-classic-nav a, .ct-classic-nav button, .ct-classic-top-tabs button, .ct-classic-timeline [data-testid="tweet-like-action"], .ct-classic-composer button, #ct-local-tools button, #ct-local-tools a)';
    style.textContent = `
      html.ct-classic-motion-enabled:not(.ct-classic-motion-paused) ${controls} {
        transition:color 120ms ease-out, background-color 120ms ease-out, box-shadow 120ms ease-out;
      }
      html.ct-classic-motion-enabled ${controls}:focus-visible {
        outline:2px solid var(--color-tl-app-primary, #1688d4);
        outline-offset:3px;
      }
      html.ct-classic-motion-paused ${controls},
      html.ct-classic-motion-paused [data-testid="tweet-like-action"] > .ct-star,
      html.ct-classic-motion-paused #ct-local-tools-panel {
        animation:none!important;
        transition:none!important;
      }
      @media (prefers-reduced-motion:reduce) {
        html.ct-classic-motion-enabled ${controls}, html.ct-classic-motion-enabled [data-testid="tweet-like-action"] > .ct-star,
        html.ct-classic-motion-enabled #ct-local-tools-panel { animation:none!important; transition:none!important; }
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function ctAnimateFavorite(button, liked) {
    if (!button?.matches?.('[data-testid="tweet-like-action"]')) return;
    const previous = ctClassicMotion.likes.get(button);
    const selected = liked === true;
    const article = button.closest('article');
    // Runtime's verified own permalink identifies a reused React card. If it
    // is not available, the containing article still guards moved controls.
    const id = article && typeof articleId === 'function' ? articleId(article) : null;
    const owner = article || button;
    const samePost = previous && previous.owner === owner && previous.id === id;
    ctClassicMotion.likes.set(button, { selected, owner, id });
    if (previous && !samePost) ctClearFavoriteMotion(button, null, true);
    if (!selected || !button.isConnected || ctMotionPaused()) {
      ctClearFavoriteMotion(button, null, true);
      return;
    }
    // Initial selected nodes and React replacements do not represent actions.
    // A click which leaves native state unchanged also cannot animate.
    if (!samePost || previous.selected !== false) return;
    const star = [...button.children].find(node => node.classList.contains('ct-star'));
    if (!star?.isConnected || typeof star.animate !== 'function') return;
    ctClearFavoriteMotion(button, null, true);
    let animation;
    try {
      animation = star.animate([
        { transform: 'scale(1) rotate(0deg)', transformOrigin: '50% 50%', offset: 0 },
        { transform: 'scale(1.22) rotate(-7deg)', transformOrigin: '50% 50%', offset: .42 },
        { transform: 'scale(.97) rotate(3deg)', transformOrigin: '50% 50%', offset: .74 },
        { transform: 'scale(1) rotate(0deg)', transformOrigin: '50% 50%', offset: 1 }
      ], { duration: 280, easing: 'cubic-bezier(.25,.9,.35,1)', fill: 'none' });
    } catch { return; }
    const job = { star, animation, timer: null };
    ctClassicMotion.running.set(button, job);
    const finish = () => ctClearFavoriteMotion(button, job);
    // Safari's Animation.finished and a bounded cleanup both leave no inline
    // transform behind. Catch cancellation so it never becomes a rejection.
    animation.finished?.then?.(finish, finish);
    job.timer = setTimeout(() => ctClearFavoriteMotion(button, job, true), 320);
    if (!ctClassicMotion.connectionObserver && typeof MutationObserver === 'function') {
      ctClassicMotion.connectionObserver = new MutationObserver(() => {
        for (const [target, active] of ctClassicMotion.running) {
          if (!target.isConnected || !active.star.isConnected || !target.contains(active.star)) {
            ctClearFavoriteMotion(target, active, true);
          }
        }
      });
      ctClassicMotion.connectionObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function patchClassicMotion(root = document, enabled = true) {
    // This switch is page-wide even when the runtime scans one changed subtree.
    // The supplied root is intentionally not transformed or animated.
    if (!root) return;
    ctBindClassicMotion();
    ctInstallClassicMotionStyle();
    const next = enabled === true;
    if (ctClassicMotion.enabled !== next) ctStopClassicMotion();
    ctClassicMotion.enabled = next;
    ctSyncClassicMotion();
    for (const [button, job] of ctClassicMotion.running) {
      if (!button.isConnected || !job.star.isConnected) ctClearFavoriteMotion(button, job, true);
    }
  }
