const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '../src/news.js'), 'utf8');
const image = 'https://news-pctr.c.yimg.jp/t/news-topics/images/topic/example.jpg';
const articleURL = 'https://news.yahoo.co.jp/articles/example';
const feedURL = 'https://news.yahoo.co.jp/rss/categories/domestic.xml';
const item = (title = '日本のニュース', url = articleURL, img = image) => `<item><title>${title}</title><link>${url}</link><pubDate>Sun, 27 Sep 2026 12:00:00 +0900</pubDate><image>${img}</image></item>`;
const rss = items => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Yahoo!ニュース</title>${items}</channel></rss>`;
function layout(active = 'News', extra = '') {
  return `<main><div class="w-full min-w-0 flex flex-col"><div class="sticky"><div class="overflow-x-auto">${['For you', 'Following', 'News', 'Sports', 'Entertainment', 'Technology'].map(label => `<button class="rounded-full whitespace-nowrap ${active === label ? 'bg-sky-500 text-white' : ''}">${label}</button>`).join('')}</div></div>${extra}<div id="native-news"><a id="native-story" href="https://example.com">Original world news</a></div></div></main>`;
}
function fakeClock(window) {
  let now = Date.parse('2026-09-30T03:00:00Z');
  let serial = 0;
  let hidden = false;
  const timers = new Map();
  window.Date.now = () => now;
  window.setTimeout = (callback, delay = 0) => {
    const id = ++serial;
    timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  return {
    timers,
    jump(milliseconds) { now += milliseconds; },
    async tick(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = Math.max(now, next[1].at);
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
    setHidden(value) {
      hidden = value;
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    }
  };
}
function setup(t, options = {}) {
  const dom = new JSDOM(`<html><head></head><body>${options.html ?? layout()}</body></html>`, {
    url: options.url || 'https://tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const window = dom.window;
  const clock = options.clock ? fakeClock(window) : null;
  if (options.region) window.localStorage.setItem('ct-news-region-v1', options.region);
  if (options.cache) window.sessionStorage.setItem('ct-japanese-news-cache-v1', options.cache);
  if (options.sources !== undefined) window.localStorage.setItem('ct-news-sources-v1', options.sources);
  if (options.gm) window.GM_xmlhttpRequest = options.gm;
  if (options.modernGM) window.GM = options.modernGM;
  if (options.lexicalGM) window.fixtureGM = options.lexicalGM;
  if (options.fetch) window.fetch = options.fetch;
  // Keep the original Yahoo transport/lifecycle cases scoped to one publisher;
  // multisource cases below use the actual full registry with allFeeds:true.
  window.eval(`const CT_LOCALE = ${JSON.stringify(options.locale || 'ja')};\nconst CT_PLATFORM = ${JSON.stringify(options.platform || 'chrome')};\n${options.lexicalGM ? 'const GM = window.fixtureGM;' : ''}\n${source}\n${options.allFeeds ? '' : "ctNewsFeedList = topic => (ctNewsFeeds[topic] || []).filter(feed => feed.publisher === 'yahoo');"}\nwindow.news = { patch: patchJapaneseNews, parse: ctParseJapaneseNews, url: ctNewsURL, load: ctLoadJapaneseNews, request: ctRequestNews, state: ctNewsState, targets: ctNewsTargets, feeds: ctNewsFeeds, merge: ctNewsMergeArticles };`);
  const news = window.news;
  news.state.timeout = 30;
  t.after(() => window.close());
  return { window, document: window.document, news, clock };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const gmSuccess = xml => options => { queueMicrotask(() => options.onload({ status: 200, responseText: xml, finalUrl: options.url })); };
const nhkURL = 'https://news.web.nhk/newsweb/na/nd-20261005example';
const nikkanURL = 'https://www.nikkansports.com/sports/news/202610050001765.html';
const nikkanImage = 'https://www.nikkansports.com/sports/athletics/news/img/202610050001765-w500_0.jpg';
const itmediaURL = 'https://www.itmedia.co.jp/news/article/2610/05/2000002016/';
const atom = (url = nikkanURL, img = nikkanImage, title = 'スポーツのニュース') => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>${title}</title><link rel="alternate" type="text/html" href="${url}"/><published>2026-10-05T20:51:20+09:00</published><link rel="enclosure" type="image/jpeg" href="${img}"/><content type="html">&lt;img src="https://evil.test/track"&gt;</content></entry></feed>`;
function select(document, label) {
  for (const button of document.querySelectorAll('.sticky button')) {
    button.classList.toggle('bg-sky-500', button.textContent === label);
    button.classList.toggle('text-white', button.textContent === label);
  }
}

test('current NHK and ITmedia RSS preserve publisher, dates and image absence', t => {
  const { news } = setup(t, { allFeeds: true });
  for (const [publisher, url, name] of [['nhk', nhkURL, 'NHK NEWS WEB'], ['itmedia', itmediaURL, 'ITmedia NEWS']]) {
    const articles = news.parse(rss(item('Home Like News', url, '')).replace('</item>', '<description>&lt;img src="https://evil.test/tracker"&gt;</description></item>'), publisher);
    assert.equal(articles.length, 1);
    assert.equal(articles[0].source, name);
    assert.equal(articles[0].image, '');
    assert.equal(articles[0].url, url);
    assert.equal(articles[0].publishedAt, '2026-09-27T03:00:00.000Z');
  }
});

test('Nikkan Atom reads official alternate link, published date and image enclosure', t => {
  const { news } = setup(t, { allFeeds: true });
  const [article] = news.parse(atom(), 'nikkan');
  assert.equal(article.source, '日刊スポーツ');
  assert.equal(article.url, nikkanURL);
  assert.equal(article.image, nikkanImage);
  assert.equal(article.publishedAt, '2026-10-05T11:51:20.000Z');
  const entertainment = news.parse(atom(nikkanURL.replace('/sports/', '/entertainment/'), nikkanImage.replace('/sports/athletics/', '/entertainment/')), 'nikkan');
  assert.equal(entertainment.length, 1);
  assert.match(entertainment[0].image, /entertainment\/news\/img/);
});

test('publisher feeds cannot impersonate other sources or inject executable markup', t => {
  const { news } = setup(t, { allFeeds: true });
  assert.deepEqual(news.parse(rss(item()), 'nhk').length, 0);
  assert.equal(news.parse(atom().replace('http://www.w3.org/2005/Atom', 'https://evil.test/atom'), 'nikkan').length, 0);
  assert.equal(news.parse(atom(), 'unknown').length, 0);
  const [article] = news.parse(atom(nikkanURL, image, '&lt;img src=x onerror=alert(1)&gt;'), 'nikkan');
  assert.equal(article.title, '<img src=x onerror=alert(1)>');
  assert.equal(article.image, '', 'a Nikkan entry must not borrow another publisher image');
  assert.equal(news.parse(atom('https://www.nikkansports.com.evil.test/sports/news/123.html'), 'nikkan').length, 0);
});

