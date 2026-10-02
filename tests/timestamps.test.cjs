const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/timestamps.js'), 'utf8');

function fixture(html = '', route = '/post/current', locale = 'ja') {
  if (/^\/post\//.test(route)) html = detailPanel(html);
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: `https://app.tweet.app${route}`, runScripts: 'outside-only', pretendToBeVisual: true
  });
  dom.window.eval(`const CT_LOCALE = ${JSON.stringify(locale)}; ${source}
    window.qa = { ctTimestampParse, ctTimestampPostValue, ctTimestampPostDate,
      ctTimestampExactText, ctTimestampNativeValue, ctTimestampCreationNode,
      ctTimestampRelativeText, ctTimestampClockState, ctTimestampRefreshRelative,
      ctTimestampDetailContext, ctTimestampPatchExactPostTime };`);
  return { dom, document: dom.window.document, qa: dom.window.qa };
}

function detailPanel(html) {
  return `<div class="animate-fadeIn flex flex-col"><div class="shrink-0"><div class="sticky"><button aria-label="Back"></button><h2>Feed</h2></div></div>
    <div class="min-h-0 flex-1 overflow-y-auto">${html}</div>
    <div class="shrink-0 z-20 border-t"><div role="form"><textarea placeholder="Post your reply"></textarea><button>Reply</button></div></div></div>`;
}

function header(title, id = 'created') {
  return `<div class="flex items-center gap-1 min-w-0 flex-wrap"><span><button class="font-bold truncate">alice</button></span>
    <span class="text-tl-app-text-muted">·</span><span id="${id}" class="text-tl-app-text-muted hover:underline" title="${title}">3h</span></div>`;
}

function post(title, id = 'main', extra = '') {
  return `<article id="${id}"><div class="flex items-start gap-3"><button><img></button>
    <div class="flex-1 min-w-0">${header(title, `${id}-created`)}<p class="tl-user-text whitespace-pre-wrap">3h and Edited remain post text.</p>
    <div id="${id}-actions"><button data-testid="tweet-like-action">Like</button></div>${extra}</div></div></article>`;
}

test('timestamp parser keeps explicitly zoned instants and rejects invalid, ambiguous or normalized dates', () => {
  const f = fixture();
  assert.equal(f.qa.ctTimestampParse('2026-10-02T00:00:00+09:00').toISOString(), '2026-10-01T15:00:00.000Z');
  assert.equal(f.qa.ctTimestampParse('2024-02-29T23:59:59.123456Z').toISOString(), '2024-02-29T23:59:59.123Z');
  for (const raw of ['', null, undefined, 96, '96', '2026-10-02', '2026-10-02T00:00:00', '2026-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z', '2026-10-00T00:00:00Z', '2026-10-02T24:00:00Z',
    '2026-10-02T00:60:00Z', '2026-10-02T00:00:60Z', '2026-10-02T00:00:00+24:00', '2026-10-02T00:00:00+09:60']) {
    assert.equal(f.qa.ctTimestampParse(raw), null, String(raw));
  }
  f.dom.window.close();
});

test('post creation date selects a valid own alias and never reads edit, save or parent timestamps', () => {
  const f = fixture();
  const created = '2026-10-02T00:00:00+09:00';
  assert.equal(f.qa.ctTimestampPostValue({ created_at: 'invalid', createdAt: created }), created);
  assert.equal(f.qa.ctTimestampPostValue({ created_at: '', createdAt: created }), created);
  assert.equal(f.qa.ctTimestampPostValue({ created_at: created, createdAt: '2026-10-01T00:00:00Z' }), created);
  assert.equal(f.qa.ctTimestampPostDate({ createdAt: created }).toISOString(), '2026-10-01T15:00:00.000Z');
  assert.equal(f.qa.ctTimestampPostValue({ editedAt: created, savedAt: created, parentPost: { createdAt: created } }), '');
  assert.equal(f.qa.ctTimestampPostDate({ createdAt: '2026-02-29T00:00:00Z' }), null);
  f.dom.window.close();
});

