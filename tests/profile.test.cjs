const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/profile.js'), 'utf8');
function client(user = 'viewer', labels = ['Tweets', 'Replies', 'Reposts']) {
  return `<div class="overflow-hidden"><img src="https://images.example/cover.jpg" alt="Cover"></div><div><div class="mt-3 flex flex-col gap-1"><h2 class="font-extrabold"><span>${user}</span></h2><p class="text-tl-app-text-muted">@${user}</p></div><p class="mt-3 text-tl-app-text leading-relaxed">Profile bio</p></div>
    <div role="tablist" class="flex border-b border-tl-app-border">${labels.map((label, index) => `<button type="button" role="tab" aria-label="${label}" aria-selected="${index === 0}"><span><svg></svg>${index === 0 ? '<span class="native-underline"></span>' : ''}</span></button>`).join('')}</div>
    <div id="native-timeline"><article><p>Untouched native post</p><button id="native-like">Favorite</button></article></div>`;
}
function post(id, media = [{ media_type: 'image', public_url: 'https://images.example/' + id + '.jpg' }], changes = {}) {
  return { id, authorUsername: 'viewer', authorName: 'Viewer', authorAvatar: 'https://images.example/avatar.jpg',
    text: 'User text <script> News Edited Like', createdAt: '2026-09-30T00:00:00Z', media_assets: media, ...changes };
}
function harness(t, options = {}) {
  const dom = new JSDOM(`<head></head><body><main>${options.html || `<div class="animate-fadeIn">${client(options.user || 'viewer', options.labels)}</div>`}</main></body>`, {
    url: 'https://app.tweet.app' + (options.route || '/profile'), runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom; t.after(() => window.close());
  let auth = { uid: 'uid-viewer', token: 'token-viewer' }; let accountUser = 'viewer'; let pages = [{ posts: [], nextCursor: null }]; let userReplies = [];
  let mutedPages = [{ success: true, users: [], nextCursor: null }];
  let override = null; const calls = [];
  window.ctNetworkState = { authUID: auth.uid };
  window.getAuth = async () => { window.ctNetworkState.authUID = auth?.uid || null; return auth; };
  window.requestJSON = async (url, headers) => {
    const endpoint = new URL(url); calls.push(endpoint.pathname + endpoint.search);
    assert.equal(endpoint.origin, 'https://api.tweet.app'); assert.match(headers.Authorization, /^Bearer /);
    if (override) { const result = await override(endpoint); if (result !== undefined) return result; }
    if (endpoint.pathname === '/api/users/muted') {
      assert.equal(endpoint.searchParams.has('limit'), false);
      return mutedPages[Number(endpoint.searchParams.get('cursor') || 0)] ?? null;
    }
    if (endpoint.pathname.startsWith('/api/user-profile/')) return { profile: { username: accountUser } };
    if (endpoint.pathname.endsWith('/replies')) return { replies: userReplies };
    assert.match(endpoint.pathname, /^\/api\/users\/[A-Za-z0-9_.-]+\/posts$/);
    assert.equal(endpoint.searchParams.get('limit'), '24');
    return pages[Number(endpoint.searchParams.get('cursor') || 0)] || { posts: [], nextCursor: null };
  };
  window.eval(`const CT_LOCALE='${options.locale || 'en'}'; const KEY={favorites:'legacy.favorites'}; const API_ORIGIN='https://api.tweet.app'; let favoritesActive=false; let ctPageActive=true; ${source}
    window.profile={patch:patchFavoriteProfileTab, close:closeFavoritesPanel, render:renderFavoritesPanel, media:ctProfileLoadMedia, mutes:ctProfileLoadFavoriteMutes, state:ctProfileState,
    save:ctProfileSaveFavorite, remove:ctProfileRemoveFavorite, remember:ctProfileRememberLikedPosts, load:ctProfileLoadFavorites, import:ctProfileImportFavorites, assets:ctProfileMediaAssets,
    context:ctProfileContext, viewerClose:ctProfileCloseViewer, setActive:value=>{ctPageActive=value;}};`);
  return { window, document: window.document, api: window.profile, calls,
    pages: value => { pages = value; }, replies: value => { userReplies = value; }, muted: value => { mutedPages = value; }, override: value => { override = value; },
    setAuth: (value, user = 'other') => { auth = value; accountUser = user; window.ctNetworkState.authUID = auth?.uid || null; },
    route: (route, user) => { window.history.replaceState({}, '', route); window.document.querySelector('main').innerHTML = `<div class="animate-fadeIn">${client(user)}</div>`; },
    async ready() { this.api.patch(); await new Promise(resolve => setTimeout(resolve, 0)); this.api.patch(); },
    async select(type) { this.document.getElementById('ct-' + type + '-tab').click(); await new Promise(resolve => setTimeout(resolve, 0)); }
  };
}
function item(id, changes = {}) { return { id, username: 'alice', name: 'Alice', text: 'Untouched <script> Edited', href: 'https://malicious.example', ...changes }; }

test('icon-only native profile tabs gain Media and account-only Favorites in normal document flow', async t => {
  const h = harness(t); await h.ready();
  assert.equal(h.document.querySelectorAll('[role=tab]').length, 5);
  assert.equal(h.document.getElementById('ct-media-tab').getAttribute('aria-label'), 'Media');
  assert.equal(h.document.getElementById('ct-favorites-tab').getAttribute('aria-label'), 'Favorites');
  h.api.save(item('favorite')); await h.select('favorites');
  const panel = h.document.getElementById('ct-favorites-panel');
  assert.equal(panel.previousElementSibling.getAttribute('role'), 'tablist');
  assert.equal(panel.nextElementSibling.id, 'native-timeline');
  assert.equal(panel.getAttribute('role'), 'tabpanel');
  assert.equal(panel.getAttribute('aria-labelledby'), 'ct-favorites-tab');
  assert.equal(h.document.getElementById('native-timeline').hasAttribute('data-ct-profile-timeline-hidden'), true);
  assert.equal(h.document.querySelectorAll('[role=tab][aria-selected=true]').length, 1);
  assert.equal(panel.querySelector('.ct-profile-post-link').getAttribute('href'), 'https://app.tweet.app/post/favorite');
  assert.equal(panel.querySelector('script'), null);
  assert.match(panel.textContent, /Untouched <script> Edited/);
});

test('native tab clicks restore the same native timeline, state, post content and event handlers', async t => {
  const h = harness(t); await h.ready(); const native = h.document.getElementById('native-timeline'); const html = native.innerHTML;
  let clicks = 0; h.document.getElementById('native-like').addEventListener('click', () => clicks++);
  const tabs = [...h.document.querySelectorAll('[role=tab]')].slice(0, 3);
  tabs[1].addEventListener('click', () => { tabs[0].setAttribute('aria-selected', 'false'); tabs[1].setAttribute('aria-selected', 'true'); });
  await h.select('favorites'); tabs[1].click();
  assert.equal(h.document.getElementById('native-timeline'), native);
  assert.equal(native.hasAttribute('data-ct-profile-timeline-hidden'), false);
  assert.equal(native.innerHTML, html); assert.equal(h.document.getElementById('ct-favorites-panel'), null);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true'); h.document.getElementById('native-like').click(); assert.equal(clicks, 1);
  assert.equal(h.api.state.active, '');
});

test('Japanese labels and hidden retained feed subtrees select only the visible profile tabs', async t => {
  const h = harness(t, { locale: 'ja', html: `<div hidden aria-hidden="true">${client('wrong')}</div><div>${client('viewer', ['ツイート', 'リプライ', 'リツイート'])}</div>` });
  await h.ready();
  assert.equal(h.document.querySelector('[hidden] #ct-media-tab'), null);
  assert.equal(h.document.getElementById('ct-media-tab').getAttribute('aria-label'), '写真・動画');
  assert.equal(h.document.getElementById('ct-favorites-tab').textContent, 'お気に入り');
  assert.equal(h.api.state.user, 'viewer');
});

test('unknown tab structures, ambiguous handles and route/header mismatches fail open', async t => {
  const variants = [client('viewer', ['Future Posts', 'Replies', 'Reposts']), client('viewer').replace('<p class="text-tl-app-text-muted">@viewer</p>', '<p class="text-tl-app-text-muted">@viewer</p><p class="text-tl-app-text-muted">@other</p>'), client('viewer').replace('id="native-timeline"', 'role="form" id="native-timeline"')];
  for (const html of variants) {
    const h = harness(t, { html: `<div>${html}</div>` }); const before = h.document.querySelector('main').innerHTML;
    await h.ready(); assert.equal(h.document.querySelector('main').innerHTML, before); assert.equal(h.calls.length, 0);
  }
  const h = harness(t, { route: '/user/other', user: 'viewer' }); await h.ready(); assert.equal(h.document.getElementById('ct-media-tab'), null);
});

test('Media on another profile never exposes the current account’s Favorites', async t => {
  const h = harness(t, { route: '/user/alice', user: 'alice' }); await h.ready(); h.api.save(item('mine'));
  assert.ok(h.document.getElementById('ct-media-tab')); assert.equal(h.document.getElementById('ct-favorites-tab'), null);
  h.pages([{ posts: [post('alice-photo', undefined, { authorUsername: 'alice' })], nextCursor: null }]); await h.select('media');
  assert.ok(h.calls.includes('/api/users/alice/posts?limit=24'));
  assert.match(h.document.getElementById('ct-media-panel').textContent, /alice/);
  assert.equal(h.document.querySelector('[data-ct-profile-post=mine]'), null);
});

test('Media uses bounded read-only cursor pages, all original image assets, videos and lazy playback', async t => {
  const h = harness(t); await h.ready();
  const images = Array.from({ length: 4 }, (_, index) => ({ media_type: 'image', public_url: 'https://images.example/' + index + '.jpg' }));
  h.pages([{ posts: [post('photos', images), post('movie', [{ media_type: 'video', public_url: 'https://media.example/movie.mp4', thumbnail_url: 'https://images.example/movie.jpg' }]), post('text', [])], nextCursor: '1' }, { posts: [post('older')], nextCursor: null }]);
  await h.select('media');
  assert.equal(h.document.querySelectorAll('[data-ct-profile-post=photos] .ct-profile-photo img').length, 4);
  assert.match(h.document.querySelector('[data-ct-profile-post=photos]').textContent, /4 photos/);
  const video = h.document.querySelector('video'); assert.equal(video.controls, true); assert.equal(video.autoplay, false); assert.equal(video.preload, 'none'); assert.equal(video.playsInline, true);
  assert.equal(video.poster, 'https://images.example/movie.jpg');
  assert.equal(h.document.querySelectorAll('[data-ct-profile-post]').length, 2);
  await h.api.media(); assert.ok(h.calls.includes('/api/users/viewer/posts?limit=24&cursor=1'));
  assert.equal(h.document.querySelectorAll('[data-ct-profile-post]').length, 3);
  const count = h.calls.length; await h.api.media(); assert.equal(h.calls.length, count);
});

test('bad URLs, deleted/reposted/foreign posts are rejected and user text is never interpreted as HTML', async t => {
  const h = harness(t); await h.ready();
  h.pages([{ posts: [post('bad-url', [{ media_type: 'image', public_url: 'javascript:alert(1)' }]), post('bad-credentials', [{ media_type: 'video', public_url: 'https://u:p@example.test/video' }]), post('foreign', undefined, { authorUsername: 'bob' }), post('deleted', undefined, { isDeleted: true }), post('muted', undefined, { status: 'MUTED' }), post('repost', undefined, { originalPostId: 'original' }), post('own')], nextCursor: null }]);
  await h.select('media');
  assert.deepEqual([...h.document.querySelectorAll('[data-ct-profile-post]')].map(el => el.dataset.ctProfilePost), ['own']);
  assert.equal(h.document.querySelector('#ct-media-panel script'), null);
  assert.equal(h.document.querySelector('.ct-profile-text').textContent, 'User text <script> News Edited Like');
});

test('empty pages with a next cursor keep an older-post control rather than claiming there is no media', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('text', [])], nextCursor: '1' }, { posts: [post('later')], nextCursor: null }]);
  await h.select('media'); assert.match(h.document.getElementById('ct-media-panel').textContent, /checked so far/);
  await h.api.media(); assert.ok(h.document.querySelector('[data-ct-profile-post=later]'));
});

