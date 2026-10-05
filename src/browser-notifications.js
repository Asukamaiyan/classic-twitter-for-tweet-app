/* Optional page-open alerts. Reads native navigation only; no API polling or Push subscription. */
function createBrowserNotifications({ locale = 'ja' } = {}) {
  const ja = locale.startsWith('ja');
  const copy = ja ? {
    off: 'オフ', on: 'このタブで通知します。', other: '別のタブが通知を担当しています。',
    preparing: '通知の対応状況を確認中…', permission: '通知の許可を確認中…',
    unsupported: 'このブラウザはページ内からの通知に対応していません。',
    insecure: '通知にはHTTPSで開いたページが必要です。',
    locks: 'このブラウザでは複数タブの通知重複を防げないため利用できません。',
    mobile: 'スマホの通知には、対応するWebアプリと有効なサービスワーカーが必要です。Safariの通常タブでは利用できません。',
    signIn: 'Tweetにログインしてから設定してください。',
    denied: 'ブラウザで通知が許可されていません。ブラウザの通知設定を確認してください。',
    gesture: 'この画面のスイッチを押して通知を許可してください。',
    count: '通知数を確実に確認できるまで待機します（99+は対象外）。',
    paused: '画面が停止している間は通知しません。',
    storage: '設定を保存できませんでした。この画面では通知を停止しました。',
    failed: '通知を表示できませんでした。ブラウザの通知設定を確認してください。',
    title: 'Tweet', body: 'Tweetに新しい通知があります。'
  } : {
    off: 'Off', on: 'This tab will show alerts.', other: 'Another tab is handling alerts.',
    preparing: 'Checking notification support…', permission: 'Waiting for notification permission…',
    unsupported: 'This browser cannot show notifications from this page.',
    insecure: 'Notifications require an HTTPS page.',
    locks: 'Alerts are unavailable because duplicate notifications across tabs cannot be prevented here.',
    mobile: 'Mobile notifications need a supported web app and an active service worker. Regular Safari tabs are not supported.',
    signIn: 'Sign in to Tweet before changing this setting.',
    denied: 'Browser notifications are not allowed. Check your browser notification settings.',
    gesture: 'Use the switch on this screen to allow notifications.',
    count: 'Waiting for a reliable unread count (99+ is excluded).',
    paused: 'Alerts stop while this page is suspended.',
    storage: 'Could not save this setting. Alerts have stopped on this page.',
    failed: 'Could not display a notification. Check your browser notification settings.',
    title: 'Tweet', body: 'You have a new notification on Tweet.'
  };
  const prefix = 'ct-browser-notifications-v1:';
  // A late worker completion must never replace or close a newer controller's
  // notification, even after ownership moves between tabs for the same account.
  const instance = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const alertTag = (handle, token) => `ct-native-notifications:${handle}:${instance}:${token}`;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let account = null, enabled = false, busy = false, active = true, destroyed = false;
  let generation = 0, baseline = null, timer = null, notification = null, swAlert = null, issue = '';
  let owner = false, releaseOwner = null, lockPending = false, lastLockAttempt = 0, lastAlert = 0, readyAt = 0;
  let backend = mobile ? null : 'window', probing = false, registration = null;
  let observed = [], signature = '';
  const observer = new MutationObserver(() => refresh());

  function identity() {
    const handles = [];
    for (const button of document.querySelectorAll('aside button[aria-label="Account menu"]')) {
      if (button.closest('[data-ct-local-ui],[data-ct-owned],article')) continue;
      const block = [...button.children].find(el => el.matches('div.flex-1.min-w-0'));
      const label = block && [...block.children].find(el => el.matches('p') &&
        el.classList.contains('text-[0.8125rem]') && el.classList.contains('text-tl-app-text-muted') && el.classList.contains('truncate'));
      const handle = label?.textContent.trim();
      if (handle && /^@[a-zA-Z0-9_.-]{1,80}$/.test(handle)) handles.push(handle.slice(1).toLowerCase());
    }
    const unique = [...new Set(handles)];
    return unique.length === 1 ? unique[0] : null;
  }

  function controls() {
    const found = [];
    for (const svg of document.querySelectorAll('aside nav svg[data-icon],nav[aria-label="Mobile navigation"] > div > button > svg[data-icon]')) {
      if (!/^(bell|bell-filled)$/.test(svg.getAttribute('data-icon') || '') ||
          svg.closest('[data-ct-local-ui],[data-ct-owned],article')) continue;
      const size = svg.getAttribute('width');
      if (size !== svg.getAttribute('height')) continue;
      const button = svg.closest('button');
      if (!button) continue;
      if (size === '18' && svg.parentElement?.matches('span.relative.flex') && svg.parentElement.parentElement === button &&
          button.matches('.w-full.flex.items-center.gap-3\\.5.px-4.py-3.text-left') &&
          [...button.children].some(el => el.matches('span') && /^(Notifications|通知)$/.test(el.textContent.trim()))) {
        found.push({ button, host: svg.parentElement, root: button.closest('nav') });
      } else if (size === '28' && svg.parentElement === button &&
          /^(Notifications|通知)$/.test(button.getAttribute('aria-label') || '') &&
          button.matches('button[type="button"].relative.flex.items-center.justify-center.rounded-2xl')) {
        found.push({ button, host: button, root: button.closest('nav') });
      }
    }
    return found;
  }

  function count(rows) {
    const values = rows.map(({ host }) => {
      const badges = [...host.children].filter(el => el.matches('span.absolute.rounded-full') && el.classList.contains('bg-sky-500'));
      if (!badges.length) return 0;
      if (badges.length !== 1 || !/^\d{1,2}$/.test(badges[0].textContent.trim())) return null;
      return Number(badges[0].textContent.trim());
    });
    return values.length && values.every(value => value !== null && value === values[0]) ? values[0] : null;
  }

  function capability() {
    if (window.isSecureContext !== true) return copy.insecure;
    if (typeof Notification !== 'function' || typeof Notification.requestPermission !== 'function') return copy.unsupported;
    if (typeof navigator.locks?.request !== 'function') return copy.locks;
    if (mobile && !backend) return probing ? copy.preparing : copy.mobile;
    return '';
  }

  function state() {
    const reason = capability();
    const denied = typeof Notification === 'function' && Notification.permission === 'denied';
    return { enabled, busy, supported: !reason, canEnable: !reason && !!account && !denied,
      status: issue || (busy ? copy.permission : reason || (!account ? copy.signIn : denied ? copy.denied :
        !enabled ? copy.off : !active ? copy.paused : baseline === null ? copy.count : owner ? copy.on : copy.other)) };
  }

  function announce() {
    const next = JSON.stringify(state());
    if (next === signature) return;
    signature = next;
    window.dispatchEvent(new CustomEvent('ct-browser-notifications-change'));
  }

  function closeSW(tag, worker) {
    if (tag && typeof worker?.getNotifications === 'function') {
      try {
        Promise.resolve(worker.getNotifications({ tag })).then(items => {
          for (const item of items || []) if (item.tag === tag) item.close();
        }).catch(() => {});
      } catch { /* A detached worker must not interrupt OFF/pagehide cleanup. */ }
    }
  }

  function close() {
    clearTimeout(timer); timer = null;
    try { notification?.close(); } catch {}
    notification = null;
    const record = swAlert; swAlert = null; closeSW(record?.tag, record?.worker);
  }

  function relinquish() {
    generation++; busy = false; close(); baseline = null; owner = false;
    releaseOwner?.(); releaseOwner = null;
  }

  function loadPreference(handle) {
    if (!handle) return false;
    try {
      const value = JSON.parse(localStorage.getItem(prefix + handle) || 'null');
      return value?.version === 1 && value.enabled === true;
    } catch { return false; }
  }

  function persist(value) {
    try { localStorage.setItem(prefix + account, JSON.stringify({ version: 1, enabled: value })); return true; }
    catch { return false; }
  }

  function acquire() {
    if (owner || lockPending || destroyed || !active || !enabled || !account || capability()) return;
    if (Date.now() - lastLockAttempt < 2000) return;
    lastLockAttempt = Date.now(); lockPending = true;
    const expected = account, token = generation;
    Promise.resolve().then(() => navigator.locks.request(prefix + expected, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock || destroyed || !active || !enabled || account !== expected || token !== generation) return;
      owner = true; baseline = count(controls()); readyAt = Date.now() + 2000; announce();
      return new Promise(resolve => { releaseOwner = resolve; });
    })).catch(() => { if (token === generation) issue = copy.failed; }).finally(() => {
      lockPending = false; if (!destroyed) refresh();
    });
  }

  function watch(rows) {
    const roots = enabled && active ? [...new Set([...rows.map(row => row.root),
      ...document.querySelectorAll('aside button[aria-label="Account menu"]')].filter(Boolean))] : [];
    if (roots.length === observed.length && roots.every((root, i) => root === observed[i])) return;
    observer.disconnect(); observed = roots;
    for (const root of roots) observer.observe(root, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['aria-label', 'data-icon'] });
  }

  function deliver(value, expected, token) {
    timer = null;
    if (destroyed || !active || !enabled || !owner || token !== generation || account !== expected ||
        capability() || identity() !== expected || Notification.permission !== 'granted' || count(controls()) !== value ||
        (document.visibilityState !== 'hidden' && document.hasFocus())) return;
    if (Date.now() - lastAlert < 30000) return;
    lastAlert = Date.now();
    try {
      if (backend === 'sw') {
        const tag = alertTag(expected, token), worker = registration; swAlert = { tag, worker };
        Promise.resolve(worker.showNotification(copy.title, { body: copy.body, tag,
          ...('navigate' in Notification.prototype
            ? { navigate: new URL('/notifications', location.origin).href } : {})
        })).then(() => {
          if (destroyed || token !== generation || !active || !enabled) closeSW(tag, worker);
        }, () => { if (token === generation) { issue = copy.failed; announce(); } });
      } else {
        close();
        const current = new Notification(copy.title, { body: copy.body, tag: alertTag(expected, token) });
        notification = current;
        current.onclick = () => {
          if (!destroyed && active && generation === token && account === expected && identity() === expected) {
            window.focus(); controls()[0]?.button.click();
          }
          try { current.close(); } catch {}
          if (notification === current) notification = null;
        };
      }
    } catch { issue = copy.failed; announce(); }
  }

  function refresh() {
    if (destroyed) return;
    const next = identity();
    if (next !== account) {
      relinquish(); account = next; issue = ''; lastLockAttempt = 0; lastAlert = 0;
      enabled = loadPreference(account) && typeof Notification === 'function' && Notification.permission === 'granted';
    }
    if (typeof Notification === 'function' && Notification.permission !== 'granted' && enabled) {
      relinquish(); enabled = false;
    }
    const rows = controls(); watch(rows);
    const value = count(rows);
    if (!enabled || !active || capability()) { baseline = null; announce(); return; }
    acquire();
    if (baseline !== null && value !== null && value > baseline && owner && Date.now() >= readyAt) {
      clearTimeout(timer);
      const expected = account, token = generation;
      timer = setTimeout(() => deliver(value, expected, token), 250);
    } else if (value === null || (baseline !== null && value < baseline)) { clearTimeout(timer); timer = null; }
    baseline = value; announce();
  }

  async function setEnabled(requested, { userGesture = false } = {}) {
    refresh();
    if (destroyed) return false;
    if (!requested) {
      busy = false; relinquish(); enabled = false; watch([]);
      const saved = account ? persist(false) : true;
      issue = saved ? '' : copy.storage; announce(); return saved;
    }
    const reason = capability();
    if (reason || !account) { issue = reason || copy.signIn; announce(); return false; }
    if (!userGesture || navigator.userActivation?.isActive === false) { issue = copy.gesture; announce(); return false; }
    if (busy) return false;
    issue = ''; busy = true; announce();
    const expected = account, token = ++generation;
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (destroyed || !active || generation !== token || identity() !== expected || account !== expected) return false;
      if (permission !== 'granted') { issue = copy.denied; return false; }
      if (!persist(true)) { issue = copy.storage; return false; }
      enabled = true; baseline = count(controls()); lastLockAttempt = 0; refresh(); return true;
    } catch { if (generation === token) issue = copy.failed; return false; }
    finally { if (generation === token) busy = false; announce(); }
  }

  async function probe() {
    if (!mobile || probing || destroyed) return;
    probing = true; announce();
    let next = null;
    try {
      if (ios && !navigator.standalone && !window.matchMedia?.('(display-mode: standalone)').matches) return;
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (destroyed) return;
      const scope = reg?.scope && new URL(reg.scope);
      const script = reg?.active?.scriptURL && new URL(reg.active.scriptURL);
      if (reg?.active && typeof reg.showNotification === 'function' && scope?.origin === location.origin &&
          script?.origin === location.origin && location.pathname.startsWith(scope.pathname)) {
        next = reg;
      }
    } catch { /* An existing worker is optional; never create one here. */ }
    finally {
      probing = false;
      if (!destroyed) {
        if (registration !== next) {
          const lost = !!registration && !next;
          relinquish(); registration = next; backend = next ? 'sw' : null;
          if (lost) enabled = false;
        }
        refresh(); announce();
      }
    }
  }

  function pageHide() { active = false; busy = false; relinquish(); watch([]); announce(); }
  function pageShow() { if (destroyed) return; active = true; baseline = null; lastLockAttempt = 0; probe(); refresh(); }
  function visibility() { baseline = null; clearTimeout(timer); timer = null; refresh(); }
  function storage(event) {
    if (!account || (event.key !== prefix + account && event.key !== null)) return;
    const requested = loadPreference(account);
    if (!requested || !enabled) {
      relinquish(); enabled = requested && typeof Notification === 'function' && Notification.permission === 'granted';
      lastLockAttempt = 0; issue = ''; refresh();
    }
  }
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  window.addEventListener('storage', storage);
  document.addEventListener('visibilitychange', visibility);
  navigator.serviceWorker?.addEventListener?.('controllerchange', probe);
  refresh(); probe();
  return { getState: state, setEnabled, refresh, destroy() {
    if (destroyed) return;
    destroyed = true; active = false; busy = false; enabled = false; relinquish(); observer.disconnect();
    window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow);
    window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visibility);
    navigator.serviceWorker?.removeEventListener?.('controllerchange', probe);
  } };
}
