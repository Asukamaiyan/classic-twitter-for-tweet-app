const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const distributions = require('../scripts/distributions.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForQuietScans(readScans) {
  const deadline = Date.now() + 3000;
  let quietWindows = 0;
  while (Date.now() < deadline) {
    const before = readScans();
    await wait(200);
    quietWindows = readScans() === before ? quietWindows + 1 : 0;
    if (quietWindows === 2) return;
  }
  assert.fail('own badge updates must reach two consecutive quiet 200 ms windows within 3 seconds');
}
const account = `<div role="dialog" aria-modal="true" aria-label="Account menu"><div class="px-4 pt-5 pb-4">
  <button class="block text-left cursor-pointer"><img src="/avatar.png" alt="Home avatar">
  <p class="mt-3 text-base font-extrabold truncate">Home</p><p class="text-sm truncate">@alice</p></button>
  <div><span><strong>4</strong> Following</span><span><strong>5</strong> Followers</span></div></div></div>`;

// Native v2.1.0 Pie rows use Ho avatars without individual onAvatarClick
// handlers. Reply events use the same grouped border row as likes.
const notification = `<div class="border-b border-tl-app-border"><button type="button" data-native-notification
  class="w-full flex items-start gap-3 px-4 py-3.5 text-left">
  <div class="mt-0.5 shrink-0"><svg width="28" height="28" class="lucide lucide-message-circle"></svg></div>
  <div class="flex-1 min-w-0"><div class="flex items-center gap-1 flex-wrap mb-1.5">
    <span class="inline-flex"><div class="relative inline-flex shrink-0 isolate"><img class="rounded-full object-cover" alt="Settings avatar" src="https://media.test/bob.png"></div></span>
    <span class="inline-flex"><div class="relative inline-flex shrink-0 isolate"><img class="rounded-full object-cover" alt="Explore avatar" src="https://media.test/carol.png"></div></span>
  </div><p class="text-tl-app-text leading-snug"><span class="font-extrabold">Settings</span> and <span class="font-extrabold">Explore</span>
  <span class="text-tl-app-text-muted" data-native-action>replied to your post</span></p>
  <p data-native-preview class="mt-1 text-tl-app-text-muted leading-snug line-clamp-2">Home Following reply</p></div></button></div>`;

