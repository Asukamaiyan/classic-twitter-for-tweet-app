  // Native feed cards have no permalink. Resolve only an exact author/time/body
  // match through the author's established read-only posts route, never a quote
  // link, text search, React internals or an extra engagement request.
  const ctFavoriteCaptures = new WeakMap();
  const ctFavoritePostCache = new Map();
  const ctFavoriteStateWatchers = new WeakMap();

  function ctWatchFavoriteRollback(button, snapshot, uid, generation, liked) {
    let currentLiked = liked;
    const stop = () => { observer.disconnect(); clearTimeout(timer); ctFavoriteStateWatchers.delete(button); };
    const observer = new MutationObserver(() => {
      if (!button.isConnected || ctNetworkState.authUID !== uid || ctFavoriteCaptures.get(button) !== generation) { stop(); return; }
      const next = ctIsLiked(button);
      if (next === currentLiked) return;
      currentLiked = next;
      if (next) saveFavorite(snapshot, uid);
      else removeFavorite(snapshot.id, uid);
    });
    observer.observe(button, {attributes:true, attributeFilter:['aria-pressed','class','aria-label']});
    // The native client toggles optimistically and can roll back a slow failure.
    // Observe this single button briefly, without polling or retaining cards.
    const timer = setTimeout(stop, 30000);
    ctFavoriteStateWatchers.set(button, stop);
  }

  function ctFavoriteDOMMedia(article) {
    return [...article.querySelectorAll('img[alt="Attached media"],video[src]')].filter(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-ct-owned],[data-ct-local-ui]'))
      .slice(0, 16).map(el => ({type: el.tagName === 'VIDEO' ? 'video' : 'image',
        url: ctProfileURL(el.src), poster: el.tagName === 'VIDEO' ? ctProfileURL(el.poster) : ''})).filter(asset => asset.url);
  }

  function ctFavoriteCandidate(article) {
    const timestamp = [...article.querySelectorAll('span.text-tl-app-text-muted.hover\\:underline[title]')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote') &&
      /^\d{4}-\d{2}-\d{2}T/.test(el.title) && Number.isFinite(Date.parse(el.title)));
    const known = snapshotFavorite(article);
    if (known) return { ...known, createdAt: timestamp?.title || '', media: ctFavoriteDOMMedia(article) };
    const username = validUser(articleAuthor(article));
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[aria-live]'));
    if (!username || !body || !timestamp) return null;
    const author = [...article.querySelectorAll('button.truncate.font-bold')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote'));
    return { username, name: author?.textContent || username, text: body.textContent,
      avatar: articleAvatar(article), createdAt: timestamp.title, savedAt: Date.now() };
  }

  async function ctFavoriteAuthorPosts(username, auth) {
    const key = auth.uid + ':' + username.toLowerCase();
    const previous = ctFavoritePostCache.get(key);
    if (previous?.pending) return previous.pending;
    if (previous && Date.now() - previous.at < 60000) return previous.posts;
    const record = { at: Date.now(), posts: [], pending: null };
    record.pending = (async () => {
      let cursor = null;
      for (let page = 0; page < 3; page++) {
        const query = new URLSearchParams({ limit: '50' });
        if (cursor) query.set('cursor', cursor);
        const json = await requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(username) + '/posts?' + query,
          { Authorization: `Bearer ${auth.token}` });
        if (!json || json.success === false || json.error || !Array.isArray(json.posts)) break;
        record.posts.push(...json.posts);
        const next = typeof json.nextCursor === 'string' && json.nextCursor.length <= 2000 ? json.nextCursor : null;
        if (!next || next === cursor) break;
        cursor = next;
      }
      return record.posts;
    })();
    ctFavoritePostCache.set(key, record);
    while (ctFavoritePostCache.size > 40) ctFavoritePostCache.delete(ctFavoritePostCache.keys().next().value);
    try { return await record.pending; }
    finally { record.pending = null; record.at = Date.now(); }
  }

  async function ctResolveFavorite(candidate, uid) {
    if (!candidate || !uid) return null;
    const auth = await getAuth();
    if (!auth?.token || auth.uid !== uid) return null;
    if (candidate.id) return candidate;
    const posts = await ctFavoriteAuthorPosts(candidate.username, auth);
    const current = await getAuth();
    if (current?.uid !== uid) return null;
    const matches = posts.filter(post => typeof post.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(post.id) &&
      !post.isDeleted && !post.originalPostId && !post.isRepost &&
      post.authorUsername?.toLowerCase() === candidate.username.toLowerCase() &&
      Date.parse(post.createdAt ?? post.created_at) === Date.parse(candidate.createdAt) &&
      typeof post.text === 'string' && post.text === candidate.text);
    const unique = [...new Map(matches.map(post => [post.id, post])).values()];
    if (unique.length !== 1) return null;
    return { ...candidate, id: unique[0].id, href: location.origin + '/post/' + encodeURIComponent(unique[0].id),
      avatar: ctProfileURL(unique[0].authorAvatar) || candidate.avatar,
      media: ctProfileMediaAssets(unique[0]) };
  }

  function ctCaptureFavoriteClick(event) {
    const button = event.target.closest?.('button[data-testid="tweet-like-action"]');
    const article = button?.closest('article');
    if (!article || article.closest('[data-ct-owned],[data-ct-local-ui]')) return;
    ctFavoriteStateWatchers.get(button)?.();
    const candidate = ctFavoriteCandidate(article);
    const uid = ctNetworkState.authUID;
    if (!candidate || !uid) return;
    const wasLiked = ctIsLiked(button);
    const generation = (ctFavoriteCaptures.get(button) || 0) + 1;
    ctFavoriteCaptures.set(button, generation);
    setTimeout(async () => {
      try {
        if (ctFavoriteCaptures.get(button) !== generation || !button.isConnected || ctNetworkState.authUID !== uid) return;
        const liked = ctIsLiked(button);
        if (liked === wasLiked) return;
        const snapshot = await ctResolveFavorite(candidate, uid);
        if (!snapshot || ctFavoriteCaptures.get(button) !== generation || !button.isConnected ||
            ctNetworkState.authUID !== uid || ctIsLiked(button) !== liked) return;
        if (liked) saveFavorite(snapshot, uid);
        else removeFavorite(snapshot.id, uid);
        ctWatchFavoriteRollback(button, snapshot, uid, generation, liked);
        if (favoritesActive) renderFavoritesPanel();
      } catch { /* Native favorite actions remain available if a read fails. */ }
    }, 450);
  }
