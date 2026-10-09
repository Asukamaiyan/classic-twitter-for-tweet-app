const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/favorite-history.js'), 'utf8');
const checkpointKey = 'favorites:history:uid:account-a';
const post = (id = 'post-a', liked = true, extra = {}) => ({ id, hasLiked: liked,
  authorUsername: 'alice', authorName: 'Alice', text: 'Original post text',
  createdAt: '2026-09-30T07:00:00.000Z', ...extra });
const page = (posts = [], nextCursor = null) => ({ success: true, posts, nextCursor });
const detail = value => ({ success: true, post: value });
function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(t, stored = {}) {
  const dom = new JSDOM('<!doctype html><body></body>',
    { url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  const f = { w, now: 100000, calls: [], saves: [], favorites: new Map(), events: 0, hidden: false,
    timers: new Map(), timerId: 0, authUID: 'account-a', storageFailure: false };
  for (const [key, value] of Object.entries(stored)) w.localStorage.setItem(key, value);
  Object.defineProperty(w.document, 'hidden', { get: () => f.hidden });
  w.Date.now = () => f.now;
  w.setTimeout = (cb, delay) => {
    const id = ++f.timerId; f.timers.set(id, { cb, delay });
    if (!f.holdTimers) Promise.resolve().then(() => {
      const timer = f.timers.get(id); if (!timer) return;
      f.timers.delete(id); f.now += timer.delay; timer.cb();
    });
    return id;
  };
  w.clearTimeout = id => f.timers.delete(id);
  const nativeSet = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (key, value) {
    if (f.storageFailure && key.includes(':history:uid:')) throw new Error('quota');
    return nativeSet.call(this, key, value);
  };
  w.getAuth = async () => {
    w.identity.authUID = f.authUID;
    return f.authUID ? { uid: f.authUID, token: 'fixture-token' } : null;
  };
  w.requestJSON = async (url, headers) => {
    f.calls.push({ url, at: f.now, authorization: headers.Authorization });
    return f.respond ? f.respond(new URL(url), f.calls.length) : page();
  };
  w.ctProfileRememberLikedPosts = (posts, uid) => {
    f.saves.push({ posts: [...posts], uid });
    let count = 0;
    for (const item of posts) {
      if (f.removed?.has(item.id)) continue;
      if (!f.favorites.has(item.id)) count++;
      f.favorites.set(item.id, item);
    }
    return count;
  };
  w.eval(`const KEY={favorites:'favorites'}; const API_ORIGIN='https://api.tweet.app';
    const ctNetworkState={authUID:'account-a'}; let ctPageActive=true;
    const ctProfileState={storageError:false,dirtyMemory:new Set()};
    function ctProfileId(value){return typeof value==='string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)?value:null;}
    function ctProfileHandle(value){return typeof value==='string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value)?value.toLowerCase():null;}
    ${source}
    window.identity=ctNetworkState; window.profileState=ctProfileState;
    window.qa={status:ctFavoriteHistoryStatus,run:ctRunFavoriteHistory,stop:ctStopFavoriteHistory,
      restart:ctRestartFavoriteHistory,setActive:value=>{ctPageActive=value;}};`);
  w.addEventListener('ct-favorite-history-change', () => { f.events++; w.qa.status(); });
  f.status = () => w.qa.status();
  f.run = () => w.qa.run();
  f.savedCheckpoint = () => JSON.parse(w.localStorage.getItem(checkpointKey));
  return f;
}
async function until(check) {
  for (let i = 0; i < 200 && !check(); i++) await Promise.resolve();
  assert.ok(check(), 'the asynchronous operation reached the expected boundary');
}

test('explicit history scan pages both existing feeds and stores only fresh server Favorites', async t => {
  const f = harness(t);
  assert.equal(f.calls.length, 0);
  f.respond = url => {
    if (url.pathname === '/api/posts/post-a') return detail(post());
    if (url.searchParams.get('scope') === 'following') return page([post(), post('not-liked', false)]);
    return url.searchParams.has('cursor') ? page() : page([post(), post('plain', false)], 'opaque-next');
  };
  const status = await f.run();
  assert.equal(status.done, true); assert.equal(status.pages, 3);
  assert.equal(status.scanned, 4); assert.equal(status.recovered, 1);
  assert.equal(status.busy, false); assert.equal(status.error, '');
  assert.equal(f.favorites.size, 1); assert.equal(f.events >= 5, true);
  assert.equal(f.calls.filter(call => call.url.endsWith('/post-a')).length, 1);
  for (let i = 1; i < f.calls.length; i++) assert.ok(f.calls[i].at - f.calls[i - 1].at >= 800);
  assert.equal(f.calls.every(call => call.authorization === 'Bearer fixture-token'), true);
  assert.equal(f.calls.every(call => new URL(call.url).origin === 'https://api.tweet.app'), true);
  assert.equal(f.calls.filter(call => new URL(call.url).pathname === '/api/posts')
    .every(call => new URL(call.url).searchParams.get('limit') === '20'), true);
  const safe = JSON.stringify(status) + f.w.localStorage.getItem(checkpointKey);
  assert.doesNotMatch(safe, /fixture-token|Original post text|alice|account-a/);
});

test('feed failure preserves the same cursor and a later Run retries from that checkpoint', async t => {
  const f = harness(t); let fail = true;
  f.respond = url => {
    if (url.searchParams.get('scope') === 'following') return page();
    if (!url.searchParams.has('cursor')) return page([post('plain', false)], 'c1');
    return fail ? null : page();
  };
  const failed = await f.run(); assert.equal(failed.error, 'response'); assert.equal(failed.pages, 1);
  assert.equal(f.savedCheckpoint().sources['for-you'].cursor, 'c1');
  fail = false; const resumed = await f.run();
  assert.equal(resumed.done, true); assert.equal(resumed.pages, 3);
  assert.equal(new URL(f.calls[2].url).searchParams.get('cursor'), 'c1');
});

test('repeated and cyclic opaque cursors reject the page before saving and survive reload', async t => {
  const f = harness(t); f.respond = url => !url.searchParams.has('cursor') ? page([], 'c1') :
    url.searchParams.get('cursor') === 'c1' ? page([], 'c2') : page([post()], 'c1');
  const status = await f.run(); assert.equal(status.error, 'cursor'); assert.equal(status.pages, 2);
  assert.equal(f.calls.length, 3); assert.equal(f.favorites.size, 0);
  const next = harness(t, { [checkpointKey]: f.w.localStorage.getItem(checkpointKey) });
  next.respond = () => page([], 'c2');
  assert.equal((await next.run()).error, 'cursor');
  assert.equal(new URL(next.calls[0].url).searchParams.get('cursor'), 'c2');
});

test('malformed feed payloads cannot advance a checkpoint or recover partial Favorites', async t => {
  for (const response of [ { posts: [] }, { success: true, posts: [], nextCursor: {} },
    { success: true, posts: [], nextCursor: '' }, { success: true, posts: [], nextCursor: 'x\n' },
    { success: true, posts: [post(), { id: 'bad' }], nextCursor: null },
    { success: false, posts: [post()], nextCursor: null },
    { success: true, posts: [post()], nextCursor: null, error: 'partial' } ]) {
    const f = harness(t); f.respond = () => response;
    const status = await f.run(); assert.equal(status.error, 'response');
    assert.equal(status.pages, 0); assert.equal(f.favorites.size, 0);
    assert.equal(f.savedCheckpoint(), null);
  }
});

test('optimistic or rolled-back Like never becomes a historical Favorite', async t => {
  const f = harness(t);
  f.respond = url => url.pathname === '/api/posts/post-a' ? detail(post('post-a', false)) :
    url.searchParams.get('scope') === 'following' ? page() : page([post()]);
  const status = await f.run(); assert.equal(status.done, true); assert.equal(status.recovered, 0);
  assert.equal(f.favorites.size, 0);
});

test('blocked timeline stubs and freshly blocked details are skipped without losing history progress',async t=>{
  const f=harness(t);
  f.respond=url=>url.pathname==='/api/posts/post-a'?detail(post('post-a',true,{status:'BLOCKED'})):
    url.searchParams.get('scope')==='following'?page():page([{id:'blocked-stub',hasLiked:true,status:'BLOCKED'},post()]);
  const status=await f.run();assert.equal(status.done,true);assert.equal(status.error,'');
  assert.equal(status.recovered,0);assert.equal(f.favorites.size,0);
  assert.equal(f.calls.some(call=>call.url.endsWith('/blocked-stub')),false);
});

test('repost wrappers normalize to fresh original IDs and never save a mismatched author or wrapper', async t => {
  const f = harness(t);
  f.respond = url => {
    if (url.pathname === '/api/posts/original-a') return detail(post('original-a'));
    if (url.pathname === '/api/posts/wrong-author') return detail(post('wrong-author', true, { authorUsername: 'bob' }));
    if (url.pathname === '/api/posts/still-wrapper') return detail(post('still-wrapper', true, { isRepost: true }));
    return url.searchParams.get('scope') === 'following' ? page() : page([
      post('repost-row', true, { authorUsername: 'bob', isRepost: true, originalPostId: 'original-a', repostedBy: { username: 'bob' } }),
      post('original-a'), post('wrong-author'), post('still-wrapper'), post('no-original-id', true, { isRepost: true }) ]);
  };
  const status = await f.run(); assert.equal(status.recovered, 1);
  assert.deepEqual([...f.favorites.keys()], ['original-a']);
  assert.equal(f.calls.filter(call => call.url.endsWith('/original-a')).length, 1);
  assert.equal(f.calls.some(call => call.url.endsWith('/repost-row')), false);
  assert.equal(f.calls.some(call => call.url.endsWith('/no-original-id')), false);
});

test('a rejected fresh Like can be rechecked if a later feed newly confirms the same ID', async t => {
  const f = harness(t); let reads = 0;
  f.respond = url => url.pathname === '/api/posts/post-a' ? detail(post('post-a', ++reads > 1)) : page([post()]);
  const status = await f.run(); assert.equal(status.done, true); assert.equal(status.recovered, 1);
  assert.equal(reads, 2); assert.equal(f.favorites.size, 1);
});

test('fresh detail errors pause on the same page rather than silently losing an older Favorite', async t => {
  const f = harness(t); let fail = true;
  f.respond = url => url.pathname === '/api/posts/post-a' ? fail ? null : detail(post()) :
    url.searchParams.get('scope') === 'following' ? page() : page([post()]);
  const failed = await f.run(); assert.equal(failed.error, 'network'); assert.equal(failed.pages, 0);
  assert.equal(f.favorites.size, 0); assert.equal(f.savedCheckpoint(), null);
  fail = false; const retried = await f.run(); assert.equal(retried.done, true); assert.equal(retried.recovered, 1);
});

test('Stop invalidates an in-flight response and concurrent Run cannot start another read', async t => {
  const f = harness(t); const pending = deferred(); f.respond = () => pending.promise;
  const work = f.run(); await until(() => f.calls.length === 1);
  assert.equal((await f.run()).busy, true); assert.equal(f.calls.length, 1);
  const stopped = f.w.qa.stop(); assert.equal(stopped.paused, true); assert.equal(stopped.pausedReason, 'stopped');
  pending.resolve(page([post()])); const result = await work;
  assert.equal(result.busy, false); assert.equal(result.pages, 0);
  assert.equal(f.saves.length, 0); assert.equal(f.savedCheckpoint(), null);
});

test('Stop wakes pacing waits without letting a delayed next request start', async t => {
  const f = harness(t); f.holdTimers = true;
  f.respond = () => page([], 'c1');
  const work = f.run(); await until(() => f.timers.size === 1);
  assert.equal(f.calls.length, 1); f.w.qa.stop(); await work;
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.savedCheckpoint().sources['for-you'].cursor, 'c1');
});

test('backgrounding discards a pending page and returning to foreground requires explicit Continue', async t => {
  const f = harness(t); const pending = deferred(); f.respond = () => pending.promise;
  const work = f.run(); await until(() => f.calls.length === 1);
  f.hidden = true; f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
  pending.resolve(page([post()])); const stopped = await work;
  assert.equal(stopped.pausedReason, 'background'); assert.equal(f.saves.length, 0);
  f.hidden = false; f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
  await Promise.resolve(); assert.equal(f.calls.length, 1);
  f.respond = () => page(); assert.equal((await f.run()).done, true);
});

test('pagehide cancels in-flight reads without storing a checkpoint from the late result', async t => {
  const f = harness(t); const pending = deferred(); f.respond = () => pending.promise;
  const work = f.run(); await until(() => f.calls.length === 1);
  f.w.qa.setActive(false); f.w.dispatchEvent(new f.w.Event('pagehide'));
  pending.resolve(page()); const status = await work;
  assert.equal(status.pausedReason, 'background'); assert.equal(f.savedCheckpoint(), null);
  assert.equal((await f.run()).pages, 0); assert.equal(f.calls.length, 1);
});

test('account change during a fresh detail discards all old-account results', async t => {
  const f = harness(t); const pending = deferred();
  f.respond = url => url.pathname === '/api/posts/post-a' ? pending.promise : page([post()]);
  const work = f.run(); await until(() => f.calls.length === 2);
  f.authUID = 'account-b'; f.w.identity.authUID = 'account-b';
  // UI status may be read immediately when account controls change.
  assert.equal(f.status().pages, 0);
  pending.resolve(detail(post())); const status = await work;
  assert.equal(status.pages, 0); assert.equal(f.saves.length, 0);
  assert.equal(f.savedCheckpoint(), null);
  assert.equal(f.w.localStorage.getItem('favorites:history:uid:account-b'), null);
});

test('checkpoint persists across reload under its UID without storing tokens or post text', async t => {
  const f = harness(t); f.holdTimers = true; f.respond = () => page([post('plain', false)], 'next-cursor');
  const work = f.run(); await until(() => f.timers.size === 1); f.w.qa.stop(); await work;
  const serialized = f.w.localStorage.getItem(checkpointKey);
  assert.doesNotMatch(serialized, /fixture-token|Original post text|authorUsername/);
  const loaded = harness(t, { [checkpointKey]: serialized });
  assert.equal(loaded.status().pages, 1); assert.equal(loaded.status().scanned, 1);
  loaded.respond = () => page(); const status = await loaded.run();
  assert.equal(status.pages, 3); assert.equal(status.done, true);
  assert.equal(new URL(loaded.calls[0].url).searchParams.get('cursor'), 'next-cursor');
  loaded.authUID = 'account-b'; loaded.w.identity.authUID = 'account-b';
  assert.equal(loaded.status().pages, 0);
});

test('checkpoint quota failure is explicit and does not advance the cursor in memory', async t => {
  const f = harness(t); f.storageFailure = true; f.respond = () => page([], 'c1');
  const failed = await f.run(); assert.equal(failed.error, 'storage'); assert.equal(failed.warning, 'storage');
  assert.equal(failed.pages, 0); assert.equal(f.savedCheckpoint(), null);
  f.storageFailure = false; f.respond = () => page(); assert.equal((await f.run()).done, true);
  assert.equal(new URL(f.calls[1].url).searchParams.has('cursor'), false);
});

test('Favorite archive storage failure prevents checkpoint advancement', async t => {
  const f = harness(t); f.w.profileState.dirtyMemory.add('account-a');
  f.respond = url => url.pathname === '/api/posts/post-a' ? detail(post()) : page([post()]);
  const status = await f.run(); assert.equal(status.error, 'storage'); assert.equal(status.warning, 'storage');
  assert.equal(status.pages, 0); assert.equal(f.savedCheckpoint(), null);
});

test('another account storage warning cannot block empty or unliked pages after an account switch', async t => {
  const f = harness(t);
  f.w.profileState.storageError = true;
  f.w.profileState.dirtyMemory.add('account-a');
  f.authUID = 'account-b'; f.w.identity.authUID = 'account-b';
  f.respond = url => url.searchParams.get('scope') === 'following' ? page() : page([post('unliked', false)]);
  const status = await f.run();
  assert.equal(status.done, true); assert.equal(status.pages, 2); assert.equal(status.scanned, 1);
  assert.equal(status.error, ''); assert.equal(status.warning, '');
  assert.equal(f.favorites.size, 0); assert.equal(f.savedCheckpoint(), null);
  const checkpoint = JSON.parse(f.w.localStorage.getItem('favorites:history:uid:account-b'));
  assert.equal(checkpoint.pages, 2); assert.equal(checkpoint.sources.following.done, true);
  assert.equal(f.w.profileState.dirtyMemory.has('account-a'), true);
  assert.equal(f.w.profileState.dirtyMemory.has('account-b'), false);
});

test('one Run pauses after 100 sequential feed pages and Continue uses its last opaque cursor', async t => {
  const f = harness(t); let count = 0;
  f.respond = url => url.searchParams.get('scope') === 'following' ? page() : page([], ++count < 102 ? 'c' + count : null);
  const first = await f.run(); assert.equal(first.pages, 100); assert.equal(first.done, false);
  assert.equal(first.pausedReason, 'limit'); assert.equal(first.busy, false);
  assert.equal(f.savedCheckpoint().sources['for-you'].cursor, 'c100');
  const next = await f.run(); assert.equal(next.done, true); assert.equal(next.pages, 103);
  assert.equal(new URL(f.calls[100].url).searchParams.get('cursor'), 'c100');
  for (let i = 1; i < f.calls.length; i++) assert.ok(f.calls[i].at - f.calls[i - 1].at >= 800);
});

test('Restart resets feed checkpoints while keeping previously stored Favorites', async t => {
  const f = harness(t);
  f.respond = url => url.pathname === '/api/posts/post-a' ? detail(post()) :
    url.searchParams.get('scope') === 'following' ? page() : page([post()]);
  await f.run(); assert.equal(f.favorites.size, 1);
  const restarted = await f.w.qa.restart(); assert.equal(restarted.done, true);
  assert.equal(restarted.pages, 2); assert.equal(restarted.recovered, 0); assert.equal(f.favorites.size, 1);
});

test('corrupt persisted checkpoint remains protected until explicit Restart', async t => {
  const f = harness(t, { [checkpointKey]: '{invalid-json' });
  assert.equal(f.status().error, 'checkpoint'); assert.equal((await f.run()).error, 'checkpoint');
  assert.equal(f.calls.length, 0); assert.equal(f.w.localStorage.getItem(checkpointKey), '{invalid-json');
  const restarted = await f.w.qa.restart(); assert.equal(restarted.done, true); assert.equal(restarted.error, '');
});

test('local removal tombstone is honored by the profile writer during historical recovery', async t => {
  const f = harness(t); f.removed = new Set(['post-a']);
  f.respond = url => url.pathname === '/api/posts/post-a' ? detail(post()) :
    url.searchParams.get('scope') === 'following' ? page() : page([post()]);
  const status = await f.run(); assert.equal(status.recovered, 0); assert.equal(f.favorites.size, 0);
});
