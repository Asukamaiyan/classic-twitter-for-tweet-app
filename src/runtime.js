  // Shared runtime; embedded at build time, never fetched remotely.
  const ctAutoSeen = new WeakMap();
  const ctAutoPending = new Map();
  const ctAutoAttempted = new Set();
  const ctManualTranslation = new WeakSet();
  const ctNativeLikeButtons = new WeakSet();
  const ctLikeLabels = new WeakMap();
  const ctFavoriteButtonClasses = new WeakMap();
  const ctFavoriteNativeTitles = new WeakMap();
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
    return /^(?:Unlike|Unfavorite|お気に入りを解除|いいねを取り消す)(?:,|$)/i.test(label);
  }

  function classicAppearanceEnabled() {
    return loadJSON('ct-classic-appearance-v1', true) !== false;
  }

  function ctNativeFavoriteAction(liked) {
    return CT_LOCALE === 'ja' ? (liked ? 'いいねを取り消す' : 'いいね') : (liked ? 'Unlike' : 'Like');
  }

  function ctSyncFavoriteAppearance(doc = document) {
    const enabled = classicAppearanceEnabled();
    if (doc.documentElement?.dataset.ctFavoriteClassic !== (enabled ? 'on' : 'off')) {
      if (doc.documentElement) doc.documentElement.dataset.ctFavoriteClassic = enabled ? 'on' : 'off';
      if (typeof ctSyncLocalizationAppearance === 'function') ctSyncLocalizationAppearance(doc);
    }
    return enabled;
  }

  const ctFavoriteStarPath = 'M12 2.75 14.86 8.54 21.25 9.47 16.63 13.98 17.72 20.36 12 17.35 6.28 20.36 7.37 13.98 2.75 9.47 9.14 8.54Z';
  const ctFavoriteButtonSelector = 'button[data-testid="tweet-like-action"]';
  const ctFavoriteCountSelector = 'button[data-testid="tweet-like-action-count"]';
  const ctFavoriteDialogSelector = 'div[role="dialog"][aria-modal="true"].bg-tl-app-card.border';
  const ctFavoriteProtectedSelector = '[data-ct-owned],[data-ct-local-ui],[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]';

  function ctInstallFavoriteStyle(doc = document) {
    const existing = doc.getElementById('ct-favorite-presentation-style');
    if (existing) return existing.matches('style[data-ct-owned="favorite-presentation"]') ? existing : null;
    if (!doc.documentElement) return null;
    const style = doc.createElement('style');
    style.id = 'ct-favorite-presentation-style';
    style.dataset.ctOwned = 'favorite-presentation';
    const mask = fill => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${ctFavoriteStarPath}" fill="${fill ? 'black' : 'none'}" stroke="black" stroke-width="1.8" stroke-linejoin="round"/></svg>`)}")`;
    const enabled = 'html[data-ct-favorite-classic="on"]';
    const button = `${enabled} button[data-testid="tweet-like-action"][data-testid]`;
    const count = `${enabled} button[data-testid="tweet-like-action-count"]`;
    const selected = `${button}:is([aria-pressed="true"],:not([aria-pressed]).text-pink-500,:not([aria-pressed]):not(.text-tl-app-text-muted):not(.text-pink-500).ct-is-liked)`;
    const notificationRows = [
      `${enabled} #root-container main button.w-full.flex.items-start.border-b`,
      `${enabled} #root-container main div.border-b > button.w-full.flex.items-start.gap-3`
    ];
    const notificationIcons = notificationRows.map(row => `${row} > div[class~="mt-0.5"].shrink-0 > svg.lucide-heart.text-rose-500[width="28"][height="28"]`);
    // React may replace both className and the icon before the next scan.
    // Stable native test IDs hide the heart immediately; the CSS vector fills
    // the brief gap until our motion-capable star is restored.
    style.textContent = `
      ${button} > svg, ${button} > :not(span.ct-star) svg { display:none!important; }
      ${button} { color:var(--color-tl-app-text-muted, var(--tl-app-text-muted, #657786))!important; }
      ${button}::before {
        content:""!important; display:inline-block!important;
        flex:0 0 20px; width:20px; height:20px;
        background:currentColor;
        -webkit-mask:${mask(false)} center/contain no-repeat;
        mask:${mask(false)} center/contain no-repeat;
      }
      ${button} > span.ct-star {
        display:inline-flex; width:20px; height:20px; align-items:center; justify-content:center;
        transform-origin:center; pointer-events:none;
      }
      ${button} > .ct-star svg {
        display:block!important; width:20px; height:20px;
        fill:none!important; stroke:currentColor; stroke-width:1.8;
        stroke-linecap:round; stroke-linejoin:round;
      }
      ${count} { color:var(--color-tl-app-text-muted, var(--tl-app-text-muted, #657786))!important; }
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
        ${button}:hover, ${count}:hover { color:#ffac33!important; }
        ${button}:hover { background:rgba(255,172,51,.12)!important; }
      }
    `;
    (doc.head || doc.documentElement).append(style);
    return style;
  }

  function ctEnsureFavoriteStar(button) {
    ctFavoriteClass(button, 'ct-favorite-button', true);
    if ([...button.children].some(node => node.matches('span.ct-star'))) return;
    const star = document.createElement('span');
    star.className = 'ct-star';
    star.dataset.ctOwned = 'favorite-star';
    star.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ctFavoriteStarPath);
    svg.append(path); star.append(svg); button.prepend(star);
  }

  function ctFavoriteClass(button, name, enabled) {
    let record = ctFavoriteButtonClasses.get(button);
    if (enabled && !button.classList.contains(name)) {
      if (!record) {
        record = { original: button.getAttribute('class'), added: new Set() };
        ctFavoriteButtonClasses.set(button, record);
      }
      record.added.add(name); button.classList.add(name);
    } else if (!enabled && record?.added.has(name)) {
      button.classList.remove(name); record.added.delete(name);
      if (!record.added.size) {
        const original = (record.original || '').trim().split(/\s+/).filter(Boolean).sort().join(' ');
        const current = [...button.classList].sort().join(' ');
        if (original === current) {
          if (record.original === null) button.removeAttribute('class');
          else if (button.getAttribute('class') !== record.original) button.setAttribute('class', record.original);
        }
        ctFavoriteButtonClasses.delete(button);
      }
    }
  }

  function ctFavoriteTitle(button, action, classic) {
    let record = ctFavoriteNativeTitles.get(button);
    const current = button.getAttribute('title');
    if (classic) {
      if (!record) { record = { native: current, own: null }; ctFavoriteNativeTitles.set(button, record); }
      else if (current !== record.own) record.native = current;
      if (current !== action) button.setAttribute('title', action);
      record.own = action;
    } else if (record) {
      // Preserve a title newly supplied by React. Otherwise restore the native
      // absence/spelling instead of leaving our classic tooltip behind.
      if (current === record.own) {
        const native = record.native;
        if (native === null) button.removeAttribute('title');
        else {
          const next = /^(?:Like|Unlike|いいね|いいねを取り消す|View\s+[\d,.]+\s+likes?|[\d,.]+件のいいねを表示|Close liked by list|いいねしたユーザー一覧を閉じる)$/i.test(native) ? action : native;
          if (current !== next) button.setAttribute('title', next);
        }
      }
      ctFavoriteNativeTitles.delete(button);
    } else if (CT_LOCALE === 'ja' && /^(?:Like|Unlike)$/i.test(current || '')) {
      button.setAttribute('title', action);
    }
  }

  function patchFavoriteButtons(root = document) {
    const doc = root.nodeType === 9 ? root : root.ownerDocument || document;
    const classic = ctSyncFavoriteAppearance(doc);
    ctInstallFavoriteStyle(doc);
    const buttons = [...root.querySelectorAll?.(ctFavoriteButtonSelector) || []];
    if (root.matches?.(ctFavoriteButtonSelector)) buttons.push(root);
    for (const button of buttons) {
      if (button.closest(ctFavoriteProtectedSelector)) continue;
      const liked = ctIsLiked(button);
      if (classic) ctEnsureFavoriteStar(button);
      else {
        button.querySelectorAll(':scope > span.ct-star[data-ct-owned="favorite-star"]').forEach(star => star.remove());
        ctFavoriteClass(button, 'ct-favorite-button', false);
        ctFavoriteClass(button, 'ct-is-liked', false);
        if (typeof ctClearFavoriteMotion === 'function') ctClearFavoriteMotion(button, null, true);
      }
      const action = classic
        ? (CT_LOCALE === 'ja' ? (liked ? 'お気に入りを解除' : 'お気に入り') : (liked ? 'Unfavorite' : 'Favorite'))
        : ctNativeFavoriteAction(liked);
      ctFavoriteTitle(button, action, classic);
      const old = button.getAttribute('aria-label') || '';
      const count = old.match(/,\s*([\d,.]+)\s*(?:likes?|favorites?|件)?/i)?.[1];
      const label = count ? `${action}, ${count} ${CT_LOCALE === 'ja' ? '件' : (classic ? 'favorites' : (count === '1' ? 'like' : 'likes'))}` : action;
      ctLikeLabels.set(button, { label, liked });
      if (old !== label) button.setAttribute('aria-label', label);
      if (classic) ctFavoriteClass(button, 'ct-is-liked', liked);
      // Only an action's own literal label is UI. Keep numeric counts, icon
      // nodes and any protected descendants instead of rebuilding the button.
      const walker = button.ownerDocument.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest(`${ctFavoriteProtectedSelector},svg`)) continue;
        if (/^(?:Like|Unlike|いいね|いいねを取り消す|Favorite|Unfavorite|お気に入り|お気に入りを解除)$/i.test(clean(node.nodeValue))) {
          const next = node.nodeValue.replace(/\S[\s\S]*\S|\S/, () => action);
          if (node.nodeValue !== next) node.nodeValue = next;
        }
      }
      if (classic && typeof ctAnimateFavorite === 'function') ctAnimateFavorite(button, liked);
    }
    ctPatchFavoriteCountLabels(root);
    ctPatchFavoriteDialogs(root);
  }

  function ctPatchFavoriteCountLabels(root = document) {
    const classic = classicAppearanceEnabled();
    const controls = [...root.querySelectorAll?.(ctFavoriteCountSelector) || []];
    if (root.matches?.(ctFavoriteCountSelector)) controls.push(root);
    for (const control of controls) {
      if (control.closest(ctFavoriteProtectedSelector)) continue;
      // Native count buttons have their own handler: only change its label.
      const text = clean(control.textContent);
      const match = /^(?:View\s+([\d,.]+)\s+(?:likes?|favorites?)|([\d,.]+)件の(?:お気に入り|いいね)を表示)$/i.exec(control.getAttribute('aria-label') || '');
      const count = match?.[1] || match?.[2] || (/^[\d,.]+$/.test(text) ? text : null);
      if (!count) continue;
      const label = CT_LOCALE === 'ja' ? `${count}件の${classic ? 'お気に入り' : 'いいね'}を表示` : `View ${count} ${classic ? 'favorites' : 'likes'}`;
      if (control.getAttribute('aria-label') !== label) control.setAttribute('aria-label', label);
      ctFavoriteTitle(control, label, classic);
    }
  }

  function ctPatchFavoriteDialogs(root = document) {
    const classic = classicAppearanceEnabled();
    const dialogs = new Set(root.querySelectorAll?.(ctFavoriteDialogSelector) || []);
    const closest = root.closest?.(ctFavoriteDialogSelector);
    if (closest) dialogs.add(closest);
    for (const dialog of dialogs) {
      if (dialog.closest(ctFavoriteProtectedSelector)) continue;
      // Confirm the shipped Favorites dialog header and close button together;
      // a person's name, post text or an unrelated dialog is never a label.
      const header = [...dialog.children].find(child => child.matches('div.flex.items-center.justify-between.border-b') &&
        child.querySelector(':scope > h3.text-sm.font-bold.text-tl-app-text') &&
        child.querySelector(':scope > button > svg.lucide-x'));
      if (!header) continue;
      const title = header.querySelector(':scope > h3');
      const close = header.querySelector(':scope > button');
      if (title.children.length || !/^(?:Liked by|Favorited by|お気に入りしたユーザー|いいねしたユーザー)$/.test(clean(title.textContent)) ||
          !/^(?:Close liked by list|Close Favorites list|お気に入りしたユーザー一覧を閉じる|いいねしたユーザー一覧を閉じる)$/.test(close.getAttribute('aria-label') || '')) continue;
      const label = CT_LOCALE === 'ja' ? `${classic ? 'お気に入り' : 'いいね'}したユーザー` : (classic ? 'Favorited by' : 'Liked by');
      const closeLabel = CT_LOCALE === 'ja' ? `${classic ? 'お気に入り' : 'いいね'}したユーザー一覧を閉じる` : (classic ? 'Close Favorites list' : 'Close liked by list');
      if (title.textContent !== label && title.firstChild?.nodeType === Node.TEXT_NODE) title.firstChild.nodeValue = label;
      if (dialog.getAttribute('aria-label') !== label) dialog.setAttribute('aria-label', label);
      if (close.getAttribute('aria-label') !== closeLabel) close.setAttribute('aria-label', closeLabel);
      ctFavoriteTitle(close, closeLabel, classic);
      const empty = dialog.querySelector(':scope > div.flex-1.overflow-y-auto > div.px-4.py-10.text-center.text-xs.text-tl-app-text-muted.font-medium');
      if (empty && !empty.children.length && /^(?:No likes yet\.|No favorites yet\.|お気に入りはまだありません。|いいねはまだありません。)$/.test(clean(empty.textContent)) && empty.firstChild?.nodeType === Node.TEXT_NODE) {
        const label = CT_LOCALE === 'ja' ? `${classic ? 'お気に入り' : 'いいね'}はまだありません。` : `No ${classic ? 'favorites' : 'likes'} yet.`;
        if (empty.firstChild.nodeValue !== label) empty.firstChild.nodeValue = label;
      }
    }
  }

  let ctFavoriteStartObserver = null;
  function ctPrepareFavoritePresentation(doc = document) {
    if (!doc.documentElement) {
      // Some document-start managers run before <html> exists. Observe only
      // document children until we can install the permanent presentation.
      if (!ctFavoriteStartObserver) {
        ctFavoriteStartObserver = new MutationObserver(() => {
          if (!doc.documentElement) return;
          ctFavoriteStartObserver.disconnect(); ctFavoriteStartObserver = null;
          ctPrepareFavoritePresentation(doc);
        });
        ctFavoriteStartObserver.observe(doc, { childList: true });
      }
      return;
    }
    ctSyncFavoriteAppearance(doc);
    let style = ctInstallFavoriteStyle(doc);
    // Loading multiple editions before DOMContentLoaded must still produce
    // one observer, in the same locale as the first edition's startup.
    if (!style || style.dataset.ctFavoriteWatch === 'true') return;
    style.dataset.ctFavoriteWatch = 'true';
    let active = true;
    const targets = `${ctFavoriteButtonSelector},${ctFavoriteCountSelector},${ctFavoriteDialogSelector}`;
    const observe = () => {
      if (active && doc.documentElement) watch.observe(doc.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['data-testid', 'class', 'aria-label', 'title', 'aria-pressed']
      });
    };
    const watch = new MutationObserver(records => {
      if (!active) return;
      const roots = new Set();
      const add = (node, descend = false) => {
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el?.isConnected || el.closest(ctFavoriteProtectedSelector)) return;
        const control = el.closest(targets);
        if (control) roots.add(control);
        else if (descend) el.querySelectorAll?.(targets).forEach(control => {
          if (!control.closest(ctFavoriteProtectedSelector)) roots.add(control);
        });
      };
      for (const record of records) {
        add(record.target);
        if (record.type === 'childList') record.addedNodes.forEach(node => add(node, true));
      }
      if (!roots.size && style?.isConnected) return;
      // MutationObserver runs before the next paint. This narrow repair cannot
      // wait for the general 100ms scan, and must not observe its own changes.
      watch.disconnect();
      try {
        if (!style?.isConnected) {
          style = ctInstallFavoriteStyle(doc);
          if (style) style.dataset.ctFavoriteWatch = 'true';
        }
        for (const root of roots) patchFavoriteButtons(root);
      } finally { observe(); }
    });
    patchFavoriteButtons(doc);
    observe();
    doc.defaultView.addEventListener('pagehide', () => { active = false; watch.disconnect(); });
    doc.defaultView.addEventListener('pageshow', event => {
      if (!event.persisted || active) return;
      active = true;
      style = ctInstallFavoriteStyle(doc);
      if (style) style.dataset.ctFavoriteWatch = 'true';
      patchFavoriteButtons(doc); observe();
    });
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
  let ctScanFull = false;
  const ctScanRoots = new Set();
  let ctScanConversationPanels = new WeakSet();
  let ctScanConversationPath = location.pathname;
  const ctScanOwnedSelector = '[data-ct-owned],[data-ct-local-ui],#ct-local-tools,#ct-favorites-panel';
  const ctObservedAttributes = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'role', 'aria-label', 'aria-disabled', 'aria-busy', 'aria-hidden', 'hidden', 'placeholder', 'title', 'datetime', 'class', 'src', 'data-app-theme'];

  function ctScanElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function ctMutationChanged(mutation) {
    const el = ctScanElement(mutation.target);
    if (el?.closest(ctScanOwnedSelector)) return false;
    if (typeof ctTimestampOwnMutation === 'function' && ctTimestampOwnMutation(mutation)) return false;
    // The document-start observer already repairs these controls before paint.
    // Its own labels, classes and vector inserts must not start a second scan.
    const favorite = el?.closest(`${ctFavoriteButtonSelector},${ctFavoriteCountSelector}`);
    if (favorite && !favorite.closest(ctFavoriteProtectedSelector) &&
        document.getElementById('ct-favorite-presentation-style')?.dataset.ctFavoriteWatch === 'true') return false;
    if (mutation.type === 'attributes') return mutation.oldValue !== mutation.target.getAttribute(mutation.attributeName);
    if (mutation.type === 'characterData') return mutation.oldValue !== mutation.target.data;
    const changed = [...mutation.addedNodes, ...mutation.removedNodes];
    if (!changed.length || changed.every(node => node.nodeType === Node.ELEMENT_NODE && node.matches(ctScanOwnedSelector))) return false;
    if (mutation.addedNodes.length && mutation.removedNodes.length &&
        changed.every(node => node.nodeType === Node.TEXT_NODE)) {
      return [...mutation.addedNodes].map(node => node.data).join('') !== [...mutation.removedNodes].map(node => node.data).join('');
    }
    return true;
  }

  function ctChangedScanRoot(node) {
    const el = ctScanElement(node);
    if (!el || el.matches('html,body')) return document;
    // A card's author, reply header, media and action rows share identity. Keep
    // that context together rather than scanning unrelated cards in the feed.
    const article = el.closest('article');
    if (article) return article;
    if (typeof ctTimestampDetailContext === 'function') {
      // A conversation's Back/header, scroll area and reply footer determine
      // whether its article timestamps can be shown. Remember a verified panel
      // so invalidating or removing one of those siblings also clears stamps.
      if (ctScanConversationPath === location.pathname) {
        for (let parent = el; parent; parent = parent.parentElement) {
          if (ctScanConversationPanels.has(parent)) return parent;
        }
      }
      const candidate = el.closest('div.animate-fadeIn.flex.flex-col');
      const post = candidate?.querySelector(':scope > div.min-h-0.flex-1.overflow-y-auto article');
      if (post && ctTimestampDetailContext(post) === candidate) return candidate;
    }
    // Grouped notification avatars live outside articles. Their native Follow
    // overlay can be replaced independently, while navigation needs the whole
    // verified avatar wrapper to repair it and retain its own profile link.
    const avatar = typeof ctAvatarWrapperSelector === 'string' ? el.closest(ctAvatarWrapperSelector) : null;
    return avatar || el.closest('[role="dialog"],[role="tablist"],[role="form"],form,nav,aside,header,footer') || el;
  }

  function ctNativeViewElement(el) {
    return !!el && !el.closest('article,[id^="ct-"],[data-ct-owned],[data-ct-local-ui],textarea,input,select,[contenteditable],.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],.whitespace-pre-wrap,.break-words,.wrap-break-word,[translate="no"],.notranslate');
  }

  function ctNativeHomeTabGroup(el) {
    if (!/^\/feed\/?$/.test(location.pathname) || !ctNativeViewElement(el)) return null;
    const group = el.closest('div.overflow-x-auto');
    const header = group?.closest('div.sticky');
    if (!header?.closest('main') || header.closest('article,[data-ct-local-ui],[data-ct-owned]')) return null;
    const buttons = [...group.children];
    return buttons.length >= 2 && buttons.every(button =>
      button.matches('button.rounded-full.whitespace-nowrap') && !button.querySelector('img,p,[data-user-content]')) ? group : null;
  }

  function ctNativeViewChanged(mutation) {
    const el = ctScanElement(mutation.target);
    if (!ctNativeViewElement(el)) return false;
    if (mutation.type === 'attributes') {
      // Switching a view at the same URL affects more than the changed tab:
      // sibling timelines and locally mounted panels need one reconciliation.
      if (mutation.attributeName === 'aria-selected') return el.matches('[role="tab"]') &&
        !!el.closest('[role="tablist"]');
      if (mutation.attributeName === 'aria-current') return el.matches('a,button') &&
        !!el.closest('nav,[role="navigation"],header,aside');
      if (mutation.attributeName === 'role') return ['tab', 'tablist', 'navigation'].includes(mutation.oldValue) ||
        el.matches('[role="tab"],[role="tablist"],[role="navigation"]');
      if (mutation.attributeName === 'class') {
        const group = ctNativeHomeTabGroup(el);
        if (!group || el.parentElement !== group) return false;
        const oldClasses = new Set((mutation.oldValue || '').split(/\s+/));
        const wasSelected = oldClasses.has('bg-sky-500') && oldClasses.has('text-white');
        const selected = el.classList.contains('bg-sky-500') && el.classList.contains('text-white');
        return wasSelected !== selected;
      }
    }
    return mutation.type === 'childList' && (el.matches('[role="tablist"]') || !!ctNativeHomeTabGroup(el));
  }

  function ctRememberScanContexts(root) {
    if (typeof ctTimestampDetailContext !== 'function') return;
    if (ctScanConversationPath !== location.pathname) {
      ctScanConversationPath = location.pathname;
      ctScanConversationPanels = new WeakSet();
    }
    const articles = new Set(root.querySelectorAll?.('article') || []);
    const own = root.closest?.('article');
    if (own) articles.add(own);
    for (const article of articles) {
      const panel = ctTimestampDetailContext(article);
      if (panel?.isConnected) ctScanConversationPanels.add(panel);
    }
  }

  function ctQueueScanRoot(root) {
    if (ctScanFull) return;
    if (root === document || root?.nodeType === Node.DOCUMENT_NODE || !root?.querySelectorAll) {
      ctScanFull = true; ctScanRoots.clear(); return;
    }
    for (const existing of ctScanRoots) {
      if (existing === root || existing.contains(root)) return;
      if (root.contains(existing)) ctScanRoots.delete(existing);
    }
    ctScanRoots.add(root);
    // A large React commit is cheaper and simpler to process once as a page.
    if (ctScanRoots.size > 12) { ctScanFull = true; ctScanRoots.clear(); }
  }

  const observer = new MutationObserver(mutations => {
    if (ctScanning || !ctPageActive || document.hidden) return;
    let changed = false;
    for (const mutation of mutations) {
      if (!ctMutationChanged(mutation)) continue;
      changed = true;
      if ((mutation.type === 'attributes' && mutation.attributeName === 'data-app-theme') || ctNativeViewChanged(mutation)) ctQueueScanRoot(document);
      else if (mutation.type === 'childList' && mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          const el = ctScanElement(node);
          if (el?.isConnected && !el.closest(ctScanOwnedSelector)) ctQueueScanRoot(ctChangedScanRoot(el));
        }
      } else ctQueueScanRoot(ctChangedScanRoot(mutation.target));
    }
    if (changed) ctScheduleScan(null);
  });

  function ctObserve() {
    if (ctPageActive && !document.hidden && document.documentElement) observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, characterDataOldValue: true,
      attributes: true, attributeOldValue: true, attributeFilter: ctObservedAttributes
    });
  }

  function ctRunScan() {
    ctScanTimer = null;
    if (ctScanning || !ctPageActive || document.hidden || !document.body) return;
    const roots = ctScanFull || !ctScanRoots.size ? [document] : [...ctScanRoots].filter(root => root.isConnected);
    ctScanFull = false; ctScanRoots.clear();
    ctScanning = true;
    observer.disconnect();
    try {
      // If every changed node was unmounted before the debounce, a page pass
      // still lets shared modules release their detached state.
      for (const root of roots.length ? roots : [document]) {
        ctRememberScanContexts(root);
        scan(root);
      }
      ctBrowserNotifications?.refresh();
      ctTools?.refresh();
    }
    finally { ctScanning = false; ctObserve(); }
  }

  function ctScheduleScan(root = document) {
    if (!ctPageActive || document.hidden) return;
    if (root !== null) ctQueueScanRoot(root);
    if (ctScanTimer !== null) return;
    ctScanTimer = setTimeout(ctRunScan, 100);
  }

  let ctTools = null;
  let ctBrowserNotifications = null;

  function start() {
    if (ctStarted) return;
    if (document.documentElement.dataset.ctActiveVersion) return;
    document.documentElement.dataset.ctActiveVersion = '6.21.0';
    ctStarted = true;
    ctBrowserNotifications = createBrowserNotifications({ locale: CT_LOCALE });
    document.addEventListener('click', ctCaptureFavoriteClick, true);
    ctDeviceTranslation = createDeviceTranslation({
      locale: CT_LOCALE, getContext: ctOwnTranslationText, isManual: article => ctManualTranslation.has(article),
      isActive: () => ctPageActive && !document.hidden && ctTranslationEngine() === 'device',
      onStatus: ctTranslationStatus, onComplete: ctScheduleScan
    });
    ctTools = installLocalEnhancements({
      locale: CT_LOCALE,
      browserNotifications: ctBrowserNotifications,
      restoreVisibleFavorites: ctRestoreVisibleFavorites,
      getFavoriteHistoryStatus: ctFavoriteHistoryStatus,
      runFavoriteHistory: ctRunFavoriteHistory,
      stopFavoriteHistory: ctStopFavoriteHistory,
      restartFavoriteHistory: ctRestartFavoriteHistory,
      getClassicAppearance: classicAppearanceEnabled,
      setClassicAppearance: enabled => {
        if (!saveJSON('ct-classic-appearance-v1', enabled === true)) throw new Error('Storage unavailable');
        // The toggle itself is synchronous: no frame may retain classic icons,
        // colors or animation after its checkbox has switched off.
        if (typeof patchClassicAppearance === 'function') patchClassicAppearance(document, enabled === true);
        if (typeof patchClassicMotion === 'function') patchClassicMotion(document, enabled === true);
        patchFavoriteButtons(document);
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
      if (document.hidden) {
        observer.disconnect(); clearTimeout(ctScanTimer); ctScanTimer = null;
        ctScanFull = false; ctScanRoots.clear(); ctCancelTranslations();
      } else { ctObserve(); ctScheduleScan(); }
    });
    window.addEventListener('pagehide', () => {
      ctPageActive = false;
      observer.disconnect();
      clearTimeout(ctScanTimer);
      ctScanTimer = null;
      ctScanFull = false; ctScanRoots.clear();
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
