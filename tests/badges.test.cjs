const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/badges.js'), 'utf8');
function article(username = 'alice', nativeBadge = '') {
  return `<article><div class="flex items-start gap-3"><button aria-label="View @${username}'s profile"><img src="/avatar.png"></button>
    <div class="min-w-0 flex-1"><div class="flex items-center gap-1"><button class="font-bold truncate">${username}</button>${nativeBadge}<span>·</span><span>3m</span></div>
    <p class="whitespace-pre-wrap break-words">Original reply text</p><button aria-label="Like 3">3</button></div></div></article>`;
}
function drawer(username = 'alice', name = 'Alice') {
  return `<div role="dialog" aria-label="Account menu"><div><button class="block text-left"><img src="/avatar.png">
    <p class="mt-3 text-base font-extrabold truncate">${name}</p><p class="text-sm truncate">@${username}</p></button></div></div>`;
}
function nativeImage(kind = 'founder', size = 18) {
  return `<span aria-label="Founder"><img class="shrink-0 select-none" src="/assets/${kind}-badge-${size}.png" srcset="/assets/${kind}-badge-18.png 18w, /assets/${kind}-badge-96.png 96w" sizes="18px" alt="" style="width:18px;height:18px"></span>`;
}
function harness(t, html, profile = async username => ({ username, badges: ['founding_special', 'wing'] }), locale = 'en') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.CT_LOCALE = locale;
  const requested = [];
  window.fetchProfile = async username => { requested.push(username); return profile(username); };
  window.eval(`${source}\nwindow.qa = { patchOfficialBadges, ctBadgeAsset, ctProfileBadgeKinds, ctBadgeLabel, ctOfficialBadgeKinds };`);
  t.after(() => window.close());
  return { window, document: window.document, qa: window.qa, requested, patch: root => window.qa.patchOfficialBadges(root) };
}

test('native badges use official 96 px art without increasing their displayed size or changing labels', async t => {
  const f = harness(t, article('alice', nativeImage()));
  const image = f.document.querySelector('img.select-none');
  await f.patch();
  assert.equal(image.src, 'https://app.tweet.app/assets/founder-badge-96.png');
  assert.equal(image.getAttribute('srcset'), null);
  assert.equal(image.style.width, '18px');
  assert.equal(image.style.height, '18px');
  assert.equal(image.parentElement.getAttribute('aria-label'), 'Founder');
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
  assert.equal(f.requested.length, 0, 'native membership artwork requires no extra profile query');
});

test('only exact official badge assets in native badge elements are upgraded', async t => {
  const f = harness(t, `<img class="shrink-0 select-none" src="https://example.com/assets/founder-badge-18.png">
    <img src="/assets/founder-badge-18.png" alt="Uploaded photograph"><img class="shrink-0 select-none" src="/assets/founder-badge-128.png">
    <img class="shrink-0 select-none" src="/assets/founder-badge-18.png?user=alice"><img src="/avatar.png">`);
  const before = [...f.document.images].map(img => img.outerHTML);
  await f.patch();
  assert.deepEqual([...f.document.images].map(img => img.outerHTML), before);
  assert.equal(f.qa.ctBadgeAsset('https://app.tweet.app.evil.example/assets/founder-badge-18.png'), null);
});

test('all seven verified official badge kinds support the larger image variant', async t => {
  const kinds = ['founder', 'fighter', 'centurion', 'team-member', 'ambassador', 'wing', 'press'];
  const f = harness(t, kinds.map(kind => nativeImage(kind)).join(''));
  await f.patch();
  assert.deepEqual([...f.document.images].map(img => img.src), kinds.map(kind => `https://app.tweet.app/assets/${kind}-badge-96.png`));
});

