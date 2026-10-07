// ==UserScript==
// @name         Classic Twitter for tweet.app - English Android
// @namespace    https://tweet.app/
// @version      6.23.1
// @description  Classic Twitter styling and star Favorites, photo slides, notification filters and local tools. Keeps post text, names and drafts intact.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
// @connect      news.yahoo.co.jp
// @connect      news.web.nhk
// @connect      www.nikkansports.com
// @connect      rss.itmedia.co.jp

// @noframes
// @run-at       document-start
// @license      MIT
// @homepageURL  https://github.com/Asukamaiyan/classic-twitter-for-tweet-app
// @supportURL   https://github.com/Asukamaiyan/classic-twitter-for-tweet-app/issues
// ==/UserScript==

(() => {
  'use strict';
  if (document.documentElement?.dataset.ctActiveVersion) return;
  const CT_LOCALE = 'en';
  const CT_PLATFORM = 'android';
    // Shared read-only transport. Authentication stays in memory only for one lookup.
  const ctNetworkState = {
    requestTimeout: 12000,
    authTimeout: 2500,
    authPending: null,
    authUID: null,
    profileTTL: 5 * 60 * 1000,
    profileTimes: new Map(),
    profileFailures: new Map()
  };

  function ctAllowedAPIURL(value) {
    try {
      const url = new URL(value);
      if (url.origin !== 'https://api.tweet.app' || !url.pathname.startsWith('/api/') ||
          url.username || url.password || url.hash) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function requestJSON(url, headers = {}) {
    const target = ctAllowedAPIURL(url);
    if (!target) return Promise.resolve(null);
    const requestHeaders = { Accept: 'application/json' };
    if (typeof headers?.Authorization === 'string' &&
        /^Bearer [A-Za-z0-9._~-]+$/.test(headers.Authorization)) {
      requestHeaders.Authorization = headers.Authorization;
    }

    return new Promise(resolve => {
      let settled = false;
      let handle;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value ?? null);
      };
      const timer = setTimeout(() => {
        finish(null);
        try { handle?.abort?.(); } catch {}
        try { controller?.abort(); } catch {}
      }, ctNetworkState.requestTimeout);
      const parse = response => {
        try {
          if (!response || !(response.status >= 200 && response.status < 300)) return null;
          for (const key of ['finalUrl', 'responseURL']) {
            if (response[key] && ctAllowedAPIURL(response[key]) !== target) return null;
          }
          // Stay may return text in `response`, or expose an unavailable
          // responseText getter. Do not accept manager-specific objects/blobs.
          let body;
          try { body = response.responseText; } catch {}
          if (body == null) body = response.response;
          if (typeof body !== 'string' || body.length > 2 * 1024 * 1024) return null;
          return JSON.parse(body);
        } catch {
          return null;
        }
      };
      // Managers can expose GM as a sandbox binding without a window property.
      const gm = typeof GM !== 'undefined' ? GM : globalThis.GM;
      let gmRequest = null;
      if (typeof GM_xmlhttpRequest === 'function') gmRequest = GM_xmlhttpRequest;
      else if (typeof gm?.xmlHttpRequest === 'function') {
        gmRequest = gm.xmlHttpRequest.bind(gm);
      }
      if (gmRequest) {
        try {
          handle = gmRequest({
            method: 'GET', url: target, headers: requestHeaders,
            timeout: ctNetworkState.requestTimeout, redirect: 'error', anonymous: true,
            responseType: 'text',
            onload: response => finish(parse(response)),
            // Stay's Safari bridge releases its per-request message listener
            // only when onloadend is registered. A final loadend can also
            // supply the response; finish keeps the first result authoritative.
            onloadend: response => finish(parse(response)),
            onerror: () => finish(null), ontimeout: () => finish(null), onabort: () => finish(null)
          });
          if (handle && typeof handle.then === 'function') {
            Promise.resolve(handle).then(response => {
              // An acknowledgement is not the response. Some bridges resolve
              // first, then deliver the HTTP result through onload.
              try {
                if (response && typeof response === 'object' &&
                    Number.isFinite(response.status) && response.status > 0 &&
                    (response.readyState == null || response.readyState === 4)) finish(parse(response));
              } catch { finish(null); }
            }, () => finish(null));
          }
        } catch {
          finish(null);
        }
        return;
      }
      if (typeof fetch !== 'function') return finish(null);
      Promise.resolve().then(() => fetch(target, {
        method: 'GET', headers: requestHeaders, credentials: 'omit', redirect: 'error',
        ...(controller ? { signal: controller.signal } : {})
      })).then(async response => {
        if (!response?.ok || (response.url && ctAllowedAPIURL(response.url) !== target)) return null;
        const body = await response.text();
        if (typeof body !== 'string' || body.length > 2 * 1024 * 1024) return null;
        try { return JSON.parse(body); } catch { return null; }
      }).then(finish, () => finish(null));
    });
  }

  function ctFirebaseKey(key) {
    return typeof key === 'string' && /^firebase:authUser:[A-Za-z0-9_-]{1,128}:\[DEFAULT\]$/.test(key);
  }

  function ctFirebaseAuth(key, value) {
    if (!ctFirebaseKey(key)) return null;
    try {
      if (typeof value === 'string') {
        if (value.length > 128 * 1024) return null;
        value = JSON.parse(value);
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const apiKey = key.split(':')[2];
      if (value.apiKey && value.apiKey !== apiKey) return null;
      const manager = value.stsTokenManager;
      const token = manager?.accessToken;
      const uid = value.uid;
      const expires = Number(manager?.expirationTime || 0);
      if (typeof token !== 'string' || token.length < 40 || token.length > 16384 ||
          !/^[A-Za-z0-9._~-]+$/.test(token) || typeof uid !== 'string' || !uid || uid.length > 256 ||
          (manager?.expirationTime != null && (!Number.isFinite(expires) || expires <= Date.now()))) return null;
      return { token, uid, apiKey, expires };
    } catch {
      return null;
    }
  }

  function ctReadStorageAuth() {
    const found = [];
    for (const name of ['sessionStorage', 'localStorage']) {
      try {
        const storage = globalThis[name];
        if (!storage) continue;
        for (let i = 0; i < Math.min(storage.length, 1024); i += 1) {
          const key = storage.key(i);
          if (!ctFirebaseKey(key)) continue;
          const auth = ctFirebaseAuth(key, storage.getItem(key));
          if (auth) found.push(auth);
        }
      } catch {}
    }
    return found;
  }

  function ctReadIDBAuth() {
    return new Promise(resolve => {
      let done = false;
      let db = null;
      const found = [];
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { db?.close(); } catch {}
        resolve(found);
      };
      const timer = setTimeout(finish, ctNetworkState.authTimeout);
      try {
        if (typeof indexedDB === 'undefined' || typeof IDBKeyRange === 'undefined') return finish();
        const request = indexedDB.open('firebaseLocalStorageDb');
        request.onerror = finish;
        request.onblocked = finish;
        request.onupgradeneeded = () => {
          // Abort creation of a database when Firebase has not initialized it.
          try { request.transaction?.abort(); } catch {}
          try { request.result?.close(); } catch {}
          finish();
        };
        request.onsuccess = () => {
          db = request.result;
          if (done) {
            try { db?.close(); } catch {}
            return;
          }
          try {
            db.onversionchange = finish;
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) return finish();
            const transaction = db.transaction('firebaseLocalStorage', 'readonly');
            transaction.onerror = finish;
            transaction.onabort = finish;
            const range = IDBKeyRange.bound('firebase:authUser:', 'firebase:authUser:\uffff');
            const cursor = transaction.objectStore('firebaseLocalStorage').openCursor(range);
            cursor.onerror = finish;
            let scanned = 0;
            cursor.onsuccess = () => {
              if (done) return;
              const row = cursor.result;
              if (!row || scanned++ >= 128) return finish();
              if (ctFirebaseKey(row.key)) {
                const auth = ctFirebaseAuth(row.key, row.value?.value);
                if (auth) found.push(auth);
              }
              row.continue();
            };
          } catch {
            finish();
          }
        };
      } catch {
        finish();
      }
    });
  }

  function getAuth() {
    if (ctNetworkState.authPending) return ctNetworkState.authPending;
    const pending = Promise.resolve().then(async () => {
      const local = ctReadStorageAuth();
      const candidates = [...local, ...await ctReadIDBAuth()];
      const identities = new Set(candidates.map(auth => `${auth.apiKey}:${auth.uid}`));
      // Never choose an arbitrary account from inconsistent persistence stores.
      const latest = identities.size === 1
        ? candidates.sort((a, b) => b.expires - a.expires)[0] : null;
      const auth = latest ? { token: latest.token, uid: latest.uid } : null;
      if (ctNetworkState.authUID !== (auth?.uid || null)) {
        ctNetworkState.authUID = auth?.uid || null;
        profileCache.clear();
        ctNetworkState.profileTimes.clear();
        ctNetworkState.profileFailures.clear();
        // Identity can finish loading after the current DOM scan. Revisit
        // account-scoped panels even when no native node changes afterward.
        if (typeof ctScheduleScan === 'function') ctScheduleScan();
      }
      return auth;
    }).catch(() => null).finally(() => {
      if (ctNetworkState.authPending === pending) ctNetworkState.authPending = null;
    });
    ctNetworkState.authPending = pending;
    return pending;
  }

  function getCachedAuth() {
    // Kept for Safari callers; only simultaneous lookups are shared.
    return getAuth();
  }

  function ctProfileFromJSON(json, username) {
    if (!json || typeof json !== 'object' || Array.isArray(json) || json.success === false || json.error) return null;
    const user = json.user ?? json.profile ?? json.data?.user ?? json.data?.profile ?? json.data ?? json;
    if (!user || typeof user !== 'object' || Array.isArray(user) || user.error) return null;
    const handle = String(user.username || user.handle || '').replace(/^@/, '').toLowerCase();
    if (handle && handle !== username) return null;
    const identity = user.id || user.uid || user.userId || handle;
    const display = typeof user.displayName === 'string' || typeof user.name === 'string' || handle;
    return identity && display ? user : null;
  }

  function fetchProfile(username) {
    const key = String(username ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_.-]{1,80}$/.test(key)) return Promise.resolve(null);
    if (profilePending.has(key)) return profilePending.get(key);
    const promise = Promise.resolve().then(async () => {
      const auth = await getAuth();
      if (!auth?.token) return null;
      const now = Date.now();
      if (profileCache.has(key) && now - (ctNetworkState.profileTimes.get(key) || 0) < ctNetworkState.profileTTL) {
        return profileCache.get(key);
      }
      const failure = ctNetworkState.profileFailures.get(key);
      if (failure && now < failure.nextTry) return null;
      const json = await requestJSON(PROFILE_API + encodeURIComponent(key), { Authorization: `Bearer ${auth.token}` });
      if (ctNetworkState.authUID !== auth.uid) return null;
      const user = ctProfileFromJSON(json, key);
      if (user) {
        if (profileCache.size >= 300 && !profileCache.has(key)) {
          const oldest = profileCache.keys().next().value;
          profileCache.delete(oldest);
          ctNetworkState.profileTimes.delete(oldest);
        }
        profileCache.set(key, user);
        ctNetworkState.profileTimes.set(key, Date.now());
        ctNetworkState.profileFailures.delete(key);
        return user;
      }
      profileCache.delete(key);
      ctNetworkState.profileTimes.delete(key);
      const count = Math.min((failure?.count || 0) + 1, 6);
      if (ctNetworkState.profileFailures.size >= 300 && !ctNetworkState.profileFailures.has(key)) {
        ctNetworkState.profileFailures.delete(ctNetworkState.profileFailures.keys().next().value);
      }
      // The next normal UI pass may retry; no background or recursive retry loop.
      ctNetworkState.profileFailures.set(key, { count, nextTry: Date.now() + Math.min(5000 * 2 ** (count - 1), 120000) });
      return null;
    }).catch(() => null).finally(() => {
      if (profilePending.get(key) === promise) profilePending.delete(key);
    });
    profilePending.set(key, promise);
    return promise;
  }

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

  /* Local-only additions. Embedded by the build inside each userscript's IIFE. */
function installLocalEnhancements({ locale = 'ja', getClassicAppearance, setClassicAppearance, getAutoTranslate, setAutoTranslate, getTranslationEngine, setTranslationEngine, deviceTranslationSupported = false, prepareDeviceTranslation, getTranslationStatus, restoreVisibleFavorites, getFavoriteHistoryStatus, runFavoriteHistory, stopFavoriteHistory, restartFavoriteHistory, browserNotifications } = {}) {
  const existing = document.getElementById('ct-local-tools');
  if (existing) return existing.ctController;
  const ja = locale.startsWith('ja');
  const copy = ja ? {
    tools: '便利ツール', title: '便利ツール', close: '閉じる',
    appearance: '昔のTwitterの表示', classic: 'クラシック表示を使う', classicHelp: '青いナビゲーションと星のお気に入り。オフにするとハート・いいね表記・Tweet標準の色や形に戻ります。日本語化と便利機能はそのまま使えます。動きを減らす端末設定にも対応します。',
    scope: '表示設定・キーワード・保存検索・保存投稿は、このブラウザ内で共有します。お気に入りの履歴はログインアカウント別です。',
    filters: 'キーワードで折りたたむ', enabled: 'キーワードフィルターを有効にする',
    words: 'キーワード（1 行に 1 件）', help: '投稿本文に含まれる語句を、大文字・小文字を区別せず照合します。最大 30 件、各 80 文字。',
    save: 'フィルターを保存', saved: '設定を保存しました。', searches: '保存した検索',
    query: '保存する検索語', add: '検索を保存', remove: '削除', noSearches: '保存した検索はありません。',
    searchHelp: '最大 20 件。検索語を押すと検索画面で検索します。',
    collapsed: 'キーワードに一致した投稿を折りたたみました。', reveal: 'この投稿を表示',
    invalidWords: 'キーワードは 30 件以内、各 80 文字以内で入力してください。',
    invalidSearch: '検索語は 1〜200 文字、保存は 20 件以内です。',
    duplicate: 'この検索語は保存済みです。',
    storageError: 'このブラウザに保存できませんでした。設定は変更されていません。ブラウザの保存設定を確認してください。',
    storageConflict: '別のタブで保存内容が変更されました。上書きを防ぐため保存を中止しました。入力中の内容を控えてから再読み込みしてください。',
    readError: '保存済み設定を読み込めませんでした。初期設定で開始しました。',
    searchError: '自動検索を開始できませんでした。検索画面で次の検索語を入力してください：',
    automatic: '投稿を自動翻訳する', autoHelp: '選択した方法で投稿を順番に翻訳します。サイトの翻訳でエラーが出た場合は5分間休止します。',
    autoError: '自動翻訳の設定を保存できませんでした。',
    translationEngine: '翻訳方法', nativeEngine: 'サイトの翻訳', deviceEngine: '端末内の翻訳',
    deviceHelp: '対応するデスクトップChrome用。翻訳モデルをダウンロードし、投稿本文は端末内で処理します。サイトの翻訳回数を消費しません。モデルは言語ごとに準備してください。',
    deviceUnsupported: 'このブラウザでは端末内翻訳を利用できません。Safari／Stayとスマートフォンではサイトの翻訳をご利用ください。',
    sourceLanguage: '翻訳する投稿の言語', prepareModel: 'モデルを準備', preparingModel: '準備中…',
    translationStatus: '翻訳の状態',
    notifications: 'ページを開いている間の通知', notificationsEnabled: '通知数が増えたらお知らせする',
    notificationsHelp: 'ページを閉じる・スマホが画面を停止すると届きません。投稿内容や名前は通知に出しません。',
    notificationsError: '通知の設定を変更できませんでした。',
    favorites: 'お気に入りの復元', restoreFavorites: '読み込み済みのお気に入りを復元', restoringFavorites: '確認中…',
    restoreHelp: '今の画面で読み込んだお気に入り済みのツイートを、このブラウザに保存します（1回40件まで）。過去の全履歴は取得できません。',
    restoreResult: (saved, unresolved) => `${saved}件を保存しました。${unresolved ? ` ${unresolved}件は特定できませんでした。詳細画面か原文を開いて再度お試しください。` : ''}`,
    restoreError: 'お気に入りを確認できませんでした。ログイン状態と通信を確認して、もう一度お試しください。',
    history: '過去のお気に入りを探す', historyStart: '過去の投稿から探す', historyContinue: '続きから探す', historyStop: '一時停止', historyRestart: '最初から探し直す',
    historyHelp: 'おすすめ・フォロー中の過去ページを順に確認します。画面を開いたまま使い、1回100ページまで。取得できるタイムラインの範囲で復元するため、全お気に入りを保証するものではありません。保存済みのお気に入りの件数・期間・確認範囲はプロフィールで表示します。',
    historyProgress: (s) => `${s.pages || 0}ページ・${s.scanned || 0}件を確認／${s.recovered || 0}件を追加。${s.busy ? '確認中…' : s.done ? '取得できるタイムラインの終端まで確認しました。' : s.paused ? '一時停止中です。' : ''}`,
    historyError: '通信・ログイン・保存状態を確認し、続きから再試行してください。',
    historyErrors: {'sign-in':'Tweetにログインしてから開始してください。','account-changed':'アカウントが変わったため停止しました。','response':'投稿を確認できませんでした。少し待って続きからお試しください。','cursor':'次のページを確認できませんでした。最初から探し直してください。','network':'通信できませんでした。少し待って続きからお試しください。','checkpoint':'続きの位置を保存できませんでした。','storage':'保存容量に達しました。プロフィールのお気に入りでJSONバックアップしてください。'},

    bookmarks: '保存した投稿', bookmarkLabel: '投稿のメモ（任意）', bookmarkSave: 'この投稿を保存',
    bookmarkHelp: '投稿の詳細画面を開くと保存できます。最大 50 件。削除された投稿や非公開の投稿は閲覧できない場合があります。',
    noBookmarks: '保存した投稿はありません。', bookmarkMissing: '先に投稿の詳細画面を開いてください。',
    bookmarkFull: '投稿は 50 件まで、メモは 200 文字以内です。', bookmarkDuplicate: 'この投稿は保存済みです。',
    post: '投稿',
  } : {
    tools: 'Tools', title: 'Tools', close: 'Close',
    appearance: 'Classic Twitter appearance', classic: 'Use classic appearance', classicHelp: 'Blue navigation and star favorites. Turn off to restore hearts, Like wording and Tweet’s original colors and shapes. Other tools remain available. Respects your reduced motion preference.',
    scope: 'Appearance, keywords, saved searches and saved links are shared within this browser. Favorites history is saved separately for each signed-in account.',
    filters: 'Collapse by keyword', enabled: 'Enable keyword filters',
    words: 'Keywords (one per line)', help: 'Matches phrases in post text, ignoring case. Up to 30 keywords, 80 characters each.',
    save: 'Save filters', saved: 'Settings saved.', searches: 'Saved searches',
    query: 'Search to save', add: 'Save search', remove: 'Remove', noSearches: 'No saved searches yet.',
    searchHelp: 'Save up to 20 searches. Select a search to open it in Explore.',
    collapsed: 'Post collapsed because it matches a keyword.', reveal: 'Show this post',
    invalidWords: 'Enter up to 30 keywords, with up to 80 characters each.',
    invalidSearch: 'Use 1–200 characters per search, and save up to 20 searches.',
    duplicate: 'This search is already saved.',
    storageError: 'Could not save in this browser. Settings have not changed. Check browser storage settings.',
    storageConflict: 'Saved data changed in another tab. Nothing was overwritten. Keep a copy of your edits, then reload before saving.',
    readError: 'Could not read saved settings. Started with the defaults.',
    searchError: 'Could not start the search automatically. Enter this query in Explore:',
    automatic: 'Automatically translate posts', autoHelp: 'Translates posts one at a time with the selected engine. Site errors pause automatic requests for 5 minutes.',
    autoError: 'Could not save the automatic translation setting.',
    translationEngine: 'Translation engine', nativeEngine: 'Site translation', deviceEngine: 'On-device translation',
    deviceHelp: 'For supported desktop Chrome browsers. Downloads models and translates post text on your device without using the site’s translation allowance. Prepare each source language separately.',
    deviceUnsupported: 'On-device translation is unavailable here. Use site translation in Safari/Stay and on mobile.',
    sourceLanguage: 'Language of posts to translate', prepareModel: 'Prepare model', preparingModel: 'Preparing…',
    translationStatus: 'Translation status',
    notifications: 'Alerts while Tweet is open', notificationsEnabled: 'Alert when the unread count increases',
    notificationsHelp: 'Alerts stop when you close the page or your phone suspends it. Names and post text are never included.',
    notificationsError: 'Could not change the notification setting.',
    favorites: 'Restore Favorites', restoreFavorites: 'Restore loaded Favorites', restoringFavorites: 'Checking…',
    restoreHelp: 'Save already-favorited Tweets loaded on this screen in this browser (up to 40 per run). This cannot retrieve your entire past history.',
    restoreResult: (saved, unresolved) => `Saved ${saved}. ${unresolved ? `${unresolved} could not be identified. Open the detail page or original text and try again.` : ''}`,
    restoreError: 'Could not check Favorites. Check your sign-in and connection, then try again.',
    history: 'Find older Favorites', historyStart: 'Search older posts', historyContinue: 'Continue searching', historyStop: 'Pause', historyRestart: 'Search again from the start',
    historyHelp: 'Checks older For you and Following pages in order, up to 100 pages per run while this tab is visible. Recovery covers the timelines the service returns and cannot guarantee your entire Favorites history. Your profile shows saved Favorites, their date range and recovery coverage.',
    historyProgress: (s) => `Checked ${s.pages || 0} pages / ${s.scanned || 0} posts; added ${s.recovered || 0}. ${s.busy ? 'Checking…' : s.done ? 'Reached the end of the timelines returned by the service.' : s.paused ? 'Paused.' : ''}`,
    historyError: 'Check your connection, sign-in and storage, then continue to retry.',
    historyErrors: {'sign-in':'Sign in to Tweet before starting.','account-changed':'Stopped because the account changed.','response':'Could not check posts. Wait a little, then continue.','cursor':'Could not verify the next page. Search again from the start.','network':'Connection failed. Wait a little, then continue.','checkpoint':'Could not save the resume position.','storage':'Browser storage is full. Back up Favorites as JSON on your profile.'},

    bookmarks: 'Saved posts', bookmarkLabel: 'Note for this post (optional)', bookmarkSave: 'Save this post',
    bookmarkHelp: 'Open a post’s detail page to save it. Up to 50 posts. Deleted or private posts may be unavailable later.',
    noBookmarks: 'No saved posts yet.', bookmarkMissing: 'Open a post’s detail page first.',
    bookmarkFull: 'Save up to 50 posts, with notes of up to 200 characters.', bookmarkDuplicate: 'This post is already saved.',
    post: 'Post',
  };
  const storageKey = 'ct-local-tools-v1';
  const searchIntentKey = 'ct-local-search-intent-v1';
  const normalize = value => String(value).normalize('NFKC').toLowerCase();
  const unique = values => values.filter((value, index, all) =>
    all.findIndex(other => normalize(other) === normalize(value)) === index);
  const postPathPattern = /^\/post\/[A-Za-z0-9_-]{1,200}$/;
  let state = { version: 1, enabled: false, keywords: [], searches: [], bookmarks: [] };
  let loadError = '';
  let lastSavedRaw = null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    lastSavedRaw = raw;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || typeof parsed.enabled !== 'boolean' ||
          !Array.isArray(parsed.keywords) || !Array.isArray(parsed.searches) ||
          parsed.keywords.length > 30 || parsed.searches.length > 20 ||
          parsed.keywords.some(s => typeof s !== 'string' || !s.trim() || s.length > 80) ||
          parsed.searches.some(s => typeof s !== 'string' || !s.trim() || s.length > 200) ||
          (parsed.bookmarks !== undefined && (!Array.isArray(parsed.bookmarks) || parsed.bookmarks.length > 50 ||
            parsed.bookmarks.some(item => !item || typeof item.path !== 'string' || !postPathPattern.test(item.path) ||
              typeof item.label !== 'string' || !item.label.trim() || item.label.length > 200)))) {
        throw new Error('Invalid local settings');
      }
      state = { version: 1, enabled: parsed.enabled,
        keywords: unique(parsed.keywords.map(s => s.trim())),
        searches: unique(parsed.searches.map(s => s.trim())),
        bookmarks: (parsed.bookmarks || []).filter((item, index, all) => all.findIndex(other => other.path === item.path) === index)
          .map(item => ({ path: item.path, label: item.label.trim() })) };
    }
  } catch { loadError = copy.readError; }

  function element(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  const style = element('style');
  style.id = 'ct-local-tools-style';
  style.textContent = `
    #ct-local-tools { --ct-base-gap:76px; position:fixed; right:max(12px, env(safe-area-inset-right)); bottom:calc(var(--ct-root-gap, var(--ct-base-gap)) + var(--ct-keyboard-offset, 0px) + env(safe-area-inset-bottom)); z-index:40; font:14px/1.5 system-ui,sans-serif; color:var(--color-tl-app-text, #17202a); }
    #ct-local-tools * { box-sizing:border-box; }
    #ct-local-tools button, #ct-local-tools a, .ct-keyword-notice button { font:inherit; cursor:pointer; }
    #ct-local-tools button, .ct-keyword-notice button { border:1px solid var(--color-tl-app-border, #b8c5d1); border-radius:8px; padding:9px 12px; color:inherit; background:var(--color-tl-app-card, #fff); min-height:44px; }
    #ct-local-tools button:focus-visible, #ct-local-tools a:focus-visible, #ct-local-tools input:focus-visible, #ct-local-tools select:focus-visible, #ct-local-tools textarea:focus-visible, .ct-keyword-notice button:focus-visible { outline:3px solid var(--color-tl-app-primary, #1688d4); outline-offset:2px; }
    #ct-local-tools button:active:not(:disabled) { transform:translateY(1px); }
    #ct-local-tools button[type=submit] { border-color:var(--color-tl-app-primary, #1688d4); font-weight:650; }
    #ct-local-tools button:disabled { opacity:.55; cursor:default; }
    #ct-local-tools-toggle { box-shadow:0 2px 12px #0002; font-weight:650; }
    #ct-local-tools-panel { display:flex; flex-direction:column; position:absolute; bottom:52px; right:0; width:min(370px, calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right))); max-height:calc(var(--ct-view-height, 100dvh) - var(--ct-root-gap, var(--ct-base-gap)) - 72px - env(safe-area-inset-bottom)); overflow:hidden; border:1px solid var(--color-tl-app-border, #b8c5d1); border-radius:12px; background:var(--color-tl-app-card, #fff); box-shadow:0 6px 28px #0003; animation:ct-tools-enter 160ms ease-out; }
    #ct-local-tools [hidden] { display:none !important; }
    #ct-local-tools header { display:flex; flex-shrink:0; gap:12px; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--color-tl-app-border, #b8c5d1); }
    #ct-local-tools-body { min-height:0; overflow:auto; overscroll-behavior:contain; padding:0 16px 16px; scroll-padding:12px; }
    #ct-local-tools footer { flex-shrink:0; max-height:calc(var(--ct-view-height, 100dvh) * .25); overflow:auto; padding:10px 16px; border-top:1px solid var(--color-tl-app-border, #b8c5d1); }
    #ct-local-tools h2, #ct-local-tools h3 { margin:0; font-size:16px; font-weight:700; }
    #ct-local-tools section { margin-top:16px; padding-top:16px; border-top:1px solid var(--color-tl-app-border, #b8c5d1); }
    #ct-local-tools p { margin:6px 0; }
    #ct-local-tools .ct-local-note { font-size:12px; color:var(--color-tl-app-text-muted, #536471); }
    #ct-local-tools label { display:block; margin:10px 0 5px; }
    #ct-local-tools input[type=text], #ct-local-tools textarea { display:block; width:100%; padding:9px; border:1px solid var(--color-tl-app-border, #b8c5d1); border-radius:8px; font:16px/1.5 system-ui,sans-serif; color:inherit; background:var(--color-tl-app-input-bg, #fff); }
    #ct-local-tools textarea { min-height:85px; resize:vertical; }
    #ct-local-tools input[type=checkbox] { display:inline-block; width:18px; height:18px; padding:0; vertical-align:middle; margin-inline-end:8px; accent-color:var(--color-tl-app-primary, #1688d4); }
    #ct-local-tools label:has(input[type=checkbox]) { display:flex; align-items:center; min-height:44px; margin:4px 0; cursor:pointer; }
    #ct-local-tools [aria-invalid=true] { border-color:var(--color-tl-app-danger, #c23636); }
    #ct-local-tools form > button { margin-top:8px; }
    #ct-local-tools ul { padding:0; margin:8px 0; list-style:none; }
    #ct-local-tools li { display:flex; align-items:center; gap:10px; padding:5px 0; }
    #ct-local-tools li a { display:flex; align-items:center; flex:1; min-width:0; min-height:44px; overflow-wrap:anywhere; color:inherit; text-decoration:underline; padding:5px 0; }
    #ct-local-tools #ct-local-tools-status { margin:0; font-size:13px; overflow-wrap:anywhere; }
    #ct-local-tools-status[data-error=true] { color:var(--color-tl-app-danger, #c23636); }
    article.ct-keyword-collapsed > :not(.ct-keyword-notice) { display:none !important; }
    .ct-keyword-notice { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 0; font:13px/1.5 system-ui,sans-serif; }
    .ct-keyword-notice span { flex:1; min-width:140px; }
    @media (min-width:1024px) { #ct-local-tools { --ct-base-gap:20px; } }
    @media (hover:hover) { #ct-local-tools button:hover:not(:disabled) { background:var(--color-tl-app-secondary-button-bg, #f1f5f9); } }
    @keyframes ct-tools-enter { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
    @media (prefers-reduced-motion:reduce) { #ct-local-tools-panel { animation:none; } #ct-local-tools button:active:not(:disabled) { transform:none; } }
  `;
  document.head.append(style);
  const root = element('aside', undefined, { id: 'ct-local-tools', 'data-ct-local-ui': '', 'aria-label': copy.tools });
  const toggle = element('button', copy.tools, { id: 'ct-local-tools-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ct-local-tools-panel' });
  const panel = element('div', undefined, { id: 'ct-local-tools-panel', role: 'region', 'aria-labelledby': 'ct-local-tools-title' });
  panel.hidden = true;
  const header = element('header');
  const title = element('h2', copy.title, { id: 'ct-local-tools-title' });
  const close = element('button', copy.close, { type: 'button' });
  header.append(title, close);
  const status = element('p', loadError, { id: 'ct-local-tools-status', role: 'status', 'aria-live': 'polite' });
  if (loadError) status.dataset.error = 'true';
  const body = element('div', undefined, { id: 'ct-local-tools-body' });
  const footer = element('footer', undefined, { tabindex: '0', 'aria-labelledby': 'ct-local-tools-status' });
  footer.append(status);
  footer.hidden = !loadError;
  body.append(element('p', copy.scope, { class: 'ct-local-note' }));
  panel.append(header, body, footer);
  root.append(toggle, panel);
  document.body.append(root);

  function openPanel(open, moveFocus = true) {
    if (open) { updateBookmarkControl(); refreshAppearance(); }
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && moveFocus) close.focus({ preventScroll: true });
    if (!open && panel.contains(document.activeElement)) toggle.focus();
  }
  toggle.addEventListener('click', () => openPanel(panel.hidden));
  close.addEventListener('click', () => openPanel(false));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); openPanel(false); }
  });
  function announce(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
    footer.hidden = !message;
  }
  function persist(next) {
    try {
      // A stale tab must not erase another tab's searches, bookmarks or filters.
      if (window.localStorage.getItem(storageKey) !== lastSavedRaw) {
        announce(copy.storageConflict, true);
        return false;
      }
      const raw = JSON.stringify(next);
      window.localStorage.setItem(storageKey, raw);
      lastSavedRaw = raw;
    }
    catch { announce(copy.storageError, true); return false; }
    state = next;
    announce(copy.saved);
    return true;
  }
  function invalidInput(input, message) {
    input.setAttribute('aria-invalid', 'true');
    announce(message, true);
    input.focus();
  }
  function clearInvalid(event) { event.target.removeAttribute('aria-invalid'); }

  let refreshBrowserNotifications = () => {};
  if (typeof browserNotifications?.getState === 'function' && typeof browserNotifications?.setEnabled === 'function') {
    const section = element('section');
    const input = element('input', undefined, { type: 'checkbox', id: 'ct-local-browser-notifications',
      'aria-describedby': 'ct-local-browser-notifications-help ct-local-browser-notifications-status' });
    const label = element('label'); label.append(input, document.createTextNode(copy.notificationsEnabled));
    const status = element('p', '', { id: 'ct-local-browser-notifications-status', class: 'ct-local-note', role: 'status', 'aria-live': 'polite' });
    refreshBrowserNotifications = () => {
      const current = browserNotifications.getState();
      input.checked = current.enabled === true;
      input.disabled = current.busy === true || (!current.canEnable && !current.enabled);
      if (status.textContent !== current.status) status.textContent = current.status || '';
    };
    input.addEventListener('change', async () => {
      const requested = input.checked;
      try {
        const pending = browserNotifications.setEnabled(requested, { userGesture: true });
        refreshBrowserNotifications(); await pending;
      } catch { announce(copy.notificationsError, true); }
      finally { refreshBrowserNotifications(); }
    });
    section.append(element('h3', copy.notifications), label,
      element('p', copy.notificationsHelp, { id: 'ct-local-browser-notifications-help', class: 'ct-local-note' }), status);
    body.append(section);
    window.addEventListener('ct-browser-notifications-change', refreshBrowserNotifications);
    refreshBrowserNotifications();
  }

  let refreshAppearance = () => {};
  if (typeof getClassicAppearance === 'function' && typeof setClassicAppearance === 'function') {
    const section = element('section');
    const label = element('label');
    const input = element('input', undefined, { type: 'checkbox', id: 'ct-local-classic-appearance', 'aria-describedby': 'ct-local-classic-help' });
    refreshAppearance = () => { input.checked = !!getClassicAppearance(); };
    refreshAppearance();
    label.append(input, document.createTextNode(copy.classic));
    section.append(element('h3', copy.appearance), label, element('p', copy.classicHelp, { id: 'ct-local-classic-help', class: 'ct-local-note' }));
    input.addEventListener('change', () => {
      const requested = input.checked;
      try {
        if (setClassicAppearance(requested) === false || !!getClassicAppearance() !== requested) throw new Error('Setting was not saved');
        announce(copy.saved);
      } catch { announce(copy.storageError, true); }
      refreshAppearance();
    });
    body.append(section);
  }

  let refreshTranslation = () => {};
  if (typeof getAutoTranslate === 'function' && typeof setAutoTranslate === 'function') {
    const automatic = element('section');
    const label = element('label');
    const input = element('input', undefined, { type: 'checkbox', id: 'ct-local-auto-translate' });
    try { input.checked = !!getAutoTranslate(); } catch { input.checked = false; }
    label.append(input, document.createTextNode(copy.automatic));
    automatic.append(label, element('p', copy.autoHelp, { class: 'ct-local-note' }));
    input.addEventListener('change', () => {
      const requested = input.checked;
      try {
        if (setAutoTranslate(requested) === false || !!getAutoTranslate() !== requested) throw new Error('Setting was not saved');
        announce(copy.saved);
      } catch {
        try { input.checked = !!getAutoTranslate(); } catch { input.checked = !requested; }
        announce(copy.autoError, true);
      }
    });
    if (typeof getTranslationEngine === 'function' && typeof setTranslationEngine === 'function') {
      const engine = element('select', undefined, { id: 'ct-local-translation-engine' });
      engine.style.cssText = 'width:100%;min-height:44px;font:inherit;color:inherit;background:var(--color-tl-app-card,#fff);border:1px solid var(--color-tl-app-border,#b8c5d1);border-radius:8px;padding:6px';
      engine.append(element('option', copy.nativeEngine, { value: 'native' }), element('option', copy.deviceEngine, { value: 'device' }));
      engine.options[1].disabled = !deviceTranslationSupported;
      engine.value = getTranslationEngine();
      const device = element('div');
      device.append(element('p', deviceTranslationSupported ? copy.deviceHelp : copy.deviceUnsupported, { class: 'ct-local-note' }));
      const source = element('select', undefined, { id: 'ct-local-translation-source' });
      source.style.cssText = engine.style.cssText;
      const languages = [['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'], ['zh-Hant', '繁體中文'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['ru', 'Русский'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'], ['th', 'ไทย'], ['vi', 'Tiếng Việt']];
      for (const [value, label] of languages) source.append(element('option', label, { value }));
      source.value = (navigator.language || locale).startsWith('en') ? 'ja' : 'en';
      const prepare = element('button', copy.prepareModel, { type: 'button', id: 'ct-local-translation-prepare' });
      source.disabled = prepare.disabled = !deviceTranslationSupported;
      device.append(element('label', copy.sourceLanguage, { for: source.id }), source, prepare);
      const translationStatus = element('p', '', { id: 'ct-local-translation-status', role: 'status', 'aria-live': 'polite', 'aria-label': copy.translationStatus, class: 'ct-local-note' });
      refreshTranslation = () => {
        const message = getTranslationStatus?.() || '';
        if (translationStatus.textContent !== message) translationStatus.textContent = message;
        device.hidden = engine.value !== 'device';
      };
      engine.addEventListener('change', () => {
        try {
          if (setTranslationEngine(engine.value) === false || getTranslationEngine() !== engine.value) throw new Error('Setting was not saved');
          announce(copy.saved);
        } catch { engine.value = getTranslationEngine(); announce(copy.autoError, true); }
        refreshTranslation();
      });
      prepare.addEventListener('click', async () => {
        prepare.disabled = true; source.disabled = true; prepare.textContent = copy.preparingModel;
        try { await prepareDeviceTranslation?.(source.value); }
        catch { announce(copy.autoError, true); }
        finally { prepare.disabled = source.disabled = !deviceTranslationSupported; prepare.textContent = copy.prepareModel; refreshTranslation(); }
      });
      automatic.append(element('label', copy.translationEngine, { for: engine.id }), engine,
        ...(!deviceTranslationSupported ? [element('p', copy.deviceUnsupported, { class: 'ct-local-note' })] : []), device, translationStatus);
      refreshTranslation();
    }
    body.append(automatic);
  }

  let refreshFavoriteHistory = () => {};
  if (typeof getFavoriteHistoryStatus === 'function' && typeof runFavoriteHistory === 'function' &&
      typeof stopFavoriteHistory === 'function' && typeof restartFavoriteHistory === 'function') {
    const section = element('section');
    const status = element('p', '', {id:'ct-history-status',role:'status','aria-live':'polite',class:'ct-local-note'});
    const run = element('button', copy.historyStart, {type:'button',id:'ct-history-run','aria-describedby':'ct-history-help'});
    const stop = element('button', copy.historyStop, {type:'button',id:'ct-history-stop'});
    const restart = element('button', copy.historyRestart, {type:'button',id:'ct-history-restart'});
    refreshFavoriteHistory = () => {
      const state = getFavoriteHistoryStatus() || {};
      run.disabled = !!state.busy || !!state.done;
      run.textContent = state.pages ? copy.historyContinue : copy.historyStart;
      stop.disabled = !state.busy; restart.disabled = !!state.busy;
      const issue = state.error || state.warning;
      status.textContent = copy.historyProgress(state) + (issue ? ` ${copy.historyErrors[issue] || copy.historyError}` : '');
    };
    const invoke = async callback => {
      try { const pending = callback(); refreshFavoriteHistory(); await pending; }
      catch { announce(copy.historyError, true); }
      finally { refreshFavoriteHistory(); }
    };
    run.addEventListener('click', () => invoke(runFavoriteHistory));
    stop.addEventListener('click', () => invoke(stopFavoriteHistory));
    restart.addEventListener('click', () => invoke(restartFavoriteHistory));
    section.append(element('h3',copy.history),element('p',copy.historyHelp,{id:'ct-history-help',class:'ct-local-note'}),run,stop,restart,status);
    body.append(section);
    window.addEventListener('ct-favorite-history-change', refreshFavoriteHistory);
    refreshFavoriteHistory();
  }

  if (typeof restoreVisibleFavorites === 'function') {
    const section = element('section');
    const restore = element('button', copy.restoreFavorites, {type:'button',id:'ct-restore-favorites','aria-describedby':'ct-restore-favorites-help'});
    restore.addEventListener('click', async () => {
      restore.disabled = true; restore.textContent = copy.restoringFavorites;
      try {
        const result = await restoreVisibleFavorites();
        if (result) announce(copy.restoreResult(result.saved, result.unresolved));
      } catch { announce(copy.restoreError, true); }
      finally { restore.disabled = false; restore.textContent = copy.restoreFavorites; }
    });
    section.append(element('h3',copy.favorites),element('p',copy.restoreHelp,{id:'ct-restore-favorites-help',class:'ct-local-note'}),restore);
    body.append(section);
  }

  const filterSection = element('section');
  const filterForm = element('form');
  const enabledLabel = element('label');
  const enabled = element('input', undefined, { type: 'checkbox', id: 'ct-local-filter-enabled' });
  enabled.checked = state.enabled;
  enabledLabel.append(enabled, document.createTextNode(copy.enabled));
  const keywords = element('textarea', undefined, { id: 'ct-local-keywords', rows: '3', 'aria-describedby': 'ct-local-keyword-help ct-local-tools-status', spellcheck: 'false' });
  keywords.addEventListener('input', clearInvalid);
  keywords.value = state.keywords.join('\n');
  filterForm.append(enabledLabel, element('label', copy.words, { for: keywords.id }), keywords,
    element('p', copy.help, { id: 'ct-local-keyword-help', class: 'ct-local-note' }), element('button', copy.save, { type: 'submit' }));
  filterSection.append(element('h3', copy.filters), filterForm);
  body.append(filterSection);

  const searchSection = element('section');
  const searchForm = element('form');
  const searchInput = element('input', undefined, { id: 'ct-local-search-input', type: 'text', maxlength: '200', autocomplete: 'off', 'aria-describedby': 'ct-local-search-help ct-local-tools-status' });
  searchInput.addEventListener('input', clearInvalid);
  searchForm.append(element('label', copy.query, { for: searchInput.id }), searchInput, element('button', copy.add, { type: 'submit' }));
  const searches = element('ul');
  searchSection.append(element('h3', copy.searches), element('p', copy.searchHelp, { id: 'ct-local-search-help', class: 'ct-local-note' }), searchForm, searches);
  body.append(searchSection);
  function renderSearches() {
    searches.replaceChildren();
    if (!state.searches.length) searches.append(element('li', copy.noSearches));
    for (const query of state.searches) {
      const row = element('li');
      // The native route is /explore. ct_search is consumed by this script;
      // tweet.app itself does not currently support search query deep links.
      const link = element('a', query, { href: '/explore?ct_search=' + encodeURIComponent(query) });
      link.addEventListener('click', event => {
        link.setAttribute('href', '/explore?ct_search=' + encodeURIComponent(query));
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (window.location.pathname === '/explore') {
          event.preventDefault();
          announce('');
          openPanel(false);
          startPendingSearch(query, true);
          return;
        }
        try {
          // This tab-only handoff survives the app normalizing its URL before
          // the userscript starts. No account data or API credential is stored.
          window.sessionStorage.setItem(searchIntentKey, JSON.stringify({ version: 1, query, createdAt: Date.now() }));
          link.setAttribute('href', '/explore');
        } catch { /* The URL remains a best-effort fallback when storage is blocked. */ }
      });
      const remove = element('button', copy.remove, { type: 'button', 'aria-label': `${copy.remove}: ${query}` });
      remove.addEventListener('click', () => {
        if (persist({ ...state, searches: state.searches.filter(item => item !== query) })) {
          renderSearches();
          searchInput.focus();
        }
      });
      row.append(link, remove);
      searches.append(row);
    }
  }
  renderSearches();
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query || query.length > 200 || state.searches.length >= 20) { invalidInput(searchInput, copy.invalidSearch); return; }
    if (state.searches.some(item => normalize(item) === normalize(query))) { invalidInput(searchInput, copy.duplicate); return; }
    searchInput.removeAttribute('aria-invalid');
    if (persist({ ...state, searches: [...state.searches, query] })) {
      searchInput.value = '';
      renderSearches();
    }
  });

  const bookmarkSection = element('section');
  const bookmarkForm = element('form');
  const bookmarkInput = element('input', undefined, { id: 'ct-local-bookmark-input', type: 'text', maxlength: '200', 'aria-describedby': 'ct-local-bookmark-help ct-local-tools-status' });
  bookmarkInput.addEventListener('input', clearInvalid);
  const bookmarkSave = element('button', copy.bookmarkSave, { type: 'submit', 'aria-describedby': 'ct-local-bookmark-help' });
  bookmarkForm.append(element('label', copy.bookmarkLabel, { for: bookmarkInput.id }), bookmarkInput, bookmarkSave);
  const bookmarks = element('ul', undefined, { id: 'ct-local-bookmarks' });
  bookmarkSection.append(element('h3', copy.bookmarks),
    element('p', copy.bookmarkHelp, { id: 'ct-local-bookmark-help', class: 'ct-local-note' }), bookmarkForm, bookmarks);
  body.append(bookmarkSection);
  function currentPost() {
    const path = window.location.pathname.replace(/\/$/, '');
    if (!postPathPattern.test(path)) return null;
    const article = [...document.querySelectorAll('main article')]
      .find(node => !node.closest('[data-ct-local-ui]'));
    if (!article) return null;
    // Use only the current detail URL. Text can be absent on media-only posts,
    // or still belong to the previous page during a native route transition.
    // Do not guess a permalink or copy private post bodies into local storage.
    return { path, label: `${copy.post} ${path.split('/').pop()}`.slice(0, 200) };
  }
  function updateBookmarkControl() {
    bookmarkSave.disabled = !currentPost();
  }
  function renderBookmarks() {
    bookmarks.replaceChildren();
    if (!state.bookmarks.length) bookmarks.append(element('li', copy.noBookmarks));
    for (const item of state.bookmarks) {
      const row = element('li');
      const link = element('a', item.label, { href: item.path });
      const remove = element('button', copy.remove, { type: 'button', 'aria-label': `${copy.remove}: ${item.label}` });
      remove.addEventListener('click', () => {
        if (persist({ ...state, bookmarks: state.bookmarks.filter(other => other.path !== item.path) })) {
          renderBookmarks();
          bookmarkInput.focus();
        }
      });
      row.append(link, remove);
      bookmarks.append(row);
    }
  }
  renderBookmarks();
  bookmarkForm.addEventListener('submit', event => {
    event.preventDefault();
    const current = currentPost();
    if (!current) { announce(copy.bookmarkMissing, true); return; }
    const label = bookmarkInput.value.trim() || current.label;
    if (label.length > 200 || state.bookmarks.length >= 50) { invalidInput(bookmarkInput, copy.bookmarkFull); return; }
    if (state.bookmarks.some(item => item.path === current.path)) { announce(copy.bookmarkDuplicate, true); return; }
    bookmarkInput.removeAttribute('aria-invalid');
    if (persist({ ...state, bookmarks: [...state.bookmarks, { path: current.path, label }] })) {
      bookmarkInput.value = '';
      renderBookmarks();
    }
  });

  let reveals = new WeakMap();
  const collapsed = new Set();
  function articleText(article) {
    // Both native post and reply components use this paragraph class. Avoid
    // matching author names, buttons, composer text, or nested reply articles.
    return [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')]
      .filter(p => p.closest('article') === article && !p.closest('[data-ct-local-ui], input, textarea, [contenteditable]') &&
        !p.querySelector('input, textarea, [contenteditable]'))
      .map(p => p.textContent || '').join('\n');
  }
  function uncollapse(article) {
    article.classList.remove('ct-keyword-collapsed');
    for (const child of [...article.children]) if (child.classList.contains('ct-keyword-notice')) child.remove();
    collapsed.delete(article);
  }
  function refresh() {
    refreshBrowserNotifications();
    updateBookmarkControl();
    for (const article of collapsed) if (!article.isConnected) collapsed.delete(article);
    if (!state.enabled && collapsed.size === 0) return;
    for (const article of document.querySelectorAll('article')) {
      if (article.closest('[data-ct-local-ui]')) continue;
      const body = articleText(article);
      const signature = normalize(body);
      const shouldCollapse = state.enabled && state.keywords.length &&
        state.keywords.some(keyword => signature.includes(normalize(keyword))) && reveals.get(article) !== signature;
      if (!shouldCollapse) { if (collapsed.has(article)) uncollapse(article); continue; }
      if (collapsed.has(article) && article.querySelector(':scope > .ct-keyword-notice')) continue;
      const notice = element('div', undefined, { class: 'ct-keyword-notice', 'data-ct-local-ui': '' });
      const reveal = element('button', copy.reveal, { type: 'button' });
      notice.append(element('span', copy.collapsed), reveal);
      notice.addEventListener('click', event => event.stopPropagation());
      notice.addEventListener('keydown', event => event.stopPropagation());
      reveal.addEventListener('click', () => {
        reveals.set(article, normalize(articleText(article)));
        uncollapse(article);
        // The button is removed; move focus to the preserved native post.
        const previousTabIndex = article.getAttribute('tabindex');
        if (previousTabIndex === null) article.setAttribute('tabindex', '-1');
        article.focus({ preventScroll: true });
        if (previousTabIndex === null) article.addEventListener('blur', () => article.removeAttribute('tabindex'), { once: true });
      });
      article.append(notice);
      article.classList.add('ct-keyword-collapsed');
      collapsed.add(article);
    }
  }
  filterForm.addEventListener('submit', event => {
    event.preventDefault();
    const words = keywords.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (words.length > 30 || words.some(value => value.length > 80)) { invalidInput(keywords, copy.invalidWords); return; }
    keywords.removeAttribute('aria-invalid');
    if (persist({ ...state, enabled: enabled.checked, keywords: unique(words) })) {
      keywords.value = state.keywords.join('\n');
      reveals = new WeakMap();
      refresh();
    }
  });

  let pendingSearch = null;
  try {
    const raw = window.sessionStorage.getItem(searchIntentKey);
    window.sessionStorage.removeItem(searchIntentKey);
    if (raw && window.location.pathname === '/explore') {
      const intent = JSON.parse(raw);
      const age = Date.now() - intent?.createdAt;
      if (intent?.version === 1 && typeof intent.query === 'string' && intent.query.trim() &&
          intent.query.length <= 200 && typeof intent.createdAt === 'number' && Number.isFinite(age) && age >= 0 && age <= 120000) {
        pendingSearch = intent.query;
      }
    }
  } catch { /* No usable tab-local handoff. */ }
  try {
    const value = new URL(window.location.href).searchParams.get('ct_search');
    if (window.location.pathname === '/explore' && value && value.length <= 200) pendingSearch = value;
  } catch { /* No deep link to consume. */ }
  let searchTimer;
  let searchRetryTimer;
  let searchTarget;
  let searchAttempts = 0;
  let allowSearchReplacement = false;
  function stopPendingSearch() {
    pendingSearch = null;
    clearTimeout(searchTimer);
    clearTimeout(searchRetryTimer);
    searchRetryTimer = null;
  }
  function failPendingSearch() {
    const query = pendingSearch;
    stopPendingSearch();
    if (!query) return;
    announce(`${copy.searchError} ${query}`, true);
    openPanel(true, false);
  }
  function nativeSearchInput() {
    // Verified in tweet.app's Explore component. Placeholder may have been
    // localized already, so accept English and Japanese forms.
    return [...document.querySelectorAll('main input[type="text"][placeholder]')]
      .find(node => !node.closest('[data-ct-local-ui]') && /^(Search\s|検索|.*を検索$)/i.test(node.getAttribute('placeholder') || ''));
  }
  function dispatchSearchValue(input, value) {
    const page = input.ownerDocument.defaultView;
    const setValue = Object.getOwnPropertyDescriptor(page.HTMLInputElement.prototype, 'value').set;
    setValue.call(input, value);
    const inputEvent = typeof page.InputEvent === 'function'
      ? new page.InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: value })
      : new page.Event('input', { bubbles: true, composed: true });
    input.dispatchEvent(inputEvent);
    input.dispatchEvent(new page.Event('change', { bubbles: true, composed: true }));
  }
  function applyPendingSearch() {
    if (!pendingSearch || searchRetryTimer) return;
    if (window.location.pathname !== '/explore') { stopPendingSearch(); return; }
    const input = nativeSearchInput();
    if (!input) return;
    const query = pendingSearch;
    // Never overwrite an existing query or a user's edits while waiting for
    // the native React tree to finish mounting.
    if (input.value && input.value !== query && !allowSearchReplacement) { stopPendingSearch(); return; }
    // This control is rendered by the native component only after its query
    // state becomes nonempty. A DOM value alone is not proof React accepted it.
    const acknowledged = input.parentElement?.querySelector('button[aria-label="Clear search"], button[aria-label="検索をクリア"]');
    if (searchTarget && input.value === query && acknowledged) {
      stopPendingSearch();
      const url = new URL(window.location.href);
      if (url.searchParams.get('ct_search') === query) {
        url.searchParams.delete('ct_search');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
      return;
    }
    if (searchAttempts >= 5) { failPendingSearch(); return; }
    searchTarget = input;
    allowSearchReplacement = false;
    try {
      // A field mounted after an early injection may start tracking our DOM
      // value as its initial value. Send an empty change first on that retry
      // so the subsequent query is a real change to the native value tracker.
      if (input.value === query) dispatchSearchValue(input, '');
      dispatchSearchValue(input, query);
    } catch { /* Retry until the native field is ready, then report failure. */ }
    const delay = [150, 300, 600, 1000, 2000][searchAttempts++];
    searchRetryTimer = setTimeout(() => {
      searchRetryTimer = null;
      applyPendingSearch();
    }, delay);
  }
  function onSearchUserInput(event) {
    if (!pendingSearch || !event.isTrusted || event.target !== nativeSearchInput()) return;
    stopPendingSearch();
  }
  document.addEventListener('input', onSearchUserInput, true);
  function startPendingSearch(query, allowReplacement = false) {
    stopPendingSearch();
    pendingSearch = query;
    searchTarget = null;
    searchAttempts = 0;
    allowSearchReplacement = allowReplacement;
    searchTimer = setTimeout(failPendingSearch, 15000);
    // Let the native mount/effect pass settle before changing its input.
    searchRetryTimer = setTimeout(() => {
      searchRetryTimer = null;
      applyPendingSearch();
    }, 80);
  }
  if (pendingSearch) startPendingSearch(pendingSearch);

  let timer;
  let destroyed = false;
  const observer = new MutationObserver(records => {
    if (records.every(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return target?.closest('[data-ct-local-ui]') ||
        (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node =>
          node.nodeType === 1 && node.matches('[data-ct-local-ui]')));
    })) return;
    if (timer) return;
    timer = setTimeout(() => { timer = null; if (!destroyed) { refresh(); applyPendingSearch(); } }, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  function onStorage(event) {
    // An open tab keeps its own unsaved edits. Tell the user to reload instead
    // of silently replacing the form and possibly changing visible posts.
    if (event.key === storageKey || event.key === null) announce(copy.storageConflict, true);
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener('popstate', refresh);
  // iOS keyboards can shrink the visual viewport without changing 100dvh.
  // Bound only our floating UI; never change page zoom or native layout.
  const viewport = window.visualViewport;
  let viewportFrame;
  function updateViewport() {
    viewportFrame = null;
    if (!viewport || (viewport.scale && Math.abs(viewport.scale - 1) > 0.01)) {
      for (const name of ['--ct-view-height', '--ct-keyboard-offset', '--ct-root-gap']) root.style.removeProperty(name);
      return;
    }
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    root.style.setProperty('--ct-view-height', `${viewport.height}px`);
    root.style.setProperty('--ct-keyboard-offset', `${covered}px`);
    if (covered > 100) root.style.setProperty('--ct-root-gap', '12px');
    else root.style.removeProperty('--ct-root-gap');
  }
  function queueViewport() {
    if (viewportFrame == null) viewportFrame = window.requestAnimationFrame(updateViewport);
  }
  viewport?.addEventListener('resize', queueViewport);
  viewport?.addEventListener('scroll', queueViewport);
  window.addEventListener('resize', queueViewport);
  updateViewport();
  refresh();
  const controller = { root, panel, refresh, refreshTranslation, destroy() {
    if (destroyed) return;
    destroyed = true;
    observer.disconnect();
    clearTimeout(timer);
    clearTimeout(searchTimer);
    clearTimeout(searchRetryTimer);
    document.removeEventListener('input', onSearchUserInput, true);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('ct-favorite-history-change', refreshFavoriteHistory);
    window.removeEventListener('ct-browser-notifications-change', refreshBrowserNotifications);
    window.removeEventListener('popstate', refresh);
    viewport?.removeEventListener('resize', queueViewport);
    viewport?.removeEventListener('scroll', queueViewport);
    window.removeEventListener('resize', queueViewport);
    if (viewportFrame != null) window.cancelAnimationFrame(viewportFrame);
    for (const article of [...collapsed]) uncollapse(article);
    root.remove();
    style.remove();
  } };
  root.ctController = controller;
  return controller;
}

  /* Optional on-device translation. No post text is sent to another service. */
function createDeviceTranslation({ locale = 'ja', getContext, isActive, isManual = () => false, onStatus, onComplete } = {}) {
  const ja = locale === 'ja';
  const copy = ja ? {
    unsupported: 'このブラウザは端末内翻訳に対応していません。サイトの翻訳をご利用ください。',
    activation: 'モデルの準備ボタンをもう一度押してください。', preparing: '翻訳モデルを準備しています…',
    ready: '端末内翻訳の準備ができました。', unavailable: 'この言語の翻訳モデルを利用できません。',
    failed: '端末内翻訳に失敗しました。原文とサイトの翻訳はそのまま使えます。',
    needModel: 'この言語のモデルを便利ツールで準備してください。', unknown: '言語を確実に判定できませんでした。サイトの翻訳をご利用ください。',
    translate: '端末内で翻訳', hide: '訳文を閉じる', working: '端末内で翻訳中…', label: '端末内の翻訳',
    same: 'ブラウザの表示言語と同じです。', length: 'この投稿は端末内翻訳で扱える長さを超えています。',
  } : {
    unsupported: 'On-device translation is unavailable in this browser. Use site translation.',
    activation: 'Press Prepare model again.', preparing: 'Preparing translation models…',
    ready: 'On-device translation is ready.', unavailable: 'This translation model is unavailable.',
    failed: 'On-device translation failed. The original and site translation remain available.',
    needModel: 'Prepare a model for this language in Tools.', unknown: 'The language could not be identified reliably. Use site translation.',
    translate: 'Translate on device', hide: 'Hide translation', working: 'Translating on device…', label: 'On-device translation',
    same: 'This post already uses the browser’s language.', length: 'This post exceeds the on-device translation input limit.',
  };
  const supported = typeof globalThis.Translator?.availability === 'function' &&
    typeof globalThis.Translator?.create === 'function' &&
    typeof globalThis.LanguageDetector?.availability === 'function' &&
    typeof globalThis.LanguageDetector?.create === 'function';
  // Chrome uses zh-Hant for Traditional Chinese, not the site's zh-TW code.
  const browserLanguage = (navigator.language || locale).toLowerCase();
  const target = /^zh-(?:hant|tw|hk|mo)/.test(browserLanguage) ? 'zh-Hant' : browserLanguage.split(/[-_]/)[0];
  const translators = new Map();
  const cache = new Map();
  const records = new Map();
  const queue = new Map();
  let detector = null;
  let busy = false;
  let current = null;
  let preparing = false;
  let generation = 0;
  let style = null;
  const say = message => onStatus?.(message);

  async function prepare(source) {
    if (!supported) { say(copy.unsupported); return false; }
    if (preparing) return false;
    if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(source) || source.toLowerCase() === target.toLowerCase()) {
      say(copy.same); return false;
    }
    if (navigator.userActivation && !navigator.userActivation.isActive) { say(copy.activation); return false; }
    preparing = true;
    say(copy.preparing);
    try {
      const [pair, detection] = await Promise.all([
        Translator.availability({ sourceLanguage: source, targetLanguage: target }),
        LanguageDetector.availability()
      ]);
      if (pair === 'unavailable' || detection === 'unavailable') { say(copy.unavailable); return false; }
      if (navigator.userActivation && !navigator.userActivation.isActive) { say(copy.activation); return false; }
      const monitor = m => m.addEventListener('downloadprogress', event => {
        if (Number.isFinite(event.loaded)) say(`${copy.preparing} ${Math.round(event.loaded * 100)}%`);
      });
      // Start both creations during the same explicit user activation. Do not
      // start the translator after waiting for the detector's model download.
      const results = await Promise.allSettled([
        detector || LanguageDetector.create({ monitor }),
        translators.get(source) || Translator.create({ sourceLanguage: source, targetLanguage: target, monitor })
      ]);
      if (results[0].status === 'fulfilled') detector = results[0].value;
      if (results[1].status === 'fulfilled') translators.set(source, results[1].value);
      if (results.some(result => result.status === 'rejected')) { say(copy.failed); return false; }
      for (const record of records.values()) record.attempted = false;
      say(`${copy.ready} (${source} → ${target})`);
      onComplete?.();
      return true;
    } catch { say(copy.failed); return false; }
    finally { preparing = false; }
  }

  function ensureStyle() {
    if (style?.isConnected) return;
    style = document.createElement('style');
    style.dataset.ctOwned = 'true';
    style.textContent = `.ct-device-translation{margin:8px 0;color:inherit;font:inherit}.ct-device-translation button{color:var(--color-tl-app-primary,#1688d4);background:none;border:0;padding:6px 0;cursor:pointer;font:inherit;font-size:.8125rem}.ct-device-translation button:focus-visible{outline:2px solid currentColor;outline-offset:2px}.ct-device-translation p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.ct-device-translation[hidden],.ct-device-translation [hidden]{display:none!important}`;
    document.head.append(style);
  }

  function stillValid(record, token) {
    return generation === token && isActive() && record.section.isConnected &&
      getContext(record.native)?.text === record.text && !record.dismissed && !isManual(record.article);
  }

  async function process() {
    if (busy) return;
    busy = true;
    let processed = false;
    while (queue.size) {
      const [record, automatic] = queue.entries().next().value;
      queue.delete(record);
      if (!record.section.isConnected || !isActive() || record.dismissed ||
          getContext(record.native)?.text !== record.text) continue;
      if (automatic && record.attempted) continue;
      processed = true;
      record.attempted = true;
      current = record;
      const token = generation;
      record.button.disabled = true;
      record.button.textContent = copy.working;
      try {
        if (!detector) throw new Error(copy.needModel);
        if (record.text.length > 12000) throw new Error(copy.length);
        const key = `${target}:${record.text}`;
        let translated = cache.get(key);
        if (!translated) {
          const [result] = await detector.detect(record.text);
          if (!stillValid(record, token)) continue;
          if (!result || !Number.isFinite(result.confidence) || result.confidence < 0.75 || !result.detectedLanguage || result.detectedLanguage === 'und') throw new Error(copy.unknown);
          const source = result.detectedLanguage;
          if (source.toLowerCase() === target.toLowerCase()) throw new Error(copy.same);
          const translator = translators.get(source);
          if (!translator) throw new Error(`${copy.needModel} (${source} → ${target})`);
          translated = await translator.translate(record.text);
          if (typeof translated !== 'string' || !translated.trim()) throw new Error(copy.failed);
          cache.set(key, translated);
          if (cache.size > 200) cache.delete(cache.keys().next().value);
        }
        if (!stillValid(record, token)) continue;
        record.output.textContent = translated;
        record.output.lang = target;
        record.output.hidden = false;
        record.shown = true;
      } catch (error) {
        if (stillValid(record, token)) {
          const known = Object.values(copy).some(message => error.message?.startsWith(message));
          record.output.textContent = known ? error.message : copy.failed;
          record.output.hidden = false;
        }
      } finally {
        current = null;
        record.button.disabled = false;
        record.button.textContent = record.shown ? copy.hide : copy.translate;
      }
    }
    busy = false;
    if (processed) onComplete?.();
  }

  function patch(root = document, automatic = false) {
    if (!supported || !isActive()) return;
    ensureStyle();
    for (const [article, record] of records) {
      if (!article.isConnected || !record.section.isConnected || getContext(record.native)?.text !== record.text) {
        record.section.remove(); queue.delete(record); records.delete(article);
      }
    }
    for (const native of ctTranslationControls(root)) {
      const context = getContext(native);
      if (!context || isManual(context.article) || !native.closest('[aria-live="polite"]') || ctTranslationDisabled(native)) continue;
      let record = records.get(context.article);
      if (!record) {
        const section = document.createElement('div');
        section.className = 'ct-device-translation';
        section.dataset.ctOwned = 'true';
        section.setAttribute('aria-label', copy.label);
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = copy.translate;
        const output = document.createElement('p'); output.hidden = true;
        output.setAttribute('aria-live', 'polite');
        section.append(button, output);
        section.addEventListener('click', event => event.stopPropagation());
        context.body.insertAdjacentElement('afterend', section);
        record = { ...context, native, section, button, output, attempted: false, dismissed: false, shown: false };
        records.set(context.article, record);
        button.addEventListener('click', () => {
          if (record.shown) {
            record.output.hidden = true; record.shown = false; record.dismissed = true;
            record.button.textContent = copy.translate;
          } else {
            record.dismissed = false; queue.set(record, false); void process();
          }
        });
      }
      if (automatic && detector && !record.attempted && !record.dismissed && queue.size < 40) queue.set(record, true);
    }
    void process();
  }

  function cancel() {
    generation++;
    queue.clear();
    // A hidden-tab or settings cancellation invalidates the pending result,
    // but has not completed this post's automatic attempt. Let the next active
    // scan resume it. process() remains sequential, so a scan before the old
    // request settles queues work rather than starting a second request. A late
    // successful translation can then be reused from cache.
    if (current && !current.shown && !current.dismissed && !isManual(current.article)) {
      current.attempted = false;
    }
  }
  function hide(article) {
    const record = records.get(article);
    if (!record) return;
    record.dismissed = true; record.output.hidden = true; record.shown = false;
    record.button.textContent = copy.translate; queue.delete(record);
  }
  function clear() {
    if (!records.size) return;
    cancel();
    for (const record of records.values()) record.section.remove();
    records.clear();
  }
  return { supported, prepare, patch, cancel, clear, hide };
}

    // Classic styling is applied only to the authenticated client structure
  // checked against Tweet's public bundle. Native nodes and handlers stay put.
  const ctClassicAppearanceStates = new WeakMap();
  const ctClassicExcluded = '[data-ct-owned],[data-user-content],blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"]';

  function ctClassicDocument(root) {
    return root?.nodeType === 9 ? root : root?.ownerDocument || null;
  }

  function ctClassicOwn(element, article) {
    return element?.closest('article') === article && !element.closest(ctClassicExcluded);
  }

  function ctClassicStyle(doc, state) {
    if (state.style?.isConnected) return true;
    // An unrelated element claiming this ID must not be replaced.
    if (doc.getElementById('ct-classic-appearance-style')) return false;
    const style = doc.createElement('style');
    style.id = 'ct-classic-appearance-style';
    style.dataset.ctOwned = 'classic-appearance';
    const composerAvatar = sizes => `:is(${sizes.map(size =>
      `img[width="${size}"][height="${size}"],[role="img"][style*="width: ${size}px"][style*="height: ${size}px"]`).join(',')}).border.object-cover.shrink-0:first-child:not([data-ct-owned] *,[data-user-content] *,blockquote *,[aria-label^="Quoted post"] *,[data-testid="quote-tweet"] *)`;
    style.textContent = `
      .ct-classic-shell {
        --ct-classic-blue:#55acee;
        --ct-classic-blue-hover:#2795e9;
        --ct-classic-border:var(--tl-app-border);
        --ct-classic-surface:var(--tl-app-card);
        --ct-classic-hover:var(--tl-app-bg);
        --ct-classic-compose:var(--tl-app-card);
        font-family:"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
      }
      .ct-classic-shell[data-app-theme="light"] {
        --ct-classic-border:#e1e8ed;
        --ct-classic-hover:#f5f8fa;
        --ct-classic-compose:#e8f5fd;
        background:#f5f8fa!important;
      }
      .ct-classic-shell[data-app-theme="dark"] {
        --ct-classic-hover:rgba(255,255,255,.035);
      }
      .ct-classic-shell .ct-classic-timeline {
        background:var(--ct-classic-surface)!important;
        border-color:var(--ct-classic-border)!important;
      }
      .ct-classic-shell .ct-classic-tweet {
        border-bottom-color:var(--ct-classic-border)!important;
        border-radius:0;
        box-shadow:none;
      }
      @media (hover:hover) {
        .ct-classic-shell .ct-classic-tweet:hover {
          background:var(--ct-classic-hover)!important;
        }
      }
      .ct-classic-shell .ct-classic-avatar {
        border-radius:4px!important;
      }
      .ct-classic-composer-avatar {
        border-radius:4px!important;
      }
      @supports selector(:has(*)) {
        /* These native rows keep replacement avatars square before a scan. */
        #root-container[data-app-theme] div.flex.gap-3:has(textarea#public-tweet-input) > ${composerAvatar([40])},
        div.bg-tl-app-card.border.rounded-3xl.max-w-lg > div.flex.gap-4.mt-2:has(textarea#public-modal-tweet-input) > ${composerAvatar([48])},
        #root-container[data-app-theme] [role="form"].flex.items-start.gap-3:has(textarea[maxlength="280"]) > ${composerAvatar([32,40])},
        #root-container[data-app-theme] [role="form"] > div.flex.items-start.gap-3:has(textarea[maxlength="280"]) > ${composerAvatar([32,40])} {
          border-radius:4px!important;
        }
      }
      .ct-classic-shell .ct-classic-top-tabs {
        padding-top:0!important;
        padding-bottom:0!important;
        background:var(--ct-classic-surface)!important;
        border-bottom-style:solid!important;
        border-bottom-color:var(--ct-classic-border)!important;
        backdrop-filter:none;
      }
      .ct-classic-shell .ct-classic-tabs-list {
        gap:0!important;
        min-height:46px;
      }
      /* React replaces a tab's complete className on every selection. Style
         direct native buttons through the verified list as well, so the
         rounded native pill cannot flash before the next reconciliation. */
      .ct-classic-shell .ct-classic-tab,
      .ct-classic-shell .ct-classic-tabs-list > button.rounded-full.text-xs {
        padding:11px 12px 8px!important;
        border:0!important;
        border-bottom:3px solid transparent!important;
        border-radius:0!important;
        background:transparent!important;
        color:var(--tl-app-text-muted)!important;
        font-size:13px;
        line-height:20px;
      }
      .ct-classic-shell .ct-classic-tab.bg-sky-500,
      .ct-classic-shell .ct-classic-tabs-list > button.rounded-full.text-xs.bg-sky-500 {
        color:var(--ct-classic-blue)!important;
        border-bottom-color:var(--ct-classic-blue)!important;
        font-weight:700;
      }
      .ct-classic-shell .ct-classic-tab:hover,
      .ct-classic-shell .ct-classic-tabs-list > button.rounded-full.text-xs:hover {
        color:var(--ct-classic-blue)!important;
        background:var(--ct-classic-hover)!important;
      }
      .ct-classic-shell .ct-classic-nav-item {
        border-radius:4px!important;
      }
      .ct-classic-shell .ct-classic-nav-item.text-sky-500,
      .ct-classic-shell .ct-classic-nav-item[aria-current="page"] {
        color:var(--ct-classic-blue)!important;
      }
      .ct-classic-shell .ct-classic-nav-desktop {
        background:var(--ct-classic-surface);
        border:1px solid var(--ct-classic-border);
        border-radius:5px;
        padding:6px;
      }
      .ct-classic-shell .ct-classic-side-panel {
        border-radius:5px!important;
        border-color:var(--ct-classic-border)!important;
        box-shadow:none!important;
      }
      .ct-classic-shell .ct-classic-header,
      .ct-classic-shell .ct-classic-nav-mobile {
        background:var(--ct-classic-surface)!important;
        border-color:var(--ct-classic-border)!important;
        backdrop-filter:none;
      }
      .ct-classic-shell .ct-classic-composer {
        background:var(--ct-classic-compose)!important;
        border-bottom-color:var(--ct-classic-border)!important;
      }
      .ct-classic-shell .ct-classic-submit {
        border-radius:4px!important;
        background:var(--ct-classic-blue)!important;
        box-shadow:none!important;
      }
      .ct-classic-shell .ct-classic-submit:not(:disabled):hover {
        background:var(--ct-classic-blue-hover)!important;
      }
      .ct-classic-shell .ct-classic-mobile-compose {
        background:var(--ct-classic-blue)!important;
        box-shadow:none!important;
      }
      .ct-classic-shell .ct-classic-actions > div > button,
      .ct-classic-shell .ct-classic-actions > button {
        border-radius:4px;
      }
      .ct-classic-shell .ct-classic-favorite-group.text-pink-500,
      .ct-classic-shell .ct-classic-favorite-group.text-pink-500 > span,
      .ct-classic-shell .ct-classic-favorite-group.text-pink-500 > [data-testid="tweet-like-action-count"],
      .ct-classic-shell .ct-classic-favorite-group:hover > span,
      .ct-classic-shell .ct-classic-favorite-group:hover > [data-testid="tweet-like-action-count"] {
        color:#ffac33!important;
      }
      @supports selector(:has(*)) {
        .ct-classic-shell .ct-classic-favorite-group:has(> [data-testid="tweet-like-action"].ct-is-liked) > span,
        .ct-classic-shell .ct-classic-favorite-group:has(> [data-testid="tweet-like-action"].ct-is-liked) > [data-testid="tweet-like-action-count"] {
          color:#ffac33!important;
        }
      }
      @media (min-width:1024px) {
        .ct-classic-shell .ct-classic-layout { max-width:1200px; }
        .ct-classic-shell .ct-classic-grid { column-gap:24px!important; }
        .ct-classic-shell .ct-classic-timeline {
          border-top:1px solid var(--ct-classic-border);
          border-radius:5px 5px 0 0;
        }
      }
      @media (max-width:1023px) {
        .ct-classic-shell .ct-classic-tabs-list { min-height:44px; }
        .ct-classic-shell .ct-classic-tab,
        .ct-classic-shell .ct-classic-tabs-list > button.rounded-full.text-xs {
          padding:10px 11px 7px!important;
          min-height:44px;
        }
        .ct-classic-shell .ct-classic-mobile-compose {
          min-width:44px;
          min-height:44px;
        }
        .ct-classic-shell .ct-classic-actions {
          flex-wrap:wrap;
          column-gap:0;
          row-gap:0;
        }
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-like-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-open-comment-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-repost-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-comment-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-up-arrow-action"] {
          min-width:44px;
          min-height:44px;
        }
      }
    `;
    (doc.head || doc.documentElement).append(style);
    state.style = style;
    return true;
  }

  function ctClassicMarkArticles(articles, mark) {
    for (const article of articles) {
      if (article.closest(ctClassicExcluded) || !article.classList.contains('py-3')) continue;
      // The current client renders this paragraph even for media-only Tweets.
      const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')]
        .find(element => ctClassicOwn(element, article));
      const actions = [...article.querySelectorAll('[data-testid="tweet-action-bar"]')]
        .find(element => ctClassicOwn(element, article) &&
          ['tweet-like-action', 'tweet-open-comment-action', 'tweet-repost-action'].every(id =>
            [...element.querySelectorAll(`[data-testid="${id}"]`)]
              .some(control => control.tagName === 'BUTTON' && ctClassicOwn(control, article))));
      if (!body || !actions) continue;
      const author = [...article.querySelectorAll('button.font-bold.truncate')]
        .find(element => ctClassicOwn(element, article));
      if (!author) continue;
      const row = [...article.children].find(element => element.classList.contains('flex') &&
        element.classList.contains('items-start') && element.classList.contains('gap-3'));
      const avatar = row?.firstElementChild;
      const profile = avatar?.matches('button[aria-label^="View @"]') ? avatar :
        avatar?.querySelector(':scope > button[aria-label^="View @"]');
      if (!profile || !ctClassicOwn(profile, article)) continue;
      const wrapper = profile.firstElementChild;
      const visuals = wrapper?.matches('div.relative.inline-flex.shrink-0.isolate') ? wrapper.children : profile.children;
      const visual = [...visuals].find(element =>
        element.classList.contains('rounded-full') && (element.tagName === 'IMG' || element.getAttribute('role') === 'img'));
      if (!visual) continue;
      mark(article, 'ct-classic-tweet');
      mark(actions, 'ct-classic-actions');
      mark(profile, 'ct-classic-avatar');
      mark(visual, 'ct-classic-avatar');
      const favorite = [...actions.querySelectorAll('[data-testid="tweet-like-action"]')]
        .find(element => ctClassicOwn(element, article));
      const group = favorite?.parentElement;
      const count = group?.children[1];
      if (group?.parentElement === actions && group.firstElementChild === favorite &&
          ['group', 'flex', 'items-center', 'gap-0.5'].every(name => group.classList.contains(name)) &&
          group.children.length <= 2 && (!count || (count.children.length === 0 &&
            /^[\d,.]+$/.test(count.textContent.trim()) &&
            (count.matches('span.text-xs.tabular-nums') || count.matches('button[data-testid="tweet-like-action-count"]'))))) {
        mark(group, 'ct-classic-favorite-group');
      }
    }
  }

  function ctClassicDesired(shell) {
    const wanted = new Map();
    const mark = (element, name) => {
      if (!element || element.closest(ctClassicExcluded)) return;
      if (!wanted.has(element)) wanted.set(element, new Set());
      wanted.get(element).add(name);
    };
    const markComposerAvatar = (input, scope, rowMatches, sizes) => {
      if (!input || input.closest(ctClassicExcluded)) return;
      for (let row = input.parentElement; row && row !== scope; row = row.parentElement) {
        if (!rowMatches(row)) continue;
        const avatar = row.firstElementChild;
        if (!avatar?.matches('img.border.object-cover.shrink-0,[role="img"].border.object-cover.shrink-0') ||
            !avatar.classList.contains('rounded-full')) continue;
        const width = Number(avatar.getAttribute('width') || parseFloat(avatar.style.width));
        const height = Number(avatar.getAttribute('height') || parseFloat(avatar.style.height));
        if (width !== height || !sizes.includes(width)) continue;
        mark(avatar, 'ct-classic-composer-avatar');
        return;
      }
    };
    const main = [...shell.querySelectorAll('main')].find(element =>
      element.classList.contains('lg:col-span-6') &&
      element.classList.contains('bg-tl-app-card') &&
      element.parentElement?.classList.contains('lg:grid-cols-12') &&
      !element.closest(ctClassicExcluded));
    if (!main) return wanted;
    mark(shell, 'ct-classic-shell');
    mark(main, 'ct-classic-timeline');
    const grid = main.parentElement;
    mark(grid, 'ct-classic-grid');
    const layout = grid.parentElement;
    if (layout?.parentElement === shell && layout.classList.contains('max-w-7xl')) {
      mark(layout, 'ct-classic-layout');
    }

    for (const aside of [...grid.children].filter(element =>
      element.tagName === 'ASIDE' && element.classList.contains('lg:col-span-3'))) {
      const nav = [...aside.children].find(element => element.tagName === 'NAV' &&
        element.classList.contains('flex-col') && element.classList.contains('gap-1'));
      if (nav) {
        mark(nav, 'ct-classic-nav');
        mark(nav, 'ct-classic-nav-desktop');
        for (const control of nav.children) {
          if (control.matches('button.rounded-2xl') && control.querySelector('svg') &&
              !control.hasAttribute('data-ct-owned')) mark(control, 'ct-classic-nav-item');
        }
        const submit = nav.querySelector('button#public-sidebar-compose-btn');
        if (submit?.parentElement === nav) mark(submit, 'ct-classic-submit');
      }
      for (const panel of aside.children) {
        if (panel.matches('div.border.bg-tl-app-card') && panel.querySelector(':scope > h3')) {
          mark(panel, 'ct-classic-side-panel');
        }
      }
    }

    for (const header of shell.children) {
      if (header.tagName === 'HEADER' && header.classList.contains('lg:hidden') &&
          header.classList.contains('sticky') && header.querySelector('button[aria-expanded]')) {
        mark(header, 'ct-classic-header');
      }
    }
    for (const nav of shell.querySelectorAll('nav')) {
      if (!nav.classList.contains('lg:hidden') || !nav.classList.contains('bottom-0') ||
          !nav.classList.contains('border-t')) continue;
      const row = nav.firstElementChild;
      if (!row?.classList.contains('justify-around')) continue;
      mark(nav, 'ct-classic-nav');
      mark(nav, 'ct-classic-nav-mobile');
      for (const control of row.children) {
        if (!control.matches('button') || !control.querySelector('svg')) continue;
        if (control.id === 'public-mobile-compose-btn') mark(control, 'ct-classic-mobile-compose');
        else if (control.hasAttribute('aria-label')) mark(control, 'ct-classic-nav-item');
      }
    }

    for (const container of main.querySelectorAll('div.sticky')) {
      if (!container.classList.contains('top-app-header') ||
          !container.classList.contains('border-dashed') ||
          container.closest('article,[data-ct-owned]')) continue;
      const list = container.firstElementChild;
      const controls = list ? [...list.children] : [];
      if (!list?.classList.contains('overflow-x-auto') || controls.length < 2 ||
          !controls.every(element => element.matches('button.rounded-full.text-xs'))) continue;
      mark(container, 'ct-classic-top-tabs');
      mark(list, 'ct-classic-tabs-list');
      controls.forEach(control => mark(control, 'ct-classic-tab'));
    }

    const input = main.querySelector('textarea#public-tweet-input');
    if (input && !input.closest('article,[data-ct-owned]')) {
      let composer = input.parentElement;
      while (composer && composer !== main && !composer.classList.contains('border-b')) {
        composer = composer.parentElement;
      }
      const submit = composer !== main && composer?.querySelector('button#public-tweet-submit-btn');
      if (submit && !composer.closest('article,[data-ct-owned]')) {
        mark(composer, 'ct-classic-composer');
        mark(submit, 'ct-classic-submit');
        markComposerAvatar(input, composer, row => row.classList.contains('flex') && row.classList.contains('gap-3'), [40]);
      }
    }

    const modalInput = shell.ownerDocument.querySelector('textarea#public-modal-tweet-input');
    markComposerAvatar(modalInput, shell.ownerDocument.body, row =>
      ['flex', 'gap-4', 'mt-2'].every(name => row.classList.contains(name)) &&
      row.parentElement?.matches('div.bg-tl-app-card.border.rounded-3xl.max-w-lg'), [48]);
    for (const form of shell.querySelectorAll('[role="form"]')) {
      if (form.closest(ctClassicExcluded)) continue;
      const replyInput = form.querySelector('textarea[maxlength="280"]');
      if (!replyInput || replyInput.closest('[role="form"]') !== form ||
          replyInput.getAttribute('autocomplete') !== 'off') continue;
      markComposerAvatar(replyInput, form.parentElement, row =>
        ['flex', 'items-start', 'gap-3'].every(name => row.classList.contains(name)) &&
        (row === form || row.parentElement === form), [32, 40]);
    }

    ctClassicMarkArticles(main.querySelectorAll('article'), mark);
    return wanted;
  }

  function ctClassicRemoveClasses(element, record, keep = new Set()) {
    for (const name of [...record.added]) {
      if (keep.has(name)) continue;
      if (element.classList.contains(name)) element.classList.remove(name);
      record.added.delete(name);
    }
    if (record.added.size) return;
    const originalTokens = (record.originalClass || '').trim().split(/\s+/).filter(Boolean).sort().join(' ');
    const currentTokens = [...element.classList].sort().join(' ');
    // Restore the original spelling when native classes have stayed the same;
    // otherwise retain classes changed by React while the theme was enabled.
    if (originalTokens === currentTokens && element.getAttribute('class') !== record.originalClass) {
      if (record.originalClass === null) element.removeAttribute('class');
      else element.setAttribute('class', record.originalClass);
    }
  }

  function patchClassicAppearance(root = document, enabled = true) {
    const doc = ctClassicDocument(root);
    if (!doc) return;
    let state = ctClassicAppearanceStates.get(doc);
    if (!state) {
      state = { marked: new Map(), style: null };
      ctClassicAppearanceStates.set(doc, state);
    }
    const shell = doc.getElementById('root-container');
    const scope = root?.nodeType === 1 ? root.closest('article') : null;
    const main = state.main;
    // A native card update cannot alter the surrounding layout. Keep its
    // markers current without traversing every older card in the timeline.
    const partial = enabled && state.enabled === enabled && scope?.isConnected &&
      shell === state.shell && shell?.getAttribute('data-app-theme') === state.theme &&
      main?.isConnected && main.classList.contains('lg:col-span-6') &&
      main.classList.contains('bg-tl-app-card') && main.parentElement?.classList.contains('lg:grid-cols-12') &&
      main.closest('#root-container') === shell && main.contains(scope) && !main.closest(ctClassicExcluded);
    const wanted = new Map();
    if (partial) {
      ctClassicMarkArticles([scope, ...scope.querySelectorAll('article')], (element, name) => {
        if (!element || element.closest(ctClassicExcluded)) return;
        if (!wanted.has(element)) wanted.set(element, new Set());
        wanted.get(element).add(name);
      });
    } else if (enabled) {
      const shell = doc.querySelector('#root-container[data-app-theme="light"],#root-container[data-app-theme="dark"]');
      if (shell && !shell.closest(ctClassicExcluded)) {
        for (const [element, names] of ctClassicDesired(shell)) wanted.set(element, names);
      }
    }
    if (!partial) {
      state.shell = shell;
      state.theme = shell?.getAttribute('data-app-theme');
      state.main = [...wanted].find(([, names]) => names.has('ct-classic-timeline'))?.[0] || null;
      state.enabled = enabled;
    }
    if (wanted.size && !ctClassicStyle(doc, state)) wanted.clear();
    for (const [element, record] of state.marked) {
      if (partial && element.isConnected && record.article !== scope && !scope.contains(element)) continue;
      ctClassicRemoveClasses(element, record, wanted.get(element));
      if (!record.added.size) state.marked.delete(element);
    }
    for (const [element, names] of wanted) {
      let record = state.marked.get(element);
      if (record) record.article = element.closest('article');
      for (const name of names) {
        if (element.classList.contains(name)) continue;
        if (!record) {
          record = { originalClass: element.getAttribute('class'), added: new Set(), article: element.closest('article') };
          state.marked.set(element, record);
        }
        element.classList.add(name);
        record.added.add(name);
      }
    }
    if (!partial && !wanted.size && state.style) {
      state.style.remove();
      state.style = null;
    }
  }

    // Local motion is limited to verified classic controls. It never dispatches
  // clicks or changes native favorite state, labels, counts or event handlers.
  const ctClassicMotion = {
    enabled: false, pageActive: true, bound: false, media: null,
    likes: new WeakMap(), running: new Map(), connectionObserver: null
  };

  function ctMotionPaused() {
    return !ctClassicMotion.enabled || !ctClassicMotion.pageActive || document.hidden ||
      ctClassicMotion.media?.matches === true;
  }

  function ctClearFavoriteMotion(button, expected, cancel = false) {
    const job = ctClassicMotion.running.get(button);
    if (!job || (expected && job !== expected)) return;
    ctClassicMotion.running.delete(button);
    clearTimeout(job.timer);
    if (cancel) { try { job.animation.cancel(); } catch {} }
    if (!ctClassicMotion.running.size) {
      ctClassicMotion.connectionObserver?.disconnect();
      ctClassicMotion.connectionObserver = null;
    }
  }

  function ctStopClassicMotion() {
    for (const [button, job] of ctClassicMotion.running) ctClearFavoriteMotion(button, job, true);
    // Returning from a hidden tab, reduced motion or OFF is a fresh baseline,
    // not a new favorite action to replay.
    ctClassicMotion.likes = new WeakMap();
  }

  function ctSyncClassicMotion() {
    const paused = ctMotionPaused();
    const classicPaused = ctClassicMotion.enabled && paused;
    const classes = document.documentElement.classList;
    if (classes.contains('ct-classic-motion-enabled') !== ctClassicMotion.enabled) classes.toggle('ct-classic-motion-enabled', ctClassicMotion.enabled);
    if (classes.contains('ct-classic-motion-paused') !== classicPaused) classes.toggle('ct-classic-motion-paused', classicPaused);
    if (paused) ctStopClassicMotion();
  }

  function ctBindClassicMotion() {
    if (ctClassicMotion.bound) return;
    ctClassicMotion.bound = true;
    try { ctClassicMotion.media = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null; } catch {}
    const change = () => { ctStopClassicMotion(); ctSyncClassicMotion(); };
    if (typeof ctClassicMotion.media?.addEventListener === 'function') ctClassicMotion.media.addEventListener('change', change);
    else ctClassicMotion.media?.addListener?.(change);
    document.addEventListener('visibilitychange', change);
    window.addEventListener('pagehide', () => { ctClassicMotion.pageActive = false; change(); });
    window.addEventListener('pageshow', () => {
      // The normal initial pageshow can arrive after the first runtime scan.
      // Keep that baseline; only an actual return from pagehide needs a reset.
      if (ctClassicMotion.pageActive) return;
      ctClassicMotion.pageActive = true;
      change();
    });
  }

  function ctInstallClassicMotionStyle() {
    if (document.getElementById('ct-classic-motion-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-classic-motion-style';
    const controls = ':is(.ct-classic-nav a, .ct-classic-nav button, .ct-classic-top-tabs button, .ct-classic-timeline [data-testid="tweet-like-action"], .ct-classic-composer button, #ct-local-tools button, #ct-local-tools a)';
    style.textContent = `
      html.ct-classic-motion-enabled:not(.ct-classic-motion-paused) ${controls} {
        transition:color 120ms ease-out, background-color 120ms ease-out, box-shadow 120ms ease-out;
      }
      html.ct-classic-motion-enabled ${controls}:focus-visible {
        outline:2px solid var(--color-tl-app-primary, #1688d4);
        outline-offset:3px;
      }
      html.ct-classic-motion-paused ${controls},
      html.ct-classic-motion-paused [data-testid="tweet-like-action"] > .ct-star,
      html.ct-classic-motion-paused #ct-local-tools-panel {
        animation:none!important;
        transition:none!important;
      }
      @media (prefers-reduced-motion:reduce) {
        html.ct-classic-motion-enabled ${controls}, html.ct-classic-motion-enabled [data-testid="tweet-like-action"] > .ct-star,
        html.ct-classic-motion-enabled #ct-local-tools-panel { animation:none!important; transition:none!important; }
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function ctAnimateFavorite(button, liked) {
    if (!button?.matches?.('[data-testid="tweet-like-action"]')) return;
    const previous = ctClassicMotion.likes.get(button);
    const selected = liked === true;
    const article = button.closest('article');
    // Runtime's verified own permalink identifies a reused React card. If it
    // is not available, the containing article still guards moved controls.
    const id = article && typeof articleId === 'function' ? articleId(article) : null;
    const owner = article || button;
    const samePost = previous && previous.owner === owner && previous.id === id;
    ctClassicMotion.likes.set(button, { selected, owner, id });
    if (previous && !samePost) ctClearFavoriteMotion(button, null, true);
    if (!selected || !button.isConnected || ctMotionPaused()) {
      ctClearFavoriteMotion(button, null, true);
      return;
    }
    // Initial selected nodes and React replacements do not represent actions.
    // A click which leaves native state unchanged also cannot animate.
    if (!samePost || previous.selected !== false) return;
    const star = [...button.children].find(node => node.classList.contains('ct-star'));
    if (!star?.isConnected || typeof star.animate !== 'function') return;
    ctClearFavoriteMotion(button, null, true);
    let animation;
    try {
      animation = star.animate([
        { transform: 'scale(1) rotate(0deg)', transformOrigin: '50% 50%', offset: 0 },
        { transform: 'scale(1.22) rotate(-7deg)', transformOrigin: '50% 50%', offset: .42 },
        { transform: 'scale(.97) rotate(3deg)', transformOrigin: '50% 50%', offset: .74 },
        { transform: 'scale(1) rotate(0deg)', transformOrigin: '50% 50%', offset: 1 }
      ], { duration: 280, easing: 'cubic-bezier(.25,.9,.35,1)', fill: 'none' });
    } catch { return; }
    const job = { star, animation, timer: null };
    ctClassicMotion.running.set(button, job);
    const finish = () => ctClearFavoriteMotion(button, job);
    // Safari's Animation.finished and a bounded cleanup both leave no inline
    // transform behind. Catch cancellation so it never becomes a rejection.
    animation.finished?.then?.(finish, finish);
    job.timer = setTimeout(() => ctClearFavoriteMotion(button, job, true), 320);
    if (!ctClassicMotion.connectionObserver && typeof MutationObserver === 'function') {
      ctClassicMotion.connectionObserver = new MutationObserver(() => {
        for (const [target, active] of ctClassicMotion.running) {
          if (!target.isConnected || !active.star.isConnected || !target.contains(active.star)) {
            ctClearFavoriteMotion(target, active, true);
          }
        }
      });
      ctClassicMotion.connectionObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function patchClassicMotion(root = document, enabled = true) {
    // This switch is page-wide even when the runtime scans one changed subtree.
    // The supplied root is intentionally not transformed or animated.
    if (!root) return;
    ctBindClassicMotion();
    ctInstallClassicMotionStyle();
    const next = enabled === true;
    if (ctClassicMotion.enabled !== next) ctStopClassicMotion();
    ctClassicMotion.enabled = next;
    ctSyncClassicMotion();
    for (const [button, job] of ctClassicMotion.running) {
      if (!button.isConnected || !job.star.isConnected) ctClearFavoriteMotion(button, job, true);
    }
  }

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
    document.documentElement.dataset.ctActiveVersion = '6.23.1';
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

    // Only the verified author header is eligible for display-name enhancement.
  function findAuthorLeaf(article, username) {
    return [...article.querySelectorAll('button.truncate.font-bold,a[data-testid="author-name"],.ct-author-name')]
      .find(el => !el.closest('[aria-label^="Quoted post"],blockquote') &&
        (normUser(el.textContent) === normUser(username) || el.dataset.ctAuthorUser === normUser(username))) || null;
  }

  async function patchArticle(article) {
    if (!article?.isConnected) return;
    const username = articleAuthor(article);
    if (!username) return;
    const leaf = findAuthorLeaf(article, username);
    if (!leaf) return;
    const previousText = leaf.textContent;
    const user = await fetchProfile(username);
    if (!user || !leaf.isConnected || !article.contains(leaf) ||
        articleAuthor(article) !== username || leaf.textContent !== previousText) return;
    const displayName = clean(user.displayName || user.name || username);
    if (!displayName) return;
    if (leaf.textContent !== displayName) leaf.textContent = displayName;
    leaf.classList.add('ct-author-name');
    leaf.dataset.ctAuthorUser = normUser(username);
    let badge = leaf.parentElement?.querySelector(':scope > .ct-founder');
    const number = user.foundingMemberNumber;
    if (number !== null && number !== undefined && /^\d+$/.test(String(number))) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'ct-founder'; leaf.after(badge); }
      const founder = String(number).padStart(5, '0');
      if (badge.textContent !== `#${founder}`) badge.textContent = `#${founder}`;
      if (badge.title !== `Founder Number #${founder}`) badge.title = `Founder Number #${founder}`;
    } else { badge?.remove(); }
  }

  // Tweet renders the stored bio as a text child in a normal-whitespace P.
  // Preserve its existing nodes, links and handlers; only that verified profile
  // field needs a whitespace rule. Reused/hidden headers release our class.
  const ctProfileBioNodes = new Set();
  function ctPatchProfileBio() {
    const path = location.pathname;
    let route = null;
    const userRoute = /^\/user\/([^/]+)\/?$/.exec(path);
    if (userRoute) {
      try { route = decodeURIComponent(userRoute[1]).toLowerCase(); } catch {}
      if (!route || !/^[a-z0-9_.-]{1,80}$/.test(route)) route = null;
    }
    const profileRoute = /^\/profile\/?$/.test(path) || !!route;
    const candidates = [];
    if (profileRoute) {
      for (const bio of document.querySelectorAll('main p.mt-3.text-tl-app-text.leading-relaxed')) {
        if (bio.closest('article,form,[role="dialog"],[data-ct-owned],[data-ct-local-ui],[hidden],.hidden,[aria-hidden="true"],[contenteditable]') ||
            bio.querySelector('input,textarea,select,[contenteditable]')) continue;
        const details = bio.parentElement;
        const header = bio.previousElementSibling;
        const metadata = bio.nextElementSibling;
        const cover = details?.parentElement;
        const tabs = cover?.nextElementSibling;
        if (!details?.matches('div.px-4.pb-4') || !cover?.matches('div.overflow-hidden') ||
            !header?.matches('div.mt-3.flex.flex-col.gap-1') ||
            !header.querySelector(':scope > h2.font-extrabold.text-tl-app-text.leading-tight.min-w-0') ||
            !metadata?.matches('div.mt-3.flex.flex-wrap.items-center.text-tl-app-text-muted') ||
            !tabs?.matches('div[role="tablist"]')) continue;
        const handles = [...header.querySelectorAll(':scope > p.text-tl-app-text-muted')];
        const handle = handles.length === 1 && !handles[0].children.length &&
          /^@([A-Za-z0-9_.-]{1,80})$/.exec(handles[0].textContent.trim())?.[1].toLowerCase();
        const nativeTabs = [...tabs.children].filter(el => el.matches('button[role="tab"]') && !el.id.startsWith('ct-'));
        const labels = nativeTabs.map(el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent).trim());
        if (!handle || (route && route !== handle) || nativeTabs.length !== 3 ||
            !/^(Tweets|Posts|ツイート|呟き)$/.test(labels[0]) || !/^(Replies|リプライ|返信)$/.test(labels[1]) ||
            !/^(Reposts|Retweets|リツイート|リポスト)$/.test(labels[2])) continue;
        candidates.push(bio);
      }
    }
    const bio = candidates.length === 1 ? candidates[0] : null;
    for (const previous of ctProfileBioNodes) {
      if (previous !== bio) { previous.classList.remove('ct-profile-bio-lines'); ctProfileBioNodes.delete(previous); }
    }
    if (!bio) return;
    let style = document.getElementById('ct-profile-bio-style');
    if (style && !style.matches('style[data-ct-owned="profile-bio"]')) return;
    if (!style) {
      style = document.createElement('style');
      style.id = 'ct-profile-bio-style';
      style.dataset.ctOwned = 'profile-bio';
      style.textContent = '.ct-profile-bio-lines{white-space:pre-wrap;overflow-wrap:anywhere}';
      (document.head || document.documentElement).append(style);
    }
    if (!bio.classList.contains('ct-profile-bio-lines')) bio.classList.add('ct-profile-bio-lines');
    ctProfileBioNodes.add(bio);
  }

  let ctProfileFounderRequest = 0;
  function ctClearProfileFounders(keep = null) {
    document.querySelectorAll('.ct-profile-founder').forEach(badge => {
      if (badge !== keep) badge.remove();
    });
  }

  async function patchProfileFounder() {
    ctPatchProfileBio();
    const request = ++ctProfileFounderRequest;
    if (!/^\/(?:profile\/?|user\/[^/]+\/?)$/.test(location.pathname)) {
      ctClearProfileFounders();
      return;
    }
    const path = location.pathname;
    const username = routeUser() || ownProfileUser();
    if (!username) { ctClearProfileFounders(); return; }
    // React may reuse the heading container when a different profile opens.
    // Remove the previous identity's badge before the new request completes.
    document.querySelectorAll('.ct-profile-founder').forEach(badge => {
      if (badge.dataset.ctFounderUser !== normUser(username) || badge.dataset.ctFounderPath !== path) badge.remove();
    });
    const user = await fetchProfile(username);
    if (request !== ctProfileFounderRequest || location.pathname !== path ||
        normUser(routeUser() || ownProfileUser()) !== normUser(username)) return;
    if (!user) return;
    const number = user.foundingMemberNumber;
    if (number == null || !/^\d+$/.test(String(number))) { ctClearProfileFounders(); return; }
    const displayName = clean(user.displayName || user.name || username);
    const heading = [...document.querySelectorAll('main h1,main h2')].find(el =>
      !el.closest('article,[data-ct-owned]') &&
      [displayName, username, `@${username}`].includes(clean(el.textContent)));
    if (!heading) { ctClearProfileFounders(); return; }
    let badge = heading.parentElement.querySelector(':scope > .ct-profile-founder');
    if (!badge) { badge = document.createElement('span'); badge.className = 'ct-profile-founder'; heading.after(badge); }
    ctClearProfileFounders(badge);
    badge.dataset.ctFounderUser = normUser(username);
    badge.dataset.ctFounderPath = path;
    const label = `#${String(number).padStart(5, '0')}`;
    if (badge.textContent !== label) badge.textContent = label;
  }

  function snapshotFavorite(article) {
    const id = articleId(article);
    if (!id) return null;
    const username = articleAuthor(article) || '';
    const name = clean(article.querySelector('.ct-author-name,button.truncate.font-bold')?.textContent) || username;
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[aria-live]'));
    return { id, username, name, text: body?.textContent || '', avatar: articleAvatar(article),
      href: `${location.origin}/post/${encodeURIComponent(id)}`, savedAt: Date.now() };
  }

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

  // Intl formatters are expensive to construct. Share the few native formats
  // across cards, and recheck the device timezone on minute/visibility changes.
  const ctTimestampFormatCache = new Map();
  let ctTimestampFormatZone = null;
  let ctTimestampFormatCheckedAt = -Infinity;
  const ctTimestampClockWrites = new WeakMap();

  function ctTimestampOwnMutation(mutation) {
    if (mutation.type !== 'characterData') return false;
    const node = mutation.target;
    const write = ctTimestampClockWrites.get(node);
    return !!write && node.data === write.value && node.parentElement === write.parent &&
      ctTimestampNativeValue(write.parent) === write.source;
  }

  function ctTimestampFormatReset() {
    ctTimestampFormatCheckedAt = -Infinity;
  }

  function ctTimestampFormatter(locale, kind) {
    const now = Date.now();
    if (ctTimestampFormatZone === null || now < ctTimestampFormatCheckedAt || now - ctTimestampFormatCheckedAt >= 60000) {
      const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone !== ctTimestampFormatZone) {
        ctTimestampFormatCache.clear();
        ctTimestampFormatZone = zone;
      }
      ctTimestampFormatCheckedAt = now;
    }
    const japanese = locale === 'ja';
    const language = japanese ? 'ja-JP' : 'en-US';
    const key = `${language}:${kind}`;
    if (!ctTimestampFormatCache.has(key)) {
      const options = kind === 'time' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } :
        { ...(kind === 'date' ? { year: 'numeric' } : {}), month: japanese ? 'long' : 'short', day: 'numeric' };
      ctTimestampFormatCache.set(key, new Intl.DateTimeFormat(language, options));
    }
    return ctTimestampFormatCache.get(key);
  }

  function ctTimestampExactText(value, locale = CT_LOCALE) {
    const date = value instanceof Date ? value : ctTimestampParse(value);
    if (!date || !Number.isFinite(date.getTime())) return '';
    const dateText = ctTimestampFormatter(locale, 'date').format(date);
    const timeText = ctTimestampFormatter(locale, 'time').format(date);
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
    const kind = date.getFullYear() !== new Date(now).getFullYear() ? 'date' : 'month-day';
    return ctTimestampFormatter(locale, kind).format(date);
  }

  function ctTimestampClockState() {
    return ctTimestampClockState.value ||= { elements: new Set(), articles: new WeakMap(), timer: null, dueAt: null, active: true, installed: false };
  }

  function ctTimestampStopClock(state) {
    clearTimeout(state.timer);
    state.timer = null;
    state.dueAt = null;
  }

  function ctTimestampRefreshRelative(dirtyElements) {
    const state = ctTimestampClockState();
    const partial = dirtyElements instanceof Set;
    if (!partial) ctTimestampStopClock(state);
    if (!state.active || document.hidden) {
      ctTimestampStopClock(state);
      return;
    }
    const now = Date.now();
    let delay = 60000;
    for (const el of partial ? dirtyElements : state.elements) {
      const value = el.isConnected && ctTimestampNativeValue(el);
      const date = value && ctTimestampParse(value);
      const node = el.firstChild;
      if (!date || el.childNodes.length !== 1 || node?.nodeType !== Node.TEXT_NODE) {
        state.elements.delete(el);
        continue;
      }
      const text = ctTimestampRelativeText(date, now);
      if (node.nodeValue !== text) {
        ctTimestampClockWrites.set(node, { value: text, parent: el, source: value });
        node.nodeValue = text;
        if (typeof ctReplyTimeRendered === 'function' && !el.hasAttribute('title')) ctReplyTimeRendered(el, text);
      }
      const age = now - date.getTime();
      if (age >= 0 && age < 604800000) delay = Math.min(delay, 60000 - age % 60000);
    }
    if (!state.elements.size) {
      ctTimestampStopClock(state);
      return;
    }
    const dueAt = now + Math.max(1000, delay);
    // A scoped scan refreshes only changed cards. Keep the already scheduled
    // global boundary unless a new clock needs an earlier wake-up.
    if (!state.timer || dueAt < state.dueAt) {
      ctTimestampStopClock(state);
      state.dueAt = dueAt;
      state.timer = setTimeout(ctTimestampRefreshRelative, dueAt - now);
    }
  }

  function ctTimestampTrackRelative(el, article) {
    const state = ctTimestampClockState();
    const previous = state.articles.get(article);
    if (previous && previous !== el) state.elements.delete(previous);
    if (!el) {
      state.articles.delete(article);
      return;
    }
    state.articles.set(article, el);
    if (!state.installed) {
      state.installed = true;
      document.addEventListener('visibilitychange', () => {
        ctTimestampFormatReset();
        ctTimestampRefreshRelative();
      });
      window.addEventListener('pagehide', () => {
        state.active = false;
        ctTimestampStopClock(state);
      });
      window.addEventListener('pageshow', event => {
        if (event.persisted) {
          state.active = true;
          ctTimestampFormatReset();
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
    const clocks = new Set();
    for (const article of articles) {
      if (!article.isConnected) continue;
      const stamps = [...article.querySelectorAll('.ct-detail-post-time')]
        .filter(stamp => stamp.closest('article') === article);
      const creation = ctTimestampCreationNode(article);
      ctTimestampTrackRelative(creation, article);
      if (creation) clocks.add(creation);
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
    ctTimestampRefreshRelative(clocks);
  }

    // Keep photos in layout coordinates while the browser magnifies and pans
  // them. Refitting to the shrinking visual viewport would cancel the zoom.
  const ctPhotoViewportBounds = new WeakMap();
  function ctPhotoViewportZoomed() {
    const scale = window.visualViewport?.scale;
    return Number.isFinite(scale) && scale > 1.001;
  }
  function ctPhotoViewportFit(dialog, prefix) {
    const viewport = window.visualViewport;
    const zoomed = ctPhotoViewportZoomed();
    let bounds = ctPhotoViewportBounds.get(dialog);
    if (!zoomed || !bounds) {
      const scale = zoomed ? viewport.scale : 1;
      bounds = {
        width: zoomed ? document.documentElement.clientWidth || viewport.width * scale || window.innerWidth : viewport?.width || window.innerWidth,
        height: (viewport?.height || window.innerHeight) * scale,
        top: zoomed ? 0 : viewport?.offsetTop || 0,
        left: zoomed ? 0 : viewport?.offsetLeft || 0
      };
      ctPhotoViewportBounds.set(dialog, bounds);
    }
    let changed = false;
    for (const [name, value] of Object.entries(bounds)) {
      if (!Number.isFinite(value) || value < 0) continue;
      const property = prefix + name, pixels = value + 'px';
      if (dialog.style.getPropertyValue(property) !== pixels) {
        dialog.style.setProperty(property, pixels); changed = true;
      }
    }
    return { zoomed, changed };
  }

    // Profile additions use Tweet's verified posts GET. Favorites are browser-local
  // snapshots, scoped to the signed-in account; no favorite-history endpoint is assumed.
  const ctProfileState = {
    path: '', user: '', uid: null, authSeen: undefined, accountUser: '', active: '', tablist: null,
    timeline: null, panel: null, sequence: 0, identityBusy: false, identityRetry: 0,
    nativeSelection: new Map(), tabsBound: new WeakSet(), rendered: '', media: null, favoriteMutes: null,
    storageBound: false, storageError: false, storageFailureUID: null, memory: new Map(), dirtyMemory: new Set(), viewer: null,
    rowItems: new WeakMap(), muteCache: new Map(), mediaCache: new Map(), favoriteRemovals: new Map(), favoriteView: null
  };
  function ctProfileText(ja, en) { return CT_LOCALE === 'ja' ? ja : en; }
  function ctProfileId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
  }
  function ctProfileHandle(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value.toLowerCase() : null;
  }
  function ctProfileURL(value) {
    if (typeof value !== 'string' || value.length > 4000) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function ctProfileUID() {
    return typeof ctNetworkState !== 'undefined' ? ctProfileId(ctNetworkState.authUID) : null;
  }
  function ctProfileMediaAssets(post) {
    const media = [];
    for (const asset of Array.isArray(post?.media_assets) ? post.media_assets.slice(0, 16) : []) {
      const url = ctProfileURL(asset?.public_url);
      if (url && ['image', 'video'].includes(asset?.media_type)) media.push({
        type: asset.media_type, url, poster: ctProfileURL(asset.thumbnail_url)
      });
    }
    const image = ctProfileURL(post?.image);
    if (!media.length && image) media.push({ type: 'image', url: image, poster: '' });
    return media;
  }
  function ctProfileFavoriteItems(data) {
    if (!Array.isArray(data)) return [];
    // Keep the first occurrence, including its saved time. An archive must not
    // silently discard older records when the collection grows past 500.
    const items = new Map();
    for (const item of data) {
      if (!ctProfileId(item?.id) || items.has(item.id)) continue;
      items.set(item.id, {
      id: item.id, username: ctProfileHandle(item.username) || '',
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : '',
      text: typeof item.text === 'string' ? item.text.slice(0, 10000) : '',
      avatar: ctProfileURL(item.avatar), savedAt: Number.isFinite(Number(item.savedAt)) && Number(item.savedAt) >= 0 ? Number(item.savedAt) : 0,
      createdAt: typeof item.createdAt === 'string' && (ctTimestampParse(item.createdAt) || Number.isFinite(Date.parse(item.createdAt))) ? item.createdAt : '',
      href: `${location.origin}/post/${encodeURIComponent(item.id)}`,
      media: Array.isArray(item.media) ? item.media.slice(0, 16).filter(asset =>
        ['image', 'video'].includes(asset?.type) && ctProfileURL(asset.url)).map(asset => ({
          type: asset.type, url: ctProfileURL(asset.url), poster: ctProfileURL(asset.poster)
        })) : []
      });
    }
    return [...items.values()];
  }
  function ctProfileFavoriteKey(uid) { return KEY.favorites + ':uid:' + encodeURIComponent(uid); }
  function ctProfileLoadFavorites() {
    const uid = ctProfileUID();
    if (!uid) return [];
    const key = ctProfileFavoriteKey(uid);
    if (ctProfileState.dirtyMemory.has(uid)) return ctProfileState.memory.get(uid) || [];
    try {
      const data = ctProfileFavoriteItems(JSON.parse(localStorage.getItem(key) || '[]'));
      ctProfileState.memory.set(uid, data);
      return data;
    } catch { return ctProfileState.memory.get(uid) || []; }
  }
  function ctProfileWriteFavorites(uid, data) {
    if (!uid || uid !== ctProfileUID()) return false;
    const items = ctProfileFavoriteItems(data);
    ctProfileState.memory.set(uid, items);
    if (ctProfileState.favoriteView?.uid === uid) ctProfileClearFavoriteBackupParts();
    try {
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      ctProfileState.storageError = false; ctProfileState.dirtyMemory.delete(uid);
      if (ctProfileState.storageFailureUID === uid) ctProfileState.storageFailureUID = null;
    } catch { ctProfileState.storageError = true; ctProfileState.storageFailureUID = uid; ctProfileState.dirtyMemory.add(uid); }
    if (favoritesActive) renderFavoritesPanel();
    return true;
  }
  function ctProfileSaveFavorite(item, expectedUid = ctProfileUID()) {
    if (!ctProfileId(item?.id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    ctProfileState.favoriteRemovals.get(expectedUid)?.delete(item.id);
    return ctProfileWriteFavorites(expectedUid, [item, ...ctProfileLoadFavorites().filter(row => row.id !== item.id)]);
  }
  function ctProfileRemoveFavorite(id, expectedUid = ctProfileUID()) {
    if (!ctProfileId(id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    if (!ctProfileState.favoriteRemovals.has(expectedUid)) ctProfileState.favoriteRemovals.set(expectedUid, new Set());
    const removed = ctProfileState.favoriteRemovals.get(expectedUid);
    removed.add(id);
    while (removed.size > 1000) removed.delete(removed.values().next().value);
    return ctProfileWriteFavorites(expectedUid, ctProfileLoadFavorites().filter(row => row.id !== id));
  }
  function ctProfileRememberLikedPosts(posts, expectedUid, expectedUser = null) {
    if (!Array.isArray(posts) || !ctProfileId(expectedUid) || expectedUid !== ctProfileUID()) return 0;
    const expectedHandle = expectedUser === null ? null : ctProfileHandle(expectedUser);
    if (expectedUser !== null && !expectedHandle) return 0;
    const previous = ctProfileLoadFavorites();
    const known = new Map(previous.map(item => [item.id, item]));
    const recovered = new Map();
    const removed = ctProfileState.favoriteRemovals.get(expectedUid);
    for (const post of posts.slice(0, 1000)) {
      const username = ctProfileHandle(post?.authorUsername);
      if (post?.hasLiked !== true || !ctProfileId(post.id) || !username ||
          (expectedHandle && username !== expectedHandle) || post.isDeleted || post.status === 'MUTED' ||
          post.isRepost || post.originalPostId || post.repostedBy || removed?.has(post.id) || typeof post.text !== 'string') continue;
      // The native client prefers created_at. A missing or invalid alias must
      // not hide a valid creation time or replace a known time with savedAt.
      const createdAt = ctTimestampPostValue(post) || known.get(post.id)?.createdAt || '';
      recovered.set(post.id, { id: post.id, username,
        name: typeof post.authorName === 'string' ? post.authorName.slice(0, 200) : username,
        avatar: ctProfileURL(post.authorAvatar), text: post.text.slice(0, 10000),
        createdAt,
        savedAt: known.get(post.id)?.savedAt ?? Date.now(), media: ctProfileMediaAssets(post) });
    }
    if (!recovered.size || expectedUid !== ctProfileUID()) return 0;
    // Reading an old cache must not undo a newer native Unlike. Existing saved
    // timestamps and row order remain stable when the same post is read again.
    const items = previous.map(item => recovered.get(item.id) || item);
    for (const [id, item] of recovered) if (!known.has(id)) items.push(item);
    if (JSON.stringify(ctProfileFavoriteItems(items)) !== JSON.stringify(previous)) ctProfileWriteFavorites(expectedUid, items);
    return [...recovered.keys()].filter(id => !known.has(id)).length;
  }
  function ctProfileLegacyFavorites() {
    try {
      // Old storage had no account identity. Import is explicit and remains
      // available only until its owner is recorded; the original data is retained.
      if (localStorage.getItem(KEY.favorites + ':owner')) return [];
      return ctProfileFavoriteItems(JSON.parse(localStorage.getItem(KEY.favorites) || '[]'));
    } catch { return []; }
  }
  function ctProfileImportFavorites(expectedUid = ctProfileUID()) {
    const uid = expectedUid;
    const legacy = ctProfileLegacyFavorites();
    if (!uid || uid !== ctProfileUID() || !legacy.length) return;
    try {
      const merged = [...ctProfileLoadFavorites(), ...legacy];
      const items = ctProfileFavoriteItems(merged);
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      localStorage.setItem(KEY.favorites + ':owner', uid);
      ctProfileState.memory.set(uid, items);
      ctProfileState.storageError = false; ctProfileState.dirtyMemory.delete(uid);
      if (ctProfileState.storageFailureUID === uid) ctProfileState.storageFailureUID = null;
      if (ctProfileState.favoriteView?.uid === uid) ctProfileClearFavoriteBackupParts();
    } catch { ctProfileState.storageError = true; ctProfileState.storageFailureUID = uid; }
    renderFavoritesPanel();
  }
  function ctProfileNativeReplyEditor(el, timeline) {
    if (!el?.matches('textarea[name="compose-text"][maxlength="280"][inputmode="text"][rows="1"][autocomplete="off"][data-form-type="other"]') ||
        !el.matches('.relative.bg-transparent.whitespace-pre-wrap.break-words.w-full.resize-none.text-tl-app-text.outline-none') ||
        !el.parentElement?.matches('div.relative') || el.closest('[data-ct-owned],[data-ct-local-ui],[data-user-content],[contenteditable]')) return false;
    const article = el.closest('article');
    return !!article && timeline.contains(article) &&
      [...article.querySelectorAll('button[data-testid="tweet-like-action"]')].some(button => button.closest('article') === article);
  }
  function ctProfileContext() {
    if (!/^\/(?:profile\/?|user\/[^/]+\/?)$/.test(location.pathname)) return null;
    const main = document.querySelector('main');
    if (!main) return null;
    for (const tablist of main.querySelectorAll('[role="tablist"]')) {
      if (tablist.closest('article,[data-ct-owned],[data-ct-local-ui],[hidden],[aria-hidden="true"]')) continue;
      const nativeTabs = [...tablist.children].filter(el => el.matches('button[role="tab"]') && !el.id.startsWith('ct-'));
      if (nativeTabs.length !== 3) continue;
      const labels = nativeTabs.map(el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent).trim());
      if (!/^(Tweets|Posts|ツイート|呟き)$/.test(labels[0]) || !/^(Replies|リプライ|返信)$/.test(labels[1]) ||
          !/^(Reposts|Retweets|リツイート|リポスト)$/.test(labels[2])) continue;
      const header = [...tablist.parentElement.children].filter(el =>
        el !== tablist && !!(el.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING));
      const handles = new Set(header.flatMap(el => [...el.querySelectorAll('div.mt-3.flex.flex-col.gap-1')])
        .filter(el => el.querySelector(':scope > h2.font-extrabold'))
        .flatMap(el => [...el.querySelectorAll(':scope > p.text-tl-app-text-muted')])
        .filter(el => !el.children.length)
        .map(el => /^@([A-Za-z0-9_.-]{1,80})$/.exec(el.textContent.trim())?.[1]).filter(Boolean).map(ctProfileHandle));
      if (handles.size !== 1) continue;
      const user = [...handles][0];
      if (location.pathname.startsWith('/user/')) {
        let route;
        try { route = ctProfileHandle(decodeURIComponent(location.pathname.split('/')[2])); } catch { continue; }
        if (!route || route !== user) continue;
      }
      let timeline = tablist.nextElementSibling;
      while (timeline?.matches('[data-ct-profile-panel]')) timeline = timeline.nextElementSibling;
      // Current profile component renders one direct DIV for the active native
      // timeline. Native inline reply editors can appear within its Tweets;
      // hiding the timeline must retain their original nodes and draft values.
      // Unknown forms, inputs and editor structures still fail open.
      if (!timeline?.matches('div') || timeline.matches('[role],[data-ct-owned],[data-ct-local-ui]') ||
          [...timeline.querySelectorAll('input,textarea,form,[role="form"]')].some(el => !ctProfileNativeReplyEditor(el, timeline))) continue;
      return { path: location.pathname, user, main, tablist, timeline, nativeTabs };
    }
    return null;
  }
  function ctProfileStyles() {
    if (document.getElementById('ct-profile-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-profile-style';
    style.textContent = `
      [data-ct-profile-tabs]{overflow-x:auto;scrollbar-width:none;min-width:0}
      [data-ct-profile-tabs]::-webkit-scrollbar{display:none}
      [data-ct-profile-tabs]>button[role=tab]{min-width:54px;min-height:48px;flex:1 0 54px}
      [data-ct-profile-active]>button:not([data-ct-profile-tab])>span{color:var(--color-tl-app-text-muted,#657786)!important}
      [data-ct-profile-active]>button:not([data-ct-profile-tab])>span>span{display:none!important}
      [data-ct-profile-timeline-hidden]{display:none!important}
      .ct-profile-tab{position:relative;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;padding:8px 4px;border:0;background:transparent;color:var(--color-tl-app-text-muted,#657786);font:inherit;cursor:pointer}
      .ct-profile-tab svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}
      .ct-profile-tab-label{font-size:10px;white-space:nowrap;line-height:14px}
      .ct-profile-tab[aria-selected=true]{color:var(--color-tl-app-text,#14171a);font-weight:700}
      .ct-profile-tab[aria-selected=true]:after{content:'';position:absolute;bottom:0;width:28px;height:4px;border-radius:2px;background:#55acee}
      .ct-profile-tab[data-ct-profile-tab=favorites] svg{color:#ffac33}
      .ct-profile-tab:focus-visible,.ct-profile-control:focus-visible,.ct-profile-details>summary:focus-visible,.ct-profile-photo:focus-visible{outline:2px solid #55acee;outline-offset:-3px}
      [data-ct-profile-panel]{position:relative!important;inset:auto!important;max-height:none!important;width:auto!important;max-width:100%;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:inherit!important;color:inherit;box-shadow:none!important;z-index:auto!important}
      .ct-profile-status{padding:6px 16px;font-size:12px;color:var(--color-tl-app-text-muted,#657786);line-height:1.45;overflow-wrap:anywhere}
      .ct-profile-empty{padding:32px 16px;text-align:center;color:var(--color-tl-app-text-muted,#657786);font-size:14px}
      .ct-profile-control{min-height:44px;max-width:100%;padding:8px;border:0;border-radius:0;background:transparent;color:#55acee;font:inherit;line-height:20px;cursor:pointer;margin:0;overflow-wrap:anywhere}
      .ct-profile-control:hover{color:var(--color-tl-app-text,#14171a);text-decoration:underline}
      .ct-profile-control:disabled{cursor:wait;opacity:.6}
      .ct-profile-toolbar{display:flex;flex-wrap:wrap;column-gap:8px;row-gap:0;align-items:center;min-width:0;padding:0 12px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544);font-size:12px;color:var(--color-tl-app-text-muted,#657786);line-height:1.45}
      .ct-profile-toolbar-count{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ct-profile-toolbar>.ct-profile-control{flex:none}
      .ct-profile-details{min-width:0;max-width:100%}
      .ct-profile-details>summary{box-sizing:border-box;min-height:44px;padding:12px 8px;line-height:20px;list-style-position:inside;color:#55acee;cursor:pointer;overflow-wrap:anywhere}
      .ct-profile-details>summary:hover{text-decoration:underline}
      .ct-profile-details[open]{flex-basis:100%}
      .ct-profile-detail-body{padding:0 4px 8px;overflow-wrap:anywhere}
      .ct-profile-detail-body>div{margin:0 0 6px}
      .ct-profile-detail-actions{display:flex;flex-wrap:wrap;column-gap:8px;row-gap:0}
      .ct-profile-toolbar [hidden]{display:none!important}
      .ct-favorite-tools input[type=file]{display:none}
      .ct-favorite-summary{flex-basis:100%;min-width:0;overflow-wrap:anywhere}
      .ct-favorite-summary:empty{display:none}
      #ct-favorite-backup-status,#ct-favorite-storage-status{padding:6px 4px}
      #ct-favorite-backup-status[data-error=true],#ct-favorite-storage-status{color:var(--color-tl-app-danger,#c23636)}
      .ct-profile-row{display:flex;gap:12px;padding:16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544)}
      .ct-profile-avatar{width:40px;height:40px;flex:none;border-radius:4px;object-fit:cover}
      .ct-profile-row-main{min-width:0;flex:1}
      .ct-profile-meta{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font-size:14px;line-height:20px}
      .ct-profile-name{font-weight:700;color:inherit;text-decoration:none}
      .ct-profile-handle,.ct-profile-time{font-size:12px;color:var(--color-tl-app-text-muted,#657786);text-decoration:none}
      .ct-profile-time{white-space:nowrap}
      .ct-profile-text{font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px}
      .ct-profile-gallery{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;border-radius:4px;scrollbar-width:thin}
      .ct-profile-photo{display:block;flex:0 0 100%;min-width:0;padding:0;background:var(--color-tl-app-bg,#f5f8fa);border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;overflow:hidden;scroll-snap-align:start;cursor:zoom-in}
      .ct-profile-photo img{display:block;width:100%;height:auto;max-height:480px;object-fit:contain}
      .ct-profile-video{display:block;width:100%;max-height:480px;background:#000;border-radius:4px;margin:8px 0}
      .ct-profile-media-note{font-size:12px;color:var(--color-tl-app-text-muted,#657786);margin:6px 0}
      .ct-profile-post-link{display:inline-flex;align-items:center;min-height:44px;color:#55acee;font-size:13px;text-decoration:none}
      .ct-profile-post-link:hover,.ct-profile-name:hover{text-decoration:underline}
      .ct-profile-viewer{box-sizing:border-box;position:fixed;inset:var(--ct-photo-view-top,0px) auto auto var(--ct-photo-view-left,0px);margin:0;padding:0;border:0;background:#000;color:#fff;width:var(--ct-photo-view-width,100vw);height:var(--ct-photo-view-height,100dvh);max-width:none;max-height:none;overflow:hidden}
      .ct-profile-viewer[open]{display:grid;grid-template-rows:minmax(0,1fr)}
      .ct-profile-viewer::backdrop{background:#000c}
      .ct-profile-viewer-stage{position:relative;box-sizing:border-box;display:grid;place-items:center;min-width:0;min-height:0;overflow:hidden;padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(env(safe-area-inset-left),env(safe-area-inset-right));touch-action:pan-y pinch-zoom}
      .ct-profile-viewer-zoomed .ct-profile-viewer-stage{touch-action:pan-x pan-y pinch-zoom}
      .ct-profile-viewer img{display:block;width:100%;height:100%;min-width:0;min-height:0;max-width:100%;max-height:100%;object-fit:contain;margin:0}
      .ct-profile-photo-covered{opacity:0}
      .ct-profile-photo-layer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
      .ct-profile-photo-track{display:flex;width:100%;height:100%;will-change:transform}
      .ct-profile-photo-pane{box-sizing:border-box;display:grid;place-items:center;flex:0 0 100%;min-width:0;min-height:0;height:100%;padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(env(safe-area-inset-left),env(safe-area-inset-right))}
      .ct-profile-viewer-nav{position:absolute;left:env(safe-area-inset-left);right:env(safe-area-inset-right);bottom:env(safe-area-inset-bottom);display:flex;align-items:center;justify-content:space-between;padding:8px;gap:8px}
      .ct-profile-viewer-nav button{min-width:44px;min-height:44px;border:1px solid #ffffff55;border-radius:4px;color:inherit;background:transparent;font:inherit;cursor:pointer}
      .ct-profile-viewer>.ct-media-photo-quality{bottom:calc(68px + env(safe-area-inset-bottom))}
      @media(max-width:480px){.ct-profile-row{padding:12px;gap:10px}.ct-profile-photo img,.ct-profile-video{max-height:360px}}
      @media(prefers-reduced-motion:no-preference){.ct-profile-tab,.ct-profile-control{transition:color 120ms ease,background-color 120ms ease}}
    `;
    document.head.appendChild(style);
  }
  function ctProfileCloseViewer() {
    const viewer = ctProfileState.viewer;
    if (!viewer) return;
    ctProfileState.viewer = null;
    if (typeof ctMediaReleasePhotoQuality === 'function') ctMediaReleasePhotoQuality(viewer.dialog);
    viewer.cleanup?.();
    try { viewer.dialog.close(); } catch {}
    viewer.dialog.remove();
    const trigger = viewer.trigger?.isConnected ? viewer.trigger :
      ctProfileState.tablist?.querySelector('button[role="tab"][aria-selected="true"]');
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  function ctProfilePhotoGestures(viewer, show) {
    const { dialog, stage, image, images } = viewer;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const pointers = new Set(), decoded = new Map(), listeners = [];
    let touch = null, motion = null, pinch = false, queued = null, waitTimer = null, suppressUntil = 0, closed = false;
    const context = `${location.pathname}${location.search}\n${ctProfileUID() || ''}`;
    const valid = () => !closed && ctProfileState.viewer === viewer && dialog.isConnected &&
      viewer.trigger?.isConnected && viewer.gallery?.isConnected && !document.hidden && ctPageActive &&
      context === `${location.pathname}${location.search}\n${ctProfileUID() || ''}` &&
      viewer.sources === [...viewer.gallery.querySelectorAll(':scope > .ct-profile-photo > img')].map(node => node.src).join('\n');
    const listen = (target, name, handler, options) => { target?.addEventListener?.(name, handler, options); listeners.push([target, name, handler, options]); };
    const reset = () => {
      const oldTouch = touch; touch = null;
      if (oldTouch?.pointer != null) try { oldTouch.capture?.releasePointerCapture(oldTouch.pointer); } catch {}
      clearTimeout(waitTimer); waitTimer = null; queued = null;
      if (!motion) return;
      const oldMotion = motion; motion = null;
      cancelAnimationFrame(oldMotion.frame); clearTimeout(oldMotion.timer);
      image.removeEventListener('load', oldMotion.loaded); image.removeEventListener('error', oldMotion.loaded);
      image.classList.remove('ct-profile-photo-covered'); oldMotion.layer.remove();
    };
    const cancel = () => { if (touch?.locked || pinch) suppressUntil = Date.now() + 400; reset(); };
    const forget = () => { for (const entry of decoded.values()) entry.image.removeEventListener('load', entry.loaded); decoded.clear(); };
    const warm = () => {
      if (!valid() || images.length < 2 || reduce?.matches || ctPhotoViewportZoomed()) { forget(); return; }
      const wanted = new Set([viewer.index - 1, viewer.index, viewer.index + 1].filter(index => images[index]));
      for (const [index, entry] of decoded) if (!wanted.has(index)) { entry.image.removeEventListener('load', entry.loaded); decoded.delete(index); }
      for (const index of wanted) {
        if (decoded.has(index)) continue;
        const node = document.createElement('img'); node.alt = ''; node.draggable = false; node.decoding = 'async'; node.referrerPolicy = image.referrerPolicy;
        const entry = { image: node, ready: false, loaded: null }; decoded.set(index, entry);
        entry.loaded = () => {
          if (!valid() || decoded.get(index) !== entry) return;
          entry.ready = node.complete && node.naturalWidth > 0;
          // The finger can reverse direction after the initially opposite photo
          // finishes decoding. Fill that pane before covering the shown image.
          const pane = motion?.panes.get(index);
          if (entry.ready && pane && !pane.firstElementChild) pane.append(node);
          if (entry.ready && queued === index) { reset(); viewer.index = index; show(); warm(); }
        };
        const canDecode = typeof node.decode === 'function';
        if (!canDecode) node.addEventListener('load', entry.loaded);
        node.src = images[index].url;
        if (canDecode) {
          try { Promise.resolve(node.decode()).then(entry.loaded, () => {}); } catch {}
        } else entry.loaded();
      }
    };
    const layer = target => {
      if (motion || reduce?.matches) return;
      warm();
      if (!decoded.get(viewer.index)?.ready || images[target] && !decoded.get(target)?.ready) return;
      const overlay = document.createElement('div'); overlay.className = 'ct-profile-photo-layer'; overlay.setAttribute('aria-hidden', 'true');
      const track = document.createElement('div'); track.className = 'ct-profile-photo-track';
      const panes = new Map();
      for (const index of [viewer.index - 1, viewer.index, viewer.index + 1]) {
        const pane = document.createElement('div'); pane.className = 'ct-profile-photo-pane';
        const entry = decoded.get(index); if (entry?.ready) pane.append(entry.image); track.append(pane); panes.set(index, pane);
      }
      overlay.append(track); stage.append(overlay); image.classList.add('ct-profile-photo-covered');
      motion = { layer: overlay, track, panes, frame: 0, timer: null, offset: 0, loaded: null };
      track.style.transform = 'translate3d(-100%,0,0)';
    };
    const offset = dx => {
      if (!motion) return;
      motion.offset = dx; if (motion.frame) return;
      const current = motion;
      current.frame = requestAnimationFrame(() => {
        current.frame = 0;
        if (motion === current) current.track.style.transform = `translate3d(calc(-100% + ${current.offset}px),0,0)`;
      });
    };
    const settle = target => {
      if (!valid()) { ctProfileCloseViewer(); return; }
      const current = motion, before = viewer.index, commit = target !== before;
      if (commit && !reduce?.matches && !decoded.get(target)?.ready) {
        // Keep the shown photo while the destination is unavailable. Late loads
        // can select it only within this live gesture's bounded wait.
        reset(); queued = target; waitTimer = setTimeout(reset, 1600); warm(); return;
      }
      if (commit) { viewer.index = target; show(); }
      if (!current) { warm(); return; }
      cancelAnimationFrame(current.frame); current.frame = 0;
      current.track.style.transform = `translate3d(calc(-100% + ${current.offset}px),0,0)`;
      current.track.getBoundingClientRect();
      current.track.style.transition = 'transform 220ms cubic-bezier(.22,.68,0,1)';
      current.track.style.transform = `translate3d(${commit ? target > before ? '-200%' : '0%' : '-100%'},0,0)`;
      current.timer = setTimeout(() => {
        if (motion !== current) return;
        if (!valid()) { ctProfileCloseViewer(); return; }
        const release = () => { if (motion === current) { reset(); warm(); } };
        if (!commit || image.complete && image.naturalWidth > 0 && image.currentSrc === images[target].url) release();
        else {
          current.loaded = event => {
            if (image.src === images[target].url && (event.type === 'error' ||
                image.complete && image.naturalWidth > 0 && image.currentSrc === images[target].url)) release();
          };
          image.addEventListener('load', current.loaded); image.addEventListener('error', current.loaded);
          current.timer = setTimeout(release, 1200);
        }
      }, 240);
    };
    const start = (event, point) => {
      if (!valid()) { ctProfileCloseViewer(); return; }
      if (!point || images.length < 2 || motion || queued != null || pinch || ctPhotoViewportZoomed() ||
          event.target !== image && event.target !== stage) return;
      touch = { x: point.clientX, y: point.clientY, at: performance.now(), locked: false, pointer: event.pointerId,
        width: stage.clientWidth || window.innerWidth };
    };
    const drag = (event, point) => {
      if (!touch || !point) return;
      if (!valid()) { ctProfileCloseViewer(); return; }
      if (pinch || ctPhotoViewportZoomed()) { cancel(); return; }
      const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
      if (!touch.locked) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { touch = null; return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        touch.locked = true; layer(viewer.index + (dx < 0 ? 1 : -1));
        if (event.pointerId != null) try { event.target.setPointerCapture(event.pointerId); touch.capture = event.target; } catch {}
      }
      if (event.cancelable) event.preventDefault();
      const edge = viewer.index === 0 && dx > 0 || viewer.index === images.length - 1 && dx < 0;
      const target = viewer.index + (dx < 0 ? 1 : -1);
      // A reversed drag may face the still-undecoded neighbor. Keep the center
      // photo visible until that pane is ready instead of exposing a black pane.
      offset(images[target] && !decoded.get(target)?.ready ? 0 : edge ? dx * .22 : Math.max(-touch.width, Math.min(touch.width, dx)));
    };
    const end = (event, point) => {
      const current = touch; if (!current || !point) return;
      drag(event, point); if (touch !== current) return;
      touch = null;
      if (current.locked) {
        const dx = point.clientX - current.x, fast = Math.abs(dx) >= 24 && Math.abs(dx) / Math.max(1, performance.now() - current.at) > .55;
        const target = Math.max(0, Math.min(images.length - 1, viewer.index + (dx < 0 ? 1 : -1)));
        suppressUntil = Date.now() + 400; settle(fast || Math.abs(dx) >= Math.min(90, current.width * .18) ? target : viewer.index);
      }
      if (current.pointer != null) try { current.capture?.releasePointerCapture(current.pointer); } catch {}
    };
    const pointer = typeof window.PointerEvent === 'function';
    if (pointer) {
      listen(dialog, 'pointerdown', event => {
        if (event.pointerType !== 'mouse') {
          pointers.add(event.pointerId);
          if (event.isPrimary === false || pointers.size > 1) { pinch = true; cancel(); return; }
        }
        if (event.button === 0) start(event, event);
      });
      listen(dialog, 'pointermove', event => { if (touch?.pointer === event.pointerId) drag(event, event); });
      listen(dialog, 'pointerup', event => {
        pointers.delete(event.pointerId); if (pinch) cancel(); else if (touch?.pointer === event.pointerId) end(event, event);
        if (!pointers.size) pinch = false;
      });
      listen(dialog, 'pointercancel', event => { pointers.delete(event.pointerId); cancel(); if (!pointers.size) pinch = false; });
      listen(dialog, 'lostpointercapture', event => { if (touch?.pointer === event.pointerId) cancel(); });
    }
    listen(dialog, 'touchstart', event => {
      if (event.touches?.length !== 1 || ctPhotoViewportZoomed()) { pinch = true; cancel(); }
      else if (!pointer && !pinch) start(event, event.touches[0]);
    }, { passive: true });
    listen(dialog, 'touchmove', event => {
      if (event.touches?.length !== 1 || ctPhotoViewportZoomed()) { pinch = true; cancel(); }
      else if (!pointer && !pinch) drag(event, event.touches[0]);
    }, { passive: false });
    listen(dialog, 'touchend', event => {
      if (pinch || ctPhotoViewportZoomed()) cancel(); else if (!pointer) end(event, event.changedTouches?.[0]);
      if (!event.touches?.length) pinch = false;
    });
    listen(dialog, 'touchcancel', event => { cancel(); pinch = !!event.touches?.length; pointers.clear(); });
    listen(dialog, 'dragstart', event => { if (touch && event.target === image) event.preventDefault(); });
    listen(dialog, 'click', event => {
      if (Date.now() < suppressUntil && (event.target === image || event.target === stage)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    const pause = () => { cancel(); forget(); pointers.clear(); pinch = false; };
    listen(document, 'visibilitychange', () => { if (document.hidden) pause(); else warm(); });
    listen(window, 'pagehide', pause);
    listen(reduce, 'change', () => { cancel(); forget(); warm(); });
    return {
      move: step => { cancel(); if (!valid()) { ctProfileCloseViewer(); return; } viewer.index = Math.max(0, Math.min(images.length - 1, viewer.index + step)); show(); warm(); },
      fit: result => { dialog.classList.toggle('ct-profile-viewer-zoomed', result.zoomed); if (result.zoomed || result.changed) { cancel(); forget(); } warm(); },
      cleanup: () => { closed = true; pause(); for (const [target, name, handler, options] of listeners) target?.removeEventListener?.(name, handler, options); }
    };
  }
  function ctProfileOpenViewer(images, index, trigger) {
    ctProfileCloseViewer();
    const dialog = document.createElement('dialog');
    // If a browser lacks modal dialogs, the unchanged post link still opens
    // Tweet's own media viewer. Do not emulate a broken focus trap.
    if (typeof dialog.showModal !== 'function') return;
    dialog.className = 'ct-profile-viewer';
    dialog.dataset.ctLocalUi = 'profile-media-viewer';
    dialog.setAttribute('aria-label', ctProfileText('写真を拡大', 'Enlarged photos'));
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    const stage = document.createElement('div'); stage.className = 'ct-profile-viewer-stage'; stage.append(img);
    const nav = document.createElement('div'); nav.className = 'ct-profile-viewer-nav';
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹';
    previous.setAttribute('aria-label', ctProfileText('前の写真', 'Previous photo'));
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = '›';
    next.setAttribute('aria-label', ctProfileText('次の写真', 'Next photo'));
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', ctProfileText('閉じる', 'Close'));
    const viewer = { dialog, stage, image: img, images: images.map(image => ({ ...image })), index, trigger,
      gallery: trigger.closest('.ct-profile-gallery'), sources: images.map(image => image.url).join('\n') };
    const show = () => {
      img.src = images[viewer.index].url;
      img.alt = ctProfileText(`写真 ${viewer.index + 1}/${images.length}`, `Photo ${viewer.index + 1}/${images.length}`);
      count.textContent = `${viewer.index + 1} / ${images.length}`;
      previous.disabled = viewer.index === 0; next.disabled = viewer.index === images.length - 1;
    };
    let gestures;
    const move = step => gestures.move(step);
    previous.onclick = () => move(-1); next.onclick = () => move(1); close.onclick = ctProfileCloseViewer;
    dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); ctProfileCloseViewer(); });
    nav.append(previous, count, next, close); dialog.append(stage, nav); document.body.append(dialog);
    const viewport = window.visualViewport;
    const fit = () => { const result = ctPhotoViewportFit(dialog, '--ct-photo-view-'); gestures.fit(result); };
    viewport?.addEventListener('resize', fit); viewport?.addEventListener('scroll', fit); window.addEventListener('resize', fit);
    ctProfileState.viewer = viewer;
    viewer.cleanup = () => {
      gestures.cleanup();
      viewport?.removeEventListener('resize', fit); viewport?.removeEventListener('scroll', fit); window.removeEventListener('resize', fit);
    };
    gestures = ctProfilePhotoGestures(viewer, show);
    fit();
    show();
    if (typeof ctMediaAttachPhotoQuality === 'function') ctMediaAttachPhotoQuality(dialog, img);
    try { dialog.showModal(); close.focus(); } catch { ctProfileCloseViewer(); }
  }
  function ctProfileRestoreNative() {
    ctProfileState.timeline?.removeAttribute('data-ct-profile-timeline-hidden');
    ctProfileState.tablist?.removeAttribute('data-ct-profile-active');
    for (const [tab, selected] of ctProfileState.nativeSelection) {
      if (tab.isConnected && tab.getAttribute('aria-selected') === 'false') tab.setAttribute('aria-selected', selected);
    }
    ctProfileState.nativeSelection.clear();
    ctProfileState.panel?.remove(); ctProfileState.panel = null;
    ctProfileState.rendered = '';
    ctProfileCloseViewer();
  }
  function closeFavoritesPanel() {
    ctProfileClearFavoriteBackupParts();
    ctProfileState.sequence++;
    ctProfileState.favoriteMutes = null;
    ctProfileState.active = ''; favoritesActive = false;
    ctProfileRestoreNative();
    for (const tab of ctProfileState.tablist?.querySelectorAll('[data-ct-profile-tab]') || []) {
      if (tab.getAttribute('aria-selected') !== 'false') tab.setAttribute('aria-selected', 'false');
    }
  }
  function ctProfileReset() {
    closeFavoritesPanel();
    ctProfileState.tablist?.removeAttribute('data-ct-profile-tabs');
    for (const tab of ctProfileState.tablist?.querySelectorAll('[data-ct-profile-tab]') || []) tab.remove();
    ctProfileState.tablist = null; ctProfileState.timeline = null; ctProfileState.media = null;
    ctProfileState.path = ''; ctProfileState.user = '';
  }
  function ctProfileBindStorage() {
    if (ctProfileState.storageBound) return;
    ctProfileState.storageBound = true;
    window.addEventListener('storage', event => {
      if (event.key === ctProfileFavoriteKey(ctProfileUID() || '') || event.key === KEY.favorites + ':owner') {
        ctProfileClearFavoriteBackupParts(); renderFavoritesPanel();
      }
    });
    window.addEventListener('pagehide', () => { ctProfileCloseViewer(); ctProfileClearFavoriteBackupParts(); });
    window.addEventListener('ct-favorite-history-change', renderFavoritesPanel);
    document.addEventListener('click', event => {
      const button = event.target.closest?.('button');
      if (!button || button.disabled || button.closest('[data-ct-owned],[data-ct-local-ui],[data-user-content],.tl-user-text,.whitespace-pre-wrap,.break-words,[contenteditable]')) return;
      const label = button.getAttribute('aria-label') || '';
      const title = button.querySelector(':scope > span.min-w-0.truncate')?.getAttribute('title') || '';
      const menuMute = button.querySelector(':scope > svg.lucide-volume-x,:scope > svg.lucide-volume-2') &&
        /^(?:Mute user|Unmute user|ミュートする|ミュートを解除|(?:Mute|Unmute) @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+をミュート|@[A-Za-z0-9_.-]+のミュートを解除)$/.test(title) &&
        (button.matches('[role="menuitem"]') || button.closest('article'));
      const settingsUnmute = /^\/(?:settings)\/?$/.test(location.pathname) &&
        /^(?:Unmute @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+のミュートを解除)$/.test(label) &&
        /^(?:Unmute|ミュートを解除)$/.test(button.textContent.trim());
      const report = button.closest('[role="dialog"][aria-modal="true"].bg-tl-app-card.border');
      const reportMute = report && /^(?:Report @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+を報告)$/.test(report.getAttribute('aria-label') || '') &&
        report.querySelector('h3.text-sm.font-bold.text-tl-app-text') && button.matches('button.w-full.rounded-full.border[aria-busy]') &&
        /^(?:Mute @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+をミュート)$/.test(button.textContent.trim());
      if (!menuMute && !settingsUnmute && !reportMute) return;
      // A native mute action changes visibility. Discard only short-lived
      // read caches; never alter the user's saved Favorites.
      ctProfileState.muteCache.clear();
      ctProfileState.mediaCache.clear();
      ctProfileState.sequence++;
      ctProfileState.favoriteMutes = null;
      ctProfileState.media = null;
      ctProfileState.rendered = '';
      if (ctProfileState.active === 'favorites') renderFavoritesPanel();
      else if (ctProfileState.active === 'media') ctProfileRenderMedia();
    }, true);
  }
  async function ctProfileEnsureIdentity(context) {
    if (ctProfileState.identityBusy || Date.now() < ctProfileState.identityRetry) return;
    ctProfileState.identityBusy = true;
    const path = context.path;
    try {
      const auth = await getAuth();
      if (location.pathname !== path || ctProfileUID() !== (auth?.uid || null)) return;
      if (!auth?.uid || !auth?.token) { ctProfileState.identityRetry = Date.now() + 10000; return; }
      if (ctProfileState.uid === auth.uid && ctProfileState.accountUser) return;
      ctProfileState.identityRetry = Date.now() + 10000;
      const json = await requestJSON(API_ORIGIN + '/api/user-profile/' + encodeURIComponent(auth.uid), {
        Authorization: `Bearer ${auth.token}`
      });
      if (location.pathname !== path || ctProfileUID() !== auth.uid || ctProfileContext()?.user !== context.user) return;
      const user = json?.success !== false && !json?.error ? ctProfileHandle(json?.profile?.username) : null;
      if (!user) { ctProfileState.identityRetry = Date.now() + 10000; return; }
      ctProfileState.uid = auth.uid; ctProfileState.accountUser = user;
      patchFavoriteProfileTab();
    } finally { ctProfileState.identityBusy = false; }
  }
  function ctProfileCreateTab(type) {
    const tab = document.createElement('button');
    tab.id = type === 'favorites' ? 'ct-favorites-tab' : 'ct-media-tab';
    tab.type = 'button'; tab.className = 'ct-profile-tab'; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false'); tab.dataset.ctProfileTab = type;
    const label = type === 'favorites' ? ctProfileText('お気に入り', 'Favorites') : ctProfileText('写真・動画', 'Media');
    tab.setAttribute('aria-label', label); tab.title = label; tab.setAttribute('aria-controls', type === 'favorites' ? 'ct-favorites-panel' : 'ct-media-panel');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', type === 'favorites' ? 'm12 3 2.8 5.7 6.3.9-4.55 4.43 1.08 6.26L12 17.34l-5.63 2.95 1.08-6.26L2.9 9.6l6.3-.9L12 3Z' : 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M16 8h.01');
    svg.append(path); const text = document.createElement('span'); text.className = 'ct-profile-tab-label'; text.textContent = label;
    tab.append(svg, text);
    tab.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      const context = ctProfileContext();
      if (!context || context.tablist !== ctProfileState.tablist) return;
      if (type === 'favorites' && (!ctProfileUID() || ctProfileState.accountUser !== context.user)) return;
      if (ctProfileState.active === type) return;
      ctProfileCloseViewer(); ctProfileState.sequence++;
      if (type !== 'favorites') ctProfileClearFavoriteBackupParts();
      ctProfileState.active = type; favoritesActive = type === 'favorites'; ctProfileState.rendered = '';
      ctProfileState.favoriteMutes = null;
      ctProfileShow(context);
      if (type === 'media' && !ctProfileMediaState().started) ctProfileLoadMedia();
      if (type === 'favorites') ctProfileLoadFavoriteMutes();
    };
    return tab;
  }
  function patchFavoriteProfileTab() {
    ctProfileBindStorage();
    const context = ctProfileContext();
    if (!context) { ctProfileReset(); return; }
    const knownUid = ctProfileUID();
    if (ctProfileState.authSeen !== knownUid) {
      ctProfileState.authSeen = knownUid; ctProfileState.identityRetry = 0;
    }
    if (ctProfileState.uid && ctProfileState.uid !== knownUid) {
      ctProfileState.muteCache.clear();
      ctProfileState.mediaCache.clear();
      ctProfileReset(); ctProfileState.uid = null; ctProfileState.accountUser = ''; ctProfileState.identityRetry = 0;
    }
    if (ctProfileState.path !== context.path || ctProfileState.user !== context.user || ctProfileState.tablist !== context.tablist) {
      ctProfileReset();
      ctProfileState.path = context.path; ctProfileState.user = context.user;
      ctProfileState.tablist = context.tablist; ctProfileState.timeline = context.timeline;
    } else if (ctProfileState.timeline !== context.timeline) {
      // React replaced its current list. Restore the detached list's marker and
      // apply only to the new, verified direct timeline sibling.
      ctProfileState.timeline?.removeAttribute('data-ct-profile-timeline-hidden');
      ctProfileState.timeline = context.timeline;
    }
    ctProfileStyles();
    if (!context.tablist.hasAttribute('data-ct-profile-tabs')) context.tablist.setAttribute('data-ct-profile-tabs', '');
    if (!context.tablist.querySelector('#ct-media-tab')) context.tablist.append(ctProfileCreateTab('media'));
    if (/^\/profile\/?$/.test(context.path) && ctProfileState.accountUser && ctProfileState.accountUser !== context.user) {
      // Native profile edits can change the handle without changing Firebase uid.
      // Recheck once; a mismatching server response is throttled by identityRetry.
      ctProfileState.accountUser = '';
    }
    const own = knownUid && ctProfileState.uid === knownUid && ctProfileState.accountUser === context.user;
    let favorites = context.tablist.querySelector('#ct-favorites-tab');
    if (own && !favorites) context.tablist.append(ctProfileCreateTab('favorites'));
    if (!own && favorites) { favorites.remove(); if (favoritesActive) closeFavoritesPanel(); }
    if (!ctProfileState.tabsBound.has(context.tablist)) {
      ctProfileState.tabsBound.add(context.tablist);
      context.tablist.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const target = event.target.closest('button[role="tab"]');
        const tabs = [...context.tablist.children].filter(el => el.matches('button[role="tab"]'));
        const index = tabs.indexOf(target);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
          (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
        tabs[next].focus();
      });
    }
    for (const tab of context.nativeTabs) {
      if (ctProfileState.tabsBound.has(tab)) continue;
      ctProfileState.tabsBound.add(tab);
      tab.addEventListener('click', () => closeFavoritesPanel(), true);
    }
    if (!ctProfileState.uid || !ctProfileState.accountUser) ctProfileEnsureIdentity(context);
    if (ctProfileState.active) ctProfileShow(context);
  }
  function ctProfileShow(context) {
    if (!ctProfileState.active || !context || context.path !== ctProfileState.path || context.user !== ctProfileState.user) return;
    if (!context.timeline.hasAttribute('data-ct-profile-timeline-hidden')) context.timeline.setAttribute('data-ct-profile-timeline-hidden', '');
    if (context.tablist.dataset.ctProfileActive !== ctProfileState.active) context.tablist.dataset.ctProfileActive = ctProfileState.active;
    for (const tab of context.nativeTabs) {
      if (!ctProfileState.nativeSelection.has(tab)) ctProfileState.nativeSelection.set(tab, tab.getAttribute('aria-selected') || 'false');
      if (tab.getAttribute('aria-selected') !== 'false') tab.setAttribute('aria-selected', 'false');
    }
    for (const tab of context.tablist.querySelectorAll('[data-ct-profile-tab]')) {
      const selected = String(tab.dataset.ctProfileTab === ctProfileState.active);
      if (tab.getAttribute('aria-selected') !== selected) tab.setAttribute('aria-selected', selected);
    }
    if (!ctProfileState.panel?.isConnected) {
      const panel = document.createElement('section'); panel.dataset.ctProfilePanel = ''; panel.dataset.ctLocalUi = 'profile';
      panel.id = ctProfileState.active === 'favorites' ? 'ct-favorites-panel' : 'ct-media-panel';
      panel.setAttribute('role', 'tabpanel');
      ctProfileState.panel = panel; context.tablist.after(panel); ctProfileState.rendered = '';
    }
    const panel = ctProfileState.panel;
    const id = ctProfileState.active === 'favorites' ? 'ct-favorites-panel' : 'ct-media-panel';
    if (panel.id !== id) panel.id = id;
    const label = ctProfileState.active === 'favorites' ? 'ct-favorites-tab' : 'ct-media-tab';
    if (panel.getAttribute('aria-labelledby') !== label) panel.setAttribute('aria-labelledby', label);
    if (ctProfileState.active === 'favorites') renderFavoritesPanel();
    else ctProfileRenderMedia();
  }
  function ctProfileStatus(text) {
    const el = document.createElement('div'); el.className = 'ct-profile-status'; el.textContent = text; return el;
  }
  function ctProfileToolbarSummary(el, text, description = text) {
    if (el.textContent !== text) el.textContent = text;
    if (el.getAttribute('aria-label') !== description) el.setAttribute('aria-label', description);
    if (el.title !== description) el.title = description;
  }
  function ctProfileControl(text, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ct-profile-control';
    button.textContent = text; button.onclick = action; return button;
  }
  function ctProfileRow(item) {
    const row = document.createElement('div'); row.className = 'ct-profile-row'; row.dataset.ctProfilePost = item.id;
    ctProfileState.rowItems.set(row, JSON.stringify(item));
    if (item.avatar) {
      const avatarLink = document.createElement('a'); avatarLink.href = '/user/' + encodeURIComponent(item.username);
      const avatar = document.createElement('img'); avatar.className = 'ct-profile-avatar'; avatar.src = item.avatar;
      avatar.alt = ctProfileText(`${item.name || item.username}のプロフィール`, `${item.name || item.username}'s profile`);
      avatar.loading = 'lazy'; avatar.referrerPolicy = 'no-referrer'; avatarLink.append(avatar); row.append(avatarLink);
    }
    const main = document.createElement('div'); main.className = 'ct-profile-row-main';
    const meta = document.createElement('div'); meta.className = 'ct-profile-meta';
    const name = document.createElement('a'); name.className = 'ct-profile-name'; name.href = item.username ? '/user/' + encodeURIComponent(item.username) : item.href;
    name.textContent = item.name || item.username; meta.append(name);
    if (item.username) {
      const handle = document.createElement('span'); handle.className = 'ct-profile-handle'; handle.textContent = '@' + item.username; meta.append(handle);
    }
    const created = ctTimestampParse(item.createdAt);
    if (created) {
      const time = document.createElement('time'); time.className = 'ct-profile-time'; time.dateTime = item.createdAt;
      const locale = CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US';
      time.textContent = created.toLocaleString(locale, { year: 'numeric', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      time.title = `${ctTimestampExactText(item.createdAt)} (${item.createdAt})`; meta.append(time);
    }
    main.append(meta);
    if (item.text) { const text = document.createElement('p'); text.className = 'ct-profile-text'; text.textContent = item.text; main.append(text); }
    const images = (item.media || []).filter(asset => asset.type === 'image');
    if (images.length) {
      const gallery = document.createElement('div'); gallery.className = 'ct-profile-gallery';
      gallery.setAttribute('aria-label', ctProfileText('投稿の写真', 'Post photos'));
      for (const [index, asset] of images.entries()) {
        const photo = document.createElement('button'); photo.type = 'button'; photo.className = 'ct-profile-photo';
        photo.setAttribute('aria-label', ctProfileText(`写真 ${index + 1}/${images.length}を拡大`, `Enlarge photo ${index + 1}/${images.length}`));
        const image = document.createElement('img'); image.src = asset.url; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        image.alt = ctProfileText(`投稿の写真 ${index + 1}/${images.length}`, `Post photo ${index + 1}/${images.length}`);
        photo.append(image); photo.onclick = () => ctProfileOpenViewer(images, index, photo); gallery.append(photo);
      }
      main.append(gallery);
      if (images.length > 1) {
        const note = document.createElement('p'); note.className = 'ct-profile-media-note';
        note.textContent = ctProfileText(`写真${images.length}枚 · 横にスクロールして表示`, `${images.length} photos · Scroll sideways to view all`); main.append(note);
      }
    }
    for (const asset of (item.media || []).filter(asset => asset.type === 'video')) {
      const video = document.createElement('video'); video.className = 'ct-profile-video'; video.src = asset.url;
      if (asset.poster) video.poster = asset.poster; video.controls = true; video.playsInline = true; video.preload = 'none';
      video.setAttribute('aria-label', ctProfileText('投稿の動画', 'Post video')); main.append(video);
    }
    const link = document.createElement('a'); link.className = 'ct-profile-post-link'; link.href = item.href;
    link.textContent = ctProfileText('元のツイートを開く', 'Open original Tweet'); main.append(link); row.append(main); return row;
  }
  function ctProfileExistingRows(panel) {
    return new Map([...panel.querySelectorAll(':scope > .ct-profile-row[data-ct-profile-post]')]
      .map(row => [row.dataset.ctProfilePost, row]));
  }
  function ctProfileReuseRow(item, rows) {
    const row = rows.get(item.id);
    return row && ctProfileState.rowItems.get(row) === JSON.stringify(item) ? row : ctProfileRow(item);
  }
  function ctProfileReplaceContent(panel, content, focused) {
    const retained = new Set(content);
    for (const node of [...panel.childNodes]) if (!retained.has(node)) node.remove();
    let next = panel.firstChild;
    for (const node of content) {
      if (node === next) next = next.nextSibling;
      else panel.insertBefore(node, next);
    }
    const viewer = ctProfileState.viewer;
    if (viewer && (!viewer.trigger?.isConnected || !viewer.gallery?.isConnected ||
        viewer.sources !== [...viewer.gallery.querySelectorAll(':scope > .ct-profile-photo > img')].map(image => image.src).join('\n'))) {
      ctProfileCloseViewer();
    }
    if (typeof ctMediaEnhanceVideo === 'function') {
      for (const video of panel.querySelectorAll('video.ct-profile-video[controls]')) ctMediaEnhanceVideo(video);
    }
    if (focused && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
  function ctProfileFavoriteMuteState() {
    const uid = ctProfileUID();
    if (!ctProfileState.favoriteMutes || ctProfileState.favoriteMutes.uid !== uid ||
        ctProfileState.favoriteMutes.path !== ctProfileState.path || ctProfileState.favoriteMutes.user !== ctProfileState.user) {
      const cached = uid && ctProfileState.muteCache.get(uid);
      const recent = cached && Date.now() - cached.at < 30000;
      ctProfileState.favoriteMutes = { uid, path: ctProfileState.path, user: ctProfileState.user,
        handles: new Set(), cursors: new Set(), cursor: null, pages: 0, busy: false, done: false, error: '' };
      if (recent) {
        ctProfileState.favoriteMutes.handles = new Set(cached.handles);
        ctProfileState.favoriteMutes.done = true;
      } else if (cached) ctProfileState.muteCache.delete(uid);
    }
    return ctProfileState.favoriteMutes;
  }
  function ctProfileFavoriteMuteCurrent(state, sequence) {
    return favoritesActive && ctProfileState.active === 'favorites' && ctProfileState.favoriteMutes === state &&
      sequence === ctProfileState.sequence && location.pathname === state.path && ctProfileState.path === state.path &&
      ctProfileState.user === state.user && ctProfileUID() === state.uid && ctProfileState.uid === state.uid &&
      ctProfileState.accountUser === state.user && ctProfileContext()?.user === state.user;
  }
  async function ctProfileLoadFavoriteMutes(refresh = false) {
    if (!favoritesActive || ctProfileState.active !== 'favorites') return;
    let state = ctProfileFavoriteMuteState();
    if (state.busy || (!refresh && state.done)) return;
    if (refresh) {
      ctProfileCloseViewer(); ctProfileState.sequence++;
      ctProfileState.muteCache.delete(ctProfileUID());
      ctProfileState.favoriteMutes = null; state = ctProfileFavoriteMuteState();
    }
    const sequence = ctProfileState.sequence;
    if (!state.uid || !ctProfileFavoriteMuteCurrent(state, sequence)) { renderFavoritesPanel(); return; }
    const active = () => !document.hidden && (typeof ctPageActive === 'undefined' || ctPageActive);
    const paused = () => ctProfileText('このタブを表示してから、ミュート一覧の確認を再開してください。', 'Show this tab, then continue checking muted accounts.');
    if (!active()) { state.error = paused(); renderFavoritesPanel(); return; }
    state.busy = true; state.error = ''; renderFavoritesPanel();
    try {
      const auth = await getAuth();
      if (!ctProfileFavoriteMuteCurrent(state, sequence)) return;
      if (!auth?.token || auth.uid !== state.uid) throw new Error('sign-in');
      const headers = { Authorization: `Bearer ${auth.token}` };
      // Tweet's native muted-accounts consumer uses opaque nextCursor values,
      // with no limit override. Check at most ten pages per explicit action.
      for (let page = 0; page < 10 && !state.done; page++) {
        if (!ctProfileFavoriteMuteCurrent(state, sequence)) return;
        if (!active()) { state.error = paused(); return; }
        const cursor = state.cursor;
        const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor);
        const json = await requestJSON(API_ORIGIN + '/api/users/muted' + (cursor ? '?' + query : ''), headers);
        const current = await getAuth();
        if (!ctProfileFavoriteMuteCurrent(state, sequence) || current?.uid !== state.uid) return;
        if (!active()) { state.error = paused(); return; }
        if (!json || json.success !== true || json.error || !Array.isArray(json.users) || json.users.length > 1000 ||
            json.users.some(user => !ctProfileId(user?.userId) || !ctProfileHandle(user?.username))) throw new Error('muted-response');
        const next = json.nextCursor ?? null;
        if (next !== null && (typeof next !== 'string' || !next || next.length > 2000 || next === cursor || state.cursors.has(next))) {
          throw new Error('muted-cursor');
        }
        for (const user of json.users) state.handles.add(ctProfileHandle(user.username));
        if (cursor) state.cursors.add(cursor);
        state.cursor = next; state.pages++; state.done = !next;
      }
      if (state.done && ctProfileFavoriteMuteCurrent(state, sequence) && active()) {
        ctProfileState.muteCache.set(state.uid, { at: Date.now(), handles: [...state.handles] });
        while (ctProfileState.muteCache.size > 4) ctProfileState.muteCache.delete(ctProfileState.muteCache.keys().next().value);
      }
    } catch {
      if (ctProfileFavoriteMuteCurrent(state, sequence)) state.error = ctProfileText(
        'ミュート一覧を確認できませんでした。保存した投稿を表示する前に、再試行してください。',
        'Muted accounts could not be checked. Try again before showing saved posts.');
    } finally {
      state.busy = false;
      if (ctProfileFavoriteMuteCurrent(state, sequence)) renderFavoritesPanel();
    }
  }
  const CT_FAVORITE_BACKUP_BYTES = 32 * 1024 * 1024;
  const CT_FAVORITE_BACKUP_ROWS = 100000;
  function ctProfileFavoriteStorageError(uid = ctProfileUID()) {
    return !!uid && (ctProfileState.dirtyMemory.has(uid) || ctProfileState.storageFailureUID === uid);
  }
  function ctProfileFavoriteView() {
    const uid = ctProfileUID();
    if (!ctProfileState.favoriteView || ctProfileState.favoriteView.uid !== uid) {
      ctProfileClearFavoriteBackupParts();
      ctProfileState.favoriteView = { uid, limit: 50, message: '', error: false, busy: false,
        backupParts: null, backupRevision: 0, backupURLs: new Map() };
    }
    return ctProfileState.favoriteView;
  }
  function ctProfileFavoriteViewCurrent(view) {
    return !!view?.uid && ctProfileState.favoriteView === view && view.uid === ctProfileUID() &&
      favoritesActive && ctProfileState.active === 'favorites' && ctProfileState.uid === view.uid &&
      ctProfileState.accountUser === ctProfileContext()?.user;
  }
  function ctProfileFavoriteMessage(view, text, error = false) {
    if (!ctProfileFavoriteViewCurrent(view)) return;
    view.message = text; view.error = error; renderFavoritesPanel();
  }
  function ctProfileFavoriteBackupParts(uid = ctProfileUID()) {
    if (!uid || uid !== ctProfileUID()) throw new Error('account');
    const header = JSON.stringify({ format: 'classic-twitter-favorites', version: 1, uid,
      account: ctProfileState.accountUser, exportedAt: new Date().toISOString() }).slice(0, -1) + ',"items":[';
    const overhead = new Blob([header + ']}']).size;
    const parts = []; let chunks = []; let bytes = overhead;
    for (const { href, ...item } of ctProfileLoadFavorites()) {
      const chunk = JSON.stringify(item); const size = new Blob([chunk]).size;
      // Each normalized record is bounded well below one part's byte limit.
      // Split the whole archive; never trim old rows after storage quota fails.
      if (chunks.length && (chunks.length >= CT_FAVORITE_BACKUP_ROWS || bytes + 1 + size > CT_FAVORITE_BACKUP_BYTES)) {
        parts.push(header + chunks.join(',') + ']}'); chunks = []; bytes = overhead;
      }
      bytes += (chunks.length ? 1 : 0) + size; chunks.push(chunk);
    }
    if (chunks.length || !parts.length) parts.push(header + chunks.join(',') + ']}');
    return parts;
  }
  function ctProfileFavoriteBackup(uid = ctProfileUID()) {
    const parts = ctProfileFavoriteBackupParts(uid);
    if (parts.length !== 1) throw new Error('parts');
    return parts[0];
  }
  function ctProfileClearFavoriteBackupParts(view = ctProfileState.favoriteView) {
    if (!view) return;
    for (const [url, timer] of view.backupURLs || []) {
      clearTimeout(timer); try { URL.revokeObjectURL(url); } catch {}
    }
    view.backupURLs?.clear(); view.backupParts = null; view.backupRevision = (view.backupRevision || 0) + 1;
    view.message = '';
    ctProfileState.panel?.querySelector('#ct-favorite-backup-parts')?.replaceChildren();
  }
  function ctProfileDownloadFavoriteBackup(view, text, index = 0, total = 1) {
    if (!ctProfileFavoriteViewCurrent(view)) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = 'tweet-favorites-' + new Date().toISOString().slice(0, 10) + (total > 1 ? `-part-${index + 1}-of-${total}` : '') + '.json';
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      const timer = setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} view.backupURLs.delete(url); }, 1000);
      view.backupURLs.set(url, timer);
    }
  }
  function ctProfileReadFavoriteBackup(text, uid) {
    if (typeof text !== 'string' || new Blob([text]).size > CT_FAVORITE_BACKUP_BYTES) throw new Error('size');
    const data = JSON.parse(text);
    const keys = (object, allowed) => object && typeof object === 'object' && !Array.isArray(object) &&
      Object.keys(object).every(key => allowed.includes(key));
    if (!keys(data, ['format', 'version', 'uid', 'account', 'exportedAt', 'items']) ||
        data.format !== 'classic-twitter-favorites' || data.version !== 1 || !ctProfileId(data.uid) ||
        typeof data.account !== 'string' || data.account.length > 80 ||
        typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt)) || !Array.isArray(data.items)) throw new Error('format');
    if (data.uid !== uid) throw new Error('account');
    if (data.items.length > CT_FAVORITE_BACKUP_ROWS) throw new Error('size');
    const safeURL = value => typeof value === 'string' && (value === '' || ctProfileURL(value) === value);
    for (const item of data.items) {
      if (!keys(item, ['id', 'username', 'name', 'text', 'avatar', 'savedAt', 'createdAt', 'media']) ||
          !ctProfileId(item.id) || typeof item.username !== 'string' || (item.username && !ctProfileHandle(item.username)) ||
          typeof item.name !== 'string' || item.name.length > 200 || typeof item.text !== 'string' || item.text.length > 10000 ||
          !safeURL(item.avatar) || typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt) || item.savedAt < 0 ||
          typeof item.createdAt !== 'string' || (item.createdAt && !ctTimestampParse(item.createdAt) && !Number.isFinite(Date.parse(item.createdAt))) ||
          !Array.isArray(item.media) || item.media.length > 16 || item.media.some(asset =>
            !keys(asset, ['type', 'url', 'poster']) || !['image', 'video'].includes(asset.type) ||
            !asset.url || !safeURL(asset.url) || !safeURL(asset.poster))) throw new Error('format');
    }
    return ctProfileFavoriteItems(data.items);
  }
  function ctProfileImportFavoriteBackup(text, expectedUid = ctProfileUID()) {
    if (!expectedUid || expectedUid !== ctProfileUID()) throw new Error('account');
    const imported = ctProfileReadFavoriteBackup(text, expectedUid);
    if (expectedUid !== ctProfileUID()) throw new Error('account');
    const existing = ctProfileLoadFavorites();
    const merged = ctProfileFavoriteItems([...existing, ...imported]);
    if (!ctProfileWriteFavorites(expectedUid, merged)) throw new Error('account');
    return merged.length - existing.length;
  }
  function ctProfileFavoriteBackupError(error) {
    return error?.message === 'account' ? ctProfileText('使用中のアカウントのバックアップだけを取り込めます。', 'Only a backup for the current account can be imported.') :
      error?.message === 'size' ? ctProfileText('バックアップは32MB・10万件以内です。データは変更していません。', 'Backups must fit within 32 MB and 100,000 records. Data has not changed.') :
        ctProfileText('バックアップを読み込めませんでした。形式とファイルを確認してください。データは変更していません。', 'Could not read the backup. Check its format and file. Data has not changed.');
  }
  function ctProfileFavoriteHistorySummary(uid) {
    if (!uid || uid !== ctProfileUID() || typeof ctFavoriteHistoryStatus !== 'function') return null;
    try {
      const status = ctFavoriteHistoryStatus();
      if (!status || !['for-you', 'following'].includes(status.source) ||
          !['pages', 'scanned', 'recovered'].every(key => Number.isSafeInteger(status[key]) && status[key] >= 0)) return null;
      return { source: status.source, pages: status.pages, scanned: status.scanned, recovered: status.recovered,
        busy: status.busy === true, paused: status.paused === true, done: status.done === true,
        error: !!status.error, warning: !!status.warning };
    } catch { return null; }
  }
  function ctProfileFavoriteHistoryText(status) {
    const scope = ctProfileText('復元の確認範囲：おすすめ・フォロー中（サービスが返す投稿）', 'Recovery scope: For you and Following (posts returned by Tweet)');
    if (!status || (!status.busy && !status.paused && !status.done && !status.error && !status.warning && !status.pages)) {
      return scope + '\n' + ctProfileText('復元状況：未確認 · 便利ツールから開始できます。', 'Recovery: not checked yet. Start from Tools.');
    }
    const phase = status.done ? ctProfileText('返された範囲の確認が終了', 'Returned timeline range checked') :
      status.error || status.warning ? ctProfileText('確認を中断', 'Checking interrupted') :
        status.busy ? ctProfileText('確認中', 'Checking') : ctProfileText('一時停止', 'Paused');
    const source = status.source === 'following' ? ctProfileText('フォロー中', 'Following') : ctProfileText('おすすめ', 'For you');
    return scope + '\n' + ctProfileText(`${phase}${status.done ? '' : `（${source}）`} · ${status.pages}ページ・${status.scanned}投稿を確認／${status.recovered}件を復元`,
      `${phase}${status.done ? '' : ` (${source})`} · ${status.pages} pages / ${status.scanned} posts checked / ${status.recovered} recovered`);
  }
  function ctProfileFavoriteDateRange(items) {
    let firstDate = Infinity; let lastDate = -Infinity; let dated = 0;
    for (const item of items) {
      const date = ctTimestampParse(item.createdAt)?.getTime();
      if (date === undefined) continue;
      firstDate = Math.min(firstDate, date); lastDate = Math.max(lastDate, date); dated++;
    }
    if (!dated) return ctProfileText('保存した投稿の日付範囲：日付未確認', 'Saved Tweet date range: dates unavailable');
    const locale = CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US';
    const first = new Date(firstDate).toLocaleDateString(locale);
    const last = new Date(lastDate).toLocaleDateString(locale);
    return ctProfileText(`保存した投稿の日付範囲（表示対象）：${first}〜${last} · 日付あり${dated}件`,
      `Saved Tweet date range (available records): ${first}–${last} · ${dated} dated`);
  }
  function ctProfileFavoriteTools(panel, view) {
    const previous = panel.querySelector(':scope > [data-ct-favorite-tools]');
    if (previous?.ctFavoriteView === view) return previous;
    const tools = document.createElement('div'); tools.className = 'ct-profile-toolbar ct-favorite-tools';
    tools.dataset.ctFavoriteTools = ''; tools.ctFavoriteView = view;
    const count = document.createElement('div'); count.id = 'ct-favorite-count'; count.className = 'ct-profile-toolbar-count'; count.setAttribute('role', 'status');
    const update = ctProfileControl(ctProfileText('更新', 'Refresh'), () => ctProfileLoadFavoriteMutes(true));
    update.id = 'ct-favorite-refresh'; update.setAttribute('aria-label', ctProfileText('お気に入りの表示を更新', 'Refresh Favorites view'));
    const details = document.createElement('details'); details.className = 'ct-profile-details';
    const summary = document.createElement('summary'); summary.textContent = ctProfileText('範囲・保存', 'Details');
    summary.setAttribute('aria-label', ctProfileText('お気に入りの取得範囲と保存操作', 'Favorites coverage and backup actions'));
    const body = document.createElement('div'); body.className = 'ct-profile-detail-body';
    details.append(summary, body); tools.append(count, update, details);
    const download = ctProfileControl(ctProfileText('バックアップを保存', 'Save local backup'), async () => {
      if (!ctProfileFavoriteViewCurrent(view)) return;
      try {
        const auth = await getAuth();
        if (!ctProfileFavoriteViewCurrent(view) || auth?.uid !== view.uid) return;
        const parts = ctProfileFavoriteBackupParts(view.uid); ctProfileClearFavoriteBackupParts(view);
        if (parts.length === 1) {
          ctProfileDownloadFavoriteBackup(view, parts[0]);
          ctProfileFavoriteMessage(view, ctProfileText('このアカウントのお気に入りのダウンロードを開始しました。', 'Started downloading a local Favorites backup for this account.'));
        } else {
          view.backupParts = parts; view.backupRevision++;
          ctProfileFavoriteMessage(view, ctProfileText(`${parts.length}個のファイルに分けました。下のボタンから全て保存してください。取り込むときは1個ずつ選択します。`, `Split the archive into ${parts.length} files. Save every part using the buttons below; import them one at a time.`));
        }
      } catch (error) { ctProfileFavoriteMessage(view, error?.message === 'size' ? ctProfileFavoriteBackupError(error) : ctProfileText('バックアップを保存できませんでした。ブラウザのダウンロード設定を確認してください。', 'Could not save the backup. Check browser download settings.'), true); }
    });
    download.id = 'ct-favorite-export';
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'ct-favorite-import-file';
    const importButton = ctProfileControl(ctProfileText('バックアップを取り込む', 'Import local backup'), () => {
      if (ctProfileFavoriteViewCurrent(view) && !view.busy) file.click();
    });
    importButton.id = 'ct-favorite-import';
    file.addEventListener('change', async () => {
      if (!ctProfileFavoriteViewCurrent(view) || view.busy || !file.files?.[0]) return;
      const selected = file.files[0]; view.busy = true; view.message = ''; renderFavoritesPanel();
      try {
        if (selected.size > CT_FAVORITE_BACKUP_BYTES) throw new Error('size');
        const text = typeof selected.text === 'function' ? await selected.text() : await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('file')); reader.readAsText(selected);
        });
        const auth = await getAuth();
        if (!ctProfileFavoriteViewCurrent(view) || auth?.uid !== view.uid) return;
        const added = ctProfileImportFavoriteBackup(text, view.uid);
        ctProfileFavoriteMessage(view, ctProfileFavoriteStorageError(view.uid) ? ctProfileText('取り込んだ内容を一時保持しています。ブラウザに保存できないため、この画面を閉じる前にバックアップしてください。', 'Imported records are held temporarily. Browser storage is unavailable; save a backup before closing this page.') :
          ctProfileText(`${added}件を取り込みました。Tweet上の星・いいねの状態は変更していません。`, `Imported ${added}. Favorite/Like states on Tweet were not changed.`), ctProfileFavoriteStorageError(view.uid));
      } catch (error) { ctProfileFavoriteMessage(view, ctProfileFavoriteBackupError(error), true); }
      finally { view.busy = false; file.value = ''; if (ctProfileFavoriteViewCurrent(view)) renderFavoritesPanel(); }
    });
    const actions = document.createElement('div'); actions.className = 'ct-profile-detail-actions'; actions.append(download, importButton, file);
    const explanation = document.createElement('div'); explanation.textContent = ctProfileText('このブラウザに保存したお気に入りです。便利ツールで過去のタイムラインから復元できます。全履歴の復元は保証できません。', 'Favorites saved in this browser. Use Tools to restore Favorites from the past timeline. Coverage of the entire past history is not guaranteed.');
    const note = document.createElement('div'); note.className = 'ct-favorite-summary'; note.textContent = ctProfileText('このアカウントのブラウザ内保存データです。バックアップの取り込みはTweet上のお気に入りを変更しません。', 'Browser-local data for this account. Importing a backup does not change Favorites on Tweet.');
    const range = document.createElement('div'); range.id = 'ct-favorite-range'; range.className = 'ct-favorite-summary';
    const history = document.createElement('div'); history.id = 'ct-favorite-history-scope'; history.className = 'ct-favorite-summary'; history.style.whiteSpace = 'pre-line'; history.setAttribute('role', 'status');
    const hidden = document.createElement('div'); hidden.id = 'ct-favorite-hidden-status'; hidden.className = 'ct-favorite-summary';
    body.append(range, history, hidden, explanation, note, actions);
    const message = document.createElement('div'); message.id = 'ct-favorite-backup-status'; message.className = 'ct-favorite-summary'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const storage = document.createElement('div'); storage.id = 'ct-favorite-storage-status'; storage.className = 'ct-favorite-summary'; storage.setAttribute('role', 'status'); storage.setAttribute('aria-live', 'polite');
    const parts = document.createElement('div'); parts.id = 'ct-favorite-backup-parts'; parts.className = 'ct-favorite-summary ct-profile-detail-actions';
    tools.append(message, storage, parts); return tools;
  }
  function renderFavoritesPanel() {
    if (!favoritesActive || ctProfileState.active !== 'favorites') return;
    const context = ctProfileContext();
    if (!context || !ctProfileUID() || ctProfileState.uid !== ctProfileUID() || ctProfileState.accountUser !== context.user) {
      closeFavoritesPanel(); return;
    }
    const panel = ctProfileState.panel;
    if (!panel?.isConnected) return;
    const items = ctProfileLoadFavorites(); const legacy = ctProfileLegacyFavorites();
    const uid = ctProfileUID(); const muted = ctProfileFavoriteMuteState(); const view = ctProfileFavoriteView();
    const storageError = ctProfileFavoriteStorageError(uid);
    const history = ctProfileFavoriteHistorySummary(uid);
    const signature = JSON.stringify(['favorites', uid, items, legacy.length, storageError,
      muted.busy, muted.done, muted.error, muted.pages, [...muted.handles], view.limit, view.message, view.error, view.busy, view.backupRevision, history]);
    if (signature === ctProfileState.rendered) return;
    ctProfileState.rendered = signature;
    const rows = ctProfileExistingRows(panel);
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const content = [];
    const tools = ctProfileFavoriteTools(panel, view);
    tools.querySelector('#ct-favorite-refresh').disabled = muted.busy;
    const importButton = tools.querySelector('#ct-favorite-import');
    if (importButton.disabled !== view.busy) importButton.disabled = view.busy;
    const message = tools.querySelector('#ct-favorite-backup-status');
    if (message.textContent !== view.message) message.textContent = view.message;
    if (message.dataset.error !== String(view.error)) message.dataset.error = String(view.error);
    const storage = tools.querySelector('#ct-favorite-storage-status');
    const storageText = storageError ? ctProfileText('ブラウザに保存できませんでした。この画面を閉じる前にバックアップを保存してください。', 'Browser storage is unavailable. Save a backup before closing this page.') : '';
    if (storage.textContent !== storageText) storage.textContent = storageText;
    const historyNode = tools.querySelector('#ct-favorite-history-scope'); const historyText = ctProfileFavoriteHistoryText(history);
    if (historyNode.textContent !== historyText) historyNode.textContent = historyText;
    const partControls = tools.querySelector('#ct-favorite-backup-parts');
    if (partControls.ctBackupParts !== view.backupParts) {
      partControls.ctBackupParts = view.backupParts; partControls.replaceChildren();
      const parts = view.backupParts;
      for (const [index, text] of (parts || []).entries()) partControls.append(ctProfileControl(
        ctProfileText(`ファイル${index + 1}/${parts.length}を保存`, `Save part ${index + 1}/${parts.length}`), async () => {
          if (!ctProfileFavoriteViewCurrent(view) || view.backupParts !== parts) return;
          try {
            const auth = await getAuth();
            if (!ctProfileFavoriteViewCurrent(view) || auth?.uid !== view.uid || view.backupParts !== parts) return;
            ctProfileDownloadFavoriteBackup(view, text, index, parts.length);
            ctProfileFavoriteMessage(view, ctProfileText(`ファイル${index + 1}/${parts.length}のダウンロードを開始しました。全てのファイルを保存してください。`, `Started downloading part ${index + 1}/${parts.length}. Save every part.`));
          } catch { ctProfileFavoriteMessage(view, ctProfileText('ファイルを保存できませんでした。もう一度お試しください。', 'Could not save this part. Try again.'), true); }
        }));
    }
    content.push(tools);
    if (legacy.length) {
      const migration = ctProfileStatus(ctProfileText('以前の保存データがあります。使用中のアカウントのものか確認して取り込めます。', 'Older saved data is available. Import it if it belongs to this account.'));
      migration.append(ctProfileControl(ctProfileText('以前の保存データを取り込む', 'Import older saved data'), () => ctProfileImportFavorites(uid))); content.push(migration);
    }
    if (!muted.done) {
      const hidden = tools.querySelector('#ct-favorite-hidden-status'); if (hidden.textContent) hidden.textContent = '';
      const count = tools.querySelector('#ct-favorite-count');
      const summary = ctProfileText(`このアカウントに保存済み${items.length}件 · 表示前にミュート一覧の確認が必要です`, `${items.length} saved for this account · Muted accounts must be checked before display`);
      const phase = muted.busy ? ctProfileText('確認中', 'Checking') : ctProfileText('未確認', 'Not checked');
      ctProfileToolbarSummary(count, ctProfileText(`保存${items.length}件 · ${phase}`, `${items.length} saved · ${phase}`), summary);
      const range = tools.querySelector('#ct-favorite-range'); const rangeText = muted.busy ?
        ctProfileText('保存した投稿の日付範囲：ミュート一覧を確認中', 'Saved Tweet date range: checking muted accounts') :
        ctProfileText('保存した投稿の日付範囲：ミュート一覧が未確認', 'Saved Tweet date range: muted accounts not checked');
      if (range.textContent !== rangeText) range.textContent = rangeText;
      const waiting = ctProfileStatus(muted.busy ? ctProfileText('ミュート一覧を確認中…', 'Checking muted accounts…') :
        muted.error || ctProfileText('ミュート一覧の確認が終わるまで、保存した投稿を表示しません。', 'Saved posts stay hidden until muted accounts have been checked.'));
      waiting.setAttribute('role', 'status');
      if (!muted.busy) waiting.append(ctProfileControl(
        muted.error ? ctProfileText('再試行', 'Try again') : ctProfileText('続きを確認', 'Continue checking'), () => ctProfileLoadFavoriteMutes()));
      content.push(waiting);
    } else {
      const unmuted = items.filter(item => item.username && !muted.handles.has(item.username));
      const hidden = tools.querySelector('#ct-favorite-hidden-status');
      const hiddenText = unmuted.length < items.length ? ctProfileText(
        `ミュートした作者や作者を確認できない投稿${items.length - unmuted.length}件を非表示にしています。保存データは保持しています。`,
        `${items.length - unmuted.length} saved posts from muted or unidentified authors are hidden. Saved data is retained.`) : '';
      if (hidden.textContent !== hiddenText) hidden.textContent = hiddenText;
      const matching = unmuted.sort((a, b) => b.savedAt - a.savedAt);
      const visible = matching.slice(0, view.limit);
      const count = tools.querySelector('#ct-favorite-count');
      const summary = ctProfileText(`このアカウントに保存済み${items.length}件 · 表示${visible.length}件／表示対象${matching.length}件`, `${items.length} saved for this account · ${visible.length} shown / ${matching.length} available`);
      ctProfileToolbarSummary(count, ctProfileText(`保存${items.length}件 · 表示${visible.length}/${matching.length}件`, `${items.length} saved · ${visible.length}/${matching.length} shown`), summary);
      const range = tools.querySelector('#ct-favorite-range'); const rangeText = ctProfileFavoriteDateRange(matching);
      if (range.textContent !== rangeText) range.textContent = rangeText;
      if (!visible.length) {
        const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.setAttribute('role', 'status');
        empty.textContent = items.length ? ctProfileText('表示できるお気に入りはありません。', 'No Favorites to display.') :
          ctProfileText('まだお気に入りがありません。ツイートの星を押すとここに保存されます。', 'No Favorites saved yet. Favorite a Tweet with the star to save it here.');
        content.push(empty);
      } else for (const item of visible) content.push(ctProfileReuseRow(item, rows));
      if (matching.length > visible.length) {
        let more = panel.querySelector(':scope > [data-ct-favorite-more]');
        if (!more || more.ctFavoriteView !== view) {
          more = ctProfileStatus(''); more.dataset.ctFavoriteMore = ''; more.ctFavoriteView = view;
          more.append(ctProfileControl(ctProfileText('さらに50件を表示', 'Show 50 more'), event => {
            if (!ctProfileFavoriteViewCurrent(view)) return;
            const focused = document.activeElement === event.currentTarget;
            view.limit += 50; renderFavoritesPanel();
            if (focused && !event.currentTarget.isConnected) panel.querySelector(':scope > .ct-profile-row:last-of-type .ct-profile-post-link')?.focus({ preventScroll: true });
          }));
        }
        content.push(more);
      }
    }
    ctProfileReplaceContent(panel, content, focused);
  }
  function ctProfileMediaState() {
    const uid = ctProfileUID();
    if (!ctProfileState.media || ctProfileState.media.user !== ctProfileState.user || (ctProfileState.media.uid && ctProfileState.media.uid !== uid)) {
      ctProfileState.media = { user: ctProfileState.user, uid, items: [], postItems: [], replyItems: [],
        scanned: 0, replyScanned: 0, cursor: null, started: false, postsStarted: false, repliesChecked: false,
        busy: false, error: '', postError: '', replyError: '', done: false, retryRefresh: false, replyLimited: false };
      const cached = uid && ctProfileState.mediaCache.get(uid + ':' + ctProfileState.user);
      if (cached && Date.now() - cached.at < 30000) ctProfileState.media = { ...cached.state,
        items: [...cached.state.items], postItems: [...cached.state.postItems], replyItems: [...cached.state.replyItems], busy: false };
      else if (cached) ctProfileState.mediaCache.delete(uid + ':' + ctProfileState.user);
    }
    if (uid && !ctProfileState.media.uid) ctProfileState.media.uid = uid;
    return ctProfileState.media;
  }
  function ctProfilePostItem(post, user) {
    if (!ctProfileId(post?.id) || ctProfileHandle(post.authorUsername) !== user || post.isDeleted || post.status === 'MUTED' ||
        post.isRepost || post.originalPostId || post.repostedBy) return null;
    const media = ctProfileMediaAssets(post);
    if (!media.length) return null;
    return { id: post.id, username: user,
      name: typeof post.authorName === 'string' ? post.authorName.slice(0, 200) : user,
      avatar: ctProfileURL(post.authorAvatar), text: typeof post.text === 'string' ? post.text.slice(0, 10000) : '',
      createdAt: ctTimestampPostValue(post),
      href: '/post/' + encodeURIComponent(post.id), media };
  }
  async function ctProfileLoadMedia(refresh = false) {
    if (ctProfileState.active !== 'media' || document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) return;
    const state = ctProfileMediaState();
    refresh = refresh || (state.postError && state.retryRefresh);
    if (state.busy || (!refresh && state.started && state.done && !state.error)) return;
    if (refresh && state.uid) ctProfileState.mediaCache.delete(state.uid + ':' + state.user);
    const loadPosts = refresh || !state.postsStarted || !!state.postError || (!state.done && !state.replyError);
    const loadReplies = refresh || !state.repliesChecked || !!state.replyError;
    state.busy = true; state.error = ''; const sequence = ctProfileState.sequence;
    const path = ctProfileState.path; const user = ctProfileState.user;
    ctProfileRenderMedia();
    try {
      const auth = await getAuth();
      if (!auth?.token || !ctProfileId(auth.uid)) throw new Error('sign-in');
      if (sequence !== ctProfileState.sequence || location.pathname !== path || ctProfileState.user !== user || ctProfileUID() !== auth.uid) return;
      if (state.uid && state.uid !== auth.uid) return;
      state.uid = auth.uid;
      const query = new URLSearchParams({ limit: '24' });
      const cursor = refresh ? null : state.cursor;
      if (cursor) query.set('cursor', cursor);
      const headers = { Authorization: `Bearer ${auth.token}` };
      // Only the native posts route has a verified cursor. The native replies
      // route returns wrappers without pagination; display its newest 100 safely.
      const currentRequest = () => sequence === ctProfileState.sequence && ctProfileState.media === state &&
        location.pathname === path && ctProfileState.path === path && ctProfileState.user === user &&
        ctProfileUID() === auth.uid && ctProfileContext()?.user === user;
      const publish = () => {
        state.items = [...new Map([...state.postItems, ...state.replyItems].map(item => [item.id, item])).values()]
          .sort((a, b) => (ctTimestampParse(b.createdAt)?.getTime() ?? -Infinity) - (ctTimestampParse(a.createdAt)?.getTime() ?? -Infinity));
        state.error = [state.postError, state.replyError].filter(Boolean).join(' ');
        ctProfileRenderMedia();
      };
      const posts = async () => {
        if (!loadPosts) return;
        const postsJSON = await requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(user) + '/posts?' + query, headers).catch(() => null);
        const current = await getAuth();
        if (!currentRequest() || current?.uid !== auth.uid) return;
        if (!postsJSON || postsJSON.success === false || postsJSON.error || !Array.isArray(postsJSON.posts) || postsJSON.posts.length > 100) {
          state.postError = ctProfileText('ツイートの写真・動画を取得できませんでした。もう一度お試しください。', 'Tweet photos and videos could not be loaded. Try again.');
          state.retryRefresh = !!refresh;
        } else {
          ctProfileRememberLikedPosts(postsJSON.posts, auth.uid, user);
          const items = postsJSON.posts.map(post => ctProfilePostItem(post, user)).filter(Boolean);
          state.postItems = [...new Map([...(refresh ? [] : state.postItems), ...items].map(item => [item.id, item])).values()];
          state.scanned = (refresh ? 0 : state.scanned) + postsJSON.posts.length;
          const next = typeof postsJSON.nextCursor === 'string' && postsJSON.nextCursor.length <= 2000 && postsJSON.nextCursor ? postsJSON.nextCursor : null;
          state.cursor = next && next !== cursor ? next : null;
          state.done = !state.cursor; state.postsStarted = true; state.postError = ''; state.retryRefresh = false;
        }
        publish();
      };
      const replies = async () => {
        if (!loadReplies) return;
        const repliesJSON = await requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(user) + '/replies', headers).catch(() => null);
        const current = await getAuth();
        if (!currentRequest() || current?.uid !== auth.uid) return;
        if (!repliesJSON || repliesJSON.success === false || repliesJSON.error || !Array.isArray(repliesJSON.replies)) {
          state.replyError = ctProfileText('返信の写真・動画を取得できませんでした。再試行すると返信を再確認します。', 'Reply photos and videos could not be loaded. Try again to recheck replies.');
        } else {
          const replies = repliesJSON.replies.map(item => item?.post).filter(post =>
            ctProfileId(post?.id) && ctProfileHandle(post.authorUsername) === user)
            .sort((a, b) => (ctTimestampPostDate(b)?.getTime() ?? -Infinity) - (ctTimestampPostDate(a)?.getTime() ?? -Infinity));
          const checked = replies.slice(0, 100);
          ctProfileRememberLikedPosts(checked, auth.uid, user);
          state.replyItems = checked.map(post => ctProfilePostItem(post, user)).filter(Boolean);
          state.replyScanned = checked.length; state.replyLimited = replies.length > 100;
          state.repliesChecked = true; state.replyError = '';
        }
        publish();
      };
      // Independent streams start together, but each publishes as soon as its
      // response is checked. Slow replies no longer hold back ready photos.
      await Promise.all([posts(), replies()]);
      if (currentRequest()) {
        state.started = true;
        if (!state.error) {
          ctProfileState.mediaCache.set(auth.uid + ':' + user, { at: Date.now(), state: { ...state, busy: false } });
          while (ctProfileState.mediaCache.size > 8) ctProfileState.mediaCache.delete(ctProfileState.mediaCache.keys().next().value);
        }
      }
    } catch {
      if (sequence === ctProfileState.sequence) {
        state.postError = ctProfileText('写真・動画を取得できませんでした。ログイン状態を確認して、もう一度お試しください。', 'Photos and videos could not be loaded. Check your sign-in and try again.');
        state.error = state.postError; state.retryRefresh = !!refresh;
      }
    } finally {
      state.busy = false;
      if (ctProfileState.media === state && ctProfileState.active === 'media' && ctProfileState.path === path && ctProfileState.user === user) {
        ctProfileRenderMedia();
        // Returning to Media while its discarded first request was completing
        // starts one fresh request after it finishes, never in parallel.
        if (sequence !== ctProfileState.sequence && !state.started && !state.error) ctProfileLoadMedia();
      }
    }
  }
  function ctProfileRenderMedia() {
    if (ctProfileState.active !== 'media' || !ctProfileState.panel?.isConnected) return;
    const state = ctProfileMediaState();
    const signature = JSON.stringify(['media', state.uid, state.items, state.scanned, state.replyScanned, state.busy, state.error, state.done, state.replyLimited]);
    if (signature === ctProfileState.rendered) return;
    ctProfileState.rendered = signature;
    const rows = ctProfileExistingRows(ctProfileState.panel);
    const focused = ctProfileState.panel.contains(document.activeElement) ? document.activeElement : null;
    const content = [];
    let tools = ctProfileState.panel.querySelector(':scope > [data-ct-media-tools]');
    if (tools?.ctMediaState !== state) {
      tools = document.createElement('div'); tools.className = 'ct-profile-toolbar'; tools.dataset.ctMediaTools = ''; tools.ctMediaState = state;
      const count = document.createElement('div'); count.className = 'ct-profile-toolbar-count'; count.id = 'ct-profile-media-count'; count.setAttribute('role', 'status');
      const update = ctProfileControl(ctProfileText('更新', 'Refresh'), () => ctProfileLoadMedia(true));
      update.setAttribute('aria-label', ctProfileText('写真・動画を更新', 'Refresh photos and videos'));
      const details = document.createElement('details'); details.className = 'ct-profile-details';
      const summary = document.createElement('summary'); summary.textContent = ctProfileText('取得範囲', 'Coverage');
      const scope = document.createElement('div'); scope.className = 'ct-profile-detail-body';
      scope.textContent = ctProfileText('返信は最新100件まで含みます。以前のツイートは下から読み込めます。', 'Includes up to the latest 100 replies. Load older Tweets below.');
      details.append(summary, scope); tools.append(count, update, details);
    }
    ctProfileToolbarSummary(tools.querySelector('#ct-profile-media-count'),
      ctProfileText(`投稿${state.scanned}件 · 返信${state.replyScanned}件`, `${state.scanned} posts · ${state.replyScanned} replies`),
      ctProfileText(`投稿${state.scanned}件・返信${state.replyScanned}件を確認 · 写真・動画`, `${state.scanned} posts and ${state.replyScanned} replies checked · Photos and videos`));
    tools.querySelector('button').disabled = state.busy; content.push(tools);
    if (state.error) {
      const error = ctProfileStatus(state.error); error.setAttribute('role', 'status'); content.push(error);
    }
    for (const item of state.items) content.push(ctProfileReuseRow(item, rows));
    if (!state.items.length) {
      const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.setAttribute('role', 'status');
      empty.textContent = state.busy ? ctProfileText('写真・動画を読み込み中…', 'Loading photos and videos…') :
        state.error ? ctProfileText('写真・動画を取得できませんでした。再試行できます。', 'Photos and videos could not be loaded. You can try again.') :
        state.done && !state.error ? ctProfileText('写真・動画のあるツイートはありません。', 'No Tweets with photos or videos.') :
          ctProfileText('ここまでの投稿には写真・動画がありません。以前の投稿を確認できます。', 'No photos or videos in the posts checked so far. You can check older posts.');
      content.push(empty);
    }
    if (!state.done || state.error) {
      const footer = ctProfileStatus('');
      const next = ctProfileControl(state.busy ? ctProfileText('読み込み中…', 'Loading…') :
        state.error ? ctProfileText('再試行', 'Try again') : ctProfileText('以前の投稿を確認', 'Check older posts'), () => ctProfileLoadMedia());
      next.disabled = state.busy; footer.append(next); content.push(footer);
    }
    ctProfileReplaceContent(ctProfileState.panel, content, focused);
  }

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
        url: ctProfileURL(el.src), poster: el.tagName === 'VIDEO' ? ctProfileURL(el.poster) : ''})).filter(asset => asset.url);
  }

  function ctFavoriteCandidate(article) {
    const timestamp = [...article.querySelectorAll('span.text-tl-app-text-muted.hover\\:underline[title]')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],div.mt-3.rounded-2xl.border') &&
      !!ctTimestampParse(el.title));
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
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-testid="quote-tweet"],[data-ct-quote],div.mt-3.rounded-2xl.border'));
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
    if (!candidate || !uid || (candidate.createdAt && !ctTimestampParse(candidate.createdAt))) return null;
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
      (candidate.createdAt ? ctTimestampPostDate(post)?.getTime() === ctTimestampParse(candidate.createdAt)?.getTime() :
        ctFavoriteRelativeTimeMatches(candidate.relativeText, ctTimestampPostValue(post), candidate.observedAt)) &&
      typeof post.text === 'string' && (candidate.translated || post.text === candidate.text));
    const unique = [...new Map(matches.map(post => [post.id, post])).values()];
    if (unique.length !== 1) return null;
    return { ...candidate, id: unique[0].id, text: unique[0].text, createdAt: ctTimestampPostValue(unique[0]),
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
          else snapshot = {...snapshot,text:post.text,createdAt:ctTimestampPostValue(post),
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

    // Recover server-confirmed Favorites through the two existing feed reads.
  // Their end cursors describe feed coverage, never a complete outgoing-like list.
  const ctFavoriteHistoryState = {
    uid: null, checkpoint: null, error: '', warning: '', paused: false,
    pausedReason: '', run: null, sequence: 0, lastRequestAt: null
  };
  const CT_FAVORITE_HISTORY_INTERVAL = 800;
  const CT_FAVORITE_HISTORY_PAGES = 100;

  function ctFavoriteHistoryEmpty() {
    return { version: 1, pages: 0, scanned: 0, recovered: 0, sources: {
      'for-you': { cursor: null, done: false, seen: [] },
      following: { cursor: null, done: false, seen: [] }
    } };
  }
  function ctFavoriteHistoryKey(uid) {
    return KEY.favorites + ':history:uid:' + encodeURIComponent(uid);
  }
  function ctFavoriteHistoryCursor(value) {
    return value === null || (typeof value === 'string' && value.length > 0 &&
      value.length <= 2000 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
  }
  function ctFavoriteHistoryCheckpoint(value) {
    if (!value || value.version !== 1 || !value.sources ||
        !['pages', 'scanned', 'recovered'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
    const copy = ctFavoriteHistoryEmpty();
    for (const name of ['for-you', 'following']) {
      const source = value.sources[name];
      if (!source || typeof source.done !== 'boolean' || !ctFavoriteHistoryCursor(source.cursor) ||
          !Array.isArray(source.seen) || source.seen.some(cursor => cursor === null || !ctFavoriteHistoryCursor(cursor)) ||
          new Set(source.seen).size !== source.seen.length ||
          (source.done && source.cursor !== null) || (!source.done && source.cursor !== null && !source.seen.includes(source.cursor))) return null;
      copy.sources[name] = { cursor: source.cursor, done: source.done, seen: [...source.seen] };
    }
    if (copy.sources.following.done && !copy.sources['for-you'].done) return null;
    for (const key of ['pages', 'scanned', 'recovered']) copy[key] = value[key];
    return copy;
  }
  function ctFavoriteHistoryEmit() {
    window.dispatchEvent(new Event('ct-favorite-history-change'));
  }
  function ctFavoriteHistoryActive() {
    return !document.hidden && (typeof ctPageActive === 'undefined' || ctPageActive);
  }
  function ctFavoriteHistoryBind() {
    const uid = ctProfileId(ctNetworkState.authUID);
    if (uid === ctFavoriteHistoryState.uid) return;
    const previousRun = ctFavoriteHistoryState.run;
    ctFavoriteHistoryState.uid = uid;
    ctFavoriteHistoryState.checkpoint = ctFavoriteHistoryEmpty();
    ctFavoriteHistoryState.error = '';
    ctFavoriteHistoryState.warning = '';
    ctFavoriteHistoryState.paused = false;
    ctFavoriteHistoryState.pausedReason = '';
    try { if (uid) {
      const raw = localStorage.getItem(ctFavoriteHistoryKey(uid));
      if (raw !== null) {
        const checkpoint = ctFavoriteHistoryCheckpoint(JSON.parse(raw));
        if (!checkpoint) throw new Error('checkpoint');
        ctFavoriteHistoryState.checkpoint = checkpoint;
      }
    } } catch {
      // A failed read must not overwrite an existing checkpoint with an empty one.
      ctFavoriteHistoryState.error = 'checkpoint';
      ctFavoriteHistoryState.warning = 'checkpoint';
    }
    if (previousRun) ctStopFavoriteHistory('account-changed');
  }
  function ctFavoriteHistoryStatus() {
    ctFavoriteHistoryBind();
    const checkpoint = ctFavoriteHistoryState.checkpoint || ctFavoriteHistoryEmpty();
    const done = checkpoint.sources['for-you'].done && checkpoint.sources.following.done;
    return {
      source: checkpoint.sources['for-you'].done ? 'following' : 'for-you',
      pages: checkpoint.pages, scanned: checkpoint.scanned, recovered: checkpoint.recovered,
      busy: !!ctFavoriteHistoryState.run, paused: ctFavoriteHistoryState.paused,
      pausedReason: ctFavoriteHistoryState.pausedReason, error: ctFavoriteHistoryState.error,
      warning: ctFavoriteHistoryState.warning, done,
      canContinue: !!ctFavoriteHistoryState.uid && !done && !ctFavoriteHistoryState.run
    };
  }
  function ctFavoriteHistoryAssert(run) {
    if (run.cancelled || ctFavoriteHistoryState.run !== run || ctFavoriteHistoryState.sequence !== run.sequence) throw new Error('stopped');
    if (ctNetworkState.authUID !== run.uid || ctFavoriteHistoryState.uid !== run.uid) throw new Error('account-changed');
    if (!ctFavoriteHistoryActive()) throw new Error('background');
  }
  async function ctFavoriteHistoryAuth(run) {
    ctFavoriteHistoryAssert(run);
    const auth = await getAuth();
    ctFavoriteHistoryAssert(run);
    if (!auth?.token || auth.uid !== run.uid) throw new Error(auth?.uid ? 'account-changed' : 'sign-in');
    return auth;
  }
  async function ctFavoriteHistoryRequest(run, path) {
    ctFavoriteHistoryAssert(run);
    const previous = ctFavoriteHistoryState.lastRequestAt;
    const remaining = previous === null ? 0 : CT_FAVORITE_HISTORY_INTERVAL - (Date.now() - previous);
    if (remaining > 0) await new Promise(resolve => {
      run.wake = resolve;
      run.timer = setTimeout(() => { run.timer = null; run.wake = null; resolve(); }, remaining);
    });
    const auth = await ctFavoriteHistoryAuth(run);
    ctFavoriteHistoryState.lastRequestAt = Date.now();
    let json;
    try { json = await requestJSON(API_ORIGIN + path, { Authorization: `Bearer ${auth.token}` }); }
    catch { ctFavoriteHistoryAssert(run); throw new Error('network'); }
    // Cancellation or backgrounding invalidates the response before any write.
    ctFavoriteHistoryAssert(run);
    await ctFavoriteHistoryAuth(run);
    return json;
  }
  function ctFavoriteHistoryPost(post) {
    return post && typeof post === 'object' && !Array.isArray(post) && ctProfileId(post.id) &&
      ctProfileHandle(post.authorUsername) && typeof post.text === 'string' && post.text.length <= 10000 &&
      post.hasLiked === true && !post.isDeleted && post.status !== 'MUTED';
  }
  function ctFavoriteHistoryPage(json, source) {
    if (!json || json.success !== true || json.error || !Array.isArray(json.posts) || json.posts.length > 20 ||
        !Object.prototype.hasOwnProperty.call(json, 'nextCursor') || !ctFavoriteHistoryCursor(json.nextCursor) ||
        json.posts.some(post => !post || typeof post !== 'object' || Array.isArray(post) || !ctProfileId(post.id) ||
          typeof post.hasLiked !== 'boolean' || (post.hasLiked === true && !post.isDeleted && post.status !== 'MUTED' &&
            (!ctProfileHandle(post.authorUsername) || typeof post.text !== 'string' || post.text.length > 10000)))) throw new Error('response');
    if (json.nextCursor !== null && (json.nextCursor === source.cursor || source.seen.includes(json.nextCursor))) throw new Error('cursor');
    return json.posts;
  }
  function ctFavoriteHistorySave(uid, checkpoint) {
    if (ctNetworkState.authUID !== uid || ctFavoriteHistoryState.uid !== uid) throw new Error('account-changed');
    try { localStorage.setItem(ctFavoriteHistoryKey(uid), JSON.stringify(checkpoint)); }
    catch { ctFavoriteHistoryState.warning = 'storage'; throw new Error('storage'); }
  }
  function ctStopFavoriteHistory(reason = 'stopped') {
    const run = ctFavoriteHistoryState.run;
    if (run) {
      run.cancelled = true;
      ctFavoriteHistoryState.sequence++;
      if (run.timer !== null) { clearTimeout(run.timer); run.timer = null; }
      const wake = run.wake;
      run.wake = null;
      if (wake) wake();
      ctFavoriteHistoryState.paused = true;
      ctFavoriteHistoryState.pausedReason = reason;
      ctFavoriteHistoryEmit();
    }
    return ctFavoriteHistoryStatus();
  }
  async function ctRunFavoriteHistory() {
    ctFavoriteHistoryBind();
    if (ctFavoriteHistoryState.run) return ctFavoriteHistoryStatus();
    if (!ctFavoriteHistoryState.uid) {
      const auth = await getAuth();
      ctFavoriteHistoryBind();
      if (!auth?.token || !ctFavoriteHistoryState.uid || auth.uid !== ctFavoriteHistoryState.uid) {
        ctFavoriteHistoryState.error = 'sign-in'; ctFavoriteHistoryEmit(); return ctFavoriteHistoryStatus();
      }
    }
    if (ctFavoriteHistoryState.run) return ctFavoriteHistoryStatus();
    if (ctFavoriteHistoryState.error === 'checkpoint') return ctFavoriteHistoryStatus();
    if (!ctFavoriteHistoryActive()) {
      ctFavoriteHistoryState.paused = true; ctFavoriteHistoryState.pausedReason = 'background';
      ctFavoriteHistoryEmit(); return ctFavoriteHistoryStatus();
    }
    if (ctFavoriteHistoryStatus().done) return ctFavoriteHistoryStatus();
    const run = { uid: ctFavoriteHistoryState.uid, sequence: ++ctFavoriteHistoryState.sequence,
      cancelled: false, timer: null, wake: null, seen: new Set() };
    ctFavoriteHistoryState.run = run;
    ctFavoriteHistoryState.error = ''; ctFavoriteHistoryState.warning = '';
    ctFavoriteHistoryState.paused = false; ctFavoriteHistoryState.pausedReason = '';
    ctFavoriteHistoryEmit();
    try {
      for (let page = 0; page < CT_FAVORITE_HISTORY_PAGES; page++) {
        ctFavoriteHistoryAssert(run);
        const before = ctFavoriteHistoryState.checkpoint;
        const name = before.sources['for-you'].done ? 'following' : 'for-you';
        if (before.sources[name].done) break;
        const source = before.sources[name];
        const query = new URLSearchParams({ limit: '20' });
        if (name === 'following') query.set('scope', 'following');
        if (source.cursor !== null) query.set('cursor', source.cursor);
        const json = await ctFavoriteHistoryRequest(run, '/api/posts?' + query);
        const posts = ctFavoriteHistoryPage(json, source);
        const confirmed = [];
        const pageIds = new Set();
        for (const candidate of posts) {
          if (!ctFavoriteHistoryPost(candidate)) continue;
          if ((candidate.isRepost || candidate.repostedBy) && !candidate.originalPostId) continue;
          const id = candidate.originalPostId ?? candidate.id;
          if (!ctProfileId(id)) throw new Error('response');
          if (run.seen.has(id) || pageIds.has(id)) continue;
          pageIds.add(id);
          const detail = await ctFavoriteHistoryRequest(run, '/api/posts/' + encodeURIComponent(id));
          // The shared transport returns null for network/HTTP failures. It
          // cannot distinguish an inaccessible post from a transient outage;
          // preserve this page's cursor so a retry can check it again.
          if (!detail) throw new Error('network');
          if (detail.success !== true || detail.error || !detail.post || typeof detail.post !== 'object' ||
              Array.isArray(detail.post) || !ctProfileId(detail.post.id) || typeof detail.post.hasLiked !== 'boolean') throw new Error('response');
          // Deleted, inaccessible or already-unliked details are not Favorites.
          if (!ctFavoriteHistoryPost(detail.post) ||
              detail.post.id !== id || detail.post.isRepost || detail.post.originalPostId || detail.post.repostedBy ||
              (!candidate.originalPostId && ctProfileHandle(detail.post.authorUsername) !== ctProfileHandle(candidate.authorUsername))) continue;
          confirmed.push(detail.post);
        }
        await ctFavoriteHistoryAuth(run);
        ctFavoriteHistoryAssert(run);
        const recovered = ctProfileRememberLikedPosts(confirmed, run.uid);
        // A previous account's storage warning is global UI state. Only this
        // account's unpersisted Favorites can block its feed checkpoint.
        if (!Number.isSafeInteger(recovered) || recovered < 0 || ctProfileState.dirtyMemory?.has(run.uid)) {
          ctFavoriteHistoryState.warning = 'storage'; throw new Error('storage');
        }
        // The source advances only after Favorites were stored. On failure or
        // cancellation the current page can safely be retried without eviction.
        const next = ctFavoriteHistoryCheckpoint(before);
        next.pages++; next.scanned += posts.length; next.recovered += recovered;
        next.sources[name].cursor = json.nextCursor;
        next.sources[name].done = json.nextCursor === null;
        if (json.nextCursor !== null) next.sources[name].seen.push(json.nextCursor);
        ctFavoriteHistorySave(run.uid, next);
        ctFavoriteHistoryState.checkpoint = next;
        for (const post of confirmed) run.seen.add(post.id);
        ctFavoriteHistoryEmit();
        if (next.sources['for-you'].done && next.sources.following.done) break;
        if (page === CT_FAVORITE_HISTORY_PAGES - 1) {
          ctFavoriteHistoryState.paused = true; ctFavoriteHistoryState.pausedReason = 'limit';
        }
      }
    } catch (error) {
      if (ctFavoriteHistoryState.uid === run.uid) {
        const code = error?.message;
        if (!run.cancelled && ['background', 'account-changed'].includes(code)) {
          ctFavoriteHistoryState.paused = true; ctFavoriteHistoryState.pausedReason = code;
        } else if (!run.cancelled && code !== 'stopped') {
          ctFavoriteHistoryState.error = ['sign-in', 'account-changed', 'response', 'cursor', 'storage'].includes(code) ? code : 'network';
          ctFavoriteHistoryState.paused = true;
        }
      }
    } finally {
      if (run.timer !== null) clearTimeout(run.timer);
      if (ctFavoriteHistoryState.run === run) ctFavoriteHistoryState.run = null;
      ctFavoriteHistoryEmit();
    }
    return ctFavoriteHistoryStatus();
  }
  function ctRestartFavoriteHistory() {
    ctFavoriteHistoryBind();
    // An in-flight read must finish cancellation before another scan starts.
    if (ctFavoriteHistoryState.run) return ctStopFavoriteHistory();
    if (!ctFavoriteHistoryState.uid) return ctRunFavoriteHistory();
    const checkpoint = ctFavoriteHistoryEmpty();
    try {
      ctFavoriteHistorySave(ctFavoriteHistoryState.uid, checkpoint);
      ctFavoriteHistoryState.checkpoint = checkpoint;
      ctFavoriteHistoryState.error = ''; ctFavoriteHistoryState.warning = '';
      ctFavoriteHistoryState.paused = false; ctFavoriteHistoryState.pausedReason = '';
    } catch {
      ctFavoriteHistoryState.error = 'storage'; ctFavoriteHistoryEmit(); return ctFavoriteHistoryStatus();
    }
    return ctRunFavoriteHistory();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctStopFavoriteHistory('background'); });
  window.addEventListener('pagehide', () => ctStopFavoriteHistory('background'));

    // The native notification row opens its representative event. Its avatars do
  // not have individual profile handlers, and their alt text is a display name,
  // never a username. Resolve identities only from native handles or API actors.
  const ctNavigationState = {
    installed: false, pending: null, uid: null, fetchedAt: 0, retryAt: 0,
    actors: new Map(), overlays: new Map(), generation: 0, loading: false,
    nextCursor: null, initialized: false, pagesFetched: 0, lastAttempt: '', cursorSeen: new Set()
  };
  const ctAvatarWrapperSelector = 'div.relative.inline-flex.shrink-0.isolate';
  const ctNativeFollowSelector = 'span[role="button"][aria-label]';

  function ctNavigationJapanese() { return CT_LOCALE === 'ja'; }
  function ctNavigationHandle(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value.trim()) ? value.trim().toLowerCase() : null;
  }
  function ctNativeAvatar(wrapper) {
    const avatarSelector = 'img.rounded-full.object-cover,div[role="img"].rounded-full';
    for (const child of wrapper.children) {
      if (child.matches(avatarSelector)) return child;
      // Uo renders the same avatar directly in notifications, but wraps it in a
      // profile button in feeds, post details and replies. Inspect only this
      // verified native button, never arbitrary descendants or ordinary Follow.
      if (child.matches('button.rounded-full[aria-label]') &&
          /^View @[a-zA-Z0-9_.-]{1,80}'s profile$/.test(child.getAttribute('aria-label') || '')) {
        const avatar = [...child.children].find(el => el.matches(avatarSelector));
        if (avatar) return avatar;
      }
    }
    return null;
  }
  function ctNativeAvatarFollow(wrapper) {
    return [...wrapper.children].find(el => el.matches(ctNativeFollowSelector) &&
      el.classList.contains('absolute') && el.classList.contains('-bottom-0.5') &&
      el.classList.contains('-right-0.5') && /^(?:Follow|Following) @[a-zA-Z0-9_.-]{1,80}$/.test(el.getAttribute('aria-label') || '')) || null;
  }
  function ctAvatarURL(value) {
    if (!value || value === 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150') return '';
    try {
      // Public avatars returned by tweet.app use absolute URLs. A relative URL
      // may refer to a different media origin, so do not infer that origin here.
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function ctAvatarIdentity(wrapper) {
    const avatar = ctNativeAvatar(wrapper);
    if (!avatar) return null;
    const label = avatar.getAttribute(avatar.tagName === 'IMG' ? 'alt' : 'aria-label') || '';
    const suffix = avatar.tagName === 'IMG' ? ' avatar' : ' avatar placeholder';
    if (!label.endsWith(suffix)) return null;
    const name = label.slice(0, -suffix.length);
    const url = avatar.tagName === 'IMG' ? ctAvatarURL(avatar.getAttribute('src')) : '';
    return name && name.length <= 512 && url !== null ? `${name}\n${url}` : null;
  }
  function ctNativeNotificationRows() {
    return [...document.querySelectorAll('main button.items-start')].filter(row =>
      !row.closest('article,[data-ct-local-ui],[data-ct-owned]') &&
      (row.matches('button.border-b') ||
        (row.matches('button.w-full.flex.gap-3') && row.parentElement?.matches('div.border-b'))));
  }
  function ctNotificationAvatarWrappers() {
    if (!/^\/notifications\/?$/.test(location.pathname)) return [];
    // In 2.1 the border moves to a wrapper that also contains the Follow back
    // list. Inspect the event button only; that list has working native links.
    return ctNativeNotificationRows().flatMap(row => [...row.querySelectorAll(ctAvatarWrapperSelector)])
      .filter(el => ctNativeAvatar(el) && !el.closest('article,[data-ct-local-ui]'));
  }
  function ctNotificationAvatarHandle(wrapper) {
    const native = ctNativeAvatarFollow(wrapper)?.getAttribute('aria-label')?.match(/ @([a-zA-Z0-9_.-]+)$/)?.[1];
    if (native) return ctNavigationHandle(native);
    if (ctNavigationState.uid !== ctNetworkState.authUID) return null;
    const identity = ctAvatarIdentity(wrapper);
    return identity ? ctNavigationState.actors.get(identity) || null : null;
  }
  function ctAddNotificationActors(json, actors) {
    if (!json || json.success !== true || !Array.isArray(json.notifications)) return false;
    for (const item of json.notifications.slice(0, 100)) {
      const handle = ctNavigationHandle(item?.actorHandle);
      const name = item?.actorDisplayName;
      const url = ctAvatarURL(item?.actorAvatarUrl);
      if (!handle || typeof name !== 'string' || !name || name.length > 512 || url === null) continue;
      const identity = `${name}\n${url}`;
      if (actors.has(identity) && actors.get(identity) !== handle) actors.set(identity, null);
      else if (!actors.has(identity)) actors.set(identity, handle);
    }
    return true;
  }
  function ctRenderNotificationAvatars() {
    const japanese = ctNavigationJapanese();
    for (const wrapper of ctNotificationAvatarWrappers()) {
      let link = wrapper.querySelector(':scope > a.ct-notification-profile-link');
      if (!link) {
        link = document.createElement('a');
        link.className = 'ct-notification-profile-link';
        link.dataset.ctLocalUi = 'notification-profile';
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        wrapper.append(link);
      }
      const handle = ctNotificationAvatarHandle(wrapper);
      const label = handle ? (japanese ? `@${handle}のプロフィールを開く` : `Open @${handle}'s profile`) :
        ctNavigationState.loading ? (japanese ? 'プロフィールを確認中…' : 'Looking up profile…') :
          (japanese ? 'プロフィールを特定できません。押すと再確認します' : 'Profile unavailable. Activate to retry');
      const href = handle ? `/user/${encodeURIComponent(handle)}` : null;
      if (href && link.getAttribute('href') !== href) link.setAttribute('href', href);
      else if (!href) link.removeAttribute('href');
      if (handle) link.removeAttribute('aria-disabled');
      else if (link.getAttribute('aria-disabled') !== 'true') link.setAttribute('aria-disabled', 'true');
      if (link.getAttribute('aria-label') !== label) link.setAttribute('aria-label', label);
      if (link.title !== label) link.title = label;
    }
  }
  function ctUnresolvedNotificationActors() {
    return [...new Set(ctNotificationAvatarWrappers().filter(wrapper => !ctNotificationAvatarHandle(wrapper))
      .map(wrapper => ctAvatarIdentity(wrapper) || 'unknown-avatar'))].sort().join('\n\n');
  }
  function ctResetNotificationActorCache() {
    ctNavigationState.actors.clear();
    ctNavigationState.fetchedAt = 0;
    ctNavigationState.nextCursor = null;
    ctNavigationState.initialized = false;
    ctNavigationState.pagesFetched = 0;
    ctNavigationState.lastAttempt = '';
    ctNavigationState.cursorSeen.clear();
  }
  function ctLoadNotificationActors({ retry = false } = {}) {
    if (ctNavigationState.pending) return ctNavigationState.pending;
    if (!/^\/notifications\/?$/.test(location.pathname) || Date.now() < ctNavigationState.retryAt) return Promise.resolve();
    const generation = ctNavigationState.generation;
    const pending = Promise.resolve().then(async () => {
      const auth = await getAuth();
      if (generation !== ctNavigationState.generation || !/^\/notifications\/?$/.test(location.pathname)) return;
      if (ctNavigationState.uid !== (auth?.uid || null)) {
        ctNavigationState.uid = auth?.uid || null;
        ctResetNotificationActorCache();
      }
      if (!auth?.token || !auth.uid) { ctNavigationState.retryAt = Date.now() + 10000; return; }
      const unresolved = ctUnresolvedNotificationActors();
      if (!unresolved) return;
      const fresh = Date.now() - ctNavigationState.fetchedAt < 60000;
      const changed = unresolved !== ctNavigationState.lastAttempt;
      if (fresh && !changed && !retry) return;
      ctNavigationState.loading = true;
      ctRenderNotificationAvatars();
      // Keep older pages when a grouped row has more than eight actors. Starting
      // again from the newest page could otherwise never reach an older avatar.
      const actors = new Map(ctNavigationState.actors);
      const headOnly = ctNavigationState.initialized && !fresh && !changed && !retry;
      const continuing = ctNavigationState.initialized && !!ctNavigationState.nextCursor && (fresh || retry);
      let cursor = continuing ? ctNavigationState.nextCursor : null;
      const budget = headOnly ? 1 : retry || !continuing ? 20 : Math.max(0, 20 - ctNavigationState.pagesFetched);
      if (!headOnly && !continuing) {
        ctNavigationState.pagesFetched = 0;
        ctNavigationState.cursorSeen.clear();
      }
      for (let page = 0; page < budget; page++) {
        if (cursor && ctNavigationState.cursorSeen.has(cursor)) break;
        const query = new URLSearchParams({ limit: '20' });
        if (cursor) query.set('cursor', cursor);
        const json = await requestJSON(`https://api.tweet.app/api/notifications?${query}`, { Authorization: `Bearer ${auth.token}` });
        if (generation !== ctNavigationState.generation || ctNetworkState.authUID !== auth.uid ||
            !/^\/notifications\/?$/.test(location.pathname)) return;
        if (!ctAddNotificationActors(json, actors)) { ctNavigationState.retryAt = Date.now() + 10000; return; }
        if (cursor) ctNavigationState.cursorSeen.add(cursor);
        while (actors.size > 1000) actors.delete(actors.keys().next().value);
        ctNavigationState.actors = actors;
        ctNavigationState.initialized = true;
        if (!cursor) ctNavigationState.fetchedAt = Date.now();
        const next = typeof json.nextCursor === 'string' && json.nextCursor.length <= 2048 ? json.nextCursor : null;
        if (!headOnly) {
          ctNavigationState.pagesFetched++;
          ctNavigationState.nextCursor = next;
        }
        ctRenderNotificationAvatars();
        if (ctNotificationAvatarWrappers().every(wrapper => ctNotificationAvatarHandle(wrapper))) break;
        if (!next || ctNavigationState.cursorSeen.has(next)) break;
        cursor = next;
      }
      ctNavigationState.lastAttempt = ctUnresolvedNotificationActors();
    }).catch(() => { ctNavigationState.retryAt = Date.now() + 10000; }).finally(() => {
      if (ctNavigationState.pending === pending) {
        ctNavigationState.pending = null;
        ctNavigationState.loading = false;
        ctRenderNotificationAvatars();
      }
    });
    ctNavigationState.pending = pending;
    return pending;
  }
  function ctNotificationLinkEvent(event) {
    const link = event.target?.closest?.('a.ct-notification-profile-link');
    if (!link || !/^\/notifications\/?$/.test(location.pathname)) return;
    const wrapper = link.parentElement;
    const row = wrapper?.closest('main button.items-start');
    if (!wrapper?.matches(ctAvatarWrapperSelector) || !ctNativeNotificationRows().includes(row)) return;
    // A React update may arrive between the last scan and this click. Never
    // navigate using the previous avatar's URL while the next scan is queued.
    const handle = ctNotificationAvatarHandle(wrapper);
    const href = handle ? `/user/${encodeURIComponent(handle)}` : null;
    if (href && link.getAttribute('href') !== href) link.setAttribute('href', href);
    else if (!href) link.removeAttribute('href');
    // Stop the outer React row handler, but keep real-anchor defaults: normal,
    // modified, middle-button and context-menu navigation all retain their URLs.
    event.stopPropagation();
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.key === ' ' || !link.hasAttribute('href')) event.preventDefault();
      if (link.hasAttribute('href') || event.key !== 'Enter') return;
    } else if (link.hasAttribute('href')) return;
    event.preventDefault();
    if (event.type === 'click' || event.type === 'keydown') {
      void ctLoadNotificationActors({ retry: true });
    }
  }
  function installNativeNavigation() {
    if (ctNavigationState.installed) return;
    ctNavigationState.installed = true;
    const style = document.createElement('style');
    style.id = 'ct-native-navigation-style';
    style.textContent = '.ct-avatar-follow-hidden{display:none!important;pointer-events:none!important}' +
      '.ct-notification-profile-link{position:absolute;inset:0;z-index:2;display:block;border-radius:9999px;background:transparent;cursor:pointer}' +
      '.ct-notification-profile-link:focus-visible{outline:2px solid #0ea5e9;outline-offset:3px}' +
      '.ct-notification-profile-link[aria-disabled="true"]{cursor:help}';
    (document.head || document.documentElement).append(style);
    for (const type of ['click', 'auxclick', 'keydown', 'contextmenu']) document.addEventListener(type, ctNotificationLinkEvent, true);
  }
  function patchNavigation(root = document) {
    installNativeNavigation();
    if (ctNavigationState.uid && ctNetworkState.authUID !== ctNavigationState.uid) {
      ctNavigationState.uid = null;
      ctResetNotificationActorCache();
    }
    const wrappers = [...root.querySelectorAll(ctAvatarWrapperSelector)];
    if (root.matches?.(ctAvatarWrapperSelector)) wrappers.unshift(root);
    for (const wrapper of wrappers) {
      if (!ctNativeAvatar(wrapper) || wrapper.closest('[data-ct-local-ui]')) continue;
      const overlay = ctNativeAvatarFollow(wrapper);
      if (!overlay) continue;
      if (!ctNavigationState.overlays.has(overlay)) ctNavigationState.overlays.set(overlay, {
        tabIndex: overlay.getAttribute('tabindex'), hidden: overlay.getAttribute('aria-hidden')
      });
      overlay.classList.add('ct-avatar-follow-hidden');
      if (overlay.getAttribute('tabindex') !== '-1') overlay.setAttribute('tabindex', '-1');
      if (overlay.getAttribute('aria-hidden') !== 'true') overlay.setAttribute('aria-hidden', 'true');
    }
    for (const overlay of ctNavigationState.overlays.keys()) if (!overlay.isConnected) ctNavigationState.overlays.delete(overlay);
    ctRenderNotificationAvatars();
    const unresolved = ctUnresolvedNotificationActors();
    if (unresolved && (Date.now() - ctNavigationState.fetchedAt >= 60000 || unresolved !== ctNavigationState.lastAttempt)) {
      void ctLoadNotificationActors();
    }
  }
  function destroyNativeNavigation() {
    ctNavigationState.generation++;
    ctNavigationState.installed = false;
    for (const type of ['click', 'auxclick', 'keydown', 'contextmenu']) document.removeEventListener(type, ctNotificationLinkEvent, true);
    document.getElementById('ct-native-navigation-style')?.remove();
    document.querySelectorAll('a.ct-notification-profile-link').forEach(link => link.remove());
    for (const [overlay, original] of ctNavigationState.overlays) {
      overlay.classList.remove('ct-avatar-follow-hidden');
      for (const [attribute, value] of [['tabindex', original.tabIndex], ['aria-hidden', original.hidden]]) {
        if (value === null) overlay.removeAttribute(attribute); else overlay.setAttribute(attribute, value);
      }
    }
    ctNavigationState.overlays.clear();
    ctResetNotificationActorCache();
    ctNavigationState.pending = null;
    ctNavigationState.uid = null;
    ctNavigationState.fetchedAt = ctNavigationState.retryAt = 0;
    ctNavigationState.loading = false;
  }

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

    // Official badge artwork and membership precedence from Tweet's web client.
  // The largest published variant is 96 px; displayed dimensions remain native.
  const ctOfficialBadgeKinds = {
    founder: 'Founder', fighter: 'Fighter', centurion: 'Centurion',
    'team-member': 'Team Member', ambassador: 'Tweet Ambassador', wing: 'Wing', press: 'Press'
  };
  const ctBadgeImageStates = new WeakMap();
  const ctBadgeRequests = new WeakMap();

  function ctBadgeLabel(kind) {
    const labels = { founder: '創設メンバー', fighter: 'ファイター', centurion: 'センチュリオン',
      'team-member': '運営メンバー', ambassador: 'Tweetアンバサダー', wing: 'ウィング', press: 'プレス' };
    return typeof CT_LOCALE !== 'undefined' && CT_LOCALE === 'ja' ? labels[kind] || '' : ctOfficialBadgeKinds[kind] || '';
  }

  function ctBadgeJapaneseDescription(value, kinds) {
    if (typeof CT_LOCALE === 'undefined' || CT_LOCALE !== 'ja' || typeof value !== 'string') return null;
    const names = value.split(' + ');
    const entries = Object.entries(ctOfficialBadgeKinds);
    const selected = names.map(name => entries.find(([, label]) => label === name)?.[0]);
    // Accept complete, known role combinations backed by the current artwork.
    // Display names, custom descriptions and numbered membership labels stay intact.
    return selected.length <= 7 && selected.every(kind => kind && kinds.includes(kind)) &&
      new Set(selected).size === selected.length ? selected.map(ctBadgeLabel).join(' + ') : null;
  }

  function ctBadgeDescriptionProtected(el) {
    return !!el.closest('[data-ct-owned],[data-ct-local-ui],[data-user-content],.tl-user-text,' +
      '[data-testid="tweet-text"],[data-testid="profile-bio"],[translate="no"],.notranslate,' +
      '[contenteditable]:not([contenteditable="false"]),.whitespace-pre-wrap,.break-words,.wrap-break-word');
  }

  function ctPatchNativeBadgeDescriptions(images, root) {
    if (typeof CT_LOCALE === 'undefined' || CT_LOCALE !== 'ja') return;
    const wrappers = new Set();
    const tooltips = new Set();
    for (const img of images) {
      if (!img.matches('img.shrink-0.select-none') || !ctBadgeAsset(img.getAttribute('src')) || ctBadgeDescriptionProtected(img)) continue;
      const wrapper = img.closest('span.relative.inline-flex.shrink-0.items-center.align-middle,' +
        'button.relative.inline-flex.shrink-0.items-center.align-middle');
      if (wrapper) wrappers.add(wrapper);
      const tooltip = img.closest('[role="tooltip"].fixed.pointer-events-none');
      if (tooltip) tooltips.add(tooltip);
    }
    const changedTooltip = root.closest?.('[role="tooltip"].fixed.pointer-events-none');
    if (changedTooltip) tooltips.add(changedTooltip);
    for (const wrapper of wrappers) {
      if (ctBadgeDescriptionProtected(wrapper)) continue;
      const kinds = [...wrapper.querySelectorAll('img.shrink-0.select-none')]
        .map(img => ctBadgeAsset(img.getAttribute('src'))?.kind).filter(Boolean);
      for (const attr of ['aria-label', 'title']) {
        const value = wrapper.getAttribute(attr);
        const out = ctBadgeJapaneseDescription(value, kinds);
        if (out && value !== out) wrapper.setAttribute(attr, out);
      }
    }
    for (const tooltip of tooltips) {
      if (ctBadgeDescriptionProtected(tooltip)) continue;
      const box = tooltip.firstElementChild;
      const artwork = box?.firstElementChild;
      const label = artwork?.nextElementSibling;
      if (!box?.matches('div.bg-tl-app-card.border.flex.flex-col.items-center') ||
          !artwork?.matches('span.inline-flex.flex-wrap.justify-center') ||
          !label?.matches('span.font-bold.text-tl-app-text.text-center.leading-tight') ||
          label.children.length || label.childNodes.length !== 1 || label.firstChild.nodeType !== Node.TEXT_NODE ||
          !artwork.children.length || [...artwork.children].some(img => !img.matches('img.shrink-0.select-none') ||
            !ctBadgeAsset(img.getAttribute('src')))) continue;
      const kinds = [...artwork.children].map(img => ctBadgeAsset(img.getAttribute('src')).kind);
      const out = ctBadgeJapaneseDescription(label.firstChild.nodeValue, kinds);
      if (out && label.firstChild.nodeValue !== out) label.firstChild.nodeValue = out;
    }
  }

  function ctBadgeAsset(value) {
    try {
      const url = new URL(value, location.origin);
      if (!['https://app.tweet.app', 'https://tweet.app'].includes(url.origin) || url.search || url.hash) return null;
      const match = url.pathname.match(/^\/assets\/(founder|fighter|centurion|team-member|ambassador|wing|press)-badge-(18|36|48|96)\.png$/);
      return match ? { kind: match[1], size: Number(match[2]), url: url.href } : null;
    } catch { return null; }
  }

  function ctBadgeSource(kind) {
    return `https://app.tweet.app/assets/${kind}-badge-96.png`;
  }

  function ctUpgradeBadgeImage(img) {
    if (!img.matches('img.shrink-0.select-none') || img.closest('.ct-official-badges')) return;
    const original = ctBadgeAsset(img.getAttribute('src'));
    if (!original) return;
    let state = ctBadgeImageStates.get(img);
    const firstUse = !state;
    if (state?.kind !== original.kind) {
      state = { kind: original.kind, src: img.getAttribute('src'), srcset: img.getAttribute('srcset'), failed: false };
      ctBadgeImageStates.set(img, state);
    }
    if (firstUse) {
      img.addEventListener('error', () => {
        const current = ctBadgeImageStates.get(img);
        if (!current || img.src !== ctBadgeSource(current.kind) || current.failed) return;
        current.failed = true;
        // A failed enhancement must not remove the site's original artwork.
        img.setAttribute('src', current.src);
        if (current.srcset === null) img.removeAttribute('srcset');
        else img.setAttribute('srcset', current.srcset);
      });
    }
    if (state.failed) return;
    const source = ctBadgeSource(original.kind);
    if (img.src !== source) img.src = source;
    // A width-based srcset lets DPR=1 choose the low-resolution 18 px file.
    // Keep layout dimensions, but select the largest artwork explicitly.
    if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
  }

  function ctProfileBadgeKinds(user) {
    const badges = Array.isArray(user?.badges) ? user.badges : [];
    if (badges.includes('team_member')) return ['team-member'];
    const hasCenturion = badges.includes('centurion');
    const hasFighter = hasCenturion || badges.includes('founding_special');
    const hasFounder = hasFighter || badges.includes('founding') ||
      (user?.foundingMemberNumber != null && /^\d+$/.test(String(user.foundingMemberNumber)));
    const result = [];
    if (hasFounder) result.push('founder');
    if (hasFighter) result.push('fighter');
    if (hasCenturion) result.push('centurion');
    if (badges.includes('wing')) result.push('wing');
    if (badges.includes('ambassador')) result.push('ambassador');
    if (badges.includes('press')) result.push('press');
    return result;
  }

  function ctBadgeUsername(value) {
    const username = String(value || '').trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_.-]{1,80}$/.test(username) ? username : null;
  }

  function ctBadgeArticleTarget(article) {
    if (!article?.isConnected || article.closest('[data-ct-owned],[data-ct-local-ui],blockquote,[aria-label^="Quoted post"]')) return null;
    const avatar = [...article.querySelectorAll('button[aria-label]')].find(button =>
      button.closest('article') === article && !button.closest('blockquote,[aria-label^="Quoted post"]') &&
      /^View @[^\s]+'s profile$/i.test(button.getAttribute('aria-label') || ''));
    const username = ctBadgeUsername(avatar?.getAttribute('aria-label')?.match(/^View @(.+)'s profile$/i)?.[1]);
    if (!username) return null;
    const name = [...article.querySelectorAll('button.font-bold.truncate')].find(button =>
      button.closest('article') === article && !button.closest('blockquote,[aria-label^="Quoted post"],p') &&
      (ctBadgeUsername(button.dataset.ctAuthorUser) === username || ctBadgeUsername(button.textContent) === username));
    if (!name) return null;
    return { name, username, host: name.parentElement, kind: 'article', scope: article };
  }

  function ctBadgeAccountTarget(dialog) {
    if (!dialog?.isConnected || !dialog.matches('[role="dialog"][aria-label="Account menu"]')) return null;
    const name = dialog.querySelector('button.block.text-left > p.font-extrabold.truncate');
    const handle = name?.nextElementSibling;
    if (!handle?.matches('p.truncate') || !/^@/.test(handle.textContent.trim())) return null;
    const username = ctBadgeUsername(handle.textContent);
    return username ? { name, username, host: name, kind: 'account', scope: dialog } : null;
  }

  function ctBadgeNativeImages(target) {
    return [...target.host.querySelectorAll('img')].filter(img => !img.closest('.ct-official-badges') && ctBadgeAsset(img.getAttribute('src')));
  }

  function ctBadgeCurrentTarget(target) {
    return target.kind === 'account' ? ctBadgeAccountTarget(target.scope) : ctBadgeArticleTarget(target.scope);
  }

  function ctBadgeGroup(target) {
    return [...target.host.children].find(child => child.classList.contains('ct-official-badges')) || null;
  }

  function ctInstallBadgeStyle() {
    if (document.getElementById('ct-official-badge-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-official-badge-style';
    style.textContent = `
      .ct-official-badges { display:inline-flex; flex-shrink:0; align-items:center; gap:2px; vertical-align:middle; }
      .ct-official-badges img { display:block; width:18px; height:18px; max-width:none; aspect-ratio:1; object-fit:contain; image-rendering:auto; }
      .ct-account-badge-name { white-space:normal !important; overflow:visible !important; overflow-wrap:anywhere; }
      .ct-account-badge-name > .ct-official-badges { margin-inline-start:4px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ctRenderProfileBadges(target, user) {
    const kinds = ctProfileBadgeKinds(user);
    let group = ctBadgeGroup(target);
    if (!kinds.length || ctBadgeNativeImages(target).length) { group?.remove(); return; }
    const signature = `${target.username}:${kinds.join(',')}`;
    if (group?.dataset.ctBadgeSignature === signature) return;
    if (!group) {
      group = document.createElement('span');
      group.className = 'ct-official-badges';
      group.dataset.ctOwned = '';
      if (target.kind === 'account') {
        target.name.classList.add('ct-account-badge-name');
        target.name.appendChild(group);
      } else target.name.after(group);
    }
    group.dataset.ctBadgeUser = target.username;
    group.dataset.ctBadgeSignature = signature;
    group.setAttribute('role', 'img');
    const labelKinds = kinds.filter(kind => !(kind === 'founder' && kinds.includes('fighter')) &&
      !(kind === 'fighter' && kinds.includes('centurion')));
    group.setAttribute('aria-label', labelKinds.map(ctBadgeLabel).join(' + '));
    group.title = group.getAttribute('aria-label');
    group.replaceChildren(...kinds.map(kind => {
      const img = document.createElement('img');
      img.src = ctBadgeSource(kind);
      img.alt = '';
      img.width = 18;
      img.height = 18;
      img.draggable = false;
      img.addEventListener('error', () => {
        img.src = `https://app.tweet.app/assets/${kind}-badge-36.png`;
      }, { once: true });
      return img;
    }));
  }

  async function ctPatchProfileBadges(target) {
    const group = ctBadgeGroup(target);
    if (group && group.dataset.ctBadgeUser !== target.username) group.remove();
    if (ctBadgeNativeImages(target).length) { ctBadgeGroup(target)?.remove(); return; }
    const pending = ctBadgeRequests.get(target.name);
    if (pending?.username === target.username) return pending.promise;
    const request = { username: target.username, promise: null };
    ctBadgeRequests.set(target.name, request);
    request.promise = Promise.resolve().then(() => fetchProfile(target.username)).then(user => {
      const current = ctBadgeCurrentTarget(target);
      if (!user || ctBadgeRequests.get(target.name) !== request || current?.name !== target.name ||
          current.username !== target.username || current.host !== target.host) return;
      const returnedUsername = ctBadgeUsername(user.username || user.handle);
      if (returnedUsername && returnedUsername !== target.username) return;
      ctRenderProfileBadges(current, user);
    }).catch(() => {}).finally(() => {
      if (ctBadgeRequests.get(target.name) === request) ctBadgeRequests.delete(target.name);
    });
    return request.promise;
  }

  function patchOfficialBadges(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const images = [...(host.querySelectorAll?.('img[src]') || [])];
    if (host.matches?.('img[src]')) images.push(host);
    images.forEach(ctUpgradeBadgeImage);
    ctPatchNativeBadgeDescriptions(images, host);
    const scopes = new Set(root.querySelectorAll?.('article,[role="dialog"][aria-label="Account menu"]') || []);
    if (root.matches?.('article,[role="dialog"][aria-label="Account menu"]')) scopes.add(root);
    const parent = root.closest?.('article,[role="dialog"][aria-label="Account menu"]');
    if (parent) scopes.add(parent);
    const requests = [];
    for (const scope of scopes) {
      const target = scope.matches('article') ? ctBadgeArticleTarget(scope) : ctBadgeAccountTarget(scope);
      if (!target) continue;
      ctInstallBadgeStyle();
      requests.push(ctPatchProfileBadges(target));
    }
    return Promise.all(requests);
  }

    // Tweet owns photo selection, uploads, inline carousels and viewer controls.
  // Supplement only the verified viewer's motion, viewport fit and delivered
  // media information; never submit posts or rewrite provided media sources.
  const ctMediaGalleries = new Map();
  const ctMediaCenteredViewers = new Map();
  const ctMediaVideos = new Map();
  const ctMediaPhotoQuality = new Map();
  let ctMediaViewportBound = false;
  let ctMediaPendingViewer = null;
  let ctMediaViewer = null;

  function ctMediaJapanese() { return CT_LOCALE === 'ja'; }
  function ctMediaQualityURL(value) {
    if (typeof value !== 'string' || value.length > 4000) return '';
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function ctMediaResolution(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      ? `${width} × ${height}` : '';
  }
  function ctMediaReleasePhotoQuality(dialog) {
    const state = ctMediaPhotoQuality.get(dialog);
    if (!state) return;
    state.observer.disconnect();
    state.image.removeEventListener('load', state.update);
    state.image.removeEventListener('error', state.update);
    state.tools.remove(); ctMediaPhotoQuality.delete(dialog);
  }
  function ctMediaAttachPhotoQuality(dialog, image) {
    if (!dialog?.isConnected || image?.tagName !== 'IMG' || !dialog.contains(image)) return;
    const old = ctMediaPhotoQuality.get(dialog);
    if (old?.image === image) { old.update(); return; }
    ctMediaReleasePhotoQuality(dialog); ctMediaStyles();
    const tools = document.createElement('div');
    tools.className = 'ct-media-photo-quality'; tools.dataset.ctLocalUi = 'media-quality';
    const open = document.createElement('a');
    open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
    open.textContent = ctMediaJapanese() ? '配信画像を開く ↗' : 'Open image ↗';
    open.setAttribute('aria-label', ctMediaJapanese() ? '配信画像を新しいタブで開く' : 'Open delivered image in a new tab');
    const resolution = document.createElement('span'); resolution.className = 'ct-media-photo-resolution';
    resolution.title = ctMediaJapanese() ? '読み込んだ画像のサイズ' : 'Size of the loaded image';
    tools.append(open, resolution);
    tools.addEventListener('click', event => event.stopPropagation());
    const state = { image, tools, open, resolution, source: '' };
    state.update = () => {
      const source = ctMediaQualityURL(image.getAttribute('src') || '');
      if (source !== state.source) {
        state.source = source; resolution.textContent = ''; resolution.hidden = true;
      }
      if (source) { if (open.href !== source) open.href = source; }
      else open.removeAttribute('href');
      open.hidden = !source;
      // currentSrc can still describe the previous photo during a native src
      // change. Never attach that earlier photo's dimensions to the new link.
      const current = image.currentSrc;
      const dimensions = source && image.complete && (!current || ctMediaQualityURL(current) === source)
        ? ctMediaResolution(image.naturalWidth, image.naturalHeight) : '';
      if (resolution.textContent !== dimensions) resolution.textContent = dimensions;
      resolution.hidden = !dimensions; tools.hidden = !source;
    };
    state.observer = new MutationObserver(state.update);
    state.observer.observe(image, { attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
    image.addEventListener('load', state.update); image.addEventListener('error', state.update);
    dialog.append(tools); ctMediaPhotoQuality.set(dialog, state); state.update();
  }
  function ctMediaLabelUploadControls(input) {
    if (!input.matches('input[type="file"][accept="image/*"][multiple]') || input.closest('[data-ct-local-ui],[data-ct-owned]')) return;
    const toolbar = input.parentElement;
    if (!toolbar?.matches('div.flex.items-center') || !toolbar.parentElement?.matches('div.w-full.mt-3.space-y-3') ||
        ![...toolbar.children].some(el => el.matches('input[type="file"][accept="video/mp4,video/quicktime"]'))) return;
    const actions = [...toolbar.children].find(el => el.matches('div.flex.items-center'));
    if (!actions) return;
    for (const [icon, label] of [['image', ctMediaJapanese() ? '写真を追加' : 'Add photos'],
        ['video', ctMediaJapanese() ? '動画を追加' : 'Add video']]) {
      const buttons = [...actions.children].filter(el => el.matches('button[type="button"]') &&
        el.querySelector(':scope > svg.lucide-' + icon));
      if (buttons.length !== 1) continue;
      const button = buttons[0], current = button.getAttribute('aria-label');
      // The current compose buttons remain icon-only. Preserve a future native
      // accessible label; naming these controls never changes upload behavior.
      if (!current || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(current)) {
        if (current !== label) button.setAttribute('aria-label', label);
        if ((!button.title || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(button.title)) && button.title !== label) button.title = label;
      }
    }
  }
  function ctMediaSlides(grid) {
    if (!grid?.matches('div.flex.w-full.snap-x.snap-mandatory.overflow-x-auto.overscroll-x-contain') ||
        !grid.closest('main,article') || grid.closest('[data-ct-local-ui],[data-ct-owned]') ||
        !grid.parentElement?.matches('div.relative.overflow-hidden.rounded-2xl.border.bg-black')) return [];
    const slides = [...grid.children];
    if (slides.length < 2 || slides.length > 16 || slides.some(slide =>
        !slide.matches('button[type="button"].relative.w-full.min-w-full.shrink-0.snap-start.bg-black') ||
        slide.children.length !== 1 || !slide.firstElementChild.matches('img.h-full.w-full.object-cover') ||
        !ctMediaQualityURL(slide.firstElementChild.src))) return [];
    const sources = slides.map(slide => slide.firstElementChild.src);
    return new Set(sources).size === sources.length ? slides : [];
  }
  function ctMediaObserveGallery(grid) {
    const slides = ctMediaSlides(grid);
    if (!slides.length) return;
    const existing = ctMediaGalleries.get(grid);
    if (existing) { existing.slides = slides; existing.shell.classList.add('ct-media-native-gallery'); return; }
    // Record the native opener only. Its scroll snap, dots, keyboard/click
    // handlers and counts remain untouched; no second inline carousel is made.
    const state = { grid, slides, shell: grid.parentElement };
    state.shell.classList.add('ct-media-native-gallery');
    state.onClick = event => {
      const button = event.target.closest?.('button');
      const index = ctMediaSlides(grid).indexOf(button);
      if (index >= 0) ctMediaPendingViewer = { state, index, at: Date.now(), context: ctMediaPhotoContext() };
    };
    grid.addEventListener('click', state.onClick, true);
    ctMediaGalleries.set(grid, state);
  }
  function ctMediaRemoveGallery(state) {
    state.shell.classList.remove('ct-media-native-gallery');
    state.grid.removeEventListener('click', state.onClick, true);
    ctMediaGalleries.delete(state.grid);
    if (ctMediaPendingViewer?.state === state) ctMediaPendingViewer = null;
  }
  function ctMediaNativePhotoViewer(dialog) {
    if (!dialog?.matches('div[role="dialog"][aria-modal="true"]:is([aria-label="Media viewer"],[aria-label="写真・動画ビューア"])') ||
        !dialog.classList.contains('flex') || !dialog.classList.contains('flex-col') ||
        dialog.closest('[data-ct-local-ui],[data-ct-owned]')) return null;
    const stage = [...dialog.children].find(el =>
      el.matches('div.relative.flex.flex-1.min-h-0.items-center.justify-center'));
    const image = stage && [...stage.children].find(el => el.matches('img.max-h-full.max-w-full.select-none.object-contain'));
    const prev = stage && [...stage.children].find(el => el.matches('button[type="button"].absolute.left-3') &&
      el.querySelector(':scope > svg.lucide-chevron-left'));
    const next = stage && [...stage.children].find(el => el.matches('button[type="button"].absolute.right-3') &&
      el.querySelector(':scope > svg.lucide-chevron-right'));
    const header = [...dialog.children].find(el => el.matches('div.flex.items-center.justify-between.shrink-0') &&
      el.querySelector(':scope > button[type="button"] > svg.lucide-x') && el.querySelector(':scope > span[aria-live="polite"]'));
    const position = /^(\d+)\s*\/\s*(\d+)$/.exec(header?.querySelector(':scope > span[aria-live="polite"]')?.textContent.trim() || '');
    const index = position ? Number(position[1]) - 1 : -1, total = position ? Number(position[2]) : 0;
    return stage && image && prev && next && header && index >= 0 && index < total && total <= 16
      ? { stage, image, prev, next, header, index, total } : null;
  }
  function ctMediaClearViewer() {
    if (!ctMediaViewer) return;
    const viewer = ctMediaViewer;
    viewer.observer?.disconnect();
    clearTimeout(viewer.requestTimer);
    ctMediaResetPhotoMotion(viewer);
    viewer.stage?.classList.remove('ct-media-swipe-stage');
    viewer.dialog.removeEventListener('click', viewer.onControlClick, true);
    viewer.dialog.removeEventListener('touchstart', viewer.onTouchStart, true);
    viewer.dialog.removeEventListener('touchmove', viewer.onTouchMove, true);
    viewer.dialog.removeEventListener('touchend', viewer.onTouchEnd, true);
    viewer.dialog.removeEventListener('touchcancel', viewer.onCancel, true);
    for (const [name, handler] of [['pointerdown', viewer.onPointerStart], ['pointermove', viewer.onPointerMove],
        ['pointerup', viewer.onPointerEnd], ['pointercancel', viewer.onCancel], ['lostpointercapture', viewer.onCancel],
        ['click', viewer.onClick]]) if (handler) viewer.dialog.removeEventListener(name, handler, name === 'click');
    document.removeEventListener('visibilitychange', viewer.onVisibility);
    window.removeEventListener('pagehide', viewer.onPageHide);
    window.removeEventListener('pageshow', viewer.onPageShow);
    viewer.dialog.removeEventListener('dragstart', viewer.onDragStart);
    viewer.reduce?.removeEventListener?.('change', viewer.onReduce);
    ctMediaClearPhotoDecode(viewer);
    if (ctMediaPendingViewer?.state === viewer.state) ctMediaPendingViewer = null;
    ctMediaViewer = null;
  }
  function ctMediaPhotoContext() {
    return `${location.pathname}${location.search}\n${typeof ctNetworkState !== 'undefined' ? ctNetworkState.authUID || '' : ''}`;
  }
  function ctMediaPhotoViewerValid(viewer) {
    return viewer.dialog.isConnected && viewer.state.grid.isConnected && !document.hidden &&
      viewer.context === ctMediaPhotoContext() && viewer.sources === ctMediaSlides(viewer.state.grid)
        .map(slide => slide.firstElementChild.src).join('\n');
  }
  function ctMediaResetPhotoMotion(viewer) {
    const touch = viewer.touch;
    viewer.touch = null;
    if (touch?.pointer != null) try { touch.capture?.releasePointerCapture(touch.pointer); } catch {}
    const motion = viewer.motion;
    if (motion) {
      cancelAnimationFrame(motion.frame);
      clearTimeout(motion.timer);
      motion.image.removeEventListener('load', motion.loaded);
      motion.image.removeEventListener('error', motion.loaded);
      motion.image.classList.remove('ct-media-photo-covered');
      motion.layer.remove();
      viewer.motion = null;
    }
  }
  function ctMediaCancelPhotoGesture(viewer) {
    if (viewer.touch?.locked || viewer.pinch) viewer.suppressClickUntil = Date.now() + 400;
    ctMediaResetPhotoMotion(viewer);
  }
  function ctMediaClearPhotoDecode(viewer) {
    // Detached decoded images belong only to this visible viewer. A promise
    // completing after close/source/account changes cannot revive that viewer.
    viewer.decodedPhotos?.clear();
  }
  function ctMediaWarmPhotoDecode(viewer) {
    if (!ctMediaPhotoViewerValid(viewer) || viewer.pageActive === false || viewer.reduce?.matches || ctPhotoViewportZoomed()) {
      ctMediaClearPhotoDecode(viewer); return;
    }
    const slides = ctMediaSlides(viewer.state.grid);
    const wanted = new Set([viewer.index - 1, viewer.index, viewer.index + 1].filter(index => slides[index]));
    const photos = viewer.decodedPhotos ||= new Map();
    for (const index of photos.keys()) if (!wanted.has(index)) photos.delete(index);
    const preview = ctMediaNativePhotoViewer(viewer.dialog)?.image;
    for (const index of wanted) {
      const source = slides[index].firstElementChild.src;
      if (photos.get(index)?.source === source) continue;
      const image = document.createElement('img');
      image.alt = ''; image.draggable = false; image.decoding = 'async';
      image.referrerPolicy = preview?.referrerPolicy || ''; image.src = source;
      const entry = { image, source, ready: typeof image.decode !== 'function' };
      photos.set(index, entry);
      if (entry.ready) continue; // Older engines retain the existing behavior.
      try {
        Promise.resolve(image.decode()).then(() => {
          if (photos.get(index) !== entry || !ctMediaPhotoViewerValid(viewer)) return;
          entry.ready = image.complete && image.naturalWidth > 0;
        }, () => {});
      } catch {}
    }
  }
  function ctMediaPhotoLayer(viewer, target) {
    if (viewer.motion) return viewer.motion;
    const image = ctMediaNativePhotoViewer(viewer.dialog)?.image;
    // Only add presentation inside the verified native stage; React keeps its
    // image, src, click handlers, close button and backdrop throughout.
    if (!viewer.stage || image?.parentElement !== viewer.stage ||
        viewer.reduce?.matches) return null;
    ctMediaWarmPhotoDecode(viewer);
    const slides = ctMediaSlides(viewer.state.grid);
    // Do not cover a decoded native photo with a freshly created, still blank
    // image. If preparation is incomplete, the native click remains available.
    if (!viewer.decodedPhotos?.get(viewer.index)?.ready ||
        (slides[target] && !viewer.decodedPhotos.get(target)?.ready)) return null;
    const layer = document.createElement('div');
    layer.className = 'ct-media-photo-layer'; layer.dataset.ctLocalUi = 'photo-motion';
    layer.setAttribute('aria-hidden', 'true');
    const track = document.createElement('div'); track.className = 'ct-media-photo-track';
    for (const index of [target < viewer.index ? target : viewer.index - 1, viewer.index,
        target > viewer.index ? target : viewer.index + 1]) {
      const pane = document.createElement('div'); pane.className = 'ct-media-photo-pane';
      const original = slides[index]?.firstElementChild;
      if (original) {
        const decoded = viewer.decodedPhotos.get(index);
        if (decoded?.ready && decoded.source === original.src) pane.append(decoded.image);
      }
      track.append(pane);
    }
    layer.append(track); viewer.stage.append(layer); image.classList.add('ct-media-photo-covered');
    const motion = { layer, track, image, width: viewer.stage.clientWidth || window.innerWidth, frame: 0, timer: null };
    viewer.motion = motion;
    track.style.transform = 'translate3d(-100%,0,0)';
    return motion;
  }
  function ctMediaPhotoOffset(viewer, offset) {
    const motion = viewer.motion;
    if (!motion) return;
    motion.offset = offset;
    if (motion.frame) return;
    motion.frame = requestAnimationFrame(() => {
      motion.frame = 0;
      if (viewer.motion === motion) motion.track.style.transform = `translate3d(calc(-100% + ${motion.offset}px),0,0)`;
    });
  }
  function ctMediaFinishPhoto(viewer, index, commit, invokeNative = true) {
    if (!ctMediaPhotoViewerValid(viewer)) { ctMediaClearViewer(); return; }
    const motion = viewer.motion;
    const oldIndex = viewer.index;
    const image = ctMediaSlides(viewer.state.grid)[index]?.firstElementChild;
    if (commit && image) {
      viewer.requestedIndex = index;
      if (motion) { motion.startSource = motion.image.src; motion.targetSource = image.src; }
      viewer.requestTimer = setTimeout(() => {
        if (ctMediaViewer !== viewer) return;
        viewer.requestedIndex = null;
        ctMediaResetPhotoMotion(viewer);
        ctMediaEnhanceViewer();
      }, 1600);
      if (invokeNative) {
        viewer.commitAction = true;
        try { (index > oldIndex ? viewer.next : viewer.prev).click(); }
        finally { viewer.commitAction = false; }
        ctMediaEnhanceViewer();
      }
    }
    if (!motion || viewer.motion !== motion) return;
    cancelAnimationFrame(motion.frame); motion.frame = 0;
    if (motion.offset != null) motion.track.style.transform = `translate3d(calc(-100% + ${motion.offset}px),0,0)`;
    // Establish the starting transform once, then let the compositor settle it.
    motion.track.getBoundingClientRect();
    motion.track.style.transition = 'transform 220ms cubic-bezier(.22,.68,0,1)';
    motion.track.style.transform = `translate3d(${commit ? index > oldIndex ? '-200%' : '0%' : '-100%'},0,0)`;
    motion.timer = setTimeout(() => {
      if (viewer.motion !== motion) return;
      if (!commit || !ctMediaPhotoViewerValid(viewer)) { ctMediaResetPhotoMotion(viewer); ctMediaEnhanceViewer(); return; }
      // Keep the already visible destination until the native image loads.
      // A bounded fallback also restores native errors instead of hiding them.
      const release = () => {
        if (viewer.motion !== motion) return;
        ctMediaResetPhotoMotion(viewer);
        ctMediaEnhanceViewer();
      };
      motion.loaded = () => { if (motion.image.src === image.src) release(); };
      if (motion.image.src === image.src && motion.image.complete) motion.loaded();
      else {
        motion.image.addEventListener('load', motion.loaded);
        motion.image.addEventListener('error', motion.loaded);
        motion.timer = setTimeout(release, 1200);
      }
    }, 240);
  }
  function ctMediaStartPhotoGesture(viewer, event, point) {
    if (!ctMediaPhotoViewerValid(viewer) || viewer.motion || viewer.requestedIndex != null || ctPhotoViewportZoomed() || viewer.pinch ||
        event.target !== ctMediaNativePhotoViewer(viewer.dialog)?.image) return;
    viewer.touch = { x: point.clientX, y: point.clientY, at: performance.now(), dx: 0, locked: false,
      pointer: event.pointerId, width: viewer.stage?.clientWidth || window.innerWidth };
  }
  function ctMediaDragPhoto(viewer, event, point) {
    const touch = viewer.touch;
    if (!touch) return;
    if (!ctMediaPhotoViewerValid(viewer)) { ctMediaClearViewer(); return; }
    if (ctPhotoViewportZoomed() || viewer.pinch) { ctMediaCancelPhotoGesture(viewer); return; }
    const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
    if (!touch.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { viewer.touch = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      touch.locked = true;
      ctMediaPhotoLayer(viewer, viewer.index + (dx < 0 ? 1 : -1));
      if (event.pointerId != null) try { event.target.setPointerCapture(event.pointerId); touch.capture = event.target; } catch {}
    }
    touch.dx = dx;
    if (event.cancelable) event.preventDefault();
    const edge = viewer.index === 0 && dx > 0 || viewer.index === viewer.state.slides.length - 1 && dx < 0;
    ctMediaPhotoOffset(viewer, edge ? dx * .22 : Math.max(-touch.width, Math.min(touch.width, dx)));
  }
  function ctMediaEndPhotoGesture(viewer, event, point) {
    const touch = viewer.touch;
    if (!touch) return;
    // Older TouchEvent bridges may omit move; retain their completed swipe.
    ctMediaDragPhoto(viewer, event, point);
    if (viewer.touch !== touch) return;
    viewer.touch = null;
    if (!touch.locked) return;
    const dx = point.clientX - touch.x;
    const fast = Math.abs(dx) >= 24 && Math.abs(dx) / Math.max(1, performance.now() - touch.at) > .55;
    const commit = fast || Math.abs(dx) >= Math.min(90, touch.width * .18);
    const index = Math.max(0, Math.min(viewer.state.slides.length - 1, viewer.index + (dx < 0 ? 1 : -1)));
    viewer.suppressClickUntil = Date.now() + 400;
    ctMediaFinishPhoto(viewer, index, commit && index !== viewer.index);
    if (touch.pointer != null) try { touch.capture?.releasePointerCapture(touch.pointer); } catch {}
  }
  function ctMediaViewport(dialog) {
    const fit = ctPhotoViewportFit(dialog, '--ct-media-view-');
    dialog.classList.toggle('ct-media-photo-zoomed', fit.zoomed);
    if (ctMediaViewer?.dialog === dialog && (fit.zoomed || fit.changed)) {
      ctMediaCancelPhotoGesture(ctMediaViewer); ctMediaEnhanceViewer();
    }
  }
  function ctMediaCenterViewers() {
    for (const [dialog, state] of ctMediaCenteredViewers) {
      if (dialog.isConnected && ctMediaNativePhotoViewer(dialog)) continue;
      dialog.classList.remove('ct-media-centered-viewer', 'ct-media-viewport-viewer', 'ct-media-photo-zoomed');
      state.stage.classList.remove('ct-media-viewer-stage');
      state.header?.classList.remove('ct-media-viewer-header');
      ctMediaReleasePhotoQuality(dialog);
      for (const key of ['top', 'left', 'width', 'height']) dialog.style.removeProperty(`--ct-media-view-${key}`);
      ctMediaCenteredViewers.delete(dialog);
    }
    for (const dialog of document.querySelectorAll('div[role="dialog"][aria-modal="true"]:is([aria-label="Media viewer"],[aria-label="写真・動画ビューア"])')) {
      const native = ctMediaNativePhotoViewer(dialog);
      if (!native) continue;
      const { image, stage, header } = native;
      const previous = ctMediaCenteredViewers.get(dialog);
      if (previous && previous.stage !== stage) previous.stage.classList.remove('ct-media-viewer-stage');
      dialog.classList.add('ct-media-centered-viewer');
      // Contained native viewers remain inside their existing modal. Only the
      // verified fixed viewer follows the visible viewport on mobile browsers.
      dialog.classList.toggle('ct-media-viewport-viewer', dialog.classList.contains('fixed'));
      stage.classList.add('ct-media-viewer-stage');
      header?.classList.add('ct-media-viewer-header');
      ctMediaAttachPhotoQuality(dialog, image);
      ctMediaCenteredViewers.set(dialog, { stage, header });
      ctMediaViewport(dialog);
    }
    if (ctMediaViewportBound) return;
    ctMediaViewportBound = true;
    const update = () => {
      for (const dialog of ctMediaCenteredViewers.keys()) if (dialog.isConnected) ctMediaViewport(dialog);
    };
    window.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('scroll', update, { passive: true });
  }
  function ctMediaVideoContext(video) {
    return { source: video.currentSrc || video.src, path: location.pathname + location.search,
      uid: typeof ctNetworkState === 'undefined' ? null : ctNetworkState.authUID };
  }
  function ctMediaVideoContextMatches(state) {
    const current = ctMediaVideoContext(state.video);
    return state.video.isConnected && current.source === state.context?.source &&
      current.path === state.context?.path && current.uid === state.context?.uid;
  }
  function ctMediaVideoFullscreen(state) {
    return document.fullscreenElement === state.video || state.webkitFullscreen === true ||
      state.video.webkitDisplayingFullscreen === true;
  }
  function ctMediaRestorePause(state) {
    clearInterval(state.guardTimer);
    state.guardTimer = null;
    if (!state.pauseGuard) return;
    // Never overwrite a later page-owned replacement of the instance method.
    if (state.video.pause === state.pauseGuard) {
      if (state.pauseDescriptor) Object.defineProperty(state.video, 'pause', state.pauseDescriptor);
      else delete state.video.pause;
    }
    state.pauseGuard = null;
  }
  function ctMediaVideoEnd(state, invalid = false) {
    const pause = state.originalPause;
    if (invalid) state.invalidatedFullscreen = true;
    ctMediaRestorePause(state);
    state.context = null;
    state.intentPlaying = false;
    state.requesting = false;
    state.requestSequence++;
    state.button.disabled = false;
    if (!ctMediaVideoFullscreen(state) && !state.pendingRequests.size) state.invalidatedFullscreen = false;
    if (!invalid) return;
    // A removed post, another account, or a new route must not leave an old
    // account's media playing in the browser's fullscreen top layer.
    if (pause && !state.video.paused) try { pause.call(state.video); } catch {}
    if (document.fullscreenElement === state.video) {
      try { document.exitFullscreen?.()?.catch?.(() => {}); } catch {}
    } else if (state.webkitFullscreen || state.video.webkitDisplayingFullscreen) {
      try { state.video.webkitExitFullscreen?.(); } catch {}
    }
  }
  function ctMediaGuardVideoPause(state) {
    if (state.pauseGuard || typeof state.video.pause !== 'function') return;
    const video = state.video;
    state.pauseDescriptor = Object.getOwnPropertyDescriptor(video, 'pause');
    state.originalPause = video.pause;
    const original = state.originalPause;
    // Tweet's autoplay manager observes the inline wrapper, which can leave the
    // viewport while this same video is in the fullscreen top layer. Ignore
    // only JavaScript pause calls during that active fullscreen session. Native
    // player controls do not call this method and their pause event is retained.
    state.pauseGuard = function (...args) {
      if (this === video && state.intentPlaying && ctMediaVideoFullscreen(state) &&
          !document.hidden && ctMediaVideoContextMatches(state)) return;
      return original.apply(this, args);
    };
    try { Object.defineProperty(video, 'pause', { configurable: true, writable: true, value: state.pauseGuard }); }
    catch { state.pauseGuard = null; return; }
    state.guardTimer = setInterval(() => {
      if (!ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
      else if (!ctMediaVideoFullscreen(state) && !state.requesting) ctMediaVideoEnd(state);
    }, 500);
  }
  function ctMediaVideoBegin(state) {
    if (document.hidden) { ctMediaVideoEnd(state); return; }
    if (!ctMediaVideoFullscreen(state)) {
      // Fullscreen exit events are queued. An older exit, or a change for
      // another player, must not cancel a valid request still awaiting entry.
      if (state.requesting && ctMediaVideoContextMatches(state)) return;
      ctMediaVideoEnd(state); return;
    }
    if (state.invalidatedFullscreen && !state.context) { ctMediaVideoEnd(state, true); return; }
    if (!state.context && state.pendingRequests.size) { ctMediaVideoEnd(state, true); return; }
    if (!state.context) {
      state.context = ctMediaVideoContext(state.video);
      state.intentPlaying = !state.video.paused && !state.video.ended;
    }
    state.requesting = false;
    state.button.disabled = false;
    ctMediaGuardVideoPause(state);
  }
  function ctMediaVideoStatus(state, text = '') {
    state.status.textContent = text;
    state.status.hidden = !text;
  }
  function ctMediaEnhanceVideo(video) {
    if (video?.tagName !== 'VIDEO' || !video.controls || !video.isConnected ||
        video.closest('[data-ct-local-ui]:not([data-ct-local-ui="profile"])') ||
        video.closest('.w-full.mt-3.space-y-3') ||
        (!video.matches('.ct-profile-video') && (!video.closest('main,article') ||
          !video.playsInline || !video.loop || !video.matches('.w-full.object-contain')))) return;
    const shell = video.parentElement;
    if (!shell || !(video.currentSrc || video.src)) return;
    const existing = ctMediaVideos.get(video);
    if (existing) {
      if (existing.shell !== shell) { ctMediaRemoveVideo(existing); return ctMediaEnhanceVideo(video); }
      shell.classList.add('ct-media-video-shell');
      video.classList.add('ct-media-enhanced-video');
      if (!existing.controls.isConnected) video.after(existing.controls);
      if (existing.context && !ctMediaVideoContextMatches(existing)) ctMediaVideoEnd(existing, true);
      return;
    }
    if (typeof video.requestFullscreen !== 'function' && typeof video.webkitEnterFullscreen !== 'function') return;
    const controls = document.createElement('div');
    controls.className = 'ct-media-video-tools'; controls.dataset.ctLocalUi = 'media-video';
    if (video.matches('.ct-profile-video')) controls.classList.add('ct-media-video-inline-tools');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ct-media-video-fullscreen';
    const label = ctMediaJapanese() ? '動画を全画面で表示' : 'Show video fullscreen';
    button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>';
    const status = document.createElement('span');
    status.className = 'ct-media-video-status'; status.setAttribute('role', 'status'); status.hidden = true;
    const resolution = document.createElement('span');
    resolution.className = 'ct-media-video-resolution'; resolution.hidden = true;
    resolution.title = ctMediaJapanese() ? '読み込んだ動画のサイズ' : 'Size of the loaded video';
    controls.append(resolution, button, status);
    controls.addEventListener('click', event => event.stopPropagation());
    const state = { video, shell, controls, button, status, resolution, context: null, pauseGuard: null,
      guardTimer: null, webkitFullscreen: false, requesting: false, requestSequence: 0, pendingRequests: new Set(),
      invalidatedFullscreen: false };
    button.addEventListener('click', () => {
      if (!video.isConnected || state.requesting) return;
      ctMediaVideoStatus(state);
      state.context = ctMediaVideoContext(video);
      state.invalidatedFullscreen = false;
      state.intentPlaying = !video.paused && !video.ended;
      state.requesting = true; button.disabled = true;
      const sequence = ++state.requestSequence;
      ctMediaGuardVideoPause(state);
      const failed = () => {
        state.pendingRequests.delete(sequence);
        if (sequence !== state.requestSequence) {
          if (!state.context && !state.pendingRequests.size && !ctMediaVideoFullscreen(state)) state.invalidatedFullscreen = false;
          return;
        }
        const same = ctMediaVideoContextMatches(state);
        ctMediaVideoEnd(state, !same);
        if (same) ctMediaVideoStatus(state, ctMediaJapanese() ? '全画面表示を開始できませんでした。動画の標準操作も利用できます。' :
          'Fullscreen could not start. You can also use the video player controls.');
      };
      try {
        // Keep this call in the click handler: browsers require user activation.
        // This never clones/reparents media, seeks, changes sound/rate or plays
        // a paused video just because its presentation is enlarged.
        if (typeof video.requestFullscreen === 'function') {
          state.pendingRequests.add(sequence);
          const result = video.requestFullscreen();
          Promise.resolve(result).then(() => {
            state.pendingRequests.delete(sequence);
            if (sequence !== state.requestSequence) {
              // The fullscreen flag can become true before fullscreenchange is
              // dispatched. Keep a cancelled successful request invalid until
              // its top layer has actually exited; a queued entry event must
              // not create a new session for changed media or another account.
              if (!state.context || !ctMediaVideoContextMatches(state)) {
                if (ctMediaVideoFullscreen(state)) ctMediaVideoEnd(state, true);
                else if (!state.pendingRequests.size) state.invalidatedFullscreen = false;
              }
              return;
            }
            if (!ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
            else ctMediaVideoBegin(state);
          }, failed);
        } else { video.webkitEnterFullscreen(); state.requesting = false; button.disabled = false; }
      } catch { failed(); }
    });
    state.onFullscreen = () => ctMediaVideoBegin(state);
    state.onWebkitBegin = () => { state.webkitFullscreen = true; ctMediaVideoBegin(state); };
    state.onWebkitEnd = () => { state.webkitFullscreen = false; ctMediaVideoEnd(state); };
    state.onPause = () => { state.intentPlaying = false; };
    state.onPlay = () => { if (ctMediaVideoFullscreen(state) && ctMediaVideoContextMatches(state)) state.intentPlaying = true; };
    state.onQuality = () => {
      const source = ctMediaQualityURL(video.src);
      const dimensions = source && video.readyState >= 1 &&
        (!video.currentSrc || ctMediaQualityURL(video.currentSrc) === source)
        ? ctMediaResolution(video.videoWidth, video.videoHeight) : '';
      if (resolution.textContent !== dimensions) resolution.textContent = dimensions;
      resolution.hidden = !dimensions;
    };
    state.onQualityReset = () => { resolution.textContent = ''; resolution.hidden = true; };
    state.onInvalid = () => {
      if (state.context && !ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
      state.onQuality();
    };
    state.onPageHide = () => ctMediaVideoEnd(state, true);
    state.onVisibility = () => {
      if (document.hidden) ctMediaVideoEnd(state);
      else if (ctMediaVideoFullscreen(state)) ctMediaVideoBegin(state);
    };
    document.addEventListener('fullscreenchange', state.onFullscreen);
    document.addEventListener('visibilitychange', state.onVisibility);
    video.addEventListener('webkitbeginfullscreen', state.onWebkitBegin);
    video.addEventListener('webkitendfullscreen', state.onWebkitEnd);
    video.addEventListener('pause', state.onPause);
    video.addEventListener('play', state.onPlay);
    video.addEventListener('emptied', state.onInvalid);
    video.addEventListener('loadstart', state.onInvalid);
    video.addEventListener('loadedmetadata', state.onQuality);
    video.addEventListener('resize', state.onQuality);
    video.addEventListener('emptied', state.onQualityReset);
    video.addEventListener('loadstart', state.onQualityReset);
    window.addEventListener('pagehide', state.onPageHide);
    state.observer = new MutationObserver(state.onInvalid);
    state.observer.observe(video, { attributes: true, attributeFilter: ['src'], childList: true, subtree: true });
    shell.classList.add('ct-media-video-shell'); video.classList.add('ct-media-enhanced-video'); video.after(controls);
    ctMediaVideos.set(video, state);
    state.onQuality();
  }
  function ctMediaRemoveVideo(state) {
    ctMediaVideoEnd(state, true);
    state.observer.disconnect();
    document.removeEventListener('fullscreenchange', state.onFullscreen);
    document.removeEventListener('visibilitychange', state.onVisibility);
    state.video.removeEventListener('webkitbeginfullscreen', state.onWebkitBegin);
    state.video.removeEventListener('webkitendfullscreen', state.onWebkitEnd);
    state.video.removeEventListener('pause', state.onPause);
    state.video.removeEventListener('play', state.onPlay);
    state.video.removeEventListener('emptied', state.onInvalid);
    state.video.removeEventListener('loadstart', state.onInvalid);
    state.video.removeEventListener('loadedmetadata', state.onQuality);
    state.video.removeEventListener('resize', state.onQuality);
    state.video.removeEventListener('emptied', state.onQualityReset);
    state.video.removeEventListener('loadstart', state.onQualityReset);
    window.removeEventListener('pagehide', state.onPageHide);
    state.controls.remove(); state.shell.classList.remove('ct-media-video-shell');
    state.video.classList.remove('ct-media-enhanced-video');
    ctMediaVideos.delete(state.video);
  }
  function ctMediaEnhanceViewer() {
    let viewer = ctMediaViewer;
    if (viewer && (!ctMediaPhotoViewerValid(viewer) || !ctMediaNativePhotoViewer(viewer.dialog))) {
      ctMediaClearViewer(); viewer = null;
    }
    if (!viewer) {
      const pending = ctMediaPendingViewer;
      if (!pending || pending.context !== ctMediaPhotoContext() || document.hidden ||
          !pending.state.grid.isConnected || Date.now() - pending.at > 5000) return;
      const slides = ctMediaSlides(pending.state.grid);
      const source = slides[pending.index]?.firstElementChild.src;
      if (!source) return;
      const dialog = [...document.querySelectorAll('div[role="dialog"][aria-modal="true"]:is([aria-label="Media viewer"],[aria-label="写真・動画ビューア"])')]
        .find(el => ctMediaNativePhotoViewer(el)?.image.src === source);
      const native = ctMediaNativePhotoViewer(dialog);
      if (!native || native.total !== slides.length || native.index !== pending.index) return;
      viewer = { dialog, state: pending.state, index: pending.index, ...native,
        pointers: new Set(), pinch: false, context: pending.context,
        sources: slides.map(slide => slide.firstElementChild.src).join('\n') };
      viewer.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      viewer.onReduce = () => {
        if (viewer.reduce.matches) { ctMediaResetPhotoMotion(viewer); ctMediaClearPhotoDecode(viewer); }
        ctMediaEnhanceViewer();
      };
      viewer.reduce?.addEventListener?.('change', viewer.onReduce);
      viewer.stage.classList.add('ct-media-swipe-stage');
      viewer.onControlClick = event => {
        const button = event.target.closest?.('button');
        if (![viewer.prev, viewer.next].includes(button) || viewer.commitAction) return;
        if (viewer.motion || viewer.requestedIndex != null) {
          event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        const index = viewer.index + (button === viewer.next ? 1 : -1);
        if (index < 0 || index >= ctMediaSlides(viewer.state.grid).length) return;
        ctMediaPhotoLayer(viewer, index);
        // The original click continues to React once. Only presentation and
        // late-commit tracking are added; native controls/counters stay native.
        ctMediaFinishPhoto(viewer, index, true, false);
      };
      viewer.onCancel = event => {
        if (event.type === 'lostpointercapture') {
          if (viewer.touch?.pointer === event.pointerId) ctMediaCancelPhotoGesture(viewer);
          return;
        }
        viewer.pointers.delete(event.pointerId);
        if (!viewer.pointers.size) viewer.pinch = false;
        if (viewer.nativeTouch) viewer.nativeTouch.cancelled = true;
        ctMediaCancelPhotoGesture(viewer);
      };
      viewer.onPageHide = () => {
        viewer.pageActive = false;
        ctMediaCancelPhotoGesture(viewer); ctMediaClearPhotoDecode(viewer);
        viewer.pointers.clear(); viewer.pinch = false; viewer.nativeTouch = null;
      };
      viewer.onPageShow = () => { viewer.pageActive = true; ctMediaWarmPhotoDecode(viewer); };
      viewer.onVisibility = () => { if (document.hidden) viewer.onPageHide(); else viewer.onPageShow(); };
      viewer.onDragStart = event => { if (viewer.touch && event.target === viewer.image) event.preventDefault(); };
      viewer.onClick = event => {
        if (Date.now() < (viewer.suppressClickUntil || 0) &&
            (event.target === viewer.stage || event.target === viewer.image)) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      };
      const pointer = typeof window.PointerEvent === 'function';
      if (pointer) {
        viewer.onPointerStart = event => {
          if (event.pointerType !== 'mouse') {
            viewer.pointers.add(event.pointerId);
            if (event.isPrimary === false || viewer.pointers.size > 1) {
              viewer.pinch = true; ctMediaCancelPhotoGesture(viewer); return;
            }
          }
          if (event.button === 0) ctMediaStartPhotoGesture(viewer, event, event);
        };
        viewer.onPointerMove = event => { if (viewer.touch?.pointer === event.pointerId) ctMediaDragPhoto(viewer, event, event); };
        viewer.onPointerEnd = event => {
          viewer.pointers.delete(event.pointerId);
          if (viewer.pinch) ctMediaCancelPhotoGesture(viewer);
          else if (viewer.touch?.pointer === event.pointerId) ctMediaEndPhotoGesture(viewer, event, event);
          if (!viewer.pointers.size) viewer.pinch = false;
        };
        for (const [name, handler] of [['pointerdown', viewer.onPointerStart], ['pointermove', viewer.onPointerMove],
            ['pointerup', viewer.onPointerEnd], ['pointercancel', viewer.onCancel], ['lostpointercapture', viewer.onCancel]]) dialog.addEventListener(name, handler);
      }
      // Native v2.2.3 compares only start/end X, including pinch and vertical
      // gestures. Capture blocks that handler only for a gesture already owned
      // here, or for zoom/pinch/vertical intent, without cancelling browser zoom.
      viewer.onTouchStart = event => {
        const point = event.touches?.[0];
        const cancelled = event.touches?.length !== 1 || ctPhotoViewportZoomed();
        viewer.nativeTouch = { x: point?.clientX, y: point?.clientY, cancelled };
        if (cancelled) { viewer.pinch = true; ctMediaCancelPhotoGesture(viewer); event.stopPropagation(); }
        else if (!pointer) ctMediaStartPhotoGesture(viewer, event, point);
      };
      viewer.onTouchMove = event => {
        const point = event.touches?.[0], gesture = viewer.nativeTouch;
        if (event.touches?.length !== 1 || ctPhotoViewportZoomed()) {
          if (gesture) gesture.cancelled = true;
          viewer.pinch = true; ctMediaCancelPhotoGesture(viewer); event.stopPropagation(); return;
        }
        if (gesture && point && Math.abs(point.clientY - gesture.y) > 10 &&
            Math.abs(point.clientY - gesture.y) >= Math.abs(point.clientX - gesture.x)) gesture.cancelled = true;
        if (!pointer && !gesture?.cancelled) ctMediaDragPhoto(viewer, event, point);
      };
      viewer.onTouchEnd = event => {
        if (!ctMediaPhotoViewerValid(viewer)) { event.stopPropagation(); ctMediaClearViewer(); return; }
        const gesture = viewer.nativeTouch, point = event.changedTouches?.[0];
        const vertical = gesture && point && Math.abs(point.clientY - gesture.y) > 10 &&
          Math.abs(point.clientY - gesture.y) >= Math.abs(point.clientX - gesture.x);
        const blocked = viewer.pinch || gesture?.cancelled || vertical || ctPhotoViewportZoomed();
        if (blocked) ctMediaCancelPhotoGesture(viewer);
        else if (!pointer && point) ctMediaEndPhotoGesture(viewer, event, point);
        if (blocked || Date.now() < (viewer.suppressClickUntil || 0)) event.stopPropagation();
        if (!event.touches?.length) { viewer.nativeTouch = null; viewer.pinch = false; }
      };
      dialog.addEventListener('touchstart', viewer.onTouchStart, { capture: true, passive: true });
      dialog.addEventListener('touchmove', viewer.onTouchMove, { capture: true, passive: false });
      dialog.addEventListener('touchend', viewer.onTouchEnd, { capture: true, passive: true });
      dialog.addEventListener('touchcancel', viewer.onCancel, true);
      dialog.addEventListener('dragstart', viewer.onDragStart);
      dialog.addEventListener('click', viewer.onControlClick, true);
      dialog.addEventListener('click', viewer.onClick, true);
      document.addEventListener('visibilitychange', viewer.onVisibility);
      window.addEventListener('pagehide', viewer.onPageHide);
      window.addEventListener('pageshow', viewer.onPageShow);
      ctMediaViewer = viewer;
      viewer.observer = new MutationObserver(records => {
        // A native keyboard action may leave and return to the old source before
        // this observer runs. Retain that source history to release stale motion.
        const motion = viewer.motion;
        if (motion?.targetSource && records.some(record => record.target === viewer.image &&
            ctMediaQualityURL(record.oldValue) === motion.targetSource)) motion.destinationSeen = true;
        ctMediaEnhanceViewer();
      });
      viewer.observer.observe(dialog, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['src'] });
    }
    const native = ctMediaNativePhotoViewer(viewer.dialog);
    const slides = ctMediaSlides(viewer.state.grid);
    const actual = slides.findIndex(slide => slide.firstElementChild.src === native?.image.src);
    if (actual < 0 || native.total !== slides.length || native.index !== actual || native.stage !== viewer.stage || native.image !== viewer.image ||
        native.prev !== viewer.prev || native.next !== viewer.next) { ctMediaClearViewer(); return; }
    const motion = viewer.motion;
    if (motion?.targetSource) {
      if (native.image.src === motion.targetSource) motion.destinationSeen = true;
      else if (motion.destinationSeen || native.image.src !== motion.startSource) {
        ctMediaResetPhotoMotion(viewer); viewer.requestedIndex = null; clearTimeout(viewer.requestTimer);
      }
    }
    viewer.index = actual;
    ctMediaWarmPhotoDecode(viewer);
    if (viewer.requestedIndex === actual) { viewer.requestedIndex = null; clearTimeout(viewer.requestTimer); }
    // The native index label and disabled states are authoritative.
  }
  function ctMediaStyles() {
    if (document.getElementById('ct-media-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-media-style';
    style.textContent = `
      .ct-media-native-gallery > div.absolute.bottom-3.flex > button { min-width:44px; min-height:44px; }
      .ct-media-centered-viewer { overflow:hidden!important; }
      .ct-media-viewport-viewer { inset:auto!important; top:var(--ct-media-view-top,0)!important; left:var(--ct-media-view-left,0)!important; width:var(--ct-media-view-width,100vw)!important; height:var(--ct-media-view-height,100dvh)!important; }
      .ct-media-centered-viewer > .ct-media-viewer-header { position:absolute!important; top:0; left:0; right:0; z-index:2; padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 12px max(12px,env(safe-area-inset-left))!important; pointer-events:none; }
      .ct-media-centered-viewer > .ct-media-viewer-header button { pointer-events:auto; min-width:44px; min-height:44px; }
      .ct-media-photo-quality { position:absolute; bottom:max(12px,env(safe-area-inset-bottom)); right:max(12px,env(safe-area-inset-right)); z-index:3; display:flex; align-items:center; flex-wrap:wrap; gap:8px; max-width:calc(100% - 88px); color:#fff; font:12px/1.4 system-ui,sans-serif; }
      .ct-media-photo-quality a { display:inline-flex; align-items:center; min-height:44px; padding:0 8px; color:inherit; background:#0009; border-radius:4px; text-decoration:none; }
      .ct-media-photo-quality a:focus-visible { outline:3px solid #fff; outline-offset:2px; }
      .ct-media-photo-resolution { padding:5px 8px; background:#0009; border-radius:4px; white-space:nowrap; }
      .ct-media-photo-quality[hidden],.ct-media-photo-quality [hidden] { display:none!important; }
      .ct-media-centered-viewer > .ct-media-viewer-stage { position:absolute!important; inset:0; box-sizing:border-box; width:100%; height:100%; min-height:0; min-width:0; display:flex!important; align-items:center!important; justify-content:center!important; padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-right)) calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left))!important; }
      .ct-media-viewer-stage > img { display:block; width:auto!important; height:auto!important; max-width:100%!important; max-height:100%!important; object-fit:contain!important; }
      .ct-media-swipe-stage { touch-action:pan-y pinch-zoom; }
      .ct-media-photo-zoomed .ct-media-swipe-stage { touch-action:pan-x pan-y pinch-zoom; }
      .ct-media-photo-covered { opacity:0!important; }
      .ct-media-photo-layer { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
      .ct-media-photo-track { display:flex; width:100%; height:100%; will-change:transform; }
      .ct-media-photo-pane { flex:0 0 100%; min-width:0; height:100%; display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-right)) calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left)); }
      .ct-media-photo-pane img { width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain; user-select:none; }
      .ct-media-video-shell { position:relative; }
      .ct-media-video-tools { position:absolute; top:4px; right:4px; z-index:1; display:flex; align-items:center; gap:4px; }
      .ct-media-video-resolution { padding:5px 7px; border-radius:4px; background:#0009; color:#fff; white-space:nowrap; font:12px/1.4 system-ui,sans-serif; }
      .ct-media-video-inline-tools { position:relative; top:auto; right:auto; display:flex; justify-content:flex-end; margin-top:-4px; margin-bottom:4px; }
      .ct-media-video-fullscreen { display:flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:#0009; color:#fff; cursor:pointer; opacity:.8; transition:background 120ms ease-out,opacity 120ms ease-out; }
      .ct-media-video-fullscreen:hover,.ct-media-video-fullscreen:focus-visible { opacity:1; background:#000c; }
      .ct-media-video-fullscreen:focus-visible { outline:3px solid #fff; outline-offset:2px; }
      .ct-media-video-fullscreen:disabled { cursor:wait; }
      .ct-media-video-status { position:absolute; top:48px; right:0; box-sizing:border-box; width:min(270px,calc(100vw - 32px)); padding:8px 10px; border-radius:6px; background:#000e; color:#fff; font:13px/1.5 system-ui,sans-serif; }
      .ct-media-video-tools [hidden] { display:none!important; }
      .ct-media-enhanced-video:fullscreen { width:100%!important; height:100%!important; max-width:none!important; max-height:none!important; margin:0!important; object-fit:contain!important; background:#000; }
      @media(hover:hover) and (pointer:fine) { .ct-media-video-shell:not(:hover):not(:focus-within) .ct-media-video-fullscreen { opacity:.45; } }
      @media(max-width:480px) { .ct-media-video-fullscreen { opacity:1; } }
      @media(prefers-reduced-motion:reduce) { .ct-media-video-fullscreen,.ct-media-centered-viewer,.ct-media-viewer-stage > img { animation:none!important; transition:none!important; } .ct-media-viewer-stage > img { transform:none!important; opacity:1!important; } }
      @media(prefers-reduced-motion:reduce) { .ct-media-photo-track { transition:none!important; } }
    `;
    document.head.append(style);
  }
  function ctMediaEnhance(root = document) {
    ctMediaStyles();
    for (const [dialog, state] of ctMediaPhotoQuality) {
      if (!dialog.isConnected || !state.image.isConnected || !dialog.contains(state.image)) ctMediaReleasePhotoQuality(dialog);
    }
    for (const state of ctMediaVideos.values()) {
      if (!state.video.isConnected) ctMediaRemoveVideo(state);
      else if (state.context && !ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
    }
    for (const state of ctMediaGalleries.values()) {
      if (!state.grid.isConnected || !ctMediaSlides(state.grid).length) ctMediaRemoveGallery(state);
    }
    const inputs = [...root.querySelectorAll?.('input[type="file"][accept="image/*"][multiple]') || []];
    if (root.matches?.('input[type="file"][accept="image/*"][multiple]')) inputs.push(root);
    inputs.forEach(ctMediaLabelUploadControls);
    const grids = [...root.querySelectorAll?.('div.flex.snap-x.snap-mandatory.overflow-x-auto') || []];
    if (root.matches?.('div.flex.snap-x.snap-mandatory.overflow-x-auto')) grids.push(root);
    grids.forEach(ctMediaObserveGallery);
    const videos = [...root.querySelectorAll?.('video[controls]') || []];
    if (root.matches?.('video[controls]')) videos.push(root);
    videos.forEach(ctMediaEnhanceVideo);
    ctMediaCenterViewers();
    ctMediaEnhanceViewer();
  }

    // Public Japanese publisher feeds. Native tweet.app requests are not intercepted.
  // The original news container remains intact and is restored on every failure.
  const ctNewsFeeds = Object.freeze({
    nation: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/domestic.xml' },
      { publisher: 'nhk', url: 'https://news.web.nhk/n-data/conf/na/rss/cat1.xml' }
    ]),
    sports: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/sports.xml' },
      { publisher: 'nikkan', url: 'https://www.nikkansports.com/sports/atom.xml' }
    ]),
    entertainment: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/entertainment.xml' },
      { publisher: 'nikkan', url: 'https://www.nikkansports.com/entertainment/atom.xml' }
    ]),
    technology: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/it.xml' },
      { publisher: 'itmedia', url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml' }
    ])
  });
  const ctNewsPublishers = Object.freeze({ yahoo: 'Yahoo!ニュース', nhk: 'NHK NEWS WEB', nikkan: '日刊スポーツ', itmedia: 'ITmedia NEWS' });
  function ctNewsFeedList(topic) {
    ctNewsEnsureSourcePreferences();
    const selected = ctNewsState.sources[topic] || [];
    return (ctNewsFeeds[topic] || []).filter(feed => selected.includes(feed.publisher));
  }
  const ctNewsLabels = new Map([
    ['News', 'nation'], ['ニュース', 'nation'], ['Sports', 'sports'], ['スポーツ', 'sports'],
    ['Entertainment', 'entertainment'], ['エンタメ', 'entertainment'], ['エンターテインメント', 'entertainment'],
    ['Technology', 'technology'], ['テクノロジー', 'technology']
  ]);
  const ctNewsState = {
    region: null, mounts: new Map(), cache: new Map(), pending: new Map(), retryAt: new Map(),
    ttl: 15 * 60 * 1000, retryDelay: 60 * 1000, timeout: 10000,
    refreshTimer: null, refreshAt: 0, lifecycleBound: false, pageActive: true,
    sources: null, sourceRaw: null, sourceError: '', regionError: '', sourceMessages: new Map(),
    sourceGenerations: new Map(), failures: new Map()
  };
  const ctNewsPreferenceKey = 'ct-news-region-v1';
  const ctNewsCacheKey = 'ct-japanese-news-cache-v1';
  const ctNewsSourcesKey = 'ct-news-sources-v1';

  function ctNewsDefaultSources() {
    return Object.fromEntries(Object.entries(ctNewsFeeds).map(([topic, feeds]) => [topic, feeds.map(feed => feed.publisher)]));
  }
  function ctNewsParseSources(raw) {
    const defaults = ctNewsDefaultSources();
    if (raw === null) return defaults;
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('sources');
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !value.topics || typeof value.topics !== 'object' || Array.isArray(value.topics) ||
        Object.keys(value).some(key => key !== 'version' && key !== 'topics') ||
        Object.keys(value.topics).some(topic => !Object.hasOwn(ctNewsFeeds, topic))) throw new Error('sources');
    for (const [topic, selected] of Object.entries(value.topics)) {
      if (!Array.isArray(selected) || !selected.length || selected.length > ctNewsFeeds[topic].length ||
          new Set(selected).size !== selected.length || selected.some(id => !defaults[topic].includes(id))) throw new Error('sources');
      defaults[topic] = defaults[topic].filter(id => selected.includes(id));
    }
    return defaults;
  }
  function ctNewsEnsureSourcePreferences() {
    if (ctNewsState.sources !== null) return;
    ctNewsState.sources = ctNewsDefaultSources();
    try {
      ctNewsState.sourceRaw = localStorage.getItem(ctNewsSourcesKey);
      ctNewsState.sources = ctNewsParseSources(ctNewsState.sourceRaw);
    } catch {
      ctNewsState.sourceError = CT_LOCALE === 'ja' ? '配信元の設定を読み込めませんでした。既定の配信元を使っています。' :
        'Publisher settings could not be read. Using the default publishers.';
    }
  }
  function ctNewsSourceKey(topic) { return ctNewsFeedList(topic).map(feed => feed.publisher).join('|'); }
  function ctNewsInvalidateSources(topic) {
    ctNewsState.sourceGenerations.set(topic, (ctNewsState.sourceGenerations.get(topic) || 0) + 1);
    ctNewsState.cache.delete(topic); ctNewsState.retryAt.delete(topic); ctNewsState.failures.delete(topic);
    // The old reads still have bounded transport deadlines. Detach their job;
    // its generation guard prevents late completion from replacing this choice.
    ctNewsState.pending.delete(topic);
    for (const mount of ctNewsState.mounts.values()) if (mount.topic === topic) mount.loading = null;
    ctNewsCancelRefresh();
  }
  function ctNewsSetSource(topic, publisher, enabled) {
    ctNewsEnsureSourcePreferences();
    if (!Object.hasOwn(ctNewsFeeds, topic) || !ctNewsFeeds[topic].some(feed => feed.publisher === publisher)) return false;
    const selected = ctNewsState.sources[topic];
    const next = ctNewsFeeds[topic].map(feed => feed.publisher).filter(id => id === publisher ? enabled : selected.includes(id));
    if (!next.length) {
      ctNewsState.sourceMessages.set(topic, CT_LOCALE === 'ja' ? '配信元は最低1つ選択してください。最後の配信元はそのままにしました。' :
        'Select at least one publisher. The last publisher remains selected.');
      return false;
    }
    if (next.join('|') === selected.join('|')) return true;
    try {
      if (localStorage.getItem(ctNewsSourcesKey) !== ctNewsState.sourceRaw) {
        ctNewsState.sourceError = CT_LOCALE === 'ja' ? '別のタブで配信元の設定が変わりました。再読み込みしてから変更してください。' :
          'Publisher settings changed in another tab. Reload before changing them.';
        return false;
      }
      const sources = { ...ctNewsState.sources, [topic]: next };
      const raw = JSON.stringify({ version: 1, topics: sources });
      localStorage.setItem(ctNewsSourcesKey, raw);
      ctNewsState.sources = sources; ctNewsState.sourceRaw = raw;
      ctNewsState.sourceError = ''; ctNewsState.sourceMessages.delete(topic);
      ctNewsInvalidateSources(topic);
      return true;
    } catch {
      ctNewsState.sourceError = CT_LOCALE === 'ja' ? '配信元の設定を保存できませんでした。選択は変更していません。' :
        'Publisher settings could not be saved. Your selection has not changed.';
      return false;
    }
  }
  function ctNewsSourceFailureText(publishers, partial) {
    const names = publishers.map(id => ctNewsPublishers[id]).filter(Boolean).join('・');
    const ja = CT_LOCALE === 'ja';
    const hint = typeof CT_PLATFORM !== 'undefined' && CT_PLATFORM === 'safari' ?
      ja ? ' Safariのページメニュー → Stayで、表示された配信元のサイト許可も確認してください。' :
        ' Also check any publisher site permissions shown in Safari’s page menu → Stay.' : '';
    return (ja ? `取得できない配信元: ${names}。${partial ? '一部取得できませんでした。取得済みのニュースを表示しています。' : '世界のニュースを表示しています。'}` :
      `Unavailable publishers: ${names}. ${partial ? 'Some publishers are unavailable. Showing retrieved news.' : 'Showing world news.'}`) + hint;
  }

  function ctNewsText(value, max = 512) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
  function ctNewsURL(value, kind = 'article') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
      if (kind === 'feed') return Object.values(ctNewsFeeds).flat().some(feed => feed.url === url.href) ? url.href : null;
      if (kind === 'image') {
        // Yahoo's feed images are served by its public image CDN. Never accept
        // arbitrary feed-supplied URLs (localhost, data URLs, credentials, etc.).
        return /^(?:[a-z0-9-]+\.)*yimg\.(?:jp|com)$/.test(url.hostname) ||
          url.hostname === 'www.nikkansports.com' && /^\/[a-z0-9_-]+\/(?:[a-z0-9_-]+\/)?news\/img\/[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? url.href : null;
      }
      return url.hostname === 'news.yahoo.co.jp' && /^\/(?:articles|pickup|expert\/articles)\//.test(url.pathname) ||
        url.hostname === 'news.web.nhk' && /^\/newsweb\/na\/[a-z0-9-]+\/?$/i.test(url.pathname) ||
        url.hostname === 'www.nikkansports.com' && /^\/[a-z0-9_-]+\/(?:[a-z0-9_-]+\/)?news\/\d+\.html$/.test(url.pathname) ||
        url.hostname === 'www.itmedia.co.jp' && /^\/news\/(?:articles|article)\//.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function ctNewsArticle(value, expectedPublisher) {
    if (!value || typeof value !== 'object') return null;
    const title = ctNewsText(value.title);
    const url = ctNewsURL(value.url);
    if (!title || !url) return null;
    const hostname = new URL(url).hostname;
    const publisher = { 'news.yahoo.co.jp': 'yahoo', 'news.web.nhk': 'nhk',
      'www.nikkansports.com': 'nikkan', 'www.itmedia.co.jp': 'itmedia' }[hostname];
    if (expectedPublisher && publisher !== expectedPublisher) return null;
    const image = ctNewsURL(value.image, 'image') || '';
    const samePublisherImage = publisher === 'yahoo' ? image && /\.yimg\.(?:jp|com)$/.test(new URL(image).hostname) :
      publisher === 'nikkan' ? image && new URL(image).hostname === hostname : false;
    const date = Date.parse(value.publishedAt);
    return {
      title, url, image: samePublisherImage ? image : '',
      source: ctNewsPublishers[publisher], publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : ''
    };
  }
  function ctParseJapaneseNews(xml, publisher = 'yahoo') {
    if (typeof xml !== 'string' || !xml || xml.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const root = doc.documentElement;
    const atom = root?.localName === 'feed' && root.namespaceURI === 'http://www.w3.org/2005/Atom';
    const channel = root?.localName === 'rss' && [...root.children].find(el => el.localName === 'channel');
    if (!atom && !channel || !Object.hasOwn(ctNewsPublishers, publisher)) return [];
    const seen = new Set();
    const articles = [];
    const items = [...(atom ? root : channel).children].filter(el => el.localName === (atom ? 'entry' : 'item') &&
      (!atom || el.namespaceURI === root.namespaceURI));
    for (const item of items.slice(0, 50)) {
      const childText = name => [...item.children].find(el => el.localName === name)?.textContent || '';
      const imageElement = [...item.children].find(el => el.localName === 'image');
      const mediaElement = [...item.children].find(el =>
        (el.localName === 'thumbnail' || el.localName === 'content') &&
        el.namespaceURI === 'http://search.yahoo.com/mrss/');
      const enclosure = [...item.children].find(el => el.localName === 'enclosure' && /^image\//.test(el.getAttribute('type') || ''));
      const atomLink = atom ? [...item.children].find(el => el.localName === 'link' &&
        el.namespaceURI === root.namespaceURI && (!el.hasAttribute('rel') || el.getAttribute('rel') === 'alternate')) : null;
      const atomImage = atom ? [...item.children].find(el => el.localName === 'link' &&
        el.namespaceURI === root.namespaceURI && el.getAttribute('rel') === 'enclosure' && /^image\//.test(el.getAttribute('type') || '')) : null;
      const imageValue = imageElement?.querySelector('url')?.textContent || imageElement?.textContent ||
        mediaElement?.getAttribute('url') || enclosure?.getAttribute('url') || atomImage?.getAttribute('href') || '';
      const article = ctNewsArticle({ title: childText('title'), url: atom ? atomLink?.getAttribute('href')?.trim() : childText('link').trim(),
        image: imageValue.trim(), publishedAt: childText(atom ? 'published' : 'pubDate') || (atom ? childText('updated') : '') }, publisher);
      if (!article || seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
      if (articles.length >= 10) break;
    }
    return articles;
  }
  function ctRequestNews(url) {
    const target = ctNewsURL(url, 'feed');
    if (!target) return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false;
      let handle;
      const aborter = typeof AbortController === 'function' ? new AbortController() : null;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        finish(null);
        try { handle?.abort?.(); } catch {}
        try { aborter?.abort(); } catch {}
      }, ctNewsState.timeout);
      const parse = response => {
        try {
          if (!(response?.status >= 200 && response.status < 300)) return null;
          // Stay exposes responseURL in its bridge; Tampermonkey uses finalUrl.
          // Compare canonical feed URLs and reject either field if it disagrees.
          for (const value of [response.finalUrl, response.responseURL]) {
            if (value && ctNewsURL(value, 'feed') !== target) return null;
          }
          let text;
          // An XHR responseText getter can throw for a non-text response. Stay's
          // older text bridge also returns null here while response is a string.
          try { text = response.responseText; } catch {}
          if (typeof text !== 'string') text = response.response;
          return typeof text === 'string' && text.length <= 1024 * 1024 ? text : null;
        } catch { return null; }
      };
      let request = null;
      if (typeof GM_xmlhttpRequest === 'function') request = GM_xmlhttpRequest;
      else {
        // Some managers expose GM as a sandbox binding rather than a property
        // on globalThis. Losing that API falls through to a CORS-blocked fetch.
        const gm = typeof GM !== 'undefined' ? GM : globalThis.GM;
        if (typeof gm?.xmlHttpRequest === 'function') request = gm.xmlHttpRequest.bind(gm);
      }
      if (request) {
        try {
          handle = request({ method: 'GET', url: target, anonymous: true, redirect: 'error', responseType: 'text',
            timeout: ctNewsState.timeout, headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
            onload: response => finish(parse(response)),
            // Stay's public Safari bridge removes its per-request message
            // listener only when an onloadend callback is registered. Accept a
            // final loadend as well, without replacing an earlier completion.
            onloadend: response => finish(parse(response)), onerror: () => finish(null),
            ontimeout: () => finish(null), onabort: () => finish(null) });
          if (handle && typeof handle.then === 'function') Promise.resolve(handle).then(response => {
            // A mobile bridge can resolve its request receipt before onload.
            // Wait for a real response or the bounded callback/timeout instead.
            try {
              const status = Number(response?.status);
              if (Number.isFinite(status) && status > 0 &&
                  (response.readyState == null || Number(response.readyState) === 4)) finish(parse(response));
            } catch { finish(null); }
          }, () => finish(null));
        } catch { finish(null); }
        return;
      }
      if (typeof fetch !== 'function') return finish(null);
      Promise.resolve().then(() => fetch(target, { method: 'GET', credentials: 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', ...(aborter ? { signal: aborter.signal } : {}) }))
        .then(async response => {
          if (!response?.ok || (response.url && ctNewsURL(response.url, 'feed') !== target)) return null;
          const value = await response.text();
          return value.length <= 1024 * 1024 ? value : null;
        }).then(finish, () => finish(null));
    });
  }
  function ctNewsReadCache() {
    try {
      const stored = sessionStorage.getItem(ctNewsCacheKey);
      if (!stored || stored.length > 128 * 1024) return;
      const cache = JSON.parse(stored);
      for (const topic of Object.keys(ctNewsFeeds)) {
        const entry = cache?.[topic];
        const feeds = ctNewsFeedList(topic), sourceKey = ctNewsSourceKey(topic);
        const defaultSelection = ctNewsState.sources[topic].length === ctNewsFeeds[topic].length;
        if (!entry || entry.loading || entry.feedCount !== ctNewsFeedList(topic).length || !Number.isFinite(entry.at) || entry.at > Date.now() ||
            Date.now() - entry.at >= ctNewsState.ttl || !Array.isArray(entry.articles) ||
            (entry.sourceKey !== sourceKey && (entry.sourceKey !== undefined || !defaultSelection))) continue;
        const articles = entry.articles.slice(0, 10).map(article => ctNewsArticle(article)).filter(article =>
          article && feeds.some(feed => article.source === ctNewsPublishers[feed.publisher]));
        const failed = Array.isArray(entry.failed) ? entry.failed.filter(id => feeds.some(feed => feed.publisher === id)) : [];
        if (articles.length) ctNewsState.cache.set(topic, { at: entry.at, articles, failed, sourceKey, feedCount: entry.feedCount, loading: false });
      }
    } catch {}
  }
  async function ctLoadJapaneseNews(topic) {
    if (!Object.hasOwn(ctNewsFeeds, topic)) return null;
    const sourceKey = ctNewsSourceKey(topic);
    const cached = ctNewsState.cache.get(topic);
    if (cached?.sourceKey === sourceKey && Date.now() >= cached.at && Date.now() - cached.at < ctNewsState.ttl) return cached.articles;
    if (ctNewsState.pending.has(topic)) return ctNewsState.pending.get(topic);
    if ((ctNewsState.retryAt.get(topic) || 0) > Date.now()) return null;
    const generation = ctNewsState.sourceGenerations.get(topic) || 0;
    const current = () => generation === (ctNewsState.sourceGenerations.get(topic) || 0) && sourceKey === ctNewsSourceKey(topic);
    const pending = (async () => {
      const feeds = ctNewsFeedList(topic);
      const batches = feeds.map(() => []);
      ctNewsState.failures.delete(topic);
      // Start each publisher together. A slow or failed Yahoo request must not
      // hold the other publisher's usable headlines behind its timeout.
      await Promise.all(feeds.map(async (feed, index) => {
        try {
          const xml = await ctRequestNews(feed.url);
          if (!current()) return;
          batches[index] = ctParseJapaneseNews(xml, feed.publisher);
        } catch { batches[index] = []; }
        if (!current() || !batches[index].length) return;
        const articles = ctNewsMergeArticles(batches);
        ctNewsState.cache.set(topic, { at: Date.now(), articles, loading: true, failed: [], sourceKey, feedCount: feeds.length });
        patchJapaneseNews();
      }));
      if (!current()) return null;
      const entry = ctNewsState.cache.get(topic);
      if (!batches.some(batch => batch.length)) {
        ctNewsState.failures.set(topic, { sourceKey, publishers: feeds.map(feed => feed.publisher) });
        ctNewsState.retryAt.set(topic, Date.now() + ctNewsState.retryDelay);
        return null;
      }
      ctNewsState.retryAt.delete(topic);
      entry.loading = false;
      entry.failed = feeds.filter((feed, index) => !batches[index].length).map(feed => feed.publisher);
      try { sessionStorage.setItem(ctNewsCacheKey, JSON.stringify(Object.fromEntries([...ctNewsState.cache].filter(([key, cached]) =>
        !cached.loading && cached.sourceKey === ctNewsSourceKey(key))))); } catch {}
      return entry.articles;
    })().finally(() => { if (ctNewsState.pending.get(topic) === pending) ctNewsState.pending.delete(topic); });
    ctNewsState.pending.set(topic, pending);
    return pending;
  }
  function ctNewsMergeArticles(batches) {
    const seen = new Set(), articles = [];
    // Give each successful publisher room, even when another has more items.
    for (let index = 0; index < 10 && articles.length < 10; index++) {
      for (const batch of batches) {
        const article = batch[index];
        if (!article || seen.has(article.url)) continue;
        seen.add(article.url); articles.push(article);
        if (articles.length === 10) break;
      }
    }
    return articles.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  }
  function ctNewsVisible(element) {
    return element?.isConnected && !element.closest('[hidden],[aria-hidden="true"]');
  }
  function ctNewsTargets() {
    if (!/^\/feed\/?$/.test(location.pathname)) return [];
    const targets = [];
    for (const header of document.querySelectorAll('main > div.w-full.min-w-0.flex.flex-col > div.sticky')) {
      if (!ctNewsVisible(header)) continue;
      const tabs = header.querySelector('div.overflow-x-auto');
      if (!tabs) continue;
      const buttons = [...tabs.children].filter(el => el.matches('button.rounded-full.whitespace-nowrap'));
      const topics = new Set(buttons.map(el => ctNewsLabels.get(ctNewsText(el.textContent))).filter(Boolean));
      if (topics.size !== 4) continue;
      const active = buttons.find(el => el.classList.contains('bg-sky-500') && el.classList.contains('text-white'));
      const topic = ctNewsLabels.get(ctNewsText(active?.textContent));
      if (!topic) continue;
      const container = header.parentElement.lastElementChild;
      // Verified native Whe layout: the final direct div is the news/feed body.
      // Never hide a composer, header, or a subtree containing another control.
      if (!container || container === header || container.tagName !== 'DIV' || container.hasAttribute('data-ct-local-ui') ||
          container.querySelector('textarea,input,article,[contenteditable="true"]')) continue;
      targets.push({ header, container, topic });
    }
    return targets;
  }
  function ctNewsCancelRefresh() {
    clearTimeout(ctNewsState.refreshTimer);
    ctNewsState.refreshTimer = null;
    ctNewsState.refreshAt = 0;
  }
  function ctNewsScheduleRefresh() {
    // A static news page produces no mutation to trigger the normal scan. Keep
    // one deadline for its visible topic; never poll the whole application.
    if (!ctNewsState.pageActive || document.hidden || ctNewsState.region !== 'jp') {
      ctNewsCancelRefresh(); return;
    }
    const now = Date.now();
    let deadline = Infinity;
    for (const target of ctNewsTargets()) {
      if (!ctNewsState.mounts.has(target.container) || ctNewsState.pending.has(target.topic)) continue;
      const cached = ctNewsState.cache.get(target.topic);
      const expires = cached && now >= cached.at && now - cached.at < ctNewsState.ttl
        ? cached.at + ctNewsState.ttl : ctNewsState.retryAt.get(target.topic);
      if (expires > now) deadline = Math.min(deadline, expires);
    }
    if (!Number.isFinite(deadline)) { ctNewsCancelRefresh(); return; }
    if (ctNewsState.refreshTimer !== null && ctNewsState.refreshAt === deadline) return;
    ctNewsCancelRefresh();
    ctNewsState.refreshAt = deadline;
    ctNewsState.refreshTimer = setTimeout(() => {
      ctNewsState.refreshTimer = null;
      ctNewsState.refreshAt = 0;
      // Recheck the native tab/route before requesting or hiding any content.
      patchJapaneseNews();
    }, deadline - now);
  }
  function ctNewsBindLifecycle() {
    if (ctNewsState.lifecycleBound) return;
    ctNewsState.lifecycleBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctNewsCancelRefresh();
      else if (ctNewsState.pageActive) patchJapaneseNews();
    });
    window.addEventListener('pagehide', () => {
      ctNewsState.pageActive = false;
      ctNewsCancelRefresh();
    });
    window.addEventListener('pageshow', () => {
      ctNewsState.pageActive = true;
      patchJapaneseNews();
    });
    window.addEventListener('storage', event => {
      if (event.key !== ctNewsSourcesKey && event.key !== null) return;
      ctNewsEnsureSourcePreferences();
      try {
        const raw = localStorage.getItem(ctNewsSourcesKey);
        if (raw === ctNewsState.sourceRaw) return;
        const sources = ctNewsParseSources(raw);
        for (const topic of Object.keys(ctNewsFeeds)) {
          if (sources[topic].join('|') !== ctNewsState.sources[topic].join('|')) ctNewsInvalidateSources(topic);
        }
        ctNewsState.sources = sources; ctNewsState.sourceRaw = raw; ctNewsState.sourceError = '';
        ctNewsState.sourceMessages.clear();
      } catch {
        ctNewsState.sourceError = CT_LOCALE === 'ja' ? '別のタブの配信元の設定を読み込めませんでした。現在の選択を保持しています。' :
          'Publisher settings from another tab could not be read. Keeping your current selection.';
      }
      patchJapaneseNews();
    });
  }
  function ctNewsSetText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function ctNewsUnhide(mount) {
    if (mount.container.classList.contains('ct-news-native-hidden')) mount.container.classList.remove('ct-news-native-hidden');
  }
  function ctNewsRefreshSources(mount) {
    const ja = CT_LOCALE === 'ja';
    const japan = ctNewsState.region === 'jp';
    if (mount.sources.hidden === japan) mount.sources.hidden = !japan;
    if (mount.sourceTopic !== mount.topic) {
      const topics = ja ? { nation: '国内ニュース', sports: 'スポーツ', entertainment: 'エンタメ', technology: 'IT' } :
        { nation: 'National news', sports: 'Sports', entertainment: 'Entertainment', technology: 'Technology' };
      const legend = document.createElement('legend');
      legend.textContent = ja ? `${topics[mount.topic]}の配信元` : `Publishers for ${topics[mount.topic]}`;
      const help = document.createElement('p'); help.className = 'ct-news-source-help';
      help.textContent = ja ? 'このジャンルのRSSから取得します。最低1つ選択してください。' :
        'Uses each publisher’s feed for this topic. Select at least one.';
      const children = [legend, help];
      for (const feed of ctNewsFeeds[mount.topic]) {
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox';
        input.dataset.ctNewsPublisher = feed.publisher;
        const topic = mount.topic;
        input.addEventListener('change', () => {
          // A detached selector must not change another native topic's setting.
          const current = ctNewsTargets().find(target => target.container === mount.container && target.topic === topic);
          if (current && ctNewsState.mounts.get(mount.container) === mount && ctNewsState.region === 'jp' &&
              ctNewsState.pageActive && !document.hidden) ctNewsSetSource(topic, feed.publisher, input.checked);
          patchJapaneseNews();
        });
        label.append(input, document.createTextNode(ctNewsPublishers[feed.publisher]));
        children.push(label);
      }
      mount.sourceFields.replaceChildren(...children);
      mount.sourceTopic = mount.topic;
    }
    for (const input of mount.sourceFields.querySelectorAll('input[data-ct-news-publisher]')) {
      const checked = ctNewsState.sources[mount.topic].includes(input.dataset.ctNewsPublisher);
      if (input.checked !== checked) input.checked = checked;
    }
    ctNewsSetText(mount.notice, [ctNewsState.regionError, ctNewsState.sourceError, ctNewsState.sourceMessages.get(mount.topic)].filter(Boolean).join(' '));
  }
  function ctNewsMakeMount(target) {
    const ja = CT_LOCALE === 'ja';
    const panel = document.createElement('section');
    panel.className = 'ct-japanese-news';
    panel.dataset.ctLocalUi = 'japanese-news';
    panel.setAttribute('aria-label', ja ? 'ニュースの地域' : 'News region');
    const controls = document.createElement('div');
    controls.className = 'ct-news-controls';
    const japan = document.createElement('button');
    japan.type = 'button'; japan.textContent = ja ? '日本' : 'Japan';
    japan.dataset.ctNewsRegion = 'jp';
    const world = document.createElement('button');
    world.type = 'button'; world.textContent = ja ? '世界' : 'World';
    world.dataset.ctNewsRegion = 'world';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = ja ? '再試行' : 'Retry';
    retry.dataset.ctNewsAction = 'retry'; retry.hidden = true;
    controls.append(japan, world, retry);
    const notice = document.createElement('p'); notice.className = 'ct-news-preference-status';
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    const sources = document.createElement('details'); sources.className = 'ct-news-sources';
    const summary = document.createElement('summary'); summary.textContent = ja ? '配信元' : 'Publishers';
    const sourceFields = document.createElement('fieldset'); sources.append(summary, sourceFields);
    const status = document.createElement('p');
    status.className = 'ct-news-status';
    status.setAttribute('role', 'status');
    const list = document.createElement('div');
    list.className = 'ct-news-list';
    panel.append(controls, notice, sources, status, list);
    target.container.before(panel);
    const mount = { ...target, panel, status, list, japan, world, retry, notice, sources, sourceFields,
      sourceTopic: null, rendered: null, loading: null };
    for (const button of [japan, world]) button.addEventListener('click', () => {
      try {
        localStorage.setItem(ctNewsPreferenceKey, button.dataset.ctNewsRegion);
        ctNewsState.region = button.dataset.ctNewsRegion; ctNewsState.regionError = '';
      } catch {
        ctNewsState.regionError = ja ? 'ニュースの地域を保存できませんでした。選択は変更していません。' :
          'News region could not be saved. Your selection has not changed.';
      }
      patchJapaneseNews();
    });
    retry.addEventListener('click', () => {
      if (!ctNewsState.pageActive || document.hidden || ctNewsState.region !== 'jp' ||
          ctNewsState.mounts.get(mount.container) !== mount || !mount.panel.isConnected) return;
      const current = ctNewsTargets().find(target => target.container === mount.container && target.topic === mount.topic);
      if (!current || ctNewsState.pending.has(current.topic)) return;
      // Explicit retry may bypass the failure delay, never a pending request.
      ctNewsState.retryAt.delete(current.topic);
      ctNewsState.cache.delete(current.topic);
      ctNewsState.failures.delete(current.topic);
      patchJapaneseNews();
    });
    return mount;
  }
  function ctNewsRenderArticles(mount, articles) {
    if (mount.rendered === articles) return;
    mount.rendered = articles;
    const fragment = document.createDocumentFragment();
    for (const article of articles) {
      const link = document.createElement('a');
      link.className = 'ct-news-article'; link.href = article.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (article.image) {
        const img = document.createElement('img');
        img.src = article.image; img.alt = ''; img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        // No made-up picture when a source thumbnail disappears.
        img.addEventListener('error', () => { img.hidden = true; });
        link.append(img);
      }
      const title = document.createElement('h3'); title.textContent = article.title;
      const source = document.createElement('p');
      source.className = 'ct-news-source'; source.textContent = article.source;
      if (article.publishedAt) {
        const time = document.createElement('time');
        time.dateTime = article.publishedAt;
        time.textContent = new Date(article.publishedAt).toLocaleString(CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        source.append(document.createTextNode(' · '), time);
      }
      link.append(title, source); fragment.append(link);
    }
    mount.list.replaceChildren(fragment);
  }
  function ctNewsRefreshMount(mount) {
    const ja = CT_LOCALE === 'ja';
    const japan = ctNewsState.region === 'jp';
    ctNewsRefreshSources(mount);
    for (const button of [mount.japan, mount.world]) {
      const selected = button.dataset.ctNewsRegion === ctNewsState.region;
      const value = String(selected);
      if (button.getAttribute('aria-pressed') !== value) button.setAttribute('aria-pressed', value);
    }
    if (!japan) {
      if (!mount.retry.hidden) mount.retry.hidden = true;
      ctNewsUnhide(mount);
      if (!mount.list.hidden) mount.list.hidden = true;
      ctNewsSetText(mount.status, '');
      return;
    }
    const cached = ctNewsState.cache.get(mount.topic);
    if (cached?.sourceKey === ctNewsSourceKey(mount.topic) && Date.now() >= cached.at && Date.now() - cached.at < ctNewsState.ttl) {
      const partial = !cached.loading && cached.failed?.length > 0;
      if (mount.retry.hidden === partial) mount.retry.hidden = !partial;
      ctNewsRenderArticles(mount, cached.articles);
      if (mount.list.hidden) mount.list.hidden = false;
      if (!mount.container.classList.contains('ct-news-native-hidden')) mount.container.classList.add('ct-news-native-hidden');
      const sources = [...new Set(cached.articles.map(article => article.source))].join('・');
      const suffix = cached.loading ? ja ? ' · 他の配信元を読み込み中…' : ' · Loading another publisher…' :
        partial ? ' · ' + ctNewsSourceFailureText(cached.failed, true) :
        ja ? ' · 見出しを押すと記事が開きます' : ' · Open a headline to read the article';
      ctNewsSetText(mount.status, sources + suffix);
      return;
    }
    // Already-started requests may finish in the background. Their completion
    // must not start another request until the page is visible again.
    if (!ctNewsState.pageActive || document.hidden) return;
    ctNewsUnhide(mount);
    if (!mount.list.hidden) mount.list.hidden = true;
    if ((ctNewsState.retryAt.get(mount.topic) || 0) > Date.now()) {
      if (mount.retry.hidden) mount.retry.hidden = false;
      const failure = ctNewsState.failures.get(mount.topic);
      const failed = failure?.sourceKey === ctNewsSourceKey(mount.topic) ? failure.publishers : ctNewsFeedList(mount.topic).map(feed => feed.publisher);
      ctNewsSetText(mount.status, ctNewsSourceFailureText(failed, false));
      return;
    }
    if (!mount.retry.hidden) mount.retry.hidden = true;
    ctNewsSetText(mount.status, ja ? '日本のニュースを読み込み中…' : 'Loading Japanese news…');
    const topic = mount.topic;
    const loading = `${topic}:${ctNewsState.sourceGenerations.get(topic) || 0}:${ctNewsSourceKey(topic)}`;
    if (mount.loading === loading) return;
    mount.loading = loading;
    ctLoadJapaneseNews(topic).finally(() => {
      if (mount.loading === loading) mount.loading = null;
      if (mount.panel.isConnected && ctNewsState.mounts.get(mount.container) === mount) patchJapaneseNews();
    });
  }
  function patchJapaneseNews() {
    ctNewsBindLifecycle();
    ctNewsEnsureSourcePreferences();
    if (ctNewsState.region === null) {
      let value;
      try { value = localStorage.getItem(ctNewsPreferenceKey); } catch {}
      ctNewsState.region = value === 'jp' || value === 'world' ? value : CT_LOCALE === 'ja' ? 'jp' : 'world';
      ctNewsReadCache();
    }
    const targets = ctNewsTargets();
    const containers = new Set(targets.map(target => target.container));
    for (const [container, mount] of ctNewsState.mounts) {
      if (!containers.has(container) || !mount.panel.isConnected) {
        ctNewsUnhide(mount); mount.panel.remove(); ctNewsState.mounts.delete(container);
      }
    }
    if (!targets.length) { ctNewsCancelRefresh(); return; }
    if (!document.getElementById('ct-japanese-news-style')) {
      const style = document.createElement('style'); style.id = 'ct-japanese-news-style';
      style.textContent = `.ct-news-native-hidden{display:none!important}.ct-news-controls{display:flex;gap:8px;padding:12px 16px 4px}.ct-news-controls button{min-height:44px;border:1px solid var(--color-tl-app-border,#ccd6dd);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:5px 14px;cursor:pointer}.ct-news-controls button[aria-pressed="true"]{background:#1d9bf0;border-color:#1d9bf0;color:#fff}.ct-news-controls button:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}.ct-news-status{margin:0;padding:4px 16px 10px;font-size:12px;line-height:1.5;color:inherit;opacity:.72}.ct-news-status:empty,.ct-news-preference-status:empty{display:none}.ct-news-preference-status{margin:0;padding:4px 16px;font-size:12px;line-height:1.5;color:var(--color-tl-app-danger,#c23636)}.ct-news-sources{padding:0 16px;font-size:13px}.ct-news-sources[hidden]{display:none}.ct-news-sources summary{display:flex;align-items:center;gap:6px;min-height:44px;cursor:pointer;width:fit-content;color:var(--color-tl-app-text-muted,#536471)}.ct-news-sources summary:before{content:"›";font-size:18px;line-height:1}.ct-news-sources[open] summary:before{transform:rotate(90deg)}.ct-news-sources summary:focus-visible,.ct-news-sources input:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}.ct-news-sources fieldset{margin:0;padding:0 0 8px;border:0;min-width:0}.ct-news-sources legend{font-weight:700}.ct-news-source-help{margin:4px 0;line-height:1.5;color:var(--color-tl-app-text-muted,#536471)}.ct-news-sources label{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer;overflow-wrap:anywhere}.ct-news-sources input{width:18px;height:18px;accent-color:#1d9bf0;margin:0;flex-shrink:0}.ct-news-article{display:block;padding:12px 16px;border-bottom:1px solid var(--color-tl-app-border,#ccd6dd);color:inherit;text-decoration:none}.ct-news-article:hover{background:rgba(127,127,127,.06)}.ct-news-article img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;border:1px solid var(--color-tl-app-border,#ccd6dd)}.ct-news-article img[hidden]{display:none}.ct-news-article h3{font-size:17px;line-height:1.4;font-weight:700;margin:12px 0 6px}.ct-news-source{margin:0;font-size:13px;line-height:1.5;opacity:.7}.ct-news-list[hidden]{display:none}`;
      (document.head || document.documentElement).append(style);
    }
    for (const target of targets) {
      let mount = ctNewsState.mounts.get(target.container);
      if (!mount) {
        mount = ctNewsMakeMount(target);
        ctNewsState.mounts.set(target.container, mount);
      }
      mount.topic = target.topic;
      ctNewsRefreshMount(mount);
    }
    ctNewsScheduleRefresh();
  }



  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    favorites: 'classicTwitterEN.favorites',
    autoTranslate: 'classicTwitterEN.autoTranslate'
  };

  const profileCache = new Map();
  const profilePending = new Map();

  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const normUser = v => clean(v).replace(/^@/, '').toLowerCase();
  const validUser = v => {
    const s = clean(v).replace(/^@/, '');
    return /^[A-Za-z0-9_.-]{1,80}$/.test(s) ? s : null;
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const EN = new Map([
    ['Feed', 'Home'],
    ['Nothing to see here yet. Likes, reposts, replies, quotes, mentions, and follows will show up here.', 'Nothing to see here yet. Favorites, Retweets, replies, quotes, mentions, and follows will show up here.'],
    ['quoted your post', 'quoted your Tweet'],
    ['quoted your tweet', 'quoted your Tweet'],
    ['Posts', 'Tweets'],
    ['No posts yet.', 'No Tweets yet.'],
    ['No reposts yet.', 'No Retweets yet.'],
    ['No posts yet. Share your first thought with the community.', 'No Tweets yet. Share your first thought with the community.'],
    ['Nothing to see here yet. Likes, reposts, and follows will show up here.', 'Nothing to see here yet. Favorites, Retweets, and follows will show up here.'],
    ['Post', 'Tweet'],
    ['Reposts', 'Retweets'],
    ['Repost', 'Retweet'],
    ['Quote', 'Quote Tweet'],
    ['Undo repost', 'Undo Retweet'],
    ['Like', 'Favorite'],
    ['Likes', 'Favorites'],
    ['Liked', 'Favorited'],
    ['Liked by', 'Favorited by'],
    ['Unlike', 'Unfavorite'],
    ['Report post', 'Report Tweet'],
    ['Delete post', 'Delete Tweet'],
    ['Repost removed', 'Retweet removed'],
    ['Repost added', 'Retweeted'],
    ['Post reposted', 'Retweeted'],
    ['Post liked', 'Favorited'],
    ['Like removed', 'Favorite removed'],
    ['Post deleted', 'Tweet deleted'],
    ['Post posted', 'Tweet sent'],
    ['mentioned you in a post', 'mentioned you in a Tweet'],
    ['mentioned you in a tweet', 'mentioned you in a Tweet'],
    ['replied to your post', 'replied to your Tweet'],
    ['replied to your tweet', 'replied to your Tweet'],
    ['liked your post', 'favorited your Tweet'],
    ['liked your tweet', 'favorited your Tweet'],
    ['favorited your post', 'favorited your Tweet'],
    ['reposted your post', 'retweeted your Tweet'],
    ['reposted your tweet', 'retweeted your Tweet'],
    ['retweeted your post', 'retweeted your Tweet']
  ]);

  // Keep the same React nodes and remember only values written by this script.
  // A later native render takes ownership again when it changes the value.
  function ctLocalizationClassicEnabled() {
    return typeof ctFavoritePresentationEnabled === 'function' ? ctFavoritePresentationEnabled() :
      typeof classicAppearanceEnabled === 'function' ? classicAppearanceEnabled() : true;
  }

  function ctLocalizationState() {
    return ctLocalizationState.value ||= { byNode: new WeakMap(), records: new Set() };
  }

  function ctLocalizationNativeRecordException(record) {
    const el = record.attribute ? record.node : record.node.parentElement;
    if (nativeLocalizationAccountMenu(el) || isNativeSettingsNavigation(el)) return true;
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications', '/profile': 'Feed' }[location.pathname.replace(/\/$/, '')];
    if (record.attribute || !routeTitle || clean(record.original) !== routeTitle ||
        !el?.matches('h2.truncate') || el.closest('article')) return false;
    const visibleHeading = [...document.querySelectorAll('main h2')].find(heading => {
      for (let parent = heading; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.style.display === 'none') return false;
      }
      return !heading.closest('article');
    });
    return el === visibleHeading;
  }

  function ctLocalizationRecordAllowed(record) {
    const el = record.attribute ? record.node : record.node.parentElement;
    return !!el && !el.closest('[id^="ct-"],[data-ct-owned],[data-ct-local-ui],[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],[contenteditable]:not([contenteditable="false"]),.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]') &&
      (!el.closest('.truncate') || ctLocalizationNativeRecordException(record)) &&
      !(record.attribute === null && el.closest('textarea,input,select,option'));
  }

  function ctLocalizationRead(record) {
    return record.attribute ? record.node.getAttribute(record.attribute) : record.node.nodeValue;
  }

  function ctLocalizationWrite(record, value) {
    if (ctLocalizationRead(record) !== value) {
      if (record.attribute) record.node.setAttribute(record.attribute, value);
      else record.node.nodeValue = value;
    }
    record.written = value;
  }

  function ctLocalizationForget(record) {
    const state = ctLocalizationState();
    state.records.delete(record);
    state.byNode.get(record.node)?.delete(record.attribute);
  }

  function ctRememberLocalization(node, attribute, classic, regular) {
    const state = ctLocalizationState();
    const current = attribute ? node.getAttribute(attribute) : node.nodeValue;
    let entries = state.byNode.get(node);
    let record = entries?.get(attribute);
    if (record && current !== record.written) {
      ctLocalizationForget(record);
      record = null;
    }
    regular ??= record?.original ?? current;
    if (classic === regular) {
      if (record) ctLocalizationForget(record);
      if (current !== classic) {
        if (attribute) node.setAttribute(attribute, classic);
        else node.nodeValue = classic;
      }
      return;
    }
    if (!record) {
      record = { node, attribute, original: current, classic, regular, written: current };
      if (!entries) state.byNode.set(node, entries = new Map());
      entries.set(attribute, record);
      state.records.add(record);
    } else {
      record.classic = classic;
      record.regular = regular;
    }
    ctLocalizationWrite(record, ctLocalizationClassicEnabled() ? record.classic : record.regular);
  }

  function ctSyncLocalizationAppearance(root = document) {
    const enabled = ctLocalizationClassicEnabled();
    for (const record of ctLocalizationState().records) {
      if (!record.node.isConnected || !ctLocalizationRecordAllowed(record) ||
          ctLocalizationRead(record) !== record.written) {
        ctLocalizationForget(record);
        continue;
      }
      if (root !== document && root !== record.node && !root.contains?.(record.node)) continue;
      ctLocalizationWrite(record, enabled ? record.classic : record.regular);
    }
    if (!enabled) {
      if (root instanceof Element && root.classList.contains('ct-notification-fav-icon')) root.classList.remove('ct-notification-fav-icon');
      root.querySelectorAll?.('.ct-notification-fav-icon').forEach(el => el.classList.remove('ct-notification-fav-icon'));
    }
  }

  function installStyle() {
    if (document.getElementById('ct-en-style')) return;

    const style = document.createElement('style');
    style.id = 'ct-en-style';
    style.textContent = `
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-favorite-button > svg { display:none!important; }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"] > .ct-star {
        display:inline-flex; width:20px; height:20px; align-items:center; justify-content:center;
        transform-origin:center; pointer-events:none;
      }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"] > .ct-star svg {
        display:block!important; width:20px; height:20px; fill:none; stroke:currentColor;
        stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;
      }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-is-liked { color:#ffac33!important; }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-is-liked > .ct-star svg { fill:currentColor; }
      @media (hover:hover) {
        html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-favorite-button:hover {
          color:#ffac33!important; background:rgba(255,172,51,.12)!important;
        }
      }

      .ct-founder,
      .ct-profile-founder {
        display:inline-flex;
        align-items:center;
        margin-left:4px;
        font-size:12px;
        line-height:18px;
        font-weight:700;
        white-space:nowrap;
        opacity:.72;
      }

      .ct-profile-founder {
        font-size:13px;
        opacity:.78;
      }

.ct-twitter-logo {
        width:28px!important;
        height:28px!important;
        object-fit:contain!important;
        display:block!important;
      }
      .ct-detail-post-time {
        font-size:13px;
        opacity:.68;
        font-weight:400;
        padding:10px 0 8px;
        margin:0 0 2px;
        border-bottom:1px solid rgba(127,127,127,.20);
        white-space:nowrap;
      }
      #ct-favorites-tab {
        position:relative;
        z-index:3;
        flex:1 1 0!important;
        min-width:0!important;
        border:0;
        border-bottom:2px solid transparent!important;
        background:transparent;
        color:inherit;
        font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;
        cursor:pointer;
        padding:0 10px;
      }
      #ct-favorites-tab:hover { background:rgba(127,127,127,.08); }
      #ct-favorites-tab[data-active="1"] {
        color:#1d9bf0;
        border-bottom-color:#1d9bf0!important;
      }
      #ct-favorites-panel {
        position:fixed;
        z-index:2147482000;
        overflow:auto;
        overscroll-behavior:contain;
        background:inherit;
        color:inherit;
        border:1px solid rgba(127,127,127,.28);
        box-shadow:0 10px 35px rgba(0,0,0,.25);
      }
      #ct-favorites-panel { border-radius:0 0 12px 12px; }
      .ct-local-head {
        position:sticky;
        top:0;
        z-index:2;
        display:flex;
        justify-content:space-between;
        gap:12px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        background:inherit;
        color:inherit;
      }
      .ct-local-title { font-weight:800; }
      .ct-local-note { font-size:11px; opacity:.6; margin-top:2px; }
      .ct-local-close {
        border:0;
        background:transparent;
        color:inherit;
        cursor:pointer;
        font-size:20px;
        padding:3px 8px;
        border-radius:999px;
      }
      .ct-local-close:hover { background:rgba(127,127,127,.14); }
      .ct-local-card {
        display:flex;
        gap:10px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        cursor:pointer;
      }
      .ct-local-card:hover { background:rgba(127,127,127,.08); }
      .ct-local-avatar {
        width:40px;
        height:40px;
        border-radius:999px;
        object-fit:cover;
        flex:0 0 auto;
        background:rgba(127,127,127,.25);
      }
      .ct-local-main { min-width:0; flex:1; }
      .ct-local-meta {
        display:flex;
        gap:4px;
        flex-wrap:wrap;
        align-items:center;
        font-size:13px;
        line-height:18px;
      }
      .ct-local-name { font-weight:800; }
      .ct-local-handle,
      .ct-local-time { opacity:.62; }
      .ct-local-text {
        margin-top:3px;
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        font-size:14px;
        line-height:20px;
      }
      .ct-local-empty { padding:28px 18px; text-align:center; opacity:.65; }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function classicNotificationText(t) {
    t = clean(t);
    if (!t) return null;

    let m;

    const replacements = [
      [/^(.+?)\s+(?:liked|favorited) your (?:post|tweet)$/i,
        a => `${a} favorited your Tweet`],
      [/^(.+?)\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        a => `${a} retweeted your Tweet`],
      [/^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i,
        a => `${a} mentioned you`],
      [/^(.+?)\s+replied to your (?:post|tweet)$/i,
        a => `${a} replied to your Tweet`],
      [/^(.+?)\s+(?:liked|favorited) your reply$/i,
        a => `${a} favorited your reply`],
      [/^(.+?)\s+(?:reposted|retweeted) your reply$/i,
        a => `${a} retweeted your reply`]
    ];

    for (const [re, fn] of replacements) {
      if ((m = t.match(re))) return fn(m[1]);
    }

    return null;
  }

  // Only localize application chrome. Text matching alone cannot distinguish a
  // label from a person's name, a post, a notification preview, or a translation.
  function localizationScopeNodes(root = document) {
    const host = root instanceof Node ? root : document;
    if (host.nodeType === Node.TEXT_NODE) return [host];
    const nodes = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function isOwnedLocalizationElement(el) {
    if (el?.closest('[id^="ct-"],[data-ct-owned],[data-ct-local-ui]')) return true;
    // Classic markers decorate native UI; they do not transfer its text ownership.
    // Keep every other extension-owned class protected, including local panels.
    for (let node = el; node; node = node.parentElement) {
      if ([...node.classList].some(name => name.startsWith('ct-') && !name.startsWith('ct-classic-'))) return true;
    }
    return false;
  }

  function isNativeSettingsNavigation(el) {
    if (!/^\/settings\/?$/.test(location.pathname) || !el?.matches('span.truncate')) return false;
    const button = el.closest('nav button');
    return !!button?.closest('main') && !!button.querySelector('svg') &&
      !button.querySelector('img,a,[data-user-content]') &&
      !/@[A-Za-z0-9_.-]/.test(clean(button.textContent)) &&
      !button.getAttribute('aria-label')?.startsWith('View @');
  }

  function isNativeLocalizationTimestamp(el) {
    if (!el?.matches('span[title]') || !el.closest('article') ||
        el.closest('button,a,[role="button"]') ||
        !el.classList.contains('text-tl-app-text-muted') || !el.classList.contains('hover:underline')) return false;
    return !!ctTimestampParse(el.getAttribute('title'));
  }

  // Tweet v2.1.0 keeps user-written poll choices in tl-user-text. Recognize
  // only the surrounding native poll chrome; never treat a whole fieldset as UI.
  function nativeLocalizationPoll(el) {
    if (!el || isOwnedLocalizationElement(el)) return null;
    const compose = el.closest('fieldset.relative.w-full.mt-3.rounded-2xl.border');
    if (compose && /^(?:Poll|投票)$/.test(clean(compose.querySelector(':scope > legend')?.textContent)) &&
        compose.querySelector('input[type="text"][maxlength="25"][id*="-choice-"]') &&
        [...compose.querySelectorAll('select option')].map(option => option.value).join(',') === '1,24,72,168') {
      return { root: compose, compose: true };
    }
    if (!el.closest('article')) return null;
    for (let candidate = el; candidate && candidate.tagName !== 'ARTICLE'; candidate = candidate.parentElement) {
      if (!candidate.matches('div.mt-3')) continue;
      const choices = candidate.querySelector(':scope > fieldset.flex.flex-col');
      const results = candidate.querySelector(':scope > div > ul[aria-label="Poll results"],:scope > div > ul[aria-label="投票結果"]');
      const labels = choices && [...choices.querySelectorAll(':scope > label')];
      if (choices && /^(?:Poll choices|投票の選択肢)$/.test(clean(choices.querySelector(':scope > legend')?.textContent)) &&
          labels.length >= 2 && labels.length <= 5 && labels.every(label =>
            label.querySelector(':scope > input[type="radio"]') && label.querySelector(':scope > span.tl-user-text'))) {
        return { root: candidate, compose: false };
      }
      if (results && results.children.length >= 2 && results.children.length <= 5 &&
          [...results.children].every(row => row.matches('li.relative.overflow-hidden') && row.querySelector('span.tl-user-text'))) {
        return { root: candidate, compose: false };
      }
    }
    return null;
  }

  function isNativeLocalizationPollUI(el) {
    const poll = nativeLocalizationPoll(el);
    if (!poll) return false;
    if (poll.compose) return el.matches('legend,label,button,button span,p[role="status"]');
    return el.matches('legend.sr-only,span.sr-only,p[role="status"],p[role="alert"]') ||
      (el.matches('button') && el.parentElement?.matches('div.mt-2.flex.items-center.justify-between')) ||
      (el.matches('span.text-tl-app-text-muted,p.text-tl-app-text-muted') &&
        (el.parentElement?.matches('div.mt-2.flex.items-center.justify-between') ||
          el.parentElement?.matches('div.flex.flex-col.outline-none')));
  }

  function nativeLocalizationAccountMenu(el) {
    if (!el?.matches('span.min-w-0.truncate') || !el.parentElement?.matches('button[role="menuitem"]') ||
        !el.parentElement.querySelector(':scope > svg') || !el.parentElement.parentElement?.matches('[role="menu"]')) return null;
    const host = el.parentElement.parentElement.parentElement;
    const trigger = host?.querySelector(':scope > button[aria-haspopup="menu"]');
    return trigger && /^(?:Profile options|プロフィールのメニュー)$/.test(trigger.getAttribute('aria-label') || '') ? el : null;
  }

  function nativeLocalizationAccountDialog(el) {
    const dialog = el?.closest('[role="dialog"][aria-modal="true"].bg-tl-app-card.border');
    if (!dialog || !/^(?:Report @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+を報告)$/.test(dialog.getAttribute('aria-label') || '') ||
        !dialog.querySelector('h3.text-sm.font-bold.text-tl-app-text')) return null;
    return dialog;
  }

  function isProtectedLocalizationElement(el) {
    if (!el?.isConnected || isOwnedLocalizationElement(el)) return true;
    if (el.closest(
      'textarea,input,select,option,script,style,code,pre,kbd,samp,svg,' +
      '[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,' +
      '[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],' +
      '.tl-user-text,.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]'
    )) return true;
    // Native settings navigation also truncates its static labels. Keep the
    // protection for profile names and account values everywhere else.
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications' }[location.pathname.replace(/\/$/, '')];
    const pageTitle = routeTitle && el.matches('h2.truncate') && clean(el.textContent) === routeTitle &&
      el === document.querySelector('main h2') && !el.closest('article');
    return !!el.closest('.truncate') && !nativeLocalizationAccountMenu(el) && !isNativeSettingsNavigation(el) && !pageTitle;
  }

  function localizationNotificationRow(el) {
    if (!location.pathname.startsWith('/notifications')) return null;
    const row = el?.closest('button,[role="button"]');
    if (!row?.closest('main') || isOwnedLocalizationElement(row)) return null;
    // Current tweet.app notification rows are border-separated buttons. Do not
    // interpret tab buttons or arbitrary paragraphs as notification content.
    if (row.matches('.items-start.border-b,[data-testid="notification-row"]')) return row;
    // v2.1.0 moved the separator to a wrapper so the native Follow list can
    // expand below its action. Match its 28px leading icon and direct body.
    const icon = row.firstElementChild;
    const body = icon?.nextElementSibling;
    return row.matches('button.w-full.flex.items-start.text-left') &&
      row.parentElement?.matches('div.border-b.border-tl-app-border') &&
      row.parentElement.firstElementChild === row && icon?.matches('div.mt-0\\.5.shrink-0') &&
      icon.querySelector(':scope > svg[width="28"][height="28"]') &&
      body?.matches('div.flex-1.min-w-0') && body.querySelector(':scope > p') ? row : null;
  }

  function localizationNotificationAction(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return null;
    const row = localizationNotificationRow(el);
    const paragraph = el?.closest('p');
    if (!row || !paragraph || !row.contains(paragraph)) return null;
    if (el.closest('.font-extrabold,.font-bold,a')) return null;
    if (!(el === paragraph || el.parentElement === paragraph)) return null;
    const text = clean(node.nodeValue);
    if (!/^(?:(?:liked|favorited|reposted|retweeted|quoted) your (?:post|tweet|reply)|followed you|mentioned you(?: in a (?:post|tweet))?|replied to (?:your (?:post|tweet)|you)|flagged your post for review|awarded you a badge|interacted with you|(?:さん)?が?あなた(?:の(?:ツイート|返信)(?:を(?:お気に入りに登録|リツイート|引用)|に返信)|を(?:フォロー|@ツイート)|宛てにツイート|に(?:返信|バッジを贈り))しました)$/i.test(text)) return null;
    return { row, paragraph, element: el };
  }

  function isLocalizationUI(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return false;
    if (localizationNotificationAction(node)) return true;
    if (localizationNotificationRow(el)) return false;
    if (isNativeLocalizationPollUI(el)) return true;
    if (nativeLocalizationAccountMenu(el)) return node === el.firstChild &&
      /^(?:Report|Mute unavailable|(?:Mute|Unmute) @[A-Za-z0-9_.-]+)$/.test(clean(node.nodeValue));
    if (nativeLocalizationAccountDialog(el) && !el.closest('textarea,input')) return true;
    const text = clean(node.nodeValue);
    const link = el.closest('a[href]');
    if (link) {
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch { return false; }
      if (url.origin !== location.origin || !/^\/(?:feed|explore|notifications|settings|profile|compose|bookmarks)\/?$/.test(url.pathname)) return false;
      return !link.querySelector('img') && !!el.closest('nav,[role="navigation"],header,aside');
    }
    // A reply target is UI, but its handle must remain byte-for-byte unchanged.
    if (/^Replying to$/i.test(text) && el.matches('p,button') &&
        [...el.children].some(child => /^@[A-Za-z0-9_.-]+$/.test(clean(child.textContent)))) return true;
    const control = el.closest('button,[role="button"],[role="tab"],[role="menuitem"],summary');
    if (control) {
      if (control.querySelector('img') || /@[A-Za-z0-9_.-]/.test(clean(control.textContent))) return false;
      // User cards are buttons too. Paragraphs and styled names inside those
      // buttons are data, not labels. Real notification actions are handled above.
      const paragraph = el.closest('p');
      if ((paragraph && control.contains(paragraph)) || control.querySelector('p')) return false;
      if (el.closest('article') && !/^(?:Like|Likes|Liked|Unlike|Favorite|Favorites|Favorited|Unfavorite|Reply|Replies|Repost|Reposts|Retweet|Retweets|Quote|Quote Tweet|Quote Retweet|Undo repost|Undo retweet|Translate|Translated|Show translation|Show original|Show more|Show less|Share|Copy link|Edit post|Delete|Report|Mute user|Unmute|Follow|Unfollow)$/i.test(text)) return false;
      return true;
    }
    if (isNativeLocalizationTimestamp(el)) return true;
    if (el.closest('article')) return false;
    if (el.closest('label,legend,[role="status"],[role="alert"]')) return true;
    const inSettings = /^\/settings\/?$/.test(location.pathname);
    const heading = el.closest('h1,h2,h3') || (inSettings && el.closest('main section h4.font-extrabold'));
    if (heading) {
      // Profile headings contain display names; all other static headings are
      // still restricted to exact dictionary entries by translateTextNode.
      if (/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname) && heading.tagName !== 'H1') return false;
      return !heading.querySelector('img');
    }
    // Settings descriptions are static text, but account values in dd/input and
    // profile data are deliberately excluded. Never allow an entire route.
    if (inSettings && el.matches('main section span.uppercase.tracking-wide')) return true;
    if (inSettings && el.matches('p,dt')) {
      if (el.closest('dl') && el.tagName !== 'DT') return false;
      if (el.classList.contains('leading-relaxed')) {
        const title = el.previousElementSibling;
        return !!el.closest('main section') && title?.matches('h4.font-extrabold') &&
          (EN.has(clean(title.textContent)) || [...EN.values()].includes(clean(title.textContent)));
      }
      return !el.closest('a');
    }
    // The mobile account menu's counts are spans, unlike profile buttons.
    if (el.matches('span') && el.closest('[role="dialog"][aria-label="Account menu"]') &&
        /^(?:Following|Followers)$/.test(text) &&
        [...el.children].some(child => child.matches('strong') && /^[\d,]+$/.test(clean(child.textContent)))) return true;
    // Native empty states put text-center on the parent, not the paragraph.
    return el.matches('p.text-center,div.text-center,[aria-busy="true"]') ||
      (el.matches('p.text-tl-app-text-muted') && el.parentElement?.matches('div.text-center'));
  }

  function replaceLocalizationText(node, text) {
    const raw = node.nodeValue || '';
    if (clean(raw) === text) return;
    ctRememberLocalization(node, null, raw.replace(/\S[\s\S]*\S|\S/, () => text));
  }

  function patchUIAttributes(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const controls = [];
    if (host instanceof Element && host.matches('button,[role="tab"],[role="menuitem"],input,textarea')) controls.push(host);
    host?.querySelectorAll?.('button,[role="tab"],[role="menuitem"],input,textarea').forEach(el => controls.push(el));
    for (const el of controls) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]') ||
          el.closest('.tl-user-text,.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"],.truncate') || el.querySelector('img')) continue;
      if (!el.hasAttribute('aria-label') && el.matches('button.absolute.top-4.right-4') &&
          el.querySelector(':scope > svg.lucide-x') &&
          el.parentElement?.matches('div.bg-tl-app-card.border.rounded-3xl.max-w-lg') &&
          el.parentElement.querySelector('textarea#public-modal-tweet-input')) el.setAttribute('aria-label', 'Close');
      for (const attr of ['aria-label', 'title']) {
        const value = el.getAttribute(attr);
        const out = EN.get(value);
        if (out && value !== out) ctRememberLocalization(el, attr, out);
      }
    }
  }

  function translateTextNode(node) {
    if (!isLocalizationUI(node)) return;
    const text = clean(node.nodeValue);
    if (!text || text.length > 500) return;
    // Dynamic replacements belong to their specific UI contexts. In particular,
    // never parse actor names or dates from arbitrary text that resembles a UI.
    const out = EN.get(text);
    if (out && out !== text) replaceLocalizationText(node, out);
  }

  function patchUI(root = document) {
    ctSyncLocalizationAppearance(root);
    localizationScopeNodes(root).forEach(translateTextNode);
    patchUIAttributes(root);
  }

  function patchInputs(root = document) {
    ctSyncLocalizationAppearance(root);
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const list = [];
    if (host instanceof Element && host.matches('input[placeholder],textarea[placeholder]')) list.push(host);
    host?.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));
    const placeholders = new Map([
      ['Post your reply', 'Tweet your reply'], ['Create a post', 'Compose a Tweet']
    ]);
    for (const el of list) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]')) continue;
      const value = el.getAttribute('placeholder');
      const out = placeholders.get(value);
      if (out && out !== value) ctRememberLocalization(el, 'placeholder', out);
    }
  }


  function userFromHref(href) {
    try {
      const m = new URL(href, location.origin).pathname.match(/^\/user\/([^/?#]+)/i);
      return m ? validUser(decodeURIComponent(m[1])) : null;
    } catch {
      return null;
    }
  }

  function articleAuthor(article) {
    if (!article) return null;

    for (const el of article.querySelectorAll('button[aria-label],a[href],span,div')) {
      let m = (el.getAttribute?.('aria-label') || '').match(/^View @(.+?)'s profile$/i);
      if (m) return validUser(m[1]);

      const user = userFromHref(el.getAttribute?.('href') || '');
      if (user) return user;

      if (!el.children.length && (m = clean(el.textContent).match(/^@([A-Za-z0-9_.-]{1,80})$/))) {
        return validUser(m[1]);
      }
    }

    return null;
  }


  function collectArticles(root = document) {
    const set = new Set();

    if (root instanceof Element) {
      if (root.matches('article')) set.add(root);
      const parent = root.closest('article');
      if (parent) set.add(parent);
    }

    root.querySelectorAll?.('article').forEach(article => set.add(article));
    return set;
  }

  function patchFeed(root = document) {
    for (const article of collectArticles(root)) patchArticle(article);
  }

  function patchRetweetRows(root = document) {
    ctSyncLocalizationAppearance(root);
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (isProtectedLocalizationElement(el) || !el.matches('span')) continue;
      const row = el.parentElement;
      // In the current client this metadata row is a direct article child,
      // marked by the repeat icon. Never infer a reposter from post text.
      if (!row?.parentElement?.matches('article') || !row.querySelector('svg.lucide-repeat')) continue;
      const text = clean(node.nodeValue);
      if (text === 'You reposted') replaceLocalizationText(node, 'You Retweeted');
      else {
        const match = text.match(/^(@?[A-Za-z0-9_.-]{1,80})\s+reposted$/i);
        if (match) replaceLocalizationText(node, `${match[1]} Retweeted`);
      }
    }
  }

  function routeUser() {
    const m = location.pathname.match(/^\/user\/([^/?#]+)/i);
    return m ? validUser(decodeURIComponent(m[1])) : null;
  }

  function ownProfileUser() {
    if (location.pathname !== '/profile') return null;

    for (const el of document.querySelectorAll('main span,main a,main div,main p')) {
      if (el.children.length) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 30 || r.top > 520) continue;
      const m = clean(el.textContent).match(/^@([A-Za-z0-9_.-]{1,80})$/);
      if (m) return validUser(m[1]);
    }

    return null;
  }


  function articleText(article) {
    return (
      [...article.querySelectorAll('p,div[dir="auto"],span')]
        .filter(el => !el.children.length)
        .map(el => clean(el.textContent))
        .filter(t => t.length > 2 && !/^@/.test(t) && !/^\d+[smhd]$/.test(t) && !EN.has(t))
        .sort((a, b) => b.length - a.length)[0] ||
      ''
    );
  }

  function articleAvatar(article) {
    return article.querySelector('img[src*="avatar"],img[alt*="profile" i]')?.src || '';
  }


  function loadFavorites() { return ctProfileLoadFavorites(); }

  function saveFavorite(item, uid) { return ctProfileSaveFavorite(item, uid); }

  function removeFavorite(id, uid) { return ctProfileRemoveFavorite(id, uid); }

  let favoritesActive = false;









  function localCard(item) {
    const row = document.createElement('div');
    row.className = 'ct-local-card';

    if (item.avatar || item.authorAvatar) {
      const img = document.createElement('img');
      img.className = 'ct-local-avatar';
      img.src = item.avatar || item.authorAvatar;
      row.appendChild(img);
    }

    const main = document.createElement('div');
    main.className = 'ct-local-main';


    const meta = document.createElement('div');
    meta.className = 'ct-local-meta';

    const name = document.createElement('span');
    name.className = 'ct-local-name';
    name.textContent =
      item.name || item.authorName || item.username || item.authorUsername || '';
    meta.appendChild(name);

    const username = item.username || item.authorUsername;
    if (username) {
      const handle = document.createElement('span');
      handle.className = 'ct-local-handle';
      handle.textContent = `@${username}`;
      meta.appendChild(handle);
    }

    main.appendChild(meta);

    if (item.text) {
      const text = document.createElement('div');
      text.className = 'ct-local-text';
      text.textContent = item.text;
      main.appendChild(text);
    }

    row.appendChild(main);
    return row;
  }





  function notificationLeaves(root = document) {
    return [...new Set(localizationScopeNodes(root)
      .filter(node => localizationNotificationAction(node)).map(node => node.parentElement))];
  }

  function patchNotifications(root = document) {
    ctSyncLocalizationAppearance(root);
    if (!location.pathname.startsWith('/notifications')) return;
    for (const node of localizationScopeNodes(root)) {
      const context = localizationNotificationAction(node);
      if (!context) continue;
      translateTextNode(node);
      if (ctLocalizationClassicEnabled() && /favorited/i.test(clean(node.nodeValue))) {
        context.row.querySelector('svg')?.parentElement?.classList.add('ct-notification-fav-icon');
      }
    }
  }


  function ctTranslationButtonText(el) {
    return clean(el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  }

  function ctTranslationControls(root = document) {
    const scope = root instanceof Element ? root : document;
    const out = [];
    const selector = 'button,[role="button"],a';
    if (scope instanceof Element && scope.matches(selector)) out.push(scope);
    scope.querySelectorAll?.(selector).forEach(el => out.push(el));
    return out.filter(el => /^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(el)));
  }

  function ctDeclaredLanguage(container) {
    if (!container) return '';
    const nodes = [container, ...(container.querySelectorAll?.('[lang],[data-lang],[data-language]') || [])];
    for (const el of nodes) {
      const raw = clean(el.getAttribute?.('lang') || el.getAttribute?.('data-lang') || el.getAttribute?.('data-language') || '').toLowerCase();
      const lang = raw.split(/[-_]/)[0];
      if (/^[a-z]{2,3}$/.test(lang)) return lang;
    }
    return '';
  }

  function ctPostTextForTranslation(control) {
    const article = control?.closest?.('article');
    if (!article) return '';
    let box = control.parentElement;
    for (let depth = 0; box && box !== article && depth < 6; depth++, box = box.parentElement) {
      const candidates = [...box.querySelectorAll('p,[dir="auto"],[data-testid*="text" i]')]
        .filter(el => !el.closest('button,[role="button"]'))
        .map(el => clean(el.textContent))
        .filter(t => t && !/^(?:Show translation|Translate|翻訳を表示|Show original|原文を表示)$/i.test(t));
      const text = candidates.sort((a,b) => b.length - a.length)[0] || '';
      if (text.length >= 2) return text;
    }
    if (typeof articleText === 'function') return clean(articleText(article));
    return clean(article.textContent);
  }

  function ctLikelyLanguage(text, container) {
    const declared = ctDeclaredLanguage(container);
    if (declared) return declared;
    const s = clean(text).replace(/https?:\/\/\S+/gi,' ').replace(/@[A-Za-z0-9_.-]+/g,' ').replace(/#[^\s]+/g,' ');
    if (!s) return 'unknown';
    if (/[\u3040-\u30ff]/u.test(s)) return 'ja';
    if (/[\uac00-\ud7af]/u.test(s)) return 'ko';
    if (/[\u4e00-\u9fff]/u.test(s)) return 'zh';
    if (/[\u0400-\u04ff]/u.test(s)) return 'ru';
    if (/[\u0600-\u06ff]/u.test(s)) return 'ar';
    if (/[\u0590-\u05ff]/u.test(s)) return 'he';
    if (/[\u0900-\u097f]/u.test(s)) return 'hi';
    if (/[\u0e00-\u0e7f]/u.test(s)) return 'th';
    const lowered = ` ${s.toLowerCase()} `;
    const words = s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
    if (!words.length) return 'unknown';
    const other = ['bonjour','merci','salut','avec','pour','dans','une','des','est','mais','vous','nous','hola','gracias','para','con','una','que','los','las','por','pero','como','muy','ciao','grazie','per','che','gli','della','sono','molto','hallo','danke','und','der','die','das','ist','nicht','mit','für','ein','eine','olá','obrigado','obrigada','não','muito'];
    if (other.some(w => lowered.includes(` ${w} `)) || /[À-ÖØ-öø-ÿ]/u.test(s)) return 'other';
    const english = new Set(['a','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from','had','has','have','he','her','here','his','how','i','if','in','is','it','just','me','more','my','no','not','of','on','one','or','our','out','she','so','some','than','that','the','their','them','there','they','this','to','too','up','us','was','we','were','what','when','where','which','who','why','will','with','would','you','your']);
    const hits = words.reduce((n,w) => n + (english.has(w) ? 1 : 0), 0);
    if (hits >= 2 || (words.length <= 4 && hits >= 1)) return 'en';
    if (words.length <= 3 && /^[\x00-\x7F\s.,!?'"()\-:;]+$/u.test(s)) return 'en';
    if (words.length >= 5 && hits / words.length >= 0.12) return 'en';
    return 'other';
  }


  function patchExactPostTime(root = document) {
    ctTimestampPatchExactPostTime(root);
  }


  function scan(root = document) {
    try {
      installStyle();
      if (typeof installSafariStyle === 'function') installSafariStyle();
      if (typeof patchMediaInfo === 'function') patchMediaInfo(root);
      const classicEnabled = classicAppearanceEnabled();
      patchClassicAppearance(root, classicEnabled);
      patchClassicMotion(root, classicEnabled);
      patchUI(root);
      patchInputs(root);
      patchNotifications(root);
      patchFavoriteButtons(root);
      patchFeed(root);
      patchRetweetRows(root);
      patchAutoTranslation(root, 'en');
      ctReplyTimesEnhance(root);
      patchExactPostTime(root);
      patchProfileFounder();
      patchFavoriteProfileTab();

    patchNavigation(root);
    ctPatchNotificationFilters();
    patchOfficialBadges(root);
    ctMediaEnhance(root);
    patchJapaneseNews(root);
    } catch (error) {
      console.debug('[Classic Twitter EN]', error);
    }
  }

  ctPrepareFavoritePresentation();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  console.log('🐦 Classic Twitter EN v6.23.1 loaded');
})();
