const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/classic.js'), 'utf8');
const actions = `<div data-testid="tweet-action-bar"><div class="group flex items-center gap-0.5 text-tl-app-text-muted"><button data-testid="tweet-like-action" aria-label="Like, 4 likes"><svg></svg></button><span class="text-xs tabular-nums text-tl-app-text-muted">4</span></div>
  <button data-testid="tweet-open-comment-action">Reply</button><div><button data-testid="tweet-repost-action">Repost</button></div></div>`;
const post = (id, reply = false) => `<article id="${id}" class="border-b border-tl-app-border px-4 py-3 transition-colors">
  <div class="flex items-start gap-3">${reply
    ? `<button class="shrink-0 rounded-full" aria-label="View @alice's profile"><div class="relative inline-flex shrink-0 isolate"><img class="rounded-full object-cover" width="40" height="40" alt="Alice avatar" src="/avatar.png"></div></button>`
    : `<div class="relative inline-flex shrink-0 isolate"><button class="rounded-full" aria-label="View @alice's profile"><img class="rounded-full object-cover" width="48" height="48" alt="Alice avatar" src="/avatar.png"></button></div>`}
  <div class="flex-1 min-w-0"><button class="font-bold truncate">Like News Favorite Alice</button>
  <p class="whitespace-pre-wrap break-words">Favorite <a href="/user/bob">@bob</a> and English text.</p>
  <img class="rounded-xl" alt="Post attachment" src="/photo.jpg">${actions}</div></div></article>`;
const client = () => `<div id="root-container" data-app-theme="light" class="min-h-screen font-sans bg-tl-app-bg text-tl-app-text">
  <header class="lg:hidden sticky"><button aria-expanded="false">Profile menu</button></header>
  <div class="max-w-7xl mx-auto"><div class="grid grid-cols-1 lg:grid-cols-12 lg:gap-8 items-start">
    <aside class="hidden lg:flex lg:col-span-3"><nav class="flex flex-col gap-1">
      <button class="rounded-2xl text-sky-500"><svg></svg><span>Home</span></button><button class="rounded-2xl"><svg></svg>Explore</button>
      <button id="public-sidebar-compose-btn" class="rounded-full">Tweet</button></nav></aside>
    <main class="min-w-0 lg:col-span-6 flex flex-col lg:border-x border-tl-app-border bg-tl-app-card">
      <div class="sticky top-app-header border-b border-dashed px-4"><div class="flex gap-1.5 overflow-x-auto min-h-10">
        <button class="rounded-full text-xs bg-sky-500">For you</button><button class="rounded-full text-xs">Following</button></div></div>
      <div class="px-4 pt-5 pb-4 border-b"><div class="flex gap-3"><div class="flex-1"><textarea id="public-tweet-input" placeholder="What's happening?">English Like News draft</textarea>
      <input type="file" accept="image/jpeg,image/png,image/webp"><button id="public-tweet-submit-btn" disabled>Tweet</button></div></div></div>
      ${post('tweet')}${post('reply', true)}
    </main>
    <aside class="hidden lg:flex lg:col-span-3"><div class="border bg-tl-app-card rounded-2xl"><h3>Who to follow</h3><button>Follow</button></div></aside>
  </div></div>
  <nav aria-label="Mobile navigation" class="lg:hidden fixed bottom-0 border-t"><div class="flex justify-around">
    <button class="rounded-2xl" aria-label="Home" aria-current="page"><svg></svg></button>
    <button id="public-mobile-compose-btn" class="rounded-full"><svg></svg></button>
    <button class="rounded-2xl" aria-label="Notifications"><svg></svg></button></div></nav>
</div>`;