test('failed Media pages retain existing results and cursor for an explicit retry', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('first')], nextCursor: '1' }, null]); h.override(endpoint => endpoint.searchParams.get('cursor') === '1' ? null : undefined);
  await h.select('media'); await h.api.media();
  assert.equal(h.api.state.media.cursor, '1'); assert.ok(h.document.querySelector('[data-ct-profile-post=first]'));
  assert.match(h.document.getElementById('ct-media-panel').textContent, /could not be loaded/);
  h.override(null); h.pages([{ posts: [post('first')], nextCursor: '1' }, { posts: [post('second')], nextCursor: null }]); await h.api.media();
  assert.equal(h.api.state.media.items.length, 2); assert.equal(h.api.state.media.error, '');
});

test('route and account changes discard late Media results and restore native content', async t => {
  const h = harness(t); await h.ready(); let release;
  h.override(endpoint => endpoint.pathname.endsWith('/posts') ? new Promise(resolve => { release = resolve; }) : undefined);
  h.document.getElementById('ct-media-tab').click(); await new Promise(resolve => setTimeout(resolve, 0));
  h.route('/user/alice', 'alice'); h.api.patch(); release({ posts: [post('old-account-media')], nextCursor: null }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.document.querySelector('[data-ct-profile-post=old-account-media]'), null);
  assert.equal(h.document.getElementById('native-timeline').hasAttribute('data-ct-profile-timeline-hidden'), false);
  h.route('/profile', 'other'); h.setAuth({ uid: 'uid-other', token: 'token-other' }); await h.ready();
  assert.equal(h.api.state.media, null); assert.equal(h.api.load().length, 0);
});

