  // Filter only notifications already rendered by Tweet. Native fetching,
  // unread counts, mute decisions, clicks and Follow back remain authoritative.
  const ctNotificationFilters = { bar: null, panel: null, select: null, status: null,
    type: '', uid: undefined, targets: new Set(), bound: new WeakSet() };
  function ctNotificationFilterVisible(el) {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
          node.style.display === 'none' || node.classList.contains('hidden')) return false;
    }
    return true;
  }
  function ctNotificationFilterBar() {
    if (!/^\/notifications\/?$/.test(location.pathname)) return null;
    return [...document.querySelectorAll('main div.flex.items-stretch.sticky')].find(bar => {
      if (!ctNotificationFilterVisible(bar) || bar.closest('[data-ct-local-ui],[data-ct-owned]')) return false;
      const buttons = [...bar.children].filter(el => el.matches('button'));
      return buttons.length === 2 && /^(All|すべて)$/.test(buttons[0].textContent.trim()) &&
        /^(Mentions|メンション|@ツイート)$/.test(buttons[1].textContent.trim());
    }) || null;
  }
  function ctNotificationFilterType(row) {
    // Only the event's direct leading 28px icon counts. A heart or reply icon
    // inside the post preview, badge, quoted tweet or expanded list is content.
    const icon = row.querySelector(':scope > div.shrink-0 > svg[width="28"][height="28"]');
    if (icon?.classList.contains('lucide-message-circle')) return 'reply';
    if (icon?.classList.contains('lucide-heart')) return 'like';
    if (icon?.classList.contains('lucide-repeat-2')) return 'repost';
    if (icon?.classList.contains('lucide-user-plus')) return 'follow';
    // Unknown and system notifications stay visible in every filter.
    return null;
  }
  function ctResetNotificationFilter(remove = false) {
    for (const target of ctNotificationFilters.targets) target.removeAttribute('data-ct-notification-hidden');
    ctNotificationFilters.targets.clear();
    ctNotificationFilters.type = '';
    if (ctNotificationFilters.select) ctNotificationFilters.select.value = '';
    if (remove) {
      ctNotificationFilters.panel?.remove();
      ctNotificationFilters.bar = ctNotificationFilters.panel = ctNotificationFilters.select = ctNotificationFilters.status = null;
    }
  }
  function ctApplyNotificationFilter() {
    if (!ctNotificationFilters.bar?.isConnected || !ctNotificationFilters.panel?.isConnected ||
        ctNotificationFilters.panel.previousElementSibling !== ctNotificationFilters.bar || !ctNotificationFilterBar()) {
      ctResetNotificationFilter(true); return;
    }
    const rows = ctNativeNotificationRows().filter(row =>
      row.closest('main') === ctNotificationFilters.bar.closest('main') &&
      ctNotificationFilterVisible(row));
    const targets = new Set(); let visible = 0; let retained = 0;
    for (const row of rows) {
      const target = row.parentElement.matches('div.border-b') ? row.parentElement : row;
      targets.add(target);
      const type = ctNotificationFilterType(row);
      const hide = !!ctNotificationFilters.type && !!type && type !== ctNotificationFilters.type;
      if (hide) target.setAttribute('data-ct-notification-hidden', 'true');
      else { target.removeAttribute('data-ct-notification-hidden'); visible++; }
      if (!type) retained++;
    }
    for (const target of ctNotificationFilters.targets) {
      if (!targets.has(target)) target.removeAttribute('data-ct-notification-hidden');
    }
    ctNotificationFilters.targets = targets;
    const ja = CT_LOCALE === 'ja';
    const text = ja ? `読み込み済み${rows.length}件中${visible}件を表示${ctNotificationFilters.type && retained ? '（その他の通知も表示）' : ''}` :
      `Showing ${visible} of ${rows.length} loaded notifications${ctNotificationFilters.type && retained ? ' (other notifications included)' : ''}`;
    if (ctNotificationFilters.status.textContent !== text) ctNotificationFilters.status.textContent = text;
  }
  function ctPatchNotificationFilters() {
    const bar = ctNotificationFilterBar();
    const uid = typeof ctNetworkState !== 'undefined' ? ctNetworkState.authUID : null;
    if (!bar) { ctResetNotificationFilter(true); ctNotificationFilters.uid = uid; return; }
    if (bar !== ctNotificationFilters.bar || uid !== ctNotificationFilters.uid ||
        (ctNotificationFilters.panel && (!ctNotificationFilters.panel.isConnected ||
          ctNotificationFilters.panel.previousElementSibling !== bar))) {
      ctResetNotificationFilter(true); ctNotificationFilters.uid = uid;
    }
    if (!ctNotificationFilters.panel) {
      if (!document.getElementById('ct-notification-filter-style')) {
        const style = document.createElement('style'); style.id = 'ct-notification-filter-style';
        style.textContent = `[data-ct-notification-hidden="true"]{display:none!important}
          .ct-notification-filters{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:8px 16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544);font-size:12px}
          .ct-notification-filters label{display:flex;align-items:center;gap:8px;min-width:0}
          .ct-notification-filters select{max-width:100%;min-height:44px;padding:4px 8px;border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;background:var(--color-tl-app-card,#fff);color:inherit;font:inherit;cursor:pointer}
          .ct-notification-filters p{margin:0;color:var(--color-tl-app-text-muted,#657786)}
          .ct-notification-filters select:focus-visible{outline:2px solid var(--color-tl-app-primary,#1da1f2);outline-offset:2px}`;
        document.head.append(style);
      }
      const ja = CT_LOCALE === 'ja';
      const panel = document.createElement('div'); panel.className = 'ct-notification-filters';
      panel.dataset.ctLocalUi = 'notification-filters';
      const label = document.createElement('label'); label.textContent = ja ? '通知の種類' : 'Notification type';
      const select = document.createElement('select'); select.setAttribute('aria-label', label.textContent);
      for (const [value, text] of [['',ja ? '全種類' : 'All types'],['reply',ja ? '返信' : 'Replies'],
        ['like',ja ? 'お気に入り' : 'Favorites'],['repost',ja ? 'リツイート' : 'Retweets'],['follow',ja ? 'フォロー' : 'Follows']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
      }
      label.append(select);
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      panel.append(label, status); bar.after(panel);
      Object.assign(ctNotificationFilters, { bar, panel, select, status });
      select.addEventListener('change', () => {
        ctNotificationFilters.type = select.value; ctApplyNotificationFilter();
      });
      if (!ctNotificationFilters.bound.has(bar)) {
        ctNotificationFilters.bound.add(bar);
        bar.addEventListener('click', event => {
          const button = event.target.closest('button');
          if (button?.parentElement === bar) { ctResetNotificationFilter(); ctApplyNotificationFilter(); }
        }, true);
      }
    }
    ctApplyNotificationFilter();
  }
