const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/profile.js'), 'utf8');
const timestamps = fs.readFileSync(path.join(__dirname, '../src/timestamps.js'), 'utf8');
const photoViewport = fs.readFileSync(path.join(__dirname, '../src/photo-viewport.js'), 'utf8');
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
  let blockedPages = [{ blocks: [], nextCursor: null }];
  const historyStatuses = new Map([['uid-viewer', options.history || null]]);
  let override = null; const calls = [];
  window.ctNetworkState = { authUID: auth.uid };
  window.ctFavoriteHistoryStatus = () => historyStatuses.get(window.ctNetworkState.authUID) || null;
  window.getAuth = async () => { window.ctNetworkState.authUID = auth?.uid || null; return auth; };
  window.requestJSON = async (url, headers) => {
    const endpoint = new URL(url); calls.push(endpoint.pathname + endpoint.search);
    assert.equal(endpoint.origin, 'https://api.tweet.app'); assert.match(headers.Authorization, /^Bearer /);
    if (override) { const result = await override(endpoint); if (result !== undefined) return result; }
    if (endpoint.pathname === '/api/users/muted') {
      assert.equal(endpoint.searchParams.has('limit'), false);
      return mutedPages[Number(endpoint.searchParams.get('cursor') || 0)] ?? null;
    }
    if (endpoint.pathname === '/api/blocks') {
      assert.equal(endpoint.searchParams.get('limit'), '200');
      return blockedPages[Number(endpoint.searchParams.get('cursor') || 0)] ?? null;
    }
    if (endpoint.pathname.startsWith('/api/user-profile/')) return { profile: { username: accountUser } };
    if (endpoint.pathname.endsWith('/replies')) return { replies: userReplies };
    assert.match(endpoint.pathname, /^\/api\/users\/[A-Za-z0-9_.-]+\/posts$/);
    assert.equal(endpoint.searchParams.get('limit'), '24');
    return pages[Number(endpoint.searchParams.get('cursor') || 0)] || { posts: [], nextCursor: null };
  };
  window.eval(`const CT_LOCALE='${options.locale || 'en'}'; const KEY={favorites:'legacy.favorites'}; const API_ORIGIN='https://api.tweet.app'; let favoritesActive=false; let ctPageActive=true; ${photoViewport} ${timestamps} ${source}
    window.profile={patch:patchFavoriteProfileTab, close:closeFavoritesPanel, render:renderFavoritesPanel, media:ctProfileLoadMedia, mutes:ctProfileLoadFavoriteMutes, state:ctProfileState,
    save:ctProfileSaveFavorite, remove:ctProfileRemoveFavorite, remember:ctProfileRememberLikedPosts, load:ctProfileLoadFavorites, import:ctProfileImportFavorites, assets:ctProfileMediaAssets,
    context:ctProfileContext, viewerClose:ctProfileCloseViewer, backup:ctProfileFavoriteBackup, backupParts:ctProfileFavoriteBackupParts, importBackup:ctProfileImportFavoriteBackup, setActive:value=>{ctPageActive=value;}};`);
  return { window, document: window.document, api: window.profile, calls,
    pages: value => { pages = value; }, replies: value => { userReplies = value; }, muted: value => { mutedPages = value; },
    blocked: value => { blockedPages = value; }, override: value => { override = value; },
    history: value => { historyStatuses.set(window.ctNetworkState.authUID, value); window.dispatchEvent(new window.Event('ct-favorite-history-change')); },
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

test('native GIF-as-video metadata reaches Media with silent looping and explicit playback', async t => {
  const h = harness(t, { locale: 'ja' }); await h.ready();
  const media = [{ media_type: 'video', public_url: 'https://media.example/animated.mp4',
    thumbnail_url: 'https://images.example/animated.jpg', is_gif: true }];
  h.pages([{ posts: [post('animated', media, { editedAt: '2026-10-09T08:00:00Z' }),
    post('still-edited', undefined, { isEdited: true }), post('movie', [
      { media_type: 'video', public_url: 'https://media.example/plain.mp4', is_gif: 'true' }
    ])], nextCursor: null }]);
  await h.select('media');
  const row = h.document.querySelector('[data-ct-profile-post=animated]');
  const video = row.querySelector('video');
  assert.equal(video.src, media[0].public_url); assert.equal(video.poster, media[0].thumbnail_url);
  assert.equal(video.loop, true); assert.equal(video.muted, true); assert.equal(video.controls, true);
  assert.equal(video.autoplay, false); assert.equal(video.preload, 'none'); assert.equal(video.playsInline, true);
  assert.equal(video.getAttribute('aria-label'), '投稿のアニメーションGIF');
  assert.equal(row.querySelector('.ct-profile-edited').textContent, '編集済み');
  assert.equal(row.querySelector('time').dateTime, '2026-09-30T00:00:00Z');
  assert.equal(h.document.querySelector('[data-ct-profile-post=still-edited] .ct-profile-edited').textContent, '編集済み');
  const ordinary = h.document.querySelector('[data-ct-profile-post=movie] video');
  assert.equal(ordinary.loop, false); assert.equal(ordinary.muted, false);
  assert.equal(h.api.state.media.items.find(item => item.id === 'animated').media[0].isGIF, true);
  assert.equal(h.api.state.media.items.find(item => item.id === 'movie').media[0].isGIF, undefined);
});

test('Favorite GIF and edit metadata survive storage and backup while older records retain their dates', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('old', { createdAt: '2020-01-02T03:04:00Z', savedAt: 23,
    media: [{ type: 'video', url: 'https://media.example/old.mp4', poster: '' }] }));
  h.api.remember([post('gif', [{ media_type: 'video', public_url: 'https://media.example/gif.mp4', is_gif: true }],
    { hasLiked: true, editedAt: '2026-10-09T08:00:00Z' })], 'uid-viewer');
  const stored = JSON.parse(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'));
  assert.equal(stored.find(item => item.id === 'gif').media[0].isGIF, true);
  assert.equal(stored.find(item => item.id === 'gif').isEdited, true);
  const old = stored.find(item => item.id === 'old');
  assert.equal(old.isEdited, undefined); assert.equal(old.media[0].isGIF, undefined); assert.equal(old.savedAt, 23);
  assert.equal(old.createdAt, '2020-01-02T03:04:00Z');
  const backup = JSON.parse(h.api.backup());
  const restored = { ...backup.items.find(item => item.id === 'gif'), id: 'restored-gif' };
  backup.items = [restored, { ...backup.items.find(item => item.id === 'old'), id: 'restored-old' }];
  assert.equal(h.api.importBackup(JSON.stringify(backup)), 2);
  await h.select('favorites');
  const row = h.document.querySelector('[data-ct-profile-post=restored-gif]');
  assert.equal(row.querySelector('video').loop, true); assert.equal(row.querySelector('video').muted, true);
  assert.equal(row.querySelector('video').autoplay, false); assert.equal(row.querySelector('.ct-profile-edited').textContent, 'Edited');
  assert.equal(h.document.querySelector('[data-ct-profile-post=restored-old] .ct-profile-edited'), null);
  assert.equal(h.document.querySelector('[data-ct-profile-post=restored-old] time').dateTime, '2020-01-02T03:04:00Z');
});

test('new optional archive flags reject malformed values atomically and do not turn edit dates into creation dates', async t => {
  const h = harness(t); await h.ready();
  h.api.remember([post('flag', [], { hasLiked: true, isEdited: true, createdAt: '', editedAt: '2026-10-09T08:00:00Z' }),
    post('unconfirmed', [], { hasLiked: true, isEdited: 'true', editedAt: ' ' })], 'uid-viewer');
  const valid = JSON.parse(h.api.backup()); const before = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer');
  const base = valid.items[0];
  for (const changes of [
    { isEdited: 'true' },
    { media: [{ type: 'video', url: 'https://media.example/gif.mp4', poster: '', isGIF: 'true' }] },
    { media: [{ type: 'image', url: 'https://images.example/photo.jpg', poster: '', isGIF: true }] }
  ]) {
    assert.throws(() => h.api.importBackup(JSON.stringify({ ...valid, items: [{ ...base, ...changes }] })), /format/);
    assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), before);
  }
  await h.select('favorites');
  assert.equal(h.document.querySelector('[data-ct-profile-post=flag] time'), null);
  assert.equal(h.document.querySelector('[data-ct-profile-post=flag] .ct-profile-edited').textContent, 'Edited');
  assert.equal(h.document.querySelector('[data-ct-profile-post=unconfirmed] .ct-profile-edited'), null);
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

test('Favorite creation times show local date and clock time and update from the same post without using save time', async t => {
  const h = harness(t, { locale: 'ja' }); await h.ready();
  h.api.save(item('dated', { username: 'viewer', createdAt: '2026-09-29T23:55:00Z', savedAt: 123 }));
  await h.select('favorites'); const initial = h.document.querySelector('[data-ct-profile-post=dated] time');
  assert.equal(initial.textContent, new Date('2026-09-29T23:55:00Z').toLocaleString('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }));
  assert.match(initial.title, /2026/);
  h.api.remember([post('dated', [], { hasLiked: true, createdAt: '2026-09-30T01:05:00Z', created_at: '2026-09-30T00:05:00Z' })], 'uid-viewer', 'viewer');
  const corrected = h.document.querySelector('[data-ct-profile-post=dated] time');
  assert.notEqual(corrected, initial); assert.equal(corrected.dateTime, '2026-09-30T00:05:00Z');
  assert.equal(h.api.load()[0].savedAt, 123);
  h.api.remember([post('dated', [], { hasLiked: true, createdAt: '', created_at: 'invalid', updatedAt: '2026-10-02T00:00:00Z' })], 'uid-viewer', 'viewer');
  assert.equal(h.api.load()[0].createdAt, '2026-09-30T00:05:00Z');
  assert.equal(h.document.querySelector('[data-ct-profile-post=dated] time').dateTime, '2026-09-30T00:05:00Z');
  h.api.remember([post('undated', [], { hasLiked: true, createdAt: '', created_at: null, savedAt: Date.now() })], 'uid-viewer', 'viewer');
  assert.equal(h.document.querySelector('[data-ct-profile-post=undated] time'), null);
});

test('ambiguous legacy Favorite date strings remain in backups but do not invent a date or clock time', async t => {
  const h = harness(t); await h.ready();
  for (const [id, createdAt] of [['date-only', '2026-09-30'], ['no-zone', '2026-09-30T11:45:00'], ['rollover', '2026-02-30T00:00:00Z']]) {
    h.api.save(item(id, { createdAt, savedAt: 123 }));
  }
  const raw = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer');
  const backup = JSON.parse(h.api.backup());
  await h.select('favorites');
  assert.equal(h.document.querySelectorAll('#ct-favorites-panel time').length, 0);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /dates unavailable/);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), raw);
  assert.deepEqual(backup.items.map(row => row.createdAt).sort(), ['2026-02-30T00:00:00Z', '2026-09-30', '2026-09-30T11:45:00'].sort());
  backup.items[0].id = 'imported-legacy';
  assert.equal(h.api.importBackup(JSON.stringify(backup)), 1);
  assert.equal(h.api.load().find(row => row.id === 'imported-legacy').createdAt, backup.items[0].createdAt);
  h.api.save(item('known', { createdAt: '2026-09-30T11:45:00+09:00' }));
  assert.equal(h.document.querySelectorAll('#ct-favorites-panel time').length, 1);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /1 dated/);
});