test('account-scoped local Favorites reject delayed saves/removals for another account', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('mine'), 'uid-viewer');
  assert.equal(h.api.load().length, 1); h.setAuth({ uid: 'uid-other', token: 'token-other' });
  assert.equal(h.api.save(item('late'), 'uid-viewer'), false); assert.equal(h.api.remove('mine', 'uid-viewer'), false);
  assert.equal(h.api.load().length, 0); h.api.save(item('other'), 'uid-other');
  h.setAuth({ uid: 'uid-viewer', token: 'token-viewer' }, 'viewer'); assert.equal(JSON.stringify(h.api.load().map(row => row.id)), JSON.stringify(['mine']));
});

test('legacy Favorites stay intact until explicitly imported and cannot be imported by another account', async t => {
  const h = harness(t); await h.ready(); h.window.localStorage.setItem('legacy.favorites', JSON.stringify([item('legacy')]));
  assert.equal(h.api.load().length, 0); await h.select('favorites'); assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Import older saved data/);
  h.api.import(); assert.equal(h.api.load()[0].id, 'legacy'); assert.ok(h.window.localStorage.getItem('legacy.favorites'));
  assert.equal(h.window.localStorage.getItem('legacy.favorites:owner'), 'uid-viewer');
  h.setAuth({ uid: 'uid-other', token: 'token-other' }); h.api.import(); assert.equal(h.api.load().length, 0);
});

test('storage failure keeps this account’s unsaved snapshots in memory and displays an honest status', async t => {
  const h = harness(t); await h.ready(); const proto = Object.getPrototypeOf(h.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('Quota'); }; t.after(() => { proto.setItem = original; });
  h.api.save(item('memory')); assert.equal(h.api.load()[0].id, 'memory'); await h.select('favorites');
  assert.match(h.document.getElementById('ct-favorites-panel').textContent, /storage is unavailable/);
  h.setAuth({ uid: 'uid-other', token: 'token-other' }); assert.equal(h.api.load().length, 0);
});

test('profile refresh scans are idempotent and preserve focus without rebuilding Favorites rows', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('saved')); await h.select('favorites');
  const link = h.document.querySelector('.ct-profile-post-link'); link.focus(); const panel = h.document.getElementById('ct-favorites-panel');
  const observer = new h.window.MutationObserver(() => {}); observer.observe(h.document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  h.api.patch(); h.api.render(); assert.deepEqual(observer.takeRecords(), []); observer.disconnect();
  assert.equal(h.document.activeElement, link); assert.equal(h.document.getElementById('ct-favorites-panel'), panel);
});

test('React timeline replacement is recognized and only the new verified sibling is hidden', async t => {
  const h = harness(t); await h.ready(); await h.select('favorites'); const old = h.document.getElementById('native-timeline');
  const next = h.document.createElement('div'); next.id = 'new-timeline'; next.textContent = 'New native timeline'; old.replaceWith(next); h.api.patch();
  assert.equal(old.hasAttribute('data-ct-profile-timeline-hidden'), false); assert.equal(next.hasAttribute('data-ct-profile-timeline-hidden'), true);
  h.api.close(); assert.equal(next.hasAttribute('data-ct-profile-timeline-hidden'), false);
});

function nativeReplyEditor(document) {
  const wrapper = document.createElement('div'); wrapper.className = 'relative';
  const textarea = document.createElement('textarea');
  for (const [key, value] of Object.entries({ name: 'compose-text', maxlength: '280', inputmode: 'text', rows: '1', autocomplete: 'off', 'data-form-type': 'other' })) textarea.setAttribute(key, value);
  textarea.className = 'relative z-[1] bg-transparent whitespace-pre-wrap break-words [overflow-wrap:anywhere] w-full resize-none text-[0.9375rem] leading-5 text-tl-app-text placeholder:text-tl-app-text-muted outline-none py-1.5';
  textarea.placeholder = 'Post your reply'; wrapper.append(textarea); return { wrapper, textarea };
}

test('native inline reply drafts keep profile tabs available and survive Media and Favorites tab switches', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('saved'));
  const timeline = h.document.getElementById('native-timeline'); const article = timeline.querySelector('article');
  article.querySelector('button').setAttribute('data-testid', 'tweet-like-action');
  const { wrapper, textarea } = nativeReplyEditor(h.document); article.append(wrapper);
  textarea.value = 'Unsaved reply Home Like Edited'; textarea.setSelectionRange(8, 13);
  let inputEvents = 0; textarea.addEventListener('input', () => inputEvents++);
  h.api.patch(); assert.ok(h.document.getElementById('ct-media-tab')); assert.ok(h.document.getElementById('ct-favorites-tab'));
  await h.select('media'); assert.equal(timeline.hasAttribute('data-ct-profile-timeline-hidden'), true);
  await h.select('favorites'); assert.equal(h.document.querySelector('textarea'), textarea);
  h.document.querySelector('[role=tab][aria-label=Replies]').click();
  assert.equal(timeline.hasAttribute('data-ct-profile-timeline-hidden'), false);
  assert.equal(h.document.querySelector('textarea'), textarea); assert.equal(textarea.value, 'Unsaved reply Home Like Edited');
  assert.equal(textarea.selectionStart, 8); assert.equal(textarea.selectionEnd, 13);
  textarea.dispatchEvent(new h.window.Event('input', { bubbles: true })); assert.equal(inputEvents, 1);
});