test('a failed larger image restores native source selection without a retry loop', async t => {
  const f = harness(t, nativeImage());
  const image = f.document.querySelector('img');
  const originalSource = image.getAttribute('src');
  const originalSrcset = image.getAttribute('srcset');
  await f.patch();
  image.dispatchEvent(new f.window.Event('error'));
  assert.equal(image.getAttribute('src'), originalSource);
  assert.equal(image.getAttribute('srcset'), originalSrcset);
  await f.patch();
  assert.equal(image.getAttribute('src'), originalSource);
  image.dispatchEvent(new f.window.Event('error'));
  assert.equal(image.getAttribute('src'), originalSource);
});

test('a recycled native image keeps one error listener and restores its current badge kind', async t => {
  const f = harness(t, nativeImage());
  const image = f.document.querySelector('img');
  const listen = image.addEventListener.bind(image);
  let errors = 0;
  image.addEventListener = (type, ...args) => { if (type === 'error') errors++; return listen(type, ...args); };
  await f.patch();
  for (const kind of ['fighter', 'centurion', 'wing', 'press']) {
    image.setAttribute('src', `/assets/${kind}-badge-18.png`);
    image.setAttribute('srcset', `/assets/${kind}-badge-18.png 18w`);
    await f.patch();
  }
  assert.equal(errors, 1);
  image.dispatchEvent(new f.window.Event('error'));
  assert.equal(image.getAttribute('src'), '/assets/press-badge-18.png');
  assert.equal(image.getAttribute('srcset'), '/assets/press-badge-18.png 18w');
});

test('official membership precedence preserves cumulative tiers, role priority, and unknown-badge exclusion', t => {
  const f = harness(t, '');
  const kinds = user => Array.from(f.qa.ctProfileBadgeKinds(user));
  assert.deepEqual(kinds({ badges: ['team_member', 'centurion', 'wing'] }), ['team-member']);
  assert.deepEqual(kinds({ badges: ['centurion', 'ambassador', 'press', 'wing', 'invented'] }), ['founder', 'fighter', 'centurion', 'wing', 'ambassador', 'press']);
  assert.deepEqual(kinds({ badges: ['founding_special'] }), ['founder', 'fighter']);
  assert.deepEqual(kinds({ foundingMemberNumber: 123, badges: [] }), ['founder']);
  assert.deepEqual(kinds({ badges: ['unverified', 'custom'] }), []);
  assert.deepEqual(kinds({ foundingMemberNumber: 'invalid' }), []);
});

test('reply author rows receive official badges while native text and click handlers stay intact', async t => {
  const f = harness(t, article());
  const name = f.document.querySelector('button.font-bold');
  let clicks = 0;
  name.addEventListener('click', () => clicks++);
  await f.patch();
  const group = name.nextElementSibling;
  assert.equal(group.className, 'ct-official-badges');
  assert.equal(group.getAttribute('aria-label'), 'Fighter + Wing');
  assert.equal(group.children.length, 3);
  assert.equal(name.textContent, 'alice');
  assert.equal(f.document.querySelector('p').textContent, 'Original reply text');
  assert.equal(f.document.querySelector('button[aria-label="Like 3"]').textContent, '3');
  name.click();
  assert.equal(clicks, 1);
});

test('mobile account drawer badges appear inside the name line without replacing profile controls', async t => {
  const f = harness(t, drawer());
  const name = f.document.querySelector('p.font-extrabold');
  const profileButton = name.parentElement;
  let clicks = 0;
  profileButton.addEventListener('click', () => clicks++);
  await f.patch();
  assert.equal(name.textContent, 'Alice');
  assert.equal(name.querySelectorAll('.ct-official-badges').length, 1);
  assert.equal(name.nextElementSibling.textContent, '@alice');
  assert.ok(name.classList.contains('ct-account-badge-name'));
  assert.equal(profileButton.querySelector('button'), null, 'no nested interactive controls');
  name.querySelector('img').click();
  assert.equal(clicks, 1);
});

test('new supplemental badges fall back to an official 36 px variant if the largest image fails', async t => {
  const f = harness(t, drawer());
  await f.patch();
  const image = f.document.querySelector('.ct-official-badges img');
  image.dispatchEvent(new f.window.Event('error'));
  assert.equal(image.src, 'https://app.tweet.app/assets/founder-badge-36.png');
  await f.patch();
  assert.equal(image.src, 'https://app.tweet.app/assets/founder-badge-36.png');
});

