// ==UserScript==
// @name         Classic Twitter for tweet.app - English
// @namespace    https://tweet.app/
// @version      6.10.0
// @description  Classic blue Twitter layout and vector star Favorites, responsive desktop/mobile styling and reduced-motion-aware feedback. Preserves posts, replies, badges, photo slides, Japan/world news, safer translation and local tools.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
// @connect      news.yahoo.co.jp

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

  /* Local-only additions. Embedded by the build inside each userscript's IIFE. */
function installLocalEnhancements({ locale = 'ja', getClassicAppearance, setClassicAppearance, getAutoTranslate, setAutoTranslate, getTranslationEngine, setTranslationEngine, deviceTranslationSupported = false, prepareDeviceTranslation, getTranslationStatus } = {}) {
  const existing = document.getElementById('ct-local-tools');
  if (existing) return existing.ctController;
  const ja = locale.startsWith('ja');
  const copy = ja ? {
    tools: '便利ツール', title: '便利ツール', close: '閉じる',
    appearance: '昔のTwitterの表示', classic: 'クラシック表示を使う', classicHelp: '青いナビゲーションと星のお気に入り。オフにするとTweet標準のレイアウトに戻ります。動きを減らす端末設定にも対応します。',
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
    automatic: '投稿を自動翻訳する', autoHelp: '選択した方法で投稿を順番に翻訳します。サイトの翻訳でエラーが出た場合は5分間休止します。',
    autoError: '自動翻訳の設定を保存できませんでした。',
    translationEngine: '翻訳方法', nativeEngine: 'サイトの翻訳', deviceEngine: '端末内の翻訳',
    deviceHelp: '対応するデスクトップChrome用。翻訳モデルをダウンロードし、投稿本文は端末内で処理します。サイトの翻訳回数を消費しません。モデルは言語ごとに準備してください。',
    deviceUnsupported: 'このブラウザでは端末内翻訳を利用できません。Safari／Stayとスマートフォンではサイトの翻訳をご利用ください。',
    sourceLanguage: '翻訳する投稿の言語', prepareModel: 'モデルを準備', preparingModel: '準備中…',
    translationStatus: '翻訳の状態',

    bookmarks: '保存した投稿', bookmarkLabel: '投稿のメモ（任意）', bookmarkSave: 'この投稿を保存',
    bookmarkHelp: '投稿の詳細画面を開くと保存できます。最大 50 件。削除された投稿や非公開の投稿は閲覧できない場合があります。',
    noBookmarks: '保存した投稿はありません。', bookmarkMissing: '先に投稿の詳細画面を開いてください。',
    bookmarkFull: '投稿は 50 件まで、メモは 200 文字以内です。', bookmarkDuplicate: 'この投稿は保存済みです。',
    post: '投稿',
  } : {
    tools: 'Tools', title: 'Tools', close: 'Close',
    appearance: 'Classic Twitter appearance', classic: 'Use classic appearance', classicHelp: 'Blue navigation and star favorites. Turn off to restore Tweet’s native layout. Respects your reduced motion preference.',
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
    automatic: 'Automatically translate posts', autoHelp: 'Translates posts one at a time with the selected engine. Site errors pause automatic requests for 5 minutes.',
    autoError: 'Could not save the automatic translation setting.',
    translationEngine: 'Translation engine', nativeEngine: 'Site translation', deviceEngine: 'On-device translation',
    deviceHelp: 'For supported desktop Chrome browsers. Downloads models and translates post text on your device without using the site’s translation allowance. Prepare each source language separately.',
    deviceUnsupported: 'On-device translation is unavailable here. Use site translation in Safari/Stay and on mobile.',
    sourceLanguage: 'Language of posts to translate', prepareModel: 'Prepare model', preparingModel: 'Preparing…',
    translationStatus: 'Translation status',

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
  const controller = { root, panel, refresh, refreshTranslation, destroy() {
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
      .ct-classic-shell .ct-classic-tab {
        padding:11px 12px 8px!important;
        border:0!important;
        border-bottom:3px solid transparent!important;
        border-radius:0!important;
        background:transparent!important;
        color:var(--tl-app-text-muted)!important;
        font-size:13px;
        line-height:20px;
      }
      .ct-classic-shell .ct-classic-tab.bg-sky-500 {
        color:var(--ct-classic-blue)!important;
        border-bottom-color:var(--ct-classic-blue)!important;
        font-weight:700;
      }
      .ct-classic-shell .ct-classic-tab:hover {
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
        .ct-classic-shell .ct-classic-tab {
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

    for (const article of main.querySelectorAll('article')) {
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
    const wanted = new Map();
    if (enabled) {
      const shell = doc.querySelector('#root-container[data-app-theme="light"],#root-container[data-app-theme="dark"]');
      if (shell && !shell.closest(ctClassicExcluded)) {
        for (const [element, names] of ctClassicDesired(shell)) wanted.set(element, names);
      }
    }
    if (wanted.size && !ctClassicStyle(doc, state)) wanted.clear();
    for (const [element, record] of state.marked) {
      ctClassicRemoveClasses(element, record, wanted.get(element));
      if (!record.added.size) state.marked.delete(element);
    }
    for (const [element, names] of wanted) {
      let record = state.marked.get(element);
      for (const name of names) {
        if (element.classList.contains(name)) continue;
        if (!record) {
          record = { originalClass: element.getAttribute('class'), added: new Set() };
          state.marked.set(element, record);
        }
        element.classList.add(name);
        record.added.add(name);
      }
    }
    if (!wanted.size && state.style) {
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
    const classes = document.documentElement.classList;
    if (classes.contains('ct-classic-motion-enabled') !== ctClassicMotion.enabled) classes.toggle('ct-classic-motion-enabled', ctClassicMotion.enabled);
    if (classes.contains('ct-classic-motion-paused') !== paused) classes.toggle('ct-classic-motion-paused', paused);
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
        html ${controls}, html [data-testid="tweet-like-action"] > .ct-star,
        html #ct-local-tools-panel { animation:none!important; transition:none!important; }
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
    const notification = '#root-container main button.w-full.flex.items-start.border-b > div[class~="mt-0.5"].shrink-0 > svg.lucide-heart.text-rose-500[width="28"][height="28"]';
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
      ${notification} {
        background:#ffac33!important;
        -webkit-mask:${mask(true)} center/contain no-repeat;
        mask:${mask(true)} center/contain no-repeat;
      }
      ${notification} * { visibility:hidden!important; }
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
    document.documentElement.dataset.ctActiveVersion = '6.10.0';
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

    // Profile additions use Tweet's verified posts GET. Favorites are browser-local
  // snapshots, scoped to the signed-in account; no favorite-history endpoint is assumed.
  const ctProfileState = {
    path: '', user: '', uid: null, authSeen: undefined, accountUser: '', active: '', tablist: null,
    timeline: null, panel: null, sequence: 0, identityBusy: false, identityRetry: 0,
    nativeSelection: new Map(), tabsBound: new WeakSet(), rendered: '', media: null,
    storageBound: false, storageError: false, memory: new Map(), dirtyMemory: new Set(), viewer: null
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
    return [...new Map(data.filter(item => ctProfileId(item?.id)).slice(0, 500).map(item => [item.id, {
      id: item.id, username: ctProfileHandle(item.username) || '',
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : '',
      text: typeof item.text === 'string' ? item.text.slice(0, 10000) : '',
      avatar: ctProfileURL(item.avatar), savedAt: Number(item.savedAt) || 0,
      createdAt: typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : '',
      href: `${location.origin}/post/${encodeURIComponent(item.id)}`,
      media: Array.isArray(item.media) ? item.media.slice(0, 16).filter(asset =>
        ['image', 'video'].includes(asset?.type) && ctProfileURL(asset.url)).map(asset => ({
          type: asset.type, url: ctProfileURL(asset.url), poster: ctProfileURL(asset.poster)
        })) : []
    }])).values()];
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
    try {
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      ctProfileState.storageError = false; ctProfileState.dirtyMemory.delete(uid);
    } catch { ctProfileState.storageError = true; ctProfileState.dirtyMemory.add(uid); }
    if (favoritesActive) renderFavoritesPanel();
    return true;
  }
  function ctProfileSaveFavorite(item, expectedUid = ctProfileUID()) {
    if (!ctProfileId(item?.id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    return ctProfileWriteFavorites(expectedUid, [item, ...ctProfileLoadFavorites().filter(row => row.id !== item.id)].slice(0, 500));
  }
  function ctProfileRemoveFavorite(id, expectedUid = ctProfileUID()) {
    if (!ctProfileId(id) || !expectedUid || expectedUid !== ctProfileUID()) return false;
    return ctProfileWriteFavorites(expectedUid, ctProfileLoadFavorites().filter(row => row.id !== id));
  }
  function ctProfileLegacyFavorites() {
    try {
      // Old storage had no account identity. Import is explicit and remains
      // available only until its owner is recorded; the original data is retained.
      if (localStorage.getItem(KEY.favorites + ':owner')) return [];
      return ctProfileFavoriteItems(JSON.parse(localStorage.getItem(KEY.favorites) || '[]'));
    } catch { return []; }
  }
  function ctProfileImportFavorites() {
    const uid = ctProfileUID();
    const legacy = ctProfileLegacyFavorites();
    if (!uid || !legacy.length) return;
    try {
      const merged = [...ctProfileLoadFavorites(), ...legacy];
      const items = ctProfileFavoriteItems(merged).slice(0, 500);
      localStorage.setItem(ctProfileFavoriteKey(uid), JSON.stringify(items));
      localStorage.setItem(KEY.favorites + ':owner', uid);
      ctProfileState.memory.set(uid, items);
      ctProfileState.storageError = false;
    } catch { ctProfileState.storageError = true; }
    renderFavoritesPanel();
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
      // timeline. Never hide an unknown container, header, form or tab control.
      if (!timeline?.matches('div') || timeline.matches('[role],[data-ct-owned],[data-ct-local-ui]') ||
          timeline.querySelector('input,textarea,[role="form"]')) continue;
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
      .ct-profile-tab:focus-visible,.ct-profile-control:focus-visible,.ct-profile-photo:focus-visible{outline:2px solid #55acee;outline-offset:-3px}
      [data-ct-profile-panel]{position:relative!important;inset:auto!important;max-height:none!important;width:auto!important;max-width:100%;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:inherit!important;color:inherit;box-shadow:none!important;z-index:auto!important}
      .ct-profile-status{padding:12px 16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544);font-size:12px;color:var(--color-tl-app-text-muted,#657786);line-height:1.6}
      .ct-profile-empty{padding:32px 16px;text-align:center;color:var(--color-tl-app-text-muted,#657786);font-size:14px}
      .ct-profile-control{min-height:44px;padding:8px 14px;border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer;margin:4px 0}
      .ct-profile-control:disabled{cursor:wait;opacity:.6}
      .ct-profile-row{display:flex;gap:12px;padding:16px;border-bottom:1px solid var(--color-tl-app-border,#8b98a544)}
      .ct-profile-avatar{width:40px;height:40px;flex:none;border-radius:4px;object-fit:cover}
      .ct-profile-row-main{min-width:0;flex:1}
      .ct-profile-meta{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font-size:14px;line-height:20px}
      .ct-profile-name{font-weight:700;color:inherit;text-decoration:none}
      .ct-profile-handle,.ct-profile-time{font-size:12px;color:var(--color-tl-app-text-muted,#657786);text-decoration:none}
      .ct-profile-text{font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px}
      .ct-profile-gallery{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;border-radius:4px;scrollbar-width:thin}
      .ct-profile-photo{display:block;flex:0 0 100%;min-width:0;padding:0;background:var(--color-tl-app-bg,#f5f8fa);border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:4px;overflow:hidden;scroll-snap-align:start;cursor:zoom-in}
      .ct-profile-photo img{display:block;width:100%;height:auto;max-height:480px;object-fit:contain}
      .ct-profile-video{display:block;width:100%;max-height:480px;background:#000;border-radius:4px;margin:8px 0}
      .ct-profile-media-note{font-size:12px;color:var(--color-tl-app-text-muted,#657786);margin:6px 0}
      .ct-profile-post-link{display:inline-flex;align-items:center;min-height:44px;color:#55acee;font-size:13px;text-decoration:none}
      .ct-profile-post-link:hover,.ct-profile-name:hover{text-decoration:underline}
      .ct-profile-viewer{padding:0;border:0;background:#000;color:#fff;width:min(100vw,1000px);max-width:100vw;max-height:100dvh;overflow:auto}
      .ct-profile-viewer::backdrop{background:#000c}
      .ct-profile-viewer img{display:block;max-width:100%;max-height:calc(100dvh - 64px);object-fit:contain;margin:auto}
      .ct-profile-viewer-nav{display:flex;align-items:center;justify-content:space-between;padding:8px;gap:8px}
      .ct-profile-viewer-nav button{min-width:44px;min-height:44px;border:1px solid #ffffff55;border-radius:4px;color:inherit;background:transparent;font:inherit;cursor:pointer}
      @media(max-width:480px){.ct-profile-row{padding:12px;gap:10px}.ct-profile-photo img,.ct-profile-video{max-height:360px}}
      @media(prefers-reduced-motion:no-preference){.ct-profile-tab,.ct-profile-control{transition:color 120ms ease,background-color 120ms ease}}
    `;
    document.head.appendChild(style);
  }
  function ctProfileCloseViewer() {
    const viewer = ctProfileState.viewer;
    if (!viewer) return;
    ctProfileState.viewer = null;
    try { viewer.dialog.close(); } catch {}
    viewer.dialog.remove();
    if (viewer.trigger?.isConnected) viewer.trigger.focus({ preventScroll: true });
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
    const nav = document.createElement('div'); nav.className = 'ct-profile-viewer-nav';
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹';
    previous.setAttribute('aria-label', ctProfileText('前の写真', 'Previous photo'));
    const count = document.createElement('span'); count.setAttribute('aria-live', 'polite');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = '›';
    next.setAttribute('aria-label', ctProfileText('次の写真', 'Next photo'));
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', ctProfileText('閉じる', 'Close'));
    const show = () => {
      img.src = images[index].url;
      img.alt = ctProfileText(`写真 ${index + 1}/${images.length}`, `Photo ${index + 1}/${images.length}`);
      count.textContent = `${index + 1} / ${images.length}`;
      previous.disabled = index === 0; next.disabled = index === images.length - 1;
    };
    const move = step => { index = Math.max(0, Math.min(images.length - 1, index + step)); show(); };
    previous.onclick = () => move(-1); next.onclick = () => move(1); close.onclick = ctProfileCloseViewer;
    dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); ctProfileCloseViewer(); });
    nav.append(previous, count, next, close); dialog.append(img, nav); document.body.append(dialog);
    ctProfileState.viewer = { dialog, trigger };
    show();
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
    ctProfileState.sequence++;
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
      if (event.key === ctProfileFavoriteKey(ctProfileUID() || '') || event.key === KEY.favorites + ':owner') renderFavoritesPanel();
    });
    window.addEventListener('pagehide', ctProfileCloseViewer);
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
      ctProfileState.active = type; favoritesActive = type === 'favorites'; ctProfileState.rendered = '';
      ctProfileShow(context);
      if (type === 'media' && !ctProfileMediaState().started) ctProfileLoadMedia();
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
  function ctProfileControl(text, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ct-profile-control';
    button.textContent = text; button.onclick = action; return button;
  }
  function ctProfileRow(item) {
    const row = document.createElement('div'); row.className = 'ct-profile-row'; row.dataset.ctProfilePost = item.id;
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
    if (Number.isFinite(Date.parse(item.createdAt))) {
      const time = document.createElement('time'); time.className = 'ct-profile-time'; time.dateTime = item.createdAt;
      time.textContent = new Date(item.createdAt).toLocaleDateString(CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US'); meta.append(time);
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
  function renderFavoritesPanel() {
    if (!favoritesActive || ctProfileState.active !== 'favorites') return;
    const context = ctProfileContext();
    if (!context || !ctProfileUID() || ctProfileState.uid !== ctProfileUID() || ctProfileState.accountUser !== context.user) {
      closeFavoritesPanel(); return;
    }
    const panel = ctProfileState.panel;
    if (!panel?.isConnected) return;
    const items = ctProfileLoadFavorites(); const legacy = ctProfileLegacyFavorites();
    const signature = JSON.stringify(['favorites', ctProfileUID(), items, legacy.length, ctProfileState.storageError]);
    if (signature === ctProfileState.rendered) return;
    ctProfileState.rendered = signature;
    const content = document.createDocumentFragment();
    content.append(ctProfileStatus(ctProfileText('このブラウザで保存したお気に入りです。過去の全履歴や他の人のお気に入りは取得できません。', 'Favorites saved in this browser. Complete older history and other users’ Favorites are unavailable.')));
    if (legacy.length) {
      const migration = ctProfileStatus(ctProfileText('以前の保存データがあります。使用中のアカウントのものか確認して取り込めます。', 'Older saved data is available. Import it if it belongs to this account.'));
      migration.append(document.createElement('br'), ctProfileControl(ctProfileText('以前の保存データを取り込む', 'Import older saved data'), ctProfileImportFavorites)); content.append(migration);
    }
    if (ctProfileState.storageError) content.append(ctProfileStatus(ctProfileText('ブラウザに保存できませんでした。保存設定を確認してください。', 'Browser storage is unavailable. Check your storage settings.')));
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.textContent = ctProfileText('まだお気に入りがありません。ツイートの星を押すとここに保存されます。', 'No Favorites saved yet. Favorite a Tweet with the star to save it here.'); content.append(empty); }
    else for (const item of items) content.append(ctProfileRow(item));
    panel.replaceChildren(content);
  }
  function ctProfileMediaState() {
    const uid = ctProfileUID();
    if (!ctProfileState.media || ctProfileState.media.user !== ctProfileState.user || (ctProfileState.media.uid && ctProfileState.media.uid !== uid)) {
      ctProfileState.media = { user: ctProfileState.user, uid, items: [], postItems: [], replyItems: [],
        scanned: 0, replyScanned: 0, cursor: null, started: false, postsStarted: false, repliesChecked: false,
        busy: false, error: '', postError: '', replyError: '', done: false, retryRefresh: false, replyLimited: false };
    }
    if (uid && !ctProfileState.media.uid) ctProfileState.media.uid = uid;
    return ctProfileState.media;
  }
  function ctProfilePostItem(post, user) {
    if (!ctProfileId(post?.id) || ctProfileHandle(post.authorUsername) !== user || post.isDeleted ||
        post.isRepost || post.originalPostId || post.repostedBy) return null;
    const media = ctProfileMediaAssets(post);
    if (!media.length) return null;
    return { id: post.id, username: user,
      name: typeof post.authorName === 'string' ? post.authorName.slice(0, 200) : user,
      avatar: ctProfileURL(post.authorAvatar), text: typeof post.text === 'string' ? post.text.slice(0, 10000) : '',
      createdAt: typeof (post.createdAt ?? post.created_at) === 'string' ? (post.createdAt ?? post.created_at) : '',
      href: '/post/' + encodeURIComponent(post.id), media };
  }
  async function ctProfileLoadMedia(refresh = false) {
    if (ctProfileState.active !== 'media' || document.hidden || (typeof ctPageActive !== 'undefined' && !ctPageActive)) return;
    const state = ctProfileMediaState();
    refresh = refresh || (state.postError && state.retryRefresh);
    if (state.busy || (!refresh && state.started && state.done && !state.error)) return;
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
      const [postsJSON, repliesJSON] = await Promise.all([
        loadPosts ? requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(user) + '/posts?' + query, headers) : null,
        loadReplies ? requestJSON(API_ORIGIN + '/api/users/' + encodeURIComponent(user) + '/replies', headers) : null
      ]);
      const current = await getAuth(); const context = ctProfileContext();
      if (sequence !== ctProfileState.sequence || location.pathname !== path || !context || context.user !== user || current?.uid !== auth.uid) return;
      state.started = true;
      if (loadPosts) {
        if (!postsJSON || postsJSON.success === false || postsJSON.error || !Array.isArray(postsJSON.posts) || postsJSON.posts.length > 100) {
          state.postError = ctProfileText('ツイートの写真・動画を取得できませんでした。もう一度お試しください。', 'Tweet photos and videos could not be loaded. Try again.');
          state.retryRefresh = !!refresh;
        } else {
          const items = postsJSON.posts.map(post => ctProfilePostItem(post, user)).filter(Boolean);
          state.postItems = [...new Map([...(refresh ? [] : state.postItems), ...items].map(item => [item.id, item])).values()];
          state.scanned = (refresh ? 0 : state.scanned) + postsJSON.posts.length;
          const next = typeof postsJSON.nextCursor === 'string' && postsJSON.nextCursor.length <= 2000 && postsJSON.nextCursor ? postsJSON.nextCursor : null;
          state.cursor = next && next !== cursor ? next : null;
          state.done = !state.cursor; state.postsStarted = true; state.postError = ''; state.retryRefresh = false;
        }
      }
      if (loadReplies) {
        if (!repliesJSON || repliesJSON.success === false || repliesJSON.error || !Array.isArray(repliesJSON.replies)) {
          state.replyError = ctProfileText('返信の写真・動画を取得できませんでした。再試行すると返信を再確認します。', 'Reply photos and videos could not be loaded. Try again to recheck replies.');
        } else {
          const replies = repliesJSON.replies.map(item => item?.post).filter(post =>
            ctProfileId(post?.id) && ctProfileHandle(post.authorUsername) === user)
            .sort((a, b) => (Date.parse(b.createdAt ?? b.created_at) || 0) - (Date.parse(a.createdAt ?? a.created_at) || 0));
          const checked = replies.slice(0, 100);
          state.replyItems = checked.map(post => ctProfilePostItem(post, user)).filter(Boolean);
          state.replyScanned = checked.length; state.replyLimited = replies.length > 100;
          state.repliesChecked = true; state.replyError = '';
        }
      }
      state.items = [...new Map([...state.postItems, ...state.replyItems].map(item => [item.id, item])).values()]
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      state.error = [state.postError, state.replyError].filter(Boolean).join(' ');
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
    const content = document.createDocumentFragment();
    const note = ctProfileStatus(ctProfileText(`投稿${state.scanned}件・返信${state.replyScanned}件を確認 · 写真・動画`, `${state.scanned} posts and ${state.replyScanned} replies checked · Photos and videos`));
    const scope = document.createElement('div');
    scope.textContent = ctProfileText('返信は最新100件まで含みます。以前のツイートは下から読み込めます。', 'Includes up to the latest 100 replies. Load older Tweets below.');
    note.append(scope, document.createElement('br'), ctProfileControl(ctProfileText('更新', 'Refresh'), () => ctProfileLoadMedia(true)));
    note.querySelector('button').disabled = state.busy; content.append(note);
    for (const item of state.items) content.append(ctProfileRow(item));
    if (!state.items.length) {
      const empty = document.createElement('p'); empty.className = 'ct-profile-empty'; empty.setAttribute('role', 'status');
      empty.textContent = state.busy ? ctProfileText('写真・動画を読み込み中…', 'Loading photos and videos…') :
        state.done && !state.error ? ctProfileText('写真・動画のあるツイートはありません。', 'No Tweets with photos or videos.') :
          ctProfileText('ここまでの投稿には写真・動画がありません。以前の投稿を確認できます。', 'No photos or videos in the posts checked so far. You can check older posts.');
      content.append(empty);
    }
    if (state.error) content.append(ctProfileStatus(state.error));
    if (!state.done || state.error) {
      const footer = ctProfileStatus('');
      const next = ctProfileControl(state.busy ? ctProfileText('読み込み中…', 'Loading…') :
        state.error ? ctProfileText('再試行', 'Try again') : ctProfileText('以前の投稿を確認', 'Check older posts'), () => ctProfileLoadMedia());
      next.disabled = state.busy; footer.append(next); content.append(footer);
    }
    ctProfileState.panel.replaceChildren(content);
  }

    // Native feed cards have no permalink. Resolve only an exact author/time/body
  // match through the author's established read-only posts route, never a quote
  // link, text search, React internals or an extra engagement request.
  const ctFavoriteCaptures = new WeakMap();
  const ctFavoritePostCache = new Map();
  const ctFavoriteStateWatchers = new WeakMap();

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
    return [...article.querySelectorAll('img[alt="Attached media"],video[src]')].filter(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[data-ct-owned],[data-ct-local-ui]'))
      .slice(0, 16).map(el => ({type: el.tagName === 'VIDEO' ? 'video' : 'image',
        url: ctProfileURL(el.src), poster: el.tagName === 'VIDEO' ? ctProfileURL(el.poster) : ''})).filter(asset => asset.url);
  }

  function ctFavoriteCandidate(article) {
    const timestamp = [...article.querySelectorAll('span.text-tl-app-text-muted.hover\\:underline[title]')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote') &&
      /^\d{4}-\d{2}-\d{2}T/.test(el.title) && Number.isFinite(Date.parse(el.title)));
    const known = snapshotFavorite(article);
    if (known) return { ...known, createdAt: timestamp?.title || '', media: ctFavoriteDOMMedia(article) };
    const username = validUser(articleAuthor(article));
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[aria-live]'));
    if (!username || !body || !timestamp) return null;
    const author = [...article.querySelectorAll('button.truncate.font-bold')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote'));
    return { username, name: author?.textContent || username, text: body.textContent,
      avatar: articleAvatar(article), createdAt: timestamp.title, savedAt: Date.now() };
  }

  async function ctFavoriteAuthorPosts(username, auth) {
    const key = auth.uid + ':' + username.toLowerCase();
    const previous = ctFavoritePostCache.get(key);
    if (previous?.pending) return previous.pending;
    if (previous && Date.now() - previous.at < 60000) return previous.posts;
    const record = { at: Date.now(), posts: [], pending: null };
    record.pending = (async () => {
      let cursor = null;
      for (let page = 0; page < 3; page++) {
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
    finally { record.pending = null; record.at = Date.now(); }
  }

  async function ctResolveFavorite(candidate, uid) {
    if (!candidate || !uid) return null;
    const auth = await getAuth();
    if (!auth?.token || auth.uid !== uid) return null;
    if (candidate.id) return candidate;
    const posts = await ctFavoriteAuthorPosts(candidate.username, auth);
    const current = await getAuth();
    if (current?.uid !== uid) return null;
    const matches = posts.filter(post => typeof post.id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(post.id) &&
      !post.isDeleted && !post.originalPostId && !post.isRepost &&
      post.authorUsername?.toLowerCase() === candidate.username.toLowerCase() &&
      Date.parse(post.createdAt ?? post.created_at) === Date.parse(candidate.createdAt) &&
      typeof post.text === 'string' && post.text === candidate.text);
    const unique = [...new Map(matches.map(post => [post.id, post])).values()];
    if (unique.length !== 1) return null;
    return { ...candidate, id: unique[0].id, href: location.origin + '/post/' + encodeURIComponent(unique[0].id),
      avatar: ctProfileURL(unique[0].authorAvatar) || candidate.avatar,
      media: ctProfileMediaAssets(unique[0]) };
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

    // Browser-local reply inbox. All routes and response shapes come from Tweet's own client.
  // No native notification is marked read and no posting/following API is called here.
  const ctReplyState = {
    uid: null, data: null, busy: false, lastAttempt: -Infinity, error: '', storageError: false,
    rendered: '', storageBound: false, tabActive: false, mount: null
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
  function ctReplyBadgeMetadata(item) {
    return {
      authorBadges: Array.isArray(item.authorBadges) ? item.authorBadges.filter(value =>
        typeof value === 'string' && /^(team_member|centurion|founding_special|founding|wing|ambassador|press)$/.test(value)) : [],
      authorFoundingMemberNumber: /^\d{1,20}$/.test(String(item.authorFoundingMemberNumber ?? ''))
        ? String(item.authorFoundingMemberNumber) : null
    };
  }
  function ctReplyRead(uid) {
    try {
      const raw = JSON.parse(localStorage.getItem(CT_REPLY_PREFIX + encodeURIComponent(uid)) || 'null');
      if (!raw || !Array.isArray(raw.notices)) return ctReplyEmpty();
      return {
        startedAt: Number(raw.startedAt) || Date.now(), checkedAt: Number(raw.checkedAt) || 0,
        notices: raw.notices.filter(item => ctReplyId(item?.id) && ctReplyHandle(item?.authorUsername))
          .slice(0, 100).map(item => ({
            id: item.id, parentId: ctReplyId(item.parentId), authorUsername: item.authorUsername,
            authorName: typeof item.authorName === 'string' ? item.authorName.slice(0, 200) : item.authorUsername,
            authorAvatar: ctReplyAvatar(item.authorAvatar), text: typeof item.text === 'string' ? item.text.slice(0, 4000) : '',
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '', detectedAt: Number(item.detectedAt) || 0,
            read: item.read === true, ...ctReplyBadgeMetadata(item)
          })),
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
      ...ctReplyBadgeMetadata(reply),
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
  function ctReplyRestoreNative() {
    const mount = ctReplyState.mount;
    if (!mount) return;
    for (const [element, original] of mount.hidden) {
      if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
        if (original.display) element.style.setProperty('display', original.display, original.priority);
        else element.style.removeProperty('display');
      }
      if (element.getAttribute('aria-hidden') === 'true') {
        if (original.aria === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', original.aria);
      }
    }
    mount.hidden.clear();
    mount.bar.removeAttribute('data-ct-reply-tabs-active');
  }
  function closeReplyPanel() {
    ctReplyRestoreNative();
    ctReplyState.mount?.button.remove();
    document.getElementById('ct-reply-panel')?.remove();
    ctReplyState.mount = null;
    ctReplyState.tabActive = false;
    ctReplyState.rendered = '';
  }
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
  function ctReplyInstallStyle() {
    if (document.getElementById('ct-reply-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-reply-ui-style';
    style.textContent = `
      #ct-reply-tab { position:relative; flex:1; display:flex; align-items:center; justify-content:center; gap:4px; min-height:48px; min-width:0; padding:8px 6px; border:0; background:transparent; color:var(--tl-app-text-muted,inherit); font:inherit; font-size:15px; font-weight:500; line-height:1.3; cursor:pointer; }
      #ct-reply-tab[aria-pressed="true"] { color:var(--tl-app-text,inherit); font-weight:800; }
      #ct-reply-tab[aria-pressed="true"]::after { content:""; position:absolute; bottom:0; height:4px; width:56px; max-width:70%; border-radius:999px; background:var(--ct-classic-blue,#0ea5e9); }
      #ct-reply-tab > [data-ct-reply-unread] { color:var(--ct-classic-blue,#0ea5e9); font-size:12px; }
      [data-ct-reply-tabs-active] > button:not(#ct-reply-tab) > span { color:var(--tl-app-text-muted,inherit)!important; font-weight:500!important; }
      [data-ct-reply-tabs-active] > button:not(#ct-reply-tab) > span.absolute.bottom-0 { display:none!important; }
      #ct-reply-panel { --ct-reply-border:var(--ct-classic-border,var(--tl-app-border,#8b98a544)); --ct-reply-muted:var(--tl-app-text-muted,#657786); --ct-reply-accent:var(--ct-classic-blue,#0ea5e9); }
      #ct-reply-panel summary { display:flex; align-items:center; justify-content:space-between; min-height:48px; padding:12px 16px; border-bottom:1px solid var(--ct-reply-border); cursor:pointer; list-style:none; font-weight:800; }
      #ct-reply-panel summary::-webkit-details-marker { display:none; }
      #ct-reply-panel summary::after { content:"⌄"; font-size:18px; color:var(--ct-reply-muted); }
      #ct-reply-panel details[open] > summary::after { transform:rotate(180deg); }
      #ct-reply-panel .ct-reply-controls { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; padding:8px 16px; border-bottom:1px solid var(--ct-reply-border); }
      #ct-reply-panel .ct-reply-status { flex:1 1 150px; font-size:12px; line-height:1.5; color:var(--ct-reply-muted); overflow-wrap:anywhere; margin:0; }
      #ct-reply-panel .ct-reply-control { min-height:44px; padding:8px 10px; border:0; background:transparent; color:var(--ct-reply-accent); border-radius:4px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }
      #ct-reply-panel .ct-reply-control:disabled { cursor:default; opacity:.5; }
      #ct-reply-panel .ct-reply-help { margin:0; padding:0 16px 10px; font-size:12px; line-height:1.5; color:var(--ct-reply-muted); }
      #ct-reply-panel .ct-reply-empty { margin:0; padding:40px 20px; color:var(--ct-reply-muted); font-size:15px; line-height:1.5; text-align:center; }
      #ct-reply-panel .ct-local-reply-row { display:flex; align-items:flex-start; gap:12px; padding:14px 16px; border-bottom:1px solid var(--ct-reply-border); }
      #ct-reply-panel .ct-local-reply-row[data-unread="true"] { background:color-mix(in srgb,var(--ct-reply-accent) 5%,transparent); }
      #ct-reply-panel .ct-reply-avatar-link { display:flex; align-items:center; justify-content:center; flex:0 0 40px; width:40px; height:40px; border-radius:50%; overflow:hidden; color:var(--ct-reply-accent); background:var(--tl-app-bg,#f5f8fa); font-size:18px; font-weight:700; text-decoration:none; }
      #ct-reply-panel .ct-reply-avatar-link img { width:40px; height:40px; object-fit:cover; }
      .ct-classic-shell #ct-reply-panel .ct-reply-avatar-link { border-radius:4px; }
      #ct-reply-panel .ct-reply-content { flex:1; min-width:0; overflow-wrap:anywhere; }
      #ct-reply-panel .ct-reply-actor-line { display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 5px; font-size:15px; line-height:1.4; }
      #ct-reply-panel .ct-reply-author { display:inline-flex; align-items:center; gap:4px; min-width:0; max-width:100%; color:inherit; font-weight:800; text-decoration:none; }
      #ct-reply-panel .ct-reply-name { overflow-wrap:anywhere; }
      #ct-reply-panel .ct-reply-handle,#ct-reply-panel time { color:var(--ct-reply-muted); font-size:13px; }
      #ct-reply-panel .ct-reply-unread { color:var(--ct-reply-accent); font-size:11px; }
      #ct-reply-panel .ct-reply-body { display:block; margin:4px 0; color:inherit; text-decoration:none; font-size:15px; line-height:1.5; white-space:pre-wrap; }
      #ct-reply-panel .ct-reply-parent { display:inline-flex; align-items:center; min-height:44px; color:var(--ct-reply-muted); font-size:12px; text-decoration:none; }
      #ct-reply-panel .ct-official-badges { display:inline-flex; align-items:center; gap:2px; }
      #ct-reply-panel .ct-official-badges img { width:18px; height:18px; object-fit:contain; }
      #ct-reply-panel a:focus-visible,#ct-reply-panel button:focus-visible,#ct-reply-panel summary:focus-visible,#ct-reply-tab:focus-visible { outline:2px solid var(--ct-classic-blue,#0ea5e9); outline-offset:-2px; }
      @media(hover:hover) { #ct-reply-tab:hover,#ct-reply-panel .ct-reply-control:hover,#ct-reply-panel .ct-local-reply-row:hover { background:var(--ct-classic-hover,var(--tl-app-bg,#f5f8fa)); } #ct-reply-panel .ct-reply-author:hover,#ct-reply-panel .ct-reply-parent:hover { text-decoration:underline; } }
    `;
    (document.head || document.documentElement).append(style);
  }
  function ctReplyNativeTabbar(main) {
    // Tweet's kie notification component owns this exact row. Do not treat
    // arbitrary sticky navigation, profile tabs or a hidden shell as its inbox.
    return [...main.querySelectorAll('div.sticky')].find(bar => {
      if (bar.closest('[data-ct-local-ui],[hidden],[aria-hidden="true"]') ||
          !['flex', 'items-stretch', 'top-app-header', 'border-b', 'border-tl-app-border'].every(name => bar.classList.contains(name))) return false;
      const nativeButtons = [...bar.children].filter(child => child.matches('button[type="button"]') && child.id !== 'ct-reply-tab');
      return nativeButtons.length >= 2 && nativeButtons.every(button => button.classList.contains('flex-1')) &&
        nativeButtons.some(button => /^(All|すべて)$/.test(button.textContent.trim())) &&
        nativeButtons.some(button => /^(Mentions|メンション|@ツイート)$/.test(button.textContent.trim()));
    }) || null;
  }
  function ctReplyMountTab(bar, panel) {
    let mount = ctReplyState.mount;
    if (mount?.bar !== bar) {
      ctReplyRestoreNative();
      mount?.button.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'ct-reply-tab';
      button.dataset.ctLocalUi = 'reply-tab';
      button.setAttribute('aria-controls', 'ct-reply-panel');
      button.title = ctReplyText('このブラウザのリプライ通知', 'Reply notifications saved in this browser');
      button.addEventListener('click', () => {
        ctReplyState.tabActive = true;
        renderReplyPanel();
      });
      mount = { bar, button, hidden: new Map() };
      ctReplyState.mount = mount;
      bar.addEventListener('click', event => {
        const button = event.target.closest?.('button');
        if (ctReplyState.mount?.bar !== bar || !button || button.id === 'ct-reply-tab' || button.parentElement !== bar) return;
        ctReplyState.tabActive = false;
        ctReplyRestoreNative();
        renderReplyPanel();
      }, true);
      ctReplyState.rendered = '';
    }
    if (mount.button.parentElement !== bar) bar.append(mount.button);
    if (panel.previousElementSibling !== bar) bar.after(panel);
    if (mount.button.getAttribute('aria-pressed') !== String(ctReplyState.tabActive)) mount.button.setAttribute('aria-pressed', String(ctReplyState.tabActive));
    if (ctReplyState.tabActive) {
      if (!bar.hasAttribute('data-ct-reply-tabs-active')) bar.dataset.ctReplyTabsActive = '1';
      for (const element of [...bar.parentElement.children]) {
        if (element === bar || element === panel || element.hasAttribute('data-ct-local-ui')) continue;
        if (!mount.hidden.has(element)) mount.hidden.set(element, {
          display: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display'),
          aria: element.getAttribute('aria-hidden')
        });
        if (element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') element.style.setProperty('display', 'none', 'important');
        if (element.getAttribute('aria-hidden') !== 'true') element.setAttribute('aria-hidden', 'true');
      }
    } else ctReplyRestoreNative();
    return mount.button;
  }
  function ctReplyAppendBadges(actor, item) {
    if (typeof ctProfileBadgeKinds !== 'function' || typeof ctBadgeSource !== 'function') return;
    const kinds = ctProfileBadgeKinds({ badges: item.authorBadges, foundingMemberNumber: item.authorFoundingMemberNumber });
    if (!kinds.length) return;
    const group = document.createElement('span');
    group.className = 'ct-official-badges';
    group.setAttribute('role', 'img');
    group.setAttribute('aria-label', kinds.map(kind => ctOfficialBadgeKinds[kind]).join(' + '));
    group.title = group.getAttribute('aria-label');
    for (const kind of kinds) {
      const image = document.createElement('img');
      image.src = ctBadgeSource(kind);
      image.alt = '';
      image.width = 18;
      image.height = 18;
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.src = `https://app.tweet.app/assets/${kind}-badge-36.png`; }, { once: true });
      group.append(image);
    }
    actor.append(group);
  }
  function renderReplyPanel() {
    ctReplyCheckKnownIdentity();
    ctReplyBindStorage();
    if (!/^\/notifications\/?$/.test(location.pathname)) { closeReplyPanel(); return; }
    const main = document.querySelector('main');
    if (!main) { closeReplyPanel(); return; }
    ctReplyInstallStyle();
    let panel = document.getElementById('ct-reply-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-reply-panel';
      panel.dataset.ctLocalUi = 'replies';
      panel.setAttribute('aria-label', ctReplyText('リプライ通知', 'Reply notifications'));
      // Retire legacy floating-card rules while keeping the native document flow.
      panel.style.cssText = 'position:relative!important;inset:auto!important;width:100%!important;max-width:100%!important;max-height:none!important;margin:0!important;padding:0!important;z-index:auto!important;box-shadow:none!important;border:0!important;border-radius:0!important;color:inherit!important;background:var(--tl-app-card,inherit)!important;overflow:visible!important';
      ctReplyState.rendered = '';
    }
    const bar = ctReplyNativeTabbar(main);
    let tab = null;
    if (bar) {
      tab = ctReplyMountTab(bar, panel);
      panel.dataset.ctReplyMode = 'tab';
      panel.hidden = !ctReplyState.tabActive;
      panel.style.setProperty('display', ctReplyState.tabActive ? 'block' : 'none', 'important');
    } else {
      ctReplyRestoreNative();
      ctReplyState.mount?.button.remove();
      ctReplyState.mount = null;
      if (panel.dataset.ctReplyMode !== 'inline') ctReplyState.rendered = '';
      panel.dataset.ctReplyMode = 'inline';
      panel.hidden = false;
      panel.style.setProperty('display', 'block', 'important');
      const heading = [...main.querySelectorAll('h1,h2')].find(el =>
        !el.closest('[data-ct-local-ui],[hidden],[aria-hidden="true"]') && /^(Notifications|通知)$/.test(el.textContent.trim()));
      const header = heading?.closest('.sticky') || heading?.parentElement;
      if (header && header !== main) { if (panel.previousElementSibling !== header) header.after(panel); }
      else if (panel.parentElement !== main) main.prepend(panel);
    }
    const notices = loadReplyNotices();
    const unread = notices.filter(item => !item.read).length;
    if (tab) {
      const label = ctReplyText('リプライ', 'Replies');
      const text = label + (unread ? ` ${unread}` : '');
      if (tab.textContent !== text) {
        tab.textContent = label;
        if (unread) {
          const count = document.createElement('span');
          count.dataset.ctReplyUnread = '1';
          count.textContent = ' ' + unread;
          tab.append(count);
        }
      }
    }
    const signature = JSON.stringify([ctReplyState.uid, notices, ctReplyState.busy, ctReplyState.error, ctReplyState.storageError, ctReplyState.data?.checkedAt, panel.dataset.ctReplyMode, ctReplyState.tabActive]);
    if (signature === ctReplyState.rendered) return;
    ctReplyState.rendered = signature;
    const open = panel.querySelector('details')?.open ?? false;
    const focused = panel.contains(document.activeElement) ? document.activeElement?.dataset?.replyAction : null;
    panel.replaceChildren();
    let host = panel;
    if (!tab) {
      const details = document.createElement('details');
      details.open = open;
      const summary = document.createElement('summary');
      summary.textContent = ctReplyText('リプライ通知', 'Reply notifications') + (unread ? ` (${unread})` : '');
      summary.dataset.replyAction = 'summary';
      details.append(summary);
      panel.append(details);
      host = details;
    }
    const controls = document.createElement('div');
    controls.className = 'ct-reply-controls';
    const status = document.createElement('p');
    status.className = 'ct-reply-status';
    status.setAttribute('role', 'status');
    status.textContent = ctReplyState.storageError
      ? ctReplyText('保存できません。このページを閉じると通知履歴が消えます。', 'Storage is unavailable. History will disappear when this page closes.')
      : ctReplyState.busy ? ctReplyText('返信を確認中…', 'Checking replies…')
      : ctReplyState.error || (!ctReplyState.uid ? ctReplyText('ログイン後に返信を確認します。', 'Sign in to check replies.')
        : ctReplyState.data?.checkedAt ? ctReplyText('最終確認 ', 'Last checked ') + new Date(ctReplyState.data.checkedAt).toLocaleTimeString(CT_LOCALE, { hour: '2-digit', minute: '2-digit' })
          : ctReplyText('返信の確認を待っています。', 'Waiting to check replies.'));
    controls.append(status);
    function control(label, action, callback) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ct-reply-control';
      button.textContent = label;
      button.dataset.replyAction = action;
      button.addEventListener('click', callback);
      controls.append(button);
      return button;
    }
    const refresh = control(ctReplyText('再確認', 'Check now'), 'refresh', () => replyWatchTick(true));
    refresh.disabled = ctReplyState.busy;
    const read = control(ctReplyText('すべて既読', 'Mark all read'), 'read', () => markReplyRead());
    read.disabled = !unread;
    host.append(controls);
    const help = document.createElement('p');
    help.className = 'ct-reply-help';
    help.textContent = ctReplyText('通知履歴・既読はこのブラウザに保存されます。', 'Notification history and read status are saved in this browser.');
    host.append(help);
    if (!notices.length) {
      const empty = document.createElement('p');
      empty.className = 'ct-reply-empty';
      empty.textContent = ctReplyText('確認した返信はまだありません。', 'No replies have been found yet.');
      host.append(empty);
    }
    const list = document.createElement('div');
    list.dataset.ctReplyList = '1';
    for (const item of notices) {
      const row = document.createElement('article');
      row.className = 'ct-local-reply-row';
      row.dataset.ctReplyId = item.id;
      row.dataset.unread = String(!item.read);
      const avatarLink = document.createElement('a');
      avatarLink.className = 'ct-reply-avatar-link';
      avatarLink.href = '/user/' + encodeURIComponent(item.authorUsername);
      avatarLink.setAttribute('aria-label', ctReplyText(`${item.authorName || item.authorUsername}のプロフィール`, `${item.authorName || item.authorUsername}'s profile`));
      avatarLink.dataset.replyAction = 'avatar:' + item.id;
      avatarLink.textContent = Array.from(item.authorName || item.authorUsername)[0] || '';
      const avatarURL = ctReplyAvatar(item.authorAvatar);
      if (avatarURL) {
        const avatar = document.createElement('img');
        avatar.src = avatarURL;
        avatar.alt = '';
        avatar.width = 40;
        avatar.height = 40;
        avatar.loading = 'lazy';
        avatar.referrerPolicy = 'no-referrer';
        avatar.addEventListener('error', () => { avatarLink.textContent = Array.from(item.authorName || item.authorUsername)[0] || ''; }, { once: true });
        avatarLink.replaceChildren(avatar);
      }
      row.append(avatarLink);
      const content = document.createElement('div');
      content.className = 'ct-reply-content';
      const actorLine = document.createElement('div');
      actorLine.className = 'ct-reply-actor-line';
      const actor = document.createElement('a');
      actor.className = 'ct-reply-author';
      actor.href = avatarLink.href;
      actor.dataset.replyAction = 'profile:' + item.id;
      const name = document.createElement('span');
      name.className = 'ct-reply-name';
      name.textContent = item.authorName || item.authorUsername;
      actor.append(name);
      ctReplyAppendBadges(actor, item);
      actorLine.append(actor);
      const handle = document.createElement('span');
      handle.className = 'ct-reply-handle';
      handle.textContent = '@' + item.authorUsername;
      actorLine.append(handle);
      const date = new Date(item.createdAt);
      if (Number.isFinite(date.getTime())) {
        const time = document.createElement('time');
        time.dateTime = date.toISOString();
        time.title = date.toLocaleString(CT_LOCALE);
        time.textContent = '· ' + date.toLocaleString(CT_LOCALE, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        actorLine.append(time);
      }
      if (!item.read) {
        const marker = document.createElement('span');
        marker.className = 'ct-reply-unread';
        marker.textContent = ctReplyText('未読', 'Unread');
        actorLine.append(marker);
      }
      content.append(actorLine);
      const link = document.createElement('a');
      link.className = 'ct-reply-body';
      link.href = '/post/' + encodeURIComponent(item.id);
      link.dataset.replyAction = 'open:' + item.id;
      link.textContent = item.text || ctReplyText('返信を開く', 'Open reply');
      link.addEventListener('click', () => markReplyRead(item.id, true));
      content.append(link);
      if (ctReplyId(item.parentId)) {
        const parent = document.createElement('a');
        parent.className = 'ct-reply-parent';
        parent.href = '/post/' + encodeURIComponent(item.parentId);
        parent.dataset.replyAction = 'parent:' + item.id;
        parent.textContent = ctReplyText('返信先のツイートを見る', 'View the original tweet');
        content.append(parent);
      }
      row.append(content);
      list.append(row);
    }
    host.append(list);
    if (focused) {
      const previous = [...panel.querySelectorAll('[data-reply-action]')].find(element => element.dataset.replyAction === focused);
      const target = previous && !previous.disabled ? previous : controls.querySelector('[data-reply-action="refresh"]') || tab;
      target?.focus({ preventScroll: true });
    }
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
        badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-inline-start:4px;padding:0 4px;border-radius:999px;background:var(--ct-classic-blue,#0ea5e9);color:white;font-size:11px;font-weight:700;vertical-align:middle;pointer-events:none';
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

    // Reuse the native upload UI: it validates and uploads one File at a time.
  // No media quotas, server formats, transcoding settings or post submissions
  // are changed here. In particular, accepting a file does not promise 4K HDR.
  const ctMediaUploads = new WeakMap();
  const ctMediaUploadEvents = new WeakSet();
  const ctMediaCarousels = new Map();
  let ctMediaTransferSupported;
  let ctMediaPendingViewer = null;
  let ctMediaViewer = null;
  const ctMediaPhotoAccept = 'image/jpeg,image/png,image/webp';

  function ctMediaJapanese() { return CT_LOCALE === 'ja'; }
  function ctMediaCanTransfer() {
    if (ctMediaTransferSupported !== undefined) return ctMediaTransferSupported;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(new File([], 'ct-capability-check.jpg', { type: 'image/jpeg' }));
      const probe = document.createElement('input');
      probe.type = 'file';
      probe.files = transfer.files;
      ctMediaTransferSupported = probe.files.length === 1;
    } catch { ctMediaTransferSupported = false; }
    return ctMediaTransferSupported;
  }
  function ctMediaUploadRoot(input) {
    if (!input.matches(`input[type="file"][accept="${ctMediaPhotoAccept}"]`) ||
        input.closest('[data-ct-local-ui]')) return null;
    const toolbar = input.parentElement;
    const root = toolbar?.parentElement;
    if (!toolbar?.matches('div.flex.items-center') || !root?.matches('div.w-full.mt-3.space-y-3') ||
        ![...toolbar.children].some(el => el.matches('input[type="file"][accept="video/mp4,video/quicktime"]'))) return null;
    const actions = [...toolbar.children].find(el => el.matches('div.flex.items-center'));
    const buttons = actions ? [...actions.children].filter(el => el.tagName === 'BUTTON') : [];
    return buttons.length === 2 ? { root, toolbar, photoButton: buttons[0], videoButton: buttons[1] } : null;
  }
  function ctMediaPreviews(root) { return [...root.querySelectorAll('img[alt="Upload preview"]')]; }
  function ctMediaPreviewReady(image) {
    return [...(image.parentElement?.children || [])].some(el => el.matches('div.absolute.bottom-2.left-2') &&
      el.classList.contains('bg-emerald-500/90'));
  }
  function ctMediaUploadError(root) {
    const error = [...root.children].find(el => el.matches('div.text-red-500'));
    return error?.textContent?.trim() || '';
  }
  function ctMediaUploadStatus(state, text, busy = false) {
    if (!state.status?.isConnected) {
      const status = document.createElement('div');
      status.className = 'ct-media-upload-status';
      status.dataset.ctLocalUi = 'media-upload';
      const label = document.createElement('span');
      label.setAttribute('role', 'status');
      label.setAttribute('aria-live', 'polite');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = ctMediaJapanese() ? '残りを中止' : 'Stop remaining';
      cancel.addEventListener('click', event => {
        event.stopPropagation();
        state.cancelled = true;
        state.wake?.();
      });
      status.append(label, cancel);
      state.root.append(status);
      state.status = status;
      state.label = label;
      state.cancel = cancel;
    }
    if (state.label.textContent !== text) state.label.textContent = text;
    state.cancel.hidden = !busy;
  }
  function ctMediaWaitForPhoto(state, previousSources) {
    return new Promise(resolve => {
      let complete = false;
      const finish = result => {
        if (complete) return;
        complete = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timeout);
        clearTimeout(initial);
        state.wake = null;
        resolve(result);
      };
      const check = () => {
        if (state.cancelled || !state.input.isConnected || !state.root.isConnected ||
            location.pathname !== state.path) { finish('cancelled'); return; }
        if (ctMediaUploadError(state.root)) { finish('error'); return; }
        const photos = ctMediaPreviews(state.root);
        if (photos.length < previousSources.length) { finish('cancelled'); return; }
        const remaining = previousSources.slice();
        const added = photos.filter(photo => {
          const index = remaining.indexOf(photo.getAttribute('src'));
          if (index < 0) return true;
          remaining.splice(index, 1);
          return false;
        });
        if (remaining.length) { finish('cancelled'); return; }
        if (added.length === 1 && ctMediaPreviewReady(added[0])) finish('ready');
      };
      // Start after the native change handler and React's state update. A stale
      // validation error may still be in the DOM during dispatchEvent itself.
      const observer = new MutationObserver(check);
      observer.observe(state.root, { childList: true, subtree: true, attributes: true, characterData: true });
      const poll = setInterval(check, 100);
      const timeout = setTimeout(() => finish('timeout'), 120000);
      const initial = setTimeout(check, 0);
      state.wake = check;
    });
  }
  async function ctMediaQueuePhotos(input, media, files) {
    const state = ctMediaUploads.get(input);
    if (state.busy) return;
    const existing = ctMediaPreviews(media.root).length;
    const available = Math.max(0, 4 - existing); // The observed native toolbar also caps at four.
    const selected = files.slice(0, available);
    const skipped = files.length - selected.length;
    const ja = ctMediaJapanese();
    if (media.photoButton.disabled || media.root.querySelector('video') || !selected.length) {
      ctMediaUploadStatus(state, ja ? '現在は写真を追加できません。既存の添付とアップロード状態を確認してください。' :
        'Photos cannot be added now. Check existing attachments and upload status.');
      input.value = '';
      return;
    }
    state.busy = true;
    state.cancelled = false;
    state.path = location.pathname;
    let completed = 0;
    let result = 'ready';
    try {
      for (const file of selected) {
        if (state.cancelled || !input.isConnected || location.pathname !== state.path) { result = 'cancelled'; break; }
        const before = ctMediaPreviews(media.root).map(photo => photo.getAttribute('src'));
        ctMediaUploadStatus(state, ja ? `写真を追加中 ${completed + 1} / ${selected.length}` :
          `Adding photos ${completed + 1} / ${selected.length}`, true);
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        const event = new Event('change', { bubbles: true });
        ctMediaUploadEvents.add(event);
        input.dispatchEvent(event);
        result = await ctMediaWaitForPhoto(state, before);
        if (result !== 'ready') break;
        completed++;
      }
    } catch { result = 'error'; }
    finally {
      state.busy = false;
      input.value = '';
      const count = ja ? `${completed}枚を追加しました。` : `${completed} photo(s) added. `;
      const reason = result === 'ready' ? (skipped ? (ja ? `1投稿4枚までのため、残り${skipped}枚は追加していません。` :
        `${skipped} remaining photo(s) were not added because a post accepts four.`) : '') :
        result === 'cancelled' ? (ja ? '残りの追加を中止しました。処理中の1枚は完了する場合があります。' :
          'Remaining photos stopped. The photo already uploading may still finish.') :
        result === 'timeout' ? (ja ? '完了を確認できないため、残りは停止しました。添付の状態を確認してください。' :
          'Completion could not be confirmed. Remaining photos stopped; check the attachments.') :
          (ja ? 'エラーのため残りは停止しました。標準のエラー表示を確認してください。' :
            'Remaining photos stopped after an error. Check the native error message.');
      if (state.root.isConnected) ctMediaUploadStatus(state, count + reason);
    }
  }
  function ctMediaEnhanceInput(input) {
    if (ctMediaUploads.has(input) || !ctMediaCanTransfer()) return;
    const media = ctMediaUploadRoot(input);
    if (!media || input.multiple) return; // A future native multi-file handler owns its own input.
    const state = { input, root: media.root, busy: false, cancelled: false };
    ctMediaUploads.set(input, state);
    input.multiple = true;
    input.addEventListener('change', event => {
      if (ctMediaUploadEvents.has(event)) return;
      const files = [...(input.files || [])];
      if (!state.busy && files.length <= 1) return;
      event.stopImmediatePropagation();
      if (!state.busy) void ctMediaQueuePhotos(input, media, files);
    }, true);
    // Home's submit is in oS.actionRight; modal submit is its sibling and
    // reply composers use a role=form ancestor with a Ctrl/Cmd+Enter handler.
    const replyForm = media.root.closest('[role="form"]');
    const parent = media.root.parentElement;
    const scope = replyForm || (parent?.querySelector('textarea#public-tweet-input,textarea#public-modal-tweet-input') ? parent : media.root);
    scope.addEventListener('click', event => {
      if (!state.busy || event.target.closest('[data-ct-local-ui="media-upload"]')) return;
      const button = event.target.closest('button,input');
      if (button && (media.root.contains(button) || replyForm?.contains(button) ||
          button.matches('#public-tweet-submit-btn,#public-modal-tweet-submit-btn'))) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    scope.addEventListener('keydown', event => {
      if (state.busy && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.matches('textarea')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    scope.addEventListener('submit', event => {
      if (state.busy) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }

  function ctMediaSlides(grid) {
    if (!grid.matches('div.grid.gap-0\\.5.rounded-2xl.overflow-hidden.border') ||
        !grid.closest('main,article') || grid.closest('[data-ct-local-ui],blockquote,[aria-label^="Quoted post"]')) return [];
    const slides = [...grid.children];
    if (slides.length < 2 || slides.some(slide => !slide.matches('div.relative.overflow-hidden') ||
        slide.children.length !== 1 || !slide.firstElementChild.matches('img[alt="Attached media"].cursor-pointer'))) return [];
    return slides;
  }
  function ctMediaCarouselIndex(state) {
    const width = state.grid.clientWidth;
    return width ? Math.max(0, Math.min(state.slides.length - 1, Math.round(state.grid.scrollLeft / width))) : state.index;
  }
  function ctMediaUpdateCarousel(state) {
    state.index = ctMediaCarouselIndex(state);
    const count = `${state.index + 1} / ${state.slides.length}`;
    if (state.count.textContent !== count) state.count.textContent = count;
    state.prev.disabled = state.index === 0;
    state.next.disabled = state.index === state.slides.length - 1;
  }
  function ctMediaMoveCarousel(state, index) {
    state.index = Math.max(0, Math.min(state.slides.length - 1, index));
    const left = state.index * state.grid.clientWidth;
    const behavior = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (typeof state.grid.scrollTo === 'function') state.grid.scrollTo({ left, behavior });
    else state.grid.scrollLeft = left;
    // Native scrolling emits scroll events while moving; keep an immediate
    // update as well for keyboard access and browsers without smooth scrolling.
    const count = `${state.index + 1} / ${state.slides.length}`;
    if (state.count.textContent !== count) state.count.textContent = count;
    state.prev.disabled = state.index === 0;
    state.next.disabled = state.index === state.slides.length - 1;
  }
  function ctMediaRemoveCarousel(state) {
    state.grid.classList.remove('ct-media-carousel');
    for (const [name, value] of state.attributes) {
      if (value === null) state.grid.removeAttribute(name);
      else state.grid.setAttribute(name, value);
    }
    state.grid.removeEventListener('scroll', state.onScroll);
    state.grid.removeEventListener('keydown', state.onKey);
    state.grid.removeEventListener('click', state.onClick, true);
    state.resize?.disconnect();
    state.controls.remove();
    ctMediaCarousels.delete(state.grid);
  }
  function ctMediaApplyCarousel(state) {
    const grid = state.grid;
    if (!grid.classList.contains('ct-media-carousel')) grid.classList.add('ct-media-carousel');
    const attributes = {
      tabindex: '0', role: 'region',
      'aria-label': ctMediaJapanese() ? '投稿の写真' : 'Post photos',
      'aria-roledescription': ctMediaJapanese() ? 'カルーセル' : 'carousel'
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (grid.getAttribute(name) !== value) grid.setAttribute(name, value);
    }
  }
  function ctMediaEnhanceCarousel(grid) {
    const slides = ctMediaSlides(grid);
    if (!slides.length) return;
    const existing = ctMediaCarousels.get(grid);
    if (existing) {
      existing.slides = slides;
      ctMediaApplyCarousel(existing);
      if (!existing.controls.isConnected) grid.after(existing.controls);
      ctMediaUpdateCarousel(existing);
      return;
    }
    const controls = document.createElement('div');
    controls.className = 'ct-media-carousel-controls';
    controls.dataset.ctLocalUi = 'media-carousel';
    const prev = document.createElement('button');
    const next = document.createElement('button');
    const count = document.createElement('span');
    prev.type = next.type = 'button';
    prev.textContent = '‹'; next.textContent = '›';
    prev.setAttribute('aria-label', ctMediaJapanese() ? '前の写真' : 'Previous photo');
    next.setAttribute('aria-label', ctMediaJapanese() ? '次の写真' : 'Next photo');
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    controls.append(prev, count, next);
    controls.addEventListener('click', event => event.stopPropagation());
    const state = { grid, slides, controls, prev, next, count, index: 0,
      attributes: ['tabindex', 'role', 'aria-label', 'aria-roledescription'].map(name => [name, grid.getAttribute(name)]) };
    prev.addEventListener('click', () => ctMediaMoveCarousel(state, state.index - 1));
    next.addEventListener('click', () => ctMediaMoveCarousel(state, state.index + 1));
    state.onScroll = () => ctMediaUpdateCarousel(state);
    state.onKey = event => {
      if (event.target !== grid || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? state.slides.length - 1 :
        state.index + (event.key === 'ArrowRight' ? 1 : -1);
      ctMediaMoveCarousel(state, index);
    };
    grid.addEventListener('scroll', state.onScroll, { passive: true });
    grid.addEventListener('keydown', state.onKey);
    state.onClick = event => {
      const index = state.slides.findIndex(slide => slide.firstElementChild === event.target);
      if (index >= 0) ctMediaPendingViewer = { state, index, at: Date.now() };
    };
    grid.addEventListener('click', state.onClick, true);
    ctMediaApplyCarousel(state);
    grid.after(controls);
    if (typeof ResizeObserver === 'function') {
      state.resize = new ResizeObserver(() => ctMediaMoveCarousel(state, state.index));
      state.resize.observe(grid);
    }
    ctMediaCarousels.set(grid, state);
    ctMediaUpdateCarousel(state);
  }
  function ctMediaClearViewer() {
    if (!ctMediaViewer) return;
    const viewer = ctMediaViewer;
    viewer.observer?.disconnect();
    viewer.controls.remove();
    document.removeEventListener('keydown', viewer.onKey, true);
    viewer.dialog.removeEventListener('touchstart', viewer.onTouchStart);
    viewer.dialog.removeEventListener('touchend', viewer.onTouchEnd);
    ctMediaViewer = null;
  }
  function ctMediaEnhanceViewer() {
    const active = ctMediaViewer;
    if (active && (!active.dialog.isConnected || !active.state.grid.isConnected || !ctMediaSlides(active.state.grid).length)) ctMediaClearViewer();
    const pending = ctMediaPendingViewer;
    if (!pending || !pending.state.grid.isConnected || Date.now() - pending.at > 5000) return;
    const source = pending.state.slides[pending.index]?.firstElementChild?.src;
    if (!source) return;
    const dialog = [...document.querySelectorAll('div[role="dialog"][aria-modal="true"][aria-label="Media viewer"]')]
      .find(el => el.querySelector('img[alt="Media preview"]')?.src === source);
    if (!dialog) return;
    if (ctMediaViewer?.dialog !== dialog || ctMediaViewer?.state !== pending.state) {
      ctMediaClearViewer();
      const controls = document.createElement('div');
      controls.className = 'ct-media-carousel-controls ct-media-viewer-controls';
      controls.dataset.ctLocalUi = 'media-viewer';
      const prev = document.createElement('button');
      const next = document.createElement('button');
      const count = document.createElement('span');
      prev.type = next.type = 'button';
      prev.textContent = '‹'; next.textContent = '›';
      prev.setAttribute('aria-label', ctMediaJapanese() ? '前の写真' : 'Previous photo');
      next.setAttribute('aria-label', ctMediaJapanese() ? '次の写真' : 'Next photo');
      count.setAttribute('role', 'status');
      count.setAttribute('aria-live', 'polite');
      controls.append(prev, count, next);
      controls.addEventListener('click', event => event.stopPropagation());
      const viewer = { dialog, state: pending.state, controls, prev, next, count, index: pending.index };
      const move = index => {
        const slides = ctMediaSlides(viewer.state.grid);
        if (!dialog.isConnected || !slides.length || !viewer.state.grid.isConnected) return;
        index = Math.max(0, Math.min(slides.length - 1, index));
        if (index === viewer.index) return;
        // Call the existing image handler so React owns the enlarged image too.
        // Neither the image URL nor the native close/backdrop behavior is replaced.
        slides[index].firstElementChild.click();
        ctMediaEnhanceViewer();
      };
      prev.addEventListener('click', () => move(viewer.index - 1));
      next.addEventListener('click', () => move(viewer.index + 1));
      viewer.onKey = event => {
        if (!dialog.isConnected || event.altKey || event.ctrlKey || event.metaKey ||
            event.target.closest?.('input,textarea,[contenteditable="true"]') ||
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        move(event.key === 'Home' ? 0 : event.key === 'End' ? viewer.state.slides.length - 1 :
          viewer.index + (event.key === 'ArrowRight' ? 1 : -1));
      };
      viewer.onTouchStart = event => {
        viewer.touch = event.touches.length === 1 && event.target.matches?.('img[alt="Media preview"]') ?
          { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      };
      viewer.onTouchEnd = event => {
        const start = viewer.touch;
        viewer.touch = null;
        if (!start || event.changedTouches.length !== 1) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) move(viewer.index + (dx < 0 ? 1 : -1));
      };
      dialog.addEventListener('touchstart', viewer.onTouchStart, { passive: true });
      dialog.addEventListener('touchend', viewer.onTouchEnd, { passive: true });
      document.addEventListener('keydown', viewer.onKey, true);
      dialog.append(controls);
      ctMediaViewer = viewer;
      // rE reuses its image and React can commit src after click() returns. The
      // shared UI observer intentionally does not watch src, so watch this one
      // verified dialog until it closes, instead of polling or rewriting src.
      viewer.observer = new MutationObserver(() => ctMediaEnhanceViewer());
      viewer.observer.observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
    ctMediaViewer.index = pending.index;
    const count = `${pending.index + 1} / ${pending.state.slides.length}`;
    if (ctMediaViewer.count.textContent !== count) ctMediaViewer.count.textContent = count;
    ctMediaViewer.prev.disabled = pending.index === 0;
    ctMediaViewer.next.disabled = pending.index === pending.state.slides.length - 1;
  }
  function ctMediaStyles() {
    if (document.getElementById('ct-media-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-media-style';
    style.textContent = `
      .ct-media-carousel { display:flex!important; gap:0!important; width:100%; min-width:0; overflow-x:auto!important; overflow-y:hidden!important; scroll-snap-type:x mandatory; overscroll-behavior-x:contain; -webkit-overflow-scrolling:touch; }
      .ct-media-carousel > div { flex:0 0 100%; min-width:0; aspect-ratio:auto!important; scroll-snap-align:start; scroll-snap-stop:always; display:flex; align-items:center; justify-content:center; }
      .ct-media-carousel > div > img { width:100%; height:auto!important; max-height:min(70vh, 510px); object-fit:contain!important; }
      .ct-media-carousel:focus-visible { outline:3px solid var(--color-tl-app-primary,#1688d4); outline-offset:2px; }
      .ct-media-carousel-controls { display:flex; align-items:center; justify-content:center; gap:12px; margin-top:4px; font:13px/1.4 system-ui,sans-serif; color:var(--color-tl-app-text-muted,#657786); }
      .ct-media-carousel-controls button { min-width:44px; min-height:44px; border:0; border-radius:50%; color:inherit; background:transparent; font:26px/1 system-ui,sans-serif; cursor:pointer; }
      .ct-media-carousel-controls button:hover:not(:disabled) { background:var(--color-tl-app-bg,#edf3f8); }
      .ct-media-carousel-controls button:disabled { opacity:.3; cursor:default; }
      .ct-media-carousel-controls button:focus-visible,.ct-media-upload-status button:focus-visible { outline:3px solid var(--color-tl-app-primary,#1688d4); }
      .ct-media-viewer-controls { flex-shrink:0; margin:0; padding:0 12px max(12px,env(safe-area-inset-bottom)); color:white; }
      .ct-media-viewer-controls button:hover:not(:disabled) { background:#ffffff26; }
      .ct-media-upload-status { display:flex; align-items:center; gap:10px; font:13px/1.5 system-ui,sans-serif; color:var(--color-tl-app-text-muted,#657786); }
      .ct-media-upload-status button { flex-shrink:0; min-height:44px; padding:5px 10px; border:1px solid var(--color-tl-app-border,#b8c5d1); border-radius:8px; color:inherit; background:transparent; cursor:pointer; }
      .ct-media-upload-status [hidden] { display:none!important; }
      @media(prefers-reduced-motion:reduce) { .ct-media-carousel { scroll-behavior:auto!important; } }
    `;
    document.head.append(style);
  }
  function ctMediaEnhance(root = document) {
    ctMediaStyles();
    for (const state of ctMediaCarousels.values()) {
      if (!state.grid.isConnected || !ctMediaSlides(state.grid).length) ctMediaRemoveCarousel(state);
    }
    const inputs = [...root.querySelectorAll?.(`input[type="file"][accept="${ctMediaPhotoAccept}"]`) || []];
    if (root.matches?.(`input[type="file"][accept="${ctMediaPhotoAccept}"]`)) inputs.push(root);
    for (const input of inputs) {
      const media = ctMediaUploadRoot(input);
      if (media) {
        for (const [button, label] of [[media.photoButton, ctMediaJapanese() ? '写真を追加' : 'Add photos'],
            [media.videoButton, ctMediaJapanese() ? '動画を追加' : 'Add video']]) {
          // Current native toolbar icons have no accessible name. Preserve a
          // future native label, but keep our own label through React updates.
          const current = button.getAttribute('aria-label');
          if (!current || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(current)) {
            if (current !== label) button.setAttribute('aria-label', label);
            if (!button.title || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(button.title)) {
              if (button.title !== label) button.title = label;
            }
          }
        }
      }
      ctMediaEnhanceInput(input);
    }
    const grids = [...root.querySelectorAll?.('div.grid.rounded-2xl.overflow-hidden.border') || []];
    if (root.matches?.('div.grid.rounded-2xl.overflow-hidden.border')) grids.push(root);
    grids.forEach(ctMediaEnhanceCarousel);
    ctMediaEnhanceViewer();
  }

    // Public Japanese RSS headlines. Native tweet.app requests are not intercepted.
  // The original news container remains intact and is restored on every failure.
  const ctNewsFeeds = Object.freeze({
    nation: 'https://news.yahoo.co.jp/rss/categories/domestic.xml',
    sports: 'https://news.yahoo.co.jp/rss/categories/sports.xml',
    entertainment: 'https://news.yahoo.co.jp/rss/categories/entertainment.xml',
    technology: 'https://news.yahoo.co.jp/rss/categories/it.xml'
  });
  const ctNewsLabels = new Map([
    ['News', 'nation'], ['ニュース', 'nation'], ['Sports', 'sports'], ['スポーツ', 'sports'],
    ['Entertainment', 'entertainment'], ['エンタメ', 'entertainment'], ['エンターテインメント', 'entertainment'],
    ['Technology', 'technology'], ['テクノロジー', 'technology']
  ]);
  const ctNewsState = {
    region: null, mounts: new Map(), cache: new Map(), pending: new Map(), retryAt: new Map(),
    ttl: 15 * 60 * 1000, retryDelay: 60 * 1000, timeout: 10000,
    refreshTimer: null, refreshAt: 0, lifecycleBound: false, pageActive: true
  };
  const ctNewsPreferenceKey = 'ct-news-region-v1';
  const ctNewsCacheKey = 'ct-japanese-news-cache-v1';

  function ctNewsText(value, max = 512) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
  function ctNewsURL(value, kind = 'article') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
      if (kind === 'feed') return Object.values(ctNewsFeeds).includes(url.href) ? url.href : null;
      if (kind === 'image') {
        // Yahoo's feed images are served by its public image CDN. Never accept
        // arbitrary feed-supplied URLs (localhost, data URLs, credentials, etc.).
        return /^(?:[a-z0-9-]+\.)*yimg\.(?:jp|com)$/.test(url.hostname) ? url.href : null;
      }
      return url.hostname === 'news.yahoo.co.jp' && /^\/(?:articles|pickup|expert\/articles)\//.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function ctNewsArticle(value) {
    if (!value || typeof value !== 'object') return null;
    const title = ctNewsText(value.title);
    const url = ctNewsURL(value.url);
    if (!title || !url) return null;
    const date = Date.parse(value.publishedAt);
    return {
      title, url, image: ctNewsURL(value.image, 'image') || '',
      source: 'Yahoo!ニュース', publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : ''
    };
  }
  function ctParseJapaneseNews(xml) {
    if (typeof xml !== 'string' || !xml || xml.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || !doc.querySelector('rss > channel')) return [];
    const seen = new Set();
    const articles = [];
    for (const item of [...doc.querySelectorAll('channel > item')].slice(0, 50)) {
      const childText = name => [...item.children].find(el => el.localName === name)?.textContent || '';
      const imageElement = [...item.children].find(el => el.localName === 'image');
      const mediaElement = [...item.children].find(el =>
        (el.localName === 'thumbnail' || el.localName === 'content') &&
        el.namespaceURI === 'http://search.yahoo.com/mrss/');
      const enclosure = [...item.children].find(el => el.localName === 'enclosure' && /^image\//.test(el.getAttribute('type') || ''));
      const imageValue = imageElement?.querySelector('url')?.textContent || imageElement?.textContent ||
        mediaElement?.getAttribute('url') || enclosure?.getAttribute('url') || '';
      const article = ctNewsArticle({ title: childText('title'), url: childText('link').trim(),
        image: imageValue.trim(), publishedAt: childText('pubDate') });
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
      const parse = response => response?.status >= 200 && response.status < 300 &&
        (!response.finalUrl || response.finalUrl === target) &&
        typeof response.responseText === 'string' && response.responseText.length <= 1024 * 1024
        ? response.responseText : null;
      let request = null;
      if (typeof GM_xmlhttpRequest === 'function') request = GM_xmlhttpRequest;
      else if (typeof globalThis.GM?.xmlHttpRequest === 'function') request = globalThis.GM.xmlHttpRequest.bind(globalThis.GM);
      if (request) {
        try {
          handle = request({ method: 'GET', url: target, anonymous: true, redirect: 'error',
            timeout: ctNewsState.timeout, headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
            onload: response => finish(parse(response)), onerror: () => finish(null),
            ontimeout: () => finish(null), onabort: () => finish(null) });
          if (handle && typeof handle.then === 'function') Promise.resolve(handle).then(response => finish(parse(response)), () => finish(null));
        } catch { finish(null); }
        return;
      }
      if (typeof fetch !== 'function') return finish(null);
      Promise.resolve().then(() => fetch(target, { method: 'GET', credentials: 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', ...(aborter ? { signal: aborter.signal } : {}) }))
        .then(async response => {
          if (!response?.ok || (response.url && response.url !== target)) return null;
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
        if (!entry || !Number.isFinite(entry.at) || entry.at > Date.now() || Date.now() - entry.at >= ctNewsState.ttl || !Array.isArray(entry.articles)) continue;
        const articles = entry.articles.slice(0, 10).map(ctNewsArticle).filter(Boolean);
        if (articles.length) ctNewsState.cache.set(topic, { at: entry.at, articles });
      }
    } catch {}
  }
  async function ctLoadJapaneseNews(topic) {
    if (!Object.hasOwn(ctNewsFeeds, topic)) return null;
    const cached = ctNewsState.cache.get(topic);
    if (cached && Date.now() >= cached.at && Date.now() - cached.at < ctNewsState.ttl) return cached.articles;
    if (ctNewsState.pending.has(topic)) return ctNewsState.pending.get(topic);
    if ((ctNewsState.retryAt.get(topic) || 0) > Date.now()) return null;
    const pending = (async () => {
      const xml = await ctRequestNews(ctNewsFeeds[topic]);
      const articles = ctParseJapaneseNews(xml);
      if (!articles.length) {
        ctNewsState.retryAt.set(topic, Date.now() + ctNewsState.retryDelay);
        return null;
      }
      ctNewsState.retryAt.delete(topic);
      ctNewsState.cache.set(topic, { at: Date.now(), articles });
      try { sessionStorage.setItem(ctNewsCacheKey, JSON.stringify(Object.fromEntries(ctNewsState.cache))); } catch {}
      return articles;
    })().finally(() => ctNewsState.pending.delete(topic));
    ctNewsState.pending.set(topic, pending);
    return pending;
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
  }
  function ctNewsSetText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function ctNewsUnhide(mount) {
    if (mount.container.classList.contains('ct-news-native-hidden')) mount.container.classList.remove('ct-news-native-hidden');
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
    controls.append(japan, world);
    const status = document.createElement('p');
    status.className = 'ct-news-status';
    status.setAttribute('role', 'status');
    const list = document.createElement('div');
    list.className = 'ct-news-list';
    panel.append(controls, status, list);
    target.container.before(panel);
    const mount = { ...target, panel, status, list, japan, world, rendered: null, loading: null };
    for (const button of [japan, world]) button.addEventListener('click', () => {
      ctNewsState.region = button.dataset.ctNewsRegion;
      try { localStorage.setItem(ctNewsPreferenceKey, ctNewsState.region); } catch {}
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
    for (const button of [mount.japan, mount.world]) {
      const selected = button.dataset.ctNewsRegion === ctNewsState.region;
      const value = String(selected);
      if (button.getAttribute('aria-pressed') !== value) button.setAttribute('aria-pressed', value);
    }
    if (!japan) {
      ctNewsUnhide(mount);
      if (!mount.list.hidden) mount.list.hidden = true;
      ctNewsSetText(mount.status, '');
      return;
    }
    const cached = ctNewsState.cache.get(mount.topic);
    if (cached && Date.now() >= cached.at && Date.now() - cached.at < ctNewsState.ttl) {
      ctNewsRenderArticles(mount, cached.articles);
      if (mount.list.hidden) mount.list.hidden = false;
      if (!mount.container.classList.contains('ct-news-native-hidden')) mount.container.classList.add('ct-news-native-hidden');
      ctNewsSetText(mount.status, ja ? 'Yahoo!ニュース · 見出しを押すと記事が開きます' : 'Yahoo! News Japan · Open a headline to read the article');
      return;
    }
    // Already-started requests may finish in the background. Their completion
    // must not start another request until the page is visible again.
    if (!ctNewsState.pageActive || document.hidden) return;
    ctNewsUnhide(mount);
    if (!mount.list.hidden) mount.list.hidden = true;
    if ((ctNewsState.retryAt.get(mount.topic) || 0) > Date.now()) {
      ctNewsSetText(mount.status, ja ? '日本のニュースを取得できなかったため、世界のニュースを表示しています。' : 'Japanese news is unavailable. Showing world news.');
      return;
    }
    ctNewsSetText(mount.status, ja ? '日本のニュースを読み込み中…' : 'Loading Japanese news…');
    if (mount.loading === mount.topic) return;
    const topic = mount.topic;
    mount.loading = topic;
    ctLoadJapaneseNews(topic).finally(() => {
      if (mount.loading === topic) mount.loading = null;
      if (mount.panel.isConnected && ctNewsState.mounts.get(mount.container) === mount) patchJapaneseNews();
    });
  }
  function patchJapaneseNews() {
    ctNewsBindLifecycle();
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
      style.textContent = `.ct-news-native-hidden{display:none!important}.ct-news-controls{display:flex;gap:8px;padding:12px 16px 4px}.ct-news-controls button{min-height:44px;border:1px solid var(--color-tl-app-border,#ccd6dd);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:5px 14px;cursor:pointer}.ct-news-controls button[aria-pressed="true"]{background:#1d9bf0;border-color:#1d9bf0;color:#fff}.ct-news-controls button:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}.ct-news-status{margin:0;padding:4px 16px 10px;font-size:12px;line-height:1.5;color:inherit;opacity:.72}.ct-news-status:empty{display:none}.ct-news-article{display:block;padding:12px 16px;border-bottom:1px solid var(--color-tl-app-border,#ccd6dd);color:inherit;text-decoration:none}.ct-news-article:hover{background:rgba(127,127,127,.06)}.ct-news-article img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;border:1px solid var(--color-tl-app-border,#ccd6dd)}.ct-news-article img[hidden]{display:none}.ct-news-article h3{font-size:17px;line-height:1.4;font-weight:700;margin:12px 0 6px}.ct-news-source{margin:0;font-size:13px;line-height:1.5;opacity:.7}.ct-news-list[hidden]{display:none}`;
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
      [data-testid="tweet-like-action"].ct-favorite-button > svg { display:none!important; }
      [data-testid="tweet-like-action"] > .ct-star {
        display:inline-flex; width:20px; height:20px; align-items:center; justify-content:center;
        transform-origin:center; pointer-events:none;
      }
      [data-testid="tweet-like-action"] > .ct-star svg {
        display:block!important; width:20px; height:20px; fill:none; stroke:currentColor;
        stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;
      }
      [data-testid="tweet-like-action"].ct-is-liked { color:#ffac33!important; }
      [data-testid="tweet-like-action"].ct-is-liked > .ct-star svg { fill:currentColor; }
      @media (hover:hover) {
        [data-testid="tweet-like-action"].ct-favorite-button:hover {
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
      if (!el.hasAttribute('aria-label') && el.matches('button.absolute.top-4.right-4') &&
          el.querySelector(':scope > svg.lucide-x') &&
          el.parentElement?.matches('div.bg-tl-app-card.border.rounded-3xl.max-w-lg') &&
          el.parentElement.querySelector('textarea#public-modal-tweet-input')) el.setAttribute('aria-label', 'Close');
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


  function loadFavorites() { return ctProfileLoadFavorites(); }

  function saveFavorite(item, uid) { return ctProfileSaveFavorite(item, uid); }

  function removeFavorite(id, uid) { return ctProfileRemoveFavorite(id, uid); }

  document.addEventListener('click', ctCaptureFavoriteClick, true);


  let favoritesActive = false;









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
      patchExactPostTime(root);
      patchProfileFounder();
      patchFavoriteProfileTab();

      if (favoritesActive) renderFavoritesPanel();
      renderReplyPanel();
      patchReplyBadge();
    patchNavigation(root);
    patchOfficialBadges(root);
    ctMediaEnhance(root);
    patchJapaneseNews(root);
    } catch (error) {
      console.debug('[Classic Twitter EN]', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  console.log('🐦 Classic Twitter EN v6.10.0 loaded');
})();