test('new feed and article URLs are restricted to their verified public locations', t => {
  const { news } = setup(t, { allFeeds: true });
  for (const feeds of Object.values(news.feeds)) for (const feed of feeds) assert.equal(news.url(feed.url, 'feed'), feed.url);
  for (const url of [nhkURL, nikkanURL, itmediaURL, 'https://www.itmedia.co.jp/news/articles/2610/05/news123.html']) assert.equal(news.url(url), url);
  for (const url of ['https://news.web.nhk/login', 'https://rss.itmedia.co.jp/rss/2.0/unknown.xml', 'https://www.nikkansports.com/sports/news/123.html']) assert.equal(news.url(url, 'feed'), null);
  for (const url of ['https://news.web.nhk.evil.test/newsweb/na/nd-example', 'http://news.web.nhk/newsweb/na/nd-example', 'https://user:pass@www.itmedia.co.jp/news/article/x', 'https://www.nikkansports.com/login', 'https://www.itmedia.co.jp/login']) assert.equal(news.url(url), null);
  assert.equal(news.url(nikkanImage, 'image'), nikkanImage);
  assert.equal(news.url(nikkanImage.replace('/news/img/', '/private/'), 'image'), null);
});

test('a fast NHK result displays before a hanging Yahoo read times out', async t => {
  const calls = [];
  const { news, document, clock } = setup(t, { allFeeds: true, clock: true, gm: options => {
    calls.push(options);
    if (options.url.includes('news.web.nhk')) gmSuccess(rss(item('NHK ready', nhkURL, '')))(options);
    return { abort() {} };
  } });
  news.patch(); await flush();
  assert.equal(calls.length, 2);
  assert.equal(news.state.pending.size, 1);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'NHK ready');
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), true);
  assert.match(document.querySelector('.ct-news-status').textContent, /他の配信元を読み込み中/);
  await clock.tick(news.state.timeout);
  assert.equal(news.state.pending.size, 0);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'NHK ready');
  assert.equal(document.querySelector('[data-ct-news-action="retry"]').hidden, false);
  assert.match(document.querySelector('.ct-news-status').textContent, /一部取得できません/);
  assert.equal(clock.timers.size, 1);
});

test('completed feeds share ten headline slots fairly and sort the chosen articles by time', async t => {
  let calls = 0;
  const { news, document } = setup(t, { allFeeds: true, gm: options => {
    calls++;
    const yahoo = options.url.includes('yahoo');
    const entries = Array.from({ length: 10 }, (_, i) => item((yahoo ? 'Yahoo ' : 'NHK ') + i,
      yahoo ? articleURL + i : nhkURL + i, yahoo ? image : '')).join('');
    gmSuccess(rss(entries))(options);
  } });
  news.patch(); await flush();
  assert.equal(calls, 2);
  const articles = news.state.cache.get('nation').articles;
  assert.equal(articles.length, 10);
  assert.equal(articles.filter(a => a.source === 'Yahoo!ニュース').length, 5);
  assert.equal(articles.filter(a => a.source === 'NHK NEWS WEB').length, 5);
  assert.equal(document.querySelectorAll('.ct-news-article').length, 10);
  assert.equal(document.querySelector('[data-ct-news-action="retry"]').hidden, true);
  const mixed = news.merge([[articles[0], { ...articles[1], publishedAt: '2026-10-05T12:00:00Z' }], [articles[0]]]);
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].publishedAt, '2026-10-05T12:00:00Z');
});

test('partial failure Retry refetches once and restores both publishers without changing native content', async t => {
  let calls = 0, failYahoo = true;
  const { news, document } = setup(t, { allFeeds: true, gm: options => {
    calls++;
    if (failYahoo && options.url.includes('yahoo')) queueMicrotask(() => options.onerror());
    else gmSuccess(rss(item(options.url.includes('yahoo') ? 'Yahoo recovered' : 'NHK works', options.url.includes('yahoo') ? articleURL : nhkURL, '')))(options);
  } });
  const native = document.getElementById('native-news');
  news.patch(); await flush();
  assert.equal(calls, 2);
  assert.equal(document.querySelectorAll('.ct-news-article').length, 1);
  failYahoo = false;
  const retry = document.querySelector('[data-ct-news-action="retry"]');
  retry.click(); retry.click(); await flush();
  assert.equal(calls, 4);
  assert.equal(document.querySelectorAll('.ct-news-article').length, 2);
  assert.equal(retry.hidden, true);
  document.querySelector('[data-ct-news-region="world"]').click();
  assert.equal(document.getElementById('native-news'), native);
  assert.equal(native.classList.contains('ct-news-native-hidden'), false);
});

test('both failing publishers restore World and retry only after a shared backoff', async t => {
  let calls = 0;
  const { news, document, clock } = setup(t, { allFeeds: true, clock: true, gm: options => {
    calls++; queueMicrotask(() => options.onerror());
  } });
  news.patch(); await flush();
  assert.equal(calls, 2);
  assert.equal(document.querySelectorAll('.ct-news-article').length, 0);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  news.patch(); news.patch(); await flush(); assert.equal(calls, 2);
  await clock.tick(news.state.retryDelay);
  assert.equal(calls, 4);
  assert.equal(clock.timers.size, 1);
});

test('old single-publisher caches are refreshed and new multifeed caches validate source ownership', async t => {
  let calls = 0;
  const legacy = { nation: { at: Date.now(), articles: [{ title: 'Legacy', url: articleURL, image }] } };
  const { news, document } = setup(t, { allFeeds: true, cache: JSON.stringify(legacy), gm: options => {
    calls++; gmSuccess(rss(item('Current', options.url.includes('yahoo') ? articleURL : nhkURL, '')))(options);
  } });
  news.patch(); await flush();
  assert.equal(calls, 2);
  assert.equal(document.querySelectorAll('.ct-news-article').length, 2);
  const cache = { nation: { at: Date.now(), feedCount: 2, failed: ['yahoo', 'evil'], articles: [
    { title: 'NHK cached', url: nhkURL, source: 'Spoofed', image }, { title: 'Evil', url: 'https://evil.test/a', image }
  ] } };
  const fresh = setup(t, { allFeeds: true, cache: JSON.stringify(cache), gm: () => assert.fail('validated fresh cache must not refetch') });
  fresh.news.patch(); await flush();
  assert.equal(fresh.document.querySelectorAll('.ct-news-article').length, 1);
  assert.match(fresh.document.querySelector('.ct-news-source').textContent, /NHK NEWS WEB/);
  assert.equal(fresh.document.querySelector('.ct-news-article img'), null);
  assert.deepEqual(Array.from(fresh.news.state.cache.get('nation').failed), ['yahoo']);
});

test('finishing another topic cannot persist an incomplete feed as a finished cache after reload', async t => {
  const calls = [];
  const { news, document, window } = setup(t, { allFeeds: true, clock: true, gm: options => calls.push(options) });
  news.patch();
  select(document, 'Sports'); news.patch();
  calls.find(o => o.url.includes('nikkansports')).onload({ status: 200, responseText: atom() }); await flush();
  assert.equal(news.state.cache.get('sports').loading, true);
  for (const request of calls.filter(o => o.url === feedURL || o.url.includes('news.web.nhk'))) {
    request.onload({ status: 200, responseText: rss(item('Complete news', request.url === feedURL ? articleURL : nhkURL, '')) });
  }
  await flush();
  const stored = JSON.parse(window.sessionStorage.getItem('ct-japanese-news-cache-v1'));
  assert.equal(stored.nation.loading, false);
  assert.equal(stored.sports, undefined, 'unfinished topics must not be persisted');
  // Also reject unfinished entries written by an older implementation.
  stored.sports = news.state.cache.get('sports');
  let reloadedCalls = 0;
  const reloaded = setup(t, { allFeeds: true, clock: true, html: layout('Sports'), cache: JSON.stringify(stored), gm: options => {
    reloadedCalls++;
    gmSuccess(options.url.includes('nikkansports') ? atom() : rss(item('Yahoo sports')))(options);
  } });
  reloaded.news.patch(); await flush();
  assert.equal(reloadedCalls, 2);
  assert.equal(reloaded.news.state.cache.get('sports').loading, false);
  assert.equal(reloaded.document.querySelector('[data-ct-news-action="retry"]').hidden, true);
});

