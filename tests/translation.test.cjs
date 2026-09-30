const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/translation.js'), 'utf8');
const post = (id, text = 'This is a post in English.') => `<article id="${id}"><p class="whitespace-pre-wrap">${text}</p><div><p aria-live="polite"><button class="native">Show translation</button></p></div></article>`;
function harness(t, options = {}) {
  const dom = new JSDOM(`<body>${options.html || post('one')}</body>`, { url: 'https://tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  let active = true, manual = new Set(), status = '', completions = 0;
  const stats = { creates: 0, detects: 0, translates: 0, native: 0, fetches: 0, pairs: [] };
  Object.defineProperty(window.navigator, 'language', { value: options.language || 'ja-JP' });
  Object.defineProperty(window.navigator, 'userActivation', { value: { isActive: true } });
  window.fetch = () => { stats.fetches++; throw new Error('Unexpected network'); };
  if (!options.unsupported) {
    window.Translator = {
      availability: async () => options.unavailable ? 'unavailable' : 'downloadable',
      create: async config => {
        stats.creates++; stats.pairs.push(config);
        if (options.prepareFailure) throw new Error('No model');
        return { translate: async text => {
          stats.translates++;
          if (options.failure) throw new Error('QuotaExceededError');
          if (options.translate) return options.translate(text);
          return 'これは投稿です。';
        } };
      }
    };
    window.LanguageDetector = {
      availability: async () => 'downloadable',
      create: async () => { stats.creates++; return { detect: async () => {
        stats.detects++;
        if (options.detect) return options.detect();
        return [{ detectedLanguage: options.source || 'en', confidence: options.confidence ?? 0.99 }];
      } }; }
    };
  }
  document.querySelectorAll('.native').forEach(button => button.addEventListener('click', () => stats.native++));
  window.ctTranslationControls = root => [...root.querySelectorAll('.native')];
  window.ctTranslationDisabled = control => control.disabled || control.getAttribute('aria-busy') === 'true';
  window.eval(source + '\nwindow.createDeviceTranslation = createDeviceTranslation');
  const engine = window.createDeviceTranslation({ locale: options.locale || 'ja',
    getContext(control) { const article = control.closest('article'), body = article?.querySelector('.whitespace-pre-wrap'); return body ? { article, body, text: body.textContent.trim() } : null; },
    isActive: () => active, isManual: article => manual.has(article),
    onStatus: value => { status = value; }, onComplete: () => completions++
  });
  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  t.after(() => { engine.clear(); window.close(); });
  return { window, document, engine, stats, flush, get status() { return status; }, get completions() { return completions; },
    active: value => { active = value; }, manual: article => manual.add(article),
    button: () => document.querySelector('.ct-device-translation button'), output: () => document.querySelector('.ct-device-translation p') };
}

test('no model creation or post transmission happens on install or before explicit prepare', async t => {
  const f = harness(t); f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.stats.creates, 0); assert.equal(f.stats.translates, 0); assert.equal(f.stats.fetches, 0);
  f.button().click(); await f.flush(); assert.match(f.output().textContent, /モデル/); assert.equal(f.stats.creates, 0);
  assert.equal(await f.engine.prepare('en'), true); assert.equal(f.stats.creates, 2);
  assert.equal(f.stats.pairs[0].targetLanguage, 'ja');
});

test('unsupported, unavailable and expired-activation models fail without a service fallback', async t => {
  for (const options of [{ unsupported: true }, { unavailable: true }, { prepareFailure: true }, {}]) {
    const f = harness(t, options);
    if (!Object.keys(options).length) f.window.navigator.userActivation.isActive = false;
    assert.equal(await f.engine.prepare('en'), false); f.engine.patch(f.document, true); await f.flush();
    assert.equal(f.stats.translates, 0); assert.equal(f.stats.fetches, 0); assert.equal(f.stats.native, 0);
    assert.ok(f.status);
  }
});

test('device translation renders as text next to the preserved original and can be hidden', async t => {
  const f = harness(t, { translate: () => '<img src=x onerror=alert(1)>訳文' });
  const original = f.document.querySelector('.whitespace-pre-wrap').outerHTML;
  await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.output().textContent, '<img src=x onerror=alert(1)>訳文'); assert.equal(f.output().querySelector('img'), null);
  assert.equal(f.document.querySelector('.whitespace-pre-wrap').outerHTML, original);
  assert.equal(f.stats.native, 0); assert.equal(f.stats.fetches, 0);
  f.button().click(); f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.output().hidden, true); assert.equal(f.stats.translates, 1);
  f.button().click(); await f.flush(); assert.equal(f.output().hidden, false); assert.equal(f.stats.translates, 1, 'cached translation is reused');
});

test('device requests are sequential and repeated scans do not duplicate active work', async t => {
  let finish;
  const f = harness(t, { html: post('one') + post('two', 'A second post.'), translate: () => new Promise(resolve => { finish = resolve; }) });
  await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
  f.engine.patch(f.document, true); await f.flush(); assert.equal(f.stats.translates, 1);
  finish('訳文1'); await f.flush(); assert.equal(f.stats.translates, 2);
  finish('訳文2'); await f.flush(); assert.equal(f.document.querySelectorAll('.ct-device-translation p:not([hidden])').length, 2);
});

test('failed device requests are not automatically retried on every scan', async t => {
  const f = harness(t, { failure: true }); await f.engine.prepare('en');
  for (let i = 0; i < 5; i++) { f.engine.patch(f.document, true); await f.flush(); }
  assert.equal(f.stats.translates, 1); assert.equal(f.stats.native, 0); assert.match(f.output().textContent, /失敗/);
  f.button().click(); await f.flush(); assert.equal(f.stats.translates, 2, 'explicit manual retry remains possible');
});

