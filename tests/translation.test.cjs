const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { translationPost:post, originalContextSource, controlsSource } = require('./helpers/native-translation.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/translation.js'), 'utf8');
function harness(t, options = {}) {
  const dom = new JSDOM(`<body>${options.html || post('one')}</body>`, { url:'https://app.tweet.app/feed', runScripts:'outside-only', pretendToBeVisual:true });
  const { window } = dom, document = window.document;
  let active = true, manual = new Set(), status = '', completions = 0;
  const stats = { creates:0, detects:0, translates:0, native:0, fetches:0, pairs:[] };
  Object.defineProperty(window.navigator, 'language', { value:options.language || 'ja-JP' });
  Object.defineProperty(window.navigator, 'userActivation', { value:{ isActive:true } });
  window.fetch = () => { stats.fetches++; throw new Error('Unexpected network'); };
  if (!options.unsupported) {
    window.Translator = {
      availability:async () => options.unavailable ? 'unavailable' : 'downloadable',
      create:async config => {
        stats.creates++; stats.pairs.push(config);
        if (options.prepareFailure) throw new Error('No model');
        return { translate:async text => {
          stats.translates++;
          if (options.failure) throw new Error('QuotaExceededError');
          return options.translate ? options.translate(text) : 'これは投稿です。';
        } };
      }
    };
    window.LanguageDetector = {
      availability:async () => 'downloadable',
      create:async () => { stats.creates++; return { detect:async () => {
        stats.detects++;
        return options.detect ? options.detect() : [{ detectedLanguage:options.source || 'en', confidence:options.confidence ?? 0.99 }];
      } }; }
    };
  }
  document.querySelectorAll('.native').forEach(button => button.addEventListener('click', () => stats.native++));
  window.eval(originalContextSource + '\n' + controlsSource + '\n' + source + '\nwindow.deviceFactory = createDeviceTranslation; window.originalContext = ctOwnTranslationText;');
  const engine = window.deviceFactory({ locale:options.locale || 'ja', getContext:window.originalContext,
    isActive:() => active, isManual:article => manual.has(article),
    onStatus:value => { status = value; }, onComplete:() => completions++ });
  async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  t.after(() => { engine.clear(); window.close(); });
  return { window, document, engine, stats, flush, get status() { return status; }, get completions() { return completions; },
    active:value => { active = value; }, manual:article => manual.add(article),
    button:(id = 'one') => document.querySelector(`#${id} .ct-device-translation button`),
    output:(id = 'one') => document.querySelector(`#${id} .ct-device-translation p`),
    async click(id = 'one') { this.button(id).click(); await flush(); },
    mode(mode, id = 'one') { const button = document.getElementById(id + '-translate'); button.dataset.translateMode = mode;
      button.setAttribute('aria-pressed', String(mode === 'active'));
      for (const name of ['aria-busy','aria-disabled']) { if (mode === 'busy') button.setAttribute(name, 'true'); else button.removeAttribute(name); }
      return button; }
  };
}

test('install, model preparation and repeated scans never translate without an explicit post click', async t => {
  const f = harness(t); f.engine.patch(f.document, true); await f.flush();
  assert.equal(f.stats.creates, 0); assert.equal(f.stats.translates, 0); assert.equal(f.stats.fetches, 0);
  await f.click(); assert.match(f.output().textContent, /モデル/); assert.equal(f.stats.creates, 0);
  assert.equal(await f.engine.prepare('en'), true); assert.equal(f.stats.creates, 2);
  for (let i = 0; i < 5; i++) { f.engine.patch(f.document, true); await f.flush(); }
  assert.equal(f.stats.translates, 0); assert.equal(f.stats.native, 0); assert.equal(f.stats.pairs[0].targetLanguage, 'ja');
});