function setup(t, html = client()) {
  const dom = new JSDOM(`<!doctype html><html data-app-theme="light"><head></head><body>${html}</body></html>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  dom.window.eval(`${source}\nwindow.patchClassicAppearance = patchClassicAppearance;`);
  t.after(() => dom.window.close());
  return { window: dom.window, document: dom.window.document, patch: dom.window.patchClassicAppearance };
}

test('only verified client sections receive classic markers, including desktop and mobile controls', t => {
  const { document, patch } = setup(t);
  patch();
  assert.equal(document.querySelectorAll('.ct-classic-shell').length, 1);
  assert.equal(document.querySelectorAll('.ct-classic-timeline').length, 1);
  assert.equal(document.querySelectorAll('.ct-classic-nav').length, 2);
  assert.equal(document.querySelectorAll('.ct-classic-nav-item').length, 4);
  assert.equal(document.querySelectorAll('.ct-classic-tab').length, 2);
  assert.equal(document.querySelectorAll('.ct-classic-submit').length, 2);
  assert.equal(document.querySelectorAll('.ct-classic-mobile-compose').length, 1);
  assert.equal(document.querySelectorAll('.ct-classic-tweet').length, 2);
  assert.equal(document.querySelectorAll('.ct-classic-avatar').length, 4);
  assert.equal(document.querySelectorAll('.ct-classic-side-panel').length, 1);
  assert.ok(document.querySelector('.ct-classic-header'));
  assert.equal(document.querySelector('img[alt="Post attachment"]').className, 'rounded-xl');
});

test('unknown roots, unverified main structure and custom themes fail open without injected CSS', t => {
  const variants = [
    '<main><article><p>Something else</p></article></main>',
    client().replace('lg:col-span-6', 'future-main-column'),
    client().replace('lg:grid-cols-12', 'future-grid'),
    client().replace('data-app-theme="light"', 'data-app-theme="sepia"'),
    client().replace('id="root-container"', 'id="different-app"')
  ];
  for (const html of variants) {
    const { document, patch } = setup(t, html);
    const before = document.documentElement.outerHTML;
    patch();
    assert.equal(document.documentElement.outerHTML, before);
  }
});

test('inputs, focus, post body, profile strings, links, dimensions and native handlers remain intact', t => {
  const { document, patch } = setup(t);
  const input = document.getElementById('public-tweet-input');
  const body = document.querySelector('#tweet p');
  const author = document.querySelector('#tweet button.font-bold');
  const favorite = document.querySelector('[data-testid="tweet-like-action"]');
  const avatar = document.querySelector('#tweet img[alt="Alice avatar"]');
  const content = [body.innerHTML, author.textContent, favorite.outerHTML, avatar.width, avatar.height];
  let clicks = 0;
  favorite.addEventListener('click', () => clicks++);
  input.focus();
  input.setSelectionRange(3, 11);
  patch();
  assert.equal(document.activeElement, input);
  assert.equal(input.value, 'English Like News draft');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 11]);
  assert.equal(input.getAttribute('placeholder'), "What's happening?");
  assert.equal(input.className, '');
  assert.equal(document.getElementById('public-tweet-submit-btn').disabled, true);
  assert.equal(document.querySelector('input[type="file"]').multiple, false);
  assert.deepEqual([body.innerHTML, author.textContent, favorite.outerHTML, avatar.width, avatar.height], content);
  assert.equal(document.querySelector('#tweet p a').getAttribute('href'), '/user/bob');
  assert.equal(document.querySelector('[data-testid="tweet-like-action"]'), favorite);
  favorite.click();
  assert.equal(clicks, 1);
});

test('disabling restores original DOM, then enabling creates one style and one set of markers', t => {
  const { document, patch } = setup(t);
  const before = document.documentElement.outerHTML;
  patch();
  patch(document, false);
  assert.equal(document.documentElement.outerHTML, before);
  patch();
  assert.equal(document.querySelectorAll('#ct-classic-appearance-style').length, 1);
  const enabled = document.documentElement.outerHTML;
  patch();
  assert.equal(document.documentElement.outerHTML, enabled);
});

test('repeated full and partial scans produce no DOM mutations', t => {
  const { document, patch, window } = setup(t);
  patch();
  const observer = new window.MutationObserver(() => {});
  observer.observe(document.documentElement, { attributes: true, subtree: true, childList: true, characterData: true });
  patch();
  patch(document.querySelector('#tweet p').firstChild);
  assert.deepEqual(observer.takeRecords(), []);
  observer.disconnect();
});

test('quoted content, owned tools, unverified articles and native attachments are never marked', t => {
  const { document, patch } = setup(t);
  const main = document.querySelector('main');
  main.insertAdjacentHTML('beforeend', `<div aria-label="Quoted post from bob">${post('quote')}</div>
    <div data-ct-owned="panel">${post('owned')}</div>
    <article id="unknown" class="py-3"><p class="whitespace-pre-wrap break-words">Unknown</p>${actions}</article>
    <article id="quoted-evidence" class="py-3"><blockquote>${post('inner-quote')}</blockquote></article>`);
  const untouched = ['quote', 'owned', 'unknown', 'quoted-evidence'].map(id => document.getElementById(id).outerHTML);
  patch();
  assert.deepEqual(['quote', 'owned', 'unknown', 'quoted-evidence'].map(id => document.getElementById(id).outerHTML), untouched);
});

test('recycled articles lose styling when required native structures disappear', t => {
  const { document, patch } = setup(t);
  patch();
  const article = document.getElementById('tweet');
  article.querySelector('[data-testid="tweet-repost-action"]').remove();
  patch(article);
  assert.equal(article.classList.contains('ct-classic-tweet'), false);
  assert.equal(article.querySelector('.ct-classic-avatar'), null);
  assert.equal(article.querySelector('.ct-classic-actions'), null);
  assert.equal(document.getElementById('reply').classList.contains('ct-classic-tweet'), true);
});

test('changing native structure or theme removes all applied styling without writing theme settings', t => {
  const { document, patch, window } = setup(t);
  window.localStorage.setItem('native-theme', 'light');
  patch();
  const shell = document.getElementById('root-container');
  shell.setAttribute('data-app-theme', 'dark');
  patch();
  assert.equal(shell.classList.contains('ct-classic-shell'), true);
  assert.equal(document.documentElement.getAttribute('data-app-theme'), 'light');
  assert.equal(window.localStorage.getItem('native-theme'), 'light');
  shell.setAttribute('data-app-theme', 'sepia');
  patch();
  assert.equal(shell.classList.contains('ct-classic-shell'), false);
  assert.equal(document.getElementById('ct-classic-appearance-style'), null);
  assert.equal(document.querySelector('.ct-classic-tweet'), null);
  assert.equal(shell.getAttribute('data-app-theme'), 'sepia');
});

test('cleanup preserves native class changes and pre-existing marker classes', t => {
  const { document, patch } = setup(t);
  const input = document.getElementById('public-tweet-submit-btn');
  input.className = 'rounded-full  bg-sky-500';
  const shell = document.getElementById('root-container');
  shell.classList.add('ct-classic-shell');
  patch();
  document.getElementById('tweet').classList.add('native-state-new');
  patch(document, false);
  assert.equal(input.className, 'rounded-full  bg-sky-500');
  assert.equal(document.getElementById('tweet').classList.contains('native-state-new'), true);
  assert.equal(shell.classList.contains('ct-classic-shell'), true);
  assert.equal(document.getElementById('ct-classic-appearance-style'), null);
});

test('unrelated style ID collision fails open and preserves the existing node', t => {
  const { document, patch } = setup(t);
  const unrelated = document.createElement('style');
  unrelated.id = 'ct-classic-appearance-style';
  unrelated.textContent = 'body { color: black; }';
  document.head.append(unrelated);
  const before = document.documentElement.outerHTML;
  patch();
  assert.equal(document.documentElement.outerHTML, before);
  assert.equal(document.getElementById('ct-classic-appearance-style'), unrelated);
});

test('media-only and quote-only native Tweets retain the same appearance without changing attachments', t => {
  const { document, patch } = setup(t);
  const tweet = document.getElementById('tweet');
  tweet.querySelector('p.whitespace-pre-wrap').textContent = '';
  const image = tweet.querySelector('img[alt="Post attachment"]');
  const before = image.outerHTML;
  const reply = document.getElementById('reply');
  reply.querySelector('p.whitespace-pre-wrap').textContent = '';
  reply.querySelector('p.whitespace-pre-wrap').insertAdjacentHTML('afterend', '<blockquote><p>Quoted original text</p></blockquote>');
  patch();
  assert.equal(tweet.classList.contains('ct-classic-tweet'), true);
  assert.equal(reply.classList.contains('ct-classic-tweet'), true);
  assert.equal(image.outerHTML, before);
  assert.equal(reply.querySelector('blockquote').outerHTML, '<blockquote><p>Quoted original text</p></blockquote>');
});

test('favorite count markers recognize only the native group and preserve numeric controls and handlers', t => {
  const { document, patch } = setup(t);
  const groups = [...document.querySelectorAll('[data-testid="tweet-like-action"]')].map(button => button.parentElement);
  groups[0].classList.replace('text-tl-app-text-muted', 'text-pink-500');
  const count = document.createElement('button');
  count.dataset.testid = 'tweet-like-action-count';
  count.setAttribute('aria-label', 'View 4 likes');
  count.className = 'text-xs tabular-nums text-pink-500';
  count.textContent = '4';
  groups[0].lastElementChild.replaceWith(count);
  let opened = 0;
  count.addEventListener('click', () => opened++);
  const before = count.outerHTML;
  patch();
  assert.equal(document.querySelectorAll('.ct-classic-favorite-group').length, 2);
  assert.equal(count.outerHTML, before);
  count.click();
  assert.equal(opened, 1);
  groups[1].insertAdjacentHTML('beforeend', '<span>Unrecognized extra control</span>');
  patch();
  assert.equal(groups[1].classList.contains('ct-classic-favorite-group'), false);
  assert.equal(groups[0].classList.contains('ct-classic-favorite-group'), true);
  assert.match(document.getElementById('ct-classic-appearance-style').textContent,
    /\.ct-classic-favorite-group\.text-pink-500 > \[data-testid="tweet-like-action-count"\]/);
  patch(document, false);
  assert.equal(groups[0].classList.contains('text-pink-500'), true);
  assert.equal(count.outerHTML, before);
});
