const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

// Extract only localization functions: fixtures never execute startup, make
// network requests, read browser credentials, or attach production timers.
function functionSource(source, name) {
  const start = source.indexOf(`\n  function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const tail = source.slice(start + 1);
  const next = tail.slice(3).search(/\n  (?:async )?function \w+\(/);
  assert.ok(next >= 0, `missing end of function ${name}`);
  return tail.slice(0, next + 3);
}

function fixture(language, html, route = '/feed') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: `https://app.tweet.app${route}`, runScripts: 'outside-only'
  });
  const source = fs.readFileSync(path.join(__dirname, `../classic-twitter-${language}.user.js`), 'utf8');
  const map = language === 'ja' ? 'JP' : 'EN';
  const start = source.indexOf(`  const ${map} = new Map([`);
  const end = source.indexOf('\n  ]);', start) + '\n  ]);'.length;
  const common = [
    'localizationScopeNodes', 'isOwnedLocalizationElement', 'isNativeSettingsNavigation',
    'isNativeLocalizationTimestamp', 'isProtectedLocalizationElement',
    'nativeLocalizationPoll', 'isNativeLocalizationPollUI',
    'nativeLocalizationAccountMenu', 'nativeLocalizationAccountDialog',
    'localizationNotificationRow', 'localizationNotificationAction', 'isLocalizationUI',
    'ctLocalizationClassicEnabled', 'ctLocalizationState', 'ctLocalizationNativeRecordException', 'ctLocalizationRecordAllowed',
    'ctLocalizationRead', 'ctLocalizationWrite', 'ctLocalizationForget', 'ctRememberLocalization',
    'ctSyncLocalizationAppearance', 'replaceLocalizationText', 'patchUIAttributes', 'translateTextNode', 'patchUI', 'patchInputs',
    'patchNotifications', 'patchRetweetRows'
  ];
  const japanese = [
    'ctLocalizationRegularText', 'ctLocalizationClassicText',
    'isNativeSettingsValue', 'isNativeLocalizationHelp', 'isNativeNotificationTimestamp',
    'isNativeEditedIndicator', 'isNativeReplyTimestamp', 'isNativeReplyOptionsButton', 'nativeLocalizationMonthNumber', 'nativeTimestampJapaneseText',
    'nativeLocalizationParentPostPreview', 'isNativeParentPostTimestamp', 'isNativeTranslationMetadata',
    'isNativeTweetCount', 'patchNativePollAndAccountUI', 'nativePollJapaneseText',
    'notificationTextNodes', 'patchNotificationGrammar', 'patchNotificationConnectors',
    'patchNotificationParticles', 'patchNotificationFollowGrammar', 'patchReplyingTo',
    'patchComposeJapanese', 'patchProfileJoinedDate', 'patchInviteJoinedLabels'
  ];
  const names = [...common, ...(language === 'ja' ? japanese : [])];
  dom.window.eval(`
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const ctFavoritePresentationEnabled = () => window.qaClassic !== false;
    ${source.slice(start, end)}
    ${names.map(name => functionSource(source, name)).join('\n')}
    window.qa = { ${names.join(', ')} };
  `);
  const { document, qa } = dom.window;
  function run(root = document) {
    qa.patchUI(root);
    qa.patchInputs(root);
    qa.patchNotifications(root);
    qa.patchRetweetRows(root);
    if (language === 'ja') {
      qa.patchNotificationFollowGrammar(root);
      qa.patchReplyingTo(root);
      qa.patchComposeJapanese(root);
      qa.patchProfileJoinedDate(root);
      qa.patchInviteJoinedLabels(root);
    }
  }
  return { dom, document, qa, run, text: id => document.getElementById(id).textContent };
}

test('ja: native edited tweet/reply metadata translates without touching content or names', () => {
  const f = fixture('ja', `<article>
    <div class="flex items-center"><span><button class="font-bold truncate" id="author">Edited</button></span>
    <span class="text-tl-app-text-muted hover:underline" title="2026-09-30T07:00:00.000Z">1m</span>
    <span>·</span><span class="text-tl-app-text-muted" title="2026-09-30T07:01:00.000Z" id="edited">Edited</span></div>
    <div class="flex items-center"><button class="font-bold truncate">Other</button>
    <span class="text-tl-app-text-muted shrink-0">2m</span><span>·</span>
    <span class="text-tl-app-text-muted shrink-0" title="2026-09-30T07:01:00.000Z" id="reply-edited">edited</span></div>
    <p class="whitespace-pre-wrap break-words" id="post">Edited</p>
    <span class="text-tl-app-text-muted" title="2026-09-30T07:01:00.000Z" id="unscoped">Edited</span>
    <button data-testid="tweet-open-comment-action" aria-label="Comment, 3 comments" id="reply"></button>
    <button data-testid="tweet-repost-action" aria-label="Retweet, 2 retweets" id="repost"></button>
  </article>`);
  f.run();
  assert.equal(f.text('edited'), '編集済み');
  assert.equal(f.text('reply-edited'), '編集済み');
  for (const id of ['author', 'post', 'unscoped']) assert.equal(f.text(id), 'Edited');
  assert.equal(f.document.getElementById('reply').getAttribute('aria-label'), '返信、3件の返信');
  assert.equal(f.document.getElementById('repost').getAttribute('aria-label'), 'リツイート、2件のリツイート');
  f.document.getElementById('edited').firstChild.nodeValue = 'Edited';
  f.run(f.document.getElementById('edited'));
  assert.equal(f.text('edited'), '編集済み');
  f.dom.window.close();
});

for (const route of ['/profile', '/user/alice']) test(`ja: verified composer heading on ${route} translates while profile name stays unchanged`, () => {
  const f = fixture('ja', `<main><div class="sticky"><h2 class="truncate" id="title">Feed</h2></div>
    <h2 id="name">Compose New</h2></main>
    <div class="bg-tl-app-card border rounded-3xl max-w-lg"><h3 class="text-xs font-bold uppercase tracking-wider" id="compose">Compose New Tweet</h3>
    <textarea id="public-modal-tweet-input">Compose New</textarea></div>`, route);
  f.run(); assert.equal(f.text('compose'), 'ツイートを作成'); assert.equal(f.text('name'), 'Compose New');
  assert.equal(f.document.querySelector('textarea').value, 'Compose New');
  if (route === '/profile') assert.equal(f.text('title'), 'プロフィール');
  f.dom.window.close();
});

test('ja: native profile/trend tweet counts translate without changing hashtags or numbers', () => {
  const f = fixture('ja', `<main><div><button>Followers</button><span class="text-tl-app-text-muted" id="count"><strong class="text-tl-app-text font-extrabold">191</strong> Tweets</span></div>
    <article><span class="text-tl-app-text-muted" id="body">191 Tweets</span></article></main>
    <aside><button class="group"><span class="truncate" title="#Tweets" id="tag">#Tweets</span><span class="text-tl-app-text-muted mt-0.5" id="trend">971 tweets</span></button></aside>`, '/profile');
  f.run(); assert.equal(f.text('count'),'191 ツイート'); assert.equal(f.text('trend'),'971件のツイート');
  assert.equal(f.text('tag'),'#Tweets');assert.equal(f.text('body'),'191 Tweets');f.dom.window.close();
});