test('a late second publisher cannot repopulate a new route or selected topic', async t => {
  const calls = [];
  const { news, document, window } = setup(t, { allFeeds: true, gm: options => calls.push(options) });
  news.patch();
  calls[1].onload({ status: 200, responseText: rss(item('First NHK', nhkURL, '')) }); await flush();
  window.history.replaceState({}, '', '/notifications'); news.patch();
  calls[0].onload({ status: 200, responseText: rss(item('Late Yahoo')) }); await flush();
  assert.equal(document.querySelector('.ct-japanese-news'), null);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
});

test('parses Yahoo RSS image headlines, deduplicates articles, preserves source and publication date', t => {
  const { news } = setup(t);
  const articles = news.parse(rss(item() + item() + item('写真なし', articleURL + '2', '')));
  assert.equal(articles.length, 2);
  assert.equal(articles[0].image, image);
  assert.equal(articles[0].title, '日本のニュース');
  assert.equal(articles[0].source, 'Yahoo!ニュース');
  assert.equal(articles[0].publishedAt, '2026-09-27T03:00:00.000Z');
  assert.equal(articles[1].image, '');
});

test('supports media thumbnail and image enclosure without reading HTML descriptions', t => {
  const { news } = setup(t);
  const first = item().replace(`<image>${image}</image>`, `<media:thumbnail url="${image}"/>`);
  const second = item('Two', articleURL + '2').replace(`<image>${image}</image>`, `<enclosure type="image/jpeg" url="${image}"/><description><![CDATA[<img src="https://evil.test/track">]]></description>`);
  assert.equal(news.parse(rss(first + second)).length, 2);
  assert.ok(news.parse(rss(first + second)).every(article => article.image === image));
});

test('rejects malformed XML, entities, oversized responses and non-RSS documents', t => {
  const { news } = setup(t);
  for (const value of [null, '<rss>', '<html><item/></html>', '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>', 'a'.repeat(1024 * 1024 + 1)]) {
    assert.equal(news.parse(value).length, 0);
  }
});

test('URL allowlists reject scripts, private hosts, lookalike domains and credentials', t => {
  const { news } = setup(t);
  for (const url of ['javascript:alert(1)', 'http://news.yahoo.co.jp/articles/one', 'https://localhost/articles/one', 'https://news.yahoo.co.jp.evil.test/articles/one', 'https://user:pass@news.yahoo.co.jp/articles/one', 'https://news.yahoo.co.jp/articles/one#fragment', 'https://news.yahoo.co.jp:8080/articles/one', 'https://news.yahoo.co.jp/login']) assert.equal(news.url(url), null);
  for (const url of ['data:image/png,aaa', 'https://127.0.0.1/image.jpg', 'https://yimg.jp.evil.test/image.jpg', 'https://user:pass@x.yimg.jp/a.jpg']) assert.equal(news.url(url, 'image'), null);
  assert.equal(news.url(image, 'image'), image);
  assert.equal(news.url(feedURL, 'feed'), feedURL);
  assert.equal(news.url(feedURL + '?unknown=1', 'feed'), null);
});

test('RSS cannot inject executable markup or arbitrary image/article URLs', t => {
  const { news } = setup(t);
  const malicious = item('&lt;img src=x onerror=alert(1)&gt;', articleURL, 'javascript:alert(1)') + item('evil', 'https://evil.test/a', image);
  const articles = news.parse(rss(malicious));
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(articles[0].image, '');
});

test('GM transport is anonymous GET with a bounded timeout and no user credentials', async t => {
  let call;
  const { news } = setup(t, { gm: options => { call = options; gmSuccess(rss(item()))(options); } });
  assert.ok(await news.request(feedURL));
  assert.equal(call.method, 'GET'); assert.equal(call.anonymous, true);
  assert.equal(call.redirect, 'error'); assert.equal(call.timeout, 30);
  assert.equal(call.headers.Authorization, undefined); assert.equal(call.headers.Cookie, undefined);
});

test('supports modern Promise GM transport and rejects redirects/status/errors', async t => {
  const gm = { marker: true, xmlHttpRequest(options) { assert.equal(this.marker, true); return Promise.resolve({ status: 200, responseText: rss(item()), finalUrl: options.url }); } };
  const { news } = setup(t, { modernGM: gm });
  assert.ok(await news.request(feedURL));
  for (const response of [{ status: 403, responseText: '<rss/>' }, { status: 200, responseText: '<rss/>', finalUrl: 'https://evil.test/rss' }, { status: 200, responseText: 'x'.repeat(1024 * 1024 + 1) }]) {
    gm.xmlHttpRequest = () => Promise.resolve(response);
    assert.equal(await news.request(feedURL), null);
  }
  gm.xmlHttpRequest = () => Promise.reject(new Error('Network error'));
  assert.equal(await news.request(feedURL), null);
});

test('sandbox-only modern GM is used instead of the cross-origin fetch fallback', async t => {
  let calls = 0;
  const gm = { marker: true, xmlHttpRequest(options) {
    assert.equal(this.marker, true); calls++;
    return Promise.resolve({ status: 200, responseText: rss(item()), finalUrl: options.url });
  } };
  const { news, document, window } = setup(t, {
    lexicalGM: gm,
    fetch: () => assert.fail('a sandbox GM binding must not fall back to CORS-blocked fetch')
  });
  assert.equal(window.GM, undefined);
  news.patch(); await flush();
  assert.equal(calls, 1);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, '日本のニュース');
  assert.equal(document.querySelector('.ct-news-article img').src, image);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), true);
});

test('an empty Promise request receipt waits for its later callback instead of reporting Japanese news failure', async t => {
  for (const receipt of [undefined, null, {}]) {
    let callback;
    const { news, document, clock } = setup(t, { clock: true, modernGM: { xmlHttpRequest(options) {
      callback = options; return Promise.resolve(receipt);
    } } });
    news.patch(); await flush();
    assert.equal(news.state.pending.size, 1);
    assert.equal(news.state.retryAt.size, 0);
    assert.match(document.querySelector('.ct-news-status').textContent, /読み込み中/);
    assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
    await clock.tick(10);
    callback.onload({ status: 200, responseText: rss(item('Callback news')), finalUrl: callback.url });
    await flush();
    assert.equal(news.state.pending.size, 0);
    assert.equal(document.querySelector('.ct-news-article h3').textContent, 'Callback news');
    assert.equal(document.querySelector('.ct-news-article img').src, image);
    assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), true);
    assert.equal(clock.timers.size, 1, 'only the next cache expiry remains');
  }
});

