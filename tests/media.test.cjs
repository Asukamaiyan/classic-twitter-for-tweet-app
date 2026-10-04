const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/media.js'), 'utf8');
const photoViewport = fs.readFileSync(path.join(__dirname, '../src/photo-viewport.js'), 'utf8');

function uploadMarkup(kind = 'home') {
  const submit = `<button id="${kind === 'modal' ? 'public-modal-tweet-submit-btn' : kind === 'reply' ? 'reply-submit' : 'public-tweet-submit-btn'}">Post</button>`;
  return `<main><section id="composer" ${kind === 'reply' ? 'role="form"' : ''}>
    <textarea id="${kind === 'modal' ? 'public-modal-tweet-input' : 'public-tweet-input'}" name="compose-text">A draft</textarea>
    <div id="upload" class="w-full mt-3 space-y-3"><div id="toolbar" class="flex items-center justify-between pt-3">
      <div class="flex items-center gap-0.5"><button id="photo" type="button"><svg class="lucide lucide-image"></svg></button><button id="video" type="button"><svg class="lucide lucide-video"></svg></button></div>
      ${kind === 'home' ? submit : ''}
      <input id="photos" type="file" accept="image/jpeg,image/png,image/webp" class="hidden">
      <input id="videos" type="file" accept="video/mp4,video/quicktime" class="hidden"></div></div>
    ${kind !== 'home' ? submit : ''}<button id="close">Close</button></section></main>`;
}
function galleryMarkup(count = 3, id = 'gallery') {
  return `<div class="mt-3"><div id="${id}" class="grid gap-0.5 rounded-2xl overflow-hidden border border-tl-app-border grid-cols-${count === 1 ? 1 : 2}">
    ${Array.from({ length: count }, (_, i) => `<div class="relative bg-tl-app-bg overflow-hidden ${i === 0 && count === 3 ? 'row-span-2' : 'aspect-video'}"><img src="https://media.tweet.app/${id}-${i}.jpg" alt="Attached media" class="w-full h-full object-cover cursor-pointer"></div>`).join('')}</div></div>`;
}

test('2.1 poll toggle does not disable multi-photo recognition or replace native poll actions', async t => {
  const f=harness(t);
  const actions=f.document.getElementById('photo').parentElement;
  const poll=f.document.createElement('button');poll.type='button';poll.setAttribute('aria-label','Add poll');poll.setAttribute('aria-pressed','false');
  poll.innerHTML='<svg class="lucide lucide-chart-column rotate-90"></svg>';
  actions.prepend(poll);
  let nativePoll=0;poll.addEventListener('click',()=>nativePoll++);
  f.enhance();
  assert.equal(f.document.getElementById('photos').multiple,true);
  assert.equal(f.document.getElementById('photo').getAttribute('aria-label'),'写真を追加');
  assert.equal(f.document.getElementById('video').getAttribute('aria-label'),'動画を追加');
  assert.equal(poll.getAttribute('aria-label'),'Add poll');
  poll.click();assert.equal(nativePoll,1);
  f.select([f.file('one.jpg'),f.file('two.jpg')]);
  await settle(()=>f.uploads.length===1);f.complete(0);
  await settle(()=>f.uploads.length===2);f.complete(1);
  await settle(()=>f.document.querySelector('.ct-media-upload-status')?.textContent.includes('2枚を追加'));
  assert.equal(f.document.querySelector('textarea').value,'A draft');
});
function harness(t, html = uploadMarkup(), { transfer = true, locale = 'ja', reduced = false, viewport = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: reduced });
  if (viewport) {
    const visual = new window.EventTarget();
    Object.assign(visual, {width:390,height:844,offsetTop:0,offsetLeft:0,scale:1}, viewport);
    Object.defineProperty(window, 'visualViewport', {configurable:true,value:visual});
  }
  if (transfer) {
    window.DataTransfer = class {
      constructor() {
        this.files = [];
        this.items = { add: file => this.files.push(file) };
      }
    };
    const files = new WeakMap();
    const value = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    Object.defineProperty(window.HTMLInputElement.prototype, 'files', {
      get() { return files.get(this) || []; }, set(v) { files.set(this, [...v]); }, configurable: true
    });
    Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
      get() { return value.get.call(this); },
      set(v) { value.set.call(this, v); if (this.type === 'file' && v === '') files.set(this, []); }, configurable: true
    });
  }
  window.ctNetworkState = {authUID:''};
  window.eval(`const CT_LOCALE=${JSON.stringify(locale)};\n${photoViewport}\n${source}\nwindow.qa={ctMediaEnhance,ctMediaUploads,ctMediaCarousels,ctMediaVideos,ctMediaEnhanceVideo,network:ctNetworkState,get viewer(){return ctMediaViewer}};`);
  t.after(() => window.close());
  const f = { dom, window, document: window.document, qa: window.qa, uploads: [], submitted: 0, closed: 0 };
  f.enhance = () => f.qa.ctMediaEnhance();
  f.file = (name, type = 'image/jpeg') => new window.File(['original bytes'], name, { type });
  f.select = files => {
    const input = f.document.getElementById('photos');
    input.files = files;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  f.preview = (name, ready = false) => {
    const holder = f.document.createElement('div');
    holder.className = 'relative aspect-video';
    const img = f.document.createElement('img');
    img.alt = 'Upload preview'; img.src = `blob:https://app.tweet.app/${name}`;
    holder.append(img);
    f.document.getElementById('upload').prepend(holder);
    if (ready) f.completeHolder(holder);
    return holder;
  };
  f.completeHolder = holder => {
    const badge = f.document.createElement('div');
    badge.className = 'absolute bottom-2 left-2 bg-emerald-500/90';
    badge.textContent = 'Ready'; holder.append(badge);
  };
  f.complete = index => f.completeHolder(f.uploads[index].holder);
  f.error = message => {
    let el = f.document.querySelector('#upload > .text-red-500');
    if (!el) { el = f.document.createElement('div'); el.className = 'text-red-500'; f.document.getElementById('upload').prepend(el); }
    el.textContent = message;
  };
  f.status = () => f.document.querySelector('.ct-media-upload-status [role="status"]')?.textContent;
  f.document.getElementById('composer')?.addEventListener('change', event => {
    if (event.target.id !== 'photos') return;
    f.document.querySelector('#upload > .text-red-500')?.remove();
    const file = event.target.files[0];
    if (!file) return;
    const upload = { file, holder: f.preview(`${f.uploads.length}-${file.name}`) };
    f.uploads.push(upload);
    event.target.value = '';
  });
  for (const button of f.document.querySelectorAll('#public-tweet-submit-btn,#public-modal-tweet-submit-btn,#reply-submit')) {
    button.addEventListener('click', () => f.submitted++);
  }
  f.document.querySelector('textarea')?.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') f.submitted++;
  });
  f.document.getElementById('close')?.addEventListener('click', () => f.closed++);
  return f;
}
async function settle(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Expected state did not settle');
}
function geometry(f, grid, width = 400) {
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: width });
  grid.scrollTo = options => { grid.lastScroll = options; grid.scrollLeft = options.left; grid.dispatchEvent(new f.window.Event('scroll')); };
}