test('unknown inputs, forms and unverified reply editors still leave the native timeline visible', async t => {
  const variants = [
    (h, article) => { const input = h.document.createElement('input'); article.append(input); },
    (h, article) => { article.append(h.document.createElement('form')); },
    (h, article) => { const form = h.document.createElement('div'); form.setAttribute('role', 'form'); article.append(form); },
    (h, article) => { const { wrapper, textarea } = nativeReplyEditor(h.document); textarea.name = 'unverified'; article.append(wrapper); },
    (h, article) => { const { wrapper } = nativeReplyEditor(h.document); h.document.getElementById('native-timeline').append(wrapper); },
    (h, article) => { const { wrapper } = nativeReplyEditor(h.document); article.append(wrapper); article.querySelector('button').removeAttribute('data-testid'); }
  ];
  for (const add of variants) {
    const h = harness(t); await h.ready(); const timeline = h.document.getElementById('native-timeline'); const article = timeline.querySelector('article');
    article.querySelector('button').setAttribute('data-testid', 'tweet-like-action'); add(h, article); h.api.patch();
    assert.equal(h.document.getElementById('ct-media-tab'), null); assert.equal(h.document.getElementById('ct-favorites-tab'), null);
    assert.equal(timeline.hasAttribute('data-ct-profile-timeline-hidden'), false);
  }
});

test('hidden pages and page-inactive state pause Media requests while native controls stay available', async t => {
  const h = harness(t); await h.ready(); h.document.getElementById('ct-media-tab').click(); await new Promise(resolve => setTimeout(resolve, 0));
  h.calls.length = 0; Object.defineProperty(h.document, 'hidden', { configurable: true, value: true }); await h.api.media(true); assert.equal(h.calls.length, 0);
  Object.defineProperty(h.document, 'hidden', { configurable: true, value: false }); h.api.setActive(false); await h.api.media(true); assert.equal(h.calls.length, 0);
  assert.ok(h.document.querySelector('button[role=tab][aria-label=Tweets]'));
});


test('failed Refresh on completed history can retry from the first page without losing prior results', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('before')], nextCursor: null }]); await h.select('media');
  h.override(endpoint => endpoint.pathname.endsWith('/posts') ? null : undefined); await h.api.media(true);
  assert.ok(h.document.querySelector('[data-ct-profile-post=before]')); assert.equal(h.api.state.media.done, true);
  assert.equal(h.api.state.mediaCache.has('uid-viewer:viewer'), false);
  assert.equal(h.api.state.media.retryRefresh, true); const calls = h.calls.length;
  h.override(null); h.pages([{ posts: [post('after')], nextCursor: null }]); await h.api.media();
  assert.ok(h.calls.length > calls); assert.equal(h.document.querySelector('[data-ct-profile-post=before]'), null);
  assert.ok(h.document.querySelector('[data-ct-profile-post=after]')); assert.equal(h.api.state.media.scanned, 1);
});

test('saved Favorite timestamps are preserved and profile tab arrow keys move focus without native activation', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('dated', { createdAt: '2026-09-30T00:00:00Z' })); await h.select('favorites');
  assert.equal(h.document.querySelector('time').dateTime, '2026-09-30T00:00:00Z');
  const tabs = [...h.document.querySelectorAll('[role=tab]')]; tabs[0].focus();
  tabs[0].dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  assert.equal(h.document.activeElement, tabs[4]); assert.equal(h.api.state.active, 'favorites');
  tabs[4].dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(h.document.activeElement, tabs[0]); assert.equal(h.api.state.active, 'favorites');
});


test('own-profile handle edits with the same uid revalidate identity and restore the Favorites tab', async t => {
  const h = harness(t); await h.ready();
  h.window.Date.now = () => Date.now() + 10001;
  h.route('/profile', 'renamed'); h.setAuth({ uid: 'uid-viewer', token: 'token-viewer' }, 'renamed'); await h.ready();
  assert.equal(h.api.state.accountUser, 'renamed'); assert.ok(h.document.getElementById('ct-favorites-tab'));
  assert.equal(h.calls.filter(url => url === '/api/user-profile/uid-viewer').length, 2);
});

test('a server returning more than the requested page size does not silently drop photos', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: Array.from({ length: 25 }, (_, i) => post('photo' + i)), nextCursor: null }]);
  await h.select('media'); assert.equal(h.api.state.media.items.length, 25); assert.equal(h.api.state.media.scanned, 25);
});


test('profile display names and bios that look like handles cannot disable verified profile tabs', async t => {
  const html = client('viewer').replace('<span>viewer</span>', '<span>@name</span>').replace('Profile bio', '@bio');
  const h = harness(t, { html: `<div>${html}</div>` }); await h.ready();
  assert.equal(h.api.state.user, 'viewer'); assert.ok(h.document.getElementById('ct-media-tab')); assert.ok(h.document.getElementById('ct-favorites-tab'));
  assert.equal(h.document.querySelector('h2').textContent, '@name');
});

test('a newly authenticated account clears the prior signed-out identity backoff immediately', async t => {
  const h = harness(t); await h.ready(); h.setAuth(null); await h.ready();
  assert.equal(h.document.getElementById('ct-favorites-tab'), null); assert.ok(h.api.state.identityRetry > Date.now());
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready();
  assert.equal(h.api.state.accountUser, 'other'); assert.ok(h.document.getElementById('ct-favorites-tab'));
});

