  // Browser-local reply inbox. All routes and response shapes come from Tweet's own client.
  // No native notification is marked read and no posting/following API is called here.
  const ctReplyState = {
    uid: null, data: null, busy: false, lastAttempt: -Infinity, error: '', storageError: false,
    rendered: '', storageBound: false
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
  function ctReplyRead(uid) {
    try {
      const raw = JSON.parse(localStorage.getItem(CT_REPLY_PREFIX + encodeURIComponent(uid)) || 'null');
      if (!raw || !Array.isArray(raw.notices)) return ctReplyEmpty();
      return {
        startedAt: Number(raw.startedAt) || Date.now(), checkedAt: Number(raw.checkedAt) || 0,
        notices: raw.notices.filter(item => ctReplyId(item?.id) && ctReplyHandle(item?.authorUsername))
          .slice(0, 100).map(item => ({ ...item, read: item.read === true })),
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
  function closeReplyPanel() { document.getElementById('ct-reply-panel')?.remove(); ctReplyState.rendered = ''; }
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
  function renderReplyPanel() {
    ctReplyCheckKnownIdentity();
    ctReplyBindStorage();
    if (!/^\/notifications\/?$/.test(location.pathname)) { closeReplyPanel(); return; }
    const main = document.querySelector('main');
    if (!main) return;
    let panel = document.getElementById('ct-reply-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-reply-panel';
      panel.dataset.ctLocalUi = 'replies';
      panel.setAttribute('aria-label', ctReplyText('リプライ通知', 'Reply notifications'));
      // Override legacy panel styling: stay in normal document flow at every screen width.
      panel.style.cssText = 'position:relative!important;inset:auto!important;width:auto!important;max-width:100%!important;max-height:none!important;margin:12px!important;padding:0!important;z-index:auto!important;box-shadow:none!important;border:1px solid var(--color-tl-app-border,#8b98a544)!important;border-radius:12px!important;color:inherit!important;background:inherit!important;overflow:hidden!important';
      const heading = [...main.querySelectorAll('h1,h2')].find(el =>
        !el.closest('[data-ct-local-ui],[hidden],[aria-hidden="true"]') && /^(Notifications|通知)$/.test(el.textContent.trim()));
      const header = heading?.closest('.sticky') || heading?.parentElement;
      if (header && header !== main) header.after(panel);
      else main.prepend(panel);
      ctReplyState.rendered = '';
    }
    const notices = loadReplyNotices();
    const unread = notices.filter(item => !item.read).length;
    const signature = JSON.stringify([ctReplyState.uid, notices, ctReplyState.busy, ctReplyState.error, ctReplyState.storageError, ctReplyState.data?.checkedAt]);
    if (signature === ctReplyState.rendered) return;
    ctReplyState.rendered = signature;
    const open = panel.querySelector('details')?.open ?? false;
    const focused = panel.contains(document.activeElement) ? document.activeElement?.dataset?.replyAction : null;
    panel.replaceChildren();
    const details = document.createElement('details');
    details.open = open;
    const summary = document.createElement('summary');
    summary.style.cssText = 'padding:12px 14px;cursor:pointer;font-weight:700;line-height:1.4';
    summary.textContent = ctReplyText('↩ リプライ通知', '↩ Reply notifications') + (unread ? ` (${unread})` : '');
    summary.dataset.replyAction = 'summary';
    details.append(summary);
    const body = document.createElement('div');
    body.style.cssText = 'padding:0 14px 14px;overflow-wrap:anywhere';
    const help = document.createElement('p');
    help.style.cssText = 'font-size:12px;line-height:1.5;opacity:.75;margin:0 0 10px';
    help.textContent = ctReplyText(
      'このアカウントの最新24件の投稿・返信を、このタブを表示している間90秒ごとに順番に確認します。履歴と既読はこのブラウザ内のみ。過去の返信は既読で追加します。',
      'Checks replies to your latest 24 posts and replies in batches every 90 seconds while this tab is visible. History and read status stay in this browser. Older replies are added as read.');
    body.append(help);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:13px;line-height:1.5;margin:0 0 10px';
    status.textContent = ctReplyState.storageError
      ? ctReplyText('保存できません。通知はこのページを閉じるまで表示します。', 'Storage is unavailable. Replies will remain only until this page closes.')
      : ctReplyState.busy ? ctReplyText('返信を確認中…', 'Checking replies…')
      : ctReplyState.error || (!ctReplyState.uid ? ctReplyText('ログイン後に返信を確認します。', 'Sign in to check replies.')
        : ctReplyState.data?.checkedAt ? ctReplyText('最終確認 ', 'Last checked ') + new Date(ctReplyState.data.checkedAt).toLocaleTimeString(CT_LOCALE, { hour: '2-digit', minute: '2-digit' })
          : ctReplyText('返信の確認を待っています。', 'Waiting to check replies.'));
    body.append(status);
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px';
    function control(label, action, callback) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.replyAction = action;
      button.style.cssText = 'font:inherit;font-size:13px;color:inherit;border:1px solid var(--color-tl-app-border,#8b98a566);background:transparent;border-radius:999px;padding:7px 12px;min-height:36px;cursor:pointer';
      button.addEventListener('click', callback);
      controls.append(button);
      return button;
    }
    const refresh = control(ctReplyText('再確認', 'Check now'), 'refresh', () => replyWatchTick(true));
    refresh.disabled = ctReplyState.busy;
    const read = control(ctReplyText('すべて既読にする', 'Mark all read'), 'read', () => markReplyRead());
    read.disabled = !unread;
    body.append(controls);
    if (!notices.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'font-size:14px;margin:8px 0';
      empty.textContent = ctReplyText('確認した返信はまだありません。', 'No replies have been found yet.');
      body.append(empty);
    }
    const list = document.createElement('div');
    list.style.cssText = 'max-height:420px;overflow:auto;overscroll-behavior:contain';
    for (const item of notices) {
      const row = document.createElement('article');
      row.dataset.ctReplyId = item.id;
      row.style.cssText = 'padding:12px 0;border-top:1px solid var(--color-tl-app-border,#8b98a544)';
      const actor = document.createElement('a');
      actor.href = '/user/' + encodeURIComponent(item.authorUsername);
      actor.textContent = `${item.authorName || item.authorUsername} @${item.authorUsername}`;
      actor.style.cssText = 'display:inline-flex;align-items:center;gap:8px;max-width:100%;font-size:14px;font-weight:700;color:inherit;text-decoration:none';
      const avatarURL = ctReplyAvatar(item.authorAvatar);
      if (avatarURL) {
        const avatar = document.createElement('img');
        avatar.src = avatarURL;
        avatar.alt = '';
        avatar.width = 28;
        avatar.height = 28;
        avatar.loading = 'lazy';
        avatar.referrerPolicy = 'no-referrer';
        avatar.style.cssText = 'width:28px;height:28px;object-fit:cover;border-radius:50%;flex-shrink:0';
        avatar.addEventListener('error', () => avatar.remove(), { once: true });
        // The avatar and author name share one verified profile destination.
        actor.prepend(avatar);
      }
      row.append(actor);
      if (!item.read) {
        const marker = document.createElement('span');
        marker.style.cssText = 'font-size:11px;margin-left:8px;color:#1d9bf0';
        marker.textContent = ctReplyText('未読', 'Unread');
        row.append(marker);
      }
      const link = document.createElement('a');
      link.href = '/post/' + encodeURIComponent(item.id);
      link.style.cssText = 'display:block;color:inherit;text-decoration:none;font-size:14px;white-space:pre-wrap;line-height:1.5;margin:5px 0';
      link.textContent = item.text || ctReplyText('返信を開く', 'Open reply');
      link.addEventListener('click', () => markReplyRead(item.id, true));
      row.append(link);
      const date = new Date(item.createdAt);
      if (Number.isFinite(date.getTime())) {
        const time = document.createElement('time');
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleString(CT_LOCALE);
        time.style.cssText = 'font-size:12px;opacity:.7';
        row.append(time);
      }
      list.append(row);
    }
    body.append(list);
    details.append(body);
    panel.append(details);
    if (focused) panel.querySelector(`[data-reply-action="${focused}"]`)?.focus();
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
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-inline-start:4px;padding:0 4px;border-radius:999px;background:#1d9bf0;color:white;font-size:11px;font-weight:700;vertical-align:middle;pointer-events:none';
        control.append(badge);
      }
      const display = `↩${count}`;
      if (badge.textContent !== display) badge.textContent = display;
      badge.setAttribute('aria-label', ctReplyText(`未読の返信 ${count} 件`, `${count} unread replies`));
    }
  }
