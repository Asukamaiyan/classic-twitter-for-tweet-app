const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/presentation.js'), 'utf8');
// Current Tweet 2.1.1 renders bio text directly between its identity header and
// calendar/location metadata. The cover and three native tabs identify the field.
function profile(handle = 'alice', labels = ['Tweets', 'Replies', 'Reposts']) {
  return `<div class="animate-fadeIn"><div class="overflow-hidden"><div class="cover">Cover</div><div class="px-4 pb-4">
    <div class="mt-3 flex flex-col gap-1"><h2 class="font-extrabold text-tl-app-text leading-tight min-w-0"><span>Alice</span></h2><p class="text-[0.9375rem] text-tl-app-text-muted">@${handle}</p></div>
    <p class="mt-3 text-[0.9375rem] text-tl-app-text leading-relaxed" data-bio></p>
    <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-tl-app-text-muted"><a href="https://example.org/">Website</a><span>Joined October 2026</span></div>
    </div></div><div role="tablist">${labels.map(label => `<button role="tab" aria-label="${label}"><svg></svg></button>`).join('')}</div><div><article>Native post</article></div></div>`;
}
function harness(t, { html = profile(), route = '/user/alice' } = {}) {
  const dom = new JSDOM(`<head></head><body><main>${html}</main></body>`, {
    url: 'https://app.tweet.app' + route, runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  window.normUser = value => window.clean(value).replace(/^@/, '').toLowerCase();
  window.routeUser = () => window.location.pathname.match(/^\/user\/([^/]+)/)?.[1] || null;
  window.ownProfileUser = () => 'alice';
  const requests = [];
  window.fetchProfile = async handle => { requests.push(handle); return { displayName: 'Alice' }; };
  window.eval(`${source}\nwindow.bioQA={patch:ctPatchProfileBio, founder:patchProfileFounder};`);
  t.after(() => window.close());
  return { window, document: window.document, api: window.bioQA, requests,
    bio: () => window.document.querySelector('[data-bio]'),
    route: value => window.history.replaceState({}, '', value)
  };
}

for (const [name, text] of [
  ['LF', '一行目\n\n二行目  空白\n長いURL https://example.org/long/path'],
  ['CRLF', '一行目\r\n二行目\r\n\r\n三行目']
]) {
  test(`profile bio preserves ${name} and blank lines through CSS without changing its text`, t => {
    const f = harness(t); const bio = f.bio();
    bio.textContent = text; const node = bio.firstChild;
    f.api.patch();
    assert.equal(bio.textContent, text);
    assert.equal(bio.firstChild, node);
    assert.equal(f.window.getComputedStyle(bio).whiteSpace, 'pre-wrap');
    assert.equal(f.window.getComputedStyle(bio).overflowWrap, 'anywhere');
    assert.equal(f.requests.length, 0, 'formatting needs no profile or media request');
  });
}

test('bio formatting retains native linked nodes, events, names, metadata and draft values', t => {
  const f = harness(t); const bio = f.bio();
  const first = f.document.createTextNode('First\n');
  const link = f.document.createElement('a'); link.href = 'https://example.org/bio'; link.textContent = 'Home';
  let clicks = 0; link.addEventListener('click', event => { event.preventDefault(); clicks++; });
  bio.append(first, link, '\nLast');
  f.document.body.insertAdjacentHTML('beforeend', '<textarea id="draft">First\nSecond</textarea><p class="leading-relaxed" id="other">Home\nFollowing</p>');
  const heading = f.document.querySelector('h2'); const metadata = bio.nextElementSibling; const text = bio.textContent;
  const metadataHTML = metadata.innerHTML; const headingHTML = heading.innerHTML;
  f.api.patch(); link.click();
  assert.equal(bio.firstChild, first); assert.equal(bio.children[0], link);
  assert.equal(bio.textContent, text); assert.equal(link.getAttribute('href'), 'https://example.org/bio'); assert.equal(clicks, 1);
  assert.equal(heading.innerHTML, headingHTML); assert.equal(metadata.innerHTML, metadataHTML);
  assert.equal(f.document.getElementById('draft').value, 'First\nSecond');
  assert.equal(f.document.getElementById('other').className, 'leading-relaxed');
});

test('Japanese and English profile routes accept verified header identity and native tab labels', t => {
  for (const [route, handle, labels] of [
    ['/profile', 'alice', ['ツイート', 'リプライ', 'リツイート']],
    ['/profile/', 'alice', ['Tweets', 'Replies', 'Reposts']],
    ['/user/ALICE/', 'alice', ['Posts', 'Replies', 'Retweets']],
    ['/user/alice%2E123', 'alice.123', ['Tweets', 'Replies', 'Reposts']]
  ]) {
    const f = harness(t, { html: profile(handle, labels), route }); f.api.patch();
    assert.equal(f.bio().classList.contains('ct-profile-bio-lines'), true, route);
  }
});

test('unverified routes, identities, hidden copies, editable fields and similar text fail open', t => {
  const base = profile();
  const cases = [
    { route: '/feed' }, { route: '/settings' }, { route: '/user/bob' }, { route: '/user/alice/posts' }, { route: '/user/%FF' },
    { html: base.replace('@alice', '@alice @bob') },
    { html: base.replace('class="px-4 pb-4"', 'class="future-profile"') },
    { html: base.replace('class="mt-3 flex flex-wrap items-center', 'class="future-meta') },
    { html: base.replace('aria-label="Tweets"', 'aria-label="Future tab"') },
    { html: base.replace('data-bio', 'data-bio contenteditable="true"') },
    { html: `<div hidden>${base}</div>` }, { html: `<div class="hidden">${base}</div>` },
    { html: `<div aria-hidden="true">${base}</div>` }, { html: `<article>${base}</article>` },
    { html: `<div data-ct-owned>${base}</div>` }, { html: `<div role="dialog">${base}</div>` },
    { html: base + base }
  ];
  for (const options of cases) {
    const f = harness(t, options); const html = f.document.querySelector('main').innerHTML;
    f.api.patch();
    assert.equal(f.document.querySelector('main').innerHTML, html, JSON.stringify(options));
    assert.equal(f.document.getElementById('ct-profile-bio-style'), null);
  }
});

test('bio class is removed on route or structure change and reused nodes can recover', t => {
  const f = harness(t); const bio = f.bio(); const nativeClass = bio.className;
  bio.textContent = 'A\nB'; f.api.patch();
  f.route('/feed'); f.api.patch(); assert.equal(bio.className, nativeClass);
  f.route('/user/alice'); f.api.patch(); assert.equal(bio.classList.contains('ct-profile-bio-lines'), true);
  const metadata = bio.nextElementSibling; const metadataClass = metadata.className;
  metadata.className = 'unknown'; f.api.patch(); assert.equal(bio.className, nativeClass);
  metadata.className = metadataClass; f.api.patch();
  f.document.querySelector('h2 + p').textContent = '@bob'; f.api.patch(); assert.equal(bio.className, nativeClass);
  f.document.querySelector('h2 + p').textContent = '@alice'; f.api.patch();
  bio.remove(); f.api.patch(); assert.equal(bio.className, nativeClass);
  assert.equal(bio.textContent, 'A\nB');
});

test('settled profile scans perform no repeated DOM writes or replacement', async t => {
  const f = harness(t); const bio = f.bio(); bio.textContent = 'A\nB';
  f.api.patch(); const style = f.document.getElementById('ct-profile-bio-style');
  const mutations = []; const observer = new f.window.MutationObserver(records => mutations.push(...records));
  observer.observe(f.document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  for (let i = 0; i < 100; i++) f.api.patch();
  await Promise.resolve(); observer.disconnect();
  assert.equal(mutations.length, 0);
  assert.equal(f.bio(), bio); assert.equal(f.document.getElementById('ct-profile-bio-style'), style);
  assert.equal(f.requests.length, 0);
});

test('existing founder scan applies bio formatting synchronously without waiting for profile requests', async t => {
  const f = harness(t); const bio = f.bio(); bio.textContent = 'A\nB';
  let respond; f.window.fetchProfile = () => new Promise(resolve => { respond = resolve; });
  const pending = f.api.founder();
  assert.equal(f.window.getComputedStyle(bio).whiteSpace, 'pre-wrap');
  respond(null); await pending;
  assert.equal(bio.textContent, 'A\nB');
});
