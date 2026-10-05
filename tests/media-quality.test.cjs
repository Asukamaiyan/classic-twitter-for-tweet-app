const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const media = fs.readFileSync(path.join(__dirname, '../src/media.js'), 'utf8');
const viewport = fs.readFileSync(path.join(__dirname, '../src/photo-viewport.js'), 'utf8');

function harness(t, { decode = true, index = 0, locale = 'ja' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><main>
    <textarea id="public-tweet-input">Keep this draft</textarea>
    <div id="gallery" class="grid gap-0.5 rounded-2xl overflow-hidden border">
      ${Array.from({ length: 4 }, (_, i) => `<div class="relative overflow-hidden"><img src="https://media.tweet.app/public-${i}.webp" class="cursor-pointer" alt="Attached media"></div>`).join('')}
    </div>
    <video id="video" src="https://media.tweet.app/provided.mp4" controls playsinline loop class="w-full object-contain"></video>
    </main></body></html>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const requests = [];
  if (decode) window.HTMLImageElement.prototype.decode = function () {
    return new Promise((resolve, reject) => requests.push({ image: this, source: this.src, resolve, reject }));
  };
  Object.defineProperties(window.HTMLImageElement.prototype, {
    complete: { configurable: true, get: () => true },
    naturalWidth: { configurable: true, get: () => 1920 },
    naturalHeight: { configurable: true, get: () => 1080 }
  });
  const reduce = { matches: false, addEventListener: (_, cb) => { reduce.listener = cb; }, removeEventListener: () => {} };
  window.matchMedia = () => reduce;
  const visual = new window.EventTarget();
  Object.assign(visual, { scale: 1, width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  window.ctNetworkState = { authUID: 'account-a' };
  const { document } = window;
  const images = [...document.querySelectorAll('#gallery img')];
  let dialog;
  const clicked = [];
  images.forEach((image, i) => image.addEventListener('click', event => {
    event.stopPropagation(); clicked.push(i);
    if (!dialog?.isConnected) {
      dialog = document.createElement('div');
      dialog.className = 'fixed';
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Media viewer');
      const header = document.createElement('div');
      const close = document.createElement('button'); close.setAttribute('aria-label', 'Close media viewer');
      close.addEventListener('click', () => dialog.remove()); header.append(close);
      const stage = document.createElement('div');
      const preview = document.createElement('img'); preview.alt = 'Media preview'; preview.referrerPolicy = 'no-referrer'; stage.append(preview);
      dialog.append(header, stage); document.body.append(dialog);
    }
    dialog.querySelector('img').src = image.src;
  }));
  window.eval(`const CT_LOCALE=${JSON.stringify(locale)};\n${viewport}\n${media}\nwindow.qa={ctMediaEnhance,ctMediaPhotoLayer,ctMediaResetPhotoMotion,ctMediaClearViewer,ctMediaAttachPhotoQuality,ctMediaReleasePhotoQuality,ctMediaPhotoQuality,get viewer(){return ctMediaViewer}};`);
  const qa = window.qa;
  const enhance = () => qa.ctMediaEnhance();
  enhance(); images[index].click(); enhance();
  t.after(() => window.close());
  return {
    window, document, images, requests, qa, enhance, clicked, reduce, visual,
    get dialog() { return dialog; }, get preview() { return dialog.querySelector('img[alt="Media preview"]'); },
    async ready() { for (const request of requests) request.resolve(); await Promise.resolve(); await Promise.resolve(); },
    layer(target) { return qa.ctMediaPhotoLayer(qa.viewer, target); }
  };
}

test('a pending photo decode never covers the already displayed native image', async t => {
  const f = harness(t);
  assert.equal(f.requests.length, 2);
  assert.equal(f.layer(1), null);
  assert.equal(f.preview.classList.contains('ct-media-photo-covered'), false);
  assert.equal(f.document.querySelector('.ct-media-photo-layer'), null);
  f.dialog.querySelector('.ct-media-viewer-controls button:last-child').click();
  assert.equal(f.preview.src, f.images[1].src);
  assert.deepEqual(f.clicked, [0, 1]);
  assert.equal(f.document.querySelector('#public-tweet-input').value, 'Keep this draft');
});

test('decoded adjacent images are reused for motion with their exact supplied URLs', async t => {
  const f = harness(t, { index: 1 });
  assert.equal(f.requests.length, 3);
  const prepared = f.qa.viewer.decodedPhotos.get(2).image;
  await f.ready();
  const layer = f.layer(2);
  assert.ok(layer);
  assert.deepEqual([...layer.layer.querySelectorAll('img')].map(image => image.src), f.images.slice(0, 3).map(image => image.src));
  assert.ok(layer.layer.contains(prepared));
  assert.equal(f.preview.classList.contains('ct-media-photo-covered'), true);
  const calls = f.requests.length;
  f.qa.ctMediaResetPhotoMotion(f.qa.viewer);
  assert.equal(f.preview.classList.contains('ct-media-photo-covered'), false);
  assert.ok(f.layer(2).layer.contains(prepared));
  assert.equal(f.requests.length, calls);
  assert.deepEqual(f.requests.map(request => request.source), f.images.slice(0, 3).map(image => image.src));
});

test('decode failure uses the native switch without leaving a blank overlay or retry loop', async t => {
  const f = harness(t);
  f.requests[0].resolve(); f.requests[1].reject(new Error('decode failed'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.layer(1), null);
  assert.equal(f.layer(1), null);
  assert.equal(f.requests.length, 2);
  f.dialog.querySelector('.ct-media-viewer-controls button:last-child').click();
  assert.equal(f.preview.src, f.images[1].src);
  assert.equal(f.preview.classList.contains('ct-media-photo-covered'), false);
});

test('preparation stays limited to the current photo and at most two adjacent photos', async t => {
  const f = harness(t);
  await f.ready();
  assert.deepEqual([...f.qa.viewer.decodedPhotos.keys()], [0, 1]);
  f.images[2].click(); f.enhance();
  assert.equal(f.qa.viewer.decodedPhotos.size, 3);
  assert.deepEqual([...f.qa.viewer.decodedPhotos.keys()], [1, 2, 3]);
  const requests = f.requests.length;
  f.enhance(); f.enhance();
  assert.equal(f.requests.length, requests);
  assert.equal(f.layer(0), null); // A distant keyboard jump retains the native path.
});

test('closing or changing account rejects decode promises from an old viewer', async t => {
  for (const change of ['close', 'account', 'route', 'source']) {
    const f = harness(t);
    const old = f.qa.viewer;
    if (change === 'close') f.dialog.remove();
    if (change === 'account') f.window.ctNetworkState.authUID = 'account-b';
    if (change === 'route') f.window.history.pushState({}, '', '/explore');
    if (change === 'source') f.images[0].src = 'https://media.tweet.app/replacement.webp';
    f.enhance();
    assert.equal(f.qa.viewer, null, change);
    assert.equal(old.decodedPhotos.size, 0, change);
    await f.ready();
    assert.equal(old.decodedPhotos.size, 0, change);
    assert.equal(f.document.querySelector('.ct-media-photo-layer'), null, change);
  }
});

test('backgrounding, zoom and reduced motion release preparations without changing sources', async t => {
  for (const change of ['pagehide', 'zoom', 'reduced']) {
    const f = harness(t);
    const viewer = f.qa.viewer;
    if (change === 'pagehide') f.window.dispatchEvent(new f.window.Event('pagehide'));
    if (change === 'zoom') { f.visual.scale = 2; f.visual.width = 195; f.visual.dispatchEvent(new f.window.Event('resize')); }
    if (change === 'reduced') { f.reduce.matches = true; f.reduce.listener(); }
    assert.equal(viewer.decodedPhotos.size, 0, change);
    await f.ready();
    assert.equal(viewer.decodedPhotos.size, 0, change);
    assert.equal(f.preview.src, f.images[0].src, change);
    assert.deepEqual(f.clicked, [0], change);
  }
});

test('older image engines preserve the existing motion and supplied video source', t => {
  const f = harness(t, { decode: false, locale: 'en' });
  const video = f.document.querySelector('#video');
  let play = 0, load = 0;
  video.play = () => { play++; }; video.load = () => { load++; };
  assert.ok(f.layer(1));
  assert.equal(f.preview.src, f.images[0].src);
  assert.equal(video.src, 'https://media.tweet.app/provided.mp4');
  assert.equal(play, 0); assert.equal(load, 0);
});

test('the photo link opens only the exact delivered source and reports its loaded dimensions', t => {
  const f = harness(t);
  const source = f.preview.src;
  const quality = f.dialog.querySelector('.ct-media-photo-quality');
  const open = quality.querySelector('a');
  assert.equal(open.href, source);
  assert.equal(open.target, '_blank'); assert.equal(open.rel, 'noopener noreferrer');
  assert.equal(open.referrerPolicy, 'no-referrer');
  assert.equal(quality.querySelector('span').textContent, '1920 × 1080');
  assert.equal(quality.querySelector('span').hidden, false);
  assert.equal(f.preview.src, source);
  f.enhance(); f.enhance();
  assert.equal(f.dialog.querySelectorAll('.ct-media-photo-quality').length, 1);
  let backdrop = 0; f.dialog.addEventListener('click', () => backdrop++);
  open.addEventListener('click', event => event.preventDefault()); open.click();
  assert.equal(backdrop, 0);
});

test('a previous photo load cannot label the newly selected delivered source with stale dimensions', async t => {
  const f = harness(t);
  const preview = f.preview;
  let current = preview.src, complete = true, width = 1920, height = 1080;
  Object.defineProperties(preview, {
    currentSrc: { configurable: true, get: () => current },
    complete: { configurable: true, get: () => complete },
    naturalWidth: { configurable: true, get: () => width },
    naturalHeight: { configurable: true, get: () => height }
  });
  preview.src = f.images[1].src; complete = false;
  await Promise.resolve();
  const quality = f.dialog.querySelector('.ct-media-photo-quality');
  assert.equal(quality.querySelector('a').href, f.images[1].src);
  assert.equal(quality.querySelector('span').hidden, true);
  preview.dispatchEvent(new f.window.Event('load'));
  assert.equal(quality.querySelector('span').textContent, '');
  complete = true; // Even an earlier source remaining in currentSrc is rejected.
  preview.dispatchEvent(new f.window.Event('load'));
  assert.equal(quality.querySelector('span').hidden, true);
  current = f.images[1].src; width = 1195; height = 1600;
  preview.dispatchEvent(new f.window.Event('load'));
  assert.equal(quality.querySelector('span').textContent, '1195 × 1600');
  assert.equal(quality.querySelector('span').hidden, false);
});

test('photo quality tools reject unsafe navigation URLs and are removed with their viewer', async t => {
  for (const source of ['javascript:alert(1)', 'http://media.tweet.app/image.jpg', 'https://user:pass@media.tweet.app/image.jpg', 'blob:https://app.tweet.app/example']) {
    const f = harness(t);
    f.preview.src = source;
    await Promise.resolve();
    const quality = f.dialog.querySelector('.ct-media-photo-quality');
    assert.equal(quality.hidden, true, source);
    assert.equal(quality.querySelector('a').hasAttribute('href'), false, source);
    f.dialog.remove(); f.enhance();
    assert.equal(f.qa.ctMediaPhotoQuality.size, 0, source);
    assert.equal(quality.isConnected, false, source);
  }
});

test('the same photo helper supports a local profile viewer and releases replaced images', t => {
  const f = harness(t, { locale: 'en' });
  const dialog = f.document.createElement('dialog'); dialog.className = 'ct-profile-viewer';
  const image = f.document.createElement('img'); image.src = f.images[0].src;
  const close = f.document.createElement('button'); close.textContent = 'Close';
  dialog.append(image, close); f.document.body.append(dialog);
  f.qa.ctMediaAttachPhotoQuality(dialog, image);
  const first = dialog.querySelector('.ct-media-photo-quality');
  assert.equal(first.querySelector('a').textContent, 'Open image ↗');
  const replacement = f.document.createElement('img'); replacement.src = f.images[1].src;
  image.replaceWith(replacement);
  f.qa.ctMediaAttachPhotoQuality(dialog, replacement);
  const second = dialog.querySelector('.ct-media-photo-quality');
  image.dispatchEvent(new f.window.Event('load'));
  assert.equal(second.querySelector('a').href, replacement.src);
  assert.equal(first.isConnected, false);
  f.qa.ctMediaReleasePhotoQuality(dialog);
  assert.equal(dialog.querySelector('.ct-media-photo-quality'), null);
  assert.ok(dialog.contains(replacement)); assert.ok(dialog.contains(close));
});

test('video dimensions follow decoded metadata and resize while retaining playback and the video node', t => {
  const f = harness(t);
  const video = f.document.querySelector('#video');
  let width = 1920, height = 1080, ready = 1, current = video.src;
  Object.defineProperties(video, {
    videoWidth: { configurable: true, get: () => width },
    videoHeight: { configurable: true, get: () => height },
    readyState: { configurable: true, get: () => ready },
    currentSrc: { configurable: true, get: () => current }
  });
  let play = 0, pause = 0, load = 0;
  video.play = () => { play++; }; video.pause = () => { pause++; }; video.load = () => { load++; };
  video.currentTime = 12.5; video.volume = .4; video.playbackRate = 1.25;
  video.requestFullscreen = () => Promise.resolve();
  f.enhance();
  const label = f.document.querySelector('.ct-media-video-resolution');
  assert.equal(label.textContent, '1920 × 1080'); assert.equal(label.hidden, false);
  width = 3840; height = 2160; video.dispatchEvent(new f.window.Event('resize'));
  assert.equal(label.textContent, '3840 × 2160');
  video.dispatchEvent(new f.window.Event('emptied'));
  assert.equal(label.hidden, true); assert.equal(label.textContent, '');
  current = 'https://media.tweet.app/old.mp4'; video.dispatchEvent(new f.window.Event('loadedmetadata'));
  assert.equal(label.hidden, true);
  current = video.src; width = 1280; height = 720; ready = 1;
  video.dispatchEvent(new f.window.Event('loadedmetadata'));
  assert.equal(label.textContent, '1280 × 720');
  assert.equal(f.document.querySelector('#video'), video);
  assert.equal(video.src, 'https://media.tweet.app/provided.mp4');
  assert.equal(video.currentTime, 12.5); assert.equal(video.volume, .4); assert.equal(video.playbackRate, 1.25);
  assert.equal(play, 0); assert.equal(pause, 0); assert.equal(load, 0);
});