test('microsecond API creation dates survive Favorite storage and backup import when native Safari parsing rejects raw fractions', async t => {
  const h = harness(t); await h.ready(); const NativeDate = h.window.Date;
  const microseconds = value => typeof value === 'string' && /\.\d{4,9}(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  h.window.Date = class SafariDate extends NativeDate {
    constructor(...values) { super(...(microseconds(values[0]) ? [NaN] : values)); }
    static parse(value) { return microseconds(value) ? NaN : NativeDate.parse(value); }
  };
  const createdAt = '2026-09-30T10:11:12.123456Z';
  assert.equal(Number.isNaN(h.window.Date.parse(createdAt)), true);
  h.api.remember([post('micro', [], { hasLiked: true, created_at: createdAt })], 'uid-viewer', 'viewer');
  assert.equal(h.api.load()[0].createdAt, createdAt);
  await h.select('favorites'); assert.equal(h.document.querySelector('[data-ct-profile-post=micro] time').dateTime, createdAt);
  const backup = JSON.parse(h.api.backup()); assert.equal(backup.items[0].createdAt, createdAt);
  backup.items[0].id = 'imported-micro';
  assert.equal(h.api.importBackup(JSON.stringify(backup)), 1);
  assert.equal(h.api.load().find(row => row.id === 'imported-micro').createdAt, createdAt);
  assert.equal(h.document.querySelector('[data-ct-profile-post=imported-micro] time').dateTime, createdAt);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /2 dated/);
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
  assert.match(h.document.getElementById('ct-profile-media-count').getAttribute('aria-label'), /1 posts and 2 replies checked/);
});

test('reply Media uses each reply creation time, valid native aliases and no parent or wrapper timestamp', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [], nextCursor: null }]);
  h.replies([
    { createdAt: '2030-01-01T00:00:00Z', parentPost: post('parent', undefined, { createdAt: '2026-10-01T23:00:00Z' }),
      post: post('reply', undefined, { createdAt: '2026-09-30T09:00:00Z', created_at: '2026-09-30T08:00:00Z', parentId: 'parent' }) },
    { post: post('fallback', undefined, { created_at: 'invalid', createdAt: '2026-09-30T10:00:00Z' }) },
    { post: post('unknown', undefined, { createdAt: '2026-02-30T00:00:00Z', created_at: '', updatedAt: '2030-01-01T00:00:00Z' }),
      parentPost: post('parent2', undefined, { createdAt: '2030-01-01T00:00:00Z' }) }
  ]);
  await h.select('media');
  assert.deepEqual(Array.from(h.api.state.media.items, row => row.id), ['fallback', 'reply', 'unknown']);
  assert.equal(h.document.querySelector('[data-ct-profile-post=reply] time').dateTime, '2026-09-30T08:00:00Z');
  assert.equal(h.document.querySelector('[data-ct-profile-post=fallback] time').dateTime, '2026-09-30T10:00:00Z');
  assert.equal(h.document.querySelector('[data-ct-profile-post=unknown] time'), null);
  assert.equal(h.document.querySelector('[data-ct-profile-post=parent]'), null);
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

test('Favorites wait for all native block pages and hide blocked authors without deleting snapshots', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('alice', { username: 'alice', createdAt: '2020-01-01T00:00:00Z' }));
  h.api.save(item('bob', { username: 'bob' })); h.api.save(item('allowed', { username: 'carol' }));
  const before = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'); let release;
  h.blocked([{ blocks: [mutedUser('ALICE')], nextCursor: '1' }, { blocks: [mutedUser('bob')], nextCursor: '' }]);
  h.override(endpoint => endpoint.pathname === '/api/blocks' && !endpoint.searchParams.has('cursor') ?
    new Promise(resolve => { release = resolve; }) : undefined);
  await h.select('favorites');
  assert.deepEqual(favoriteRows(h), []); assert.equal(h.api.state.favoriteMutes.mutedDone, true);
  assert.equal(h.api.state.favoriteMutes.blockedDone, false);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /checking muted and blocked accounts/);
  release({ blocks: [mutedUser('ALICE')], nextCursor: '1' }); await tick();
  assert.deepEqual(favoriteRows(h), ['allowed']); assert.equal(h.api.state.favoriteMutes.blockPages, 2);
  assert.equal(h.api.state.favoriteMutes.done, true);
  assert.ok(h.calls.includes('/api/blocks?limit=200&cursor=1'));
  assert.match(h.document.getElementById('ct-favorite-hidden-status').textContent, /blocked.*hidden.*retained/);
  assert.doesNotMatch(h.document.getElementById('ct-favorite-range').textContent, /2020/);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), before); assert.equal(h.api.load().length, 3);
});

test('invalid block responses and repeated cursors keep snapshots hidden and preserve the failed page for retry', async t => {
  for (const response of [null, { success: false, blocks: [] }, { blocks: {} },
    { blocks: [{ username: 'alice' }] }, { blocks: [mutedUser('invalid user')] },
    { blocks: [], nextCursor: 3 }]) {
    const h = harness(t); await h.ready(); h.api.save(item('saved')); h.blocked([response]); await h.select('favorites');
    assert.deepEqual(favoriteRows(h), []); assert.equal(h.api.state.favoriteMutes.done, false);
    assert.equal(h.api.state.favoriteMutes.mutedDone, true); assert.equal(h.api.state.muteCache.size, 0);
    assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Blocked accounts could not be checked/);
    assert.equal(h.api.load().length, 1);
  }
  const h = harness(t); await h.ready(); h.api.save(item('blocked')); h.api.save(item('allowed', { username: 'bob' }));
  h.blocked([{ blocks: [mutedUser('alice')], nextCursor: '1' }, { blocks: [], nextCursor: '1' }]);
  await h.select('favorites'); assert.equal(h.api.state.favoriteMutes.blockCursor, '1'); assert.deepEqual(favoriteRows(h), []);
  const before = h.calls.length;
  h.blocked([{ blocks: [mutedUser('alice')], nextCursor: '1' }, { blocks: [], nextCursor: null }]);
  favoriteControl(h, 'Try again').click(); await tick();
  assert.deepEqual(h.calls.slice(before), ['/api/blocks?limit=200&cursor=1']); assert.deepEqual(favoriteRows(h), ['allowed']);
});

test('block pagination is bounded and requires explicit continuation before Favorites appear', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('last-page-blocked')); h.api.save(item('allowed', { username: 'bob' }));
  h.blocked(Array.from({ length: 11 }, (_, index) => ({ blocks: index === 10 ? [mutedUser('alice')] : [],
    nextCursor: index === 10 ? null : String(index + 1) })));
  await h.select('favorites');
  assert.equal(h.calls.filter(url => url.startsWith('/api/blocks?')).length, 10);
  assert.equal(h.api.state.favoriteMutes.done, false); assert.deepEqual(favoriteRows(h), []);
  const before = h.calls.length; h.api.patch(); h.api.render(); await tick(); assert.equal(h.calls.length, before);
  favoriteControl(h, 'Continue checking').click(); await tick();
  assert.equal(h.calls.filter(url => url.startsWith('/api/blocks?')).length, 11);
  assert.deepEqual(favoriteRows(h), ['allowed']); assert.equal(h.api.load().length, 2);
});

test('late block pages cannot populate another route or account or finish a background visibility check', async t => {
  for (const change of ['account', 'route', 'background']) {
    const h = harness(t); await h.ready(); h.api.save(item('old')); let release;
    h.override(endpoint => endpoint.pathname === '/api/blocks' ? new Promise(resolve => { release = resolve; }) : undefined);
    await h.select('favorites');
    if (change === 'account') { h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); }
    else if (change === 'route') { h.route('/user/bob', 'bob'); await h.ready(); }
    else Object.defineProperty(h.document, 'hidden', { configurable: true, value: true });
    release({ blocks: [], nextCursor: null }); await tick();
    assert.deepEqual(favoriteRows(h), []); assert.equal(h.api.state.muteCache.size, 0);
    if (change === 'background') {
      assert.equal(h.api.state.favoriteMutes.done, false); assert.match(h.api.state.favoriteMutes.error, /Show this tab/);
      Object.defineProperty(h.document, 'hidden', { configurable: true, value: false }); h.override(null);
      await h.api.mutes(); assert.deepEqual(favoriteRows(h), ['old']);
    }
    if (change !== 'background') assert.equal(h.document.getElementById('native-timeline').hasAttribute('data-ct-profile-timeline-hidden'), false);
  }
});