for (const language of ['ja', 'en']) {
  test(`${language}: UI labels translate while post, quote, names and translations remain intact`, () => {
    const f = fixture(language, `
      <nav><button id="nav">Posts</button></nav>
      <article>
        <button id="name" class="font-bold truncate">Like</button>
        <p id="body" class="whitespace-pre-wrap break-words">Like</p>
        <div role="button"><p id="quote">Posts</p></div>
        <div class="tweet-action-bar"><button id="like" data-testid="tweet-like-action">Like</button></div>
        <p aria-live="polite"><span id="translated">Posts</span><button id="translate">Show original</button></p>
      </article>
      <a id="profile-link" href="/user/posts">Posts</a>
      <button id="user-card"><img alt=""><span id="user-name">Home</span></button>
      <h2 class="truncate" id="heading-name">Posts</h2>
      <p class="leading-relaxed" id="bio">Posts</p>
      <p id="plain">Posts</p>
      <a id="url" href="https://example.org">Posts</a>
      <pre><code id="code">Posts</code></pre>
      <div contenteditable=""><button id="editable">Posts</button></div>
      <div contenteditable="plaintext-only" id="plaintext">Posts</div>
      <div id="ct-local-panel"><button id="owned">Posts</button></div>
      <div class="ct-local-row"><span id="local-name">Posts</span></div>
      <div translate="no"><button id="no-translate">Posts</button></div>
    `);
    f.run();
    assert.equal(f.text('nav'), language === 'ja' ? 'ツイート' : 'Tweets');
    assert.equal(f.text('like'), language === 'ja' ? 'お気に入り' : 'Favorite');
    assert.equal(f.text('name'), 'Like');
    assert.equal(f.text('body'), 'Like');
    assert.equal(f.text('user-name'), 'Home');
    for (const id of ['quote', 'translated', 'profile-link', 'heading-name', 'bio', 'plain', 'url', 'code', 'editable', 'plaintext', 'owned', 'local-name', 'no-translate']) {
      assert.equal(f.text(id), 'Posts', id);
    }
    assert.equal(f.text('translate'), language === 'ja' ? '原文を表示' : 'Show original');
    f.dom.window.close();
  });

  test(`${language}: notification actor names and content previews cannot be rewritten`, () => {
    const f = fixture(language, `
      <main>
        <button class="w-full items-start border-b" id="row1">
          <div><svg></svg></div><div>
            <p><span class="font-extrabold" id="actor1">Home</span> and <span class="font-extrabold" id="actor2">Like</span> <span id="action1">liked your post</span></p>
            <p class="line-clamp-2" id="preview1">Like</p>
          </div>
        </button>
        <button class="w-full items-start border-b" id="row2">
          <div><p class="truncate"><span class="font-extrabold" id="actor3">Posts</span> @posts</p>
          <p id="action2">mentioned you</p><p class="line-clamp-3" id="preview2">Alice followed you</p></div>
        </button>
        <p id="unscoped">Bob liked your post</p>
        <button id="tab">Posts</button>
      </main>
    `, '/notifications');
    f.run();
    assert.equal(f.text('actor1'), 'Home');
    assert.equal(f.text('actor2'), 'Like');
    assert.equal(f.text('actor3'), 'Posts');
    assert.equal(f.text('preview1'), 'Like');
    assert.equal(f.text('preview2'), 'Alice followed you');
    assert.equal(f.text('unscoped'), 'Bob liked your post');
    assert.equal(f.text('action1'), language === 'ja' ? 'さんがあなたのツイートをお気に入りに登録しました' : 'favorited your Tweet');
    assert.equal(f.text('action2'), language === 'ja' ? 'あなたを@ツイートしました' : 'mentioned you');
    const before = f.document.body.innerHTML;
    f.run();
    assert.equal(f.document.body.innerHTML, before, 'repeated observer passes are idempotent');
    f.dom.window.close();
  });

  test(`${language}: changing a text-node subtree is handled without rescanning unrelated text`, () => {
    const f = fixture(language, '<button id="target">Posts</button><button id="other">Posts</button>');
    f.run(f.document.getElementById('target').firstChild);
    assert.equal(f.text('target'), language === 'ja' ? 'ツイート' : 'Tweets');
    assert.equal(f.text('other'), 'Posts');
    f.document.getElementById('target').firstChild.nodeValue = 'Like';
    f.run(f.document.getElementById('target').firstChild);
    assert.equal(f.text('target'), language === 'ja' ? 'お気に入り' : 'Favorite');
    f.dom.window.close();
  });

  test(`${language}: placeholder matching is exact and preserves drafts and UI structure`, () => {
    const f = fixture(language, `
      <form><label>Bio</label><textarea id="draft" placeholder="Post your reply">Posts</textarea>
      <input id="search" placeholder="Search someone's profile" value="Like">
      <button id="submit" type="submit"><svg id="icon"></svg><span>Post</span></button></form>
      <div id="ct-test"><input id="owned-input" placeholder="Post your reply"></div>
      <button id="aria" aria-label="Like" title="Like"></button>
    `);
    const icon = f.document.getElementById('icon');
    f.run();
    assert.equal(f.document.getElementById('draft').value, 'Posts');
    assert.equal(f.document.getElementById('draft').placeholder, language === 'ja' ? '返信をツイート' : 'Tweet your reply');
    assert.equal(f.document.getElementById('search').value, 'Like');
    assert.equal(f.document.getElementById('search').placeholder, "Search someone's profile");
    assert.equal(f.document.getElementById('owned-input').placeholder, 'Post your reply');
    assert.equal(f.document.getElementById('icon'), icon);
    assert.equal(f.document.getElementById('aria').getAttribute('aria-label'), language === 'ja' ? 'お気に入り' : 'Favorite');
    f.dom.window.close();
  });
}

test('ja: grouped notification grammar stays within one paragraph and preserves actor names', () => {
  const f = fixture('ja', `
    <main><button class="items-start border-b"><p><span class="font-extrabold" id="name1">Posts</span>, <span class="font-extrabold" id="name2">Home</span> and <span id="count"></span><span class="text-tl-app-text-muted" id="action">followed you</span></p></button>
    <button class="items-start border-b"><p id="next">followed you</p><p class="line-clamp-2">and</p></button></main>
  `, '/notifications');
  // Match React's real direct text-node split: " and ", 1, " ", "other", " ".
  const count = f.document.getElementById('count');
  count.replaceWith(f.document.createTextNode('1'), f.document.createTextNode(' '), f.document.createTextNode('other'), f.document.createTextNode(' '));
  f.run();
  assert.equal(f.text('name1'), 'Posts');
  assert.equal(f.text('name2'), 'Home');
  assert.match(f.document.querySelector('p').textContent, /Postsさん、Homeさんとそのほか1人/);
  assert.equal(f.text('action'), 'があなたをフォローしました');
  assert.equal(f.text('next'), 'あなたをフォローしました', 'standalone action has no actor inferred from previous row');
  const before = f.document.body.innerHTML;
  f.run();
  assert.equal(f.document.body.innerHTML, before);
  f.dom.window.close();
});

test('ja: Joined changes only calendar metadata or referral dt, never bio, names or locations', () => {
  const f = fixture('ja', `
    <main><h2 id="name">Home</h2><p class="leading-relaxed" id="bio">Joined September 2026</p>
    <span class="inline-flex" id="location"><svg class="lucide-map-pin"></svg>Joined September 2026</span>
    <span class="inline-flex" id="joined"><svg class="lucide-calendar"></svg>Joined September 2026</span>
    <article><span class="inline-flex" id="post"><svg class="lucide-calendar"></svg>Joined September 2026</span></article></main>
  `, '/user/home');
  f.run();
  assert.equal(f.text('name'), 'Home');
  assert.equal(f.text('bio'), 'Joined September 2026');
  assert.equal(f.text('location'), 'Joined September 2026');
  assert.equal(f.text('post'), 'Joined September 2026');
  assert.equal(f.text('joined'), '2026年9月からTweetを利用しています');
  f.dom.window.close();
  const g = fixture('ja', '<main><dl><div><dt id="label">Joined</dt><dd id="value">Home</dd></div></dl></main>', '/settings');
  g.run();
  assert.equal(g.text('label'), '参加した人数');
  assert.equal(g.text('value'), 'Home');
  g.dom.window.close();
});

test('ja: split native joined metadata formats the month and retains React nodes on date updates', () => {
  const f = fixture('ja', '<main><span class="inline-flex" id="joined"><svg class="lucide-calendar"></svg></span></main>', '/profile');
  const el = f.document.getElementById('joined');
  const icon = el.firstElementChild;
  const label = f.document.createTextNode('Joined');
  const spacer = f.document.createTextNode(' ');
  const date = f.document.createTextNode('Sep 2026');
  el.append(label, spacer, date);
  f.run();
  assert.equal(el.textContent, '2026年9月からTweetを利用しています');
  assert.deepEqual([...el.childNodes], [icon, label, spacer, date]);
  const before = el.innerHTML;
  f.run();
  assert.equal(el.innerHTML, before);
  // Native React may update only the date, or render all three values again.
  date.nodeValue = '2026年10月';
  f.run(date);
  assert.equal(el.textContent, '2026年10月からTweetを利用しています');
  label.nodeValue = 'Joined'; spacer.nodeValue = ' '; date.nodeValue = 'Nov 2026';
  f.run(el);
  assert.equal(el.textContent, '2026年11月からTweetを利用しています');
  f.dom.window.qaClassic = false;
  f.run();
  assert.equal(el.textContent, '2026年11月からTweetを利用しています');
  f.dom.window.close();
});