test('returning to Media while a cancelled first page finishes retries sequentially with current identity', async t => {
  const h = harness(t); await h.ready(); let release; let requested = 0;
  h.override(endpoint => {
    if (!endpoint.pathname.endsWith('/posts')) return undefined;
    requested++;
    return requested === 1 ? new Promise(resolve => { release = resolve; }) : { posts: [post('current')], nextCursor: null };
  });
  h.document.getElementById('ct-media-tab').click(); await new Promise(resolve => setTimeout(resolve, 0));
  h.document.getElementById('ct-favorites-tab').click(); h.document.getElementById('ct-media-tab').click();
  assert.equal(requested, 1); release({ posts: [post('discarded')], nextCursor: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requested, 2); assert.equal(h.document.querySelector('[data-ct-profile-post=discarded]'), null);
  assert.ok(h.document.querySelector('[data-ct-profile-post=current]')); assert.equal(h.api.state.media.busy, false);
});

test('expanded photos show original sources, keyboard and button navigation, and restore trigger focus', async t => {
  const h = harness(t); await h.ready();
  h.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  h.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  h.pages([{ posts: [post('photos', [{ media_type: 'image', public_url: 'https://images.example/original-one.jpg' }, { media_type: 'image', public_url: 'https://images.example/original-two.jpg' }])], nextCursor: null }]);
  await h.select('media'); const trigger = h.document.querySelector('.ct-profile-photo'); trigger.click();
  const dialog = h.document.querySelector('dialog'); assert.ok(dialog.hasAttribute('open'));
  assert.equal(dialog.querySelector('img').src, 'https://images.example/original-one.jpg');
  dialog.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(dialog.querySelector('img').src, 'https://images.example/original-two.jpg');
  assert.equal(dialog.querySelector('[aria-label="Next photo"]').disabled, true);
  dialog.querySelector('[aria-label="Close"]').click(); assert.equal(h.document.querySelector('dialog'), null);
  assert.equal(h.document.activeElement, trigger);
});


test('Media includes all media assets of own reply wrappers and rejects parent-post media and foreign replies', async t => {
  const h = harness(t); await h.ready();
  h.pages([{ posts: [post('tweet')], nextCursor: null }]);
  h.replies([{ post: post('reply-photo', [{ media_type: 'image', public_url: 'https://images.example/reply-one.jpg' }, { media_type: 'image', public_url: 'https://images.example/reply-two.jpg' }], { parentId: 'parent' }), parentPost: post('parent', undefined, { authorUsername: 'someone' }) },
    { post: post('foreign-reply', undefined, { authorUsername: 'someone' }) }, { post: post('reply-video', [{ media_type: 'video', public_url: 'https://media.example/reply.mp4' }], { parentId: 'parent' }) }]);
  await h.select('media'); assert.ok(h.calls.includes('/api/users/viewer/replies'));
  assert.equal(h.document.querySelectorAll('[data-ct-profile-post=reply-photo] img').length, 3);
  assert.ok(h.document.querySelector('[data-ct-profile-post=reply-video] video'));
  assert.equal(h.document.querySelector('[data-ct-profile-post=parent]'), null); assert.equal(h.document.querySelector('[data-ct-profile-post=foreign-reply]'), null);
  assert.match(h.document.getElementById('ct-media-panel').textContent, /1 posts and 2 replies checked/);
});

test('reply media failure preserves successful Tweets and manual retry rechecks only the failed replies', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('tweet')], nextCursor: null }]);
  h.override(endpoint => endpoint.pathname.endsWith('/replies') ? null : undefined); await h.select('media');
  assert.ok(h.document.querySelector('[data-ct-profile-post=tweet]')); assert.match(h.document.getElementById('ct-media-panel').textContent, /Reply photos and videos could not be loaded/);
  const postCalls = h.calls.filter(url => url.includes('/posts?')).length;
  h.override(null); h.replies([{ post: post('reply', undefined, { parentId: 'parent' }) }]); await h.api.media();
  assert.equal(h.calls.filter(url => url.includes('/posts?')).length, postCalls);
  assert.ok(h.document.querySelector('[data-ct-profile-post=reply]')); assert.equal(h.api.state.media.error, '');
});

test('reply media is checked once, refreshed explicitly, and capped at the latest 100 own reply wrappers', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('tweet')], nextCursor: '1' }, { posts: [], nextCursor: null }]);
  h.replies(Array.from({ length: 105 }, (_, index) => ({ post: post('reply' + index, undefined, { createdAt: new Date(Date.parse('2026-09-30T00:00:00Z') + index * 1000).toISOString(), parentId: 'parent' }) })));
  await h.select('media'); assert.equal(h.api.state.media.replyScanned, 100); assert.equal(h.api.state.media.replyLimited, true);
  assert.equal(h.document.querySelector('[data-ct-profile-post=reply0]'), null); assert.ok(h.document.querySelector('[data-ct-profile-post=reply104]'));
  await h.api.media(); assert.equal(h.calls.filter(url => url.endsWith('/replies')).length, 1);
  await h.api.media(true); assert.equal(h.calls.filter(url => url.endsWith('/replies')).length, 2);
});

test('ready Tweet media is displayed while replies are pending and keeps existing images, videos and focus', async t => {
  const h = harness(t); await h.ready(); let release;
  h.pages([{ posts: [post('ready-photo'), post('ready-video', [{ media_type: 'video', public_url: 'https://media.example/ready.mp4' }])], nextCursor: null }]);
  h.override(endpoint => endpoint.pathname.endsWith('/replies') ? new Promise(resolve => { release = resolve; }) : undefined);
  await h.select('media');
  const row = h.document.querySelector('[data-ct-profile-post=ready-photo]');
  const image = row.querySelector('img'); const gallery = row.querySelector('.ct-profile-gallery');
  gallery.scrollLeft = 47;
  const video = h.document.querySelector('video'); video.currentTime = 12;
  const link = row.querySelector('.ct-profile-post-link'); link.focus();
  const removedRows = [];
  const observer = new h.window.MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) if (node.matches?.('.ct-profile-row')) removedRows.push(node);
  });
  observer.observe(h.document.getElementById('ct-media-panel'), { childList: true });
  assert.equal(h.api.state.media.busy, true); assert.equal(h.api.state.media.repliesChecked, false);
  release({ replies: [{ post: post('later-reply', undefined, { parentId: 'parent' }) }] }); await tick();
  assert.ok(h.document.querySelector('[data-ct-profile-post=later-reply]'));
  assert.equal(h.document.querySelector('[data-ct-profile-post=ready-photo]'), row);
  assert.equal(row.querySelector('img'), image); assert.equal(gallery.scrollLeft, 47);
  assert.equal(h.document.querySelector('video'), video); assert.equal(video.currentTime, 12);
  observer.disconnect(); assert.deepEqual(removedRows, []);
  assert.equal(h.document.activeElement, link); assert.equal(h.api.state.media.busy, false);
});

test('ready reply media is displayed before slow Tweets and failed Tweets remain retryable', async t => {
  const h = harness(t); await h.ready(); let release;
  h.replies([{ post: post('ready-reply', undefined, { parentId: 'parent' }) }]);
  h.override(endpoint => endpoint.pathname.endsWith('/posts') ? new Promise(resolve => { release = resolve; }) : undefined);
  await h.select('media');
  const row = h.document.querySelector('[data-ct-profile-post=ready-reply]');
  assert.ok(row); assert.equal(h.api.state.media.busy, true);
  release(null); await tick();
  assert.equal(h.document.querySelector('[data-ct-profile-post=ready-reply]'), row);
  assert.match(h.api.state.media.error, /Tweet photos and videos could not be loaded/);
  h.override(null); h.pages([{ posts: [post('retried-photo')], nextCursor: null }]); await h.api.media();
  assert.ok(h.document.querySelector('[data-ct-profile-post=retried-photo]')); assert.equal(h.api.state.media.error, '');
});