test('native blocked profile panels in both languages and classic modes stay visible and remove cached extension tabs', async t => {
  for (const locale of ['ja', 'en']) for (const classic of [false, true]) for (const direction of ['viewer', 'target']) {
    const h = harness(t, { route: '/user/alice', user: 'alice', locale }); await h.ready();
    h.pages([{ posts: [post('cached-photo', undefined, { authorUsername: 'alice' })], nextCursor: null }]);
    await h.select('media'); assert.ok(h.document.querySelector('[data-ct-profile-post=cached-photo]'));
    const timeline = h.document.getElementById('native-timeline');
    timeline.className = direction === 'viewer' ? 'flex flex-col items-center justify-center py-20 px-4 text-center' :
      'flex flex-col items-start justify-center py-12 px-8';
    h.document.documentElement.classList.toggle('ct-classic-enabled', classic);
    const title = direction === 'viewer' ? locale === 'ja' ? 'ブロック済み: @Alice' : 'You blocked @Alice' :
      locale === 'ja' ? 'ブロックされています' : "You're blocked";
    const noun = classic ? 'Tweets' : 'posts';
    const body = direction === 'viewer' ? locale === 'ja' ? '相手のツイートや返信は表示されません。' : `You are not seeing their ${noun} or replies.` :
      locale === 'ja' ? '@Aliceさんにブロックされているため、フォローやツイートの表示ができません。' :
        `@Alice has blocked you, so you can't follow them or see their ${noun}.`;
    timeline.innerHTML = `<p>${title}</p><p class="text-tl-app-text-muted">${body}</p>`;
    const before = h.calls.length; h.api.patch();
    assert.equal(h.document.getElementById('ct-media-tab'), null); assert.equal(h.document.getElementById('ct-media-panel'), null);
    assert.equal(timeline.hasAttribute('data-ct-profile-timeline-hidden'), false);
    assert.equal(timeline.textContent, title + body); assert.equal(h.calls.length, before);
  }
});

test('native block and unblock controls invalidate read caches while preserving stored Favorites and handlers', async t => {
  const h = harness(t); await h.ready(); h.pages([{ posts: [post('cached')], nextCursor: null }]); await h.select('media');
  h.api.save(item('saved')); await h.select('favorites');
  const stored = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer');
  const plain = h.document.createElement('button'); plain.textContent = 'Block @alice'; h.document.body.append(plain); plain.click();
  assert.equal(h.api.state.muteCache.size, 1);
  for (const label of ['Block @alice', 'Unblock @alice', '@aliceをブロック', '@aliceのブロックを解除']) {
    const holder = h.document.createElement('div'); holder.className = 'relative shrink-0';
    const trigger = label.startsWith('@') ? 'メニューを開く' : 'More options';
    holder.innerHTML = `<button aria-label="${trigger}"></button><div class="absolute right-0 top-full bg-tl-app-card border rounded-xl"><button type="button" class="w-full flex items-center"><svg class="lucide-ban"></svg>${label}</button></div>`;
    h.document.body.append(holder); let nativeCalls = 0;
    const button = holder.querySelector('.absolute > button'); button.addEventListener('click', () => nativeCalls++); button.click();
    assert.equal(nativeCalls, 1); assert.equal(h.api.state.muteCache.size, 0); assert.equal(h.api.state.mediaCache.size, 0);
    assert.deepEqual(favoriteRows(h), []); assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), stored);
    holder.remove(); await h.api.mutes(); assert.equal(h.api.state.muteCache.size, 1);
  }
  const confirmation = h.document.createElement('div'); confirmation.className = 'bg-tl-app-card border';
  confirmation.setAttribute('role', 'dialog'); confirmation.setAttribute('aria-modal', 'true'); confirmation.setAttribute('aria-labelledby', 'app-confirm-title');
  confirmation.innerHTML = '<h3 id="app-confirm-title">Block @alice?</h3><p class="mt-2 text-tl-app-text-muted leading-relaxed">Block explanation</p><div class="mt-5"><button>Cancel</button><button class="bg-red-500">Block</button></div>';
  h.document.body.append(confirmation); confirmation.querySelector('button').click(); assert.equal(h.api.state.muteCache.size, 1);
  confirmation.querySelector('button.bg-red-500').click(); assert.equal(h.api.state.muteCache.size, 0);
  await h.api.mutes(); assert.equal(h.api.state.muteCache.size, 1);
  h.window.history.replaceState({}, '', '/settings');
  const section = h.document.createElement('section'); section.innerHTML = '<button aria-label="Unblock @alice">Unblock</button>';
  h.document.querySelector('main').append(section); section.querySelector('button').click(); assert.equal(h.api.state.muteCache.size, 0);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), stored);
});

test('native BLOCKED post stubs are excluded from added Media and Favorite recovery', async t => {
  const h = harness(t); await h.ready();
  h.pages([{ posts: [post('blocked-stub', undefined, { status: 'BLOCKED', hasLiked: true }), post('allowed')], nextCursor: null }]);
  await h.select('media'); assert.equal(h.document.querySelector('[data-ct-profile-post=blocked-stub]'), null);
  assert.equal(h.api.remember([post('blocked-stub', undefined, { status: 'BLOCKED', hasLiked: true })], 'uid-viewer'), 0);
  assert.equal(h.api.load().length, 0);
});

test('Favorites wait for native mute checking without showing snapshots and retain hidden saved data', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('muted', { username: 'ALICE' })); h.api.save(item('visible', { username: 'bob' })); h.api.save(item('unknown', { username: '' }));
  const before = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'); let release;
  h.override(endpoint => endpoint.pathname === '/api/users/muted' ? new Promise(resolve => { release = resolve; }) : undefined);
  h.document.getElementById('ct-favorites-tab').click();
  assert.deepEqual(favoriteRows(h), []); await tick();
  assert.deepEqual(favoriteRows(h), []); assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Checking muted and blocked accounts/);
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
  assert.deepEqual(h.calls.slice(before), ['/api/users/muted?cursor=1', '/api/blocks?limit=200']); assert.deepEqual(favoriteRows(h), ['visible']);
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
  favoriteControl(h, 'Refresh').click(); assert.deepEqual(favoriteRows(h), []); await tick();
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
  favoriteControl(h, 'Refresh').click(); await tick(); h.route('/feed', 'other'); h.api.patch();
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
  await h.select('favorites'); assert.equal(favoriteRows(h).at(-1), 'existing');
  assert.deepEqual(new Set(favoriteRows(h)), new Set(['existing', 'older-liked', 'liked-reply']));
  assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Use Tools to restore Favorites from the past timeline.*entire past history is not guaranteed/);
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

test('Favorites retain more than 500 records and mount progressively without rebuilding existing media', async t => {
  const h = harness(t); await h.ready();
  const data = Array.from({ length: 620 }, (_, index) => item('archive-' + index, { savedAt: 620 - index,
    media: index === 0 ? [{ type: 'video', url: 'https://images.example/video.mp4', poster: '' }] : [] }));
  h.window.localStorage.setItem('legacy.favorites:uid:uid-viewer', JSON.stringify(data));
  assert.equal(h.api.load().length, 620);
  h.api.save(item('new', { savedAt: 1000 })); assert.equal(h.api.load().length, 621);
  assert.equal(h.api.load().at(-1).id, 'archive-619'); await h.select('favorites');
  assert.equal(favoriteRows(h).length, 50);
  const row = h.document.querySelector('[data-ct-profile-post=archive-0]'); const video = row.querySelector('video'); video.currentTime = 24;
  const more = favoriteControl(h, 'Show 50 more'); more.focus(); more.click();
  assert.equal(favoriteRows(h).length, 100); assert.equal(h.document.querySelector('[data-ct-profile-post=archive-0]'), row);
  assert.equal(favoriteControl(h, 'Show 50 more'), more); assert.equal(h.document.activeElement, more);
  assert.equal(row.querySelector('video'), video); assert.equal(video.currentTime, 24);
  assert.match(h.document.getElementById('ct-favorite-count').getAttribute('aria-label'), /621 saved for this account.*100 shown.*621 available/);
  assert.equal(h.api.load().length, 621);
});

test('Favorites simply display saved rows without search or filter controls and retain playing video during progress updates', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('old-photo', { name: 'Alice', text: '星の写真', savedAt: 10, createdAt: '2020-01-01T00:00:00Z', media: [{ type: 'image', url: 'https://images.example/photo.jpg', poster: '' }] }));
  h.api.save(item('new-video', { username: 'bob', name: 'Bob', text: '星の動画', savedAt: 30, createdAt: '2026-01-01T00:00:00Z', media: [{ type: 'video', url: 'https://images.example/video.mp4', poster: '' }] }));
  h.api.save(item('middle', { username: 'carol', text: 'Other words', savedAt: 20, createdAt: '2023-01-01T00:00:00Z' }));
  await h.select('favorites'); const before = h.calls.length;
  assert.deepEqual(favoriteRows(h), ['new-video', 'middle', 'old-photo']);
  assert.equal(h.document.querySelector('#ct-favorites-panel input:not([type=file]),#ct-favorites-panel select'), null);
  const button = h.document.getElementById('ct-favorite-export'); const tools = button.closest('[data-ct-favorite-tools]'); button.focus();
  const video = h.document.querySelector('[data-ct-profile-post=new-video] video'); video.currentTime = 9;
  h.history({ source: 'for-you', pages: 3, scanned: 60, recovered: 2, busy: true });
  assert.deepEqual(favoriteRows(h), ['new-video', 'middle', 'old-photo']);
  assert.equal(h.document.querySelector('[data-ct-profile-post=new-video] video'), video); assert.equal(video.currentTime, 9);
  assert.equal(button.closest('[data-ct-favorite-tools]'), tools); assert.equal(h.document.activeElement, button);
  assert.match(h.document.getElementById('ct-favorite-count').getAttribute('aria-label'), /3 saved for this account.*3 shown.*3 available/);
  assert.match(h.document.getElementById('ct-favorite-history-scope').textContent, /For you and Following.*\nChecking \(For you\).*3 pages.*60 posts checked.*2 recovered/);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /2020.*2026.*3 dated/);
  assert.equal(h.calls.length, before); assert.equal(h.api.load().length, 3);
});