for (const locale of ['ja', 'en']) test(`${locale}: exact creation time uses viewer timezone and midnight is 00:00`, () => {
  const f = fixture('', '/post/current', locale);
  const date = new f.dom.window.Date(2026, 9, 2, 0, 0, 0);
  assert.match(f.qa.ctTimestampExactText(date), / · 00:00$/);
  assert.equal(f.qa.ctTimestampExactText('invalid'), '');
  f.dom.window.close();
});

for (const locale of ['ja', 'en']) test(`${locale}: a native post stamp updates with React metadata and is removed when source becomes invalid`, () => {
  const f = fixture(post('2026-10-02T09:00:00Z'), '/post/current', locale);
  f.qa.ctTimestampPatchExactPostTime();
  const original = f.document.querySelector('.ct-detail-post-time');
  assert.equal(original.textContent, f.qa.ctTimestampExactText('2026-10-02T09:00:00Z'));
  assert.equal(original.nextElementSibling.id, 'main-actions');
  assert.equal(original.dataset.ctCreatedAt, '2026-10-02T09:00:00Z');
  const node = f.document.getElementById('main-created');
  node.title = '2026-10-01T01:23:00Z';
  f.qa.ctTimestampPatchExactPostTime(node);
  assert.equal(f.document.querySelector('.ct-detail-post-time'), original);
  assert.equal(original.textContent, f.qa.ctTimestampExactText(node.title));
  assert.equal(f.document.querySelector('p.tl-user-text').textContent, '3h and Edited remain post text.');
  node.title = '2026-04-31T00:00:00Z';
  f.qa.ctTimestampPatchExactPostTime(node.firstChild);
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  f.dom.window.close();
});

test('edited inline replies never borrow the edit timestamp, their parent or a nested quote creation time', () => {
  const reply = `<article id="reply"><div class="flex items-start gap-3"><button><img></button><div class="min-w-0 flex-1">
    <div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate">bob</button>
    <span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted shrink-0">5m</span>
    <span>·</span><span class="text-tl-app-text-muted shrink-0" title="2026-10-02T09:55:00Z">Edited</span></div>
    <p class="tl-user-text whitespace-pre-wrap">reply</p><div class="ct-detail-post-time">old incorrect edit stamp</div>
    <blockquote>${header('2026-09-01T00:00:00Z', 'quoted')}</blockquote></div></div></article>`;
  const f = fixture(post('2026-10-02T09:00:00Z', 'main', reply));
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.document.querySelectorAll('.ct-detail-post-time').length, 1);
  assert.equal(f.document.querySelector('.ct-detail-post-time').closest('article').id, 'main');
  assert.equal(f.document.getElementById('reply').querySelector('.ct-detail-post-time'), null);
  f.dom.window.close();
});

test('quote-only ISO, numeric tooltip and user-created datetime do not become a parent post creation time', () => {
  const f = fixture(`<article><span title="96">founder tooltip</span><div class="mt-3 rounded-2xl border">${header('2026-09-01T00:00:00Z')}</div>
    <p class="tl-user-text"><time datetime="2026-10-02T09:00:00Z">user-written date</time></p>
    <div class="ct-detail-post-time">stale incorrect timestamp</div></article>`);
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  assert.equal(f.document.querySelector('time').textContent, 'user-written date');
  f.dom.window.close();
});

test('feed cards retain compact native times and ambiguous creation headers do not produce a stamp', () => {
  const f = fixture(post('2026-10-02T09:00:00Z'), '/feed');
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  f.dom.reconfigure({ url: 'https://app.tweet.app/post/current' });
  f.document.body.innerHTML = detailPanel(f.document.body.innerHTML);
  f.document.querySelector('article > div > div').insertAdjacentHTML('afterbegin', header('2026-10-01T00:00:00Z', 'ambiguous'));
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  f.dom.window.close();
});

