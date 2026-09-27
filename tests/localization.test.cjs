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
    'localizationNotificationRow', 'localizationNotificationAction', 'isLocalizationUI',
    'replaceLocalizationText', 'patchUIAttributes', 'translateTextNode', 'patchUI', 'patchInputs',
    'patchNotifications', 'patchRetweetRows'
  ];
  const japanese = [
    'isNativeSettingsValue', 'isNativeLocalizationHelp', 'isNativeNotificationTimestamp',
    'notificationTextNodes', 'patchNotificationGrammar', 'patchNotificationConnectors',
    'patchNotificationParticles', 'patchNotificationFollowGrammar', 'patchReplyingTo',
    'patchComposeJapanese', 'patchProfileJoinedDate', 'patchInviteJoinedLabels'
  ];
  const names = [...common, ...(language === 'ja' ? japanese : [])];
  dom.window.eval(`
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
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
  assert.equal(f.text('joined'), '登録日: September 2026');
  f.dom.window.close();
  const g = fixture('ja', '<main><dl><div><dt id="label">Joined</dt><dd id="value">Home</dd></div></dl></main>', '/settings');
  g.run();
  assert.equal(g.text('label'), '参加した人数');
  assert.equal(g.text('value'), 'Home');
  g.dom.window.close();
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