test('an empty request receipt with no callback still times out and aborts once before backing off', async t => {
  let calls = 0, aborts = 0;
  const { news, document, clock } = setup(t, { clock: true, modernGM: { xmlHttpRequest() {
    calls++; return Object.assign(Promise.resolve(undefined), { abort() { aborts++; } });
  } } });
  news.patch(); await flush();
  await clock.tick(news.state.timeout - 1);
  assert.equal(news.state.pending.size, 1); assert.equal(aborts, 0);
  await clock.tick(1);
  assert.equal(news.state.pending.size, 0); assert.equal(aborts, 1);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  assert.match(document.querySelector('.ct-news-status').textContent, /世界のニュース/);
  news.patch(); await clock.tick(news.state.retryDelay - 1); assert.equal(calls, 1);
  await clock.tick(1); assert.equal(calls, 2);
});

test('a callback result is retained if the receipt Promise later rejects or returns a different response', async t => {
  for (const reject of [false, true]) {
    let settle;
    const { news } = setup(t, { modernGM: { xmlHttpRequest(options) {
      const receipt = new Promise((resolve, fail) => { settle = reject ? fail : resolve; });
      options.onload({ status: 200, responseText: rss(item('First callback')), finalUrl: options.url });
      return receipt;
    } } });
    const result = await news.request(feedURL);
    settle(reject ? new Error('Late bridge rejection') : { status: 403, responseText: 'Blocked' });
    await flush();
    assert.match(result, /First callback/);
  }
});

test('hanging GM request is aborted at the deadline and unknown URLs are never fetched', async t => {
  let calls = 0;
  let aborts = 0;
  const { news } = setup(t, { gm: () => { calls++; return { abort() { aborts++; } }; } });
  assert.equal(await news.request('https://evil.test/rss'), null);
  assert.equal(calls, 0);
  assert.equal(await news.request(feedURL), null);
  assert.equal(aborts, 1);
});

test('fetch fallback omits cookies, referrer and redirects and times out on a hanging body', async t => {
  let call;
  const { news } = setup(t, { fetch: async (url, options) => { call = options; return { ok: true, url, text: () => new Promise(() => {}) }; } });
  assert.equal(await news.request(feedURL), null);
  assert.equal(call.credentials, 'omit'); assert.equal(call.referrerPolicy, 'no-referrer');
  assert.equal(call.redirect, 'error'); assert.equal(call.signal.aborted, true);
});

test('concurrent loads deduplicate and successful headlines are cached for 15 minutes', async t => {
  let calls = 0;
  const { news, window } = setup(t, { gm: options => { calls++; gmSuccess(rss(item()))(options); } });
  const [a, b] = await Promise.all([news.load('nation'), news.load('nation')]);
  assert.equal(calls, 1); assert.equal(a, b);
  assert.equal(await news.load('nation'), a); assert.equal(calls, 1);
  assert.ok(window.sessionStorage.getItem('ct-japanese-news-cache-v1'));
  news.state.cache.get('nation').at = Date.now() - news.state.ttl;
  await news.load('nation'); assert.equal(calls, 2);
});

test('failures back off and empty/malformed feeds do not suppress world news', async t => {
  let calls = 0;
  const { news, document } = setup(t, { gm: options => { calls++; gmSuccess('<html>blocked</html>')(options); } });
  news.patch(); await flush();
  assert.equal(calls, 1);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  assert.match(document.querySelector('.ct-news-status').textContent, /世界のニュース/);
  news.patch(); await news.load('nation'); assert.equal(calls, 1);
});

for (const locale of ['ja', 'en']) test(`${locale}: explicit Retry recovers a failed feed without waiting or duplicating pending requests`, async t => {
  let calls = 0, pending;
  const { news, document, clock } = setup(t, { locale, region: 'jp', clock: true, gm: options => {
    calls++;
    if (calls === 1) queueMicrotask(() => options.onerror());
    else pending = options;
  } });
  const native = document.getElementById('native-news');
  news.patch(); await flush();
  const retry = document.querySelector('[data-ct-news-action="retry"]');
  assert.equal(retry.textContent, locale === 'ja' ? '再試行' : 'Retry');
  assert.equal(retry.hidden, false);
  assert.equal(native.classList.contains('ct-news-native-hidden'), false);
  assert.equal(calls, 1);
  retry.click(); retry.click(); await flush();
  assert.equal(calls, 2);
  assert.equal(retry.hidden, true);
  assert.equal(news.state.pending.size, 1);
  assert.equal(news.state.retryAt.size, 0);
  pending.onload({ status: 200, responseText: rss(item('Recovered by Retry')), finalUrl: pending.url });
  await flush();
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'Recovered by Retry');
  assert.equal(document.querySelector('.ct-news-article img').src, image);
  assert.equal(retry.hidden, true);
  assert.equal(document.getElementById('native-news'), native);
  assert.equal(native.classList.contains('ct-news-native-hidden'), true);
  assert.equal(clock.timers.size, 1);
});

test('retry cannot restart a detached, hidden, backgrounded, World or non-news panel', async t => {
  for (const change of [
    f => f.document.querySelector('[data-ct-news-region="world"]').click(),
    f => select(f.document, 'For you'),
    f => f.window.history.replaceState({}, '', '/notifications'),
    f => { f.document.querySelector('main > div').hidden = true; },
    f => f.document.querySelector('main > div').setAttribute('aria-hidden', 'true'),
    f => f.clock.setHidden(true),
    f => f.window.dispatchEvent(new f.window.Event('pagehide')),
    f => f.document.querySelector('.ct-japanese-news').remove()
  ]) {
    let calls = 0;
    const f = setup(t, { clock: true, gm: options => { calls++; queueMicrotask(() => options.onerror()); } });
    f.news.patch(); await flush();
    const retry = f.document.querySelector('[data-ct-news-action="retry"]');
    change(f); retry.click(); await flush();
    assert.equal(calls, 1);
    assert.equal(f.document.getElementById('native-news').classList.contains('ct-news-native-hidden'), false);
  }
});

test('retry follows the currently verified topic and an older response cannot replace its headlines or failure', async t => {
  const callbacks = [];
  const { news, document, clock } = setup(t, { clock: true, gm: options => callbacks.push(options) });
  news.patch();
  select(document, 'Sports'); news.patch();
  callbacks[1].onerror(); await flush();
  const retry = document.querySelector('[data-ct-news-action="retry"]');
  assert.equal(retry.hidden, false);
  retry.click(); assert.equal(callbacks.length, 3);
  assert.match(callbacks[2].url, /sports\.xml$/);
  callbacks[0].onload({ status: 200, responseText: rss(item('Old nation')), finalUrl: callbacks[0].url });
  await flush();
  assert.equal(document.querySelectorAll('.ct-news-article').length, 0);
  assert.equal(document.getElementById('native-news').classList.contains('ct-news-native-hidden'), false);
  assert.match(document.querySelector('.ct-news-status').textContent, /読み込み中/);
  callbacks[2].onload({ status: 200, responseText: rss(item('Current sports')), finalUrl: callbacks[2].url });
  await flush();
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'Current sports');
  assert.equal(clock.timers.size, 1);
});