test('ja: joined date accepts native English and Japanese month formats but preserves unknown and protected data', () => {
  const values = ['Jan 2026', 'September 2026', 'Sept. 2026', '2026年9月', '2026/09', '9/2026', '09.2026',
    'Unknown 2026', '2026年13月', 'Jan 26'];
  const html = values.map((value, i) => `<span class="inline-flex" id="joined-${i}"><svg class="lucide-calendar"></svg>Joined ${value}</span>`).join('') +
    '<div data-user-content><span class="inline-flex" id="protected"><svg class="lucide-calendar"></svg>Joined September 2026</span></div>' +
    '<span class="inline-flex" id="nested"><svg class="lucide-calendar"></svg><span>Joined September 2026</span></span>';
  const f = fixture('ja', `<main>${html}</main>`, '/user/alice');
  f.run();
  for (let i = 0; i < 7; i++) assert.equal(f.text(`joined-${i}`), `2026年${i === 0 ? 1 : 9}月からTweetを利用しています`);
  for (let i = 7; i < values.length; i++) assert.equal(f.text(`joined-${i}`), `Joined ${values[i]}`);
  assert.equal(f.text('protected'), 'Joined September 2026');
  assert.equal(f.text('nested'), 'Joined September 2026');
  f.dom.window.close();
});

test('ja: replying-to labels preserve handles instead of adding honorifics to identities', () => {
  const f = fixture('ja', '<article><p id="replying">Replying to <span id="handle">@Home</span></p><p class="whitespace-pre-wrap" id="body">Replying to @Home</p></article>');
  f.run();
  assert.equal(f.text('handle'), '@Home');
  assert.equal(f.text('replying'), '返信先: @Home');
  assert.equal(f.text('body'), 'Replying to @Home');
  f.dom.window.close();
});

for (const language of ['ja', 'en']) {
  test(`${language}: repost metadata only changes in the icon-marked article header`, () => {
    const f = fixture(language, '<article><div><svg class="lucide-repeat"></svg><span id="meta">Home reposted</span></div><p class="whitespace-pre-wrap" id="body">Home reposted</p><div id="unknown">Home reposted</div></article><p id="outside">Home reposted</p>');
    f.run();
    assert.equal(f.text('meta'), language === 'ja' ? 'Homeさんがリツイートしました' : 'Home Retweeted');
    for (const id of ['body', 'unknown', 'outside']) assert.equal(f.text(id), 'Home reposted');
    f.dom.window.close();
  });
}

test('ja: native settings labels translate without exposing account values or unrelated truncated names', () => {
  const f = fixture('ja', `
    <main><nav>
      <button><svg></svg><span><span class="font-bold truncate" id="nav-label">Your account</span><span class="truncate" id="nav-description">See account information like your username and date of birth.</span></span></button>
      <button><img alt=""><span class="truncate" id="nav-name">Home</span></button>
      <button><svg></svg><span class="truncate" id="nav-handle">Home</span><span>@home</span></button>
    </nav><section>
      <div><h4 class="font-extrabold" id="title">Account information</h4><p class="leading-relaxed" id="description">See your account information like your username and date of birth.</p></div>
      <div><span class="uppercase tracking-wide" id="row-label">Username</span><span class="truncate" id="value">Home</span></div>
      <p class="leading-relaxed" id="bio">Home</p>
      <div><h4 class="font-extrabold">A user-chosen title</h4><p class="leading-relaxed" id="unverified-description">Home</p></div>
    </section></main>
  `, '/settings');
  f.run();
  assert.equal(f.text('nav-label'), 'アカウント');
  assert.equal(f.text('nav-description'), 'ユーザー名や生年月日などのアカウント情報を確認します。');
  assert.equal(f.text('title'), 'アカウント情報');
  assert.equal(f.text('description'), 'ユーザー名や生年月日などのアカウント情報を確認できます。');
  assert.equal(f.text('row-label'), 'ユーザー名');
  for (const id of ['nav-name', 'nav-handle', 'value', 'bio', 'unverified-description']) assert.equal(f.text(id), 'Home', id);
  const before = f.document.body.innerHTML;
  f.run();
  assert.equal(f.document.body.innerHTML, before);
  f.dom.window.close();
});

test('ja: native timestamp translations require ISO date and header styling', () => {
  const f = fixture('ja', `<article>
    <span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00.000Z" id="now">Just now</span>
    <span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00Z" id="seconds">12s</span>
    <span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00+09:00" id="minutes">12m</span>
    <span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00.000Z" id="hours">3h</span>
    <span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00.000Z" id="days">2d</span>
    <span class="text-tl-app-text-muted hover:underline" title="not-a-date" id="invalid">Just now</span>
    <span title="2026-09-26T09:00:00.000Z" id="unstyled">Just now</span>
    <p class="whitespace-pre-wrap"><span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00.000Z" id="body">Just now</span></p>
    <button><span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00.000Z" id="name">Just now</span></button>
  </article><span class="text-tl-app-text-muted hover:underline" title="2026-09-26T09:00:00.000Z" id="outside">12m</span>`);
  f.run();
  for (const [id, expected] of [['now', 'たった今'], ['seconds', '12秒前'], ['minutes', '12分前'], ['hours', '3時間前'], ['days', '2日前']]) assert.equal(f.text(id), expected);
  for (const id of ['invalid', 'unstyled', 'body', 'name']) assert.equal(f.text(id), 'Just now', id);
  assert.equal(f.text('outside'), '12m');
  const before = f.document.body.innerHTML;
  f.run();
  assert.equal(f.document.body.innerHTML, before);
  f.dom.window.close();
});

function nativeReplyTimestampCard(value, id, extra = '') {
  return `<article><div class="flex items-start gap-3"><button aria-label="View @alice's profile"><img></button>
    <div class="min-w-0 flex-1"><div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate hover:underline">alice</button>
      <span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted shrink-0" id="${id}" ${extra}>${value}</span>
      <div class="flex items-center shrink-0 ml-auto"><button aria-label="More options"></button></div></div>
    <p class="tl-user-text whitespace-pre-wrap">${value}</p></div></div></article>`;
}

test('ja: native reply header times localize without ISO titles and preserve body, names and native nodes', () => {
  const values = ['Just now', '12s', '5m', '3h', '2d', 'Sep 27', 'Feb 29'];
  const f = fixture('ja', values.map((value, i) => nativeReplyTimestampCard(value, `time-${i}`)).join(''), '/post/example');
  const time = f.document.getElementById('time-3');
  const node = time.firstChild;
  f.run();
  const expected = ['たった今', '12秒前', '5分前', '3時間前', '2日前', '9月27日', '2月29日'];
  for (let i = 0; i < values.length; i++) assert.equal(f.text(`time-${i}`), expected[i]);
  assert.deepEqual([...f.document.querySelectorAll('p.tl-user-text')].map(el => el.textContent), values);
  assert.equal(time.firstChild, node);
  node.nodeValue = '4h';
  f.run(node);
  assert.equal(time.textContent, '4時間前');
  const before = f.document.body.innerHTML;
  f.run(); assert.equal(f.document.body.innerHTML, before);
  f.dom.window.close();
});

test('ja: reply timestamp guard rejects lookalike content and invalid dates', () => {
  const f = fixture('ja', nativeReplyTimestampCard('3h', 'native') +
    nativeReplyTimestampCard('3h', 'invalid-title', 'title="not-a-date"') +
    nativeReplyTimestampCard('Apr 31', 'invalid-monthday') +
    nativeReplyTimestampCard('3h', 'protected', 'data-user-content') +
    '<article><span class="text-tl-app-text-muted shrink-0" id="unscoped">3h</span></article>' +
    '<div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate hover:underline">alice</button><span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted shrink-0" id="outside">3h</span><div class="flex items-center shrink-0 ml-auto"></div></div><p class="tl-user-text whitespace-pre-wrap">3h</p>');
  f.run();
  assert.equal(f.text('native'), '3時間前');
  for (const id of ['invalid-title', 'protected', 'unscoped', 'outside']) assert.equal(f.text(id), '3h', id);
  assert.equal(f.text('invalid-monthday'), 'Apr 31');
  f.dom.window.close();
});

