const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/network.js'), 'utf8');
const apiURL = 'https://api.tweet.app/api/users/by-username/alice';
const firebaseKey = 'firebase:authUser:public_api_key:[DEFAULT]';
const tokenA = 'test-token-a.'.repeat(6);
const tokenB = 'test-token-b.'.repeat(6);
function authValue(token = tokenA, uid = 'viewer', expirationTime = Date.now() + 60000) {
  return { uid, apiKey: 'public_api_key', stsTokenManager: { accessToken: token, expirationTime } };
}
function storage(values = {}) {
  const map = new Map(Object.entries(values));
  const reads = [];
  return {
    reads, map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i]; },
    getItem(key) { reads.push(key); return map.get(key) ?? null; }
  };
}
function harness(overrides = {}) {
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    localStorage: storage(), sessionStorage: storage(),
    ...overrides
  });
  vm.runInContext(`const profileCache = new Map(); const profilePending = new Map();
    const PROFILE_API = 'https://api.tweet.app/api/users/by-username/';
    ${source}
    globalThis.network = { requestJSON, getAuth, getCachedAuth, fetchProfile,
      state: ctNetworkState, profileCache, profilePending };`, context);
  context.network.state.requestTimeout = 25;
  context.network.state.authTimeout = 20;
  return context;
}
function idbMock(rows = [], options = {}) {
  const stats = { opens: 0, closes: 0, ranges: [], aborts: 0 };
  const db = {
    objectStoreNames: { contains: () => options.missingStore !== true },
    close() { stats.closes += 1; },
    transaction(name, mode) {
      assert.equal(name, 'firebaseLocalStorage'); assert.equal(mode, 'readonly');
      return { objectStore() { return { openCursor(range) {
        stats.ranges.push(range);
        const request = {};
        let offset = 0;
        const emit = () => queueMicrotask(() => {
          if (options.cursorError) return request.onerror?.();
          const entry = rows[offset++];
          request.result = entry ? { key: entry.key, value: { value: entry.value }, continue: emit } : null;
          request.onsuccess?.();
        });
        emit(); return request;
      } }; } };
    }
  };
  return {
    stats,
    IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) },
    indexedDB: { open(name) {
      assert.equal(name, 'firebaseLocalStorageDb'); stats.opens += 1;
      const request = { result: db, transaction: { abort() { stats.aborts += 1; } } };
      const complete = () => {
        if (options.newDatabase) request.onupgradeneeded?.();
        else if (options.openError) request.onerror?.();
        else request.onsuccess?.();
      };
      if (options.delay) setTimeout(complete, options.delay);
      else queueMicrotask(complete);
      return request;
    } }
  };
}

test('rejects non-API, insecure, credential-bearing and foreign URLs before transport', async () => {
  let calls = 0;
  const c = harness({ GM_xmlhttpRequest() { calls += 1; } });
  for (const url of ['http://api.tweet.app/api/posts', 'https://other.test/api/posts',
    'https://api.tweet.app.evil.test/api/posts', 'https://api.tweet.app/posts',
    'https://name:password@api.tweet.app/api/posts', '/api/posts',
    'https://api.tweet.app/api/../private', 'https://api.tweet.app/api/posts#fragment']) {
    assert.equal(await c.network.requestJSON(url, { Authorization: `Bearer ${tokenA}` }), null);
  }
  assert.equal(calls, 0);
});

test('legacy GM request is GET-only, finite, cookie-free and returns parsed JSON', async () => {
  let options;
  const c = harness({ GM_xmlhttpRequest(value) {
    options = value;
    queueMicrotask(() => value.onload({ status: 200, responseText: '{"value":4}', finalUrl: apiURL }));
  } });
  assert.equal((await c.network.requestJSON(apiURL, { Authorization: `Bearer ${tokenA}`, Cookie: 'never-send' })).value, 4);
  assert.equal(options.method, 'GET'); assert.equal(options.timeout, 25);
  assert.equal(options.redirect, 'error'); assert.equal(options.anonymous, true);
  assert.equal(options.responseType, 'text');
  assert.equal(options.headers.Authorization, `Bearer ${tokenA}`);
  assert.equal(options.headers.Cookie, undefined);
});

test('GM Promise method retains receiver and handles success or rejection', async () => {
  const gm = { marker: true, xmlHttpRequest() {
    assert.equal(this, gm);
    return Promise.resolve({ status: 200, responseText: '{"ok":true}' });
  } };
  const c = harness({ GM: gm });
  assert.equal((await c.network.requestJSON(apiURL)).ok, true);
  gm.xmlHttpRequest = function () { assert.equal(this, gm); return Promise.reject(new Error('failure')); };
  assert.equal(await c.network.requestJSON(apiURL), null);
});

