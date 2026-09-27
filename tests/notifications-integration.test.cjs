const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForQuietScans(readScans) {
  const deadline = Date.now() + 3000;
  let quietWindows = 0;
  while (Date.now() < deadline) {
    const before = readScans();
    await wait(200);
    quietWindows = readScans() === before ? quietWindows + 1 : 0;
    // Startup profile/reply responses can queue one final 100 ms observer pass.
    // Require two quiet windows after it, and fail a self-triggering scan loop.
    if (quietWindows === 2) return;
  }
  assert.fail('own badge/counter updates must reach two consecutive quiet 200 ms windows within 3 seconds');
}
const account = `<div role="dialog" aria-modal="true" aria-label="Account menu"><div class="px-4 pt-5 pb-4">
  <button class="block text-left cursor-pointer"><img src="/avatar.png" alt="Home avatar">
  <p class="mt-3 text-base font-extrabold truncate">Home</p><p class="text-sm truncate">@alice</p></button>
  <div><span><strong>4</strong> Following</span><span><strong>5</strong> Followers</span></div></div></div>`;

for (const file of ['classic-twitter-ja.user.js', 'classic-twitter-ja-safari.user.js', 'classic-twitter-en.user.js']) {
  test(`${file}: localization, display names, reply notifications and supplemental badges coexist`, async t => {
    const english = file.includes('-en.');
    const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <nav><button aria-label="Notifications"><svg></svg><span>Notifications</span><span data-native-count>3</span></button></nav>
      <main><header class="sticky"><h2 class="truncate">Notifications</h2></header>
      <article data-native-reply><div class="flex items-start gap-3"><button aria-label="View @alice's profile"><img alt="alice avatar"></button>
        <div class="min-w-0 flex-1"><div class="flex items-center gap-1"><button class="font-bold truncate">alice</button><span>·</span><span>3m</span></div>
        <p class="break-words whitespace-pre-wrap">Home Following Settings</p><p aria-live="polite"><button>Show translation</button></p>
        <button aria-label="Like, 3 likes">Like</button></div></div></article>
      <textarea>Home Following draft</textarea></main>${account}</body></html>`, {
      url: 'https://app.tweet.app/notifications', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    const { document } = window;
    t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
    const errors = [];
    const requests = [];
    window.addEventListener('error', event => errors.push(event.message));
    window.console.debug = (...args) => errors.push(args);
    window.console.log = () => {};
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    // Synthetic credentials are confined to this isolated DOM; no real network is used.
    window.localStorage.setItem('firebase:authUser:fixture:[DEFAULT]', JSON.stringify({
      uid: 'qa-user', apiKey: 'fixture', stsTokenManager: { accessToken: 'A'.repeat(60), expirationTime: Date.now() + 60000 }
    }));
    window.localStorage.setItem('ct-replies-v2:qa-user', JSON.stringify({
      startedAt: Date.now() - 60000, checkedAt: 0, notices: [], seen: [], threads: {}
    }));
    const now = new Date().toISOString();
    window.GM_xmlhttpRequest = options => {
      const url = new URL(options.url);
      requests.push({ method: options.method, path: url.pathname, search: url.search });
      let body;
      if (url.pathname === '/api/users/by-username/alice') {
        body = { user: { id: 'qa-user', username: 'alice', displayName: 'Home', foundingMemberNumber: 71, badges: ['centurion', 'wing'] } };
      } else if (url.pathname === '/api/user-profile/qa-user') {
        body = { profile: { username: 'alice' } };
      } else if (url.pathname === '/api/users/alice/posts') {
        body = { posts: [{ id: 'own-post', authorUsername: 'alice', replyCount: 1, createdAt: now }] };
      } else if (url.pathname === '/api/users/alice/replies') {
        body = { replies: [] };
      } else if (url.pathname === '/api/posts/own-post/replies') {
        body = { replies: [{ id: 'new-reply', parentId: 'own-post', authorUsername: 'bob', authorName: 'Settings', text: 'Home Following reply', createdAt: now }], nextCursor: null };
      }
      queueMicrotask(() => options.onload({ status: body ? 200 : 404, responseText: JSON.stringify(body || { error: 'unknown fixture route' }) }));
      return { abort() {} };
    };
    let scans = 0;
    const walker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (...args) => { scans++; return walker(...args); };
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
    await wait(400);
    assert.deepEqual(errors, []);
    const reply = document.querySelector('[data-native-reply]');
    const name = reply.querySelector('button.font-bold');
    assert.equal(name.textContent, 'Home', 'display names that match dictionary labels must be preserved');
    assert.equal(name.dataset.ctAuthorUser, 'alice');
    assert.equal(reply.querySelector('.ct-official-badges')?.getAttribute('aria-label'), 'Centurion + Wing');
    assert.equal(reply.querySelectorAll('.ct-official-badges img').length, 4);
    assert.equal(reply.querySelector('.ct-founder').textContent, '#00071');
    assert.equal(reply.querySelector('.break-words').textContent, 'Home Following Settings');
    assert.equal(document.querySelector('textarea').value, 'Home Following draft');
    assert.equal(reply.querySelector('button[aria-label]').getAttribute('aria-label'), "View @alice's profile");
    const drawer = document.querySelector('[role="dialog"][aria-label="Account menu"]');
    assert.ok(drawer, 'localization must preserve the dialog identity used by the badge patch');
    assert.equal(drawer.querySelector('p.font-extrabold').textContent, 'Home');
    assert.equal(drawer.querySelectorAll('.ct-official-badges').length, 1);
    assert.equal(drawer.querySelector('p.text-sm').textContent, '@alice');
    assert.match(drawer.textContent, english ? /Following/ : /フォロー中/);
    const counter = document.querySelector('nav [data-ct-reply-count]');
    assert.equal(counter?.textContent, '↩1');
    assert.equal(counter.getAttribute('aria-label'), english ? '1 unread replies' : '未読の返信 1 件');
    assert.equal(document.querySelector('nav button').getAttribute('aria-label'), english ? 'Notifications' : '通知');
    assert.equal(document.querySelector('[data-native-count]').textContent, '3', 'the existing native counter must remain separate');
    const notice = document.querySelector('[data-ct-reply-id="new-reply"]');
    assert.equal(notice.querySelector('a').textContent, 'Settings @bob');
    assert.equal(notice.querySelector('a[href="/post/new-reply"]').textContent, 'Home Following reply');
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.equal(requests.filter(request => request.path === '/api/users/by-username/alice').length, 1, 'the display name and badge lookup share one profile request');
    await waitForQuietScans(() => scans);
    document.querySelector('[data-reply-action="read"]').click();
    assert.equal(document.querySelector('nav [data-ct-reply-count]'), null);
    assert.equal(document.querySelector('[data-native-count]').textContent, '3');
    drawer.remove();
    document.body.insertAdjacentHTML('beforeend', account);
    await wait(250);
    assert.equal(document.querySelectorAll('[aria-label="Account menu"] .ct-official-badges').length, 1, 'a newly opened mobile drawer is enhanced by the normal mutation scan');
    assert.deepEqual(errors, []);
  });
}
