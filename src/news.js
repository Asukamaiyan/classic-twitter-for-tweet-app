  // Public Japanese publisher feeds. Native tweet.app requests are not intercepted.
  // The original news container remains intact and is restored on every failure.
  const ctNewsFeeds = Object.freeze({
    nation: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/domestic.xml' },
      { publisher: 'nhk', url: 'https://news.web.nhk/n-data/conf/na/rss/cat1.xml' }
    ]),
    sports: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/sports.xml' },
      { publisher: 'nikkan', url: 'https://www.nikkansports.com/sports/atom.xml' }
    ]),
    entertainment: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/entertainment.xml' },
      { publisher: 'nikkan', url: 'https://www.nikkansports.com/entertainment/atom.xml' }
    ]),
    technology: Object.freeze([
      { publisher: 'yahoo', url: 'https://news.yahoo.co.jp/rss/categories/it.xml' },
      { publisher: 'itmedia', url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml' }
    ])
  });
  const ctNewsPublishers = Object.freeze({ yahoo: 'Yahoo!ニュース', nhk: 'NHK NEWS WEB', nikkan: '日刊スポーツ', itmedia: 'ITmedia NEWS' });
  function ctNewsFeedList(topic) {
    ctNewsEnsureSourcePreferences();
    const selected = ctNewsState.sources[topic] || [];
    return (ctNewsFeeds[topic] || []).filter(feed => selected.includes(feed.publisher));
  }
  const ctNewsLabels = new Map([
    ['News', 'nation'], ['ニュース', 'nation'], ['Sports', 'sports'], ['スポーツ', 'sports'],
    ['Entertainment', 'entertainment'], ['エンタメ', 'entertainment'], ['エンターテインメント', 'entertainment'],
    ['Technology', 'technology'], ['テクノロジー', 'technology']
  ]);
  const ctNewsState = {
    region: null, mounts: new Map(), cache: new Map(), pending: new Map(), retryAt: new Map(),
    ttl: 15 * 60 * 1000, retryDelay: 60 * 1000, timeout: 10000,
    refreshTimer: null, refreshAt: 0, lifecycleBound: false, pageActive: true,
    sources: null, sourceRaw: null, sourceError: '', regionError: '', sourceMessages: new Map(),
    sourceGenerations: new Map(), failures: new Map()
  };
  const ctNewsPreferenceKey = 'ct-news-region-v1';
  const ctNewsCacheKey = 'ct-japanese-news-cache-v1';
  const ctNewsSourcesKey = 'ct-news-sources-v1';

  function ctNewsDefaultSources() {
    return Object.fromEntries(Object.entries(ctNewsFeeds).map(([topic, feeds]) => [topic, feeds.map(feed => feed.publisher)]));
  }
  function ctNewsParseSources(raw) {
    const defaults = ctNewsDefaultSources();
    if (raw === null) return defaults;
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('sources');
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !value.topics || typeof value.topics !== 'object' || Array.isArray(value.topics) ||
        Object.keys(value).some(key => key !== 'version' && key !== 'topics') ||
        Object.keys(value.topics).some(topic => !Object.hasOwn(ctNewsFeeds, topic))) throw new Error('sources');
    for (const [topic, selected] of Object.entries(value.topics)) {
      if (!Array.isArray(selected) || !selected.length || selected.length > ctNewsFeeds[topic].length ||
          new Set(selected).size !== selected.length || selected.some(id => !defaults[topic].includes(id))) throw new Error('sources');
      defaults[topic] = defaults[topic].filter(id => selected.includes(id));
    }
    return defaults;
  }
  function ctNewsEnsureSourcePreferences() {
    if (ctNewsState.sources !== null) return;
    ctNewsState.sources = ctNewsDefaultSources();
    try {
      ctNewsState.sourceRaw = localStorage.getItem(ctNewsSourcesKey);
      ctNewsState.sources = ctNewsParseSources(ctNewsState.sourceRaw);
    } catch {
      ctNewsState.sourceError = CT_LOCALE === 'ja' ? '配信元の設定を読み込めませんでした。既定の配信元を使っています。' :
        'Publisher settings could not be read. Using the default publishers.';
    }
  }
  function ctNewsSourceKey(topic) { return ctNewsFeedList(topic).map(feed => feed.publisher).join('|'); }
  function ctNewsInvalidateSources(topic) {
    ctNewsState.sourceGenerations.set(topic, (ctNewsState.sourceGenerations.get(topic) || 0) + 1);
    ctNewsState.cache.delete(topic); ctNewsState.retryAt.delete(topic); ctNewsState.failures.delete(topic);
    // The old reads still have bounded transport deadlines. Detach their job;
    // its generation guard prevents late completion from replacing this choice.
    ctNewsState.pending.delete(topic);
    for (const mount of ctNewsState.mounts.values()) if (mount.topic === topic) mount.loading = null;
    ctNewsCancelRefresh();
  }
  function ctNewsSetSource(topic, publisher, enabled) {
    ctNewsEnsureSourcePreferences();
    if (!Object.hasOwn(ctNewsFeeds, topic) || !ctNewsFeeds[topic].some(feed => feed.publisher === publisher)) return false;
    const selected = ctNewsState.sources[topic];
    const next = ctNewsFeeds[topic].map(feed => feed.publisher).filter(id => id === publisher ? enabled : selected.includes(id));
    if (!next.length) {
      ctNewsState.sourceMessages.set(topic, CT_LOCALE === 'ja' ? '配信元は最低1つ選択してください。最後の配信元はそのままにしました。' :
        'Select at least one publisher. The last publisher remains selected.');
      return false;
    }
    if (next.join('|') === selected.join('|')) return true;
    try {
      if (localStorage.getItem(ctNewsSourcesKey) !== ctNewsState.sourceRaw) {
        ctNewsState.sourceError = CT_LOCALE === 'ja' ? '別のタブで配信元の設定が変わりました。再読み込みしてから変更してください。' :
          'Publisher settings changed in another tab. Reload before changing them.';
        return false;
      }
      const sources = { ...ctNewsState.sources, [topic]: next };
      const raw = JSON.stringify({ version: 1, topics: sources });
      localStorage.setItem(ctNewsSourcesKey, raw);
      ctNewsState.sources = sources; ctNewsState.sourceRaw = raw;
      ctNewsState.sourceError = ''; ctNewsState.sourceMessages.delete(topic);
      ctNewsInvalidateSources(topic);
      return true;
    } catch {
      ctNewsState.sourceError = CT_LOCALE === 'ja' ? '配信元の設定を保存できませんでした。選択は変更していません。' :
        'Publisher settings could not be saved. Your selection has not changed.';
      return false;
    }
  }
  function ctNewsSourceFailureText(publishers, partial) {
    const names = publishers.map(id => ctNewsPublishers[id]).filter(Boolean).join('・');
    const ja = CT_LOCALE === 'ja';
    const hint = typeof CT_PLATFORM !== 'undefined' && CT_PLATFORM === 'safari' ?
      ja ? ' Safariのページメニュー → Stayで、表示された配信元のサイト許可も確認してください。' :
        ' Also check any publisher site permissions shown in Safari’s page menu → Stay.' : '';
    return (ja ? `取得できない配信元: ${names}。${partial ? '一部取得できませんでした。取得済みのニュースを表示しています。' : '世界のニュースを表示しています。'}` :
      `Unavailable publishers: ${names}. ${partial ? 'Some publishers are unavailable. Showing retrieved news.' : 'Showing world news.'}`) + hint;
  }

  function ctNewsText(value, max = 512) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
  function ctNewsURL(value, kind = 'article') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
      if (kind === 'feed') return Object.values(ctNewsFeeds).flat().some(feed => feed.url === url.href) ? url.href : null;
      if (kind === 'image') {
        // Yahoo's feed images are served by its public image CDN. Never accept
        // arbitrary feed-supplied URLs (localhost, data URLs, credentials, etc.).
        return /^(?:[a-z0-9-]+\.)*yimg\.(?:jp|com)$/.test(url.hostname) ||
          url.hostname === 'www.nikkansports.com' && /^\/[a-z0-9_-]+\/(?:[a-z0-9_-]+\/)?news\/img\/[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? url.href : null;
      }
      return url.hostname === 'news.yahoo.co.jp' && /^\/(?:articles|pickup|expert\/articles)\//.test(url.pathname) ||
        url.hostname === 'news.web.nhk' && /^\/newsweb\/na\/[a-z0-9-]+\/?$/i.test(url.pathname) ||
        url.hostname === 'www.nikkansports.com' && /^\/[a-z0-9_-]+\/(?:[a-z0-9_-]+\/)?news\/\d+\.html$/.test(url.pathname) ||
        url.hostname === 'www.itmedia.co.jp' && /^\/news\/(?:articles|article)\//.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  function ctNewsArticle(value, expectedPublisher) {
    if (!value || typeof value !== 'object') return null;
    const title = ctNewsText(value.title);
    const url = ctNewsURL(value.url);
    if (!title || !url) return null;
    const hostname = new URL(url).hostname;
    const publisher = { 'news.yahoo.co.jp': 'yahoo', 'news.web.nhk': 'nhk',
      'www.nikkansports.com': 'nikkan', 'www.itmedia.co.jp': 'itmedia' }[hostname];
    if (expectedPublisher && publisher !== expectedPublisher) return null;
    const image = ctNewsURL(value.image, 'image') || '';
    const samePublisherImage = publisher === 'yahoo' ? image && /\.yimg\.(?:jp|com)$/.test(new URL(image).hostname) :
      publisher === 'nikkan' ? image && new URL(image).hostname === hostname : false;
    const date = Date.parse(value.publishedAt);
    return {
      title, url, image: samePublisherImage ? image : '',
      source: ctNewsPublishers[publisher], publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : ''
    };
  }
  function ctParseJapaneseNews(xml, publisher = 'yahoo') {
    if (typeof xml !== 'string' || !xml || xml.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const root = doc.documentElement;
    const atom = root?.localName === 'feed' && root.namespaceURI === 'http://www.w3.org/2005/Atom';
    const channel = root?.localName === 'rss' && [...root.children].find(el => el.localName === 'channel');
    if (!atom && !channel || !Object.hasOwn(ctNewsPublishers, publisher)) return [];
    const seen = new Set();
    const articles = [];
    const items = [...(atom ? root : channel).children].filter(el => el.localName === (atom ? 'entry' : 'item') &&
      (!atom || el.namespaceURI === root.namespaceURI));
    for (const item of items.slice(0, 50)) {
      const childText = name => [...item.children].find(el => el.localName === name)?.textContent || '';
      const imageElement = [...item.children].find(el => el.localName === 'image');
      const mediaElement = [...item.children].find(el =>
        (el.localName === 'thumbnail' || el.localName === 'content') &&
        el.namespaceURI === 'http://search.yahoo.com/mrss/');
      const enclosure = [...item.children].find(el => el.localName === 'enclosure' && /^image\//.test(el.getAttribute('type') || ''));
      const atomLink = atom ? [...item.children].find(el => el.localName === 'link' &&
        el.namespaceURI === root.namespaceURI && (!el.hasAttribute('rel') || el.getAttribute('rel') === 'alternate')) : null;
      const atomImage = atom ? [...item.children].find(el => el.localName === 'link' &&
        el.namespaceURI === root.namespaceURI && el.getAttribute('rel') === 'enclosure' && /^image\//.test(el.getAttribute('type') || '')) : null;
      const imageValue = imageElement?.querySelector('url')?.textContent || imageElement?.textContent ||
        mediaElement?.getAttribute('url') || enclosure?.getAttribute('url') || atomImage?.getAttribute('href') || '';
      const article = ctNewsArticle({ title: childText('title'), url: atom ? atomLink?.getAttribute('href')?.trim() : childText('link').trim(),
        image: imageValue.trim(), publishedAt: childText(atom ? 'published' : 'pubDate') || (atom ? childText('updated') : '') }, publisher);
      if (!article || seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
      if (articles.length >= 10) break;
    }
    return articles;
  }
  function ctRequestNews(url) {
    const target = ctNewsURL(url, 'feed');
    if (!target) return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false;
      let handle;
      const aborter = typeof AbortController === 'function' ? new AbortController() : null;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        finish(null);
        try { handle?.abort?.(); } catch {}
        try { aborter?.abort(); } catch {}
      }, ctNewsState.timeout);
      const parse = response => {
        try {
          if (!(response?.status >= 200 && response.status < 300)) return null;
          // Stay exposes responseURL in its bridge; Tampermonkey uses finalUrl.
          // Compare canonical feed URLs and reject either field if it disagrees.
          for (const value of [response.finalUrl, response.responseURL]) {
            if (value && ctNewsURL(value, 'feed') !== target) return null;
          }
          let text;
          // An XHR responseText getter can throw for a non-text response. Stay's
          // older text bridge also returns null here while response is a string.
          try { text = response.responseText; } catch {}
          if (typeof text !== 'string') text = response.response;
          return typeof text === 'string' && text.length <= 1024 * 1024 ? text : null;
        } catch { return null; }
      };
      let request = null;
      if (typeof GM_xmlhttpRequest === 'function') request = GM_xmlhttpRequest;
      else {
        // Some managers expose GM as a sandbox binding rather than a property
        // on globalThis. Losing that API falls through to a CORS-blocked fetch.
        const gm = typeof GM !== 'undefined' ? GM : globalThis.GM;
        if (typeof gm?.xmlHttpRequest === 'function') request = gm.xmlHttpRequest.bind(gm);
      }
      if (request) {
        try {
          handle = request({ method: 'GET', url: target, anonymous: true, redirect: 'error', responseType: 'text',
            timeout: ctNewsState.timeout, headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
            onload: response => finish(parse(response)),
            // Stay's public Safari bridge removes its per-request message
            // listener only when an onloadend callback is registered. Accept a
            // final loadend as well, without replacing an earlier completion.
            onloadend: response => finish(parse(response)), onerror: () => finish(null),
            ontimeout: () => finish(null), onabort: () => finish(null) });
          if (handle && typeof handle.then === 'function') Promise.resolve(handle).then(response => {
            // A mobile bridge can resolve its request receipt before onload.
            // Wait for a real response or the bounded callback/timeout instead.
            try {
              const status = Number(response?.status);
              if (Number.isFinite(status) && status > 0 &&
                  (response.readyState == null || Number(response.readyState) === 4)) finish(parse(response));
            } catch { finish(null); }
          }, () => finish(null));
        } catch { finish(null); }
        return;
      }
      if (typeof fetch !== 'function') return finish(null);
      Promise.resolve().then(() => fetch(target, { method: 'GET', credentials: 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', ...(aborter ? { signal: aborter.signal } : {}) }))
        .then(async response => {
          if (!response?.ok || (response.url && ctNewsURL(response.url, 'feed') !== target)) return null;
          const value = await response.text();
          return value.length <= 1024 * 1024 ? value : null;
        }).then(finish, () => finish(null));
    });
  }
  function ctNewsReadCache() {
    try {
      const stored = sessionStorage.getItem(ctNewsCacheKey);
      if (!stored || stored.length > 128 * 1024) return;
      const cache = JSON.parse(stored);
      for (const topic of Object.keys(ctNewsFeeds)) {
        const entry = cache?.[topic];
        const feeds = ctNewsFeedList(topic), sourceKey = ctNewsSourceKey(topic);
        const defaultSelection = ctNewsState.sources[topic].length === ctNewsFeeds[topic].length;
        if (!entry || entry.loading || entry.feedCount !== ctNewsFeedList(topic).length || !Number.isFinite(entry.at) || entry.at > Date.now() ||
            Date.now() - entry.at >= ctNewsState.ttl || !Array.isArray(entry.articles) ||
            (entry.sourceKey !== sourceKey && (entry.sourceKey !== undefined || !defaultSelection))) continue;
        const articles = entry.articles.slice(0, 10).map(article => ctNewsArticle(article)).filter(article =>
          article && feeds.some(feed => article.source === ctNewsPublishers[feed.publisher]));
        const failed = Array.isArray(entry.failed) ? entry.failed.filter(id => feeds.some(feed => feed.publisher === id)) : [];
        if (articles.length) ctNewsState.cache.set(topic, { at: entry.at, articles, failed, sourceKey, feedCount: entry.feedCount, loading: false });
      }
    } catch {}
  }
  async function ctLoadJapaneseNews(topic) {
    if (!Object.hasOwn(ctNewsFeeds, topic)) return null;
    const sourceKey = ctNewsSourceKey(topic);
    const cached = ctNewsState.cache.get(topic);
    if (cached?.sourceKey === sourceKey && Date.now() >= cached.at && Date.now() - cached.at < ctNewsState.ttl) return cached.articles;
    if (ctNewsState.pending.has(topic)) return ctNewsState.pending.get(topic);
    if ((ctNewsState.retryAt.get(topic) || 0) > Date.now()) return null;
    const generation = ctNewsState.sourceGenerations.get(topic) || 0;
    const current = () => generation === (ctNewsState.sourceGenerations.get(topic) || 0) && sourceKey === ctNewsSourceKey(topic);
    const pending = (async () => {
      const feeds = ctNewsFeedList(topic);
      const batches = feeds.map(() => []);
      ctNewsState.failures.delete(topic);
      // Start each publisher together. A slow or failed Yahoo request must not
      // hold the other publisher's usable headlines behind its timeout.
      await Promise.all(feeds.map(async (feed, index) => {
        try {
          const xml = await ctRequestNews(feed.url);
          if (!current()) return;
          batches[index] = ctParseJapaneseNews(xml, feed.publisher);
        } catch { batches[index] = []; }
        if (!current() || !batches[index].length) return;
        const articles = ctNewsMergeArticles(batches);
        ctNewsState.cache.set(topic, { at: Date.now(), articles, loading: true, failed: [], sourceKey, feedCount: feeds.length });
        patchJapaneseNews();
      }));
      if (!current()) return null;
      const entry = ctNewsState.cache.get(topic);
      if (!batches.some(batch => batch.length)) {
        ctNewsState.failures.set(topic, { sourceKey, publishers: feeds.map(feed => feed.publisher) });
        ctNewsState.retryAt.set(topic, Date.now() + ctNewsState.retryDelay);
        return null;
      }
      ctNewsState.retryAt.delete(topic);
      entry.loading = false;
      entry.failed = feeds.filter((feed, index) => !batches[index].length).map(feed => feed.publisher);
      try { sessionStorage.setItem(ctNewsCacheKey, JSON.stringify(Object.fromEntries([...ctNewsState.cache].filter(([key, cached]) =>
        !cached.loading && cached.sourceKey === ctNewsSourceKey(key))))); } catch {}
      return entry.articles;
    })().finally(() => { if (ctNewsState.pending.get(topic) === pending) ctNewsState.pending.delete(topic); });
    ctNewsState.pending.set(topic, pending);
    return pending;
  }
  function ctNewsMergeArticles(batches) {
    const seen = new Set(), articles = [];
    // Give each successful publisher room, even when another has more items.
    for (let index = 0; index < 10 && articles.length < 10; index++) {
      for (const batch of batches) {
        const article = batch[index];
        if (!article || seen.has(article.url)) continue;
        seen.add(article.url); articles.push(article);
        if (articles.length === 10) break;
      }
    }
    return articles.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  }
  function ctNewsVisible(element) {
    return element?.isConnected && !element.closest('[hidden],[aria-hidden="true"]');
  }
  function ctNewsTargets() {
    if (!/^\/feed\/?$/.test(location.pathname)) return [];
    const targets = [];
    for (const header of document.querySelectorAll('main > div.w-full.min-w-0.flex.flex-col > div.sticky')) {
      if (!ctNewsVisible(header)) continue;
      const tabs = header.querySelector('div.overflow-x-auto');
      if (!tabs) continue;
      const buttons = [...tabs.children].filter(el => el.matches('button.rounded-full.whitespace-nowrap'));
      const topics = new Set(buttons.map(el => ctNewsLabels.get(ctNewsText(el.textContent))).filter(Boolean));
      if (topics.size !== 4) continue;
      const active = buttons.find(el => el.classList.contains('bg-sky-500') && el.classList.contains('text-white'));
      const topic = ctNewsLabels.get(ctNewsText(active?.textContent));
      if (!topic) continue;
      const container = header.parentElement.lastElementChild;
      // Verified native Whe layout: the final direct div is the news/feed body.
      // Never hide a composer, header, or a subtree containing another control.
      if (!container || container === header || container.tagName !== 'DIV' || container.hasAttribute('data-ct-local-ui') ||
          container.querySelector('textarea,input,article,[contenteditable="true"]')) continue;
      targets.push({ header, container, topic });
    }
    return targets;
  }
  function ctNewsCancelRefresh() {
    clearTimeout(ctNewsState.refreshTimer);
    ctNewsState.refreshTimer = null;
    ctNewsState.refreshAt = 0;
  }
  function ctNewsScheduleRefresh() {
    // A static news page produces no mutation to trigger the normal scan. Keep
    // one deadline for its visible topic; never poll the whole application.
    if (!ctNewsState.pageActive || document.hidden || ctNewsState.region !== 'jp') {
      ctNewsCancelRefresh(); return;
    }
    const now = Date.now();
    let deadline = Infinity;
    for (const target of ctNewsTargets()) {
      if (!ctNewsState.mounts.has(target.container) || ctNewsState.pending.has(target.topic)) continue;
      const cached = ctNewsState.cache.get(target.topic);
      const expires = cached && now >= cached.at && now - cached.at < ctNewsState.ttl
        ? cached.at + ctNewsState.ttl : ctNewsState.retryAt.get(target.topic);
      if (expires > now) deadline = Math.min(deadline, expires);
    }
    if (!Number.isFinite(deadline)) { ctNewsCancelRefresh(); return; }
    if (ctNewsState.refreshTimer !== null && ctNewsState.refreshAt === deadline) return;
    ctNewsCancelRefresh();
    ctNewsState.refreshAt = deadline;
    ctNewsState.refreshTimer = setTimeout(() => {
      ctNewsState.refreshTimer = null;
      ctNewsState.refreshAt = 0;
      // Recheck the native tab/route before requesting or hiding any content.
      patchJapaneseNews();
    }, deadline - now);
  }
  function ctNewsBindLifecycle() {
    if (ctNewsState.lifecycleBound) return;
    ctNewsState.lifecycleBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctNewsCancelRefresh();
      else if (ctNewsState.pageActive) patchJapaneseNews();
    });
    window.addEventListener('pagehide', () => {
      ctNewsState.pageActive = false;
      ctNewsCancelRefresh();
    });
    window.addEventListener('pageshow', () => {
      ctNewsState.pageActive = true;
      patchJapaneseNews();
    });
    window.addEventListener('storage', event => {
      if (event.key !== ctNewsSourcesKey && event.key !== null) return;
      ctNewsEnsureSourcePreferences();
      try {
        const raw = localStorage.getItem(ctNewsSourcesKey);
        if (raw === ctNewsState.sourceRaw) return;
        const sources = ctNewsParseSources(raw);
        for (const topic of Object.keys(ctNewsFeeds)) {
          if (sources[topic].join('|') !== ctNewsState.sources[topic].join('|')) ctNewsInvalidateSources(topic);
        }
        ctNewsState.sources = sources; ctNewsState.sourceRaw = raw; ctNewsState.sourceError = '';
        ctNewsState.sourceMessages.clear();
      } catch {
        ctNewsState.sourceError = CT_LOCALE === 'ja' ? '別のタブの配信元の設定を読み込めませんでした。現在の選択を保持しています。' :
          'Publisher settings from another tab could not be read. Keeping your current selection.';
      }
      patchJapaneseNews();
    });
  }
  function ctNewsSetText(node, text) { if (node.textContent !== text) node.textContent = text; }
  function ctNewsUnhide(mount) {
    if (mount.container.classList.contains('ct-news-native-hidden')) mount.container.classList.remove('ct-news-native-hidden');
  }
  function ctNewsRefreshSources(mount) {
    const ja = CT_LOCALE === 'ja';
    const japan = ctNewsState.region === 'jp';
    if (mount.sources.hidden === japan) mount.sources.hidden = !japan;
    if (mount.sourceTopic !== mount.topic) {
      const topics = ja ? { nation: '国内ニュース', sports: 'スポーツ', entertainment: 'エンタメ', technology: 'IT' } :
        { nation: 'National news', sports: 'Sports', entertainment: 'Entertainment', technology: 'Technology' };
      const legend = document.createElement('legend');
      legend.textContent = ja ? `${topics[mount.topic]}の配信元` : `Publishers for ${topics[mount.topic]}`;
      const help = document.createElement('p'); help.className = 'ct-news-source-help';
      help.textContent = ja ? 'このジャンルのRSSから取得します。最低1つ選択してください。' :
        'Uses each publisher’s feed for this topic. Select at least one.';
      const children = [legend, help];
      for (const feed of ctNewsFeeds[mount.topic]) {
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox';
        input.dataset.ctNewsPublisher = feed.publisher;
        const topic = mount.topic;
        input.addEventListener('change', () => {
          // A detached selector must not change another native topic's setting.
          const current = ctNewsTargets().find(target => target.container === mount.container && target.topic === topic);
          if (current && ctNewsState.mounts.get(mount.container) === mount && ctNewsState.region === 'jp' &&
              ctNewsState.pageActive && !document.hidden) ctNewsSetSource(topic, feed.publisher, input.checked);
          patchJapaneseNews();
        });
        label.append(input, document.createTextNode(ctNewsPublishers[feed.publisher]));
        children.push(label);
      }
      mount.sourceFields.replaceChildren(...children);
      mount.sourceTopic = mount.topic;
    }
    for (const input of mount.sourceFields.querySelectorAll('input[data-ct-news-publisher]')) {
      const checked = ctNewsState.sources[mount.topic].includes(input.dataset.ctNewsPublisher);
      if (input.checked !== checked) input.checked = checked;
    }
    ctNewsSetText(mount.notice, [ctNewsState.regionError, ctNewsState.sourceError, ctNewsState.sourceMessages.get(mount.topic)].filter(Boolean).join(' '));
  }
  function ctNewsMakeMount(target) {
    const ja = CT_LOCALE === 'ja';
    const panel = document.createElement('section');
    panel.className = 'ct-japanese-news';
    panel.dataset.ctLocalUi = 'japanese-news';
    panel.setAttribute('aria-label', ja ? 'ニュースの地域' : 'News region');
    const controls = document.createElement('div');
    controls.className = 'ct-news-controls';
    const japan = document.createElement('button');
    japan.type = 'button'; japan.textContent = ja ? '日本' : 'Japan';
    japan.dataset.ctNewsRegion = 'jp';
    const world = document.createElement('button');
    world.type = 'button'; world.textContent = ja ? '世界' : 'World';
    world.dataset.ctNewsRegion = 'world';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = ja ? '再試行' : 'Retry';
    retry.dataset.ctNewsAction = 'retry'; retry.hidden = true;
    controls.append(japan, world, retry);
    const notice = document.createElement('p'); notice.className = 'ct-news-preference-status';
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    const sources = document.createElement('details'); sources.className = 'ct-news-sources';
    const summary = document.createElement('summary'); summary.textContent = ja ? '配信元' : 'Publishers';
    const sourceFields = document.createElement('fieldset'); sources.append(summary, sourceFields);
    const status = document.createElement('p');
    status.className = 'ct-news-status';
    status.setAttribute('role', 'status');
    const list = document.createElement('div');
    list.className = 'ct-news-list';
    panel.append(controls, notice, sources, status, list);
    target.container.before(panel);
    const mount = { ...target, panel, status, list, japan, world, retry, notice, sources, sourceFields,
      sourceTopic: null, rendered: null, loading: null };
    for (const button of [japan, world]) button.addEventListener('click', () => {
      try {
        localStorage.setItem(ctNewsPreferenceKey, button.dataset.ctNewsRegion);
        ctNewsState.region = button.dataset.ctNewsRegion; ctNewsState.regionError = '';
      } catch {
        ctNewsState.regionError = ja ? 'ニュースの地域を保存できませんでした。選択は変更していません。' :
          'News region could not be saved. Your selection has not changed.';
      }
      patchJapaneseNews();
    });
    retry.addEventListener('click', () => {
      if (!ctNewsState.pageActive || document.hidden || ctNewsState.region !== 'jp' ||
          ctNewsState.mounts.get(mount.container) !== mount || !mount.panel.isConnected) return;
      const current = ctNewsTargets().find(target => target.container === mount.container && target.topic === mount.topic);
      if (!current || ctNewsState.pending.has(current.topic)) return;
      // Explicit retry may bypass the failure delay, never a pending request.
      ctNewsState.retryAt.delete(current.topic);
      ctNewsState.cache.delete(current.topic);
      ctNewsState.failures.delete(current.topic);
      patchJapaneseNews();
    });
    return mount;
  }
  function ctNewsRenderArticles(mount, articles) {
    if (mount.rendered === articles) return;
    mount.rendered = articles;
    const fragment = document.createDocumentFragment();
    for (const article of articles) {
      const link = document.createElement('a');
      link.className = 'ct-news-article'; link.href = article.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (article.image) {
        const img = document.createElement('img');
        img.src = article.image; img.alt = ''; img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        // No made-up picture when a source thumbnail disappears.
        img.addEventListener('error', () => { img.hidden = true; });
        link.append(img);
      }
      const title = document.createElement('h3'); title.textContent = article.title;
      const source = document.createElement('p');
      source.className = 'ct-news-source'; source.textContent = article.source;
      if (article.publishedAt) {
        const time = document.createElement('time');
        time.dateTime = article.publishedAt;
        time.textContent = new Date(article.publishedAt).toLocaleString(CT_LOCALE === 'ja' ? 'ja-JP' : 'en-US', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        source.append(document.createTextNode(' · '), time);
      }
      link.append(title, source); fragment.append(link);
    }
    mount.list.replaceChildren(fragment);
  }
  function ctNewsRefreshMount(mount) {
    const ja = CT_LOCALE === 'ja';
    const japan = ctNewsState.region === 'jp';
    ctNewsRefreshSources(mount);
    for (const button of [mount.japan, mount.world]) {
      const selected = button.dataset.ctNewsRegion === ctNewsState.region;
      const value = String(selected);
      if (button.getAttribute('aria-pressed') !== value) button.setAttribute('aria-pressed', value);
    }
    if (!japan) {
      if (!mount.retry.hidden) mount.retry.hidden = true;
      ctNewsUnhide(mount);
      if (!mount.list.hidden) mount.list.hidden = true;
      ctNewsSetText(mount.status, '');
      return;
    }
    const cached = ctNewsState.cache.get(mount.topic);
    if (cached?.sourceKey === ctNewsSourceKey(mount.topic) && Date.now() >= cached.at && Date.now() - cached.at < ctNewsState.ttl) {
      const partial = !cached.loading && cached.failed?.length > 0;
      if (mount.retry.hidden === partial) mount.retry.hidden = !partial;
      ctNewsRenderArticles(mount, cached.articles);
      if (mount.list.hidden) mount.list.hidden = false;
      if (!mount.container.classList.contains('ct-news-native-hidden')) mount.container.classList.add('ct-news-native-hidden');
      const sources = [...new Set(cached.articles.map(article => article.source))].join('・');
      const suffix = cached.loading ? ja ? ' · 他の配信元を読み込み中…' : ' · Loading another publisher…' :
        partial ? ' · ' + ctNewsSourceFailureText(cached.failed, true) :
        ja ? ' · 見出しを押すと記事が開きます' : ' · Open a headline to read the article';
      ctNewsSetText(mount.status, sources + suffix);
      return;
    }
    // Already-started requests may finish in the background. Their completion
    // must not start another request until the page is visible again.
    if (!ctNewsState.pageActive || document.hidden) return;
    ctNewsUnhide(mount);
    if (!mount.list.hidden) mount.list.hidden = true;
    if ((ctNewsState.retryAt.get(mount.topic) || 0) > Date.now()) {
      if (mount.retry.hidden) mount.retry.hidden = false;
      const failure = ctNewsState.failures.get(mount.topic);
      const failed = failure?.sourceKey === ctNewsSourceKey(mount.topic) ? failure.publishers : ctNewsFeedList(mount.topic).map(feed => feed.publisher);
      ctNewsSetText(mount.status, ctNewsSourceFailureText(failed, false));
      return;
    }
    if (!mount.retry.hidden) mount.retry.hidden = true;
    ctNewsSetText(mount.status, ja ? '日本のニュースを読み込み中…' : 'Loading Japanese news…');
    const topic = mount.topic;
    const loading = `${topic}:${ctNewsState.sourceGenerations.get(topic) || 0}:${ctNewsSourceKey(topic)}`;
    if (mount.loading === loading) return;
    mount.loading = loading;
    ctLoadJapaneseNews(topic).finally(() => {
      if (mount.loading === loading) mount.loading = null;
      if (mount.panel.isConnected && ctNewsState.mounts.get(mount.container) === mount) patchJapaneseNews();
    });
  }
  function patchJapaneseNews() {
    ctNewsBindLifecycle();
    ctNewsEnsureSourcePreferences();
    if (ctNewsState.region === null) {
      let value;
      try { value = localStorage.getItem(ctNewsPreferenceKey); } catch {}
      ctNewsState.region = value === 'jp' || value === 'world' ? value : CT_LOCALE === 'ja' ? 'jp' : 'world';
      ctNewsReadCache();
    }
    const targets = ctNewsTargets();
    const containers = new Set(targets.map(target => target.container));
    for (const [container, mount] of ctNewsState.mounts) {
      if (!containers.has(container) || !mount.panel.isConnected) {
        ctNewsUnhide(mount); mount.panel.remove(); ctNewsState.mounts.delete(container);
      }
    }
    if (!targets.length) { ctNewsCancelRefresh(); return; }
    if (!document.getElementById('ct-japanese-news-style')) {
      const style = document.createElement('style'); style.id = 'ct-japanese-news-style';
      style.textContent = `.ct-news-native-hidden{display:none!important}.ct-news-controls{display:flex;gap:8px;padding:12px 16px 4px}.ct-news-controls button{min-height:44px;border:1px solid var(--color-tl-app-border,#ccd6dd);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:5px 14px;cursor:pointer}.ct-news-controls button[aria-pressed="true"]{background:#1d9bf0;border-color:#1d9bf0;color:#fff}.ct-news-controls button:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}.ct-news-status{margin:0;padding:4px 16px 10px;font-size:12px;line-height:1.5;color:inherit;opacity:.72}.ct-news-status:empty,.ct-news-preference-status:empty{display:none}.ct-news-preference-status{margin:0;padding:4px 16px;font-size:12px;line-height:1.5;color:var(--color-tl-app-danger,#c23636)}.ct-news-sources{padding:0 16px;font-size:13px}.ct-news-sources[hidden]{display:none}.ct-news-sources summary{display:flex;align-items:center;gap:6px;min-height:44px;cursor:pointer;width:fit-content;color:var(--color-tl-app-text-muted,#536471)}.ct-news-sources summary:before{content:"›";font-size:18px;line-height:1}.ct-news-sources[open] summary:before{transform:rotate(90deg)}.ct-news-sources summary:focus-visible,.ct-news-sources input:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}.ct-news-sources fieldset{margin:0;padding:0 0 8px;border:0;min-width:0}.ct-news-sources legend{font-weight:700}.ct-news-source-help{margin:4px 0;line-height:1.5;color:var(--color-tl-app-text-muted,#536471)}.ct-news-sources label{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer;overflow-wrap:anywhere}.ct-news-sources input{width:18px;height:18px;accent-color:#1d9bf0;margin:0;flex-shrink:0}.ct-news-article{display:block;padding:12px 16px;border-bottom:1px solid var(--color-tl-app-border,#ccd6dd);color:inherit;text-decoration:none}.ct-news-article:hover{background:rgba(127,127,127,.06)}.ct-news-article img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px;border:1px solid var(--color-tl-app-border,#ccd6dd)}.ct-news-article img[hidden]{display:none}.ct-news-article h3{font-size:17px;line-height:1.4;font-weight:700;margin:12px 0 6px}.ct-news-source{margin:0;font-size:13px;line-height:1.5;opacity:.7}.ct-news-list[hidden]{display:none}`;
      (document.head || document.documentElement).append(style);
    }
    for (const target of targets) {
      let mount = ctNewsState.mounts.get(target.container);
      if (!mount) {
        mount = ctNewsMakeMount(target);
        ctNewsState.mounts.set(target.container, mount);
      }
      mount.topic = target.topic;
      ctNewsRefreshMount(mount);
    }
    ctNewsScheduleRefresh();
  }