test('GM hung callback or promise reaches deadline and aborts', async () => {
  let aborts = 0;
  const handle = new Promise(() => {}); handle.abort = () => { aborts += 1; };
  const c = harness({ GM: { xmlHttpRequest: () => handle } });
  assert.equal(await c.network.requestJSON(apiURL), null);
  assert.equal(aborts, 1);
});

test('GM callback plus promise settles once, malformed/status/redirect failures return null', async () => {
  for (const response of [
    { status: 401, responseText: '{}' }, { status: 500, responseText: '{}' },
    { responseText: '{}' }, { status: 200, responseText: '<html>' },
    { status: 200, responseText: '{}', finalUrl: 'https://other.test/api/posts' }
  ]) {
    const c = harness({ GM_xmlhttpRequest(options) { options.onload(response); return Promise.resolve(response); } });
    assert.equal(await c.network.requestJSON(apiURL), null);
  }
});

test('throwing GM transport returns null without duplicate fetch', async () => {
  const c = harness({ GM_xmlhttpRequest() { throw new Error('not available'); },
    fetch() { throw new Error('must not retry with a second transport'); } });
  assert.equal(await c.network.requestJSON(apiURL), null);
});

test('Stay text response fallback supports missing or unavailable responseText', async () => {
  for (const response of [
    { status: 200, response: '{"ok":true}' },
    { status: 200, responseText: null, response: '{"ok":true}' },
    { status: 200, get responseText() { throw new Error('unavailable'); }, response: '{"ok":true}' }
  ]) {
    const c = harness({ GM_xmlhttpRequest(options) { queueMicrotask(() => options.onload(response)); } });
    assert.equal((await c.network.requestJSON(apiURL)).ok, true);
  }
});

test('zero-status acknowledgement and partial Promise wait for the actual callback', async () => {
  for (const ack of [{ status: 0 }, { status: 200, readyState: 2, responseText: '{}' }]) {
    let callbacks = 0;
    const c = harness({ GM_xmlhttpRequest(options) {
      setTimeout(() => { callbacks++; options.onload({ status: 200, response: '{"ok":true}' }); }, 5);
      return Promise.resolve(ack);
    } });
    assert.equal((await c.network.requestJSON(apiURL)).ok, true);
    assert.equal(callbacks, 1);
  }
});

test('incomplete Promise acknowledgements without callbacks remain bounded and abort', async () => {
  for (const ack of [{ status: 0 }, { status: 200, readyState: 3 }]) {
    let aborts = 0;
    const c = harness({ GM_xmlhttpRequest() {
      const pending = Promise.resolve(ack); pending.abort = () => aborts++;
      return pending;
    } });
    assert.equal(await c.network.requestJSON(apiURL), null);
    assert.equal(aborts, 1);
  }
});

test('response text is bounded and structured or malformed manager values are rejected', async () => {
  for (const response of [
    { status: 200, response: { ok: true } },
    { status: 200, response: new Blob(['{}']) },
    { status: 200, response: '<html>' },
    { status: 200, response: ' '.repeat(2 * 1024 * 1024 + 1) },
    { status: 200, responseText: {}, response: '{}' },
    { status: 200, responseText: 'bad', response: '{}' },
    { status: 200, responseText: '', response: '{}' }
  ]) {
    const c = harness({ GM_xmlhttpRequest(options) { options.onload(response); } });
    assert.equal(await c.network.requestJSON(apiURL), null);
  }
});

test('both manager final URLs must match the requested endpoint exactly', async () => {
  for (const extra of [
    { finalUrl: 'https://api.tweet.app/api/posts' },
    { responseURL: 'https://api.tweet.app/api/posts' },
    { finalUrl: apiURL, responseURL: 'https://other.test/api/users/by-username/alice' },
    { finalUrl: apiURL + '?other=1' },
    { responseURL: 'https://name:password@api.tweet.app/api/users/by-username/alice' }
  ]) {
    const c = harness({ GM_xmlhttpRequest(options) { options.onload({ status: 200, response: '{}', ...extra }); } });
    assert.equal(await c.network.requestJSON(apiURL), null);
  }
  const c = harness({ GM_xmlhttpRequest(options) {
    options.onload({ status: 200, response: '{"ok":true}',
      finalUrl: 'https://API.TWEET.APP:443/api/users/by-username/alice', responseURL: apiURL });
  } });
  assert.equal((await c.network.requestJSON(apiURL)).ok, true);
});

