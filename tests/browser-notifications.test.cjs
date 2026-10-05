const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '../src/browser-notifications.js'), 'utf8');
const toolsSource = readFileSync(join(__dirname, '../src/enhancements.js'), 'utf8');
const key = handle => 'ct-browser-notifications-v1:' + handle;
const badge = value => value ? `<span class="absolute rounded-full bg-sky-500 text-white">${value}</span>` : '';
const html = (handle, value) => `<aside class="hidden lg:flex"><nav><button id="desktop" class="w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-left"><span class="relative flex"><svg data-icon="bell" width="18" height="18"></svg>${badge(value)}</span><span>Notifications</span></button></nav><button aria-label="Account menu"><img><div class="flex-1 min-w-0"><p class="font-bold">Private Name</p><p class="text-[0.8125rem] text-tl-app-text-muted truncate">@${handle}</p></div></button></aside>
<nav aria-label="Mobile navigation"><div><button id="mobile" type="button" class="relative flex items-center justify-center rounded-2xl" aria-label="Notifications"><svg data-icon="bell" width="28" height="28"></svg>${badge(value)}</button></div></nav>
<main><article><p>Private post body</p><button id="native-favorite">Like</button></article><textarea>Draft stays intact</textarea></main>`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = () => new Promise(resolve => setTimeout(resolve, 290));
async function until(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('Expected notification state did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function locks() {
  const owners = new Set();
  return { request: async (name, options, callback) => {
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { mode: 'exclusive', ifAvailable: true });
    if (owners.has(name)) return callback(null);
    owners.add(name);
    try { return await callback({ name }); } finally { owners.delete(name); }
  } };
}
function setup(t, { handle = 'alice', value = 3, permission = 'granted', requestPermission,
  beforeCreate, sharedLocks = locks(), mobile = false, ios = false, standalone = false,
  registration, settings, locale = 'en', url = 'https://app.tweet.app/feed' } = {}) {
  const dom = new JSDOM(html(handle, value), { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: url.startsWith('https:') });
  const alerts = [], traffic = [], prompts = [], workerRequests = [];
  let now = 100000, focused = false, visibility = 'visible';
  window.Date.now = () => now;
  document.hasFocus = () => focused;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(window.navigator, 'locks', { configurable: true, value: sharedLocks });
  if (mobile) Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: ios ? 'iPhone Safari' : 'Android Firefox' });
  if (standalone) Object.defineProperty(window.navigator, 'standalone', { value: true });
  if (registration) Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: {
    getRegistration: async () => { workerRequests.push('getRegistration'); return registration; },
    register: () => { throw new Error('Must not register a worker'); }, addEventListener() {}, removeEventListener() {}
  } });
  class FakeNotification {
    static permission = permission;
    static requestPermission() {
      prompts.push('request');
      return requestPermission ? requestPermission(FakeNotification) : Promise.resolve(FakeNotification.permission = 'granted');
    }
    constructor(title, options) { this.title = title; this.options = options; this.closed = false; alerts.push(this); }
    close() { this.closed = true; }
  }
  window.Notification = FakeNotification;
  window.fetch = (...args) => { traffic.push(args); throw new Error('Must not fetch'); };
  window.WebSocket = () => { throw new Error('Must not open another socket'); };
  window.focus = () => {};
  if (settings) window.localStorage.setItem(key(handle), JSON.stringify(settings));
  if (beforeCreate) beforeCreate(window);
  window.eval(source + '\nwindow.createBrowserNotifications=createBrowserNotifications;');
  const controller = window.createBrowserNotifications({ locale });
  t.after(() => { controller.destroy(); window.close(); });
  const count = (next, target) => {
    for (const id of target ? [target] : ['desktop', 'mobile']) {
      const button = document.getElementById(id), host = id === 'desktop' ? button.firstElementChild : button;
      host.querySelector('span.absolute')?.remove();
      if (next) host.insertAdjacentHTML('beforeend', badge(next));
    }
    controller.refresh();
  };
  return { window, document, controller, alerts, traffic, prompts, workerRequests, count,
    advance(ms) { now += ms; }, focus(value) { focused = value; },
    hidden(value) { visibility = value ? 'hidden' : 'visible'; document.dispatchEvent(new window.Event('visibilitychange')); },
    account(next) { document.querySelector('aside button[aria-label="Account menu"] p.truncate').textContent = '@' + next; controller.refresh(); },
    async enable({ owner = true } = {}) {
      const saved = await controller.setEnabled(true, { userGesture: true });
      if (saved && owner) await until(() => /This tab|このタブ/.test(controller.getState().status));
      this.advance(2100); return saved;
    }
  };
}

