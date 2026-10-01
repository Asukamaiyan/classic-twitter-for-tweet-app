const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/motion.js'), 'utf8');
const favorite = '<button data-testid="tweet-like-action" aria-label="Like, 1 like" class="text-tl-app-text-muted"><svg class="ct-star" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9Z"></path></svg><span>1</span></button>';

function harness(t, options = {}) {
  const dom = new JSDOM(`<!doctype html><head></head><body><main class="ct-classic-timeline">${favorite}</main><div role="dialog"><textarea>Keep my draft</textarea></div></body>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;
  let hidden = false;
  let nextTimer = 0;
  const timers = new Map();
  const animations = [];
  const listeners = new Set();
  const media = { matches: options.reduced === true };
  let queries = 0;
  const bindings = { visibilitychange: 0, pagehide: 0, pageshow: 0 };
  const listenDocument = document.addEventListener.bind(document);
  const listenWindow = window.addEventListener.bind(window);
  document.addEventListener = (type, fn, opts) => { if (type === 'visibilitychange') bindings[type]++; listenDocument(type, fn, opts); };
  window.addEventListener = (type, fn, opts) => { if (type === 'pagehide' || type === 'pageshow') bindings[type]++; listenWindow(type, fn, opts); };
  if (options.legacyMedia) media.addListener = fn => listeners.add(fn);
  else media.addEventListener = (type, fn) => { assert.equal(type, 'change'); listeners.add(fn); };
  window.matchMedia = query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); queries++; return media; };
  Object.defineProperty(document, 'hidden', { get: () => hidden });
  window.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.Element.prototype.animate = function (frames, settings) {
    let resolve;
    let reject;
    const job = {
      target: this, frames, settings, cancelled: false,
      finished: new Promise((ok, fail) => { resolve = ok; reject = fail; }),
      cancel() { this.cancelled = true; reject(new Error('Animation cancelled')); },
      finish() { resolve(); }
    };
    animations.push(job);
    return job;
  };
  window.eval(`${source}\nwindow.qa = { patchClassicMotion, ctAnimateFavorite, active: () => ctClassicMotion.running.size, observing: () => Boolean(ctClassicMotion.connectionObserver) };`);
  const button = () => document.querySelector('[data-testid="tweet-like-action"]');
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  return {
    window, document, qa: window.qa, animations, timers, bindings, listeners, button,
    get queries() { return queries; },
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    setHidden(value) { hidden = value; document.dispatchEvent(new window.Event('visibilitychange')); },
    reduce(value) { media.matches = value; for (const fn of listeners) fn({ matches: value }); },
    tick() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } }
  };
}

test('a native false-to-true favorite transition animates only its owned star', async t => {
  const f = harness(t);
  const button = f.button();
  let clicks = 0;
  button.addEventListener('click', () => clicks++);
  const before = button.outerHTML;
  const modalBefore = f.document.querySelector('[role="dialog"]').outerHTML;
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(button, false);
  f.qa.ctAnimateFavorite(button, true);
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].target, button.querySelector('.ct-star'));
  assert.equal(f.animations[0].settings.duration, 280);
  assert.equal(f.animations[0].settings.fill, 'none');
  assert.match(f.animations[0].frames[1].transform, /scale\(1\.22\)/);
  assert.equal(button.outerHTML, before, 'motion cannot rewrite the native label, count or star');
  assert.equal(f.document.querySelector('[role="dialog"]').outerHTML, modalBefore);
  assert.equal(clicks, 0, 'motion cannot send a native favorite request');
  button.click();
  assert.equal(clicks, 1, 'the original click handler remains usable');
  f.animations[0].finish();
  await f.flush();
  assert.equal(f.qa.active(), 0);
  assert.equal(f.qa.observing(), false);
  assert.equal(f.timers.size, 0);
  assert.equal(button.querySelector('.ct-star').getAttribute('style'), null);
});

test('initial selected favorites, React replacements and repeated scans stay still', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), true);
  f.qa.ctAnimateFavorite(f.button(), true);
  const replacement = f.button().cloneNode(true);
  f.button().replaceWith(replacement);
  f.qa.ctAnimateFavorite(replacement, true);
  for (let i = 0; i < 10; i++) { f.qa.patchClassicMotion(replacement); f.qa.ctAnimateFavorite(replacement, true); }
  assert.equal(f.animations.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.qa.observing(), false);
});

test('moving a reused native button into another article establishes a new baseline', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  const first = f.document.createElement('article');
  const second = f.document.createElement('article');
  f.document.querySelector('main').append(first, second);
  first.append(f.button());
  f.qa.ctAnimateFavorite(f.button(), false);
  second.append(f.button());
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 0);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
  first.append(f.button());
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations[0].cancelled, true, 'motion from the old article is cancelled');
});

test('a React card reused for another verified post cannot animate an initial favorite', t => {
  const f = harness(t);
  const article = f.document.createElement('article');
  article.innerHTML = '<a href="/post/one"><time>10:00</time></a>';
  f.document.querySelector('main').append(article);
  article.append(f.button());
  f.window.articleId = ownArticle => ownArticle.querySelector('a:has(time)')?.getAttribute('href') || null;
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  article.querySelector('a').href = '/post/two';
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 0);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
});

test('clicking without a native state change or unfavoriting does not animate', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.button().click();
  f.qa.ctAnimateFavorite(f.button(), false);
  assert.equal(f.animations.length, 0, 'a rejected or unchanged click stays still');
  f.qa.ctAnimateFavorite(f.button(), true);
  f.qa.ctAnimateFavorite(f.button(), false);
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.qa.active(), 0);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 2, 'the next successful state transition can react');
});

test('hidden tabs cancel active motion and returning establishes a fresh baseline', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  f.setHidden(true);
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.qa.active(), 0);
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-paused'), true);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
  f.setHidden(false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1, 'a hidden-tab action is not replayed on return');
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-paused'), false);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 2);
});

test('live reduced-motion changes cancel motion and cannot replay on re-enable', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  f.reduce(true);
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.qa.active(), 0);
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-paused'), true);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  f.reduce(false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 2);
});

test('reduced motion from startup and legacy Safari media listeners are supported', t => {
  const f = harness(t, { reduced: true, legacyMedia: true });
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 0);
  assert.equal(f.listeners.size, 1);
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-paused'), true);
  f.reduce(false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 0);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
});

test('classic OFF cancels and cleans active jobs while preserving native markup', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  const before = f.button().outerHTML;
  f.qa.patchClassicMotion(f.document, false);
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.qa.active(), 0);
  assert.equal(f.qa.observing(), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-enabled'), false);
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-paused'), false, 'OFF must release the transition overrides as well as active animations');
  assert.equal(f.button().outerHTML, before);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
  f.qa.patchClassicMotion(f.document, true);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1, 'turning the look on cannot replay an old favorite');
});

test('classic OFF releases native control transitions and never reinstates paused styling on backgrounding', t => {
  const f = harness(t);
  const style = f.document.createElement('style');
  style.textContent = '#ct-local-tools button { transition:color 240ms ease-in; }';
  f.document.head.append(style);
  const tools = f.document.createElement('div'); tools.id = 'ct-local-tools'; tools.innerHTML = '<button>Tools</button>';
  f.document.body.append(tools);
  f.qa.patchClassicMotion(); f.setHidden(true);
  assert.equal(f.window.getComputedStyle(tools.firstChild).transition, 'none');
  f.qa.patchClassicMotion(f.document, false);
  assert.equal(f.window.getComputedStyle(tools.firstChild).transition, 'color 240ms ease-in');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  f.window.dispatchEvent(new f.window.Event('pageshow'));
  assert.equal(f.document.documentElement.classList.contains('ct-classic-motion-paused'), false);
  assert.equal(f.window.getComputedStyle(tools.firstChild).transition, 'color 240ms ease-in');
});

test('removing a button or replacing its star immediately cancels that animation', async t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  const original = f.button();
  original.remove();
  await f.flush();
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.qa.active(), 0);
  f.document.querySelector('main').append(original);
  f.qa.ctAnimateFavorite(original, false);
  f.qa.ctAnimateFavorite(original, true);
  original.querySelector('.ct-star').replaceWith(original.querySelector('.ct-star').cloneNode(true));
  await f.flush();
  assert.equal(f.animations[1].cancelled, true);
  assert.equal(f.qa.active(), 0);
  assert.equal(f.qa.observing(), false);
});

test('normal initial pageshow preserves the favorite baseline and active motion', async t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: false }));
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1, 'the first native state change still reacts after initial pageshow');
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: false }));
  await f.flush();
  assert.equal(f.animations[0].cancelled, false);
  assert.equal(f.qa.active(), 1, 'a repeated normal pageshow does not interrupt motion');
});

test('pagehide cancels and pageshow restores without replaying the selected state', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.animations[0].cancelled, true);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  f.window.dispatchEvent(new f.window.Event('pageshow'));
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.animations.length, 1);
});

test('repeated patches install one scoped stylesheet and one lifecycle listener set', t => {
  const f = harness(t);
  for (let i = 0; i < 20; i++) f.qa.patchClassicMotion(f.button());
  assert.equal(f.document.querySelectorAll('#ct-classic-motion-style').length, 1);
  assert.deepEqual(f.bindings, { visibilitychange: 1, pagehide: 1, pageshow: 1 });
  assert.equal(f.queries, 1);
  assert.equal(f.listeners.size, 1);
  const css = f.document.getElementById('ct-classic-motion-style').textContent;
  assert.match(css, /color 120ms/);
  assert.match(css, /background-color 120ms/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /ct-classic-motion-paused #ct-local-tools-panel/);
  assert.doesNotMatch(css, /\[role="dialog"\]|\bbody\b|\binput\b|\btextarea\b|keyframes/);
  assert.equal(f.document.querySelector('[role="dialog"] textarea').value, 'Keep my draft');
});

test('a late finish from a cancelled animation cannot clear a later one', async t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  await f.flush();
  assert.equal(f.qa.active(), 1);
  assert.equal(f.animations[1].cancelled, false);
  assert.equal(f.timers.size, 1);
  f.animations[1].finish();
  await f.flush();
  assert.equal(f.qa.active(), 0);
});

test('unsupported Web Animations and unrelated controls remain functional', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.button().querySelector('.ct-star').animate = undefined;
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  const unrelated = f.document.createElement('button');
  unrelated.innerHTML = '<svg class="ct-star"></svg>';
  f.document.body.append(unrelated);
  f.qa.ctAnimateFavorite(unrelated, false);
  f.qa.ctAnimateFavorite(unrelated, true);
  assert.equal(f.animations.length, 0);
  assert.equal(f.qa.active(), 0);
  f.button().querySelector('.ct-star').animate = () => { throw new Error('Not available'); };
  f.qa.ctAnimateFavorite(f.button(), false);
  assert.doesNotThrow(() => f.qa.ctAnimateFavorite(f.button(), true));
});

test('bounded cleanup releases completed favorite jobs without timers or observers', t => {
  const f = harness(t);
  f.qa.patchClassicMotion();
  f.qa.ctAnimateFavorite(f.button(), false);
  f.qa.ctAnimateFavorite(f.button(), true);
  assert.equal(f.qa.active(), 1);
  assert.equal(f.qa.observing(), true);
  assert.equal([...f.timers.values()][0].delay, 320);
  f.tick();
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(f.qa.active(), 0);
  assert.equal(f.qa.observing(), false);
  assert.equal(f.timers.size, 0);
});