test('fetch also rejects another endpoint on the same API host', async () => {
  const c = harness({ fetch: async () => ({ ok: true, url: 'https://api.tweet.app/api/posts', text: async () => '{}' }) });
  assert.equal(await c.network.requestJSON(apiURL), null);
});

test('late callback and Promise cannot replace the first completed result', async () => {
  let onload;
  const c = harness({ GM_xmlhttpRequest(options) {
    onload = options.onload;
    options.onload({ status: 200, response: '{"first":true}' });
    return Promise.resolve({ status: 200, response: '{"first":false}' });
  } });
  const result = await c.network.requestJSON(apiURL);
  onload({ status: 200, response: '{"first":false}' });
  assert.equal(result.first, true);
});

test('fetch has an abort deadline, redirect denial and no ambient cookies', async () => {
  let options;
  const c = harness({ fetch: (url, value) => { options = value; return new Promise(() => {}); } });
  assert.equal(await c.network.requestJSON(apiURL), null);
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error'); assert.equal(options.signal.aborted, true);
});

test('fetch success JSON and body-read hangs are both bounded', async () => {
  const c = harness({ fetch: async () => ({ ok: true, url: apiURL, text: async () => '{"ok":true}' }) });
  assert.equal((await c.network.requestJSON(apiURL)).ok, true);
  c.fetch = async () => ({ ok: true, text: () => new Promise(() => {}) });
  assert.equal(await c.network.requestJSON(apiURL), null);
});

test('auth reads only the Firebase default-user key, never a general auth/token key', async () => {
  const local = storage({ 'other-auth': JSON.stringify(authValue()),
    'firebase:unrelated': JSON.stringify(authValue()), [firebaseKey]: JSON.stringify(authValue()) });
  const c = harness({ localStorage: local });
  const result = await c.network.getAuth();
  assert.equal(result.token, tokenA); assert.equal(result.uid, 'viewer');
  assert.deepEqual(local.reads, [firebaseKey]);
});

test('auth deduplicates concurrent lookups but refreshes immediately after token change or logout', async () => {
  const local = storage({ [firebaseKey]: JSON.stringify(authValue()) });
  let refreshes = 0;
  const c = harness({ localStorage: local, ctScheduleScan() { refreshes++; } });
  const first = c.network.getAuth(); assert.equal(c.network.getAuth(), first);
  assert.equal((await first).token, tokenA);
  assert.equal(refreshes, 1, 'an asynchronously discovered identity refreshes account-scoped UI');
  local.map.set(firebaseKey, JSON.stringify(authValue(tokenB)));
  assert.equal((await c.network.getCachedAuth()).token, tokenB);
  assert.equal(refreshes, 1, 'token refresh for the same account does not trigger repeated scans');
  local.map.delete(firebaseKey);
  assert.equal(await c.network.getAuth(), null);
  assert.equal(refreshes, 2, 'sign-out clears account-scoped UI even without another native mutation');
  assert.equal(c.network.state.authPending, null);
});

test('expired tokens, arbitrary nested tokens and mixed accounts are rejected', async () => {
  for (const value of [authValue(tokenA, 'viewer', Date.now() - 1),
    authValue(tokenA, 'viewer', 'invalid'), { nested: authValue() },
    { uid: 'viewer', accessToken: tokenA }]) {
    const c = harness({ localStorage: storage({ [firebaseKey]: JSON.stringify(value) }) });
    assert.equal(await c.network.getAuth(), null);
  }
  const c = harness({ localStorage: storage({ [firebaseKey]: JSON.stringify(authValue()) }),
    sessionStorage: storage({ [firebaseKey]: JSON.stringify(authValue(tokenB, 'other-viewer')) }) });
  assert.equal(await c.network.getAuth(), null);
});

test('IDB reads only the Firebase user key range and closes connection after success', async () => {
  const mock = idbMock([{ key: firebaseKey, value: authValue() },
    { key: 'firebase:not-a-user', value: authValue(tokenB, 'other-viewer') }]);
  const c = harness(mock);
  assert.equal((await c.network.getAuth()).token, tokenA);
  assert.equal(mock.stats.closes, 1);
  assert.equal(mock.stats.ranges[0].lower, 'firebase:authUser:');
});

test('IDB closes on missing store and cursor failure; unavailable IDB uses Stay storage fallback', async () => {
  for (const options of [{ missingStore: true }, { cursorError: true }, { openError: true }]) {
    const mock = idbMock([], options);
    const c = harness({ ...mock, sessionStorage: storage({ [firebaseKey]: JSON.stringify(authValue()) }) });
    assert.equal((await c.network.getAuth()).token, tokenA);
    assert.equal(mock.stats.closes, options.openError ? 0 : 1);
  }
});

