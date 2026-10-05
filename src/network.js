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