test('unsupported, unavailable and expired activation fail without a service fallback', async t => {
  for (const options of [{ unsupported:true }, { unavailable:true }, { prepareFailure:true }, {}]) {
    const f = harness(t, options); if (!Object.keys(options).length) f.window.navigator.userActivation.isActive = false;
    assert.equal(await f.engine.prepare('en'), false); f.engine.patch(f.document); await f.flush();
    assert.equal(f.stats.translates, 0); assert.equal(f.stats.fetches, 0); assert.equal(f.stats.native, 0); assert.ok(f.status);
  }
});

test('manual output stays text-only next to unchanged original, supports hide and explicit cached repeat', async t => {
  const f = harness(t, { translate:() => '<img src=x onerror=alert(1)>訳文' });
  const original = f.document.querySelector('.tl-user-text').outerHTML;
  await f.engine.prepare('en'); f.engine.patch(f.document); await f.click();
  assert.equal(f.output().textContent, '<img src=x onerror=alert(1)>訳文'); assert.equal(f.output().querySelector('img'), null);
  assert.equal(f.document.querySelector('.tl-user-text').outerHTML, original); assert.equal(f.stats.native, 0); assert.equal(f.stats.fetches, 0);
  await f.click(); f.engine.patch(f.document); await f.flush(); assert.equal(f.output().hidden, true);
  assert.equal(f.stats.translates, 1); await f.click(); assert.equal(f.output().hidden, false); assert.equal(f.stats.translates, 1);
});

test('separate explicit post requests stay sequential, while repeated scans and clicks add no duplicate work', async t => {
  const pending = [];
  const f = harness(t, { html:post('one') + post('two','A second post.'), translate:() => new Promise(resolve => pending.push(resolve)) });
  await f.engine.prepare('en'); f.engine.patch(f.document); await f.click('one');
  f.button('one').click(); await f.click('two'); f.engine.patch(f.document); await f.flush();
  assert.equal(f.stats.translates, 1); pending.shift()('訳文1'); await f.flush(); assert.equal(f.stats.translates, 2);
  pending.shift()('訳文2'); await f.flush(); assert.equal(f.document.querySelectorAll('.ct-device-translation p:not([hidden])').length, 2);
});

test('device failures and uncertain language require explicit retry, never automatic scans', async t => {
  for (const options of [{ failure:true }, { confidence:0.5 }, { source:'fr' }, { source:'ja' }]) {
    const f = harness(t, options); await f.engine.prepare('en'); f.engine.patch(f.document); await f.click();
    const attempts = f.stats.detects;
    for (let i = 0; i < 3; i++) { f.engine.patch(f.document); await f.flush(); }
    assert.equal(f.stats.detects, attempts); assert.equal(f.stats.native, 0); assert.equal(f.output().hidden, false);
    assert.equal(f.document.querySelector('.tl-user-text').textContent, 'This is a post in English.');
    await f.click(); assert.equal(f.stats.detects, attempts + 1);
  }
});

test('native busy, active, original, unknown and malformed states never gain a device control', async t => {
  for (const mode of ['busy','active','original','unknown']) {
    const f = harness(t, { html:post('one','Native body',mode) }); await f.engine.prepare('en');
    f.engine.patch(f.document); await f.flush(); assert.equal(f.button(), null, mode); assert.equal(f.stats.translates, 0);
  }
  for (const alter of [
    f => f.mode('idle').removeAttribute('aria-pressed'),
    f => f.mode('idle').parentElement.querySelector('[data-translate-status]').remove(),
    f => f.document.querySelector('.tl-user-text').insertAdjacentHTML('beforebegin','<div class="mt-0.5"><p class="text-[0.8125rem] text-tl-app-text-muted">Translated from English</p></div>'),
    f => f.document.querySelector('.tl-user-text').insertAdjacentHTML('afterend','<p class="tl-user-text whitespace-pre-wrap break-words">Ambiguous second body</p>'),
    f => f.document.querySelector('article').setAttribute('data-ct-owned','true'),
    f => f.document.querySelector('article').setAttribute('aria-label','Quoted post by Alice')
  ]) { const f = harness(t); alter(f); f.engine.patch(f.document); assert.equal(f.button(), null); }
});