test('ja: reply times remain native metadata when official owned badges and founder numbers precede the separator', () => {
  const f = fixture('ja', nativeReplyTimestampCard('5h', 'time') + nativeReplyTimestampCard('3h', 'unknown') +
    nativeReplyTimestampCard('3h', 'bad-founder') + nativeReplyTimestampCard('3h', 'bad-art'), '/post/example');
  const decoration = '<span class="ct-official-badges" data-ct-owned role="img" aria-label="創設メンバー"><img src="https://app.tweet.app/assets/founder-badge-96.png"></span><span class="ct-founder" title="Founder Number #05376">#05376</span>';
  const insert = (id, html) => f.document.getElementById(id).parentElement.firstElementChild.insertAdjacentHTML('afterend', html);
  insert('time', decoration);
  insert('unknown', '<span>Unknown user content</span>');
  insert('bad-founder', '<span class="ct-founder" title="Different metadata">#05376</span>');
  insert('bad-art', '<span class="ct-official-badges" data-ct-owned role="img"><img src="https://example.com/founder-badge-96.png"></span>');
  f.document.getElementById('time').parentElement.firstElementChild.classList.add('ct-author-name');
  f.run();
  assert.equal(f.text('time'), '5時間前');
  for (const id of ['unknown', 'bad-founder', 'bad-art']) assert.equal(f.text(id), '3h');
  assert.equal(f.document.querySelector('span.ct-founder').textContent, '#05376');
  assert.equal(f.document.querySelector('button.ct-author-name').textContent, 'alice');
  const node = f.document.getElementById('time').firstChild;
  node.nodeValue = '6h'; f.run(node); assert.equal(node.nodeValue, '6時間前');
  f.dom.window.close();
});

test('ja: reply options accessibility label localizes only on the verified native menu trigger', () => {
  const f = fixture('ja', '<article><div class="relative"><button class="p-2 rounded-full text-tl-app-text-muted" aria-label="Reply options" title="Reply options" id="menu"><svg class="lucide-ellipsis-vertical" width="18" height="18"></svg></button></div>' +
    '<button aria-label="Reply options" id="unscoped"></button><p class="tl-user-text" id="body">Reply options</p>' +
    '<div data-user-content><div class="relative"><button class="p-2 rounded-full text-tl-app-text-muted" aria-label="Reply options" id="protected"><svg class="lucide-ellipsis-vertical" width="18" height="18"></svg></button></div></div></article>');
  f.run();
  assert.equal(f.document.getElementById('menu').getAttribute('aria-label'), '返信のメニュー');
  assert.equal(f.document.getElementById('menu').title, '返信のメニュー');
  for (const id of ['unscoped', 'protected']) assert.equal(f.document.getElementById(id).getAttribute('aria-label'), 'Reply options');
  assert.equal(f.text('body'), 'Reply options');
  f.dom.window.close();
});

test('ja: old native tweet dates localize only with valid ISO metadata', () => {
  const f = fixture('ja', '<article><span class="text-tl-app-text-muted hover:underline" title="2026-09-27T09:00:00Z" id="date">Sep 27</span><span class="text-tl-app-text-muted hover:underline" title="not-a-date" id="invalid">Sep 27</span><p class="tl-user-text" id="body">Sep 27</p></article>');
  f.run();
  assert.equal(f.text('date'), '9月27日');
  assert.equal(f.text('invalid'), 'Sep 27');
  assert.equal(f.text('body'), 'Sep 27');
  f.dom.window.close();
});

test('en: native reply relative times and joined metadata retain natural English', () => {
  const f = fixture('en', nativeReplyTimestampCard('3h', 'time') + '<span class="inline-flex" id="joined"><svg class="lucide-calendar"></svg>Joined Sep 2026</span>', '/user/alice');
  f.run();
  assert.equal(f.text('time'), '3h');
  assert.equal(f.text('joined'), 'Joined Sep 2026');
  f.dom.window.close();
});

test('ja: native parent-preview timestamp and unavailable metadata translate while names and quoted text stay intact', () => {
  const f = fixture('ja', `<main><div class="border-b border-tl-app-border"><button class="flex w-full items-start gap-3 px-4 pt-3 pb-2 text-left">
    <div class="min-w-0 flex-1"><div class="flex min-w-0 flex-wrap items-center gap-1 leading-4">
      <span class="font-semibold truncate" id="name">Just now</span><span class="text-tl-app-text-muted truncate">@alice</span>
      <span class="text-tl-app-text-muted">·</span><span class="shrink-0 text-tl-app-text-muted" id="time">3h</span></div>
    <p class="mt-1">Replying to <span id="handle">@alice</span></p>
    <p class="line-clamp-3 wrap-break-word" id="preview">3h Translated from English</p>
    <p class="mt-1 italic leading-5 text-tl-app-text-muted" id="unavailable">This post is no longer available</p></div></button><article><p class="tl-user-text" id="post">This post is no longer available</p></article></div>
    <button class="flex w-full items-start gap-3 px-4 pt-3 pb-2 text-left"><div class="min-w-0 flex-1"><div class="flex min-w-0 flex-wrap items-center gap-1 leading-4"><span class="font-semibold truncate">Alice</span><span class="text-tl-app-text-muted truncate">@alice</span><span class="text-tl-app-text-muted">·</span><span class="shrink-0 text-tl-app-text-muted" id="lookalike">3h</span></div></div></button></main>`, '/user/alice');
  f.run();
  assert.equal(f.text('time'), '3時間前');
  assert.equal(f.text('name'), 'Just now');
  assert.equal(f.text('handle'), '@alice');
  assert.equal(f.text('preview'), '3h Translated from English');
  assert.equal(f.text('unavailable'), 'このツイートは表示できません');
  assert.equal(f.text('post'), 'This post is no longer available');
  assert.equal(f.text('lookalike'), '3h');
  f.document.getElementById('time').firstChild.nodeValue = 'Sep 27';
  f.run(f.document.getElementById('time'));
  assert.equal(f.text('time'), '9月27日');
  f.dom.window.close();
});

test('ja: native translation source language formats naturally and preserves generated translation and user content', () => {
  const f = fixture('ja', `<article><div class="mt-0.5"><p class="text-tl-app-text-muted" aria-live="polite" id="metadata">Translated from English<span class="select-none"> · </span><button class="text-sky-500" id="toggle">Show original</button></p></div>
    <div class="mt-0.5"><p class="text-tl-app-text-muted" aria-live="polite" id="japanese-source">Translated from 英語<span class="select-none"> · </span><button class="text-sky-500">Show original</button></p></div>
    <p class="tl-user-text" id="translated">Translated from English</p>
    <p class="text-tl-app-text-muted" aria-live="polite" id="unscoped">Translated from English</p>
    <div data-user-content class="mt-0.5"><p class="text-tl-app-text-muted" aria-live="polite" id="protected">Translated from English<span class="select-none"> · </span><button class="text-sky-500">Show original</button></p></div></article>`);
  const node = f.document.getElementById('metadata').firstChild;
  f.run();
  assert.equal(node.nodeValue, '英語から翻訳');
  assert.equal(f.text('toggle'), '原文を表示');
  assert.ok(f.text('japanese-source').startsWith('英語から翻訳 · '));
  assert.equal(f.text('translated'), 'Translated from English');
  assert.equal(f.text('unscoped'), 'Translated from English');
  assert.ok(f.text('protected').startsWith('Translated from English · '));
  node.nodeValue = 'Translated from Japanese';
  f.run(node);
  assert.equal(node.nodeValue, '日本語から翻訳');
  f.dom.window.close();
});

test('ja: native busy translation control localizes split text without rewriting body or unrelated buttons', () => {
  const f = fixture('ja', `<article><div class="mt-0.5"><p class="text-tl-app-text-muted" aria-live="polite"><button class="text-tl-app-text-muted" aria-busy="true" aria-disabled="true" id="translating"></button></p></div>
    <p class="tl-user-text" id="body">Translating</p><button class="text-tl-app-text-muted" aria-busy="true" id="unscoped">Translating</button></article>`);
  const button = f.document.getElementById('translating');
  const label = f.document.createTextNode('Translating');
  const dots = f.document.createTextNode('…');
  button.append(label, dots);
  f.run();
  assert.equal(button.textContent, '翻訳中…');
  assert.deepEqual([...button.childNodes], [label, dots]);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(f.text('body'), 'Translating');
  assert.equal(f.text('unscoped'), 'Translating');
  f.dom.window.close();
});