test('uncertain detection and unprepared source languages preserve the post', async t => {
  for (const options of [{ confidence: 0.5 }, { source: 'fr' }, { source: 'ja' }]) {
    const f = harness(t, options); await f.engine.prepare('en');
    f.engine.patch(f.document, true); await f.flush();
    assert.equal(f.stats.translates, 0); assert.equal(f.document.querySelector('.whitespace-pre-wrap').textContent, 'This is a post in English.');
    assert.equal(f.output().hidden, false);
  }
});

test('switching engine, backgrounding or native manual choice cannot apply a late device result', async t => {
  for (const mode of ['cancel', 'manual', 'changed', 'clear']) {
    let finish;
    const f = harness(t, { translate: () => new Promise(resolve => { finish = resolve; }) });
    await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
    const article = f.document.querySelector('article');
    if (mode === 'cancel') { f.active(false); f.engine.cancel(); }
    if (mode === 'manual') { f.manual(article); f.engine.hide(article); }
    if (mode === 'changed') article.querySelector('.whitespace-pre-wrap').textContent = 'Changed body';
    if (mode === 'clear') f.engine.clear();
    finish('遅い結果'); await f.flush();
    assert.equal(f.document.body.textContent.includes('遅い結果'), false, mode);
  }
});

test('backgrounded language detection resumes automatically after returning to the page', async t => {
  let finish;
  let detects = 0;
  const result = [{ detectedLanguage: 'en', confidence: 0.99 }];
  const f = harness(t, { detect: () => ++detects === 1 ? new Promise(resolve => { finish = resolve; }) : result });
  await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
  f.active(false); f.engine.cancel(); finish(result); await f.flush();
  assert.equal(f.stats.translates, 0); assert.equal(f.output().hidden, true);
  f.active(true); f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.stats.detects, 2); assert.equal(f.stats.translates, 1);
  assert.equal(f.output().textContent, 'これは投稿です。'); assert.equal(f.output().hidden, false);
});

test('backgrounded translation resumes from cache without another model request', async t => {
  let finish;
  const f = harness(t, { translate: () => new Promise(resolve => { finish = resolve; }) });
  await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
  f.active(false); f.engine.cancel(); finish('キャッシュした訳文'); await f.flush();
  assert.equal(f.output().hidden, true);
  f.active(true); f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.stats.detects, 1); assert.equal(f.stats.translates, 1);
  assert.equal(f.output().textContent, 'キャッシュした訳文'); assert.equal(f.output().hidden, false);
});

test('returning before a canceled translation settles does not create concurrent requests', async t => {
  let finish;
  const f = harness(t, { translate: () => new Promise(resolve => { finish = resolve; }) });
  await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
  f.active(false); f.engine.cancel(); f.active(true);
  for (let i = 0; i < 3; i++) { f.engine.patch(f.document, true); await f.flush(); }
  assert.equal(f.stats.translates, 1); assert.equal(f.stats.detects, 1);
  finish('遅れて完了した訳文'); await f.flush();
  assert.equal(f.stats.translates, 1); assert.equal(f.stats.detects, 1);
  assert.equal(f.output().textContent, '遅れて完了した訳文'); assert.equal(f.output().hidden, false);
});

test('cancellation preserves failed attempts and manual choices instead of automatically retrying them', async t => {
  const failed = harness(t, { failure: true });
  await failed.engine.prepare('en'); failed.engine.patch(failed.document, true); await failed.flush();
  failed.active(false); failed.engine.cancel(); failed.active(true);
  failed.engine.patch(failed.document, true); await failed.flush();
  assert.equal(failed.stats.translates, 1); assert.match(failed.output().textContent, /失敗/);

  const dismissed = harness(t);
  await dismissed.engine.prepare('en'); dismissed.engine.patch(dismissed.document, true); await dismissed.flush();
  dismissed.button().click(); dismissed.active(false); dismissed.engine.cancel(); dismissed.active(true);
  dismissed.engine.patch(dismissed.document, true); await dismissed.flush();
  assert.equal(dismissed.stats.translates, 1); assert.equal(dismissed.output().hidden, true);

  let finish;
  const manual = harness(t, { translate: () => new Promise(resolve => { finish = resolve; }) });
  await manual.engine.prepare('en'); manual.engine.patch(manual.document, true); await manual.flush();
  const article = manual.document.querySelector('article');
  manual.manual(article); manual.engine.hide(article); manual.active(false); manual.engine.cancel();
  manual.active(true); manual.engine.patch(manual.document, true); finish('遅い結果'); await manual.flush();
  assert.equal(manual.stats.translates, 1); assert.equal(manual.output().hidden, true);
  assert.equal(manual.output().textContent, '');
});

test('native Show original preference survives body replacement and prevents device auto recreation', async t => {
  const f = harness(t); await f.engine.prepare('en'); f.engine.patch(f.document, true); await f.flush();
  const article = f.document.querySelector('article'); f.manual(article); f.engine.hide(article);
  article.querySelector('.whitespace-pre-wrap').textContent = 'Site-translated replacement';
  f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.document.querySelector('.ct-device-translation'), null); assert.equal(f.stats.translates, 1);
});

test('Traditional Chinese browser targets use the supported zh-Hant model code', async t => {
  const f = harness(t, { language: 'zh-TW' }); await f.engine.prepare('en');
  assert.equal(f.stats.pairs[0].targetLanguage, 'zh-Hant');
});