test('default OFF never prompts, polls, changes private content or alters native handlers', async t => {
  const h = setup(t, { permission: 'default' });
  let clicks = 0; h.document.getElementById('native-favorite').addEventListener('click', () => clicks++);
  h.count(8); h.hidden(true); await settle();
  assert.equal(h.controller.getState().enabled, false);
  assert.deepEqual(h.prompts, []); assert.deepEqual(h.traffic, []); assert.deepEqual(h.alerts, []);
  assert.equal(h.document.querySelector('textarea').value, 'Draft stays intact');
  assert.equal(h.document.querySelector('main p').textContent, 'Private post body');
  h.document.getElementById('native-favorite').click(); assert.equal(clicks, 1);
});

test('explicit enable baselines old unread count and alerts once with generic text and native navigation', async t => {
  const h = setup(t, { permission: 'default', value: 12, locale: 'ja' });
  assert.equal(await h.controller.setEnabled(true), false); assert.equal(h.prompts.length, 0);
  assert.equal(await h.enable(), true); assert.equal(h.prompts.length, 1);
  await settle(); assert.equal(h.alerts.length, 0);
  h.count(13); h.count(14); await settle();
  assert.equal(h.alerts.length, 1); assert.equal(h.alerts[0].title, 'Tweet');
  assert.equal(h.alerts[0].options.body, 'Tweetに新しい通知があります。');
  assert.doesNotMatch(JSON.stringify(h.alerts[0]), /Private Name|Private post|Draft/);
  let opens = 0; h.document.getElementById('desktop').addEventListener('click', () => opens++);
  h.alerts[0].onclick(); assert.equal(opens, 1); assert.equal(h.alerts[0].closed, true);
  assert.deepEqual(h.traffic, []);
});

test('count decrease, unchanged grouped updates, disagreement, invalid and 99+ counts never alert', async t => {
  const h = setup(t); await h.enable();
  h.count(3); h.count(2); h.count('99+'); h.count('99+'); await settle();
  assert.equal(h.alerts.length, 0); assert.match(h.controller.getState().status, /99\+/);
  h.count(5); h.count(6, 'desktop'); await settle();
  assert.equal(h.alerts.length, 0);
  h.count('200'); h.count(7); await settle(); assert.equal(h.alerts.length, 0);
  h.count(8); await settle(); assert.equal(h.alerts.length, 1);
});

test('initial hydration settles quietly and foreground attention suppresses redundant OS alerts', async t => {
  const h = setup(t, { value: 0 });
  await h.controller.setEnabled(true, { userGesture: true }); await tick();
  h.count(9); await settle(); assert.equal(h.alerts.length, 0);
  h.advance(2100); h.focus(true); h.count(10); await settle(); assert.equal(h.alerts.length, 0);
  h.hidden(true); h.count(11); await settle(); assert.equal(h.alerts.length, 1);
});

test('denied and rejected permission keep alerts OFF without automatic retries', async t => {
  const h = setup(t, { permission: 'default', requestPermission: Notification => Promise.resolve(Notification.permission = 'denied') });
  assert.equal(await h.enable(), false); h.count(5); await settle();
  assert.equal(h.controller.getState().enabled, false); assert.match(h.controller.getState().status, /not allowed/);
  assert.equal(h.prompts.length, 1); assert.equal(h.alerts.length, 0);
  const failed = setup(t, { permission: 'default', requestPermission: () => Promise.reject(new Error('blocked')) });
  assert.equal(await failed.enable(), false); assert.match(failed.controller.getState().status, /Could not display/);
});

