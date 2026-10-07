const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/media.js'), 'utf8');
const photoViewport = fs.readFileSync(path.join(__dirname, '../src/photo-viewport.js'), 'utf8');
const {galleryMarkup,viewerMarkup,installNativeViewer}=require('./helpers/native-media.cjs');

function uploadMarkup(kind = 'home') {
  const submit = `<button id="${kind === 'modal' ? 'public-modal-tweet-submit-btn' : kind === 'reply' ? 'reply-submit' : 'public-tweet-submit-btn'}">Post</button>`;
  return `<main><section id="composer" ${kind === 'reply' ? 'role="form"' : ''}>
    <textarea id="${kind === 'modal' ? 'public-modal-tweet-input' : 'public-tweet-input'}" name="compose-text">A draft</textarea>
    <div id="upload" class="w-full mt-3 space-y-3"><div id="toolbar" class="flex items-center justify-between pt-3">
      <div class="flex items-center gap-0.5"><button id="photo" type="button"><svg class="lucide lucide-image"></svg></button><button id="video" type="button"><svg class="lucide lucide-video"></svg></button></div>
      ${kind === 'home' ? submit : ''}
      <input id="photos" type="file" accept="image/*" multiple class="hidden">
      <input id="videos" type="file" accept="video/mp4,video/quicktime" class="hidden"></div></div>
    ${kind !== 'home' ? submit : ''}<button id="close">Close</button></section></main>`;
}
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
  window.eval(`const CT_LOCALE=${JSON.stringify(locale)};\n${photoViewport}\n${source}\nwindow.qa={ctMediaEnhance,ctMediaGalleries,ctMediaVideos,ctMediaEnhanceVideo,network:ctNetworkState,get viewer(){return ctMediaViewer}};`);
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
    for(const file of event.target.files){f.uploads.push({file,holder:f.preview(`${f.uploads.length}-${file.name}`)});}
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