test('Japanese default renders source photos; World restores the same native DOM and event handlers', async t => {
  const { news, document, window } = setup(t, { gm: gmSuccess(rss(item())) });
  const native = document.querySelector('#native-news');
  let clicked = 0;
  document.querySelector('#native-story').addEventListener('click', e => { e.preventDefault(); clicked++; });
  news.patch(); await flush();
  assert.equal(document.querySelector('.ct-news-article img').src, image);
  assert.equal(document.querySelector('.ct-news-article').href, articleURL);
  assert.equal(document.querySelector('.ct-news-article').rel, 'noopener noreferrer');
  assert.equal(document.querySelector('.ct-news-article img').referrerPolicy, 'no-referrer');
  assert.equal(native.classList.contains('ct-news-native-hidden'), true);
  document.querySelector('[data-ct-news-region="world"]').click();
  assert.equal(native.classList.contains('ct-news-native-hidden'), false);
  assert.equal(document.querySelector('#native-news'), native);
  assert.equal(document.querySelector('.ct-news-list').hidden, true);
  document.querySelector('#native-story').click(); assert.equal(clicked, 1);
  assert.equal(window.localStorage.getItem('ct-news-region-v1'), 'world');
});

test('English defaults to world news without contacting an external feed until Japan is chosen', async t => {
  let calls = 0;
  const { news, document } = setup(t, { locale: 'en', gm: options => { calls++; gmSuccess(rss(item()))(options); } });
  news.patch(); await flush(); assert.equal(calls, 0);
  assert.equal(document.querySelector('[data-ct-news-region="world"]').getAttribute('aria-pressed'), 'true');
  document.querySelector('[data-ct-news-region="jp"]').click(); await flush();
  assert.equal(calls, 1); assert.equal(document.querySelector('.ct-news-article h3').textContent, '日本のニュース');
});

test('switching region or topic during a pending request cannot hide the current world feed', async t => {
  const callbacks = [];
  const { news, document } = setup(t, { gm: options => callbacks.push(options) });
  news.patch();
  document.querySelector('[data-ct-news-region="world"]').click();
  callbacks[0].onload({ status: 200, responseText: rss(item()) }); await flush();
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  assert.equal(document.querySelector('.ct-news-list').hidden, true);
  select(document, 'Sports');
  document.querySelector('[data-ct-news-region="jp"]').click();
  assert.match(callbacks[1].url, /sports\.xml$/);
  select(document, 'Technology'); news.patch();
  assert.match(callbacks[2].url, /it\.xml$/);
  callbacks[1].onload({ status: 200, responseText: rss(item('sports')) }); await flush();
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  callbacks[2].onload({ status: 200, responseText: rss(item('technology')) }); await flush();
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'technology');
});

test('switching back to native For you removes the panel and restores native contents', async t => {
  const { news, document } = setup(t, { gm: gmSuccess(rss(item())) });
  news.patch(); await flush(); select(document, 'For you'); news.patch();
  assert.equal(document.querySelector('.ct-japanese-news'), null);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  assert.equal(news.state.mounts.size, 0);
});

test('only verified visible home news tabs are eligible; composers and user content are never hidden', t => {
  for (const options of [
    { html: layout('For you') },
    { html: layout().replace('id="native-news"', 'id="native-news"><textarea>Draft</textarea><div').replace('</main>', '</main>') },
    { html: layout().replace('class="w-full min-w-0 flex flex-col"', 'class="w-full min-w-0 flex flex-col" hidden') },
    { url: 'https://tweet.app/post/example' }
  ]) {
    const { news, document } = setup(t, options);
    news.patch(); assert.equal(document.querySelector('.ct-japanese-news'), null);
  }
});

test('translated native category labels still resolve and do not change titles or article bodies', async t => {
  const html = layout().replace('>News<', '>ニュース<').replace('>Sports<', '>スポーツ<').replace('>Entertainment<', '>エンターテインメント<').replace('>Technology<', '>テクノロジー<');
  const { news, document } = setup(t, { html, gm: gmSuccess(rss(item('&lt;img src=x&gt;'))) });
  news.patch(); await flush();
  assert.equal(document.querySelector('.ct-news-article h3').textContent, '<img src=x>');
  assert.equal(document.querySelector('.ct-news-article h3 img'), null);
  assert.equal(document.querySelector('#native-story').textContent, 'Original world news');
});

test('cached headlines are validated again and stale or malicious entries are discarded', async t => {
  const entry = { at: Date.now(), feedCount: 1, articles: [{ title: 'Cached', url: articleURL, image, publishedAt: '2026-09-27T03:00:00Z' }, { title: 'Evil', url: 'javascript:alert(1)', image }] };
  const { news, document } = setup(t, { cache: JSON.stringify({ nation: entry }), gm: () => assert.fail('fresh cache should not fetch') });
  news.patch(); await flush();
  assert.equal(document.querySelectorAll('.ct-news-article').length, 1);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'Cached');
});

test('repeated scans are DOM-idempotent and failed photos hide without a broken-image placeholder', async t => {
  const { news, document, window } = setup(t, { gm: gmSuccess(rss(item())) });
  news.patch(); await flush();
  let count = 0;
  const observer = new window.MutationObserver(records => { count += records.length; });
  observer.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
  news.patch(); news.patch(); await flush(); assert.equal(count, 0);
  observer.disconnect();
  const img = document.querySelector('.ct-news-article img');
  img.dispatchEvent(new window.Event('error')); assert.equal(img.hidden, true);
});

test('a pending result after route change cannot hide native content or recreate removed panels', async t => {
  let request;
  const { news, document, window } = setup(t, { gm: options => { request = options; } });
  news.patch(); window.history.replaceState({}, '', '/notifications'); news.patch();
  request.onload({ status: 200, responseText: rss(item()) }); await flush();
  assert.equal(document.querySelector('.ct-japanese-news'), null);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
});

test('visible Japanese headlines refresh at cache expiry even when the page has no DOM changes', async t => {
  let calls = 0;
  const { news, document, clock } = setup(t, { clock: true, gm: options => {
    calls++; gmSuccess(rss(item(`News ${calls}`)))(options);
  } });
  const native = document.querySelector('#native-news');
  news.patch(); await flush();
  assert.equal(calls, 1);
  await clock.tick(news.state.ttl - 1);
  assert.equal(calls, 1);
  await clock.tick(1);
  assert.equal(calls, 2, 'expiry must refresh the visible topic without a mutation scan');
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'News 2');
  assert.equal(document.querySelector('#native-news'), native);
  assert.equal(native.classList.contains('ct-news-native-hidden'), true);
  assert.equal(clock.timers.size, 1, 'only the next expiry should remain scheduled');
  const timer = news.state.refreshTimer;
  news.patch(); news.patch();
  assert.equal(news.state.refreshTimer, timer, 'unrelated scans must retain the same deadline timer');
  assert.equal(calls, 2);
});

