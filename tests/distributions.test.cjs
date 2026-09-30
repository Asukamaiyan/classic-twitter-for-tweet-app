const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

for (const file of ['classic-twitter-ja.user.js', 'classic-twitter-ja-safari.user.js', 'classic-twitter-en.user.js']) {
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
    assert.equal(window.document.querySelector('nav button').textContent, file.includes('-en.') ? 'Settings' : '設定');
    assert.equal(window.document.querySelector('[aria-live] button').style.display, '');
    assert.ok(window.document.querySelector('[data-ct-local-ui]'));
    const previous = scans;
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(scans, previous, 'idle observer must not loop on its own changes');
    const label = window.document.createElement('button'); label.textContent = 'Settings';
    window.document.querySelector('nav').append(label);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(label.textContent, file.includes('-en.') ? 'Settings' : '設定');
    assert.deepEqual(errors, []);
    dom.window.close();
  });
}

for (const file of ['classic-twitter-ja.user.js', 'classic-twitter-ja-safari.user.js', 'classic-twitter-en.user.js']) {
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
      if (options.url.includes('news.yahoo.co.jp/rss/')) {
        requests.push(options);
        window.setTimeout(() => options.onload({status:200,responseText:`<rss version="2.0"><channel><item><title>国内の新しいニュース</title><link>https://news.yahoo.co.jp/articles/test-article</link><image>https://newsatcl-pctr.c.yimg.jp/t/amd-img/thumbnail.jpg</image><pubDate>Sun, 27 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`}),0);
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
      assert.equal(window.document.documentElement.dataset.ctActiveVersion,'6.8.1');
      assert.equal(window.document.querySelector('.ct-media-carousel-controls [role="status"]').textContent,'1 / 2');
      assert.equal(window.document.querySelector('article p').textContent,'News Photos Home');
      assert.equal(window.document.querySelector('textarea').value,'My draft');
      assert.equal(window.document.querySelector('textarea').placeholder,file.includes('-en.') ? "What's happening, Alice?" : 'いまどうしてる？');
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
      if (file.includes('-en.')) {
        assert.equal(requests.length,0,'English starts with world news');
        window.document.querySelector('[data-ct-news-region="jp"]').click();
        await new Promise(resolve => setTimeout(resolve,200));
      }
      assert.equal(requests.length,1);
      assert.equal(requests[0].anonymous,true);
      assert.equal(window.document.querySelector('.ct-news-article h3').textContent,'国内の新しいニュース');
      assert.match(window.document.querySelector('.ct-news-article img').src,/yimg\.jp/);
      assert.equal(window.getComputedStyle(native).display,'none');
      assert.equal(native.textContent,'Native world headline');
      const previous = mutations;
      await new Promise(resolve => setTimeout(resolve,450));
      assert.equal(mutations,previous,'news completion and gallery cleanup must settle');
      window.document.querySelector('[data-ct-news-region="world"]').click();
      assert.notEqual(window.getComputedStyle(native).display,'none');
      assert.deepEqual(errors,[]);
    } finally { observer.disconnect(); window.close(); }
  });
}
