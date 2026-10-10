const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '../src/enhancements.js'), 'utf8');

const KEY = 'ct-local-tools-v1';
const INTENT_KEY = 'ct-local-search-intent-v1';
const state = overrides => ({ version: 1, enabled: false, keywords: [], searches: [], ...overrides });
const post = (id, body, name = 'Normal Author') => `<article id="${id}"><div><button class="author">${name}</button><p class="whitespace-pre-wrap break-words">${body}</p><button class="like">Like</button></div></article>`;
function setup(t, { html = '', settings, url = 'https://tweet.app/feed', options = {}, beforeInstall } = {}) {
  const dom = new JSDOM(`<html><head></head><body><main>${html}</main></body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  if (settings !== undefined) window.localStorage.setItem(KEY, typeof settings === 'string' ? settings : JSON.stringify(settings));
  if (beforeInstall) beforeInstall(window);
  window.eval(source + '\nwindow.installLocalEnhancements = installLocalEnhancements;');
  const controller = window.installLocalEnhancements({ locale: 'en', ...options });
  t.after(() => { controller.destroy(); window.close(); });
  return { window, document: window.document, controller };
}
function submit(window, element) {
  element.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
function acknowledgeNativeSearch(input) {
  const button = input.ownerDocument.createElement('button');
  button.setAttribute('aria-label', 'Clear search');
  input.parentElement.append(button);
}

test('link preview toggle reflects persisted state and restores its checkbox after a save failure', t => {
  let automatic = true, reject = false;
  const { document, controller } = setup(t, { options:{
    getLinkPreviews:() => automatic,
    setLinkPreviews:value => { if (reject) return false; automatic = value; }
  }});
  const input = document.getElementById('ct-local-link-previews');
  assert.equal(input.checked, true);
  input.click(); assert.equal(automatic, false); assert.equal(input.checked, false);
  reject = true; input.click(); assert.equal(input.checked, false);
  assert.match(document.getElementById('ct-local-tools-status').textContent, /Could not save/);
  automatic = true; controller.refresh(); assert.equal(input.checked, true);
  assert.match(document.getElementById('ct-local-link-help').textContent, /directly.*without sign-in credentials or post text/);
});

test('links-only Home filter preserves native nodes, counts verified originals and can be cleared immediately', t => {
  const html = post('plain', 'Ordinary post') + post('linked', '<a href="https://example.com/article">Read more</a>') +
    post('quoted', '<blockquote><a href="https://example.com/quote">Quoted link</a></blockquote>') +
    '<article id="unknown"><span>Unknown native layout</span></article>';
  const { window, document, controller } = setup(t, { html });
  const plain = document.getElementById('plain'), linked = document.getElementById('linked');
  const original = linked.innerHTML;
  document.getElementById('ct-local-links-only').click();
  assert.equal(plain.classList.contains('ct-links-filter-hidden'), true);
  assert.equal(linked.classList.contains('ct-links-filter-hidden'), false);
  assert.equal(document.getElementById('unknown').classList.contains('ct-links-filter-hidden'), false);
  assert.equal(linked.innerHTML, original);
  assert.match(document.querySelector('.ct-links-filter-summary').textContent, /1 \/ 3 verified posts/);
  assert.equal(JSON.parse(window.localStorage.getItem(KEY)).linksOnly, true);
  document.querySelector('.ct-links-filter-summary button').click();
  assert.equal(document.querySelector('.ct-links-filter-hidden'), null);
  assert.equal(document.querySelector('.ct-links-filter-summary'), null);
  assert.equal(document.getElementById('ct-local-links-only').checked, false);
  controller.destroy(); assert.equal(document.getElementById('plain'), plain);
});

test('links-only filtering ignores preview-owned and quoted anchors, restores after route changes and reacts to reused bodies', t => {
  const { document, window, controller } = setup(t, { settings:state({ linksOnly:true }), html:
    post('a', '<a href="https://example.com/article">External</a>') +
    post('b', '<span data-ct-owned><a href="https://example.com/preview">Preview</a></span>') });
  const a = document.getElementById('a'), b = document.getElementById('b');
  assert.equal(a.classList.contains('ct-links-filter-hidden'), false);
  assert.equal(b.classList.contains('ct-links-filter-hidden'), true);
  a.querySelector('a').setAttribute('href', '/user/someone'); controller.refresh();
  assert.equal(a.classList.contains('ct-links-filter-hidden'), true);
  window.history.pushState({}, '', '/post/example'); controller.refresh();
  assert.equal(document.querySelector('.ct-links-filter-hidden'), null);
  window.history.pushState({}, '', '/feed'); controller.refresh();
  assert.equal(a.classList.contains('ct-links-filter-hidden'), true);
  controller.destroy(); assert.equal(document.querySelector('.ct-links-filter-hidden'), null);
});

test('old Tools settings preserve searches and bookmarks when links-only is added, while invalid optional values fail validation', t => {
  const saved = state({ searches:['my search'], bookmarks:[{path:'/post/my-post',label:'My note'}] });
  const { document, window } = setup(t, { settings:saved, html:post('a', 'Plain') });
  assert.equal(document.getElementById('ct-local-links-only').checked, false);
  document.getElementById('ct-local-links-only').click();
  const result = JSON.parse(window.localStorage.getItem(KEY));
  assert.deepEqual(result.searches, saved.searches); assert.deepEqual(result.bookmarks, saved.bookmarks);
  const invalid = setup(t, { settings:state({ linksOnly:'yes' }) });
  assert.match(invalid.document.getElementById('ct-local-tools-status').textContent, /Could not read/);
  assert.equal(invalid.document.getElementById('ct-local-links-only').checked, false);
});

test('filters are opt-in and tools are keyboard-accessible', t => {
  const { document, window } = setup(t, { html: post('a', 'News about sports') });
  assert.equal(document.querySelector('.ct-keyword-collapsed'), null);
  const toggle = document.getElementById('ct-local-tools-toggle');
  const panel = document.getElementById('ct-local-tools-panel');
  const close = panel.querySelector('header button');
  assert.ok(toggle.compareDocumentPosition(panel) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    'Tab order must enter the revealed panel after its toggle');
  assert.equal(panel.getAttribute('role'), 'region');
  assert.ok(document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent);
  assert.equal(panel.hidden, true);
  toggle.focus();
  toggle.click();
  assert.equal(panel.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, close, 'Opening must make panel controls reachable immediately');
  close.click();
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, toggle);
  toggle.click();
  document.getElementById('ct-local-keywords').focus();
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, toggle);
});

test('Favorites restoration is explicit and reports partial recovery or a retryable failure', async t => {
  let called=0,fail=false;
  const {document}=setup(t,{options:{restoreVisibleFavorites:async()=>{called++;if(fail) throw new Error('offline');return {saved:3,unresolved:1};}}});
  const button=document.getElementById('ct-restore-favorites');assert.equal(called,0);
  button.click();await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.getElementById('ct-local-tools-status').textContent,/Saved 3.*1 could not be identified/);
  assert.equal(button.disabled,false);fail=true;button.click();await new Promise(resolve=>setImmediate(resolve));
  assert.match(document.getElementById('ct-local-tools-status').textContent,/Could not check Favorites/);
  assert.equal(button.disabled,false);
});

test('historical recovery starts only on a click and updates pause, resume, terminal and storage feedback', async t => {
  let state={pages:0,scanned:0,recovered:0,busy:false},runs=0,stops=0,restarts=0;
  const {document,window}=setup(t,{options:{getFavoriteHistoryStatus:()=>state,
    runFavoriteHistory:()=>{runs++;state={...state,busy:true};},
    stopFavoriteHistory:()=>{stops++;state={...state,busy:false,paused:true};},
    restartFavoriteHistory:()=>{restarts++;state={pages:0,busy:true};}}});
  const run=document.getElementById('ct-history-run'),stop=document.getElementById('ct-history-stop'),restart=document.getElementById('ct-history-restart');
  assert.equal(runs,0);assert.equal(stop.disabled,true);run.click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runs,1);assert.equal(run.disabled,true);assert.equal(restart.disabled,true);assert.equal(stop.disabled,false);
  stop.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(stops,1);assert.match(document.getElementById('ct-history-status').textContent,/Paused/);
  state={pages:3,scanned:60,recovered:7,busy:false};window.dispatchEvent(new window.Event('ct-favorite-history-change'));
  assert.equal(run.textContent,'Continue searching');assert.match(document.getElementById('ct-history-status').textContent,/3 pages.*60 posts.*7/);
  state={...state,done:true};window.dispatchEvent(new window.Event('ct-favorite-history-change'));assert.equal(run.disabled,true);
  assert.match(document.getElementById('ct-history-status').textContent,/end of the timelines returned/);
  restart.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(restarts,1);
  state={...state,busy:false,warning:'storage'};window.dispatchEvent(new window.Event('ct-favorite-history-change'));
  assert.match(document.getElementById('ct-history-status').textContent,/Back up Favorites as JSON/);
});

test('history controls explain the service boundary in Japanese and unsubscribe when destroyed', t => {
  let reads=0;
  const {document,window,controller}=setup(t,{options:{locale:'ja',getFavoriteHistoryStatus:()=>{reads++;return {};},runFavoriteHistory:()=>{},stopFavoriteHistory:()=>{},restartFavoriteHistory:()=>{}}});
  assert.match(document.getElementById('ct-history-help').textContent,/全お気に入りを保証するものではありません/);
  assert.equal(document.getElementById('ct-history-run').textContent,'過去の投稿から探す');
  controller.destroy();const before=reads;window.dispatchEvent(new window.Event('ct-favorite-history-change'));assert.equal(reads,before);
});

test('save feedback stays outside the scrolling form body and inputs reference visible help', t => {
  const { document, window } = setup(t);
  const panel = document.getElementById('ct-local-tools-panel');
  const body = document.getElementById('ct-local-tools-body');
  const status = document.getElementById('ct-local-tools-status');
  assert.ok(body && panel.contains(body));
  assert.equal(body.contains(status), false, 'Feedback must remain visible when the forms scroll');
  assert.equal(status.closest('footer')?.parentElement, panel);
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  for (const id of ['ct-local-keywords', 'ct-local-search-input', 'ct-local-bookmark-input']) {
    const input = document.getElementById(id);
    const descriptions = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    assert.ok(descriptions.some(id => document.getElementById(id)?.textContent.trim()), `${id} needs readable guidance`);
    assert.ok(body.contains(input));
  }
  const searchInput = document.getElementById('ct-local-search-input');
  searchInput.value = 'cats';
  submit(window, searchInput);
  assert.equal(status.closest('footer').hidden, false);
  assert.match(status.textContent, /saved/i);
});

test('filter matches only native post body, ignoring authors, controls, editors and nested replies', t => {
  const html = post('matched', 'News about SPOILERS') +
    post('author-only', 'Ordinary text', 'Spoilers') +
    post('button-only', 'Ordinary text').replace('Like', 'Spoilers') +
    post('editor', '<span contenteditable="true">spoilers</span>') +
    `<article id="parent"><p class="whitespace-pre-wrap break-words">Ordinary text</p>${post('reply', 'spoilers')}</article>`;
  const { document } = setup(t, { html, settings: state({ enabled: true, keywords: ['spoilers'] }) });
  assert.equal(document.getElementById('matched').classList.contains('ct-keyword-collapsed'), true);
  assert.equal(document.getElementById('author-only').classList.contains('ct-keyword-collapsed'), false);
  assert.equal(document.getElementById('button-only').classList.contains('ct-keyword-collapsed'), false);
  assert.equal(document.getElementById('editor').classList.contains('ct-keyword-collapsed'), false);
  assert.equal(document.getElementById('parent').classList.contains('ct-keyword-collapsed'), false);
  assert.equal(document.getElementById('reply').classList.contains('ct-keyword-collapsed'), true);
});

test('show this post restores preserved native handlers and does not navigate the card', t => {
  let nativeClicks = 0;
  let navigations = 0;
  const { document, controller } = setup(t, {
    html: post('a', 'spoilers <a href="/hashtag/story">#story</a>'),
    settings: state({ enabled: true, keywords: ['spoilers'] }),
    beforeInstall(window) {
      window.document.querySelector('.like').addEventListener('click', () => nativeClicks++);
      window.document.querySelector('article').addEventListener('click', () => navigations++);
    },
  });
  const article = document.getElementById('a');
  const like = article.querySelector('.like');
  const link = article.querySelector('a');
  article.querySelector('.ct-keyword-notice button').click();
  assert.equal(navigations, 0);
  assert.equal(article.classList.contains('ct-keyword-collapsed'), false);
  controller.refresh();
  assert.equal(article.classList.contains('ct-keyword-collapsed'), false);
  assert.equal(article.querySelector('.like'), like);
  assert.equal(article.querySelector('a'), link);
  like.click();
  assert.equal(nativeClicks, 1);
  article.querySelector('p').textContent = 'Another spoilers post in a recycled card';
  controller.refresh();
  assert.equal(article.classList.contains('ct-keyword-collapsed'), true);
});

test('saving and disabling keywords affects existing and newly mounted posts', async t => {
  const { document, window } = setup(t, { html: post('a', 'ＳＰＯＩＬＥＲＳ') });
  const words = document.getElementById('ct-local-keywords');
  words.value = 'spoilers\nSPOILERS';
  document.getElementById('ct-local-filter-enabled').checked = true;
  submit(window, words);
  assert.equal(document.querySelectorAll('.ct-keyword-collapsed').length, 1);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(KEY)).keywords, ['spoilers']);
  document.querySelector('main').insertAdjacentHTML('beforeend', post('b', 'spoilers here'));
  await new Promise(resolve => window.setTimeout(resolve, 110));
  assert.equal(document.querySelectorAll('.ct-keyword-collapsed').length, 2);
  document.getElementById('ct-local-filter-enabled').checked = false;
  submit(window, words);
  assert.equal(document.querySelectorAll('.ct-keyword-collapsed').length, 0);
});

test('saved searches use actual Explore route, safe text and removable persistent entries', t => {
  const { document, window } = setup(t);
  const input = document.getElementById('ct-local-search-input');
  input.value = '<img src=x onerror=alert(1)> 日本語 & food';
  submit(window, input);
  const link = document.querySelector('#ct-local-tools li a');
  assert.equal(link.textContent, '<img src=x onerror=alert(1)> 日本語 & food');
  assert.equal(document.querySelector('#ct-local-tools img'), null);
  const url = new URL(link.href);
  assert.equal(url.pathname, '/explore');
  assert.equal(url.searchParams.get('ct_search'), link.textContent);
  assert.equal(JSON.parse(window.localStorage.getItem(KEY)).searches.length, 1);
  link.nextElementSibling.click();
  assert.equal(JSON.parse(window.localStorage.getItem(KEY)).searches.length, 0);
});

test('ordinary saved-search clicks hand off a bounded tab-local intent to the plain Explore route', t => {
  const { document, window } = setup(t, { url: 'https://tweet.app/settings', settings: state({ searches: ['cats'] }) });
  const link = document.querySelector('#ct-local-tools li a');
  document.addEventListener('click', event => event.preventDefault()); // Keep jsdom on this document.
  link.click();
  assert.equal(link.getAttribute('href'), '/explore');
  const intent = JSON.parse(window.sessionStorage.getItem(INTENT_KEY));
  assert.equal(intent.version, 1);
  assert.equal(intent.query, 'cats');
  assert.equal(typeof intent.createdAt, 'number');
  assert.ok(Date.now() - intent.createdAt < 1000);
  assert.deepEqual(Object.keys(intent).sort(), ['createdAt', 'query', 'version']);
});

test('saved-search startup consumes a fresh tab-local intent even after the app removes the URL query', async t => {
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet">', url: 'https://tweet.app/explore',
    beforeInstall(window) {
      window.sessionStorage.setItem(INTENT_KEY, JSON.stringify({ version: 1, query: 'cats', createdAt: Date.now() }));
      const input = window.document.querySelector('main input');
      input.addEventListener('input', () => acknowledgeNativeSearch(input));
    },
  });
  assert.equal(window.sessionStorage.getItem(INTENT_KEY), null);
  // Wait for the native acknowledgement to be consumed, not a fixed timer
  // that can fire before the next animation frame under parallel CI load.
  const deadline = Date.now() + 3000;
  while (window.location.search !== '?tab=latest' && Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 20));
  }
  assert.equal(document.querySelector('main input').value, 'cats');
  assert.equal(document.getElementById('ct-local-tools-status').textContent, '');
});

test('stale, malformed and other-route search intents are discarded without entering a query', async t => {
  const fixtures = [
    ['https://tweet.app/explore', JSON.stringify({ version: 1, query: 'cats', createdAt: Date.now() - 121000 })],
    ['https://tweet.app/explore', JSON.stringify({ version: 1, query: 'cats', createdAt: Date.now() + 60000 })],
    ['https://tweet.app/explore', JSON.stringify({ version: 1, query: 'x'.repeat(201), createdAt: Date.now() })],
    ['https://tweet.app/explore', '{invalid'],
    ['https://tweet.app/settings', JSON.stringify({ version: 1, query: 'cats', createdAt: Date.now() })],
  ].map(([url, intent]) => setup(t, {
    html: '<input type="text" placeholder="Search Tweet">', url,
    beforeInstall(window) { window.sessionStorage.setItem(INTENT_KEY, intent); },
  }));
  await new Promise(resolve => setTimeout(resolve, 180));
  for (const { document, window } of fixtures) {
    assert.equal(window.sessionStorage.getItem(INTENT_KEY), null);
    assert.equal(document.querySelector('main input').value, '');
  }
});

test('choosing a saved search on Explore applies it directly in the same page', async t => {
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet" value="old query">',
    url: 'https://tweet.app/explore', settings: state({ searches: ['cats'] }),
    beforeInstall(window) {
      const input = window.document.querySelector('main input');
      input.addEventListener('input', () => acknowledgeNativeSearch(input));
    },
  });
  document.getElementById('ct-local-tools-toggle').click();
  document.querySelector('#ct-local-tools li a').click();
  await new Promise(resolve => window.setTimeout(resolve, 280));
  assert.equal(document.querySelector('main input').value, 'cats');
  assert.equal(document.getElementById('ct-local-tools-panel').hidden, true);
  assert.equal(window.sessionStorage.getItem(INTENT_KEY), null);
  assert.equal(window.location.href, 'https://tweet.app/explore');
});

test('modified clicks and blocked session storage keep a best-effort query URL', t => {
  const { document, window } = setup(t, { settings: state({ searches: ['cats'] }) });
  const link = document.querySelector('#ct-local-tools li a');
  document.addEventListener('click', event => event.preventDefault());
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
  assert.equal(window.sessionStorage.getItem(INTENT_KEY), null);
  assert.equal(link.getAttribute('href'), '/explore?ct_search=cats');
  window.Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  link.click();
  assert.equal(link.getAttribute('href'), '/explore?ct_search=cats');
});

test('saved search deep link drives native controlled input and preserves router state', async t => {
  let inputEvents = 0;
  let readValue;
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet">',
    url: 'https://tweet.app/explore?ct_search=%E6%97%A5%E6%9C%AC%E8%AA%9E%20%26%20cats&tab=latest#results',
    beforeInstall(window) {
      window.history.replaceState({ idx: 3, key: 'router' }, '');
      const input = window.document.querySelector('main input');
      // React installs an own-property setter to track values. The script
      // must use the prototype setter so a bubbling input event is observed.
      Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return window.HTMLInputElement.prototype.__lookupGetter__('value').call(this); },
        set() { throw new Error('Do not call React-tracked instance setter'); },
      });
      input.addEventListener('input', () => { inputEvents++; readValue = input.value; acknowledgeNativeSearch(input); });
    },
  });
  await new Promise(resolve => window.setTimeout(resolve, 280));
  assert.equal(document.querySelector('main input').value, '日本語 & cats');
  assert.equal(inputEvents, 1);
  assert.equal(readValue, '日本語 & cats');
  assert.equal(window.location.search, '?tab=latest');
  assert.equal(window.location.hash, '#results');
  assert.deepEqual(window.history.state, { idx: 3, key: 'router' });
});

test('deep link waits for asynchronously mounted native search field', async t => {
  const { document, window } = setup(t, { url: 'https://tweet.app/explore?ct_search=cats' });
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Tweet を検索';
  input.addEventListener('input', () => acknowledgeNativeSearch(input));
  document.querySelector('main').append(input);
  await new Promise(resolve => window.setTimeout(resolve, 280));
  assert.equal(input.value, 'cats');
  assert.equal(window.location.search, '');
});

test('saved search retries native mount resets before consuming its URL parameter', async t => {
  let changes = 0;
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet">',
    url: 'https://tweet.app/explore?ct_search=cats',
    beforeInstall(window) {
      const input = window.document.querySelector('main input');
      input.addEventListener('input', () => {
        changes++;
        if (changes === 1) input.value = ''; // Native initial effect wins once.
        else acknowledgeNativeSearch(input);
      });
    },
  });
  await new Promise(resolve => window.setTimeout(resolve, 180));
  assert.equal(window.location.search, '?ct_search=cats');
  await new Promise(resolve => window.setTimeout(resolve, 420));
  assert.equal(changes, 2);
  assert.equal(document.querySelector('main input').value, 'cats');
  assert.equal(window.location.search, '');
});

test('saved search recovers when native value tracking attaches after the first injection', async t => {
  let queryState = '';
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet">',
    url: 'https://tweet.app/explore?ct_search=cats',
    beforeInstall(window) {
      window.setTimeout(() => {
        const input = window.document.querySelector('main input');
        let trackedValue = input.value;
        input.addEventListener('input', () => {
          if (input.value === trackedValue) return;
          trackedValue = input.value;
          queryState = input.value;
          if (queryState) acknowledgeNativeSearch(input);
        });
      }, 160);
    },
  });
  await new Promise(resolve => window.setTimeout(resolve, 620));
  assert.equal(queryState, 'cats');
  assert.equal(document.querySelector('main input').value, 'cats');
  assert.equal(window.location.search, '');
});

test('a DOM value without native acknowledgement is not reported as a successful search', async t => {
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet"><textarea aria-label="Draft">Unsent draft</textarea>',
    url: 'https://tweet.app/explore?ct_search=cats',
    beforeInstall(window) {
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 15000 ? 380 : delay, ...args);
    },
  });
  const draft = document.querySelector('main textarea');
  draft.focus();
  await new Promise(resolve => window.setTimeout(resolve, 450));
  assert.equal(window.location.search, '?ct_search=cats');
  assert.match(document.getElementById('ct-local-tools-status').textContent, /Could not start.*cats/);
  assert.equal(document.getElementById('ct-local-tools-panel').hidden, false);
  assert.equal(document.activeElement, draft, 'A delayed search error must not steal focus from current work');
  assert.equal(draft.value, 'Unsent draft');
});

test('an existing search query is preserved while waiting to apply a saved search', async t => {
  const { document, window } = setup(t, {
    html: '<input type="text" placeholder="Search Tweet" value="user query">',
    url: 'https://tweet.app/explore?ct_search=cats',
  });
  await new Promise(resolve => window.setTimeout(resolve, 180));
  assert.equal(document.querySelector('main input').value, 'user query');
});

test('malformed storage and write errors are visible and do not partially enable filtering', t => {
  const { document, window } = setup(t, {
    html: post('a', 'spoilers'), settings: '{invalid',
    beforeInstall(window) { window.Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); }; },
  });
  assert.match(document.getElementById('ct-local-tools-status').textContent, /Could not read/);
  const words = document.getElementById('ct-local-keywords');
  words.value = 'spoilers';
  document.getElementById('ct-local-filter-enabled').checked = true;
  submit(window, words);
  assert.match(document.getElementById('ct-local-tools-status').textContent, /Could not save/);
  assert.equal(document.querySelector('.ct-keyword-collapsed'), null);
});

test('saving detects a newer stored value before its storage event arrives and preserves other-tab posts', t => {
  const initial = state({ bookmarks: [] });
  const { document, window } = setup(t, { settings: initial });
  const otherTab = state({ bookmarks: [{ path: '/post/other-tab', label: 'Saved in another tab' }] });
  const externalRaw = JSON.stringify(otherTab);
  window.localStorage.setItem(KEY, externalRaw);
  // Cross-tab event delivery is asynchronous; the write itself must detect this conflict.
  const input = document.getElementById('ct-local-search-input');
  input.value = 'My unsaved search';
  submit(window, input);
  assert.equal(window.localStorage.getItem(KEY), externalRaw);
  assert.equal(input.value, 'My unsaved search');
  const status = document.getElementById('ct-local-tools-status');
  assert.equal(status.dataset.error, 'true');
  assert.match(status.textContent, /reload/i);
  assert.equal(document.querySelector('#ct-local-tools a'), null, 'A rejected save must not become a local success');
});

test('a storage event preserves editable filter drafts and rejects stale filter saves without folding posts', t => {
  const { document, window } = setup(t, {
    html: post('a', 'spoilers'), settings: state({ bookmarks: [] }),
  });
  const input = document.getElementById('ct-local-keywords');
  input.value = 'spoilers';
  document.getElementById('ct-local-filter-enabled').checked = true;
  const externalRaw = JSON.stringify(state({ searches: ['cats'], bookmarks: [{ path: '/post/external', label: 'External' }] }));
  window.localStorage.setItem(KEY, externalRaw);
  window.dispatchEvent(new window.StorageEvent('storage', { key: KEY, newValue: externalRaw, storageArea: window.localStorage }));
  assert.equal(input.value, 'spoilers');
  assert.equal(document.getElementById('ct-local-filter-enabled').checked, true);
  submit(window, input);
  assert.equal(window.localStorage.getItem(KEY), externalRaw);
  assert.equal(document.querySelector('.ct-keyword-collapsed'), null);
  assert.equal(input.value, 'spoilers');
  assert.equal(document.getElementById('ct-local-tools-status').dataset.error, 'true');
});

test('storage.clear events warn and stale bookmark saves cannot resurrect deleted settings', t => {
  const { document, window } = setup(t, {
    html: post('a', 'Post body'), url: 'https://tweet.app/post/new-post',
    settings: state({ bookmarks: [{ path: '/post/existing-post', label: 'Existing post' }] }),
  });
  const input = document.getElementById('ct-local-bookmark-input');
  input.value = 'Unsaved bookmark note';
  window.localStorage.clear();
  window.dispatchEvent(new window.StorageEvent('storage', { key: null, newValue: null, storageArea: window.localStorage }));
  const status = document.getElementById('ct-local-tools-status');
  assert.match(status.textContent, /reload/i);
  submit(window, input);
  assert.equal(window.localStorage.getItem(KEY), null);
  assert.equal(input.value, 'Unsaved bookmark note');
  assert.equal(status.dataset.error, 'true');
  assert.deepEqual([...document.querySelectorAll('#ct-local-bookmarks a')].map(link => link.getAttribute('href')), ['/post/existing-post']);
});

test('automatic translation hook preserves failed state and supports Japanese copy', t => {
  let enabled = false;
  let shouldFail = false;
  const { document, window } = setup(t, { options: {
    locale: 'ja', getAutoTranslate: () => enabled,
    setAutoTranslate: value => { if (shouldFail) return false; enabled = value; },
  } });
  const checkbox = document.getElementById('ct-local-auto-translate');
  assert.equal(checkbox.checked, false);
  assert.equal(document.getElementById('ct-local-tools-toggle').textContent, '便利ツール');
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(enabled, true);
  shouldFail = true;
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(checkbox.checked, true);
  assert.match(document.getElementById('ct-local-tools-status').textContent, /保存できません/);
});

test('installation is idempotent and destroy restores all collapsed posts', t => {
  const { document, controller, window } = setup(t, { html: post('a', 'spoilers'), settings: state({ enabled: true, keywords: ['spoilers'] }) });
  assert.equal(window.installLocalEnhancements(), controller);
  assert.equal(document.querySelectorAll('#ct-local-tools').length, 1);
  controller.destroy();
  assert.equal(document.querySelector('.ct-keyword-collapsed'), null);
  assert.equal(document.querySelector('.ct-keyword-notice'), null);
  assert.equal(document.getElementById('ct-local-tools-style'), null);
});

test('saved posts require a detail route and persist only a safe permalink and user label', t => {
  const { document, window, controller } = setup(t, { html: post('a', 'Post body') });
  const input = document.getElementById('ct-local-bookmark-input');
  assert.equal(input.closest('form').querySelector('button').disabled, true);
  submit(window, input);
  assert.equal(window.localStorage.getItem(KEY), null);
  window.history.pushState({}, '', '/post/abc-123');
  controller.refresh();
  assert.equal(input.closest('form').querySelector('button').disabled, false);
  input.value = '<script>private note</script>';
  submit(window, input);
  const link = document.querySelector('#ct-local-bookmarks a');
  assert.equal(link.getAttribute('href'), '/post/abc-123');
  assert.equal(link.textContent, '<script>private note</script>');
  assert.equal(document.querySelector('#ct-local-tools script'), null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(KEY)).bookmarks,
    [{ path: '/post/abc-123', label: '<script>private note</script>' }]);
  submit(window, input);
  assert.match(document.getElementById('ct-local-tools-status').textContent, /already saved/);
  assert.equal(document.querySelectorAll('#ct-local-bookmarks a').length, 1);
  link.nextElementSibling.click();
  assert.equal(JSON.parse(window.localStorage.getItem(KEY)).bookmarks.length, 0);
});

test('unsafe stored bookmark URLs are rejected without rendering executable links', t => {
  const { document } = setup(t, { settings: state({ bookmarks: [{ path: 'javascript:alert(1)', label: 'Bad link' }] }) });
  assert.equal(document.querySelector('#ct-local-bookmarks a'), null);
  assert.match(document.getElementById('ct-local-tools-status').textContent, /Could not read/);
});

test('media-only detail posts can be saved without copying post content', t => {
  const { document, window } = setup(t, {
    html: '<article><img alt="Personal photo" src="/media/example.jpg"><button>Like</button></article>',
    url: 'https://tweet.app/post/media-123/?view=detail#comments',
    settings: state({ searches: ['cats'] }),
  });
  const input = document.getElementById('ct-local-bookmark-input');
  assert.equal(input.closest('form').querySelector('button').disabled, false);
  submit(window, input);
  const stored = JSON.parse(window.localStorage.getItem(KEY));
  assert.deepEqual(stored.bookmarks, [{ path: '/post/media-123', label: 'Post media-123' }]);
  assert.deepEqual(stored.searches, ['cats']);
  assert.equal(JSON.stringify(stored).includes('Personal photo'), false);
  assert.equal(document.querySelector('#ct-local-bookmarks a').textContent, 'Post media-123');
});

test('bookmark button updates when the tools open or browser history changes', t => {
  const { document, window } = setup(t, { html: post('a', 'Post body') });
  const input = document.getElementById('ct-local-bookmark-input');
  const button = input.closest('form').querySelector('button');
  assert.equal(button.disabled, true);
  window.history.pushState({}, '', '/post/abc-123');
  document.getElementById('ct-local-tools-toggle').click();
  assert.equal(button.disabled, false);
  window.history.replaceState({}, '', '/feed');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(button.disabled, true);
  submit(window, input);
  assert.equal(window.localStorage.getItem(KEY), null);
});

test('failed bookmark saves preserve existing entries and editable note', t => {
  const { document, window } = setup(t, {
    html: post('a', 'Post body'), url: 'https://tweet.app/post/new-123',
    settings: state({ bookmarks: [{ path: '/post/existing-123', label: 'Existing note' }] }),
    beforeInstall(window) { window.Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); }; },
  });
  const input = document.getElementById('ct-local-bookmark-input');
  input.value = 'New note';
  submit(window, input);
  assert.equal(input.value, 'New note');
  assert.match(document.getElementById('ct-local-tools-status').textContent, /Could not save/);
  assert.deepEqual([...document.querySelectorAll('#ct-local-bookmarks a')].map(link => link.getAttribute('href')), ['/post/existing-123']);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(KEY)).bookmarks, [{ path: '/post/existing-123', label: 'Existing note' }]);
});

test('overlong filters are rejected before any storage write or DOM collapse', t => {
  const { document, window } = setup(t, { html: post('a', 'spoilers') });
  const input = document.getElementById('ct-local-keywords');
  input.value = 'spoilers\n' + 'x'.repeat(81);
  document.getElementById('ct-local-filter-enabled').checked = true;
  submit(window, input);
  assert.equal(window.localStorage.getItem(KEY), null);
  assert.equal(document.querySelector('.ct-keyword-collapsed'), null);
  assert.match(document.getElementById('ct-local-tools-status').textContent, /80 characters/);
});

test('invalid form values identify and focus the field, then clear invalid state when edited', t => {
  for (const [id, invalidValue] of [
    ['ct-local-keywords', 'x'.repeat(81)],
    ['ct-local-search-input', '   '],
    ['ct-local-bookmark-input', 'x'.repeat(201)],
  ]) {
    const { document, window } = setup(t, {
      html: post('a', 'Post body'), url: 'https://tweet.app/post/current-post',
    });
    document.getElementById('ct-local-tools-toggle').click();
    const input = document.getElementById(id);
    input.value = invalidValue;
    submit(window, input);
    assert.equal(input.getAttribute('aria-invalid'), 'true', id);
    assert.equal(document.activeElement, input, id);
    assert.equal(input.value, invalidValue, 'Validation must preserve what the user typed');
    assert.equal(window.localStorage.getItem(KEY), null);
    input.value = 'Corrected text';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.notEqual(input.getAttribute('aria-invalid'), 'true', id);
  }
});

test('device models are prepared only by an explicit button click and failure preserves controls', async t => {
  let engine = 'native', preparations = 0, status = '';
  const { document, window, controller } = setup(t, { options: {
    getAutoTranslate: () => false, setAutoTranslate: () => {},
    getTranslationEngine: () => engine, setTranslationEngine: value => { engine = value; },
    deviceTranslationSupported: true,
    prepareDeviceTranslation: async language => { preparations++; assert.equal(language, 'ja'); status = 'Model unavailable'; return false; },
    getTranslationStatus: () => status,
  } });
  const select = document.getElementById('ct-local-translation-engine');
  select.value = 'device'; select.dispatchEvent(new window.Event('change'));
  assert.equal(engine, 'device'); assert.equal(preparations, 0);
  const button = document.getElementById('ct-local-translation-prepare');
  button.click(); assert.equal(preparations, 1); assert.equal(button.disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, false); assert.equal(button.textContent, 'Prepare model');
  controller.refreshTranslation();
  assert.equal(document.getElementById('ct-local-translation-status').textContent, 'Model unavailable');
});

test('unsupported device translation is explained and disabled without changing saved engine', t => {
  let engine = 'native';
  const { document } = setup(t, { options: {
    getAutoTranslate: () => false, setAutoTranslate: () => {},
    getTranslationEngine: () => engine, setTranslationEngine: value => { engine = value; },
    deviceTranslationSupported: false,
  } });
  assert.equal(document.querySelector('#ct-local-translation-engine option[value="device"]').disabled, true);
  assert.equal(document.getElementById('ct-local-translation-prepare').disabled, true);
  assert.equal(engine, 'native'); assert.match(document.getElementById('ct-local-tools').textContent, /Safari\/Stay/);
});

test('classic display toggle saves and restores without changing a draft or other local tools', t => {
  let enabled = true;
  const { document, window } = setup(t, { html:'<textarea id="native-draft">Keep my draft</textarea>', settings:state({searches:['saved search']}), options:{
    getClassicAppearance:()=>enabled,
    setClassicAppearance:next=>{enabled=next;}
  }});
  const input = document.getElementById('ct-local-classic-appearance');
  assert.equal(input.checked,true);
  input.click(); assert.equal(enabled,false); assert.equal(input.checked,false);
  assert.equal(document.getElementById('native-draft').value,'Keep my draft');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(KEY)).searches,['saved search']);
  enabled=true;
  document.getElementById('ct-local-tools-toggle').click();
  assert.equal(input.checked,true,'opening tools reflects another tab’s preference');
});

test('classic display toggle reports storage failure and rolls its checkbox back', t => {
  const {document} = setup(t,{options:{getClassicAppearance:()=>true,setClassicAppearance:()=>{throw new Error('blocked');}}});
  const input=document.getElementById('ct-local-classic-appearance');
  input.click();
  assert.equal(input.checked,true);
  assert.equal(document.getElementById('ct-local-tools-status').dataset.error,'true');
  assert.match(document.getElementById('ct-local-tools-status').textContent,/Could not save/);
});
