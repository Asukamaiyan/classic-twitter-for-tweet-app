const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const distributions = require('../scripts/distributions.cjs');
const root = path.join(__dirname, '..');
const settle = () => new Promise(resolve => setTimeout(resolve, 180));

for (const { file } of distributions) {
  test(`${file}: old enabled setting cannot fetch or add cards, and original links and media stay usable`, async t => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body><main>
      <article id="linked"><div class="flex-1 min-w-0">
        <div class="flex items-center"><button class="font-bold truncate">Alice</button><span>·</span><span title="2026-10-10T00:00:00Z">1m</span></div>
        <p id="original" class="tl-user-text whitespace-pre-wrap break-words">My original <a id="original-link" href="https://example.org/article?topic=web#section" target="_blank" rel="noopener noreferrer">https://example.org/article?topic=web#section</a></p>
        <blockquote id="quote"><p class="whitespace-pre-wrap break-words">Quoted <a id="quote-link" href="https://example.net/quote">quoted URL</a></p></blockquote>
        <a id="native-card" href="https://example.org/native">Native site link</a>
        <img id="photo" src="https://media.tweet.app/photo.jpg" alt="Native photo">
        <video id="video" controls src="https://media.tweet.app/video.mp4" poster="https://media.tweet.app/poster.jpg"></video>
      </div></article>
      <article id="plain"><p class="whitespace-pre-wrap break-words">Ordinary post</p></article>
      <textarea id="public-tweet-input">My draft https://example.com/draft</textarea>
      </main></body></html>`, {
      url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom, { document } = window;
    t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
    const requests = [], errors = [];
    window.addEventListener('error', event => errors.push(event.error || event.message));
    window.console.debug = (...args) => errors.push(args);
    window.console.log = () => {};
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(document, 'readyState', { get: () => 'complete' });
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 20, y: 100, top: 100, left: 20, right: 520, bottom: 300, width: 500, height: 200 });
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(target) { window.queueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }])); }
      unobserve() {}
      disconnect() {}
    };
    window.fetch = async input => { requests.push(String(input?.url || input)); return { ok: false, status: 401 }; };
    const gm = details => {
      requests.push(details.url);
      window.queueMicrotask(() => details.onerror?.({ status: 0 }));
      return { abort() {} };
    };
    window.GM_xmlhttpRequest = gm; window.GM = { xmlHttpRequest: gm };
    window.XMLHttpRequest.prototype.open = function (method, url) { this.fixtureURL = String(url); };
    window.XMLHttpRequest.prototype.send = function () { requests.push(this.fixtureURL); };
    const preference = 'ct-link-previews-enabled-v1';
    window.localStorage.setItem(preference, 'true');
    const ids = ['original', 'original-link', 'quote', 'quote-link', 'native-card', 'photo', 'video'];
    const original = new Map(ids.map(id => [id, document.getElementById(id)]));
    const text = original.get('original').textContent;
    const quote = original.get('quote').innerHTML;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    window.eval(source);
    await settle();
    assert.ok(document.getElementById('ct-local-tools'), 'the real distribution completed startup');
    document.getElementById('ct-local-tools-toggle').click();
    assert.equal(document.getElementById('ct-local-link-previews'), null);
    document.getElementById('ct-local-links-only').click();
    assert.equal(document.getElementById('plain').classList.contains('ct-links-filter-hidden'), true);
    assert.equal(document.getElementById('linked').classList.contains('ct-links-filter-hidden'), false);
    document.getElementById('ct-local-links-only').click();
    assert.equal(document.querySelector('.ct-links-filter-hidden'), null);
    window.dispatchEvent(new window.StorageEvent('storage', { key: preference, newValue: 'true' }));
    window.history.pushState({}, '', '/post/example');
    await settle();
    window.history.replaceState({}, '', '/feed');
    hidden = true; document.dispatchEvent(new window.Event('visibilitychange'));
    hidden = false; document.dispatchEvent(new window.Event('visibilitychange'));
    window.dispatchEvent(new window.Event('pagehide'));
    window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    await settle();
    for (const [id, node] of original) assert.equal(document.getElementById(id), node, `${id} keeps its native node`);
    assert.equal(original.get('original').textContent, text);
    assert.equal(original.get('quote').innerHTML, quote);
    assert.equal(document.getElementById('public-tweet-input').value, 'My draft https://example.com/draft');
    assert.equal(original.get('photo').getAttribute('src'), 'https://media.tweet.app/photo.jpg');
    assert.equal(original.get('video').getAttribute('src'), 'https://media.tweet.app/video.mp4');
    assert.equal(original.get('video').getAttribute('poster'), 'https://media.tweet.app/poster.jpg');
    for (const id of ['original-link', 'quote-link', 'native-card']) {
      const link = original.get(id);
      link.focus(); assert.equal(document.activeElement, link);
      assert.equal(link.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), true);
      let reachedNativeHandler = false;
      link.addEventListener('click', event => { reachedNativeHandler = !event.defaultPrevented; event.preventDefault(); }, { once: true });
      link.click(); assert.equal(reachedNativeHandler, true);
    }
    assert.equal(document.querySelector('.ct-link-preview, [data-ct-link-preview]'), null);
    assert.equal(window.localStorage.getItem(preference), 'true', 'unused preferences are preserved');
    assert.deepEqual(requests, [], 'visible links, old settings and lifecycle scans cause no metadata or destination requests');
    assert.deepEqual(errors, []);
  });
}
