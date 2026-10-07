const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/news.js'), 'utf8');
const feed = 'https://news.yahoo.co.jp/rss/categories/domestic.xml';
const xml = '<?xml version="1.0"?><rss version="2.0"><channel><item><title>News</title><link>https://news.yahoo.co.jp/articles/example</link></item></channel></rss>';
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  let serial = 0;
  const timers = new Map();
  window.setTimeout = callback => { timers.set(++serial, callback); return serial; };
  window.clearTimeout = id => timers.delete(id);
  if (options.gm) window.GM_xmlhttpRequest = options.gm;
  if (options.modernGM) window.GM = options.modernGM;
  if (options.fetch) window.fetch = options.fetch;
  window.eval(`const CT_LOCALE='ja';\n${source}\nwindow.transport={request:ctRequestNews,parse:ctParseJapaneseNews};`);
  t.after(() => window.close());
  return { window, timers, ...window.transport, expire() {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  } };
}

test('explicit text requests accept the legacy Stay string response with null responseText', async t => {
  let details;
  const f = setup(t, { gm(options) {
    details = options;
    options.onload({ status: 200, responseText: null, response: xml, finalUrl: options.url });
  } });
  assert.equal(await f.request(feed), xml);
  assert.equal(details.responseType, 'text');
  assert.equal(details.anonymous, true);
  assert.equal(details.method, 'GET');
  assert.equal(details.redirect, 'error');
  assert.equal(details.headers.Authorization, undefined);
  assert.equal(details.headers.Cookie, undefined);
  assert.equal(f.timers.size, 0);
});

test('Promise GM text responses work through response without changing callback precedence', async t => {
  const f = setup(t, { modernGM: { marker: true, xmlHttpRequest(options) {
    assert.equal(this.marker, true);
    return Promise.resolve({ status: 200, response: xml, responseURL: options.url });
  } } });
  assert.equal(await f.request(feed), xml);
  assert.equal(f.timers.size, 0);
});

test('an inaccessible responseText getter safely falls back to its string response', async t => {
  const response = { status: 200, response: xml, responseURL: feed };
  Object.defineProperty(response, 'responseText', { get() { throw new Error('InvalidStateError'); } });
  const f = setup(t, { gm(options) { queueMicrotask(() => options.onload(response)); } });
  assert.equal(await f.request(feed), xml);
  assert.equal(f.timers.size, 0);
});

test('status-zero and incomplete Promise receipts wait for the real callback without failing early', async t => {
  for (const receipt of [
    { status: 0, readyState: 1, responseText: '' },
    { status: 0, readyState: 4 },
    { status: 200, readyState: 2, responseText: '' },
    { responseText: '' }
  ]) {
    let details, settled = false;
    const f = setup(t, { modernGM: { xmlHttpRequest(options) {
      details = options; return Promise.resolve(receipt);
    } } });
    const request = f.request(feed).then(value => { settled = true; return value; });
    await flush();
    assert.equal(settled, false);
    assert.equal(f.timers.size, 1);
    details.onload({ status: 200, responseText: xml, responseURL: feed });
    assert.equal(await request, xml);
    assert.equal(f.timers.size, 0);
  }
});

test('an unfinished Promise receipt times out and aborts once while a late callback cannot recover it', async t => {
  let details, aborts = 0;
  const f = setup(t, { modernGM: { xmlHttpRequest(options) {
    details = options;
    return Object.assign(Promise.resolve({ status: 0, responseText: '' }), { abort() { aborts++; } });
  } } });
  const request = f.request(feed);
  await flush(); f.expire();
  assert.equal(await request, null);
  assert.equal(aborts, 1);
  details.onload({ status: 200, responseText: xml, responseURL: feed });
  await flush(); assert.equal(aborts, 1); assert.equal(f.timers.size, 0);
});

test('canonical finalUrl and responseURL values accept equivalent HTTPS feed URLs', async t => {
  for (const field of ['finalUrl', 'responseURL']) {
    const f = setup(t, { gm(options) {
      options.onload({ status: 200, responseText: xml, [field]: 'https://NEWS.yahoo.co.jp:443/rss/categories/domestic.xml' });
    } });
    assert.equal(await f.request(feed), xml);
  }
});

test('a redirected responseURL, conflicting URL aliases or a different configured feed is rejected', async t => {
  for (const urls of [
    { responseURL: 'https://evil.test/rss' },
    { finalUrl: feed, responseURL: 'https://evil.test/rss' },
    { responseURL: 'https://news.yahoo.co.jp/rss/categories/sports.xml' },
    { responseURL: feed + '#fragment' },
    { responseURL: 'https://user:secret@news.yahoo.co.jp/rss/categories/domestic.xml' }
  ]) {
    const f = setup(t, { modernGM: { xmlHttpRequest() {
      return Promise.resolve({ status: 200, responseText: xml, ...urls });
    } } });
    assert.equal(await f.request(feed), null);
    assert.equal(f.timers.size, 0);
  }
});

