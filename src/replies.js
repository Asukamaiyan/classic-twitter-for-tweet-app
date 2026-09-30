  // Browser-local reply inbox. All routes and response shapes come from Tweet's own client.
  // No native notification is marked read and no posting/following API is called here.
  const ctReplyState = {
    uid: null, data: null, busy: false, lastAttempt: -Infinity, error: '', storageError: false,
    rendered: '', storageBound: false, tabActive: false, mount: null
  };
  const CT_REPLY_PREFIX = 'ct-replies-v2:';
  const CT_REPLY_INTERVAL = 90000;
  const CT_REPLY_THREADS = 24;
  const CT_REPLY_BATCH = 6;
  const CT_REPLY_PAGES = 3;

  function ctReplyText(ja, en) { return CT_LOCALE === 'ja' ? ja : en; }
  function ctReplyId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
  }
  function ctReplyHandle(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
  }
  function ctReplyAvatar(value) {
    if (typeof value !== 'string' || value.length > 4000) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function ctReplyEmpty() {
    return { startedAt: Date.now(), checkedAt: 0, notices: [], seen: [], threads: {} };
  }
  function ctReplyBadgeMetadata(item) {
    return {
      authorBadges: Array.isArray(item.authorBadges) ? item.authorBadges.filter(value =>
        typeof value === 'string' && /^(team_member|centurion|founding_special|founding|wing|ambassador|press)$/.test(value)) : [],
      authorFoundingMemberNumber: /^\d{1,20}$/.test(String(item.authorFoundingMemberNumber ?? ''))
        ? String(item.authorFoundingMemberNumber) : null
    };
  }
  function ctReplyRead(uid) {
    try {
      const raw = JSON.parse(localStorage.getItem(CT_REPLY_PREFIX + encodeURIComponent(uid)) || 'null');
      if (!raw || !Array.isArray(raw.notices)) return ctReplyEmpty();
      return {
        startedAt: Number(raw.startedAt) || Date.now(), checkedAt: Number(raw.checkedAt) || 0,
        notices: raw.notices.filter(item => ctReplyId(item?.id) && ctReplyHandle(item?.authorUsername))
          .slice(0, 100).map(item => ({
            id: item.id, parentId: ctReplyId(item.parentId), authorUsername: item.authorUsername,
            authorName: typeof item.authorName === 'string' ? item.authorName.slice(0, 200) : item.authorUsername,
            authorAvatar: ctReplyAvatar(item.authorAvatar), text: typeof item.text === 'string' ? item.text.slice(0, 4000) : '',
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '', detectedAt: Number(item.detectedAt) || 0,
            read: item.read === true, ...ctReplyBadgeMetadata(item)
          })),
        seen: Array.isArray(raw.seen) ? raw.seen.filter(ctReplyId).slice(-4000) : [],
        threads: raw.threads && typeof raw.threads === 'object' && !Array.isArray(raw.threads) ? raw.threads : {}
      };
    } catch { return ctReplyEmpty(); }
  }
  function ctReplyWrite(uid, data) {
    // Preserve acknowledgements made by another tab while network requests were running.
    const latest = ctReplyRead(uid);
    const read = new Set(latest.notices.filter(item => item.read).map(item => item.id));
    const notices = new Map(latest.notices.map(item => [item.id, item]));
    for (const item of data.notices) notices.set(item.id, { ...item, read: item.read || read.has(item.id) });
    const merged = {
      ...data, notices: [...notices.values()].sort((a, b) =>
        (Date.parse(b.createdAt) || b.detectedAt || 0) - (Date.parse(a.createdAt) || a.detectedAt || 0)
      ).slice(0, 100), seen: [...new Set([...latest.seen, ...data.seen])].slice(-4000)
    };
    try {
      localStorage.setItem(CT_REPLY_PREFIX + encodeURIComponent(uid), JSON.stringify(merged));
      ctReplyState.storageError = false;
      return merged;
    } catch {
      ctReplyState.storageError = true;
      return merged;
    }
  }
  function ctReplyCheckKnownIdentity() {
    if (ctReplyState.uid && typeof ctNetworkState !== 'undefined' && ctNetworkState.authUID !== ctReplyState.uid) {
      ctReplyState.uid = null;
      ctReplyState.data = null;
      ctReplyState.error = '';
      ctReplyState.storageError = false;
    }
  }
  function loadReplyNotices() {
    ctReplyCheckKnownIdentity();
    return ctReplyState.uid ? (ctReplyState.data?.notices || []) : [];
  }
  function markReplyRead(id, deferRender = false) {
    ctReplyCheckKnownIdentity();
    if (!ctReplyState.uid || !ctReplyState.data) return;
    const data = ctReplyRead(ctReplyState.uid);
    // Retain this tab's in-memory replies if browser storage is unavailable.
    data.notices = [...new Map([...data.notices, ...loadReplyNotices()].map(item => [item.id, item])).values()]
      .map(item => !id || item.id === id ? { ...item, read: true } : item);
    ctReplyState.data = ctReplyWrite(ctReplyState.uid, { ...ctReplyState.data, notices: data.notices });
    const updateUI = () => { renderReplyPanel(); patchReplyBadge(); };
    // Keep the activated anchor connected until its native click action has run.
    // This also preserves normal browser modifier-key/new-tab navigation.
    if (deferRender) setTimeout(updateUI, 0);
    else updateUI();
  }
  async function ctReplyJSON(path, auth) {
    const json = await requestJSON(API_ORIGIN + path, { Authorization: `Bearer ${auth.token}` });
    if (!json || typeof json !== 'object' || json.success === false || json.error) return null;
    return json;
  }
  function ctReplySelectParents(posts, replies, username) {
    const candidates = [...posts, ...replies.map(item => item?.post)];
    return [...new Map(candidates.filter(post => ctReplyId(post?.id) &&
      ctReplyHandle(post?.authorUsername)?.toLowerCase() === username.toLowerCase() &&
      !post.originalPostId && !post.isRepost && !post.repostedBy).map(post => [post.id, post])).values()]
      .sort((a, b) => (Date.parse(b.createdAt ?? b.created_at) || 0) - (Date.parse(a.createdAt ?? a.created_at) || 0))
      .slice(0, CT_REPLY_THREADS)
      .filter(post => Number(post.replyCount ?? post.comments ?? 0) > 0);
  }
  function ctReplyRecord(reply, parentId, username, data) {
    const id = ctReplyId(reply?.id);
    const handle = ctReplyHandle(reply?.authorUsername);
    if (!id || !handle || handle.toLowerCase() === username.toLowerCase() || reply.isDeleted ||
        reply.originalPostId || (reply.parentId && reply.parentId !== parentId)) return;
    const existing = data.notices.find(item => item.id === id);
    const wasSeen = data.seen.includes(id);
    if (!wasSeen) data.seen.push(id);
    if (wasSeen && !existing) return;
    const createdAt = typeof (reply.createdAt ?? reply.created_at) === 'string' ? (reply.createdAt ?? reply.created_at) : '';
    const created = Date.parse(createdAt);
    const record = {
      id, parentId, authorUsername: handle,
      authorName: typeof reply.authorName === 'string' ? reply.authorName.slice(0, 200) : handle,
      authorAvatar: ctReplyAvatar(reply.authorAvatar),
      ...ctReplyBadgeMetadata(reply),
      text: typeof reply.text === 'string' ? reply.text.slice(0, 4000) : '',
      createdAt, detectedAt: existing?.detectedAt || Date.now(),
      // Historical replies are useful history, but never an initial unread flood.
      read: existing ? existing.read : (!Number.isFinite(created) || created <= data.startedAt)
    };
    // Trim by creation date only when committing, not by API/parent traversal order.
    data.notices = [record, ...data.notices.filter(item => item.id !== id)];
  }
  async function replyWatchTick(force = false) {
    if (ctReplyState.busy || document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) return;
    const now = Date.now();
    ctReplyState.busy = true;
    try {
      const auth = await getAuth();
      if (!auth?.token || !ctReplyId(auth.uid)) {
        ctReplyState.uid = null;
        ctReplyState.data = null;
        ctReplyState.error = '';
        ctReplyState.storageError = false;
        return;
      }
      const accountChanged = ctReplyState.uid !== auth.uid;
      // Identity checks are never throttled; a newly selected account does not
      // inherit the previous account's polling deadline or visible inbox.
      if (!accountChanged && now - ctReplyState.lastAttempt < (force ? 10000 : CT_REPLY_INTERVAL)) return;
      ctReplyState.lastAttempt = now;
      ctReplyState.error = '';
      if (accountChanged) {
        ctReplyState.uid = auth.uid;
        ctReplyState.data = ctReplyRead(auth.uid);
        ctReplyState.storageError = false;
      }
      renderReplyPanel();
      patchReplyBadge();
      // GET /api/user-profile requires the Firebase uid; the bare route is PUT-only.
      const profileJSON = await ctReplyJSON('/api/user-profile/' + encodeURIComponent(auth.uid), auth);
      const username = ctReplyHandle(profileJSON?.profile?.username);
      if (!username) throw new Error('profile');
      const [postsJSON, repliesJSON] = await Promise.all([
        ctReplyJSON('/api/users/' + encodeURIComponent(username) + '/posts?limit=24', auth),
        ctReplyJSON('/api/users/' + encodeURIComponent(username) + '/replies', auth)
      ]);
      if (!Array.isArray(postsJSON?.posts) || !Array.isArray(repliesJSON?.replies)) throw new Error('threads');
      const data = JSON.parse(JSON.stringify(ctReplyState.data || ctReplyRead(auth.uid)));
      const parents = ctReplySelectParents(postsJSON.posts, repliesJSON.replies, username);
      const parentIds = new Set(parents.map(post => post.id));
      data.threads = Object.fromEntries(Object.entries(data.threads).filter(([id]) => parentIds.has(id)));
      const pending = parents.filter(post => {
        const previous = data.threads[post.id];
        return force || !previous || previous.cursor || previous.count !== Number(post.replyCount ?? post.comments) ||
          now - previous.checkedAt >= 600000;
      }).sort((a, b) => (data.threads[a.id]?.checkedAt || 0) - (data.threads[b.id]?.checkedAt || 0))
        .slice(0, CT_REPLY_BATCH);
      let failures = 0;
      for (const parent of pending) {
        if (document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) break;
        let cursor = data.threads[parent.id]?.cursor || null;
        let successful = true;
        for (let page = 0; page < CT_REPLY_PAGES; page++) {
          const query = new URLSearchParams({ limit: '50' });
          if (cursor) query.set('cursor', cursor);
          const json = await ctReplyJSON('/api/posts/' + encodeURIComponent(parent.id) + '/replies?' + query, auth);
          if (!Array.isArray(json?.replies)) { successful = false; failures++; break; }
          for (const reply of json.replies) ctReplyRecord(reply, parent.id, username, data);
          const next = typeof json.nextCursor === 'string' && json.nextCursor.length <= 2000 ? json.nextCursor : null;
          if (!next || next === cursor) { cursor = null; break; }
          cursor = next;
        }
        if (successful) data.threads[parent.id] = {
          count: Number(parent.replyCount ?? parent.comments), checkedAt: now, cursor
        };
        // A failed page must not be remembered as a successful count baseline.
      }
      const current = await getAuth();
      if (current?.uid !== auth.uid) {
        ctReplyState.uid = null;
        ctReplyState.data = null;
        return;
      }
      data.checkedAt = now;
      ctReplyState.data = ctReplyWrite(auth.uid, data);
      if (failures) ctReplyState.error = ctReplyText('一部の返信を取得できませんでした。次回に再確認します。', 'Some replies could not be checked. They will be retried.');
    } catch {
      ctReplyState.error = ctReplyText('返信を取得できませんでした。ログイン状態を確認して、再確認してください。', 'Replies could not be checked. Check your sign-in and try again.');
    } finally {
      const current = await getAuth();
      if (current?.uid !== ctReplyState.uid) {
        ctReplyState.uid = null;
        ctReplyState.data = null;
      }
      ctReplyState.busy = false;
      renderReplyPanel();
      patchReplyBadge();
    }
  }
  function ctReplyRestoreNative() {
    const mount = ctReplyState.mount;
    if (!mount) return;
    for (const [element, original] of mount.hidden) {
      if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
        if (original.display) element.style.setProperty('display', original.display, original.priority);
        else element.style.removeProperty('display');
      }
      if (element.getAttribute('aria-hidden') === 'true') {
        if (original.aria === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', original.aria);
      }
    }
    mount.hidden.clear();
    mount.bar.removeAttribute('data-ct-reply-tabs-active');
  }
  function closeReplyPanel() {
    ctReplyRestoreNative();
    ctReplyState.mount?.button.remove();
    document.getElementById('ct-reply-panel')?.remove();
    ctReplyState.mount = null;
    ctReplyState.tabActive = false;
    ctReplyState.rendered = '';
  }
  function ctReplyBindStorage() {
    if (ctReplyState.storageBound) return;
    ctReplyState.storageBound = true;
    window.addEventListener('storage', event => {
      if (ctReplyState.uid && event.key === CT_REPLY_PREFIX + encodeURIComponent(ctReplyState.uid)) {
        ctReplyState.data = ctReplyRead(ctReplyState.uid);
        renderReplyPanel();
        patchReplyBadge();
      }
    });
  }
  function ctReplyInstallStyle() {
    if (document.getElementById('ct-reply-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-reply-ui-style';
    style.textContent = `
      #ct-reply-tab { position:relative; flex:1; display:flex; align-items:center; justify-content:center; gap:4px; min-height:48px; min-width:0; padding:8px 6px; border:0; background:transparent; color:var(--tl-app-text-muted,inherit); font:inherit; font-size:15px; font-weight:500; line-height:1.3; cursor:pointer; }
      #ct-reply-tab[aria-pressed="true"] { color:var(--tl-app-text,inherit); font-weight:800; }
      #ct-reply-tab[aria-pressed="true"]::after { content:""; position:absolute; bottom:0; height:4px; width:56px; max-width:70%; border-radius:999px; background:var(--ct-classic-blue,#0ea5e9); }
      #ct-reply-tab > [data-ct-reply-unread] { color:var(--ct-classic-blue,#0ea5e9); font-size:12px; }
      [data-ct-reply-tabs-active] > button:not(#ct-reply-tab) > span { color:var(--tl-app-text-muted,inherit)!important; font-weight:500!important; }
      [data-ct-reply-tabs-active] > button:not(#ct-reply-tab) > span.absolute.bottom-0 { display:none!important; }
      #ct-reply-panel { --ct-reply-border:var(--ct-classic-border,var(--tl-app-border,#8b98a544)); --ct-reply-muted:var(--tl-app-text-muted,#657786); --ct-reply-accent:var(--ct-classic-blue,#0ea5e9); }
      #ct-reply-panel summary { display:flex; align-items:center; justify-content:space-between; min-height:48px; padding:12px 16px; border-bottom:1px solid var(--ct-reply-border); cursor:pointer; list-style:none; font-weight:800; }
      #ct-reply-panel summary::-webkit-details-marker { display:none; }
      #ct-reply-panel summary::after { content:"⌄"; font-size:18px; color:var(--ct-reply-muted); }
      #ct-reply-panel details[open] > summary::after { transform:rotate(180deg); }
      #ct-reply-panel .ct-reply-controls { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; padding:8px 16px; border-bottom:1px solid var(--ct-reply-border); }
      #ct-reply-panel .ct-reply-status { flex:1 1 150px; font-size:12px; line-height:1.5; color:var(--ct-reply-muted); overflow-wrap:anywhere; margin:0; }
      #ct-reply-panel .ct-reply-control { min-height:44px; padding:8px 10px; border:0; background:transparent; color:var(--ct-reply-accent); border-radius:4px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
      #ct-reply-panel .ct-reply-control:disabled { cursor:default; opacity:.5; }
      #ct-reply-panel .ct-reply-help { margin:0; padding:0 16px 10px; font-size:12px; line-height:1.5; color:var(--ct-reply-muted); }
      #ct-reply-panel .ct-reply-empty { margin:0; padding:40px 20px; color:var(--ct-reply-muted); font-size:15px; line-height:1.5; text-align:center; }
      #ct-reply-panel .ct-local-reply-row { display:flex; align-items:flex-start; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ct-reply-border); }
      #ct-reply-panel .ct-local-reply-row[data-unread="true"] { background:color-mix(in srgb,var(--ct-reply-accent) 5%,transparent); }
      #ct-reply-panel .ct-reply-avatar-link { display:flex; align-items:center; justify-content:center; flex:0 0 40px; width:40px; height:40px; border-radius:50%; overflow:hidden; color:var(--ct-reply-accent); background:var(--tl-app-bg,#f5f8fa); font-size:18px; font-weight:700; text-decoration:none; }
      #ct-reply-panel .ct-reply-avatar-link img { width:40px; height:40px; object-fit:cover; }
      .ct-classic-shell #ct-reply-panel .ct-reply-avatar-link { border-radius:4px; }
      #ct-reply-panel .ct-reply-content { flex:1; min-width:0; overflow-wrap:anywhere; }
      #ct-reply-panel .ct-reply-actor-line { display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 5px; font-size:15px; line-height:1.4; }
      #ct-reply-panel .ct-reply-author { display:inline-flex; align-items:center; gap:4px; min-width:0; max-width:100%; color:inherit; font-weight:800; text-decoration:none; }
      #ct-reply-panel .ct-reply-name { overflow-wrap:anywhere; }
      #ct-reply-panel .ct-reply-handle,#ct-reply-panel time { color:var(--ct-reply-muted); font-size:13px; }
      #ct-reply-panel .ct-reply-unread { color:var(--ct-reply-accent); font-size:11px; }
      #ct-reply-panel .ct-reply-body { display:block; margin:4px 0; color:inherit; text-decoration:none; font-size:15px; line-height:1.5; white-space:pre-wrap; }
      #ct-reply-panel .ct-reply-parent { display:inline-flex; align-items:center; min-height:44px; color:var(--ct-reply-muted); font-size:12px; text-decoration:none; }
      #ct-reply-panel .ct-official-badges { display:inline-flex; align-items:center; gap:2px; }
      #ct-reply-panel .ct-official-badges img { width:18px; height:18px; object-fit:contain; }
      #ct-reply-panel a:focus-visible,#ct-reply-panel button:focus-visible,#ct-reply-panel summary:focus-visible,#ct-reply-tab:focus-visible { outline:2px solid var(--ct-classic-blue,#0ea5e9); outline-offset:-2px; }
      @media(hover:hover) { #ct-reply-tab:hover,#ct-reply-panel .ct-reply-control:hover,#ct-reply-panel .ct-local-reply-row:hover { background:var(--ct-classic-hover,var(--tl-app-bg,#f5f8fa)); } #ct-reply-panel .ct-reply-author:hover,#ct-reply-panel .ct-reply-parent:hover { text-decoration:underline; } }
    `;
    (document.head || document.documentElement).append(style);
  }
  function ctReplyNativeTabbar(main) {
    // Tweet's kie notification component owns this exact row. Do not treat
    // arbitrary sticky navigation, profile tabs or a hidden shell as its inbox.
    return [...main.querySelectorAll('div.sticky')].find(bar => {
      if (bar.closest('[data-ct-local-ui],[hidden],[aria-hidden="true"]') ||
          !['flex', 'items-stretch', 'top-app-header', 'border-b', 'border-tl-app-border'].every(name => bar.classList.contains(name))) return false;
      const nativeButtons = [...bar.children].filter(child => child.matches('button[type="button"]') && child.id !== 'ct-reply-tab');
      return nativeButtons.length >= 2 && nativeButtons.every(button => button.classList.contains('flex-1')) &&
        nativeButtons.some(button => /^(All|すべて)$/.test(button.textContent.trim())) &&
        nativeButtons.some(button => /^(Mentions|メンション|@ツイート)$/.test(button.textContent.trim()));
    }) || null;
  }
  function ctReplyMountTab(bar, panel) {
    let mount = ctReplyState.mount;
    if (mount?.bar !== bar) {
      ctReplyRestoreNative();
      mount?.button.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'ct-reply-tab';
      button.dataset.ctLocalUi = 'reply-tab';
      button.setAttribute('aria-controls', 'ct-reply-panel');
      button.title = ctReplyText('このブラウザのリプライ通知', 'Reply notifications saved in this browser');
      button.addEventListener('click', () => {
        ctReplyState.tabActive = true;
        renderReplyPanel();
      });
      mount = { bar, button, hidden: new Map() };
      ctReplyState.mount = mount;
      bar.addEventListener('click', event => {
        const button = event.target.closest?.('button');
        if (ctReplyState.mount?.bar !== bar || !button || button.id === 'ct-reply-tab' || button.parentElement !== bar) return;
        ctReplyState.tabActive = false;
        ctReplyRestoreNative();
        renderReplyPanel();
      }, true);
      ctReplyState.rendered = '';
    }
    if (mount.button.parentElement !== bar) bar.append(mount.button);
    if (panel.previousElementSibling !== bar) bar.after(panel);
    if (mount.button.getAttribute('aria-pressed') !== String(ctReplyState.tabActive)) mount.button.setAttribute('aria-pressed', String(ctReplyState.tabActive));
    if (ctReplyState.tabActive) {
      if (!bar.hasAttribute('data-ct-reply-tabs-active')) bar.dataset.ctReplyTabsActive = '1';
      for (const element of [...bar.parentElement.children]) {
        if (element === bar || element === panel || element.hasAttribute('data-ct-local-ui')) continue;
        if (!mount.hidden.has(element)) mount.hidden.set(element, {
          display: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display'),
          aria: element.getAttribute('aria-hidden')
        });
        if (element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') element.style.setProperty('display', 'none', 'important');
        if (element.getAttribute('aria-hidden') !== 'true') element.setAttribute('aria-hidden', 'true');
      }
    } else ctReplyRestoreNative();
    return mount.button;
  }
  function ctReplyAppendBadges(actor, item) {
    if (typeof ctProfileBadgeKinds !== 'function' || typeof ctBadgeSource !== 'function') return;
    const kinds = ctProfileBadgeKinds({ badges: item.authorBadges, foundingMemberNumber: item.authorFoundingMemberNumber });
    if (!kinds.length) return;
    const group = document.createElement('span');
    group.className = 'ct-official-badges';
    group.setAttribute('role', 'img');
    group.setAttribute('aria-label', kinds.map(kind => ctOfficialBadgeKinds[kind]).join(' + '));
    group.title = group.getAttribute('aria-label');
    for (const kind of kinds) {
      const image = document.createElement('img');
      image.src = ctBadgeSource(kind);
      image.alt = '';
      image.width = 18;
      image.height = 18;
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.src = `https://app.tweet.app/assets/${kind}-badge-36.png`; }, { once: true });
      group.append(image);
    }
    actor.append(group);
  }
  function renderReplyPanel() {
    ctReplyCheckKnownIdentity();
    ctReplyBindStorage();
    if (!/^\/notifications\/?$/.test(location.pathname)) { closeReplyPanel(); return; }
    const main = document.querySelector('main');
    if (!main) { closeReplyPanel(); return; }
    ctReplyInstallStyle();
    let panel = document.getElementById('ct-reply-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-reply-panel';
      panel.dataset.ctLocalUi = 'replies';
      panel.setAttribute('aria-label', ctReplyText('リプライ通知', 'Reply notifications'));
      // Retire legacy floating-card rules while keeping the native document flow.
      panel.style.cssText = 'position:relative!important;inset:auto!important;width:100%!important;max-width:100%!important;max-height:none!important;margin:0!important;padding:0!important;z-index:auto!important;box-shadow:none!important;border:0!important;border-radius:0!important;color:inherit!important;background:var(--tl-app-card,inherit)!important;overflow:visible!important';
      ctReplyState.rendered = '';
    }
    const bar = ctReplyNativeTabbar(main);
    let tab = null;
    if (bar) {
      tab = ctReplyMountTab(bar, panel);
      panel.dataset.ctReplyMode = 'tab';
      panel.hidden = !ctReplyState.tabActive;
      panel.style.setProperty('display', ctReplyState.tabActive ? 'block' : 'none', 'important');
    } else {
      ctReplyRestoreNative();
      ctReplyState.mount?.button.remove();
      ctReplyState.mount = null;
      if (panel.dataset.ctReplyMode !== 'inline') ctReplyState.rendered = '';
      panel.dataset.ctReplyMode = 'inline';
      panel.hidden = false;
      panel.style.setProperty('display', 'block', 'important');
      const heading = [...main.querySelectorAll('h1,h2')].find(el =>
        !el.closest('[data-ct-local-ui],[hidden],[aria-hidden="true"]') && /^(Notifications|通知)$/.test(el.textContent.trim()));
      const header = heading?.closest('.sticky') || heading?.parentElement;
      if (header && header !== main) { if (panel.previousElementSibling !== header) header.after(panel); }
      else if (panel.parentElement !== main) main.prepend(panel);
    }
    const notices = loadReplyNotices();
    const unread = notices.filter(item => !item.read).length;
    if (tab) {
      const label = ctReplyText('リプライ', 'Replies');
      const text = label + (unread ? ` ${unread}` : '');
      if (tab.textContent !== text) {
        tab.textContent = label;
        if (unread) {
          const count = document.createElement('span');
          count.dataset.ctReplyUnread = '1';
          count.textContent = ' ' + unread;
          tab.append(count);
        }
      }
    }
    const signature = JSON.stringify([ctReplyState.uid, notices, ctReplyState.busy, ctReplyState.error, ctReplyState.storageError, ctReplyState.data?.checkedAt, panel.dataset.ctReplyMode, ctReplyState.tabActive]);
    if (signature === ctReplyState.rendered) return;
    ctReplyState.rendered = signature;
    const open = panel.querySelector('details')?.open ?? false;
    const focused = panel.contains(document.activeElement) ? document.activeElement?.dataset?.replyAction : null;
    panel.replaceChildren();
    let host = panel;
    if (!tab) {
      const details = document.createElement('details');
      details.open = open;
      const summary = document.createElement('summary');
      summary.textContent = ctReplyText('リプライ通知', 'Reply notifications') + (unread ? ` (${unread})` : '');
      summary.dataset.replyAction = 'summary';
      details.append(summary);
      panel.append(details);
      host = details;
    }
    const controls = document.createElement('div');
    controls.className = 'ct-reply-controls';
    const status = document.createElement('p');
    status.className = 'ct-reply-status';
    status.setAttribute('role', 'status');
    status.textContent = ctReplyState.storageError
      ? ctReplyText('保存できません。このページを閉じると通知履歴が消えます。', 'Storage is unavailable. History will disappear when this page closes.')
      : ctReplyState.busy ? ctReplyText('返信を確認中…', 'Checking replies…')
      : ctReplyState.error || (!ctReplyState.uid ? ctReplyText('ログイン後に返信を確認します。', 'Sign in to check replies.')
        : ctReplyState.data?.checkedAt ? ctReplyText('最終確認 ', 'Last checked ') + new Date(ctReplyState.data.checkedAt).toLocaleTimeString(CT_LOCALE, { hour: '2-digit', minute: '2-digit' })
          : ctReplyText('返信の確認を待っています。', 'Waiting to check replies.'));
    controls.append(status);
    function control(label, action, callback) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ct-reply-control';
      button.textContent = label;
      button.dataset.replyAction = action;
      button.addEventListener('click', callback);
      controls.append(button);
      return button;
    }
    const refresh = control(ctReplyText('再確認', 'Check now'), 'refresh', () => replyWatchTick(true));
    refresh.disabled = ctReplyState.busy;
    const read = control(ctReplyText('すべて既読', 'Mark all read'), 'read', () => markReplyRead());
    read.disabled = !unread;
    host.append(controls);
    const help = document.createElement('p');
    help.className = 'ct-reply-help';
    help.textContent = ctReplyText('通知履歴・既読はこのブラウザに保存されます。', 'Notification history and read status are saved in this browser.');
    host.append(help);
    if (!notices.length) {
      const empty = document.createElement('p');
      empty.className = 'ct-reply-empty';
      empty.textContent = ctReplyText('確認した返信はまだありません。', 'No replies have been found yet.');
      host.append(empty);
    }
    const list = document.createElement('div');
    list.dataset.ctReplyList = '1';
    for (const item of notices) {
      const row = document.createElement('article');
      row.className = 'ct-local-reply-row';
      row.dataset.ctReplyId = item.id;
      row.dataset.unread = String(!item.read);
      const avatarLink = document.createElement('a');
      avatarLink.className = 'ct-reply-avatar-link';
      avatarLink.href = '/user/' + encodeURIComponent(item.authorUsername);
      avatarLink.setAttribute('aria-label', ctReplyText(`${item.authorName || item.authorUsername}のプロフィール`, `${item.authorName || item.authorUsername}'s profile`));
      avatarLink.dataset.replyAction = 'avatar:' + item.id;
      avatarLink.textContent = Array.from(item.authorName || item.authorUsername)[0] || '';
      const avatarURL = ctReplyAvatar(item.authorAvatar);
      if (avatarURL) {
        const avatar = document.createElement('img');
        avatar.src = avatarURL;
        avatar.alt = '';
        avatar.width = 40;
        avatar.height = 40;
        avatar.loading = 'lazy';
        avatar.referrerPolicy = 'no-referrer';
        avatar.addEventListener('error', () => { avatarLink.textContent = Array.from(item.authorName || item.authorUsername)[0] || ''; }, { once: true });
        avatarLink.replaceChildren(avatar);
      }
      row.append(avatarLink);
      const content = document.createElement('div');
      content.className = 'ct-reply-content';
      const actorLine = document.createElement('div');
      actorLine.className = 'ct-reply-actor-line';
      const actor = document.createElement('a');
      actor.className = 'ct-reply-author';
      actor.href = avatarLink.href;
      actor.dataset.replyAction = 'profile:' + item.id;
      const name = document.createElement('span');
      name.className = 'ct-reply-name';
      name.textContent = item.authorName || item.authorUsername;
      actor.append(name);
      ctReplyAppendBadges(actor, item);
      actorLine.append(actor);
      const handle = document.createElement('span');
      handle.className = 'ct-reply-handle';
      handle.textContent = '@' + item.authorUsername;
      actorLine.append(handle);
      const date = new Date(item.createdAt);
      if (Number.isFinite(date.getTime())) {
        const time = document.createElement('time');
        time.dateTime = date.toISOString();
        time.title = date.toLocaleString(CT_LOCALE);
        time.textContent = '· ' + date.toLocaleString(CT_LOCALE, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        actorLine.append(time);
      }
      if (!item.read) {
        const marker = document.createElement('span');
        marker.className = 'ct-reply-unread';
        marker.textContent = ctReplyText('未読', 'Unread');
        actorLine.append(marker);
      }
      content.append(actorLine);
      const link = document.createElement('a');
      link.className = 'ct-reply-body';
      link.href = '/post/' + encodeURIComponent(item.id);
      link.dataset.replyAction = 'open:' + item.id;
      link.textContent = item.text || ctReplyText('返信を開く', 'Open reply');
      link.addEventListener('click', () => markReplyRead(item.id, true));
      content.append(link);
      if (ctReplyId(item.parentId)) {
        const parent = document.createElement('a');
        parent.className = 'ct-reply-parent';
        parent.href = '/post/' + encodeURIComponent(item.parentId);
        parent.dataset.replyAction = 'parent:' + item.id;
        parent.textContent = ctReplyText('返信先のツイートを見る', 'View the original tweet');
        content.append(parent);
      }
      row.append(content);
      list.append(row);
    }
    host.append(list);
    if (focused) {
      const previous = [...panel.querySelectorAll('[data-reply-action]')].find(element => element.dataset.replyAction === focused);
      const target = previous && !previous.disabled ? previous : controls.querySelector('[data-reply-action="refresh"]') || tab;
      target?.focus({ preventScroll: true });
    }
  }
  function patchReplyBadge() {
    document.getElementById('ct-reply-badge')?.remove(); // Retire the old detached overlay badge.
    const count = loadReplyNotices().filter(item => !item.read).length;
    for (const control of document.querySelectorAll('nav a,nav button,aside a,aside button')) {
      const label = (control.getAttribute('aria-label') || '').trim();
      const text = [...control.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent).join('').trim();
      const nativeText = [...control.querySelectorAll('span')].filter(el => !el.closest('[data-ct-local-ui]'))
        .map(el => el.textContent.trim());
      const target = control.getAttribute('href') === '/notifications' ||
        /^(Notifications|通知)$/.test(label) || /^(Notifications|通知)$/.test(text) || nativeText.some(value => /^(Notifications|通知)$/.test(value));
      let badge = control.querySelector('[data-ct-reply-count]');
      if (!target || !count) { badge?.remove(); continue; }
      if (!badge) {
        badge = document.createElement('span');
        badge.dataset.ctReplyCount = '1';
        badge.dataset.ctLocalUi = 'reply-count';
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-inline-start:4px;padding:0 4px;border-radius:999px;background:var(--ct-classic-blue,#0ea5e9);color:white;font-size:11px;font-weight:700;vertical-align:middle;pointer-events:none';
        control.append(badge);
      }
      const display = `↩${count}`;
      if (badge.textContent !== display) badge.textContent = display;
      badge.setAttribute('aria-label', ctReplyText(`未読の返信 ${count} 件`, `${count} unread replies`));
    }
  }
