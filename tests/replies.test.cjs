const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/replies.js'), 'utf8');
const start = Date.parse('2026-09-27T10:00:00Z');
const oldDate = '2026-09-26T10:00:00Z';
const newDate = '2026-09-27T10:01:00Z';
function post(id = 'parent', changes = {}) {
  return { id, authorUsername: 'viewer', replyCount: 1, createdAt: oldDate, ...changes };
}
function reply(id = 'reply', changes = {}) {
  return { id, parentId: 'parent', authorUsername: 'alice', authorName: 'Alice', text: 'Hello <script>', createdAt: oldDate, ...changes };
}
function harness(options = {}) {
  const dom = new JSDOM('<nav><button aria-label="Notifications">Notifications</button></nav><main><div hidden aria-hidden="true"><h2>Home</h2></div><div class="animate-fadeIn"><div class="sticky"><button>Back</button><div><h2>Notifications</h2></div></div><div id="native-notices">Native list</div></div></main>', {
    url: 'https://app.tweet.app/notifications', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  let now = start;
  let auth = { uid: 'uid-viewer', token: 'test-token' };
  let handle = 'viewer';
  let posts = [post()];
  let userReplies = [];
  const pages = new Map([['parent', { replies: [reply()], nextCursor: null }]]);
  let requestOverride = null;
  window.Date.now = () => now;
  window.ctNetworkState = { authUID: 'uid-viewer' };
  window.getAuth = async () => { window.ctNetworkState.authUID = auth?.uid || null; return auth; };
  window.requestJSON = async (url, headers) => {
    const endpoint = new URL(url);
    calls.push(endpoint.pathname + endpoint.search);
    assert.equal(endpoint.origin, 'https://api.tweet.app');
    assert.equal(headers.Authorization, 'Bearer test-token');
    if (requestOverride) {
      const result = await requestOverride(endpoint);
      if (result !== undefined) return result;
    }
    if (endpoint.pathname === '/api/user-profile/' + auth?.uid) return { success: true, profile: { username: handle } };
    if (endpoint.pathname === '/api/users/' + handle + '/posts') return { success: true, posts };
    if (endpoint.pathname === '/api/users/' + handle + '/replies') return { replies: userReplies };
    const id = endpoint.pathname.match(/^\/api\/posts\/([^/]+)\/replies$/)?.[1];
    if (id) return pages.get(id) || { replies: [] };
    throw new Error('Unexpected endpoint: ' + url);
  };
  window.eval(`const CT_LOCALE = '${options.locale || 'en'}'; const API_ORIGIN = 'https://api.tweet.app'; let ctPageActive = true; ${source}\nwindow.replies = { tick: replyWatchTick, render: renderReplyPanel, badge: patchReplyBadge, read: markReplyRead, notices: loadReplyNotices, state: ctReplyState, readStore: ctReplyRead, write: ctReplyWrite, parents: ctReplySelectParents, setActive: value => {ctPageActive=value;} };`);
  return {
    window, calls, api: window.replies, pages,
    setPosts: value => { posts = value; }, setReplies: value => { userReplies = value; },
    setAuth: (value, username = 'other') => { auth = value; handle = username; },
    advance: amount => { now += amount; },
    override: fn => { requestOverride = fn; },
    close: () => window.close()
  };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('first check uses the verified uid profile GET and shows past replies as read history', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick();
  assert.deepEqual(h.calls, ['/api/user-profile/uid-viewer', '/api/users/viewer/posts?limit=24', '/api/users/viewer/replies', '/api/posts/parent/replies?limit=50']);
  assert.equal(h.api.notices().length, 1);
  assert.equal(h.api.notices()[0].read, true);
  assert.equal(h.window.document.querySelector('[data-ct-reply-id] a').getAttribute('href'), '/user/alice');
  assert.equal(h.window.document.querySelector('[data-ct-reply-id] a + a').getAttribute('href'), '/post/reply');
  assert.equal(h.window.document.querySelector('[data-ct-reply-id] script'), null);
});

test('later reply count changes produce unread history and a native-navigation badge', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick(); h.advance(90000);
  h.setPosts([post('parent', { replyCount: 2 })]);
  h.pages.set('parent', { replies: [reply(), reply('new-reply', { createdAt: newDate })] });
  await h.api.tick();
  assert.equal(h.api.notices().find(item => item.id === 'new-reply').read, false);
  assert.equal(h.window.document.querySelector('[data-ct-reply-count]').textContent, '↩1');
  assert.match(h.window.document.querySelector('summary').textContent, /\(1\)/);
  h.api.read('new-reply');
  assert.equal(h.api.notices().find(item => item.id === 'new-reply').read, true);
  assert.equal(h.window.document.querySelector('[data-ct-reply-count]'), null);
});

test('own reply wrappers are unwrapped and monitored while reposts/foreign posts are rejected', async t => {
  const h = harness(); t.after(h.close);
  h.setPosts([post('foreign', { authorUsername: 'other' }), post('repost', { originalPostId: 'origin' })]);
  h.setReplies([{ post: post('my-reply'), parentPost: post('foreign-parent', { authorUsername: 'other' }) }]);
  h.pages.set('my-reply', { replies: [reply('answer', { parentId: 'my-reply' })] });
  await h.api.tick();
  assert.ok(h.calls.includes('/api/posts/my-reply/replies?limit=50'));
  assert.equal(h.calls.some(url => /foreign|repost/.test(url)), false);
  assert.equal(h.api.notices()[0].id, 'answer');
});

test('notification ids, parent objects, own replies and mismatched reply parents never become reply links', async t => {
  const h = harness(); t.after(h.close);
  h.pages.set('parent', { replies: [
    { type: 'REPLY', id: 'notification-id', actorUsername: 'alice' },
    reply('self', { authorUsername: 'VIEWER' }), reply('other-thread', { parentId: 'elsewhere' }),
    reply('deleted', { isDeleted: true }), reply('bad id'), reply('good')
  ] });
  await h.api.tick();
  assert.deepEqual(plain(h.api.notices().map(item => item.id)), ['good']);
  assert.equal(h.calls.some(url => url.includes('notifications')), false);
});

test('legacy unscoped storage is not imported and account switches cannot expose the prior account inbox', async t => {
  const h = harness(); t.after(h.close);
  h.window.localStorage.setItem('classicTwitterEN.replyNotifications', JSON.stringify([reply('legacy')]));
  await h.api.tick();
  assert.equal(h.api.notices().some(item => item.id === 'legacy'), false);
  h.advance(90000); h.setAuth({ uid: 'uid-other', token: 'test-token' }); h.setPosts([]);
  await h.api.tick();
  assert.equal(h.api.state.uid, 'uid-other');
  assert.equal(h.api.notices().length, 0);
  assert.ok(h.window.localStorage.getItem('ct-replies-v2:uid-viewer'));
  assert.ok(h.window.localStorage.getItem('ct-replies-v2:uid-other'));
});

test('an account change during a request discards the pending old-account result', async t => {
  const h = harness(); t.after(h.close);
  h.override(async endpoint => {
    if (endpoint.pathname === '/api/posts/parent/replies') {
      h.setAuth({ uid: 'uid-other', token: 'test-token' });
      return { replies: [reply()] };
    }
  });
  await h.api.tick();
  assert.equal(h.api.state.uid, null);
  assert.equal(h.api.notices().length, 0);
  assert.equal(h.window.localStorage.getItem('ct-replies-v2:uid-viewer'), null);
});

test('failed reply requests are retried rather than committing a successful count baseline', async t => {
  const h = harness(); t.after(h.close);
  h.pages.set('parent', null);
  h.override(endpoint => endpoint.pathname === '/api/posts/parent/replies' ? null : undefined);
  await h.api.tick();
  assert.equal(h.api.state.data.threads.parent, undefined);
  assert.match(h.api.state.error, /could not/);
  h.override(() => undefined); h.pages.set('parent', { replies: [reply()] }); h.advance(90000);
  await h.api.tick();
  assert.equal(h.api.state.data.threads.parent.count, 1);
  assert.equal(h.api.notices().length, 1);
});

test('unchanged counts skip reply API until a ten-minute rescan; manual check refreshes it', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick(); h.advance(90000); h.calls.length = 0;
  await h.api.tick();
  assert.equal(h.calls.some(url => url.startsWith('/api/posts/')), false);
  h.advance(10000); h.calls.length = 0;
  await h.api.tick(true);
  assert.ok(h.calls.includes('/api/posts/parent/replies?limit=50'));
  h.advance(600001); h.calls.length = 0;
  await h.api.tick();
  assert.ok(h.calls.includes('/api/posts/parent/replies?limit=50'));
});

