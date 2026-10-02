  // Inline replies have no creation ISO in the DOM. Verify a unique original
  // author/body/age match against one complete native parent-replies GET before
  // supplying a clock source. One opened container gets one bounded request;
  // minute-by-minute clock updates never fetch replies again.
  const ctReplyTimeBindings = new WeakMap();
  const ctReplyTimeContainers = new WeakMap();
  const ctReplyTimePending = new Set();

  function ctReplyTimeUID() {
    const uid = typeof ctNetworkState !== 'undefined' ? ctNetworkState.authUID : null;
    return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(uid) ? uid : null;
  }

  function ctReplyTimeActive() {
    return !document.hidden && (typeof ctPageActive === 'undefined' || ctPageActive);
  }

  function ctReplyTimeVisible(article) {
    if (!article?.isConnected || article.closest('[aria-hidden="true"],[hidden],[data-ct-owned],[data-ct-local-ui]')) return false;
    const bounds = article.getBoundingClientRect();
    return bounds.height > 0 && bounds.width > 0 && bounds.bottom > 0 && bounds.top < innerHeight;
  }

  function ctReplyTimeContext(el) {
    if (!el?.matches('span.text-tl-app-text-muted.shrink-0:not([title])') || el.closest('button,a,[role="button"],blockquote,[aria-label^="Quoted post"]')) return null;
    const article = el.closest('article');
    const inline = article?.closest('[id^="inline-replies-"]');
    const inlineId = inline?.id.match(/^inline-replies-([A-Za-z0-9_-]{1,160})$/)?.[1];
    const panel = !inline && article ? ctTimestampDetailContext(article) : null;
    const container = inline || panel?.querySelector(':scope > div.min-h-0.flex-1.overflow-y-auto');
    const parentId = inlineId || (panel ? location.pathname.match(/^\/(?:post|posts)\/([A-Za-z0-9_-]{1,160})\/?$/)?.[1] : null);
    return article && container && parentId ? { article, container, panel, inline: !!inline, parentId } : null;
  }

  function ctReplyTimeCanCheck(el, context) {
    const record = ctReplyTimeContainers.get(context.container);
    if (!record || record.uid !== ctReplyTimeUID() || record.path !== location.pathname + location.search || record.parentId !== context.parentId) return true;
    // A complete response is only for the original nodes and each gets one
    // identity attempt. An edited unknown node cannot later inherit cached data.
    return record.elements.has(el) && !record.usedElements.has(el) &&
      (!!record.pending || !!record.posts && Date.now() - record.at < 60000);
  }

  function ctReplyTimeCandidate(el, context) {
    if (!context) return null;
    const { article, container, panel, inline, parentId } = context;
    const header = el.parentElement;
    const author = header?.querySelector(':scope > button.font-bold.truncate');
    const separator = el.previousElementSibling;
    const body = header?.nextElementSibling;
    if (!article || !parentId || !ctReplyTimeAgeKey(el.textContent) || !header?.matches('div.flex.items-center.gap-1.min-w-0') ||
        !author || !separator?.matches('span.text-tl-app-text-muted') || separator.textContent.trim() !== '·' ||
        !header.querySelector('button > svg.lucide-ellipsis-vertical') ||
        !body?.matches('p.whitespace-pre-wrap.break-words') || body.closest('article') !== article ||
        [...article.querySelectorAll('button')].some(button => button.closest('article') === article &&
          /^(?:Show original|原文を表示)$/i.test(button.textContent.trim()))) return null;
    const native = ctFavoriteCandidate(article);
    if (!native || native.translated || native.parentId && native.parentId !== parentId ||
        typeof native.username !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(native.username) ||
        typeof native.text !== 'string' || native.text !== body.textContent) return null;
    return { el, article, container, panel, inline, parentId, body, author, username: native.username.toLowerCase(),
      text: body.textContent, authorLabel: author.getAttribute('aria-label') || '', authorText: author.textContent,
      initialText: el.textContent, observedAt: Date.now(), uid: ctReplyTimeUID(), path: location.pathname + location.search };
  }

  function ctReplyTimeSame(candidate, checkText = true) {
    if (!ctReplyTimeActive() || !candidate.el.isConnected || candidate.uid !== ctReplyTimeUID() ||
        candidate.path !== location.pathname + location.search || candidate.el.closest('article') !== candidate.article ||
        candidate.el.closest('button,a,[role="button"],blockquote,[aria-label^="Quoted post"],[data-ct-owned],[data-ct-local-ui]') ||
        (candidate.inline ? candidate.article.closest('[id^="inline-replies-"]') !== candidate.container ||
          candidate.container.id !== 'inline-replies-' + candidate.parentId :
          ctTimestampDetailContext(candidate.article) !== candidate.panel ||
          candidate.panel?.querySelector(':scope > div.min-h-0.flex-1.overflow-y-auto') !== candidate.container) ||
        candidate.el.parentElement?.nextElementSibling !== candidate.body ||
        candidate.body.textContent !== candidate.text || !candidate.author.isConnected ||
        (candidate.author.getAttribute('aria-label') || '') !== candidate.authorLabel ||
        candidate.author.textContent !== candidate.authorText ||
        [...candidate.article.querySelectorAll('button')].some(button => button.closest('article') === candidate.article &&
          /^(?:Show original|原文を表示)$/i.test(button.textContent.trim()))) return false;
    const expectedText = candidate.lastOwnText ?? candidate.initialText;
    if (checkText && candidate.el.textContent !== expectedText &&
        (!ctReplyTimeAgeKey(expectedText) || ctReplyTimeAgeKey(candidate.el.textContent) !== ctReplyTimeAgeKey(expectedText))) return false;
    return candidate.el.matches('span.text-tl-app-text-muted.shrink-0:not([title])') &&
      candidate.author.closest('article') === candidate.article &&
      (articleAuthor(candidate.article) || '').toLowerCase() === candidate.username;
  }

  function ctReplyTimeAgeKey(text) {
    const value = text.trim();
    const short = /^(\d+)([mhd])$/.exec(value);
    const japanese = /^(\d+)(分|時間|日)前$/.exec(value);
    const match = short || japanese;
    if (match) return `${Number(match[1])}:${({ m: 'm', h: 'h', d: 'd', 分: 'm', 時間: 'h', 日: 'd' })[match[2]]}`;
    return /^(?:Just now|たった今|今)$/.test(value) ? 'now' : '';
  }

  function ctReplyTimeSource(el) {
    // Hidden-tab clock suspension does not discard an already verified date.
    if (!ctReplyTimeActive()) return '';
    const binding = ctReplyTimeBindings.get(el);
    if (!binding || !ctReplyTimeSame(binding)) {
      if (binding) ctReplyTimeBindings.delete(el);
      return '';
    }
    return binding.createdAt;
  }

  function ctReplyTimeRendered(el, text) {
    const binding = ctReplyTimeBindings.get(el);
    if (binding && el.textContent === text && ctReplyTimeSame(binding, false)) binding.lastOwnText = text;
  }

  function ctReplyTimeCompletePosts(json, parentId) {
    if (!json || json.success === false || json.error || !Array.isArray(json.replies) ||
        json.replies.length > 50 || json.nextCursor !== null) return null;
    const ids = new Set();
    for (const post of json.replies) {
      if (!post || typeof post !== 'object' || Array.isArray(post) ||
          typeof post.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(post.id) || ids.has(post.id) ||
          typeof post.authorUsername !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(post.authorUsername) ||
          typeof post.text !== 'string' || !ctTimestampPostValue(post) ||
          (post.parentId != null && post.parentId !== parentId)) return null;
      ids.add(post.id);
    }
    return json.replies;
  }

  function ctReplyTimeBind(candidate, posts) {
    if (!ctReplyTimeSame(candidate) || !ctReplyTimeVisible(candidate.article)) return false;
    const matches = posts.filter(post => !post.isDeleted && post.status !== 'MUTED' && !post.isRepost && !post.originalPostId &&
      post.authorUsername.toLowerCase() === candidate.username && post.text === candidate.text &&
      ctFavoriteRelativeTimeMatches(candidate.initialText, ctTimestampPostValue(post), candidate.observedAt));
    if (matches.length !== 1) return false;
    ctReplyTimeBindings.set(candidate.el, { ...candidate, id: matches[0].id, createdAt: ctTimestampPostValue(matches[0]) });
    return true;
  }

  async function ctReplyTimeLoad(container, candidates) {
    const first = candidates[0];
    let record = ctReplyTimeContainers.get(container);
    if (!record || record.uid !== first.uid || record.path !== first.path || record.parentId !== first.parentId) {
      if (ctReplyTimePending.size >= 4) return;
      // A node inserted after this complete response could be a newly added
      // duplicate body. Do not assign it an older reply from the short cache.
      const elements = new Set([...container.querySelectorAll('span.text-tl-app-text-muted.shrink-0:not([title])')].slice(0, 50));
      record = { uid: first.uid, path: first.path, parentId: first.parentId, at: Date.now(), posts: null, pending: null, elements, usedElements: new WeakSet() };
      ctReplyTimeContainers.set(container, record);
      ctReplyTimePending.add(record);
      record.pending = (async () => {
        const auth = await getAuth();
        if (!auth?.token || auth.uid !== record.uid || !ctReplyTimeSame(first) || ctReplyTimeContainers.get(container) !== record) return;
        const json = await requestJSON(API_ORIGIN + '/api/posts/' + encodeURIComponent(record.parentId) + '/replies?limit=50',
          { Authorization: `Bearer ${auth.token}` });
        const current = await getAuth();
        if (current?.uid !== record.uid || !ctReplyTimeSame(first) || ctReplyTimeContainers.get(container) !== record || Date.now() - record.at >= 60000) return;
        record.posts = ctReplyTimeCompletePosts(json, record.parentId);
      })().catch(() => {}).finally(() => { record.pending = null; ctReplyTimePending.delete(record); });
    }
    if (record.pending) await record.pending;
    if (!record.posts || Date.now() - record.at >= 60000 || ctReplyTimeContainers.get(container) !== record) return;
    let changed = false;
    for (const candidate of candidates) if (record.elements.has(candidate.el) && !record.usedElements.has(candidate.el) && ctReplyTimeVisible(candidate.article)) {
      record.usedElements.add(candidate.el);
      if (ctReplyTimeBind(candidate, record.posts)) changed = true;
    }
    if (changed && typeof ctScheduleScan === 'function') ctScheduleScan();
  }

  function ctReplyTimesEnhance(root = document) {
    if (!ctReplyTimeActive() || !ctReplyTimeUID()) return Promise.resolve();
    const scope = root?.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const elements = new Set();
    if (scope?.matches?.('span.text-tl-app-text-muted.shrink-0:not([title])')) elements.add(scope);
    scope?.querySelectorAll?.('span.text-tl-app-text-muted.shrink-0:not([title])').forEach(el => elements.add(el));
    const groups = new Map(); let count = 0;
    for (const el of elements) {
      if (count >= 20) break;
      if (ctReplyTimeSource(el)) continue;
      const context = ctReplyTimeContext(el);
      if (!context || !ctReplyTimeCanCheck(el, context)) continue;
      const candidate = ctReplyTimeCandidate(el, context);
      if (!candidate || !ctReplyTimeVisible(candidate.article)) continue;
      if (!groups.has(candidate.container)) {
        if (groups.size >= 4) continue;
        groups.set(candidate.container, []);
      }
      groups.get(candidate.container).push(candidate); count++;
    }
    return Promise.all([...groups].map(([container, candidates]) => ctReplyTimeLoad(container, candidates)));
  }