test('only the verified native photo input gains multi-selection, with no format changes', t => {
  const f = harness(t, uploadMarkup() + '<input id="profile" type="file" accept="image/jpeg,image/png,image/webp">');
  f.enhance(); f.enhance();
  assert.equal(f.document.getElementById('photos').multiple, true);
  assert.equal(f.document.getElementById('videos').multiple, false);
  assert.equal(f.document.getElementById('profile').multiple, false);
  assert.equal(f.document.getElementById('photos').accept, 'image/jpeg,image/png,image/webp');
  assert.equal(f.document.querySelectorAll('#ct-media-style').length, 1);
});
test('DataTransfer-unavailable browsers and future native multi-file handlers retain their native inputs', t => {
  const unsupported = harness(t, uploadMarkup(), { transfer: false });
  unsupported.enhance();
  assert.equal(unsupported.document.getElementById('photos').multiple, false);
  const native = harness(t);
  native.document.getElementById('photos').multiple = true;
  native.enhance();
  assert.equal(native.qa.ctMediaUploads.has(native.document.getElementById('photos')), false);
});
test('a single selected photo keeps the original one-file change behavior', t => {
  const f = harness(t); f.enhance();
  const photo = f.file('one.jpg'); f.select([photo]);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].file, photo);
  assert.equal(f.document.querySelector('.ct-media-upload-status'), null);
});
test('multiple photos are serialized through the native handler only after a ready preview', async t => {
  const f = harness(t); f.enhance();
  const photos = [f.file('one.jpg'), f.file('two.png', 'image/png'), f.file('three.webp', 'image/webp')];
  f.select(photos);
  assert.equal(f.uploads.length, 1);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.uploads.length, 1, 'a uploading preview is not a completed upload');
  f.complete(0); await settle(() => f.uploads.length === 2);
  f.complete(1); await settle(() => f.uploads.length === 3);
  f.complete(2); await settle(() => !f.qa.ctMediaUploads.get(f.document.getElementById('photos')).busy);
  assert.deepEqual(f.uploads.map(upload => upload.file), photos, 'exact File objects and original bytes are preserved');
  assert.match(f.status(), /3枚を追加/);
  assert.equal(f.document.querySelector('textarea').value, 'A draft');
  assert.equal(f.submitted, 0);
});
test('existing attachments consume slots and excess selected files are explicitly reported', async t => {
  const f = harness(t); f.preview('existing', true); f.enhance();
  f.select([1, 2, 3, 4, 5].map(n => f.file(`${n}.jpg`)));
  for (let i = 0; i < 3; i++) { await settle(() => f.uploads.length === i + 1); f.complete(i); }
  await settle(() => /残り2枚/.test(f.status()));
  assert.equal(f.uploads.length, 3);
  assert.equal(f.document.querySelectorAll('img[alt="Upload preview"]').length, 4);
});
test('a native error stops remaining files instead of retrying or bypassing validation', async t => {
  const f = harness(t); f.enhance(); f.select([f.file('one.jpg'), f.file('two.jpg')]);
  f.error('Daily upload limit reached');
  await settle(() => /エラー/.test(f.status()));
  assert.equal(f.uploads.length, 1);
  assert.equal(f.document.querySelector('#upload > .text-red-500').textContent, 'Daily upload limit reached');
});
test('native validation before staging, including the same previous error, stops safely', async t => {
  const f = harness(t); f.error('Images must be 10 MB or smaller.'); f.enhance();
  f.document.getElementById('photos').addEventListener('change', () => f.error('Images must be 10 MB or smaller.'));
  // Simulate validation with no preview: the fixture handler otherwise stages each File.
  f.document.getElementById('composer').addEventListener('change', () => {
    for (const img of f.document.querySelectorAll('img[alt="Upload preview"]')) img.parentElement.remove();
    f.error('Images must be 10 MB or smaller.');
  });
  f.select([f.file('big.jpg'), f.file('other.jpg')]);
  await settle(() => /エラー/.test(f.status()));
  assert.equal(f.uploads.length, 1);
});
test('video attachment or disabled native photo button does not start an upload queue', t => {
  for (const kind of ['video', 'disabled']) {
    const f = harness(t); f.enhance();
    if (kind === 'video') f.document.getElementById('upload').prepend(f.document.createElement('video'));
    else f.document.getElementById('photo').disabled = true;
    f.select([f.file('one.jpg'), f.file('two.jpg')]);
    assert.equal(f.uploads.length, 0, kind);
    assert.match(f.status(), /追加できません/);
  }
});
test('cancel stops remaining files without cancelling native work already dispatched', async t => {
  const f = harness(t); f.enhance(); f.select([f.file('one.jpg'), f.file('two.jpg')]);
  f.document.querySelector('.ct-media-upload-status button').click();
  await settle(() => /中止/.test(f.status()));
  f.complete(0);
  assert.equal(f.uploads.length, 1);
  assert.match(f.status(), /処理中の1枚/);
});
test('navigation or removal of the native composer stops the queue', async t => {
  const f = harness(t); f.enhance(); f.select([f.file('one.jpg'), f.file('two.jpg')]);
  f.window.history.pushState({}, '', '/settings');
  f.complete(0);
  await settle(() => /中止/.test(f.status()));
  assert.equal(f.uploads.length, 1);
  const g = harness(t); g.enhance(); g.select([g.file('one.jpg'), g.file('two.jpg')]);
  const state = g.qa.ctMediaUploads.get(g.document.getElementById('photos'));
  g.document.getElementById('composer').remove();
  await settle(() => !state.busy);
  assert.equal(g.uploads.length, 1);
});
for (const kind of ['home', 'modal', 'reply']) {
  test(`${kind}: busy queue blocks native submit and Cmd/Ctrl+Enter, preserving text and scope`, async t => {
    const f = harness(t, uploadMarkup(kind)); f.enhance(); f.select([f.file('one.jpg'), f.file('two.jpg')]);
    const submit = f.document.querySelector('#public-tweet-submit-btn,#public-modal-tweet-submit-btn,#reply-submit');
    submit.click();
    for (const modifier of ['ctrlKey', 'metaKey']) f.document.querySelector('textarea').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, bubbles: true }));
    assert.equal(f.submitted, 0);
    f.document.getElementById('close').click();
    assert.equal(f.closed, kind === 'reply' ? 0 : 1);
    f.document.querySelector('.ct-media-upload-status button').click();
    await settle(() => /中止/.test(f.status()));
    submit.click(); assert.equal(f.submitted, 1);
    assert.equal(f.document.querySelector('textarea').value, 'A draft');
  });
}
test('new selections during an active queue cannot start concurrent uploads', async t => {
  const f = harness(t); f.enhance(); f.select([f.file('one.jpg'), f.file('two.jpg')]);
  f.select([f.file('replacement.jpg')]);
  assert.equal(f.uploads.length, 1);
  f.complete(0); await settle(() => f.uploads.length === 2);
  assert.equal(f.uploads[1].file.name, 'two.jpg');
  f.complete(1); await settle(() => /2枚を追加/.test(f.status()));
});

