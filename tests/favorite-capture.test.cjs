const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/favorite-capture.js'), 'utf8');
const timestampSource = fs.readFileSync(require('node:path').join(__dirname, '../src/timestamps.js'), 'utf8');
const mediaSource = fs.readFileSync(require('node:path').join(__dirname, '../src/media.js'), 'utf8');
const {galleryMarkup}=require('./helpers/native-media.cjs');
const date = '2026-09-30T07:00:00.000Z';
function native26Control(mode = 'idle') {
  return `<span class="inline-flex items-center"><button type="button" data-translate-mode="${mode}" aria-label="Translate post" aria-pressed="${mode === 'active'}" ${mode === 'busy' ? 'aria-busy="true" aria-disabled="true"' : ''}><svg aria-hidden="true"></svg></button><span data-translate-status role="status" aria-live="polite" class="sr-only"></span></span>`;
}
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
  w.ctProfilePostEdited = post => post.isEdited === true || typeof post.editedAt === 'string' && !!post.editedAt.trim();
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
test('Tweet 2.6 native icon modes protect Favorite originals without requiring English button text', async t => {
  for (const mode of ['active', 'busy', 'future-state', '', 'idle', 'original']) {
    const f = harness(t); f.article.insertAdjacentHTML('beforeend', native26Control(mode));
    if (mode === 'active') f.article.querySelector('p').textContent = '翻訳文';
    const candidate = f.candidate();
    if (['busy', 'future-state', ''].includes(mode)) { assert.equal(candidate, null, mode); continue; }
    assert.equal(candidate.translated, mode === 'active', mode); f.response = {posts:[f.post()]};
    assert.equal((await f.w.qa.ctResolveFavorite(candidate, 'account-a')).text, 'My post', mode);
  }
});
test('known Favorite permalinks cannot bypass native translated state or save the visible translation', async t => {
  for (const changes of [null, {id:'other'}, {authorUsername:'bob'}, {createdAt:'2026-09-30T08:00:00Z'},
    {text:null}, {status:'BLOCKED'}, {isDeleted:true}, {originalPostId:'reposted'}]) {
    const f = harness(t); f.article.querySelector('p').textContent = '翻訳文';
    f.article.insertAdjacentHTML('beforeend', native26Control('active'));
    f.w.snapshotFavorite = () => ({id:'post-a', username:'alice', text:'翻訳文'});
    f.response = {success:true, post:{...f.post(), ...(changes || {})}};
    const candidate = f.candidate(); assert.equal(candidate.translated, true);
    const item = await f.w.qa.ctResolveFavorite(candidate, 'account-a');
    assert.equal(item?.text || null, changes ? null : 'My post');
    assert.deepEqual(f.requests, ['https://api.tweet.app/api/posts/post-a']);
  }
  for (const mode of ['busy', 'future-state']) {
    const f = harness(t); f.w.snapshotFavorite = () => ({id:'post-a', username:'alice', text:'My post'});
    f.article.insertAdjacentHTML('beforeend', native26Control(mode)); assert.equal(f.candidate(), null, mode);
  }
});
test('Tweet 2.6 translated or uncertain reply Favorites remain unresolved even with a known permalink', t => {
  for (const mode of ['active', 'busy', 'future-state', 'idle', 'original']) {
    const f = harness(t); replyFixture(f); f.article.insertAdjacentHTML('beforeend', native26Control(mode));
    f.w.snapshotFavorite = () => ({id:'reply-a', username:'alice', text:'My reply'});
    assert.equal(!!f.candidate(), ['idle', 'original'].includes(mode), mode);
    assert.equal(f.requests.length, 0);
  }
});
test('Favorite translation checks exclude quote and nested-post controls and reject orphan native source status', t => {
  const f = harness(t); f.article.querySelector('[aria-label]').insertAdjacentHTML('beforeend', native26Control('active'));
  f.article.insertAdjacentHTML('beforeend', `<article>${native26Control('busy')}</article>`);
  assert.equal(f.candidate().translated, false);
  const body = f.article.querySelector('p');
  body.insertAdjacentHTML('beforebegin', '<div class="mt-0.5"><p class="text-[0.8125rem] text-tl-app-text-muted">Translated from English</p></div>');
  assert.equal(f.candidate(), null);
});

