const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/favorite-capture.js'), 'utf8');
const timestampSource = fs.readFileSync(require('node:path').join(__dirname, '../src/timestamps.js'), 'utf8');
const mediaSource = fs.readFileSync(require('node:path').join(__dirname, '../src/media.js'), 'utf8');
const {galleryMarkup}=require('./helpers/native-media.cjs');
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
  w.eval(`const API_ORIGIN='https://api.tweet.app'; const ctNetworkState={authUID:'account-a'}; const CT_LOCALE='ja'; ${timestampSource}
    let favoritesActive=false; ${mediaSource}
    ${source}; window.identity=ctNetworkState;
    window.qa={ctFavoriteCandidate,ctResolveFavorite,ctCaptureFavoriteClick,ctRestoreVisibleFavorites,ctFavoriteRelativeTimeMatches};`);
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

function replyFixture(f, text='My reply') {
  f.article.outerHTML = `<div id="inline-replies-parent-a"><article><div class="flex items-center">
    <button class="font-bold truncate">Alice</button><span>·</span><span class="text-tl-app-text-muted shrink-0">2h</span>
    <div><button aria-label="Reply options"><svg class="lucide-ellipsis-vertical"></svg></button></div></div>
    <p class="whitespace-pre-wrap break-words">${text}</p><button data-testid="tweet-like-action" aria-pressed="false"></button></article></div>`;
  f.article=f.doc.querySelector('article');f.button=f.doc.querySelector('[data-testid]');
}
test('inline reply favorite resolves the exact parent route and relative time without an ISO title', async t => {
  const f=harness(t);replyFixture(f);const time=new Date(Date.now()-2.5*3600000).toISOString();
  f.response={success:true,replies:[{...f.post('reply-a'),text:'My reply',createdAt:time}]};
  const candidate=f.candidate();assert.equal(candidate.parentId,'parent-a');
  const item=await f.w.qa.ctResolveFavorite(candidate,'account-a');
  assert.equal(item.id,'reply-a');assert.equal(item.createdAt,time);
  assert.match(f.requests[0],/\/posts\/parent-a\/replies\?limit=50$/);
});
test('reply identity rejects a duplicate body, wrong author/time and translated text', async t => {
  const f=harness(t);replyFixture(f);const createdAt=new Date(Date.now()-2.5*3600000).toISOString();
  f.response={replies:[{...f.post('a'),text:'My reply',createdAt},{...f.post('b'),text:'My reply',createdAt}]};
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);
  f.article.insertAdjacentHTML('beforeend','<button>Show original</button>');assert.equal(f.candidate(),null);
  assert.equal(f.w.qa.ctFavoriteRelativeTimeMatches('2h',date,Date.parse(date)+9*3600000),false);
  assert.equal(f.w.qa.ctFavoriteRelativeTimeMatches('2時間前',createdAt,Date.now()),true);
});
test('profile replies use wrapper.post and never the parent post as a reply candidate', async t => {
  const f=harness(t);replyFixture(f);f.article.parentElement.id='';
  const createdAt=new Date(Date.now()-2.5*3600000).toISOString();
  f.response={replies:[{post:{...f.post('reply-a'),text:'My reply',createdAt},parentPost:f.post('parent-a')}]};
  assert.equal((await f.w.qa.ctResolveFavorite(f.candidate(),'account-a')).id,'reply-a');
  assert.match(f.requests[0],/\/users\/alice\/replies$/);
});
test('relative reply identification rejects incomplete pages and date-only identities and never reuses a stale list', async t => {
  const f=harness(t);replyFixture(f);const createdAt=new Date(Date.now()-2.5*3600000).toISOString();
  f.w.requestJSON=async url=>{f.requests.push(url);return {replies:[{...f.post('a'),text:'My reply',createdAt}],nextCursor:'page-'+f.requests.length};};
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);assert.equal(f.requests.length,3);
  f.w.requestJSON=async url=>{f.requests.push(url);return {replies:[{...f.post('a'),text:'My reply',createdAt}]};};
  assert.equal((await f.w.qa.ctResolveFavorite(f.candidate(),'account-a')).id,'a');
  f.w.requestJSON=async url=>{f.requests.push(url);return {replies:[{...f.post('a'),text:'My reply',createdAt},{...f.post('b'),text:'My reply',createdAt}]};};
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);
  assert.equal(f.w.qa.ctFavoriteRelativeTimeMatches('Sep 30',date,Date.now()),false);
});
test('translated main card keeps exact author/ISO identity and saves API original text', async t => {
  const f=harness(t);f.article.querySelector('p').textContent='翻訳文';
  f.article.insertAdjacentHTML('beforeend','<button>原文を表示</button>');f.response={posts:[f.post()]};
  assert.equal((await f.w.qa.ctResolveFavorite(f.candidate(),'account-a')).text,'My post');
});
test('explicit loaded-Favorites restoration saves only native liked cards and sends no engagement', async t => {
  const f=harness(t);const main=f.doc.createElement('main');f.article.before(main);main.append(f.article);
  f.button.setAttribute('aria-pressed','true');f.response={posts:[f.post()],post:{...f.post(),hasLiked:true}};
  const result=await f.w.qa.ctRestoreVisibleFavorites();assert.equal(result.saved,1);assert.equal(result.unresolved,0);
  assert.equal(f.saves.length,1);assert.match(f.requests[0],/\/users\/alice\/posts/);
  f.button.setAttribute('aria-pressed','false');await f.w.qa.ctRestoreVisibleFavorites();assert.equal(f.saves.length,1);
});
test('loaded-Favorites recovery rejects an optimistic Like that the fresh detail response does not confirm', async t => {
  const f=harness(t);const main=f.doc.createElement('main');f.article.before(main);main.append(f.article);
  f.button.setAttribute('aria-pressed','true');f.response={posts:[f.post()],post:{...f.post(),hasLiked:false}};
  const result=await f.w.qa.ctRestoreVisibleFavorites();assert.equal(result.saved,0);assert.equal(result.unresolved,1);
  assert.equal(f.saves.length,0);assert.match(f.requests.at(-1),/\/api\/posts\/post-a$/);
});


