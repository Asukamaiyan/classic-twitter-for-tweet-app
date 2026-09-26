const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const runtime = fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../classic-twitter-ja.user.js'), 'utf8');
const helperNames = new Set(['ctTranslationButtonText', 'ctTranslationControls', 'ctDeclaredLanguage', 'ctLikelyLanguage']);
const helpers = [];
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && helperNames.has(node.id?.name)) helpers.push(script.slice(node.start, node.end));
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(acorn.parse(script, { ecmaVersion: 'latest' }));
assert.equal(helpers.length, helperNames.size, 'runtime fixtures use the actual shipped translation helpers');

function post(id, text = 'This is a post in English.', language = 'en', label = 'Show translation') {
  return `<article id="${id}"><p class="whitespace-pre-wrap" lang="${language}">${text}</p><p aria-live="polite"><button id="${id}-translate">${label}</button></p></article>`;
}

function harness(t, html = '', options = {}) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: `https://app.tweet.app${options.route || '/feed'}`, runScripts: 'outside-only', pretendToBeVisual: true
  });
  const window = dom.window;
  const document = window.document;
  const values = new Map(Object.entries(options.values || {}));
  let now = 10000;
  let nextID = 0;
  const timers = new Map();
  const intervals = new Map();
  const stats = { scans: 0, refreshes: 0, installs: 0, replyChecks: 0 };
  let hidden = false;
  let settings;
  Object.defineProperty(document, 'hidden', { get: () => hidden });
  Object.defineProperty(window.navigator, 'language', { value: options.browserLanguage || 'ja-JP', configurable: true });
  window.Date.now = () => now;
  window.setTimeout = (callback, delay = 0) => {
    const id = ++nextID;
    timers.set(id, { callback, at: now + Number(delay) });
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (callback, delay) => {
    const id = ++nextID;
    intervals.set(id, { callback, delay });
    return id;
  };
  window.clearInterval = id => intervals.delete(id);
  window.loadJSON = (key, fallback) => values.has(key) ? values.get(key) : fallback;
  window.saveJSON = (key, value) => {
    if (options.storageFailure) return false;
    values.set(key, value); return true;
  };
  window.installLocalEnhancements = value => {
    settings = value; stats.installs += 1;
    return { refresh() { stats.refreshes += 1; } };
  };
  window.replyWatchTick = () => { stats.replyChecks += 1; };
  window.scan = root => {
    stats.scans += 1;
    options.scan?.(root, window.qa, stats);
  };
  window.eval(`
    const KEY = { autoTranslate: 'autoTranslate' };
    const CT_LOCALE = ${JSON.stringify(options.locale || 'ja')};
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    ${helpers.join('\n')}
    ${runtime}
    window.qa = { autoTranslationEnabled, patchAutoTranslation, ctOwnTranslationText,
      ctRememberTranslationChoice, patchFavoriteButtons, articleId, start, ctRunScan, ctScheduleScan,
      pending: () => ctAutoPending.size };
  `);
  async function flush() { await Promise.resolve(); await Promise.resolve(); }
  async function advance(duration = 0) {
    const end = now + duration;
    await flush();
    let runs = 0;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++runs < 100, 'timer scan must settle rather than looping');
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); });
  return {
    dom, window, document, qa: window.qa, stats, timers, intervals, values, advance, flush,
    get settings() { return settings; },
    hidden(value) { hidden = value; document.dispatchEvent(new window.Event('visibilitychange')); },
    button(id) { return document.getElementById(`${id}-translate`); }
  };
}

function countClicks(f, id) {
  let count = 0;
  f.button(id).addEventListener('click', () => { count += 1; });
  return () => count;
}

for (const locale of ['ja', 'en']) {
  test(`${locale}: auto translation defaults off even when the legacy preference was enabled`, async t => {
    const f = harness(t, post('one'), { locale, values: { autoTranslate: true } });
    const count = countClicks(f, 'one');
    const button = f.button('one');
    const before = button.outerHTML;
    assert.equal(f.qa.autoTranslationEnabled(), false);
    f.qa.patchAutoTranslation();
    await f.advance(10000);
    assert.equal(count(), 0);
    assert.equal(button.outerHTML, before, 'the manual translator remains visible and unchanged');
    button.click();
    assert.equal(count(), 1, 'manual translation remains usable');
  });

  test(`${locale}: native favorite classes remain authoritative after repeated label changes`, t => {
    const f = harness(t, '<button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 1,234 likes"></button>', { locale });
    const button = f.document.querySelector('button');
    f.qa.patchFavoriteButtons(button);
    assert.equal(button.title, locale === 'ja' ? 'お気に入り' : 'Favorite');
    assert.equal(button.classList.contains('ct-is-liked'), false);
    assert.match(button.getAttribute('aria-label'), /1,234/);
    button.className = 'text-pink-500';
    f.qa.patchFavoriteButtons(); f.qa.patchFavoriteButtons();
    assert.equal(button.title, locale === 'ja' ? 'お気に入りを解除' : 'Unfavorite');
    assert.equal(button.classList.contains('ct-is-liked'), true);
    button.classList.remove('text-pink-500');
    f.qa.patchFavoriteButtons();
    assert.equal(button.title, locale === 'ja' ? 'お気に入り' : 'Favorite');
    assert.equal(button.classList.contains('ct-is-liked'), false, 'our old Unlike label cannot keep the favorite active');
    button.setAttribute('aria-pressed', 'true');
    f.qa.patchFavoriteButtons();
    assert.equal(button.classList.contains('ct-is-liked'), true);
    button.setAttribute('aria-pressed', 'false'); button.classList.add('text-pink-500');
    f.qa.patchFavoriteButtons();
    assert.equal(button.classList.contains('ct-is-liked'), false, 'explicit native pressed state wins');
  });
}

