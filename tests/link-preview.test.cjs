const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/link-preview.js'), 'utf8');
const timestamps = fs.readFileSync(path.join(__dirname, '../src/timestamps.js'), 'utf8');
const destination = 'https://example.org/article?topic=web#section';
const metadata = '<!doctype html><html><head><meta property="og:title" content="Real title &amp; details"><meta property="og:description" content="Real description"><meta property="og:site_name" content="Example"><title>Fallback</title></head><body><script>window.untrusted=true</script></body></html>';
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function native(url = destination, id = 'post') {
  return `<article id="${id}"><div class="flex-1 min-w-0"><div class="flex items-center"><button class="font-bold truncate">Alice</button><span>·</span><span title="2026-10-10T00:00:00Z">1m</span></div><p class="tl-user-text whitespace-pre-wrap break-words">My original <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p><button class="native-action">Like</button></div></article>`;
}
function timestampedNative(url = destination, id = 'post') {
  return `<article id="${id}"><div class="flex-1 min-w-0"><div class="flex items-start justify-between gap-2"><div class="min-w-0 flex-1"><div class="flex items-center gap-1 min-w-0 flex-wrap"><button class="font-bold truncate">Alice</button><span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted hover:underline" title="2026-10-10T00:00:00Z">1m</span></div><p aria-live="polite"><button class="translation-toggle">Show translation</button></p></div></div><p class="tl-user-text whitespace-pre-wrap break-words">My original <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p><button class="native-action">Like</button></div></article>`;
}
function translateNative(h, body = h.doc.querySelector('article p.tl-user-text'), url = destination) {
  body.innerHTML = `翻訳された文章 <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  body.previousElementSibling.querySelector('.translation-toggle').textContent = 'Show original';
}
function harness(t, options = {}) {
  const dom = new JSDOM(`<!doctype html><head></head><body><main>${options.html || native()}</main></body>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window, calls = [], timers = new Map(), objects = new Set(), revoked = [];
  let serial = 0, observer = null;
  w.setTimeout = callback => { timers.set(++serial, callback); return serial; }; w.clearTimeout = id => timers.delete(id);
  w.ctNetworkState = { authUID: 'account-a' }; w.ctPageActive = true;
  let enabled = options.enabled !== false; w.ctGetLinkPreviewsEnabled = () => enabled;
  if (!options.noObserver) w.IntersectionObserver = class {
    constructor(callback, settings) { this.callback = callback; this.settings = settings; this.targets = new Set(); observer = this; }
    observe(target) { this.targets.add(target); } unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  w.URL.createObjectURL = () => { const value = 'blob:https://app.tweet.app/' + ++serial; objects.add(value); return value; };
  w.URL.revokeObjectURL = value => { revoked.push(value); objects.delete(value); };
  const defaultGM = details => { const call = { details, aborted: 0 }; calls.push(call);
    return { abort() { call.aborted++; details.onabort({ status: 0 }); details.onloadend({ status: 0 }); } }; };
  if (options.modernGM) w.GM = options.modernGM;
  else if (options.gm !== false) w.GM_xmlhttpRequest = options.gm || defaultGM;
  w.eval(`const CT_LOCALE='${options.locale || 'en'}'; ${options.timestamps ? timestamps : ''} ${source}
    window.qa={patch:ctLinkPreviewsPatch,cleanup:ctLinkPreviewsCleanup,url:ctLinkPreviewURL,first:ctLinkPreviewFirstURL,
      parse:ctLinkPreviewParse,request:ctLinkPreviewRequest,state:ctLinkPreviewState,limits:ctLinkPreviewLimits,
      source:ctLinkPreviewSource,cache:ctLinkPreviewCache,deleteCache:ctLinkPreviewDeleteCache};`);
  const h = { w, doc: w.document, qa: w.qa, calls, timers, objects, revoked,
    enabled: value => { enabled = value; },
    observer: () => observer,
    intersections(entries) { observer.callback(entries.map(([target, visible]) => ({ target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }))); },
    show(target, visible = true) { const targets = target ? [target] : [...observer.targets]; this.intersections(targets.map(node => [node, visible])); },
    respond(index, html = metadata, changes = {}) { const details = calls[index].details;
      const response = { status: 200, readyState: 4, responseText: html, finalUrl: details.url, responseHeaders: 'Content-Type: text/html', ...changes };
      details.onload(response); details.onloadend(response); },
    expire() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    async ready() { w.qa.patch(); this.show(); await flush(); }
  };
  t.after(() => { w.qa.cleanup(); w.close(); }); return h;
}

test('only public HTTPS destinations without credentials can be read; navigation keeps signed query', t => {
  const h = harness(t);
  for (const url of ['http://example.org/a', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@example.org/',
    'https://localhost/a', 'https://foo.local/a', 'https://foo.internal/a', 'https://home.arpa/a',
    'https://127.0.0.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://[::1]/a', 'https://169.254.169.254/a',
    'https://192.168.1.1/a', 'https://example.org:8443/a', 'https://app.tweet.app/post/a', 'https://api.tweet.app/a']) {
    assert.equal(h.qa.url(url), '', url);
  }
  for (const key of ['token', 'key', 'secret', 'auth', 'password', 'signature', 'sig', 'code', 'access_token',
    'oauth_token', 'password_reset_token', 'session', 'jwt', 'saml', 'sso', 'AWSAccessKeyId', 'private_key', 'X-Amz-Signature', 'X-Goog-Credential']) {
    const url = `https://example.org/a?${key}=private`;
    assert.equal(h.qa.url(url), '', key); assert.equal(h.qa.url(url, '', false), url);
  }
  assert.equal(h.qa.url('https://EXAMPLE.org:443/a?topic=web'), 'https://example.org/a?topic=web');
  assert.equal(h.qa.url('/photo.png', 'https://example.org/article'), 'https://example.org/photo.png');
  assert.equal(h.qa.first('Read (https://example.org/a). Then https://other.org/b'), 'https://example.org/a');
});

test('metadata chooses OGP, preserves text safely and never parses external body resources', t => {
  const h = harness(t);
  const result = h.qa.parse(metadata.replace('</head>', '<meta property="og:image" content="/real.png"><meta name="twitter:image" content="https://other.org/second.webp"><base href="https://evil.org/"></head>'), destination);
  assert.equal(result.title, 'Real title & details'); assert.equal(result.description, 'Real description');
  assert.deepEqual(Array.from(result.images), ['https://example.org/real.png', 'https://other.org/second.webp']);
  assert.equal(h.w.untrusted, undefined); assert.equal(h.doc.querySelector('script,iframe'), null);
  const literal = h.qa.parse('<html><head><meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;"><meta property="og:image" content="javascript:alert(1)"><title>Other</title></head></html>', destination);
  assert.equal(literal.title, '<img src=x onerror=alert(1)>'); assert.equal(literal.images.length, 0);
  assert.equal(h.qa.parse('<html><head><title>Page &amp; title</title></head></html>', destination).title, 'Page & title');
  const fake = h.qa.parse('<html><head><!-- <meta property="og:title" content="Comment fake"> -->' +
    '<script>const fake = \'<meta property="og:title" content="Script fake">\';</script>' +
    '<style>/* <meta property="og:title" content="Style fake"> */</style><title>Real fallback</title></head></html>', destination);
  assert.equal(fake.title, 'Real fallback');
  assert.equal(h.qa.parse('<html><body>No declared metadata</body></html>', destination).title, 'example.org');
  for (const value of ['Denied', '<!ENTITY unsafe>', 'x'.repeat(h.qa.limits.text + 1)]) assert.equal(h.qa.parse(value, destination), null);
});

test('native body and handlers stay intact; first visible URL gains one owned card', async t => {
  const h = harness(t); const body = h.doc.querySelector('p'), original = body.innerHTML, anchor = body.querySelector('a');
  let anchorClicks = 0, nativeClicks = 0, postClicks = 0;
  anchor.addEventListener('click', () => anchorClicks++); h.doc.querySelector('.native-action').addEventListener('click', () => nativeClicks++);
  h.doc.querySelector('article').addEventListener('click', () => postClicks++);
  h.qa.patch(); assert.equal(h.calls.length, 0); assert.equal(h.doc.querySelectorAll('.ct-link-preview').length, 1);
  h.show(); assert.equal(h.calls.length, 1); h.respond(0); await flush(); h.qa.patch();
  assert.equal(body.innerHTML, original); assert.equal(body.querySelector('a'), anchor); assert.equal(h.doc.querySelectorAll('.ct-link-preview').length, 1);
  assert.equal(h.doc.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
  const cardLink = h.doc.querySelector('.ct-link-preview a'); assert.equal(cardLink.href, destination); assert.equal(cardLink.rel, 'noopener noreferrer');
  h.doc.querySelector('.native-action').click(); assert.equal(nativeClicks, 1); assert.equal(postClicks, 1);
  h.doc.querySelector('.ct-link-preview button').click(); assert.equal(postClicks, 1); assert.equal(anchorClicks, 0);
  assert.match(h.qa.state.style.textContent, /min-height:44px/); assert.match(h.qa.state.style.textContent, /prefers-reduced-motion:reduce/);
  assert.match(h.qa.state.style.textContent, /\.ct-link-preview button\{[^}]*color:var\(--color-tl-app-text,#14171a\)/);
});

test('quotes, polls, translated bodies, drafts, bio and notifications are protected', t => {
  const h = harness(t, { html: native() + '<p class="tl-user-text whitespace-pre-wrap break-words">Bio <a href="https://bio.org/">bio</a></p>' });
  const original = h.doc.querySelector('article');
  const cases = [
    ['blockquote', {}], ['div', { 'aria-label': 'Quoted post by Bob' }], ['div', { 'data-ct-owned': 'translation' }],
    ['fieldset', {}], ['div', { contenteditable: 'true' }], ['div', { role: 'dialog' }], ['div', { 'aria-live': 'polite' }]
  ];
  for (const [tag, attributes] of cases) {
    const container = h.doc.createElement(tag); for (const [name, value] of Object.entries(attributes)) container.setAttribute(name, value);
    container.append(original.cloneNode(true)); h.doc.querySelector('main').append(container);
  }
  const translated = original.cloneNode(true); translated.querySelector('p').previousElementSibling.insertAdjacentHTML('beforeend', '<button>Show original</button>'); h.doc.querySelector('main').append(translated);
  const quoteSnippet = original.cloneNode(true); quoteSnippet.querySelector('p').classList.remove('whitespace-pre-wrap'); quoteSnippet.querySelector('p').classList.add('line-clamp-3'); h.doc.querySelector('main').append(quoteSnippet);
  h.qa.patch(); assert.equal(h.doc.querySelectorAll('.ct-link-preview').length, 1);
  assert.equal(h.qa.state.records.size, 1); assert.equal(h.calls.length, 0);
});

test('known profile original sources and verified inline replies qualify independently', t => {
  const profile = `<section data-ct-profile-panel data-ct-local-ui="profile"><div class="ct-profile-row" data-ct-profile-post="saved"><div class="ct-profile-row-main"><p class="ct-profile-text" data-ct-link-preview-source="original">Saved https://example.org/saved.</p></div></div></section>`;
  const h = harness(t, { html: `<div id="inline-replies-parent">${native('https://example.org/reply')}</div>${profile}` });
  h.qa.patch(); assert.equal(h.doc.querySelectorAll('.ct-link-preview').length, 2); assert.equal(h.calls.length, 0);
  assert.equal(h.doc.querySelector('.ct-profile-row .ct-link-preview a').href, 'https://example.org/saved');
});

test('verified original URL cards survive native translation during metadata and thumbnail reads', async t => {
  const h = harness(t, { html: timestampedNative(), timestamps: true }); await h.ready();
  const body = h.doc.querySelector('article p.tl-user-text'), originalText = body.textContent;
  const card = h.doc.querySelector('.ct-link-preview');
  translateNative(h, body); h.qa.patch(body);
  assert.equal(h.doc.querySelector('.ct-link-preview'), card); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].aborted, 0);
  assert.equal(h.qa.source(body).text, originalText); assert.equal(h.qa.source(body).url, destination);
  h.respond(0, metadata.replace('</head>', '<meta property="og:image" content="https://images.org/real.png"></head>'));
  await flush(); assert.equal(h.calls.length, 2);
  body.previousElementSibling.querySelector('.translation-toggle').textContent = '原文を表示';
  body.previousElementSibling.querySelector('button.font-bold').textContent = 'ALICE';
  body.previousElementSibling.querySelector('span[title]').textContent = '2時間前';
  h.qa.patch(body); assert.equal(h.doc.querySelector('.ct-link-preview'), card); assert.equal(h.calls[1].aborted, 0);
  h.respond(1, '', { response: [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0], responseHeaders: 'Content-Type: image/png' });
  await flush(); assert.ok(card.querySelector('img')); assert.equal(card.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
  const image = card.querySelector('img'); h.qa.patch(); assert.equal(card.querySelector('img'), image);
  assert.equal(card.querySelector('a').href, destination); assert.equal(body.textContent.includes('翻訳された文章'), true);
});

test('already translated, missing timestamp helpers, unknown creation and ambiguous native dates never establish original URL evidence', async t => {
  for (const kind of ['already-translated', 'no-helpers', 'no-ISO', 'ambiguous-ISO']) {
    const h = harness(t, { html: timestampedNative(), timestamps: kind !== 'no-helpers' });
    const body = h.doc.querySelector('article p.tl-user-text'), header = body.previousElementSibling;
    if (kind === 'already-translated') translateNative(h, body);
    if (kind === 'no-ISO') header.querySelector('span[title]').removeAttribute('title');
    if (kind === 'ambiguous-ISO') {
      const creation = header.querySelector('span[title]');
      creation.after(creation.previousElementSibling.cloneNode(true), creation.cloneNode(true));
    }
    h.qa.patch();
    if (kind !== 'already-translated') { assert.ok(h.doc.querySelector('.ct-link-preview')); translateNative(h, body); h.qa.patch(body); }
    assert.equal(h.doc.querySelector('.ct-link-preview'), null, kind); assert.equal(h.calls.length, 0, kind);
  }
});

test('translated URL evidence rejects changed source, structure, author, creation instant and edit state', async t => {
  for (const change of ['url', 'first-url', 'author', 'author-node', 'creation', 'creation-node', 'header', 'parent', 'body', 'edited']) {
    const h = harness(t, { html: timestampedNative(), timestamps: true }); await h.ready();
    const body = h.doc.querySelector('article p.tl-user-text'), header = body.previousElementSibling;
    translateNative(h, body);
    if (change === 'url') body.querySelector('a').href = 'https://translation-only.org/new';
    if (change === 'first-url') body.insertAdjacentHTML('afterbegin', '<a href="https://translation-only.org/new">new first URL</a> ');
    if (change === 'author') header.querySelector('button.font-bold').textContent = 'Bob';
    if (change === 'author-node') { const author = header.querySelector('button.font-bold'); author.replaceWith(author.cloneNode(true)); }
    if (change === 'creation') header.querySelector('span[title]').title = '2026-10-11T00:00:00Z';
    if (change === 'creation-node') { const creation = header.querySelector('span[title]'); creation.replaceWith(creation.cloneNode(true)); }
    if (change === 'header') header.replaceWith(header.cloneNode(true));
    if (change === 'parent') {
      const parent = body.parentElement, replacement = parent.cloneNode(false);
      while (parent.firstChild) replacement.append(parent.firstChild);
      parent.replaceWith(replacement);
    }
    if (change === 'body') body.replaceWith(body.cloneNode(true));
    if (change === 'edited') header.querySelector('div.flex.items-center').insertAdjacentHTML('beforeend', '<span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted" title="2026-10-11T00:00:00Z">Edited</span>');
    h.qa.patch(); await flush();
    assert.equal(h.doc.querySelector('.ct-link-preview'), null, change); assert.equal(h.calls[0].aborted, 1, change);
    h.show(); assert.equal(h.calls.length, 1, change);
    h.respond(0); await flush(); assert.equal(h.doc.querySelector('.ct-link-preview-image'), null, change);
  }
  const edited = harness(t, { html: timestampedNative(), timestamps: true });
  const body = edited.doc.querySelector('article p.tl-user-text'), header = body.previousElementSibling;
  header.querySelector('div.flex.items-center').insertAdjacentHTML('beforeend', '<span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted" title="2026-10-10T01:00:00Z">Edited</span>');
  await edited.ready(); translateNative(edited, body);
  [...header.querySelectorAll('span[title]')].at(-1).title = '2026-10-11T00:00:00Z';
  edited.qa.patch(); await flush(); assert.equal(edited.doc.querySelector('.ct-link-preview'), null); assert.equal(edited.calls[0].aborted, 1);
});

test('an original post edit replaces its baseline and only the newly verified URL survives translation', async t => {
  const h = harness(t, { html: timestampedNative(), timestamps: true }); await h.ready();
  const body = h.doc.querySelector('article p.tl-user-text'), header = body.previousElementSibling;
  const oldCard = h.doc.querySelector('.ct-link-preview'), editedURL = 'https://example.org/edited';
  body.innerHTML = `Edited original <a href="${editedURL}">${editedURL}</a>`;
  header.querySelector('div.flex.items-center').insertAdjacentHTML('beforeend', '<span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted" title="2026-10-10T01:00:00Z">Edited</span>');
  h.qa.patch(body); await flush(); assert.equal(h.calls[0].aborted, 1);
  const card = h.doc.querySelector('.ct-link-preview'); assert.notEqual(card, oldCard);
  h.show(card); assert.equal(h.calls[1].details.url, editedURL);
  translateNative(h, body, editedURL); h.qa.patch(body); assert.equal(h.doc.querySelector('.ct-link-preview'), card);
  assert.equal(h.qa.source(body).text, `Edited original ${editedURL}`); assert.equal(h.calls[1].aborted, 0);
  h.respond(1); await flush(); assert.equal(card.querySelector('a').href, editedURL);
});

test('offscreen and capacity recycling preserve a verified translated URL but context and cleanup do not', async t => {
  const h = harness(t, { html: timestampedNative() + timestampedNative('https://second.org/a', 'second'), timestamps: true, enabled: false });
  h.qa.limits.records = 1; h.qa.patch();
  const body = h.doc.querySelector('#post p.tl-user-text'); translateNative(h, body);
  assert.equal(h.doc.querySelector('#post .ct-link-preview'), null);
  h.show(body); const card = h.doc.querySelector('#post .ct-link-preview'); assert.ok(card); assert.equal(card.querySelector('a').href, destination);
  h.intersections([[body, false], [card, false]]); h.show(card); assert.equal(h.doc.querySelector('#post .ct-link-preview'), card);
  assert.equal(h.calls.length, 0);
  for (const change of ['route', 'account', 'setting', 'cleanup']) {
    const reset = harness(t, { html: timestampedNative(), timestamps: true }); await reset.ready();
    const resetBody = reset.doc.querySelector('article p.tl-user-text'); translateNative(reset, resetBody);
    if (change === 'route') reset.w.history.replaceState({}, '', '/post/original');
    if (change === 'account') reset.w.ctNetworkState.authUID = 'account-b';
    if (change === 'setting') reset.enabled(false);
    if (change === 'cleanup') reset.qa.cleanup();
    reset.qa.patch(); await flush(); assert.equal(reset.doc.querySelector('.ct-link-preview'), null, change);
    assert.equal(reset.calls[0].aborted, 1, change); reset.show(); assert.equal(reset.calls.length, 1, change);
  }
});

test('OFF retains fallback actions, stops requests and permits manual metadata reads', async t => {
  const h = harness(t); await h.ready(); assert.equal(h.calls.length, 1);
  h.enabled(false); h.qa.patch(); await flush(); assert.equal(h.calls[0].aborted, 1);
  assert.equal(h.doc.querySelectorAll('.ct-link-preview').length, 1); assert.equal(h.calls.length, 1);
  const button = [...h.doc.querySelectorAll('.ct-link-preview button')].find(node => node.textContent === 'Load preview');
  button.click(); assert.equal(h.calls.length, 2); h.respond(1); await flush();
  assert.equal(h.doc.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
});

test('signed links keep their real navigation URL and cannot trigger metadata requests', async t => {
  const signed = 'https://example.org/private?access_token=private#view'; const h = harness(t, { html: native(signed) });
  await h.ready(); assert.equal(h.calls.length, 0); assert.equal(h.doc.querySelector('.ct-link-preview a').href, signed);
  const record = [...h.qa.state.records.values()][0]; assert.equal(record.fetch.disabled, true);
  assert.match(record.status.textContent, /credentials/);
});

test('concurrency is bounded to two, inflight/cache reads deduplicate repeated destinations', async t => {
  const h = harness(t, { html: native(destination, 'one') + native(destination, 'duplicate') + native('https://second.org/article', 'two') + native('https://third.org/article', 'three') });
  await h.ready(); assert.equal(h.calls.length, 2); assert.equal(h.qa.state.running, 2);
  h.respond(0); await flush(); assert.equal(h.calls.length, 3); assert.equal(h.doc.querySelectorAll('.ct-link-preview-title').length, 4);
  assert.equal([...h.doc.querySelectorAll('.ct-link-preview-title')].filter(node => node.textContent === 'Real title & details').length, 2);
  h.respond(1); h.respond(2); await flush();
  h.doc.querySelector('main').insertAdjacentHTML('beforeend', native(destination, 'cached')); h.qa.patch(); h.show(); await flush();
  assert.equal(h.calls.length, 3); assert.equal(h.doc.querySelector('#cached .ct-link-preview-title').textContent, 'Real title & details');
});

test('offscreen, changed URL/text, detached rows, route/account and cleanup discard late responses', async t => {
  for (const change of ['offscreen', 'url', 'text', 'detached', 'route', 'account', 'cleanup']) {
    const h = harness(t); await h.ready(); const body = h.doc.querySelector('p');
    if (change === 'offscreen') h.intersections([[body, false], [h.doc.querySelector('.ct-link-preview'), false]]);
    if (change === 'url') { body.querySelector('a').href = 'https://changed.org/article'; h.qa.patch(body); }
    if (change === 'text') { body.prepend('Changed '); h.qa.patch(body); }
    if (change === 'detached') { body.closest('article').remove(); h.qa.patch(); }
    if (change === 'route') { h.w.history.replaceState({}, '', '/profile'); h.qa.patch(); }
    if (change === 'account') { h.w.ctNetworkState.authUID = 'account-b'; h.qa.patch(); }
    if (change === 'cleanup') h.qa.cleanup();
    h.respond(0); await flush(); assert.equal(h.calls[0].aborted, 1, change);
    assert.equal([...h.doc.querySelectorAll('.ct-link-preview-title')].some(node => node.textContent === 'Real title & details'), false, change);
  }
});

test('background cleanup is reversible and cache expiry/limits never grow without bound', async t => {
  const h = harness(t); await h.ready(); h.w.ctPageActive = false; h.qa.patch(); await flush();
  assert.equal(h.calls[0].aborted, 1); assert.equal(h.doc.querySelector('.ct-link-preview'), null); assert.equal(h.timers.size, 0);
  h.w.ctPageActive = true; h.qa.patch(); h.show(); assert.equal(h.calls.length, 2); h.respond(1); await flush();
  for (let i = 0; i < 120; i++) h.qa.cache('https://cache.org/' + i, { ok: true, meta: { title: 'real' } });
  assert.equal(h.qa.state.cache.size, h.qa.limits.cache);
  const record = [...h.qa.state.records.values()][0]; record.attempted = false;
  h.qa.cache(record.metadataURL, { ok: true, meta: { title: 'expired', description: '', site: 'site', domain: 'example.org', images: [] } });
  h.qa.state.cache.get(record.metadataURL).until = 0; h.qa.patch(); assert.equal(h.calls.length, 3);
});

test('clipboard/share success follows completion and local fallback selects actual link', async t => {
  const h = harness(t, { enabled: false }); await h.ready(); const buttons = h.doc.querySelectorAll('.ct-link-preview button');
  let complete, copied = ''; h.w.navigator.clipboard = { writeText(text) { copied = text; return new Promise(resolve => { complete = resolve; }); } };
  buttons[0].click(); assert.equal(copied, destination); assert.notEqual(h.doc.querySelector('[role=status]').textContent, 'Copied.');
  complete(); await flush(); assert.equal(h.doc.querySelector('[role=status]').textContent, 'Copied.');
  h.w.navigator.clipboard = undefined; buttons[1].click(); await flush();
  const field = h.doc.querySelector('.ct-link-preview-copy-field'); assert.equal(field.value, destination); assert.equal(h.doc.activeElement, field);
  let shared; h.w.navigator.share = async data => { shared = data; }; buttons[1].click(); await flush();
  assert.equal(shared.url, destination); assert.equal(h.doc.querySelector('[role=status]').textContent, 'Shared.');
});

test('anonymous text transport supports legacy Stay and Promise GM without accepting receipts early', async t => {
  let details;
  const h = harness(t, { modernGM: { marker: true, xmlHttpRequest(options) {
    assert.equal(this.marker, true); details = options;
    return Promise.resolve({ status: 0, readyState: 1, response: '' });
  } } });
  const request = h.qa.request(destination); let settled = false; request.promise.then(() => { settled = true; }); await flush();
  assert.equal(settled, false); assert.equal(details.anonymous, true); assert.equal(details.responseType, 'text');
  assert.equal(details.redirect, 'manual'); assert.equal(details.headers.Authorization, undefined); assert.equal(details.headers.Cookie, undefined);
  details.onloadend({ status: 200, responseText: null, response: metadata, responseURL: destination });
  const result = await request.promise; assert.equal(result.ok, true); assert.equal(result.html, metadata); assert.equal(h.timers.size, 0);
});

test('Promise response works, throwing responseText falls back and callback wins over late promise', async t => {
  const response = { status: 200, readyState: 4, response: metadata, responseURL: destination };
  Object.defineProperty(response, 'responseText', { get() { throw new Error('InvalidStateError'); } });
  const h = harness(t, { modernGM: { xmlHttpRequest() { return Promise.resolve(response); } } });
  assert.equal((await h.qa.request(destination).promise).ok, true);
  let resolve; const other = harness(t, { modernGM: { xmlHttpRequest(details) {
    details.onload({ status: 200, responseText: metadata, finalUrl: details.url }); return new Promise(done => { resolve = done; });
  } } });
  assert.equal((await other.qa.request(destination).promise).ok, true); resolve({ status: 403 }); await flush(); assert.equal(other.timers.size, 0);
});

test('transport validates manual redirects and every final URL alias before accepting content', async t => {
  const h = harness(t); const request = h.qa.request(destination);
  h.respond(0, '', { status: 302, responseHeaders: 'Location: https://redirect.org/page' }); await flush();
  assert.equal(h.calls[1].details.url, 'https://redirect.org/page'); h.respond(1); assert.equal((await request.promise).ok, true);
  for (const url of ['http://example.org/a', 'https://127.0.0.1/a', 'https://example.org/a?token=secret']) {
    const check = h.qa.request(destination); h.respond(h.calls.length - 1, metadata, { finalUrl: url }); assert.equal((await check.promise).ok, false);
  }
  const conflict = h.qa.request(destination); h.respond(h.calls.length - 1, metadata, { responseURL: 'https://other.org/' });
  assert.equal((await conflict.promise).reason, 'unsafe');
  const badRedirect = h.qa.request(destination); const index = h.calls.length - 1;
  h.respond(index, '', { status: 302, responseHeaders: 'Location: https://192.168.1.1/' }); assert.equal((await badRedirect.promise).ok, false);
  assert.equal(h.calls.length, index + 1);
});

test('HTTP/error/type/size/deadline paths give real fallback and abort bridge listeners', async t => {
  const listeners = new Set(); let mode = 'timeout', aborts = 0;
  const h = harness(t, { gm(details) {
    const listener = {}; listeners.add(listener);
    const end = response => { details.onloadend(response); listeners.delete(listener); };
    if (mode === 'success') queueMicrotask(() => { details.onload({ status: 200, response: metadata, responseURL: details.url }); end({ status: 200 }); });
    if (mode === 'error') queueMicrotask(() => { details.onerror({ status: 0 }); end({ status: 0 }); });
    return { abort() { aborts++; details.onabort({ status: 0 }); end({ status: 0 }); } };
  } });
  const pending = h.qa.request(destination); h.expire(); assert.equal((await pending.promise).reason, 'timeout'); assert.equal(aborts, 1); assert.equal(listeners.size, 0);
  mode = 'success'; assert.equal((await h.qa.request(destination).promise).ok, true); assert.equal(listeners.size, 0);
  mode = 'error'; assert.equal((await h.qa.request(destination).promise).ok, false); assert.equal(listeners.size, 0);
  const f = harness(t);
  for (const changes of [{ status: 403 }, { status: 503 }, { responseHeaders: 'Content-Type: application/json' },
    { responseHeaders: 'Content-Length: 99999999' }, { responseText: 'x'.repeat(f.qa.limits.text + 1) }]) {
    const check = f.qa.request(destination); f.respond(f.calls.length - 1, metadata, changes); assert.equal((await check.promise).ok, false);
  }
  const progress = f.qa.request(destination); const call = f.calls.at(-1); call.details.onprogress({ loaded: f.qa.limits.text + 1 });
  assert.equal((await progress.promise).reason, 'size'); assert.equal(call.aborted, 1);
  call.details.onload({ status: 200, responseText: metadata }); assert.equal(f.timers.size, 0);
});

test('real validated raster images use blob URLs; cache eviction retains active image until row removal', async t => {
  const h = harness(t); await h.ready(); h.respond(0, metadata.replace('</head>', '<meta property="og:image" content="https://images.org/real.png"></head>'));
  await flush(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].details.anonymous, true); assert.equal(h.calls[1].details.responseType, 'arraybuffer');
  const png = new h.w.Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  h.respond(1, '', { response: png.buffer, responseHeaders: 'Content-Type: image/png' }); await flush();
  const image = h.doc.querySelector('.ct-link-preview-image'); assert.ok(image); assert.match(image.src, /^blob:/); assert.equal(image.referrerPolicy, 'no-referrer');
  assert.equal(h.objects.size, 1); const url = image.src; h.qa.deleteCache([...h.qa.state.cache.keys()][0]); assert.equal(h.objects.has(url), true);
  h.doc.querySelector('article').remove(); h.qa.patch(); assert.equal(h.objects.size, 0); assert.ok(h.revoked.includes(url));
});

test('offscreen image URLs release immediately and reappear from cached blobs without network reads', async t => {
  const h = harness(t); await h.ready(); h.respond(0, metadata.replace('</head>', '<meta property="og:image" content="https://images.org/real.png"></head>'));
  await flush();
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0];
  h.respond(1, '', { response: bytes, responseHeaders: 'Content-Type: image/png' }); await flush();
  assert.equal(h.qa.state.recordImageBytes, bytes.length); const body = h.doc.querySelector('p');
  h.intersections([[body, false], [h.doc.querySelector('.ct-link-preview'), false]]);
  assert.equal(h.qa.state.recordImageBytes, 0); assert.equal(h.objects.size, 0);
  assert.equal(h.doc.querySelector('.ct-link-preview-image'), null); h.show(body); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.objects.size, 1); assert.equal(h.qa.state.recordImageBytes, bytes.length);
  const bad = h.qa.request('https://images.org/bad.png', true);
  h.respond(2, '', { response: [137, 80, 78, 71, 13, 10, 26, 256], responseHeaders: 'Content-Type: image/png' });
  assert.equal((await bad.promise).ok, false);
});

test('bounded cards recycle old offscreen rows and returning sources recreate their cards', async t => {
  const h = harness(t, { enabled: false, html: native('https://first.org/a', 'first') + native('https://second.org/a', 'second') +
    native('https://third.org/a', 'third') + native('https://fourth.org/a', 'fourth') });
  h.qa.limits.records = 2; h.qa.patch(); assert.equal(h.qa.state.records.size, 2);
  const pruned = h.doc.querySelector('#second p'); assert.equal(h.qa.state.records.has(pruned), false);
  pruned.closest('article').remove(); h.qa.patch(); assert.equal(h.qa.state.observedSources.has(pruned), false);
  const first = h.doc.querySelector('#first p'); h.show(first); assert.ok(h.doc.querySelector('#first .ct-link-preview'));
  const third = h.doc.querySelector('#third p'); h.show(third); assert.ok(h.doc.querySelector('#third .ct-link-preview'));
  h.show(first, false); const fourth = h.doc.querySelector('#fourth p'); h.show(fourth);
  assert.equal(h.doc.querySelector('#first .ct-link-preview'), null); assert.ok(h.doc.querySelector('#fourth .ct-link-preview'));
  h.show(fourth, false); h.show(first); assert.ok(h.doc.querySelector('#first .ct-link-preview'));
  assert.equal(h.qa.state.records.size, 2); assert.equal(h.calls.length, 0);
});

test('a visible card loads and retains its thumbnail while the original text is offscreen', async t => {
  const h = harness(t); h.qa.patch();
  const body = h.doc.querySelector('article p'), card = h.doc.querySelector('.ct-link-preview');
  assert.ok(h.observer().targets.has(body)); assert.ok(h.observer().targets.has(card));
  h.show(card); assert.equal(h.calls.length, 1);
  h.respond(0, metadata.replace('</head>', '<meta property="og:image" content="https://images.org/real.png"></head>'));
  await flush(); const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0];
  h.respond(1, '', { response: bytes, responseHeaders: 'Content-Type: image/png' }); await flush();
  const record = h.qa.state.records.get(body), image = card.querySelector('img'), objectURL = image.src;
  h.show(body, false); await flush();
  assert.equal(record.bodyVisible, false); assert.equal(record.cardVisible, true); assert.equal(record.visible, true);
  assert.equal(card.querySelector('img'), image); assert.equal(h.objects.has(objectURL), true);
  assert.equal(h.calls[0].aborted, 0); assert.equal(h.calls[1].aborted, 0);
  h.show(card, false); assert.equal(record.visible, false); assert.equal(card.querySelector('img'), null);
  assert.equal(h.objects.size, 0); assert.equal(h.qa.state.recordImageBytes, 0);
  h.show(card); await flush(); assert.ok(card.querySelector('img')); assert.equal(h.calls.length, 2);
  assert.equal(record.bodyVisible, false); assert.equal(record.visible, true);
});