test('Favorites counts and date range cover displayable saves while keeping muted snapshots hidden', async t => {
  const h = harness(t); await h.ready();
  h.window.localStorage.setItem('legacy.favorites:uid:uid-viewer', JSON.stringify([
    item('hidden', { text: 'secret needle', username: 'alice', createdAt: '1900-01-01T00:00:00Z' }),
    ...Array.from({ length: 105 }, (_, index) => item('visible-' + index, { text: 'needle', username: 'bob', createdAt: index ? '2026-01-01T00:00:00Z' : '2020-01-01T00:00:00Z' }))
  ]));
  h.muted([{ success: true, users: [mutedUser('alice')], nextCursor: null }]); await h.select('favorites');
  favoriteControl(h, 'Show 50 more').click(); assert.equal(favoriteRows(h).length, 100);
  h.history({ source: 'following', pages: 8, scanned: 160, recovered: 9, paused: true });
  assert.equal(favoriteRows(h).length, 100); assert.ok(!favoriteRows(h).includes('hidden'));
  assert.doesNotMatch(h.document.getElementById('ct-favorites-panel').textContent, /secret needle/);
  assert.match(h.document.getElementById('ct-favorite-count').getAttribute('aria-label'), /106 saved for this account.*100 shown.*105 available/);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /2020.*2026.*105 dated/);
  assert.doesNotMatch(h.document.getElementById('ct-favorite-range').textContent, /1900/);
  assert.equal(h.api.load().length, 106);
});

test('local Favorite backups contain only this account snapshots and merge without altering saved records', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('existing', { savedAt: 42, text: 'Keep this body', createdAt: '2020-01-01T00:00:00Z' }));
  const backup = JSON.parse(h.api.backup());
  assert.equal(backup.uid, 'uid-viewer'); assert.equal(backup.format, 'classic-twitter-favorites'); assert.equal(backup.items[0].href, undefined);
  assert.doesNotMatch(JSON.stringify(backup), /token-viewer|Authorization|firebase/);
  backup.items[0].text = 'Older backup replacement'; backup.items[0].savedAt = 1;
  backup.items.push({ ...backup.items[0], id: 'added', text: 'Added <script> Like Edited' });
  backup.items.push({ ...backup.items[0], id: 'added', text: 'Duplicate should not replace first' });
  const before = h.calls.length; assert.equal(h.api.importBackup(JSON.stringify(backup)), 1);
  assert.equal(h.calls.length, before); const data = h.api.load();
  assert.deepEqual(Array.from(data, row => row.id), ['existing', 'added']); assert.equal(data[0].text, 'Keep this body'); assert.equal(data[0].savedAt, 42);
  assert.equal(data[1].text, 'Added <script> Like Edited'); assert.equal(data[1].href, 'https://app.tweet.app/post/added');
  assert.equal(h.api.importBackup(JSON.stringify(backup)), 0);
  await h.select('favorites'); assert.equal(h.document.querySelector('#ct-favorites-panel script'), null);
});

test('backup imports reject other accounts, invalid fields and excessive sizes atomically', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('kept', { savedAt: 9 }));
  const valid = JSON.parse(h.api.backup()); const before = h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer');
  const variants = [
    { ...valid, uid: 'uid-other' }, { ...valid, version: 2 }, { ...valid, token: 'unexpected' },
    { ...valid, items: [{ ...valid.items[0], avatar: 'javascript:alert(1)' }] },
    { ...valid, items: [{ ...valid.items[0], savedAt: '9' }] },
    { ...valid, items: [{ ...valid.items[0], media: [{ type: 'image', url: 'https://user:password@example.test/a', poster: '' }] }] },
    { ...valid, items: Array(100001).fill(null) }
  ];
  for (const value of variants) { assert.throws(() => h.api.importBackup(JSON.stringify(value))); assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), before); }
  assert.throws(() => h.api.importBackup(' '.repeat(32 * 1024 * 1024 + 1)), /size/);
  assert.equal(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer'), before);
  h.setAuth({ uid: 'uid-other', token: 'token-other' }); assert.throws(() => h.api.backup('uid-viewer'), /account/);
  assert.throws(() => h.api.importBackup(JSON.stringify(valid), 'uid-viewer'), /account/); assert.equal(h.api.load().length, 0);
});

test('file selection is explicit, imports only local backup and rejects late results after account change', async t => {
  const h = harness(t, { locale: 'ja' }); await h.ready(); h.api.save(item('kept')); const backup = JSON.parse(h.api.backup());
  backup.items.push({ ...backup.items[0], id: 'new-file' }); await h.select('favorites');
  const file = h.document.getElementById('ct-favorite-import-file'); let picker = 0; file.click = () => picker++;
  h.document.getElementById('ct-favorite-import').click(); assert.equal(picker, 1); assert.equal(h.api.load().length, 1);
  Object.defineProperty(file, 'files', { configurable: true, value: [{ size: 100, text: async () => JSON.stringify(backup) }] });
  file.dispatchEvent(new h.window.Event('change', { bubbles: true })); await tick(); await tick();
  assert.equal(h.api.load().length, 2); assert.match(h.document.getElementById('ct-favorite-backup-status').textContent, /1件を取り込みました.*変更していません/);
  let release;
  Object.defineProperty(file, 'files', { configurable: true, value: [{ size: 100, text: () => new Promise(resolve => { release = resolve; }) }] });
  file.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); await h.select('favorites');
  release(JSON.stringify(backup)); await tick(); await tick();
  assert.equal(h.api.load().length, 0); assert.equal(h.document.getElementById('ct-favorite-backup-status').textContent, '');
  file.dispatchEvent(new h.window.Event('change', { bubbles: true })); assert.equal(h.api.load().length, 0);
});

test('quota failure preserves the entire archive in memory and allows a complete local backup', async t => {
  const h = harness(t); await h.ready();
  const data = Array.from({ length: 550 }, (_, index) => item('stored-' + index, { savedAt: index }));
  h.window.localStorage.setItem('legacy.favorites:uid:uid-viewer', JSON.stringify(data));
  const proto = Object.getPrototypeOf(h.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('Quota'); }; t.after(() => { proto.setItem = original; });
  h.api.save(item('unsaved', { savedAt: 1000 })); assert.equal(h.api.load().length, 551);
  const backup = JSON.parse(h.api.backup()); assert.equal(backup.items.length, 551); assert.ok(backup.items.some(row => row.id === 'stored-549'));
  await h.select('favorites'); assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Save a backup before closing/);
  backup.items.push({ ...backup.items[0], id: 'import-memory' }); assert.equal(h.api.importBackup(JSON.stringify(backup)), 1);
  assert.equal(h.api.load().length, 552); assert.equal(JSON.parse(h.api.backup()).items.length, 552);
});

test('legacy import keeps all older records and never replaces existing snapshots on duplicates', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('existing', { text: 'Keep', savedAt: 77 }));
  h.window.localStorage.setItem('legacy.favorites', JSON.stringify([
    item('existing', { text: 'Legacy replacement', savedAt: 1 }), ...Array.from({ length: 550 }, (_, index) => item('legacy-' + index))
  ])); h.api.import();
  assert.equal(h.api.load().length, 551); assert.equal(h.api.load()[0].text, 'Keep'); assert.equal(h.api.load()[0].savedAt, 77);
  assert.equal(h.api.load().at(-1).id, 'legacy-549'); assert.equal(h.window.localStorage.getItem('legacy.favorites:owner'), 'uid-viewer');
});

test('aggregate quota-held archives export in importable parts through explicit downloads and clean up on route changes', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('template')); const base = JSON.parse(h.api.backup());
  const first = JSON.stringify({ ...base, items: Array.from({ length: 1900 }, (_, index) => ({ ...base.items[0], id: 'first-' + index, text: 'x'.repeat(10000) })) });
  const second = JSON.stringify({ ...base, items: Array.from({ length: 1900 }, (_, index) => ({ ...base.items[0], id: 'second-' + index, text: 'y'.repeat(10000) })) });
  assert.ok(Buffer.byteLength(first) < 32 * 1024 * 1024); assert.ok(Buffer.byteLength(second) < 32 * 1024 * 1024);
  const proto = Object.getPrototypeOf(h.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('Quota'); }; t.after(() => { proto.setItem = original; });
  assert.equal(h.api.importBackup(first), 1900); assert.equal(h.api.importBackup(second), 1900);
  assert.equal(h.api.load().length, 3801); assert.ok(h.api.state.dirtyMemory.has('uid-viewer'));
  const parts = Array.from(h.api.backupParts()); assert.equal(parts.length, 2);
  assert.equal(parts.reduce((count, text) => count + JSON.parse(text).items.length, 0), 3801);
  for (const text of parts) { assert.ok(Buffer.byteLength(text) <= 32 * 1024 * 1024); assert.ok(JSON.parse(text).items.length <= 100000); }
  const target = harness(t); await target.ready();
  for (const text of parts) target.api.importBackup(text);
  assert.equal(target.api.load().length, 3801); assert.equal(target.api.load().at(-1).id, 'second-1899');
  assert.equal(target.api.load().find(row => row.id === 'first-0').text.length, 10000);
  await h.select('favorites'); const downloads = []; const revoked = []; let serial = 0;
  h.window.URL.createObjectURL = () => 'blob:backup-' + (++serial); h.window.URL.revokeObjectURL = url => revoked.push(url);
  h.window.HTMLAnchorElement.prototype.click = function() { downloads.push({ href: this.href, file: this.download }); };
  h.document.getElementById('ct-favorite-export').click(); await tick(); await tick();
  assert.equal(downloads.length, 0); assert.equal(serial, 0);
  const partButtons = [...h.document.querySelectorAll('#ct-favorite-backup-parts button')]; assert.equal(partButtons.length, 2);
  assert.match(h.document.getElementById('ct-favorite-backup-status').textContent, /Split the archive into 2 files/);
  partButtons[0].click(); await tick(); assert.equal(downloads.length, 1); assert.match(downloads[0].file, /part-1-of-2\.json$/);
  const firstView = h.api.state.favoriteView; const oldParts = firstView.backupParts;
  h.document.getElementById('ct-favorite-export').click(); await tick(); await tick();
  assert.notEqual(firstView.backupParts, oldParts); assert.ok(revoked.includes('blob:backup-1')); assert.equal(downloads.length, 1);
  partButtons[1].click(); await tick(); assert.equal(downloads.length, 1);
  h.document.querySelector('#ct-favorite-backup-parts button').click(); await tick(); assert.equal(downloads.length, 2);
  h.route('/feed', 'viewer'); h.api.patch(); assert.equal(firstView.backupParts, null); assert.equal(firstView.backupURLs.size, 0);
  assert.ok(revoked.includes('blob:backup-2')); assert.equal(h.document.querySelector('#ct-favorite-backup-parts'), null);
  const before = downloads.length; partButtons[0].click(); await tick(); assert.equal(downloads.length, before);
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); await h.select('favorites');
  assert.equal(h.document.querySelectorAll('#ct-favorite-backup-parts button').length, 0);
  assert.throws(() => h.api.backupParts('uid-viewer'), /account/);
});

