const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/media.js'), 'utf8');

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
function harness(t, html = uploadMarkup(), { transfer = true, locale = 'ja', reduced = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: reduced });
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
  window.eval(`const CT_LOCALE=${JSON.stringify(locale)};\n${source}\nwindow.qa={ctMediaEnhance,ctMediaUploads,ctMediaCarousels};`);
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