test('native multi-photo grid gains a carousel without replacing photos or their click handlers', t => {
  const f = harness(t, `<main><article>${galleryMarkup()}</article></main>`);
  const grid = f.document.getElementById('gallery'); geometry(f, grid);
  const images = [...grid.querySelectorAll('img')]; let clicked = null;
  images.forEach((image, index) => image.addEventListener('click', event => { event.stopPropagation(); clicked = index; }));
  f.enhance(); f.enhance();
  assert.equal(f.document.querySelectorAll('.ct-media-carousel-controls').length, 1);
  assert.deepEqual([...grid.querySelectorAll('img')], images);
  images[2].click(); assert.equal(clicked, 2);
  assert.equal(grid.getAttribute('role'), 'region');
  assert.equal(grid.tabIndex, 0);
  assert.match(f.document.getElementById('ct-media-style').textContent, /scroll-snap-type:x mandatory/);
});
test('arrows, scroll and keyboard reach every photo with bounded controls and reduced motion', t => {
  const f = harness(t, `<main>${galleryMarkup(4)}</main>`, { locale: 'en', reduced: true });
  const grid = f.document.getElementById('gallery'); geometry(f, grid); f.enhance();
  const controls = grid.nextElementSibling;
  const [prev, next] = controls.querySelectorAll('button');
  assert.equal(prev.disabled, true);
  next.click(); assert.equal(grid.scrollLeft, 400); assert.equal(controls.querySelector('span').textContent, '2 / 4');
  assert.equal(grid.lastScroll.behavior, 'auto');
  grid.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(grid.scrollLeft, 1200); assert.equal(next.disabled, true);
  grid.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(grid.scrollLeft, 0);
  grid.scrollLeft = 800; grid.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(controls.querySelector('span').textContent, '3 / 4');
  assert.equal(prev.getAttribute('aria-label'), 'Previous photo');
});
test('carousel controls do not trigger post navigation and normal keys remain untouched', t => {
  const f = harness(t, `<main><article>${galleryMarkup()}</article></main>`);
  const grid = f.document.getElementById('gallery'); geometry(f, grid); let navigated = 0, keys = 0;
  f.document.querySelector('article').addEventListener('click', () => navigated++);
  f.document.addEventListener('keydown', () => keys++);
  f.enhance(); grid.nextElementSibling.querySelectorAll('button')[1].click();
  assert.equal(navigated, 0);
  grid.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(keys, 0);
  grid.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.equal(keys, 1);
});
test('single images, videos, quote media, upload previews and unrelated image grids stay unchanged', t => {
  const f = harness(t, `<main>${galleryMarkup(1, 'single')}<blockquote>${galleryMarkup(2, 'quote')}</blockquote>
    <div class="grid gap-0.5 rounded-2xl overflow-hidden border" id="video-grid"><video src="/movie.mp4"></video></div>
    <div class="grid gap-0.5 rounded-2xl overflow-hidden border" id="other"><img src="/one.jpg"><img src="/two.jpg"></div>
    ${uploadMarkup()}</main>`);
  const before = f.document.getElementById('single').outerHTML;
  f.enhance();
  assert.equal(f.document.querySelectorAll('.ct-media-carousel').length, 0);
  assert.equal(f.document.getElementById('single').outerHTML, before);
});
test('a reused grid changing to one image restores attributes and removes stale controls', t => {
  const f = harness(t, `<main>${galleryMarkup(2)}</main>`);
  const grid = f.document.getElementById('gallery'); grid.setAttribute('aria-label', 'Original'); geometry(f, grid);
  f.enhance(); grid.lastElementChild.remove(); f.enhance();
  assert.equal(grid.classList.contains('ct-media-carousel'), false);
  assert.equal(grid.getAttribute('aria-label'), 'Original');
  assert.equal(grid.hasAttribute('tabindex'), false);
  assert.equal(f.document.querySelector('.ct-media-carousel-controls'), null);
});
function nativeViewer(f, images) {
  let dialog;
  const clicked = [];
  images.forEach((image, index) => image.addEventListener('click', event => {
    event.stopPropagation(); clicked.push(index);
    if (!dialog?.isConnected) {
      dialog = f.document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Media viewer');
      const close = f.document.createElement('button'); close.setAttribute('aria-label', 'Close media viewer'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.remove());
      const preview = f.document.createElement('img'); preview.alt = 'Media preview'; preview.addEventListener('click', event => event.stopPropagation());
      dialog.append(close, preview); dialog.addEventListener('click', () => dialog.remove()); f.document.body.append(dialog);
    }
    dialog.querySelector('img').src = image.src;
  }));
  return { clicked, get dialog() { return dialog; } };
}
test('native enlarged viewer moves using original image handlers, retaining close and backdrop', t => {
  const f = harness(t, `<main>${galleryMarkup(3)}</main>`);
  const grid = f.document.getElementById('gallery'); geometry(f, grid);
  const images = [...grid.querySelectorAll('img')]; const native = nativeViewer(f, images); f.enhance();
  images[0].click(); f.enhance();
  const controls = native.dialog.querySelector('.ct-media-viewer-controls');
  assert.ok(controls);
  controls.querySelectorAll('button')[1].click();
  assert.equal(native.dialog.querySelector('img').src, images[1].src);
  assert.equal(controls.querySelector('span').textContent, '2 / 3');
  assert.deepEqual(native.clicked, [0, 1]);
  f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(native.dialog.querySelector('img').src, images[2].src);
  native.dialog.querySelector('[aria-label="Close media viewer"]').click(); f.enhance();
  assert.equal(f.document.querySelector('.ct-media-viewer-controls'), null);
  images[0].click(); f.enhance(); native.dialog.click(); f.enhance();
  assert.equal(f.document.querySelector('[role="dialog"]'), null);
});
test('viewer swipes move photos without hijacking vertical movement or unrelated viewer images', t => {
  const f = harness(t, `<main>${galleryMarkup(3)}</main>`);
  const grid = f.document.getElementById('gallery'); geometry(f, grid); const images = [...grid.querySelectorAll('img')];
  const native = nativeViewer(f, images); f.enhance(); images[0].click(); f.enhance();
  const swipe = (dx, dy) => {
    const image = native.dialog.querySelector('img');
    const begin = new f.window.Event('touchstart', { bubbles: true }); Object.defineProperty(begin, 'touches', { value: [{ clientX: 200, clientY: 100 }] }); image.dispatchEvent(begin);
    const end = new f.window.Event('touchend', { bubbles: true }); Object.defineProperty(end, 'changedTouches', { value: [{ clientX: 200 + dx, clientY: 100 + dy }] }); image.dispatchEvent(end);
  };
  swipe(-100, 5); assert.equal(native.dialog.querySelector('img').src, images[1].src);
  swipe(-20, 100); assert.equal(native.clicked.length, 2);
  native.dialog.remove(); f.enhance();
  const unrelated = f.document.createElement('div'); unrelated.setAttribute('role', 'dialog'); unrelated.setAttribute('aria-modal', 'true'); unrelated.setAttribute('aria-label', 'Media viewer'); unrelated.innerHTML = '<img alt="Media preview" src="/unrelated.jpg">'; f.document.body.append(unrelated); f.enhance();
  assert.equal(unrelated.querySelector('.ct-media-viewer-controls'), null);
});