test('background and pagehide stop expiry timers; foreground and pageshow refresh expired headlines', async t => {
  let calls = 0;
  const { news, document, window, clock } = setup(t, { clock: true, gm: options => {
    calls++; gmSuccess(rss(item(`News ${calls}`)))(options);
  } });
  news.patch(); await flush();
  assert.equal(calls, 1);
  clock.setHidden(true);
  assert.equal(clock.timers.size, 0);
  news.patch();
  await clock.tick(news.state.ttl + 1);
  assert.equal(calls, 1, 'background scans and elapsed time must not request headlines');
  clock.setHidden(false); await flush();
  assert.equal(calls, 2);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'News 2');
  assert.equal(clock.timers.size, 1);

  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(clock.timers.size, 0);
  await clock.tick(news.state.ttl + 1);
  news.patch(); clock.setHidden(false); await flush();
  assert.equal(calls, 2, 'visibility alone must not reactivate a page after pagehide');
  window.dispatchEvent(new window.Event('pageshow')); await flush();
  assert.equal(calls, 3);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'News 3');
  assert.equal(clock.timers.size, 1);
});

test('World, For you and another route cancel the news deadline and retain native contents', async t => {
  for (const destination of ['World', 'For you', 'route']) {
    let calls = 0;
    const { news, document, window, clock } = setup(t, { clock: true, gm: options => {
      calls++; gmSuccess(rss(item()))(options);
    } });
    const native = document.querySelector('#native-news');
    let clicked = 0;
    document.querySelector('#native-story').addEventListener('click', event => { event.preventDefault(); clicked++; });
    news.patch(); await flush();
    if (destination === 'World') document.querySelector('[data-ct-news-region="world"]').click();
    else if (destination === 'For you') { select(document, 'For you'); news.patch(); }
    else { window.history.replaceState({}, '', '/notifications'); news.patch(); }
    assert.equal(clock.timers.size, 0, destination);
    await clock.tick(news.state.ttl * 2);
    assert.equal(calls, 1, destination);
    assert.equal(document.querySelector('#native-news'), native);
    assert.equal(native.classList.contains('ct-news-native-hidden'), false);
    document.querySelector('#native-story').click(); assert.equal(clicked, 1);

    if (destination === 'World') document.querySelector('[data-ct-news-region="jp"]').click();
    else if (destination === 'For you') { select(document, 'News'); news.patch(); }
    else { window.history.replaceState({}, '', '/feed'); news.patch(); }
    await flush();
    assert.equal(calls, 2, `returning from ${destination} must refresh the expired cache`);
    assert.equal(clock.timers.size, 1);
  }
});

test('failed foreground refreshes wait for each retry deadline and recover without a DOM mutation', async t => {
  let calls = 0;
  const { news, document, clock } = setup(t, { clock: true, gm: options => {
    calls++; gmSuccess(calls < 3 ? '<html>blocked</html>' : rss(item('Recovered')))(options);
  } });
  news.patch(); await flush();
  assert.equal(calls, 1);
  assert.equal(clock.timers.size, 1);
  news.patch(); news.patch(); await flush();
  await clock.tick(news.state.retryDelay - 1);
  assert.equal(calls, 1);
  await clock.tick(1);
  assert.equal(calls, 2);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  assert.equal(clock.timers.size, 1, 'another failure must schedule one backoff, not a tight loop');
  await clock.tick(news.state.retryDelay);
  assert.equal(calls, 3);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'Recovered');
  assert.equal(clock.timers.size, 1, 'successful recovery schedules the next cache expiry');
});

test('a hanging request remains deduplicated and retries only after its timeout and backoff', async t => {
  let calls = 0;
  let aborts = 0;
  const { news, clock } = setup(t, { clock: true, gm: options => {
    calls++;
    if (calls > 1) gmSuccess(rss(item()))(options);
    return { abort() { aborts++; } };
  } });
  news.patch(); news.patch(); await flush();
  assert.equal(calls, 1);
  await clock.tick(news.state.timeout - 1);
  news.patch(); assert.equal(calls, 1);
  await clock.tick(1);
  assert.equal(aborts, 1);
  assert.equal(calls, 1);
  assert.equal(clock.timers.size, 1);
  await clock.tick(news.state.retryDelay - 1); assert.equal(calls, 1);
  await clock.tick(1); assert.equal(calls, 2);
  assert.equal(clock.timers.size, 1);
});

test('an old request completion rechecks For you before the queued application scan', async t => {
  let request;
  const { news, document, clock } = setup(t, { clock: true, gm: options => { request = options; } });
  news.patch();
  select(document, 'For you'); // The application has changed tabs; its observer scan has not run yet.
  request.onload({ status: 200, responseText: rss(item()) }); await flush();
  assert.equal(document.querySelector('.ct-japanese-news'), null);
  assert.equal(document.querySelector('#native-news').classList.contains('ct-news-native-hidden'), false);
  assert.equal(clock.timers.size, 0);
});

test('a large clock jump refreshes once without replaying missed cache periods or scheduling immediate loops', async t => {
  let calls = 0;
  const { news, clock } = setup(t, { clock: true, gm: options => {
    calls++; gmSuccess(rss(item()))(options);
  } });
  news.patch(); await flush();
  clock.jump(news.state.ttl * 1000);
  await clock.tick(0);
  assert.equal(calls, 2, 'the overdue deadline should make one current request');
  assert.equal(clock.timers.size, 1);
  await clock.tick(news.state.ttl - 1);
  assert.equal(calls, 2, 'the next request should use a new full cache period');
  await clock.tick(1);
  assert.equal(calls, 3);
});

test('a request that fails in the background waits for foreground and honors its remaining retry deadline', async t => {
  let request;
  let calls = 0;
  const { news, document, clock } = setup(t, { clock: true, gm: options => {
    calls++;
    if (calls === 1) request = options;
    else gmSuccess(rss(item('Recovered')))(options);
  } });
  news.patch(); clock.setHidden(true);
  request.onerror(); await flush();
  assert.equal(clock.timers.size, 0, 'an in-flight background completion must not arm another request');
  await clock.tick(news.state.retryDelay - 1);
  clock.setHidden(false); await flush();
  assert.equal(calls, 1, 'foreground must preserve the remaining failure backoff');
  assert.equal(clock.timers.size, 1);
  await clock.tick(1);
  assert.equal(calls, 2);
  assert.equal(document.querySelector('.ct-news-article h3').textContent, 'Recovered');
});

const sourcesKey = 'ct-news-sources-v1';
const sourceSettings = topics => JSON.stringify({ version: 1, topics });
function changePublisher(f, publisher, checked) {
  const input = f.document.querySelector(`[data-ct-news-publisher="${publisher}"]`);
  assert.ok(input);
  input.checked = checked;
  input.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  return input;
}
function publisherSuccess(options) {
  gmSuccess(options.url.includes('nikkansports') ? atom() : rss(item(
    options.url.includes('yahoo') ? 'Yahoo news' : 'NHK news', options.url.includes('yahoo') ? articleURL : nhkURL, '')))(options);
}