test('opted-in translation is throttled, deduplicated and never hides manual controls', async t => {
  const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one'); const two = countClicks(f, 'two');
  f.qa.patchAutoTranslation(); f.qa.patchAutoTranslation();
  assert.equal(f.qa.pending(), 2);
  await f.advance();
  assert.equal(one(), 1); assert.equal(two(), 0);
  await f.advance(749); assert.equal(two(), 0);
  await f.advance(1); assert.equal(two(), 1);
  f.qa.patchAutoTranslation(); await f.advance(2000);
  assert.equal(one(), 1); assert.equal(two(), 1);
  assert.equal(f.button('one').style.display, '');
  assert.equal(f.button('two').hidden, false);
});

test('Show original is preserved and manual choice cancels delayed and replacement controls', async t => {
  const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one'); const two = countClicks(f, 'two');
  f.qa.start();
  f.qa.patchAutoTranslation();
  await f.advance(); assert.equal(one(), 1);
  f.button('one').textContent = 'Show original';
  f.button('one').click();
  f.button('one').textContent = 'Show translation';
  f.button('two').click();
  f.button('two').replaceWith(f.button('two').cloneNode(true));
  const replacement = countClicks(f, 'two');
  f.qa.patchAutoTranslation();
  await f.advance(5000);
  assert.equal(one(), 2, 'one automatic click and one explicit user click');
  assert.equal(two(), 1, 'the queued second automatic click was canceled');
  assert.equal(replacement(), 0, 'manual choice survives React replacing the button');
  assert.equal(f.qa.pending(), 0);
});

test('already translated posts retain Show original without an automatic click', async t => {
  const f = harness(t, post('one', 'This is translated text.', 'en', 'Show original'), { values: { 'autoTranslate.optInV2': true } });
  const count = countClicks(f, 'one');
  const before = f.button('one').outerHTML;
  f.qa.patchAutoTranslation(); await f.advance(2000);
  assert.equal(count(), 0); assert.equal(f.button('one').outerHTML, before);
});

test('language detection uses the own post body and native browser target language', async t => {
  const f = harness(t, `
    <article id="english"><div aria-label="Quoted post by Alice"><p class="whitespace-pre-wrap" lang="ja">こんにちは</p></div>
      <p class="whitespace-pre-wrap" lang="en">This is English.</p><p aria-live="polite"><button id="english-translate">Show translation</button></p></article>
    <article id="japanese"><blockquote><p class="whitespace-pre-wrap" lang="en">This is a quote.</p></blockquote>
      <p class="whitespace-pre-wrap" lang="ja">こんにちは世界</p><p aria-live="polite"><button id="japanese-translate">Show translation</button></p></article>
    <article><p class="whitespace-pre-wrap" lang="ja">これは親の本文です</p><div data-testid="quote-tweet">
      <p class="whitespace-pre-wrap" lang="en">This is a quote.</p><p aria-live="polite"><button id="quote-translate">Show translation</button></p></div></article>
  `, { browserLanguage: 'en-US', values: { 'autoTranslate.optInV2': true } });
  const english = countClicks(f, 'english'); const japanese = countClicks(f, 'japanese'); const quote = countClicks(f, 'quote');
  f.qa.patchAutoTranslation(); await f.advance(5000);
  assert.equal(english(), 0); assert.equal(japanese(), 1); assert.equal(quote(), 0);
});

test('disable, backgrounding and leaving the page cancel queued translation', async t => {
  for (const mode of ['disable', 'hidden', 'pagehide']) {
    const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
    const count = countClicks(f, 'two');
    f.qa.start(); f.qa.patchAutoTranslation(); await f.advance();
    if (mode === 'disable') f.settings.setAutoTranslate(false);
    if (mode === 'hidden') f.hidden(true);
    if (mode === 'pagehide') f.window.dispatchEvent(new f.window.Event('pagehide'));
    assert.equal(f.qa.pending(), 0, mode);
    await f.advance(5000); assert.equal(count(), 0, mode);
  }
});

