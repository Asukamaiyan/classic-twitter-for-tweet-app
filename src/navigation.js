  // The native notification row opens its representative event. Its avatars do
  // not have individual profile handlers, and their alt text is a display name,
  // never a username. Resolve identities only from native handles or API actors.
  const ctNavigationState = {
    installed: false, pending: null, uid: null, fetchedAt: 0, retryAt: 0,
    actors: new Map(), overlays: new Map(), generation: 0, loading: false,
    nextCursor: null, initialized: false, pagesFetched: 0, lastAttempt: '', cursorSeen: new Set()
  };
  const ctAvatarWrapperSelector = 'div.relative.inline-flex.shrink-0.isolate';
  const ctNativeFollowSelector = 'span[role="button"][aria-label]';

  function ctNavigationJapanese() { return CT_LOCALE === 'ja'; }
  function ctNavigationHandle(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value.trim()) ? value.trim().toLowerCase() : null;
  }
  function ctNativeAvatar(wrapper) {
    const avatarSelector = 'img.rounded-full.object-cover,div[role="img"].rounded-full';
    for (const child of wrapper.children) {
      if (child.matches(avatarSelector)) return child;
      // Uo renders the same avatar directly in notifications, but wraps it in a
      // profile button in feeds, post details and replies. Inspect only this
      // verified native button, never arbitrary descendants or ordinary Follow.
      if (child.matches('button.rounded-full[aria-label]') &&
          /^View @[a-zA-Z0-9_.-]{1,80}'s profile$/.test(child.getAttribute('aria-label') || '')) {
        const avatar = [...child.children].find(el => el.matches(avatarSelector));
        if (avatar) return avatar;
      }
    }
    return null;
  }
  function ctNativeAvatarFollow(wrapper) {
    return [...wrapper.children].find(el => el.matches(ctNativeFollowSelector) &&
      el.classList.contains('absolute') && el.classList.contains('-bottom-0.5') &&
      el.classList.contains('-right-0.5') && /^(?:Follow|Following) @[a-zA-Z0-9_.-]{1,80}$/.test(el.getAttribute('aria-label') || '')) || null;
  }
  function ctAvatarURL(value) {
    if (!value || value === 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150') return '';
    try {
      // Public avatars returned by tweet.app use absolute URLs. A relative URL
      // may refer to a different media origin, so do not infer that origin here.
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function ctAvatarIdentity(wrapper) {
    const avatar = ctNativeAvatar(wrapper);
    if (!avatar) return null;
    const label = avatar.getAttribute(avatar.tagName === 'IMG' ? 'alt' : 'aria-label') || '';
    const suffix = avatar.tagName === 'IMG' ? ' avatar' : ' avatar placeholder';
    if (!label.endsWith(suffix)) return null;
    const name = label.slice(0, -suffix.length);
    const url = avatar.tagName === 'IMG' ? ctAvatarURL(avatar.getAttribute('src')) : '';
    return name && name.length <= 512 && url !== null ? `${name}\n${url}` : null;
  }
  function ctNotificationAvatarWrappers() {
    if (!/^\/notifications\/?$/.test(location.pathname)) return [];
    return [...document.querySelectorAll(`main button.items-start.border-b ${ctAvatarWrapperSelector}`)]
      .filter(el => ctNativeAvatar(el) && !el.closest('article,[data-ct-local-ui]'));
  }
  function ctNotificationAvatarHandle(wrapper) {
    const native = ctNativeAvatarFollow(wrapper)?.getAttribute('aria-label')?.match(/ @([a-zA-Z0-9_.-]+)$/)?.[1];
    if (native) return ctNavigationHandle(native);
    if (ctNavigationState.uid !== ctNetworkState.authUID) return null;
    const identity = ctAvatarIdentity(wrapper);
    return identity ? ctNavigationState.actors.get(identity) || null : null;
  }
  function ctAddNotificationActors(json, actors) {
    if (!json || json.success !== true || !Array.isArray(json.notifications)) return false;
    for (const item of json.notifications.slice(0, 100)) {
      const handle = ctNavigationHandle(item?.actorHandle);
      const name = item?.actorDisplayName;
      const url = ctAvatarURL(item?.actorAvatarUrl);
      if (!handle || typeof name !== 'string' || !name || name.length > 512 || url === null) continue;
      const identity = `${name}\n${url}`;
      if (actors.has(identity) && actors.get(identity) !== handle) actors.set(identity, null);
      else if (!actors.has(identity)) actors.set(identity, handle);
    }
    return true;
  }
  function ctRenderNotificationAvatars() {
    const japanese = ctNavigationJapanese();
    for (const wrapper of ctNotificationAvatarWrappers()) {
      let link = wrapper.querySelector(':scope > a.ct-notification-profile-link');
      if (!link) {
        link = document.createElement('a');
        link.className = 'ct-notification-profile-link';
        link.dataset.ctLocalUi = 'notification-profile';
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        wrapper.append(link);
      }
      const handle = ctNotificationAvatarHandle(wrapper);
      const label = handle ? (japanese ? `@${handle}のプロフィールを開く` : `Open @${handle}'s profile`) :
        ctNavigationState.loading ? (japanese ? 'プロフィールを確認中…' : 'Looking up profile…') :
          (japanese ? 'プロフィールを特定できません。押すと再確認します' : 'Profile unavailable. Activate to retry');
      const href = handle ? `/user/${encodeURIComponent(handle)}` : null;
      if (href && link.getAttribute('href') !== href) link.setAttribute('href', href);
      else if (!href) link.removeAttribute('href');
      if (handle) link.removeAttribute('aria-disabled');
      else if (link.getAttribute('aria-disabled') !== 'true') link.setAttribute('aria-disabled', 'true');
      if (link.getAttribute('aria-label') !== label) link.setAttribute('aria-label', label);
      if (link.title !== label) link.title = label;
    }
  }
  function ctUnresolvedNotificationActors() {
    return [...new Set(ctNotificationAvatarWrappers().filter(wrapper => !ctNotificationAvatarHandle(wrapper))
      .map(wrapper => ctAvatarIdentity(wrapper) || 'unknown-avatar'))].sort().join('\n\n');
  }
  function ctResetNotificationActorCache() {
    ctNavigationState.actors.clear();
    ctNavigationState.fetchedAt = 0;
    ctNavigationState.nextCursor = null;
    ctNavigationState.initialized = false;
    ctNavigationState.pagesFetched = 0;
    ctNavigationState.lastAttempt = '';
    ctNavigationState.cursorSeen.clear();
  }
  function ctLoadNotificationActors({ retry = false } = {}) {
    if (ctNavigationState.pending) return ctNavigationState.pending;
    if (!/^\/notifications\/?$/.test(location.pathname) || Date.now() < ctNavigationState.retryAt) return Promise.resolve();
    const generation = ctNavigationState.generation;
    const pending = Promise.resolve().then(async () => {
      const auth = await getAuth();
      if (generation !== ctNavigationState.generation || !/^\/notifications\/?$/.test(location.pathname)) return;
      if (ctNavigationState.uid !== (auth?.uid || null)) {
        ctNavigationState.uid = auth?.uid || null;
        ctResetNotificationActorCache();
      }
      if (!auth?.token || !auth.uid) { ctNavigationState.retryAt = Date.now() + 10000; return; }
      const unresolved = ctUnresolvedNotificationActors();
      if (!unresolved) return;
      const fresh = Date.now() - ctNavigationState.fetchedAt < 60000;
      const changed = unresolved !== ctNavigationState.lastAttempt;
      if (fresh && !changed && !retry) return;
      ctNavigationState.loading = true;
      ctRenderNotificationAvatars();
      // Keep older pages when a grouped row has more than eight actors. Starting
      // again from the newest page could otherwise never reach an older avatar.
      const actors = new Map(ctNavigationState.actors);
      const headOnly = ctNavigationState.initialized && !fresh && !changed && !retry;
      const continuing = ctNavigationState.initialized && !!ctNavigationState.nextCursor && (fresh || retry);
      let cursor = continuing ? ctNavigationState.nextCursor : null;
      const budget = headOnly ? 1 : retry || !continuing ? 20 : Math.max(0, 20 - ctNavigationState.pagesFetched);
      if (!headOnly && !continuing) {
        ctNavigationState.pagesFetched = 0;
        ctNavigationState.cursorSeen.clear();
      }
      for (let page = 0; page < budget; page++) {
        if (cursor && ctNavigationState.cursorSeen.has(cursor)) break;
        const query = new URLSearchParams({ limit: '20' });
        if (cursor) query.set('cursor', cursor);
        const json = await requestJSON(`https://api.tweet.app/api/notifications?${query}`, { Authorization: `Bearer ${auth.token}` });
        if (generation !== ctNavigationState.generation || ctNetworkState.authUID !== auth.uid ||
            !/^\/notifications\/?$/.test(location.pathname)) return;
        if (!ctAddNotificationActors(json, actors)) { ctNavigationState.retryAt = Date.now() + 10000; return; }
        if (cursor) ctNavigationState.cursorSeen.add(cursor);
        while (actors.size > 1000) actors.delete(actors.keys().next().value);
        ctNavigationState.actors = actors;
        ctNavigationState.initialized = true;
        if (!cursor) ctNavigationState.fetchedAt = Date.now();
        const next = typeof json.nextCursor === 'string' && json.nextCursor.length <= 2048 ? json.nextCursor : null;
        if (!headOnly) {
          ctNavigationState.pagesFetched++;
          ctNavigationState.nextCursor = next;
        }
        ctRenderNotificationAvatars();
        if (ctNotificationAvatarWrappers().every(wrapper => ctNotificationAvatarHandle(wrapper))) break;
        if (!next || ctNavigationState.cursorSeen.has(next)) break;
        cursor = next;
      }
      ctNavigationState.lastAttempt = ctUnresolvedNotificationActors();
    }).catch(() => { ctNavigationState.retryAt = Date.now() + 10000; }).finally(() => {
      if (ctNavigationState.pending === pending) {
        ctNavigationState.pending = null;
        ctNavigationState.loading = false;
        ctRenderNotificationAvatars();
      }
    });
    ctNavigationState.pending = pending;
    return pending;
  }
  function ctNotificationLinkEvent(event) {
    const link = event.target?.closest?.('a.ct-notification-profile-link');
    if (!link || !/^\/notifications\/?$/.test(location.pathname)) return;
    const wrapper = link.parentElement;
    if (!wrapper?.matches(ctAvatarWrapperSelector) || !wrapper.closest('main button.items-start.border-b')) return;
    // A React update may arrive between the last scan and this click. Never
    // navigate using the previous avatar's URL while the next scan is queued.
    const handle = ctNotificationAvatarHandle(wrapper);
    const href = handle ? `/user/${encodeURIComponent(handle)}` : null;
    if (href && link.getAttribute('href') !== href) link.setAttribute('href', href);
    else if (!href) link.removeAttribute('href');
    // Stop the outer React row handler, but keep real-anchor defaults: normal,
    // modified, middle-button and context-menu navigation all retain their URLs.
    event.stopPropagation();
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.key === ' ' || !link.hasAttribute('href')) event.preventDefault();
      if (link.hasAttribute('href') || event.key !== 'Enter') return;
    } else if (link.hasAttribute('href')) return;
    event.preventDefault();
    if (event.type === 'click' || event.type === 'keydown') {
      void ctLoadNotificationActors({ retry: true });
    }
  }
  function installNativeNavigation() {
    if (ctNavigationState.installed) return;
    ctNavigationState.installed = true;
    const style = document.createElement('style');
    style.id = 'ct-native-navigation-style';
    style.textContent = '.ct-avatar-follow-hidden{display:none!important;pointer-events:none!important}' +
      '.ct-notification-profile-link{position:absolute;inset:0;z-index:2;display:block;border-radius:9999px;background:transparent;cursor:pointer}' +
      '.ct-notification-profile-link:focus-visible{outline:2px solid #0ea5e9;outline-offset:3px}' +
      '.ct-notification-profile-link[aria-disabled="true"]{cursor:help}';
    (document.head || document.documentElement).append(style);
    for (const type of ['click', 'auxclick', 'keydown', 'contextmenu']) document.addEventListener(type, ctNotificationLinkEvent, true);
  }
  function patchNavigation(root = document) {
    installNativeNavigation();
    if (ctNavigationState.uid && ctNetworkState.authUID !== ctNavigationState.uid) {
      ctNavigationState.uid = null;
      ctResetNotificationActorCache();
    }
    const wrappers = [...root.querySelectorAll(ctAvatarWrapperSelector)];
    if (root.matches?.(ctAvatarWrapperSelector)) wrappers.unshift(root);
    for (const wrapper of wrappers) {
      if (!ctNativeAvatar(wrapper) || wrapper.closest('[data-ct-local-ui]')) continue;
      const overlay = ctNativeAvatarFollow(wrapper);
      if (!overlay) continue;
      if (!ctNavigationState.overlays.has(overlay)) ctNavigationState.overlays.set(overlay, {
        tabIndex: overlay.getAttribute('tabindex'), hidden: overlay.getAttribute('aria-hidden')
      });
      overlay.classList.add('ct-avatar-follow-hidden');
      if (overlay.getAttribute('tabindex') !== '-1') overlay.setAttribute('tabindex', '-1');
      if (overlay.getAttribute('aria-hidden') !== 'true') overlay.setAttribute('aria-hidden', 'true');
    }
    for (const overlay of ctNavigationState.overlays.keys()) if (!overlay.isConnected) ctNavigationState.overlays.delete(overlay);
    ctRenderNotificationAvatars();
    const unresolved = ctUnresolvedNotificationActors();
    if (unresolved && (Date.now() - ctNavigationState.fetchedAt >= 60000 || unresolved !== ctNavigationState.lastAttempt)) {
      void ctLoadNotificationActors();
    }
  }
  function destroyNativeNavigation() {
    ctNavigationState.generation++;
    ctNavigationState.installed = false;
    for (const type of ['click', 'auxclick', 'keydown', 'contextmenu']) document.removeEventListener(type, ctNotificationLinkEvent, true);
    document.getElementById('ct-native-navigation-style')?.remove();
    document.querySelectorAll('a.ct-notification-profile-link').forEach(link => link.remove());
    for (const [overlay, original] of ctNavigationState.overlays) {
      overlay.classList.remove('ct-avatar-follow-hidden');
      for (const [attribute, value] of [['tabindex', original.tabIndex], ['aria-hidden', original.hidden]]) {
        if (value === null) overlay.removeAttribute(attribute); else overlay.setAttribute(attribute, value);
      }
    }
    ctNavigationState.overlays.clear();
    ctResetNotificationActorCache();
    ctNavigationState.pending = null;
    ctNavigationState.uid = null;
    ctNavigationState.fetchedAt = ctNavigationState.retryAt = 0;
    ctNavigationState.loading = false;
  }