test('polling is suspended while hidden or page-inactive, prevents overlap, and rate-limits manual checks', async t => {
  const h = harness(); t.after(h.close);
  Object.defineProperty(h.window.document, 'hidden', { configurable: true, value: true });
  await h.api.tick(); assert.equal(h.calls.length, 0);
  Object.defineProperty(h.window.document, 'hidden', { configurable: true, value: false });
  h.api.setActive(false); await h.api.tick(); assert.equal(h.calls.length, 0);
  h.api.setActive(true); await Promise.all([h.api.tick(), h.api.tick(), h.api.tick(true)]);
  assert.equal(h.calls.length, 4);
  await h.api.tick(true); assert.equal(h.calls.length, 4);
});

test('per-tick work is bounded and paginated replies continue on the next check', async t => {
  const h = harness(); t.after(h.close);
  h.setPosts(Array.from({ length: 30 }, (_, i) => post('p' + i, { replyCount: 1000 })));
  h.override(endpoint => {
    if (endpoint.pathname.startsWith('/api/posts/')) {
      const n = Number(endpoint.searchParams.get('cursor') || 0);
      return { replies: [], nextCursor: String(n + 1) };
    }
  });
  await h.api.tick();
  assert.equal(h.calls.length, 21); // profile + two lists + six threads times three pages
  assert.equal(Object.keys(h.api.state.data.threads).length, 6);
  assert.equal(h.api.state.data.threads.p0.cursor, '3');
  h.setPosts([post('p0', { replyCount: 1000 })]); h.advance(90000); h.calls.length = 0;
  await h.api.tick();
  assert.ok(h.calls.includes('/api/posts/p0/replies?limit=50&cursor=3'));
});

