  // Native feed cards have no permalink. Resolve only an exact author/time/body
  // match through the author's established read-only posts route, never a quote
  // link, text search, React internals or an extra engagement request.
  const ctFavoriteCaptures = new WeakMap();
  const ctFavoriteInteractions = new WeakMap();
  const ctFavoriteOriginals = new WeakMap();
  const ctFavoritePostCache = new Map();
  const ctFavoriteStateWatchers = new WeakMap();
  let ctFavoriteRestoreBusy = false;

  function ctFavoriteReplyParent(article) {
    const container = article.closest('[id^="inline-replies-"]');
    const inline = container?.id.match(/^inline-replies-([A-Za-z0-9_-]{1,160})$/)?.[1];
    return inline || null;
  }

  function ctFavoriteRelativeTimeMatches(text, createdAt, observedAt) {
    const created = ctTimestampParse(createdAt)?.getTime();
    if (!Number.isFinite(created) || !Number.isFinite(observedAt)) return false;
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

  function ctWatchFavoriteRollback(button, snapshot, uid, generation, liked, sameIdentity = () => true) {
    let currentLiked = liked;
    const stop = () => { observer.disconnect(); clearTimeout(timer); ctFavoriteStateWatchers.delete(button); };
    const observer = new MutationObserver(() => {
      if (!button.isConnected || ctNetworkState.authUID !== uid || ctFavoriteCaptures.get(button) !== generation || !sameIdentity()) { stop(); return; }
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
    const nodes = [...article.querySelectorAll('img[alt="Attached media"],video[src]')];
    // Native v2.2.3 numbers each carousel image's alt. Reuse the verified
    // gallery structure rather than matching arbitrary avatars or body images.
    if (typeof ctMediaSlides === 'function') for (const grid of article.querySelectorAll('div.flex.snap-x.snap-mandatory.overflow-x-auto')) {
      for (const slide of ctMediaSlides(grid)) nodes.push(slide.firstElementChild);
    }
    // The current native legacy-image branch uses a different alt; accept only
    // its exact direct image container, never a similarly named user image.
    for (const image of article.querySelectorAll('img[alt="Post media"].w-full.object-cover.cursor-pointer')) {
      if (image.parentElement?.matches('div.mt-3.rounded-2xl.overflow-hidden.border') &&
          image.parentElement.children.length === 1) nodes.push(image);
    }
    return [...new Set(nodes)].filter(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],[data-user-content],.tl-user-text,[data-ct-owned],[data-ct-local-ui]'))
      .slice(0, 16).map(el => ({type: el.tagName === 'VIDEO' ? 'video' : 'image',
        url: ctProfileURL(el.src), poster: el.tagName === 'VIDEO' ? ctProfileURL(el.poster) : '',
        ...(el.tagName === 'VIDEO' && /^(Animated GIF|GIFアニメーション|アニメーションGIF)$/.test(el.getAttribute('aria-label') || '')
          ? {isGIF:true} : {})})).filter(asset => asset.url);
  }

  function ctFavoriteTranslationMetadataBlock(node) {
    return !!node?.matches('div.mt-0\\.5,div.mt-1') && node.children.length > 0 && node.children.length <= 2 &&
      [...node.children].every(el => el.matches('p.text-tl-app-text-muted') &&
        el.classList.contains('text-[0.8125rem]') && !el.children.length &&
        (!el.hasAttribute('role') || el.getAttribute('role') === 'alert'));
  }

  function ctFavoriteTranslationState(article) {
    // Tweet 2.6 renders an icon instead of the old text toggle. Restrict the
    // control to this post: a quoted/nested post's translation is independent.
    const controls = [...article.querySelectorAll('button')].filter(el => el.closest('article') === article &&
      !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],[data-ct-owned],[data-ct-local-ui],.tl-user-text,[data-user-content]'));
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')].find(el => el.closest('article') === article &&
      !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],[data-ct-owned],[data-ct-local-ui]'));
    const metadata = body?.previousElementSibling;
    const sourceLine = ctFavoriteTranslationMetadataBlock(metadata) &&
      [...metadata.children].some(el => !el.hasAttribute('role'));
    const native = controls.filter(el => el.hasAttribute('data-translate-mode'));
    if (native.length) {
      if (native.length !== 1) return 'unknown';
      const control = native[0], mode = control.getAttribute('data-translate-mode');
      if (!['idle', 'busy', 'active', 'original'].includes(mode)) return 'unknown';
      if (mode === 'busy' || control.getAttribute('aria-busy') === 'true') return 'busy';
      if (mode === 'active') return 'translated';
      if (control.getAttribute('aria-pressed') === 'true' || sourceLine) return 'unknown';
      return 'original';
    }
    if (sourceLine) return 'unknown';
    return controls.some(el => [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label')]
      .some(value => /^(?:Show original|原文を表示)$/i.test((value || '').trim()))) ? 'translated' : 'original';
  }

  function ctFavoriteCandidate(article, removing = false) {
    const translation = ctFavoriteTranslationState(article);
    if (!removing && (translation === 'busy' || translation === 'unknown')) return null;
    // Removing a known Favorite needs its identity, not the displayed body.
    // Uncertain native text must still resolve through a saved/API original.
    const translated = translation !== 'original';
    const timestamp = [...article.querySelectorAll('span.text-tl-app-text-muted.hover\\:underline[title]')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],div.mt-3.rounded-2xl.border') &&
      !!ctTimestampParse(el.title));
    // A translated reply has no exact ISO time or original body in the DOM.
    // Check this before a known permalink can bypass the original-text check.
    if (!timestamp && translated) return null;
    const known = snapshotFavorite(article);
    if (known) return { ...known, translated, createdAt: timestamp?.title || '', media: ctFavoriteDOMMedia(article) };
    const username = validUser(articleAuthor(article));
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[aria-live]'));
    const replyTime = [...article.querySelectorAll('span.text-tl-app-text-muted.shrink-0')].find(el =>
      el.closest('article') === article && el.previousElementSibling?.textContent.trim() === '·' &&
      el.parentElement.querySelector(':scope > button.font-bold.truncate') &&
      el.parentElement.querySelector('button > svg.lucide-ellipsis-vertical'));
    const parentId = ctFavoriteReplyParent(article);
    if (!username || !body || (!timestamp && !replyTime)) return null;
    const author = [...article.querySelectorAll('button.truncate.font-bold')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],div.mt-3.rounded-2xl.border'));
    return { username, name: author?.textContent || username, text: body.textContent,
      avatar: articleAvatar(article), createdAt: timestamp?.title || '', savedAt: Date.now(),
      relativeText: replyTime?.textContent || '', observedAt: Date.now(), parentId, translated };
  }

  function ctFavoriteSavedRemoval(candidate, uid) {
    if (!candidate?.id || !candidate.translated || !candidate.createdAt ||
        ctNetworkState.authUID !== uid || typeof loadFavorites !== 'function') return null;
    const created = ctTimestampParse(candidate.createdAt)?.getTime();
    const matches = loadFavorites().filter(item => item.id === candidate.id &&
      typeof item.username === 'string' && item.username.toLowerCase() === candidate.username?.toLowerCase() &&
      ctTimestampParse(item.createdAt)?.getTime() === created && typeof item.text === 'string');
    return matches.length === 1 ? matches[0] : null;
  }

  function ctFavoriteCaptureSame(article, candidate, snapshot) {
    const current = ctFavoriteCandidate(article, true);
    if (!current || (current.id || null) !== (candidate.id || null) ||
        current.username?.toLowerCase() !== candidate.username?.toLowerCase() ||
        (current.parentId || null) !== (candidate.parentId || null)) return false;
    if (candidate.createdAt) return ctTimestampParse(current.createdAt)?.getTime() === ctTimestampParse(candidate.createdAt)?.getTime();
    if (candidate.id) return true;
    return !current.translated && current.text === candidate.text &&
      ctFavoriteRelativeTimeMatches(current.relativeText, snapshot.createdAt, current.observedAt);
  }

  function ctFavoriteRememberedOriginal(button, article, uid) {
    const original = ctFavoriteOriginals.get(button);
    if (!original) return null;
    const created = ctTimestampParse(original.candidate.createdAt)?.getTime();
    if (!uid || original.uid !== uid || original.article !== article || !button.isConnected ||
        button.closest('article') !== article || original.path !== location.pathname + location.search ||
        !Number.isFinite(created) || ctTimestampParse(original.snapshot.createdAt)?.getTime() !== created ||
        typeof original.candidate.username !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(original.candidate.username) ||
        typeof original.snapshot.username !== 'string' || original.snapshot.username.toLowerCase() !== original.candidate.username.toLowerCase() ||
        typeof original.snapshot.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(original.snapshot.id) ||
        original.candidate.id && original.candidate.id !== original.snapshot.id ||
        !ctFavoriteCaptureSame(article, original.candidate, original.snapshot)) {
      ctFavoriteOriginals.delete(button); return null;
    }
    return original;
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
    if (!candidate || !uid || (candidate.createdAt && !ctTimestampParse(candidate.createdAt))) return null;
    const auth = await getAuth();
    if (!auth?.token || auth.uid !== uid) return null;
    if (candidate.id && !candidate.translated) return candidate;
    let posts;
    if (candidate.id) {
      // A permalink establishes the post ID, not that the visible paragraph is
      // its original. Read that exact post before storing a translated card.
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(candidate.id) || !candidate.createdAt ||
          typeof candidate.username !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(candidate.username) || Date.now() >= deadline) return null;
      const json = await requestJSON(API_ORIGIN + '/api/posts/' + encodeURIComponent(candidate.id),
        { Authorization: `Bearer ${auth.token}` });
      posts = json && json.success !== false && !json.error && json.post ? [json.post] : null;
    } else posts = candidate.relativeText && !candidate.createdAt ? await ctFavoriteReplyPosts(candidate, auth, deadline) :
      await ctFavoriteAuthorPosts(candidate.username, auth, deadline);
    const current = await getAuth();
    if (current?.uid !== uid || !Array.isArray(posts)) return null;
    const matches = posts.filter(post => typeof post.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(post.id) &&
      (!candidate.id || post.id === candidate.id) &&
      !post.isDeleted && !post.originalPostId && !post.isRepost &&
      !['MUTED','BLOCKED'].includes(post.status) &&
      post.authorUsername?.toLowerCase() === candidate.username.toLowerCase() &&
      (candidate.createdAt ? ctTimestampPostDate(post)?.getTime() === ctTimestampParse(candidate.createdAt)?.getTime() :
        ctFavoriteRelativeTimeMatches(candidate.relativeText, ctTimestampPostValue(post), candidate.observedAt)) &&
      typeof post.text === 'string' && (candidate.translated || post.text === candidate.text));
    const unique = [...new Map(matches.map(post => [post.id, post])).values()];
    if (unique.length !== 1) return null;
    return { ...candidate, id: unique[0].id, text: unique[0].text, createdAt: ctTimestampPostValue(unique[0]),
      href: location.origin + '/post/' + encodeURIComponent(unique[0].id),
      avatar: ctProfileURL(unique[0].authorAvatar) || candidate.avatar,
      media: ctProfileMediaAssets(unique[0]), ...(ctProfilePostEdited(unique[0]) ? {isEdited:true} : {}) };
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
        const interaction = ctFavoriteInteractions.get(button) || 0;
        const path = location.pathname + location.search;
        const candidate = ctFavoriteCandidate(article);
        let snapshot = candidate && await ctResolveFavorite(candidate, auth.uid, deadline);
        if (snapshot && Date.now() < deadline) {
          // A loaded button may still be an optimistic Like. Recovery must
          // confirm current server state rather than retain a later rollback.
          const json = await requestJSON(API_ORIGIN + '/api/posts/' + encodeURIComponent(snapshot.id),
            {Authorization:`Bearer ${auth.token}`});
          const post = json?.post;
          if (!json || json.success === false || json.error || post?.id !== snapshot.id || post.hasLiked !== true ||
              post.isDeleted || ['MUTED','BLOCKED'].includes(post.status) || post.isRepost || post.originalPostId ||
              post.authorUsername?.toLowerCase() !== snapshot.username.toLowerCase() || typeof post.text !== 'string') snapshot = null;
          else snapshot = {...snapshot,text:post.text,createdAt:ctTimestampPostValue(post),isEdited:ctProfilePostEdited(post),
            media:ctProfileMediaAssets(post),avatar:ctProfileURL(post.authorAvatar) || snapshot.avatar};
        } else snapshot = null;
        const current = await getAuth();
        if (current?.uid !== auth.uid) throw new Error('account-changed');
        if (ctNetworkState.authUID !== auth.uid) throw new Error('account-changed');
        // A pending recovery must not undo a later click, even if a rapid
        // unlike/like cycle or a reused row ends in the same pressed state.
        if (snapshot && button?.isConnected && button.closest('article') === article && ctIsLiked(button) &&
            article.querySelector('button[data-testid="tweet-like-action"]') === button &&
            location.pathname + location.search === path && (ctFavoriteInteractions.get(button) || 0) === interaction &&
            (!candidate.createdAt || ctTimestampParse(snapshot.createdAt)?.getTime() === ctTimestampParse(candidate.createdAt)?.getTime()) &&
            ctFavoriteCaptureSame(article, candidate, snapshot)) {
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
    // Invalidate older recovery work for every native click, including a
    // currently unidentifiable reply that cannot safely be captured itself.
    ctFavoriteInteractions.set(button, (ctFavoriteInteractions.get(button) || 0) + 1);
    const wasLiked = ctIsLiked(button);
    const uid = ctNetworkState.authUID;
    const original = ctFavoriteRememberedOriginal(button, article, uid);
    let candidate = ctFavoriteCandidate(article, wasLiked);
    let remembered = null;
    if (!candidate && original) {
      // A prior unlike removes the stored Favorite, but not the independently
      // verified original for this unchanged native button. An explicit re-like
      // can reuse it even after the short rollback observer has expired.
      candidate = ctFavoriteCandidate(article, true);
      remembered = original.snapshot;
    }
    if (!candidate || !uid) return;
    // Accepted capture work owns its separate generation; recovery interaction
    // tracking never supplies a new original or extends the rollback observer.
    const generation = (ctFavoriteCaptures.get(button) || 0) + 1;
    ctFavoriteCaptures.set(button, generation);
    ctFavoriteStateWatchers.get(button)?.();
    const path = location.pathname + location.search;
    setTimeout(async () => {
      try {
        if (ctFavoriteCaptures.get(button) !== generation || !button.isConnected || ctNetworkState.authUID !== uid) return;
        const liked = ctIsLiked(button);
        if (liked === wasLiked) return;
        const snapshot = remembered || (wasLiked && ctFavoriteSavedRemoval(candidate, uid)) || await ctResolveFavorite(candidate, uid);
        const sameIdentity = () => button.closest('article') === article && location.pathname + location.search === path &&
          ctFavoriteCaptureSame(article, candidate, snapshot);
        if (!snapshot || ctFavoriteCaptures.get(button) !== generation || !button.isConnected ||
            ctNetworkState.authUID !== uid || ctIsLiked(button) !== liked || !sameIdentity()) return;
        ctFavoriteOriginals.set(button, { article, candidate, snapshot, uid, path });
        if (liked) saveFavorite(snapshot, uid);
        else removeFavorite(snapshot.id, uid);
        ctWatchFavoriteRollback(button, snapshot, uid, generation, liked, sameIdentity);
        if (favoritesActive) renderFavoritesPanel();
      } catch { /* Native favorite actions remain available if a read fails. */ }
    }, 450);
  }