test('late permission after OFF, account change or pagehide cannot enable or save an alert', async t => {
  for (const action of ['off', 'account', 'pagehide']) {
    let resolve;
    const h = setup(t, { permission: 'default', requestPermission: Notification => new Promise(done => {
      resolve = () => { Notification.permission = 'granted'; done('granted'); };
    }) });
    const pending = h.controller.setEnabled(true, { userGesture: true });
    await tick();
    if (action === 'off') await h.controller.setEnabled(false);
    if (action === 'account') h.account('bob');
    if (action === 'pagehide') h.window.dispatchEvent(new h.window.Event('pagehide'));
    resolve(); assert.equal(await pending, false);
    assert.equal(h.controller.getState().enabled, false); assert.equal(h.controller.getState().busy, false);
    assert.notEqual(h.window.localStorage.getItem(key('alice')), '{"version":1,"enabled":true}');
  }
});

test('account switch does not inherit enabled preference, baseline, private content or click target', async t => {
  const h = setup(t); await h.enable(); h.count(4); await settle();
  assert.equal(h.alerts.length, 1); h.account('bob');
  assert.equal(h.alerts[0].closed, true); assert.equal(h.controller.getState().enabled, false);
  let opens = 0; h.document.getElementById('desktop').addEventListener('click', () => opens++);
  h.alerts[0].onclick(); assert.equal(opens, 0);
  assert.equal(h.window.localStorage.getItem(key('bob')), null);
  await h.enable(); h.count(5); await settle(); assert.equal(h.alerts.length, 2);
});

test('same-origin exclusive lock gives two open tabs only one alert owner', async t => {
  const sharedLocks = locks();
  const first = setup(t, { sharedLocks }), second = setup(t, { sharedLocks });
  await first.enable(); await second.enable({ owner: false });
  assert.match(first.controller.getState().status, /This tab/);
  assert.match(second.controller.getState().status, /Another tab/);
  first.count(4); second.count(4); await settle();
  assert.equal(first.alerts.length + second.alerts.length, 1);
  first.controller.destroy(); await tick(); second.advance(2100); second.controller.refresh();
  await until(() => /This tab/.test(second.controller.getState().status)); second.advance(2100);
  second.count(5); await settle(); assert.equal(second.alerts.length, 1);
});

test('pagehide suspends and closes alerts; pageshow baselines and resumes without catch-up', async t => {
  const h = setup(t); await h.enable(); h.count(4); await settle();
  h.window.dispatchEvent(new h.window.Event('pagehide'));
  assert.equal(h.alerts[0].closed, true); assert.match(h.controller.getState().status, /suspended/);
  h.count(10); await settle(); assert.equal(h.alerts.length, 1);
  await tick(); h.window.dispatchEvent(new h.window.Event('pageshow')); await tick(); h.advance(31000);
  await settle(); assert.equal(h.alerts.length, 1);
  h.count(11); await settle(); assert.equal(h.alerts.length, 2);
});

test('ON save failure stays OFF and OFF save failure stops current alerts immediately', async t => {
  const h = setup(t);
  const prototype = h.window.Storage.prototype, original = prototype.setItem;
  prototype.setItem = () => { throw new Error('full'); };
  assert.equal(await h.enable(), false); assert.equal(h.controller.getState().enabled, false);
  assert.match(h.controller.getState().status, /Could not save/);
  prototype.setItem = original;
  await h.enable(); h.count(4); await settle(); assert.equal(h.alerts.length, 1);
  prototype.setItem = () => { throw new Error('full'); };
  assert.equal(await h.controller.setEnabled(false), false);
  assert.equal(h.controller.getState().enabled, false); assert.equal(h.alerts[0].closed, true);
  h.count(5); await settle(); assert.equal(h.alerts.length, 1);
});

test('unsupported Web Locks, API, HTTPS and regular iOS tabs give reasons without prompting', async t => {
  for (const options of [
    { sharedLocks: null, message: /duplicate/ },
    { beforeCreate: window => { delete window.Notification; }, message: /cannot show/ },
    { url: 'http://app.tweet.app/feed', message: /HTTPS/ },
    { mobile: true, ios: true, message: /Regular Safari/ }
  ]) {
    const h = setup(t, { permission: 'default', ...options }); await tick();
    assert.equal(h.controller.getState().canEnable, false); assert.match(h.controller.getState().status, options.message);
    assert.equal(await h.enable(), false); assert.deepEqual(h.prompts, []); assert.deepEqual(h.alerts, []);
  }
});