test('uncertain native translation does not prevent a confirmed unlike or restore translated text after rollback', async t => {
  for (const mode of ['busy', 'future-state', 'orphan-source']) {
    const f = harness(t), original = {id:'post-a', username:'alice', text:'Saved original', createdAt:date, savedAt:123};
    f.w.loadFavorites = () => [original];
    f.w.snapshotFavorite = () => ({id:'post-a', username:'alice', text:'Visible translation'});
    f.article.querySelector('p').textContent = 'Visible translation';
    if (mode === 'orphan-source') f.article.querySelector('p').insertAdjacentHTML('beforebegin',
      '<div class="mt-0.5"><p class="text-[0.8125rem] text-tl-app-text-muted">Translated from English</p></div>');
    else f.article.insertAdjacentHTML('beforeend', native26Control(mode));
    assert.equal(f.candidate(), null, 'saving remains guarded');
    f.button.setAttribute('aria-pressed','true'); f.click(); f.button.setAttribute('aria-pressed','false');
    await f.timers.shift()();
    assert.deepEqual(f.removals, [{id:'post-a',uid:'account-a'}], mode);
    assert.equal(f.requests.length, 0, 'the saved ID, author and exact time already establish the original');
    f.button.setAttribute('aria-pressed','true'); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.saves.length, 1); assert.equal(f.saves[0].item.text, 'Saved original');
    assert.equal(f.saves[0].item.savedAt, 123);
  }
});

test('uncertain unlike and re-like retain the saved original through repeated native actions and failures', async t => {
  for(const mode of ['busy','future-state']){
    const f=harness(t), original={id:'post-a',username:'alice',text:'Saved original',createdAt:date,savedAt:123};
    const items=new Map([[original.id,original]]);
    f.w.loadFavorites=()=>[...items.values()];
    f.w.saveFavorite=(item,uid)=>{f.saves.push({item,uid});items.set(item.id,item);};
    f.w.removeFavorite=(id,uid)=>{f.removals.push({id,uid});items.delete(id);};
    f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:'Visible translation'});
    f.article.querySelector('p').textContent='Visible translation';
    f.article.insertAdjacentHTML('beforeend',native26Control(mode));
    f.button.setAttribute('aria-pressed','true');
    for(let round=0;round<2;round++){
      f.click();f.button.setAttribute('aria-pressed','false');await f.timers.shift()();
      assert.equal(items.size,0,mode+' unlike');
      assert.equal(f.candidate(),null,'uncertain text remains unavailable for new snapshots');
      f.click();f.button.setAttribute('aria-pressed','true');await Promise.resolve();await Promise.resolve();
      assert.equal(f.timers.length,0,'the retained original watcher handles the state change');
      assert.equal(items.get('post-a')?.text,'Saved original',mode+' re-like');
      assert.equal(items.get('post-a')?.savedAt,123);
      // The native request rejects the re-like, then a later explicit retry succeeds.
      f.button.setAttribute('aria-pressed','false');await Promise.resolve();await Promise.resolve();
      assert.equal(items.size,0,mode+' re-like rollback');
      f.click();f.button.setAttribute('aria-pressed','true');await Promise.resolve();await Promise.resolve();
      assert.equal(items.get('post-a')?.text,'Saved original',mode+' retry');
    }
    assert.equal(f.requests.length,0);
    assert.ok(f.saves.every(row=>row.item.text==='Saved original'));
  }
});

test('unlike on an uncertain permalink-less main card resolves one API original without adopting its visible text', async t => {
  const f=harness(t); f.article.insertAdjacentHTML('beforeend', native26Control('busy'));
  f.article.querySelector('p').textContent='Visible translation'; f.response={posts:[f.post()]};
  f.button.setAttribute('aria-pressed','true'); f.click(); f.button.setAttribute('aria-pressed','false');
  await f.timers.shift()();
  assert.deepEqual(f.removals,[{id:'post-a',uid:'account-a'}]); assert.equal(f.requests.length,1);
  f.button.setAttribute('aria-pressed','true'); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.saves[0].item.text,'My post');
});