test('replies with their own native creation title remain isolated from parent timestamps', () => {
  const f = fixture(post('2026-10-02T09:00:00Z', 'main', post('2026-10-02T09:01:00Z', 'reply')));
  f.qa.ctTimestampPatchExactPostTime();
  for (const [id, time] of [['main', '2026-10-02T09:00:00Z'], ['reply', '2026-10-02T09:01:00Z']]) {
    const stamps = [...f.document.getElementById(id).querySelectorAll('.ct-detail-post-time')].filter(el => el.closest('article').id === id);
    assert.equal(stamps.length, 1);
    assert.equal(stamps[0].textContent, f.qa.ctTimestampExactText(time));
  }
  f.dom.window.close();
});

for (const locale of ['ja', 'en']) test(`${locale}: elapsed display follows the native second/minute/hour/day/week boundaries`, () => {
  const f = fixture('', '/feed', locale);
  const created = '2026-09-01T12:00:00Z';
  const origin = f.qa.ctTimestampParse(created).getTime();
  const expected = locale === 'ja' ? ['たった今', 'たった今', '1分前', '59分前', '1時間前', '23時間前', '1日前', '6日前', '9月1日'] :
    ['Just now', 'Just now', '1m', '59m', '1h', '23h', '1d', '6d', 'Sep 1'];
  for (const [i, age] of [-1, 59, 60, 3599, 3600, 86399, 86400, 604799, 604800].entries()) {
    assert.equal(f.qa.ctTimestampRelativeText(created, origin + age * 1000), expected[i], `age ${age}`);
  }
  assert.match(f.qa.ctTimestampRelativeText(created, origin + 400 * 86400000), /2026/);
  f.dom.window.close();
});

test('clock refreshes registered native creation nodes without replacing React nodes or scanning user content', () => {
  const f = fixture(post('2026-10-02T09:00:00Z'), '/feed');
  const origin = f.qa.ctTimestampParse('2026-10-02T09:00:00Z').getTime();
  let now = origin + 59999;
  f.dom.window.Date.now = () => now;
  const el = f.document.getElementById('main-created');
  const node = el.firstChild;
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(el.textContent, 'たった今');
  assert.equal(f.qa.ctTimestampClockState().elements.size, 1);
  now = origin + 60001;
  f.qa.ctTimestampRefreshRelative();
  assert.equal(node.nodeValue, '1分前');
  now = origin + 3600001;
  f.qa.ctTimestampRefreshRelative();
  assert.equal(node.nodeValue, '1時間前');
  assert.equal(el.firstChild, node);
  assert.equal(f.document.querySelector('p').textContent, '3h and Edited remain post text.');
  el.title = '2026-02-29T09:00:00Z';
  f.qa.ctTimestampRefreshRelative();
  assert.equal(f.qa.ctTimestampClockState().elements.size, 0);
  assert.equal(f.qa.ctTimestampClockState().timer, null);
  f.dom.window.close();
});

test('relative clock stops on hidden/pagehide, resumes on visible/bfcache and drops disconnected nodes', () => {
  const f = fixture(post('2026-10-02T09:00:00Z'), '/feed');
  const origin = f.qa.ctTimestampParse('2026-10-02T09:00:00Z').getTime();
  let now = origin + 120000, hidden = false;
  f.dom.window.Date.now = () => now;
  Object.defineProperty(f.document, 'hidden', { get: () => hidden, configurable: true });
  f.qa.ctTimestampPatchExactPostTime();
  const state = f.qa.ctTimestampClockState();
  const el = f.document.getElementById('main-created');
  assert.equal(el.textContent, '2分前');
  assert.notEqual(state.timer, null);
  hidden = true; now += 60000;
  f.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
  assert.equal(state.timer, null);
  assert.equal(el.textContent, '2分前');
  hidden = false;
  f.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
  assert.equal(el.textContent, '3分前');
  f.dom.window.dispatchEvent(new f.dom.window.Event('pagehide'));
  assert.equal(state.active, false); assert.equal(state.timer, null);
  now += 60000; f.qa.ctTimestampRefreshRelative();
  assert.equal(el.textContent, '3分前');
  const restore = new f.dom.window.Event('pageshow');
  Object.defineProperty(restore, 'persisted', { value: true });
  f.dom.window.dispatchEvent(restore);
  assert.equal(state.active, true); assert.equal(el.textContent, '4分前');
  el.closest('article').remove(); f.qa.ctTimestampRefreshRelative();
  assert.equal(state.elements.size, 0); assert.equal(state.timer, null);
  f.dom.window.close();
});