test('repeated scans reuse one badge group and one style element without redundant DOM writes', async t => {
  const f = harness(t, `${article()}${drawer()}`);
  await f.patch();
  const groups = [...f.document.querySelectorAll('.ct-official-badges')];
  const firstImages = groups.map(group => group.firstElementChild);
  await f.patch();
  await f.patch();
  assert.equal(f.document.querySelectorAll('.ct-official-badges').length, 2);
  assert.deepEqual([...f.document.querySelectorAll('.ct-official-badges')], groups);
  assert.deepEqual(groups.map(group => group.firstElementChild), firstImages);
  assert.equal(f.document.querySelectorAll('#ct-official-badge-style').length, 1);
});

test('in-flight lookups are shared per author name and detached targets are ignored', async t => {
  let resolve;
  const f = harness(t, drawer(), () => new Promise(done => { resolve = done; }));
  const first = f.patch();
  const second = f.patch();
  await Promise.resolve();
  assert.equal(f.requested.length, 1);
  f.document.querySelector('[role="dialog"]').remove();
  resolve({ username: 'alice', badges: ['founding'] });
  await Promise.all([first, second]);
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
});

test('recycled reply identities cannot keep the previous user badge or accept their late response', async t => {
  const replies = new Map();
  const f = harness(t, article(), username => new Promise(resolve => replies.set(username, resolve)));
  const first = f.patch();
  await Promise.resolve();
  const avatar = f.document.querySelector('button[aria-label]');
  avatar.setAttribute('aria-label', "View @bob's profile");
  f.document.querySelector('button.font-bold').textContent = 'bob';
  const second = f.patch();
  await Promise.resolve();
  replies.get('bob')({ username: 'bob', badges: ['press'] });
  await second;
  replies.get('alice')({ username: 'alice', badges: ['centurion'] });
  await first;
  const group = f.document.querySelector('.ct-official-badges');
  assert.equal(group.dataset.ctBadgeUser, 'bob');
  assert.equal(group.getAttribute('aria-label'), 'Press');
  avatar.setAttribute('aria-label', "View @carol's profile");
  f.document.querySelector('button.font-bold').textContent = 'carol';
  const third = f.patch();
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
  await Promise.resolve();
  replies.get('carol')({ username: 'carol', badges: [] });
  await third;
});

test('badge revocation and a newly native badge remove the supplemental group', async t => {
  let badges = ['founding'];
  const f = harness(t, article(), async username => ({ username, badges }));
  await f.patch();
  assert.ok(f.document.querySelector('.ct-official-badges'));
  badges = [];
  await f.patch();
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
  badges = ['founding'];
  await f.patch();
  f.document.querySelector('button.font-bold').insertAdjacentHTML('afterend', nativeImage());
  await f.patch();
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
});

test('missing or mismatched profiles do not fabricate membership from display names or body content', async t => {
  const f = harness(t, article(), async () => ({ username: 'different', badges: ['centurion'] }));
  await f.patch();
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
  f.window.fetchProfile = async () => null;
  await f.patch();
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
});

test('quoted content, custom panels, and non-profile dialogs are excluded from badge inference', async t => {
  const f = harness(t, `<blockquote>${article()}</blockquote><div data-ct-owned>${article()}</div>
    <div role="dialog" aria-label="Reply to post"><button class="block text-left"><p class="font-extrabold truncate">Alice</p><p class="truncate">@alice</p></button></div>`);
  await f.patch();
  assert.equal(f.requested.length, 0);
  assert.equal(f.document.querySelector('.ct-official-badges'), null);
});

test('a nested quote cannot supply an author for an outer article with no known author', async t => {
  const f = harness(t, `<article><p>Unknown author</p><blockquote>${article()}</blockquote></article>`);
  await f.patch();
  assert.equal(f.requested.length, 0);
});