test('native five-photo selection keeps the input, complete File list, original handler and draft', t=>{
  const f=harness(t);const input=f.document.getElementById('photos'),before=input.outerHTML;
  const files=[1,2,3,4,5].map(i=>f.file(`${i}.jpg`));f.enhance();f.enhance();f.select(files);
  assert.equal(input.outerHTML,before);assert.equal(input.multiple,true);assert.equal(input.accept,'image/*');
  assert.deepEqual(f.uploads.map(x=>x.file),files);assert.equal(f.document.querySelector('.ct-media-upload-status'),null);
  assert.equal(f.document.querySelector('textarea').value,'A draft');assert.equal(f.submitted,0);
  f.document.getElementById('public-tweet-submit-btn').click();assert.equal(f.submitted,1);
});
test('legacy file inputs fail open without adding multiple or intercepting their change handler',t=>{
  const f=harness(t);const input=f.document.getElementById('photos');input.accept='image/jpeg,image/png,image/webp';input.multiple=false;
  const before=input.outerHTML;f.enhance();assert.equal(input.outerHTML,before);
  f.select([f.file('one.jpg')]);assert.equal(f.uploads.length,1);assert.equal(f.status(),undefined);
});
test('native inline carousel, dots, counts and controls stay unchanged without a second row',t=>{
  const f=harness(t,`<main>${galleryMarkup(5)}</main>`);const grid=f.document.getElementById('gallery'),shell=grid.parentElement;
  const before=shell.outerHTML,nodes=[...shell.querySelectorAll('*')];let clicks=0;
  shell.querySelector('[data-inline-next]').addEventListener('click',()=>clicks++);f.enhance();f.enhance();shell.querySelector('[data-inline-next]').click();
  assert.equal(clicks,1);shell.classList.remove('ct-media-native-gallery');assert.equal(shell.outerHTML,before);assert.deepEqual([...shell.querySelectorAll('*')],nodes);
  assert.equal(f.document.querySelector('.ct-media-carousel-controls'),null);assert.equal(f.qa.ctMediaGalleries.size,1);
});
test('galleries are tracked once, with detached and unknown structures released',t=>{
  const f=harness(t,`<main>${galleryMarkup(3)}</main>`),grid=f.document.getElementById('gallery');f.enhance();assert.equal(f.qa.ctMediaGalleries.size,1);
  grid.classList.remove('snap-x');f.enhance();assert.equal(f.qa.ctMediaGalleries.size,0);grid.classList.add('snap-x');f.enhance();assert.equal(f.qa.ctMediaGalleries.size,1);
  grid.remove();f.enhance();assert.equal(f.qa.ctMediaGalleries.size,0);
});
test('unknown grids, missing photos, duplicate sources and local galleries remain native',t=>{
  for(const change of ['old','missing','duplicate','local']){
    const f=harness(t,`<main>${galleryMarkup(3)}</main>`),grid=f.document.getElementById('gallery');
    if(change==='old')grid.className='grid gap-0.5 rounded-2xl overflow-hidden border';
    if(change==='missing')grid.firstElementChild.innerHTML='Unavailable image';
    if(change==='duplicate')grid.lastElementChild.firstElementChild.src=grid.firstElementChild.firstElementChild.src;
    if(change==='local')grid.parentElement.dataset.ctLocalUi='profile';
    const before=grid.outerHTML;f.enhance();assert.equal(grid.outerHTML,before);assert.equal(f.qa.ctMediaGalleries.size,0,change);
  }
});
function nativeViewer(f,images,options={}){return installNativeViewer(f.window,images,options);}
test('native viewer buttons, count and keyboard are reused without duplicate navigation',t=>{
  const f=harness(t,`<main>${galleryMarkup(3)}</main>`),images=[...f.document.querySelectorAll('#gallery img')],native=nativeViewer(f,images);
  f.enhance();images[0].click();const buttons=[...native.dialog.querySelectorAll('button')];f.enhance();
  native.dialog.querySelector('[data-native-next]').click();assert.equal(native.calls.next,1);assert.equal(native.dialog.querySelector('img').src,images[1].src);
  assert.equal(native.dialog.querySelector('[data-native-count]').textContent,'2/3');assert.deepEqual([...native.dialog.querySelectorAll('button')],buttons);
  assert.equal(native.dialog.querySelector('.ct-media-viewer-controls'),null);
  f.document.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(native.calls.key,1);assert.equal(native.dialog.querySelector('img').src,images[2].src);
  native.dialog.querySelector('[aria-label="Close media viewer"]').click();f.enhance();assert.equal(f.qa.viewer,null);
});
test('asynchronous native selection keeps its original image/counter and updates the delivered-image link',async t=>{
  const f=harness(t,`<main>${galleryMarkup(3)}</main>`),images=[...f.document.querySelectorAll('#gallery img')],native=nativeViewer(f,images,{asyncCommit:true});
  f.enhance();images[0].click();await settle(()=>native.dialog?.isConnected);f.enhance();const image=native.dialog.querySelector('img'),counter=native.dialog.querySelector('[data-native-count]');
  native.dialog.querySelector('[data-native-next]').click();await settle(()=>image.src===images[1].src);await Promise.resolve();
  assert.equal(f.qa.viewer.index,1);assert.equal(counter.textContent,'2/3');assert.equal(native.calls.next,1);
  assert.equal(native.dialog.querySelector('.ct-media-photo-quality a').href,images[1].src);assert.equal(native.dialog.querySelector('img'),image);assert.equal(native.dialog.querySelector('[data-native-count]'),counter);
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
  f.stage = f.preview.parentElement;
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
test('release before the queued animation frame begins settling from the latest finger position', t => {
  const f=motionViewer(t);f.gesture('touchstart',240);f.gesture('touchmove',160);
  const track=f.document.querySelector('.ct-media-photo-track');let start;
  track.getBoundingClientRect=()=>{start=track.style.transform;return {width:390}};
  f.gesture('touchend',100);assert.match(start,/-140px/);assert.equal(f.frames.size,0);
});
test('asynchronous native commit locks repeated navigation and an old-source load cannot release its photo layer', t => {
  const f=motionViewer(t);f.native.dialog.querySelector('[data-native-next]').addEventListener('click',e=>{e.stopImmediatePropagation();f.native.clicked.push(1)},{capture:true});
  const next=f.native.dialog.querySelector('[data-native-next]');next.click();next.click();
  assert.deepEqual(f.native.clicked,[0,1]);assert.equal(f.qa.viewer.requestedIndex,1);f.tick(240);
  f.preview.dispatchEvent(new f.window.Event('load'));assert.ok(f.document.querySelector('.ct-media-photo-layer'));
  f.native.commit(1);f.preview.dispatchEvent(new f.window.Event('load'));f.enhance();
  assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.qa.viewer.requestedIndex,null);
  assert.equal(f.native.dialog.querySelector('[data-native-count]').textContent,'2/3');
});
test('a native handler with no commit times out, restores navigation and follows a later commit, including reduced motion', t => {
  for(const reduced of [false,true]) {
    const f=motionViewer(t,{reduced});f.native.dialog.querySelector('[data-native-next]').addEventListener('click',e=>e.stopImmediatePropagation(),{capture:true});
    const next=f.native.dialog.querySelector('[data-native-next]');next.click();assert.equal(f.qa.viewer.requestedIndex,1);
    f.tick(1600);assert.equal(f.qa.viewer.requestedIndex,null);assert.equal(f.qa.viewer.requestedIndex,null);
    assert.equal(f.document.querySelector('.ct-media-photo-layer'),null);assert.equal(f.native.dialog.querySelector('[data-native-count]').textContent,'1/3');
    f.native.commit(1);f.enhance();assert.equal(f.native.dialog.querySelector('[data-native-count]').textContent,'2/3');
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
  const f=harness(t, viewerMarkup({id:'fixed',source:'https://media.tweet.app/one.jpg'})+viewerMarkup({id:'contained',source:'https://media.tweet.app/two.jpg',contained:true}));
  const viewport = new f.window.EventTarget(); Object.assign(viewport, { width: 390, height: 520, offsetTop: 34, offsetLeft: 2 });
  Object.defineProperty(f.window, 'visualViewport', { configurable: true, value: viewport });
  f.enhance();
  const fixed = f.document.getElementById('fixed'), contained = f.document.getElementById('contained');
  assert.ok(fixed.classList.contains('ct-media-viewport-viewer'));
  assert.equal(fixed.style.getPropertyValue('--ct-media-view-height'), '520px');
  assert.equal(fixed.style.getPropertyValue('--ct-media-view-top'), '34px');
  assert.ok(fixed.querySelector('img').parentElement.classList.contains('ct-media-viewer-stage'));
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
  const f=harness(t, viewerMarkup({source:'https://media.tweet.app/photo.jpg'}));
  const v=photoViewportFixture(f), d=f.document.querySelector('[role=dialog]'), img=d.querySelector('img');
  const original=d.style.cssText;
  for(const values of [{scale:2,width:195,height:422,offsetLeft:60,offsetTop:100},{scale:4,width:97.5,height:211,offsetLeft:90,offsetTop:180}]) {
    Object.assign(v,values);v.dispatchEvent(new f.window.Event('resize'));v.dispatchEvent(new f.window.Event('scroll'));f.enhance();
    assert.equal(d.style.cssText,original);assert.equal(d.querySelector('img'),img);assert.equal(img.getAttribute('src'),'https://media.tweet.app/photo.jpg');
    assert.equal(d.classList.contains('ct-media-photo-zoomed'),true);
  }
  Object.assign(v,{scale:1,width:390,height:740,offsetLeft:0,offsetTop:0});v.dispatchEvent(new f.window.Event('resize'));
  assert.equal(d.style.getPropertyValue('--ct-media-view-height'),'740px');assert.equal(d.classList.contains('ct-media-photo-zoomed'),false);
});
test('a photo opened while already zoomed starts at unscaled bounds rather than the shrinking viewport', t => {
  const f=harness(t,viewerMarkup({source:'https://media.tweet.app/photo.jpg'}));
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

test('a browser emitting pointer plus touch events commits one native swipe, retaining its own counter',t=>{
  const f=motionViewer(t,{pointer:true,viewport:{}});
  f.gesture('pointerdown',240);f.gesture('touchstart',240);
  f.gesture('pointermove',120);f.gesture('touchmove',120);f.flushFrames();
  f.gesture('pointerup',90);f.gesture('touchend',90,100,{touches:{value:[]}});
  assert.equal(f.native.calls.next,1);assert.equal(f.native.calls.touch,0);
  assert.deepEqual(f.native.clicked,[0,1]);assert.equal(f.native.dialog.querySelector('[data-native-count]').textContent,'2/3');
});
test('native X-only touch navigation is suppressed for diagonal vertical intent and pinch without preventing browser defaults',t=>{
  const f=motionViewer(t,{viewport:{}});
  f.gesture('touchstart',240,100);const vertical=f.gesture('touchmove',140,260);f.gesture('touchend',140,260,{touches:{value:[]}});
  assert.equal(vertical.defaultPrevented,false);assert.equal(f.native.calls.touch,0);assert.deepEqual(f.native.clicked,[0]);
  f.gesture('touchstart',240);const pinch=f.gesture('touchstart',180,100,{touches:{value:[{clientX:240,clientY:100},{clientX:180,clientY:100}]}});
  f.gesture('touchend',80,100,{touches:{value:[]}});
  assert.equal(pinch.defaultPrevented,false);assert.equal(f.native.calls.touch,0);assert.deepEqual(f.native.clicked,[0]);
});
test('native keyboard changes during settling discard the old destination, including returning to the original image in one turn',async t=>{
  for(const key of ['ArrowRight','ArrowLeft','Home']){
    const f=motionViewer(t);f.native.dialog.querySelector('[data-native-next]').click();assert.ok(f.qa.viewer.motion);
    f.document.dispatchEvent(new f.window.KeyboardEvent('keydown',{key,bubbles:true}));await Promise.resolve();await Promise.resolve();
    assert.equal(f.native.calls.next,1);assert.equal(f.native.calls.key,1);
    assert.equal(f.document.querySelector('.ct-media-photo-layer'),null,key);
    assert.equal(f.preview.classList.contains('ct-media-photo-covered'),false,key);assert.equal(f.timers.size,0,key);
    assert.equal(f.qa.viewer.index,key==='ArrowRight'?2:0);
  }
});
test('an open native viewer keeps source reconciliation after the initial five-second opener window',t=>{
  const f=motionViewer(t);const real=f.window.Date.now;f.window.Date.now=()=>real()+10000;
  f.native.commit(2);f.enhance();assert.equal(f.qa.viewer.index,2);
  assert.equal(f.native.dialog.querySelector('.ct-media-photo-quality a').href,f.images[2].src);
});
test('closing a gallery viewer cannot bind a later single-photo reply viewer with the same delivered URL',t=>{
  const f=motionViewer(t);const source=f.images[0].src;f.native.dialog.remove();f.enhance();assert.equal(f.qa.viewer,null);
  const box=f.document.createElement('div');box.innerHTML=viewerMarkup({source,count:1});const single=box.firstElementChild;f.document.body.append(single);f.enhance();
  assert.equal(f.qa.viewer,null);assert.equal(single.querySelector('.ct-media-photo-layer'),null);
  assert.ok(single.classList.contains('ct-media-centered-viewer'));assert.equal(single.querySelector('.ct-media-photo-quality a').href,source);
});
test('native total and index must match the opener before photo motion can attach',t=>{
  for(const count of ['1/1','2/3','not a count']){
    const f=harness(t,`<main>${galleryMarkup(3)}</main>`),images=[...f.document.querySelectorAll('#gallery img')],native=nativeViewer(f,images);
    f.enhance();images[0].click();native.dialog.querySelector('[data-native-count]').textContent=count;f.enhance();
    assert.equal(f.qa.viewer,null,count);assert.equal(native.dialog.querySelector('.ct-media-photo-layer'),null,count);
  }
});
test('native Japanese viewer labels keep the same buttons, image, quality and motion attachment',t=>{
  const f=motionViewer(t),dialog=f.native.dialog,buttons=[...dialog.querySelectorAll('button')];
  dialog.setAttribute('aria-label','写真・動画ビューア');buttons[0].setAttribute('aria-label','写真・動画を閉じる');buttons[1].setAttribute('aria-label','前の画像');buttons[2].setAttribute('aria-label','次の画像');f.enhance();
  assert.ok(f.qa.viewer);assert.deepEqual([...dialog.querySelectorAll('button')],buttons);assert.ok(dialog.querySelector('.ct-media-photo-quality'));
});

test('native icon-only upload controls keep accessible names while selection and submit handlers stay native',t=>{
  const f=harness(t),photo=f.document.getElementById('photo'),video=f.document.getElementById('video');
  f.enhance();assert.equal(photo.getAttribute('aria-label'),'写真を追加');assert.equal(video.getAttribute('aria-label'),'動画を追加');
  photo.setAttribute('aria-label','Native future photo control');f.enhance();assert.equal(photo.getAttribute('aria-label'),'Native future photo control');
  const g=harness(t,uploadMarkup(),{locale:'en'});g.enhance();assert.equal(g.document.getElementById('photo').getAttribute('aria-label'),'Add photos');
  assert.equal(g.document.getElementById('videos').multiple,false);assert.equal(g.document.getElementById('photos').multiple,true);
});
