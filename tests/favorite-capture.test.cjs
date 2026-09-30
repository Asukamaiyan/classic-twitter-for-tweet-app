const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/favorite-capture.js'), 'utf8');
const date = '2026-09-30T07:00:00.000Z';
function harness(t) {
  const dom = new JSDOM(`<article><button class="truncate font-bold">Alice</button>
    <span class="text-tl-app-text-muted hover:underline" title="${date}">1m</span>
    <p class="whitespace-pre-wrap break-words">My post</p><div aria-label="Quoted post by Bob">
    <span class="text-tl-app-text-muted hover:underline" title="${date}">2m</span>
    <p class="whitespace-pre-wrap break-words">Longer quoted post</p></div>
    <button data-testid="tweet-like-action" aria-pressed="false"></button></article>`,
    {url:'https://app.tweet.app/feed', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  const f = {w, doc:w.document, requests:[], saves:[], removals:[], timers:[]};
  w.setTimeout = (cb, delay) => { if (delay === 450) f.timers.push(cb); return f.timers.length + 1; };
  w.snapshotFavorite = () => null;
  w.validUser = value => value;
  w.articleAuthor = () => 'alice';
  w.articleAvatar = () => '';
  w.getAuth = async () => ({uid:w.identity.authUID,token:'fixture-token'});
  w.requestJSON = async url => { f.requests.push(url); return f.response || {posts:[]}; };
  w.ctIsLiked = button => button.getAttribute('aria-pressed') === 'true';
  w.saveFavorite = (item, uid) => f.saves.push({item,uid});
  w.removeFavorite = (id, uid) => f.removals.push({id,uid});
  w.renderFavoritesPanel = () => {};
  w.ctProfileMediaAssets = post => post.media_assets || [];
  w.ctProfileURL = value => /^https:\/\//.test(value || '') ? value : '';
  w.eval(`const API_ORIGIN='https://api.tweet.app'; const ctNetworkState={authUID:'account-a'};
    let favoritesActive=false; ${source}; window.identity=ctNetworkState;
    window.qa={ctFavoriteCandidate,ctResolveFavorite,ctCaptureFavoriteClick};`);
  f.article = f.doc.querySelector('article');
  f.button = f.doc.querySelector('[data-testid]');
  f.candidate = () => w.qa.ctFavoriteCandidate(f.article);
  f.post = (id='post-a') => ({id,authorUsername:'alice',createdAt:date,text:'My post'});
  f.click = () => w.qa.ctCaptureFavoriteClick({target:f.button});
  return f;
}
test('feed candidate keeps original body and time rather than quoted content', t => {
  const f=harness(t), item=f.candidate();
  assert.equal(item.text,'My post'); assert.equal(item.createdAt,date); assert.equal(item.username,'alice');
  f.article.querySelector('span').remove(); assert.equal(f.candidate(),null);
});
test('known detail permalink captures native photos/videos while excluding quoted media', t => {
  const f=harness(t); f.w.snapshotFavorite=()=>({id:'detail',text:'My post'});
  f.article.insertAdjacentHTML('beforeend', '<img alt="Attached media" src="https://media.tweet.app/one.jpg"><video src="https://media.tweet.app/one.mp4" poster="https://media.tweet.app/one-poster.jpg"></video>');
  f.article.querySelector('[aria-label]').insertAdjacentHTML('beforeend','<img alt="Attached media" src="https://media.tweet.app/quote.jpg">');
  assert.equal(f.candidate().media.length,2); assert.equal(f.candidate().media[1].type,'video');
});
test('read-only cursor resolution accepts one exact author/time/body ID and caches reads', async t => {
  const f=harness(t);
  f.w.requestJSON=async url => { f.requests.push(url); return f.requests.length===1
    ? {posts:[{...f.post('wrong'),text:'Different'}],nextCursor:'next'} : {posts:[f.post()]}; };
  const item=await f.w.qa.ctResolveFavorite(f.candidate(),'account-a');
  assert.equal(item.id,'post-a'); assert.equal(item.href,'https://app.tweet.app/post/post-a');
  assert.equal(f.requests.length,2); assert.match(f.requests[0],/\/api\/users\/alice\/posts\?limit=50$/);
  assert.match(f.requests[1],/cursor=next/);
  await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'); assert.equal(f.requests.length,2);
});
test('ambiguous or nonmatching IDs never become a saved permalink', async t => {
  const f=harness(t); f.response={posts:[f.post('one'),f.post('two')]};
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);
});
test('account switch during a read discards the previous account result', async t => {
  const f=harness(t); f.w.requestJSON=async () => { f.w.identity.authUID='account-b'; return {posts:[f.post()]}; };
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);
});
test('native favorite transition saves only after resolution and preserves actual action', async t => {
  const f=harness(t);f.response={posts:[f.post()]};f.click();f.button.setAttribute('aria-pressed','true');
  await f.timers.shift()();assert.equal(f.saves.length,1);assert.equal(f.saves[0].uid,'account-a');
  f.click();f.button.setAttribute('aria-pressed','false');await f.timers.shift()();
  assert.equal(f.removals.length,1); assert.equal(f.removals[0].id,'post-a');
});
test('rapid reversal and server rollback cannot save a stale favorite', async t => {
  const f=harness(t);f.response={posts:[f.post()]};f.click();f.button.setAttribute('aria-pressed','true');
  f.click();f.button.setAttribute('aria-pressed','false');
  await f.timers.shift()();await f.timers.shift()();assert.equal(f.saves.length,0);
  f.click(); f.button.setAttribute('aria-pressed','true');
  f.w.requestJSON=async () => {f.button.setAttribute('aria-pressed','false');return {posts:[f.post()]};};
  // Expire the author cache so the rollback happens during this resolution.
  f.w.Date.now=()=>Date.now()+120000;
  await f.timers.shift()();assert.equal(f.saves.length,0);
});
test('a late native rollback reconciles the local snapshot without extra engagement', async t => {
  const f=harness(t); f.response={posts:[f.post()]}; f.click(); f.button.setAttribute('aria-pressed','true');
  await f.timers.shift()(); assert.equal(f.saves.length,1);
  f.button.setAttribute('aria-pressed','false'); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.removals.length,1); assert.equal(f.removals[0].id,'post-a');
  assert.equal(f.requests.length,1);
});