test('uncertain unlike rejects inexact replies, ambiguous API identities and mismatched saved or API originals', async t => {
  for (const change of ['reply', 'duplicate', 'saved-id', 'saved-author', 'saved-time', 'api-id', 'api-author', 'api-time']) {
    const f=harness(t); const original={id:'post-a',username:'alice',text:'Saved original',createdAt:date};
    if(change==='reply') replyFixture(f);
    f.article.insertAdjacentHTML('beforeend',native26Control('busy'));
    if(change!=='duplicate') f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:'Visible translation'});
    const saved={...original};
    if(change==='saved-id') saved.id='different';
    if(change==='saved-author') saved.username='bob';
    if(change==='saved-time') saved.createdAt='2026-09-30T07:00:01.000Z';
    f.w.loadFavorites=()=>change.startsWith('saved-') ? [saved] : [];
    const post=f.post();
    if(change==='api-id') post.id='different';
    if(change==='api-author') post.authorUsername='bob';
    if(change==='api-time') post.createdAt='2026-09-30T07:00:01.000Z';
    f.response=change==='duplicate'?{posts:[f.post('one'),f.post('two')]}:
      change.startsWith('api-')?{post}:null;
    f.button.setAttribute('aria-pressed','true');f.click();f.button.setAttribute('aria-pressed','false');
    while(f.timers.length)await f.timers.shift()();
    assert.equal(f.removals.length,0,change);assert.equal(f.saves.length,0,change);
    if(change==='reply')assert.equal(f.requests.length,0);
  }
});

test('uncertain unlike waits for a native state change and ignores a rollback before capture', async t => {
  for(const rollback of [false,true]){
    const f=harness(t);f.article.insertAdjacentHTML('beforeend',native26Control('busy'));
    f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:'Visible translation'});
    f.w.loadFavorites=()=>[{id:'post-a',username:'alice',text:'Saved original',createdAt:date}];
    f.button.setAttribute('aria-pressed','true');f.click();
    if(rollback){f.button.setAttribute('aria-pressed','false');f.button.setAttribute('aria-pressed','true');}
    await f.timers.shift()();
    assert.equal(f.removals.length,0);assert.equal(f.saves.length,0);assert.equal(f.requests.length,0);
  }
});

test('uncertain unlike discards a late identity after row reuse, navigation, account change or native reversal', async t => {
  for(const change of ['id','author','time','route','account','detached','reversal']){
    const f=harness(t);f.article.insertAdjacentHTML('beforeend',native26Control('busy'));
    let id='post-a',username='alice',finish;
    f.w.articleAuthor=()=>username;f.w.snapshotFavorite=()=>({id,username,text:'Visible translation'});
    f.w.requestJSON=async()=>new Promise(resolve=>{finish=resolve;});
    f.button.setAttribute('aria-pressed','true');f.click();f.button.setAttribute('aria-pressed','false');
    const pending=f.timers.shift()();
    for(let i=0;i<5&&!finish;i++)await Promise.resolve();
    assert.equal(typeof finish,'function');
    if(change==='id')id='other';
    if(change==='author')username='bob';
    if(change==='time')f.article.querySelector('span[title]').title='2026-09-30T07:00:01.000Z';
    if(change==='route')f.w.history.pushState({},'', '/user/bob');
    if(change==='account')f.w.identity.authUID='account-b';
    if(change==='detached')f.article.remove();
    if(change==='reversal')f.button.setAttribute('aria-pressed','true');
    finish({post:f.post()});await pending;
    assert.equal(f.removals.length,0,change);assert.equal(f.saves.length,0,change);
  }
});

test('late unlike rollback cannot restore the saved original onto a reused article', async t => {
  const f=harness(t);f.article.insertAdjacentHTML('beforeend',native26Control('busy'));
  f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:'Visible translation'});
  f.w.loadFavorites=()=>[{id:'post-a',username:'alice',text:'Saved original',createdAt:date}];
  f.button.setAttribute('aria-pressed','true');f.click();f.button.setAttribute('aria-pressed','false');
  await f.timers.shift()();assert.equal(f.removals.length,1);
  f.article.querySelector('span[title]').title='2026-09-30T07:00:01.000Z';
  f.button.setAttribute('aria-pressed','true');await Promise.resolve();await Promise.resolve();
  assert.equal(f.saves.length,0);
});

