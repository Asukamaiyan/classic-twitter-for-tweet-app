  // Profile additions use Tweet's verified posts GET. Favorites are browser-local
  // snapshots, scoped to the signed-in account; no favorite-history endpoint is assumed.
  const ctProfileState = {
    path: '', user: '', uid: null, authSeen: undefined, accountUser: '', active: '', tablist: null,
    timeline: null, panel: null, sequence: 0, identityBusy: false, identityRetry: 0,
    nativeSelection: new Map(), tabsBound: new WeakSet(), rendered: '', media: null, favoriteMutes: null,
    storageBound: false, storageError: false, memory: new Map(), dirtyMemory: new Set(), viewer: null,
    rowItems: new WeakMap(), muteCache: new Map(), mediaCache: new Map(), favoriteRemovals: new Map()
  };
  function ctProfileText(ja, en) { return CT_LOCALE === 'ja' ? ja : en; }
  function ctProfileId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
  }
  function ctProfileHandle(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value.toLowerCase() : null;
  }
  function ctProfileURL(value) {
    if (typeof value !== 'string' || value.length > 4000) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function ctProfileUID() {
    return typeof ctNetworkState !== 'undefined' ? ctProfileId(ctNetworkState.authUID) : null;
  }
  function ctProfileMediaAssets(post) {
    const media = [];
    for (const asset of Array.isArray(post?.media_assets) ? post.media_assets.slice(0, 16) : []) {
      const url = ctProfileURL(asset?.public_url);
      if (url && ['image', 'video'].includes(asset?.media_type)) media.push({
        type: asset.media_type, url, poster: ctProfileURL(asset.thumbnail_url)
      });
    }
    const image = ctProfileURL(post?.image);
    if (!media.length && image) media.push({ type: 'image', url: image, poster: '' });
    return media;
  }
  function ctProfileFavoriteItems(data) {
    if (!Array.isArray(data)) return [];
    return [...new Map(data.filter(item => ctProfileId(item?.id)).slice(0, 500).map(item => [item.id, {
      id: item.id, username: ctProfileHandle(item.username) || '',
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : '',
      text: typeof item.text === 'string' ? item.text.slice(0, 10000) : '',
      avatar: ctProfileURL(item.avatar), savedAt: Number(item.savedAt) || 0,
      createdAt: typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : '',
      href: `${location.origin}/post/${encodeURIComponent(item.id)}`,
      media: Array.isArray(item.media) ? item.media.slice(0, 16).filter(asset =>
        ['image', 'video'].includes(asset?.type) && ctProfileURL(asset.url)).map(asset => ({
          type: asset.type, url: ctProfileURL(asset.url), poster: ctProfileURL(asset.poster)
        })) : []
    }])).values()];
  }
  function ctProfileFavoriteKey(uid) { return KEY.favorites + ':uid:' + encodeURIComponent(uid); }
  function ctProfileLoadFavorites() {
    const uid = ctProfileUID();
    if (!uid) return [];
    const key = ctProfileFavoriteKey(uid);
    if (ctProfileState.dirtyMemory.has(uid)) return ctProfileState.memory.get(uid) || [];
    try {
      const data = ctProfileFavoriteItems(JSON.parse(localStorage.getItem(key) || '[]'));
      ctProfileState.memory.set(uid, data);
      return data;
    } catch { return ctProfileState.memory.get(uid) || []; }
  }
  function ctProfileWriteFavorites(uid, data) {
    if (!uid || uid !== ctProfileUID()) return false;
    const items = ctProfileFavoriteItems(data);
    ctProfileState.memory.set(uid, items);
    try {
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      ctProfileState.storageError = false; ctProfileState.dirtyMemory.delete(uid);
    } catch { ctProfileState.storageError = true; ctProfileState.dirtyMemory.add(uid); }
    if (favoritesActive) renderFavoritesPanel();
    return true;
  }
  function ctProfileSaveFavorite(item, expectedUid = ctProfileUID()) {
    if (!ctProfileId(item?.id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    ctProfileState.favoriteRemovals.get(expectedUid)?.delete(item.id);
    return ctProfileWriteFavorites(expectedUid, [item, ...ctProfileLoadFavorites().filter(row => row.id !== item.id)].slice(0, 500));
  }
  function ctProfileRemoveFavorite(id, expectedUid = ctProfileUID()) {
    if (!ctProfileId(id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    if (!ctProfileState.favoriteRemovals.has(expectedUid)) ctProfileState.favoriteRemovals.set(expectedUid, new Set());
    const removed = ctProfileState.favoriteRemovals.get(expectedUid);
    removed.add(id);
    while (removed.size > 1000) removed.delete(removed.values().next().value);
    return ctProfileWriteFavorites(expectedUid, ctProfileLoadFavorites().filter(row => row.id !== id));
  }
  function ctProfileRememberLikedPosts(posts, expectedUid, expectedUser = null) {
    if (!Array.isArray(posts) || !ctProfileId(expectedUid) || expectedUid !== ctProfileUID()) return 0;
    const expectedHandle = expectedUser === null ? null : ctProfileHandle(expectedUser);
    if (expectedUser !== null && !expectedHandle) return 0;
    const previous = ctProfileLoadFavorites();
    const known = new Map(previous.map(item => [item.id, item]));
    const recovered = new Map();
    const removed = ctProfileState.favoriteRemovals.get(expectedUid);
    for (const post of posts.slice(0, 1000)) {
      const username = ctProfileHandle(post?.authorUsername);
      if (post?.hasLiked !== true || !ctProfileId(post.id) || !username ||
          (expectedHandle && username !== expectedHandle) || post.isDeleted || post.status === 'MUTED' ||
          post.isRepost || post.originalPostId || post.repostedBy || removed?.has(post.id) || typeof post.text !== 'string') continue;
      const createdAt = post.createdAt ?? post.created_at;
      recovered.set(post.id, { id: post.id, username,
        name: typeof post.authorName === 'string' ? post.authorName.slice(0, 200) : username,
        avatar: ctProfileURL(post.authorAvatar), text: post.text.slice(0, 10000),
        createdAt: typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) ? createdAt : '',
        savedAt: known.get(post.id)?.savedAt ?? Date.now(), media: ctProfileMediaAssets(post) });
    }
    if (!recovered.size || expectedUid !== ctProfileUID()) return 0;
    // Reading an old cache must not undo a newer native Unlike. Existing saved
    // timestamps and row order remain stable when the same post is read again.
    const items = previous.map(item => recovered.get(item.id) || item);
    for (const [id, item] of recovered) if (!known.has(id)) items.push(item);
    if (JSON.stringify(ctProfileFavoriteItems(items)) !== JSON.stringify(previous)) ctProfileWriteFavorites(expectedUid, items);
    return [...recovered.keys()].filter(id => !known.has(id)).length;
  }
  function ctProfileLegacyFavorites() {
    try {
      // Old storage had no account identity. Import is explicit and remains
      // available only until its owner is recorded; the original data is retained.
      if (localStorage.getItem(KEY.favorites + ':owner')) return [];
      return ctProfileFavoriteItems(JSON.parse(localStorage.getItem(KEY.favorites) || '[]'));
    } catch { return []; }
  }
  function ctProfileImportFavorites(expectedUid = ctProfileUID()) {
    const uid = expectedUid;
    const legacy = ctProfileLegacyFavorites();
    if (!uid || uid !== ctProfileUID() || !legacy.length) return;
    try {
      const merged = [...ctProfileLoadFavorites(), ...legacy];
      const items = ctProfileFavoriteItems(merged).slice(0, 500);
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      localStorage.setItem(KEY.favorites + ':owner', uid);
      ctProfileState.memory.set(uid, items);
      ctProfileState.storageError = false;
    } catch { ctProfileState.storageError = true; }
    renderFavoritesPanel();
  }
  function ctProfileNativeReplyEditor(el, timeline) {
    if (!el?.matches('textarea[name="compose-text"][maxlength="280"][inputmode="text"][rows="1"][autocomplete="off"][data-form-type="other"]') ||
        !el.matches('.relative.bg-transparent.whitespace-pre-wrap.break-words.w-full.resize-none.text-tl-app-text.outline-none') ||
        !el.parentElement?.matches('div.relative') || el.closest('[data-ct-owned],[data-ct-local-ui],[data-user-content],[contenteditable]')) return false;
    const article = el.closest('article');
    return !!article && timeline.contains(article) &&
      [...article.querySelectorAll('button[data-testid="tweet-like-action"]')].some(button => button.closest('article') === article);
  }
  function ctProfileContext() {
    if (!/^\/(?:profile\/?|user\/[^/]+\/?)$/.test(location.pathname)) return null;
    const main = document.querySelector('main');
    if (!main) return null;
    for (const tablist of main.querySelectorAll('[role="tablist"]')) {
      if (tablist.closest('article,[data-ct-owned],[data-ct-local-ui],[hidden],[aria-hidden="true"]')) continue;
      const nativeTabs = [...tablist.children].filter(el => el.matches('button[role="tab"]') && !el.id.startsWith('ct-'));
      if (nativeTabs.length !== 3) continue;
      const labels = nativeTabs.map(el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent).trim());
      if (!/^(Tweets|Posts|ツイート|呟き)$/.test(labels[0]) || !/^(Replies|リプライ|返信)$/.test(labels[1]) ||
          !/^(Reposts|Retweets|リツイート|リポスト)$/.test(labels[2])) continue;
      const header = [...tablist.parentElement.children].filter(el =>
        el !== tablist && !!(el.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING));
      const handles = new Set(header.flatMap(el => [...el.querySelectorAll('div.mt-3.flex.flex-col.gap-1')])
        .filter(el => el.querySelector(':scope > h2.font-extrabold'))
        .flatMap(el => [...el.querySelectorAll(':scope > p.text-tl-app-text-muted')])
        .filter(el => !el.children.length)
        .map(el => /^@([A-Za-z0-9_.-]{1,80})$/.exec(el.textContent.trim())?.[1]).filter(Boolean).map(ctProfileHandle));
      if (handles.size !== 1) continue;
      const user = [...handles][0];
      if (location.pathname.startsWith('/user/')) {
        let route;
        try { route = ctProfileHandle(decodeURIComponent(location.pathname.split('/')[2])); } catch { continue; }
        if (!route || route !== user) continue;
      }
      let timeline = tablist.nextElementSibling;
      while (timeline?.matches('[data-ct-profile-panel]')) timeline = timeline.nextElementSibling;
      // Current profile component renders one direct DIV for the active native
      // timeline. Native inline reply editors can appear within its Tweets;
      // hiding the timeline must retain their original nodes and draft values.
      // Unknown forms, inputs and editor structures still fail open.
      if (!timeline?.matches('div') || timeline.matches('[role],[data-ct-owned],[data-ct-local-ui]') ||
          [...timeline.querySelectorAll('input,textarea,form,[role="form"]')].some(el => !ctProfileNativeReplyEditor(el, timeline))) continue;
      return { path: location.pathname, user, main, tablist, timeline, nativeTabs };
    }
    return null;
  }
  function ctProfileStyles() {
    if (document.getElementById('ct-profile-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-profile-style';
    style.textContent = `
      [data-ct-profile-tabs]{overflow-x:auto;scrollbar-width:none;min-width:0}
      [data-ct-profile-tabs]::-webkit-scrollbar{display:none}
      [data-ct-profile-tabs]>button[role=tab]{min-width:54px;min-height:48px;flex:1 0 54px}
      [data-ct-profile-active]>button:not([data-ct-profile-tab])>span{color:var(--color-tl-app-text-muted,#657786)!important}
      [data-ct-profile-active]>button:not([data-ct-profile-tab])>span>span{display:none!important}
      [data-ct-profile-timeline-hidden]{display:none!important}
      .ct-profile-tab{position:relative;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;padding:8px 4px;border:0;background:transparent;color:var(--color-tl-app-text-muted,#657786);font:inherit;cursor:pointer}
      .ct-profile-tab svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}
      .ct-profile-tab-label{font-size:10px;white-space:nowrap;line-height:14px}
      .ct-profile-tab[aria-selected=true]{color:var(--color-tl-app-text,#14171a);font-weight:700}
      .ct-profile-tab[aria-selected=true]:after{content:'';position:absolute;bottom:0;width:28px;height:4px;border-radius:2px;background:#55acee}
      .ct-profile-tab[data-ct-profile-tab=favorites] svg{color:#ffac33}
      .ct-profile-tab:focus-visible,.ct-profile-control:focus-visible,.ct-profile-photo:focus-visible{outline:2px solid #55acee;outline-offset:-3px}
      [data-ct-profile-panel]{position:relative!important;inset:auto!important;max-height:none!important;width:auto!important;max-width:100%;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:inherit!important;color:inherit;box-shadow:none!important;z-index:auto!important}
      .ct-profile-status{padding:12px 16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544);font-size:12px;color:var(--color-tl-app-text-muted,#657786);line-height:1.6}
      .ct-profile-empty{padding:32px 16px;text-align:center;color:var(--color-tl-app-text-muted,#657786);font-size:14px}
      .ct-profile-control{min-height:44px;padding:8px 14px;border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer;margin:4px 0}
      .ct-profile-control:disabled{cursor:wait;opacity:.6}
      .ct-profile-row{display:flex;gap:12px;padding:16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544)}
      .ct-profile-avatar{width:40px;height:40px;flex:none;border-radius:4px;object-fit:cover}
      .ct-profile-row-main{min-width:0;flex:1}
      .ct-profile-meta{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font-size:14px;line-height:20px}
      .ct-profile-name{font-weight:700;color:inherit;text-decoration:none}
      .ct-profile-handle,.ct-profile-time{font-size:12px;color:var(--color-tl-app-text-muted,#657786);text-decoration:none}
      .ct-profile-text{font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px}
      .ct-profile-gallery{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;border-radius:4px;scrollbar-width:thin}
      .ct-profile-photo{display:block;flex:0 0 100%;min-width:0;padding:0;background:var(--color-tl-app-bg,#f5f8fa);border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;overflow:hidden;scroll-snap-align:start;cursor:zoom-in}
      .ct-profile-photo img{display:block;width:100%;height:auto;max-height:480px;object-fit:contain}
      .ct-profile-video{display:block;width:100%;max-height:480px;background:#000;border-radius:4px;margin:8px 0}
      .ct-profile-media-note{font-size:12px;color:var(--color-tl-app-text-muted,#657786);margin:6px 0}
      .ct-profile-post-link{display:inline-flex;align-items:center;min-height:44px;color:#55acee;font-size:13px;text-decoration:none}
      .ct-profile-post-link:hover,.ct-profile-name:hover{text-decoration:underline}
      .ct-profile-viewer{padding:0;border:0;background:#000;color:#fff;width:min(100vw,1000px);max-width:100vw;max-height:100dvh;overflow:auto}
      .ct-profile-viewer::backdrop{background:#000c}
      .ct-profile-viewer img{display:block;max-width:100%;max-height:calc(100dvh - 64px);object-fit:contain;margin:auto}
      .ct-profile-viewer-nav{display:flex;align-items:center;justify-content:space-between;padding:8px;gap:8px}
      .ct-profile-viewer-nav button{min-width:44px;min-height:44px;border:1px solid #ffffff55;border-radius:4px;color:inherit;background:transparent;font:inherit;cursor:pointer}
      @media(max-width:480px){.ct-profile-row{padding:12px;gap:10px}.ct-profile-photo img,.ct-profile-video{max-height:360px}}
      @media(prefers-reduced-motion:no-preference){.ct-profile-tab,.ct-profile-control{transition:color 120ms ease,background-color 120ms ease}}
    `;
    document.head.appendChild(style);
  }
  function ctProfileCloseViewer() {
    const viewer = ctProfileState.viewer;
    if (!viewer) return;
    ctProfileState.viewer = null;
    try { viewer.dialog.close(); } catch {}
    viewer.dialog.remove();
    if (viewer.trigger?.isConnected) viewer.trigger.focus({ preventScroll: true });
  }
  function ctProfileOpenViewer(images, index, trigger) {
    ctProfileCloseViewer();
    const dialog = document.createElement('dialog');
    // If a browser lacks modal dialogs, the unchanged post link still opens
    // Tweet's own media viewer. Do not emulate a broken focus trap.
    if (typeof dialog.showModal !== 'function') return;
    dialog.className = 'ct-profile-viewer';
    dialog.dataset.ctLocalUi = 'profile-media-viewer';
    dialog.setAttribute('aria-label', ctProfileText('写真を拡大', 'Enlarged photos'));
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    const nav = document.createElement('div'); nav.className = 'ct-profile-viewer-nav';
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹';
    previous.setAttribute('aria-label', ctProfileText('前の写真', 'Previous photo'));
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = '›';
    next.setAttribute('aria-label', ctProfileText('次の写真', 'Next photo'));
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', ctProfileText('閉じる', 'Close'));
    const show = () => {
      img.src = images[index].url;
      img.alt = ctProfileText(`写真 ${index + 1}/${images.length}`, `Photo ${index + 1}/${images.length}`);
      count.textContent = `${index + 1} / ${images.length}`;
      previous.disabled = index === 0; next.disabled = index === images.length - 1;
    };
    const move = step => { index = Math.max(0, Math.min(images.length - 1, index + step)); show(); };
    previous.onclick = () => move(-1); next.onclick = () => move(1); close.onclick = ctProfileCloseViewer;
    dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); ctProfileCloseViewer(); });
    nav.append(previous, count, next, close); dialog.append(img, nav); document.body.append(dialog);
    ctProfileState.viewer = { dialog, trigger };
    show();
    try { dialog.showModal(); close.focus(); } catch { ctProfileCloseViewer(); }
  }
  function ctProfileRestoreNative() {
    ctProfileState.timeline?.removeAttribute('data-ct-profile-timeline-hidden');
    ctProfileState.tablist?.removeAttribute('data-ct-profile-active');
    for (const [tab, selected] of ctProfileState.nativeSelection) {
      if (tab.isConnected && tab.getAttribute('aria-selected') === 'false') tab.setAttribute('aria-selected', selected);
    }
    ctProfileState.nativeSelection.clear();
    ctProfileState.panel?.remove(); ctProfileState.panel = null;
    ctProfileState.rendered = '';
    ctProfileCloseViewer();
  }
  function closeFavoritesPanel() {
    ctProfileState.sequence++;
    ctProfileState.favoriteMutes = null;
    ctProfileState.active = ''; favoritesActive = false;
    ctProfileRestoreNative();
    for (const tab of ctProfileState.tablist?.querySelectorAll('[data-ct-profile-tab]') || []) {
      if (tab.getAttribute('aria-selected') !== 'false') tab.setAttribute('aria-selected', 'false');
    }
  }
  function ctProfileReset() {
    closeFavoritesPanel();
    ctProfileState.tablist?.removeAttribute('data-ct-profile-tabs');
    for (const tab of ctProfileState.tablist?.querySelectorAll('[data-ct-profile-tab]') || []) tab.remove();
    ctProfileState.tablist = null; ctProfileState.timeline = null; ctProfileState.media = null;
    ctProfileState.path = ''; ctProfileState.user = '';
  }
  function ctProfileBindStorage() {
    if (ctProfileState.storageBound) return;
    ctProfileState.storageBound = true;
    window.addEventListener('storage', event => {
      if (event.key === ctProfileFavoriteKey(ctProfileUID() || '') || event.key === KEY.favorites + ':owner') renderFavoritesPanel();
    });
    window.addEventListener('pagehide', ctProfileCloseViewer);
    document.addEventListener('click', event => {
      const button = event.target.closest?.('button');
      if (!button || button.disabled || button.closest('[data-ct-owned],[data-ct-local-ui],[data-user-content],.tl-user-text,.whitespace-pre-wrap,.break-words,[contenteditable]')) return;
      const label = button.getAttribute('aria-label') || '';
      const title = button.querySelector(':scope > span.min-w-0.truncate')?.getAttribute('title') || '';
      const menuMute = button.querySelector(':scope > svg.lucide-volume-x,:scope > svg.lucide-volume-2') &&
        /^(?:Mute user|Unmute user|ミュートする|ミュートを解除|(?:Mute|Unmute) @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+をミュート|@[A-Za-z0-9_.-]+のミュートを解除)$/.test(title) &&
        (button.matches('[role="menuitem"]') || button.closest('article'));
      const settingsUnmute = /^\/(?:settings)\/?$/.test(location.pathname) &&
        /^(?:Unmute @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+のミュートを解除)$/.test(label) &&
        /^(?:Unmute|ミュートを解除)$/.test(button.textContent.trim());
      const report = button.closest('[role="dialog"][aria-modal="true"].bg-tl-app-card.border');
      const reportMute = report && /^(?:Report @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+を報告)$/.test(report.getAttribute('aria-label') || '') &&
        report.querySelector('h3.text-sm.font-bold.text-tl-app-text') && button.matches('button.w-full.rounded-full.border[aria-busy]') &&
        /^(?:Mute @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+をミュート)$/.test(button.textContent.trim());
      if (!menuMute && !settingsUnmute && !reportMute) return;
      // A native mute action changes visibility. Discard only short-lived
      // read caches; never alter the user's saved Favorites.
      ctProfileState.muteCache.clear();
      ctProfileState.mediaCache.clear();
      ctProfileState.sequence++;
      ctProfileState.favoriteMutes = null;
      ctProfileState.media = null;
      ctProfileState.rendered = '';
      if (ctProfileState.active === 'favorites') renderFavoritesPanel();
      else if (ctProfileState.active === 'media') ctProfileRenderMedia();
    }, true);
  }
  async function ctProfileEnsureIdentity(context) {
    if (ctProfileState.identityBusy || Date.now() < ctProfileState.identityRetry) return;
    ctProfileState.identityBusy = true;
    const path = context.path;
    try {
      const auth = await getAuth();
      if (location.pathname !== path || ctProfileUID() !== (auth?.uid || null)) return;
      if (!auth?.uid || !auth?.token) { ctProfileState.identityRetry = Date.now() + 10000; return; }
      if (ctProfileState.uid === auth.uid && ctProfileState.accountUser) return;
      ctProfileState.identityRetry = Date.now() + 10000;
      const json = await requestJSON(API_ORIGIN + '/api/user-profile/' + encodeURIComponent(auth.uid), {
        Authorization: `Bearer ${auth.token}`
      });
      if (location.pathname !== path || ctProfileUID() !== auth.uid || ctProfileContext()?.user !== context.user) return;
      const user = json?.success !== false && !json?.error ? ctProfileHandle(json?.profile?.username) : null;
      if (!user) { ctProfileState.identityRetry = Date.now() + 10000; return; }
      ctProfileState.uid = auth.uid; ctProfileState.accountUser = user;
      patchFavoriteProfileTab();
    } finally { ctProfileState.identityBusy = false; }
  }
  function ctProfileCreateTab(type) {
    const tab = document.createElement('button');
    tab.id = type === 'favorites' ? 'ct-favorites-tab' : 'ct-media-tab';
    tab.type = 'button'; tab.className = 'ct-profile-tab'; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false'); tab.dataset.ctProfileTab = type;
    const label = type === 'favorites' ? ctProfileText('お気に入り', 'Favorites') : ctProfileText('写真・動画', 'Media');
    tab.setAttribute('aria-label', label); tab.title = label; tab.setAttribute('aria-controls', type === 'favorites' ? 'ct-favorites-panel' : 'ct-media-panel');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', type === 'favorites' ? 'm12 3 2.8 5.7 6.3.9-4.55 4.43 1.08 6.26L12 17.34l-5.63 2.95 1.08-6.26L2.9 9.6l6.3-.9L12 3Z' : 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M16 8h.01');
    svg.append(path); const text = document.createElement('span'); text.className = 'ct-profile-tab-label'; text.textContent = label;
    tab.append(svg, text);
    tab.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      const context = ctProfileContext();
      if (!context || context.tablist !== ctProfileState.tablist) return;
      if (type === 'favorites' && (!ctProfileUID() || ctProfileState.accountUser !== context.user)) return;
      if (ctProfileState.active === type) return;
      ctProfileCloseViewer(); ctProfileState.sequence++;
      ctProfileState.active = type; favoritesActive = type === 'favorites'; ctProfileState.rendered = '';
      ctProfileState.favoriteMutes = null;
      ctProfileShow(context);
      if (type === 'media' && !ctProfileMediaState().started) ctProfileLoadMedia();
      if (type === 'favorites') ctProfileLoadFavoriteMutes();
    };
    return tab;
  }
  function patchFavoriteProfileTab() {
    ctProfileBindStorage();
    const context = ctProfileContext();
    if (!context) { ctProfileReset(); return; }
    const knownUid = ctProfileUID();
    if (ctProfileState.authSeen !== knownUid) {
      ctProfileState.authSeen = knownUid; ctProfileState.identityRetry = 0;
    }
    if (ctProfileState.uid && ctProfileState.uid !== knownUid) {
      ctProfileState.muteCache.clear();
      ctProfileState.mediaCache.clear();
      ctProfileReset(); ctProfileState.uid = null; ctProfileState.accountUser = ''; ctProfileState.identityRetry = 0;
    }
    if (ctProfileState.path !== context.path || ctProfileState.user !== context.user || ctProfileState.tablist !== context.tablist) {
      ctProfileReset();
      ctProfileState.path = context.path; ctProfileState.user = context.user;
      ctProfileState.tablist = context.tablist; ctProfileState.timeline = context.timeline;
    } else if (ctProfileState.timeline !== context.timeline) {
      // React replaced its current list. Restore the detached list's marker and
      // apply only to the new, verified direct timeline sibling.
      ctProfileState.timeline?.removeAttribute('data-ct-profile-timeline-hidden');
      ctProfileState.timeline = context.timeline;
    }
    ctProfileStyles();
    if (!context.tablist.hasAttribute('data-ct-profile-tabs')) context.tablist.setAttribute('data-ct-profile-tabs', '');
    if (!context.tablist.querySelector('#ct-media-tab')) context.tablist.append(ctProfileCreateTab('media'));
    if (/^\/profile\/?$/.test(context.path) && ctProfileState.accountUser && ctProfileState.accountUser !== context.user) {
      // Native profile edits can change the handle without changing Firebase uid.
      // Recheck once; a mismatching server response is throttled by identityRetry.
      ctProfileState.accountUser = '';
    }
    const own = knownUid && ctProfileState.uid === knownUid && ctProfileState.accountUser === context.user;
    let favorites = context.tablist.querySelector('#ct-favorites-tab');
    if (own && !favorites) context.tablist.append(ctProfileCreateTab('favorites'));
    if (!own && favorites) { favorites.remove(); if (favoritesActive) closeFavoritesPanel(); }
    if (!ctProfileState.tabsBound.has(context.tablist)) {
      ctProfileState.tabsBound.add(context.tablist);
      context.tablist.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const target = event.target.closest('button[role="tab"]');
        const tabs = [...context.tablist.children].filter(el => el.matches('button[role="tab"]'));
        const index = tabs.indexOf(target);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
          (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
        tabs[next].focus();
      });
    }
    for (const tab of context.nativeTabs) {
      if (ctProfileState.tabsBound.has(tab)) continue;
      ctProfileState.tabsBound.add(tab);
      tab.addEventListener('click', () => closeFavoritesPanel(), true);
    }
    if (!ctProfileState.uid || !ctProfileState.accountUser) ctProfileEnsureIdentity(context);
    if (ctProfileState.active) ctProfileShow(context);
  }
  function ctProfileShow(context) {
    if (!ctProfileState.active || !context || context.path !== ctProfileState.path || context.user !== ctProfileState.user) return;
    if (!context.timeline.hasAttribute('data-ct-profile-timeline-hidden')) context.timeline.setAttribute('data-ct-profile-timeline-hidden', '');
    if (context.tablist.dataset.ctProfileActive !== ctProfileState.active) context.tablist.dataset.ctProfileActive = ctProfileState.active;
    for (const tab of context.nativeTabs) {
      if (!ctProfileState.nativeSelection.has(tab)) ctProfileState.nativeSelection.set(tab, tab.getAttribute('aria-selected') || 'false');
      if (tab.getAttribute('aria-selected') !== 'false') tab.setAttribute('aria-selected', 'false');
    }
    for (const tab of context.tablist.querySelectorAll('[data-ct-profile-tab]')) {
      const selected = String(tab.dataset.ctProfileTab === ctProfileState.active);
      if (tab.getAttribute('aria-selected') !== selected) tab.setAttribute('aria-selected', selected);
    }
    if (!ctProfileState.panel?.isConnected) {
      const panel = document.createElement('section'); panel.dataset.ctProfilePanel = ''; panel.dataset.ctLocalUi = 'profile';
      panel.id = ctProfileState.active === 'favorites' ? 'ct-favorites-panel' : 'ct-media-panel';
      panel.setAttribute('role', 'tabpanel');
      ctProfileState.panel = panel; context.tablist.after(panel); ctProfileState.rendered = '';
    }
    const panel = ctProfileState.panel;
    const id = ctProfileState.active === 'favorites' ? 'ct-favorites-panel' : 'ct-media-panel';
    if (panel.id !== id) panel.id = id;
    const label = ctProfileState.active === 'favorites' ? 'ct-favorites-tab' : 'ct-media-tab';
    if (panel.getAttribute('aria-labelledby') !== label) panel.setAttribute('aria-labelledby', label);
    if (ctProfileState.active === 'favorites') renderFavoritesPanel();
    else ctProfileRenderMedia();
  }
  function ctProfileStatus(text) {
    const el = document.createElement('div'); el.className = 'ct-profile-status'; el.textContent = text; return el;
  }
  function ctProfileControl(text, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ct-profile-control';
    button.textContent = text; button.onclick = action; return button;
  }
  function ctProfileRow(item) {
    const row = document.createElement('div'); row.className = 'ct-profile-row'; row.dataset.ctProfilePost = item.id;
    ctProfileState.rowItems.set(row, JSON.stringify(item));
    if (item.avatar) {
      const avatarLink = document.createElement('a'); avatarLink.href = '/user/' + encodeURIComponent(item.username);
      const avatar = document.createElement('img'); avatar.className = 'ct-profile-avatar'; avatar.src = item.avatar;
      avatar.alt = ctProfileText(`${item.name || item.username}のプロフィール`, `${item.name || item.username}'s profile`);
      avatar.loading = 'lazy'; avatar.referrerPolicy = 'no-referrer'; avatarLink.append(avatar); row.append(avatarLink);
    }
    const main = document.createElement('div'); main.className = 'ct-profile-row-main';
    const meta = document.createElement('div'); meta.className = 'ct-profile-meta';
    const name = document.createElement('a'); name.className = 'ct-profile-name'; name.href = item.username ? '/user/' + encodeURIComponent(item.username) : item.href;
    name.textContent = item.name || item.username; meta.append(name);
    if (item.username) {
      const handle = document.createElement('span'); handle.className = 'ct-profile-handle'; handle.textContent = '@' + item.username; meta.append(handle);
    }
    if (Number.isFinite(Date.parse(item.createdAt))) {
      const time = document.createElement('time'); time.className = 'ct-profile-time'; time.dateTime = item.createdAt;
      time.textContent = new Date(item.createdAt).toLocaleDateString(CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US'); meta.append(time);
    }
    main.append(meta);
    if (item.text) { const text = document.createElement('p'); text.className = 'ct-profile-text'; text.textContent = item.text; main.append(text); }
    const images = (item.media || []).filter(asset => asset.type === 'image');
    if (images.length) {
      const gallery = document.createElement('div'); gallery.className = 'ct-profile-gallery';
      gallery.setAttribute('aria-label', ctProfileText('投稿の写真', 'Post photos'));
      for (const [index, asset] of images.entries()) {
        const photo = document.createElement('button'); photo.type = 'button'; photo.className = 'ct-profile-photo';
        photo.setAttribute('aria-label', ctProfileText(`写真 ${index + 1}/${images.length}を拡大`, `Enlarge photo ${index + 1}/${images.length}`));
        const image = document.createElement('img'); image.src = asset.url; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        image.alt = ctProfileText(`投稿の写真 ${index + 1}/${images.length}`, `Post photo ${index + 1}/${images.length}`);
        photo.append(image); photo.onclick = () => ctProfileOpenViewer(images, index, photo); gallery.append(photo);
      }
      main.append(gallery);
      if (images.length > 1) {
        const note = document.createElement('p'); note.className = 'ct-profile-media-note';
        note.textContent = ctProfileText(`写真${images.length}枚 · 横にスクロールして表示`, `${images.length} photos · Scroll sideways to view all`); main.append(note);
      }
    }
    for (const asset of (item.media || []).filter(asset => asset.type === 'video')) {
      const video = document.createElement('video'); video.className = 'ct-profile-video'; video.src = asset.url;
      if (asset.poster) video.poster = asset.poster; video.controls = true; video.playsInline = true; video.preload = 'none';
      video.setAttribute('aria-label', ctProfileText('投稿の動画', 'Post video')); main.append(video);
    }
    const link = document.createElement('a'); link.className = 'ct-profile-post-link'; link.href = item.href;
    link.textContent = ctProfileText('元のツイートを開く', 'Open original Tweet'); main.append(link); row.append(main); return row;
  }
  function ctProfileExistingRows(panel) {
    return new Map([...panel.querySelectorAll(':scope > .ct-profile-row[data-ct-profile-post]')]
      .map(row => [row.dataset.ctProfilePost, row]));
  }
  function ctProfileReuseRow(item, rows) {
    const row = rows.get(item.id);
    return row && ctProfileState.rowItems.get(row) === JSON.stringify(item) ? row : ctProfileRow(item);
  }
  function ctProfileReplaceContent(panel, content, focused) {
    const retained = new Set(content);
    for (const node of [...panel.childNodes]) if (!retained.has(node)) node.remove();
    let next = panel.firstChild;
    for (const node of content) {
      if (node === next) next = next.nextSibling;
      else panel.insertBefore(node, next);
    }
    if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  function ctProfileFavoriteMuteState() {
    const uid = ctProfileUID();
    if (!ctProfileState.favoriteMutes || ctProfileState.favoriteMutes.uid !== uid ||
        ctProfileState.favoriteMutes.path !== ctProfileState.path || ctProfileState.favoriteMutes.user !== ctProfileState.user) {
      const cached = uid && ctProfileState.muteCache.get(uid);
      const recent = cached && Date.now() - cached.at < 30000;
      ctProfileState.favoriteMutes = { uid, path: ctProfileState.path, user: ctProfileState.user,
        handles: new Set(), cursors: new Set(), cursor: null, pages: 0, busy: false, done: false, error: '' };
      if (recent) {
        ctProfileState.favoriteMutes.handles = new Set(cached.handles);
        ctProfileState.favoriteMutes.done = true;
      } else if (cached) ctProfileState.muteCache.delete(uid);
    }
    return ctProfileState.favoriteMutes;
  }
  function ctProfileFavoriteMuteCurrent(state, sequence) {
    return favoritesActive && ctProfileState.active === 'favorites' && ctProfileState.favoriteMutes === state &&
      sequence === ctProfileState.sequence && location.pathname === state.path && ctProfileState.path === state.path &&
      ctProfileState.user === state.user && ctProfileUID() === state.uid && ctProfileState.uid === state.uid &&
      ctProfileState.accountUser === state.user && ctProfileContext()?.user === state.user;
  }
  async function ctProfileLoadFavoriteMutes(refresh = false) {
    if (!favoritesActive || ctProfileState.active !== 'favorites') return;
    let state = ctProfileFavoriteMuteState();
    if (state.busy || (!refresh && state.done)) return;
    if (refresh) {
      ctProfileCloseViewer(); ctProfileState.sequence++;
      ctProfileState.muteCache.delete(ctProfileUID());
      ctProfileState.favoriteMutes = null; state = ctProfileFavoriteMuteState();
    }
    const sequence = ctProfileState.sequence;
    if (!state.uid || !ctProfileFavoriteMuteCurrent(state, sequence)) { renderFavoritesPanel(); return; }
    const active = () => !document.hidden && (typeof ctPageActive === 'undefined' || ctPageActive);
    const paused = () => ctProfileText('このタブを表示してから、ミュート一覧の確認を再開してください。', 'Show this tab, then continue checking muted accounts.');
    if (!active()) { state.error = paused(); renderFavoritesPanel(); return; }
    state.busy = true; state.error = ''; renderFavoritesPanel();
    try {
      const auth = await getAuth();
      if (!ctProfileFavoriteMuteCurrent(state, sequence)) return;
      if (!auth?.token || auth.uid !== state.uid) throw new Error('sign-in');
      const headers = { Authorization: `Bearer ${auth.token}` };
      // Tweet's native muted-accounts consumer uses opaque nextCursor values,
      // with no limit override. Check at most ten pages per explicit action.
      for (let page = 0; page < 10 && !state.done; page++) {
        if (!ctProfileFavoriteMuteCurrent(state, sequence)) return;
        if (!active()) { state.error = paused(); return; }
        const cursor = state.cursor;
        const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor);
        const json = await requestJSON(API_ORIGIN + '/api/users/muted' + (cursor ? '?' + query : ''), headers);
        const current = await getAuth();
        if (!ctProfileFavoriteMuteCurrent(state, sequence) || current?.uid !== state.uid) return;
        if (!active()) { state.error = paused(); return; }
        if (!json || json.success !== true || json.error || !Array.isArray(json.users) || json.users.length > 1000 ||
            json.users.some(user => !ctProfileId(user?.userId) || !ctProfileHandle(user?.username))) throw new Error('muted-response');
        const next = json.nextCursor ?? null;
        if (next !== null && (typeof next !== 'string' || !next || next.length > 2000 || next === cursor || state.cursors.has(next))) {
          throw new Error('muted-cursor');
        }
        for (const user of json.users) state.handles.add(ctProfileHandle(user.username));
        if (cursor) state.cursors.add(cursor);
        state.cursor = next; state.pages++; state.done = !next;
      }
      if (state.done && ctProfileFavoriteMuteCurrent(state, sequence) && active()) {
        ctProfileState.muteCache.set(state.uid, { at: Date.now(), handles: [...state.handles] });
        while (ctProfileState.muteCache.size > 4) ctProfileState.muteCache.delete(ctProfileState.muteCache.keys().next().value);
      }
    } catch {
      if (ctProfileFavoriteMuteCurrent(state, sequence)) state.error = ctProfileText(
        'ミュート一覧を確認できませんでした。保存した投稿を表示する前に、再試行してください。',
        'Muted accounts could not be checked. Try again before showing saved posts.');
    } finally {
      state.busy = false;
      if (ctProfileFavoriteMuteCurrent(state, sequence)) renderFavoritesPanel();
    }
  }
  function renderFavoritesPanel() {
    if (!favoritesActive || ctProfileState.active !== 'favorites') return;
    const context = ctProfileContext();
    if (!context || !ctProfileUID() || ctProfileState.uid !== ctProfileUID() || ctProfileState.accountUser !== context.user) {
      closeFavoritesPanel(); return;
    }
    const panel = ctProfileState.panel;
    if (!panel?.isConnected) return;
    const items = ctProfileLoadFavorites(); const legacy = ctProfileLegacyFavorites();
    const uid = ctProfileUID(); const muted = ctProfileFavoriteMuteState();
    const signature = JSON.stringify(['favorites', uid, items, legacy.length, ctProfileState.storageError,
      muted.busy, muted.done, muted.error, muted.pages, [...muted.handles]]);
    if (signature === ctProfileState.rendered) return;
    ctProfileState.rendered = signature;
    const rows = ctProfileExistingRows(panel);
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const content = [];
    content.push(ctProfileStatus(ctProfileText('このブラウザに保存したお気に入りです。読み込み済みの投稿から復元します。過去の全履歴は取得できません。', 'Favorites saved in this browser. Restores Favorites from loaded posts; the entire past history cannot be retrieved.')));
    const controls = ctProfileStatus('');
    const update = ctProfileControl(ctProfileText('表示を更新', 'Refresh view'), () => ctProfileLoadFavoriteMutes(true));
    update.disabled = muted.busy; controls.append(update); content.push(controls);
    if (legacy.length) {
      const migration = ctProfileStatus(ctProfileText('以前の保存データがあります。使用中のアカウントのものか確認して取り込めます。', 'Older saved data is available. Import it if it belongs to this account.'));
      migration.append(document.createElement('br'), ctProfileControl(ctProfileText('以前の保存データを取り込む', 'Import older saved data'), () => ctProfileImportFavorites(uid))); content.push(migration);
    }
    if (ctProfileState.storageError) content.push(ctProfileStatus(ctProfileText('ブラウザに保存できませんでした。保存設定を確認してください。', 'Browser storage is unavailable. Check your storage settings.')));
    if (!muted.done) {
      const waiting = ctProfileStatus(muted.busy ? ctProfileText('ミュート一覧を確認中…', 'Checking muted accounts…') :
        muted.error || ctProfileText('ミュート一覧の確認が終わるまで、保存した投稿を表示しません。', 'Saved posts stay hidden until muted accounts have been checked.'));
      waiting.setAttribute('role', 'status');
      if (!muted.busy) waiting.append(document.createElement('br'), ctProfileControl(
        muted.error ? ctProfileText('再試行', 'Try again') : ctProfileText('続きを確認', 'Continue checking'), () => ctProfileLoadFavoriteMutes()));
      content.push(waiting);
    } else {
      const visible = items.filter(item => item.username && !muted.handles.has(item.username));
      if (visible.length < items.length) content.push(ctProfileStatus(ctProfileText(
        `ミュートした作者や作者を確認できない投稿${items.length - visible.length}件を非表示にしています。保存データは保持しています。`,
        `${items.length - visible.length} saved posts from muted or unidentified authors are hidden. Saved data is retained.`)));
      if (!visible.length) {
        const empty = document.createElement('p'); empty.className = 'ct-profile-empty';
        empty.textContent = items.length ? ctProfileText('表示できるお気に入りはありません。', 'No Favorites to display.') :
          ctProfileText('まだお気に入りがありません。ツイートの星を押すとここに保存されます。', 'No Favorites saved yet. Favorite a Tweet with the star to save it here.');
        content.push(empty);
      } else for (const item of visible) content.push(ctProfileReuseRow(item, rows));
    }
    ctProfileReplaceContent(panel, content, focused);
  }
  function ctProfileMediaState() {
    const uid = ctProfileUID();
    if (!ctProfileState.media || ctProfileState.media.user !== ctProfileState.user || (ctProfileState.media.uid && ctProfileState.media.uid !== uid)) {
      ctProfileState.media = { user: ctProfileState.user, uid, items: [], postItems: [], replyItems: [],
        scanned: 0, replyScanned: 0, cursor: null, started: false, postsStarted: false, repliesChecked: false,
        busy: false, error: '', postError: '', replyError: '', done: false, retryRefresh: false, replyLimited: false };
      const cached = uid && ctProfileState.mediaCache.get(uid + ':' + ctProfileState.user);
      if (cached && Date.now() - cached.at < 30000) ctProfileState.media = { ...cached.state,
        items: [...cached.state.items], postItems: [...cached.state.postItems], replyItems: [...cached.state.replyItems], busy: false };
      else if (cached) ctProfileState.mediaCache.delete(uid + ':' + ctProfileState.user);
    }
    if (uid && !ctProfileState.media.uid) ctProfileState.media.uid = uid;
    return ctProfileState.media;
  }
  function ctProfilePostItem(post, user) {
    if (!ctProfileId(post?.id) || ctProfileHandle(post.authorUsername) !== user || post.isDeleted || post.status === 'MUTED' ||
        post.isRepost || post.originalPostId || post.repostedBy) return null;
    const media = ctProfileMediaAssets(post);
    if (!media.length) return null;
    return { id: post.id, username: user,
      name: typeof post.authorName === 'string' ? post.authorName.slice(0, 200) : user,
      avatar: ctProfileURL(post.authorAvatar), text: typeof post.text === 'string' ? post.text.slice(0, 10000) : '',
      createdAt: typeof (post.createdAt ?? post.created_at) === 'string' ? (post.createdAt ?? post.created_at) : '',
      href: '/post/' + encodeURIComponent(post.id), media };
  }
  async function ctProfileLoadMedia(refresh = false) {
    if (ctProfileState.active !== 'media' || document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) return;
    const state = ctProfileMediaState();
    refresh = refresh || (state.postError && state.retryRefresh);
    if (state.busy || (!refresh && state.started && state.done && !state.error)) return;
    if (refresh && state.uid) ctProfileState.mediaCache.delete(state.uid + ':' + state.user);
    const loadPosts = refresh || !state.postsStarted || !!state.postError || (!state.done && !state.replyError);
    const loadReplies = refresh || !state.repliesChecked || !!state.replyError;
    state.busy = true; state.error = ''; const sequence = ctProfileState.sequence;
    const path = ctProfileState.path; const user = ctProfileState.user;
    ctProfileRenderMedia();
    try {
      const auth = await getAuth();
      if (!auth?.token || !ctProfileId(auth.uid)) throw new Error('sign-in');
      if (sequence !== ctProfileState.sequence || location.pathname !== path || ctProfileState.user !== user || ctProfileUID() !== auth.uid) return;
      if (state.uid && state.uid !== auth.uid) return;
      state.uid = auth.uid;
      const query = new URLSearchParams({ limit: '24' });
      const cursor = refresh ? null : state.cursor;
      if (cursor) query.set('cursor', cursor);
      const headers = { Authorization: `Bearer ${auth.token}` };
      // Only the native posts route has a verified cursor. The native replies
      // route returns wrappers without pagination; display its newest 100 safely.
      const currentRequest = () => sequence === ctProfileState.sequence && ctProfileState.media === state &&
        location.pathname === path && ctProfileState.path === path && ctProfileState.user === user &&
        ctProfileUID() === auth.uid && ctProfileContext()?.user === user;
      const publish = () => {
        state.items = [...new Map([...state.postItems, ...state.replyItems].map(item => [item.id, item])).values()]
          .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
        state.error = [state.postError, state.replyError].filter(Boolean).join(' ');
        ctProfileRenderMedia();
      };
      const posts = async () => {
        if (!loadPosts) return;
        const postsJSON = await requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(user) + '/posts?' + query, headers).catch(() => null);
        const current = await getAuth();
        if (!currentRequest() || current?.uid !== auth.uid) return;
        if (!postsJSON || postsJSON.success === false || postsJSON.error || !Array.isArray(postsJSON.posts) || postsJSON.posts.length > 100) {
          state.postError = ctProfileText('ツイートの写真・動画を取得できませんでした。もう一度お試しください。', 'Tweet photos and videos could not be loaded. Try again.');
          state.retryRefresh = !!refresh;
        } else {
          ctProfileRememberLikedPosts(postsJSON.posts, auth.uid, user);
          const items = postsJSON.posts.map(post => ctProfilePostItem(post, user)).filter(Boolean);
          state.postItems = [...new Map([...(refresh ? [] : state.postItems), ...items].map(item => [item.id, item])).values()];
          state.scanned = (refresh ? 0 : state.scanned) + postsJSON.posts.length;
          const next = typeof postsJSON.nextCursor === 'string' && postsJSON.nextCursor.length <= 2000 && postsJSON.nextCursor ? postsJSON.nextCursor : null;
          state.cursor = next && next !== cursor ? next : null;
          state.done = !state.cursor; state.postsStarted = true; state.postError = ''; state.retryRefresh = false;
        }
        publish();
      };
      const replies = async () => {
        if (!loadReplies) return;
        const repliesJSON = await requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(user) + '/replies', headers).catch(() => null);
        const current = await getAuth();
        if (!currentRequest() || current?.uid !== auth.uid) return;
        if (!repliesJSON || repliesJSON.success === false || repliesJSON.error || !Array.isArray(repliesJSON.replies)) {
          state.replyError = ctProfileText('返信の写真・動画を取得できませんでした。再試行すると返信を再確認します。', 'Reply photos and videos could not be loaded. Try again to recheck replies.');
        } else {
          const replies = repliesJSON.replies.map(item => item?.post).filter(post =>
            ctProfileId(post?.id) && ctProfileHandle(post.authorUsername) === user)
            .sort((a, b) => (Date.parse(b.createdAt ?? b.created_at) || 0) - (Date.parse(a.createdAt ?? a.created_at) || 0));
          const checked = replies.slice(0, 100);
          ctProfileRememberLikedPosts(checked, auth.uid, user);
          state.replyItems = checked.map(post => ctProfilePostItem(post, user)).filter(Boolean);
          state.replyScanned = checked.length; state.replyLimited = replies.length > 100;
          state.repliesChecked = true; state.replyError = '';
        }
        publish();
      };
      // Independent streams start together, but each publishes as soon as its
      // response is checked. Slow replies no longer hold back ready photos.
      await Promise.all([posts(), replies()]);
      if (currentRequest()) {
        state.started = true;
        if (!state.error) {
          ctProfileState.mediaCache.set(auth.uid + ':' + user, { at: Date.now(), state: { ...state, busy: false } });
          while (ctProfileState.mediaCache.size > 8) ctProfileState.mediaCache.delete(ctProfileState.mediaCache.keys().next().value);
        }
      }
    } catch {
      if (sequence === ctProfileState.sequence) {
        state.postError = ctProfileText('写真・動画を取得できませんでした。ログイン状態を確認して、もう一度お試しください。', 'Photos and videos could not be loaded. Check your sign-in and try again.');
        state.error = state.postError; state.retryRefresh = !!refresh;
      }
    } finally {
      state.busy = false;
      if (ctProfileState.media === state && ctProfileState.active === 'media' && ctProfileState.path === path && ctProfileState.user === user) {
        ctProfileRenderMedia();
        // Returning to Media while its discarded first request was completing
        // starts one fresh request after it finishes, never in parallel.
        if (sequence !== ctProfileState.sequence && !state.started && !state.error) ctProfileLoadMedia();
      }
    }
  }
  function ctProfileRenderMedia() {
    if (ctProfileState.active !== 'media' || !ctProfileState.panel?.isConnected) return;
    const state = ctProfileMediaState();
    const signature = JSON.stringify(['media', state.uid, state.items, state.scanned, state.replyScanned, state.busy, state.error, state.done, state.replyLimited]);
    if (signature === ctProfileState.rendered) return;
    ctProfileState.rendered = signature;
    const rows = ctProfileExistingRows(ctProfileState.panel);
    const focused = ctProfileState.panel.contains(document.activeElement) ? document.activeElement : null;
    const content = [];
    const note = ctProfileStatus(ctProfileText(`投稿${state.scanned}件・返信${state.replyScanned}件を確認 · 写真・動画`, `${state.scanned} posts and ${state.replyScanned} replies checked · Photos and videos`));
    const scope = document.createElement('div');
    scope.textContent = ctProfileText('返信は最新100件まで含みます。以前のツイートは下から読み込めます。', 'Includes up to the latest 100 replies. Load older Tweets below.');
    note.append(scope, document.createElement('br'), ctProfileControl(ctProfileText('更新', 'Refresh'), () => ctProfileLoadMedia(true)));
    note.querySelector('button').disabled = state.busy; content.push(note);
    for (const item of state.items) content.push(ctProfileReuseRow(item, rows));
    if (!state.items.length) {
      const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.setAttribute('role', 'status');
      empty.textContent = state.busy ? ctProfileText('写真・動画を読み込み中…', 'Loading photos and videos…') :
        state.done && !state.error ? ctProfileText('写真・動画のあるツイートはありません。', 'No Tweets with photos or videos.') :
          ctProfileText('ここまでの投稿には写真・動画がありません。以前の投稿を確認できます。', 'No photos or videos in the posts checked so far. You can check older posts.');
      content.push(empty);
    }
    if (state.error) content.push(ctProfileStatus(state.error));
    if (!state.done || state.error) {
      const footer = ctProfileStatus('');
      const next = ctProfileControl(state.busy ? ctProfileText('読み込み中…', 'Loading…') :
        state.error ? ctProfileText('再試行', 'Try again') : ctProfileText('以前の投稿を確認', 'Check older posts'), () => ctProfileLoadMedia());
      next.disabled = state.busy; footer.append(next); content.push(footer);
    }
    ctProfileReplaceContent(ctProfileState.panel, content, focused);
  }
