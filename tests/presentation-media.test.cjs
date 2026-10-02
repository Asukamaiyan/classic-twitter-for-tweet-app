const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const presentation = fs.readFileSync(path.join(__dirname, '../src/presentation.js'), 'utf8');
const mediaSource = fs.readFileSync(path.join(__dirname, '../src/safari-extras.js'), 'utf8');
function harness(t, fetchProfile = async () => null, locale = 'ja', sandboxManager = null) {
  const dom = new JSDOM(`<!doctype html><body><button id="previous">Open</button><main>
    <div id="profile-heading"><h1>Alice</h1></div><article>
    <img id="one" src="https://storage.googleapis.com/one.jpg">
    <img id="two" src="https://storage.googleapis.com/two.png">
    <video id="video" src="https://storage.googleapis.com/video.mp4"></video></article></main></body>`, {
    url: 'https://app.tweet.app/user/alice', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  window.normUser = value => window.clean(value).replace(/^@/, '').toLowerCase();
  window.routeUser = () => window.location.pathname.match(/^\/user\/([^/]+)/)?.[1] || null;
  window.ownProfileUser = () => window.document.querySelector('h1')?.dataset.username || null;
  window.fetchProfile = fetchProfile;
  window.matchMedia = () => ({ matches: false });
  const requests = [];
  window.GM_xmlhttpRequest = options => { requests.push(options); };
  const localeDeclaration = locale == null ? '' : `const CT_LOCALE = ${JSON.stringify(locale)};`;
  let managerDeclaration = '';
  if (sandboxManager) {
    window.GM_xmlhttpRequest = undefined;
    window.transportManager = sandboxManager;
    managerDeclaration = 'const GM = window.transportManager;';
  }
  window.eval(`${managerDeclaration} ${localeDeclaration}\n${presentation}\n${mediaSource}\nwindow.qa = { patchProfileFounder, ctShowMediaInfo };`);
  t.after(() => dom.window.close());
  return {
    window, document: window.document, qa: window.qa, requests,
    profile(username, displayName) {
      window.history.pushState({}, '', `/user/${username}`);
      window.document.querySelector('h1').textContent = displayName;
    },
    badge: () => window.document.querySelector('.ct-profile-founder'),
    show: id => window.qa.ctShowMediaInfo(window.document.getElementById(id)),
    respond(index, bytes, type = 'image/jpeg') {
      requests[index].onload({ status: 200, responseHeaders: `Content-Length: ${bytes}\r\nContent-Type: ${type}` });
    },
    value(label) {
      return [...window.document.querySelectorAll('.ct-media-info-key')]
        .find(el => el.textContent === label)?.nextElementSibling?.textContent;
    }
  };
}

test('profile navigation removes the previous founder number before the next request resolves', async t => {
  let resolveBob;
  const f = harness(t, username => username === 'alice'
    ? Promise.resolve({ displayName: 'Alice', foundingMemberNumber: 17 })
    : new Promise(resolve => { resolveBob = resolve; }));
  await f.qa.patchProfileFounder();
  assert.equal(f.badge().textContent, '#00017');
  f.profile('bob', 'Bob');
  const pending = f.qa.patchProfileFounder();
  assert.equal(f.badge(), null);
  resolveBob({ displayName: 'Bob', foundingMemberNumber: null });
  await pending;
  assert.equal(f.badge(), null);
});

test('founder badge stays single and is removed when the current profile loses its number or route', async t => {
  let number = 17;
  const f = harness(t, async () => ({ displayName: 'Alice', foundingMemberNumber: number }));
  await f.qa.patchProfileFounder();
  const original = f.badge();
  await f.qa.patchProfileFounder();
  assert.equal(f.badge(), original);
  assert.equal(f.document.querySelectorAll('.ct-profile-founder').length, 1);
  number = null;
  await f.qa.patchProfileFounder();
  assert.equal(f.badge(), null);
  number = 17;
  await f.qa.patchProfileFounder();
  f.window.history.pushState({}, '', '/feed');
  await f.qa.patchProfileFounder();
  assert.equal(f.badge(), null);
});

test('a late profile response cannot overwrite a newer result on the same route', async t => {
  const replies = [];
  const f = harness(t, () => new Promise(resolve => replies.push(resolve)));
  const older = f.qa.patchProfileFounder();
  const newer = f.qa.patchProfileFounder();
  replies[1]({ displayName: 'Alice', foundingMemberNumber: 22 });
  await newer;
  replies[0]({ displayName: 'Alice', foundingMemberNumber: 17 });
  await older;
  assert.equal(f.badge().textContent, '#00022');
});

test('profile responses are rejected if route or own-profile identity changed while loading', async t => {
  let respond;
  const f = harness(t, () => new Promise(resolve => { respond = resolve; }));
  const pending = f.qa.patchProfileFounder();
  f.profile('bob', 'Bob');
  respond({ displayName: 'Alice', foundingMemberNumber: 17 });
  await pending;
  assert.equal(f.badge(), null);
  f.window.history.pushState({}, '', '/profile');
  f.document.querySelector('h1').dataset.username = 'alice';
  const own = f.qa.patchProfileFounder();
  f.document.querySelector('h1').dataset.username = 'bob';
  respond({ displayName: 'Bob', foundingMemberNumber: 17 });
  await own;
  assert.equal(f.badge(), null);
});

test('media information opens immediately and fills headers without delaying close controls', async t => {
  const f = harness(t);
  Object.defineProperties(f.document.getElementById('one'), {
    naturalWidth: { value: 1920 }, naturalHeight: { value: 1080 }
  });
  const pending = f.show('one');
  assert.ok(f.document.getElementById('ct-media-info-panel'));
  assert.equal(f.value('実解像度'), '1920 × 1080 px');
  assert.equal(f.value('配信ファイル容量'), '取得中…');
  f.respond(0, 2048);
  await pending;
  assert.equal(f.value('形式'), 'JPG');
  assert.equal(f.value('配信ファイル容量'), '2.00 KB');
});

test('English photo information localizes its labels while headers load asynchronously', async t => {
  const f = harness(t, undefined, 'en');
  const image = f.document.getElementById('one');
  Object.defineProperties(image, {
    naturalWidth: { value: 1920 }, naturalHeight: { value: 1080 }
  });
  const pending = f.show('one');
  const overlay = f.document.getElementById('ct-media-info-panel');
  assert.equal(overlay.getAttribute('aria-label'), 'Photo information');
  assert.equal(overlay.querySelector('.ct-media-info-title').textContent, '📸 Photo information');
  assert.equal(f.document.activeElement.getAttribute('aria-label'), 'Close');
  assert.equal(f.value('Resolution'), '1920 × 1080 px');
  assert.equal(f.value('Format'), 'JPG');
  assert.equal(f.value('Delivered file size'), 'Loading…');
  assert.equal(f.requests[0].method, 'HEAD');
  assert.equal(f.requests[0].anonymous, true);
  f.respond(0, 2048, 'image/png');
  await pending;
  assert.equal(f.value('Format'), 'PNG');
  assert.equal(f.value('Delivered file size'), '2.00 KB');
  assert.equal(overlay.querySelector('.ct-media-info-url').textContent, image.src);
  assert.doesNotMatch(overlay.textContent, /[ぁ-んァ-ヶ一-龠]/);
});

test('English video information displays duration and updates format without changing the media', async t => {
  const f = harness(t, undefined, 'en');
  const video = f.document.getElementById('video');
  Object.defineProperties(video, {
    videoWidth: { value: 3840 }, videoHeight: { value: 2160 }, duration: { value: 12.345 }
  });
  const original = video.outerHTML;
  const pending = f.show('video');
  const overlay = f.document.getElementById('ct-media-info-panel');
  assert.equal(overlay.getAttribute('aria-label'), 'Video information');
  assert.equal(overlay.querySelector('.ct-media-info-title').textContent, '🎬 Video information');
  assert.equal(f.value('Resolution'), '3840 × 2160 px');
  assert.equal(f.value('Duration'), '12.35 seconds');
  assert.equal(f.value('Delivered file size'), 'Loading…');
  f.respond(0, 2097152, 'video/quicktime');
  await pending;
  assert.equal(f.value('Format'), 'MOV');
  assert.equal(f.value('Delivered file size'), '2.00 MB');
  assert.equal(video.outerHTML, original);
  assert.doesNotMatch(overlay.textContent, /[ぁ-んァ-ヶ一-龠]/);
});

test('English missing media and failed headers show clear fallback text and retain dismissal behavior', async t => {
  const f = harness(t, undefined, 'en');
  const video = f.document.getElementById('video');
  video.removeAttribute('src');
  await f.show('video');
  assert.equal(f.value('Resolution'), 'Waiting for media to load');
  assert.equal(f.value('Duration'), 'Waiting for media to load');
  assert.equal(f.value('Format'), 'Unknown');
  assert.equal(f.value('Delivered file size'), 'Unavailable');
  assert.equal(f.document.querySelector('.ct-media-info-url').textContent, 'URL unavailable');
  assert.equal(f.requests.length, 0);
  f.document.querySelector('.ct-media-info-close').click();
  const previous = f.document.getElementById('previous');
  previous.focus();
  const pending = f.show('one');
  assert.equal(f.value('Delivered file size'), 'Loading…');
  f.requests[0].onerror();
  await pending;
  assert.equal(f.value('Delivered file size'), 'Unavailable');
  f.document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.document.getElementById('ct-media-info-panel'), null);
  assert.equal(f.document.activeElement, previous);
});

test('media information retains Japanese labels when an older harness omits the locale constant', async t => {
  const f = harness(t, undefined, null);
  const pending = f.show('one');
  assert.equal(f.document.getElementById('ct-media-info-panel').getAttribute('aria-label'), '写真情報');
  assert.equal(f.value('配信ファイル容量'), '取得中…');
  f.respond(0, 1024);
  await pending;
  assert.equal(f.value('形式'), 'JPG');
  assert.equal(f.value('配信ファイル容量'), '1.00 KB');
});

test('out-of-order media requests keep only the most recently opened item', async t => {
  const f = harness(t);
  const first = f.show('one');
  const second = f.show('two');
  f.respond(1, 2048, 'image/png');
  await second;
  f.respond(0, 1024);
  await first;
  assert.equal(f.document.querySelectorAll('#ct-media-info-panel').length, 1);
  assert.equal(f.document.querySelector('.ct-media-info-url').textContent, 'https://storage.googleapis.com/two.png');
  assert.equal(f.value('形式'), 'PNG');
  assert.equal(f.value('配信ファイル容量'), '2.00 KB');
});

test('closing during media loading prevents late responses from reopening the panel and restores focus', async t => {
  const f = harness(t);
  const previous = f.document.getElementById('previous');
  previous.focus();
  const pending = f.show('one');
  assert.equal(f.document.activeElement.className, 'ct-media-info-close');
  f.document.querySelector('.ct-media-info-close').click();
  assert.equal(f.document.activeElement, previous);
  f.respond(0, 1024);
  await pending;
  assert.equal(f.document.getElementById('ct-media-info-panel'), null);
});

test('replacing a media sheet preserves the original page focus target', async t => {
  const f = harness(t);
  const previous = f.document.getElementById('previous');
  previous.focus();
  const first = f.show('one');
  const second = f.show('two');
  f.document.querySelector('.ct-media-info-close').click();
  assert.equal(f.document.activeElement, previous);
  f.respond(1, 2048);
  f.respond(0, 1024);
  await Promise.all([first, second]);
  assert.equal(f.document.activeElement, previous);
  assert.equal(f.document.getElementById('ct-media-info-panel'), null);
});

test('Escape and backdrop dismissal also invalidate pending media responses', async t => {
  const f = harness(t);
  let nativeEscapeEvents = 0;
  f.document.addEventListener('keydown', event => {
    if (event.key === 'Escape') nativeEscapeEvents++;
  });
  for (const dismissal of ['escape', 'backdrop']) {
    const index = f.requests.length;
    const pending = f.show('one');
    const overlay = f.document.getElementById('ct-media-info-panel');
    if (dismissal === 'escape') {
      f.document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else overlay.click();
    f.respond(index, 1024);
    await pending;
    assert.equal(f.document.getElementById('ct-media-info-panel'), null, dismissal);
  }
  assert.equal(nativeEscapeEvents, 0, 'Escape must not also dismiss the underlying native UI');
});


test('Safari media metadata supports sandbox GM and delayed callback after bridge acknowledgement', async t => {
  let options;
  const manager = { xmlHttpRequest(value) {
    assert.equal(this, manager);
    options = value;
    return Promise.resolve(undefined);
  } };
  const f = harness(t, undefined, 'ja', manager);
  assert.equal(f.window.GM, undefined);
  const pending = f.show('one');
  await Promise.resolve();
  assert.equal(f.value('配信ファイル容量'), '取得中…');
  assert.equal(options.method, 'HEAD');
  assert.equal(options.anonymous, true);
  assert.equal(options.redirect, 'error');
  options.onload({ status: 200, responseHeaders: 'Content-Length: 2048\r\nContent-Type: image/png' });
  await pending;
  assert.equal(f.value('配信ファイル容量'), '2.00 KB');
  assert.equal(f.value('形式'), 'PNG');
});