test('an original reply with a known permalink still captures without an exact DOM timestamp', async t => {
  const f=harness(t);replyFixture(f);
  f.w.snapshotFavorite=()=>({id:'reply-a',username:'alice',text:'My reply'});
  f.click();f.button.setAttribute('aria-pressed','true');await f.timers.shift()();
  assert.equal(f.saves.length,1);assert.equal(f.saves[0].item.id,'reply-a');
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

async function pendingFavoriteRestore(f) {
  const main=f.doc.createElement('main');f.article.before(main);main.append(f.article);
  f.button.setAttribute('aria-pressed','true');
  let finish;
  f.w.requestJSON=async url=>{f.requests.push(url);return new Promise(resolve=>{finish=resolve;});};
  const pending=f.w.qa.ctRestoreVisibleFavorites();
  for(let i=0;i<20&&!finish;i++)await Promise.resolve();
  assert.equal(typeof finish,'function');
  return {pending,finish:post=>finish({success:true,post:post||{...f.post(),hasLiked:true}})};
}

test('loaded-Favorites recovery discards stale row, route, button and server creation identities', async t => {
  for(const change of ['id','author','time','route','button','server-time']){
    const f=harness(t);let id='post-a',username='alice';
    f.w.snapshotFavorite=()=>({id,username,text:'My post'});f.w.articleAuthor=()=>username;
    const recovery=await pendingFavoriteRestore(f);
    if(change==='id')id='post-b';
    if(change==='author')username='bob';
    if(change==='time')f.article.querySelector('span[title]').title='2026-09-30T08:00:00.000Z';
    if(change==='route')f.w.history.pushState({},'', '/user/bob');
    if(change==='button')f.button.replaceWith(f.button.cloneNode(true));
    recovery.finish({...f.post(),hasLiked:true,...(change==='server-time'?{createdAt:'2026-09-30T08:00:00.000Z'}:{})});
    const result=await recovery.pending;
    assert.equal(result.saved,0,change);assert.equal(result.unresolved,1,change);assert.equal(f.saves.length,0,change);
  }
});

test('loaded-Favorites recovery cannot restore an unliked post after its row is reused as another liked post', async t => {
  const f=harness(t);let id='post-a',username='alice';
  f.w.snapshotFavorite=()=>({id,username,text:f.article.querySelector('p').textContent});f.w.articleAuthor=()=>username;
  const recovery=await pendingFavoriteRestore(f);
  f.click();f.button.setAttribute('aria-pressed','false');await f.timers.shift()();
  assert.deepEqual(f.removals,[{id:'post-a',uid:'account-a'}]);
  id='post-b';username='bob';f.article.querySelector('p').textContent='Another post';
  f.button.setAttribute('aria-pressed','true');await Promise.resolve();await Promise.resolve();
  recovery.finish();const result=await recovery.pending;
  assert.equal(result.saved,0);assert.equal(result.unresolved,1);assert.equal(f.saves.length,0);
});

test('loaded-Favorites recovery is invalidated by later native clicks even when the same post becomes liked again', async t => {
  for(const cycle of ['unlike-like','unlike-like-unlike','unidentifiable-cycle']){
    const f=harness(t);f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:'My post'});
    const recovery=await pendingFavoriteRestore(f);
    const timestamp=f.article.querySelector('span[title]');
    if(cycle==='unidentifiable-cycle'){
      timestamp.title='';f.article.insertAdjacentHTML('beforeend',native26Control('busy'));
    }
    f.click();f.button.setAttribute('aria-pressed','false');
    if(cycle!=='unidentifiable-cycle')await f.timers.shift()();
    f.click();f.button.setAttribute('aria-pressed','true');
    if(cycle!=='unidentifiable-cycle')await f.timers.shift()();
    if(cycle==='unlike-like-unlike'){
      f.click();f.button.setAttribute('aria-pressed','false');await f.timers.shift()();
    }
    if(cycle==='unidentifiable-cycle'){
      assert.equal(f.timers.length,0,'unidentifiable clicks perform no capture');
      timestamp.title=date;f.article.querySelector('[data-translate-mode]').remove();
    }
    const savedBefore=f.saves.length;
    recovery.finish();const result=await recovery.pending;
    assert.equal(result.saved,0,cycle);assert.equal(result.unresolved,1,cycle);
    assert.equal(f.saves.length,savedBefore,cycle);
  }
});

