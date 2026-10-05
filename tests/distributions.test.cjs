const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const distributions = require('../scripts/distributions.cjs');
const releaseVersion = require('../package.json').version;

function closeFixture(dom) {
  // JSDOM deletes document without firing pagehide. Run the normal lifecycle
  // cleanup before close can queue mutations against the discarded window.
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  dom.window.close();
}

test('six editions preserve existing identifiers and share their platform implementation', () => {
  assert.deepEqual(distributions.map(({ file }) => file), [
    'classic-twitter-ja.user.js', 'classic-twitter-ja-safari.user.js', 'classic-twitter-ja-android.user.js',
    'classic-twitter-en.user.js', 'classic-twitter-en-safari.user.js', 'classic-twitter-en-android.user.js'
  ]);
  assert.equal(new Set(distributions.map(({ file }) => file)).size, 6);
  const expectedNames = {
    'classic-twitter-ja.user.js': 'Classic Twitter for tweet.app - Japanese',
    'classic-twitter-ja-safari.user.js': 'Classic Twitter for tweet.app - Japanese',
    'classic-twitter-ja-android.user.js': 'Classic Twitter for tweet.app - Japanese Android',
    'classic-twitter-en.user.js': 'Classic Twitter for tweet.app - English',
    'classic-twitter-en-safari.user.js': 'Classic Twitter for tweet.app - English Safari',
    'classic-twitter-en-android.user.js': 'Classic Twitter for tweet.app - English Android'
  };
  for (const { file, locale, platform } of distributions) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(source.match(/^\/\/ @name\s+(.+)$/m)?.[1], expectedNames[file]);
    assert.equal(source.match(/^\/\/ @namespace\s+(.+)$/m)?.[1], 'https://tweet.app/');
    assert.equal(source.match(/^\/\/ @version\s+(.+)$/m)?.[1], releaseVersion);
    assert.match(source, new RegExp(`const CT_LOCALE = '${locale}'`));
    for (const host of ['news.yahoo.co.jp', 'news.web.nhk', 'www.nikkansports.com', 'rss.itmedia.co.jp']) {
      assert.equal(source.includes(`// @connect      ${host}`), true, 'each publisher uses an explicit public feed permission');
    }
    assert.doesNotMatch(source, /\/\* @(?:include|safari-grants)/);
    assert.equal(source.includes('function ctShowMediaInfo('), platform === 'safari', 'both Safari locales include the same media tools');
    for (const domain of ['firebasestorage.googleapis.com', 'storage.googleapis.com']) {
      assert.equal(source.includes(`// @connect      ${domain}`), platform === 'safari');
    }
    if (platform === 'android') {
      const desktop = fs.readFileSync(path.join(root, `classic-twitter-${locale}.user.js`), 'utf8');
      const withoutName = code => code.replace(/^\/\/ @name\s+.*$/m, '');
      assert.equal(withoutName(source), withoutName(desktop), 'Android uses the verified common core without a divergent copy');
    }
  }
});

