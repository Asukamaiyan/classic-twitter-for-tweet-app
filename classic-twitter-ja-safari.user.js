// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese
// @namespace    https://tweet.app/
// @version      6.7.1
// @description  tweet.appのUIを安全に日本語化。投稿本文・名前を保持し、表示名・Founder Number・星のお気に入り、保存検索・投稿保存・任意のキーワード折りたたみに対応。
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
// @connect      firebasestorage.googleapis.com
// @connect      storage.googleapis.com
// @noframes
// @run-at       document-start
// @license      MIT
// @homepageURL  https://github.com/Asukamaiyan/classic-twitter-for-tweet-app
// @supportURL   https://github.com/Asukamaiyan/classic-twitter-for-tweet-app/issues
// ==/UserScript==

(() => {
  'use strict';
  if (document.documentElement?.dataset.ctActiveVersion) return;
  const CT_LOCALE = 'ja';
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
    document.documentElement.dataset.ctActiveVersion = '6.7.1';
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

    function ctFormatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '取得できません';
    const units = ['B','KB','MB','GB'];
    let value = n, i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value >= 10 || i === 0 ? value.toFixed(i === 0 ? 0 : 1) : value.toFixed(2)} ${units[i]}`;
  }

  function ctMediaFormat(src, contentType = '') {
    const type = clean(contentType).split(';')[0].toLowerCase();
    if (type.includes('/')) return type.split('/')[1].toUpperCase().replace('QUICKTIME','MOV').replace('JPEG','JPG');
    try {
      const path = decodeURIComponent(new URL(src, location.href).pathname).toLowerCase();
      const m = path.match(/\.([a-z0-9]{2,5})$/);
      if (m) return m[1].toUpperCase();
    } catch {}
    return '不明';
  }

  function ctHeadMedia(src) {
    const empty = { bytes: null, contentType: '' };
    try {
      const url = new URL(src);
      if (url.protocol !== 'https:' || !['firebasestorage.googleapis.com', 'storage.googleapis.com'].includes(url.hostname) || url.username || url.password) return Promise.resolve(empty);
    } catch { return Promise.resolve(empty); }
    return new Promise(resolve => {
      let settled = false;
      let handle;
      const finish = response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const headers = response?.status >= 200 && response.status < 300 ? String(response.responseHeaders || '') : '';
        const length = headers.match(/^content-length:\s*(\d+)/im)?.[1];
        const contentType = headers.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.trim() || '';
        resolve({ bytes: length ? Number(length) : null, contentType });
      };
      const timer = setTimeout(() => { finish(null); try { handle?.abort?.(); } catch {} }, 8000);
      const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest :
        typeof globalThis.GM?.xmlHttpRequest === 'function' ? globalThis.GM.xmlHttpRequest.bind(globalThis.GM) : null;
      if (!gm) return finish(null);
      try {
        handle = gm({ method: 'HEAD', url: src, timeout: 8000, anonymous: true, redirect: 'error',
          onload: finish, onerror: () => finish(null), ontimeout: () => finish(null), onabort: () => finish(null) });
        if (handle && typeof handle.then === 'function') Promise.resolve(handle).then(finish, () => finish(null));
      } catch { finish(null); }
    });
  }

  let ctMediaInfoRequest = 0;
  let ctMediaInfoPreviousFocus = null;
  async function ctShowMediaInfo(media) {
    const request = ++ctMediaInfoRequest;
    const previousOverlay = document.getElementById('ct-media-info-panel');
    const previousFocus = previousOverlay?.contains(document.activeElement) && ctMediaInfoPreviousFocus?.isConnected
      ? ctMediaInfoPreviousFocus : document.activeElement;
    ctMediaInfoPreviousFocus = previousFocus;
    previousOverlay?.remove();
    const src = media.currentSrc || media.src || '';
    const isVideo = media instanceof HTMLVideoElement;
    const width = isVideo ? media.videoWidth : media.naturalWidth;
    const height = isVideo ? media.videoHeight : media.naturalHeight;
    const duration = isVideo && Number.isFinite(media.duration) ? media.duration : null;

    const overlay = document.createElement('div');
    overlay.id = 'ct-media-info-panel';
    overlay.setAttribute('data-ct-local-ui', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', isVideo ? '動画情報' : '写真情報');
    const dark = matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    overlay.style.setProperty('--ct-media-bg', `var(--color-tl-app-card, ${dark ? '#15202b' : '#fff'})`);
    overlay.style.setProperty('--ct-media-fg', `var(--color-tl-app-text, ${dark ? '#f1f5f9' : '#17202a'})`);

    const sheet = document.createElement('div');
    sheet.className = 'ct-media-info-sheet';
    const headRow = document.createElement('div');
    headRow.className = 'ct-media-info-head';
    const title = document.createElement('div');
    title.className = 'ct-media-info-title';
    title.textContent = isVideo ? '🎬 動画情報' : '📸 写真情報';
    const close = document.createElement('button');
    close.className = 'ct-media-info-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '閉じる');
    headRow.append(title, close);

    const grid = document.createElement('div');
    grid.className = 'ct-media-info-grid';
    const rows = [
      ['実解像度', width && height ? `${width} × ${height} px` : '読み込み待ち'],
      ['形式', ctMediaFormat(src)],
      ['配信ファイル容量', src ? '取得中…' : '取得できません']
    ];
    if (isVideo) rows.push(['長さ', duration != null ? `${duration.toFixed(2)} 秒` : '読み込み待ち']);
    const values = new Map();
    for (const [key, value] of rows) {
      const k = document.createElement('div'); k.className = 'ct-media-info-key'; k.textContent = key;
      const v = document.createElement('div'); v.className = 'ct-media-info-value'; v.textContent = value;
      values.set(key, v);
      grid.append(k, v);
    }

    const url = document.createElement('div');
    url.className = 'ct-media-info-url';
    url.textContent = src || 'URLを取得できません';

    sheet.append(headRow, grid, url);
    overlay.append(sheet);
    document.body.append(overlay);
    const dismiss = () => {
      const current = request === ctMediaInfoRequest;
      if (current) ctMediaInfoRequest++;
      overlay.remove();
      if (current) {
        ctMediaInfoPreviousFocus = null;
        if (previousFocus?.isConnected) previousFocus.focus?.();
      }
    };
    overlay.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });
    close.focus();
    close.onclick = dismiss;
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });

    // Show the sheet immediately, then update only this still-open request.
    // Closing it or opening another media item cannot be undone by a late HEAD.
    const head = src ? await ctHeadMedia(src) : { bytes: null, contentType: '' };
    if (request !== ctMediaInfoRequest || !overlay.isConnected) return;
    values.get('形式').textContent = ctMediaFormat(src, head.contentType);
    values.get('配信ファイル容量').textContent = ctFormatBytes(head.bytes);
  }

  function patchMediaInfo(root = document) {
    const scope = root instanceof Element ? root : document;
    const media = [];
    if (scope instanceof HTMLImageElement || scope instanceof HTMLVideoElement) media.push(scope);
    scope.querySelectorAll?.('article img, article video').forEach(el => media.push(el));

    for (const el of media) {
      if (!el.isConnected || el.dataset.ctMediaInfo === '1') continue;
      if (el instanceof HTMLImageElement) {
        const alt = clean(el.alt || '').toLowerCase();
        const r = el.getBoundingClientRect();
        if (/avatar|profile/.test(alt) || (r.width && r.width <= 96 && r.height <= 96)) continue;
      }

      let timer = null;
      let startX = 0;
      let startY = 0;
      const cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };

      el.addEventListener('touchstart', event => {
        const touch = event.touches?.[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        cancel();
        timer = setTimeout(() => {
          timer = null;
          ctShowMediaInfo(el);
        }, 650);
      }, { passive:true });

      el.addEventListener('touchmove', event => {
        const touch = event.touches?.[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) cancel();
      }, { passive:true });

      el.addEventListener('touchend', cancel, { passive:true });
      el.addEventListener('touchcancel', cancel, { passive:true });
      el.dataset.ctMediaInfo = '1';
    }
  }
  function installSafariStyle() {
    if(document.getElementById("ct-safari-style")) return;
    const style=document.createElement("style"); style.id="ct-safari-style";
    style.textContent="      #ct-media-info-panel {\n        position:fixed;\n        inset:0;\n        z-index:2147483600;\n        display:flex;\n        align-items:flex-end;\n        justify-content:center;\n        padding:16px;\n        background:rgba(0,0,0,.34);\n      }\n\n      .ct-media-info-sheet {\n        box-sizing:border-box;\n        width:min(520px,100%);\n        max-height:72vh;\n        overflow:auto;\n        border-radius:18px;\n        padding:16px;\n        background:var(--ct-media-bg,#fff);\n        color:var(--ct-media-fg,#17202a);\n        box-shadow:0 12px 44px rgba(0,0,0,.34);\n        font:14px/1.55 system-ui,-apple-system,\"Segoe UI\",sans-serif;\n      }\n\n      .ct-media-info-head {\n        display:flex;\n        align-items:center;\n        justify-content:space-between;\n        gap:12px;\n        margin-bottom:12px;\n      }\n\n      .ct-media-info-title { font-size:17px; font-weight:800; }\n      .ct-media-info-close {\n        border:0;\n        border-radius:999px;\n        background:rgba(127,127,127,.15);\n        color:inherit;\n        width:32px;\n        height:32px;\n        font-size:20px;\n      }\n      .ct-media-info-grid {\n        display:grid;\n        grid-template-columns:auto 1fr;\n        gap:7px 12px;\n      }\n      .ct-media-info-key { opacity:.62; }\n      .ct-media-info-value { min-width:0; overflow-wrap:anywhere; font-weight:650; }\n      .ct-media-info-url {\n        margin-top:12px;\n        padding:10px;\n        border-radius:10px;\n        background:rgba(127,127,127,.10);\n        font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;\n        overflow-wrap:anywhere;\n        user-select:text;\n        -webkit-user-select:text;\n      }\n\n";
    (document.head || document.documentElement).append(style);
  }


  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    favorites: 'classicTwitterJP.favorites',
    replyNotices: 'classicTwitterJP.replyNotifications',
    replySeen: 'classicTwitterJP.replySeenIds',
    replyCounts: 'classicTwitterJP.replyCounts',
    replyInit: 'classicTwitterJP.replyWatcherInitialized',
    autoTranslate: 'classicTwitterJP.autoTranslate'
  };

  const profileCache = new Map();
  const profilePending = new Map();

  const clean = v =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  const normUser = v =>
    clean(v)
      .replace(/^@/, '')
      .toLowerCase();

  const validUser = v => {
    const s = clean(v).replace(/^@/, '');

    return /^[A-Za-z0-9_.-]{1,80}$/.test(s)
      ? s
      : null;
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(
        localStorage.getItem(key) || 'null'
      );

      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const JP = new Map([
    ['Home', 'ホーム'],
    ['Feed', 'ホーム'],
    ['Explore', '話題を検索'],
    ['Notifications', '通知'],
    ['Profile', 'プロフィール'],
    ['Settings', '設定'],

    ['For you', 'おすすめ'],
    ['Following', 'フォロー中'],

    ['Trending', 'トレンド'],
    ['Trends for you', 'おすすめのトレンド'],
    ['News', 'ニュース'],
    ['Sports', 'スポーツ'],
    ['Entertainment', 'エンターテインメント'],
    ['Technology', 'テクノロジー'],

    ['Top', '話題'],
    ['Latest', '最新'],
    ['People', 'ユーザー'],
    ['Photos', '画像'],
    ['Hashtags', 'ハッシュタグ'],

    ['All', 'すべて'],
    ['Verified', '認証済み'],
    ['Mentions', '@ツイート'],

    ['Posts', 'ツイート'],
    ['Post', 'ツイート'],
    ['Tweets', 'ツイート'],
    ['Tweet', 'ツイート'],

    ['Replies', '返信'],
    ['No replies yet', 'まだ返信はありません'],
    ['No replies yet.', 'まだ返信はありません。'],
    ['No tweets yet.', 'まだツイートはありません。'],
    ['No posts yet.', 'まだツイートはありません。'],
    ['No reposts yet.', 'まだリツイートはありません。'],
    ['No tweets yet. Share your first thought with the community.', 'まだツイートはありません。最初のツイートを投稿してみましょう。'],
    ['No posts yet. Share your first thought with the community.', 'まだツイートはありません。最初のツイートを投稿してみましょう。'],
    ['Be the first to reply.', '最初の返信をしてみましょう。'],
    ['Reply', '返信'],

    ['Followers', 'フォロワー'],
    ['Follower', 'フォロワー'],

    ['Edit profile', 'プロフィールを編集'],

    ['Follow', 'フォロー'],
    ['Unfollow', 'フォロー解除'],

    ['Reposts', 'リツイート'],
    ['Repost', 'リツイート'],
    ['Retweets', 'リツイート'],
    ['Retweet', 'リツイート'],

    ['Quote', '引用ツイート'],
    ['Quote Tweet', '引用ツイート'],
    ['Quote Retweet', '引用ツイート'],

    ['Undo repost', 'リツイートを取り消す'],
    ['Undo retweet', 'リツイートを取り消す'],

    ['Like', 'お気に入り'],
    ['Likes', 'お気に入り'],
    ['Liked', 'お気に入り済み'],
    ['Liked by', 'お気に入りしたユーザー'],
    ['Unlike', 'お気に入りを解除'],

    ['Who to follow', 'おすすめユーザー'],

    // Backup codes / security
    ['Backup codes', 'バックアップコード'],
    ['Generate new codes', '新しいコードを生成'],
    ['codes remaining', '個のコードが残っています'],
    ['code remaining', '個のコードが残っています'],

    // Wing badge / loading states
    ['You earned the Wing badge for inviting 5 friends who joined.', '5人の友だちを招待したので、Wingバッジを獲得しました！'],
    ['awarded you a badge', 'あなたにバッジを贈りました'],
    ['Loading account...', 'アカウント情報を読み込み中…'],
    ['Loading followed hashtags...', 'フォロー中のハッシュタグを読み込み中…'],
    ['Loading more followed hashtags', 'フォロー中のハッシュタグをさらに読み込み中…'],
    ['Loading more muted accounts', 'ミュートしているアカウントをさらに読み込み中…'],
    ['Loading muted accounts...', 'ミュートしているアカウントを読み込み中…'],
    ['Loading more notifications', '通知をさらに読み込み中…'],
    ['Loading more notifications...', '通知をさらに読み込み中…'],
    ['Loading notifications...', '通知を読み込み中…'],
    ['Loading notification...', '通知を読み込み中…'],
    ['Loading profile...', 'プロフィールを読み込み中…'],
    ['Loading posts...', 'ツイートを読み込み中…'],
    ['Loading more posts...', 'ツイートをさらに読み込み中…'],
    ['Loading followers...', 'フォロワーを読み込み中…'],
    ['Loading following...', 'フォロー中のユーザーを読み込み中…'],
    ['Loading more', 'さらに読み込み中…'],
    ['Load more', 'さらに読み込む'],

    // Settings / loading / notifications refinements
    ['See your account information like your username and date of birth.', 'ユーザー名や生年月日などのアカウント情報を確認できます。'],
    ['Founding plan', 'Foundingプラン'],
    ['You have Centurion.', 'Centurionを利用中です。'],
    ['Generating new codes invalidates any unused codes you already have.', '新しいコードを生成すると、現在お持ちの未使用コードはすべて無効になります。'],
    ['Manage two-factor authentication and sign-in protection.', '2要素認証とログイン保護を管理します。'],
    ["You aren't following any hashtags.", 'フォローしているハッシュタグはありません。'],
    ["You haven't muted anyone.", 'ミュートしているアカウントはありません。'],
    ['Loading muted', 'ミュートしているアカウントを読み込み中…'],
    ['Loading notifications', '通知を読み込み中…'],
    ['Loading notification', '通知を読み込み中…'],
    ['No verified account notifications yet.', '認証済みアカウントからの通知はまだありません。'],
    ['No VERA notifications yet.', 'VERAからの通知はまだありません。'],
    ['When someone quotes or mentions you, it will show up here.', 'あなたへの引用や@ツイートがここに表示されます。'],
    ['Nothing to see here yet. Likes, reposts, and follows will show up here.', '通知はまだありません。お気に入り、リツイート、フォローの通知がここに表示されます。'],
    ['quoted your post', 'あなたのツイートを引用しました'],
    ['quoted your tweet', 'あなたのツイートを引用しました'],
    ['posted', 'ツイートしました'],
    ['reposted', 'リツイートしました'],
    ['retweeted', 'リツイートしました'],
    ['removed a repost', 'リツイートを取り消しました'],
    ['removed a retweet', 'リツイートを取り消しました'],
    ['Your post was sent.', 'ツイートしました'],
    ['Repost removed.', 'リツイートを取り消しました'],
    ['Post deleted.', 'ツイートを削除しました'],

    // Invite / referral
    ['Invite', '招待する'],
    ['Invite friends', '友だちを招待しよう！'],
    ['Share your personal invite link with friends by text, email, or anywhere else.', 'あなた専用の招待リンクを、メッセージやメールなどで友だちにシェアしよう！'],
    ['Share invite', '招待リンクをシェア'],
    ['Link opens', 'リンクを開いた人数'],
    ['Signed up', '登録した人数'],
    ['Friends who joined', '参加した友だち'],
    ['Earn a Wing badge!', 'Wingバッジを獲得しよう！'],
    ['How it works:', '仕組み:'],
    ['Share your invite link with friends.', '招待リンクを友だちにシェアします。'],
    ['They sign up. Once they confirm their email, pay, and activate their account, that counts as one friend.', '友だちが登録し、メール認証・支払い・アカウントの有効化を完了すると、1人としてカウントされます。'],
    ['Get 5 friends → get a Wing badge!', '5人の友だちが参加すると、Wingバッジを獲得できます！'],
    ['Share your personal invite link.', 'あなた専用の招待リンクをシェアしよう！'],
    ['Invalid invite link.', 'この招待リンクは無効です'],
    ['Invite link is missing.', '招待リンクが見つかりません'],
    ['Could not validate invite link.', '招待リンクを確認できませんでした'],
    ['Could not redeem invite.', '招待を利用できませんでした'],
    ['Copy link', 'リンクをコピー'],
    ['Share', 'シェア'],
    ['Share post', 'ツイートをシェア'],
    ['Shared post', 'シェアされたツイート'],

    // Post editing
    ['Edit post', 'ツイートを編集'],
    ['Edit your post...', 'ツイートを編集...'],
    ['Edited', '編集済み'],
    ['Post updated.', 'ツイートを更新しました'],
    ['The edit window for this post has closed.', 'このツイートの編集可能時間は終了しました'],
    ['This edit could not be saved. Your post is unchanged.', '編集を保存できませんでした。ツイートは変更されていません'],
    ['Editing is temporarily unavailable. Try again shortly.', '現在、編集機能を利用できません。しばらくしてからもう一度お試しください'],

    // Hashtags
    ['Hashtag', 'ハッシュタグ'],
    ['Hashtag suggestions', 'ハッシュタグ候補'],
    ['Followed hashtags', 'フォロー中のハッシュタグ'],
    ['View and unfollow hashtags you follow.', 'フォローしているハッシュタグを確認・解除できます'],
    ['Posts with these hashtags are boosted in your For You feed. Unfollow one here to stop boosting it.', 'フォローしたハッシュタグのツイートは「おすすめ」に表示されやすくなります。ここからフォローを解除できます。'],
    ['No hashtags found.', 'ハッシュタグが見つかりません'],
    ['Loading followed hashtags...', 'フォロー中のハッシュタグを読み込んでいます…'],
    ['Something went wrong loading hashtags you follow.', 'フォロー中のハッシュタグを読み込めませんでした'],

    // Mute / reports
    ['Mute user', 'ミュートする'],
    ['Unmute', 'ミュートを解除'],
    ['Unmute user', 'ミュートを解除'],
    ['User muted.', 'アカウントをミュートしました'],
    ['View and unmute the accounts you have muted.', 'ミュートしているアカウントを確認・解除できます'],
    ['Muted accounts stay hidden from your For You feed. Unmute one here to see their posts again.', 'ミュートしたアカウントのツイートは「おすすめ」に表示されません。ここからミュートを解除できます。'],
    ['Report', '報告する'],
    ['Submit report', '報告を送信'],
    ['Thanks for your report', 'ご報告ありがとうございます'],
    ['Why are you reporting this?', 'このツイートを報告する理由を選んでください'],
    ['Report submitted.', '報告を送信しました'],
    ['Your report is private. We use it to review and improve safety.', '報告内容が他のユーザーに公開されることはありません。安全性向上のため確認を行います。'],
    ['Only you see this notice. Our team will review the report.', 'このお知らせはあなたにのみ表示されています。運営チームが報告内容を確認します。'],
    ['Manipulated media', '加工・改変されたメディア'],
    ['Likely false claim', '誤解を招く可能性のある情報'],

    // Translation / profile copy
    ['Translate', '翻訳する'],
    ['Translated', '翻訳済み'],
    ["Couldn’t translate. Try again.", '翻訳できませんでした。もう一度お試しください。'],
    ['Manage your public profile, photo, and bio.', 'プロフィール、写真、自己紹介を編集できます'],

    // Official role badge names intentionally remain unchanged
    ['Team Member', 'Team Member'],
    ['Tweet Ambassador', 'Tweet Ambassador'],

    ['Search', '検索'],
    ['Search Twitter', 'Twitterを検索'],

    ['Account', 'アカウント'],
    ['Your account', 'アカウント'],
    ['Account settings', 'アカウント設定'],

    ['Replying to', '返信先:'],
    ['Show translation', '翻訳を表示'],
    ['Show original', '原文を表示'],
    ['See account information like your username and date of birth.', 'ユーザー名や生年月日などのアカウント情報を確認します。'],
    ['Manage your public profile, photo, and more.', '公開プロフィール、プロフィール画像などを管理します。'],
    ['Manage two-factor authentication and security.', '2要素認証などのセキュリティ設定を管理します。'],
    ['Manage two-factor authentication and account security.', '2要素認証などのセキュリティ設定を管理します。'],
    ['Update your public profile. To change your username or email, go to Your account.', '公開プロフィールを編集します。ユーザー名やメールアドレスを変更するには、アカウント設定を開いてください。'],
    ['Help protect your account from unauthorized access by requiring a second authentication method in addition to your password.', 'パスワードに加えて2つ目の認証方法を使用し、不正アクセスからアカウントを保護します。'],
    ['Your username was set when you created your account and cannot be changed here.', 'ユーザー名はアカウント作成時に設定されたため、ここでは変更できません。'],
    ['APPEARANCE', '外観'],
    ['Appearance', '外観'],
    ['System', 'システム'],
    ['Account information', 'アカウント情報'],
    ['Manage your account details and password.', 'アカウント情報やパスワードを管理します。'],
    ['Two-factor authentication', '2要素認証'],
    ['Add an extra layer of security to your account.', 'アカウントのセキュリティを強化します。'],
    ['Protect your account with an extra layer of security.', '2要素認証でアカウントのセキュリティを強化します。'],
    ['Display', '表示'],
    ['Manage your theme and appearance.', 'テーマや表示を管理します。'],
    ['AUTHENTICATION APP', '認証アプリ'],
    ['Authentication app', '認証アプリ'],
    ['Use an authentication app like Google Authenticator or Authy to generate verification codes.', 'Google AuthenticatorやAuthyなどの認証アプリを使用して認証コードを生成します。'],
    ['TEXT MESSAGE', 'SMS'],
    ['Text message', 'SMS'],
    ['Receive verification codes via SMS to your phone.', 'SMSで認証コードを受け取ります。'],
    ['Set up', '設定する'],
    ['See your account information like your username, email address, and phone number.', 'ユーザー名、メールアドレス、電話番号などのアカウント情報を確認できます。'],
    ['Phone', '電話番号'],
    ['DATE OF BIRTH', '生年月日'],
    ['Date of birth', '生年月日'],
    ['This information is not public. We use your age to customize your experience, including ads.', 'この情報は公開されません。年齢は、広告を含むTwitterでの表示内容をカスタマイズするために使用されます。'],
    ['Learn more', '詳細はこちら'],
    ['Edit', '編集'],
    ['Bio', '自己紹介'],
    ['Location', '場所'],
    ['Website', 'ウェブサイト'],
    ["This can only be changed a few times. Make sure you enter the age of the person using the account. Even if you're making an account for your business, event, or cat.", '変更できる回数には制限があります。アカウントを利用する本人の生年月日を入力してください。ビジネス、イベント、ペット用のアカウントの場合も同様です。'],

    ['Privacy', 'プライバシー'],
    ['Privacy and safety', 'プライバシーと安全'],
    ['Safety', '安全'],
    ['Security', 'セキュリティ'],

    ['Content', 'コンテンツ'],
    ['Content preferences', 'コンテンツ設定'],

    ['Sensitive content', 'センシティブなコンテンツ'],
    ['Show sensitive content', 'センシティブなコンテンツを表示'],
    ['Hide sensitive content', 'センシティブなコンテンツを非表示'],

    ['Push notifications', 'プッシュ通知'],
    ['Email notifications', 'メール通知'],
    ['Notification settings', '通知設定'],

    ['Language', '言語'],
    ['Languages', '言語'],
    ['Language settings', '言語設定'],
    ['English', '英語'],
    ['Japanese', '日本語'],

    ['Accessibility', 'アクセシビリティ'],
    ['Reduce motion', '動きを減らす'],

    ['Autoplay', '自動再生'],
    ['Autoplay videos', '動画を自動再生'],

    ['Muted accounts', 'ミュートしているアカウント'],
    ['Muted', 'ミュート済み'],
    ['Mute', 'ミュート'],

    ['Data', 'データ'],
    ['Data usage', 'データ利用'],

    ['Help', 'ヘルプ'],
    ['Help Center', 'ヘルプセンター'],
    ['Support', 'サポート'],
    ['Feedback', 'フィードバック'],

    ['Terms of Service', '利用規約'],
    ['Privacy Policy', 'プライバシーポリシー'],

    ['Save', '保存'],
    ['Saved', '保存しました'],
    ['Cancel', 'キャンセル'],
    ['Close', '閉じる'],
    ['Back', '戻る'],
    ['Done', '完了'],
    ['Confirm', '確認'],
    ['Delete', '削除'],

    ['Log out', 'ログアウト'],
    ['Logout', 'ログアウト'],
    ['Sign out', 'ログアウト'],

    ['Delete account', 'アカウントを削除'],
    ['Deactivate account', 'アカウントを停止'],

    ['Username', 'ユーザー名'],
    ['Display name', '表示名'],
    ['Name', '名前'],
    ['Email', 'メールアドレス'],
    ['Password', 'パスワード'],
    ['Change password', 'パスワードを変更'],

    ['On', 'オン'],
    ['Off', 'オフ'],
    ['Enabled', '有効'],
    ['Disabled', '無効'],

    ['Just now', 'たった今'],
    ['just now', 'たった今'],

    ['Report post', 'ツイートを報告'],
    ['Delete post', 'ツイートを削除'],

    ['Repost removed', 'リツイートを取り消しました'],
    ['Repost added', 'リツイートしました'],
    ['Post reposted', 'リツイートしました'],
    ['Retweet removed', 'リツイートを取り消しました'],

    ['Post liked', 'お気に入りに登録しました'],
    ['Like removed', 'お気に入りを解除しました'],

    ['Copied to clipboard', 'クリップボードにコピーしました'],
    ['Post deleted', 'ツイートを削除しました'],
    ['Post posted', 'ツイートしました'],

    ['mentioned you', 'あなたを@ツイートしました'],
    ['mentioned you in a post', 'あなたを@ツイートしました'],
    ['mentioned you in a tweet', 'あなたを@ツイートしました'],

    ['replied to your post', 'あなたのツイートに返信しました'],
    ['replied to your tweet', 'あなたのツイートに返信しました'],
    ['replied to you', 'あなたに返信しました'],

    ['liked your post', 'あなたのツイートをお気に入りに登録しました'],
    ['liked your tweet', 'あなたのツイートをお気に入りに登録しました'],
    ['favorited your post', 'あなたのツイートをお気に入りに登録しました'],
    ['favorited your tweet', 'あなたのツイートをお気に入りに登録しました'],

    ['reposted your post', 'あなたのツイートをリツイートしました'],
    ['reposted your tweet', 'あなたのツイートをリツイートしました'],
    ['retweeted your post', 'あなたのツイートをリツイートしました'],
    ['retweeted your tweet', 'あなたのツイートをリツイートしました'],

    ['followed you', 'あなたをフォローしました']
  ]);

  function installStyle() {
    if (document.getElementById('ct-jp-style')) {
      return;
    }

    const style = document.createElement('style');

    style.id = 'ct-jp-style';

    style.textContent = `
      [data-testid="tweet-like-action"] svg {
        display:none!important;
      }

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
        0% {
          transform:translateY(-1px) scale(.72) rotate(-8deg);
          opacity:.55;
        }

        48% {
          transform:translateY(-1px) scale(1.3) rotate(6deg);
        }

        74% {
          transform:translateY(-1px) scale(.94) rotate(-2deg);
        }

        100% {
          transform:translateY(-1px) scale(1);
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

      .ct-notification-fav-icon {
        position:relative!important;
      }

      .ct-notification-fav-icon > svg {
        visibility:hidden!important;
      }

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

      #ct-favorites-tab:hover {
        background:rgba(127,127,127,.08);
      }

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

      #ct-favorites-panel {
        border-radius:0 0 12px 12px;
      }

      #ct-reply-panel {
        border-radius:14px;
        max-height:min(48vh,460px);
      }

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

      .ct-local-title {
        font-weight:800;
      }

      .ct-local-note {
        font-size:11px;
        opacity:.6;
        margin-top:2px;
      }

      .ct-local-close {
        border:0;
        background:transparent;
        color:inherit;
        cursor:pointer;
        font-size:20px;
        padding:3px 8px;
        border-radius:999px;
      }

      .ct-local-close:hover {
        background:rgba(127,127,127,.14);
      }

      .ct-local-card {
        display:flex;
        gap:10px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        cursor:pointer;
      }

      .ct-local-card:hover {
        background:rgba(127,127,127,.08);
      }

      .ct-local-avatar {
        width:40px;
        height:40px;
        border-radius:999px;
        object-fit:cover;
        flex:0 0 auto;
        background:rgba(127,127,127,.25);
      }

      .ct-local-main {
        min-width:0;
        flex:1;
      }

      .ct-local-meta {
        display:flex;
        gap:4px;
        flex-wrap:wrap;
        align-items:center;
        font-size:13px;
        line-height:18px;
      }

      .ct-local-name {
        font-weight:800;
      }

      .ct-local-handle,
      .ct-local-time {
        opacity:.62;
      }

      .ct-local-text {
        margin-top:3px;
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        font-size:14px;
        line-height:20px;
      }

      .ct-local-empty {
        padding:28px 18px;
        text-align:center;
        opacity:.65;
      }

      .ct-reply-kicker {
        font-size:12px;
        color:#1d9bf0;
        margin-bottom:3px;
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

    (
      document.head ||
      document.documentElement
    ).appendChild(style);
  }

  function dynamicJP(t) {
    let m;


    // Notification grammar normalization
    if ((m = t.match(/^(.+?)さんがあなたを@ツイートしました$/))) {
      return `${m[1]}さんがあなた宛てにツイートしました`;
    }

    if ((m = t.match(/^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i))) {
      return `${m[1]}さんがあなた宛てにツイートしました`;
    }

    if ((m = t.match(/^(.+?)\s+quoted your (?:post|tweet)$/i))) {
      return `${m[1]}さんがあなたのツイートを引用しました`;
    }

    if ((m = t.match(/^Replying\s+to\s+(.+)$/i))) {
      const targets = m[1].replace(
        /(@[A-Za-z0-9_.-]{1,80})(?!さん)/g,
        '$1さん'
      );

      return `返信先: ${targets}`;
    }

if (/^just\s+now$/i.test(t)) {
      return 'たった今';
    }

    if ((m = t.match(/^(\d+)s$/))) {
      return `${m[1]}秒`;
    }

    if ((m = t.match(/^(\d+)m$/))) {
      return `${m[1]}分`;
    }

    if ((m = t.match(/^(\d+)h$/))) {
      return `${m[1]}時間`;
    }

    if ((m = t.match(/^(\d+)d$/))) {
      return `${m[1]}日`;
    }

    if ((m = t.match(/^Joined\s+(.+)$/i))) {
      return `${m[1]}からTwitterを利用しています`;
    }

    if ((m = t.match(/^(\d+)\s+codes?\s+remaining$/i))) {
      return `${m[1]}個のコードが残っています`;
    }

    if ((m = t.match(/^参加した人数\s+(.+)$/))) {
      return `${m[1]}からTwitterを利用しています`;
    }

    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Following$/i))) {
      return `${m[1]}人 フォロー中`;
    }

    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Followers?$/i))) {
      return `${m[1]}人 フォロワー`;
    }

    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Tweets?$/i))) {
      return `${m[1]} ツイート`;
    }

    if ((m = t.match(/^Logged in as\s+(.+)$/i))) {
      return `${m[1]}としてログイン中`;
    }

    if ((m = t.match(/^Version\s+(.+)$/i))) {
      return `バージョン ${m[1]}`;
    }

    if ((m = t.match(/^and\s+(\d+)\s+others?$/i))) {
      return `とそのほか${m[1]}人`;
    }

    if ((m = t.match(/^(\d+)\s+others?$/i))) {
      return `そのほか${m[1]}人`;
    }

    return null;
  }

  function actorJP(s) {
    return clean(s)
      .replace(/\s+and\s+/gi, '、')
      .replace(/\s*,\s*/g, '、')
      .split('、')
      .map(x =>
        clean(x).replace(/さん$/, '')
      )
      .filter(Boolean)
      .map(x => `${x}さん`)
      .join('と');
  }

  function translateNotification(t) {
    t = clean(t);

    if (!t) {
      return null;
    }

    let m;

    const many = [
      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+(?:liked|favorited) your (?:post|tweet)$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたのツイートをお気に入りに登録しました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたのツイートをリツイートしました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+followed you$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたをフォローしました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+mentioned you(?: in a (?:post|tweet))?$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたを@ツイートしました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+replied to (?:your (?:post|tweet)|you)$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたのツイートに返信しました`
      ]
    ];

    for (const [re, fn] of many) {
      if ((m = t.match(re))) {
        return fn(
          m[1],
          m[2]
        );
      }
    }

    const one = [
      [
        /^(.+?)\s+(?:liked|favorited) your (?:post|tweet)$/i,
        a =>
          `${actorJP(a)}があなたのツイートをお気に入りに登録しました`
      ],

      [
        /^(.+?)\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        a =>
          `${actorJP(a)}があなたのツイートをリツイートしました`
      ],

      [
        /^(.+?)\s+followed you$/i,
        a =>
          `${actorJP(a)}があなたをフォローしました`
      ],

      [
        /^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i,
        a =>
          `${actorJP(a)}があなたを@ツイートしました`
      ],

      [
        /^(.+?)\s+replied to your (?:post|tweet)$/i,
        a =>
          `${actorJP(a)}があなたのツイートに返信しました`
      ],

      [
        /^(.+?)\s+replied to you$/i,
        a =>
          `${actorJP(a)}があなたに返信しました`
      ],

      [
        /^(.+?)\s+(?:liked|favorited) your reply$/i,
        a =>
          `${actorJP(a)}があなたの返信をお気に入りに登録しました`
      ],

      [
        /^(.+?)\s+(?:reposted|retweeted) your reply$/i,
        a =>
          `${actorJP(a)}があなたの返信をリツイートしました`
      ]
    ];

    for (const [re, fn] of one) {
      if ((m = t.match(re))) {
        return fn(
          m[1]
        );
      }
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
          (JP.has(clean(title.textContent)) || [...JP.values()].includes(clean(title.textContent)));
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
        const out = JP.get(value);
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
    const relative = isNativeLocalizationTimestamp(node.parentElement) && text.match(/^(\d+)([smhd])$/);
    const units = { s: '秒前', m: '分前', h: '時間前', d: '日前' };
    const out = relative ? relative[1] + units[relative[2]] : JP.get(text);
    if (out && out !== text) replaceLocalizationText(node, out);
  }

  function patchUI(root = document) {
    localizationScopeNodes(root).forEach(translateTextNode);
    patchUIAttributes(root);
  }

  function notificationTextNodes(root = document) {
    return localizationScopeNodes(root).filter(node => localizationNotificationAction(node));
  }

  function nearestUsefulSibling(node, direction) {
    let current = direction < 0 ? node.previousSibling : node.nextSibling;
    while (current && !clean(current.textContent)) current = direction < 0 ? current.previousSibling : current.nextSibling;
    return current;
  }

  function patchNotificationConnectors(root = document) {
    patchNotificationGrammar(root);
  }

  function patchNotificationGrammar(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;
    for (const action of notificationTextNodes(root)) {
      const context = localizationNotificationAction(action);
      const paragraph = context.paragraph;
      // Mentions/quotes have a separate action paragraph and need no actor
      // particles. Never reach into a previous notification to find an actor.
      if (context.element === paragraph) continue;
      if (!/^(?:さん)?が?あなた/.test(clean(action.nodeValue))) continue;
      const actorElements = [...paragraph.children].filter(el => el.matches('span.font-extrabold'));
      if (!actorElements.length) continue;
      const siblings = [...paragraph.childNodes];
      const actionIndex = siblings.indexOf(context.element);
      if (actionIndex < 0) continue;
      const before = siblings.slice(0, actionIndex);
      const directText = before.filter(node => node.nodeType === Node.TEXT_NODE);
      for (const node of directText) {
        const text = clean(node.nodeValue);
        if (!text && node.nodeValue) node.nodeValue = '';
        else if (/^and$/i.test(text)) node.nodeValue = 'さんと';
        else if (text === ',') node.nodeValue = 'さん、';
        else {
          const together = text.match(/^and\s+(\d+)\s+others?$/i);
          if (together) replaceLocalizationText(node, `さんとそのほか${together[1]}人`);
        }
      }
      for (let i = 0; i < before.length; i++) {
        const node = before[i];
        if (node.nodeType !== Node.TEXT_NODE || !/^\d+$/.test(clean(node.nodeValue))) continue;
        const next = before.slice(i + 1).find(sibling => clean(sibling.textContent));
        if (next?.nodeType === Node.TEXT_NODE && /^others?$/i.test(clean(next.nodeValue))) {
          replaceLocalizationText(node, `そのほか${clean(node.nodeValue)}人`);
          next.nodeValue = '';
        }
      }
      const actionText = clean(action.nodeValue);
      if (!/^あなた/.test(actionText)) continue;
      const previous = before.slice().reverse().find(node => clean(node.textContent));
      if (!previous) continue;
      const prefix = previous.nodeType === Node.TEXT_NODE && /そのほか\d+人$/.test(clean(previous.nodeValue)) ? 'が' : 'さんが';
      replaceLocalizationText(action, prefix + actionText);
    }
  }

  function patchNotificationParticles(root = document) {
    patchNotificationGrammar(root);
  }

  function patchNotificationFollowGrammar(root = document) {
    patchNotificationGrammar(root);
  }

  function patchReplyingTo(root = document) {
    for (const node of localizationScopeNodes(root)) {
      if (/^Replying to$/i.test(clean(node.nodeValue)) && isLocalizationUI(node)) {
        replaceLocalizationText(node, '返信先:');
      }
    }
  }

  function patchInputs(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const list = [];
    if (host instanceof Element && host.matches('input[placeholder],textarea[placeholder]')) list.push(host);
    host?.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));
    const placeholders = new Map([
      ["What's happening?", 'いまどうしてる？'], ["What's happening?!", 'いまどうしてる？'],
      ['What’s happening?', 'いまどうしてる？'], ['Post your reply', '返信をツイート'],
      ['Add your thoughts', 'コメントを追加…'], ['Add your thoughts...', 'コメントを追加…'],
      ['Add your thoughts…', 'コメントを追加…'], ['Create a post', 'ツイートを作成'],
      ['Search', '検索'], ['Search Tweet', 'Tweetを検索'], ['Search Twitter', 'Twitterを検索']
    ]);
    for (const el of list) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]')) continue;
      const value = el.getAttribute('placeholder');
      const out = placeholders.get(value) || JP.get(value);
      if (out && out !== value) el.setAttribute('placeholder', out);
    }
  }


  function userFromHref(
    href
  ) {
    try {
      const m =
        new URL(
          href,
          location.origin
        )
          .pathname
          .match(
            /^\/user\/([^/?#]+)/i
          );

      return m
        ? validUser(
            decodeURIComponent(
              m[1]
            )
          )
        : null;

    } catch {
      return null;
    }
  }

  function articleAuthor(
    article
  ) {
    if (!article) {
      return null;
    }

    for (
      const el of
      article.querySelectorAll(
        'button[aria-label],a[href],span,div'
      )
    ) {
      let m =
        (
          el.getAttribute?.(
            'aria-label'
          ) || ''
        )
          .match(
            /^View @(.+?)'s profile$/i
          );

      if (m) {
        return validUser(
          m[1]
        );
      }

      const user =
        userFromHref(
          el.getAttribute?.(
            'href'
          ) || ''
        );

      if (user) {
        return user;
      }

      if (
        !el.children.length &&
        (
          m =
            clean(
              el.textContent
            )
              .match(
                /^@([A-Za-z0-9_.-]{1,80})$/
              )
        )
      ) {
        return validUser(
          m[1]
        );
      }
    }

    return null;
  }


  function collectArticles(
    root =
      document
  ) {
    const set =
      new Set();

    if (
      root instanceof Element
    ) {
      if (
        root.matches(
          'article'
        )
      ) {
        set.add(
          root
        );
      }

      const parent =
        root.closest(
          'article'
        );

      if (parent) {
        set.add(
          parent
        );
      }
    }

    root.querySelectorAll?.(
      'article'
    )
      .forEach(
        article =>
          set.add(
            article
          )
      );

    return set;
  }

  function patchFeed(
    root =
      document
  ) {
    for (
      const article of
      collectArticles(
        root
      )
    ) {
      patchArticle(
        article
      );
    }
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
      if (text === 'You reposted') replaceLocalizationText(node, 'あなたがリツイートしました');
      else {
        const match = text.match(/^(@?[A-Za-z0-9_.-]{1,80})\s+reposted$/i);
        if (match) replaceLocalizationText(node, `${match[1]}さんがリツイートしました`);
      }
    }
  }

  function routeUser() {
    const m =
      location.pathname
        .match(
          /^\/user\/([^/?#]+)/i
        );

    return m
      ? validUser(
          decodeURIComponent(
            m[1]
          )
        )
      : null;
  }

  function ownProfileUser() {
    if (
      location.pathname !==
      '/profile'
    ) {
      return null;
    }

    for (
      const el of
      document.querySelectorAll(
        'main span,main a,main div,main p'
      )
    ) {
      if (
        el.children.length
      ) {
        continue;
      }

      const r =
        el.getBoundingClientRect();

      if (
        r.top < 30 ||
        r.top > 520
      ) {
        continue;
      }

      const m =
        clean(
          el.textContent
        )
          .match(
            /^@([A-Za-z0-9_.-]{1,80})$/
          );

      if (m) {
        return validUser(
          m[1]
        );
      }
    }

    return null;
  }


  function articleText(
    article
  ) {
    return (
      [
        ...article.querySelectorAll(
          'p,div[dir="auto"],span'
        )
      ]
        .filter(
          el =>
            !el.children.length
        )
        .map(
          el =>
            clean(
              el.textContent
            )
        )
        .filter(
          t =>
            t.length > 2 &&
            !/^@/.test(t) &&
            !/^\d+[smhd]$/.test(t) &&
            !JP.has(t)
        )
        .sort(
          (a, b) =>
            b.length -
            a.length
        )[0]
      ||
      ''
    );
  }

  function articleAvatar(
    article
  ) {
    return (
      article.querySelector(
        'img[src*="avatar"],img[alt*="profile" i]'
      )
        ?.src
      ||
      ''
    );
  }


  function loadFavorites() {
    const items =
      loadJSON(
        KEY.favorites,
        []
      );

    return Array.isArray(
      items
    )
      ? items
      : [];
  }

  function saveFavorite(
    item
  ) {
    if (
      !item?.id
    ) {
      return;
    }

    saveJSON(
      KEY.favorites,
      [
        item,
        ...loadFavorites()
          .filter(
            x =>
              x.id !==
              item.id
          )
      ]
        .slice(
          0,
          500
        )
    );
  }

  function removeFavorite(
    id
  ) {
    saveJSON(
      KEY.favorites,
      loadFavorites()
        .filter(
          x =>
            x.id !== id
        )
    );
  }

  document.addEventListener(
    'click',
    event => {
      const button =
        event.target
          .closest?.(
            '[data-testid="tweet-like-action"]'
          );

      if (!button) {
        return;
      }

      const article =
        button.closest(
          'article'
        );

      if (!article) {
        return;
      }

      const snapshot =
        snapshotFavorite(
          article
        );

      const wasLiked =
        ctIsLiked(button);

      button.classList.remove(
        'ct-star-pop'
      );

      void button.offsetWidth;

      button.classList.add(
        'ct-star-pop'
      );

      setTimeout(
        () =>
          button.classList.remove(
            'ct-star-pop'
          ),
        380
      );

      setTimeout(
        () => {
          const nowLiked =
            ctIsLiked(button);

          if (
            !wasLiked &&
            nowLiked
          ) {
            saveFavorite(
              snapshot
            );
          }

          else if (
            wasLiked &&
            !nowLiked
          ) {
            removeFavorite(
              snapshot?.id
            );
          }

          if (
            favoritesActive
          ) {
            renderFavoritesPanel();
          }
        },
        450
      );
    },
    true
  );


  let favoritesActive =
    false;

  function findRepostTab() {
    if (
      location.pathname !==
      '/profile'
    ) {
      return null;
    }

    return (
      [
        ...document.querySelectorAll(
          'main a,main button,main [role="tab"]'
        )
      ]
        .find(
          el =>
            /^(Reposts|Retweets|リツイート)$/i
              .test(
                clean(
                  el.textContent
                )
              )
        )
      ||
      null
    );
  }

  function patchFavoriteProfileTab() {
    let tab =
      document.getElementById(
        'ct-favorites-tab'
      );

    if (
      location.pathname !==
      '/profile'
    ) {
      tab?.remove();

      favoritesActive =
        false;

      closeFavoritesPanel();

      return;
    }

    const ref =
      findRepostTab();

    if (!ref) {
      tab?.remove();
      return;
    }

    if (!tab) {
      tab =
        document.createElement(
          'button'
        );

      tab.id =
        'ct-favorites-tab';

      tab.type =
        'button';

      tab.textContent =
        'お気に入り';

      const parent =
        ref.parentElement;

      if (!parent) {
        return;
      }

      parent.appendChild(
        tab
      );

      tab.onclick =
        event => {
          event.preventDefault();
          event.stopPropagation();

          favoritesActive =
            !favoritesActive;

          tab.dataset.active =
            favoritesActive
              ? '1'
              : '0';

          renderFavoritesPanel();
        };
    }

    tab.dataset.active =
      favoritesActive
        ? '1'
        : '0';
  }

  function centerRect() {
    const main =
      document.querySelector(
        'main'
      );

    if (!main) {
      return null;
    }

    const r =
      main.getBoundingClientRect();

    return r.width > 280
      ? r
      : null;
  }

  function panelHead(
    title,
    note,
    onClose
  ) {
    const head =
      document.createElement(
        'div'
      );

    head.className =
      'ct-local-head';

    const left =
      document.createElement(
        'div'
      );

    const titleEl =
      document.createElement(
        'div'
      );

    titleEl.className =
      'ct-local-title';

    titleEl.textContent =
      title;

    left.appendChild(
      titleEl
    );

    if (note) {
      const noteEl =
        document.createElement(
          'div'
        );

      noteEl.className =
        'ct-local-note';

      noteEl.textContent =
        note;

      left.appendChild(
        noteEl
      );
    }

    const close =
      document.createElement(
        'button'
      );

    close.className =
      'ct-local-close';

    close.textContent =
      '×';

    close.onclick =
      onClose;

    head.append(
      left,
      close
    );

    return head;
  }

  function localCard(
    item,
    reply =
      false
  ) {
    const row =
      document.createElement(
        'div'
      );

    row.className =
      'ct-local-card';

    if (
      item.avatar ||
      item.authorAvatar
    ) {
      const img =
        document.createElement(
          'img'
        );

      img.className =
        'ct-local-avatar';

      img.src =
        item.avatar ||
        item.authorAvatar;

      row.appendChild(
        img
      );
    }

    const main =
      document.createElement(
        'div'
      );

    main.className =
      'ct-local-main';

    if (reply) {
      const kicker =
        document.createElement(
          'div'
        );

      kicker.className =
        'ct-reply-kicker';

      kicker.textContent =
        'あなたのツイートに返信しました';

      main.appendChild(
        kicker
      );
    }

    const meta =
      document.createElement(
        'div'
      );

    meta.className =
      'ct-local-meta';

    const name =
      document.createElement(
        'span'
      );

    name.className =
      'ct-local-name';

    name.textContent =
      item.name
      ||
      item.authorName
      ||
      item.username
      ||
      item.authorUsername
      ||
      '';

    meta.appendChild(
      name
    );

    const username =
      item.username
      ||
      item.authorUsername;

    if (username) {
      const handle =
        document.createElement(
          'span'
        );

      handle.className =
        'ct-local-handle';

      handle.textContent =
        `@${username}`;

      meta.appendChild(
        handle
      );
    }

    main.appendChild(
      meta
    );

    if (item.text) {
      const text =
        document.createElement(
          'div'
        );

      text.className =
        'ct-local-text';

      text.textContent =
        item.text;

      main.appendChild(
        text
      );
    }

    row.appendChild(
      main
    );

    return row;
  }

  function closeFavoritesPanel() {
    document.getElementById(
      'ct-favorites-panel'
    )
      ?.remove();
  }

  function renderFavoritesPanel() {
    if (
      !favoritesActive ||
      location.pathname !==
        '/profile'
    ) {
      closeFavoritesPanel();
      return;
    }

    const r =
      centerRect();

    if (!r) {
      return;
    }

    let panel =
      document.getElementById(
        'ct-favorites-panel'
      );

    if (!panel) {
      panel =
        document.createElement(
          'section'
        );

      panel.id =
        'ct-favorites-panel';

      document.body.appendChild(
        panel
      );
    }

    panel.style.left =
      `${Math.round(
        r.left
      )}px`;

    panel.style.top =
      `${
        Math.max(
          100,
          Math.round(
            r.top + 88
          )
        )
      }px`;

    panel.style.width =
      `${Math.round(
        r.width
      )}px`;

    panel.style.maxHeight =
      `calc(100vh - ${
        Math.max(
          110,
          Math.round(
            r.top + 100
          )
        )
      }px)`;

    panel.innerHTML =
      '';

    panel.appendChild(
      panelHead(
        '★ お気に入り',
        'このブラウザだけに保存されます',

        () => {
          favoritesActive =
            false;

          const tab =
            document.getElementById(
              'ct-favorites-tab'
            );

          if (tab) {
            tab.dataset.active =
              '0';
          }

          closeFavoritesPanel();
        }
      )
    );

    const data =
      loadFavorites();

    if (!data.length) {
      const empty =
        document.createElement(
          'div'
        );

      empty.className =
        'ct-local-empty';

      empty.textContent =
        'お気に入りはまだありません。';

      panel.appendChild(
        empty
      );

      return;
    }

    for (const item of data) {
      const row =
        localCard(
          item,
          false
        );

      row.onclick =
        () => {
          if (item.href) {
            location.href =
              item.href;
          }
        };

      panel.appendChild(
        row
      );
    }
  }

  function notificationLeaves(root = document) {
    return [...new Set(notificationTextNodes(root).map(node => node.parentElement))];
  }

  function patchNotifications(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;
    for (const node of notificationTextNodes(root)) {
      const context = localizationNotificationAction(node);
      translateTextNode(node);
      if (/お気に入りに登録しました/.test(clean(node.nodeValue))) {
        context.row.querySelector('svg')?.parentElement?.classList.add('ct-notification-fav-icon');
      }
    }
    patchNotificationGrammar(root);
  }


  function authJSON(
    path,
    auth
  ) {
    if (
      !auth?.token
    ) {
      return Promise.resolve(
        null
      );
    }

    return requestJSON(
      path.startsWith(
        'http'
      )
        ? path
        : API_ORIGIN + path,

      {
        Authorization:
          `Bearer ${auth.token}`
      }
    );
  }

  function items(
    json,
    keys = []
  ) {
    if (
      Array.isArray(
        json
      )
    ) {
      return json;
    }

    if (
      !json ||
      typeof json !==
        'object'
    ) {
      return [];
    }

    for (
      const key of
      [
        ...keys,
        'items',
        'notifications',
        'posts',
        'replies',
        'results'
      ]
    ) {
      if (
        Array.isArray(
          json[key]
        )
      ) {
        return json[key];
      }
    }

    return json.data
      ? items(
          json.data,
          keys
        )
      : [];
  }

  const postId =
    post =>
      String(
        post?.originalPostId
        ||
        post?.postId
        ||
        post?.id
        ||
        ''
      )
        .trim();

  const replyCount =
    post =>
      Number(
        post?.replyCount
        ??
        post?.comments
        ??
        post?.commentCount
        ??
        post?.repliesCount
        ??
        post?.reply_count
        ??
        0
      )
      ||
      0;

  const author =
    post =>
      validUser(
        post?.authorUsername
        ||
        post?.authorHandle
        ||
        post?.author?.username
        ||
        post?.username
      );

  const postText =
    post =>
      String(
        post?.text
        ||
        post?.body
        ||
        post?.content
        ||
        post?.replyText
        ||
        ''
      );

  const postName =
    post =>
      String(
        post?.authorName
        ||
        post?.actorName
        ||
        post?.author?.displayName
        ||
        author(post)
        ||
        ''
      );

  const postAvatar =
    post =>
      String(
        post?.authorAvatar
        ||
        post?.actorAvatar
        ||
        post?.author?.avatarUrl
        ||
        post?.avatarUrl
        ||
        ''
      );

  const postCreated =
    post =>
      String(
        post?.createdAt
        ||
        post?.created_at
        ||
        post?.timestamp
        ||
        ''
      );

  function loadReplyNotices() {
    const list =
      loadJSON(
        KEY.replyNotices,
        []
      );

    return Array.isArray(
      list
    )
      ? list
      : [];
  }

  function saveReplyNotice(
    reply,
    parentId = ''
  ) {
    const id =
      postId(
        reply
      );

    const username =
      author(
        reply
      );

    if (
      !id ||
      !username
    ) {
      return;
    }

    const list =
      loadReplyNotices();

    const old =
      list.find(
        x =>
          x.id === id
      );

    const record = {
      id,

      parentId:
        String(
          reply?.parentPostId
          ||
          reply?.parentId
          ||
          parentId
          ||
          ''
        ),

      authorUsername:
        username,

      authorName:
        postName(reply)
        ||
        username,

      authorAvatar:
        postAvatar(reply),

      text:
        postText(reply),

      createdAt:
        postCreated(reply)
        ||
        new Date()
          .toISOString(),

      detectedAt:
        Date.now(),

      read:
        old?.read || false
    };

    saveJSON(
      KEY.replyNotices,
      [
        record,
        ...list.filter(
          x =>
            x.id !== id
        )
      ]
        .sort(
          (a, b) =>
            new Date(
              b.createdAt ||
              b.detectedAt
            )
            -
            new Date(
              a.createdAt ||
              a.detectedAt
            )
        )
        .slice(
          0,
          100
        )
    );
  }

  function markReplyRead(
    id
  ) {
    const list =
      loadReplyNotices();

    list.forEach(
      item => {
        if (
          item.id === id
        ) {
          item.read =
            true;
        }
      }
    );

    saveJSON(
      KEY.replyNotices,
      list
    );
  }

  let replyBusy =
    false;

  let lastFull =
    0;

  async function replyWatchTick() {
    if (replyBusy) {
      return;
    }

    replyBusy =
      true;

    try {
      const auth =
        await getAuth();

      if (
        !auth?.token
      ) {
        return;
      }

      const me =
        await authJSON(
          '/api/user-profile',
          auth
        );

      const myHandle =
        validUser(
          me?.username
          ||
          me?.handle
          ||
          me?.user?.username
          ||
          me?.profile?.username
        );

      const notificationsJson =
        await authJSON(
          '/api/notifications?limit=50',
          auth
        );

      for (
        const notification of
        items(
          notificationsJson,
          ['notifications']
        )
      ) {
        const type =
          String(
            notification?.type
            ||
            notification?.eventType
            ||
            notification?.kind
            ||
            notification?.notificationType
            ||
            ''
          )
            .toUpperCase();

        const message =
          String(
            notification?.message
            ||
            notification?.text
            ||
            ''
          );

        if (
          !type.includes(
            'REPLY'
          )
          &&
          !/replied to|返信/i.test(
            message
          )
        ) {
          continue;
        }

        const object =
          notification?.reply
          ||
          notification?.post
          ||
          notification?.tweet
          ||
          notification;

        const id =
          postId(
            object
          )
          ||
          String(
            notification?.postId
            ||
            notification?.replyPostId
            ||
            notification?.id
            ||
            ''
          );

        const username =
          validUser(
            notification?.actorHandle
            ||
            notification?.actorUsername
            ||
            notification?.actor?.username
            ||
            author(
              object
            )
          );

        if (
          id &&
          username
        ) {
          saveReplyNotice(
            {
              ...object,

              id,

              authorUsername:
                username,

              authorName:
                notification?.actorName
                ||
                notification?.actorDisplayName
                ||
                notification?.actor?.displayName
                ||
                postName(
                  object
                )
                ||
                username,

              authorAvatar:
                notification?.actorAvatar
                ||
                notification?.actor?.avatarUrl
                ||
                postAvatar(
                  object
                ),

              text:
                notification?.replyText
                ||
                notification?.postText
                ||
                postText(
                  object
                ),

              createdAt:
                notification?.createdAt
                ||
                notification?.created_at
                ||
                postCreated(
                  object
                )
            },

            notification?.parentPostId
            ||
            notification?.targetPostId
            ||
            ''
          );
        }
      }

      if (!myHandle) {
        renderReplyPanel();
        patchReplyBadge();
        return;
      }

      const [
        postsJson,
        repliesJson
      ] =
        await Promise.all([
          authJSON(
            `/api/users/${
              encodeURIComponent(
                myHandle
              )
            }/posts?limit=24`,
            auth
          ),

          authJSON(
            `/api/users/${
              encodeURIComponent(
                myHandle
              )
            }/replies`,
            auth
          )
        ]);

      const parents =
        [
          ...items(
            postsJson,
            ['posts']
          ),

          ...items(
            repliesJson,
            ['replies']
          )
        ]
          .filter(
            post =>
              postId(post)
              &&
              replyCount(post) > 0
          )
          .sort(
            (a, b) =>
              new Date(
                postCreated(b) || 0
              )
              -
              new Date(
                postCreated(a) || 0
              )
          )
          .slice(
            0,
            24
          );

      const counts =
        loadJSON(
          KEY.replyCounts,
          {}
        );

      const seen =
        new Set(
          loadJSON(
            KEY.replySeen,
            []
          )
        );

      const initialized =
        localStorage.getItem(
          KEY.replyInit
        ) === '1';

      const force =
        Date.now()
        -
        lastFull
        >
        10 *
        60 *
        1000;

      if (force) {
        lastFull =
          Date.now();
      }

      for (
        const parent of
        parents
      ) {
        const pid =
          postId(
            parent
          );

        const count =
          replyCount(
            parent
          );

        if (
          !force &&
          initialized &&
          counts[pid] === count
        ) {
          continue;
        }

        const replyJson =
          await authJSON(
            `/api/posts/${
              encodeURIComponent(
                pid
              )
            }/replies?limit=50`,
            auth
          );

        for (
          const reply of
          items(
            replyJson,
            ['replies']
          )
        ) {
          const rid =
            postId(
              reply
            );

          if (
            !rid ||
            seen.has(
              rid
            )
          ) {
            continue;
          }

          const username =
            author(
              reply
            );

          if (
            !username
            ||
            normUser(
              username
            ) ===
              normUser(
                myHandle
              )
          ) {
            seen.add(
              rid
            );

            continue;
          }

          if (initialized) {
            saveReplyNotice(
              reply,
              pid
            );
          }

          seen.add(
            rid
          );
        }

        counts[pid] =
          count;
      }

      saveJSON(
        KEY.replyCounts,
        counts
      );

      saveJSON(
        KEY.replySeen,
        [...seen]
          .slice(
            -3000
          )
      );

      localStorage.setItem(
        KEY.replyInit,
        '1'
      );

      renderReplyPanel();
      patchReplyBadge();

    } catch(error) {
      console.debug(
        '[Classic Twitter JP reply watcher]',
        error
      );

    } finally {
      replyBusy =
        false;
    }
  }

  function closeReplyPanel() {
    document.getElementById(
      'ct-reply-panel'
    )
      ?.remove();
  }

  function renderReplyPanel() {
    if (
      !location.pathname.startsWith(
        '/notifications'
      )
    ) {
      closeReplyPanel();
      return;
    }

    const data =
      loadReplyNotices()
        .filter(
          item =>
            !item.read
        );

    if (!data.length) {
      closeReplyPanel();
      return;
    }

    const r =
      centerRect();

    if (!r) {
      return;
    }

    let panel =
      document.getElementById(
        'ct-reply-panel'
      );

    if (!panel) {
      panel =
        document.createElement(
          'section'
        );

      panel.id =
        'ct-reply-panel';

      document.body.appendChild(
        panel
      );
    }

    panel.style.left =
      `${Math.round(
        r.left + 12
      )}px`;

    panel.style.top =
      `${
        Math.max(
          90,
          Math.round(
            r.top + 80
          )
        )
      }px`;

    panel.style.width =
      `${
        Math.max(
          280,
          Math.round(
            r.width - 24
          )
        )
      }px`;

    panel.innerHTML =
      '';

    panel.appendChild(
      panelHead(
        '↩ 新しい返信',
        'tweet.app本体で表示されない返信を補完しています',

        () => {
          data.forEach(
            item =>
              markReplyRead(
                item.id
              )
          );

          closeReplyPanel();
          patchReplyBadge();
        }
      )
    );

    for (
      const item of
      data
    ) {
      const row =
        localCard(
          item,
          true
        );

      row.onclick =
        () => {
          markReplyRead(
            item.id
          );

          if (item.id) {
            location.href =
              `/post/${
                encodeURIComponent(
                  item.id
                )
              }`;
          }

          renderReplyPanel();
          patchReplyBadge();
        };

      panel.appendChild(
        row
      );
    }
  }

  function patchReplyBadge() {
    const count =
      loadReplyNotices()
        .filter(
          item =>
            !item.read
        )
        .length;

    let badge =
      document.getElementById(
        'ct-reply-badge'
      );

    const link =
      [
        ...document.querySelectorAll(
          'a,button'
        )
      ]
        .find(
          el =>
            /^(Notifications|通知)$/i
              .test(
                clean(
                  el.textContent
                )
              )
        );

    if (
      !count ||
      !link
    ) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge =
        document.createElement(
          'div'
        );

      badge.id =
        'ct-reply-badge';

      document.body.appendChild(
        badge
      );
    }

    const r =
      link.getBoundingClientRect();

    badge.textContent =
      String(
        count
      );

    badge.style.left =
      `${Math.round(
        r.right - 8
      )}px`;

    badge.style.top =
      `${Math.round(
        r.top + 2
      )}px`;
  }


  function patchComposeJapanese(root = document) {
    for (const node of localizationScopeNodes(root)) {
      if (!isLocalizationUI(node)) continue;
      const text = clean(node.nodeValue);
      const button = node.parentElement.closest('button');
      if (text === '今どうしてる？') replaceLocalizationText(node, 'いまどうしてる？');
      // Change only a composer submit/navigation control, preserving its icon
      // and React-managed children rather than assigning button.textContent.
      if (text === 'ツイート' && button && (
        button.id === 'public-sidebar-compose-btn' ||
        button.closest('form,[role="dialog"]')?.querySelector('textarea')
      )) replaceLocalizationText(node, 'ツイートする');
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

      // Only add the X-style timestamp to the Tweet detail/conversation view.
      // Feed cards keep their compact relative timestamp.
      const path = location.pathname;
      const isDetail = /\/status\/|\/post\/|\/posts\//i.test(path) ||
        !!article.querySelector('[data-testid*="reply" i] textarea, textarea[placeholder*="reply" i]');
      if (!isDetail) continue;
      if (article.querySelector('.ct-detail-post-time')) continue;

      const timeEl = article.querySelector('time[datetime]');
      let date = timeEl ? new Date(timeEl.getAttribute('datetime') || '') : null;

      if (!date || Number.isNaN(date.getTime())) {
        const candidates = [...article.querySelectorAll('[title],[datetime]')];
        for (const el of candidates) {
          const raw = el.getAttribute('datetime') || el.getAttribute('title') || '';
          const d = new Date(raw);
          if (!Number.isNaN(d.getTime())) { date = d; break; }
        }
      }
      if (!date || Number.isNaN(date.getTime())) continue;

      const stamp = document.createElement('div');
      stamp.className = 'ct-detail-post-time';
      const timeText = new Intl.DateTimeFormat('ja-JP', {
        hour:'2-digit', minute:'2-digit', hour12:false
      }).format(date);
      const dateText = new Intl.DateTimeFormat('ja-JP', {
        year:'numeric', month:'long', day:'numeric'
      }).format(date);
      stamp.textContent = `${dateText} · ${timeText}`;

      // Put it below the Tweet body/media and above the action row when possible.
      const actions = [...article.querySelectorAll('button')].map(b => b.parentElement)
        .find(el => el && /reply|返信|repost|retweet|リツイート|like|お気に入り/i.test(el.textContent || ''));
      if (actions?.parentElement) actions.parentElement.insertBefore(stamp, actions);
      else article.append(stamp);
    }
  }

  function patchProfileJoinedDate(root = document) {
    if (!/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname)) return;
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (isProtectedLocalizationElement(el) || el.closest('article')) continue;
      // The profile metadata uses a calendar icon. Location/bio/name strings
      // resembling "Joined ..." must never be interpreted as metadata.
      if (!el.matches('span.inline-flex') || !el.querySelector('svg.lucide-calendar')) continue;
      const text = clean(node.nodeValue);
      if (/^(?:Joined|参加した人数)$/i.test(text)) replaceLocalizationText(node, '登録日:');
      else if (/^Joined\s+/i.test(text)) replaceLocalizationText(node, text.replace(/^Joined\s+/i, '登録日: '));
    }
  }

  function patchInviteJoinedLabels(root = document) {
    if (!location.pathname.startsWith('/settings')) return;
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (clean(node.nodeValue) !== 'Joined' || isProtectedLocalizationElement(el)) continue;
      if (el.matches('dt') && el.closest('dl')) replaceLocalizationText(node, '参加した人数');
    }
  }


  function scan(
    root =
      document
  ) {
    try {
      installStyle();
      if (typeof installSafariStyle === 'function') installSafariStyle();
      if (typeof patchMediaInfo === 'function') patchMediaInfo(root);

      patchUI(
        root
      );

      patchReplyingTo(root);

      patchInputs(
        root
      );

      patchNotifications(
        root
      );

      patchFavoriteButtons(
        root
      );

      patchFeed(
        root
      );

      patchRetweetRows(
        root
      );
      patchComposeJapanese(root);
      patchNotificationFollowGrammar(root);
      patchAutoTranslation(root, 'ja');
      patchExactPostTime(root);
      patchInviteJoinedLabels(root);
      patchProfileJoinedDate(root);

      patchProfileFounder();

      patchFavoriteProfileTab();

      if (
        favoritesActive
      ) {
        renderFavoritesPanel();
      }

      renderReplyPanel();

      patchReplyBadge();

    } catch(error) {
      console.debug(
        '[Classic Twitter JP]',
        error
      );
    }
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once: true
      }
    );

  } else {
    start();
  }

  console.log(
    '🐦 Classic Twitter JP v6.7.1 loaded'
  );
})();
