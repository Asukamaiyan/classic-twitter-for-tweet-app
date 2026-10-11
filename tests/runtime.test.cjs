const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const translation = fs.readFileSync(path.join(__dirname, '../src/translation.js'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8');
const timestamps = fs.readFileSync(path.join(__dirname, '../src/timestamps.js'), 'utf8');
const motion = fs.readFileSync(path.join(__dirname, '../src/motion.js'), 'utf8');
const navigation = fs.readFileSync(path.join(__dirname, '../src/navigation.js'), 'utf8');
const browserNotifications = fs.readFileSync(path.join(__dirname, '../src/browser-notifications.js'), 'utf8');
const network = fs.readFileSync(path.join(__dirname, '../src/network.js'), 'utf8');
const linkPreviews = fs.readFileSync(path.join(__dirname, '../src/link-preview.js'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../classic-twitter-ja.user.js'), 'utf8');
const helperNames = new Set(['ctTranslationButtonText', 'ctTranslationControls', 'ctDeclaredLanguage', 'ctLikelyLanguage']);
const helpers = [];
const shippedFunctions = new Map();
const shippedDeclarations = new Map();
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration') {
    shippedFunctions.set(node.id?.name, script.slice(node.start, node.end));
    if (helperNames.has(node.id?.name)) helpers.push(script.slice(node.start, node.end));
  }
  if (node.type === 'VariableDeclaration') {
    for (const declaration of node.declarations) {
      if (declaration.id?.type === 'Identifier' && declaration.id.name === 'ctNativeNotificationRowSelector') {
        shippedDeclarations.set(declaration.id.name, script.slice(node.start, node.end));
      }
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(acorn.parse(script, { ecmaVersion: 'latest' }));
assert.equal(helpers.length, helperNames.size, 'runtime fixtures use the actual shipped translation helpers');
const localizationNames = [
  'localizationScopeNodes', 'isOwnedLocalizationElement', 'isNativeSettingsNavigation', 'isNativeLocalizationTimestamp',
  'isProtectedLocalizationElement', 'nativeLocalizationPoll', 'isNativeLocalizationPollUI', 'nativeLocalizationAccountMenu',
  'nativeLocalizationAccountDialog', 'localizationNotificationRow', 'localizationNotificationAction', 'isLocalizationUI',
  'ctLocalizationClassicEnabled', 'ctLocalizationState', 'ctLocalizationNativeRecordException', 'ctLocalizationRecordAllowed',
  'ctLocalizationRead', 'ctLocalizationWrite', 'ctLocalizationForget', 'ctRememberLocalization', 'ctSyncLocalizationAppearance',
  'replaceLocalizationText', 'patchUIAttributes', 'translateTextNode', 'patchUI', 'patchInputs', 'ctLocalizationRegularText',
  'ctLocalizationClassicText', 'isNativeSettingsValue', 'isNativeLocalizationHelp', 'isNativeNotificationTimestamp',
  'isNativeEditedIndicator', 'isNativeReplyTimestamp', 'isNativeReplyOptionsButton', 'nativeLocalizationMonthNumber',
  'nativeTimestampJapaneseText', 'nativeLocalizationParentPostPreview', 'isNativeParentPostTimestamp', 'isNativeTranslationMetadata',
  'isNativeTweetCount', 'patchNativePollAndAccountUI', 'nativePollJapaneseText', 'nativeMediaUploadJapaneseText',
  'nativeLocalizationMediaUpload', 'nativeLocalizationGIFMedia', 'nativeLocalizationBlockMenu',
  'nativeLocalizationBlockDialog', 'nativeLocalizationBlockProfile', 'nativeBlockJapaneseText', 'isNativeBlockedAccountError'
];
assert.ok(shippedDeclarations.has('ctNativeNotificationRowSelector'), 'localization uses the shipped notification row selector');
assert.ok(shippedFunctions.has('ctIsNativeNotificationRow'), 'localization uses the shipped notification row validator');
const localizationNavigationSource = shippedDeclarations.get('ctNativeNotificationRowSelector') + '\n' + shippedFunctions.get('ctIsNativeNotificationRow');
const jpMapStart = script.indexOf('  const JP = new Map([');
const jpMapEnd = script.indexOf('\n  ]);', jpMapStart) + '\n  ]);'.length;
const localizationSource = script.slice(jpMapStart, jpMapEnd) + localizationNames.map(name => {
  assert.ok(shippedFunctions.has(name), `missing shipped localization helper ${name}`);
  return shippedFunctions.get(name);
}).join('\n');

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
  const stats = { scans: 0, refreshes: 0, installs: 0, roots: [], previewPatches: 0, previewCleanups: 0 };
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
    stats.roots.push(root);
    options.scan?.(root, window.qa, stats);
  };
  window.ctCaptureFavoriteClick = options.captureFavoriteClick || (() => {});
  window.ctRestoreVisibleFavorites = async () => ({saved:0,unresolved:0});
  window.ctFavoriteHistoryStatus = () => ({pages:0});
  window.ctRunFavoriteHistory = async () => {};
  window.ctStopFavoriteHistory = () => {};
  window.ctRestartFavoriteHistory = async () => {};
  window.ctLinkPreviewsPatch = () => { stats.previewPatches += 1; };
  window.ctLinkPreviewsCleanup = () => { stats.previewCleanups += 1; };
  if (options.navigation) {
    window.API_ORIGIN = 'https://api.tweet.app';
    window.ctNetworkState = { authUID: 'fixture-viewer' };
    window.getAuth = async () => ({ uid: 'fixture-viewer', token: 'fixture-token' });
    window.requestJSON = async () => { throw new Error('Known native notification handles must not need a lookup'); };
  }
  options.configureNetwork?.(window);
  window.eval(`
    const KEY = { autoTranslate: 'autoTranslate' };
    const CT_LOCALE = ${JSON.stringify(options.locale || 'ja')};
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    ${helpers.join('\n')}
    ${translation}
    ${options.timestamps ? timestamps : ''}
    ${options.network ? `const profileCache = new Map(); const profilePending = new Map();
      const PROFILE_API = 'https://api.tweet.app/api/users/by-username/'; ${network}` : ''}
    ${options.motion ? motion : ''}
    ${browserNotifications}
    ${runtime}
    ${options.linkPreviews ? linkPreviews : ''}
    ${options.navigation ? navigation : ''}
    ${options.localization && !options.navigation ? localizationNavigationSource : ''}
    ${options.localization ? localizationSource : ''}
    window.qa = { autoTranslationEnabled, patchAutoTranslation, ctOwnTranslationText,
      ctRememberTranslationChoice, patchFavoriteButtons, articleId, start, ctRunScan, ctScheduleScan,
      ctPrepareFavoritePresentation, pending: () => ctAutoPending.size,
      timestampPatch: typeof ctTimestampPatchExactPostTime === 'function' ? ctTimestampPatchExactPostTime : null,
      patchClassicMotion: typeof patchClassicMotion === 'function' ? patchClassicMotion : null,
      patchNavigation: typeof patchNavigation === 'function' ? patchNavigation : null,
      patchUI: typeof patchUI === 'function' ? patchUI : null,
      networkState: typeof ctNetworkState === 'undefined' ? null : ctNetworkState,
      getAuth: typeof getAuth === 'function' ? getAuth : null,
      linkPreviewsPatch: ctLinkPreviewsPatch, linkPreviewsCleanup: ctLinkPreviewsCleanup,
      linkPreviewState: typeof ctLinkPreviewState === 'undefined' ? null : ctLinkPreviewState,
      destroyBrowserNotifications: () => ctBrowserNotifications?.destroy() };
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
  t.after(() => {
    window.dispatchEvent(new window.Event('pagehide'));
    window.qa.destroyBrowserNotifications();
    dom.window.close();
  });
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

test('native auto translation waits for initial auth, then preserves the resolved original link card', async t => {
  const destination = 'https://example.org/original';
  let idbRequest, opens = 0, intersectionObserver;
  const requests = [];
  const f = harness(t, `<main><article id="one"><div class="flex-1 min-w-0">
    <div class="flex items-start justify-between gap-2"><div class="min-w-0 flex-1">
      <div class="flex items-center gap-1 min-w-0 flex-wrap"><button class="font-bold truncate">Alice</button>
        <span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted hover:underline" title="2026-10-10T00:00:00Z">1m</span></div>
      <p aria-live="polite"><button id="one-translate">Show translation</button></p>
    </div></div>
    <p class="tl-user-text whitespace-pre-wrap break-words" lang="en">This is an original post. <a href="${destination}" target="_blank" rel="noopener noreferrer">${destination}</a></p>
  </div></article></main>`, {
    network: true, timestamps: true, linkPreviews: true, values: { 'autoTranslate.optInV2': true },
    configureNetwork(window) {
      window.localStorage.setItem('firebase:authUser:public_fixture_key:[DEFAULT]', JSON.stringify({
        uid: 'fixture-viewer', apiKey: 'public_fixture_key',
        stsTokenManager: { accessToken: 'fixture-token.'.repeat(6), expirationTime: 1000000 }
      }));
      window.IDBKeyRange = { bound() { return {}; } };
      window.indexedDB = { open() { opens++; idbRequest = {}; return idbRequest; } };
      window.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; this.targets = new Set(); intersectionObserver = this; }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
      };
      window.GM_xmlhttpRequest = details => {
        const call = { details, aborts: 0 }; requests.push(call);
        return { abort() { call.aborts++; details.onabort({ status: 0 }); details.onloadend({ status: 0 }); } };
      };
    },
    scan(root, qa) { qa.patchAutoTranslation(root); qa.linkPreviewsPatch(root); }
  });
  const body = f.document.querySelector('p.tl-user-text');
  const originalText = body.textContent;
  const show = () => intersectionObserver.callback([...intersectionObserver.targets]
    .map(target => ({ target, isIntersecting: true, intersectionRatio: 1 })));
  let clicks = 0, resolvedCard;
  f.button('one').addEventListener('click', () => {
    clicks++;
    assert.equal(f.qa.networkState.authSettled, true);
    assert.equal(f.qa.networkState.authUID, 'fixture-viewer');
    assert.equal(f.qa.linkPreviewState.originals.get(body)?.context, '/feed\nfixture-viewer',
      'the resolved-account scan captures original URL evidence before the zero-delay native click');
    resolvedCard = f.document.querySelector('.ct-link-preview');
    assert.ok(resolvedCard);
    body.innerHTML = `翻訳された本文 <a href="${destination}" target="_blank" rel="noopener noreferrer">${destination}</a>`;
    f.button('one').textContent = 'Show original';
  });
  f.qa.start(); show();
  assert.equal(f.qa.networkState.authSettled, false);
  await f.advance(100);
  f.qa.patchAutoTranslation(); await f.flush();
  assert.equal(opens, 1, 'all scans share the existing bounded persistence lookup');
  assert.equal(clicks, 0);
  assert.equal(f.qa.pending(), 0);
  assert.equal(body.textContent, originalText);
  assert.equal(requests.length, 1);
  idbRequest.onerror();
  await f.flush(); await f.flush(); await f.flush();
  assert.equal(f.qa.networkState.authSettled, true);
  assert.equal(clicks, 0, 'settlement schedules a scan rather than clicking from its promise');
  await f.advance(100);
  assert.equal(clicks, 1);
  assert.equal(requests[0].aborts, 1, 'the initial unknown-account record is discarded');
  assert.equal(f.document.querySelector('.ct-link-preview'), resolvedCard);
  show();
  assert.equal(requests.length, 2);
  requests[1].details.onload({ status: 200, readyState: 4, finalUrl: destination,
    responseHeaders: 'Content-Type: text/html', responseText: '<html><head><title>Original link</title></head></html>' });
  await f.flush(); await f.advance(100);
  assert.equal(f.document.querySelector('.ct-link-preview'), resolvedCard);
  assert.equal(resolvedCard.querySelector('.ct-link-preview-title').textContent, 'Original link');
  assert.equal(requests[1].aborts, 0);
  assert.equal(requests.length, 2);
});

test('initial auth without a user, after read failure or at the deadline still resumes native automatic translation', async t => {
  for (const mode of ['missing-user', 'read-failure', 'deadline']) {
    const f = harness(t, post('one'), {
      network: true, values: { 'autoTranslate.optInV2': true },
      configureNetwork(window) {
        if (mode === 'deadline') {
          window.IDBKeyRange = { bound() { return {}; } };
          window.indexedDB = { open() { return {}; } };
        }
      },
      scan(root, qa) { qa.patchAutoTranslation(root); }
    });
    if (mode === 'read-failure') f.window.eval('ctReadIDBAuth = () => Promise.reject(new Error("fixture read failure"));');
    const count = countClicks(f, 'one');
    f.qa.start();
    const pending = f.qa.getAuth();
    assert.equal(count(), 0);
    if (mode === 'deadline') {
      await f.advance(2499);
      assert.equal(count(), 0);
      assert.equal(f.qa.networkState.authSettled, false);
      await f.advance(1);
    }
    await pending;
    assert.equal(f.qa.networkState.authSettled, true, mode);
    assert.equal(f.qa.networkState.authUID, null, mode);
    await f.advance(100);
    assert.equal(count(), 1, mode);
    await f.advance(2000);
    assert.equal(count(), 1, 'null identity settlement does not loop or repeat automatic clicks');
  }
});

test('initial auth lookup is not started by disabled, device, hidden or inactive auto translation', async t => {
  for (const mode of ['off', 'device', 'hidden', 'inactive']) {
    let opens = 0;
    const f = harness(t, post('one'), {
      network: true,
      values: { 'autoTranslate.optInV2': mode !== 'off', 'autoTranslate.engine': mode === 'device' ? 'device' : 'native' },
      configureNetwork(window) {
        window.IDBKeyRange = { bound() { return {}; } };
        window.indexedDB = { open() { opens++; return {}; } };
      },
      scan(root, qa) { if (mode !== 'inactive') qa.patchAutoTranslation(root); }
    });
    const count = countClicks(f, 'one');
    if (mode === 'hidden') f.hidden(true);
    f.qa.start();
    if (mode === 'inactive') f.window.dispatchEvent(new f.window.Event('pagehide'));
    f.qa.patchAutoTranslation(); await f.advance();
    assert.equal(opens, 0, mode);
    assert.equal(f.qa.networkState.authSettled, false, mode);
    assert.equal(count(), 0, mode);
  }
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
    scan(root, qa) {
      const nav = root.querySelector('#nav');
      if (nav) nav.textContent = 'ホーム';
      qa.patchFavoriteButtons(root);
    }
  });
  f.qa.start(); f.qa.start();
  assert.equal(f.stats.scans, 1); assert.equal(f.stats.installs, 1);
  assert.equal(f.settings.browserNotifications.getState().enabled, false);
  assert.equal(f.settings.browserNotifications.getState().supported, false, 'the real module handles an engine without Notification');
  assert.equal(f.intervals.size, 0, 'native notifications own their refresh interval');
  await f.advance(1000); assert.equal(f.stats.scans, 1, 'no idle observer cycle from script mutations');
  f.document.getElementById('nav').textContent = 'Notifications';
  f.document.getElementById('like').className = 'text-pink-500';
  await f.advance(99); assert.equal(f.stats.scans, 1);
  await f.advance(1); assert.equal(f.stats.scans, 3, 'navigation and the action are separate changed roots in one batch');
  assert.equal(f.document.getElementById('like').classList.contains('ct-is-liked'), true);
  await f.advance(1000); assert.equal(f.stats.scans, 3);
  f.document.getElementById('nav').textContent = 'ホーム';
  f.document.getElementById('owned').textContent = 'Settings';
  await f.advance(1000); assert.equal(f.stats.scans, 3, 'identical native text and owned content do not schedule scans');
  f.window.history.pushState({}, '', '/notifications');
  f.window.history.replaceState({}, '', '/settings');
  f.window.dispatchEvent(new f.window.PopStateEvent('popstate'));
  await f.advance(100); assert.equal(f.stats.scans, 4, 'route changes are debounced into one page pass');
  assert.equal(f.stats.refreshes, 3);
});

test('URL preview setting persists before cleanup and failed storage leaves active work untouched', async t => {
  const f = harness(t);
  f.qa.start();
  assert.equal(f.settings.getLinkPreviews(), true);
  f.settings.setLinkPreviews(false);
  assert.equal(f.values.get('ct-link-previews-enabled-v1'), false);
  assert.equal(f.settings.getLinkPreviews(), false);
  assert.equal(f.stats.previewCleanups, 1);
  assert.equal(f.stats.previewPatches, 1);
  await f.advance(100);
  const g = harness(t, '', { storageFailure: true });
  g.qa.start();
  assert.throws(() => g.settings.setLinkPreviews(false), /Storage unavailable/);
  assert.equal(g.settings.getLinkPreviews(), true);
  assert.equal(g.stats.previewCleanups, 0);
  assert.equal(g.stats.previewPatches, 0);
});

test('URL preview lifecycle cancels on relevant storage, background and pagehide, while href edits rescan', async t => {
  const f = harness(t, '<main><article><p><a id="url" href="https://ogp.me/">link</a></p></article></main>');
  f.qa.start();
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: 'unrelated' }));
  assert.equal(f.stats.previewCleanups, 0);
  f.values.set('ct-link-previews-enabled-v1', false);
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: 'ct-link-previews-enabled-v1' }));
  assert.equal(f.stats.previewCleanups, 1);
  assert.equal(f.settings.getLinkPreviews(), false);
  await f.advance(100);
  const before = f.stats.scans;
  f.document.getElementById('url').setAttribute('href', 'https://example.com/changed');
  await f.advance(100);
  assert.equal(f.stats.scans, before + 1, 'a reused native link updates its card without polling');
  f.hidden(true);
  assert.equal(f.stats.previewCleanups, 2);
  f.hidden(false); await f.advance(100);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.stats.previewCleanups, 3);
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  await f.advance(100);
  assert.equal(f.intervals.size, 0);
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

for (const locale of ['ja', 'en']) {
  test(`${locale}: 2.3 sibling-overlay notification hearts do not flash and classic OFF restores the live native icon`, async t => {
    const currentRow = (id, border = false) => `<div id="${id}" class="relative w-full flex items-start gap-3 px-4 py-3.5 ${border ? 'border-b border-tl-app-border' : ''}">
      <button id="${id}-event" type="button" aria-labelledby="${id}-label" class="absolute inset-0 w-full h-full cursor-pointer"></button>
      <div class="mt-0.5 shrink-0 pointer-events-none"><svg class="lucide lucide-heart text-rose-500" width="28" height="28"><path id="${id}-heart"></path></svg></div>
      <div class="flex-1 min-w-0 pointer-events-none"><p id="${id}-label">Alice liked your post</p></div><div class="relative z-10"><button id="${id}-menu">More</button></div>
    </div>`;
    const f = harness(t, `<div id="root-container"><main><div class="border-b">${currentRow('grouped')}</div>${currentRow('direct', true)}
      <div class="border-b">${currentRow('unknown').replace('absolute inset-0', 'absolute top-0')}</div>
      <button id="ordinary"><svg class="lucide-heart text-rose-500" width="28" height="28"><path id="ordinary-heart"></path></svg></button>
      </main></div>`, { locale });
    const grouped = f.document.getElementById('grouped');
    const direct = f.document.getElementById('direct');
    const event = f.document.getElementById('grouped-event');
    const menu = f.document.getElementById('grouped-menu');
    let eventClicks = 0, menuClicks = 0;
    event.addEventListener('click', () => eventClicks++);
    menu.addEventListener('click', () => menuClicks++);
    const body = grouped.querySelector('p').firstChild;
    f.qa.ctPrepareFavoritePresentation(); f.qa.start();
    for (const row of [grouped, direct]) {
      const iconContainer = row.children[1];
      iconContainer.className = 'mt-0.5 shrink-0 pointer-events-none';
      iconContainer.innerHTML = `<svg class="lucide lucide-heart text-rose-500" width="28" height="28"><path id="${row.id}-replacement"></path></svg>`;
      const icon = iconContainer.firstElementChild;
      assert.equal(f.window.getComputedStyle(icon.firstElementChild).visibility, 'hidden', 'React replacement is a star before any delayed scan');
      assert.equal(f.window.getComputedStyle(icon).backgroundColor, 'rgb(255, 172, 51)');
      assert.match(f.window.getComputedStyle(icon).getPropertyValue('mask'), /data:image\/svg\+xml/);
    }
    assert.notEqual(f.window.getComputedStyle(f.document.getElementById('unknown-heart')).visibility, 'hidden');
    assert.notEqual(f.window.getComputedStyle(f.document.getElementById('ordinary-heart')).visibility, 'hidden');
    f.settings.setClassicAppearance(false);
    for (const row of [grouped, direct]) {
      const icon = row.children[1].firstElementChild;
      assert.notEqual(f.window.getComputedStyle(icon.firstElementChild).visibility, 'hidden');
      assert.doesNotMatch(f.window.getComputedStyle(icon).getPropertyValue('mask'), /data:image\/svg\+xml/);
    }
    assert.equal(grouped.firstElementChild, event);
    assert.equal(grouped.querySelector('p').firstChild, body);
    event.click(); menu.click();
    assert.equal(eventClicks, 1);
    assert.equal(menuClicks, 1);
    f.settings.setClassicAppearance(true);
    assert.equal(f.window.getComputedStyle(f.document.getElementById('grouped-replacement')).visibility, 'hidden');
    await f.flush();
    assert.equal(f.document.querySelectorAll('#ct-favorite-presentation-style').length, 1);
  });
}

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


test('a native datetime-only update refreshes the existing time display and settles without an idle scan loop', async t => {
  const f = harness(t, '<main><article><time id="created" datetime="2026-10-02T01:00:00Z">native</time><span id="display"></span></article></main>', {
    route: '/post/time-a',
    scan(root) {
      root.querySelector('#display').textContent = root.querySelector('#created').getAttribute('datetime');
    }
  });
  f.qa.start(); assert.equal(f.document.getElementById('display').textContent,'2026-10-02T01:00:00Z');
  f.document.getElementById('created').setAttribute('datetime','2026-10-01T23:00:00Z');
  await f.advance(100);
  assert.equal(f.document.getElementById('display').textContent,'2026-10-01T23:00:00Z');
  assert.equal(f.stats.scans,2);
  await f.advance(1000); assert.equal(f.stats.scans,2);
});

test('one changed card in a 240-card feed visits only that card and coalesces its header/body mutations', async t => {
  let visited = 0;
  const html = `<main>${Array.from({ length: 240 }, (_, index) => `<article id="card-${index}"><header><span title="2026-10-02T01:00:00Z">1h</span></header><p class="whitespace-pre-wrap">Post ${index}</p></article>`).join('')}</main>`;
  const f = harness(t, html, {
    scan(root) { visited += root.matches?.('article') ? 1 : root.querySelectorAll('article').length; }
  });
  f.qa.start(); assert.equal(visited, 240); visited = 0;
  const card = f.document.getElementById('card-42');
  card.querySelector('span').title = '2026-10-02T02:00:00Z';
  for (let index = 0; index < 30; index++) card.querySelector('p').firstChild.data = `Edited ${index}`;
  await f.advance(100);
  assert.equal(visited, 1, '240 existing articles must not be revisited for one React card update');
  assert.equal(f.stats.scans, 2);
  assert.equal(f.stats.roots[1], card);
  await f.advance(1000); assert.equal(f.stats.scans, 2, 'no idle follow-up pass');
});

test('added and replaced feed cards scan their connected subtree instead of the whole timeline', async t => {
  const f = harness(t, '<main><article id="old"><p>Old</p></article><article id="unchanged"><p>Unchanged</p></article></main>');
  f.qa.start();
  f.document.querySelector('main').insertAdjacentHTML('beforeend', '<article id="added"><header>Author</header><p>New</p></article>');
  await f.advance(100);
  assert.equal(f.stats.roots[1], f.document.getElementById('added'));
  f.document.getElementById('old').outerHTML = '<article id="replacement"><p>Replaced</p></article>';
  await f.advance(100);
  assert.equal(f.stats.roots[2], f.document.getElementById('replacement'));
  assert.equal(f.stats.refreshes, 3);
  f.document.getElementById('replacement').remove();
  await f.advance(100);
  assert.equal(f.stats.roots[3], f.document.querySelector('main'), 'removals still allow shared modules to release detached state');
});

test('nested dirty roots are coalesced, and a large commit uses one bounded page fallback', async t => {
  const f = harness(t, `<main>${Array.from({ length: 15 }, (_, index) => `<article id="card-${index}"><p>Post ${index}</p></article>`).join('')}</main>`);
  f.qa.start();
  const card = f.document.getElementById('card-0');
  f.qa.ctScheduleScan(card.querySelector('p')); f.qa.ctScheduleScan(card);
  await f.advance(100);
  assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], card);
  for (const article of f.document.querySelectorAll('article')) article.querySelector('p').textContent = 'Updated';
  await f.advance(100);
  assert.equal(f.stats.scans, 3, '15 disjoint article mutations are processed in one page pass');
  assert.equal(f.stats.roots[2], f.document);
  assert.equal(f.stats.refreshes, 3);
});

test('route and theme changes promote queued article work to one full pass', async t => {
  const f = harness(t, '<div id="root-container" data-app-theme="light"><main><article><p>Post</p></article></main></div>');
  f.qa.start();
  f.document.querySelector('article p').textContent = 'Changed'; await f.flush();
  f.window.history.pushState({}, '', '/post/one');
  await f.advance(100);
  assert.equal(f.stats.roots[1], f.document); assert.equal(f.stats.scans, 2);
  f.document.querySelector('article p').textContent = 'Changed again';
  f.document.getElementById('root-container').dataset.appTheme = 'dark';
  await f.advance(100);
  assert.equal(f.stats.roots[2], f.document); assert.equal(f.stats.scans, 3);
});

test('early favorite repairs do not schedule a second general scan after repeated native action commits', async t => {
  const f = harness(t, '<main><article><p class="tl-user-text">Like ❤ body</p><button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like, 1 like"><svg class="lucide-heart"></svg>Like</button><button data-testid="tweet-like-action-count" aria-label="View 1 like">1</button></article></main>');
  f.qa.ctPrepareFavoritePresentation(); f.qa.start();
  const button = f.document.querySelector('[data-testid="tweet-like-action"]');
  const count = f.document.querySelector('[data-testid="tweet-like-action-count"]');
  for (let index = 0; index < 10; index++) {
    button.className = index % 2 ? 'text-tl-app-text-muted' : 'text-pink-500';
    button.title = 'Like'; button.setAttribute('aria-label', `Like, ${index + 2} likes`);
    button.innerHTML = '<svg class="lucide-heart"></svg>Like';
    count.textContent = String(index + 2); count.setAttribute('aria-label', `View ${index + 2} likes`);
    await f.advance(100);
  }
  assert.equal(f.stats.scans, 1, '10 action commits use the immediate favorite observer and no general pass');
  assert.equal(f.timers.size, 0);
  assert.equal(button.title, 'お気に入り'); assert.equal(button.querySelectorAll('.ct-star').length, 1);
  assert.equal(count.getAttribute('aria-label'), '11件のお気に入りを表示');
  assert.equal(f.document.querySelector('.tl-user-text').textContent, 'Like ❤ body');
});

test('async owned badge/time/panel inserts and removals do not wake the general scan', async t => {
  const f = harness(t, '<main><article><header>Author</header><p>Post</p></article></main>');
  f.qa.start();
  for (const owner of ['official-badges', 'exact-timestamp', 'favorite-star']) {
    const span = f.document.createElement('span'); span.dataset.ctOwned = owner; span.textContent = owner;
    f.document.querySelector('article header').append(span); await f.advance(100);
    span.textContent = 'Updated'; span.remove(); await f.advance(100);
  }
  assert.equal(f.stats.scans, 1); assert.equal(f.timers.size, 0);
  f.document.querySelector('article header').append(' native metadata');
  await f.advance(100); assert.equal(f.stats.scans, 2, 'native metadata remains eligible');
});

test('hidden pages cancel pending scans, ignore native changes, and refresh once when visible', async t => {
  const f = harness(t, '<main><article><p>Post</p></article></main>');
  f.qa.start();
  f.document.querySelector('p').textContent = 'Changed before hide'; await f.advance(50);
  f.hidden(true); assert.equal(f.timers.size, 0);
  f.document.querySelector('main').innerHTML = '<article><p>Changed while hidden</p></article>';
  f.qa.ctScheduleScan(); await f.advance(1000);
  assert.equal(f.stats.scans, 1);
  f.hidden(false); f.hidden(false); await f.advance(100);
  assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], f.document);
  await f.advance(1000); assert.equal(f.stats.scans, 2);
});

test('hidden and aria-hidden native UI changes are reconsidered and unmounted queued roots are cleaned up', async t => {
  const f = harness(t, '<main><article hidden aria-hidden="true"><p>Post</p></article></main>');
  f.qa.start(); const article = f.document.querySelector('article');
  article.hidden = false; article.setAttribute('aria-hidden', 'false');
  await f.advance(100);
  assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], article);
  f.qa.ctScheduleScan(article); article.remove(); await f.advance(100);
  assert.equal(f.stats.scans, 3); assert.ok(f.stats.roots[2].isConnected);
  await f.advance(1000); assert.equal(f.stats.scans, 3);
});

test('500 registered minute-clock writes do not wake a general scan, while native timestamp changes still do', async t => {
  const cards = Array.from({ length: 500 }, (_, index) => `<article id="clock-${index}"><div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate">alice</button><span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted hover:underline" title="1970-01-01T00:00:00Z">Just now</span></div><p class="tl-user-text">Clock post ${index}</p></article>`).join('');
  const f = harness(t, `<main>${cards}</main>`, {
    timestamps: true,
    scan(root, qa) { qa.timestampPatch(root); }
  });
  f.qa.start();
  assert.equal(f.stats.scans, 1);
  assert.equal(f.document.querySelector('span[title]').textContent, 'たった今');
  await f.advance(50000);
  assert.equal(f.document.querySelectorAll('span[title]').length, 500);
  for (const clock of f.document.querySelectorAll('span[title]')) assert.equal(clock.textContent, '1分前');
  assert.equal(f.stats.scans, 1, 'minute updates must not produce 500 dirty roots or a full-page fallback');
  const clock = f.document.querySelector('span[title]');
  clock.firstChild.data = '5h';
  await f.advance(100);
  assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], clock.closest('article'));
  assert.equal(clock.textContent, '1分前', 'a different native label remains eligible for correction');
  clock.title = '1970-01-01T00:00:59Z';
  await f.advance(100);
  assert.equal(f.stats.scans, 3); assert.equal(clock.textContent, 'たった今');
});

test('immediate favorite repair retains native clicks, capture listeners and the selected-star motion without a general scan', async t => {
  let captures = 0, nativeClicks = 0;
  const animations = [];
  const f = harness(t, '<main><article><p class="tl-user-text">Body ❤</p><button data-testid="tweet-like-action" class="text-tl-app-text-muted" aria-label="Like"><svg class="lucide-heart"></svg>Like</button></article></main>', {
    motion: true,
    captureFavoriteClick(event) { if (event.target.closest('[data-testid="tweet-like-action"]')) captures++; },
    scan(root, qa) { qa.patchClassicMotion(root, true); qa.patchFavoriteButtons(root); }
  });
  f.window.Element.prototype.animate = function (frames, settings) {
    const animation = { target: this, frames, settings, finished: new Promise(() => {}), cancel() {} };
    animations.push(animation); return animation;
  };
  const button = f.document.querySelector('[data-testid="tweet-like-action"]');
  button.addEventListener('click', () => {
    nativeClicks++; button.className = 'text-pink-500'; button.setAttribute('aria-label', 'Unlike');
  });
  f.qa.ctPrepareFavoritePresentation(); f.qa.start();
  button.click(); await f.advance(100);
  assert.equal(nativeClicks, 1); assert.equal(captures, 1);
  assert.equal(f.stats.scans, 1);
  assert.equal(animations.length, 1); assert.equal(animations[0].target, button.querySelector('.ct-star'));
  assert.equal(animations[0].settings.duration, 280);
  assert.equal(button.title, 'お気に入りを解除');
  assert.equal(f.document.querySelector('.tl-user-text').textContent, 'Body ❤');
  await f.advance(500); assert.equal(f.stats.scans, 1); assert.equal(f.timers.size, 0);
});

test('notification avatar overlay updates retain the wrapper context and cannot restore the native Follow plus', async t => {
  const avatar = username => `<div id="avatar-${username}" class="relative inline-flex shrink-0 isolate"><img class="rounded-full object-cover" alt="${username} avatar" src="https://cdn.example/${username}.jpg"><span role="button" tabindex="0" aria-label="Follow @${username}" class="absolute -bottom-0.5 -right-0.5"><svg></svg></span></div>`;
  const f = harness(t, `<main><div class="border-b"><button id="row" class="w-full flex items-start gap-3"><div>${avatar('alice')}${avatar('bob')}</div><p>Notification preview</p></button></div></main>`, {
    navigation: true, route: '/notifications',
    scan(root, qa) { qa.patchNavigation(root); }
  });
  let rowClicks = 0;
  f.document.getElementById('row').addEventListener('click', () => rowClicks++);
  f.qa.start();
  const wrapper = f.document.getElementById('avatar-bob');
  let overlay = wrapper.querySelector('span[role="button"]');
  const link = wrapper.querySelector('a.ct-notification-profile-link');
  assert.equal(link.getAttribute('href'), '/user/bob');
  overlay.className = 'absolute -bottom-0.5 -right-0.5 cursor-pointer';
  overlay.setAttribute('aria-hidden', 'false'); overlay.tabIndex = 0;
  await f.advance(100);
  assert.equal(f.stats.roots[1], wrapper);
  assert.equal(overlay.classList.contains('ct-avatar-follow-hidden'), true);
  assert.equal(overlay.getAttribute('aria-hidden'), 'true'); assert.equal(overlay.tabIndex, -1);
  assert.equal(wrapper.querySelector('a.ct-notification-profile-link'), link, 'the exact profile link is retained');
  overlay.outerHTML = '<span role="button" tabindex="0" aria-label="Follow @bob" class="absolute -bottom-0.5 -right-0.5"><svg></svg></span>';
  await f.advance(100); overlay = wrapper.querySelector('span[role="button"]');
  assert.equal(f.stats.roots[2], wrapper);
  assert.equal(overlay.classList.contains('ct-avatar-follow-hidden'), true);
  assert.equal(overlay.getAttribute('aria-hidden'), 'true'); assert.equal(overlay.tabIndex, -1);
  link.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  assert.equal(rowClicks, 0, 'individual avatar navigation still bypasses the representative notification');
  assert.equal(wrapper.querySelector('a.ct-notification-profile-link').getAttribute('href'), '/user/bob');
  assert.equal(f.document.getElementById('avatar-alice').querySelector('a').getAttribute('href'), '/user/alice');
  await f.advance(1000); assert.equal(f.stats.scans, 3, 'repairs settle without a follow-up scan loop');
});

function conversationFixture() {
  const article = id => `<article id="${id}"><div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate">alice</button><span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted hover:underline" title="1970-01-01T00:00:00Z">Just now</span></div><p class="tl-user-text">Conversation post ${id}</p><div><button data-testid="tweet-like-action">Like</button></div></article>`;
  return `<main><div id="conversation" class="animate-fadeIn flex flex-col"><div id="conversation-header" class="shrink-0"><div class="sticky"><button id="back" aria-label="Back"></button></div></div><div id="conversation-scroll" class="min-h-0 flex-1 overflow-y-auto">${article('parent')}${article('reply')}</div><div id="conversation-footer" class="shrink-0 z-20 border-t"><div role="form"><textarea id="reply-input"></textarea></div></div></div></main>`;
}

for (const mode of ['back-label', 'reply-input-removal', 'footer-removal', 'header-removal', 'scroll-class', 'panel-class']) {
  test(`conversation ${mode} updates invalidate and restore all stamps through the verified shared panel`, async t => {
    const f = harness(t, conversationFixture(), {
      timestamps: true, route: '/post/parent',
      scan(root, qa) { qa.timestampPatch(root); }
    });
    f.qa.start();
    const panel = f.document.getElementById('conversation');
    const back = f.document.getElementById('back');
    const input = f.document.getElementById('reply-input');
    const footer = f.document.getElementById('conversation-footer');
    const header = f.document.getElementById('conversation-header');
    const scroll = f.document.getElementById('conversation-scroll');
    assert.equal(f.document.querySelectorAll('.ct-detail-post-time').length, 2);
    if (mode === 'back-label') back.setAttribute('aria-label', 'Other action');
    if (mode === 'reply-input-removal') input.remove();
    if (mode === 'footer-removal') footer.remove();
    if (mode === 'header-removal') header.remove();
    if (mode === 'scroll-class') scroll.classList.remove('overflow-y-auto');
    if (mode === 'panel-class') panel.classList.remove('animate-fadeIn');
    await f.advance(100);
    assert.equal(f.stats.roots[1], panel, 'invalidating siblings must revisit their native conversation articles');
    assert.equal(f.document.querySelectorAll('.ct-detail-post-time').length, 0, 'a lost strict detail context removes every stale stamp');
    if (mode === 'back-label') back.setAttribute('aria-label', 'Back');
    if (mode === 'reply-input-removal') footer.querySelector('[role="form"]').append(input);
    if (mode === 'footer-removal') panel.append(footer);
    if (mode === 'header-removal') panel.prepend(header);
    if (mode === 'scroll-class') scroll.classList.add('overflow-y-auto');
    if (mode === 'panel-class') panel.classList.add('animate-fadeIn');
    await f.advance(100);
    assert.equal(f.stats.roots[2], panel);
    assert.equal(f.document.querySelectorAll('.ct-detail-post-time').length, 2);
    const source = f.document.querySelector('#reply span[title]');
    source.title = '1970-01-01T00:00:01Z'; await f.advance(100);
    assert.equal(f.stats.roots[3], source.closest('article'), 'ordinary article changes keep their narrow card scope');
    await f.advance(1000); assert.equal(f.stats.scans, 4, 'shared repairs settle without an idle loop');
  });
}

test('a newly valid conversation is recognized, while an unverified similar container is not promoted', async t => {
  const f = harness(t, conversationFixture(), {
    timestamps: true, route: '/post/parent',
    scan(root, qa) { qa.timestampPatch(root); }
  });
  f.document.getElementById('back').setAttribute('aria-label', 'Other action');
  const generic = f.document.createElement('span'); generic.id = 'generic'; generic.title = 'Original';
  f.document.getElementById('conversation-footer').append(generic);
  f.qa.start(); assert.equal(f.document.querySelectorAll('.ct-detail-post-time').length, 0);
  generic.title = 'Changed'; await f.advance(100);
  assert.equal(f.stats.roots[1], generic, 'matching outer flex classes alone cannot widen a generic UI update');
  f.document.getElementById('back').setAttribute('aria-label', 'Back'); await f.advance(100);
  assert.equal(f.stats.roots[2], f.document.getElementById('conversation'));
  assert.equal(f.document.querySelectorAll('.ct-detail-post-time').length, 2, 'positive detail context is detected even without a previous stamp');
});

test('native home tab selection gets one full reconciliation, while later card updates retain the fast path', async t => {
  let visits = 0;
  const labels = ['For you', 'Following', 'News', 'Sports', 'Entertainment', 'Technology'];
  const tabs = `<div class="sticky top-app-header border-dashed"><div class="overflow-x-auto">${labels.map((label, index) => `<button id="home-tab-${index}" class="rounded-full text-xs whitespace-nowrap ${index === 0 ? 'bg-sky-500 text-white' : 'bg-tl-app-card text-tl-app-text-muted'}">${label}</button>`).join('')}</div></div>`;
  const f = harness(t, `<main>${tabs}${Array.from({ length: 240 }, (_, index) => `<article id="tab-card-${index}"><p class="tl-user-text">Following News Post ${index}</p></article>`).join('')}</main><textarea>Following News draft</textarea>`, {
    localization: true,
    scan(root, qa) {
      visits += root.matches?.('article') ? 1 : root.querySelectorAll('article').length;
      qa.patchUI(root);
    }
  });
  f.qa.start(); assert.equal(visits, 240); visits = 0;
  const original = f.document.getElementById('home-tab-0');
  const following = f.document.getElementById('home-tab-1');
  let nativeClicks = 0;
  following.addEventListener('click', () => {
    nativeClicks++;
    original.className = 'rounded-full text-xs whitespace-nowrap bg-tl-app-card text-tl-app-text-muted';
    following.className = 'rounded-full text-xs whitespace-nowrap bg-sky-500 text-white';
  });
  following.click(); await f.advance(100);
  assert.equal(nativeClicks, 1); assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], f.document);
  assert.equal(visits, 240, 'a native view switch reconciles retained sibling state once');
  assert.equal(following.textContent, 'フォロー中');
  assert.equal(f.document.querySelector('textarea').value, 'Following News draft');
  assert.equal(f.document.getElementById('tab-card-42').textContent, 'Following News Post 42');
  visits = 0;
  f.document.getElementById('tab-card-42').querySelector('p').firstChild.data = 'Updated post';
  await f.advance(100);
  assert.equal(visits, 1); assert.equal(f.stats.roots[2], f.document.getElementById('tab-card-42'));
  following.classList.add('new-native-hover-style'); await f.advance(100);
  assert.notEqual(f.stats.roots[3], f.document, 'an unchanged selected state does not promote cosmetic tab updates');
  await f.advance(1000); assert.equal(f.stats.scans, 4);
});

test('aria-selected-only native tab switches reconcile the full view and preserve localized labels and native handlers', async t => {
  const f = harness(t, '<main><div role="tablist"><button id="posts-tab" role="tab" aria-selected="true" aria-label="Posts">Posts</button><button id="replies-tab" role="tab" aria-selected="false" aria-label="Replies">Replies</button></div><article><p class="tl-user-text">Posts Replies user text</p><button class="font-bold truncate">Following</button></article><textarea>Posts Replies draft</textarea></main>', {
    route: '/profile', localization: true,
    scan(root, qa) { qa.patchUI(root); }
  });
  f.qa.start();
  const posts = f.document.getElementById('posts-tab');
  const replies = f.document.getElementById('replies-tab');
  let clicks = 0;
  replies.addEventListener('click', () => {
    clicks++; posts.setAttribute('aria-selected', 'false'); replies.setAttribute('aria-selected', 'true');
  });
  replies.click(); await f.advance(100);
  assert.equal(clicks, 1); assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], f.document);
  assert.equal(posts.textContent, 'ツイート'); assert.equal(replies.textContent, '返信');
  assert.equal(posts.getAttribute('aria-selected'), 'false'); assert.equal(replies.getAttribute('aria-selected'), 'true');
  assert.equal(f.document.querySelector('.tl-user-text').textContent, 'Posts Replies user text');
  assert.equal(f.document.querySelector('.font-bold').textContent, 'Following');
  assert.equal(f.document.querySelector('textarea').value, 'Posts Replies draft');
  replies.setAttribute('aria-selected', 'true'); await f.advance(1000);
  assert.equal(f.stats.scans, 2, 'writing the same native selection again cannot keep scanning');
});

test('same-URL native navigation current-state and tablist replacement get one full reconciliation', async t => {
  const f = harness(t, '<nav><button id="home" aria-current="page">Home</button><button id="notifications">Notifications</button></nav><main><div id="tabs" role="tablist"><button role="tab" aria-selected="true">Posts</button><button role="tab" aria-selected="false">Replies</button></div></main>');
  f.qa.start();
  f.document.getElementById('home').removeAttribute('aria-current');
  f.document.getElementById('notifications').setAttribute('aria-current', 'page');
  await f.advance(100);
  assert.equal(f.stats.scans, 2); assert.equal(f.stats.roots[1], f.document);
  f.document.getElementById('tabs').innerHTML = '<button role="tab" aria-selected="true">Replies</button><button role="tab" aria-selected="false">Reposts</button>';
  await f.advance(100);
  assert.equal(f.stats.scans, 3); assert.equal(f.stats.roots[2], f.document);
  f.document.getElementById('tabs').removeAttribute('role'); await f.advance(100);
  assert.equal(f.stats.scans, 4); assert.equal(f.stats.roots[3], f.document, 'losing the native tablist role also releases sibling state');
  await f.advance(1000); assert.equal(f.stats.scans, 4);
});

test('post content, draft suggestions and local panels cannot promote their selected controls to a full scan', async t => {
  const f = harness(t, '<main><article id="post"><div class="tl-user-text" role="tablist"><button role="tab" aria-selected="false" id="content-tab">Following</button></div></article><div role="listbox"><button role="option" aria-selected="false" id="suggestion">Following</button></div><div data-ct-local-ui="japanese-news"><button aria-current="page" role="tab" aria-selected="false" id="local-tab">日本</button></div><textarea>Following draft</textarea></main>');
  f.qa.start();
  f.document.getElementById('content-tab').setAttribute('aria-selected', 'true');
  await f.advance(100); assert.equal(f.stats.roots[1], f.document.getElementById('post'));
  f.document.getElementById('suggestion').setAttribute('aria-selected', 'true');
  await f.advance(100); assert.notEqual(f.stats.roots[2], f.document);
  f.document.getElementById('local-tab').setAttribute('aria-selected', 'true');
  f.document.getElementById('local-tab').setAttribute('aria-current', 'step');
  await f.advance(1000); assert.equal(f.stats.scans, 3);
  assert.equal(f.document.getElementById('content-tab').textContent, 'Following');
  assert.equal(f.document.querySelector('textarea').value, 'Following draft');
});
