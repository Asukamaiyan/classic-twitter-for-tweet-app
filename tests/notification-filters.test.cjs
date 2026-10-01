const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = ['navigation','notification-filters'].map(name => fs.readFileSync(path.join(__dirname, '../src/'+name+'.js'), 'utf8')).join('\n');
const bar = '<div id="bar" class="flex items-stretch sticky border-b"><button id="all">All</button><button id="mentions">Mentions</button></div>';
const icons = {reply:'message-circle',like:'heart',repost:'repeat-2',follow:'user-plus',unknown:'award'};
function row(id,type,extra='') {
  return `<div id="${id}-wrapper" class="border-b border-tl-app-border"><button id="${id}" class="w-full flex items-start gap-3 px-4 py-3.5 text-left"><div class="mt-0.5 shrink-0"><svg width="28" height="28" class="lucide lucide-${icons[type]}"></svg></div><div><p>Author ${type}</p><p class="tl-user-text">Home Following ${extra}</p></div></button>${type==='follow'?'<div class="native-follower-list"><button>Follow back</button></div>':''}</div>`;
}
function harness(t,{locale='ja',content}={}) {
  const dom=new JSDOM(`<head></head><body><nav><span id="native-unread">7</span></nav><main>${bar}${content||Object.keys(icons).map(type=>row(type,type)).join('')}</main></body>`,{url:'https://app.tweet.app/notifications',runScripts:'outside-only'});
  const {window}=dom; t.after(()=>window.close());
  window.ctNetworkState={authUID:'one'};
  window.getAuth=window.requestJSON=window.fetch=()=>{throw new Error('Filtering must not fetch or write');};
  window.eval(`const CT_LOCALE='${locale}'; ${source}; window.filters={patch:ctPatchNotificationFilters,state:ctNotificationFilters};`);
  return {window,document:window.document,patch:()=>window.filters.patch(),select(value){const select=window.document.querySelector('.ct-notification-filters select');select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));},hidden(id){return window.document.getElementById(id+'-wrapper').hasAttribute('data-ct-notification-hidden');}};
}
test('filters rendered native events only and keeps unknown notices, content and unread counts',t=>{
  const h=harness(t); const content=h.document.querySelector('.tl-user-text').textContent;
  h.patch();h.select('reply');
  assert.equal(h.hidden('reply'),false);assert.equal(h.hidden('unknown'),false);
  for(const type of ['like','repost','follow'])assert.equal(h.hidden(type),true);
  assert.equal(h.document.querySelector('.tl-user-text').textContent,content);
  assert.equal(h.document.getElementById('native-unread').textContent,'7');
  assert.match(h.document.querySelector('[role=status]').textContent,/5件中2件/);
  assert.equal(h.document.querySelectorAll('.ct-notification-filters').length,1);
  const before=h.document.body.innerHTML;h.patch();assert.equal(h.document.body.innerHTML,before);
});
test('follow expansion is hidden with its event, while native click handlers remain intact',t=>{
  const h=harness(t);let clicks=0;
  h.document.getElementById('follow').addEventListener('click',()=>clicks++);
  h.patch();h.select('follow');
  assert.equal(h.hidden('follow'),false);
  h.document.getElementById('follow').click();assert.equal(clicks,1);
  h.select('like');assert.equal(h.hidden('follow'),true);
  assert.equal(h.document.querySelector('.native-follower-list').textContent,'Follow back');
});
test('native tabs clear only the local filter and restore every original row',t=>{
  const h=harness(t);let native=0;
  h.document.getElementById('mentions').addEventListener('click',()=>native++);
  h.patch();h.select('reply');h.document.getElementById('mentions').click();
  assert.equal(native,1);assert.equal(h.document.querySelector('select').value,'');
  assert.equal(h.document.querySelectorAll('[data-ct-notification-hidden]').length,0);
});
test('React row replacement, icon changes and tab remount recover without stale hidden state',t=>{
  const h=harness(t);h.patch();h.select('reply');
  h.document.getElementById('like').querySelector('svg').setAttribute('class','lucide lucide-message-circle');
  h.patch();assert.equal(h.hidden('like'),false);
  h.document.getElementById('repost-wrapper').outerHTML=row('new','reply');
  h.patch();assert.equal(h.hidden('new'),false);
  const old=h.document.getElementById('bar');old.outerHTML=bar;h.patch();
  assert.equal(h.document.querySelector('select').value,'');
  assert.equal(h.document.querySelectorAll('[data-ct-notification-hidden]').length,0);
  assert.equal(h.document.querySelectorAll('.ct-notification-filters').length,1);
});
test('route exit and account changes restore native DOM and reset the filter',t=>{
  const h=harness(t);h.patch();h.select('repost');
  h.window.ctNetworkState.authUID='two';h.patch();
  assert.equal(h.document.querySelector('select').value,'');
  h.select('reply');h.window.history.replaceState({},'','/profile');h.patch();
  assert.equal(h.document.querySelector('.ct-notification-filters'),null);
  assert.equal(h.document.querySelectorAll('[data-ct-notification-hidden]').length,0);
});
test('removing or moving the filter panel restores hidden notifications and recreates usable controls',t=>{
  const h=harness(t);h.patch();h.select('reply');
  h.document.querySelector('.ct-notification-filters').remove();h.patch();
  assert.equal(h.document.querySelectorAll('.ct-notification-filters').length,1);
  assert.equal(h.document.querySelector('select').value,'');
  assert.equal(h.document.querySelectorAll('[data-ct-notification-hidden]').length,0);
  h.select('follow');h.document.body.append(h.document.querySelector('.ct-notification-filters'));h.patch();
  assert.equal(h.document.querySelector('.ct-notification-filters').previousElementSibling.id,'bar');
  assert.equal(h.document.querySelectorAll('[data-ct-notification-hidden]').length,0);
});
test('preview icons and retained hidden headers never identify a notification type or visible bar',t=>{
  const h=harness(t,{content:row('unknown','unknown','<svg width="28" height="28" class="lucide lucide-heart"></svg>')});
  h.patch();h.select('reply');assert.equal(h.hidden('unknown'),false);
  h.document.getElementById('bar').parentElement.style.display='none';h.patch();
  assert.equal(h.document.querySelector('.ct-notification-filters'),null);
});
test('English edition exposes native keyboard select with English classic labels',t=>{
  const h=harness(t,{locale:'en'});h.patch();
  assert.equal(h.document.querySelector('select').getAttribute('aria-label'),'Notification type');
  assert.deepEqual([...h.document.querySelectorAll('option')].map(x=>x.textContent),['All types','Replies','Favorites','Retweets','Follows']);
});