test('mobile uses an existing same-origin worker, does not register, and closes only its own alerts', async t => {
  const shown = [], closed = [];
  const registration = { scope: 'https://app.tweet.app/', active: { scriptURL: 'https://app.tweet.app/sw.js' },
    showNotification: async (title, options) => { shown.push({ title, options }); },
    getNotifications: async ({ tag }) => [{ tag, close: () => closed.push(tag) }, { tag: 'native-unrelated', close: () => closed.push('WRONG') }]
  };
  const h = setup(t, { mobile: true, registration }); await tick(); await h.enable();
  h.count(4); await settle(); assert.equal(shown.length, 1); assert.deepEqual(h.alerts, []);
  assert.deepEqual(h.workerRequests, ['getRegistration']);
  assert.equal(shown[0].options.body, 'You have a new notification on Tweet.');
  await h.controller.setEnabled(false); await tick(); assert.deepEqual(closed, [shown[0].options.tag]);
  assert.match(shown[0].options.tag, /^ct-native-notifications:alice:[^:]+:\d+$/);
});

function delayedWorker() {
  const shown = new Map(), requested = [], completions = [];
  const registration = { scope: 'https://app.tweet.app/', active: { scriptURL: 'https://app.tweet.app/sw.js' },
    showNotification(title, options) {
      requested.push(options.tag);
      const add = () => shown.set(options.tag, { tag: options.tag, closed: false,
        close() { this.closed = true; shown.delete(this.tag); } });
      if (requested.length === 1) return new Promise(resolve => completions.push(() => { add(); resolve(); }));
      add(); return Promise.resolve();
    },
    getNotifications: async ({ tag }) => shown.has(tag) ? [shown.get(tag)] : []
  };
  return { registration, requested, shown, finishOld: () => completions.shift()() };
}

test('late worker completion from an old tab cannot replace or close the new owner alert', async t => {
  const worker = delayedWorker(), sharedLocks = locks();
  const old = setup(t, { mobile: true, registration: worker.registration, sharedLocks });
  const next = setup(t, { mobile: true, registration: worker.registration, sharedLocks });
  await tick(); await old.enable(); old.count(4); await settle();
  assert.equal(worker.requested.length, 1);
  old.window.dispatchEvent(new old.window.Event('pagehide')); await tick();
  await next.enable(); next.count(4); await settle();
  assert.equal(worker.requested.length, 2);
  const [oldTag, nextTag] = worker.requested;
  assert.notEqual(oldTag, nextTag);
  const current = worker.shown.get(nextTag); assert.ok(current);
  worker.finishOld(); await until(() => !worker.shown.has(oldTag));
  assert.equal(current.closed, false); assert.equal(worker.shown.get(nextTag), current);
});

test('late worker completion from an old generation cannot close the resumed controller alert', async t => {
  const worker = delayedWorker();
  const h = setup(t, { mobile: true, registration: worker.registration });
  await tick(); await h.enable(); h.count(4); await settle();
  await h.controller.setEnabled(false); await tick(); await h.enable(); h.advance(31000);
  h.count(5); await settle(); assert.equal(worker.requested.length, 2);
  const [oldTag, nextTag] = worker.requested;
  assert.notEqual(oldTag, nextTag);
  const current = worker.shown.get(nextTag); assert.ok(current);
  worker.finishOld(); await until(() => !worker.shown.has(oldTag));
  assert.equal(current.closed, false); assert.equal(worker.shown.get(nextTag), current);
});

