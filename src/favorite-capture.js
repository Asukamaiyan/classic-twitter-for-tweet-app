  // Native feed cards have no permalink. Resolve only an exact author/time/body
  // match through the author's established read-only posts route, never a quote
  // link, text search, React internals or an extra engagement request.
  const ctFavoriteCaptures = new WeakMap();
  const ctFavoritePostCache = new Map();
  const ctFavoriteStateWatchers = new WeakMap();
  let ctFavoriteRestoreBusy = false;

  function ctFavoriteReplyParent(article) {
    const container = article.closest('[id^="inline-replies-"]');
    const inline = container?.id.match(/^inline-replies-([A-Za-z0-9_-]{1,160})$/)?.[1];
    return inline || null;
  }

  function ctFavoriteRelativeTimeMatches(text, createdAt, observedAt) {
    const created = Date.parse(createdAt);
    if (!Number.isFinite(created)) return false;
    const value = text.trim();
    const short = /^(\d+)([mhd])$/.exec(value);
    const japanese = /^(\d+)(分|時間|日)前$/.exec(value);
    const units = {m:60000,h:3600000,d:86400000,'分':60000,'時間':3600000,'日':86400000};
    const match = short || japanese;
    if (match) {
      const unit = units[match[2]], age = observedAt - created;
      // The card may have been rendered shortly before the click. Allow two
      // minutes of render age, while still requiring one unique author/body ID.
      return age >= Number(match[1]) * unit && age < (Number(match[1]) + 1) * unit + 120000;
    }
    if (/^(Just now|たった今|今)$/.test(value)) return observedAt - created >= 0 && observedAt - created < 180000;
    // A month/day label carries no year and cannot identify an older reply.
    return false;
  }

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
    const replyTime = [...article.querySelectorAll('span.text-tl-app-text-muted.shrink-0')].find(el =>
      el.closest('article') === article && el.previousElementSibling?.textContent.trim() === '·' &&
      el.parentElement.querySelector(':scope > button.font-bold.truncate') &&
      el.parentElement.querySelector('button > svg.lucide-ellipsis-vertical'));
    const parentId = ctFavoriteReplyParent(article);
    if (!username || !body || (!timestamp && !replyTime)) return null;
    const translated = [...article.querySelectorAll('button')].some(el => el.closest('article') === article &&
      /^(Show original|原文を表示)$/i.test(el.textContent.trim()));
    // A translated reply has no exact ISO time or original body in the DOM.
    // Do not infer its identity from the translated text.
    if (!timestamp && translated) return null;
    const author = [...article.querySelectorAll('button.truncate.font-bold')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote'));
    return { username, name: author?.textContent || username, text: body.textContent,
      avatar: articleAvatar(article), createdAt: timestamp?.title || '', savedAt: Date.now(),
      relativeText: replyTime?.textContent || '', observedAt: Date.now(), parentId, translated };
  }

  async function ctFavoriteAuthorPosts(username, auth, deadline = Infinity) {
    const key = auth.uid + ':' + username.toLowerCase();
    const previous = ctFavoritePostCache.get(key);
    if (previous?.pending) return previous.pending;
    if (previous && Date.now() - previous.at < 60000) return previous.posts;
    const record = { at: Date.now(), posts: [], pending: null };
    record.pending = (async () => {
      let cursor = null;
      for (let page = 0; page < 3; page++) {
        if (Date.now() >= deadline) { record.expired = true; break; }
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
    finally {
      record.pending = null; record.at = Date.now();
      if (record.expired && ctFavoritePostCache.get(key) === record) ctFavoritePostCache.delete(key);
    }
  }

  async function ctFavoriteReplyPosts(candidate, auth, deadline = Infinity) {
    const base = candidate.parentId ? '/api/posts/' + encodeURIComponent(candidate.parentId) + '/replies' :
      '/api/users/' + encodeURIComponent(candidate.username) + '/replies';
    // Relative-time identities must use fresh, complete responses. Reusing an
    // old list could mistake a newly added duplicate reply for an earlier one.
    const posts = [];
    let cursor = null;
    for (let page = 0; page < (candidate.parentId ? 3 : 1); page++) {
      if (Date.now() >= deadline) return null;
      const query = new URLSearchParams({limit:'50'});
      if (cursor) query.set('cursor',cursor);
      const json = await requestJSON(API_ORIGIN + base + (candidate.parentId ? '?' + query : ''),
        {Authorization:`Bearer ${auth.token}`});
      if (!json || json.success === false || json.error || !Array.isArray(json.replies) || json.replies.length > 1000) return null;
      posts.push(...json.replies.map(row => candidate.parentId ? row : row?.post).filter(Boolean));
      const next = json.nextCursor ?? null;
      if (next === null) return posts;
      if (!candidate.parentId || typeof next !== 'string' || !next || next.length > 2000 || next === cursor) return null;
      cursor = next;
    }
    return null;
  }

  async function ctResolveFavorite(candidate, uid, deadline = Infinity) {
    if (!candidate || !uid) return null;
    const auth = await getAuth();
    if (!auth?.token || auth.uid !== uid) return null;
    if (candidate.id) return candidate;
    const posts = candidate.relativeText && !candidate.createdAt ? await ctFavoriteReplyPosts(candidate, auth, deadline) :
      await ctFavoriteAuthorPosts(candidate.username, auth, deadline);
    const current = await getAuth();
    if (current?.uid !== uid || !Array.isArray(posts)) return null;
    const matches = posts.filter(post => typeof post.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(post.id) &&
      !post.isDeleted && !post.originalPostId && !post.isRepost &&
      post.status !== 'MUTED' &&
      post.authorUsername?.toLowerCase() === candidate.username.toLowerCase() &&
      (candidate.createdAt ? Date.parse(post.createdAt ?? post.created_at) === Date.parse(candidate.createdAt) :
        ctFavoriteRelativeTimeMatches(candidate.relativeText, post.createdAt ?? post.created_at, candidate.observedAt)) &&
      typeof post.text === 'string' && (candidate.translated || post.text === candidate.text));
    const unique = [...new Map(matches.map(post => [post.id, post])).values()];
    if (unique.length !== 1) return null;
    return { ...candidate, id: unique[0].id, text: unique[0].text, createdAt: unique[0].createdAt ?? unique[0].created_at,
      href: location.origin + '/post/' + encodeURIComponent(unique[0].id),
      avatar: ctProfileURL(unique[0].authorAvatar) || candidate.avatar,
      media: ctProfileMediaAssets(unique[0]) };
  }

  async function ctRestoreVisibleFavorites() {
    if (ctFavoriteRestoreBusy) return null;
    ctFavoriteRestoreBusy = true;
    let saved = 0, unresolved = 0;
    try {
      const auth = await getAuth();
      if (!auth?.token || !auth.uid) throw new Error('sign-in');
      const deadline = Date.now() + 45000;
      const cards = [...document.querySelectorAll('main article')].filter(article => {
        const button = article.querySelector('button[data-testid="tweet-like-action"]');
        return button && !article.closest('[data-ct-owned],[data-ct-local-ui],[aria-hidden="true"]') && ctIsLiked(button);
      }).slice(0,40);
      for (const [index, article] of cards.entries()) {
        if (Date.now() >= deadline) { unresolved += cards.length - index; break; }
        if (ctNetworkState.authUID !== auth.uid) throw new Error('account-changed');
        const button = article.querySelector('button[data-testid="tweet-like-action"]');
        const candidate = ctFavoriteCandidate(article);
        let snapshot = candidate && await ctResolveFavorite(candidate, auth.uid, deadline);
        if (snapshot && Date.now() < deadline) {
          // A loaded button may still be an optimistic Like. Recovery must
          // confirm current server state rather than retain a later rollback.
          const json = await requestJSON(API_ORIGIN + '/api/posts/' + encodeURIComponent(snapshot.id),
            {Authorization:`Bearer ${auth.token}`});
          const post = json?.post;
          if (!json || json.success === false || json.error || post?.id !== snapshot.id || post.hasLiked !== true ||
              post.isDeleted || post.status === 'MUTED' || post.isRepost || post.originalPostId ||
              post.authorUsername?.toLowerCase() !== snapshot.username.toLowerCase() || typeof post.text !== 'string') snapshot = null;
          else snapshot = {...snapshot,text:post.text,createdAt:post.createdAt ?? post.created_at,
            media:ctProfileMediaAssets(post),avatar:ctProfileURL(post.authorAvatar) || snapshot.avatar};
        } else snapshot = null;
        const current = await getAuth();
        if (current?.uid !== auth.uid) throw new Error('account-changed');
        if (ctNetworkState.authUID !== auth.uid) throw new Error('account-changed');
        if (snapshot && button.isConnected && ctIsLiked(button)) {
          if (saveFavorite(snapshot, auth.uid) !== false) saved++;
        } else unresolved++;
      }
      return {saved,unresolved};
    } finally { ctFavoriteRestoreBusy = false; }
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