test('native state changes remove visible device output and preserve every native node and handler', async t => {
  for (const mode of ['busy','active','original']) {
    const f = harness(t); const native = f.document.getElementById('one-translate'), body = f.document.querySelector('.tl-user-text');
    await f.engine.prepare('en'); f.engine.patch(f.document); await f.click(); assert.equal(f.output().hidden,false);
    f.mode(mode); f.engine.patch(native); await f.flush();
    assert.equal(f.button(), null, mode); assert.equal(f.document.getElementById('one-translate'), native); assert.equal(f.document.querySelector('.tl-user-text'), body);
    native.click(); assert.equal(f.stats.native, 1);
  }
});

test('native automatic activation during detection or translation rejects late results before the next scan', async t => {
  for (const stage of ['detect','translate']) {
    let finish;
    const f = harness(t, stage === 'detect' ? { detect:() => new Promise(resolve => { finish=resolve; }) } : { translate:() => new Promise(resolve => { finish=resolve; }) });
    await f.engine.prepare('en'); f.engine.patch(f.document); await f.click();
    f.mode('active');
    finish(stage === 'detect' ? [{ detectedLanguage:'en',confidence:0.99 }] : 'Late device output'); await f.flush();
    assert.equal(f.document.body.textContent.includes('Late device output'),false);
    if(stage === 'detect') assert.equal(f.stats.translates,0);
    f.engine.patch(f.document); assert.equal(f.button(),null);
  }
});

test('native activation and return to idle cannot resurrect a detached pending device result', async t => {
  let finish;
  const f=harness(t,{translate:()=>new Promise(resolve=>{finish=resolve;})});
  await f.engine.prepare('en'); f.engine.patch(f.document); await f.click();
  f.mode('active'); f.engine.patch(f.document); f.mode('idle'); f.engine.patch(f.document);
  finish('Orphaned result'); await f.flush(); assert.equal(f.output().textContent,''); assert.equal(f.output().hidden,true);
  assert.equal(f.stats.translates,1); assert.equal(f.stats.native,0);
});

test('disable, body replacement, native manual choice and detach reject late results without automatic resume', async t => {
  for (const mode of ['cancel','clear','manual','changed','detached']) {
    let finish; const f=harness(t,{translate:()=>new Promise(resolve=>{finish=resolve;})});
    await f.engine.prepare('en'); f.engine.patch(f.document); await f.click();
    const article=f.document.querySelector('article');
    if(mode==='cancel'){f.active(false);f.engine.cancel();}
    if(mode==='clear')f.engine.clear();
    if(mode==='manual'){f.manual(article);f.engine.hide(article);}
    if(mode==='changed')article.querySelector('.tl-user-text').textContent='Changed source';
    if(mode==='detached')article.remove();
    finish('Late result');await f.flush();assert.equal(f.document.body.textContent.includes('Late result'),false,mode);
    f.active(true);f.engine.patch(f.document);await f.flush();assert.equal(f.stats.translates,1,mode);
  }
});

test('background return requires another explicit click, with a cached result reused locally', async t => {
  let finish; const f=harness(t,{translate:()=>new Promise(resolve=>{finish=resolve;})});
  await f.engine.prepare('en');f.engine.patch(f.document);await f.click();
  f.active(false);f.engine.cancel();finish('Local cached result');await f.flush();assert.equal(f.output().hidden,true);
  f.active(true);for(let i=0;i<3;i++){f.engine.patch(f.document);await f.flush();}
  assert.equal(f.output().hidden,true);assert.equal(f.stats.translates,1);
  await f.click();assert.equal(f.output().textContent,'Local cached result');assert.equal(f.output().hidden,false);assert.equal(f.stats.translates,1);
});

test('Traditional Chinese uses the supported zh-Hant model code',async t=>{
  const f=harness(t,{language:'zh-TW'});await f.engine.prepare('en');assert.equal(f.stats.pairs[0].targetLanguage,'zh-Hant');
});