test('a queued click on an old desktop alert cannot navigate or close the resumed alert', async t => {
  const h = setup(t); await h.enable(); h.count(4); await settle();
  const old = h.alerts[0];
  await h.controller.setEnabled(false); await h.enable(); h.advance(31000); h.count(5); await settle();
  const current = h.alerts[1]; assert.ok(current);
  let opens = 0; h.document.getElementById('desktop').addEventListener('click', () => opens++);
  old.onclick(); assert.equal(opens, 0); assert.equal(current.closed, false);
  current.onclick(); assert.equal(opens, 1); assert.equal(current.closed, true);
});

test('losing the existing mobile worker cancels pending delivery and reports unsupported', async t => {
  const shown = [];
  const registration = { scope: 'https://app.tweet.app/', active: { scriptURL: 'https://app.tweet.app/sw.js' },
    showNotification: async (title, options) => shown.push({ title, options }) };
  const h = setup(t, { mobile: true, registration });
  await tick(); await h.enable(); h.count(4);
  registration.active = null;
  h.window.dispatchEvent(new h.window.Event('pageshow'));
  await until(() => !h.controller.getState().supported);
  await settle(); assert.equal(h.controller.getState().enabled, false);
  assert.equal(h.controller.getState().canEnable, false); assert.equal(shown.length, 0);
  assert.match(h.controller.getState().status, /active service worker/);
});

test('missing or impersonated native DOM cannot establish account or count; route labels stay untouched', async t => {
  const h = setup(t, { beforeCreate: window => {
    window.document.querySelector('aside button[aria-label="Account menu"]').remove();
    window.document.querySelector('article').insertAdjacentHTML('beforeend', '<button aria-label="Account menu"><div class="flex-1 min-w-0"><p class="text-[0.8125rem] text-tl-app-text-muted truncate">@forged</p></div></button>');
  } });
  assert.equal(h.controller.getState().canEnable, false); assert.match(h.controller.getState().status, /Sign in/);
  assert.equal(await h.enable(), false); assert.equal(h.alerts.length, 0);
  assert.equal(h.document.querySelector('#desktop > span:last-child').textContent, 'Notifications');
});

test('saved opt-in never prompts on reload and another tab turning OFF stops alerts', async t => {
  const h = setup(t, { settings: { version: 1, enabled: true } }); await tick(); h.advance(2100);
  assert.equal(h.controller.getState().enabled, true); assert.equal(h.prompts.length, 0);
  h.count(4); await settle(); assert.equal(h.alerts.length, 1);
  h.window.localStorage.setItem(key('alice'), '{"version":1,"enabled":false}');
  h.window.dispatchEvent(new h.window.StorageEvent('storage', { key: key('alice') }));
  assert.equal(h.controller.getState().enabled, false); assert.equal(h.alerts[0].closed, true);
});

test('alert cooldown prevents a burst and destroy cancels pending background notifications', async t => {
  const h = setup(t); await h.enable(); h.count(4); await settle();
  h.count(5); await settle(); assert.equal(h.alerts.length, 1);
  h.advance(31000); h.count(6); h.controller.destroy(); await settle();
  assert.equal(h.alerts.length, 1); assert.equal(h.alerts[0].closed, true);
});

test('Tools shows short localized help, changes settings only on a switch and removes its listener', async t => {
  const h = setup(t, { locale: 'ja' });
  h.window.eval(toolsSource + '\nwindow.installLocalEnhancements=installLocalEnhancements;');
  let reads = 0, calls = [];
  const fake = { getState() { reads++; return { enabled: false, canEnable: true, busy: false, status: 'オフ' }; },
    setEnabled(value, options) { calls.push([value, options]); return Promise.resolve(false); }
  };
  const tools = h.window.installLocalEnhancements({ locale: 'ja', browserNotifications: fake });
  t.after(() => tools.destroy());
  const input = h.document.getElementById('ct-local-browser-notifications');
  assert.ok(input); assert.deepEqual(calls, []);
  assert.match(h.document.getElementById('ct-local-browser-notifications-help').textContent, /ページを閉じる.*名前は通知に出しません/);
  input.click(); await tick(); assert.equal(calls.length, 1); assert.equal(calls[0][0], true); assert.equal(calls[0][1].userGesture, true);
  tools.destroy(); const previous = reads; h.window.dispatchEvent(new h.window.Event('ct-browser-notifications-change')); assert.equal(reads, previous);
});
