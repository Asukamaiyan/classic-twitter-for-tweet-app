const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8');
const now = Date.parse('2026-10-02T12:00:00Z');
const createdAt = '2026-10-02T09:30:00.123456Z';
const turn = () => new Promise(resolve => setImmediate(resolve));

function reply(id, parent = 'parent-a', text = 'My reply', age = '2h') {
  return `<div id="inline-replies-${parent}"><article data-reply="${id}"><div class="flex items-center gap-1 min-w-0">
    <button class="font-bold truncate hover:underline" aria-label="View @alice's profile">Alice</button><span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted shrink-0">${age}</span>
    <div class="flex items-center shrink-0 ml-auto"><div><button><svg class="lucide-ellipsis-vertical"></svg></button></div></div></div>
    <p class="tl-user-text whitespace-pre-wrap break-words">${text}</p><button data-testid="tweet-like-action"></button></article></div>`;
}
function post(id = 'reply-a', changes = {}) {
  return { id, authorUsername: 'alice', text: 'My reply', createdAt, parentId: 'parent-a', ...changes };
}
function native26Control(mode = 'idle') {
  return `<span class="inline-flex items-center"><button type="button" data-translate-mode="${mode}" aria-label="Translate post" aria-pressed="${mode === 'active'}" ${mode === 'busy' ? 'aria-busy="true" aria-disabled="true"' : ''}><svg aria-hidden="true"></svg></button><span data-translate-status role="status" aria-live="polite" class="sr-only"></span></span>`;
}
function detail(html) {
  return `<div class="animate-fadeIn flex flex-col"><div class="shrink-0"><div class="sticky"><button aria-label="Back"><svg width="18" height="18"></svg></button></div></div>
    <div class="min-h-0 flex-1 overflow-y-auto">${html.replace(/^<div id="inline-replies-[^"]+">/, '').replace(/<\/div>$/, '')}</div>
    <div class="shrink-0 z-20 border-t"><div role="form"><textarea></textarea></div></div></div>`;
}
function harness(t, html = reply('reply-a')) {
  const dom = new JSDOM(`<main>${html}</main>`, { url: 'https://app.tweet.app/post/parent-a', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window: w } = dom; t.after(() => w.close());
  const f = { w, doc: w.document, calls: [], scans: 0, active: true, time: now, json: { success: true, replies: [post()], nextCursor: null } };
  w.Date.now = () => f.time;
  w.Element.prototype.getBoundingClientRect = function () { return { top: this.hasAttribute('data-offscreen') ? 1000 : 0, bottom: this.hasAttribute('data-offscreen') ? 1050 : 50, left: 0, right: 300, width: 300, height: 50 }; };
  w.snapshotFavorite = () => null;
  w.validUser = value => value;
  w.articleAuthor = article => article.querySelector('button.font-bold.truncate')?.getAttribute('aria-label')?.match(/^View @(.+?)'s profile$/)?.[1] || null;
  w.articleAvatar = () => '';
  w.ctProfileURL = () => '';
  w.getAuth = async () => ({ uid: w.identity.authUID, token: 'fixture-token' });
  w.requestJSON = async (url, headers) => {
    f.calls.push(url); assert.equal(headers.Authorization, 'Bearer fixture-token');
    return f.respond ? f.respond(url) : f.json;
  };
  w.ctScheduleScan = () => f.scans++;
  w.eval(`const CT_LOCALE='ja'; const API_ORIGIN='https://api.tweet.app'; const ctNetworkState={authUID:'account-a'}; let ctPageActive=true;
    ${read('timestamps.js')} ${read('favorite-capture.js')} ${read('reply-times.js')}
    window.identity=ctNetworkState; window.qa={patch:ctReplyTimesEnhance,source:ctReplyTimeSource,rendered:ctReplyTimeRendered,
      active:value=>{ctPageActive=value;},pending:ctReplyTimePending};`);
  f.span = () => f.doc.querySelector('span.shrink-0');
  f.patch = root => w.qa.patch(root);
  f.source = el => w.qa.source(el || f.span());
  f.hidden = value => Object.defineProperty(f.doc, 'hidden', { configurable: true, value });
  return f;
}

test('inline creation clocks verify one exact original reply through the established GET without touching body, title or engagements', async t => {
  const f = harness(t); const body = f.doc.querySelector('p'); const text = body.textContent;
  await f.patch(); assert.equal(f.source(), createdAt);
  assert.deepEqual(f.calls, ['https://api.tweet.app/api/posts/parent-a/replies?limit=50']);
  assert.equal(body.textContent, text); assert.equal(f.span().hasAttribute('title'), false);
  assert.equal(f.doc.querySelectorAll('.ct-detail-post-time').length, 0);
  assert.equal(f.scans, 1);
  f.time += 3600000; f.span().firstChild.nodeValue = '3時間前'; f.w.qa.rendered(f.span(), '3時間前');
  await f.patch(); assert.equal(f.source(), createdAt); assert.equal(f.calls.length, 1);
});

test('actual conversation replies use the verified panel parent route while a feed retained under a post URL does not trigger reads', async t => {
  const f = harness(t, detail(reply('reply-a'))); await f.patch();
  assert.equal(f.source(), createdAt); assert.deepEqual(f.calls, ['https://api.tweet.app/api/posts/parent-a/replies?limit=50']);
  f.doc.querySelector('textarea').closest('[role=form]').remove(); assert.equal(f.source(), '');
  const feed = harness(t, reply('reply-a').replace('id="inline-replies-parent-a"', 'class="animate-fadeIn"'));
  await feed.patch(); assert.equal(feed.calls.length, 0); assert.equal(feed.source(), '');
});

test('creation matching uses valid native aliases and rejects parent/edit time, duplicate bodies and incorrect author or age', async t => {
  for (const changes of [
    { createdAt: '', created_at: '2026-10-02T11:55:00Z', editedAt: createdAt },
    { authorUsername: 'bob' }, { text: 'Different body' }, { createdAt: '2026-10-02T02:00:00Z' },
    { parentId: 'other-parent' }, { status: 'MUTED' }, { isDeleted: true }, { isRepost: true }
  ]) {
    const f = harness(t); f.json.replies = [post('reply-a', changes)]; await f.patch(); assert.equal(f.source(), '');
  }
  const alias = harness(t); alias.json.replies = [post('reply-a', { createdAt: 'invalid', created_at: createdAt })];
  await alias.patch(); assert.equal(alias.source(), createdAt);
  const duplicate = harness(t); duplicate.json.replies = [post('one'), post('two')]; await duplicate.patch(); assert.equal(duplicate.source(), '');
});

test('incomplete or malformed responses never supply a guessed time and failures do not retry automatically', async t => {
  for (const json of [
    { replies: [post()], nextCursor: 'older-page' }, { replies: [post()] },
    { replies: [post()], nextCursor: false }, { replies: [post(), { text: 'broken' }], nextCursor: null },
    { replies: [post(), post()], nextCursor: null }, { replies: [post('bad', { createdAt: '2026-02-30T00:00:00Z' })], nextCursor: null },
    { replies: Array.from({ length: 51 }, (_, index) => post('reply-' + index)), nextCursor: null },
    { success: false, replies: [post()], nextCursor: null }, null
  ]) {
    const f = harness(t); f.json = json; await f.patch(); assert.equal(f.source(), '');
    f.time += 120000; await f.patch(); assert.equal(f.calls.length, 1);
  }
  const f = harness(t); f.respond = async () => { throw new Error('network'); };
  await f.patch(); await f.patch(); assert.equal(f.calls.length, 1); assert.equal(f.source(), '');
});

test('translated, unsupported-date, quote, hidden and offscreen cards are left alone without reply reads', async t => {
  for (const change of [
    f => f.doc.querySelector('article').insertAdjacentHTML('beforeend', '<button>原文を表示</button>'),
    f => { f.span().textContent = 'Oct 2'; },
    f => { const block = f.doc.createElement('blockquote'); f.doc.querySelector('article').before(block); block.append(f.doc.querySelector('article')); },
    f => f.doc.querySelector('article').setAttribute('hidden', ''),
    f => f.doc.querySelector('article').setAttribute('data-offscreen', ''),
    f => f.hidden(true), f => f.w.qa.active(false)
  ]) {
    const f = harness(t); change(f); await f.patch(); assert.equal(f.calls.length, 0); assert.equal(f.source(), '');
  }
});

test('Tweet 2.6 reply translation icon modes reject inferred clocks until the original is visible', async t => {
  for (const mode of ['active', 'busy', 'future-state', '', 'idle', 'original']) {
    const f = harness(t); f.doc.querySelector('article > div').insertAdjacentHTML('beforeend', native26Control(mode));
    await f.patch(); const original = ['idle', 'original'].includes(mode);
    assert.equal(f.source(), original ? createdAt : '', mode); assert.equal(f.calls.length, original ? 1 : 0, mode);
  }
  const f = harness(t), body = f.doc.querySelector('p');
  f.doc.querySelector('article > div').insertAdjacentHTML('beforeend', native26Control('idle'));
  body.insertAdjacentHTML('beforebegin', '<div class="mt-1"><p role="alert" class="text-[0.8125rem] text-tl-app-text-muted">Couldn’t translate. Try again.</p></div>');
  await f.patch(); assert.equal(f.source(), createdAt);
});

test('Tweet 2.6 native translation state changes discard pending and previously bound reply clocks', async t => {
  for (const mode of ['active', 'busy', 'future-state']) {
    const f = harness(t); f.doc.querySelector('article > div').insertAdjacentHTML('beforeend', native26Control('idle'));
    let resolve; f.respond = () => new Promise(done => { resolve = done; });
    const pending = f.patch(); await turn(); assert.equal(f.calls.length, 1);
    f.doc.querySelector('[data-translate-mode]').setAttribute('data-translate-mode', mode);
    resolve(f.json); await pending; assert.equal(f.source(), '', mode);
    const bound = harness(t); bound.doc.querySelector('article > div').insertAdjacentHTML('beforeend', native26Control('original'));
    await bound.patch(); assert.equal(bound.source(), createdAt);
    bound.doc.querySelector('[data-translate-mode]').setAttribute('data-translate-mode', mode);
    assert.equal(bound.source(), '', mode);
  }
});

test('Tweet 2.6 quote translation controls stay independent while missing or conflicting native state stays unresolved', async t => {
  const f = harness(t); f.doc.querySelector('article').insertAdjacentHTML('beforeend', `<blockquote>${native26Control('active')}</blockquote><article>${native26Control('busy')}</article>`);
  await f.patch(); assert.equal(f.source(), createdAt);
  for (const html of [native26Control('idle') + native26Control('active'),
    '<div class="mt-1"><p class="text-[0.8125rem] text-tl-app-text-muted">Translated from English</p></div>']) {
    const unknown = harness(t); unknown.doc.querySelector('p').insertAdjacentHTML('beforebegin', html);
    await unknown.patch(); assert.equal(unknown.source(), ''); assert.equal(unknown.calls.length, 0);
  }
});

test('late responses are discarded after route, account, body, native age, translation, node or visibility changes', async t => {
  for (const change of [
    f => f.w.history.replaceState({}, '', '/post/another'),
    f => { f.w.identity.authUID = 'account-b'; },
    f => { f.doc.querySelector('p').textContent = 'Edited reply'; },
    f => { f.span().textContent = '3h'; },
    f => f.doc.querySelector('article').insertAdjacentHTML('beforeend', '<button>Show original</button>'),
    f => { f.span().replaceWith(f.span().cloneNode(true)); },
    f => f.hidden(true), f => f.w.qa.active(false)
  ]) {
    const f = harness(t); let resolve; f.respond = () => new Promise(done => { resolve = done; });
    const pending = f.patch(); await turn(); assert.equal(f.calls.length, 1);
    change(f); resolve(f.json); await pending; assert.equal(f.source(), '');
  }
});

test('equivalent Japanese localization during a pending read keeps identity but a native age change invalidates it', async t => {
  const f = harness(t); let resolve; f.respond = () => new Promise(done => { resolve = done; });
  const pending = f.patch(); await turn(); f.span().textContent = '2時間前';
  resolve(f.json); await pending; assert.equal(f.source(), createdAt);
  f.span().textContent = '3h'; assert.equal(f.source(), '');
});

test('a native age reversion after a clock update invalidates the source and cannot reuse the old cached creation time', async t => {
  const f = harness(t); await f.patch(); assert.equal(f.source(), createdAt);
  f.span().textContent = '3時間前'; f.w.qa.rendered(f.span(), '3時間前'); assert.equal(f.source(), createdAt);
  f.span().textContent = '2h'; assert.equal(f.source(), '');
  await f.patch(); assert.equal(f.source(), ''); assert.equal(f.calls.length, 1);
});

test('verified clocks suspend while hidden and resume without fetching while dynamic identity changes invalidate old sources', async t => {
  const f = harness(t); await f.patch(); f.hidden(true); assert.equal(f.source(), '');
  f.time += 180000; f.hidden(false); assert.equal(f.source(), createdAt); await f.patch(); assert.equal(f.calls.length, 1);
  f.doc.querySelector('button.font-bold').setAttribute('aria-label', "View @bob's profile"); assert.equal(f.source(), '');
});

test('fresh complete replies are shared across visible cards with a twenty-card scan budget and no repeated clock GETs', async t => {
  const f = harness(t, reply('first')); const container = f.doc.getElementById('inline-replies-parent-a'); const template = container.querySelector('article');
  for (let index = 1; index < 25; index++) { const article = template.cloneNode(true); article.querySelector('p').textContent = 'Reply ' + index; container.append(article); }
  f.json.replies = [post('first'), ...Array.from({ length: 24 }, (_, index) => post('reply-' + index, { text: 'Reply ' + (index + 1) }))];
  await f.patch(); const spans = [...f.doc.querySelectorAll('span.shrink-0')];
  assert.equal(spans.filter(el => f.source(el)).length, 20); assert.equal(f.calls.length, 1);
  await f.patch(); assert.equal(spans.filter(el => f.source(el)).length, 25); assert.equal(f.calls.length, 1);
  f.time += 3600000; await f.patch(); assert.equal(f.calls.length, 1);
});

test('new reply nodes cannot inherit an older duplicate reply from the opened-container cache', async t => {
  const f = harness(t); await f.patch(); const old = f.span(); assert.equal(f.source(old), createdAt);
  const container = f.doc.getElementById('inline-replies-parent-a'); const added = container.querySelector('article').cloneNode(true);
  container.append(added); await f.patch();
  assert.equal(f.source(added.querySelector('span.shrink-0')), ''); assert.equal(f.source(old), createdAt);
  assert.equal(f.calls.length, 1);
});

test('unknown replies are checked once and cannot inherit an old cached creation time after body changes', async t => {
  const f = harness(t, reply('unknown', 'parent-a', 'Unmatched body'));
  let authorReads = 0;
  const author = f.w.articleAuthor;
  f.w.articleAuthor = article => { authorReads++; return author(article); };
  await f.patch(); assert.equal(f.source(), ''); assert.equal(f.calls.length, 1);
  const initialReads = authorReads;
  assert.ok(initialReads > 0);
  for (let index = 0; index < 25; index++) await f.patch();
  assert.equal(authorReads, initialReads);
  f.doc.querySelector('p').textContent = 'My reply';
  await f.patch(); assert.equal(f.source(), ''); assert.equal(authorReads, initialReads);
  assert.equal(f.calls.length, 1);
});

test('failed, expired or replacement-node caches skip repeat body identity parsing without retrying the GET', async t => {
  for (const state of ['failed', 'expired', 'replacement']) {
    const f = harness(t, reply('unknown', 'parent-a', 'Unmatched body'));
    let authorReads = 0;
    const author = f.w.articleAuthor;
    f.w.articleAuthor = article => { authorReads++; return author(article); };
    if (state === 'failed') f.json = null;
    await f.patch(); assert.equal(f.source(), '');
    if (state === 'expired') f.time += 60000;
    if (state === 'replacement') { const article = f.doc.querySelector('article'); article.replaceWith(article.cloneNode(true)); }
    const initialReads = authorReads;
    for (let index = 0; index < 25; index++) await f.patch();
    assert.equal(authorReads, initialReads, state);
    assert.equal(f.calls.length, 1, state);
    assert.equal(f.source(), '', state);
  }
});

test('an original reply scrolled out during the request can still be verified when visible again within the short cache', async t => {
  const f = harness(t);
  let resolve;
  f.respond = () => new Promise(done => { resolve = done; });
  const pending = f.patch(); await turn();
  const article = f.doc.querySelector('article');
  article.setAttribute('data-offscreen', '');
  resolve(f.json); await pending;
  assert.equal(f.source(), '');
  article.removeAttribute('data-offscreen');
  await f.patch();
  assert.equal(f.source(), createdAt);
  assert.equal(f.calls.length, 1);
});

test('at most four parent requests run concurrently even when scrolling reveals another parent during a read', async t => {
  const f = harness(t, Array.from({ length: 5 }, (_, index) => reply('reply-' + index, 'parent-' + index)).join(''));
  const resolvers = [];
  f.respond = url => new Promise(resolve => { resolvers.push(() => resolve({ replies: [post('a', { parentId: new URL(url).pathname.split('/')[3] })], nextCursor: null })); });
  const pending = f.patch(); await turn(); assert.equal(f.calls.length, 4);
  for (const article of [...f.doc.querySelectorAll('article')].slice(0, 4)) article.setAttribute('data-offscreen', '');
  await f.patch(); assert.equal(f.calls.length, 4); assert.equal(f.w.qa.pending.size, 4);
  resolvers.splice(0).forEach(resolve => resolve()); await pending;
  const final = f.patch(); await turn(); assert.equal(f.calls.length, 5);
  resolvers.splice(0).forEach(resolve => resolve()); await final;
});
