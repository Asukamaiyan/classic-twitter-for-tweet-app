// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese News Test
// @namespace    https://tweet.app/
// @version      0.2.0-test
// @description  Experimental Chrome/Tampermonkey test: replace tweet.app Explore news with Google News Japan RSS and restore article images where available.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      news.google.com
// @connect      *
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const IMAGE_CACHE_KEY = 'classicTwitterJP.newsImageCache.v1';
  const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000;

  function googleNewsRSS(topic) {
    const base = 'https://news.google.com/rss';
    const suffix = 'hl=ja&gl=JP&ceid=JP:ja';
    if (topic === 'sports') return `${base}/search?q=${encodeURIComponent('スポーツ')}&${suffix}`;
    if (topic === 'entertainment') return `${base}/search?q=${encodeURIComponent('エンタメ OR 芸能')}&${suffix}`;
    if (topic === 'technology') return `${base}/search?q=${encodeURIComponent('テクノロジー OR IT')}&${suffix}`;
    return `${base}?${suffix}`;
  }

  function gmRequest(url, accept, responseType = 'text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 10000,
        responseType,
        headers: { Accept: accept },
        onload: response => {
          if (response.status >= 200 && response.status < 400) resolve(response);
          else reject(new Error(`HTTP ${response.status}`));
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout'))
      });
    });
  }

  async function requestText(url, accept = 'text/html,application/xhtml+xml,*/*') {
    const response = await gmRequest(url, accept);
    return response.responseText || response.response || '';
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    return clean(doc.body?.textContent || '');
  }

  function loadImageCache() {
    try {
      const data = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  function saveImageCache(cache) {
    try { localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  function cachedImage(url) {
    const cache = loadImageCache();
    const hit = cache[url];
    if (!hit) return null;
    if (Date.now() - Number(hit.at || 0) > IMAGE_CACHE_TTL) {
      delete cache[url];
      saveImageCache(cache);
      return null;
    }
    return typeof hit.image === 'string' ? hit.image : '';
  }

  function storeImage(url, image) {
    const cache = loadImageCache();
    cache[url] = { image: image || '', at: Date.now() };
    const entries = Object.entries(cache)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, 100);
    saveImageCache(Object.fromEntries(entries));
  }

  function absoluteURL(value, base) {
    try { return new URL(value, base).href; } catch { return ''; }
  }

  function metaImage(html, base) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const selectors = [
      'meta[property="og:image:secure_url"]',
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'link[rel="image_src"]'
    ];
    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      const raw = el?.getAttribute('content') || el?.getAttribute('href') || '';
      const image = absoluteURL(raw, base);
      if (/^https?:\/\//i.test(image)) return image;
    }
    return '';
  }

  async function resolveGoogleNewsURL(googleURL) {
    try {
      const response = await gmRequest(googleURL, 'text/html,application/xhtml+xml,*/*');
      const finalURL = response.finalUrl || response.responseURL || googleURL;
      if (finalURL && !/news\.google\.com/i.test(new URL(finalURL).hostname)) return finalURL;

      const html = response.responseText || response.response || '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const canonical = doc.querySelector('link[rel="canonical"]')?.href || '';
      if (canonical && !/news\.google\.com/i.test(new URL(canonical).hostname)) return canonical;
    } catch {}
    return googleURL;
  }

  async function articleImage(articleURL) {
    const cached = cachedImage(articleURL);
    if (cached !== null) return cached;

    try {
      const finalURL = await resolveGoogleNewsURL(articleURL);
      const html = await requestText(finalURL);
      const image = metaImage(html, finalURL);
      storeImage(articleURL, image);
      return image;
    } catch {
      storeImage(articleURL, '');
      return '';
    }
  }

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function run() {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  async function getJapaneseNews(topic, limit) {
    const xml = await requestText(
      googleNewsRSS(topic),
      'application/rss+xml, application/xml, text/xml, */*'
    );
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid Google News RSS');

    const max = Math.max(1, Math.min(Number(limit) || 10, 20));
    const baseArticles = [...doc.querySelectorAll('item')]
      .slice(0, max)
      .map(item => {
        const rawTitle = clean(item.querySelector('title')?.textContent || '');
        const source = clean(item.querySelector('source')?.textContent || '');
        const link = clean(item.querySelector('link')?.textContent || '');
        const description = htmlToText(item.querySelector('description')?.textContent || '');
        const pubDate = clean(item.querySelector('pubDate')?.textContent || '');
        let title = rawTitle;
        if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(` - ${source}`).length).trim();
        let publishedAt = new Date().toISOString();
        if (pubDate) {
          const date = new Date(pubDate);
          if (!Number.isNaN(date.getTime())) publishedAt = date.toISOString();
        }
        return { id: `${link}::${title}`, title, description, url: link, image: '', source, publishedAt };
      })
      .filter(article => article.title && article.url);

    const articles = await mapLimit(baseArticles, 4, async article => ({
      ...article,
      image: await articleImage(article.url)
    }));

    return { success: true, topic, articles };
  }

  function install() {
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (!page?.fetch || page.__classicTwitterJPNewsTest) return;

    const originalFetch = page.fetch.bind(page);
    page.__classicTwitterJPNewsTest = true;

    page.fetch = async function(input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : input?.url || String(input || ''); } catch {}
      let parsed;
      try { parsed = new URL(url, location.href); } catch { return originalFetch(input, init); }

      if (parsed.hostname === 'api.tweet.app' && parsed.pathname === '/api/news/headlines') {
        const topic = parsed.searchParams.get('topic') || 'nation';
        const limit = parsed.searchParams.get('limit') || '10';
        try {
          const payload = await getJapaneseNews(topic, limit);
          const withImages = payload.articles.filter(article => article.image).length;
          const ResponseCtor = page.Response || Response;
          console.log(`🇯🇵 [Classic Twitter News Test] ${topic}: ${payload.articles.length} Japanese articles, ${withImages} images`);
          return new ResponseCtor(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        } catch (error) {
          console.warn('[Classic Twitter News Test] Japanese news failed, using tweet.app original feed.', error);
        }
      }
      return originalFetch(input, init);
    };

    console.log('🇯🇵 Classic Twitter Japanese News Test v0.2.0 installed');
  }

  install();
})();
