  // Creation timestamps must carry their own timezone. Date.parse accepts
  // calendar rollovers and local-time strings, which cannot identify a post's
  // actual creation instant safely.
  function ctTimestampParse(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, fraction, zone] = match;
    const y = Number(year), m = Number(month), d = Number(day);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m < 1 || m > 12 || d < 1 || d > days[m - 1] ||
        Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
        (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return null;
    // Normalize fractional precision to the standard millisecond form before
    // parsing, including browsers that reject service timestamps with 6 digits.
    const milliseconds = fraction ? `.${fraction.padEnd(3, '0').slice(0, 3)}` : '.000';
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${milliseconds}${zone}`);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function ctTimestampPostValue(post) {
    if (!post || typeof post !== 'object' || Array.isArray(post)) return '';
    for (const value of [post.created_at, post.createdAt]) {
      if (ctTimestampParse(value)) return value;
    }
    return '';
  }

  function ctTimestampPostDate(post) {
    return ctTimestampParse(ctTimestampPostValue(post));
  }

  function ctTimestampExactText(value, locale = CT_LOCALE) {
    const date = value instanceof Date ? value : ctTimestampParse(value);
    if (!date || !Number.isFinite(date.getTime())) return '';
    const language = locale === 'ja' ? 'ja-JP' : 'en-US';
    const dateText = new Intl.DateTimeFormat(language, {
      year: 'numeric', month: locale === 'ja' ? 'long' : 'short', day: 'numeric'
    }).format(date);
    const timeText = new Intl.DateTimeFormat(language, {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
    return `${dateText} · ${timeText}`;
  }

  function ctTimestampNativeValue(el) {
    if (!el?.matches('span.text-tl-app-text-muted') || !el.closest('article') ||
        el.closest('button,a,[role="button"],blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"],[data-ct-quote],div.mt-3.rounded-2xl.border,.tl-user-text,[data-user-content],.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"],[contenteditable]') ||
        (typeof isOwnedLocalizationElement === 'function' && isOwnedLocalizationElement(el))) return '';
    for (let parent = el; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.style.display === 'none' ||
          (parent.classList.contains('hidden') && getComputedStyle(parent).display === 'none')) return '';
    }
    const header = el.parentElement;
    if (!header?.matches('div.flex.items-center.gap-1.min-w-0') ||
        !header.querySelector('button.font-bold.truncate') ||
        !el.previousElementSibling?.matches('span.text-tl-app-text-muted') ||
        el.previousElementSibling.textContent.trim() !== '·') return '';
    if (el.classList.contains('hover:underline') && el.hasAttribute('title')) {
      const value = el.getAttribute('title');
      return ctTimestampParse(value) ? value : '';
    }
    // Inline replies omit the ISO title. A separate read-only resolver may
    // provide the reply's own creation timestamp after unique API verification.
    if (el.classList.contains('shrink-0') && !el.hasAttribute('title') &&
        typeof ctReplyTimeSource === 'function') {
      const value = ctReplyTimeSource(el);
      return ctTimestampParse(value) ? value : '';
    }
    return '';
  }

  function ctTimestampCreationNode(article) {
    const sources = [...article.querySelectorAll('span.text-tl-app-text-muted')]
      .filter(el => el.closest('article') === article && !!ctTimestampNativeValue(el));
    // Multiple candidates are ambiguous; never borrow from a quote or reply.
    return sources.length === 1 ? sources[0] : null;
  }

  function ctTimestampRelativeText(value, now = Date.now(), locale = CT_LOCALE) {
    const date = value instanceof Date ? value : ctTimestampParse(value);
    if (!date || !Number.isFinite(date.getTime()) || !Number.isFinite(now)) return '';
    const seconds = Math.floor((now - date.getTime()) / 1000);
    if (seconds < 60) return locale === 'ja' ? 'たった今' : 'Just now';
    for (const [limit, divisor, japanese, english] of [
      [3600, 60, '分前', 'm'], [86400, 3600, '時間前', 'h'], [604800, 86400, '日前', 'd']
    ]) {
      if (seconds < limit) return `${Math.floor(seconds / divisor)}${locale === 'ja' ? japanese : english}`;
    }
    const year = date.getFullYear() !== new Date(now).getFullYear() ? 'numeric' : undefined;
    return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      ...(year ? { year } : {}), month: locale === 'ja' ? 'long' : 'short', day: 'numeric'
    }).format(date);
  }

  function ctTimestampClockState() {
    return ctTimestampClockState.value ||= { elements: new Set(), timer: null, active: true, installed: false };
  }

  function ctTimestampRefreshRelative() {
    const state = ctTimestampClockState();
    clearTimeout(state.timer);
    state.timer = null;
    if (!state.active || document.hidden) return;
    const now = Date.now();
    let delay = 60000;
    for (const el of state.elements) {
      const value = el.isConnected && ctTimestampNativeValue(el);
      const date = value && ctTimestampParse(value);
      const node = el.firstChild;
      if (!date || el.childNodes.length !== 1 || node?.nodeType !== Node.TEXT_NODE) {
        state.elements.delete(el);
        continue;
      }
      const text = ctTimestampRelativeText(date, now);
      if (node.nodeValue !== text) {
        node.nodeValue = text;
        if (typeof ctReplyTimeRendered === 'function' && !el.hasAttribute('title')) ctReplyTimeRendered(el, text);
      }
      const age = now - date.getTime();
      if (age >= 0 && age < 604800000) delay = Math.min(delay, 60000 - age % 60000);
    }
    if (state.elements.size) state.timer = setTimeout(ctTimestampRefreshRelative, Math.max(1000, delay));
  }

  function ctTimestampTrackRelative(el) {
    const state = ctTimestampClockState();
    if (!state.installed) {
      state.installed = true;
      document.addEventListener('visibilitychange', ctTimestampRefreshRelative);
      window.addEventListener('pagehide', () => {
        state.active = false;
        clearTimeout(state.timer);
        state.timer = null;
      });
      window.addEventListener('pageshow', event => {
        if (event.persisted) {
          state.active = true;
          ctTimestampRefreshRelative();
        }
      });
    }
    state.elements.add(el);
    if (state.elements.size > 500) state.elements.delete(state.elements.values().next().value);
  }

  function ctTimestampDetailContext(article) {
    if (!/^\/(?:post|posts)\/[^/]+\/?$/.test(location.pathname) && !/\/status\/[^/]+\/?$/.test(location.pathname)) return null;
    // Tweet keeps the old feed mounted while a route is loading. Its URL and
    // heading alone cannot identify the actual conversation panel.
    const panel = article.closest('div.animate-fadeIn.flex.flex-col');
    const scroll = article.closest('div.min-h-0.flex-1.overflow-y-auto');
    const footer = panel?.lastElementChild;
    return panel && scroll?.parentElement === panel &&
      panel.querySelector(':scope > div.shrink-0 > div.sticky > button[aria-label="Back"],:scope > div.shrink-0 > div.sticky > button[aria-label="戻る"]') &&
      footer?.matches('div.shrink-0.z-20.border-t') && footer.querySelector('[role="form"] textarea') ? panel : null;
  }

  function ctTimestampPatchExactPostTime(root = document) {
    const scope = root?.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const articles = new Set();
    if (scope instanceof Element) {
      const parent = scope.closest('article');
      if (parent) articles.add(parent);
    }
    scope?.querySelectorAll?.('article').forEach(article => articles.add(article));
    for (const article of articles) {
      if (!article.isConnected) continue;
      const stamps = [...article.querySelectorAll('.ct-detail-post-time')]
        .filter(stamp => stamp.closest('article') === article);
      const creation = ctTimestampCreationNode(article);
      if (creation) ctTimestampTrackRelative(creation);
      const source = ctTimestampDetailContext(article) ? creation : null;
      const value = source && ctTimestampNativeValue(source);
      const date = value && ctTimestampParse(value);
      if (!date) {
        stamps.forEach(stamp => stamp.remove());
        continue;
      }
      const stamp = stamps.shift() || document.createElement('div');
      stamps.forEach(extra => extra.remove());
      stamp.className = 'ct-detail-post-time';
      stamp.dataset.ctOwned = 'true';
      stamp.dataset.ctCreatedAt = value;
      const text = ctTimestampExactText(date);
      if (stamp.textContent !== text) stamp.textContent = text;
      // Insert in this post's content column, before its own engagement row.
      // The same article may contain a full inline reply thread below that row.
      let column = source.parentElement;
      while (column && column !== article && !column.parentElement?.matches('div.flex.items-start.gap-3')) column = column.parentElement;
      if (!column || column === article) column = article;
      const action = [...column.querySelectorAll('[data-testid="tweet-like-action"],[data-testid="tweet-open-comment-action"],[data-testid="tweet-comment-action"]')]
        .find(button => button.closest('article') === article);
      let actionRow = action;
      while (actionRow && actionRow.parentElement !== column) actionRow = actionRow.parentElement;
      if (actionRow) {
        if (stamp.nextSibling !== actionRow || stamp.parentElement !== column) column.insertBefore(stamp, actionRow);
      } else if (stamp.parentElement !== column) column.append(stamp);
    }
    ctTimestampRefreshRelative();
  }
