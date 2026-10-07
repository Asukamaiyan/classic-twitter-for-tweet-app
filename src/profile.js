  // Profile additions use Tweet's verified posts GET. Favorites are browser-local
  // snapshots, scoped to the signed-in account; no favorite-history endpoint is assumed.
  const ctProfileState = {
    path: '', user: '', uid: null, authSeen: undefined, accountUser: '', active: '', tablist: null,
    timeline: null, panel: null, sequence: 0, identityBusy: false, identityRetry: 0,
    nativeSelection: new Map(), tabsBound: new WeakSet(), rendered: '', media: null, favoriteMutes: null,
    storageBound: false, storageError: false, storageFailureUID: null, memory: new Map(), dirtyMemory: new Set(), viewer: null,
    rowItems: new WeakMap(), muteCache: new Map(), mediaCache: new Map(), favoriteRemovals: new Map(), favoriteView: null
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
    // Keep the first occurrence, including its saved time. An archive must not
    // silently discard older records when the collection grows past 500.
    const items = new Map();
    for (const item of data) {
      if (!ctProfileId(item?.id) || items.has(item.id)) continue;
      items.set(item.id, {
      id: item.id, username: ctProfileHandle(item.username) || '',
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : '',
      text: typeof item.text === 'string' ? item.text.slice(0, 10000) : '',
      avatar: ctProfileURL(item.avatar), savedAt: Number.isFinite(Number(item.savedAt)) && Number(item.savedAt) >= 0 ? Number(item.savedAt) : 0,
      createdAt: typeof item.createdAt === 'string' && (ctTimestampParse(item.createdAt) || Number.isFinite(Date.parse(item.createdAt))) ? item.createdAt : '',
      href: `${location.origin}/post/${encodeURIComponent(item.id)}`,
      media: Array.isArray(item.media) ? item.media.slice(0, 16).filter(asset =>
        ['image', 'video'].includes(asset?.type) && ctProfileURL(asset.url)).map(asset => ({
          type: asset.type, url: ctProfileURL(asset.url), poster: ctProfileURL(asset.poster)
        })) : []
      });
    }
    return [...items.values()];
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
    if (ctProfileState.favoriteView?.uid === uid) ctProfileClearFavoriteBackupParts();
    try {
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      ctProfileState.storageError = false; ctProfileState.dirtyMemory.delete(uid);
      if (ctProfileState.storageFailureUID === uid) ctProfileState.storageFailureUID = null;
    } catch { ctProfileState.storageError = true; ctProfileState.storageFailureUID = uid; ctProfileState.dirtyMemory.add(uid); }
    if (favoritesActive) renderFavoritesPanel();
    return true;
  }
  function ctProfileSaveFavorite(item, expectedUid = ctProfileUID()) {
    if (!ctProfileId(item?.id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    ctProfileState.favoriteRemovals.get(expectedUid)?.delete(item.id);
    return ctProfileWriteFavorites(expectedUid, [item, ...ctProfileLoadFavorites().filter(row => row.id !== item.id)]);
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
      // The native client prefers created_at. A missing or invalid alias must
      // not hide a valid creation time or replace a known time with savedAt.
      const createdAt = ctTimestampPostValue(post) || known.get(post.id)?.createdAt || '';
      recovered.set(post.id, { id: post.id, username,
        name: typeof post.authorName === 'string' ? post.authorName.slice(0, 200) : username,
        avatar: ctProfileURL(post.authorAvatar), text: post.text.slice(0, 10000),
        createdAt,
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
      const items = ctProfileFavoriteItems(merged);
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      localStorage.setItem(KEY.favorites + ':owner', uid);
      ctProfileState.memory.set(uid, items);
      ctProfileState.storageError = false; ctProfileState.dirtyMemory.delete(uid);
      if (ctProfileState.storageFailureUID === uid) ctProfileState.storageFailureUID = null;
      if (ctProfileState.favoriteView?.uid === uid) ctProfileClearFavoriteBackupParts();
    } catch { ctProfileState.storageError = true; ctProfileState.storageFailureUID = uid; }
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
      .ct-profile-tab:focus-visible,.ct-profile-control:focus-visible,.ct-profile-details>summary:focus-visible,.ct-profile-photo:focus-visible{outline:2px solid #55acee;outline-offset:-3px}
      [data-ct-profile-panel]{position:relative!important;inset:auto!important;max-height:none!important;width:auto!important;max-width:100%;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:inherit!important;color:inherit;box-shadow:none!important;z-index:auto!important}
      .ct-profile-status{padding:6px 16px;font-size:12px;color:var(--color-tl-app-text-muted,#657786);line-height:1.45;overflow-wrap:anywhere}
      .ct-profile-empty{padding:32px 16px;text-align:center;color:var(--color-tl-app-text-muted,#657786);font-size:14px}
      .ct-profile-control{min-height:44px;max-width:100%;padding:8px;border:0;border-radius:0;background:transparent;color:#55acee;font:inherit;line-height:20px;cursor:pointer;margin:0;overflow-wrap:anywhere}
      .ct-profile-control:hover{color:var(--color-tl-app-text,#14171a);text-decoration:underline}
      .ct-profile-control:disabled{cursor:wait;opacity:.6}
      .ct-profile-toolbar{display:flex;flex-wrap:wrap;column-gap:8px;row-gap:0;align-items:center;min-width:0;padding:0 12px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544);font-size:12px;color:var(--color-tl-app-text-muted,#657786);line-height:1.45}
      .ct-profile-toolbar-count{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ct-profile-toolbar>.ct-profile-control{flex:none}
      .ct-profile-details{min-width:0;max-width:100%}
      .ct-profile-details>summary{box-sizing:border-box;min-height:44px;padding:12px 8px;line-height:20px;list-style-position:inside;color:#55acee;cursor:pointer;overflow-wrap:anywhere}
      .ct-profile-details>summary:hover{text-decoration:underline}
      .ct-profile-details[open]{flex-basis:100%}
      .ct-profile-detail-body{padding:0 4px 8px;overflow-wrap:anywhere}
      .ct-profile-detail-body>div{margin:0 0 6px}
      .ct-profile-detail-actions{display:flex;flex-wrap:wrap;column-gap:8px;row-gap:0}
      .ct-profile-toolbar [hidden]{display:none!important}
      .ct-favorite-tools input[type=file]{display:none}
      .ct-favorite-summary{flex-basis:100%;min-width:0;overflow-wrap:anywhere}
      .ct-favorite-summary:empty{display:none}
      #ct-favorite-backup-status,#ct-favorite-storage-status{padding:6px 4px}
      #ct-favorite-backup-status[data-error=true],#ct-favorite-storage-status{color:var(--color-tl-app-danger,#c23636)}
      .ct-profile-row{display:flex;gap:12px;padding:16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544)}
      .ct-profile-avatar{width:40px;height:40px;flex:none;border-radius:4px;object-fit:cover}
      .ct-profile-row-main{min-width:0;flex:1}
      .ct-profile-meta{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font-size:14px;line-height:20px}
      .ct-profile-name{font-weight:700;color:inherit;text-decoration:none}
      .ct-profile-handle,.ct-profile-time{font-size:12px;color:var(--color-tl-app-text-muted,#657786);text-decoration:none}
      .ct-profile-time{white-space:nowrap}
      .ct-profile-text{font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px}
      .ct-profile-gallery{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;border-radius:4px;scrollbar-width:thin}
      .ct-profile-photo{display:block;flex:0 0 100%;min-width:0;padding:0;background:var(--color-tl-app-bg,#f5f8fa);border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;overflow:hidden;scroll-snap-align:start;cursor:zoom-in}
      .ct-profile-photo img{display:block;width:100%;height:auto;max-height:480px;object-fit:contain}
      .ct-profile-video{display:block;width:100%;max-height:480px;background:#000;border-radius:4px;margin:8px 0}
      .ct-profile-media-note{font-size:12px;color:var(--color-tl-app-text-muted,#657786);margin:6px 0}
      .ct-profile-post-link{display:inline-flex;align-items:center;min-height:44px;color:#55acee;font-size:13px;text-decoration:none}
      .ct-profile-post-link:hover,.ct-profile-name:hover{text-decoration:underline}
      .ct-profile-viewer{box-sizing:border-box;position:fixed;inset:var(--ct-photo-view-top,0px) auto auto var(--ct-photo-view-left,0px);margin:0;padding:0;border:0;background:#000;color:#fff;width:var(--ct-photo-view-width,100vw);height:var(--ct-photo-view-height,100dvh);max-width:none;max-height:none;overflow:hidden}
      .ct-profile-viewer[open]{display:grid;grid-template-rows:minmax(0,1fr)}
      .ct-profile-viewer::backdrop{background:#000c}
      .ct-profile-viewer-stage{position:relative;box-sizing:border-box;display:grid;place-items:center;min-width:0;min-height:0;overflow:hidden;padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(env(safe-area-inset-left),env(safe-area-inset-right));touch-action:pan-y pinch-zoom}
      .ct-profile-viewer-zoomed .ct-profile-viewer-stage{touch-action:pan-x pan-y pinch-zoom}
      .ct-profile-viewer img{display:block;width:100%;height:100%;min-width:0;min-height:0;max-width:100%;max-height:100%;object-fit:contain;margin:0}
      .ct-profile-photo-covered{opacity:0}
      .ct-profile-photo-layer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
      .ct-profile-photo-track{display:flex;width:100%;height:100%;will-change:transform}
      .ct-profile-photo-pane{box-sizing:border-box;display:grid;place-items:center;flex:0 0 100%;min-width:0;min-height:0;height:100%;padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(env(safe-area-inset-left),env(safe-area-inset-right))}
      .ct-profile-viewer-nav{position:absolute;left:env(safe-area-inset-left);right:env(safe-area-inset-right);bottom:env(safe-area-inset-bottom);display:flex;align-items:center;justify-content:space-between;padding:8px;gap:8px}
      .ct-profile-viewer-nav button{min-width:44px;min-height:44px;border:1px solid #ffffff55;border-radius:4px;color:inherit;background:transparent;font:inherit;cursor:pointer}
      .ct-profile-viewer>.ct-media-photo-quality{bottom:calc(68px + env(safe-area-inset-bottom))}
      @media(max-width:480px){.ct-profile-row{padding:12px;gap:10px}.ct-profile-photo img,.ct-profile-video{max-height:360px}}
      @media(prefers-reduced-motion:no-preference){.ct-profile-tab,.ct-profile-control{transition:color 120ms ease,background-color 120ms ease}}
    `;
    document.head.appendChild(style);
  }
  function ctProfileCloseViewer() {
    const viewer = ctProfileState.viewer;
    if (!viewer) return;
    ctProfileState.viewer = null;
    if (typeof ctMediaReleasePhotoQuality === 'function') ctMediaReleasePhotoQuality(viewer.dialog);
    viewer.cleanup?.();
    try { viewer.dialog.close(); } catch {}
    viewer.dialog.remove();
    const trigger = viewer.trigger?.isConnected ? viewer.trigger :
      ctProfileState.tablist?.querySelector('button[role="tab"][aria-selected="true"]');
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  function ctProfilePhotoGestures(viewer, show) {
    const { dialog, stage, image, images } = viewer;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const pointers = new Set(), decoded = new Map(), listeners = [];
    let touch = null, motion = null, pinch = false, queued = null, waitTimer = null, suppressUntil = 0, closed = false;
    const context = `${location.pathname}${location.search}\n${ctProfileUID() || ''}`;
    const valid = () => !closed && ctProfileState.viewer === viewer && dialog.isConnected &&
      viewer.trigger?.isConnected && viewer.gallery?.isConnected && !document.hidden && ctPageActive &&
      context === `${location.pathname}${location.search}\n${ctProfileUID() || ''}` &&
      viewer.sources === [...viewer.gallery.querySelectorAll(':scope > .ct-profile-photo > img')].map(node => node.src).join('\n');
    const listen = (target, name, handler, options) => { target?.addEventListener?.(name, handler, options); listeners.push([target, name, handler, options]); };
    const reset = () => {
      const oldTouch = touch; touch = null;
      if (oldTouch?.pointer != null) try { oldTouch.capture?.releasePointerCapture(oldTouch.pointer); } catch {}
      clearTimeout(waitTimer); waitTimer = null; queued = null;
      if (!motion) return;
      const oldMotion = motion; motion = null;
      cancelAnimationFrame(oldMotion.frame); clearTimeout(oldMotion.timer);
      image.removeEventListener('load', oldMotion.loaded); image.removeEventListener('error', oldMotion.loaded);
      image.classList.remove('ct-profile-photo-covered'); oldMotion.layer.remove();
    };
    const cancel = () => { if (touch?.locked || pinch) suppressUntil = Date.now() + 400; reset(); };
    const forget = () => { for (const entry of decoded.values()) entry.image.removeEventListener('load', entry.loaded); decoded.clear(); };
    const warm = () => {
      if (!valid() || images.length < 2 || reduce?.matches || ctPhotoViewportZoomed()) { forget(); return; }
      const wanted = new Set([viewer.index - 1, viewer.index, viewer.index + 1].filter(index => images[index]));
      for (const [index, entry] of decoded) if (!wanted.has(index)) { entry.image.removeEventListener('load', entry.loaded); decoded.delete(index); }
      for (const index of wanted) {
        if (decoded.has(index)) continue;
        const node = document.createElement('img'); node.alt = ''; node.draggable = false; node.decoding = 'async'; node.referrerPolicy = image.referrerPolicy;
        const entry = { image: node, ready: false, loaded: null }; decoded.set(index, entry);
        entry.loaded = () => {
          if (!valid() || decoded.get(index) !== entry) return;
          entry.ready = node.complete && node.naturalWidth > 0;
          // The finger can reverse direction after the initially opposite photo
          // finishes decoding. Fill that pane before covering the shown image.
          const pane = motion?.panes.get(index);
          if (entry.ready && pane && !pane.firstElementChild) pane.append(node);
          if (entry.ready && queued === index) { reset(); viewer.index = index; show(); warm(); }
        };
        const canDecode = typeof node.decode === 'function';
        if (!canDecode) node.addEventListener('load', entry.loaded);
        node.src = images[index].url;
        if (canDecode) {
          try { Promise.resolve(node.decode()).then(entry.loaded, () => {}); } catch {}
        } else entry.loaded();
      }
    };
    const layer = target => {
      if (motion || reduce?.matches) return;
      warm();
      if (!decoded.get(viewer.index)?.ready || images[target] && !decoded.get(target)?.ready) return;
      const overlay = document.createElement('div'); overlay.className = 'ct-profile-photo-layer'; overlay.setAttribute('aria-hidden', 'true');
      const track = document.createElement('div'); track.className = 'ct-profile-photo-track';
      const panes = new Map();
      for (const index of [viewer.index - 1, viewer.index, viewer.index + 1]) {
        const pane = document.createElement('div'); pane.className = 'ct-profile-photo-pane';
        const entry = decoded.get(index); if (entry?.ready) pane.append(entry.image); track.append(pane); panes.set(index, pane);
      }
      overlay.append(track); stage.append(overlay); image.classList.add('ct-profile-photo-covered');
      motion = { layer: overlay, track, panes, frame: 0, timer: null, offset: 0, loaded: null };
      track.style.transform = 'translate3d(-100%,0,0)';
    };
    const offset = dx => {
      if (!motion) return;
      motion.offset = dx; if (motion.frame) return;
      const current = motion;
      current.frame = requestAnimationFrame(() => {
        current.frame = 0;
        if (motion === current) current.track.style.transform = `translate3d(calc(-100% + ${current.offset}px),0,0)`;
      });
    };
    const settle = target => {
      if (!valid()) { ctProfileCloseViewer(); return; }
      const current = motion, before = viewer.index, commit = target !== before;
      if (commit && !reduce?.matches && !decoded.get(target)?.ready) {
        // Keep the shown photo while the destination is unavailable. Late loads
        // can select it only within this live gesture's bounded wait.
        reset(); queued = target; waitTimer = setTimeout(reset, 1600); warm(); return;
      }
      if (commit) { viewer.index = target; show(); }
      if (!current) { warm(); return; }
      cancelAnimationFrame(current.frame); current.frame = 0;
      current.track.style.transform = `translate3d(calc(-100% + ${current.offset}px),0,0)`;
      current.track.getBoundingClientRect();
      current.track.style.transition = 'transform 220ms cubic-bezier(.22,.68,0,1)';
      current.track.style.transform = `translate3d(${commit ? target > before ? '-200%' : '0%' : '-100%'},0,0)`;
      current.timer = setTimeout(() => {
        if (motion !== current) return;
        if (!valid()) { ctProfileCloseViewer(); return; }
        const release = () => { if (motion === current) { reset(); warm(); } };
        if (!commit || image.complete && image.naturalWidth > 0 && image.currentSrc === images[target].url) release();
        else {
          current.loaded = event => {
            if (image.src === images[target].url && (event.type === 'error' ||
                image.complete && image.naturalWidth > 0 && image.currentSrc === images[target].url)) release();
          };
          image.addEventListener('load', current.loaded); image.addEventListener('error', current.loaded);
          current.timer = setTimeout(release, 1200);
        }
      }, 240);
    };
    const start = (event, point) => {
      if (!valid()) { ctProfileCloseViewer(); return; }
      if (!point || images.length < 2 || motion || queued != null || pinch || ctPhotoViewportZoomed() ||
          event.target !== image && event.target !== stage) return;
      touch = { x: point.clientX, y: point.clientY, at: performance.now(), locked: false, pointer: event.pointerId,
        width: stage.clientWidth || window.innerWidth };
    };
    const drag = (event, point) => {
      if (!touch || !point) return;
      if (!valid()) { ctProfileCloseViewer(); return; }
      if (pinch || ctPhotoViewportZoomed()) { cancel(); return; }
      const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
      if (!touch.locked) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { touch = null; return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        touch.locked = true; layer(viewer.index + (dx < 0 ? 1 : -1));
        if (event.pointerId != null) try { event.target.setPointerCapture(event.pointerId); touch.capture = event.target; } catch {}
      }
      if (event.cancelable) event.preventDefault();
      const edge = viewer.index === 0 && dx > 0 || viewer.index === images.length - 1 && dx < 0;
      const target = viewer.index + (dx < 0 ? 1 : -1);
      // A reversed drag may face the still-undecoded neighbor. Keep the center
      // photo visible until that pane is ready instead of exposing a black pane.
      offset(images[target] && !decoded.get(target)?.ready ? 0 : edge ? dx * .22 : Math.max(-touch.width, Math.min(touch.width, dx)));
    };
    const end = (event, point) => {
      const current = touch; if (!current || !point) return;
      drag(event, point); if (touch !== current) return;
      touch = null;
      if (current.locked) {
        const dx = point.clientX - current.x, fast = Math.abs(dx) >= 24 && Math.abs(dx) / Math.max(1, performance.now() - current.at) > .55;
        const target = Math.max(0, Math.min(images.length - 1, viewer.index + (dx < 0 ? 1 : -1)));
        suppressUntil = Date.now() + 400; settle(fast || Math.abs(dx) >= Math.min(90, current.width * .18) ? target : viewer.index);
      }
      if (current.pointer != null) try { current.capture?.releasePointerCapture(current.pointer); } catch {}
    };
    const pointer = typeof window.PointerEvent === 'function';
    if (pointer) {
      listen(dialog, 'pointerdown', event => {
        if (event.pointerType !== 'mouse') {
          pointers.add(event.pointerId);
          if (event.isPrimary === false || pointers.size > 1) { pinch = true; cancel(); return; }
        }
        if (event.button === 0) start(event, event);
      });
      listen(dialog, 'pointermove', event => { if (touch?.pointer === event.pointerId) drag(event, event); });
      listen(dialog, 'pointerup', event => {
        pointers.delete(event.pointerId); if (pinch) cancel(); else if (touch?.pointer === event.pointerId) end(event, event);
        if (!pointers.size) pinch = false;
      });
      listen(dialog, 'pointercancel', event => { pointers.delete(event.pointerId); cancel(); if (!pointers.size) pinch = false; });
      listen(dialog, 'lostpointercapture', event => { if (touch?.pointer === event.pointerId) cancel(); });
    }
    listen(dialog, 'touchstart', event => {
      if (event.touches?.length !== 1 || ctPhotoViewportZoomed()) { pinch = true; cancel(); }
      else if (!pointer && !pinch) start(event, event.touches[0]);
    }, { passive: true });
    listen(dialog, 'touchmove', event => {
      if (event.touches?.length !== 1 || ctPhotoViewportZoomed()) { pinch = true; cancel(); }
      else if (!pointer && !pinch) drag(event, event.touches[0]);
    }, { passive: false });
    listen(dialog, 'touchend', event => {
      if (pinch || ctPhotoViewportZoomed()) cancel(); else if (!pointer) end(event, event.changedTouches?.[0]);
      if (!event.touches?.length) pinch = false;
    });
    listen(dialog, 'touchcancel', event => { cancel(); pinch = !!event.touches?.length; pointers.clear(); });
    listen(dialog, 'dragstart', event => { if (touch && event.target === image) event.preventDefault(); });
    listen(dialog, 'click', event => {
      if (Date.now() < suppressUntil && (event.target === image || event.target === stage)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    const pause = () => { cancel(); forget(); pointers.clear(); pinch = false; };
    listen(document, 'visibilitychange', () => { if (document.hidden) pause(); else warm(); });
    listen(window, 'pagehide', pause);
    listen(reduce, 'change', () => { cancel(); forget(); warm(); });
    return {
      move: step => { cancel(); if (!valid()) { ctProfileCloseViewer(); return; } viewer.index = Math.max(0, Math.min(images.length - 1, viewer.index + step)); show(); warm(); },
      fit: result => { dialog.classList.toggle('ct-profile-viewer-zoomed', result.zoomed); if (result.zoomed || result.changed) { cancel(); forget(); } warm(); },
      cleanup: () => { closed = true; pause(); for (const [target, name, handler, options] of listeners) target?.removeEventListener?.(name, handler, options); }
    };
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
    const stage = document.createElement('div'); stage.className = 'ct-profile-viewer-stage'; stage.append(img);
    const nav = document.createElement('div'); nav.className = 'ct-profile-viewer-nav';
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹';
    previous.setAttribute('aria-label', ctProfileText('前の写真', 'Previous photo'));
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = '›';
    next.setAttribute('aria-label', ctProfileText('次の写真', 'Next photo'));
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', ctProfileText('閉じる', 'Close'));
    const viewer = { dialog, stage, image: img, images: images.map(image => ({ ...image })), index, trigger,
      gallery: trigger.closest('.ct-profile-gallery'), sources: images.map(image => image.url).join('\n') };
    const show = () => {
      img.src = images[viewer.index].url;
      img.alt = ctProfileText(`写真 ${viewer.index + 1}/${images.length}`, `Photo ${viewer.index + 1}/${images.length}`);
      count.textContent = `${viewer.index + 1} / ${images.length}`;
      previous.disabled = viewer.index === 0; next.disabled = viewer.index === images.length - 1;
    };
    let gestures;
    const move = step => gestures.move(step);
    previous.onclick = () => move(-1); next.onclick = () => move(1); close.onclick = ctProfileCloseViewer;
    dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); ctProfileCloseViewer(); });
    nav.append(previous, count, next, close); dialog.append(stage, nav); document.body.append(dialog);
    const viewport = window.visualViewport;
    const fit = () => { const result = ctPhotoViewportFit(dialog, '--ct-photo-view-'); gestures.fit(result); };
    viewport?.addEventListener('resize', fit); viewport?.addEventListener('scroll', fit); window.addEventListener('resize', fit);
    ctProfileState.viewer = viewer;
    viewer.cleanup = () => {
      gestures.cleanup();
      viewport?.removeEventListener('resize', fit); viewport?.removeEventListener('scroll', fit); window.removeEventListener('resize', fit);
    };
    gestures = ctProfilePhotoGestures(viewer, show);
    fit();
    show();
    if (typeof ctMediaAttachPhotoQuality === 'function') ctMediaAttachPhotoQuality(dialog, img);
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
    ctProfileClearFavoriteBackupParts();
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
      if (event.key === ctProfileFavoriteKey(ctProfileUID() || '') || event.key === KEY.favorites + ':owner') {
        ctProfileClearFavoriteBackupParts(); renderFavoritesPanel();
      }
    });
    window.addEventListener('pagehide', () => { ctProfileCloseViewer(); ctProfileClearFavoriteBackupParts(); });
    window.addEventListener('ct-favorite-history-change', renderFavoritesPanel);
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
      if (type !== 'favorites') ctProfileClearFavoriteBackupParts();
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
  function ctProfileToolbarSummary(el, text, description = text) {
    if (el.textContent !== text) el.textContent = text;
    if (el.getAttribute('aria-label') !== description) el.setAttribute('aria-label', description);
    if (el.title !== description) el.title = description;
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
    const created = ctTimestampParse(item.createdAt);
    if (created) {
      const time = document.createElement('time'); time.className = 'ct-profile-time'; time.dateTime = item.createdAt;
      const locale = CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US';
      time.textContent = created.toLocaleString(locale, { year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      time.title = `${ctTimestampExactText(item.createdAt)} (${item.createdAt})`; meta.append(time);
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
    const viewer = ctProfileState.viewer;
    if (viewer && (!viewer.trigger?.isConnected || !viewer.gallery?.isConnected ||
        viewer.sources !== [...viewer.gallery.querySelectorAll(':scope > .ct-profile-photo > img')].map(image => image.src).join('\n'))) {
      ctProfileCloseViewer();
    }
    if (typeof ctMediaEnhanceVideo === 'function') {
      for (const video of panel.querySelectorAll('video.ct-profile-video[controls]')) ctMediaEnhanceVideo(video);
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
  const CT_FAVORITE_BACKUP_BYTES = 32 * 1024 * 1024;
  const CT_FAVORITE_BACKUP_ROWS = 100000;
  function ctProfileFavoriteStorageError(uid = ctProfileUID()) {
    return !!uid && (ctProfileState.dirtyMemory.has(uid) || ctProfileState.storageFailureUID === uid);
  }
  function ctProfileFavoriteView() {
    const uid = ctProfileUID();
    if (!ctProfileState.favoriteView || ctProfileState.favoriteView.uid !== uid) {
      ctProfileClearFavoriteBackupParts();
      ctProfileState.favoriteView = { uid, limit: 50, message: '', error: false, busy: false,
        backupParts: null, backupRevision: 0, backupURLs: new Map() };
    }
    return ctProfileState.favoriteView;
  }
  function ctProfileFavoriteViewCurrent(view) {
    return !!view?.uid && ctProfileState.favoriteView === view && view.uid === ctProfileUID() &&
      favoritesActive && ctProfileState.active === 'favorites' && ctProfileState.uid === view.uid &&
      ctProfileState.accountUser === ctProfileContext()?.user;
  }
  function ctProfileFavoriteMessage(view, text, error = false) {
    if (!ctProfileFavoriteViewCurrent(view)) return;
    view.message = text; view.error = error; renderFavoritesPanel();
  }
  function ctProfileFavoriteBackupParts(uid = ctProfileUID()) {
    if (!uid || uid !== ctProfileUID()) throw new Error('account');
    const header = JSON.stringify({ format: 'classic-twitter-favorites', version: 1, uid,
      account: ctProfileState.accountUser, exportedAt: new Date().toISOString() }).slice(0, -1) + ',"items":[';
    const overhead = new Blob([header + ']}']).size;
    const parts = []; let chunks = []; let bytes = overhead;
    for (const { href, ...item } of ctProfileLoadFavorites()) {
      const chunk = JSON.stringify(item); const size = new Blob([chunk]).size;
      // Each normalized record is bounded well below one part's byte limit.
      // Split the whole archive; never trim old rows after storage quota fails.
      if (chunks.length && (chunks.length >= CT_FAVORITE_BACKUP_ROWS || bytes + 1 + size > CT_FAVORITE_BACKUP_BYTES)) {
        parts.push(header + chunks.join(',') + ']}'); chunks = []; bytes = overhead;
      }
      bytes += (chunks.length ? 1 : 0) + size; chunks.push(chunk);
    }
    if (chunks.length || !parts.length) parts.push(header + chunks.join(',') + ']}');
    return parts;
  }
  function ctProfileFavoriteBackup(uid = ctProfileUID()) {
    const parts = ctProfileFavoriteBackupParts(uid);
    if (parts.length !== 1) throw new Error('parts');
    return parts[0];
  }
  function ctProfileClearFavoriteBackupParts(view = ctProfileState.favoriteView) {
    if (!view) return;
    for (const [url, timer] of view.backupURLs || []) {
      clearTimeout(timer); try { URL.revokeObjectURL(url); } catch {}
    }
    view.backupURLs?.clear(); view.backupParts = null; view.backupRevision = (view.backupRevision || 0) + 1;
    view.message = '';
    ctProfileState.panel?.querySelector('#ct-favorite-backup-parts')?.replaceChildren();
  }
  function ctProfileDownloadFavoriteBackup(view, text, index = 0, total = 1) {
    if (!ctProfileFavoriteViewCurrent(view)) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = 'tweet-favorites-' + new Date().toISOString().slice(0, 10) + (total > 1 ? `-part-${index + 1}-of-${total}` : '') + '.json';
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      const timer = setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} view.backupURLs.delete(url); }, 1000);
      view.backupURLs.set(url, timer);
    }
  }
  function ctProfileReadFavoriteBackup(text, uid) {
    if (typeof text !== 'string' || new Blob([text]).size > CT_FAVORITE_BACKUP_BYTES) throw new Error('size');
    const data = JSON.parse(text);
    const keys = (object, allowed) => object && typeof object === 'object' && !Array.isArray(object) &&
      Object.keys(object).every(key => allowed.includes(key));
    if (!keys(data, ['format', 'version', 'uid', 'account', 'exportedAt', 'items']) ||
        data.format !== 'classic-twitter-favorites' || data.version !== 1 || !ctProfileId(data.uid) ||
        typeof data.account !== 'string' || data.account.length > 80 ||
        typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt)) || !Array.isArray(data.items)) throw new Error('format');
    if (data.uid !== uid) throw new Error('account');
    if (data.items.length > CT_FAVORITE_BACKUP_ROWS) throw new Error('size');
    const safeURL = value => typeof value === 'string' && (value === '' || ctProfileURL(value) === value);
    for (const item of data.items) {
      if (!keys(item, ['id', 'username', 'name', 'text', 'avatar', 'savedAt', 'createdAt', 'media']) ||
          !ctProfileId(item.id) || typeof item.username !== 'string' || (item.username && !ctProfileHandle(item.username)) ||
          typeof item.name !== 'string' || item.name.length > 200 || typeof item.text !== 'string' || item.text.length > 10000 ||
          !safeURL(item.avatar) || typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt) || item.savedAt < 0 ||
          typeof item.createdAt !== 'string' || (item.createdAt && !ctTimestampParse(item.createdAt) && !Number.isFinite(Date.parse(item.createdAt))) ||
          !Array.isArray(item.media) || item.media.length > 16 || item.media.some(asset =>
            !keys(asset, ['type', 'url', 'poster']) || !['image', 'video'].includes(asset.type) ||
            !asset.url || !safeURL(asset.url) || !safeURL(asset.poster))) throw new Error('format');
    }
    return ctProfileFavoriteItems(data.items);
  }
  function ctProfileImportFavoriteBackup(text, expectedUid = ctProfileUID()) {
    if (!expectedUid || expectedUid !== ctProfileUID()) throw new Error('account');
    const imported = ctProfileReadFavoriteBackup(text, expectedUid);
    if (expectedUid !== ctProfileUID()) throw new Error('account');
    const existing = ctProfileLoadFavorites();
    const merged = ctProfileFavoriteItems([...existing, ...imported]);
    if (!ctProfileWriteFavorites(expectedUid, merged)) throw new Error('account');
    return merged.length - existing.length;
  }
  function ctProfileFavoriteBackupError(error) {
    return error?.message === 'account' ? ctProfileText('使用中のアカウントのバックアップだけを取り込めます。', 'Only a backup for the current account can be imported.') :
      error?.message === 'size' ? ctProfileText('バックアップは32MB・10万件以内です。データは変更していません。', 'Backups must fit within 32 MB and 100,000 records. Data has not changed.') :
        ctProfileText('バックアップを読み込めませんでした。形式とファイルを確認してください。データは変更していません。', 'Could not read the backup. Check its format and file. Data has not changed.');
  }
  function ctProfileFavoriteHistorySummary(uid) {
    if (!uid || uid !== ctProfileUID() || typeof ctFavoriteHistoryStatus !== 'function') return null;
    try {
      const status = ctFavoriteHistoryStatus();
      if (!status || !['for-you', 'following'].includes(status.source) ||
          !['pages', 'scanned', 'recovered'].every(key => Number.isSafeInteger(status[key]) && status[key] >= 0)) return null;
      return { source: status.source, pages: status.pages, scanned: status.scanned, recovered: status.recovered,
        busy: status.busy === true, paused: status.paused === true, done: status.done === true,
        error: !!status.error, warning: !!status.warning };
    } catch { return null; }
  }
  function ctProfileFavoriteHistoryText(status) {
    const scope = ctProfileText('復元の確認範囲：おすすめ・フォロー中（サービスが返す投稿）', 'Recovery scope: For you and Following (posts returned by Tweet)');
    if (!status || (!status.busy && !status.paused && !status.done && !status.error && !status.warning && !status.pages)) {
      return scope + '\n' + ctProfileText('復元状況：未確認 · 便利ツールから開始できます。', 'Recovery: not checked yet. Start from Tools.');
    }
    const phase = status.done ? ctProfileText('返された範囲の確認が終了', 'Returned timeline range checked') :
      status.error || status.warning ? ctProfileText('確認を中断', 'Checking interrupted') :
        status.busy ? ctProfileText('確認中', 'Checking') : ctProfileText('一時停止', 'Paused');
    const source = status.source === 'following' ? ctProfileText('フォロー中', 'Following') : ctProfileText('おすすめ', 'For you');
    return scope + '\n' + ctProfileText(`${phase}${status.done ? '' : `（${source}）`} · ${status.pages}ページ・${status.scanned}投稿を確認／${status.recovered}件を復元`,
      `${phase}${status.done ? '' : ` (${source})`} · ${status.pages} pages / ${status.scanned} posts checked / ${status.recovered} recovered`);
  }
  function ctProfileFavoriteDateRange(items) {
    let firstDate = Infinity; let lastDate = -Infinity; let dated = 0;
    for (const item of items) {
      const date = ctTimestampParse(item.createdAt)?.getTime();
      if (date === undefined) continue;
      firstDate = Math.min(firstDate, date); lastDate = Math.max(lastDate, date); dated++;
    }
    if (!dated) return ctProfileText('保存した投稿の日付範囲：日付未確認', 'Saved Tweet date range: dates unavailable');
    const locale = CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US';
    const first = new Date(firstDate).toLocaleDateString(locale);
    const last = new Date(lastDate).toLocaleDateString(locale);
    return ctProfileText(`保存した投稿の日付範囲（表示対象）：${first}〜${last} · 日付あり${dated}件`,
      `Saved Tweet date range (available records): ${first}–${last} · ${dated} dated`);
  }
  function ctProfileFavoriteTools(panel, view) {
    const previous = panel.querySelector(':scope > [data-ct-favorite-tools]');
    if (previous?.ctFavoriteView === view) return previous;
    const tools = document.createElement('div'); tools.className = 'ct-profile-toolbar ct-favorite-tools';
    tools.dataset.ctFavoriteTools = ''; tools.ctFavoriteView = view;
    const count = document.createElement('div'); count.id = 'ct-favorite-count'; count.className = 'ct-profile-toolbar-count'; count.setAttribute('role', 'status');
    const update = ctProfileControl(ctProfileText('更新', 'Refresh'), () => ctProfileLoadFavoriteMutes(true));
    update.id = 'ct-favorite-refresh'; update.setAttribute('aria-label', ctProfileText('お気に入りの表示を更新', 'Refresh Favorites view'));
    const details = document.createElement('details'); details.className = 'ct-profile-details';
    const summary = document.createElement('summary'); summary.textContent = ctProfileText('範囲・保存', 'Details');
    summary.setAttribute('aria-label', ctProfileText('お気に入りの取得範囲と保存操作', 'Favorites coverage and backup actions'));
    const body = document.createElement('div'); body.className = 'ct-profile-detail-body';
    details.append(summary, body); tools.append(count, update, details);
    const download = ctProfileControl(ctProfileText('バックアップを保存', 'Save local backup'), async () => {
      if (!ctProfileFavoriteViewCurrent(view)) return;
      try {
        const auth = await getAuth();
        if (!ctProfileFavoriteViewCurrent(view) || auth?.uid !== view.uid) return;
        const parts = ctProfileFavoriteBackupParts(view.uid); ctProfileClearFavoriteBackupParts(view);
        if (parts.length === 1) {
          ctProfileDownloadFavoriteBackup(view, parts[0]);
          ctProfileFavoriteMessage(view, ctProfileText('このアカウントのお気に入りのダウンロードを開始しました。', 'Started downloading a local Favorites backup for this account.'));
        } else {
          view.backupParts = parts; view.backupRevision++;
          ctProfileFavoriteMessage(view, ctProfileText(`${parts.length}個のファイルに分けました。下のボタンから全て保存してください。取り込むときは1個ずつ選択します。`, `Split the archive into ${parts.length} files. Save every part using the buttons below; import them one at a time.`));
        }
      } catch (error) { ctProfileFavoriteMessage(view, error?.message === 'size' ? ctProfileFavoriteBackupError(error) : ctProfileText('バックアップを保存できませんでした。ブラウザのダウンロード設定を確認してください。', 'Could not save the backup. Check browser download settings.'), true); }
    });
    download.id = 'ct-favorite-export';
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'ct-favorite-import-file';
    const importButton = ctProfileControl(ctProfileText('バックアップを取り込む', 'Import local backup'), () => {
      if (ctProfileFavoriteViewCurrent(view) && !view.busy) file.click();
    });
    importButton.id = 'ct-favorite-import';
    file.addEventListener('change', async () => {
      if (!ctProfileFavoriteViewCurrent(view) || view.busy || !file.files?.[0]) return;
      const selected = file.files[0]; view.busy = true; view.message = ''; renderFavoritesPanel();
      try {
        if (selected.size > CT_FAVORITE_BACKUP_BYTES) throw new Error('size');
        const text = typeof selected.text === 'function' ? await selected.text() : await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('file')); reader.readAsText(selected);
        });
        const auth = await getAuth();
        if (!ctProfileFavoriteViewCurrent(view) || auth?.uid !== view.uid) return;
        const added = ctProfileImportFavoriteBackup(text, view.uid);
        ctProfileFavoriteMessage(view, ctProfileFavoriteStorageError(view.uid) ? ctProfileText('取り込んだ内容を一時保持しています。ブラウザに保存できないため、この画面を閉じる前にバックアップしてください。', 'Imported records are held temporarily. Browser storage is unavailable; save a backup before closing this page.') :
          ctProfileText(`${added}件を取り込みました。Tweet上の星・いいねの状態は変更していません。`, `Imported ${added}. Favorite/Like states on Tweet were not changed.`), ctProfileFavoriteStorageError(view.uid));
      } catch (error) { ctProfileFavoriteMessage(view, ctProfileFavoriteBackupError(error), true); }
      finally { view.busy = false; file.value = ''; if (ctProfileFavoriteViewCurrent(view)) renderFavoritesPanel(); }
    });
    const actions = document.createElement('div'); actions.className = 'ct-profile-detail-actions'; actions.append(download, importButton, file);
    const explanation = document.createElement('div'); explanation.textContent = ctProfileText('このブラウザに保存したお気に入りです。便利ツールで過去のタイムラインから復元できます。全履歴の復元は保証できません。', 'Favorites saved in this browser. Use Tools to restore Favorites from the past timeline. Coverage of the entire past history is not guaranteed.');
    const note = document.createElement('div'); note.className = 'ct-favorite-summary'; note.textContent = ctProfileText('このアカウントのブラウザ内保存データです。バックアップの取り込みはTweet上のお気に入りを変更しません。', 'Browser-local data for this account. Importing a backup does not change Favorites on Tweet.');
    const range = document.createElement('div'); range.id = 'ct-favorite-range'; range.className = 'ct-favorite-summary';
    const history = document.createElement('div'); history.id = 'ct-favorite-history-scope'; history.className = 'ct-favorite-summary'; history.style.whiteSpace = 'pre-line'; history.setAttribute('role', 'status');
    const hidden = document.createElement('div'); hidden.id = 'ct-favorite-hidden-status'; hidden.className = 'ct-favorite-summary';
    body.append(range, history, hidden, explanation, note, actions);
    const message = document.createElement('div'); message.id = 'ct-favorite-backup-status'; message.className = 'ct-favorite-summary'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const storage = document.createElement('div'); storage.id = 'ct-favorite-storage-status'; storage.className = 'ct-favorite-summary'; storage.setAttribute('role', 'status'); storage.setAttribute('aria-live', 'polite');
    const parts = document.createElement('div'); parts.id = 'ct-favorite-backup-parts'; parts.className = 'ct-favorite-summary ct-profile-detail-actions';
    tools.append(message, storage, parts); return tools;
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
    const uid = ctProfileUID(); const muted = ctProfileFavoriteMuteState(); const view = ctProfileFavoriteView();
    const storageError = ctProfileFavoriteStorageError(uid);
    const history = ctProfileFavoriteHistorySummary(uid);
    const signature = JSON.stringify(['favorites', uid, items, legacy.length, storageError,
      muted.busy, muted.done, muted.error, muted.pages, [...muted.handles], view.limit, view.message, view.error, view.busy, view.backupRevision, history]);
    if (signature === ctProfileState.rendered) return;
    ctProfileState.rendered = signature;
    const rows = ctProfileExistingRows(panel);
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const content = [];
    const tools = ctProfileFavoriteTools(panel, view);
    tools.querySelector('#ct-favorite-refresh').disabled = muted.busy;
    const importButton = tools.querySelector('#ct-favorite-import');
    if (importButton.disabled !== view.busy) importButton.disabled = view.busy;
    const message = tools.querySelector('#ct-favorite-backup-status');
    if (message.textContent !== view.message) message.textContent = view.message;
    if (message.dataset.error !== String(view.error)) message.dataset.error = String(view.error);
    const storage = tools.querySelector('#ct-favorite-storage-status');
    const storageText = storageError ? ctProfileText('ブラウザに保存できませんでした。この画面を閉じる前にバックアップを保存してください。', 'Browser storage is unavailable. Save a backup before closing this page.') : '';
    if (storage.textContent !== storageText) storage.textContent = storageText;
    const historyNode = tools.querySelector('#ct-favorite-history-scope'); const historyText = ctProfileFavoriteHistoryText(history);
    if (historyNode.textContent !== historyText) historyNode.textContent = historyText;
    const partControls = tools.querySelector('#ct-favorite-backup-parts');
    if (partControls.ctBackupParts !== view.backupParts) {
      partControls.ctBackupParts = view.backupParts; partControls.replaceChildren();
      const parts = view.backupParts;
      for (const [index, text] of (parts || []).entries()) partControls.append(ctProfileControl(
        ctProfileText(`ファイル${index + 1}/${parts.length}を保存`, `Save part ${index + 1}/${parts.length}`), async () => {
          if (!ctProfileFavoriteViewCurrent(view) || view.backupParts !== parts) return;
          try {
            const auth = await getAuth();
            if (!ctProfileFavoriteViewCurrent(view) || auth?.uid !== view.uid || view.backupParts !== parts) return;
            ctProfileDownloadFavoriteBackup(view, text, index, parts.length);
            ctProfileFavoriteMessage(view, ctProfileText(`ファイル${index + 1}/${parts.length}のダウンロードを開始しました。全てのファイルを保存してください。`, `Started downloading part ${index + 1}/${parts.length}. Save every part.`));
          } catch { ctProfileFavoriteMessage(view, ctProfileText('ファイルを保存できませんでした。もう一度お試しください。', 'Could not save this part. Try again.'), true); }
        }));
    }
    content.push(tools);
    if (legacy.length) {
      const migration = ctProfileStatus(ctProfileText('以前の保存データがあります。使用中のアカウントのものか確認して取り込めます。', 'Older saved data is available. Import it if it belongs to this account.'));
      migration.append(ctProfileControl(ctProfileText('以前の保存データを取り込む', 'Import older saved data'), () => ctProfileImportFavorites(uid))); content.push(migration);
    }
    if (!muted.done) {
      const hidden = tools.querySelector('#ct-favorite-hidden-status'); if (hidden.textContent) hidden.textContent = '';
      const count = tools.querySelector('#ct-favorite-count');
      const summary = ctProfileText(`このアカウントに保存済み${items.length}件 · 表示前にミュート一覧の確認が必要です`, `${items.length} saved for this account · Muted accounts must be checked before display`);
      const phase = muted.busy ? ctProfileText('確認中', 'Checking') : ctProfileText('未確認', 'Not checked');
      ctProfileToolbarSummary(count, ctProfileText(`保存${items.length}件 · ${phase}`, `${items.length} saved · ${phase}`), summary);
      const range = tools.querySelector('#ct-favorite-range'); const rangeText = muted.busy ?
        ctProfileText('保存した投稿の日付範囲：ミュート一覧を確認中', 'Saved Tweet date range: checking muted accounts') :
        ctProfileText('保存した投稿の日付範囲：ミュート一覧が未確認', 'Saved Tweet date range: muted accounts not checked');
      if (range.textContent !== rangeText) range.textContent = rangeText;
      const waiting = ctProfileStatus(muted.busy ? ctProfileText('ミュート一覧を確認中…', 'Checking muted accounts…') :
        muted.error || ctProfileText('ミュート一覧の確認が終わるまで、保存した投稿を表示しません。', 'Saved posts stay hidden until muted accounts have been checked.'));
      waiting.setAttribute('role', 'status');
      if (!muted.busy) waiting.append(ctProfileControl(
        muted.error ? ctProfileText('再試行', 'Try again') : ctProfileText('続きを確認', 'Continue checking'), () => ctProfileLoadFavoriteMutes()));
      content.push(waiting);
    } else {
      const unmuted = items.filter(item => item.username && !muted.handles.has(item.username));
      const hidden = tools.querySelector('#ct-favorite-hidden-status');
      const hiddenText = unmuted.length < items.length ? ctProfileText(
        `ミュートした作者や作者を確認できない投稿${items.length - unmuted.length}件を非表示にしています。保存データは保持しています。`,
        `${items.length - unmuted.length} saved posts from muted or unidentified authors are hidden. Saved data is retained.`) : '';
      if (hidden.textContent !== hiddenText) hidden.textContent = hiddenText;
      const matching = unmuted.sort((a, b) => b.savedAt - a.savedAt);
      const visible = matching.slice(0, view.limit);
      const count = tools.querySelector('#ct-favorite-count');
      const summary = ctProfileText(`このアカウントに保存済み${items.length}件 · 表示${visible.length}件／表示対象${matching.length}件`, `${items.length} saved for this account · ${visible.length} shown / ${matching.length} available`);
      ctProfileToolbarSummary(count, ctProfileText(`保存${items.length}件 · 表示${visible.length}/${matching.length}件`, `${items.length} saved · ${visible.length}/${matching.length} shown`), summary);
      const range = tools.querySelector('#ct-favorite-range'); const rangeText = ctProfileFavoriteDateRange(matching);
      if (range.textContent !== rangeText) range.textContent = rangeText;
      if (!visible.length) {
        const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.setAttribute('role', 'status');
        empty.textContent = items.length ? ctProfileText('表示できるお気に入りはありません。', 'No Favorites to display.') :
          ctProfileText('まだお気に入りがありません。ツイートの星を押すとここに保存されます。', 'No Favorites saved yet. Favorite a Tweet with the star to save it here.');
        content.push(empty);
      } else for (const item of visible) content.push(ctProfileReuseRow(item, rows));
      if (matching.length > visible.length) {
        let more = panel.querySelector(':scope > [data-ct-favorite-more]');
        if (!more || more.ctFavoriteView !== view) {
          more = ctProfileStatus(''); more.dataset.ctFavoriteMore = ''; more.ctFavoriteView = view;
          more.append(ctProfileControl(ctProfileText('さらに50件を表示', 'Show 50 more'), event => {
            if (!ctProfileFavoriteViewCurrent(view)) return;
            const focused = document.activeElement === event.currentTarget;
            view.limit += 50; renderFavoritesPanel();
            if (focused && !event.currentTarget.isConnected) panel.querySelector(':scope > .ct-profile-row:last-of-type .ct-profile-post-link')?.focus({ preventScroll: true });
          }));
        }
        content.push(more);
      }
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
      createdAt: ctTimestampPostValue(post),
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
          .sort((a, b) => (ctTimestampParse(b.createdAt)?.getTime() ?? -Infinity) - (ctTimestampParse(a.createdAt)?.getTime() ?? -Infinity));
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
            .sort((a, b) => (ctTimestampPostDate(b)?.getTime() ?? -Infinity) - (ctTimestampPostDate(a)?.getTime() ?? -Infinity));
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
    let tools = ctProfileState.panel.querySelector(':scope > [data-ct-media-tools]');
    if (tools?.ctMediaState !== state) {
      tools = document.createElement('div'); tools.className = 'ct-profile-toolbar'; tools.dataset.ctMediaTools = ''; tools.ctMediaState = state;
      const count = document.createElement('div'); count.className = 'ct-profile-toolbar-count'; count.id = 'ct-profile-media-count'; count.setAttribute('role', 'status');
      const update = ctProfileControl(ctProfileText('更新', 'Refresh'), () => ctProfileLoadMedia(true));
      update.setAttribute('aria-label', ctProfileText('写真・動画を更新', 'Refresh photos and videos'));
      const details = document.createElement('details'); details.className = 'ct-profile-details';
      const summary = document.createElement('summary'); summary.textContent = ctProfileText('取得範囲', 'Coverage');
      const scope = document.createElement('div'); scope.className = 'ct-profile-detail-body';
      scope.textContent = ctProfileText('返信は最新100件まで含みます。以前のツイートは下から読み込めます。', 'Includes up to the latest 100 replies. Load older Tweets below.');
      details.append(summary, scope); tools.append(count, update, details);
    }
    ctProfileToolbarSummary(tools.querySelector('#ct-profile-media-count'),
      ctProfileText(`投稿${state.scanned}件 · 返信${state.replyScanned}件`, `${state.scanned} posts · ${state.replyScanned} replies`),
      ctProfileText(`投稿${state.scanned}件・返信${state.replyScanned}件を確認 · 写真・動画`, `${state.scanned} posts and ${state.replyScanned} replies checked · Photos and videos`));
    tools.querySelector('button').disabled = state.busy; content.push(tools);
    if (state.error) {
      const error = ctProfileStatus(state.error); error.setAttribute('role', 'status'); content.push(error);
    }
    for (const item of state.items) content.push(ctProfileReuseRow(item, rows));
    if (!state.items.length) {
      const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.setAttribute('role', 'status');
      empty.textContent = state.busy ? ctProfileText('写真・動画を読み込み中…', 'Loading photos and videos…') :
        state.error ? ctProfileText('写真・動画を取得できませんでした。再試行できます。', 'Photos and videos could not be loaded. You can try again.') :
        state.done && !state.error ? ctProfileText('写真・動画のあるツイートはありません。', 'No Tweets with photos or videos.') :
          ctProfileText('ここまでの投稿には写真・動画がありません。以前の投稿を確認できます。', 'No photos or videos in the posts checked so far. You can check older posts.');
      content.push(empty);
    }
    if (!state.done || state.error) {
      const footer = ctProfileStatus('');
      const next = ctProfileControl(state.busy ? ctProfileText('読み込み中…', 'Loading…') :
        state.error ? ctProfileText('再試行', 'Try again') : ctProfileText('以前の投稿を確認', 'Check older posts'), () => ctProfileLoadMedia());
      next.disabled = state.busy; footer.append(next); content.push(footer);
    }
    ctProfileReplaceContent(ctProfileState.panel, content, focused);
  }