test('a rejected replies request does not discard ready photos or prevent a later retry', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('kept-photo')], nextCursor: null }]);
  h.override(endpoint => endpoint.pathname.endsWith('/replies') ? Promise.reject(new Error('network')) : undefined);
  await h.select('media'); assert.ok(h.document.querySelector('[data-ct-profile-post=kept-photo]'));
  assert.match(h.api.state.media.error, /Reply photos and videos/); const posts = h.calls.filter(url => url.includes('/posts?')).length;
  h.override(null); h.replies([{ post: post('retried-reply', undefined, { parentId: 'parent' }) }]); await h.api.media();
  assert.ok(h.document.querySelector('[data-ct-profile-post=retried-reply]')); assert.equal(h.api.state.media.error, '');
  assert.equal(h.calls.filter(url => url.includes('/posts?')).length, posts);
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const mutedUser = username => ({ userId: 'uid-' + username.toLowerCase(), username, displayName: username, avatarUrl: 'https://images.example/avatar.jpg' });
function favoriteRows(h) { return [...h.document.querySelectorAll('#ct-favorites-panel [data-ct-profile-post]')].map(row => row.dataset.ctProfilePost); }
function favoriteControl(h, label) { return [...h.document.querySelectorAll('#ct-favorites-panel button')].find(button => button.textContent === label); }

test('Favorites wait for native mute checking without showing snapshots and retain hidden saved data', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('muted', { username: 'ALICE' })); h.api.save(item('visible', { username: 'bob' })); h.api.save(item('unknown', { username: '' }));
  const before = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'); let release;
  h.override(endpoint => endpoint.pathname === '/api/users/muted' ? new Promise(resolve => { release = resolve; }) : undefined);
  h.document.getElementById('ct-favorites-tab').click();
  assert.deepEqual(favoriteRows(h), []); await tick();
  assert.deepEqual(favoriteRows(h), []); assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Checking muted accounts/);
  h.api.render(); h.api.patch(); assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 1);
  release({ success: true, users: [mutedUser('Alice')], nextCursor: null }); await tick();
  assert.deepEqual(favoriteRows(h), ['visible']); assert.match(h.document.getElementById('ct-favorites-panel').textContent, /2 saved posts.*hidden.*retained/);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), before);
  assert.equal(h.api.load().length, 3);
});

test('a failed partial mute check keeps all snapshots hidden until an explicit retry completes it', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('muted')); h.api.save(item('visible', { username: 'bob' }));
  h.muted([{ success: true, users: [mutedUser('alice')], nextCursor: '1' }, null]); await h.select('favorites');
  assert.deepEqual(favoriteRows(h), []); assert.equal(h.api.state.favoriteMutes.done, false); assert.equal(h.api.state.favoriteMutes.cursor, '1');
  assert.match(h.document.getElementById('ct-favorites-panel').textContent, /could not be checked/);
  const before = h.calls.length; h.api.patch(); h.api.render(); await tick(); assert.equal(h.calls.length, before);
  h.muted([{ success: true, users: [mutedUser('alice')], nextCursor: '1' }, { success: true, users: [], nextCursor: null }]);
  favoriteControl(h, 'Try again').click(); await tick();
  assert.deepEqual(h.calls.slice(before), ['/api/users/muted?cursor=1']); assert.deepEqual(favoriteRows(h), ['visible']);
  assert.equal(h.api.state.favoriteMutes.done, true); assert.equal(h.api.load().length, 2);
});

test('mute pagination stops after ten pages and requires explicit continuation before any saved row appears', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('last-page-muted')); h.api.save(item('visible', { username: 'bob' }));
  h.muted(Array.from({ length: 11 }, (_, index) => ({ success: true, users: index === 10 ? [mutedUser('alice')] : [], nextCursor: index === 10 ? null : String(index + 1) })));
  await h.select('favorites');
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 10); assert.equal(h.api.state.favoriteMutes.done, false);
  assert.deepEqual(favoriteRows(h), []); assert.ok(favoriteControl(h, 'Continue checking'));
  h.api.patch(); h.api.render(); await tick(); assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 10);
  favoriteControl(h, 'Continue checking').click(); await tick();
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 11); assert.equal(h.api.state.favoriteMutes.pages, 11);
  assert.deepEqual(favoriteRows(h), ['visible']);
});

test('bad mute records and invalid or repeating cursors never turn an incomplete check into success', async t => {
  const bad = [null, { success: false, users: [] }, { success: true, users: {} }, { success: true, users: [{ username: 'alice' }] },
    { success: true, users: [mutedUser('invalid user')] }, { success: true, users: [], nextCursor: 2 }, { success: true, users: [], nextCursor: '' }];
  for (const response of bad) {
    const h = harness(t); await h.ready(); h.api.save(item('saved')); h.muted([response]); await h.select('favorites');
    assert.equal(h.api.state.favoriteMutes.done, false); assert.deepEqual(favoriteRows(h), []); assert.ok(favoriteControl(h, 'Try again')); assert.equal(h.api.load().length, 1);
  }
  const h = harness(t); await h.ready(); h.api.save(item('saved'));
  h.muted([{ success: true, users: [], nextCursor: '1' }, { success: true, users: [], nextCursor: '1' }]); await h.select('favorites');
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 2); assert.equal(h.api.state.favoriteMutes.done, false); assert.deepEqual(favoriteRows(h), []);
});

test('explicit Favorite refresh clears snapshots while waiting and recent complete mute checks are reused briefly', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('saved')); await h.select('favorites'); assert.deepEqual(favoriteRows(h), ['saved']);
  let release; h.override(endpoint => endpoint.pathname === '/api/users/muted' ? new Promise(resolve => { release = resolve; }) : undefined);
  favoriteControl(h, 'Refresh view').click(); assert.deepEqual(favoriteRows(h), []); await tick();
  release({ success: true, users: [mutedUser('alice')], nextCursor: null }); await tick(); assert.deepEqual(favoriteRows(h), []);
  assert.equal(h.api.load().length, 1);
  h.override(null); h.muted([{ success: true, users: [], nextCursor: null }]); h.document.querySelector('[role=tab][aria-label=Tweets]').click();
  const before = h.calls.filter(url => url.startsWith('/api/users/muted')).length; await h.select('favorites');
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, before); assert.deepEqual(favoriteRows(h), []);
  h.api.state.muteCache.get('uid-viewer').at = Date.now() - 30001;
  h.document.querySelector('[role=tab][aria-label=Tweets]').click(); await h.select('favorites');
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, before + 1); assert.deepEqual(favoriteRows(h), ['saved']);
});

