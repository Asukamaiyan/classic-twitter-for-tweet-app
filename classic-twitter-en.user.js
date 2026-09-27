// ==UserScript==
// @name         Classic Twitter for tweet.app - English
// @namespace    https://tweet.app/
// @version      6.7.2
// @description  Classic interface for tweet.app, preserving posts and names. Reply inbox, individual notification-avatar links, high-resolution badges, star Favorites, saved searches, local saved posts and optional keyword filters.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app

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
        if (!response || !(response.status >= 200 && response.status < 300) ||
            (response.finalUrl && !ctAllowedAPIURL(response.finalUrl))) return null;
        try {
          if (typeof response.responseText !== 'string' || response.responseText.length > 2 * 1024 * 1024) return null;
          return JSON.parse(response.responseText);
        } catch {
          return null;
        }
      };
      let gmRequest = null;
      if (typeof GM_xmlhttpRequest === 'function') gmRequest = GM_xmlhttpRequest;
      else if (typeof globalThis.GM?.xmlHttpRequest === 'function') {
        gmRequest = globalThis.GM.xmlHttpRequest.bind(globalThis.GM);
      }
      if (gmRequest) {
        try {
          handle = gmRequest({
            method: 'GET', url: target, headers: requestHeaders,
            timeout: ctNetworkState.requestTimeout, redirect: 'error', anonymous: true,
            onload: response => finish(parse(response)),
            onerror: () => finish(null), ontimeout: () => finish(null), onabort: () => finish(null)
          });
          if (handle && typeof handle.then === 'function') {
            Promise.resolve(handle).then(response => finish(parse(response)), () => finish(null));
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
        if (!response?.ok || (response.url && !ctAllowedAPIURL(response.url))) return null;
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024) return null;
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

  /* Local-only additions. Embedded by the build inside each userscript's IIFE. */
function installLocalEnhancements({ locale = 'ja', getAutoTranslate, setAutoTranslate } = {}) {
  const existing = document.getElementById('ct-local-tools');
  if (existing) return existing.ctController;
  const ja = locale.startsWith('ja');
  const copy = ja ? {
    tools: '便利ツール', title: '便利ツール', close: '閉じる',
    scope: 'このブラウザ内でのみ保存されます。同じブラウザの別アカウントにも適用されます。',
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
    automatic: '投稿を自動翻訳する', autoHelp: '有効にすると、サイトの翻訳機能を自動で呼び出します。',
    autoError: '自動翻訳の設定を保存できませんでした。',
    bookmarks: '保存した投稿', bookmarkLabel: '投稿のメモ（任意）', bookmarkSave: 'この投稿を保存',
    bookmarkHelp: '投稿の詳細画面を開くと保存できます。最大 50 件。削除された投稿や非公開の投稿は閲覧できない場合があります。',
    noBookmarks: '保存した投稿はありません。', bookmarkMissing: '先に投稿の詳細画面を開いてください。',
    bookmarkFull: '投稿は 50 件まで、メモは 200 文字以内です。', bookmarkDuplicate: 'この投稿は保存済みです。',
    post: '投稿',
  } : {
    tools: 'Tools', title: 'Tools', close: 'Close',
    scope: 'Saved only in this browser. Applies to other accounts in the same browser, too.',
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
    automatic: 'Automatically translate posts', autoHelp: 'Calls the site’s translation feature automatically when enabled.',
    autoError: 'Could not save the automatic translation setting.',
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
    #ct-local-tools button:focus-visible, #ct-local-tools a:focus-visible, #ct-local-tools input:focus-visible, #ct-local-tools textarea:focus-visible, .ct-keyword-notice button:focus-visible { outline:3px solid var(--color-tl-app-primary, #1688d4); outline-offset:2px; }
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
    if (open) updateBookmarkControl();
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
    body.append(automatic);
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
  const controller = { root, panel, refresh, destroy() {
    destroyed = true;
    observer.disconnect();
    clearTimeout(timer);
    clearTimeout(searchTimer);
    clearTimeout(searchRetryTimer);
    document.removeEventListener('input', onSearchUserInput, true);
    window.removeEventListener('storage', onStorage);
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
    document.documentElement.dataset.ctActiveVersion = '6.7.2';
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
    replyWatchTick();
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
      else { ctScheduleScan(); replyWatchTick(); }
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
        replyWatchTick();
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

  let ctProfileFounderRequest = 0;
  function ctClearProfileFounders(keep = null) {
    document.querySelectorAll('.ct-profile-founder').forEach(badge => {
      if (badge !== keep) badge.remove();
    });
  }

  async function patchProfileFounder() {
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

    // Browser-local reply inbox. All routes and response shapes come from Tweet's own client.
  // No native notification is marked read and no posting/following API is called here.
  const ctReplyState = {
    uid: null, data: null, busy: false, lastAttempt: -Infinity, error: '', storageError: false,
    rendered: '', storageBound: false
  };
  const CT_REPLY_PREFIX = 'ct-replies-v2:';
  const CT_REPLY_INTERVAL = 90000;
  const CT_REPLY_THREADS = 24;
  const CT_REPLY_BATCH = 6;
  const CT_REPLY_PAGES = 3;

  function ctReplyText(ja, en) { return CT_LOCALE === 'ja' ? ja : en; }
  function ctReplyId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
  }
  function ctReplyHandle(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
  }
  function ctReplyAvatar(value) {
    if (typeof value !== 'string' || value.length > 4000) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function ctReplyEmpty() {
    return { startedAt: Date.now(), checkedAt: 0, notices: [], seen: [], threads: {} };
  }
  function ctReplyRead(uid) {
    try {
      const raw = JSON.parse(localStorage.getItem(CT_REPLY_PREFIX + encodeURIComponent(uid)) || 'null');
      if (!raw || !Array.isArray(raw.notices)) return ctReplyEmpty();
      return {
        startedAt: Number(raw.startedAt) || Date.now(), checkedAt: Number(raw.checkedAt) || 0,
        notices: raw.notices.filter(item => ctReplyId(item?.id) && ctReplyHandle(item?.authorUsername))
          .slice(0, 100).map(item => ({ ...item, read: item.read === true })),
        seen: Array.isArray(raw.seen) ? raw.seen.filter(ctReplyId).slice(-4000) : [],
        threads: raw.threads && typeof raw.threads === 'object' && !Array.isArray(raw.threads) ? raw.threads : {}
      };
    } catch { return ctReplyEmpty(); }
  }
  function ctReplyWrite(uid, data) {
    // Preserve acknowledgements made by another tab while network requests were running.
    const latest = ctReplyRead(uid);
    const read = new Set(latest.notices.filter(item => item.read).map(item => item.id));
    const notices = new Map(latest.notices.map(item => [item.id, item]));
    for (const item of data.notices) notices.set(item.id, { ...item, read: item.read || read.has(item.id) });
    const merged = {
      ...data, notices: [...notices.values()].sort((a, b) =>
        (Date.parse(b.createdAt) || b.detectedAt || 0) - (Date.parse(a.createdAt) || a.detectedAt || 0)
      ).slice(0, 100), seen: [...new Set([...latest.seen, ...data.seen])].slice(-4000)
    };
    try {
      localStorage.setItem(CT_REPLY_PREFIX + encodeURIComponent(uid), JSON.stringify(merged));
      ctReplyState.storageError = false;
      return merged;
    } catch {
      ctReplyState.storageError = true;
      return merged;
    }
  }
  function ctReplyCheckKnownIdentity() {
    if (ctReplyState.uid && typeof ctNetworkState !== 'undefined' && ctNetworkState.authUID !== ctReplyState.uid) {
      ctReplyState.uid = null;
      ctReplyState.data = null;
      ctReplyState.error = '';
      ctReplyState.storageError = false;
    }
  }
  function loadReplyNotices() {
    ctReplyCheckKnownIdentity();
    return ctReplyState.uid ? (ctReplyState.data?.notices || []) : [];
  }
  function markReplyRead(id, deferRender = false) {
    ctReplyCheckKnownIdentity();
    if (!ctReplyState.uid || !ctReplyState.data) return;
    const data = ctReplyRead(ctReplyState.uid);
    // Retain this tab's in-memory replies if browser storage is unavailable.
    data.notices = [...new Map([...data.notices, ...loadReplyNotices()].map(item => [item.id, item])).values()]
      .map(item => !id || item.id === id ? { ...item, read: true } : item);
    ctReplyState.data = ctReplyWrite(ctReplyState.uid, { ...ctReplyState.data, notices: data.notices });
    const updateUI = () => { renderReplyPanel(); patchReplyBadge(); };
    // Keep the activated anchor connected until its native click action has run.
    // This also preserves normal browser modifier-key/new-tab navigation.
    if (deferRender) setTimeout(updateUI, 0);
    else updateUI();
  }
  async function ctReplyJSON(path, auth) {
    const json = await requestJSON(API_ORIGIN + path, { Authorization: `Bearer ${auth.token}` });
    if (!json || typeof json !== 'object' || json.success === false || json.error) return null;
    return json;
  }
  function ctReplySelectParents(posts, replies, username) {
    const candidates = [...posts, ...replies.map(item => item?.post)];
    return [...new Map(candidates.filter(post => ctReplyId(post?.id) &&
      ctReplyHandle(post?.authorUsername)?.toLowerCase() === username.toLowerCase() &&
      !post.originalPostId && !post.isRepost && !post.repostedBy).map(post => [post.id, post])).values()]
      .sort((a, b) => (Date.parse(b.createdAt ?? b.created_at) || 0) - (Date.parse(a.createdAt ?? a.created_at) || 0))
      .slice(0, CT_REPLY_THREADS)
      .filter(post => Number(post.replyCount ?? post.comments ?? 0) > 0);
  }
  function ctReplyRecord(reply, parentId, username, data) {
    const id = ctReplyId(reply?.id);
    const handle = ctReplyHandle(reply?.authorUsername);
    if (!id || !handle || handle.toLowerCase() === username.toLowerCase() || reply.isDeleted ||
        reply.originalPostId || (reply.parentId && reply.parentId !== parentId)) return;
    const existing = data.notices.find(item => item.id === id);
    const wasSeen = data.seen.includes(id);
    if (!wasSeen) data.seen.push(id);
    if (wasSeen && !existing) return;
    const createdAt = typeof (reply.createdAt ?? reply.created_at) === 'string' ? (reply.createdAt ?? reply.created_at) : '';
    const created = Date.parse(createdAt);
    const record = {
      id, parentId, authorUsername: handle,
      authorName: typeof reply.authorName === 'string' ? reply.authorName.slice(0, 200) : handle,
      authorAvatar: ctReplyAvatar(reply.authorAvatar),
      text: typeof reply.text === 'string' ? reply.text.slice(0, 4000) : '',
      createdAt, detectedAt: existing?.detectedAt || Date.now(),
      // Historical replies are useful history, but never an initial unread flood.
      read: existing ? existing.read : (!Number.isFinite(created) || created <= data.startedAt)
    };
    // Trim by creation date only when committing, not by API/parent traversal order.
    data.notices = [record, ...data.notices.filter(item => item.id !== id)];
  }
  async function replyWatchTick(force = false) {
    if (ctReplyState.busy || document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) return;
    const now = Date.now();
    ctReplyState.busy = true;
    try {
      const auth = await getAuth();
      if (!auth?.token || !ctReplyId(auth.uid)) {
        ctReplyState.uid = null;
        ctReplyState.data = null;
        ctReplyState.error = '';
        ctReplyState.storageError = false;
        return;
      }
      const accountChanged = ctReplyState.uid !== auth.uid;
      // Identity checks are never throttled; a newly selected account does not
      // inherit the previous account's polling deadline or visible inbox.
      if (!accountChanged && now - ctReplyState.lastAttempt < (force ? 10000 : CT_REPLY_INTERVAL)) return;
      ctReplyState.lastAttempt = now;
      ctReplyState.error = '';
      if (accountChanged) {
        ctReplyState.uid = auth.uid;
        ctReplyState.data = ctReplyRead(auth.uid);
        ctReplyState.storageError = false;
      }
      renderReplyPanel();
      patchReplyBadge();
      // GET /api/user-profile requires the Firebase uid; the bare route is PUT-only.
      const profileJSON = await ctReplyJSON('/api/user-profile/' + encodeURIComponent(auth.uid), auth);
      const username = ctReplyHandle(profileJSON?.profile?.username);
      if (!username) throw new Error('profile');
      const [postsJSON, repliesJSON] = await Promise.all([
        ctReplyJSON('/api/users/' + encodeURIComponent(username) + '/posts?limit=24', auth),
        ctReplyJSON('/api/users/' + encodeURIComponent(username) + '/replies', auth)
      ]);
      if (!Array.isArray(postsJSON?.posts) || !Array.isArray(repliesJSON?.replies)) throw new Error('threads');
      const data = JSON.parse(JSON.stringify(ctReplyState.data || ctReplyRead(auth.uid)));
      const parents = ctReplySelectParents(postsJSON.posts, repliesJSON.replies, username);
      const parentIds = new Set(parents.map(post => post.id));
      data.threads = Object.fromEntries(Object.entries(data.threads).filter(([id]) => parentIds.has(id)));
      const pending = parents.filter(post => {
        const previous = data.threads[post.id];
        return force || !previous || previous.cursor || previous.count !== Number(post.replyCount ?? post.comments) ||
          now - previous.checkedAt >= 600000;
      }).sort((a, b) => (data.threads[a.id]?.checkedAt || 0) - (data.threads[b.id]?.checkedAt || 0))
        .slice(0, CT_REPLY_BATCH);
      let failures = 0;
      for (const parent of pending) {
        if (document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) break;
        let cursor = data.threads[parent.id]?.cursor || null;
        let successful = true;
        for (let page = 0; page < CT_REPLY_PAGES; page++) {
          const query = new URLSearchParams({ limit: '50' });
          if (cursor) query.set('cursor', cursor);
          const json = await ctReplyJSON('/api/posts/' + encodeURIComponent(parent.id) + '/replies?' + query, auth);
          if (!Array.isArray(json?.replies)) { successful = false; failures++; break; }
          for (const reply of json.replies) ctReplyRecord(reply, parent.id, username, data);
          const next = typeof json.nextCursor === 'string' && json.nextCursor.length <= 2000 ? json.nextCursor : null;
          if (!next || next === cursor) { cursor = null; break; }
          cursor = next;
        }
        if (successful) data.threads[parent.id] = {
          count: Number(parent.replyCount ?? parent.comments), checkedAt: now, cursor
        };
        // A failed page must not be remembered as a successful count baseline.
      }
      const current = await getAuth();
      if (current?.uid !== auth.uid) {
        ctReplyState.uid = null;
        ctReplyState.data = null;
        return;
      }
      data.checkedAt = now;
      ctReplyState.data = ctReplyWrite(auth.uid, data);
      if (failures) ctReplyState.error = ctReplyText('一部の返信を取得できませんでした。次回に再確認します。', 'Some replies could not be checked. They will be retried.');
    } catch {
      ctReplyState.error = ctReplyText('返信を取得できませんでした。ログイン状態を確認して、再確認してください。', 'Replies could not be checked. Check your sign-in and try again.');
    } finally {
      const current = await getAuth();
      if (current?.uid !== ctReplyState.uid) {
        ctReplyState.uid = null;
        ctReplyState.data = null;
      }
      ctReplyState.busy = false;
      renderReplyPanel();
      patchReplyBadge();
    }
  }
  function closeReplyPanel() { document.getElementById('ct-reply-panel')?.remove(); ctReplyState.rendered = ''; }
  function ctReplyBindStorage() {
    if (ctReplyState.storageBound) return;
    ctReplyState.storageBound = true;
    window.addEventListener('storage', event => {
      if (ctReplyState.uid && event.key === CT_REPLY_PREFIX + encodeURIComponent(ctReplyState.uid)) {
        ctReplyState.data = ctReplyRead(ctReplyState.uid);
        renderReplyPanel();
        patchReplyBadge();
      }
    });
  }
  function renderReplyPanel() {
    ctReplyCheckKnownIdentity();
    ctReplyBindStorage();
    if (!/^\/notifications\/?$/.test(location.pathname)) { closeReplyPanel(); return; }
    const main = document.querySelector('main');
    if (!main) return;
    let panel = document.getElementById('ct-reply-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-reply-panel';
      panel.dataset.ctLocalUi = 'replies';
      panel.setAttribute('aria-label', ctReplyText('リプライ通知', 'Reply notifications'));
      // Override legacy panel styling: stay in normal document flow at every screen width.
      panel.style.cssText = 'position:relative!important;inset:auto!important;width:auto!important;max-width:100%!important;max-height:none!important;margin:12px!important;padding:0!important;z-index:auto!important;box-shadow:none!important;border:1px solid var(--color-tl-app-border,#8b98a544)!important;border-radius:12px!important;color:inherit!important;background:inherit!important;overflow:hidden!important';
      const heading = [...main.querySelectorAll('h1,h2')].find(el =>
        !el.closest('[data-ct-local-ui],[hidden],[aria-hidden="true"]') && /^(Notifications|通知)$/.test(el.textContent.trim()));
      const header = heading?.closest('.sticky') || heading?.parentElement;
      if (header && header !== main) header.after(panel);
      else main.prepend(panel);
      ctReplyState.rendered = '';
    }
    const notices = loadReplyNotices();
    const unread = notices.filter(item => !item.read).length;
    const signature = JSON.stringify([ctReplyState.uid, notices, ctReplyState.busy, ctReplyState.error, ctReplyState.storageError, ctReplyState.data?.checkedAt]);
    if (signature === ctReplyState.rendered) return;
    ctReplyState.rendered = signature;
    const open = panel.querySelector('details')?.open ?? false;
    const focused = panel.contains(document.activeElement) ? document.activeElement?.dataset?.replyAction : null;
    panel.replaceChildren();
    const details = document.createElement('details');
    details.open = open;
    const summary = document.createElement('summary');
    summary.style.cssText = 'padding:12px 14px;cursor:pointer;font-weight:700;line-height:1.4';
    summary.textContent = ctReplyText('↩ リプライ通知', '↩ Reply notifications') + (unread ? ` (${unread})` : '');
    summary.dataset.replyAction = 'summary';
    details.append(summary);
    const body = document.createElement('div');
    body.style.cssText = 'padding:0 14px 14px;overflow-wrap:anywhere';
    const help = document.createElement('p');
    help.style.cssText = 'font-size:12px;line-height:1.5;opacity:.75;margin:0 0 10px';
    help.textContent = ctReplyText(
      'このアカウントの最新24件の投稿・返信を、このタブを表示している間90秒ごとに順番に確認します。履歴と既読はこのブラウザ内のみ。過去の返信は既読で追加します。',
      'Checks replies to your latest 24 posts and replies in batches every 90 seconds while this tab is visible. History and read status stay in this browser. Older replies are added as read.');
    body.append(help);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:13px;line-height:1.5;margin:0 0 10px';
    status.textContent = ctReplyState.storageError
      ? ctReplyText('保存できません。通知はこのページを閉じるまで表示します。', 'Storage is unavailable. Replies will remain only until this page closes.')
      : ctReplyState.busy ? ctReplyText('返信を確認中…', 'Checking replies…')
      : ctReplyState.error || (!ctReplyState.uid ? ctReplyText('ログイン後に返信を確認します。', 'Sign in to check replies.')
        : ctReplyState.data?.checkedAt ? ctReplyText('最終確認 ', 'Last checked ') + new Date(ctReplyState.data.checkedAt).toLocaleTimeString(CT_LOCALE, { hour: '2-digit', minute: '2-digit' })
          : ctReplyText('返信の確認を待っています。', 'Waiting to check replies.'));
    body.append(status);
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px';
    function control(label, action, callback) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.replyAction = action;
      button.style.cssText = 'font:inherit;font-size:13px;color:inherit;border:1px solid var(--color-tl-app-border,#8b98a566);background:transparent;border-radius:999px;padding:7px 12px;min-height:36px;cursor:pointer';
      button.addEventListener('click', callback);
      controls.append(button);
      return button;
    }
    const refresh = control(ctReplyText('再確認', 'Check now'), 'refresh', () => replyWatchTick(true));
    refresh.disabled = ctReplyState.busy;
    const read = control(ctReplyText('すべて既読にする', 'Mark all read'), 'read', () => markReplyRead());
    read.disabled = !unread;
    body.append(controls);
    if (!notices.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'font-size:14px;margin:8px 0';
      empty.textContent = ctReplyText('確認した返信はまだありません。', 'No replies have been found yet.');
      body.append(empty);
    }
    const list = document.createElement('div');
    list.style.cssText = 'max-height:420px;overflow:auto;overscroll-behavior:contain';
    for (const item of notices) {
      const row = document.createElement('article');
      row.dataset.ctReplyId = item.id;
      row.style.cssText = 'padding:12px 0;border-top:1px solid var(--color-tl-app-border,#8b98a544)';
      const actor = document.createElement('a');
      actor.href = '/user/' + encodeURIComponent(item.authorUsername);
      actor.textContent = `${item.authorName || item.authorUsername} @${item.authorUsername}`;
      actor.style.cssText = 'display:inline-flex;align-items:center;gap:8px;max-width:100%;font-size:14px;font-weight:700;color:inherit;text-decoration:none';
      const avatarURL = ctReplyAvatar(item.authorAvatar);
      if (avatarURL) {
        const avatar = document.createElement('img');
        avatar.src = avatarURL;
        avatar.alt = '';
        avatar.width = 28;
        avatar.height = 28;
        avatar.loading = 'lazy';
        avatar.referrerPolicy = 'no-referrer';
        avatar.style.cssText = 'width:28px;height:28px;object-fit:cover;border-radius:50%;flex-shrink:0';
        avatar.addEventListener('error', () => avatar.remove(), { once: true });
        // The avatar and author name share one verified profile destination.
        actor.prepend(avatar);
      }
      row.append(actor);
      if (!item.read) {
        const marker = document.createElement('span');
        marker.style.cssText = 'font-size:11px;margin-left:8px;color:#1d9bf0';
        marker.textContent = ctReplyText('未読', 'Unread');
        row.append(marker);
      }
      const link = document.createElement('a');
      link.href = '/post/' + encodeURIComponent(item.id);
      link.style.cssText = 'display:block;color:inherit;text-decoration:none;font-size:14px;white-space:pre-wrap;line-height:1.5;margin:5px 0';
      link.textContent = item.text || ctReplyText('返信を開く', 'Open reply');
      link.addEventListener('click', () => markReplyRead(item.id, true));
      row.append(link);
      const date = new Date(item.createdAt);
      if (Number.isFinite(date.getTime())) {
        const time = document.createElement('time');
        time.dateTime = date.toISOString();
        time.textContent = date.toLocaleString(CT_LOCALE);
        time.style.cssText = 'font-size:12px;opacity:.7';
        row.append(time);
      }
      list.append(row);
    }
    body.append(list);
    details.append(body);
    panel.append(details);
    if (focused) panel.querySelector(`[data-reply-action="${focused}"]`)?.focus();
  }
  function patchReplyBadge() {
    document.getElementById('ct-reply-badge')?.remove(); // Retire the old detached overlay badge.
    const count = loadReplyNotices().filter(item => !item.read).length;
    for (const control of document.querySelectorAll('nav a,nav button,aside a,aside button')) {
      const label = (control.getAttribute('aria-label') || '').trim();
      const text = [...control.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent).join('').trim();
      const nativeText = [...control.querySelectorAll('span')].filter(el => !el.closest('[data-ct-local-ui]'))
        .map(el => el.textContent.trim());
      const target = control.getAttribute('href') === '/notifications' ||
        /^(Notifications|通知)$/.test(label) || /^(Notifications|通知)$/.test(text) || nativeText.some(value => /^(Notifications|通知)$/.test(value));
      let badge = control.querySelector('[data-ct-reply-count]');
      if (!target || !count) { badge?.remove(); continue; }
      if (!badge) {
        badge = document.createElement('span');
        badge.dataset.ctReplyCount = '1';
        badge.dataset.ctLocalUi = 'reply-count';
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-inline-start:4px;padding:0 4px;border-radius:999px;background:#1d9bf0;color:white;font-size:11px;font-weight:700;vertical-align:middle;pointer-events:none';
        control.append(badge);
      }
      const display = `↩${count}`;
      if (badge.textContent !== display) badge.textContent = display;
      badge.setAttribute('aria-label', ctReplyText(`未読の返信 ${count} 件`, `${count} unread replies`));
    }
  }

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
    return [...wrapper.children].find(el => el.matches('img.rounded-full.object-cover,div[role="img"].rounded-full')) || null;
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
  function ctNotificationAvatarWrappers() {
    if (!/^\/notifications\/?$/.test(location.pathname)) return [];
    return [...document.querySelectorAll(`main button.items-start.border-b ${ctAvatarWrapperSelector}`)]
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
    if (!wrapper?.matches(ctAvatarWrapperSelector) || !wrapper.closest('main button.items-start.border-b')) return;
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

    // Official badge artwork and membership precedence from Tweet's web client.
  // The largest published variant is 96 px; displayed dimensions remain native.
  const ctOfficialBadgeKinds = {
    founder: 'Founder', fighter: 'Fighter', centurion: 'Centurion',
    'team-member': 'Team Member', ambassador: 'Tweet Ambassador', wing: 'Wing', press: 'Press'
  };
  const ctBadgeImageStates = new WeakMap();
  const ctBadgeRequests = new WeakMap();

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
    group.setAttribute('aria-label', labelKinds.map(kind => ctOfficialBadgeKinds[kind]).join(' + '));
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
    const images = [...(root.querySelectorAll?.('img[src]') || [])];
    if (root.matches?.('img[src]')) images.push(root);
    images.forEach(ctUpgradeBadgeImage);
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



  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    favorites: 'classicTwitterEN.favorites',
    replyNotices: 'classicTwitterEN.replyNotifications',
    replySeen: 'classicTwitterEN.replySeenIds',
    replyCounts: 'classicTwitterEN.replyCounts',
    replyInit: 'classicTwitterEN.replyWatcherInitialized',
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

  function installStyle() {
    if (document.getElementById('ct-en-style')) return;

    const style = document.createElement('style');
    style.id = 'ct-en-style';
    style.textContent = `
      [data-testid="tweet-like-action"] svg { display:none!important; }
      [data-testid="tweet-like-action"]::before {
        content:"☆";
        display:inline-block;
        font:700 23px/18px Arial,sans-serif;
        transform:translateY(-1px);
        transform-origin:center;
      }
      [data-testid="tweet-like-action"].ct-is-liked::before,
      [data-testid="tweet-like-action"][aria-pressed="true"]::before,
      [data-testid="tweet-like-action"].text-pink-500::before {
        content:"★";
        color:#ffac33!important;
      }
      [data-testid="tweet-like-action"][aria-pressed="true"],
      [data-testid="tweet-like-action"].text-pink-500 {
        color:#ffac33!important;
      }
      [data-testid="tweet-like-action"]:hover {
        color:#ffac33!important;
        background:rgba(255,172,51,.12)!important;
      }
      [data-testid="tweet-like-action"].ct-star-pop::before {
        animation:ctStarPop .32s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes ctStarPop {
        0% { transform:translateY(-1px) scale(.72) rotate(-8deg); opacity:.55; }
        48% { transform:translateY(-1px) scale(1.3) rotate(6deg); }
        74% { transform:translateY(-1px) scale(.94) rotate(-2deg); }
        100% { transform:translateY(-1px) scale(1); }
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
      .ct-notification-fav-icon { position:relative!important; }
      .ct-notification-fav-icon > svg { visibility:hidden!important; }
      .ct-notification-fav-icon::after {
        content:"★";
        position:absolute!important;
        left:50%!important;
        top:50%!important;
        transform:translate(-50%,-50%)!important;
        color:#ffac33!important;
        font:700 27px/1 Arial,sans-serif!important;
        pointer-events:none!important;
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
      #ct-favorites-panel,
      #ct-reply-panel {
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
      #ct-reply-panel { border-radius:14px; max-height:min(48vh,460px); }
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
      .ct-reply-kicker { font-size:12px; color:#1d9bf0; margin-bottom:3px; }
      #ct-reply-badge {
        position:fixed;
        z-index:2147483000;
        min-width:18px;
        height:18px;
        padding:0 5px;
        border-radius:999px;
        background:#1d9bf0;
        color:#fff;
        font:700 11px/18px Arial;
        text-align:center;
        pointer-events:none;
      }
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
    return !!el?.closest('[id^="ct-"],[class^="ct-"],[class*=" ct-"],[data-ct-owned],[data-ct-local-ui]');
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
    const title = el.getAttribute('title');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(title) &&
      Number.isFinite(Date.parse(title));
  }

  function isProtectedLocalizationElement(el) {
    if (!el?.isConnected || isOwnedLocalizationElement(el)) return true;
    if (el.closest(
      'textarea,input,select,option,script,style,code,pre,kbd,samp,svg,' +
      '[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,' +
      '[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],' +
      '.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]'
    )) return true;
    // Native settings navigation also truncates its static labels. Keep the
    // protection for profile names and account values everywhere else.
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications' }[location.pathname.replace(/\/$/, '')];
    const pageTitle = routeTitle && el.matches('h2.truncate') && clean(el.textContent) === routeTitle &&
      el === document.querySelector('main h2') && !el.closest('article');
    return !!el.closest('.truncate') && !isNativeSettingsNavigation(el) && !pageTitle;
  }

  function localizationNotificationRow(el) {
    if (!location.pathname.startsWith('/notifications')) return null;
    const row = el?.closest('button,[role="button"]');
    if (!row?.closest('main') || isOwnedLocalizationElement(row)) return null;
    // Current tweet.app notification rows are border-separated buttons. Do not
    // interpret tab buttons or arbitrary paragraphs as notification content.
    return row.matches('.items-start.border-b,[data-testid="notification-row"]') ? row : null;
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
      if (el.closest('article') && !/^(?:Like|Likes|Liked|Unlike|Reply|Replies|Repost|Reposts|Retweet|Retweets|Quote|Quote Tweet|Quote Retweet|Undo repost|Undo retweet|Translate|Translated|Show translation|Show original|Show more|Show less|Share|Copy link|Edit post|Delete|Report|Mute user|Unmute|Follow|Unfollow)$/i.test(text)) return false;
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
    node.nodeValue = raw.replace(/\S[\s\S]*\S|\S/, () => text);
  }

  function patchUIAttributes(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const controls = [];
    if (host instanceof Element && host.matches('button,[role="tab"],[role="menuitem"],input,textarea')) controls.push(host);
    host?.querySelectorAll?.('button,[role="tab"],[role="menuitem"],input,textarea').forEach(el => controls.push(el));
    for (const el of controls) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]') ||
          el.closest('.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"],.truncate') || el.querySelector('img')) continue;
      for (const attr of ['aria-label', 'title']) {
        const value = el.getAttribute(attr);
        const out = EN.get(value);
        if (out && value !== out) el.setAttribute(attr, out);
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
    localizationScopeNodes(root).forEach(translateTextNode);
    patchUIAttributes(root);
  }

  function patchInputs(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const list = [];
    if (host instanceof Element && host.matches('input[placeholder],textarea[placeholder]')) list.push(host);
    host?.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));
    const placeholders = new Map([
      ['Post your reply', 'Tweet your reply'], ['Create a post', 'Compose a Tweet']
    ]);
    for (const el of list) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]')) continue;
      const value = el.getAttribute('placeholder');
      const out = placeholders.get(value);
      if (out && out !== value) el.setAttribute('placeholder', out);
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


  function loadFavorites() {
    const items = loadJSON(KEY.favorites, []);
    return Array.isArray(items) ? items : [];
  }

  function saveFavorite(item) {
    if (!item?.id) return;
    saveJSON(
      KEY.favorites,
      [item, ...loadFavorites().filter(x => x.id !== item.id)].slice(0, 500)
    );
  }

  function removeFavorite(id) {
    saveJSON(KEY.favorites, loadFavorites().filter(x => x.id !== id));
  }

  document.addEventListener(
    'click',
    event => {
      const button = event.target.closest?.('[data-testid="tweet-like-action"]');
      if (!button) return;

      const article = button.closest('article');
      if (!article) return;

      const snapshot = snapshotFavorite(article);
      const wasLiked = ctIsLiked(button);

      button.classList.remove('ct-star-pop');
      void button.offsetWidth;
      button.classList.add('ct-star-pop');
      setTimeout(() => button.classList.remove('ct-star-pop'), 380);

      setTimeout(() => {
        const nowLiked = ctIsLiked(button);

        if (!wasLiked && nowLiked) saveFavorite(snapshot);
        else if (wasLiked && !nowLiked) removeFavorite(snapshot?.id);

        if (favoritesActive) renderFavoritesPanel();
      }, 450);
    },
    true
  );


  let favoritesActive = false;

  function findRetweetTab() {
    if (location.pathname !== '/profile') return null;
    return (
      [...document.querySelectorAll('main a,main button,main [role="tab"]')].find(el =>
        /^(Reposts|Retweets)$/i.test(clean(el.textContent))
      ) || null
    );
  }

  function patchFavoriteProfileTab() {
    let tab = document.getElementById('ct-favorites-tab');

    if (location.pathname !== '/profile') {
      tab?.remove();
      favoritesActive = false;
      closeFavoritesPanel();
      return;
    }

    const ref = findRetweetTab();
    if (!ref) {
      tab?.remove();
      return;
    }

    if (!tab) {
      tab = document.createElement('button');
      tab.id = 'ct-favorites-tab';
      tab.type = 'button';
      tab.textContent = 'Favorites';

      const parent = ref.parentElement;
      if (!parent) return;
      parent.appendChild(tab);

      tab.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        favoritesActive = !favoritesActive;
        tab.dataset.active = favoritesActive ? '1' : '0';
        renderFavoritesPanel();
      };
    }

    tab.dataset.active = favoritesActive ? '1' : '0';
  }

  function centerRect() {
    const main = document.querySelector('main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    return r.width > 280 ? r : null;
  }

  function panelHead(title, note, onClose) {
    const head = document.createElement('div');
    head.className = 'ct-local-head';

    const left = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'ct-local-title';
    titleEl.textContent = title;
    left.appendChild(titleEl);

    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'ct-local-note';
      noteEl.textContent = note;
      left.appendChild(noteEl);
    }

    const close = document.createElement('button');
    close.className = 'ct-local-close';
    close.textContent = '×';
    close.onclick = onClose;

    head.append(left, close);
    return head;
  }

  function localCard(item, reply = false) {
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

    if (reply) {
      const kicker = document.createElement('div');
      kicker.className = 'ct-reply-kicker';
      kicker.textContent = 'replied to your Tweet';
      main.appendChild(kicker);
    }

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

  function closeFavoritesPanel() {
    document.getElementById('ct-favorites-panel')?.remove();
  }

  function renderFavoritesPanel() {
    if (!favoritesActive || location.pathname !== '/profile') {
      closeFavoritesPanel();
      return;
    }

    const r = centerRect();
    if (!r) return;

    let panel = document.getElementById('ct-favorites-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-favorites-panel';
      document.body.appendChild(panel);
    }

    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.max(100, Math.round(r.top + 88))}px`;
    panel.style.width = `${Math.round(r.width)}px`;
    panel.style.maxHeight = `calc(100vh - ${Math.max(110, Math.round(r.top + 100))}px)`;
    panel.innerHTML = '';

    panel.appendChild(
      panelHead('★ Favorites', 'Stored only in this browser', () => {
        favoritesActive = false;
        const tab = document.getElementById('ct-favorites-tab');
        if (tab) tab.dataset.active = '0';
        closeFavoritesPanel();
      })
    );

    const data = loadFavorites();
    if (!data.length) {
      const empty = document.createElement('div');
      empty.className = 'ct-local-empty';
      empty.textContent = 'No Favorites yet.';
      panel.appendChild(empty);
      return;
    }

    for (const item of data) {
      const row = localCard(item, false);
      row.onclick = () => {
        if (item.href) location.href = item.href;
      };
      panel.appendChild(row);
    }
  }

  function notificationLeaves(root = document) {
    return [...new Set(localizationScopeNodes(root)
      .filter(node => localizationNotificationAction(node)).map(node => node.parentElement))];
  }

  function patchNotifications(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;
    for (const node of localizationScopeNodes(root)) {
      const context = localizationNotificationAction(node);
      if (!context) continue;
      translateTextNode(node);
      if (/favorited/i.test(clean(node.nodeValue))) {
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
    const scope = root instanceof Element ? root : document;
    const articles = [];
    if (scope instanceof Element && scope.matches('article')) articles.push(scope);
    scope.querySelectorAll?.('article').forEach(a => articles.push(a));
    for (const article of articles) {
      if (!article.isConnected) continue;
      const path = location.pathname;
      const isDetail = /\/status\/|\/post\/|\/posts\//i.test(path) ||
        !!article.querySelector('[data-testid*="reply" i] textarea, textarea[placeholder*="reply" i]');
      if (!isDetail || article.querySelector('.ct-detail-post-time')) continue;
      const timeEl = article.querySelector('time[datetime]');
      let date = timeEl ? new Date(timeEl.getAttribute('datetime') || '') : null;
      if (!date || Number.isNaN(date.getTime())) continue;
      const stamp=document.createElement('div');
      stamp.className='ct-detail-post-time';
      const timeText=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
      const dateText=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric'}).format(date);
      stamp.textContent=`${dateText} · ${timeText}`;
      article.append(stamp);
    }
  }


  function scan(root = document) {
    try {
      installStyle();
      if (typeof installSafariStyle === 'function') installSafariStyle();
      if (typeof patchMediaInfo === 'function') patchMediaInfo(root);
      patchUI(root);
      patchInputs(root);
      patchNotifications(root);
      patchFavoriteButtons(root);
      patchFeed(root);
      patchRetweetRows(root);
      patchAutoTranslation(root, 'en');
      patchExactPostTime(root);
      patchProfileFounder();
      patchFavoriteProfileTab();

      if (favoritesActive) renderFavoritesPanel();
      renderReplyPanel();
      patchReplyBadge();
    patchNavigation(root);
    patchOfficialBadges(root);
    } catch (error) {
      console.debug('[Classic Twitter EN]', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  console.log('🐦 Classic Twitter EN v6.7.2 loaded');
})();