test('Favorite creation matching uses valid native snake_case before camelCase or edited time', async t => {
  const f=harness(t);
  f.response={posts:[{...f.post(),createdAt:'2026-09-29T07:00:00.000Z',created_at:date,editedAt:'2026-10-02T09:00:00Z'}]};
  const item=await f.w.qa.ctResolveFavorite(f.candidate(),'account-a');
  assert.equal(item.id,'post-a'); assert.equal(item.createdAt,date);
});
test('reply matching rejects ambiguous local-time and rolled-over dates instead of using the parent or edit date', async t => {
  const f=harness(t); replyFixture(f);
  const valid=new Date(Date.now()-2.5*3600000).toISOString();
  f.response={replies:[{...f.post('reply-a'),text:'My reply',createdAt:'2026-02-30T07:00:00Z',editedAt:valid}]};
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);
  assert.equal(f.w.qa.ctFavoriteRelativeTimeMatches('2h','2026-10-02T12:00:00',Date.now()),false);
  f.response={replies:[{...f.post('reply-a'),text:'My reply',created_at:'',createdAt:valid}]};
  assert.equal((await f.w.qa.ctResolveFavorite(f.candidate(),'account-a')).createdAt,valid);
});

test('malformed exact candidate timestamps cannot match another invalid API creation timestamp', async t => {
  const f=harness(t); f.response={posts:[{...f.post(),createdAt:'not-a-date'}]};
  assert.equal(await f.w.qa.ctResolveFavorite({...f.candidate(),createdAt:'not-a-date'},'account-a'),null);
  assert.equal(f.requests.length,0);
});

test('known detail Favorites retain all five numbered native photos while excluding quote, avatar and user images',t=>{
  const f=harness(t);f.w.snapshotFavorite=()=>({id:'detail',text:'My post'});
  f.article.insertAdjacentHTML('beforeend',galleryMarkup(5));
  f.article.querySelector('[aria-label]').insertAdjacentHTML('beforeend',galleryMarkup(2,'quote'));
  f.article.insertAdjacentHTML('beforeend','<img class="rounded-full" alt="Attached media 1 of 2" src="https://media.tweet.app/avatar.jpg"><div class="tl-user-text">'+galleryMarkup(2,'body')+'</div><article>'+galleryMarkup(2,'nested')+'</article>');
  const originals=[...f.doc.querySelectorAll('#gallery img')],before=f.article.innerHTML;
  const item=f.candidate();assert.equal(item.media.length,5);
  assert.deepEqual([...item.media].map(asset=>asset.url), originals.map(image=>image.src));
  assert.ok([...item.media].every(asset=>asset.type==='image'));
  assert.equal(f.article.innerHTML,before);assert.equal(f.requests.length,0);
});
test('known detail Favorites include only the native legacy Post media image structure',t=>{
  const f=harness(t);f.w.snapshotFavorite=()=>({id:'detail',text:'My post'});
  f.article.insertAdjacentHTML('beforeend','<div class="mt-3 rounded-2xl overflow-hidden border"><img class="w-full object-cover cursor-pointer" alt="Post media" src="https://media.tweet.app/legacy.jpg"></div><img alt="Post media" src="https://media.tweet.app/body.jpg">');
  f.article.querySelector('[aria-label]').insertAdjacentHTML('beforeend','<div class="mt-3 rounded-2xl overflow-hidden border"><img class="w-full object-cover cursor-pointer" alt="Post media" src="https://media.tweet.app/quoted.jpg"></div>');
  assert.deepEqual([...f.candidate().media].map(asset=>asset.url),['https://media.tweet.app/legacy.jpg']);
});
