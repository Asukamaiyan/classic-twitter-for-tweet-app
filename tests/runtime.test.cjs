const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const translation = fs.readFileSync(path.join(__dirname, '../src/translation.js'), 'utf8');
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

function post(id, text = `This is a post in English. ${id}`,  language = 'en', label = 'Show translation') {
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
  const stats = { scans: 0, refreshes: 0, installs: 0 };
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
  window.scan = root => {
    stats.scans += 1;
    options.scan?.(root, window.qa, stats);
  };
  window.ctCaptureFavoriteClick = () => {};
  window.ctRestoreVisibleFavorites = async () => ({saved:0,unresolved:0});
  window.eval(`
    const KEY = { autoTranslate: 'autoTranslate' };
    const CT_LOCALE = ${JSON.stringify(options.locale || 'ja')};
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    ${helpers.join('\n')}
    ${translation}
    ${runtime}
    window.qa = { autoTranslationEnabled, patchAutoTranslation, ctOwnTranslationText,
      ctRememberTranslationChoice, patchFavoriteButtons, articleId, start, ctRunScan, ctScheduleScan,
      ctPrepareFavoritePresentation, pending: () => ctAutoPending.size };
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

function countClicks(f, id, complete = true) {
  let count = 0;
  f.button(id).addEventListener('click', () => { count += 1; if (complete) f.button(id).textContent = 'Show original'; });
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
  await f.advance(1499); assert.equal(two(), 0);
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
    await f.advance(2000); assert.equal(count(), 0, mode);
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
  assert.equal(f.intervals.size, 0, 'native notifications own their refresh interval');
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

test('pagehide stops observation and persisted pageshow restores it without notification polling', async t => {
  const f = harness(t, '<button>Home</button>');
  f.qa.start();
  assert.equal(f.intervals.size, 0, 'startup does not install a duplicate notification interval');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.intervals.size, 0);
  f.document.querySelector('button').textContent = 'Notifications';
  await f.advance(1000); assert.equal(f.stats.scans, 1);
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  await f.advance(100); assert.equal(f.stats.scans, 2); assert.equal(f.intervals.size, 0);
  f.hidden(true); await f.advance(1000); assert.equal(f.stats.scans, 2);
  f.hidden(false); await f.advance(100); assert.equal(f.stats.scans, 3, 'visible pages rescan existing native UI');
  assert.equal(f.intervals.size, 0, 'backgrounding and BFCache restores never restart retired reply polling');
});

test('native translation waits for completion before sending the next request', async t => {
  const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one', false), two = countClicks(f, 'two');
  f.qa.patchAutoTranslation(); await f.advance();
  f.button('one').setAttribute('aria-busy', 'true');
  await f.advance(5000);
  assert.equal(one(), 1); assert.equal(two(), 0);
  f.button('one').removeAttribute('aria-busy'); f.button('one').textContent = 'Show original';
  await f.advance(249); assert.equal(two(), 0);
  await f.advance(1501); assert.equal(two(), 1);
});

test('native error cancels queued requests, survives backgrounding and permits manual retry', async t => {
  const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one', false), two = countClicks(f, 'two');
  f.qa.start(); f.qa.patchAutoTranslation(); await f.advance();
  f.hidden(true);
  const alert = f.document.createElement('p'); alert.setAttribute('role', 'alert');
  alert.textContent = '翻訳できませんでした。もう一度お試しください。';
  f.button('one').parentElement.parentElement.append(alert);
  await f.advance(250); f.hidden(false);
  assert.equal(f.qa.pending(), 0); assert.match(f.settings.getTranslationStatus(), /5分/);
  f.qa.patchAutoTranslation(); await f.advance(2000); assert.equal(two(), 0);
  f.button('one').click(); assert.equal(one(), 2, 'manual control was not disabled or hidden');
  alert.remove();
  await f.advance(300000); f.qa.patchAutoTranslation(); await f.advance();
  assert.equal(two(), 1, 'other posts can resume after cooldown');
});

test('native timeout pauses the queue instead of flooding more requests', async t => {
  const f = harness(t, post('one') + post('two'), { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one', false), two = countClicks(f, 'two');
  f.qa.start(); f.qa.patchAutoTranslation(); await f.advance(15000); await f.advance(15000);
  assert.equal(one(), 1); assert.equal(two(), 0);
  assert.match(f.settings.getTranslationStatus(), /5分/);
});

test('native attempts deduplicate React replacement by own permalink and original body', async t => {
  const html = post('one').replace('<article id="one">', '<article id="one"><a href="/post/real-id"><time>now</time></a>');
  const f = harness(t, html, { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one'); f.qa.patchAutoTranslation(); await f.advance(); assert.equal(one(), 1);
  f.document.querySelector('article').outerHTML = html;
  const replacement = countClicks(f, 'one'); f.qa.patchAutoTranslation(); await f.advance(2000);
  assert.equal(replacement(), 0);
  f.document.querySelector('.whitespace-pre-wrap').textContent = 'This post has been edited.';
  f.qa.patchAutoTranslation(); await f.advance(); assert.equal(replacement(), 1);
});

test('feed cards without permalinks deduplicate exact text across remounts', async t => {
  const f = harness(t, post('one'), { values: { 'autoTranslate.optInV2': true } });
  const one = countClicks(f, 'one'); f.qa.patchAutoTranslation(); await f.advance(); assert.equal(one(), 1);
  f.document.querySelector('article').outerHTML = post('one');
  const replacement = countClicks(f, 'one'); f.qa.patchAutoTranslation(); await f.advance(2000);
  assert.equal(replacement(), 0);
  f.button('one').click(); assert.equal(replacement(), 1, 'dedupe does not disable manual translation');
});

test('native same-language response completes even when a fast busy state was not observed', async t => {
  const f = harness(t, post('one') + post('two', 'This is another post.'), { values: { 'autoTranslate.optInV2': true } });
  f.button('one').addEventListener('click', () => f.button('one').setAttribute('aria-disabled', 'true'));
  const two = countClicks(f, 'two'); f.qa.patchAutoTranslation(); await f.advance(1500);
  assert.equal(two(), 1);
});

test('unmounting an in-flight native translation pauses new requests instead of assuming completion', async t => {
  const f = harness(t, post('one'), { values: { 'autoTranslate.optInV2': true } });
  f.qa.start(); const one = countClicks(f, 'one', false);
  f.qa.patchAutoTranslation(); await f.advance(); assert.equal(one(), 1);
  f.document.querySelector('article').remove();
  f.document.body.insertAdjacentHTML('beforeend', post('two'));
  const two = countClicks(f, 'two'); f.qa.patchAutoTranslation(); await f.advance(2000);
  assert.equal(two(), 0); assert.match(f.settings.getTranslationStatus(), /完了を確認できない/);
});

test('favorite vector preserves the native icon, click handler and count on React updates', t => {
  const f = harness(t, '<button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 14 likes"><svg class="lucide-heart"><path></path></svg></button>');
  const button = f.document.querySelector('button');
  const native = button.querySelector('svg');
  let clicks = 0; button.addEventListener('click', () => clicks++);
  f.qa.patchFavoriteButtons(); f.qa.patchFavoriteButtons();
  assert.equal(button.querySelectorAll('.ct-star').length, 1);
  assert.equal(button.querySelector('.ct-star').getAttribute('aria-hidden'), 'true');
  assert.equal(button.querySelector('svg.lucide-heart'), native);
  assert.match(button.getAttribute('aria-label'), /14/);
  button.click(); assert.equal(clicks, 1);
  button.className = 'text-pink-500';
  button.querySelector('.ct-star').remove(); // Native React can replace icon children.
  f.qa.patchFavoriteButtons();
  assert.equal(button.querySelectorAll('.ct-star svg').length, 1);
  assert.equal(button.querySelector('svg.lucide-heart'), native);
  assert.equal(button.classList.contains('ct-is-liked'), true);
});

test('native hearts stay hidden immediately through class, icon and complete button replacements', t => {
  const f = harness(t, '<button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 14 likes"><svg class="lucide-heart"><path></path></svg></button><button id="other"><svg class="lucide-heart"></svg></button>');
  const button = f.document.querySelector('[data-testid="tweet-like-action"]');
  f.qa.patchFavoriteButtons();
  assert.equal(f.document.querySelectorAll('#ct-favorite-presentation-style').length, 1);
  button.className = 'text-pink-500';
  assert.equal(f.window.getComputedStyle(button.querySelector('svg.lucide-heart')).display, 'none');
  button.innerHTML = '<svg class="lucide-heart native-replacement"><path></path></svg>';
  assert.equal(button.querySelector('.ct-star'), null, 'the CSS covers the gap before the delayed scan');
  assert.equal(f.window.getComputedStyle(button.querySelector('svg')).display, 'none');
  assert.equal(f.window.getComputedStyle(button).color, 'rgb(255, 172, 51)', 'native selected state colors the CSS fallback immediately');
  const replacement = button.cloneNode(true);
  replacement.className = 'text-tl-app-text-muted';
  button.replaceWith(replacement);
  assert.equal(f.window.getComputedStyle(replacement.querySelector('svg')).display, 'none');
  assert.notEqual(f.window.getComputedStyle(f.document.querySelector('#other svg')).display, 'none', 'unrelated native heart controls stay untouched');
  f.qa.patchFavoriteButtons();
  assert.equal(replacement.querySelectorAll('.ct-star').length, 1);
  assert.equal(f.document.querySelectorAll('#ct-favorite-presentation-style').length, 1);
  const rules = f.document.getElementById('ct-favorite-presentation-style').textContent;
  assert.match(rules, /:has\(> span\.ct-star\)::before \{ display:none!important;/);
  assert.match(rules, /-webkit-mask:.*data:image\/svg\+xml/);
});

test('native pressed and muted states override stale favorite markers without waiting for another scan', t => {
  const f = harness(t, '<button data-testid="tweet-like-action" class="text-pink-500" aria-label="Unlike"><svg></svg></button>');
  const button = f.document.querySelector('button');
  f.qa.patchFavoriteButtons();
  assert.equal(button.classList.contains('ct-is-liked'), true);
  button.className = 'text-tl-app-text-muted ct-favorite-button ct-is-liked';
  assert.notEqual(f.window.getComputedStyle(button).color, 'rgb(255, 172, 51)');
  assert.equal(f.window.getComputedStyle(button.querySelector('.ct-star svg')).fill, 'none');
  button.className = 'text-pink-500 ct-favorite-button ct-is-liked';
  button.setAttribute('aria-pressed', 'false');
  assert.notEqual(f.window.getComputedStyle(button).color, 'rgb(255, 172, 51)');
  assert.equal(f.window.getComputedStyle(button.querySelector('.ct-star svg')).fill, 'none');
  button.setAttribute('aria-pressed', 'true');
  assert.equal(f.window.getComputedStyle(button).color, 'rgb(255, 172, 51)');
  assert.equal(f.window.getComputedStyle(button.querySelector('.ct-star svg')).fill, 'currentColor');
});

test('native notification heart replacements remain vector stars without affecting other icons', t => {
  const f = harness(t, '<div id="root-container"><main><button class="w-full flex items-start border-b"><div class="mt-0.5 shrink-0 ct-notification-fav-icon"><svg class="lucide lucide-heart text-rose-500" width="28" height="28"><path id="notification-heart"></path></svg></div></button><button><svg class="lucide-heart text-rose-500" width="28" height="28"><path id="other-heart"></path></svg></button></main></div>');
  f.qa.patchFavoriteButtons();
  const row = f.document.querySelector('button.w-full');
  row.firstElementChild.className = 'mt-0.5 shrink-0';
  row.firstElementChild.innerHTML = '<svg class="lucide lucide-heart text-rose-500" width="28" height="28"><path id="notification-heart"></path></svg>';
  assert.equal(f.window.getComputedStyle(f.document.getElementById('notification-heart')).visibility, 'hidden');
  assert.notEqual(f.window.getComputedStyle(f.document.getElementById('other-heart')).visibility, 'hidden');
  assert.equal(f.window.getComputedStyle(row.querySelector('svg')).backgroundColor, 'rgb(255, 172, 51)');
});

test('v2.1.0 wrapped notification hearts remain vector stars before the observer scan', t => {
  const f = harness(t, '<div id="root-container"><main><div class="border-b border-tl-app-border"><button class="w-full flex items-start gap-3"><div class="mt-0.5 shrink-0"><svg class="lucide lucide-heart text-rose-500" width="28" height="28"><path id="wrapped-heart"></path></svg></div></button></div><div class="border-b"><button class="w-full flex items-start"><div class="mt-0.5 shrink-0"><svg class="lucide-heart text-rose-500" width="28" height="28"><path id="unrelated-heart"></path></svg></div></button></div></main></div>');
  f.qa.patchFavoriteButtons();
  const row = f.document.querySelector('button.gap-3');
  row.firstElementChild.innerHTML = '<svg class="lucide lucide-heart text-rose-500" width="28" height="28"><path id="wrapped-heart"></path></svg>';
  const icon = row.querySelector('svg');
  assert.equal(f.window.getComputedStyle(f.document.getElementById('wrapped-heart')).visibility, 'hidden');
  assert.equal(f.window.getComputedStyle(icon).backgroundColor, 'rgb(255, 172, 51)');
  assert.match(f.window.getComputedStyle(icon).getPropertyValue('mask'), /data:image\/svg\+xml/);
  assert.notEqual(f.window.getComputedStyle(f.document.getElementById('unrelated-heart')).visibility, 'hidden', 'a different button structure is not treated as a notification event');
});

test('classic appearance defaults on and persists independently of existing settings', t => {
  const f = harness(t, '', { values: {'autoTranslate.optInV2': true, 'existing-favorite-key': [{id:'saved'}]} });
  f.qa.start();
  assert.equal(f.settings.getClassicAppearance(), true);
  f.settings.setClassicAppearance(false);
  assert.equal(f.settings.getClassicAppearance(), false);
  assert.equal(f.qa.autoTranslationEnabled(), true);
  f.settings.setClassicAppearance(true);
  assert.equal(f.settings.getClassicAppearance(), true);
});

test('native favorite count stays gold immediately when React replaces all group classes', t => {
  const f = harness(t, '<article><div class="group flex items-center gap-0.5"><button data-testid="tweet-like-action" class="text-tl-app-text-muted"><svg></svg></button><span class="text-xs tabular-nums">1</span></div></article>');
  const button = f.document.querySelector('button'), count = f.document.querySelector('span');
  f.qa.patchFavoriteButtons();
  button.className = 'text-pink-500'; button.parentElement.className = 'group flex items-center gap-0.5 text-pink-500';
  count.className = 'text-xs tabular-nums text-pink-500';
  assert.equal(f.window.getComputedStyle(count).color, 'rgb(255, 172, 51)');
  button.className = 'text-tl-app-text-muted'; count.className = 'text-xs tabular-nums';
  assert.notEqual(f.window.getComputedStyle(count).color, 'rgb(255, 172, 51)');
});

for (const locale of ['ja', 'en']) {
  test(`${locale}: early favorite presentation repairs React commits before any timer or main scan`, async t => {
    const f = harness(t, `<div data-app-theme="dark"><article>
      <p class="whitespace-pre-wrap break-words" id="user-text">Like Liked by ❤</p>
      <button class="font-bold truncate" id="name">Liked by</button>
      <div class="group flex items-center gap-0.5"><button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 3 likes"><svg class="lucide-heart"></svg></button>
      <button data-testid="tweet-like-action-count" aria-label="View 3 likes">3</button></div>
      </article><textarea>Like ❤ draft</textarea><button id="unrelated" title="Like"><svg class="lucide-heart"></svg>Like</button></div>`, { locale });
    Object.defineProperty(f.document, 'readyState', { get: () => 'loading' });
    const button = f.document.querySelector('[data-testid="tweet-like-action"]');
    const count = f.document.querySelector('[data-testid="tweet-like-action-count"]');
    const native = button.querySelector('svg');
    let clicks = 0, countClicks = 0;
    button.addEventListener('click', () => clicks++); count.addEventListener('click', () => countClicks++);
    f.qa.ctPrepareFavoritePresentation(); f.qa.ctPrepareFavoritePresentation();
    assert.equal(f.window.getComputedStyle(native).display, 'none');
    assert.equal(f.window.getComputedStyle(button.querySelector('.ct-star')).width, '20px', 'the early vector is sized before the main locale stylesheet');
    assert.equal(f.document.querySelectorAll('#ct-favorite-presentation-style').length, 1);
    assert.equal(button.title, locale === 'ja' ? 'お気に入り' : 'Favorite');
    assert.equal(count.getAttribute('aria-label'), locale === 'ja' ? '3件のお気に入りを表示' : 'View 3 favorites');
    button.className = 'text-pink-500'; button.title = 'Like'; button.setAttribute('aria-label', 'Like, 4 likes');
    button.innerHTML = '<span class="native-icon-wrap"><svg class="lucide-heart"><path></path></svg></span><span class="native-label">Like</span>';
    count.textContent = '4'; count.setAttribute('aria-label', 'View 4 likes');
    const wrapped = button.querySelector('.native-icon-wrap svg');
    assert.equal(f.window.getComputedStyle(wrapped).display, 'none', 'CSS covers a wrapped icon before even the observer callback');
    await f.flush();
    const selected = locale === 'ja' ? 'お気に入りを解除' : 'Unfavorite';
    assert.equal(button.title, selected); assert.match(button.getAttribute('aria-label'), /4/);
    assert.equal(button.querySelector('.native-label').textContent, selected);
    assert.equal(button.querySelectorAll('.ct-star').length, 1);
    assert.equal(button.querySelector('.native-icon-wrap svg'), wrapped, 'native icons are retained rather than removed');
    assert.equal(count.title, locale === 'ja' ? '4件のお気に入りを表示' : 'View 4 favorites');
    button.click(); count.click(); assert.equal(clicks, 1); assert.equal(countClicks, 1);
    const replacement = f.document.createElement('button');
    replacement.dataset.testid = 'tweet-like-action'; replacement.className = 'text-tl-app-text-muted';
    replacement.setAttribute('aria-label', 'Like, 4 likes'); replacement.innerHTML = '<svg class="lucide-heart"></svg>Like';
    button.replaceWith(replacement); await f.flush();
    assert.equal(replacement.textContent, locale === 'ja' ? 'お気に入り' : 'Favorite');
    assert.equal(replacement.querySelectorAll('.ct-star').length, 1);
    assert.equal(f.stats.scans, 0, 'none of these repairs waits for the general full-page scan');
    assert.equal(f.timers.size, 0, 'no 100ms debounce or repeating repair timer is used');
    assert.equal(f.document.getElementById('user-text').textContent, 'Like Liked by ❤');
    assert.equal(f.document.getElementById('name').textContent, 'Liked by');
    assert.equal(f.document.querySelector('textarea').value, 'Like ❤ draft');
    assert.equal(f.document.querySelector('[data-app-theme]').dataset.appTheme, 'dark');
    assert.equal(f.document.getElementById('unrelated').textContent, 'Like');
    assert.equal(f.document.getElementById('unrelated').title, 'Like');
    assert.notEqual(f.window.getComputedStyle(f.document.querySelector('#unrelated svg')).display, 'none');
  });

  test(`${locale}: native Favorites dialog labels are repaired before the general scan while names and posts stay intact`, async t => {
    const f = harness(t, `<main><p>Liked by</p></main><div role="dialog" aria-modal="true" class="bg-tl-app-card border" id="other-dialog"><h3>Liked by</h3></div>`, { locale });
    f.qa.ctPrepareFavoritePresentation();
    const dialog = f.document.createElement('div');
    dialog.className = 'relative bg-tl-app-card border overflow-hidden flex flex-col';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Liked by');
    dialog.innerHTML = `<div class="flex items-center justify-between px-4 py-3 border-b"><h3 class="text-sm font-bold text-tl-app-text">Liked by</h3>
      <button aria-label="Close liked by list"><svg class="lucide lucide-x"></svg></button></div>
      <div class="flex-1 overflow-y-auto"><div class="px-4 py-10 text-center text-xs text-tl-app-text-muted font-medium">No likes yet.</div>
      <div><button class="font-bold truncate" id="user-name">Liked by</button><p id="user-post">No likes yet. Like ❤</p></div></div>`;
    let closes = 0; const close = dialog.querySelector('button'); const heading = dialog.querySelector('h3'); const headingText = heading.firstChild;
    close.addEventListener('click', () => closes++); f.document.body.append(dialog); await f.flush();
    const label = locale === 'ja' ? 'お気に入りしたユーザー' : 'Favorited by';
    const closeLabel = locale === 'ja' ? 'お気に入りしたユーザー一覧を閉じる' : 'Close Favorites list';
    assert.equal(heading.textContent, label); assert.equal(heading.firstChild, headingText);
    assert.equal(dialog.getAttribute('aria-label'), label); assert.equal(close.getAttribute('aria-label'), closeLabel);
    assert.equal(close.title, closeLabel); close.click(); assert.equal(closes, 1);
    assert.equal(dialog.querySelector('.text-center').textContent, locale === 'ja' ? 'お気に入りはまだありません。' : 'No favorites yet.');
    heading.firstChild.nodeValue = 'Liked by'; dialog.setAttribute('aria-label', 'Liked by'); close.setAttribute('aria-label', 'Close liked by list');
    await f.flush(); assert.equal(heading.textContent, label); assert.equal(close.getAttribute('aria-label'), closeLabel);
    assert.equal(dialog.querySelector('#user-name').textContent, 'Liked by'); assert.equal(dialog.querySelector('#user-post').textContent, 'No likes yet. Like ❤');
    assert.equal(f.document.getElementById('other-dialog').textContent, 'Liked by'); assert.equal(f.document.querySelector('main p').textContent, 'Liked by');
    assert.equal(f.stats.scans, 0); assert.equal(f.timers.size, 0);
  });
}

test('early favorite observer resumes after a persisted page return and restores a removed stylesheet', async t => {
  const f = harness(t, '<button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 1 like"><svg></svg></button>');
  f.qa.ctPrepareFavoritePresentation();
  const button = f.document.querySelector('button');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  button.setAttribute('aria-label', 'Like, 1 like'); await f.flush();
  assert.equal(button.getAttribute('aria-label'), 'Like, 1 like');
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true })); await f.flush();
  assert.equal(button.getAttribute('aria-label'), 'お気に入り, 1 件');
  f.document.getElementById('ct-favorite-presentation-style').remove(); await f.flush();
  assert.equal(f.document.querySelectorAll('#ct-favorite-presentation-style').length, 1);
  button.title = 'Like'; await f.flush(); assert.equal(button.title, 'お気に入り');
  assert.equal(f.stats.scans, 0); assert.equal(f.timers.size, 0);
});

test('document-start favorite repair waits for an HTML root and protects editable/user-owned controls', async t => {
  const f = harness(t);
  f.document.documentElement.remove(); f.qa.ctPrepareFavoritePresentation();
  const html = f.document.createElement('html'); html.innerHTML = `<head></head><body>
    <button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like"><svg></svg></button>
    <div contenteditable="true"><button data-testid="tweet-like-action" aria-label="Like">Like</button></div>
    <div data-ct-owned="fixture"><button data-testid="tweet-like-action" aria-label="Like">Like</button></div>
    </body>`;
  f.document.append(html); await f.flush();
  assert.equal(f.document.querySelector('body > button').title, 'お気に入り');
  for (const protectedButton of f.document.querySelectorAll('div > button')) {
    assert.equal(protectedButton.textContent, 'Like'); assert.equal(protectedButton.getAttribute('aria-label'), 'Like');
    assert.equal(protectedButton.querySelector('.ct-star'), null);
  }
  assert.equal(f.timers.size, 0);
});

test('early favorite repair ignores unrelated body mutations and visits only controls in newly added subtrees', async t => {
  const f = harness(t, '<main><button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like"><svg></svg></button></main>');
  f.qa.ctPrepareFavoritePresentation();
  const repaired = []; const original = f.window.patchFavoriteButtons;
  f.window.patchFavoriteButtons = root => { repaired.push(root); original(root); };
  f.document.body.className = 'new-native-layout';
  f.document.body.insertAdjacentHTML('beforeend', '<article><p>Like Liked by ❤ unrelated post</p></article>');
  await f.flush(); assert.deepEqual(repaired, [], 'body-level updates must not trigger a page-wide favorite traversal');
  f.document.body.insertAdjacentHTML('beforeend', '<article><div><button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 2 likes"><svg></svg></button><button data-testid="tweet-like-action-count" aria-label="View 2 likes">2</button></div></article>');
  await f.flush();
  assert.equal(repaired.length, 2); assert.ok(repaired.every(root => root.matches('button[data-testid^="tweet-like-action"]')));
  assert.equal(f.document.querySelector('article button[data-testid="tweet-like-action"]').title, 'お気に入り');
  await f.flush(); assert.equal(repaired.length, 2, 'its own presentation changes cannot schedule another repair');
  assert.equal(f.timers.size, 0); assert.equal(f.stats.scans, 0);
});

test('failed appearance save retains the previous option', t => {
  const f = harness(t, '', { storageFailure: true });
  f.qa.start();
  assert.throws(() => f.settings.setClassicAppearance(false), /Storage unavailable/);
  assert.equal(f.settings.getClassicAppearance(), true);
});

for (const locale of ['ja', 'en']) {
  test(`${locale}: the classic switch restores native hearts, colors and current labels synchronously, then enables once`, async t => {
    const f = harness(t, `<style>.text-pink-500 { color:rgb(236, 72, 153); }</style>
      <div id="root-container"><main><article><p class="tl-user-text">Favorite Like ❤ body</p><div class="group flex items-center gap-0.5">
      <button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 1 like"><svg class="lucide-heart"><path></path></svg><span>Like</span></button>
      <button data-testid="tweet-like-action-count" aria-label="View 1 like" title="View 1 like">1</button></div></article>
      <button class="w-full flex items-start border-b"><div class="mt-0.5 shrink-0"><svg class="lucide-heart text-rose-500" width="28" height="28"><path id="notice-heart"></path></svg></div></button>
      </main></div><textarea>Favorite Like ❤ draft</textarea>`, { locale });
    const button = f.document.querySelector('[data-testid="tweet-like-action"]');
    const count = f.document.querySelector('[data-testid="tweet-like-action-count"]');
    const icon = button.querySelector('svg'), labelNode = button.querySelector('span').firstChild;
    let clicks = 0; button.addEventListener('click', () => clicks++);
    f.qa.ctPrepareFavoritePresentation(); f.qa.start();
    assert.equal(f.window.getComputedStyle(icon).display, 'none');
    assert.equal(f.window.getComputedStyle(f.document.getElementById('notice-heart')).visibility, 'hidden');
    f.settings.setClassicAppearance(false);
    assert.equal(f.document.documentElement.dataset.ctFavoriteClassic, 'off');
    assert.equal(button.querySelector('.ct-star'), null);
    assert.notEqual(f.window.getComputedStyle(icon).display, 'none');
    assert.notEqual(f.window.getComputedStyle(f.document.getElementById('notice-heart')).visibility, 'hidden');
    assert.equal(button.className, 'text-tl-app-text-muted');
    assert.equal(button.getAttribute('title'), null, 'the native absence of an action tooltip is restored');
    assert.equal(labelNode.nodeValue, locale === 'ja' ? 'いいね' : 'Like');
    assert.equal(count.getAttribute('aria-label'), locale === 'ja' ? '1件のいいねを表示' : 'View 1 likes');
    assert.equal(count.title, locale === 'ja' ? '1件のいいねを表示' : 'View 1 likes');
    button.className = 'text-pink-500'; button.setAttribute('aria-label', 'Like, 4 likes'); button.title = 'Like'; labelNode.nodeValue = 'Like';
    count.textContent = '4'; count.setAttribute('aria-label', 'View 4 likes'); count.title = 'Native new count tooltip';
    await f.flush();
    assert.equal(button.getAttribute('aria-label'), locale === 'ja' ? 'いいねを取り消す, 4 件' : 'Unlike, 4 likes');
    assert.equal(labelNode.nodeValue, locale === 'ja' ? 'いいねを取り消す' : 'Unlike');
    assert.equal(button.querySelector('.ct-star'), null);
    assert.equal(f.window.getComputedStyle(button).color, 'rgb(236, 72, 153)', 'native selected pink is released after OFF');
    assert.equal(count.title, 'Native new count tooltip', 'native title changes are never reverted to an older snapshot');
    assert.equal(count.getAttribute('aria-label'), locale === 'ja' ? '4件のいいねを表示' : 'View 4 likes');
    const watcher = new f.window.MutationObserver(() => {});
    watcher.observe(button.parentElement, { subtree:true, childList:true, attributes:true, characterData:true });
    f.qa.patchFavoriteButtons(); assert.deepEqual(watcher.takeRecords(), [], 'a stable OFF scan cannot keep rewriting native controls'); watcher.disconnect();
    f.settings.setClassicAppearance(true);
    assert.equal(button.querySelectorAll('.ct-star').length, 1);
    assert.equal(f.window.getComputedStyle(icon).display, 'none');
    assert.equal(button.getAttribute('aria-label'), locale === 'ja' ? 'お気に入りを解除, 4 件' : 'Unfavorite, 4 favorites');
    f.settings.setClassicAppearance(false);
    assert.equal(button.querySelector('.ct-star'), null);
    assert.equal(count.title, 'Native new count tooltip');
    assert.equal(button.querySelector('svg'), icon); assert.equal(button.querySelector('span').firstChild, labelNode);
    assert.equal(f.document.querySelector('textarea').value, 'Favorite Like ❤ draft');
    assert.equal(f.document.querySelector('.tl-user-text').textContent, 'Favorite Like ❤ body');
    button.click(); assert.equal(clicks, 1);
  });

  test(`${locale}: a saved classic OFF preference respects native first paint and React replacements`, async t => {
    const f = harness(t, '<button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 2 likes"><svg class="lucide-heart"></svg>Like</button>', {
      locale, values: { 'ct-classic-appearance-v1': false }
    });
    Object.defineProperty(f.document, 'readyState', { get: () => 'loading' });
    const original = f.document.querySelector('button'); const before = original.outerHTML;
    f.qa.ctPrepareFavoritePresentation();
    assert.equal(original.querySelector('.ct-star'), null);
    assert.notEqual(f.window.getComputedStyle(original.querySelector('svg')).display, 'none');
    if (locale === 'en') assert.equal(original.outerHTML, before, 'English native controls stay byte-for-byte unchanged when OFF at startup');
    else assert.equal(original.textContent, 'いいね');
    const replacement = original.cloneNode(true);
    replacement.className = 'text-pink-500'; replacement.setAttribute('aria-label', 'Like, 5 likes'); replacement.lastChild.nodeValue = 'Like';
    original.replaceWith(replacement); await f.flush();
    assert.equal(replacement.querySelector('.ct-star'), null);
    assert.equal(replacement.textContent, locale === 'ja' ? 'いいねを取り消す' : 'Unlike');
    assert.match(replacement.getAttribute('aria-label'), /5/);
    f.document.getElementById('ct-favorite-presentation-style').remove(); await f.flush();
    assert.equal(f.document.querySelectorAll('#ct-favorite-presentation-style').length, 1);
    assert.notEqual(f.window.getComputedStyle(replacement.querySelector('svg')).display, 'none', 'reinstalled early CSS remains disabled');
    f.window.dispatchEvent(new f.window.Event('pagehide'));
    f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted:true })); await f.flush();
    assert.equal(replacement.querySelector('.ct-star'), null); assert.equal(f.timers.size, 0);
  });

  test(`${locale}: a visible Favorites dialog returns to native Likes without recreating its header or handlers`, async t => {
    const f = harness(t, `<div role="dialog" aria-modal="true" aria-label="Liked by" class="bg-tl-app-card border">
      <div class="flex items-center justify-between border-b"><h3 class="text-sm font-bold text-tl-app-text">Liked by</h3><button aria-label="Close liked by list"><svg class="lucide-x"></svg></button></div>
      <div class="flex-1 overflow-y-auto"><div class="px-4 py-10 text-center text-xs text-tl-app-text-muted font-medium">No likes yet.</div>
      <p class="tl-user-text">No favorites yet. Liked by Like ❤</p></div></div>`, { locale });
    const dialog = f.document.querySelector('[role="dialog"]'), heading = dialog.querySelector('h3'), text = heading.firstChild, close = dialog.querySelector('button');
    let closes = 0; close.addEventListener('click', () => closes++);
    f.qa.ctPrepareFavoritePresentation(); f.qa.start(); f.settings.setClassicAppearance(false);
    const label = locale === 'ja' ? 'いいねしたユーザー' : 'Liked by';
    const closeLabel = locale === 'ja' ? 'いいねしたユーザー一覧を閉じる' : 'Close liked by list';
    assert.equal(heading.textContent, label); assert.equal(heading.firstChild, text);
    assert.equal(dialog.getAttribute('aria-label'), label); assert.equal(close.getAttribute('aria-label'), closeLabel);
    assert.equal(close.getAttribute('title'), null);
    assert.equal(dialog.querySelector('.text-center').textContent, locale === 'ja' ? 'いいねはまだありません。' : 'No likes yet.');
    f.settings.setClassicAppearance(true); f.settings.setClassicAppearance(false); await f.flush();
    assert.equal(heading.textContent, label);
    assert.equal(dialog.querySelector('.tl-user-text').textContent, 'No favorites yet. Liked by Like ❤');
    close.click(); assert.equal(closes, 1);
  });
}