test('React class and child replacement on an existing gallery restores the carousel without duplicate controls', t => {
  const f = harness(t, `<main>${galleryMarkup(3)}</main>`);
  const grid = f.document.getElementById('gallery'); geometry(f, grid); f.enhance();
  grid.className = 'grid gap-0.5 rounded-2xl overflow-hidden border border-tl-app-border grid-cols-2';
  grid.removeAttribute('tabindex'); grid.removeAttribute('aria-label');
  grid.append(grid.firstElementChild.cloneNode(true));
  f.enhance(); f.enhance();
  assert.ok(grid.classList.contains('ct-media-carousel'));
  assert.equal(grid.tabIndex, 0);
  assert.equal(grid.getAttribute('aria-label'), '投稿の写真');
  assert.equal(f.document.querySelectorAll('.ct-media-carousel-controls').length, 1);
  assert.equal(grid.nextElementSibling.querySelector('span').textContent, '1 / 4');
});
test('viewer navigation follows an asynchronous native React src update without relying on the shared observer', async t => {
  const f = harness(t, `<main>${galleryMarkup(3)}</main>`);
  const grid = f.document.getElementById('gallery'); geometry(f, grid); const images = [...grid.querySelectorAll('img')];
  const dialog = f.document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Media viewer');
  const image = f.document.createElement('img'); image.alt = 'Media preview'; dialog.append(image);
  images.forEach(native => native.addEventListener('click', event => {
    event.stopPropagation();
    queueMicrotask(() => { image.src = native.src; if (!dialog.isConnected) f.document.body.append(dialog); });
  }));
  f.enhance(); images[0].click(); await new Promise(resolve => setTimeout(resolve, 0)); f.enhance();
  const next = dialog.querySelector('.ct-media-viewer-controls button:last-child');
  next.click(); await settle(() => dialog.querySelector('[role="status"]').textContent === '2 / 3');
  assert.equal(image.src, images[1].src);
  next.click(); await settle(() => dialog.querySelector('[role="status"]').textContent === '3 / 3');
  assert.equal(image.src, images[2].src); assert.equal(next.disabled, true);
});

function motionViewer(t, options = {}) {
  const f = harness(t, `<main>${galleryMarkup(3)}</main>`, options);
  let reduceListener;
  const reduce={matches:options.reduced===true,addEventListener:(name,cb)=>reduceListener=cb,removeEventListener:()=>reduceListener=null};
  f.window.matchMedia=()=>reduce;
  f.setReduced=value=>{reduce.matches=value;reduceListener?.()};
  const frames = new Map(), timers = new Map(); let serial = 0, now = 0;
  f.window.requestAnimationFrame = cb => { frames.set(++serial, cb); return serial; };
  f.window.cancelAnimationFrame = id => frames.delete(id);
  f.window.setTimeout = (cb, ms) => { timers.set(++serial, {cb, ms}); return serial; };
  f.window.clearTimeout = id => timers.delete(id);
  f.window.performance.now = () => now;
  f.grid = f.document.getElementById('gallery'); geometry(f, f.grid, 390);
  f.images = [...f.grid.querySelectorAll('img')];
  f.native = nativeViewer(f, f.images); f.enhance(); f.images[0].click();
  f.preview = f.native.dialog.querySelector('img');
  f.stage = f.document.createElement('div'); f.preview.before(f.stage); f.stage.append(f.preview);
  Object.defineProperty(f.stage, 'clientWidth', {value:390});
  if (options.pointer) f.window.PointerEvent = f.window.MouseEvent;
  f.enhance();
  f.flushFrames = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb=>cb()); };
  f.tick = ms => { now += ms; for(const [id,timer] of [...timers]) if(timer.ms<=ms){ timers.delete(id);timer.cb(); } };
  f.gesture = (type, x, y = 100, extra = {}) => {
    const e = new f.window.Event(type, {bubbles:true,cancelable:true});
    Object.defineProperties(e, {
      touches:{value:[{clientX:x,clientY:y}]},changedTouches:{value:[{clientX:x,clientY:y}]},
      clientX:{value:x},clientY:{value:y},pointerId:{value:7},isPrimary:{value:true},button:{value:0},...extra
    }); f.preview.dispatchEvent(e); return e;
  };
  f.frames = frames; f.timers = timers;
  return f;
}
test('photo follows horizontal touch movement once per frame, then settles with the native image and handler preserved', t => {
  const f=motionViewer(t); const original=f.preview;
  f.gesture('touchstart',240);f.gesture('touchmove',180);f.gesture('touchmove',120);
  assert.equal(f.frames.size,1);assert.deepEqual(f.native.clicked,[0]);
  f.flushFrames();const track=f.document.querySelector('.ct-media-photo-track');
  assert.match(track.style.transform,/-120px/);
  assert.equal(f.document.querySelector('.ct-media-photo-layer').getAttribute('aria-hidden'),'true');
  f.gesture('touchend',100);assert.deepEqual(f.native.clicked,[0,1]);assert.equal(f.preview,original);
  assert.equal(original.src,f.images[1].src);assert.equal(track.style.transform,'translate3d(-200%,0,0)');
  assert.match(track.style.transition,/220ms/);f.tick(240);
  original.dispatchEvent(new f.window.Event('load'));assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);
  assert.equal(original.classList.contains('ct-media-photo-covered'),false);assert.equal(f.timers.size,0);
});
test('short slow drag settles back, first-photo resistance stays at the boundary, and vertical/pinch gestures are untouched', t => {
  const f=motionViewer(t);
  f.gesture('touchstart',200);f.gesture('touchmove',180);f.tick(500);f.gesture('touchend',180);
  assert.deepEqual(f.native.clicked,[0]);assert.equal(f.document.querySelector('.ct-media-photo-track').style.transform,'translate3d(-100%,0,0)');
  f.tick(240);f.gesture('touchstart',200);f.gesture('touchmove',300);f.flushFrames();
  assert.match(f.document.querySelector('.ct-media-photo-track').style.transform,/22px/);
  f.gesture('touchend',300);assert.deepEqual(f.native.clicked,[0]);f.tick(240);
  f.gesture('touchstart',200);const vertical=f.gesture('touchmove',205,170);f.gesture('touchend',210,200);
  assert.equal(vertical.defaultPrevented,false);assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);
  f.gesture('touchstart',200);f.gesture('touchmove',100);f.gesture('touchmove',90,100,{touches:{value:[{},{}]}});
  assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.deepEqual(f.native.clicked,[0]);
});
test('PointerEvent navigation suppresses only the following drag click and keeps close/backdrop controls', t => {
  const f=motionViewer(t,{pointer:true});let photoClicks=0;f.preview.addEventListener('click',()=>photoClicks++);
  f.gesture('pointerdown',240);f.gesture('pointermove',120);f.flushFrames();f.gesture('pointerup',100);
  assert.deepEqual(f.native.clicked,[0,1]);f.preview.click();assert.equal(photoClicks,0);
  f.native.dialog.querySelector('[aria-label="Close media viewer"]').click();f.enhance();
  assert.equal(f.document.querySelector('[aria-label="Media viewer"]'),null);assert.equal(f.qa.viewer,null);
  assert.equal(f.preview.classList.contains('ct-media-photo-covered'),false);assert.equal(f.timers.size,0);
});
test('reduced motion switches directly and canceled pointers remove presentation without choosing another photo', t => {
  const reduced=motionViewer(t,{reduced:true});reduced.gesture('touchstart',200);reduced.gesture('touchmove',100);reduced.gesture('touchend',90);
  assert.deepEqual(reduced.native.clicked,[0,1]);assert.equal(reduced.document.querySelector('.ct-media-photo-layer'),null);
  const f=motionViewer(t,{pointer:true});f.gesture('pointerdown',200);f.gesture('pointermove',100);f.gesture('pointercancel',100);
  assert.deepEqual(f.native.clicked,[0]);assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.frames.size,0);
});
test('route, account and source changes discard a photo gesture without invoking a stale native handler', t => {
  for(const change of ['route','account','source']){
    const f=motionViewer(t);f.gesture('touchstart',200);f.gesture('touchmove',100);
    if(change==='route')f.window.history.pushState({},'', '/notifications');
    if(change==='account')f.qa.network.authUID='new-account';
    if(change==='source')f.images[1].src='https://media.tweet.app/replaced.jpg';
    f.gesture('touchend',80);assert.deepEqual(f.native.clicked,[0]);assert.equal(f.qa.viewer,null);
    assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.preview.classList.contains('ct-media-photo-covered'),false);
    assert.ok(f.native.dialog.isConnected,'native dialog is retained');
  }
});
test('backgrounding and image errors release the photo layer, animation frames and timers', t => {
  const f=motionViewer(t);f.gesture('touchstart',200);f.gesture('touchmove',100);
  Object.defineProperty(f.document,'hidden',{configurable:true,value:true});f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.frames.size,0);
  Object.defineProperty(f.document,'hidden',{configurable:true,value:false});f.gesture('touchstart',200);f.gesture('touchmove',100);f.gesture('touchend',90);f.tick(240);
  f.preview.dispatchEvent(new f.window.Event('error'));assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.timers.size,0);
});
test('gallery height-only resize leaves an in-progress swipe alone and width resize aligns without smooth scrolling', t => {
  const f=harness(t,`<main>${galleryMarkup(3)}</main>`);const grid=f.document.getElementById('gallery');geometry(f,grid,390);
  let resize;f.window.ResizeObserver=class {constructor(cb){resize=cb}observe(){}disconnect(){}};f.enhance();
  grid.scrollLeft=100;resize();resize();assert.equal(grid.lastScroll,undefined);assert.equal(grid.scrollLeft,100);
  Object.defineProperty(grid,'clientWidth',{configurable:true,value:320});resize();assert.deepEqual({...grid.lastScroll},{left:0,behavior:'auto'});
});
test('release before the queued animation frame begins settling from the latest finger position', t => {
  const f=motionViewer(t);f.gesture('touchstart',240);f.gesture('touchmove',160);
  const track=f.document.querySelector('.ct-media-photo-track');let start;
  track.getBoundingClientRect=()=>{start=track.style.transform;return {width:390}};
  f.gesture('touchend',100);assert.match(start,/-140px/);assert.equal(f.frames.size,0);
});
test('asynchronous native commit locks repeated navigation and an old-source load cannot release its photo layer', t => {
  const f=motionViewer(t);f.images[1].addEventListener('click',e=>{e.stopImmediatePropagation();f.native.clicked.push(1)},{capture:true});
  const next=f.native.dialog.querySelector('.ct-media-viewer-controls button:last-child');next.click();next.click();
  assert.deepEqual(f.native.clicked,[0,1]);assert.equal(next.disabled,true);f.tick(240);
  f.preview.dispatchEvent(new f.window.Event('load'));assert.ok(f.document.querySelector('.ct-media-photo-layer'));
  f.preview.src=f.images[1].src;f.preview.dispatchEvent(new f.window.Event('load'));f.enhance();
  assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(next.disabled,false);
  assert.equal(f.native.dialog.querySelector('[role="status"]').textContent,'2 / 3');
});
test('a native handler with no commit times out, restores navigation and follows a later commit, including reduced motion', t => {
  for(const reduced of [false,true]) {
    const f=motionViewer(t,{reduced});f.images[1].addEventListener('click',e=>e.stopImmediatePropagation(),{capture:true});
    const next=f.native.dialog.querySelector('.ct-media-viewer-controls button:last-child');next.click();assert.equal(next.disabled,true);
    f.tick(1600);assert.equal(next.disabled,false);assert.equal(f.qa.viewer.requestedIndex,null);
    assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.native.dialog.querySelector('[role="status"]').textContent,'1 / 3');
    f.preview.src=f.images[1].src;f.enhance();assert.equal(f.native.dialog.querySelector('[role="status"]').textContent,'2 / 3');
  }
});
test('mouse pointer capture stays on the preview and its native drag ghost is prevented', t => {
  const f=motionViewer(t,{pointer:true});let captured,released;
  f.preview.setPointerCapture=id=>captured=id;f.preview.releasePointerCapture=id=>released=id;
  f.gesture('pointerdown',240);const drag=f.gesture('dragstart',240);assert.equal(drag.defaultPrevented,true);
  f.gesture('pointermove',100);assert.equal(captured,7);f.gesture('pointerup',90);assert.equal(released,7);
  f.preview.click();assert.ok(f.native.dialog.isConnected);
});
test('changing reduced motion during a captured drag restores the photo and releases capture without navigation', t => {
  const f=motionViewer(t,{pointer:true});let released=0;f.preview.setPointerCapture=()=>{};f.preview.releasePointerCapture=()=>released++;
  f.gesture('pointerdown',240);f.gesture('pointermove',100);f.setReduced(true);
  assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.frames.size,0);assert.equal(released,1);
  f.gesture('pointerup',90);assert.deepEqual(f.native.clicked,[0]);
});