test('verified reply creation sources gain their own exact time and clock handshake, unknown replies stay native', () => {
  const f = fixture(post('2026-10-02T09:00:00Z', 'reply'), '/post/current', 'en');
  const el = f.document.getElementById('reply-created');
  el.classList.remove('hover:underline'); el.classList.add('shrink-0'); el.removeAttribute('title');
  let lastText = el.textContent;
  const created = '2026-10-02T09:01:00Z';
  f.dom.window.Date.now = () => f.qa.ctTimestampParse(created).getTime() + 120001;
  f.dom.window.ctReplyTimeSource = candidate => candidate === el && candidate.textContent === lastText ? created : '';
  f.dom.window.ctReplyTimeRendered = (candidate, text) => { if (candidate === el) lastText = text; };
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(el.textContent, '2m');
  assert.equal(lastText, '2m');
  assert.equal(f.document.querySelector('.ct-detail-post-time').textContent, f.qa.ctTimestampExactText(created));
  el.firstChild.nodeValue = 'native metadata reuse';
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  assert.equal(f.qa.ctTimestampClockState().elements.size, 0);
  assert.equal(el.textContent, 'native metadata reuse');
  f.dom.window.close();
});

test('hidden route panels, owned timelines and edited indicators never enter the native clock registry', () => {
  const f = fixture(`<div style="display:none">${post('2026-10-02T09:00:00Z', 'hidden')}</div>
    <div data-ct-owned>${post('2026-10-02T09:00:00Z', 'owned')}</div>
    <article><div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate">alice</button>
    <span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted shrink-0" title="2026-10-02T09:01:00Z" id="edited-only">Edited</span></div></article>`);
  f.dom.window.isOwnedLocalizationElement = el => !!el.closest('[data-ct-owned]');
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.qa.ctTimestampClockState().elements.size, 0);
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  assert.equal(f.document.getElementById('edited-only').textContent, 'Edited');
  f.dom.window.close();
});

test('a mounted home feed at a post URL receives only an elapsed clock, never detail creation stamps', () => {
  const f = fixture(post('2026-10-02T09:00:00Z'), '/feed');
  f.dom.reconfigure({ url: 'https://app.tweet.app/post/loading' });
  f.document.body.insertAdjacentHTML('afterbegin', '<h2>Feed</h2><textarea id="public-tweet-input"></textarea><div role="tablist"><button>For you</button></div>');
  f.qa.ctTimestampPatchExactPostTime();
  assert.equal(f.document.querySelector('.ct-detail-post-time'), null);
  assert.equal(f.qa.ctTimestampClockState().elements.size, 1);
  f.dom.window.close();
});

test('CSS-hidden route panels are excluded while responsive visible panels still update', () => {
  const f = fixture(`<style>.hidden { display: none; } .hidden.desktop-visible { display: block; }</style>
    <div class="hidden">${post('2026-10-02T09:00:00Z', 'hidden')}</div>
    <div class="hidden desktop-visible">${post('2026-10-02T09:00:00Z', 'visible')}</div>`, '/feed');
  f.qa.ctTimestampPatchExactPostTime();
  const state = f.qa.ctTimestampClockState();
  assert.equal(state.elements.size, 1);
  assert.equal([...state.elements][0].id, 'visible-created');
  f.dom.window.close();
});