for (const route of ['/profile', '/user/alice']) test(`ja: verified profile sidebar headings and abbreviated tweet counts translate on ${route}`, () => {
  const f = fixture('ja', `<main><h3 class="font-semibold text-tl-app-text shrink-0" id="name">Who to follow</h3></main>
    <aside><div class="bg-tl-app-card border border-tl-app-border"><h3 class="font-semibold text-tl-app-text shrink-0" id="heading">Who to follow</h3>
      <h3 class="font-semibold text-tl-app-text shrink-0" id="trends">Trends for you</h3>
      <button class="group"><span class="truncate" title="#Home" id="tag">#Home</span><span class="text-tl-app-text-muted mt-0.5" id="count">1.1K tweets</span></button>
      <button class="group"><span class="truncate" title="#Friends">#Friends</span><span class="text-tl-app-text-muted mt-0.5" id="million">2M tweets</span></button>
      <p class="tl-user-text" id="body">1.1K tweets</p></div></aside>`, route);
  f.run();
  assert.equal(f.text('name'), 'Who to follow');
  assert.equal(f.text('heading'), 'おすすめユーザー');
  assert.equal(f.text('trends'), 'おすすめのトレンド');
  assert.equal(f.text('count'), '1.1K件のツイート');
  assert.equal(f.text('million'), '2M件のツイート');
  assert.equal(f.text('tag'), '#Home');
  assert.equal(f.text('body'), '1.1K tweets');
  f.dom.window.close();
});

for (const language of ['ja', 'en']) {
  test(`${language}: native parent-styled empty states and explicit no-translation attributes`, () => {
    const f = fixture(language, `
      <main><div class="text-center"><p class="text-tl-app-text-muted" id="empty">No reposts yet.</p></div>
      <div class="text-center"><p class="text-tl-app-text-muted" id="notifications">Nothing to see here yet. Likes, reposts, and follows will show up here.</p></div>
      <article><div class="text-center"><p class="text-tl-app-text-muted" id="post">No reposts yet.</p></div></article>
      <div translate="no"><button aria-label="Like" title="Like" id="protected-button">Like</button><input placeholder="Post your reply" id="protected-input"></div>
      <div class="notranslate"><button aria-label="Like" id="protected-class">Like</button></div>
      <div data-user-content><input placeholder="Post your reply" id="protected-data"></div>
      <input placeholder="Search Tweet" value="Home" id="search"></main>`);
    f.run();
    assert.equal(f.text('empty'), language === 'ja' ? 'まだリツイートはありません。' : 'No Retweets yet.');
    assert.equal(f.text('notifications'), language === 'ja' ? '通知はまだありません。お気に入り、リツイート、フォローの通知がここに表示されます。' : 'Nothing to see here yet. Favorites, Retweets, and follows will show up here.');
    assert.equal(f.text('post'), 'No reposts yet.');
    for (const id of ['protected-button', 'protected-class']) assert.equal(f.document.getElementById(id).getAttribute('aria-label'), 'Like');
    assert.equal(f.document.getElementById('protected-button').title, 'Like');
    for (const id of ['protected-input', 'protected-data']) assert.equal(f.document.getElementById(id).placeholder, 'Post your reply');
    assert.equal(f.document.getElementById('search').placeholder, language === 'ja' ? 'Tweetを検索' : 'Search Tweet');
    assert.equal(f.document.getElementById('search').value, 'Home');
    f.dom.window.close();
  });
}

test('ja: mobile account menu counts translate while display name stays unchanged', () => {
  const f = fixture('ja', `<div role="dialog" aria-label="Account menu">
    <button><img alt=""><p class="truncate" id="name">Followers</p></button>
    <div><span id="followers"><strong>10</strong> Followers</span><span id="following"><strong>2</strong> Following</span></div>
  </div><span id="outside"><strong>10</strong> Followers</span>`);
  f.run();
  assert.equal(f.text('followers'), '10 フォロワー');
  assert.equal(f.text('following'), '2 フォロー中');
  assert.equal(f.text('name'), 'Followers');
  assert.equal(f.text('outside'), '10 Followers');
  f.dom.window.close();
});


test('ja: native truncated route heading translates without changing profile names', () => {
  const f = fixture('ja', '<main><h2 class="truncate">Explore</h2><article><h2 class="truncate" id="name">Explore</h2></article></main>', '/explore');
  f.run();
  assert.equal(f.document.querySelector('main h2').textContent, '話題を検索');
  assert.equal(f.text('name'), 'Explore');
  f.dom.window.close();
});

test('ja: grouped notifications recover when React changes only the count and retains translated action nodes', () => {
  const f = fixture('ja', '<main><button class="items-start border-b"><p><span class="font-extrabold" id="actorA">Actor A</span>, <span class="font-extrabold" id="actorB">Actor B</span><span id="count"></span><span class="text-tl-app-text-muted" id="action">liked your post</span></p></button></main>', '/notifications');
  const connector = f.document.createTextNode(' and ');
  const count = f.document.createTextNode('3');
  const other = f.document.createTextNode('others');
  f.document.getElementById('count').replaceWith(connector, count, f.document.createTextNode(' '), other, f.document.createTextNode(' '));
  f.run();
  assert.equal(f.document.querySelector('p').textContent, 'Actor Aさん、Actor Bさんとそのほか3人があなたのツイートをお気に入りに登録しました');
  count.nodeValue = '6'; // Native React reuses its unchanged connectors and others text.
  f.run();
  assert.equal(f.document.querySelector('p').textContent, 'Actor Aさん、Actor Bさんとそのほか6人があなたのツイートをお気に入りに登録しました');
  f.document.getElementById('action').firstChild.nodeValue = 'さんがあなたのツイートをお気に入りに登録しました';
  f.run();
  assert.equal(f.text('action'), 'があなたのツイートをお気に入りに登録しました');
  assert.equal(f.text('actorA'), 'Actor A');
  assert.equal(f.text('actorB'), 'Actor B');
  const stable = f.document.body.innerHTML;
  f.run(); assert.equal(f.document.body.innerHTML, stable);
  f.dom.window.close();
});


test('ja: settings row notes and finite security states translate without touching account values', () => {
  const f = fixture('ja', `<main><section>
    <div><div><span class="uppercase tracking-wide">Username</span><span class="truncate" id="name">On</span></div><button id="change">Change</button></div>
    <p class="px-4 py-3 text-tl-app-text-muted leading-relaxed" id="note">Your username was set when you created your account and cannot be changed here.</p>
    <div><span class="uppercase tracking-wide">Founding plan</span><p class="text-tl-app-text-muted leading-relaxed" id="plan">You have Centurion.</p></div>
    <div><span class="uppercase tracking-wide">Authentication app</span><span class="truncate" id="auth">On</span></div>
    <div><span class="uppercase tracking-wide">Text message</span><span class="truncate" id="sms">Off</span><button id="off">Turn off</button></div>
    <div><div><span class="uppercase tracking-wide">Backup codes</span><span class="truncate" id="codes">10 codes remaining</span></div></div>
    <p class="px-4 py-3 text-tl-app-text-muted leading-relaxed" id="warning">Generating new codes invalidates any unused codes you already have.</p>
    <div><span class="uppercase tracking-wide">Display name</span><span class="truncate" id="display">10 codes remaining</span></div>
    <div>Unrelated content</div><p class="px-4 py-3 text-tl-app-text-muted leading-relaxed" id="unknown">Home</p>
    <h4 class="font-bold" id="joined-title">Friends who joined</h4><ul><li id="joined-user">@Home</li></ul>
  </section></main>`, '/settings');
  f.run();
  assert.equal(f.text('name'), 'On');
  assert.equal(f.text('display'), '10 codes remaining');
  assert.equal(f.text('change'), '変更');
  assert.equal(f.text('note'), 'ユーザー名はアカウント作成時に設定されたため、ここでは変更できません。');
  assert.equal(f.text('plan'), 'Centurionを利用中です。');
  assert.equal(f.text('auth'), 'オン');
  assert.equal(f.text('sms'), 'オフ');
  assert.equal(f.text('off'), 'オフにする');
  assert.equal(f.text('codes'), '10個のコードが残っています');
  assert.equal(f.text('warning'), '新しいコードを生成すると、現在お持ちの未使用コードはすべて無効になります。');
  assert.equal(f.text('joined-title'), '参加した友だち');
  assert.equal(f.text('joined-user'), '@Home');
  // An unrelated paragraph still does not gain access to dictionary matching.
  assert.equal(f.text('unknown'), 'Home');
  f.document.getElementById('codes').firstChild.nodeValue = '1 code remaining';
  f.run(); assert.equal(f.text('codes'), '1個のコードが残っています');
  f.document.getElementById('codes').firstChild.nodeValue = 'No unused codes';
  f.run(); assert.equal(f.text('codes'), '未使用のコードはありません');
  const before = f.document.body.innerHTML;
  f.run(); assert.equal(f.document.body.innerHTML, before);
  f.dom.window.close();
});