test('publisher choices persist per topic, only selected feeds load, and native contents and drafts stay intact', async t => {
  const calls = [];
  const f = setup(t, { allFeeds: true, html: layout('News', '<textarea id="draft">Keep my draft</textarea><video id="player"></video>'),
    gm: options => { calls.push(options.url); publisherSuccess(options); } });
  const native = f.document.getElementById('native-news'), draft = f.document.getElementById('draft'), video = f.document.getElementById('player');
  let clicks = 0;
  f.document.getElementById('native-story').addEventListener('click', event => { event.preventDefault(); clicks++; });
  f.news.patch(); await flush();
  assert.equal(calls.length, 2);
  const details = f.document.querySelector('.ct-news-sources');
  details.open = true;
  changePublisher(f, 'yahoo', false); await flush();
  assert.equal(calls.length, 3);
  assert.match(calls[2], /news\.web\.nhk/);
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem(sourcesKey)).topics.nation, ['nhk']);
  assert.equal(details.open, true);
  assert.equal(f.document.querySelector('.ct-news-article h3').textContent, 'NHK news');
  select(f.document, 'Sports'); f.news.patch(); await flush();
  assert.deepEqual([...f.document.querySelectorAll('[data-ct-news-publisher]')].map(input => [input.dataset.ctNewsPublisher, input.checked]), [['yahoo', true], ['nikkan', true]]);
  assert.match(f.document.querySelector('.ct-news-sources legend').textContent, /スポーツ/);
  changePublisher(f, 'nikkan', false); await flush();
  assert.match(calls.at(-1), /sports\.xml$/);
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem(sourcesKey)).topics.sports, ['yahoo']);
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem(sourcesKey)).topics.nation, ['nhk']);
  select(f.document, 'News'); f.news.patch(); await flush();
  assert.equal(f.document.querySelector('[data-ct-news-publisher="yahoo"]').checked, false);
  assert.equal(f.document.getElementById('native-news'), native);
  assert.equal(f.document.getElementById('draft'), draft); assert.equal(draft.value, 'Keep my draft');
  assert.equal(f.document.getElementById('player'), video);
  f.document.querySelector('[data-ct-news-region="world"]').click();
  assert.equal(details.hidden, true);
  assert.equal(native.classList.contains('ct-news-native-hidden'), false);
  f.document.getElementById('native-story').click(); assert.equal(clicks, 1);
});

for (const locale of ['ja', 'en']) test(`${locale}: the final publisher stays checked with an accessible explanation and no extra request`, async t => {
  let calls = 0;
  const f = setup(t, { allFeeds: true, locale, region: 'jp', sources: sourceSettings({ nation: ['nhk'] }), gm: options => { calls++; publisherSuccess(options); } });
  f.news.patch(); await flush();
  const input = changePublisher(f, 'nhk', false); await flush();
  assert.equal(input.checked, true);
  assert.equal(calls, 1);
  assert.equal(f.document.querySelector('.ct-news-sources summary').textContent, locale === 'ja' ? '配信元' : 'Publishers');
  assert.match(f.document.querySelector('.ct-news-preference-status').textContent, locale === 'ja' ? /最低1つ/ : /at least one/);
  assert.equal(f.document.querySelector('.ct-news-preference-status').getAttribute('aria-live'), 'polite');
  assert.match(input.closest('label').textContent, /NHK NEWS WEB/);
  const css = f.document.getElementById('ct-japanese-news-style').textContent;
  assert.match(css, /\.ct-news-sources label\{[^}]*min-height:44px/);
  assert.match(css, /\.ct-news-sources input:focus-visible/);
});

test('failed publisher preference writes restore the checked inputs and keep the old cache, setting and native region', async t => {
  let calls = 0;
  const stored = sourceSettings({ nation: ['yahoo', 'nhk'] });
  const f = setup(t, { allFeeds: true, sources: stored, gm: options => { calls++; publisherSuccess(options); } });
  f.news.patch(); await flush();
  const cached = f.news.state.cache.get('nation');
  const prototype = Object.getPrototypeOf(f.window.localStorage), original = prototype.setItem;
  prototype.setItem = function (key, value) { if (key === sourcesKey || key === 'ct-news-region-v1') throw new Error('QuotaExceededError'); return original.call(this, key, value); };
  changePublisher(f, 'yahoo', false); await flush();
  assert.equal(f.document.querySelector('[data-ct-news-publisher="yahoo"]').checked, true);
  assert.equal(f.window.localStorage.getItem(sourcesKey), stored);
  assert.equal(f.news.state.cache.get('nation'), cached);
  assert.equal(calls, 2);
  assert.match(f.document.querySelector('.ct-news-preference-status').textContent, /保存できません/);
  f.document.querySelector('[data-ct-news-region="world"]').click();
  assert.equal(f.news.state.region, 'jp');
  assert.equal(f.document.querySelector('[data-ct-news-region="jp"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.document.getElementById('native-news').classList.contains('ct-news-native-hidden'), true);
});

test('source preference validation rejects unknown topics, empty selections, URLs, duplicates and oversized data without destroying older storage', async t => {
  for (const stored of ['{', 'x'.repeat(2049), sourceSettings({ nation: [] }), sourceSettings({ nation: ['nhk', 'nhk'] }),
    sourceSettings({ nation: ['https://evil.test/rss'] }), sourceSettings({ unknown: ['yahoo'] }), JSON.stringify({ version: 2, topics: {} })]) {
    let calls = 0;
    const f = setup(t, { allFeeds: true, sources: stored, gm: options => { calls++; publisherSuccess(options); } });
    f.window.localStorage.setItem('ct-local-tools-v1', 'preserved-tools');
    f.window.localStorage.setItem('ct-favorites-v1', 'preserved-favorites');
    f.news.patch(); await flush();
    assert.equal(calls, 2);
    assert.match(f.document.querySelector('.ct-news-preference-status').textContent, /読み込めません/);
    assert.equal(f.window.localStorage.getItem(sourcesKey), stored);
    assert.equal(f.window.localStorage.getItem('ct-local-tools-v1'), 'preserved-tools');
    assert.equal(f.window.localStorage.getItem('ct-favorites-v1'), 'preserved-favorites');
  }
});

test('a source selection generation rejects late success and failure even after choosing the original set again', async t => {
  const requests = [];
  const f = setup(t, { allFeeds: true, clock: true, gm: options => requests.push(options) });
  f.news.patch();
  changePublisher(f, 'yahoo', false);
  changePublisher(f, 'yahoo', true);
  assert.equal(requests.length, 5);
  const newest = requests.slice(3);
  for (const request of newest) request.onload({ status: 200, responseText: rss(item('Current ' + (request.url.includes('yahoo') ? 'Yahoo' : 'NHK'), request.url.includes('yahoo') ? articleURL : nhkURL, '')) });
  await flush();
  const current = f.news.state.cache.get('nation');
  assert.equal(current.loading, false);
  requests[0].onload({ status: 200, responseText: rss(item('Stale Yahoo')) });
  requests[1].onerror(); requests[2].onerror(); await flush();
  assert.equal(f.news.state.cache.get('nation'), current);
  assert.equal(f.news.state.retryAt.size, 0);
  assert.equal(f.news.state.pending.size, 0);
  assert.equal(f.document.querySelector('[data-ct-news-action="retry"]').hidden, true);
  assert.ok([...f.document.querySelectorAll('.ct-news-article h3')].every(node => node.textContent.startsWith('Current ')));
  assert.equal(f.clock.timers.size, 1);
});

test('an old job cannot remove the current pending source job or persist excluded publisher articles', async t => {
  const requests = [];
  const f = setup(t, { allFeeds: true, clock: true, gm: options => requests.push(options) });
  f.news.patch(); changePublisher(f, 'yahoo', false);
  requests[0].onload({ status: 200, responseText: rss(item('Excluded Yahoo')) }); requests[1].onerror(); await flush();
  assert.equal(f.news.state.pending.size, 1);
  assert.equal(f.news.state.cache.size, 0);
  assert.equal(f.news.state.retryAt.size, 0);
  assert.equal(f.window.sessionStorage.getItem('ct-japanese-news-cache-v1'), null);
  requests[2].onload({ status: 200, responseText: rss(item('Selected NHK', nhkURL, '')) }); await flush();
  const cached = JSON.parse(f.window.sessionStorage.getItem('ct-japanese-news-cache-v1')).nation;
  assert.equal(cached.sourceKey, 'nhk'); assert.equal(cached.feedCount, 1);
  assert.deepEqual(cached.articles.map(article => article.source), ['NHK NEWS WEB']);
});

test('reload reuses only a cache for the selected source set and TTL refresh requests only that set', async t => {
  const selected = sourceSettings({ nation: ['nhk'] });
  const cache = { nation: { at: Date.parse('2026-09-30T03:00:00Z'), sourceKey: 'nhk', feedCount: 1, failed: [],
    articles: [{ title: 'Selected cached', url: nhkURL, publishedAt: '2026-09-27T03:00:00Z' }, { title: 'Excluded cached', url: articleURL }] } };
  const calls = [];
  const f = setup(t, { allFeeds: true, clock: true, sources: selected, cache: JSON.stringify(cache), gm: options => { calls.push(options.url); publisherSuccess(options); } });
  f.news.patch(); await flush();
  assert.equal(calls.length, 0);
  assert.deepEqual([...f.document.querySelectorAll('.ct-news-article h3')].map(node => node.textContent), ['Selected cached']);
  await f.clock.tick(f.news.state.ttl);
  assert.equal(calls.length, 1); assert.match(calls[0], /news\.web\.nhk/);
  const stale = setup(t, { allFeeds: true, clock: true, sources: selected,
    cache: JSON.stringify({ nation: { ...cache.nation, sourceKey: 'yahoo' } }), gm: publisherSuccess });
  stale.news.patch(); await flush();
  assert.equal(stale.document.querySelector('.ct-news-article h3').textContent, 'NHK news');
});

test('cross-tab changes update choices while stale saves and invalid external data cannot overwrite another tab', async t => {
  let calls = 0;
  const f = setup(t, { allFeeds: true, clock: true, gm: options => { calls++; publisherSuccess(options); } });
  f.news.patch(); await flush();
  const external = sourceSettings({ nation: ['nhk'] });
  f.window.localStorage.setItem(sourcesKey, external);
  changePublisher(f, 'nhk', false); await flush();
  assert.equal(f.window.localStorage.getItem(sourcesKey), external);
  assert.equal(calls, 2);
  assert.match(f.document.querySelector('.ct-news-preference-status').textContent, /別のタブ/);
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: sourcesKey, newValue: external, storageArea: f.window.localStorage })); await flush();
  assert.equal(calls, 3);
  assert.equal(f.document.querySelector('[data-ct-news-publisher="yahoo"]').checked, false);
  f.window.localStorage.setItem(sourcesKey, sourceSettings({ nation: [] }));
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: sourcesKey, storageArea: f.window.localStorage })); await flush();
  assert.equal(calls, 3);
  assert.equal(f.document.querySelector('[data-ct-news-publisher="nhk"]').checked, true);
  assert.match(f.document.querySelector('.ct-news-preference-status').textContent, /現在の選択を保持/);
});