for (const { file, locale } of distributions) {
  test(`${file}: native reply notifications keep their badge and handlers without a duplicate inbox or polling`, async t => {
    const english = locale === 'en';
    const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <nav><button aria-label="Notifications"><svg></svg><span>Notifications</span><span data-native-count>3</span></button></nav>
      <main><header class="sticky"><h2 class="truncate">Notifications</h2></header>
      <div data-native-tabs class="flex items-stretch sticky top-app-header border-b border-tl-app-border">
        <button type="button" class="flex-1"><span>All</span></button><button type="button" class="flex-1"><span>Mentions</span></button>
      </div>${notification}
      <article data-native-reply><div class="flex items-start gap-3"><button aria-label="View @alice's profile"><img alt="alice avatar"></button>
        <div class="min-w-0 flex-1"><div class="flex items-center gap-1"><button class="font-bold truncate">alice</button><span>·</span><span>3m</span></div>
        <p class="break-words whitespace-pre-wrap">Home Following Settings</p><p aria-live="polite"><button>Show translation</button></p>
        <button data-testid="tweet-like-action" aria-label="Like, 3 likes" class="text-tl-app-text-muted"><svg class="lucide-heart"></svg></button>
        <div data-native-poll><button data-poll-option>Home</button><button data-poll-option>Settings</button><span data-native-poll-count>7 votes</span></div>
      </div></div></article><textarea>Home Following draft</textarea></main>${account}</body></html>`, {
      url: 'https://app.tweet.app/notifications', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    const { document } = window;
    t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
    const errors = [];
    const requests = [];
    const extraIntervals = [];
    window.addEventListener('error', event => errors.push(event.message));
    window.console.debug = (...args) => errors.push(args);
    window.console.log = () => {};
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const nativeInterval = window.setInterval(() => {}, 30000);
    const setInterval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      extraIntervals.push(delay); return setInterval(callback, delay, ...args);
    };
    t.after(() => window.clearInterval(nativeInterval));
    let nativeOpens = 0;
    const nativeRow = document.querySelector('[data-native-notification]');
    nativeRow.addEventListener('click', () => {
      nativeOpens++;
      document.querySelector('[data-native-count]').textContent = '2';
    });
    let nativeVotes = 0;
    document.querySelector('[data-poll-option]').addEventListener('click', () => nativeVotes++);
    // Synthetic credentials never leave this isolated DOM.
    window.localStorage.setItem('firebase:authUser:fixture:[DEFAULT]', JSON.stringify({
      uid: 'qa-user', apiKey: 'fixture', stsTokenManager: { accessToken: 'A'.repeat(60), expirationTime: Date.now() + 60000 }
    }));
    const oldHistory = JSON.stringify({ startedAt: 1234, checkedAt: 5678, notices: [{ id: 'retired', authorUsername: 'bob', text: 'Retained history' }], seen: ['retired'], threads: {} });
    const legacyKey = english ? 'classicTwitterEN.replyNotifications' : 'classicTwitterJP.replyNotifications';
    window.localStorage.setItem('ct-replies-v2:qa-user', oldHistory);
    window.localStorage.setItem(legacyKey, oldHistory);
    window.GM_xmlhttpRequest = options => {
      const url = new URL(options.url);
      requests.push({ method: options.method, path: url.pathname, search: url.search });
      let body;
      if (url.pathname === '/api/users/by-username/alice') {
        body = { user: { id: 'qa-user', username: 'alice', displayName: 'Home', foundingMemberNumber: 71, badges: ['centurion', 'wing'] } };
      } else if (url.pathname === '/api/notifications') {
        body = { success: true, notifications: [
          { id: 'reply-bob', type: 'reply', actorHandle: 'bob', actorDisplayName: 'Settings', actorAvatarUrl: 'https://media.test/bob.png' },
          { id: 'reply-carol', type: 'reply', actorHandle: 'carol', actorDisplayName: 'Explore', actorAvatarUrl: 'https://media.test/carol.png' }
        ], nextCursor: null };
      }
      queueMicrotask(() => options.onload({ status: body ? 200 : 404, responseText: JSON.stringify(body || { error: 'unexpected fixture route' }) }));
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
    assert.equal(name.textContent, 'Home', 'dictionary-like display names are preserved');
    assert.equal(name.dataset.ctAuthorUser, 'alice');
    assert.equal(reply.querySelector('.ct-official-badges')?.getAttribute('aria-label'), file.includes('-ja') ? 'センチュリオン + ウィング' : 'Centurion + Wing');
    assert.equal(reply.querySelectorAll('.ct-official-badges img').length, 4);
    assert.equal(reply.querySelector('.ct-founder').textContent, '#00071');
    assert.equal(reply.querySelector('.break-words').textContent, 'Home Following Settings');
    assert.equal(document.querySelector('textarea').value, 'Home Following draft');
    assert.equal(reply.querySelector('button[aria-label]').getAttribute('aria-label'), "View @alice's profile");
    const drawer = document.querySelector('[role="dialog"][aria-label="Account menu"]');
    assert.equal(drawer.querySelector('p.font-extrabold').textContent, 'Home');
    assert.equal(drawer.querySelectorAll('.ct-official-badges').length, 1);
    assert.equal(drawer.querySelector('p.text-sm').textContent, '@alice');
    assert.match(drawer.textContent, english ? /Following/ : /フォロー中/);
    assert.equal(document.querySelector('nav button').getAttribute('aria-label'), english ? 'Notifications' : '通知');
    assert.equal(document.querySelector('[data-native-count]').textContent, '3');
    assert.equal(document.querySelector('#ct-reply-panel,#ct-reply-tab,#ct-reply-badge,[data-ct-reply-count]'), null);
    assert.equal(document.querySelector('#ct-reply-ui-style'), null);
    assert.equal(nativeRow.hidden, false);
    assert.notEqual(nativeRow.style.display, 'none');
    assert.equal(document.querySelector('[data-native-preview]').textContent, 'Home Following reply');
    assert.match(document.querySelector('[data-native-action]').textContent, english ? /replied to your Tweet/ : /あなたのツイートに返信しました/);
    const links = [...nativeRow.querySelectorAll('a.ct-notification-profile-link')];
    assert.deepEqual(links.map(link => link.getAttribute('href')), ['/user/bob', '/user/carol']);
    window.addEventListener('click', event => event.preventDefault(), { capture: true, once: true });
    links[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(nativeOpens, 0, 'individual profile clicks do not invoke the representative notification');
    nativeRow.click();
    assert.equal(nativeOpens, 1, 'the native notification handler remains intact');
    assert.equal(document.querySelector('[data-native-count]').textContent, '2', 'native read updates remain authoritative');
    assert.deepEqual([...document.querySelectorAll('[data-poll-option]')].map(button => button.textContent), ['Home', 'Settings']);
    assert.equal(document.querySelector('[data-native-poll-count]').textContent, '7 votes');
    document.querySelector('[data-poll-option]').click();
    assert.equal(nativeVotes, 1, 'native poll interaction remains connected');
    await waitForQuietScans(() => scans);
    window.dispatchEvent(new window.Event('visibilitychange'));
    window.dispatchEvent(new window.Event('pagehide'));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    await waitForQuietScans(() => scans);
    assert.deepEqual(extraIntervals, [], 'startup, visibility and BFCache add no notification polling');
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.every(request => ['/api/users/by-username/alice', '/api/notifications'].includes(request.path)), 'only preserved display-name/badge and actor resolution lookups are permitted; no reply scanning or mark-read request');
    assert.equal(requests.filter(request => request.path === '/api/users/by-username/alice').length, 1);
    assert.equal(requests.filter(request => request.path === '/api/notifications').length, 1);
    assert.equal(window.localStorage.getItem('ct-replies-v2:qa-user'), oldHistory, 'retired local history is retained byte for byte');
    assert.equal(window.localStorage.getItem(legacyKey), oldHistory, 'older locale history is also retained');
    assert.equal(document.querySelector('[data-native-count]').textContent, '2');
    drawer.remove();
    document.body.insertAdjacentHTML('beforeend', account);
    await wait(250);
    assert.equal(document.querySelectorAll('[aria-label="Account menu"] .ct-official-badges').length, 1, 'a newly opened mobile drawer is enhanced by the normal mutation scan');
    assert.deepEqual(errors, []);
  });
}