test('successful legacy import after quota clears dirty memory so later same-account disk updates are preserved', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('existing'));
  const proto = Object.getPrototypeOf(h.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('Quota'); }; h.api.save(item('memory')); assert.ok(h.api.state.dirtyMemory.has('uid-viewer'));
  proto.setItem = original;
  h.window.localStorage.setItem('legacy.favorites', JSON.stringify([item('legacy')])); h.api.import();
  assert.equal(h.api.state.dirtyMemory.has('uid-viewer'), false); assert.equal(h.api.state.storageError, false);
  const disk = JSON.parse(h.window.localStorage.getItem('legacy.favorites:uid:uid-viewer')); disk.push(item('other-tab'));
  h.window.localStorage.setItem('legacy.favorites:uid:uid-viewer', JSON.stringify(disk));
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: 'legacy.favorites:uid:uid-viewer' }));
  h.api.save(item('latest')); assert.ok(h.api.load().some(row => row.id === 'other-tab'));
  assert.deepEqual(new Set(Array.from(h.api.load(), row => row.id)), new Set(['existing', 'memory', 'legacy', 'other-tab', 'latest']));
});

test('Favorites quota warnings follow the affected UID and remain visible after another account saves successfully', async t => {
  const h = harness(t); await h.ready(); const proto = Object.getPrototypeOf(h.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('Quota'); }; h.api.save(item('a-memory')); proto.setItem = original;
  await h.select('favorites'); assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Browser storage is unavailable/);
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); await h.select('favorites');
  assert.doesNotMatch(h.document.getElementById('ct-favorites-panel').textContent, /Browser storage is unavailable/);
  h.api.save(item('b-stored')); assert.equal(h.api.state.storageError, false);
  assert.doesNotMatch(h.document.getElementById('ct-favorites-panel').textContent, /Browser storage is unavailable/);
  h.setAuth({ uid: 'uid-viewer', token: 'token-viewer' }, 'viewer'); h.route('/profile', 'viewer'); await h.ready(); await h.select('favorites');
  assert.match(h.document.getElementById('ct-favorites-panel').textContent, /Browser storage is unavailable/);
  assert.equal(h.api.load()[0].id, 'a-memory');
});

test('Favorites show account-local recovery coverage without claiming that the whole history is complete', async t => {
  const h = harness(t, { locale: 'ja' }); await h.ready(); h.api.save(item('unknown-date')); await h.select('favorites');
  assert.equal(h.document.getElementById('ct-favorite-query'), null); assert.equal(h.document.getElementById('ct-favorite-type'), null); assert.equal(h.document.getElementById('ct-favorite-sort'), null);
  assert.match(h.document.getElementById('ct-favorite-count').getAttribute('aria-label'), /このアカウントに保存済み1件.*表示1件.*表示対象1件/);
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /日付未確認/);
  assert.match(h.document.getElementById('ct-favorite-history-scope').textContent, /おすすめ・フォロー中.*サービスが返す投稿.*\n.*未確認/);
  const calls = h.calls.length;
  h.history({ source: 'following', pages: 12, scanned: 240, recovered: 7, done: true });
  assert.match(h.document.getElementById('ct-favorite-history-scope').textContent, /返された範囲の確認が終了.*12ページ.*240投稿.*7件を復元/);
  assert.match(h.document.getElementById('ct-favorites-panel').textContent, /全履歴の復元は保証できません/);
  assert.doesNotMatch(h.document.getElementById('ct-favorite-history-scope').textContent, /全履歴.*完了/);
  h.history({ source: 'following', pages: 12, scanned: 240, recovered: 7, error: 'network', paused: true });
  assert.match(h.document.getElementById('ct-favorite-history-scope').textContent, /確認を中断（フォロー中）/);
  h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.route('/profile', 'other'); await h.ready(); await h.select('favorites');
  assert.match(h.document.getElementById('ct-favorite-count').getAttribute('aria-label'), /保存済み0件.*表示0件/);
  assert.match(h.document.getElementById('ct-favorite-history-scope').textContent, /未確認/);
  assert.doesNotMatch(h.document.getElementById('ct-favorite-history-scope').textContent, /240|7件/);
  assert.equal(h.calls.slice(calls).filter(url => url.startsWith('/api/posts')).length, 0);
});

test('photo dialog centers a stage in the current visual viewport and removes viewport listeners on close', async t => {
  const h = harness(t); await h.ready(); const viewport = new h.window.EventTarget();
  Object.assign(viewport, { width: 390, height: 844, offsetTop: 12, offsetLeft: 0, scale: 1 });
  Object.defineProperty(h.window, 'visualViewport', { configurable: true, value: viewport });
  h.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  h.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  h.api.save(item('photo', { media: [{ type: 'image', url: 'https://images.example/photo.jpg', poster: '' }] })); await h.select('favorites');
  const trigger = h.document.querySelector('.ct-profile-photo'); trigger.click(); const dialog = h.document.querySelector('dialog');
  assert.equal(dialog.querySelector('.ct-profile-viewer-stage > img').src, 'https://images.example/photo.jpg');
  assert.equal(h.window.getComputedStyle(dialog).display, 'grid');
  assert.equal(h.window.getComputedStyle(dialog).gridTemplateRows, 'minmax(0,1fr)');
  assert.equal(h.window.getComputedStyle(dialog.querySelector('.ct-profile-viewer-nav')).position, 'absolute');
  assert.equal(h.window.getComputedStyle(dialog.querySelector('.ct-profile-viewer-stage')).placeItems, 'center');
  assert.equal(dialog.style.getPropertyValue('--ct-photo-view-height'), '844px');
  assert.equal(dialog.style.getPropertyValue('--ct-photo-view-width'), '390px');
  const bounds = () => ['width', 'height', 'top', 'left'].map(name => dialog.style.getPropertyValue('--ct-photo-view-' + name));
  const before = bounds();
  Object.assign(viewport, { scale: 2, width: 195, height: 422, offsetTop: 80, offsetLeft: 35 }); viewport.dispatchEvent(new h.window.Event('resize'));
  assert.deepEqual(bounds(), before);
  Object.assign(viewport, { scale: 4, width: 97.5, height: 211, offsetTop: 130, offsetLeft: 70 }); viewport.dispatchEvent(new h.window.Event('resize'));
  viewport.offsetTop = 160; viewport.offsetLeft = 92; viewport.dispatchEvent(new h.window.Event('scroll')); h.window.dispatchEvent(new h.window.Event('resize'));
  assert.deepEqual(bounds(), before); assert.equal(dialog.querySelector('img').src, 'https://images.example/photo.jpg');
  viewport.scale = 1;
  viewport.height = 600; viewport.width = 320; viewport.offsetTop = 6; viewport.dispatchEvent(new h.window.Event('resize'));
  assert.equal(dialog.style.getPropertyValue('--ct-photo-view-height'), '600px'); assert.equal(dialog.style.getPropertyValue('--ct-photo-view-width'), '320px');
  assert.equal(dialog.style.getPropertyValue('--ct-photo-view-top'), '6px');
  dialog.querySelector('[aria-label=Close]').click(); assert.equal(h.document.activeElement, trigger);
  viewport.height = 500; viewport.dispatchEvent(new h.window.Event('resize'));
  assert.equal(dialog.style.getPropertyValue('--ct-photo-view-height'), '600px'); assert.equal(h.document.querySelector('dialog'), null);
});