test('one observer batch hands visibility from original text to its card without canceling the request', async t => {
  for (const cardFirst of [false, true]) {
    const h = harness(t); h.qa.patch();
    const body = h.doc.querySelector('article p'), card = h.doc.querySelector('.ct-link-preview');
    h.show(body); assert.equal(h.calls.length, 1);
    const entries = [[body, false], [card, true]]; h.intersections(cardFirst ? entries.reverse() : entries);
    assert.equal(h.calls[0].aborted, 0); assert.equal(h.calls.length, 1);
    const record = h.qa.state.records.get(body);
    assert.equal(record.bodyVisible, false); assert.equal(record.cardVisible, true); assert.equal(record.visible, true);
    h.respond(0); await flush(); assert.equal(card.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
  }
});

test('both original text and card leaving the viewport cancel pending reads and can return', async t => {
  const h = harness(t); h.qa.patch();
  const body = h.doc.querySelector('article p'), card = h.doc.querySelector('.ct-link-preview');
  h.show(card); assert.equal(h.calls.length, 1);
  h.intersections([[card, false], [body, false]]); await flush();
  assert.equal(h.calls[0].aborted, 1); assert.equal(h.qa.state.jobs.size, 0);
  assert.equal(h.qa.state.records.get(body).visible, false); assert.equal(card.hasAttribute('aria-busy'), false);
  h.respond(0); await flush(); assert.notEqual(card.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
  h.show(card); assert.equal(h.calls.length, 2); h.respond(1); await flush();
  assert.equal(card.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
});

test('removed and reused source rows clear both observer registrations and restore fresh cards', async t => {
  const h = harness(t); h.qa.patch();
  const article = h.doc.querySelector('article'), body = article.querySelector('p'), originalAnchor = body.querySelector('a');
  const oldCard = article.querySelector('.ct-link-preview'), oldRecord = h.qa.state.records.get(body);
  h.show(oldCard); article.remove(); h.qa.patch(); await flush();
  assert.equal(h.calls[0].aborted, 1); assert.equal(h.qa.state.cards.size, 0); assert.equal(h.qa.state.records.size, 0);
  assert.equal(h.observer().targets.has(body), false); assert.equal(h.observer().targets.has(oldCard), false);
  assert.equal(oldRecord.bodyVisible, false); assert.equal(oldRecord.cardVisible, false); assert.equal(oldCard.isConnected, false);
  h.doc.querySelector('main').append(article); h.qa.patch();
  const restored = article.querySelector('.ct-link-preview'), restoredRecord = h.qa.state.records.get(body);
  assert.notEqual(restored, oldCard); assert.notEqual(restoredRecord, oldRecord); assert.equal(body.querySelector('a'), originalAnchor);
  assert.equal(restoredRecord.visible, false); assert.equal(h.observer().targets.has(body), true); assert.equal(h.observer().targets.has(restored), true);
  h.show(oldCard); assert.equal(h.calls.length, 1);
  h.show(restored); assert.equal(h.calls.length, 2);
  originalAnchor.href = 'https://changed.org/article'; h.qa.patch(body); await flush();
  assert.equal(h.calls[1].aborted, 1); assert.equal(h.observer().targets.has(restored), false); assert.equal(h.qa.state.cards.has(restored), false);
  const reused = h.qa.state.records.get(body); assert.equal(reused.url, 'https://changed.org/article');
  assert.equal(reused.bodyVisible, false); assert.equal(reused.cardVisible, false); assert.equal(reused.visible, false);
  h.show(reused.card); assert.equal(h.calls[2].details.url, 'https://changed.org/article');
});

test('setting, account, route and cleanup reset visibility and ignore disconnected observer batches', async t => {
  const h = harness(t); await h.ready();
  const body = h.doc.querySelector('article p');
  for (const change of ['setting', 'account', 'route', 'cleanup']) {
    const observer = h.observer(), previous = h.qa.state.records.get(body), previousCount = h.calls.length;
    if (change === 'setting') h.enabled(false);
    if (change === 'account') h.w.ctNetworkState.authUID = 'account-b';
    if (change === 'route') h.w.history.replaceState({}, '', '/post/original');
    if (change === 'cleanup') h.qa.cleanup();
    h.qa.patch(); await flush();
    const current = h.qa.state.records.get(body);
    assert.notEqual(current, previous); assert.equal(previous.card.isConnected, false); assert.equal(observer.targets.size, 0);
    assert.equal(previous.bodyVisible, false); assert.equal(previous.cardVisible, false);
    assert.equal(current.bodyVisible, false); assert.equal(current.cardVisible, false); assert.equal(current.visible, false);
    observer.callback([{ target: body, isIntersecting: true, intersectionRatio: 1 }, { target: previous.card, isIntersecting: true, intersectionRatio: 1 }]);
    assert.equal(current.visible, false); assert.equal(h.calls.length, previousCount);
    assert.equal(h.qa.state.cards.size, 1); assert.equal(h.observer().targets.size, 2);
    h.show(current.card); assert.equal(h.calls.length, previousCount); // automatic OFF remains OFF after each context change
  }
  const observer = h.observer(); h.qa.cleanup();
  assert.equal(observer.targets.size, 0); assert.equal(h.qa.state.cards.size, 0); assert.equal(h.qa.state.records.size, 0);
  assert.equal(h.qa.state.observedSources.size, 0); assert.equal(h.objects.size, 0);
});

test('recycled rows retain only their source observation and release it when that source no longer qualifies', t => {
  const h = harness(t, { enabled: false, html: native('https://first.org/a', 'first') + native('https://second.org/a', 'second') });
  h.qa.limits.records = 1; h.qa.patch();
  const first = h.doc.querySelector('#first p'), second = h.doc.querySelector('#second p');
  assert.equal(h.qa.state.records.has(first), false); assert.equal(h.qa.state.cards.size, 1);
  assert.equal(h.observer().targets.size, 3); assert.equal(h.observer().targets.has(first), true);
  first.textContent = 'The reused native row no longer has a URL.'; h.qa.patch(first);
  assert.equal(h.qa.state.observedSources.has(first), false); assert.equal(h.observer().targets.has(first), false);
  assert.equal(h.observer().targets.size, 2); assert.equal(h.qa.state.records.has(second), true);
  h.show(first); assert.equal(h.qa.state.records.has(first), false); assert.equal(h.calls.length, 0);
});

test('unsafe, mislabeled, oversized and animated images are omitted without invented replacements', async t => {
  const h = harness(t);
  const invalid = [
    ['image/svg+xml', '<svg/>'], ['image/gif', 'GIF89a00'], ['text/html', '<html/>'], ['image/png', 'notimage'],
    ['image/png', new Uint8Array(h.qa.limits.image + 1)],
    ['image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 97, 99, 84, 76])],
    ['image/webp', new Uint8Array([...Buffer.from('RIFF0000WEBPANIM')])]
  ];
  for (const [type, data] of invalid) {
    const check = h.qa.request('https://images.org/image', true);
    const bytes = typeof data === 'string' ? new h.w.Uint8Array(Buffer.from(data)).buffer : new h.w.Uint8Array(data).buffer;
    h.respond(h.calls.length - 1, '', { response: bytes, responseHeaders: 'Content-Type: ' + type }); assert.equal((await check.promise).ok, false, type);
  }
  await h.ready(); const index = h.calls.length - 1;
  h.respond(index, metadata.replace('</head>', '<meta property="og:image" content="https://127.0.0.1/image.png"></head>')); await flush();
  assert.equal(h.calls.length, index + 1); assert.equal(h.doc.querySelector('.ct-link-preview-image'), null); assert.equal(h.doc.querySelector('.ct-link-preview-title').textContent, 'Real title & details');
});

test('failure displays concise retry, and no GM transport never falls back to an external proxy/fetch', async t => {
  const h = harness(t); await h.ready(); h.respond(0, '', { status: 403 }); await flush();
  assert.match(h.doc.querySelector('.ct-link-preview-status').textContent, /site permission/);
  [...h.doc.querySelectorAll('.ct-link-preview button')].find(button => button.textContent === 'Load preview').click(); assert.equal(h.calls.length, 2);
  const unavailable = harness(t, { gm: false }); let fetches = 0; unavailable.w.fetch = () => { fetches++; return Promise.reject(); };
  await unavailable.ready(); assert.equal(fetches, 0); assert.match(unavailable.doc.querySelector('.ct-link-preview-status').textContent, /script manager/);
});