test('late mute responses cannot affect another route or account and native content is restored', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('old')); let release; let requests = 0;
  h.override(endpoint => endpoint.pathname === '/api/users/muted' ? (++requests === 1 ? new Promise(resolve => { release = resolve; }) : { success: true, users: [], nextCursor: null }) : undefined);
  await h.select('favorites');
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); h.api.save(item('new', { username: 'bob' })); await h.select('favorites');
  release({ success: true, users: [mutedUser('bob')], nextCursor: null }); await tick();
  assert.deepEqual(favoriteRows(h), ['new']); assert.equal(h.api.state.favoriteMutes.uid, 'uid-other'); assert.equal(h.api.state.favoriteMutes.handles.size, 0);
  let late; h.override(endpoint => endpoint.pathname === '/api/users/muted' ? new Promise(resolve => { late = resolve; }) : undefined);
  favoriteControl(h, 'Refresh view').click(); await tick(); h.route('/feed', 'other'); h.api.patch();
  late({ success: true, users: [], nextCursor: null }); await tick();
  assert.equal(h.document.getElementById('ct-favorites-panel'), null); assert.equal(h.api.state.favoriteMutes, null);
  assert.equal(h.document.getElementById('native-timeline').hasAttribute('data-ct-profile-timeline-hidden'), false);
});

test('hidden and inactive pages send no mute requests and a background transition cannot complete a pending check', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('saved'));
  Object.defineProperty(h.document, 'hidden', { configurable: true, value: true }); await h.select('favorites');
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 0); assert.deepEqual(favoriteRows(h), []);
  Object.defineProperty(h.document, 'hidden', { configurable: true, value: false }); h.api.setActive(false); await h.api.mutes();
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 0);
  h.api.setActive(true); let release; h.override(endpoint => endpoint.pathname === '/api/users/muted' ? new Promise(resolve => { release = resolve; }) : undefined);
  const pending = h.api.mutes(); await tick(); Object.defineProperty(h.document, 'hidden', { configurable: true, value: true });
  release({ success: true, users: [], nextCursor: null }); await pending;
  assert.equal(h.api.state.favoriteMutes.done, false); assert.deepEqual(favoriteRows(h), []); assert.ok(favoriteControl(h, 'Try again'));
  Object.defineProperty(h.document, 'hidden', { configurable: true, value: false }); h.override(null); await h.api.mutes();
  assert.deepEqual(favoriteRows(h), ['saved']);
});

test('Favorite saves, removals, imports and storage events obey a completed mute check without erasing filtered snapshots', async t => {
  const h = harness(t); await h.ready(); h.muted([{ success: true, users: [mutedUser('alice')], nextCursor: null }]); await h.select('favorites');
  h.api.save(item('muted')); h.api.save(item('visible', { username: 'bob' })); assert.deepEqual(favoriteRows(h), ['visible']);
  h.window.localStorage.setItem('legacy.favorites', JSON.stringify([item('legacy-muted'), item('legacy-visible', { username: 'bob' })])); h.api.render();
  favoriteControl(h, 'Import older saved data').click(); assert.deepEqual(favoriteRows(h), ['visible', 'legacy-visible']); assert.equal(h.api.load().length, 4);
  h.api.remove('visible', 'uid-viewer'); assert.deepEqual(favoriteRows(h), ['legacy-visible']);
  h.window.localStorage.setItem('legacy.favorites:uid:uid-viewer', JSON.stringify([item('stored-muted'), item('stored-visible', { username: 'bob' })]));
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: 'legacy.favorites:uid:uid-viewer' })); assert.deepEqual(favoriteRows(h), ['stored-visible']); assert.equal(h.api.load().length, 2);
  assert.equal(h.calls.filter(url => url.startsWith('/api/users/muted')).length, 1);
});

test('a detached legacy import control cannot claim storage for a newly signed-in account', async t => {
  const h = harness(t); await h.ready(); h.window.localStorage.setItem('legacy.favorites', JSON.stringify([item('legacy')])); await h.select('favorites');
  const oldImport = favoriteControl(h, 'Import older saved data');
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); oldImport.click();
  assert.equal(h.window.localStorage.getItem('legacy.favorites:owner'), null); assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-other'), null);
  assert.equal(h.api.load().length, 0); assert.ok(h.window.localStorage.getItem('legacy.favorites'));
});

test('returning to Favorites supersedes a late mute check from the same account', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('saved')); let release; let requests = 0;
  h.override(endpoint => endpoint.pathname === '/api/users/muted' ? (++requests === 1 ? new Promise(resolve => { release = resolve; }) : { success: true, users: [], nextCursor: null }) : undefined);
  await h.select('favorites'); h.document.querySelector('[role=tab][aria-label=Tweets]').click(); await h.select('favorites');
  assert.deepEqual(favoriteRows(h), ['saved']); const current = h.api.state.favoriteMutes;
  release({ success: true, users: [mutedUser('alice')], nextCursor: null }); await tick();
  assert.equal(h.api.state.favoriteMutes, current); assert.equal(current.handles.size, 0); assert.deepEqual(favoriteRows(h), ['saved']);
});

test('saves, removals and import during mute checking stay hidden until the current check completes', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('remove-me', { username: 'bob' }));
  h.window.localStorage.setItem('legacy.favorites', JSON.stringify([item('legacy-muted'), item('legacy-visible', { username: 'bob' })]));
  let release; h.override(endpoint => endpoint.pathname === '/api/users/muted' ? new Promise(resolve => { release = resolve; }) : undefined);
  await h.select('favorites'); h.api.save(item('saved-muted')); h.api.save(item('saved-visible', { username: 'bob' })); h.api.remove('remove-me');
  favoriteControl(h, 'Import older saved data').click(); assert.deepEqual(favoriteRows(h), []);
  release({ success: true, users: [mutedUser('alice')], nextCursor: null }); await tick();
  assert.deepEqual(favoriteRows(h), ['saved-visible', 'legacy-visible']); assert.equal(h.api.load().length, 4);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:owner'), 'uid-viewer');
  assert.equal(h.api.load().some(row => row.id === 'remove-me'), false);
});

test('returning to a recent profile reuses verified Media while expired or failed caches are rechecked', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('cached-photo')], nextCursor: '1' }]); await h.select('media');
  const before = h.calls.filter(url => /\/(?:posts|replies)/.test(url)).length;
  h.route('/feed', 'viewer'); h.api.patch(); h.route('/profile', 'viewer'); await h.ready(); await h.select('media');
  assert.ok(h.document.querySelector('[data-ct-profile-post=cached-photo]'));
  assert.equal(h.calls.filter(url => /\/(?:posts|replies)/.test(url)).length, before);
  h.api.state.mediaCache.get('uid-viewer:viewer').at = Date.now() - 30001;
  h.route('/feed', 'viewer'); h.api.patch(); h.route('/profile', 'viewer'); await h.ready();
  h.override(endpoint => endpoint.pathname.endsWith('/posts') ? null : undefined); await h.select('media');
  assert.equal(h.document.querySelector('[data-ct-profile-post=cached-photo]'), null); assert.match(h.api.state.media.error, /could not be loaded/);
  assert.equal(h.api.state.mediaCache.has('uid-viewer:viewer'), false);
  h.route('/feed', 'viewer'); h.api.patch(); h.route('/profile', 'viewer'); await h.ready();
  h.override(null); h.pages([{ posts: [post('after-failure')], nextCursor: null }]); await h.select('media');
  assert.ok(h.document.querySelector('[data-ct-profile-post=after-failure]'));
});