test('read acknowledgement from a second tab is preserved when a pending poll writes', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick(); h.advance(90000);
  h.setPosts([post('parent', { replyCount: 2 })]);
  h.pages.set('parent', { replies: [reply('fresh', { createdAt: newDate })] });
  await h.api.tick();
  const stale = plain(h.api.state.data);
  const current = plain(h.api.state.data); current.notices.forEach(item => { item.read = true; });
  h.window.localStorage.setItem('ct-replies-v2:uid-viewer', JSON.stringify(current));
  const merged = h.api.write('uid-viewer', stale);
  assert.equal(merged.notices.find(item => item.id === 'fresh').read, true);
});

test('the compact inline panel appears after the visible sticky header and stays available when empty', t => {
  const h = harness(); t.after(h.close);
  h.api.render();
  const doc = h.window.document;
  const panel = doc.getElementById('ct-reply-panel');
  assert.equal(panel.previousElementSibling.className, 'sticky');
  assert.equal(panel.nextElementSibling.id, 'native-notices');
  assert.equal(panel.closest('[hidden]'), null);
  assert.equal(panel.style.position, 'relative');
  assert.match(panel.textContent, /No replies/);
  const details = panel.querySelector('details'); details.open = true;
  h.api.state.error = 'test'; h.api.render();
  assert.equal(panel.querySelector('details').open, true);
});

test('closing the panel never acknowledges replies; author and reply navigation remain independent', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick(); h.advance(90000);
  h.setPosts([post('parent', { replyCount: 2 })]); h.pages.set('parent', { replies: [reply('fresh', { createdAt: newDate })] });
  await h.api.tick();
  const panel = h.window.document.getElementById('ct-reply-panel');
  panel.querySelector('details').open = true; panel.querySelector('details').open = false;
  assert.equal(h.api.notices().find(item => item.id === 'fresh').read, false);
  const actor = panel.querySelector('[data-ct-reply-id="fresh"] a');
  actor.addEventListener('click', event => event.preventDefault()); actor.click();
  assert.equal(h.api.notices().find(item => item.id === 'fresh').read, false);
  const body = actor.nextElementSibling.nextElementSibling;
  assert.equal(body.getAttribute('href'), '/post/fresh');
  body.addEventListener('click', event => event.preventDefault()); body.click();
  assert.equal(h.api.notices().find(item => item.id === 'fresh').read, true);
});