test('queued translation rechecks attachment, source text, disabled state and button action', async t => {
  for (const mode of ['detached', 'text-changed', 'disabled', 'busy', 'show-original']) {
    const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
    const count = countClicks(f, 'two');
    f.qa.patchAutoTranslation(); await f.advance();
    const button = f.button('two');
    if (mode === 'detached') button.remove();
    if (mode === 'text-changed') f.document.querySelector('#two p').textContent = 'Changed while waiting.';
    if (mode === 'disabled') button.setAttribute('aria-disabled', 'true');
    if (mode === 'busy') button.setAttribute('aria-busy', 'true');
    if (mode === 'show-original') button.textContent = 'Show original';
    await f.advance(1000); assert.equal(count(), 0, mode);
  }
});

test('storage failure does not silently enable automatic translation', t => {
  const f = harness(t, post('one'), { storageFailure: true });
  f.qa.start();
  assert.throws(() => f.settings.setAutoTranslate(true), /Storage unavailable/);
  assert.equal(f.qa.autoTranslationEnabled(), false);
});

test('own permalink wins over quote, nested article, content link and foreign URLs', t => {
  const f = harness(t, `<article id="parent">
    <a href="/post/mention">a mentioned post</a>
    <div aria-label="Quoted post by Alice"><a href="/post/quote"><time>1h</time></a></div>
    <article><a href="/post/nested"><time>1h</time></a></article>
    <a href="https://other.test/post/foreign"><time>1h</time></a>
    <a href="/post/own_A-1"><time>2h</time></a></article>`);
  assert.equal(f.qa.articleId(f.document.getElementById('parent')), 'own_A-1');
  assert.equal(f.qa.articleId(null), null);
});

test('detail-route fallback is limited to the first non-quoted article', t => {
  const f = harness(t, '<article id="main"><div data-testid="quote-tweet"><a href="/post/quoted"><time>1h</time></a></div></article><article id="reply"></article>', { route: '/post/detail_123' });
  assert.equal(f.qa.articleId(f.document.getElementById('main')), 'detail_123');
  assert.equal(f.qa.articleId(f.document.getElementById('reply')), null);
  const g = harness(t, '<blockquote><article id="quoted"></article></blockquote>', { route: '/post/detail_123' });
  assert.equal(g.qa.articleId(g.document.getElementById('quoted')), null);
});

test('observer settles after own scan writes and batches dynamic navigation and native changes', async t => {
  const f = harness(t, '<nav><button id="nav">Home</button></nav><button id="like" data-testid="tweet-like-action" class="text-tl-app-text-muted"></button><div data-ct-owned="true"><span id="owned">Tools</span></div>', {
    scan(document, qa) {
      document.getElementById('nav').textContent = 'ホーム';
      qa.patchFavoriteButtons(document);
    }
  });
  f.qa.start(); f.qa.start();
  assert.equal(f.stats.scans, 1); assert.equal(f.stats.installs, 1);
  assert.equal(f.intervals.size, 1);
  await f.advance(1000); assert.equal(f.stats.scans, 1, 'no idle observer cycle from script mutations');
  f.document.getElementById('nav').textContent = 'Notifications';
  f.document.getElementById('like').className = 'text-pink-500';
  await f.advance(99); assert.equal(f.stats.scans, 1);
  await f.advance(1); assert.equal(f.stats.scans, 2);
  assert.equal(f.document.getElementById('like').classList.contains('ct-is-liked'), true);
  await f.advance(1000); assert.equal(f.stats.scans, 2);
  f.document.getElementById('nav').textContent = 'ホーム';
  f.document.getElementById('owned').textContent = 'Settings';
  await f.advance(1000); assert.equal(f.stats.scans, 2, 'identical native text and owned content do not schedule scans');
  f.window.history.pushState({}, '', '/notifications');
  f.window.history.replaceState({}, '', '/settings');
  f.window.dispatchEvent(new f.window.PopStateEvent('popstate'));
  await f.advance(100); assert.equal(f.stats.scans, 3, 'route changes are debounced');
  assert.equal(f.stats.refreshes, 3);
});

test('busy translation controls are reconsidered when native loading finishes', async t => {
  const f = harness(t, post('one'), {
    values: { 'autoTranslate.optInV2': true },
    scan(document, qa) { qa.patchAutoTranslation(document); }
  });
  const count = countClicks(f, 'one');
  f.button('one').setAttribute('aria-busy', 'true');
  f.qa.start(); await f.advance(1000); assert.equal(count(), 0);
  f.button('one').removeAttribute('aria-busy');
  await f.advance(100); assert.equal(count(), 1);
});

test('pagehide stops observer and interval, and persisted pageshow restores one of each', async t => {
  const f = harness(t, '<button>Home</button>');
  f.qa.start();
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.intervals.size, 0);
  f.document.querySelector('button').textContent = 'Notifications';
  await f.advance(1000); assert.equal(f.stats.scans, 1);
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  await f.advance(100); assert.equal(f.stats.scans, 2); assert.equal(f.intervals.size, 1);
  const interval = [...f.intervals.values()][0];
  interval.callback(); assert.equal(f.stats.replyChecks, 1);
  f.hidden(true); interval.callback(); assert.equal(f.stats.replyChecks, 1);
});
