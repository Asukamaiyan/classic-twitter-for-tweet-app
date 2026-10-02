  // Recover server-confirmed Favorites through the two existing feed reads.
  // Their end cursors describe feed coverage, never a complete outgoing-like list.
  const ctFavoriteHistoryState = {
    uid: null, checkpoint: null, error: '', warning: '', paused: false,
    pausedReason: '', run: null, sequence: 0, lastRequestAt: null
  };
  const CT_FAVORITE_HISTORY_INTERVAL = 800;
  const CT_FAVORITE_HISTORY_PAGES = 100;

  function ctFavoriteHistoryEmpty() {
    return { version: 1, pages: 0, scanned: 0, recovered: 0, sources: {
      'for-you': { cursor: null, done: false, seen: [] },
      following: { cursor: null, done: false, seen: [] }
    } };
  }
  function ctFavoriteHistoryKey(uid) {
    return KEY.favorites + ':history:uid:' + encodeURIComponent(uid);
  }
  function ctFavoriteHistoryCursor(value) {
    return value === null || (typeof value === 'string' && value.length > 0 &&
      value.length <= 2000 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
  }
  function ctFavoriteHistoryCheckpoint(value) {
    if (!value || value.version !== 1 || !value.sources ||
        !['pages', 'scanned', 'recovered'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
    const copy = ctFavoriteHistoryEmpty();
    for (const name of ['for-you', 'following']) {
      const source = value.sources[name];
      if (!source || typeof source.done !== 'boolean' || !ctFavoriteHistoryCursor(source.cursor) ||
          !Array.isArray(source.seen) || source.seen.some(cursor => cursor === null || !ctFavoriteHistoryCursor(cursor)) ||
          new Set(source.seen).size !== source.seen.length ||
          (source.done && source.cursor !== null) || (!source.done && source.cursor !== null && !source.seen.includes(source.cursor))) return null;
      copy.sources[name] = { cursor: source.cursor, done: source.done, seen: [...source.seen] };
    }
    if (copy.sources.following.done && !copy.sources['for-you'].done) return null;
    for (const key of ['pages', 'scanned', 'recovered']) copy[key] = value[key];
    return copy;
  }
  function ctFavoriteHistoryEmit() {
    window.dispatchEvent(new Event('ct-favorite-history-change'));
  }
  function ctFavoriteHistoryActive() {
    return !document.hidden && (typeof ctPageActive === 'undefined' || ctPageActive);
  }
  function ctFavoriteHistoryBind() {
    const uid = ctProfileId(ctNetworkState.authUID);
    if (uid === ctFavoriteHistoryState.uid) return;
    const previousRun = ctFavoriteHistoryState.run;
    ctFavoriteHistoryState.uid = uid;
    ctFavoriteHistoryState.checkpoint = ctFavoriteHistoryEmpty();
    ctFavoriteHistoryState.error = '';
    ctFavoriteHistoryState.warning = '';
    ctFavoriteHistoryState.paused = false;
    ctFavoriteHistoryState.pausedReason = '';
    try { if (uid) {
      const raw = localStorage.getItem(ctFavoriteHistoryKey(uid));
      if (raw !== null) {
        const checkpoint = ctFavoriteHistoryCheckpoint(JSON.parse(raw));
        if (!checkpoint) throw new Error('checkpoint');
        ctFavoriteHistoryState.checkpoint = checkpoint;
      }
    } } catch {
      // A failed read must not overwrite an existing checkpoint with an empty one.
      ctFavoriteHistoryState.error = 'checkpoint';
      ctFavoriteHistoryState.warning = 'checkpoint';
    }
    if (previousRun) ctStopFavoriteHistory('account-changed');
  }
  function ctFavoriteHistoryStatus() {
    ctFavoriteHistoryBind();
    const checkpoint = ctFavoriteHistoryState.checkpoint || ctFavoriteHistoryEmpty();
    const done = checkpoint.sources['for-you'].done && checkpoint.sources.following.done;
    return {
      source: checkpoint.sources['for-you'].done ? 'following' : 'for-you',
      pages: checkpoint.pages, scanned: checkpoint.scanned, recovered: checkpoint.recovered,
      busy: !!ctFavoriteHistoryState.run, paused: ctFavoriteHistoryState.paused,
      pausedReason: ctFavoriteHistoryState.pausedReason, error: ctFavoriteHistoryState.error,
      warning: ctFavoriteHistoryState.warning, done,
      canContinue: !!ctFavoriteHistoryState.uid && !done && !ctFavoriteHistoryState.run
    };
  }
  function ctFavoriteHistoryAssert(run) {
    if (run.cancelled || ctFavoriteHistoryState.run !== run || ctFavoriteHistoryState.sequence !== run.sequence) throw new Error('stopped');
    if (ctNetworkState.authUID !== run.uid || ctFavoriteHistoryState.uid !== run.uid) throw new Error('account-changed');
    if (!ctFavoriteHistoryActive()) throw new Error('background');
  }
  async function ctFavoriteHistoryAuth(run) {
    ctFavoriteHistoryAssert(run);
    const auth = await getAuth();
    ctFavoriteHistoryAssert(run);
    if (!auth?.token || auth.uid !== run.uid) throw new Error(auth?.uid ? 'account-changed' : 'sign-in');
    return auth;
  }
  async function ctFavoriteHistoryRequest(run, path) {
    ctFavoriteHistoryAssert(run);
    const previous = ctFavoriteHistoryState.lastRequestAt;
    const remaining = previous === null ? 0 : CT_FAVORITE_HISTORY_INTERVAL - (Date.now() - previous);
    if (remaining > 0) await new Promise(resolve => {
      run.wake = resolve;
      run.timer = setTimeout(() => { run.timer = null; run.wake = null; resolve(); }, remaining);
    });
    const auth = await ctFavoriteHistoryAuth(run);
    ctFavoriteHistoryState.lastRequestAt = Date.now();
    let json;
    try { json = await requestJSON(API_ORIGIN + path, { Authorization: `Bearer ${auth.token}` }); }
    catch { ctFavoriteHistoryAssert(run); throw new Error('network'); }
    // Cancellation or backgrounding invalidates the response before any write.
    ctFavoriteHistoryAssert(run);
    await ctFavoriteHistoryAuth(run);
    return json;
  }
  function ctFavoriteHistoryPost(post) {
    return post && typeof post === 'object' && !Array.isArray(post) && ctProfileId(post.id) &&
      ctProfileHandle(post.authorUsername) && typeof post.text === 'string' && post.text.length <= 10000 &&
      post.hasLiked === true && !post.isDeleted && post.status !== 'MUTED';
  }
  function ctFavoriteHistoryPage(json, source) {
    if (!json || json.success !== true || json.error || !Array.isArray(json.posts) || json.posts.length > 20 ||
        !Object.prototype.hasOwnProperty.call(json, 'nextCursor') || !ctFavoriteHistoryCursor(json.nextCursor) ||
        json.posts.some(post => !post || typeof post !== 'object' || Array.isArray(post) || !ctProfileId(post.id) ||
          typeof post.hasLiked !== 'boolean' || (post.hasLiked === true && !post.isDeleted && post.status !== 'MUTED' &&
            (!ctProfileHandle(post.authorUsername) || typeof post.text !== 'string' || post.text.length > 10000)))) throw new Error('response');
    if (json.nextCursor !== null && (json.nextCursor === source.cursor || source.seen.includes(json.nextCursor))) throw new Error('cursor');
    return json.posts;
  }
  function ctFavoriteHistorySave(uid, checkpoint) {
    if (ctNetworkState.authUID !== uid || ctFavoriteHistoryState.uid !== uid) throw new Error('account-changed');
    try { localStorage.setItem(ctFavoriteHistoryKey(uid), JSON.stringify(checkpoint)); }
    catch { ctFavoriteHistoryState.warning = 'storage'; throw new Error('storage'); }
  }
  function ctStopFavoriteHistory(reason = 'stopped') {
    const run = ctFavoriteHistoryState.run;
    if (run) {
      run.cancelled = true;
      ctFavoriteHistoryState.sequence++;
      if (run.timer !== null) { clearTimeout(run.timer); run.timer = null; }
      const wake = run.wake;
      run.wake = null;
      if (wake) wake();
      ctFavoriteHistoryState.paused = true;
      ctFavoriteHistoryState.pausedReason = reason;
      ctFavoriteHistoryEmit();
    }
    return ctFavoriteHistoryStatus();
  }
  async function ctRunFavoriteHistory() {
    ctFavoriteHistoryBind();
    if (ctFavoriteHistoryState.run) return ctFavoriteHistoryStatus();
    if (!ctFavoriteHistoryState.uid) {
      const auth = await getAuth();
      ctFavoriteHistoryBind();
      if (!auth?.token || !ctFavoriteHistoryState.uid || auth.uid !== ctFavoriteHistoryState.uid) {
        ctFavoriteHistoryState.error = 'sign-in'; ctFavoriteHistoryEmit(); return ctFavoriteHistoryStatus();
      }
    }
    if (ctFavoriteHistoryState.run) return ctFavoriteHistoryStatus();
    if (ctFavoriteHistoryState.error === 'checkpoint') return ctFavoriteHistoryStatus();
    if (!ctFavoriteHistoryActive()) {
      ctFavoriteHistoryState.paused = true; ctFavoriteHistoryState.pausedReason = 'background';
      ctFavoriteHistoryEmit(); return ctFavoriteHistoryStatus();
    }
    if (ctFavoriteHistoryStatus().done) return ctFavoriteHistoryStatus();
    const run = { uid: ctFavoriteHistoryState.uid, sequence: ++ctFavoriteHistoryState.sequence,
      cancelled: false, timer: null, wake: null, seen: new Set() };
    ctFavoriteHistoryState.run = run;
    ctFavoriteHistoryState.error = ''; ctFavoriteHistoryState.warning = '';
    ctFavoriteHistoryState.paused = false; ctFavoriteHistoryState.pausedReason = '';
    ctFavoriteHistoryEmit();
    try {
      for (let page = 0; page < CT_FAVORITE_HISTORY_PAGES; page++) {
        ctFavoriteHistoryAssert(run);
        const before = ctFavoriteHistoryState.checkpoint;
        const name = before.sources['for-you'].done ? 'following' : 'for-you';
        if (before.sources[name].done) break;
        const source = before.sources[name];
        const query = new URLSearchParams({ limit: '20' });
        if (name === 'following') query.set('scope', 'following');
        if (source.cursor !== null) query.set('cursor', source.cursor);
        const json = await ctFavoriteHistoryRequest(run, '/api/posts?' + query);
        const posts = ctFavoriteHistoryPage(json, source);
        const confirmed = [];
        const pageIds = new Set();
        for (const candidate of posts) {
          if (!ctFavoriteHistoryPost(candidate)) continue;
          if ((candidate.isRepost || candidate.repostedBy) && !candidate.originalPostId) continue;
          const id = candidate.originalPostId ?? candidate.id;
          if (!ctProfileId(id)) throw new Error('response');
          if (run.seen.has(id) || pageIds.has(id)) continue;
          pageIds.add(id);
          const detail = await ctFavoriteHistoryRequest(run, '/api/posts/' + encodeURIComponent(id));
          // The shared transport returns null for network/HTTP failures. It
          // cannot distinguish an inaccessible post from a transient outage;
          // preserve this page's cursor so a retry can check it again.
          if (!detail) throw new Error('network');
          if (detail.success !== true || detail.error || !detail.post || typeof detail.post !== 'object' ||
              Array.isArray(detail.post) || !ctProfileId(detail.post.id) || typeof detail.post.hasLiked !== 'boolean') throw new Error('response');
          // Deleted, inaccessible or already-unliked details are not Favorites.
          if (!ctFavoriteHistoryPost(detail.post) ||
              detail.post.id !== id || detail.post.isRepost || detail.post.originalPostId || detail.post.repostedBy ||
              (!candidate.originalPostId && ctProfileHandle(detail.post.authorUsername) !== ctProfileHandle(candidate.authorUsername))) continue;
          confirmed.push(detail.post);
        }
        await ctFavoriteHistoryAuth(run);
        ctFavoriteHistoryAssert(run);
        const recovered = ctProfileRememberLikedPosts(confirmed, run.uid);
        // A previous account's storage warning is global UI state. Only this
        // account's unpersisted Favorites can block its feed checkpoint.
        if (!Number.isSafeInteger(recovered) || recovered < 0 || ctProfileState.dirtyMemory?.has(run.uid)) {
          ctFavoriteHistoryState.warning = 'storage'; throw new Error('storage');
        }
        // The source advances only after Favorites were stored. On failure or
        // cancellation the current page can safely be retried without eviction.
        const next = ctFavoriteHistoryCheckpoint(before);
        next.pages++; next.scanned += posts.length; next.recovered += recovered;
        next.sources[name].cursor = json.nextCursor;
        next.sources[name].done = json.nextCursor === null;
        if (json.nextCursor !== null) next.sources[name].seen.push(json.nextCursor);
        ctFavoriteHistorySave(run.uid, next);
        ctFavoriteHistoryState.checkpoint = next;
        for (const post of confirmed) run.seen.add(post.id);
        ctFavoriteHistoryEmit();
        if (next.sources['for-you'].done && next.sources.following.done) break;
        if (page === CT_FAVORITE_HISTORY_PAGES - 1) {
          ctFavoriteHistoryState.paused = true; ctFavoriteHistoryState.pausedReason = 'limit';
        }
      }
    } catch (error) {
      if (ctFavoriteHistoryState.uid === run.uid) {
        const code = error?.message;
        if (!run.cancelled && ['background', 'account-changed'].includes(code)) {
          ctFavoriteHistoryState.paused = true; ctFavoriteHistoryState.pausedReason = code;
        } else if (!run.cancelled && code !== 'stopped') {
          ctFavoriteHistoryState.error = ['sign-in', 'account-changed', 'response', 'cursor', 'storage'].includes(code) ? code : 'network';
          ctFavoriteHistoryState.paused = true;
        }
      }
    } finally {
      if (run.timer !== null) clearTimeout(run.timer);
      if (ctFavoriteHistoryState.run === run) ctFavoriteHistoryState.run = null;
      ctFavoriteHistoryEmit();
    }
    return ctFavoriteHistoryStatus();
  }
  function ctRestartFavoriteHistory() {
    ctFavoriteHistoryBind();
    // An in-flight read must finish cancellation before another scan starts.
    if (ctFavoriteHistoryState.run) return ctStopFavoriteHistory();
    if (!ctFavoriteHistoryState.uid) return ctRunFavoriteHistory();
    const checkpoint = ctFavoriteHistoryEmpty();
    try {
      ctFavoriteHistorySave(ctFavoriteHistoryState.uid, checkpoint);
      ctFavoriteHistoryState.checkpoint = checkpoint;
      ctFavoriteHistoryState.error = ''; ctFavoriteHistoryState.warning = '';
      ctFavoriteHistoryState.paused = false; ctFavoriteHistoryState.pausedReason = '';
    } catch {
      ctFavoriteHistoryState.error = 'storage'; ctFavoriteHistoryEmit(); return ctFavoriteHistoryStatus();
    }
    return ctRunFavoriteHistory();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctStopFavoriteHistory('background'); });
  window.addEventListener('pagehide', () => ctStopFavoriteHistory('background'));