test('localized display names still resolve only through the verified author identity marker', async t => {
  const f = harness(t, article());
  const name = f.document.querySelector('button.font-bold');
  name.textContent = 'アリス';
  name.dataset.ctAuthorUser = 'alice';
  await f.patch(name);
  assert.equal(f.document.querySelector('.ct-official-badges')?.dataset.ctBadgeUser, 'alice');
  assert.equal(name.textContent, 'アリス');
});

function nativeDescription(label, kinds, id = 'badge') {
  return `<span class="relative inline-flex shrink-0 items-center align-middle" role="button" tabindex="0" aria-label="${label}" title="${label}" id="${id}">${kinds.map(kind =>
    `<img class="shrink-0 select-none" src="/assets/${kind}-badge-18.png" alt="">`).join('')}</span>`;
}
function nativeTooltip(label, kinds, id = 'tooltip') {
  return `<div role="tooltip" class="fixed pointer-events-none" id="${id}"><div class="bg-tl-app-card border flex flex-col items-center">
    <span class="inline-flex flex-wrap justify-center">${kinds.map(kind => `<img class="shrink-0 select-none" src="/assets/${kind}-badge-36.png" alt="">`).join('')}</span>
    <span class="font-bold text-tl-app-text text-center leading-tight">${label}</span></div></div>`;
}

test('ja: all official role descriptions localize only through verified current badge artwork', async t => {
  const entries = [['founder', 'Founder', '創設メンバー'], ['fighter', 'Fighter', 'ファイター'],
    ['centurion', 'Centurion', 'センチュリオン'], ['team-member', 'Team Member', '運営メンバー'],
    ['ambassador', 'Tweet Ambassador', 'Tweetアンバサダー'], ['wing', 'Wing', 'ウィング'], ['press', 'Press', 'プレス']];
  const f = harness(t, entries.map(([kind, name]) => nativeDescription(name, [kind], kind)).join(''), undefined, 'ja');
  const images = [...f.document.images];
  let clicks = 0;
  f.document.getElementById('team-member').addEventListener('click', () => clicks++);
  await f.patch();
  for (const [kind, english, japanese] of entries) {
    const el = f.document.getElementById(kind);
    assert.equal(el.getAttribute('aria-label'), japanese);
    assert.equal(el.title, japanese);
    assert.equal(f.qa.ctOfficialBadgeKinds[kind], english, 'role definitions remain canonical English');
  }
  assert.deepEqual([...f.document.images], images);
  f.document.getElementById('team-member').click();
  assert.equal(clicks, 1);
  const before = f.document.body.innerHTML;
  await f.patch(); assert.equal(f.document.body.innerHTML, before);
});

test('ja: native combination tooltip and accessibility descriptions translate while preserving tooltip nodes', async t => {
  const kinds = ['founder', 'fighter', 'centurion', 'ambassador', 'press', 'wing'];
  const english = 'Centurion + Tweet Ambassador + Press + Wing';
  const f = harness(t, nativeDescription(english, kinds) + nativeTooltip(english, kinds) +
    '<h2 id="name">Team Member</h2><p class="tl-user-text" id="body">Founder + Wing</p>', undefined, 'ja');
  const label = f.document.querySelector('[role="tooltip"] span.font-bold');
  const text = label.firstChild;
  await f.patch();
  const japanese = 'センチュリオン + Tweetアンバサダー + プレス + ウィング';
  assert.equal(f.document.getElementById('badge').getAttribute('aria-label'), japanese);
  assert.equal(label.textContent, japanese);
  assert.equal(label.firstChild, text);
  assert.equal(f.document.getElementById('name').textContent, 'Team Member');
  assert.equal(f.document.getElementById('body').textContent, 'Founder + Wing');
  text.nodeValue = 'Wing';
  await f.patch(text);
  assert.equal(text.nodeValue, 'ウィング', 'native React text updates are handled from their changed node');
});