function nativeVideo(f, { paused = false, standard = true, safari = false, deny = false } = {}) {
  const video = f.document.querySelector('video');
  let playing = !paused, fullscreen = null;
  const calls = { pause: 0, play: 0, request: 0, exit: 0 };
  Object.defineProperties(video, {
    paused: { configurable: true, get: () => !playing },
    currentSrc: { configurable: true, get: () => video.src }
  });
  Object.defineProperty(f.document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  video.currentTime = 12.5; video.muted = false; video.volume = .35; video.playbackRate = 1.5;
  const nativePause = () => {
    playing = false;
    video.dispatchEvent(new f.window.Event('pause'));
  };
  video.pause = function () { calls.pause++; nativePause(); };
  video.play = function () { calls.play++; playing = true; video.dispatchEvent(new f.window.Event('play')); return Promise.resolve(); };
  const enter = () => {
    fullscreen = video;
    f.document.dispatchEvent(new f.window.Event('fullscreenchange'));
  };
  const exit = () => {
    fullscreen = null;
    f.document.dispatchEvent(new f.window.Event('fullscreenchange'));
  };
  if (standard) video.requestFullscreen = function () {
    calls.request++;
    if (deny) return Promise.reject(new Error('Denied'));
    assert.equal(this, video);
    enter();
    return Promise.resolve();
  };
  if (safari) {
    video.webkitEnterFullscreen = () => { calls.request++; video.dispatchEvent(new f.window.Event('webkitbeginfullscreen')); };
    video.webkitExitFullscreen = () => { calls.exit++; video.dispatchEvent(new f.window.Event('webkitendfullscreen')); };
  }
  f.document.exitFullscreen = () => { calls.exit++; exit(); return Promise.resolve(); };
  return { video, calls, enter, exit, nativePause, originalPause: video.pause,
    enterWithoutEvent: () => { fullscreen = video; },
    fullscreenEvent: () => f.document.dispatchEvent(new f.window.Event('fullscreenchange')),
    nativePlay: () => { playing = true; video.dispatchEvent(new f.window.Event('play')); } };
}
function postedVideoMarkup(extra = '') {
  return `<main><article><div id="video-shell" class="rounded-2xl overflow-hidden border bg-black">
    <video src="https://media.tweet.app/test.mp4" class="w-full max-h-[31.875rem] object-contain" controls playsinline loop muted></video>
    </div>${extra}</article></main>`;
}
test('fullscreen uses the original playing video without changing playback, source, sound or its parent', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f);
  const video = player.video, shell = video.parentElement, time = video.currentTime, source = video.src;
  f.enhance(); f.enhance();
  assert.equal(f.document.querySelectorAll('.ct-media-video-fullscreen').length, 1);
  assert.equal(f.document.querySelector('video'), video);
  f.document.querySelector('.ct-media-video-fullscreen').click();
  await Promise.resolve();
  assert.equal(player.calls.request, 1);
  assert.equal(player.calls.play, 0);
  assert.equal(player.calls.pause, 0);
  assert.equal(video.parentElement, shell);
  assert.equal(video.src, source);
  assert.equal(video.currentTime, time);
  assert.equal(video.paused, false);
  assert.equal(video.muted, false); assert.equal(video.volume, .35); assert.equal(video.playbackRate, 1.5);
  assert.equal(video.controls, true);
  player.exit();
  assert.equal(video.pause, player.originalPause);
  assert.equal(video.paused, false); assert.equal(video.currentTime, time);
});
test('paused media is never started by fullscreen and page pause calls still work', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f, { paused: true }); f.enhance();
  f.document.querySelector('.ct-media-video-fullscreen').click();
  await settle(() => !f.document.querySelector('.ct-media-video-fullscreen').disabled);
  assert.equal(player.video.paused, true); assert.equal(player.calls.play, 0);
  player.video.pause(); assert.equal(player.calls.pause, 1);
  player.exit(); assert.equal(player.video.pause, player.originalPause);
});
test('the inline autoplay manager cannot pause an active fullscreen video while native controls can pause and resume it', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); f.enhance();
  f.document.querySelector('.ct-media-video-fullscreen').click(); await Promise.resolve();
  player.video.pause();
  assert.equal(player.calls.pause, 0); assert.equal(player.video.paused, false);
  player.nativePause();
  assert.equal(player.video.paused, true);
  player.video.pause(); assert.equal(player.calls.pause, 1);
  player.nativePlay();
  player.video.pause(); assert.equal(player.calls.pause, 1); assert.equal(player.video.paused, false);
  player.exit();
  player.video.pause(); assert.equal(player.calls.pause, 2); assert.equal(player.video.paused, true);
  assert.equal(player.calls.play, 0, 'continuity must not be implemented by repeated play calls');
});
test('fullscreen entered from native controls also preserves the same playing node and restores the pause method on exit', t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); f.enhance();
  player.enter(); player.video.pause();
  assert.equal(player.calls.request, 0); assert.equal(player.calls.pause, 0); assert.equal(player.video.paused, false);
  player.exit(); assert.equal(player.video.pause, player.originalPause);
});
test('a denied fullscreen request preserves playback and offers a localized standard-control fallback', async t => {
  const f = harness(t, postedVideoMarkup(), { locale: 'en' }); const player = nativeVideo(f, { deny: true }); f.enhance();
  const descriptor = Object.getOwnPropertyDescriptor(player.video, 'pause');
  f.document.querySelector('.ct-media-video-fullscreen').click();
  await settle(() => !f.document.querySelector('.ct-media-video-fullscreen').disabled);
  assert.equal(player.video.paused, false); assert.equal(player.calls.play, 0); assert.equal(player.calls.pause, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(player.video, 'pause'), descriptor);
  assert.equal(f.document.querySelector('.ct-media-video-fullscreen').disabled, false);
  assert.match(f.document.querySelector('.ct-media-video-status').textContent, /video player controls/);
  assert.equal(f.qa.ctMediaVideos.get(player.video).guardTimer, null);
});
test('Safari fullscreen event paths preserve playback and restore the original pause method', t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f, { standard: false, safari: true }); f.enhance();
  f.document.querySelector('.ct-media-video-fullscreen').click();
  assert.equal(player.calls.request, 1); player.video.pause();
  assert.equal(player.calls.pause, 0); assert.equal(player.video.paused, false);
  player.video.webkitExitFullscreen();
  assert.equal(player.video.pause, player.originalPause); assert.equal(player.video.paused, false);
});
test('background pauses remain allowed and a removed fullscreen post is stopped without replay', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); f.enhance();
  f.document.querySelector('.ct-media-video-fullscreen').click(); await Promise.resolve();
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: true });
  player.video.pause(); assert.equal(player.calls.pause, 1); assert.equal(player.video.paused, true);
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: false }); player.nativePlay();
  player.video.remove(); f.enhance();
  assert.equal(player.calls.pause, 2); assert.equal(player.calls.exit, 1);
  assert.equal(player.video.pause, player.originalPause); assert.equal(f.qa.ctMediaVideos.size, 0);
  assert.equal(player.calls.play, 0);
});
test('hiding the page releases the fullscreen guard and timer without forcing playback or reopening media', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); f.enhance();
  f.document.querySelector('.ct-media-video-fullscreen').click(); await Promise.resolve();
  const state = f.qa.ctMediaVideos.get(player.video); assert.ok(state.guardTimer);
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: true });
  f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(player.video.pause, player.originalPause); assert.equal(state.guardTimer, null);
  assert.equal(player.calls.play, 0); assert.equal(player.calls.request, 1);
  player.video.pause(); assert.equal(player.video.paused, true);
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: false });
  f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(player.video.paused, true); assert.equal(player.calls.play, 0);
  player.exit(); assert.equal(player.video.pause, player.originalPause); assert.equal(state.guardTimer, null);
});
test('source, account and route changes invalidate fullscreen without preserving another media or account session', async t => {
  for (const change of ['source', 'account', 'route']) {
    const f = harness(t, postedVideoMarkup()); f.window.ctNetworkState = { authUID: 'account-one' };
    const player = nativeVideo(f); f.enhance();
    f.document.querySelector('.ct-media-video-fullscreen').click(); await Promise.resolve();
    if (change === 'source') player.video.src = 'https://media.tweet.app/changed.mp4';
    if (change === 'account') f.window.ctNetworkState.authUID = 'account-two';
    if (change === 'route') f.window.history.pushState({}, '', '/user/another');
    f.enhance();
    assert.equal(player.video.pause, player.originalPause, change);
    assert.equal(player.calls.exit, 1, change); assert.equal(player.video.paused, true, change);
    assert.equal(player.calls.play, 0, change);
  }
});
test('late completion or rejection of an earlier fullscreen request cannot terminate a newer session', async t => {
  for (const stale of ['resolve', 'reject']) {
    const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f);
    const requests = [];
    player.video.requestFullscreen = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
    f.enhance(); const button = f.document.querySelector('.ct-media-video-fullscreen');
    button.click();
    player.video.src = 'https://media.tweet.app/next.mp4'; f.enhance();
    assert.equal(button.disabled, false);
    player.nativePlay(); button.click(); player.enter();
    const guard = player.video.pause;
    requests[0][stale](stale === 'reject' ? new Error('Old denied') : undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(player.video.pause, guard, stale);
    assert.equal(player.video.paused, false, stale);
    assert.equal(player.calls.exit, 0, stale);
    assert.equal(f.document.querySelector('.ct-media-video-status').hidden, true, stale);
    requests[1].resolve(); await new Promise(resolve => setTimeout(resolve, 0));
    player.video.pause(); assert.equal(player.video.paused, false, stale);
    assert.equal(player.calls.exit, 0, stale);
    player.exit(); assert.equal(player.video.pause, player.originalPause, stale);
  }
});
test('a late fullscreen event from a cancelled request cannot reopen media after its source changed', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); let resolveRequest;
  player.video.requestFullscreen = () => new Promise(resolve => { resolveRequest = resolve; });
  f.enhance(); f.document.querySelector('.ct-media-video-fullscreen').click();
  player.video.src = 'https://media.tweet.app/next.mp4'; f.enhance();
  player.nativePlay(); player.enter();
  assert.equal(player.video.paused, true); assert.equal(player.calls.exit, 1);
  resolveRequest(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(player.video.pause, player.originalPause);
  assert.equal(player.calls.play, 0); assert.equal(f.document.fullscreenElement, null);
});
test('cancelled fullscreen success before its queued entry event is stopped and cannot bind changed media', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); let resolveRequest;
  player.video.requestFullscreen = () => new Promise(resolve => { resolveRequest = resolve; });
  f.enhance(); f.document.querySelector('.ct-media-video-fullscreen').click();
  player.video.src = 'https://media.tweet.app/next.mp4'; f.enhance();
  player.nativePlay(); player.enterWithoutEvent(); resolveRequest();
  await new Promise(resolve => setTimeout(resolve, 0));
  const state = f.qa.ctMediaVideos.get(player.video);
  assert.equal(player.calls.exit, 1); assert.equal(player.video.paused, true);
  assert.equal(state.context, null); assert.equal(state.pauseGuard, null); assert.equal(state.guardTimer, null);
  player.fullscreenEvent();
  assert.equal(state.context, null); assert.equal(state.pauseGuard, null); assert.equal(state.guardTimer, null);
  assert.equal(player.calls.play, 0); assert.equal(f.document.fullscreenElement, null);
});
test('a cancelled request that rejects leaves later native-control fullscreen available', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); let rejectRequest;
  player.video.requestFullscreen = () => new Promise((_, reject) => { rejectRequest = reject; });
  f.enhance(); f.document.querySelector('.ct-media-video-fullscreen').click();
  player.video.src = 'https://media.tweet.app/next.mp4'; f.enhance(); rejectRequest(new Error('Old denied'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const state = f.qa.ctMediaVideos.get(player.video);
  assert.equal(state.invalidatedFullscreen, false);
  player.nativePlay(); player.enter(); player.video.pause();
  assert.equal(player.video.paused, false); assert.equal(player.calls.exit, 0);
  player.exit(); assert.equal(player.video.pause, player.originalPause);
});
test('a fullscreen event queued after hiding the page cannot recreate a guard or timer in the background', t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); f.enhance(); player.enter();
  const state = f.qa.ctMediaVideos.get(player.video);
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: true });
  f.document.dispatchEvent(new f.window.Event('visibilitychange')); player.fullscreenEvent();
  assert.equal(state.context, null); assert.equal(state.pauseGuard, null); assert.equal(state.guardTimer, null);
  assert.equal(player.video.pause, player.originalPause); assert.equal(player.calls.play, 0);
  player.nativePause();
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: false });
  f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(player.video.paused, true); assert.equal(player.calls.play, 0);
  player.exit(); assert.equal(state.guardTimer, null);
});
test('an earlier exit event does not cancel a valid request still waiting to enter fullscreen', async t => {
  const f = harness(t, postedVideoMarkup()); const player = nativeVideo(f); let resolveRequest;
  player.video.requestFullscreen = () => new Promise(resolve => { resolveRequest = resolve; });
  f.enhance(); f.document.querySelector('.ct-media-video-fullscreen').click();
  const state = f.qa.ctMediaVideos.get(player.video), context = state.context, sequence = state.requestSequence;
  player.fullscreenEvent();
  assert.equal(state.context, context); assert.equal(state.requestSequence, sequence); assert.equal(state.requesting, true);
  player.enterWithoutEvent(); resolveRequest(); await new Promise(resolve => setTimeout(resolve, 0));
  player.fullscreenEvent(); player.video.pause();
  assert.equal(player.video.paused, false); assert.equal(player.calls.exit, 0);
  player.exit(); assert.equal(player.video.pause, player.originalPause);
});
test('local profile video gets an inline fullscreen control but upload previews and unrelated videos are untouched', t => {
  const f = harness(t, `<main><section data-ct-local-ui="profile"><div><video class="ct-profile-video" src="/local.mp4" controls playsinline></video></div></section>
    <div class="w-full mt-3 space-y-3"><video id="upload-video" src="/upload.mp4" class="w-full object-contain" controls playsinline loop></video></div>
    <video id="other-video" src="/other.mp4" controls></video></main>`);
  const player = nativeVideo(f); f.document.querySelectorAll('video').forEach(video => { video.requestFullscreen ||= () => Promise.resolve(); });
  f.enhance();
  assert.equal(f.document.querySelectorAll('.ct-media-video-fullscreen').length, 1);
  assert.ok(player.video.nextElementSibling.classList.contains('ct-media-video-inline-tools'));
  assert.equal(f.document.getElementById('upload-video').classList.contains('ct-media-enhanced-video'), false);
  assert.equal(f.document.getElementById('other-video').classList.contains('ct-media-enhanced-video'), false);
});
test('single native photos center in the visual viewport independently of carousel setup, while contained viewers keep their modal bounds', t => {
  const f = harness(t, `<main></main><div class="fixed inset-0" role="dialog" aria-modal="true" aria-label="Media viewer" id="fixed">
    <div><button aria-label="Close media viewer">Close</button></div><div><img alt="Media preview" src="/one.jpg"></div></div>
    <div class="absolute inset-0" role="dialog" aria-modal="true" aria-label="Media viewer" id="contained">
    <div><button aria-label="Close media viewer">Close</button></div><div><img alt="Media preview" src="/two.jpg"></div></div>`);
  const viewport = new f.window.EventTarget(); Object.assign(viewport, { width: 390, height: 520, offsetTop: 34, offsetLeft: 2 });
  Object.defineProperty(f.window, 'visualViewport', { configurable: true, value: viewport });
  f.enhance();
  const fixed = f.document.getElementById('fixed'), contained = f.document.getElementById('contained');
  assert.ok(fixed.classList.contains('ct-media-viewport-viewer'));
  assert.equal(fixed.style.getPropertyValue('--ct-media-view-height'), '520px');
  assert.equal(fixed.style.getPropertyValue('--ct-media-view-top'), '34px');
  assert.equal(fixed.querySelector('img').parentElement.className, 'ct-media-viewer-stage');
  assert.equal(fixed.querySelectorAll('.ct-media-viewer-controls').length, 0);
  assert.ok(contained.classList.contains('ct-media-centered-viewer'));
  assert.equal(contained.classList.contains('ct-media-viewport-viewer'), false);
  viewport.height = 390; viewport.offsetTop = 0; viewport.dispatchEvent(new f.window.Event('resize'));
  assert.equal(fixed.style.getPropertyValue('--ct-media-view-height'), '390px');
  const style = f.document.getElementById('ct-media-style').textContent;
  assert.match(style, /align-items:center!important; justify-content:center!important/);
  assert.match(style, /max\(env\(safe-area-inset-top\),env\(safe-area-inset-bottom\)\)/);
  assert.match(style, /prefers-reduced-motion:reduce/);
  assert.match(style, /hover:hover\) and \(pointer:fine/);
});