test('verified native mute actions invalidate short-lived caches without altering saved Favorites', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('photo')], nextCursor: null }]); await h.select('media');
  h.api.save(item('saved')); await h.select('favorites'); const stored = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer');
  assert.equal(h.api.state.muteCache.size, 1); assert.equal(h.api.state.mediaCache.size, 1);
  const protectedButton = h.document.createElement('button'); protectedButton.innerHTML = '<svg class="lucide-volume-x"></svg><span class="min-w-0 truncate" title="Mute user">Mute user</span>';
  const userContent = h.document.createElement('div'); userContent.dataset.userContent = ''; userContent.append(protectedButton); h.document.querySelector('article').append(userContent);
  protectedButton.click(); assert.equal(h.api.state.muteCache.size, 1);
  const button = h.document.createElement('button'); button.innerHTML = '<svg class="lucide-volume-x"></svg><span class="min-w-0 truncate" title="Mute user">Mute user</span>';
  h.document.querySelector('article').append(button); button.click();
  assert.equal(h.api.state.muteCache.size, 0); assert.equal(h.api.state.mediaCache.size, 0); assert.deepEqual(favoriteRows(h), []);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), stored);
  h.muted([{ success: true, users: [mutedUser('alice')], nextCursor: null }]); await h.api.mutes(); assert.deepEqual(favoriteRows(h), []);
});

test('native profile and settings unmute controls invalidate cache while ordinary labels do not', async t => {
  const h = harness(t); await h.ready(); await h.select('favorites');
  const normal = h.document.createElement('button'); normal.textContent = 'Mute user'; h.document.body.append(normal); normal.click(); assert.equal(h.api.state.muteCache.size, 1);
  const menu = h.document.createElement('div'); menu.setAttribute('role', 'menu');
  menu.innerHTML = '<button role="menuitem"><svg class="lucide-volume-2"></svg><span class="min-w-0 truncate" title="Unmute @alice">Unmute @alice</span></button>';
  h.document.body.append(menu); menu.querySelector('button').click(); assert.equal(h.api.state.muteCache.size, 0);
  await h.api.mutes(); assert.equal(h.api.state.muteCache.size, 1);
  const report = h.document.createElement('div'); report.setAttribute('role', 'dialog'); report.setAttribute('aria-modal', 'true'); report.setAttribute('aria-label', 'Report @alice'); report.className = 'bg-tl-app-card border';
  report.innerHTML = '<h3 class="text-sm font-bold text-tl-app-text">Thank you</h3><button class="w-full rounded-full border" aria-busy="false">Mute @alice</button>';
  h.document.body.append(report); report.querySelector('button').click(); assert.equal(h.api.state.muteCache.size, 0);
  await h.api.mutes(); assert.equal(h.api.state.muteCache.size, 1);
  h.window.history.replaceState({}, '', '/settings');
  const unmute = h.document.createElement('button'); unmute.setAttribute('aria-label', 'Unmute @alice'); unmute.textContent = 'Unmute'; h.document.body.append(unmute); unmute.click();
  assert.equal(h.api.state.muteCache.size, 0);
});

test('Media restores confirmed older Favorites without requiring images and preserves existing order and saved times', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('existing', { savedAt: 123, text: 'Old snapshot' }));
  h.pages([{ posts: [post('older-liked', [], { hasLiked: true }), post('existing', [], { hasLiked: true })], nextCursor: null }]);
  h.replies([{ post: post('liked-reply', [], { hasLiked: true, parentId: 'parent' }) }]); await h.select('media');
  assert.deepEqual(Array.from(h.api.load(), row => row.id), ['existing', 'older-liked', 'liked-reply']);
  assert.equal(h.api.load()[0].savedAt, 123); const before = JSON.stringify(h.api.load());
  await h.api.media(true); assert.equal(JSON.stringify(h.api.load()), before);
  await h.select('favorites'); assert.deepEqual(favoriteRows(h), ['existing', 'older-liked', 'liked-reply']);
  assert.match(h.document.getElementById('ct-favorites-panel').textContent, /entire past history cannot be retrieved/);
});

test('read restoration rejects unconfirmed, deleted, muted, reposted, foreign or stale-account data', async t => {
  const h = harness(t); await h.ready();
  const rejected = [post('not-liked'), post('false-liked', [], { hasLiked: false }), post('truthy', [], { hasLiked: 1 }),
    post('deleted', [], { hasLiked: true, isDeleted: true }), post('muted', [], { hasLiked: true, status: 'MUTED' }),
    post('repost', [], { hasLiked: true, isRepost: true }), post('original', [], { hasLiked: true, originalPostId: 'origin' }),
    post('foreign', [], { hasLiked: true, authorUsername: 'alice' }), post('invalid', [], { hasLiked: true, authorUsername: 'bad handle' }),
    post('missing-text', [], { hasLiked: true, text: null })];
  assert.equal(h.api.remember(rejected, 'uid-viewer', 'viewer'), 0); assert.equal(h.api.load().length, 0);
  assert.equal(h.api.remember([post('wrong-uid', [], { hasLiked: true })], 'uid-other', 'viewer'), 0);
  h.api.save(item('kept')); h.api.remember([post('kept', [], { hasLiked: false })], 'uid-viewer', 'viewer'); assert.equal(h.api.load()[0].id, 'kept');
});

test('an old hasLiked read cannot revive a newer native Unlike, but a confirmed new Favorite can', async t => {
  const h = harness(t); await h.ready(); const liked = post('removed', [], { hasLiked: true });
  h.api.remember([liked], 'uid-viewer', 'viewer'); assert.equal(h.api.load().length, 1);
  h.api.remove('removed', 'uid-viewer'); h.api.remember([liked], 'uid-viewer', 'viewer'); assert.equal(h.api.load().length, 0);
  h.api.save(item('removed', { username: 'viewer' }), 'uid-viewer'); h.api.remember([liked], 'uid-viewer', 'viewer'); assert.equal(h.api.load().length, 1);
  h.setAuth({ uid: 'uid-other', token: 'token-other' }); assert.equal(h.api.remember([liked], 'uid-viewer', 'viewer'), 0); assert.equal(h.api.load().length, 0);
});