test('Japanese UI is localized without changing reply bodies or authors', async t => {
  const h = harness({ locale: 'ja' }); t.after(h.close);
  await h.api.tick();
  const panel = h.window.document.getElementById('ct-reply-panel');
  assert.match(panel.textContent, /リプライ通知/);
  assert.match(panel.textContent, /Alice @alice/);
  assert.match(panel.textContent, /Hello <script>/);
});

test('storage failure retains this page inbox and clearly reports that persistence failed', async t => {
  const h = harness(); t.after(h.close);
  h.window.Storage.prototype.setItem = () => { throw new Error('quota'); };
  await h.api.tick();
  assert.equal(h.api.notices().length, 1);
  assert.equal(h.api.state.storageError, true);
  assert.match(h.window.document.querySelector('#ct-reply-panel [role="status"]').textContent, /Storage is unavailable/);
});

test('sign-out clears in-memory inbox and account data is not loaded before authenticated identity', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick(); h.advance(90000); h.setAuth(null);
  await h.api.tick();
  assert.equal(h.api.notices().length, 0);
  assert.equal(h.api.state.uid, null);
  assert.match(h.window.document.getElementById('ct-reply-panel').textContent, /Sign in/);
});

test('the latest-24 window is selected before excluding threads with zero replies', async t => {
  const h = harness(); t.after(h.close);
  const recent = Array.from({ length: 24 }, (_, i) => post('recent-' + i, {
    replyCount: 0, createdAt: new Date(start - i * 1000).toISOString()
  }));
  h.setPosts(recent);
  h.setReplies([{ post: post('older-reply', { createdAt: oldDate }) }]);
  await h.api.tick();
  assert.equal(h.calls.some(url => url.startsWith('/api/posts/')), false);
  h.advance(90000);
  h.setPosts(recent.map(item => item.id === 'recent-0' ? { ...item, replyCount: 1 } : item));
  h.pages.set('recent-0', { replies: [reply('new-answer', { parentId: 'recent-0', createdAt: newDate })] });
  await h.api.tick();
  assert.ok(h.calls.includes('/api/posts/recent-0/replies?limit=50'));
  assert.equal(h.calls.some(url => url.includes('/posts/older-reply/')), false);
  assert.equal(h.api.notices()[0].id, 'new-answer');
});

test('reply activation saves read state while keeping its real anchor intact through default-action dispatch', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick(); h.advance(90000);
  h.setPosts([post('parent', { replyCount: 2 })]);
  h.pages.set('parent', { replies: [reply('fresh', { createdAt: newDate })] });
  await h.api.tick();
  const row = h.window.document.querySelector('[data-ct-reply-id="fresh"]');
  const link = row.querySelector('a[href="/post/fresh"]');
  let observed = null;
  h.window.document.addEventListener('click', event => {
    if (event.target !== link) return;
    observed = {
      connected: link.isConnected, sameRow: row.contains(link),
      href: link.href, prevented: event.defaultPrevented, ctrl: event.ctrlKey
    };
    // Suppress jsdom's unsupported document navigation only after checking native eligibility.
    event.preventDefault();
  });
  link.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  assert.deepEqual(observed, {
    connected: true, sameRow: true, href: 'https://app.tweet.app/post/fresh', prevented: false, ctrl: true
  });
  assert.equal(h.api.notices().find(item => item.id === 'fresh').read, true);
  assert.equal(link.isConnected, true);
  await new Promise(resolve => h.window.setTimeout(resolve, 5));
  assert.equal(h.window.document.querySelector('[data-ct-reply-id="fresh"] span'), null);
});