test('profile photo opened during pinch uses layout bounds and resumes keyboard or browser resize fitting after zoom ends', async t => {
  const h = harness(t); await h.ready(); const viewport = new h.window.EventTarget();
  Object.assign(viewport, { width: 195, height: 300, offsetTop: 120, offsetLeft: 45, scale: 2 });
  Object.defineProperty(h.window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(h.document.documentElement, 'clientWidth', { configurable: true, value: 390 });
  h.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  h.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  h.api.save(item('photo', { media: [{ type: 'image', url: 'https://images.example/photo.jpg', poster: '' }] })); await h.select('favorites');
  h.document.querySelector('.ct-profile-photo').click(); const dialog = h.document.querySelector('dialog');
  const bounds = () => ['width', 'height', 'top', 'left'].map(name => dialog.style.getPropertyValue('--ct-photo-view-' + name));
  assert.deepEqual(bounds(), ['390px', '600px', '0px', '0px']);
  Object.assign(viewport, { scale: 3, width: 130, height: 200, offsetTop: 200, offsetLeft: 80 }); viewport.dispatchEvent(new h.window.Event('scroll'));
  assert.deepEqual(bounds(), ['390px', '600px', '0px', '0px']);
  Object.assign(viewport, { scale: 1, width: 390, height: 720, offsetTop: 14, offsetLeft: 0 }); viewport.dispatchEvent(new h.window.Event('resize'));
  assert.deepEqual(bounds(), ['390px', '720px', '14px', '0px']);
  viewport.height = 480; viewport.offsetTop = 80; viewport.dispatchEvent(new h.window.Event('resize'));
  assert.deepEqual(bounds(), ['390px', '480px', '80px', '0px']);
  viewport.width = 320; viewport.height = 600; viewport.offsetTop = 0; h.window.dispatchEvent(new h.window.Event('resize'));
  assert.deepEqual(bounds(), ['320px', '600px', '0px', '0px']);
});

test('profile photo route, account and pagehide cleanup removes all fit callbacks without changing the detached dialog', async t => {
  for (const kind of ['route', 'account', 'pagehide']) {
    const h = harness(t); await h.ready(); const viewport = new h.window.EventTarget();
    Object.assign(viewport, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    const active = new Set(); const windowActive = new Set();
    const add = viewport.addEventListener.bind(viewport), remove = viewport.removeEventListener.bind(viewport);
    viewport.addEventListener = (name, listener, options) => { active.add(listener); add(name, listener, options); };
    viewport.removeEventListener = (name, listener, options) => { remove(name, listener, options); if (name === 'resize') active.delete(listener); };
    const windowAdd = h.window.addEventListener.bind(h.window), windowRemove = h.window.removeEventListener.bind(h.window);
    h.window.addEventListener = (name, listener, options) => { if (name === 'resize') windowActive.add(listener); windowAdd(name, listener, options); };
    h.window.removeEventListener = (name, listener, options) => { if (name === 'resize') windowActive.delete(listener); windowRemove(name, listener, options); };
    Object.defineProperty(h.window, 'visualViewport', { configurable: true, value: viewport });
    h.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
    h.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
    h.api.save(item('photo', { media: [{ type: 'image', url: 'https://images.example/photo.jpg', poster: '' }] })); await h.select('favorites');
    h.document.querySelector('.ct-profile-photo').click(); const dialog = h.document.querySelector('dialog');
    const previous = dialog.getAttribute('style'); assert.equal(active.size, 1); assert.equal(windowActive.size, 1);
    if (kind === 'route') { h.route('/user/alice', 'alice'); h.api.patch(); }
    else if (kind === 'account') { h.setAuth({ uid: 'uid-other', token: 'token-other' }, 'other'); h.api.patch(); }
    else h.window.dispatchEvent(new h.window.Event('pagehide'));
    await tick(); assert.equal(h.api.state.viewer, null); assert.equal(dialog.isConnected, false);
    assert.equal(active.size, 0); assert.equal(windowActive.size, 0);
    viewport.width = 320; viewport.height = 500; viewport.dispatchEvent(new h.window.Event('resize')); viewport.dispatchEvent(new h.window.Event('scroll')); h.window.dispatchEvent(new h.window.Event('resize'));
    assert.equal(dialog.getAttribute('style'), previous);
  }
});

test('profile photo sources or removed triggers close stale viewers while ordinary reused metadata keeps them open', async t => {
  for (const change of ['replace', 'remove', 'gallery']) {
    const h = harness(t); await h.ready();
    h.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
    h.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
    h.api.save(item('photo', { createdAt: '2026-01-01T00:00:00Z', media: [{ type: 'image', url: 'https://images.example/original.jpg', poster: '' }] })); await h.select('favorites');
    const trigger = h.document.querySelector('.ct-profile-photo'); trigger.click(); const dialog = h.document.querySelector('dialog');
    const viewer = h.api.state.viewer; const time = h.document.querySelector('.ct-profile-time'); time.textContent = 'Updated display time';
    h.history({ source: 'following', pages: 2, scanned: 40, recovered: 1, busy: true });
    assert.equal(h.api.state.viewer, viewer); assert.equal(dialog.isConnected, true); assert.equal(trigger.isConnected, true);
    assert.equal(h.document.querySelector('.ct-profile-time'), time); assert.equal(time.textContent, 'Updated display time');
    if (change === 'replace') h.api.save(item('photo', { createdAt: '2026-01-01T00:00:00Z', media: [{ type: 'image', url: 'https://images.example/replaced.jpg', poster: '' }] }));
    else if (change === 'remove') h.api.remove('photo');
    else { trigger.querySelector('img').src = 'https://images.example/changed.jpg'; h.history({ source: 'following', pages: 3, scanned: 60, recovered: 1, busy: true }); }
    assert.equal(h.api.state.viewer, null); assert.equal(dialog.isConnected, false);
    assert.equal(h.document.activeElement, change === 'gallery' ? trigger : h.document.getElementById('ct-favorites-tab'));
  }
});

test('local profile videos gain shared fullscreen handling only after mounting and keep their existing nodes', async t => {
  const h = harness(t); await h.ready(); const mounted = new Set();
  h.window.ctMediaEnhanceVideo = video => { assert.equal(video.isConnected, true); mounted.add(video); };
  h.api.save(item('video', { media: [{ type: 'video', url: 'https://images.example/video.mp4', poster: '' }] })); await h.select('favorites');
  const video = h.document.querySelector('video'); assert.ok(mounted.has(video)); video.currentTime = 16;
  h.history({ source: 'following', pages: 2, scanned: 40, recovered: 1, paused: true });
  assert.equal(h.document.querySelector('video'), video); assert.equal(video.currentTime, 16); assert.equal(mounted.size, 1);
});

test('normal Media and Favorites start with one compact toolbar followed immediately by Tweets in both locales', async t => {
  for (const locale of ['ja', 'en']) {
    const h = harness(t, { locale }); await h.ready(); h.api.save(item('favorite'));
    h.pages([{ posts: [post('photo')], nextCursor: null }]); await h.select('media');
    let panel = h.document.getElementById('ct-media-panel');
    assert.ok(panel.firstElementChild.hasAttribute('data-ct-media-tools'));
    assert.equal(panel.firstElementChild.nextElementSibling.dataset.ctProfilePost, 'photo');
    assert.equal(panel.querySelector('.ct-profile-details').open, false);
    assert.match(h.document.getElementById('ct-profile-media-count').getAttribute('aria-label'), locale === 'ja' ? /投稿1件・返信0件を確認/ : /1 posts and 0 replies checked/);
    await h.select('favorites'); panel = h.document.getElementById('ct-favorites-panel');
    assert.ok(panel.firstElementChild.hasAttribute('data-ct-favorite-tools'));
    assert.equal(panel.firstElementChild.nextElementSibling.dataset.ctProfilePost, 'favorite');
    assert.equal(panel.querySelector('.ct-profile-details').open, false);
    const count = h.document.getElementById('ct-favorite-count');
    assert.equal(count.textContent, locale === 'ja' ? '保存1件 · 表示1/1件' : '1 saved · 1/1 shown');
    assert.equal(count.title, count.getAttribute('aria-label')); assert.equal(count.getAttribute('role'), 'status');
    assert.equal(panel.querySelector('input:not([type=file]),select'), null);
    for (const control of [h.document.getElementById('ct-favorite-refresh'), panel.querySelector('summary')]) {
      const style = h.window.getComputedStyle(control);
      assert.equal(style.minHeight, '44px');
      assert.ok(control.textContent.trim());
    }
    const style = h.window.getComputedStyle(h.document.getElementById('ct-favorite-refresh'));
    assert.equal(style.borderTopWidth, '0px'); assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)');
  }
});

test('Favorite coverage and backup disclosure keeps its native open state, focus and video through progress changes', async t => {
  const h = harness(t); await h.ready();
  h.api.save(item('video', { createdAt: '2026-01-01T00:00:00Z', media: [{ type: 'video', url: 'https://media.example/movie.mp4', poster: '' }] }));
  await h.select('favorites'); const panel = h.document.getElementById('ct-favorites-panel');
  const details = panel.querySelector('details'); const summary = details.querySelector('summary');
  const calls = h.calls.length; summary.click(); await tick(); summary.focus();
  assert.equal(details.open, true); assert.equal(h.document.activeElement, summary);
  assert.ok(details.contains(h.document.getElementById('ct-favorite-range')));
  assert.ok(details.contains(h.document.getElementById('ct-favorite-history-scope')));
  assert.ok(details.contains(h.document.getElementById('ct-favorite-export')));
  assert.ok(details.contains(h.document.getElementById('ct-favorite-import')));
  const video = panel.querySelector('video'); video.currentTime = 15;
  h.history({ source: 'following', pages: 8, scanned: 160, recovered: 4, busy: true });
  assert.equal(panel.querySelector('details'), details); assert.equal(details.open, true);
  assert.equal(h.document.activeElement, summary); assert.equal(panel.querySelector('video'), video); assert.equal(video.currentTime, 15);
  assert.match(h.document.getElementById('ct-favorite-history-scope').textContent, /8 pages.*160 posts checked.*4 recovered/);
  assert.equal(h.calls.length, calls); summary.click(); await tick(); assert.equal(details.open, false);
});

test('Media keeps coverage disclosure and video while a later reply response updates counts', async t => {
  const h = harness(t); await h.ready(); let release;
  h.pages([{ posts: [post('video', [{ media_type: 'video', public_url: 'https://media.example/movie.mp4' }])], nextCursor: null }]);
  h.override(endpoint => endpoint.pathname.endsWith('/replies') ? new Promise(resolve => { release = resolve; }) : undefined);
  await h.select('media'); const panel = h.document.getElementById('ct-media-panel');
  const tools = panel.firstElementChild; const details = tools.querySelector('details'); const summary = details.querySelector('summary');
  summary.click(); await tick(); summary.focus(); const video = panel.querySelector('video'); video.currentTime = 11;
  release({ replies: [{ post: post('reply', undefined, { parentId: 'parent' }) }] }); await tick();
  assert.equal(panel.firstElementChild, tools); assert.equal(tools.querySelector('details'), details); assert.equal(details.open, true);
  assert.equal(h.document.activeElement, summary); assert.equal(panel.querySelector('video'), video); assert.equal(video.currentTime, 11);
  assert.equal(panel.querySelector('[data-ct-profile-post=reply]').isConnected, true);
  assert.match(h.document.getElementById('ct-profile-media-count').getAttribute('aria-label'), /1 posts and 1 replies checked/);
});

test('empty and failed profile loads retain readable status and an explicit retry outside collapsed details', async t => {
  const h = harness(t); await h.ready(); await h.select('favorites');
  let panel = h.document.getElementById('ct-favorites-panel');
  assert.equal(panel.querySelector('.ct-profile-empty').getAttribute('role'), 'status');
  assert.match(panel.querySelector('.ct-profile-empty').textContent, /No Favorites saved yet/);
  h.api.save(item('saved')); h.override(endpoint => endpoint.pathname === '/api/users/muted' ? null : undefined);
  h.document.getElementById('ct-favorite-refresh').click(); await tick();
  const error = panel.querySelector(':scope > .ct-profile-status[role=status]');
  assert.match(error.textContent, /Muted accounts could not be checked/); assert.equal(error.closest('details'), null);
  assert.equal(panel.querySelector('details').open, false); assert.equal(h.document.getElementById('ct-favorite-count').textContent, '1 saved · Not checked');
  assert.match(h.document.getElementById('ct-favorite-range').textContent, /muted and blocked accounts not checked/);
  const retry = favoriteControl(h, 'Try again'); assert.ok(error.contains(retry));
  assert.equal(h.window.getComputedStyle(retry).minHeight, '44px');
  h.override(null); retry.click(); await tick(); assert.deepEqual(favoriteRows(h), ['saved']);
  assert.equal(panel.firstElementChild.nextElementSibling.dataset.ctProfilePost, 'saved');
  h.override(endpoint => endpoint.pathname.endsWith('/posts') ? null : undefined); await h.select('media');
  panel = h.document.getElementById('ct-media-panel');
  assert.match(panel.querySelector(':scope > .ct-profile-status[role=status]').textContent, /could not be loaded/);
  assert.equal(panel.querySelector('.ct-profile-empty').getAttribute('role'), 'status');
  assert.match(panel.querySelector('.ct-profile-empty').textContent, /could not be loaded.*try again/);
  assert.ok([...panel.querySelectorAll(':scope > .ct-profile-status button')].some(button => button.textContent === 'Try again'));
});

test('long backup errors and storage warnings remain visible outside details and preserve complete text', async t => {
  const h = harness(t); await h.ready(); h.api.save(item('saved')); await h.select('favorites');
  const panel = h.document.getElementById('ct-favorites-panel'); const view = h.api.state.favoriteView;
  const text = 'Backup failed <script> & '.repeat(80); view.message = text; view.error = true; h.api.render();
  const message = h.document.getElementById('ct-favorite-backup-status');
  assert.equal(message.textContent, text); assert.equal(message.querySelector('script'), null);
  assert.equal(message.closest('details'), null); assert.equal(panel.querySelector('details').open, false);
  assert.equal(message.getAttribute('role'), 'status'); assert.equal(message.getAttribute('aria-live'), 'polite');
  assert.equal(h.window.getComputedStyle(message).overflowWrap, 'anywhere');
  h.api.state.dirtyMemory.add('uid-viewer'); h.api.render();
  const warning = h.document.getElementById('ct-favorite-storage-status');
  assert.match(warning.textContent, /Browser storage is unavailable.*Save a backup before closing/);
  assert.equal(warning.closest('details'), null); assert.equal(warning.getAttribute('role'), 'status');
  view.message = ''; view.error = false; h.api.state.dirtyMemory.delete('uid-viewer'); h.api.render();
  assert.equal(message.textContent, ''); assert.equal(warning.textContent, '');
  assert.equal(h.window.getComputedStyle(message).display, 'none'); assert.equal(h.window.getComputedStyle(warning).display, 'none');
  assert.equal(panel.firstElementChild.nextElementSibling.dataset.ctProfilePost, 'saved');
});

async function photoGestures(t, { pointer = true, ready = true, count = 4, locale = 'en' } = {}) {
  const h = harness(t, { locale }); await h.ready();
  const reduce = new h.window.EventTarget(); reduce.matches = false; h.window.matchMedia = () => reduce;
  const viewport = new h.window.EventTarget(); Object.assign(viewport, { width: 390, height: 844, scale: 1, offsetTop: 0, offsetLeft: 0 });
  Object.defineProperty(h.window, 'visualViewport', { configurable: true, value: viewport });
  if (pointer) h.window.PointerEvent = function PointerEvent() {};
  else h.window.PointerEvent = undefined;
  h.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  h.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  const preparations = [], frames = new Map(), timers = new Map(); let serial = 0;
  h.window.HTMLImageElement.prototype.decode = function() {
    return new Promise((resolve, reject) => preparations.push({ image: this, resolve, reject }));
  };
  const media = Array.from({ length: count }, (_, index) => ({ type: 'image', url: `https://images.example/gesture-${index}.jpg`, poster: '' }));
  h.api.save(item('gesture', { media })); await h.select('favorites');
  h.window.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  h.window.cancelAnimationFrame = id => frames.delete(id);
  h.window.setTimeout = callback => { const id = ++serial; timers.set(id, callback); return id; };
  h.window.clearTimeout = id => timers.delete(id);
  const trigger = h.document.querySelector('.ct-profile-photo'); trigger.click();
  const dialog = h.document.querySelector('dialog'), stage = dialog.querySelector('.ct-profile-viewer-stage'), image = stage.querySelector(':scope > img');
  Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 390 });
  const loaded = node => {
    for (const [key, value] of Object.entries({ complete: true, naturalWidth: 1600, naturalHeight: 1200, currentSrc: node.src })) Object.defineProperty(node, key, { configurable: true, value });
  };
  const prepare = async index => {
    const entry = preparations.find(entry => entry.image.src === media[index].url); assert.ok(entry, `prepared photo ${index}`);
    loaded(entry.image); entry.resolve(); await new Promise(resolve => setImmediate(resolve));
  };
  if (ready && count > 1) { await prepare(0); await prepare(1); }
  const pointerEvent = (name, x, y = 200, extra = {}) => {
    const event = new h.window.Event(name, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y, ...extra }); image.dispatchEvent(event); return event;
  };
  const touchEvent = (name, points, changed = points) => {
    const event = new h.window.Event(name, { bubbles: true, cancelable: true });
    Object.assign(event, { touches: points.map(([x, y]) => ({ clientX: x, clientY: y })), changedTouches: changed.map(([x, y]) => ({ clientX: x, clientY: y })) }); image.dispatchEvent(event); return event;
  };
  return Object.assign(h, { dialog, stage, image, trigger, viewport, reduce, preparations, frames, timers, prepare, loaded, pointerEvent, touchEvent,
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    swipe(from = 300, to = 100) { pointerEvent('pointerdown', from); pointerEvent('pointermove', to); pointerEvent('pointerup', to); }
  });
}