test('ja: native invite help preserves React counters and never translates user list items', () => {
  const f = fixture('ja', `<div role="region" aria-label="How the Wing badge works">
    <p id="title">Earn a Wing badge!</p><p id="how">How it works:</p>
    <ol><li id="share">Share your invite link with friends.</li><li id="get"></li></ol>
  </div><ul><li id="name">Share your invite link with friends.</li></ul>
  <article><div role="region" aria-label="How the Wing badge works"><li id="post">Share your invite link with friends.</li></div></article>`);
  const counter = f.document.createTextNode('5');
  f.document.getElementById('get').append(f.document.createTextNode('Get '), counter, f.document.createTextNode(' friends → get a Wing badge!'));
  f.run();
  assert.equal(f.text('title'), 'Wingバッジを獲得しよう！');
  assert.equal(f.text('how'), '仕組み:');
  assert.equal(f.text('share'), '招待リンクを友だちにシェアします。');
  assert.match(f.text('get'), /友だちが 5 人参加すると、Wingバッジを獲得できます！/);
  assert.equal(f.document.getElementById('get').childNodes[1], counter);
  counter.nodeValue = '6'; f.run();
  assert.match(f.text('get'), /友だちが 6 人参加すると、Wingバッジを獲得できます！/);
  assert.equal(f.text('name'), 'Share your invite link with friends.');
  assert.equal(f.text('post'), 'Share your invite link with friends.');
  f.dom.window.close();
});

test('ja: native composer prompt omits the name while preserving the draft', () => {
  const f = fixture('ja', `<textarea id="public-tweet-input" placeholder="What's happening, Home 🫍?">Keep my draft</textarea>
    <textarea id="public-modal-tweet-input" placeholder="Home 🫍、いまどうしてる？">Modal draft</textarea>
    <textarea id="other" placeholder="What's happening, Home 🫍?">Another draft</textarea>`);
  f.run();
  assert.equal(f.document.getElementById('public-tweet-input').placeholder, 'いまどうしてる？');
  assert.equal(f.document.getElementById('public-tweet-input').value, 'Keep my draft');
  assert.equal(f.document.getElementById('public-modal-tweet-input').placeholder, 'いまどうしてる？');
  assert.equal(f.document.getElementById('public-modal-tweet-input').value, 'Modal draft');
  assert.equal(f.document.getElementById('other').placeholder, "What's happening, Home 🫍?");
  assert.equal(f.document.getElementById('other').value, 'Another draft');
  f.dom.window.close();
});

test('ja: visible native route title translates when React keeps the previous feed hidden', () => {
  const f = fixture('ja', `<main><div style="display: none"><h2>Home</h2></div>
    <div><h2 class="truncate" id="title">Notifications</h2></div>
    <article><h2 class="truncate" id="name">Notifications</h2></article></main>`, '/notifications');
  f.run();
  assert.equal(f.text('title'), '通知');
  assert.equal(f.text('name'), 'Notifications');
  f.dom.window.close();
});

test('ja: native notification timestamps and spinner labels localize in their exact contexts', () => {
  const f = fixture('ja', `<main><button class="items-start border-b"><p><span class="font-extrabold" id="name">Just now</span>
    <span>followed you</span><span class="text-tl-app-text-soft" id="stamp"></span></p><p class="line-clamp-2" id="preview">3h</p></button>
    <span class="text-tl-app-text-soft" id="unscoped">3h</span>
    <div class="flex items-center justify-center"><svg class="animate-spin"></svg><span class="text-xs font-semibold" id="loading">Loading account...</span></div>
    <span class="text-xs font-semibold" id="plain">Loading account...</span>
  </main>`, '/notifications');
  f.document.getElementById('stamp').append(f.document.createTextNode('· '), f.document.createTextNode('3h'));
  f.run();
  assert.equal(f.text('name'), 'Just now');
  assert.equal(f.text('stamp'), '· 3時間前');
  assert.equal(f.text('preview'), '3h');
  assert.equal(f.text('unscoped'), '3h');
  assert.equal(f.text('loading'), 'アカウント情報を読み込み中…');
  assert.equal(f.text('plain'), 'Loading account...');
  const before = f.document.body.innerHTML;
  f.run(); assert.equal(f.document.body.innerHTML, before);
  f.dom.window.close();
});


test('ja: native translation errors and footer controls translate without changing post content', () => {
  const f = fixture('ja', `<aside><button id="terms">Terms</button><button id="rules">Rules</button><button id="about">About</button></aside>
    <article><p role="alert" id="error">Couldn’t translate. Try again.</p>
      <p class="whitespace-pre-wrap" id="post">Couldn’t translate. Try again.</p>
      <p class="whitespace-pre-wrap"><span role="alert" id="nested-post">Terms</span></p>
    </article>`);
  f.run();
  assert.equal(f.text('terms'), '利用規約');
  assert.equal(f.text('rules'), 'ルール');
  assert.equal(f.text('about'), 'サービスについて');
  assert.equal(f.text('error'), '翻訳できませんでした。もう一度お試しください。');
  assert.equal(f.text('post'), 'Couldn’t translate. Try again.');
  assert.equal(f.text('nested-post'), 'Terms');
  f.dom.window.close();
});


for (const language of ['ja', 'en']) {
  test(`${language}: classic markers retain native UI localization and user content exclusions`, () => {
    const f=fixture(language, `<div class="ct-classic-shell"><nav class="ct-classic-nav"><button id="classic-nav">Posts</button></nav><main class="ct-classic-timeline"><article class="ct-classic-tweet"><p class="whitespace-pre-wrap break-words" id="classic-body">Posts</p><button class="font-bold truncate" id="classic-name">Like</button></article><textarea id="public-tweet-input" placeholder="What's happening, Alice?">My draft</textarea></main><div class="ct-local-row"><button id="classic-owned">Posts</button></div></div>`);
    f.document.documentElement.className='ct-classic-motion-enabled';
    f.run();
    assert.equal(f.text('classic-nav'),language==='ja'?'ツイート':'Tweets');
    assert.equal(f.text('classic-body'),'Posts');
    assert.equal(f.text('classic-name'),'Like');
    assert.equal(f.text('classic-owned'),'Posts');
    const draft=f.document.getElementById('public-tweet-input');
    assert.equal(draft.value,'My draft');
    assert.equal(draft.placeholder,language==='ja'?'いまどうしてる？':"What's happening, Alice?");
    f.dom.window.close();
  });
}

for (const language of ['ja', 'en']) test(`${language}: v2.1 native poll choices, results, and user text remain byte-for-byte intact`, () => {
  const f = fixture(language, `<article>
    <p class="tl-user-text" id="body211">Home</p>
    <div class="mt-3" id="voting"><fieldset class="flex flex-col gap-1.5"><legend class="sr-only" id="choices">Poll choices</legend>
      <label><input type="radio" name="poll" value="native-one"><span class="tl-user-text min-w-0 break-words" id="choice1">Home</span></label>
      <label><input type="radio" name="poll" value="native-two"><span class="tl-user-text min-w-0 break-words" id="choice2">Reply</span></label>
      </fieldset><div class="mt-2 flex items-center justify-between gap-2"><span class="text-[0.8125rem] text-tl-app-text-muted" id="deadline">3 h left</span>
      <button type="button" aria-busy="false" id="vote">Vote</button></div><p role="status" class="sr-only" id="vote-status">Vote recorded.</p>
    </div>
    <div class="mt-3" id="results"><div class="flex flex-col gap-1.5 outline-none" tabindex="-1">
      <ul class="flex flex-col gap-1.5" aria-label="Poll results" id="results-list">
       <li class="relative overflow-hidden rounded-lg border"><div class="relative flex items-center justify-between">
        <span class="flex min-w-0 items-center"><span class="tl-user-text min-w-0 break-words" id="result1">Posts</span><svg></svg><span class="sr-only" id="your-vote">(your vote)</span></span><span class="tabular-nums text-tl-app-text-muted">50%</span></div></li>
       <li class="relative overflow-hidden rounded-lg border"><div><span><span class="tl-user-text" id="result2">Follow back</span></span><span>50%</span></div></li>
      </ul><p class="text-[0.8125rem] text-tl-app-text-muted" id="total">2 votes · Final results</p></div><p role="status" class="sr-only"></p></div>
    <button class="tl-user-text" id="fake-user-button">Like</button>
    <label id="other-label">Vote</label><span class="text-tl-app-text-muted" id="fake-deadline">3 h left</span>
  </article>`);
  const vote = f.document.getElementById('vote');
  const radio = f.document.querySelector('input');
  let voteCalls = 0;
  vote.addEventListener('click', () => voteCalls++);
  radio.checked = true;
  f.run();
  for (const [id, expected] of Object.entries({ body211: 'Home', choice1: 'Home', choice2: 'Reply', result1: 'Posts', result2: 'Follow back', 'fake-user-button': 'Like', 'other-label': 'Vote', 'fake-deadline': '3 h left' })) assert.equal(f.text(id), expected, id);
  assert.equal(f.text('choices'), language === 'ja' ? '投票の選択肢' : 'Poll choices');
  assert.equal(f.text('deadline'), language === 'ja' ? '残り3時間' : '3 h left');
  assert.equal(f.text('vote'), language === 'ja' ? '投票する' : 'Vote');
  assert.equal(f.text('vote-status'), language === 'ja' ? '投票を記録しました。' : 'Vote recorded.');
  assert.equal(f.text('your-vote'), language === 'ja' ? '（あなたの投票）' : '(your vote)');
  assert.equal(f.text('total'), language === 'ja' ? '2票 · 最終結果' : '2 votes · Final results');
  assert.equal(f.document.getElementById('results-list').getAttribute('aria-label'), language === 'ja' ? '投票結果' : 'Poll results');
  assert.equal(radio.value, 'native-one'); assert.equal(radio.checked, true);
  assert.equal(vote, f.document.getElementById('vote'));
  vote.click(); assert.equal(voteCalls, 1, 'native vote listener is preserved');
  assert.equal(vote.getAttribute('aria-busy'), 'false');
  const once = f.document.body.innerHTML; f.run(); assert.equal(f.document.body.innerHTML, once);
  f.document.getElementById('deadline').firstChild.nodeValue = '1 min left';
  f.run(f.document.getElementById('deadline').firstChild);
  assert.equal(f.text('deadline'), language === 'ja' ? '残り1分' : '1 min left');
  f.dom.window.close();
});