test('ja: protected content, unknown roles, asset mismatches and numbered labels are preserved', async t => {
  const f = harness(t, `<div data-user-content>${nativeDescription('Founder', ['founder'], 'protected')}</div>` +
    nativeDescription('Founder + Custom Role', ['founder'], 'custom') +
    nativeDescription('Founder #42', ['founder'], 'numbered') +
    nativeDescription('Founder', ['wing'], 'mismatch') +
    '<span class="relative inline-flex shrink-0 items-center align-middle" role="button" aria-label="Founder" id="foreign"><img class="shrink-0 select-none" src="https://example.com/assets/founder-badge-18.png"></span>' +
    nativeTooltip('Founder + Unknown', ['founder']) +
    '<div role="tooltip" class="fixed pointer-events-none"><span class="font-bold text-tl-app-text text-center leading-tight" id="plain">Founder</span></div>', undefined, 'ja');
  await f.patch();
  for (const [id, value] of [['protected', 'Founder'], ['custom', 'Founder + Custom Role'], ['numbered', 'Founder #42'], ['mismatch', 'Founder'], ['foreign', 'Founder']]) {
    assert.equal(f.document.getElementById(id).getAttribute('aria-label'), value);
  }
  assert.equal(f.document.querySelector('#tooltip span.font-bold').textContent, 'Founder + Unknown');
  assert.equal(f.document.getElementById('plain').textContent, 'Founder');
});

test('ja: recycled native labels use current role values and retain image error fallback behavior', async t => {
  const f = harness(t, nativeDescription('Founder', ['founder']), undefined, 'ja');
  const wrapper = f.document.getElementById('badge');
  const image = wrapper.querySelector('img');
  await f.patch();
  image.setAttribute('src', '/assets/press-badge-18.png');
  wrapper.setAttribute('aria-label', 'Press'); wrapper.title = 'Press';
  await f.patch(wrapper);
  assert.equal(wrapper.getAttribute('aria-label'), 'プレス');
  assert.equal(wrapper.title, 'プレス');
  wrapper.setAttribute('aria-label', 'Custom native label');
  await f.patch(wrapper);
  assert.equal(wrapper.getAttribute('aria-label'), 'Custom native label');
  image.dispatchEvent(new f.window.Event('error'));
  assert.equal(image.getAttribute('src'), '/assets/press-badge-18.png');
  await f.patch(); assert.equal(image.getAttribute('src'), '/assets/press-badge-18.png');
});

test('ja: supplemental reply and drawer descriptions use Japanese while official art and identities remain intact', async t => {
  const f = harness(t, article() + drawer(), undefined, 'ja');
  await f.patch();
  const groups = [...f.document.querySelectorAll('.ct-official-badges')];
  assert.equal(groups.length, 2);
  for (const group of groups) {
    assert.equal(group.getAttribute('aria-label'), 'ファイター + ウィング');
    assert.equal(group.title, 'ファイター + ウィング');
  }
  assert.equal(f.document.querySelector('button.font-bold').textContent, 'alice');
  assert.equal(f.document.querySelector('p.font-extrabold').textContent, 'Alice');
  const image = groups[0].querySelector('img');
  image.dispatchEvent(new f.window.Event('error'));
  assert.equal(image.src, 'https://app.tweet.app/assets/founder-badge-36.png');
  await f.patch(); assert.equal(groups[0].getAttribute('aria-label'), 'ファイター + ウィング');
});

test('en: native and supplemental role explanations retain their original English', async t => {
  const english = 'Centurion + Tweet Ambassador';
  const kinds = ['founder', 'fighter', 'centurion', 'ambassador'];
  const f = harness(t, nativeDescription(english, kinds) + nativeTooltip(english, kinds) + article(), undefined, 'en');
  await f.patch();
  assert.equal(f.document.getElementById('badge').getAttribute('aria-label'), english);
  assert.equal(f.document.getElementById('badge').title, english);
  assert.equal(f.document.querySelector('#tooltip span.font-bold').textContent, english);
  assert.equal(f.document.querySelector('.ct-official-badges').getAttribute('aria-label'), 'Fighter + Wing');
});