for (const locale of ['ja', 'en']) for (const partial of [false, true]) test(`${locale}: ${partial ? 'partial' : 'total'} failure names only selected failed publishers and Safari suggests checking permission without assuming its cause`, async t => {
  const f = setup(t, { allFeeds: true, locale, platform: 'safari', region: 'jp', html: layout('Sports'),
    gm: options => { if (partial && options.url.includes('yahoo')) publisherSuccess(options); else queueMicrotask(() => options.onerror()); } });
  f.news.patch(); await flush();
  const status = f.document.querySelector('.ct-news-status').textContent;
  assert.match(status, /日刊スポーツ/); assert.match(status, /Stay/);
  assert.match(status, locale === 'ja' ? /取得できない配信元/ : /Unavailable publishers/);
  assert.match(status, locale === 'ja' ? /も確認/ : /Also check/);
  assert.doesNotMatch(status, /NHK|ITmedia/);
  assert.equal(f.document.querySelector('[data-ct-news-action="retry"]').hidden, false);
  const desktop = setup(t, { allFeeds: true, locale, region: 'jp', html: layout('Sports'), gm: options => queueMicrotask(() => options.onerror()) });
  desktop.news.patch(); await flush(); assert.doesNotMatch(desktop.document.querySelector('.ct-news-status').textContent, /Stay/);
});

test('World, hidden and detached publisher inputs cannot change settings or start reads; a background cross-tab change waits for foreground', async t => {
  for (const change of [
    f => f.document.querySelector('[data-ct-news-region="world"]').click(),
    f => f.clock.setHidden(true),
    f => { f.window.history.replaceState({}, '', '/notifications'); f.news.patch(); }
  ]) {
    let calls = 0;
    const f = setup(t, { allFeeds: true, clock: true, gm: options => { calls++; publisherSuccess(options); } });
    f.news.patch(); await flush();
    const input = f.document.querySelector('[data-ct-news-publisher="yahoo"]');
    change(f); input.checked = false; input.dispatchEvent(new f.window.Event('change', { bubbles: true })); await flush();
    assert.equal(f.window.localStorage.getItem(sourcesKey), null);
    assert.equal(calls, 2);
  }
  const calls = [];
  const f = setup(t, { allFeeds: true, clock: true, gm: options => { calls.push(options.url); publisherSuccess(options); } });
  f.news.patch(); await flush(); f.clock.setHidden(true);
  f.window.localStorage.setItem(sourcesKey, sourceSettings({ nation: ['nhk'] }));
  f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: sourcesKey, storageArea: f.window.localStorage })); await flush();
  assert.equal(calls.length, 2);
  assert.equal(f.clock.timers.size, 0);
  f.clock.setHidden(false); await flush();
  assert.equal(calls.length, 3); assert.match(calls[2], /news\.web\.nhk/);
  assert.equal(f.document.querySelector('[data-ct-news-publisher="yahoo"]').checked, false);
});

test('a single selected failed publisher is named without blaming unselected media, and Retry contacts only that publisher', async t => {
  const calls = [];
  const f = setup(t, { allFeeds: true, platform: 'safari', sources: sourceSettings({ nation: ['nhk'] }),
    gm: options => { calls.push(options); queueMicrotask(() => options.onerror()); } });
  f.news.patch(); await flush();
  assert.equal(calls.length, 1);
  const status = f.document.querySelector('.ct-news-status').textContent;
  assert.match(status, /取得できない配信元: NHK NEWS WEB/);
  assert.doesNotMatch(status, /Yahoo|日刊スポーツ|ITmedia/);
  f.document.querySelector('[data-ct-news-action="retry"]').click(); await flush();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(request => request.url.includes('news.web.nhk')));
  assert.ok(calls.every(request => request.anonymous && request.method === 'GET' && request.headers.Authorization === undefined));
});