test('fallback responses retain the text-size limit and do not coerce arbitrary payloads into XML', async t => {
  for (const response of [
    { status: 200, response: 'x'.repeat(1024 * 1024 + 1) },
    { status: 200, response: { text: xml } },
    { status: 200, responseXML: { documentElement: { outerHTML: xml } } },
    { status: 403, response: xml },
    { status: 200, responseText: '', response: xml }
  ]) {
    const f = setup(t, { gm(options) { options.onload(response); } });
    const value = await f.request(feed);
    assert.equal(value, response.responseText === '' ? '' : null);
    assert.equal(f.parse(value).length, 0);
    assert.equal(f.timers.size, 0);
  }
});

test('throwing response fields finish safely and malformed textual feeds do not produce headlines', async t => {
  const response = { status: 200, response: xml };
  Object.defineProperty(response, 'responseURL', { get() { throw new Error('Broken bridge'); } });
  const f = setup(t, { gm(options) { queueMicrotask(() => options.onload(response)); } });
  assert.equal(await f.request(feed), null);
  assert.equal(f.timers.size, 0);
  for (const payload of ['<html>Denied</html>', '<rss><channel>', '<!DOCTYPE rss><rss><channel/></rss>']) {
    assert.equal(f.parse(payload).length, 0);
  }
});

test('a successful callback remains authoritative over later failed Promise completion', async t => {
  let complete;
  const f = setup(t, { modernGM: { xmlHttpRequest(options) {
    options.onload({ status: 200, response: xml, responseURL: options.url });
    return new Promise(resolve => { complete = resolve; });
  } } });
  assert.equal(await f.request(feed), xml);
  complete({ status: 403, response: 'Denied' }); await flush();
  assert.equal(f.timers.size, 0);
});

test('Safari loadend-only completion supplies final text and clears the request deadline', async t => {
  const f = setup(t, { gm(options) {
    queueMicrotask(() => options.onloadend({ status: 200, readyState: 4, response: xml, responseURL: options.url }));
  } });
  assert.equal(await f.request(feed), xml);
  assert.equal(f.timers.size, 0);
});

test('Stay loadend registration permits its bridge to release each request listener', async t => {
  // Stay's public bridge registers a window message listener in __xhr and
  // removes it inside the details.onloadend branch. Keep this lifecycle
  // contract when success, errors or deadline aborts settle the request.
  // https://github.com/shenruisi/Stay/blob/9b78d761d307234d4ed5ea72ac423804ea0c4301/Stay/tampermonkey/lib/gm-api-create.js#L1059-L1116
  const listeners = new Set();
  let mode = 'success';
  const f = setup(t, { gm(options) {
    const listener = {};
    listeners.add(listener);
    const end = response => {
      if (options.onloadend) {
        options.onloadend(response);
        listeners.delete(listener);
      }
    };
    if (mode === 'success') queueMicrotask(() => {
      options.onload({ status: 200, responseText: xml, responseURL: options.url });
      end({ status: 200, responseText: xml, responseURL: options.url });
    });
    if (mode === 'failure') queueMicrotask(() => {
      options.onerror({ status: 0 });
      end({ status: 0, responseText: '' });
    });
    return { abort() { options.onabort({ status: 0 }); end({ status: 0, responseText: '' }); } };
  } });
  for (mode of ['success', 'failure', 'timeout']) {
    const result = f.request(feed);
    if (mode === 'timeout') f.expire();
    assert.equal(await result, mode === 'success' ? xml : null);
    assert.equal(listeners.size, 0, `${mode} must release the Safari bridge listener`);
    assert.equal(f.timers.size, 0);
  }
});

test('a failed or timed-out request cannot be revived by a later successful loadend', async t => {
  for (const completion of ['error', 'deadline']) {
    let details;
    const f = setup(t, { gm(options) { details = options; return { abort() {} }; } });
    const result = f.request(feed);
    if (completion === 'error') details.onerror({ status: 0 });
    else f.expire();
    assert.equal(await result, null);
    details.onloadend({ status: 200, readyState: 4, responseText: xml, responseURL: feed });
    await flush();
    assert.equal(f.timers.size, 0);
  }
});

test('unknown URLs never use either transport and canonical fetch URLs preserve the anonymous fallback', async t => {
  let details, calls = 0;
  const f = setup(t, { fetch(url, options) {
    calls++; details = options;
    return Promise.resolve({ ok: true, url: 'https://NEWS.yahoo.co.jp:443/rss/categories/domestic.xml', text: async () => xml });
  } });
  assert.equal(await f.request('https://evil.test/rss'), null);
  assert.equal(calls, 0);
  assert.equal(await f.request(feed), xml);
  assert.equal(details.credentials, 'omit');
  assert.equal(details.referrerPolicy, 'no-referrer');
  assert.equal(details.redirect, 'error');
  assert.equal(f.timers.size, 0);
});