test('uncertain re-like preserves the original watcher while independently invalidating older Favorites recovery', async t => {
  const f=harness(t),original={id:'post-a',username:'alice',text:'Saved original',createdAt:date,savedAt:123};
  const items=new Map([[original.id,original]]);
  f.w.loadFavorites=()=>[...items.values()];
  f.w.saveFavorite=(item,uid)=>{f.saves.push({item,uid});items.set(item.id,item);};
  f.w.removeFavorite=(id,uid)=>{f.removals.push({id,uid});items.delete(id);};
  f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:f.article.querySelector('p').textContent});
  const recovery=await pendingFavoriteRestore(f);
  f.article.querySelector('p').textContent='Visible translation';
  f.article.insertAdjacentHTML('beforeend',native26Control('busy'));
  f.click();f.button.setAttribute('aria-pressed','false');await f.timers.shift()();assert.equal(items.size,0);
  f.click();f.button.setAttribute('aria-pressed','true');await Promise.resolve();await Promise.resolve();
  assert.equal(items.get('post-a')?.text,'Saved original');
  const before=f.saves.length;recovery.finish();const result=await recovery.pending;
  assert.equal(result.saved,0);assert.equal(result.unresolved,1);assert.equal(f.saves.length,before);
  assert.equal(items.get('post-a')?.text,'Saved original');
  f.button.setAttribute('aria-pressed','false');await Promise.resolve();await Promise.resolve();assert.equal(items.size,0);
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

test('captured native GIF video retains GIF metadata without changing regular or quoted video',t=>{
  const f=harness(t);f.w.snapshotFavorite=()=>({id:'detail',text:'My post'});
  f.article.insertAdjacentHTML('beforeend','<video aria-label="Animated GIF" src="https://media.tweet.app/gif.mp4"></video><video aria-label="GIFアニメーション" src="https://media.tweet.app/jp-gif.mp4"></video><video src="https://media.tweet.app/video.mp4"></video>');
  f.article.querySelector('[aria-label]').insertAdjacentHTML('beforeend','<video aria-label="Animated GIF" src="https://media.tweet.app/quoted-gif.mp4"></video>');
  const before=f.article.innerHTML,media=f.candidate().media;
  assert.equal(media.length,3);assert.equal(media[0].isGIF,true);assert.equal(media[1].isGIF,true);
  assert.equal(media[2].isGIF,undefined);assert.equal(f.article.innerHTML,before);
});

test('API-confirmed Favorites preserve edit metadata and GIF assets using the creation time',async t=>{
  const f=harness(t),edited={...f.post(),isEdited:true,editedAt:'2026-10-09T10:00:00Z',media_assets:[{type:'video',url:'https://media.tweet.app/gif.mp4',isGIF:true}]};
  f.response={posts:[edited],post:{...edited,hasLiked:true}};
  const item=await f.w.qa.ctResolveFavorite(f.candidate(),'account-a');
  assert.equal(item.isEdited,true);assert.equal(item.createdAt,date);assert.equal(item.media[0].isGIF,true);
  const main=f.doc.createElement('main');f.article.before(main);main.append(f.article);f.button.setAttribute('aria-pressed','true');
  const result=await f.w.qa.ctRestoreVisibleFavorites();assert.equal(result.saved,1);
  assert.equal(f.saves[0].item.isEdited,true);assert.equal(f.saves[0].item.createdAt,date);assert.equal(f.saves[0].item.media[0].isGIF,true);
  assert.equal(f.requests.some(url=>/like|favorite/.test(url)),false);
});

test('blocked native posts cannot resolve or restore a saved Favorite',async t=>{
  const f=harness(t);f.response={posts:[{...f.post(),status:'BLOCKED'}]};
  assert.equal(await f.w.qa.ctResolveFavorite(f.candidate(),'account-a'),null);
  f.w.snapshotFavorite=()=>({id:'post-a',username:'alice',text:'My post'});
  const main=f.doc.createElement('main');f.article.before(main);main.append(f.article);f.button.setAttribute('aria-pressed','true');
  f.response={post:{...f.post(),hasLiked:true,status:'BLOCKED'}};
  const result=await f.w.qa.ctRestoreVisibleFavorites();assert.equal(result.saved,0);assert.equal(f.saves.length,0);
});
