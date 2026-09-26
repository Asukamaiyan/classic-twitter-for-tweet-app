  // Shared runtime; embedded at build time, never fetched remotely.
  const ctAutoSeen = new WeakMap();
  const ctAutoPending = new Map();
  const ctManualTranslation = new WeakSet();
  const ctNativeLikeButtons = new WeakSet();
  const ctLikeLabels = new WeakMap();
  let ctAutoClick = false;
  let ctNextTranslationAt = 0;

  function autoTranslationEnabled() {
    // A separate opt-in key does not inherit the old enabled-by-default setting.
    return loadJSON(KEY.autoTranslate + '.optInV2', false) === true;
  }

  function ctCancelTranslations() {
    for (const timer of ctAutoPending.values()) clearTimeout(timer);
    ctAutoPending.clear();
    ctNextTranslationAt = 0;
  }

  function ctOwnTranslationText(control) {
    if (control.closest('blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"]')) return null;
    const article = control.closest('article');
    if (!article) return null;
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap,[data-testid="tweet-text"],[data-testid="post-text"]')]
      .find(el => el.closest('article') === article &&
        !el.closest('[aria-live],button,[role="button"],blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"]'));
    const text = body?.textContent?.trim();
    return text ? { article, body, text } : null;
  }

  function ctTranslationDisabled(control) {
    return control.disabled || control.getAttribute('aria-disabled') === 'true' ||
      control.getAttribute('aria-busy') === 'true';
  }

  function patchAutoTranslation(root = document, nativeLanguage = CT_LOCALE) {
    if (!autoTranslationEnabled() || document.hidden || !ctPageActive) {
      ctCancelTranslations();
      return;
    }
    // Tweet's native translator chooses navigator.language, not the userscript UI locale.
    const targetLanguage = (navigator.language || nativeLanguage).toLowerCase().split(/[-_]/)[0];
    for (const control of ctTranslationControls(root)) {
      if (!control.isConnected || ctTranslationDisabled(control)) continue;
      const context = ctOwnTranslationText(control);
      if (!context || !control.closest('[aria-live="polite"]')) continue;
      const { article, body, text } = context;
      const lang = ctLikelyLanguage(text, body);
      if (lang === 'unknown' || lang === targetLanguage || ctManualTranslation.has(article)) continue;
      if (ctAutoSeen.get(article) === text || ctAutoPending.has(control)) continue;
      if (!/^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(control))) continue;
      if (ctAutoPending.size >= 40) break;
      const delay = Math.max(0, ctNextTranslationAt - Date.now());
      ctNextTranslationAt = Date.now() + delay + 750;
      const timer = setTimeout(() => {
        ctAutoPending.delete(control);
        if (!autoTranslationEnabled() || document.hidden || !ctPageActive ||
            !control.isConnected || ctTranslationDisabled(control) || ctManualTranslation.has(article)) return;
        if (ctOwnTranslationText(control)?.text !== text) return;
        if (!/^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(control))) return;
        ctAutoSeen.set(article, text);
        ctAutoClick = true;
        try { control.click(); } finally { ctAutoClick = false; }
      }, delay);
      ctAutoPending.set(control, timer);
    }
  }

  function ctRememberTranslationChoice(event) {
    if (ctAutoClick) return;
    const control = event.target?.closest?.('button,[role="button"],a');
    if (!control?.closest('[aria-live="polite"]') || !/^(?:Show original|Show translation|Translate|原文を表示|翻訳を表示)$/i.test(ctTranslationButtonText(control))) return;
    const article = control.closest('article');
    if (!article) return;
    ctManualTranslation.add(article);
    const timer = ctAutoPending.get(control);
    if (timer !== undefined) clearTimeout(timer);
    ctAutoPending.delete(control);
  }

  function ctIsLiked(button) {
    const pressed = button.getAttribute('aria-pressed');
    if (pressed !== null) return pressed === 'true';
    const pink = button.classList.contains('text-pink-500');
    if (pink || button.classList.contains('text-tl-app-text-muted')) ctNativeLikeButtons.add(button);
    if (ctNativeLikeButtons.has(button)) return pink;
    const label = button.getAttribute('aria-label') || '';
    const previous = ctLikeLabels.get(button);
    if (previous?.label === label) return previous.liked;
    return /^(?:Unlike|Unfavorite|お気に入りを解除)(?:,|$)/i.test(label);
  }

  function patchFavoriteButtons(root = document) {
    const buttons = [...root.querySelectorAll?.('[data-testid="tweet-like-action"]') || []];
    if (root.matches?.('[data-testid="tweet-like-action"]')) buttons.push(root);
    for (const button of buttons) {
      const liked = ctIsLiked(button);
      const action = CT_LOCALE === 'ja' ? (liked ? 'お気に入りを解除' : 'お気に入り') : (liked ? 'Unfavorite' : 'Favorite');
      if (button.title !== action) button.title = action;
      const old = button.getAttribute('aria-label') || '';
      const count = old.match(/,\s*([\d,.]+)\s*(?:likes?|favorites?|件)?/i)?.[1];
      const label = count ? `${action}, ${count} ${CT_LOCALE === 'ja' ? '件' : 'favorites'}` : action;
      ctLikeLabels.set(button, { label, liked });
      if (old !== label) button.setAttribute('aria-label', label);
      if (button.classList.contains('ct-is-liked') !== liked) button.classList.toggle('ct-is-liked', liked);
    }
  }

  // Never mistake a quoted post's link for its parent post.
  function articleId(article) {
    if (!article) return null;
    for (const link of article.querySelectorAll('a[href]')) {
      if (link.closest('article') !== article ||
          !(link.querySelector('time') || link.closest('[data-testid="post-permalink"]')) ||
          link.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"]')) continue;
      try {
        const url = new URL(link.getAttribute('href'), location.origin);
        const id = url.pathname.match(/^\/post\/([A-Za-z0-9_-]+)\/?$/)?.[1];
        if (url.origin === location.origin && id) return id;
      } catch {}
    }
    const detail = location.pathname.match(/^\/post\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    return detail && article === document.querySelector('article') &&
      !article.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"]') ? detail : null;
  }

  let ctScanTimer = null;
  let ctScanning = false;
  let ctPageActive = true;
  let ctStarted = false;
  const ctObservedAttributes = ['aria-pressed', 'aria-checked', 'aria-label', 'aria-disabled', 'aria-busy', 'placeholder', 'title', 'class'];
  const observer = new MutationObserver(mutations => {
    if (ctScanning || !ctPageActive) return;
    if (!mutations.some(m => {
      const el = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      if (el?.closest('[data-ct-owned],[data-ct-local-ui],#ct-local-tools,#ct-favorites-panel,#ct-reply-panel')) return false;
      if (m.type === 'attributes') return m.oldValue !== m.target.getAttribute(m.attributeName);
      if (m.type === 'characterData') return m.oldValue !== m.target.data;
      if (m.type === 'childList' && m.addedNodes.length && m.removedNodes.length &&
          [...m.addedNodes, ...m.removedNodes].every(node => node.nodeType === Node.TEXT_NODE)) {
        return [...m.addedNodes].map(node => node.data).join('') !== [...m.removedNodes].map(node => node.data).join('');
      }
      return true;
    })) return;
    ctScheduleScan();
  });

  function ctObserve() {
    if (ctPageActive && document.documentElement) observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, characterDataOldValue: true,
      attributes: true, attributeOldValue: true, attributeFilter: ctObservedAttributes
    });
  }

  function ctRunScan() {
    ctScanTimer = null;
    if (ctScanning || !ctPageActive || !document.body) return;
    ctScanning = true;
    observer.disconnect();
    try { scan(document); ctTools?.refresh(); }
    finally { ctScanning = false; ctObserve(); }
  }

  function ctScheduleScan() {
    if (!ctPageActive || ctScanTimer !== null) return;
    ctScanTimer = setTimeout(ctRunScan, 100);
  }

  let ctTools = null;
  let ctReplyInterval = null;
  function ctStartReplyInterval() {
    if (ctReplyInterval !== null) return;
    ctReplyInterval = setInterval(() => {
      if (!document.hidden && ctPageActive) replyWatchTick();
    }, 90000);
  }

  function start() {
    if (ctStarted) return;
    if (document.documentElement.dataset.ctActiveVersion) return;
    document.documentElement.dataset.ctActiveVersion = '6.7.0';
    ctStarted = true;
    ctTools = installLocalEnhancements({
      locale: CT_LOCALE,
      getAutoTranslate: autoTranslationEnabled,
      setAutoTranslate: enabled => {
        if (!saveJSON(KEY.autoTranslate + '.optInV2', enabled === true)) throw new Error('Storage unavailable');
        ctCancelTranslations();
        ctScheduleScan();
      }
    });
    document.addEventListener('click', ctRememberTranslationChoice, true);
    ctRunScan();
    ctStartReplyInterval();
    window.addEventListener('popstate', ctScheduleScan);
    for (const name of ['pushState', 'replaceState']) {
      const original = history[name];
      history[name] = function (...args) {
        const result = original.apply(this, args);
        ctScheduleScan();
        return result;
      };
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctCancelTranslations();
      else ctScheduleScan();
    });
    window.addEventListener('pagehide', () => {
      ctPageActive = false;
      observer.disconnect();
      clearTimeout(ctScanTimer);
      ctScanTimer = null;
      ctCancelTranslations();
      clearInterval(ctReplyInterval);
      ctReplyInterval = null;
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted && !ctPageActive) {
        ctPageActive = true;
        ctObserve();
        ctScheduleScan();
        ctStartReplyInterval();
      }
    });
  }