test('profile photo pointer drag follows each animation frame and settles while preserving the original image, controls and focus', async t => {
  const h = await photoGestures(t); const calls = h.calls.length;
  h.pointerEvent('pointerdown', 300); const drag = h.pointerEvent('pointermove', 170);
  const track = h.stage.querySelector('.ct-profile-photo-track'); assert.ok(track); assert.equal(drag.defaultPrevented, true);
  assert.equal(track.parentElement.getAttribute('aria-hidden'), 'true'); assert.equal(track.children.length, 3);
  assert.equal(track.style.transform, 'translate3d(-100%,0,0)'); assert.equal(h.frames.size, 1);
  h.pointerEvent('pointermove', 140); assert.equal(h.frames.size, 1); h.flushFrames();
  assert.equal(track.style.transform, 'translate3d(calc(-100% + -160px),0,0)');
  h.pointerEvent('pointerup', 140); assert.equal(h.api.state.viewer.index, 1);
  assert.equal(h.image.src, 'https://images.example/gesture-1.jpg'); assert.equal(track.style.transform, 'translate3d(-200%,0,0)');
  assert.match(track.style.transition, /220ms/); assert.equal(h.stage.querySelector(':scope > img'), h.image);
  assert.equal(h.dialog.querySelector('.ct-profile-viewer-nav span').textContent, '2 / 4');
  h.loaded(h.image); h.flushTimers(); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
  assert.equal(h.image.classList.contains('ct-profile-photo-covered'), false); assert.equal(h.preparations.length, 3);
  assert.equal(h.calls.length, calls); h.dialog.querySelector('[aria-label=Close]').click(); assert.equal(h.document.activeElement, h.trigger);
});

test('profile TouchEvent fallback moves once and a short or edge swipe returns smoothly without changing the photo', async t => {
  const h = await photoGestures(t, { pointer: false, count: 2, locale: 'ja' });
  h.touchEvent('touchstart', [[100, 200]]); h.touchEvent('touchmove', [[220, 200]]); h.flushFrames();
  assert.equal(h.stage.querySelector('.ct-profile-photo-track').style.transform, 'translate3d(calc(-100% + 26.4px),0,0)');
  h.touchEvent('touchend', [], [[220, 200]]); assert.equal(h.api.state.viewer.index, 0); h.flushTimers();
  h.touchEvent('touchstart', [[300, 200]]); h.touchEvent('touchmove', [[100, 202]]); h.touchEvent('touchend', [], [[100, 202]]);
  assert.equal(h.api.state.viewer.index, 1); assert.match(h.image.alt, /写真 2\/2/);
  h.loaded(h.image); h.flushTimers();
  h.touchEvent('touchstart', [[100, 200]]); h.touchEvent('touchmove', [[115, 200]]); h.touchEvent('touchend', [], [[115, 200]]);
  assert.equal(h.api.state.viewer.index, 1); assert.equal(h.stage.querySelector('.ct-profile-photo-track').style.transform, 'translate3d(-100%,0,0)');
  h.flushTimers(); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
});