test('IDB timeout resolves; late database success still closes the connection', async () => {
  const mock = idbMock([{ key: firebaseKey, value: authValue() }], { delay: 35 });
  const c = harness(mock);
  assert.equal(await c.network.getAuth(), null);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(mock.stats.closes, 1);
});

test('opening a nonexistent Firebase database aborts upgrade and closes', async () => {
  const mock = idbMock([], { newDatabase: true });
  const c = harness(mock);
  assert.equal(await c.network.getAuth(), null);
  assert.equal(mock.stats.aborts, 1); assert.equal(mock.stats.closes, 1);
});

test('profile requests deduplicate, normalize the handle, and cache only validated profiles', async () => {
  let calls = 0, requested;
  const c = harness({ localStorage: storage({ [firebaseKey]: JSON.stringify(authValue()) }),
    GM_xmlhttpRequest(options) {
      calls += 1; requested = options.url;
      queueMicrotask(() => options.onload({ status: 200, responseText: '{"user":{"username":"alice","displayName":"Alice"}}' }));
    } });
  const first = c.network.fetchProfile('@ALICE');
  assert.equal(c.network.fetchProfile('alice'), first);
  assert.equal((await first).displayName, 'Alice');
  assert.equal(requested, apiURL);
  assert.equal((await c.network.fetchProfile('alice')).displayName, 'Alice');
  assert.equal(calls, 1); assert.equal(c.network.profilePending.size, 0);
});

test('invalid profile names never request; failed responses enter bounded backoff then recover', async () => {
  let calls = 0;
  const c = harness({ localStorage: storage({ [firebaseKey]: JSON.stringify(authValue()) }),
    GM_xmlhttpRequest(options) {
      calls += 1;
      options.onload({ status: 200, responseText: calls === 1 ? '{"success":false,"message":"failed"}' : '{"username":"alice"}' });
    } });
  assert.equal(await c.network.fetchProfile('../admin'), null);
  assert.equal(await c.network.fetchProfile('alice'), null);
  assert.equal(await c.network.fetchProfile('alice'), null); assert.equal(calls, 1);
  assert.equal(c.network.profileCache.size, 0);
  c.network.state.profileFailures.get('alice').nextTry = 0;
  assert.equal((await c.network.fetchProfile('alice')).username, 'alice');
  assert.equal(calls, 2); assert.equal(c.network.state.profileFailures.size, 0);
});

test('profile cache refreshes after TTL and account changes, mismatched identity is not cached', async () => {
  let calls = 0;
  const local = storage({ [firebaseKey]: JSON.stringify(authValue()) });
  const c = harness({ localStorage: local, GM_xmlhttpRequest(options) {
    calls += 1;
    options.onload({ status: 200, responseText: JSON.stringify({ username: calls === 4 ? 'mallory' : 'alice' }) });
  } });
  await c.network.fetchProfile('alice');
  c.network.state.profileTimes.set('alice', 0); await c.network.fetchProfile('alice');
  local.map.set(firebaseKey, JSON.stringify(authValue(tokenB, 'viewer-2')));
  await c.network.fetchProfile('alice'); assert.equal(calls, 3);
  c.network.state.profileTimes.set('alice', 0);
  assert.equal(await c.network.fetchProfile('alice'), null);
  assert.equal(c.network.profileCache.size, 0);
});


test('sandbox lexical GM works without a global property and retains its receiver', async () => {
  const manager = { xmlHttpRequest(options) {
    assert.equal(this, manager);
    assert.equal(options.method, 'GET');
    return Promise.resolve({ status: 200, responseText: '{"lexical":true}', finalUrl: apiURL });
  } };
  const c = harness({ manager, fetch() { throw new Error('must use the manager'); } });
  vm.runInContext('const GM = manager;', c);
  assert.equal(c.GM, undefined);
  assert.equal((await c.network.requestJSON(apiURL)).lexical, true);
});

test('manager acknowledgement waits for the HTTP callback and remains bounded without it', async () => {
  for (const acknowledgement of [undefined, null, { requestId: 17 }]) {
    let callback;
    const c = harness({ GM: { xmlHttpRequest(options) { callback = options; return Promise.resolve(acknowledgement); } } });
    const pending = c.network.requestJSON(apiURL);
    await Promise.resolve();
    callback.onload({ status: 200, responseText: '{"callback":true}', finalUrl: apiURL });
    assert.equal((await pending).callback, true);
  }
  const c = harness({ GM: { xmlHttpRequest() { return Promise.resolve(undefined); } } });
  assert.equal(await c.network.requestJSON(apiURL), null, 'acknowledgement without a callback reaches the deadline');
});
