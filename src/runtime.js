  // Shared runtime; embedded at build time, never fetched remotely.
  const ctAutoSeen = new WeakMap();
  const ctAutoPending = new Map();
  const ctAutoAttempted = new Set();
  const ctManualTranslation = new WeakSet();
  const ctNativeLikeButtons = new WeakSet();
  const ctLikeLabels = new WeakMap();
  let ctAutoClick = false;
  let ctAutoTimer = null;
  let ctAutoCurrent = null;
  let ctAutoCooldownUntil = 0;
  let ctTranslationMessage = '';
  let ctDeviceTranslation = null;

  function autoTranslationEnabled() {
    // A separate opt-in key does not inherit the old enabled-by-default setting.
    return loadJSON(KEY.autoTranslate + '.optInV2', false) === true;
  }

  function ctTranslationEngine() {
    return loadJSON(KEY.autoTranslate + '.engine', 'native') === 'device' ? 'device' : 'native';
  }

  function ctTranslationStatus(message) {
    ctTranslationMessage = message;
    ctTools?.refreshTranslation?.();
  }

  function ctCancelTranslations() {
    clearTimeout(ctAutoTimer);
    ctAutoTimer = null;
    ctAutoPending.clear();
    // The request is already owned by the site and cannot be canceled here.
    // Keep its result monitor so a hidden-tab error still starts the cooldown.
    ctDeviceTranslation?.cancel();
  }

  function ctOwnTranslationText(control) {
    if (control.closest('blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"],[data-ct-owned]')) return null;
    const article = control.closest('article');
    if (!article) return null;
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap,[data-testid="tweet-text"],[data-testid="post-text"]')]
      .find(el => el.closest('article') === article &&
        !el.closest('[aria-live],button,[role="button"],blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"],[data-ct-owned]'));
    const text = body?.textContent?.trim();
    return text ? { article, body, text } : null;
  }

  function ctTranslationDisabled(control) {
    return control.disabled || control.getAttribute('aria-disabled') === 'true' ||
      control.getAttribute('aria-busy') === 'true';
  }

  function ctNativeTranslationError(control) {
    const region = control.closest('[aria-live="polite"]')?.parentElement;
    return [...region?.querySelectorAll('[role="alert"]') || []]
      .some(node => /Couldn.t translate|翻訳できませんでした/i.test(node.textContent));
  }

  function ctTranslationAttemptKey(context, target) {
    const id = articleId(context.article);
    // Feed cards often have no permalink. Repeated identical text can reuse
    // the session's attempted state; manual translation is always available.
    return `${target}:${id || 'text'}:${context.text}`;
  }

  function ctFinishNativeTranslation(failed, uncertain = false) {
    clearTimeout(ctAutoCurrent?.timer);
    ctAutoCurrent = null;
    if (failed) {
      ctAutoCooldownUntil = Date.now() + 5 * 60 * 1000;
      ctAutoPending.clear();
      ctTranslationStatus(CT_LOCALE === 'ja'
        ? `${uncertain ? '翻訳の完了を確認できないため' : 'サイトの翻訳でエラーが発生したため'}、自動翻訳を5分間休止しています。手動翻訳は引き続き使えます。`
        : `Automatic site translation is paused for 5 minutes ${uncertain ? 'because completion could not be confirmed' : 'after an error'}. Manual translation is still available.`);
    } else {
      ctAutoTimer = setTimeout(ctRunNativeTranslation, 1500);
    }
  }

  function ctMonitorNativeTranslation() {
    const job = ctAutoCurrent;
    if (!job) return;
    if (!job.article.isConnected) { ctFinishNativeTranslation(true, true); return; }
    const control = [...job.article.querySelectorAll('[aria-live="polite"] button')]
      .find(button => button.closest('article') === job.article && !button.closest('blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"]'));
    if (control && ctNativeTranslationError(control)) { ctFinishNativeTranslation(true); return; }
    const action = ctTranslationButtonText(control);
    if (/^(?:Show original|原文を表示)$/i.test(action) ||
        (control && /^(?:Show translation|翻訳を表示)$/i.test(action) &&
          control.getAttribute('aria-busy') !== 'true' && ctTranslationDisabled(control))) {
      ctFinishNativeTranslation(false); return;
    }
    if (Date.now() - job.started >= 30000) { ctFinishNativeTranslation(true, true); return; }
    job.timer = setTimeout(ctMonitorNativeTranslation, 250);
  }

  function ctRunNativeTranslation() {
    ctAutoTimer = null;
    if (ctAutoCurrent || ctAutoCooldownUntil > Date.now()) return;
    if (!autoTranslationEnabled() || ctTranslationEngine() !== 'native' || document.hidden || !ctPageActive) {
      ctAutoPending.clear(); return;
    }
    while (ctAutoPending.size) {
      const [control, context] = ctAutoPending.entries().next().value;
      ctAutoPending.delete(control);
      const { article, text, key } = context;
      if (key && ctAutoAttempted.has(key)) continue;
      if (!control.isConnected || ctTranslationDisabled(control) || ctManualTranslation.has(article) ||
          ctOwnTranslationText(control)?.text !== text ||
          !/^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(control))) continue;
      if (ctNativeTranslationError(control)) { ctFinishNativeTranslation(true); return; }
      ctAutoSeen.set(article, text);
      if (key) {
        ctAutoAttempted.add(key);
        if (ctAutoAttempted.size > 1000) ctAutoAttempted.delete(ctAutoAttempted.values().next().value);
      }
      ctAutoCurrent = { article, started: Date.now(), timer: null };
      ctAutoClick = true;
      try { control.click(); }
      catch { ctFinishNativeTranslation(true); }
      finally { ctAutoClick = false; }
      if (ctAutoCurrent) ctMonitorNativeTranslation();
      return;
    }
  }

  function patchAutoTranslation(root = document, nativeLanguage = CT_LOCALE) {
    const active = !document.hidden && ctPageActive;
    if (ctTranslationEngine() === 'device') {
      ctAutoPending.clear();
      clearTimeout(ctAutoTimer); ctAutoTimer = null;
      ctDeviceTranslation?.patch(root, active && autoTranslationEnabled());
      return;
    }
    ctDeviceTranslation?.clear();
    if (!autoTranslationEnabled() || !active) { ctCancelTranslations(); return; }
    if (ctAutoCooldownUntil > Date.now()) return;
    if (ctAutoCooldownUntil) { ctAutoCooldownUntil = 0; ctTranslationStatus(''); }
    // Tweet's native translator chooses navigator.language, not the userscript UI locale.
    const targetLanguage = (navigator.language || nativeLanguage).toLowerCase().split(/[-_]/)[0];
    for (const control of ctTranslationControls(root)) {
      if (!control.isConnected || ctTranslationDisabled(control)) continue;
      const context = ctOwnTranslationText(control);
      if (!context || !control.closest('[aria-live="polite"]')) continue;
      const { article, body, text } = context;
      const lang = ctLikelyLanguage(text, body);
      if (lang === 'unknown' || lang === targetLanguage || ctManualTranslation.has(article)) continue;
      const key = ctTranslationAttemptKey(context, targetLanguage);
      if (ctAutoSeen.get(article) === text || (key && ctAutoAttempted.has(key)) || ctAutoPending.has(control)) continue;
      if (ctAutoPending.size >= 40) break;
      ctAutoPending.set(control, { ...context, key });
    }
    if (!ctAutoCurrent && ctAutoTimer === null && ctAutoPending.size) ctAutoTimer = setTimeout(ctRunNativeTranslation, 0);
  }

  function ctRememberTranslationChoice(event) {
    if (ctAutoClick) return;
    const control = event.target?.closest?.('button,[role="button"],a');
    if (!control?.closest('[aria-live="polite"]') || !/^(?:Show original|Show translation|Translate|原文を表示|翻訳を表示)$/i.test(ctTranslationButtonText(control))) return;
    const article = control.closest('article');
    if (!article) return;
    ctManualTranslation.add(article);
    ctDeviceTranslation?.hide(article);
    for (const [queued, context] of ctAutoPending) if (context.article === article) ctAutoPending.delete(queued);
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

  function classicAppearanceEnabled() {
    return loadJSON('ct-classic-appearance-v1', true) !== false;
  }

  const ctFavoriteStarPath = 'M12 2.75 14.86 8.54 21.25 9.47 16.63 13.98 17.72 20.36 12 17.35 6.28 20.36 7.37 13.98 2.75 9.47 9.14 8.54Z';

  function ctInstallFavoriteStyle(doc = document) {
    if (doc.getElementById('ct-favorite-presentation-style')) return;
    const style = doc.createElement('style');
    style.id = 'ct-favorite-presentation-style';
    style.dataset.ctOwned = 'favorite-presentation';
    const mask = fill => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${ctFavoriteStarPath}" fill="${fill ? 'black' : 'none'}" stroke="black" stroke-width="1.8" stroke-linejoin="round"/></svg>`)}")`;
    const button = 'button[data-testid="tweet-like-action"][data-testid]';
    const selected = `${button}:is([aria-pressed="true"],:not([aria-pressed]).text-pink-500,:not([aria-pressed]):not(.text-tl-app-text-muted):not(.text-pink-500).ct-is-liked)`;
    const notificationRows = [
      '#root-container main button.w-full.flex.items-start.border-b',
      '#root-container main div.border-b > button.w-full.flex.items-start.gap-3'
    ];
    const notificationIcons = notificationRows.map(row => `${row} > div[class~="mt-0.5"].shrink-0 > svg.lucide-heart.text-rose-500[width="28"][height="28"]`);
    // React may replace both className and the icon before the next scan.
    // Stable native test IDs hide the heart immediately; the CSS vector fills
    // the brief gap until our motion-capable star is restored.
    style.textContent = `
      ${button} > svg { display:none!important; }
      ${button} { color:var(--color-tl-app-text-muted, var(--tl-app-text-muted, #657786))!important; }
      ${button}::before {
        content:""!important; display:inline-block!important;
        flex:0 0 20px; width:20px; height:20px;
        background:currentColor;
        -webkit-mask:${mask(false)} center/contain no-repeat;
        mask:${mask(false)} center/contain no-repeat;
      }
      ${button} > .ct-star svg { fill:none!important; stroke:currentColor; }
      ${selected} { color:#ffac33!important; }
      ${selected}::before {
        -webkit-mask-image:${mask(true)};
        mask-image:${mask(true)};
      }
      ${selected} > .ct-star svg { fill:currentColor!important; }
      ${selected} + :is(span.text-xs.tabular-nums,button[data-testid="tweet-like-action-count"]) { color:#ffac33!important; }
      ${notificationIcons.join(',')} {
        background:#ffac33!important;
        -webkit-mask:${mask(true)} center/contain no-repeat;
        mask:${mask(true)} center/contain no-repeat;
      }
      ${notificationIcons.map(icon => `${icon} *`).join(',')} { visibility:hidden!important; }
      @supports selector(:has(*)) {
        ${button}:has(> span.ct-star)::before { display:none!important; }
      }
      @supports not selector(:has(*)) {
        ${button} > span.ct-star { display:none!important; }
      }
      @media (hover:hover) {
        ${button}:hover { color:#ffac33!important; }
      }
    `;
    (doc.head || doc.documentElement).append(style);
  }

  function ctEnsureFavoriteStar(button) {
    if (!button.classList.contains('ct-favorite-button')) button.classList.add('ct-favorite-button');
    if ([...button.children].some(node => node.matches('span.ct-star'))) return;
    const star = document.createElement('span');
    star.className = 'ct-star';
    star.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ctFavoriteStarPath);
    svg.append(path); star.append(svg); button.prepend(star);
  }

  function patchFavoriteButtons(root = document) {
    ctInstallFavoriteStyle(root.nodeType === 9 ? root : root.ownerDocument || document);
    const buttons = [...root.querySelectorAll?.('[data-testid="tweet-like-action"]') || []];
    if (root.matches?.('[data-testid="tweet-like-action"]')) buttons.push(root);
    for (const button of buttons) {
      const liked = ctIsLiked(button);
      ctEnsureFavoriteStar(button);
      const action = CT_LOCALE === 'ja' ? (liked ? 'お気に入りを解除' : 'お気に入り') : (liked ? 'Unfavorite' : 'Favorite');
      if (button.title !== action) button.title = action;
      const old = button.getAttribute('aria-label') || '';
      const count = old.match(/,\s*([\d,.]+)\s*(?:likes?|favorites?|件)?/i)?.[1];
      const label = count ? `${action}, ${count} ${CT_LOCALE === 'ja' ? '件' : 'favorites'}` : action;
      ctLikeLabels.set(button, { label, liked });
      if (old !== label) button.setAttribute('aria-label', label);
      if (button.classList.contains('ct-is-liked') !== liked) button.classList.toggle('ct-is-liked', liked);
      if (typeof ctAnimateFavorite === 'function') ctAnimateFavorite(button, liked);
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
    return detail && article === [...document.querySelectorAll('article')].find(el =>
      !el.closest('[hidden],[aria-hidden="true"],[data-ct-owned],[data-ct-local-ui]')) &&
      !article.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"]') ? detail : null;
  }

  let ctScanTimer = null;
  let ctScanning = false;
  let ctPageActive = true;
  let ctStarted = false;
  const ctObservedAttributes = ['aria-pressed', 'aria-checked', 'aria-label', 'aria-disabled', 'aria-busy', 'placeholder', 'title', 'class', 'src', 'data-app-theme'];
  const observer = new MutationObserver(mutations => {
    if (ctScanning || !ctPageActive) return;
    if (!mutations.some(m => {
      const el = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      if (el?.closest('[data-ct-owned],[data-ct-local-ui],#ct-local-tools,#ct-favorites-panel')) return false;
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

  function start() {
    if (ctStarted) return;
    if (document.documentElement.dataset.ctActiveVersion) return;
    document.documentElement.dataset.ctActiveVersion = '6.11.0';
    ctStarted = true;
    ctDeviceTranslation = createDeviceTranslation({
      locale: CT_LOCALE, getContext: ctOwnTranslationText, isManual: article => ctManualTranslation.has(article),
      isActive: () => ctPageActive && !document.hidden && ctTranslationEngine() === 'device',
      onStatus: ctTranslationStatus, onComplete: ctScheduleScan
    });
    ctTools = installLocalEnhancements({
      locale: CT_LOCALE,
      getClassicAppearance: classicAppearanceEnabled,
      setClassicAppearance: enabled => {
        if (!saveJSON('ct-classic-appearance-v1', enabled === true)) throw new Error('Storage unavailable');
        ctScheduleScan();
      },
      getAutoTranslate: autoTranslationEnabled,
      getTranslationEngine: ctTranslationEngine,
      setTranslationEngine: engine => {
        if (!['native', 'device'].includes(engine) ||
            !saveJSON(KEY.autoTranslate + '.engine', engine)) throw new Error('Storage unavailable');
        ctCancelTranslations(); ctScheduleScan();
      },
      deviceTranslationSupported: ctDeviceTranslation.supported,
      prepareDeviceTranslation: source => ctDeviceTranslation.prepare(source),
      getTranslationStatus: () => ctTranslationMessage,
      setAutoTranslate: enabled => {
        if (!saveJSON(KEY.autoTranslate + '.optInV2', enabled === true)) throw new Error('Storage unavailable');
        ctCancelTranslations();
        ctScheduleScan();
      }
    });
    document.addEventListener('click', ctRememberTranslationChoice, true);
    ctRunScan();
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
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted && !ctPageActive) {
        ctPageActive = true;
        ctObserve();
        ctScheduleScan();
      }
    });
  }