for (const { beforeReady, firstFile, locale } of [
  { beforeReady: true, firstFile: 'classic-twitter-en-safari.user.js', locale: 'en' },
  { beforeReady: false, firstFile: 'classic-twitter-ja-android.user.js', locale: 'ja' }
]) {
  test(`mixed editions ${beforeReady ? 'before DOMContentLoaded' : 'on a ready page'} start one runtime and save each native Favorite once`, async t => {
    const dom = new JSDOM(`<!doctype html><html data-app-theme="dark"><head></head><body>
      <nav><button>Settings</button></nav><main><article>
      <button aria-label="View @alice's profile"></button><button class="truncate font-bold">alice</button>
      <p class="whitespace-pre-wrap break-words">Home Like Post Following</p>
      <a href="/post/post-a">1m</a>
      <button data-testid="tweet-like-action" aria-label="Like, 0 likes" aria-pressed="false">Like</button>
      </article><textarea id="public-tweet-input">My draft Home</textarea></main></body></html>`, {
      url: 'https://app.tweet.app/post/post-a', runScripts: 'outside-only', pretendToBeVisual: true
    });
    t.after(() => closeFixture(dom));
    const { window } = dom;
    const document = window.document;
    const errors = [];
    window.addEventListener('error', event => errors.push(event.error || event.message));
    window.console.debug = (...args) => errors.push(args);
    window.console.log = () => {};
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.fetch = async () => ({ ok: false, status: 401 });
    window.localStorage.setItem('firebase:authUser:fixture-key:[DEFAULT]', JSON.stringify({
      apiKey: 'fixture-key', uid: 'account-a', stsTokenManager: { accessToken: 'a'.repeat(40) }
    }));
    const favoritesKeys = ['classicTwitterJP.favorites:uid:account-a', 'classicTwitterEN.favorites:uid:account-a'];
    for (const key of favoritesKeys) window.localStorage.setItem(key, '[]');
    const writes = [];
    const originalWrite = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function (key, value) {
      if (favoritesKeys.includes(key)) writes.push({ key, value });
      return originalWrite.call(this, key, value);
    };
    const captures = [];
    let captureCalls = 0;
    const originalListen = document.addEventListener.bind(document);
    document.addEventListener = (type, listener, options) => {
      if (type === 'click' && listener.name === 'ctCaptureFavoriteClick') {
        captures.push(listener);
        return originalListen(type, event => { captureCalls++; listener(event); }, options);
      }
      return originalListen(type, listener, options);
    };
    let readiness = beforeReady ? 'loading' : 'complete';
    Object.defineProperty(document, 'readyState', { get: () => readiness });
    const files = [firstFile, ...distributions.map(({ file }) => file).filter(file => file !== firstFile)];
    for (const file of files) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
    if (beforeReady) {
      assert.equal(captures.length, 0, 'capture listeners must not escape the deferred startup guard');
      readiness = 'interactive';
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(errors, []);
    assert.equal(captures.length, 1);
    assert.equal(document.querySelectorAll('#ct-local-tools').length, 1);
    assert.equal(document.documentElement.dataset.ctActiveVersion, releaseVersion);
    assert.equal(document.documentElement.dataset.appTheme, 'dark');
    assert.equal(document.querySelector('nav button').textContent, locale === 'en' ? 'Settings' : '設定');
    const like = document.querySelector('[data-testid="tweet-like-action"]');
    let nativeCalls = 0;
    like.addEventListener('click', () => { nativeCalls++; like.setAttribute('aria-pressed', 'true'); });
    like.click();
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(nativeCalls, 1);
    assert.equal(captureCalls, 1, 'the other editions must not leave a second capture callback behind');
    assert.equal(writes.length, 1, 'one native Favorite transition makes one local snapshot write');
    const activeKey = locale === 'en' ? favoritesKeys[1] : favoritesKeys[0];
    assert.equal(writes[0].key, activeKey);
    assert.equal(JSON.parse(writes[0].value)[0].id, 'post-a');
    assert.equal(window.localStorage.getItem(favoritesKeys.find(key => key !== activeKey)), '[]');
    assert.equal(document.querySelector('article p').textContent, 'Home Like Post Following');
    assert.equal(document.querySelector('textarea').value, 'My draft Home');
    assert.deepEqual(errors, []);
  });
}

for (const { file, locale } of distributions) {
  test(`${file}: full startup preserves content and settles when idle`, async () => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body><nav><button>Settings</button></nav><main>
      <article><div><div class="relative inline-flex shrink-0 isolate"><button class="rounded-full" aria-label="View @someone's profile"><img class="rounded-full object-cover" alt="someone avatar"></button><span role="button" tabindex="0" aria-label="Follow @someone" class="absolute -bottom-0.5 -right-0.5"><svg class="lucide-plus"></svg></span></div><button class="truncate font-bold">someone</button>
      <p aria-live="polite"><button>Show translation</button></p></div>
      <p class="break-words whitespace-pre-wrap">Home Like Post Following</p>
      <div class="tweet-action-bar" data-testid="tweet-action-bar"><button data-testid="tweet-like-action" aria-label="Like, 3 likes">Like</button></div></article>
      <textarea id="public-tweet-input">Post Home</textarea></main></body></html>`, {
      url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    const errors = [];
    window.addEventListener('error', e => errors.push(e.error || e.message));
    window.console.debug = (...args) => errors.push(args);
    window.console.log = () => {};
    window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
    window.fetch = async () => ({ok: false, status: 401});
    let scans = 0;
    const walker = window.document.createTreeWalker.bind(window.document);
    window.document.createTreeWalker = (...args) => { scans++; return walker(...args); };
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.deepEqual(errors, []);
    assert.equal(window.document.querySelector('article p.break-words').textContent, 'Home Like Post Following');
    assert.equal(window.document.querySelector('textarea').value, 'Post Home');
    const avatarFollow = window.document.querySelector('[aria-label="Follow @someone"]');
    assert.equal(window.getComputedStyle(avatarFollow).display, 'none', 'the native wrapped-avatar plus stays hidden in every distribution');
    assert.equal(avatarFollow.tabIndex, -1);
    assert.equal(window.document.querySelector('[aria-label="View @someone\'s profile"]').hidden, false);
    assert.equal(window.document.querySelector('button.truncate').textContent, 'someone');
    assert.equal(window.document.querySelector('nav button').textContent, locale === 'en' ? 'Settings' : '設定');
    assert.equal(window.document.querySelector('[aria-live] button').style.display, '');
    assert.ok(window.document.querySelector('[data-ct-local-ui]'));
    const previous = scans;
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(scans, previous, 'idle observer must not loop on its own changes');
    const label = window.document.createElement('button'); label.textContent = 'Settings';
    window.document.querySelector('nav').append(label);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(label.textContent, locale === 'en' ? 'Settings' : '設定');
    assert.deepEqual(errors, []);
    closeFixture(dom);
  });
}

for (const { file, locale } of distributions) {
  test(`${file}: integrated photo slides and Japan news keep native content and settle`, async () => {
    const dom = new JSDOM(`<!doctype html><html><head></head><body><main>
      <div class="w-full min-w-0 flex flex-col"><div class="sticky"><div class="overflow-x-auto">
      ${['For you', 'Following', 'News', 'Sports', 'Entertainment', 'Technology'].map((name, i) => `<button class="rounded-full whitespace-nowrap ${i === 0 ? 'bg-sky-500 text-white' : ''}">${name}</button>`).join('')}
      </div></div><div id="native-body"><article>
      <p class="whitespace-pre-wrap break-words">News Photos Home</p>
      <div class="grid gap-0.5 rounded-2xl overflow-hidden border"><div class="relative overflow-hidden"><img alt="Attached media" class="cursor-pointer" src="https://storage.googleapis.com/first.png"></div><div class="relative overflow-hidden"><img alt="Attached media" class="cursor-pointer" src="https://storage.googleapis.com/second.png"></div></div>
      </article></div></div><textarea id="public-tweet-input" placeholder="What's happening, Alice?">My draft</textarea>
      </main></body></html>`, {url:'https://app.tweet.app/feed', runScripts:'outside-only', pretendToBeVisual:true});
    const {window} = dom;
    const errors = [];
    window.addEventListener('error', e => errors.push(e.error || e.message));
    window.console.debug = (...args) => errors.push(args);
    window.console.log = () => {};
    window.matchMedia = () => ({matches:true,addEventListener(){},removeEventListener(){}});
    window.fetch = async () => ({ok:false,status:401});
    const requests = [];
    window.GM_xmlhttpRequest = options => {
      if (options.url.includes('news.yahoo.co.jp/rss/') || options.url.includes('news.web.nhk/n-data/')) {
        requests.push(options);
        const xml = options.url.includes('yahoo')
          ? `<rss version="2.0"><channel><item><title>国内の新しいニュース</title><link>https://news.yahoo.co.jp/articles/test-article</link><image>https://newsatcl-pctr.c.yimg.jp/t/amd-img/thumbnail.jpg</image><pubDate>Sun, 27 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`
          : `<rss version="2.0"><channel><item><title>NHKの国内ニュース</title><link>https://news.web.nhk/newsweb/na/nd-20261005example</link><pubDate>Sun, 27 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
        // Exercise the mobile Stay text response shape in complete editions.
        window.setTimeout(() => options.onload({status:200,responseText:null,response:xml,responseURL:options.url}),0);
      } else window.setTimeout(() => options.onload({status:401,responseText:'{}'}),0);
      return {abort(){}};
    };
    for (const image of window.document.querySelectorAll('img[alt="Attached media"]')) {
      image.addEventListener('click', () => window.queueMicrotask(() => {
        let viewer = window.document.querySelector('[aria-label="Media viewer"]');
        if (!viewer) {
          viewer = window.document.createElement('div');
          viewer.setAttribute('role','dialog'); viewer.setAttribute('aria-modal','true'); viewer.setAttribute('aria-label','Media viewer');
          viewer.innerHTML = '<img alt="Media preview">';
          window.document.body.append(viewer);
        }
        // Match React's delayed src-only update, not a replacement image node.
        viewer.querySelector('img').src = image.src;
      }));
    }
    let mutations = 0;
    const observer = new window.MutationObserver(() => mutations++);
    observer.observe(window.document.body,{childList:true,subtree:true,attributes:true,characterData:true});
    try {
      window.eval(fs.readFileSync(path.join(root,file),'utf8'));
      await new Promise(resolve => setTimeout(resolve,400));
      assert.deepEqual(errors,[]);
      assert.equal(window.document.documentElement.dataset.ctActiveVersion,releaseVersion);
      assert.equal(window.document.querySelector('.ct-media-carousel-controls [role="status"]').textContent,'1 / 2');
      assert.equal(window.document.querySelector('article p').textContent,'News Photos Home');
      assert.equal(window.document.querySelector('textarea').value,'My draft');
      assert.equal(window.document.querySelector('textarea').placeholder,locale === 'en' ? "What's happening, Alice?" : 'いまどうしてる？');
      assert.equal(requests.length,0,'home must not request a news feed');
      window.document.querySelector('img[alt="Attached media"]').click();
      await new Promise(resolve => setTimeout(resolve,200));
      assert.equal(window.document.querySelector('.ct-media-viewer-controls [role="status"]').textContent,'1 / 2');
      window.document.querySelector('.ct-media-viewer-controls button:last-child').click();
      await new Promise(resolve => setTimeout(resolve,200));
      assert.match(window.document.querySelector('[aria-label="Media viewer"] img').src,/second\.png$/);
      assert.equal(window.document.querySelector('.ct-media-viewer-controls [role="status"]').textContent,'2 / 2','gallery must observe a React src-only commit');
      window.document.querySelector('[aria-label="Media viewer"]').remove();
      const tabs = window.document.querySelectorAll('.sticky button');
      tabs[0].classList.remove('bg-sky-500','text-white');
      tabs[2].classList.add('bg-sky-500','text-white');
      const native = window.document.getElementById('native-body');
      native.innerHTML = '<a href="https://example.com/news">Native world headline</a>';
      await new Promise(resolve => setTimeout(resolve,350));
      if (locale === 'en') {
        assert.equal(requests.length,0,'English starts with world news');
        window.document.querySelector('[data-ct-news-region="jp"]').click();
        await new Promise(resolve => setTimeout(resolve,200));
      }
      assert.equal(requests.length,2);
      assert.equal(requests.every(request => request.anonymous && request.responseType === 'text'),true);
      assert.equal(window.document.querySelector('.ct-news-article h3').textContent,'国内の新しいニュース');
      assert.match(window.document.querySelector('.ct-news-article img').src,/yimg\.jp/);
      assert.equal(window.document.querySelectorAll('.ct-news-article').length,2);
      assert.match(window.document.querySelector('.ct-news-status').textContent,/Yahoo!ニュース・NHK NEWS WEB/);
      assert.equal(window.getComputedStyle(native).display,'none');
      assert.equal(native.textContent,'Native world headline');
      // Loaded headlines can precede the last queued runtime/gallery scan on a
      // busy CI runner. Require a bounded quiet window before observing idle;
      // recurring mutation loops must still fail to reach this window.
      const settleDeadline = Date.now() + 3000;
      let lastMutations = mutations, quietSince = Date.now();
      while (Date.now() - quietSince < 250 && Date.now() < settleDeadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
        if (mutations !== lastMutations) { lastMutations = mutations; quietSince = Date.now(); }
      }
      assert.ok(Date.now() - quietSince >= 250, 'news/gallery mutations must reach a quiet window');
      const previous = mutations;
      await new Promise(resolve => setTimeout(resolve,450));
      assert.equal(mutations,previous,'news completion and gallery cleanup must settle');
      window.document.querySelector('[data-ct-news-region="world"]').click();
      assert.notEqual(window.getComputedStyle(native).display,'none');
      assert.deepEqual(errors,[]);
    } finally { observer.disconnect(); closeFixture(dom); }
  });
}
