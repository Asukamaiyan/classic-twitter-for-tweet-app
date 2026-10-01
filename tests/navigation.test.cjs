const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/navigation.js'), 'utf8');
const actor = (handle, name = handle, url = `https://cdn.example/${handle}.jpg`) => ({ actorHandle: handle, actorDisplayName: name, actorAvatarUrl: url });
const avatar = (name, { handle, src = `https://cdn.example/${name}.jpg`, placeholder = false } = {}) => `<div class="relative inline-flex shrink-0 isolate">${placeholder
  ? `<div role="img" class="rounded-full border object-cover" aria-label="${name} avatar placeholder"></div>`
  : `<img class="rounded-full object-cover" alt="${name} avatar" src="${src}">`}${handle ? `<span role="button" tabindex="0" aria-label="Follow @${handle}" class="absolute -bottom-0.5 -right-0.5"><svg></svg></span>` : ''}</div>`;
function harness(t, content, notifications = [], locale = 'ja') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><main><button type="button" id="row" class="items-start border-b"><div>${content}</div><p id="preview">Notification post preview</p></button><button id="regular">Follow</button></main></body></html>`, {
    url: 'https://app.tweet.app/notifications', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const state = { uid: 'one', notifications, requests: [], authCalls: 0, rowClicks: 0 };
  const template = fs.readFileSync(path.join(__dirname, `../src/${locale}.js`), 'utf8');
  const localeDeclaration = template.match(/const CT_LOCALE = '[a-z]+';/)?.[0];
  assert.ok(localeDeclaration, 'use the real template locale declaration, without invented global names');
  window.ctNetworkState = { authUID: 'one' };
  window.getAuth = async () => {
    state.authCalls++;
    window.ctNetworkState.authUID = state.uid;
    return { uid: state.uid, token: 'token' };
  };
  window.requestJSON = async (url, headers) => {
    state.requests.push({ url, headers });
    return { success: true, notifications: state.notifications };
  };
  window.eval(`${localeDeclaration}\n${source}\nwindow.qa = { patchNavigation, installNativeNavigation, destroyNativeNavigation, ctLoadNotificationActors, ctNavigationState };`);
  window.document.getElementById('row').addEventListener('click', () => state.rowClicks++);
  t.after(() => window.close());
  return { window, document: window.document, state, qa: window.qa,
    links: () => [...window.document.querySelectorAll('.ct-notification-profile-link')],
    async patch() { window.qa.patchNavigation(); await window.qa.ctNavigationState.pending; },
    event(target, type = 'click', extra = {}) {
      const event = type === 'keydown' ? new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...extra }) :
        new window.MouseEvent(type, { bubbles: true, cancelable: true, ...extra });
      target.dispatchEvent(event);
      return event;
    }
  };
}

test('2.1 wrapper keeps grouped avatar navigation independent without covering native Follow back rows', async t => {
  const f=harness(t,avatar('alice',{handle:'alice'})+avatar('bob',{handle:'bob'}));
  const row=f.document.getElementById('row');
  row.className='w-full flex items-start gap-3';
  const wrapper=f.document.createElement('div');wrapper.className='border-b border-tl-app-border';
  row.before(wrapper);wrapper.append(row);
  const expanded=f.document.createElement('div');expanded.className='native-follower-list';
  expanded.innerHTML=avatar('carol',{handle:'carol'})+'<button id="back">Follow back</button>';
  wrapper.append(expanded);
  await f.patch();
  assert.deepEqual(f.links().map(x=>x.getAttribute('href')),['/user/alice','/user/bob']);
  assert.equal(expanded.querySelector('.ct-notification-profile-link'),null);
  f.event(f.links()[1]);assert.equal(f.state.rowClicks,0);
  f.event(f.document.getElementById('preview'));assert.equal(f.state.rowClicks,1);
  let back=0;f.document.getElementById('back').addEventListener('click',()=>back++);
  f.document.getElementById('back').click();assert.equal(back,1);
});

test('removes only native avatar follow overlays, preserving ordinary Follow controls', async t => {
  const f = harness(t, avatar('alice', { handle: 'alice' }));
  const overlay = f.document.querySelector('span[role="button"]');
  const regular = f.document.getElementById('regular');
  await f.patch();
  assert.equal(overlay.classList.contains('ct-avatar-follow-hidden'), true);
  assert.equal(overlay.getAttribute('tabindex'), '-1');
  assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(regular.className, '');
  assert.equal(regular.textContent, 'Follow');
  assert.equal(f.links()[0].getAttribute('href'), '/user/alice');
  assert.equal(f.state.requests.length, 0);
});

test('every grouped notification avatar gets its own exact profile link, including followed actors', async t => {
  const f = harness(t, avatar('Noel') + avatar('David', { handle: 'david' }), [actor('noel', 'Noel', 'https://cdn.example/Noel.jpg'), actor('david', 'David', 'https://cdn.example/David.jpg')]);
  await f.patch();
  assert.deepEqual(f.links().map(link => link.getAttribute('href')), ['/user/noel', '/user/david']);
  assert.equal(f.state.requests.length, 1);
  assert.equal(new URL(f.state.requests[0].url).searchParams.get('limit'), '20');
  assert.match(f.links()[0].getAttribute('aria-label'), /@noel/);
});

test('avatar click, modified click and middle click bypass the row without cancelling anchor defaults', async t => {
  const f = harness(t, avatar('alice', { handle: 'alice' }));
  await f.patch();
  const link = f.links()[0];
  for (const [type, extra] of [['click', {}], ['click', { ctrlKey: true }], ['click', { metaKey: true }], ['auxclick', { button: 1 }]]) {
    assert.equal(f.event(link, type, extra).defaultPrevented, false);
  }
  assert.equal(f.state.rowClicks, 0);
  f.event(f.document.getElementById('preview'));
  assert.equal(f.state.rowClicks, 1);
  assert.equal(f.event(link, 'keydown', { key: 'Enter' }).defaultPrevented, false);
  assert.equal(f.event(link, 'keydown', { key: ' ' }).defaultPrevented, true);
});

test('unknown avatars never fall through to the representative profile or post, and can retry', async t => {
  const f = harness(t, avatar('Not a handle'));
  await f.patch();
  const link = f.links()[0];
  assert.equal(link.hasAttribute('href'), false);
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.match(link.title, /プロフィールを特定できません/);
  assert.equal(f.event(link).defaultPrevented, true);
  await f.qa.ctNavigationState.pending;
  assert.equal(f.state.rowClicks, 0);
  assert.equal(f.state.requests.length, 2);
});

test('API display names are never interpreted as handles; identical name and avatar collisions stay disabled', async t => {
  const f = harness(t, avatar('Shared', { src: 'https://cdn.example/shared.jpg' }), [
    actor('alice', 'Shared', 'https://cdn.example/shared.jpg'), actor('bob', 'Shared', 'https://cdn.example/shared.jpg')
  ]);
  await f.patch();
  assert.equal(f.links()[0].hasAttribute('href'), false);
  assert.equal(f.links()[0].getAttribute('aria-disabled'), 'true');
});

test('placeholder and native default avatars map only unambiguous API identities', async t => {
  const f = harness(t, avatar('Alice', { placeholder: true }) + avatar('Shared', { placeholder: true }), [
    actor('alice', 'Alice', null), actor('bob', 'Shared', null), actor('carol', 'Shared', '')
  ]);
  await f.patch();
  assert.deepEqual(f.links().map(link => link.getAttribute('href')), ['/user/alice', null]);
});

test('different avatar URLs with the same display name keep their own identities', async t => {
  const f = harness(t, avatar('Shared', { src: 'https://cdn.example/a.jpg' }) + avatar('Shared', { src: 'https://cdn.example/b.jpg' }), [
    actor('alice', 'Shared', 'https://cdn.example/a.jpg'), actor('bob', 'Shared', 'https://cdn.example/b.jpg')
  ]);
  await f.patch();
  assert.deepEqual(f.links().map(link => link.getAttribute('href')), ['/user/alice', '/user/bob']);
});

test('API errors, untrusted handles and malformed actor schemas cannot produce navigation links', async t => {
  const f = harness(t, avatar('Alice'), [actor('../wrong', 'Alice', 'https://cdn.example/Alice.jpg')], 'en');
  await f.patch();
  assert.equal(f.links()[0].hasAttribute('href'), false);
  assert.match(f.links()[0].title, /Profile unavailable/);
  f.qa.ctNavigationState.fetchedAt = 0;
  f.window.requestJSON = async () => ({ success: false, notifications: [actor('alice', 'Alice', 'https://cdn.example/Alice.jpg')] });
  await f.qa.ctLoadNotificationActors();
  assert.equal(f.links()[0].hasAttribute('href'), false);
  const calls = f.state.authCalls;
  await f.patch();
  assert.equal(f.state.authCalls, calls, 'failed lookups back off instead of retrying every mutation');
});

test('concurrent scans deduplicate API requests and stop pagination once visible actors are known', async t => {
  const f = harness(t, avatar('Alice'));
  let resolve;
  f.window.requestJSON = async url => { f.state.requests.push(url); return new Promise(done => { resolve = done; }); };
  f.qa.patchNavigation(); f.qa.patchNavigation(); f.qa.patchNavigation();
  await new Promise(done => setImmediate(done));
  assert.equal(f.state.requests.length, 1);
  resolve({ success: true, notifications: [actor('alice', 'Alice', 'https://cdn.example/Alice.jpg')], nextCursor: 'more' });
  await f.qa.ctNavigationState.pending;
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.links()[0].getAttribute('href'), '/user/alice');
});

test('unresolved avatars use bounded cursor pagination without looping cursors', async t => {
  const f = harness(t, avatar('Alice'));
  f.window.requestJSON = async url => {
    f.state.requests.push(url);
    return { success: true, notifications: [], nextCursor: 'same' };
  };
  await f.patch();
  assert.equal(f.state.requests.length, 2);
  assert.equal(new URL(f.state.requests[1]).searchParams.get('cursor'), 'same');
});

test('account changes and late responses never reuse previous notification identities', async t => {
  const f = harness(t, avatar('Alice'), [actor('alice', 'Alice', 'https://cdn.example/Alice.jpg')]);
  await f.patch();
  assert.equal(f.links()[0].getAttribute('href'), '/user/alice');
  f.state.uid = f.window.ctNetworkState.authUID = 'two';
  f.state.notifications = [];
  await f.patch();
  assert.equal(f.links()[0].hasAttribute('href'), false);
  let resolve;
  f.qa.ctNavigationState.fetchedAt = 0;
  f.window.requestJSON = async () => new Promise(done => { resolve = done; });
  const pending = f.qa.ctLoadNotificationActors();
  await new Promise(done => setImmediate(done));
  f.window.ctNetworkState.authUID = 'three';
  resolve({ success: true, notifications: [actor('wrong', 'Alice', 'https://cdn.example/Alice.jpg')] });
  await pending;
  assert.equal(f.links()[0].hasAttribute('href'), false);
});

test('avatar DOM reuse removes a stale target immediately, and teardown restores native controls', async t => {
  const f = harness(t, avatar('Alice', { handle: 'alice' }));
  await f.patch();
  const overlay = f.document.querySelector('span[role="button"]');
  const image = f.document.querySelector('img');
  overlay.setAttribute('aria-label', 'Follow @bob');
  image.setAttribute('alt', 'Bob avatar'); image.src = 'https://cdn.example/Bob.jpg';
  await f.patch();
  assert.equal(f.links().length, 1);
  assert.equal(f.links()[0].getAttribute('href'), '/user/bob');
  f.qa.destroyNativeNavigation();
  assert.equal(f.links().length, 0);
  assert.equal(f.document.getElementById('ct-native-navigation-style'), null);
  assert.equal(overlay.classList.contains('ct-avatar-follow-hidden'), false);
  assert.equal(overlay.getAttribute('tabindex'), '0');
  assert.equal(overlay.hasAttribute('aria-hidden'), false);
});

test('feed avatars hide follow overlays while retaining their native profile actions', async t => {
  const f = harness(t, avatar('Alice', { handle: 'alice' }));
  f.window.history.replaceState({}, '', '/feed');
  await f.patch();
  assert.equal(f.links().length, 0);
  assert.equal(f.document.querySelector('span[role="button"]').classList.contains('ct-avatar-follow-hidden'), true);
  assert.equal(f.state.requests.length, 0);
});

function profileAvatar(handle, { placeholder = false, overlay = true } = {}) {
  // Current native Uo markup differs from notification avatars: Lr is inside
  // the profile button, while the small follow span is its sibling.
  return `<div class="relative inline-flex shrink-0 isolate" style="width:48px;height:48px">
    <button type="button" class="rounded-full focus:outline-none" aria-label="View @${handle}'s profile">${placeholder
      ? `<div role="img" class="rounded-full border" aria-label="${handle} avatar placeholder"></div>`
      : `<img class="rounded-full border object-cover shrink-0" alt="${handle} avatar" src="https://cdn.example/${handle}.jpg">`}</button>
    ${overlay ? `<span role="button" tabindex="0" aria-disabled="false" aria-label="Follow @${handle}" class="absolute -bottom-0.5 -right-0.5 z-[1] flex items-center justify-center rounded-full" style="width:17px;height:17px"><svg class="lucide lucide-plus"></svg></span>` : ''}
  </div>`;
}

for (const [surface, route, placeholder] of [
  ['feed', '/feed', false], ['post detail', '/post/example', false], ['reply', '/post/example', true]
]) {
  test(`${surface} profile-button avatars hide the plus without changing profile or ordinary Follow actions`, async t => {
    const f = harness(t, '');
    f.window.history.replaceState({}, '', route);
    f.document.querySelector('main').innerHTML = `<article>${profileAvatar('alice', { placeholder })}
      <button id="ordinary-follow" aria-label="Follow @alice">Follow</button></article>`;
    const profile = f.document.querySelector('button.rounded-full');
    const overlay = f.document.querySelector('span[role="button"]');
    const ordinary = f.document.getElementById('ordinary-follow');
    let profileClicks = 0;
    let ordinaryClicks = 0;
    profile.addEventListener('click', () => profileClicks++);
    ordinary.addEventListener('click', () => ordinaryClicks++);
    await f.patch();
    assert.equal(f.window.getComputedStyle(overlay).display, 'none');
    assert.equal(overlay.getAttribute('tabindex'), '-1');
    assert.equal(overlay.getAttribute('aria-hidden'), 'true');
    assert.equal(profile.classList.contains('ct-avatar-follow-hidden'), false);
    assert.equal(ordinary.className, '');
    assert.equal(f.links().length, 0);
    assert.equal(f.state.requests.length, 0);
    f.event(profile.querySelector('img,[role="img"]'));
    f.event(ordinary);
    assert.equal(profileClicks, 1);
    assert.equal(ordinaryClicks, 1);
    f.qa.destroyNativeNavigation();
    assert.equal(overlay.getAttribute('tabindex'), '0');
    assert.equal(overlay.hasAttribute('aria-hidden'), false);
    assert.equal(overlay.classList.contains('ct-avatar-follow-hidden'), false);
  });
}

test('follow overlays mounted after a feed avatar or replaced by React stay hidden', async t => {
  const f = harness(t, '');
  f.window.history.replaceState({}, '', '/feed');
  f.document.querySelector('main').innerHTML = `<article>${profileAvatar('alice', { overlay: false })}</article>`;
  await f.patch();
  const article = f.document.querySelector('article');
  article.innerHTML = profileAvatar('alice');
  await f.patch();
  const first = article.querySelector('span[role="button"]');
  assert.equal(f.window.getComputedStyle(first).display, 'none');
  article.innerHTML = profileAvatar('bob');
  await f.patch();
  const second = article.querySelector('span[role="button"]');
  assert.equal(f.window.getComputedStyle(second).display, 'none');
  assert.equal(f.qa.ctNavigationState.overlays.has(first), false);
  assert.equal(f.qa.ctNavigationState.overlays.size, 1);
});

test('unrelated image controls and editable profile avatars do not qualify as native follow avatars', async t => {
  const f = harness(t, '');
  f.window.history.replaceState({}, '', '/settings');
  f.document.querySelector('main').innerHTML = `<div class="relative inline-flex shrink-0 isolate">
    <button class="rounded-full" aria-label="Edit profile photo"><img class="rounded-full object-cover"></button>
    <span role="button" tabindex="0" aria-label="Follow @alice" class="absolute -bottom-0.5 -right-0.5">Follow</span></div>`;
  await f.patch();
  assert.equal(f.document.querySelector('.ct-avatar-follow-hidden'), null);
  assert.equal(f.document.querySelector('span').getAttribute('tabindex'), '0');
});

test('the native default avatar URL maps to its placeholder while duplicate default identities stay disabled', async t => {
  const defaultURL = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150';
  const f = harness(t, avatar('Alice', { placeholder: true }) + avatar('Shared', { placeholder: true }), [
    actor('alice', 'Alice', defaultURL), actor('bob', 'Shared', defaultURL), actor('carol', 'Shared', null)
  ]);
  await f.patch();
  assert.deepEqual(f.links().map(link => link.getAttribute('href')), ['/user/alice', null]);
});

test('successful unresolved lookups stay cached during repeated mutations and expire after one minute', async t => {
  const f = harness(t, avatar('Alice'));
  await f.patch();
  for (let i = 0; i < 5; i++) await f.patch();
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.authCalls, 1);
  f.qa.ctNavigationState.fetchedAt = Date.now() - 60001;
  await f.patch();
  assert.equal(f.state.requests.length, 2);
});

test('automatic notification pagination stops after twenty pages even with unique cursors', async t => {
  const f = harness(t, avatar('Alice'));
  f.window.requestJSON = async url => {
    f.state.requests.push(url);
    return { success: true, notifications: [], nextCursor: `cursor-${f.state.requests.length}` };
  };
  await f.patch();
  assert.equal(f.state.requests.length, 20);
  assert.equal(f.links()[0].hasAttribute('href'), false);
});

test('missing authentication backs off without making API requests or guessing display-name routes', async t => {
  const f = harness(t, avatar('Alice'));
  let authCalls = 0;
  f.window.getAuth = async () => { authCalls++; return null; };
  await f.patch();
  await f.patch();
  assert.equal(authCalls, 1);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.links()[0].hasAttribute('href'), false);
});

test('teardown cancels late lookup effects and cannot recreate removed links', async t => {
  const f = harness(t, avatar('Alice'));
  let resolve;
  f.window.requestJSON = async () => new Promise(done => { resolve = done; });
  f.qa.patchNavigation();
  const pending = f.qa.ctNavigationState.pending;
  await new Promise(done => setImmediate(done));
  f.qa.destroyNativeNavigation();
  resolve({ success: true, notifications: [actor('alice', 'Alice', 'https://cdn.example/Alice.jpg')] });
  await pending;
  assert.equal(f.links().length, 0);
  assert.equal(f.qa.ctNavigationState.actors.size, 0);
});


test('a reused avatar cannot activate its previous URL before the next scheduled scan', async t => {
  const f = harness(t, avatar('Alice'), [actor('alice', 'Alice', 'https://cdn.example/Alice.jpg')]);
  await f.patch();
  const image = f.document.querySelector('img');
  image.setAttribute('alt', 'Unknown avatar');
  image.src = 'https://cdn.example/Unknown.jpg';
  const event = f.event(f.links()[0]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.links()[0].hasAttribute('href'), false);
  assert.equal(f.state.rowClicks, 0);
  await f.qa.ctNavigationState.pending;
});

test('an actor older than the first eighty notifications is resolved automatically', async t => {
  const f = harness(t, avatar('Kevin'));
  f.window.requestJSON = async url => {
    f.state.requests.push(url);
    const page = f.state.requests.length;
    return { success: true, notifications: page === 6 ? [actor('kevin', 'Kevin', 'https://cdn.example/Kevin.jpg')] : [], nextCursor: `cursor-${page}` };
  };
  await f.patch();
  assert.equal(f.state.requests.length, 6);
  assert.equal(f.links()[0].getAttribute('href'), '/user/kevin');
});

test('newly displayed older actors continue the retained cursor while the head is cached', async t => {
  const f = harness(t, avatar('Alice'));
  f.window.requestJSON = async url => {
    f.state.requests.push(url);
    const cursor = new URL(url).searchParams.get('cursor');
    return { success: true, notifications: [cursor ? actor('kevin', 'Kevin', 'https://cdn.example/Kevin.jpg') : actor('alice', 'Alice', 'https://cdn.example/Alice.jpg')], nextCursor: cursor ? null : 'older' };
  };
  await f.patch();
  f.document.getElementById('preview').insertAdjacentHTML('beforebegin', avatar('Kevin'));
  await f.patch();
  assert.equal(f.state.requests.length, 2);
  assert.equal(new URL(f.state.requests[1]).searchParams.get('cursor'), 'older');
  assert.deepEqual(f.links().map(link => link.getAttribute('href')), ['/user/alice', '/user/kevin']);
});

test('stable unresolved actors refresh only the head after a minute instead of repeating twenty pages', async t => {
  const f = harness(t, avatar('Missing'));
  f.window.requestJSON = async url => {
    f.state.requests.push(url);
    return { success: true, notifications: [], nextCursor: `cursor-${f.state.requests.length}` };
  };
  await f.patch();
  assert.equal(f.state.requests.length, 20);
  const retainedCursor = f.qa.ctNavigationState.nextCursor;
  f.qa.ctNavigationState.fetchedAt = Date.now() - 60001;
  await f.patch();
  assert.equal(f.state.requests.length, 21);
  assert.equal(new URL(f.state.requests[20]).searchParams.has('cursor'), false);
  assert.equal(f.qa.ctNavigationState.nextCursor, retainedCursor);
  await f.patch();
  assert.equal(f.state.requests.length, 21);
});

test('explicit retry continues older pages past the automatic budget without refetching the beginning', async t => {
  const f = harness(t, avatar('Kevin'));
  f.window.requestJSON = async url => {
    f.state.requests.push(url);
    return { success: true, notifications: f.state.requests.length === 21 ? [actor('kevin', 'Kevin', 'https://cdn.example/Kevin.jpg')] : [], nextCursor: `cursor-${f.state.requests.length}` };
  };
  await f.patch();
  assert.equal(f.state.requests.length, 20);
  assert.equal(f.links()[0].hasAttribute('href'), false);
  f.event(f.links()[0]);
  await f.qa.ctNavigationState.pending;
  assert.equal(f.state.requests.length, 21);
  assert.equal(new URL(f.state.requests[20]).searchParams.get('cursor'), 'cursor-20');
  assert.equal(f.links()[0].getAttribute('href'), '/user/kevin');
});


test('context menus refresh a recycled avatar target before offering Open in new tab', async t => {
  const f = harness(t, avatar('Alice', { handle: 'alice' }));
  await f.patch();
  const overlay = f.document.querySelector('span[role="button"]');
  const image = f.document.querySelector('img');
  overlay.setAttribute('aria-label', 'Follow @bob');
  image.setAttribute('alt', 'Bob avatar');
  image.src = 'https://cdn.example/Bob.jpg';
  const event = f.event(f.links()[0], 'contextmenu');
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.links()[0].getAttribute('href'), '/user/bob');
  assert.equal(f.state.rowClicks, 0);
  overlay.remove();
  image.setAttribute('alt', 'Unknown avatar');
  assert.equal(f.event(f.links()[0], 'contextmenu').defaultPrevented, true);
  assert.equal(f.links()[0].hasAttribute('href'), false);
});
