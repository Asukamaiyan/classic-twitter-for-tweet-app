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