function nativePollComposer211() {
  return `<fieldset class="relative w-full mt-3 rounded-2xl border p-3 flex flex-col gap-2" id="poll-compose"><legend class="px-1 text-xs font-bold" id="poll-legend">Poll</legend>
    <button aria-label="Remove poll" id="remove-poll"><svg></svg></button>
    <div><div><label for="native-choice-0" class="sr-only" id="input-label">Choice <!-- -->1</label><input type="text" id="native-choice-0" maxlength="25" placeholder="Choice 1" value="Home"></div><span id="characters">4/25</span><button aria-label="Remove choice 1" id="remove-choice"><svg></svg></button></div>
    <div><div><label for="native-choice-1" class="sr-only">Choice 2</label><input type="text" id="native-choice-1" maxlength="25" placeholder="Choice 2" value="Reply"></div></div>
    <div><button id="add-choice">Add choice</button><label class="flex items-center gap-2 text-xs text-tl-app-text-muted" id="length-label">Poll length<select id="duration"><option value="1">1 hour</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option></select></label></div>
    <p role="status" id="poll-error">Poll choices must be different from each other.</p></fieldset>`;
}

for (const language of ['ja', 'en']) test(`${language}: native poll composer keeps typed choices, duration values, and React nodes`, () => {
  const f = fixture(language, `<main>${nativePollComposer211()}<label id="plain">Poll length<select id="unrelated"><option value="Home">Home</option></select></label></main>`);
  const input = f.document.getElementById('native-choice-0');
  const duration = f.document.getElementById('duration');
  const options = [...duration.options];
  const inputLabel = f.document.getElementById('input-label');
  const countNode = inputLabel.lastChild;
  duration.value = '72'; input.value = 'Like';
  let changes = 0; duration.addEventListener('change', () => changes++);
  f.run();
  assert.equal(input.value, 'Like'); assert.equal(f.document.getElementById('native-choice-1').value, 'Reply');
  assert.equal(input.getAttribute('placeholder'), language === 'ja' ? '選択肢 1' : 'Choice 1');
  assert.equal(f.text('poll-legend'), language === 'ja' ? '投票' : 'Poll');
  assert.equal(f.text('input-label'), language === 'ja' ? '選択肢 1' : 'Choice 1');
  assert.equal(inputLabel.lastChild, countNode, 'React choice counter remains attached');
  assert.equal(f.document.getElementById('remove-choice').getAttribute('aria-label'), language === 'ja' ? '選択肢 1を削除' : 'Remove choice 1');
  assert.equal(f.document.getElementById('remove-poll').getAttribute('aria-label'), language === 'ja' ? '投票を削除' : 'Remove poll');
  assert.equal(f.text('add-choice'), language === 'ja' ? '選択肢を追加' : 'Add choice');
  assert.equal(f.text('poll-error'), language === 'ja' ? '選択肢にはそれぞれ異なる内容を入力してください。' : 'Poll choices must be different from each other.');
  assert.deepEqual([...duration.options].map(option => option.value), ['1', '24', '72', '168']);
  assert.deepEqual([...duration.options], options);
  assert.deepEqual([...duration.options].map(option => option.textContent), language === 'ja' ? ['1時間', '1日', '3日', '7日'] : ['1 hour', '1 day', '3 days', '7 days']);
  assert.equal(duration.value, '72'); assert.equal(changes, 0, 'localization never changes native state');
  assert.equal(f.document.getElementById('unrelated').firstChild.textContent, 'Home');
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: v2.1 wrapped native reply notifications translate action but preserve actors and preview`, () => {
  const f = fixture(language, `<main><div class="border-b border-tl-app-border"><button class="w-full flex items-start gap-3 px-4 py-3.5 text-left">
    <div class="mt-0.5 shrink-0"><svg width="28" height="28"></svg></div><div class="flex-1 min-w-0">
    <div><img alt="Home"></div><p class="text-tl-app-text"><span class="font-extrabold" id="actor211">Home</span> <span class="text-tl-app-text-muted" id="reply211">replied to your post</span></p>
    <p class="line-clamp-2" id="reply-preview211">Home</p></div></button></div>
    <div class="border-b border-tl-app-border"><button class="w-full flex items-start text-left"><div class="mt-0.5 shrink-0"><svg width="16" height="16"></svg></div><div class="flex-1 min-w-0"><p id="fake211">replied to your post</p></div></button></div></main>`, '/notifications');
  f.run(); assert.equal(f.text('actor211'), 'Home'); assert.equal(f.text('reply-preview211'), 'Home');
  assert.equal(f.text('reply211'), language === 'ja' ? 'さんがあなたのツイートに返信しました' : 'replied to your Tweet');
  assert.equal(f.text('fake211'), 'replied to your post');
  const once = f.document.body.innerHTML; f.run(); assert.equal(f.document.body.innerHTML, once);
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: native account report menu localizes actions while preserving split handles`, () => {
  const f = fixture(language, `<main><div class="relative"><button aria-label="Profile options" aria-haspopup="menu"><svg></svg></button><div role="menu">
    <button role="menuitem"><svg></svg><span class="min-w-0 truncate" title="Report @Home" id="report211">Report<!-- --> @<!-- -->Home</span></button>
    <button role="menuitem"><svg></svg><span class="min-w-0 truncate" title="Mute @Reply" id="mute211">Mute @Reply</span></button></div></div>
    <div role="dialog" aria-modal="true" aria-label="Report @Home" class="bg-tl-app-card border" id="report-dialog211"><h3 class="text-sm font-bold text-tl-app-text" id="report-heading211">Why are you reporting this account?</h3><p class="text-xs text-tl-app-text-muted" id="report-help211">Your report is private. We use it to review and improve safety.</p><label>Additional details (optional)<textarea id="report-draft211" placeholder="Add context that helps our review team.">Home</textarea></label><button>Submit report</button></div>
    <span class="truncate" title="Report @Home" id="username211">Home</span></main>`, '/user/Home');
  const label = f.document.getElementById('report211'); const handleNode = label.lastChild;
  f.run();
  assert.equal(f.text('report211'), language === 'ja' ? '報告する @Home' : 'Report @Home');
  assert.equal(label.lastChild, handleNode); assert.equal(handleNode.nodeValue, 'Home');
  assert.equal(f.text('mute211'), language === 'ja' ? '@Replyをミュート' : 'Mute @Reply');
  assert.equal(label.getAttribute('title'), language === 'ja' ? '@Homeを報告' : 'Report @Home');
  assert.equal(f.document.getElementById('report-dialog211').getAttribute('aria-label'), language === 'ja' ? '@Homeを報告' : 'Report @Home');
  assert.equal(f.text('report-heading211'), language === 'ja' ? 'このアカウントを報告する理由は何ですか？' : 'Why are you reporting this account?');
  assert.equal(f.document.getElementById('report-draft211').value, 'Home');
  assert.equal(f.text('username211'), 'Home');
  const once = f.document.body.innerHTML; f.run(); assert.equal(f.document.body.innerHTML, once);
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: native Follow back and updated notification empty state preserve user cards`, () => {
  const f = fixture(language, `<main><div><div><button class="font-bold truncate" id="followback-name">Follow back</button><p class="truncate">@Home</p></div><span><button id="followback">Follow back</button></span></div>
    <div class="flex flex-col items-center text-center"><p class="text-tl-app-text-muted" id="empty211">Nothing to see here yet. Likes, reposts, replies, quotes, mentions, and follows will show up here.</p></div></main>`, '/notifications');
  f.run(); assert.equal(f.text('followback-name'), 'Follow back');
  assert.equal(f.text('followback'), language === 'ja' ? 'フォローバック' : 'Follow back');
  assert.equal(f.text('empty211'), language === 'ja' ? '通知はまだありません。お気に入り、リツイート、返信、引用、@ツイート、フォローの通知がここに表示されます。' : 'Nothing to see here yet. Favorites, Retweets, replies, quotes, mentions, and follows will show up here.');
  f.dom.window.close();
});

for (const language of ['ja', 'en']) {
  test(`${language}: classic toggle restores native labels and keeps localization, content and React nodes`, () => {
    const f = fixture(language, `<nav><button id="toggle-posts">Posts</button></nav>
      <article><button id="toggle-like" aria-label="Like" title="Like">Like</button>
      <p class="tl-user-text" id="toggle-body">Like Favorite お気に入り</p></article>
      <div role="status" id="toggle-toast">Post liked</div>
      <input id="toggle-input" placeholder="Post your reply" value="Favorite お気に入り">
      <main><button class="items-start border-b" data-testid="notification-row">
        <div><svg><path d="M0 0"></path></svg></div><div><p><span class="font-extrabold" id="toggle-actor">Like</span> <span id="toggle-action">liked your post</span></p>
        <p class="line-clamp-2" id="toggle-preview">Favorite</p></div></button></main>`, '/notifications');
    const like = f.document.getElementById('toggle-like');
    const text = like.firstChild;
    let clicks = 0;
    like.addEventListener('click', () => clicks++);
    f.run();
    const on = language === 'ja' ? 'お気に入り' : 'Favorite';
    const off = language === 'ja' ? 'いいね' : 'Like';
    assert.equal(text.nodeValue, on);
    assert.equal(like.title, on);
    assert.equal(f.document.getElementById('toggle-input').placeholder, language === 'ja' ? '返信をツイート' : 'Tweet your reply');
    assert.ok(f.document.querySelector('.ct-notification-fav-icon'));
    f.dom.window.qaClassic = false;
    f.qa.ctSyncLocalizationAppearance();
    f.run();
    assert.equal(like.firstChild, text);
    assert.equal(text.nodeValue, off);
    assert.equal(like.title, off);
    assert.equal(like.getAttribute('aria-label'), off);
    assert.equal(f.text('toggle-posts'), language === 'ja' ? 'ツイート' : 'Posts');
    assert.equal(f.text('toggle-toast'), language === 'ja' ? 'いいねしました' : 'Post liked');
    assert.equal(f.text('toggle-action'), language === 'ja' ? 'さんがあなたのツイートにいいねしました' : 'liked your post');
    assert.equal(f.document.getElementById('toggle-input').placeholder, language === 'ja' ? '返信をツイート' : 'Post your reply');
    assert.equal(f.document.querySelector('.ct-notification-fav-icon'), null);
    f.dom.window.qaClassic = true;
    f.qa.ctSyncLocalizationAppearance();
    f.run();
    assert.equal(text.nodeValue, on);
    assert.equal(like.title, on);
    assert.equal(f.text('toggle-action'), language === 'ja' ? 'さんがあなたのツイートをお気に入りに登録しました' : 'favorited your Tweet');
    assert.ok(f.document.querySelector('.ct-notification-fav-icon'));
    like.click();
    assert.equal(clicks, 1);
    assert.equal(f.text('toggle-body'), 'Like Favorite お気に入り');
    assert.equal(f.text('toggle-actor'), 'Like');
    assert.equal(f.text('toggle-preview'), 'Favorite');
    assert.equal(f.document.getElementById('toggle-input').value, 'Favorite お気に入り');
    f.dom.window.close();
  });

  test(`${language}: saved classic OFF never applies classic wording and later ON still works`, () => {
    const f = fixture(language, `<nav><button id="saved-posts">Posts</button></nav>
      <article><button id="saved-like" aria-label="Like">Like</button></article>
      <div role="status" id="saved-toast">Like removed</div>
      <input id="saved-reply" placeholder="Post your reply" value="My draft">`);
    f.dom.window.qaClassic = false;
    f.run();
    assert.equal(f.text('saved-like'), language === 'ja' ? 'いいね' : 'Like');
    assert.equal(f.text('saved-posts'), language === 'ja' ? 'ツイート' : 'Posts');
    assert.equal(f.text('saved-toast'), language === 'ja' ? 'いいねを取り消しました' : 'Like removed');
    assert.equal(f.document.getElementById('saved-reply').placeholder, language === 'ja' ? '返信をツイート' : 'Post your reply');
    f.dom.window.qaClassic = true;
    f.run();
    assert.equal(f.text('saved-like'), language === 'ja' ? 'お気に入り' : 'Favorite');
    assert.equal(f.text('saved-posts'), language === 'ja' ? 'ツイート' : 'Tweets');
    assert.equal(f.document.getElementById('saved-reply').value, 'My draft');
    f.dom.window.close();
  });

  test(`${language}: restoring classic wording respects native rerenders and forgets detached nodes`, () => {
    const f = fixture(language, `<nav><button id="changed" aria-label="Like">Like</button><button id="detached">Posts</button></nav>
      <input id="changed-input" placeholder="Post your reply" value="unchanged draft">`);
    f.run();
    const changed = f.document.getElementById('changed');
    changed.firstChild.nodeValue = 'Post';
    changed.setAttribute('aria-label', 'Report post');
    f.document.getElementById('changed-input').placeholder = 'Search';
    f.document.getElementById('detached').remove();
    f.dom.window.qaClassic = false;
    f.qa.ctSyncLocalizationAppearance();
    assert.equal(changed.textContent, 'Post');
    assert.equal(changed.getAttribute('aria-label'), 'Report post');
    assert.equal(f.document.getElementById('changed-input').placeholder, 'Search');
    assert.equal([...f.qa.ctLocalizationState().records].some(record => !record.node.isConnected), false);
    f.run();
    assert.equal(changed.textContent, language === 'ja' ? 'ツイート' : 'Post');
    assert.equal(f.document.getElementById('changed-input').value, 'unchanged draft');
    f.dom.window.qaClassic = true;
    f.run();
    assert.equal(changed.textContent, language === 'ja' ? 'ツイート' : 'Tweet');
    assert.equal(changed.getAttribute('aria-label'), language === 'ja' ? 'ツイートを報告' : 'Report Tweet');
    f.dom.window.close();
  });
}

test('en: truncated native settings navigation restores wording while truncated profile names remain intact', () => {
  const f = fixture('en', `<main><nav><button><svg></svg><span class="truncate" id="truncated-nav">Feed</span></button></nav>
    <div><button><img src="avatar.png"><span class="truncate" id="truncated-name">Feed</span></button></div>
    <h2 class="truncate" id="truncated-route">Settings</h2></main>`, '/settings');
  const nav = f.document.getElementById('truncated-nav');
  const node = nav.firstChild;
  f.run();
  assert.equal(nav.textContent, 'Home');
  // A second scan must retain ownership of the translated label.
  f.run();
  f.dom.window.qaClassic = false;
  f.qa.ctSyncLocalizationAppearance();
  assert.equal(nav.textContent, 'Feed');
  assert.equal(nav.firstChild, node);
  assert.equal(f.text('truncated-name'), 'Feed');
  f.run();
  f.dom.window.qaClassic = true;
  f.run();
  assert.equal(nav.textContent, 'Home');
  assert.equal(f.text('truncated-name'), 'Feed');
  assert.equal(f.text('truncated-route'), 'Settings');
  f.dom.window.close();
});
