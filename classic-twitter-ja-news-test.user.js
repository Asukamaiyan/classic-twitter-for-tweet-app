// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese News Test
// @namespace    https://tweet.app/
// @version      0.1.0-test
// @description  Experimental Chrome/Tampermonkey test: replace tweet.app Explore news with Google News Japan RSS. Install alongside the Japanese Classic Twitter userscript.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      news.google.com
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function googleNewsRSS(topic) {
    const base = 'https://news.google.com/rss';
    const suffix = 'hl=ja&gl=JP&ceid=JP:ja';

    if (topic === 'sports') {
      return `${base}/search?q=${encodeURIComponent('スポーツ')}&${suffix}`;
    }

    if (topic === 'entertainment') {
      return `${base}/search?q=${encodeURIComponent('エンタメ OR 芸能')}&${suffix}`;
    }

    if (topic === 'technology') {
      return `${base}/search?q=${encodeURIComponent('テクノロジー OR IT')}&${suffix}`;
    }

    return `${base}?${suffix}`;
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 12000,
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml, */*'
        },
        onload: response => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(new Error(`Google News RSS HTTP ${response.status}`));
          }
        },
        onerror: () => reject(new Error('Google News RSS network error')),
        ontimeout: () => reject(new Error('Google News RSS timeout'))
      });
    });
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    return clean(doc.body?.textContent || '');
  }

  async function getJapaneseNews(topic, limit) {
    const xml = await requestText(googleNewsRSS(topic));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');

    if (doc.querySelector('parsererror')) {
      throw new Error('Invalid Google News RSS');
    }

    const max = Math.max(1, Math.min(Number(limit) || 10, 20));
    const articles = [...doc.querySelectorAll('item')]
      .slice(0, max)
      .map(item => {
        const rawTitle = clean(item.querySelector('title')?.textContent || '');
        const source = clean(item.querySelector('source')?.textContent || '');
        const link = clean(item.querySelector('link')?.textContent || '');
        const description = htmlToText(item.querySelector('description')?.textContent || '');
        const pubDate = clean(item.querySelector('pubDate')?.textContent || '');

        let title = rawTitle;
        if (source && title.endsWith(` - ${source}`)) {
          title = title.slice(0, -(` - ${source}`).length).trim();
        }

        let publishedAt = new Date().toISOString();
        if (pubDate) {
          const date = new Date(pubDate);
          if (!Number.isNaN(date.getTime())) {
            publishedAt = date.toISOString();
          }
        }

        return {
          id: `${link}::${title}`,
          title,
          description,
          url: link,
          image: '',
          source,
          publishedAt
        };
      })
      .filter(article => article.title && article.url);

    return {
      success: true,
      topic,
      articles
    };
  }

  function install() {
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (!page?.fetch || page.__classicTwitterJPNewsTest) {
      return;
    }

    const originalFetch = page.fetch.bind(page);
    page.__classicTwitterJPNewsTest = true;

    page.fetch = async function(input, init) {
      let url = '';

      try {
        url = typeof input === 'string'
          ? input
          : input?.url || String(input || '');
      } catch {}

      let parsed;
      try {
        parsed = new URL(url, location.href);
      } catch {
        return originalFetch(input, init);
      }

      if (
        parsed.hostname === 'api.tweet.app' &&
        parsed.pathname === '/api/news/headlines'
      ) {
        const topic = parsed.searchParams.get('topic') || 'nation';
        const limit = parsed.searchParams.get('limit') || '10';

        try {
          const payload = await getJapaneseNews(topic, limit);
          const ResponseCtor = page.Response || Response;

          console.log(
            `🇯🇵 [Classic Twitter News Test] ${topic}: ${payload.articles.length} Japanese articles`
          );

          return new ResponseCtor(JSON.stringify(payload), {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8'
            }
          });
        } catch (error) {
          console.warn(
            '[Classic Twitter News Test] Japanese news failed, using tweet.app original feed.',
            error
          );
        }
      }

      return originalFetch(input, init);
    };

    console.log('🇯🇵 Classic Twitter Japanese News Test installed');
  }

  install();
})();