test('the retained 100 replies are the newest by date rather than the last parent traversed', async t => {
  const h = harness(); t.after(h.close);
  h.setPosts([post('new-thread', { createdAt: newDate, replyCount: 50 }), post('old-thread', { replyCount: 50 }), post('oldest-thread', { replyCount: 50 })]);
  for (const [prefix, days] of [['new', 0], ['old', 1], ['oldest', 2]]) {
    h.pages.set(prefix + '-thread', { replies: Array.from({ length: 50 }, (_, i) => reply(prefix + '-' + i, {
      parentId: prefix + '-thread', createdAt: new Date(start - days * 86400000 - i * 1000).toISOString()
    })) });
  }
  await h.api.tick();
  assert.equal(h.api.notices().length, 100);
  assert.equal(h.api.notices().filter(item => item.id.startsWith('new-')).length, 50);
  assert.equal(h.api.notices().some(item => item.id.startsWith('oldest-')), false);
  assert.equal(h.api.notices()[0].id, 'new-0');
});

test('verified authorAvatar artwork shares the author profile link and failed images leave its name usable', async t => {
  const h = harness(); t.after(h.close);
  h.pages.set('parent', { replies: [reply('portrait', { authorAvatar: 'https://cdn.example.test/alice.png' })] });
  await h.api.tick();
  const actor = h.window.document.querySelector('[data-ct-reply-id="portrait"] a');
  const avatar = actor.querySelector('img');
  assert.equal(avatar.src, 'https://cdn.example.test/alice.png');
  assert.equal(avatar.closest('a').getAttribute('href'), '/user/alice');
  assert.equal(avatar.referrerPolicy, 'no-referrer');
  assert.equal(avatar.alt, '');
  assert.equal(h.api.notices()[0].authorAvatar, 'https://cdn.example.test/alice.png');
  avatar.dispatchEvent(new h.window.Event('error'));
  assert.equal(actor.querySelector('img'), null);
  assert.equal(actor.textContent, 'Alice @alice');
  assert.equal(actor.getAttribute('href'), '/user/alice');
});

test('reply avatars reject executable, insecure and credential-bearing URLs even from persisted records', async t => {
  const h = harness(); t.after(h.close);
  h.pages.set('parent', { replies: [
    reply('js-avatar', { authorAvatar: 'javascript:alert(1)' }),
    reply('insecure-avatar', { authorAvatar: 'http://cdn.example.test/alice.png' }),
    reply('credentials-avatar', { authorAvatar: 'https://user:secret@cdn.example.test/alice.png' })
  ] });
  await h.api.tick();
  assert.equal(h.window.document.querySelectorAll('#ct-reply-panel img').length, 0);
  assert.ok(h.api.notices().every(item => item.authorAvatar === ''));
  h.api.state.data.notices[0].authorAvatar = 'data:image/svg+xml,<svg/>';
  h.api.render();
  assert.equal(h.window.document.querySelectorAll('#ct-reply-panel img').length, 0);
});

test('same-clock account switches and sign-out bypass the preceding account polling throttle', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick();
  assert.equal(h.api.notices().length, 1);
  h.setAuth({ uid: 'uid-other', token: 'test-token' }); h.setPosts([]);
  await h.api.tick(); // No time advance: identity revalidation precedes the 90s throttle.
  assert.ok(h.calls.includes('/api/user-profile/uid-other'));
  assert.equal(h.api.state.uid, 'uid-other');
  assert.equal(h.api.notices().length, 0);
  assert.equal(h.window.document.querySelector('[data-ct-reply-id]'), null);
  h.setAuth(null);
  await h.api.tick();
  assert.equal(h.api.state.uid, null);
  assert.match(h.window.document.getElementById('ct-reply-panel').textContent, /Sign in/);
});

test('known network identity changes immediately hide the old inbox before another reply poll', async t => {
  const h = harness(); t.after(h.close);
  await h.api.tick();
  const state = h.api.state;
  state.data.notices[0].read = false;
  h.api.render(); h.api.badge();
  assert.ok(h.window.document.querySelector('[data-ct-reply-count]'));
  h.window.ctNetworkState.authUID = 'uid-other';
  h.api.render(); h.api.badge();
  assert.equal(h.api.notices().length, 0);
  assert.equal(state.uid, null);
  assert.equal(h.window.document.querySelector('[data-ct-reply-id]'), null);
  assert.equal(h.window.document.querySelector('[data-ct-reply-count]'), null);
  const before = h.window.localStorage.getItem('ct-replies-v2:uid-viewer');
  h.api.read('reply');
  assert.equal(h.window.localStorage.getItem('ct-replies-v2:uid-viewer'), before);
});