function photoViewportFixture(f, values = {}) {
  const viewport = f.window.visualViewport || new f.window.EventTarget();
  Object.assign(viewport, {width:390,height:844,offsetTop:0,offsetLeft:0,scale:1}, values);
  Object.defineProperty(f.window, 'visualViewport', {configurable:true,value:viewport});
  f.enhance();
  return viewport;
}
test('native photo zoom retains layout size and position through 2x, 4x and browser pan, then refits after zoom-out', t => {
  const f=harness(t, '<div class="fixed" role="dialog" aria-modal="true" aria-label="Media viewer"><div><button aria-label="Close media viewer">Close</button></div><div><img alt="Media preview" src="/photo.jpg"></div></div>');
  const v=photoViewportFixture(f), d=f.document.querySelector('[role=dialog]'), img=d.querySelector('img');
  const original=d.style.cssText;
  for(const values of [{scale:2,width:195,height:422,offsetLeft:60,offsetTop:100},{scale:4,width:97.5,height:211,offsetLeft:90,offsetTop:180}]) {
    Object.assign(v,values);v.dispatchEvent(new f.window.Event('resize'));v.dispatchEvent(new f.window.Event('scroll'));f.enhance();
    assert.equal(d.style.cssText,original);assert.equal(d.querySelector('img'),img);assert.equal(img.getAttribute('src'),'/photo.jpg');
    assert.equal(d.classList.contains('ct-media-photo-zoomed'),true);
  }
  Object.assign(v,{scale:1,width:390,height:740,offsetLeft:0,offsetTop:0});v.dispatchEvent(new f.window.Event('resize'));
  assert.equal(d.style.getPropertyValue('--ct-media-view-height'),'740px');assert.equal(d.classList.contains('ct-media-photo-zoomed'),false);
});
test('a photo opened while already zoomed starts at unscaled bounds rather than the shrinking viewport', t => {
  const f=harness(t,'<div class="fixed" role="dialog" aria-modal="true" aria-label="Media viewer"><div><img alt="Media preview" src="/photo.jpg"></div></div>');
  photoViewportFixture(f,{scale:2,width:195,height:422,offsetLeft:100,offsetTop:200});const d=f.document.querySelector('[role=dialog]');
  assert.equal(d.style.getPropertyValue('--ct-media-view-width'),'390px');assert.equal(d.style.getPropertyValue('--ct-media-view-height'),'844px');
  assert.equal(d.style.getPropertyValue('--ct-media-view-top'),'0px');assert.equal(d.style.getPropertyValue('--ct-media-view-left'),'0px');
});
test('zoom beginning mid-swipe cancels touch and pointer movement without a native photo switch, even before viewport events', t => {
  for(const pointer of [false,true]) {
    const f=motionViewer(t,{pointer,viewport:{}});const v=photoViewportFixture(f);const names=pointer?['pointerdown','pointermove','pointerup']:['touchstart','touchmove','touchend'];
    f.gesture(names[0],280);f.gesture(names[1],200);f.flushFrames();assert.ok(f.qa.viewer.motion);
    Object.assign(v,{scale:2,width:195,height:422});const move=f.gesture(names[1],80);f.gesture(names[2],70);f.tick(1800);
    assert.equal(move.defaultPrevented,false);assert.deepEqual(f.native.clicked,[0]);assert.equal(f.qa.viewer.touch,null);assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);
  }
});
test('viewport zoom cancels an existing captured drag immediately and allows horizontal browser panning', t => {
  const f=motionViewer(t,{pointer:true,viewport:{}});const v=photoViewportFixture(f);let released=0;
  f.preview.setPointerCapture=()=>{};f.preview.releasePointerCapture=()=>released++;
  f.gesture('pointerdown',280);f.gesture('pointermove',160);f.flushFrames();
  Object.assign(v,{scale:2,width:195,height:422});v.dispatchEvent(new f.window.Event('resize'));
  assert.equal(released,1);assert.equal(f.qa.viewer.touch,null);assert.equal(f.qa.viewer.motion,null);
  f.gesture('pointerup',80);f.gesture('pointerdown',280);const move=f.gesture('pointermove',80);f.gesture('pointerup',80);
  assert.equal(move.defaultPrevented,false);assert.deepEqual(f.native.clicked,[0]);assert.ok(f.native.dialog.classList.contains('ct-media-photo-zoomed'));
  assert.match(f.document.getElementById('ct-media-style').textContent,/\.ct-media-photo-zoomed \.ct-media-swipe-stage \{ touch-action:pan-x pan-y pinch-zoom/);
});
test('multi-pointer pinch remains canceled until every finger lifts and a new gesture starts', t => {
  const f=motionViewer(t,{pointer:true,viewport:{}});photoViewportFixture(f);
  f.gesture('pointerdown',280);f.gesture('pointermove',200);f.flushFrames();
  const secondary={pointerId:{value:8},isPrimary:{value:false},pointerType:{value:'touch'}};
  f.gesture('pointerdown',160,100,secondary);f.gesture('pointerup',180);
  const move=f.gesture('pointermove',40,100,secondary);f.gesture('pointerup',40,100,secondary);
  assert.equal(move.defaultPrevented,false);assert.deepEqual(f.native.clicked,[0]);assert.equal(f.qa.viewer.pointers.size,0);assert.equal(f.qa.viewer.pinch,false);
  f.gesture('pointerdown',280);f.gesture('pointermove',120);f.gesture('pointerup',90);f.tick(240);assert.deepEqual(f.native.clicked,[0,1]);
});
test('touch fallback does not turn the remaining finger of a pinch into a swipe', t => {
  const f=motionViewer(t,{viewport:{}});photoViewportFixture(f);
  f.gesture('touchstart',280);f.gesture('touchmove',200);
  f.gesture('touchstart',160,100,{touches:{value:[{clientX:200,clientY:100},{clientX:160,clientY:100}]}});
  f.gesture('touchend',200,100,{touches:{value:[{clientX:160,clientY:100}]}});
  const move=f.gesture('touchmove',40);f.gesture('touchend',40,100,{touches:{value:[]}});
  assert.equal(move.defaultPrevented,false);assert.deepEqual(f.native.clicked,[0]);assert.equal(f.qa.viewer.pinch,false);
  f.gesture('touchstart',280);f.gesture('touchend',90,100,{touches:{value:[]}});f.tick(240);assert.deepEqual(f.native.clicked,[0,1]);
});
test('unzoomed viewport resize cancels stale drag geometry while fresh swipes continue to work', t => {
  const f=motionViewer(t,{pointer:true,viewport:{}});const v=photoViewportFixture(f);
  f.gesture('pointerdown',280);f.gesture('pointermove',200);f.flushFrames();v.height=600;v.dispatchEvent(new f.window.Event('resize'));
  f.gesture('pointerup',90);assert.deepEqual(f.native.clicked,[0]);assert.equal(f.qa.viewer.motion,null);
  f.gesture('pointerdown',280);f.gesture('pointerup',90);f.tick(240);assert.deepEqual(f.native.clicked,[0,1]);
});