test('profile photo keeps the currently displayed image until an undecoded destination becomes ready and ignores expired preparation', async t => {
  const h = await photoGestures(t, { ready: false, count: 2 }); await h.prepare(0);
  h.swipe(); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
  assert.equal(h.api.state.viewer.index, 0); assert.equal(h.image.src, 'https://images.example/gesture-0.jpg');
  assert.equal(h.image.classList.contains('ct-profile-photo-covered'), false);
  const undecoded = h.preparations.find(entry => entry.image.src.endsWith('gesture-1.jpg')).image;
  h.loaded(undecoded); undecoded.dispatchEvent(new h.window.Event('load'));
  assert.equal(h.api.state.viewer.index, 0, 'load alone must not expose a photo before its decode promise resolves');
  await h.prepare(1); assert.equal(h.api.state.viewer.index, 1); assert.equal(h.image.src, 'https://images.example/gesture-1.jpg');
  const expired = await photoGestures(t, { ready: false, count: 2 }); expired.swipe(); expired.flushTimers();
  await expired.prepare(1); assert.equal(expired.api.state.viewer.index, 0); assert.equal(expired.image.src, 'https://images.example/gesture-0.jpg');
});

test('failed profile photo preparation preserves the visible image and existing button and keyboard navigation', async t => {
  const h = await photoGestures(t, { ready: false, count: 2 });
  h.preparations.find(entry => entry.image.src.endsWith('gesture-1.jpg')).reject(new Error('Decode failed')); await Promise.resolve();
  h.swipe(); assert.equal(h.image.src, 'https://images.example/gesture-0.jpg'); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
  h.dialog.querySelector('[aria-label="Next photo"]').click(); assert.equal(h.image.src, 'https://images.example/gesture-1.jpg');
  h.dialog.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(h.image.src, 'https://images.example/gesture-0.jpg');
});

test('vertical movement, a second pointer and pinch followed by one finger preserve browser gestures and never switch profile photos', async t => {
  for (const kind of ['vertical', 'pointer-pinch', 'touch-pinch', 'touch-cancel']) {
    const h = await photoGestures(t, { pointer: kind !== 'touch-pinch' && kind !== 'touch-cancel', count: 2 });
    if (kind === 'vertical') {
      h.pointerEvent('pointerdown', 300, 100); const event = h.pointerEvent('pointermove', 260, 240); assert.equal(event.defaultPrevented, false);
      h.pointerEvent('pointerup', 50, 300);
    } else if (kind === 'pointer-pinch') {
      h.pointerEvent('pointerdown', 300); h.pointerEvent('pointermove', 240);
      const event = h.pointerEvent('pointerdown', 100, 200, { pointerId: 2, isPrimary: false }); assert.equal(event.defaultPrevented, false);
      assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
      h.pointerEvent('pointerup', 100, 200, { pointerId: 2, isPrimary: false }); h.pointerEvent('pointermove', 50); h.pointerEvent('pointerup', 50);
    } else {
      h.touchEvent('touchstart', [[300, 200]]); h.touchEvent('touchmove', [[240, 200]]);
      const event = h.touchEvent('touchstart', [[240, 200], [100, 200]]); assert.equal(event.defaultPrevented, false);
      assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
      h.touchEvent(kind === 'touch-cancel' ? 'touchcancel' : 'touchend', [[240, 200]], [[100, 200]]);
      assert.equal(h.touchEvent('touchmove', [[50, 200]]).defaultPrevented, false); h.touchEvent('touchend', [], [[50, 200]]);
    }
    assert.equal(h.api.state.viewer.index, 0); assert.equal(h.image.src, 'https://images.example/gesture-0.jpg');
  }
});

test('zoom cancels active profile photo motion without refitting the magnified image or preventing zoomed pan', async t => {
  const h = await photoGestures(t, { count: 2 }); const style = h.dialog.getAttribute('style');
  h.pointerEvent('pointerdown', 300); h.pointerEvent('pointermove', 220); assert.ok(h.stage.querySelector('.ct-profile-photo-layer'));
  Object.assign(h.viewport, { scale: 2, width: 195, height: 422, offsetTop: 80, offsetLeft: 35 }); h.viewport.dispatchEvent(new h.window.Event('resize'));
  assert.equal(h.dialog.getAttribute('style'), style); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null); assert.equal(h.frames.size, 0);
  h.pointerEvent('pointermove', 40); h.pointerEvent('pointerup', 40); assert.equal(h.api.state.viewer.index, 0);
  h.pointerEvent('pointerdown', 300); assert.equal(h.pointerEvent('pointermove', 40).defaultPrevented, false); h.pointerEvent('pointerup', 40);
  assert.equal(h.api.state.viewer.index, 0); assert.equal(h.dialog.classList.contains('ct-profile-viewer-zoomed'), true);
  h.api.viewerClose(); assert.equal(h.dialog.isConnected, false); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
});

test('reduced motion changes cancel profile photo animation and retain instant accessible navigation', async t => {
  const h = await photoGestures(t, { count: 2 }); h.pointerEvent('pointerdown', 300); h.pointerEvent('pointermove', 220);
  h.reduce.matches = true; h.reduce.dispatchEvent(new h.window.Event('change'));
  assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null); assert.equal(h.frames.size, 0); h.pointerEvent('pointerup', 40);
  assert.equal(h.api.state.viewer.index, 0); h.swipe(); assert.equal(h.api.state.viewer.index, 1);
  assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null); h.dialog.querySelector('[aria-label="Previous photo"]').click();
  assert.equal(h.api.state.viewer.index, 0);
});

test('close, route, account and background changes discard profile photo frames, timers, capture and late decoded images', async t => {
  for (const kind of ['close', 'route', 'account', 'pagehide', 'background']) {
    const h = await photoGestures(t, { count: 2 }); const captures = new Set();
    h.image.setPointerCapture = id => captures.add(id); h.image.releasePointerCapture = id => captures.delete(id);
    h.pointerEvent('pointerdown', 300); h.pointerEvent('pointermove', 220); assert.equal(captures.size, 1); assert.equal(h.frames.size, 1);
    if (kind === 'close') h.api.viewerClose();
    else if (kind === 'route') { h.route('/feed', 'viewer'); h.api.patch(); }
    else if (kind === 'account') { h.setAuth({ uid: 'uid-other', token: 'token-other' }); h.api.patch(); }
    else if (kind === 'pagehide') h.window.dispatchEvent(new h.window.Event('pagehide'));
    else { Object.defineProperty(h.document, 'hidden', { configurable: true, value: true }); h.document.dispatchEvent(new h.window.Event('visibilitychange')); }
    assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0); assert.equal(captures.size, 0); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
    for (const entry of h.preparations) { h.loaded(entry.image); entry.resolve(); } await Promise.resolve();
    h.flushFrames(); h.flushTimers(); assert.equal(h.image.src, 'https://images.example/gesture-0.jpg');
    if (kind !== 'background') assert.equal(h.api.state.viewer, null);
  }
});

test('a profile keyboard or button action interrupts slide presentation and a stale image load cannot release a newer destination', async t => {
  const h = await photoGestures(t); h.swipe(); const firstTrack = h.stage.querySelector('.ct-profile-photo-track');
  h.dialog.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(h.api.state.viewer.index, 0); assert.equal(firstTrack.isConnected, false); assert.equal(h.timers.size, 0);
  h.swipe(); h.flushTimers(); assert.ok(h.stage.querySelector('.ct-profile-photo-layer'));
  Object.defineProperties(h.image, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: 1600 },
    currentSrc: { configurable: true, value: 'https://images.example/gesture-0.jpg' } }); h.image.dispatchEvent(new h.window.Event('load'));
  assert.ok(h.stage.querySelector('.ct-profile-photo-layer'));
  h.loaded(h.image); h.image.dispatchEvent(new h.window.Event('load')); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
  assert.equal(h.dialog.querySelector('.ct-profile-viewer-nav span').textContent, '2 / 4');
});

test('reversing a profile photo drag fills a newly decoded opposite pane before sliding onto it', async t => {
  const h = await photoGestures(t, { ready: false, count: 3 });
  await h.prepare(1); h.dialog.querySelector('[aria-label="Next photo"]').click(); await h.prepare(2);
  assert.equal(h.api.state.viewer.index, 1);
  h.pointerEvent('pointerdown', 300); h.pointerEvent('pointermove', 180);
  const track = h.stage.querySelector('.ct-profile-photo-track');
  assert.ok(track); assert.equal(track.children[0].querySelector('img'), null);
  assert.equal(track.children[1].querySelector('img').src, 'https://images.example/gesture-1.jpg');
  assert.equal(track.children[2].querySelector('img').src, 'https://images.example/gesture-2.jpg');
  await h.prepare(0);
  assert.equal(track.children[0].querySelector('img').src, 'https://images.example/gesture-0.jpg');
  h.pointerEvent('pointermove', 420); h.flushFrames();
  assert.equal(track.style.transform, 'translate3d(calc(-100% + 120px),0,0)');
  h.pointerEvent('pointerup', 420); assert.equal(h.api.state.viewer.index, 0);
  assert.equal(track.style.transform, 'translate3d(0%,0,0)');
  assert.equal(h.image.classList.contains('ct-profile-photo-covered'), true);
  assert.equal(track.children[0].querySelector('img').src, h.image.src);
  h.loaded(h.image); h.flushTimers(); assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null);
  assert.equal(h.image.classList.contains('ct-profile-photo-covered'), false);
});

test('a reversed profile photo drag toward an undecoded neighbor retains the center photo until preparation completes', async t => {
  const h = await photoGestures(t, { ready: false, count: 3 });
  await h.prepare(1); h.dialog.querySelector('[aria-label="Next photo"]').click(); await h.prepare(2);
  h.pointerEvent('pointerdown', 300); h.pointerEvent('pointermove', 180);
  const track = h.stage.querySelector('.ct-profile-photo-track'); assert.ok(track);
  h.pointerEvent('pointermove', 420); h.flushFrames();
  assert.equal(track.children[0].querySelector('img'), null);
  assert.equal(track.style.transform, 'translate3d(calc(-100% + 0px),0,0)');
  assert.equal(track.children[1].querySelector('img').src, h.image.src);
  h.pointerEvent('pointerup', 420); assert.equal(h.api.state.viewer.index, 1);
  assert.equal(h.stage.querySelector('.ct-profile-photo-layer'), null); assert.equal(h.image.classList.contains('ct-profile-photo-covered'), false);
  await h.prepare(0); assert.equal(h.api.state.viewer.index, 0); assert.equal(h.image.src, 'https://images.example/gesture-0.jpg');
});
