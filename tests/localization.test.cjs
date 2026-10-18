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
  // Test editable locale sources directly, including their shared date parser,
  // so regressions cannot be hidden by a stale generated userscript.
  const localeSource = fs.readFileSync(path.join(__dirname, `../src/${language}.js`), 'utf8');
  const source = localeSource.replace('/* @include timestamps */',
    fs.readFileSync(path.join(__dirname, '../src/timestamps.js'), 'utf8')).replace('/* @include navigation */',
    fs.readFileSync(path.join(__dirname, '../src/navigation.js'), 'utf8'));
  const map = language === 'ja' ? 'JP' : 'EN';
  const start = source.indexOf(`  const ${map} = new Map([`);
  const end = source.indexOf('\n  ]);', start) + '\n  ]);'.length;
  const common = [
    'ctTimestampParse', 'ctIsNativeNotificationRow',
    'localizationScopeNodes', 'isOwnedLocalizationElement', 'isNativeSettingsNavigation',
    'isNativeLocalizationTimestamp', 'isProtectedLocalizationElement',
    'nativeLocalizationPoll', 'isNativeLocalizationPollUI',
    'nativeLocalizationAccountMenu', 'nativeLocalizationAccountDialog',
    'nativeLocalizationBlockDialog', 'nativeLocalizationBlockProfile',
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
    'nativeLocalizationSessionContext', 'nativeSessionJapaneseText', 'nativeLocalizationPinContext', 'nativePinJapaneseText',
    'nativeLocalizationMediaUpload', 'nativeMediaUploadJapaneseText', 'nativeLocalizationGIFMedia',
    'nativeLocalizationBlockMenu', 'nativeBlockJapaneseText', 'isNativeBlockedAccountError',
    'nativeLocalizationGameContext', 'nativeGameJapaneseText', 'patchNativeGamesUI',
    'nativeLocalization26Context', 'native26JapaneseText', 'patchNative26UI',
    'isNativeTweetCount', 'patchNativePollAndAccountUI', 'nativePollJapaneseText',
    'notificationTextNodes', 'patchNotificationGrammar', 'patchNotificationConnectors',
    'patchNotificationParticles', 'patchNotificationFollowGrammar', 'patchReplyingTo',
    'patchComposeJapanese', 'patchProfileJoinedDate', 'patchInviteJoinedLabels'
  ];
  const names = [...common, ...(language === 'ja' ? japanese : [])];
  dom.window.eval(`
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const ctFavoritePresentationEnabled = () => window.qaClassic !== false;
    ${source.match(/^  const ctNativeNotificationRowSelector = .*;$/m)?.[0] || ''}
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
  assert.equal(f.text('title'), 'プロフィール');
  f.dom.window.close();
});

test('ja: public profile Feed title survives native redraw without translating a matching name or bio', () => {
  const f = fixture('ja', `<main><div class="sticky"><button>Back</button><h2 class="truncate" id="title">Feed</h2></div>
    <h2 class="font-bold truncate" id="name">Feed</h2><p data-testid="profile-bio" id="bio">Feed</p>
    <article><p class="tl-user-text" id="body">Feed</p></article></main>`, '/user/alice');
  f.run();
  assert.equal(f.text('title'), 'プロフィール');
  for (const id of ['name', 'bio', 'body']) assert.equal(f.text(id), 'Feed');
  f.document.getElementById('title').firstChild.nodeValue = 'Feed';
  f.run();
  assert.equal(f.text('title'), 'プロフィール');
  for (const id of ['name', 'bio', 'body']) assert.equal(f.text(id), 'Feed');
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

test('ja: impossible or timezone-ambiguous creation and edit metadata never authorize localization', () => {
  const f = fixture('ja', `<article><div class="flex items-center"><button class="font-bold truncate">alice</button>
    <span class="text-tl-app-text-muted hover:underline" title="2026-02-29T00:00:00Z" id="invalid-day">3h</span>
    <span class="text-tl-app-text-muted hover:underline" title="2026-10-02T09:00:00" id="no-zone">3h</span>
    <span>·</span><span class="text-tl-app-text-muted" title="2026-04-31T00:00:00Z" id="edited">Edited</span>
    <span class="text-tl-app-text-muted hover:underline" title="2024-02-29T00:00:00.123456Z" id="valid-leap">3h</span>
    </div><p class="tl-user-text">Edited 3h</p></article>`);
  f.run();
  assert.equal(f.text('invalid-day'), '3h');
  assert.equal(f.text('no-zone'), '3h');
  assert.equal(f.text('edited'), 'Edited');
  assert.equal(f.text('valid-leap'), '3時間前');
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

test('ja: Tweet 2.2.3 photo controls localize without replacing native handlers or captions', () => {
  const f = fixture('ja', `<article><p class="whitespace-pre-wrap" id="caption">Open image 1 of 2</p>
    <div class="relative overflow-hidden rounded-2xl border bg-black"><div class="snap-x snap-mandatory overflow-x-auto">
    <button id="open-one" class="w-full min-w-full shrink-0 snap-start" aria-label="Open image 1 of 2"><img class="h-full w-full object-cover" alt="My original caption"></button>
    <button id="open-two" class="w-full min-w-full shrink-0 snap-start" aria-label="Open image 2 of 2"><img class="h-full w-full object-cover"></button></div>
    <button id="gallery-next" aria-label="Next image"><svg class="lucide-chevron-right"></svg></button>
    <div id="dots" aria-label="Choose image"><button id="dot-one" aria-current="true" aria-label="Show image 1 of 2"></button><button aria-current="false" aria-label="Show image 2 of 2"></button></div></div></article>
    <div class="fixed inset-0 flex flex-col ct-media-photo-dialog" role="dialog" aria-modal="true" aria-label="Media viewer" id="viewer"><div>
    <button id="viewer-close" aria-label="Close media viewer"><svg class="lucide-x"></svg></button></div><div class="flex-1 min-h-0">
    <button aria-label="Previous image" id="viewer-prev"><svg class="lucide-chevron-left"></svg></button><img class="object-contain" draggable="false"><button aria-label="Next image" id="viewer-next"><svg class="lucide-chevron-right"></svg></button></div></div>
    <button aria-label="Open image 1 of 2" id="unrelated"><img></button>`);
  const photo = f.document.getElementById('open-one'); const image = photo.firstElementChild;
  let opens = 0; photo.addEventListener('click', () => opens++);
  f.run(); f.run();
  assert.equal(photo.getAttribute('aria-label'), '2枚中1枚目の画像を開く');
  assert.equal(f.document.getElementById('open-two').getAttribute('aria-label'), '2枚中2枚目の画像を開く');
  assert.equal(f.document.getElementById('dot-one').getAttribute('aria-label'), '2枚中1枚目の画像を表示');
  assert.equal(f.document.getElementById('dots').getAttribute('aria-label'), '画像を選択');
  assert.equal(f.document.getElementById('gallery-next').getAttribute('aria-label'), '次の画像');
  assert.equal(f.document.getElementById('viewer').getAttribute('aria-label'), '写真・動画ビューア');
  assert.equal(f.document.getElementById('viewer-close').getAttribute('aria-label'), '写真・動画を閉じる');
  assert.equal(f.document.getElementById('viewer-prev').getAttribute('aria-label'), '前の画像');
  assert.equal(f.document.getElementById('viewer-next').getAttribute('aria-label'), '次の画像');
  assert.equal(f.text('caption'), 'Open image 1 of 2');
  assert.equal(f.document.getElementById('unrelated').getAttribute('aria-label'), 'Open image 1 of 2');
  assert.equal(photo.firstElementChild, image); assert.equal(image.alt, 'My original caption');
  photo.click(); assert.equal(opens, 1);
  photo.setAttribute('aria-label', 'Open image 2 of 2'); f.run(photo);
  assert.equal(photo.getAttribute('aria-label'), 'Open image 2 of 2');
  f.dom.window.close();
});

test('ja: native upload errors explain limits and retain the exact filename suffix', () => {
  const error = text => `<div class="p-3 border text-red-500 flex items-center gap-2 bg-red-500/10 border-red-500/15"><svg class="lucide-circle-alert"></svg><span id="upload-error">${text}</span></div>`;
  const f = fixture('ja', `<div><textarea id="public-tweet-input">draft</textarea><div class="w-full mt-3 space-y-3"><input type="file" accept="image/*" multiple><input type="file" accept="video/mp4,video/quicktime">${error('Maximum of 5 images allowed per post.')}</div></div><article><p class="whitespace-pre-wrap" id="body">Maximum of 5 images allowed per post.</p></article>`);
  f.run(); assert.equal(f.text('upload-error'),'写真は1ツイートに5枚まで追加できます。');
  assert.equal(f.text('body'),'Maximum of 5 images allowed per post.');
  const node = f.document.getElementById('upload-error').firstChild;
  node.nodeValue = '2 images were not added. My  Summer.png: Upload failed';
  f.run(node.parentElement); assert.equal(node.nodeValue,'2枚の写真を追加できませんでした。 My  Summer.png: Upload failed');
  node.nodeValue = 'Images must be 10 MB or smaller.'; f.run(node.parentElement);
  assert.equal(node.nodeValue,'写真は1枚10MB以下にしてください。');
  f.document.querySelector('input[accept="image/*"]').removeAttribute('multiple');
  node.nodeValue = 'Maximum of 5 images allowed per post.'; f.run(node.parentElement);
  assert.equal(node.nodeValue,'Maximum of 5 images allowed per post.');
  assert.equal(f.document.querySelector('textarea').value,'draft'); f.dom.window.close();
});

function nativeUpload230({ compact = false, error = '', extra = '' } = {}) {
  return `<form role="form"><textarea id="public-tweet-input">GIFs must be 15 MB or smaller.</textarea>
    <div class="w-full space-y-3 ${compact ? 'mt-2' : 'mt-3'}">
    <div class="p-3 bg-red-500/10 border border-red-500/15 text-red-500 rounded-xl flex items-center gap-2"><svg class="lucide-circle-alert"></svg><span id="latest-error">${error}</span></div>${extra}
    <div class="flex items-center"><button type="button" id="add-gif" aria-label="Add photo or GIF"><svg></svg><span>Add Photo</span></button>
    <button type="button" id="add-video" aria-label="Add video"><svg></svg><span>Add Video</span></button>
    <input id="latest-images" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif">
    <input id="latest-video" type="file" accept="video/mp4,video/quicktime"></div></div></form>`;
}

for (const compact of [false, true]) test(`ja: Tweet 2.3.0 ${compact ? 'compact reply' : 'composer'} GIF upload limits use native inputs and preserve filenames`, () => {
  const f = fixture('ja', `<main>${nativeUpload230({ compact, error: 'GIFs must be 15 MB or smaller.' })}</main>
    <article><p class="whitespace-pre-wrap" id="gif-body">GIFs must be 15 MB or smaller.</p></article>`);
  const imageInput = f.document.getElementById('latest-images');
  const videoInput = f.document.getElementById('latest-video');
  const error = f.document.getElementById('latest-error');
  const node = error.firstChild;
  const add = f.document.getElementById('add-gif');
  let adds = 0; add.addEventListener('click', () => adds++);
  f.run();
  assert.equal(node.nodeValue, 'GIFは15MB以下にしてください。');
  assert.equal(add.getAttribute('aria-label'), '写真・GIFを追加');
  assert.equal(add.textContent, '写真を追加');
  assert.equal(f.document.getElementById('add-video').getAttribute('aria-label'), '動画を追加');
  for (const [native, japanese] of [
    ['GIFs cannot be combined with other media assets.', 'GIFと他の写真・動画は同時に投稿できません。'],
    ['Videos cannot be combined with other media assets.', '動画と他の写真・動画は同時に投稿できません。'],
    ['Cannot mix images and videos in the same post.', '写真と動画は同時に投稿できません。'],
    ['Videos must be 50 MB or smaller.', '動画は50MB以下にしてください。'],
    ['Videos must be 30 seconds or shorter.', '動画は30秒以内にしてください。'],
    ['Unsupported file type. Please select an image, GIF, or video.', '対応していないファイル形式です。写真、GIF、動画を選択してください。']
  ]) {
    node.nodeValue = native; f.run(error); assert.equal(node.nodeValue, japanese);
  }
  node.nodeValue = '1 image was not added. My  GIFs must be 15 MB or smaller..gif: GIFs cannot be combined with other media assets.';
  f.run(error);
  assert.equal(node.nodeValue, '1枚の写真を追加できませんでした。 My  GIFs must be 15 MB or smaller..gif: GIFs cannot be combined with other media assets.');
  assert.equal(error.firstChild, node);
  assert.equal(f.document.getElementById('latest-images'), imageInput);
  assert.equal(imageInput.accept, 'image/jpeg,image/png,image/webp,image/gif');
  assert.equal(imageInput.multiple, true);
  assert.equal(f.document.getElementById('latest-video'), videoInput);
  assert.equal(videoInput.accept, 'video/mp4,video/quicktime');
  assert.equal(f.document.getElementById('public-tweet-input').value, 'GIFs must be 15 MB or smaller.');
  assert.equal(f.text('gif-body'), 'GIFs must be 15 MB or smaller.');
  add.click(); assert.equal(adds, 1);
  imageInput.removeAttribute('multiple');
  node.nodeValue = 'GIFs must be 15 MB or smaller.'; f.run(error);
  assert.equal(node.nodeValue, 'GIFs must be 15 MB or smaller.', 'lookalike uploader without native multiple input is protected');
  f.dom.window.close();
});

test('ja: Tweet 2.3.0 GIF staging progress keeps React counters and native removal handler', () => {
  const extra = `<div class="relative aspect-video"><div class="absolute inset-0 flex flex-col items-center justify-center">
    <svg class="animate-pulse"></svg><div id="upload-progress" class="text-white font-mono font-bold">Uploading… <!-- -->42<!-- -->%</div></div>
    <div class="absolute inset-0 flex flex-col items-center justify-center"><svg class="animate-spin"></svg>
    <div class="text-white font-mono font-bold" id="processing">Processing…</div><div class="font-sans" id="gif-prepare">Preparing GIF loop…</div></div>
    <button type="button" id="gif-remove" title="Remove GIF"><svg></svg></button><div class="absolute bottom-2 left-2"><svg></svg><span id="ready">Ready</span></div></div>`;
  const f = fixture('ja', nativeUpload230({ extra }));
  const progress = f.document.getElementById('upload-progress');
  const label = progress.firstChild; const count = progress.childNodes[2];
  const remove = f.document.getElementById('gif-remove');
  let removals = 0; remove.addEventListener('click', () => removals++);
  f.run();
  assert.equal(label.nodeValue, 'アップロード中… ');
  assert.equal(progress.childNodes[2], count); assert.equal(count.nodeValue, '42');
  count.nodeValue = '73'; f.run(progress); assert.equal(progress.textContent, 'アップロード中… 73%');
  assert.equal(f.text('processing'), '処理中…');
  assert.equal(f.text('gif-prepare'), 'GIFのループ再生を準備中…');
  assert.equal(f.text('ready'), '準備完了');
  assert.equal(remove.title, 'GIFを削除'); remove.click(); assert.equal(removals, 1);
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: Tweet 2.3.0 native GIF labels preserve media, play state and handlers`, () => {
  const f = fixture(language, `<article><div class="relative"><video id="gif-video" src="fixture.mp4" loop muted playsinline preload="auto" aria-label="Animated GIF"></video>
    <button id="gif-toggle" class="absolute bottom-2 right-2" aria-label="Pause GIF"><svg aria-hidden="true"></svg></button>
    <span class="pointer-events-none" aria-hidden="true">GIF</span></div><p class="whitespace-pre-wrap" id="gif-caption">Pause GIF</p></article>
    <div class="relative"><video id="plain-video" loop muted playsinline aria-label="Animated GIF"></video><button aria-label="Play GIF"></button></div>`);
  const video = f.document.getElementById('gif-video');
  const toggle = f.document.getElementById('gif-toggle');
  let clicks = 0; toggle.addEventListener('click', () => clicks++);
  f.run(); f.run();
  assert.equal(video.getAttribute('aria-label'), language === 'ja' ? 'GIFアニメーション' : 'Animated GIF');
  assert.equal(toggle.getAttribute('aria-label'), language === 'ja' ? 'GIFを一時停止' : 'Pause GIF');
  assert.equal(video.getAttribute('src'), 'fixture.mp4'); assert.equal(video.loop, true);
  assert.equal(video.defaultMuted, true); assert.equal(video.preload, 'auto');
  assert.equal(f.text('gif-caption'), 'Pause GIF');
  assert.equal(f.document.getElementById('plain-video').getAttribute('aria-label'), 'Animated GIF');
  toggle.setAttribute('aria-label', 'Play GIF'); f.run(toggle);
  assert.equal(toggle.getAttribute('aria-label'), language === 'ja' ? 'GIFを再生' : 'Play GIF');
  toggle.click(); assert.equal(clicks, 1);
  f.dom.window.close();
});

const nativeBlockBody230 = "They won't be able to follow you, or reply to, quote, repost or like your posts, and neither of you will see the other's posts or get notifications from each other. Any follows between you are removed, and unblocking won't restore them.";

for (const language of ['ja', 'en']) test(`${language}: Tweet 2.3.0 native block menu and confirmation keep handles, handlers and classic OFF restoration`, () => {
  const f = fixture(language, `<main><div class="relative"><button aria-label="Profile options" aria-haspopup="menu"><svg></svg></button>
    <div class="absolute right-0 top-full bg-tl-app-card border rounded-xl" role="menu"><button class="text-red-500" role="menuitem" id="block-menu"><svg></svg><span class="min-w-0 truncate" id="block-label">Block @Like</span></button></div></div>
    <article><div class="relative"><button aria-label="Post options"><svg></svg></button><div class="absolute right-0 top-full bg-tl-app-card border rounded-xl"><button class="text-red-500"><svg></svg><span class="min-w-0 truncate" id="unblock-label">Unblock @Reply</span></button></div></div>
    <p class="whitespace-pre-wrap" id="block-tweet">${nativeBlockBody230}</p></article>
    <div class="bg-tl-app-card border" role="dialog" aria-modal="true" aria-labelledby="app-confirm-title"><h3 id="app-confirm-title">Block @Like?</h3>
    <p class="mt-2 leading-relaxed text-tl-app-text-muted" id="block-body">${nativeBlockBody230}</p><div class="mt-5"><button>Cancel</button><button id="block-confirm">Block</button></div></div>
    <button class="truncate" id="block-name">Block @Like</button></main>`, '/user/Like');
  const title = f.document.getElementById('app-confirm-title'); const titleNode = title.firstChild;
  const body = f.document.getElementById('block-body'); const bodyNode = body.firstChild;
  const label = f.document.getElementById('block-label'); const labelNode = label.firstChild;
  let menuClicks = 0; let confirms = 0;
  f.document.getElementById('block-menu').addEventListener('click', () => menuClicks++);
  f.document.getElementById('block-confirm').addEventListener('click', () => confirms++);
  f.run(); f.run();
  assert.equal(title.textContent, language === 'ja' ? '@Likeをブロックしますか？' : 'Block @Like?');
  assert.equal(label.textContent, language === 'ja' ? '@Likeをブロック' : 'Block @Like');
  assert.equal(f.text('unblock-label'), language === 'ja' ? '@Replyのブロックを解除' : 'Unblock @Reply');
  assert.match(body.textContent, language === 'ja' ? /リツイート、お気に入り/ : /Retweet or favorite your Tweets/);
  assert.equal(f.text('block-tweet'), nativeBlockBody230);
  assert.equal(f.text('block-name'), 'Block @Like');
  f.dom.window.qaClassic = false; f.qa.ctSyncLocalizationAppearance(); f.run();
  assert.match(body.textContent, language === 'ja' ? /リツイート、いいね/ : /repost or like your posts/);
  f.dom.window.qaClassic = true; f.qa.ctSyncLocalizationAppearance(); f.run();
  assert.match(body.textContent, language === 'ja' ? /リツイート、お気に入り/ : /Retweet or favorite your Tweets/);
  assert.equal(title.firstChild, titleNode); assert.equal(body.firstChild, bodyNode); assert.equal(label.firstChild, labelNode);
  f.document.getElementById('block-menu').click(); f.document.getElementById('block-confirm').click();
  assert.equal(menuClicks, 1); assert.equal(confirms, 1);
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: Tweet 2.3.0 blocked-profile states retain split usernames and exclude arbitrary profile text`, () => {
  const f = fixture(language, `<main><div class="flex flex-col items-center justify-center py-20 px-4 text-center">
    <p class="font-bold" id="blocked-by-me">You blocked @<!-- -->Like</p><p class="text-tl-app-text-muted" id="blocked-info">You are not seeing their posts or replies.</p></div>
    <div class="flex flex-col items-start justify-center py-12 px-8"><p id="blocked-by-target">You're blocked</p>
    <p class="text-tl-app-text-muted" id="blocked-target-info">@Reply has blocked you, so you can't follow them or see their posts.</p></div>
    <p id="ordinary-profile-copy">@Reply has blocked you, so you can't follow them or see their posts.</p>
    <p class="whitespace-pre-wrap" id="blocked-bio">You're blocked</p></main>`, '/user/Like');
  const title = f.document.getElementById('blocked-by-me'); const username = title.lastChild;
  f.run(); f.run();
  assert.equal(title.textContent, language === 'ja' ? 'ブロック済み: @Like' : 'You blocked @Like');
  assert.equal(title.lastChild, username); assert.equal(username.nodeValue, 'Like');
  assert.equal(f.text('blocked-info'), language === 'ja' ? '相手のツイートや返信は表示されません。' : 'You are not seeing their Tweets or replies.');
  assert.equal(f.text('blocked-by-target'), language === 'ja' ? 'ブロックされています' : "You're blocked");
  assert.equal(f.text('blocked-target-info'), language === 'ja' ? '@Replyさんにブロックされているため、フォローやツイートの表示ができません。' : "@Reply has blocked you, so you can't follow them or see their Tweets.");
  assert.equal(f.text('ordinary-profile-copy'), "@Reply has blocked you, so you can't follow them or see their posts.");
  assert.equal(f.text('blocked-bio'), "You're blocked");
  f.dom.window.qaClassic = false; f.qa.ctSyncLocalizationAppearance(); f.run();
  assert.equal(f.text('blocked-info'), language === 'ja' ? '相手のツイートや返信は表示されません。' : 'You are not seeing their posts or replies.');
  f.dom.window.close();
});

test('ja: Tweet 2.3.0 blocked-account settings localize errors and actions while keeping user cards intact', () => {
  const f = fixture('ja', `<main><section><div class="flex flex-col gap-5"><div><h4 class="font-extrabold" id="blocked-heading">Blocked accounts</h4>
    <p class="leading-relaxed" id="blocked-description">When you block someone, they cannot view your posts or follow you, and you will not see their posts or notifications.</p></div>
    <div><div class="text-red-500 bg-red-500/10 border border-red-500/20" id="blocked-load-error">Couldn't load your blocked accounts.</div><button aria-label="Retry loading blocked accounts" id="block-retry">Retry</button></div>
    <div><button class="truncate" id="blocked-card-name" aria-label="View @Block's profile">Block</button><span class="truncate">@Block</span>
    <button id="settings-unblock" aria-label="Unblock @Block">Unblock</button></div>
    <div class="text-center"><h3 id="blocked-empty">You aren't blocking anyone</h3><p class="text-tl-app-text-muted" id="blocked-empty-description">When you block someone, they'll show up here.</p></div></div>
    <div class="text-red-500 bg-red-500/10 border border-red-500/20" id="unrelated-error">Couldn't load your blocked accounts.</div></section></main>`, '/settings');
  const unblock = f.document.getElementById('settings-unblock');
  let unblocks = 0; unblock.addEventListener('click', () => unblocks++);
  f.run();
  assert.equal(f.text('blocked-heading'), 'ブロックしているアカウント');
  assert.match(f.text('blocked-description'), /相手のツイートや通知も表示されません/);
  assert.equal(f.text('blocked-load-error'), 'ブロックしているアカウントを読み込めませんでした。');
  assert.equal(f.text('block-retry'), '再試行');
  assert.equal(f.document.getElementById('block-retry').getAttribute('aria-label'), 'ブロックしているアカウントを再読み込み');
  assert.equal(unblock.textContent, 'ブロックを解除'); assert.equal(unblock.getAttribute('aria-label'), '@Blockのブロックを解除');
  unblock.disabled = true; unblock.setAttribute('aria-label', 'Unblocking @Block'); f.run(unblock);
  assert.equal(unblock.getAttribute('aria-label'), '@Blockのブロックを解除中…'); assert.equal(unblock.disabled, true);
  unblock.disabled = false; unblock.click(); assert.equal(unblocks, 1);
  assert.equal(f.text('blocked-card-name'), 'Block');
  assert.equal(f.document.getElementById('blocked-card-name').getAttribute('aria-label'), "View @Block's profile");
  assert.equal(f.text('blocked-empty'), 'ブロックしているアカウントはありません');
  assert.equal(f.text('blocked-empty-description'), 'ブロックしたアカウントがここに表示されます。');
  assert.equal(f.text('unrelated-error'), "Couldn't load your blocked accounts.");
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: Tweet 2.3.0 overlay notification rows localize only actions and keep independent avatar and menu handlers`, () => {
  const f = fixture(language, `<main><div class="border-b border-tl-app-border"><div class="relative w-full flex items-start gap-3" id="new-notification">
    <button type="button" class="absolute inset-0 w-full h-full" aria-labelledby="new-notification-action" id="new-notification-open"></button>
    <div class="mt-0.5 shrink-0 pointer-events-none"><svg width="28" height="28"></svg></div>
    <div class="flex-1 min-w-0 pointer-events-none"><div><button id="new-actor-avatar" aria-label="Like avatar"><img alt="Like avatar"></button></div>
    <p id="new-notification-action"><span class="font-extrabold" id="new-notification-actor">Like</span> <span class="text-tl-app-text-muted" id="new-reply-action">replied to your post</span></p>
    <p class="line-clamp-2" id="new-reply-preview">replied to your post</p></div><div class="relative shrink-0"><button aria-label="More options" aria-haspopup="true"><svg></svg></button>
    <div class="absolute right-0 top-full bg-tl-app-card border rounded-xl"><button type="button" class="w-full flex items-center text-left" id="notification-block"><svg class="lucide-ban"></svg>Block @Like</button></div></div></div></div>
    <div class="border-b"><div class="relative w-full flex items-start gap-3"><button type="button" class="absolute inset-0 w-full h-full" aria-labelledby="outside-label"></button>
    <div class="flex-1 min-w-0 pointer-events-none"><p><span class="font-extrabold">Home</span> <span id="fake-new-action">replied to your post</span></p></div></div></div>
    <p id="outside-label">An unrelated label</p></main>`, '/notifications');
  const open = f.document.getElementById('new-notification-open');
  const avatar = f.document.getElementById('new-actor-avatar');
  const block = f.document.getElementById('notification-block');
  const action = f.document.getElementById('new-reply-action'); const node = action.firstChild;
  let opens = 0; let avatars = 0; let blocks = 0;
  open.addEventListener('click', () => opens++); avatar.addEventListener('click', () => avatars++); block.addEventListener('click', () => blocks++);
  f.run(); f.run();
  assert.equal(action.textContent, language === 'ja' ? 'さんがあなたのツイートに返信しました' : 'replied to your Tweet');
  assert.equal(f.text('new-notification-actor'), 'Like'); assert.equal(f.text('new-reply-preview'), 'replied to your post');
  assert.equal(f.text('fake-new-action'), 'replied to your post');
  assert.equal(block.textContent, language === 'ja' ? '@Likeをブロック' : 'Block @Like');
  assert.equal(open.getAttribute('aria-labelledby'), 'new-notification-action');
  assert.equal(action.firstChild, node);
  open.click(); avatar.click(); block.click(); assert.equal(opens, 1); assert.equal(avatars, 1); assert.equal(blocks, 1);
  node.nodeValue = 'liked your post'; f.run(action);
  assert.equal(action.textContent, language === 'ja' ? 'さんがあなたのツイートをお気に入りに登録しました' : 'favorited your Tweet');
  assert.ok(f.document.querySelector('#new-notification .ct-notification-fav-icon'));
  f.dom.window.qaClassic = false; f.qa.ctSyncLocalizationAppearance(); f.run();
  assert.equal(action.textContent, language === 'ja' ? 'さんがあなたのツイートにいいねしました' : 'liked your post');
  assert.equal(f.document.querySelector('#new-notification .ct-notification-fav-icon'), null);
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: Tweet 2.3.0 mention metadata localizes the time without rewriting split handles or previews`, () => {
  const f = fixture(language, `<main><div class="relative w-full flex items-start gap-3 border-b">
    <button type="button" class="absolute inset-0 w-full h-full" aria-labelledby="mention-who mention-action"></button>
    <div class="flex-1 min-w-0 pointer-events-none"><p class="truncate" id="mention-who"><span class="font-extrabold" id="mention-name">Like</span> <span class="text-tl-app-text-soft" id="mention-meta">@<!-- -->1h<!-- --> · <!-- -->2h</span></p>
    <p id="mention-action">mentioned you</p><p class="line-clamp-3" id="mention-preview">mentioned you 2h</p></div></div></main>`, '/notifications');
  const meta = f.document.getElementById('mention-meta'); const handle = meta.childNodes[2]; const time = meta.lastChild;
  f.run(); f.run();
  assert.equal(f.text('mention-name'), 'Like'); assert.equal(handle.nodeValue, '1h');
  assert.equal(meta.textContent, language === 'ja' ? '@1h · 2時間前' : '@1h · 2h');
  assert.equal(f.text('mention-action'), language === 'ja' ? 'あなたを@ツイートしました' : 'mentioned you');
  assert.equal(f.text('mention-preview'), 'mentioned you 2h'); assert.equal(meta.lastChild, time);
  time.nodeValue = '3m'; f.run(meta);
  assert.equal(meta.textContent, language === 'ja' ? '@1h · 3分前' : '@1h · 3m');
  f.dom.window.close();
});

test('ja: native detail title translates without changing author names or quoted headings', () => {
  const f = fixture('ja', '<main><div class="sticky"><h2 class="truncate" id="detail-title">Feed</h2></div><article><button class="truncate" id="detail-author">Feed</button><h2 class="truncate" id="quote-title">Feed</h2></article></main>', '/post/detail-id');
  const node = f.document.getElementById('detail-title').firstChild;
  f.run(); f.run(); assert.equal(f.text('detail-title'), 'ツイート');
  assert.equal(f.text('detail-author'), 'Feed'); assert.equal(f.text('quote-title'), 'Feed');
  node.nodeValue = 'Feed'; f.run(); assert.equal(f.text('detail-title'), 'ツイート'); f.dom.window.close();
});

test('ja: native pin menu localizes its three actions while preserving post text and handlers', () => {
  const f = fixture('ja', `<main><article><button class="font-bold truncate" id="pin-author">Pin to profile</button><p class="whitespace-pre-wrap" id="pin-post">Move to top</p><div class="relative"><button type="button" data-post-menu-trigger="post-a" aria-label="Post options"></button><div class="absolute right-0 top-full bg-tl-app-card border rounded-xl">
    <button type="button" id="pin-action"><svg class="lucide-pin"></svg><span>Pin to profile</span></button>
    <button type="button" id="unpin-action"><svg class="lucide-pin-off"></svg><span>Unpin from profile</span></button>
    <button type="button" id="move-pin-action"><svg class="lucide-arrow-up"></svg><span>Move to top</span></button></div></div>
    <button type="button" id="unverified-pin"><svg class="lucide-pin"></svg><span>Pin to profile</span></button></article></main>`);
  const pin = f.document.getElementById('pin-action'), span = pin.lastElementChild, node = span.firstChild;
  let clicks = 0; pin.addEventListener('click', () => clicks++);
  f.run(); f.run();
  assert.equal(pin.textContent.trim(), 'プロフィールに固定'); assert.equal(span.firstChild, node);
  assert.equal(f.text('unpin-action'), 'プロフィールの固定を解除'); assert.equal(f.text('move-pin-action'), '一番上に移動');
  assert.equal(f.text('pin-author'), 'Pin to profile'); assert.equal(f.text('pin-post'), 'Move to top');
  assert.equal(f.text('unverified-pin'), 'Pin to profile'); pin.click(); assert.equal(clicks, 1);
  node.nodeValue = 'Pin to profile'; f.run(span); assert.equal(span.textContent, 'プロフィールに固定'); f.dom.window.close();
});

test('ja: profile pinned section translates labels and expansion while leaving all native posts in place', () => {
  const f = fixture('ja', `<main><section aria-label="Pinned posts" id="pins"><div><p class="flex items-center font-bold text-tl-app-text-muted"><svg class="lucide-pin"></svg><span id="pin-position">Pinned · 1 of 3</span></p><article><p class="whitespace-pre-wrap" id="pinned-content">Pinned · 1 of 3</p><img src="https://images.example/pin.webp"></article></div>
    <button type="button" aria-expanded="false" aria-controls="more-pins" class="w-full flex items-center border-b" id="more-pin-action"><svg></svg><span>Show 2 more pinned posts</span></button><div id="more-pins" hidden><div><p class="flex items-center font-bold text-tl-app-text-muted"><svg class="lucide-pin"></svg><span>Pinned · 2 of 3</span></p><article></article></div></div></section>
    <p class="text-tl-app-text-muted" id="unverified-position">Pinned · 1 of 3</p></main>`, '/profile');
  const action = f.document.getElementById('more-pin-action'), node = action.lastElementChild.firstChild;
  const article = f.document.querySelector('article'); let clicks = 0; action.addEventListener('click', () => clicks++);
  f.run(); f.run(); assert.equal(f.document.getElementById('pins').getAttribute('aria-label'), '固定されたツイート');
  assert.equal(f.text('pin-position'), '固定 · 3件中1件目'); assert.equal(action.textContent.trim(), 'ほかの固定ツイート2件を表示');
  assert.equal(f.text('pinned-content'), 'Pinned · 1 of 3'); assert.equal(f.text('unverified-position'), 'Pinned · 1 of 3');
  assert.equal(f.document.querySelector('article'), article); assert.equal(action.lastElementChild.firstChild, node);
  action.click(); assert.equal(clicks, 1); assert.equal(f.document.getElementById('more-pins').hidden, true);
  node.nodeValue = 'Hide 2 pinned posts'; action.setAttribute('aria-expanded', 'true'); f.run(action);
  assert.equal(action.textContent.trim(), '固定ツイート2件を折りたたむ');
  f.document.getElementById('pin-position').firstChild.nodeValue = 'Pinned · 3 of 2'; f.run();
  assert.equal(f.text('pin-position'), 'Pinned · 3 of 2'); f.dom.window.close();
});

test('ja: native pin hint and replace sheet keep radio values, selection, body text and cancel actions native', () => {
  const f = fixture('ja', `<main><div class="mx-4 my-3 flex items-start gap-3 rounded-2xl border bg-tl-app-card px-4 py-3"><svg class="lucide-pin"></svg><p class="min-w-0 flex-1 text-tl-app-text" id="pin-hint">Pin up to 3 posts so visitors see your best work first. Use ··· on any of your posts.</p><button type="button" aria-label="Dismiss" id="dismiss-pin"><svg class="lucide-x"></svg></button></div></main>
    <div role="dialog" aria-modal="true" aria-labelledby="replace-pin-title" aria-describedby="replace-pin-body" class="bg-tl-app-card border overflow-hidden"><div><h3 id="replace-pin-title"><svg class="lucide-pin"></svg>You have 3 pinned posts</h3><button type="button" aria-label="Cancel" id="cancel-pin-icon"><svg></svg></button></div><div><p id="replace-pin-body">Choose one to replace. It stays on your profile; it just won't be pinned.</p><div role="radiogroup" aria-labelledby="replace-pin-title">${['Post with media', 'Pin to profile', 'Replace'].map((text, index) => `<label><input type="radio" name="replace-pin" value="post-${index}" ${index === 1 ? 'checked' : ''}><span class="break-words" id="pin-choice-${index}">${text}</span></label>`).join('')}</div><div><button type="button" id="cancel-pin">Cancel</button><button type="button" id="replace-pin">Replace</button></div></div></div>`, '/profile');
  const radio = f.document.querySelector('input:checked'), cancel = f.document.getElementById('cancel-pin');
  let clicks = 0; cancel.addEventListener('click', () => clicks++); const bodyNode = f.document.getElementById('replace-pin-body').firstChild;
  f.run(); f.run(); assert.match(f.text('pin-hint'), /3件まで/); assert.equal(f.document.getElementById('dismiss-pin').getAttribute('aria-label'), '閉じる');
  assert.equal(f.text('replace-pin-title'), 'ツイートを3件固定しています'); assert.match(f.text('replace-pin-body'), /固定を解除する/);
  assert.equal(f.document.getElementById('replace-pin-body').firstChild, bodyNode);
  assert.equal(f.text('replace-pin'), '入れ替える'); assert.equal(cancel.textContent, 'キャンセル');
  assert.equal(f.document.getElementById('cancel-pin-icon').getAttribute('aria-label'), 'キャンセル');
  assert.equal(f.document.querySelector('input:checked'), radio); assert.equal(radio.value, 'post-1');
  assert.deepEqual([0,1,2].map(i => f.text(`pin-choice-${i}`)), ['Post with media', 'Pin to profile', 'Replace']); cancel.click(); assert.equal(clicks, 1); f.dom.window.close();
});

test('ja: verified native pin toasts translate real results and preserve Undo and Retry handlers', () => {
  const f = fixture('ja', `<div class="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center"><div role="status" aria-live="polite" class="pointer-events-auto flex items-center gap-3 rounded-full bg-sky-500"><span id="pin-toast">Pinned to your profile.</span><button type="button" class="shrink-0 font-bold underline" id="pin-undo">Undo</button></div></div><p class="whitespace-pre-wrap" id="toast-post">Pinned to your profile.</p><div role="status"><span id="unverified-toast">Pinned to your profile.</span></div>`);
  const button = f.document.getElementById('pin-undo'), text = f.document.getElementById('pin-toast').firstChild;
  let clicks = 0; button.addEventListener('click', () => clicks++);
  f.run(); f.run(); assert.equal(f.text('pin-toast'), 'プロフィールに固定しました。'); assert.equal(button.textContent, '元に戻す');
  assert.equal(f.text('toast-post'), 'Pinned to your profile.'); assert.equal(f.text('unverified-toast'), 'Pinned to your profile.');
  button.click(); assert.equal(clicks, 1); text.nodeValue = "Couldn't pin. Try again."; button.firstChild.nodeValue = 'Retry'; f.run();
  assert.equal(f.text('pin-toast'), '固定できませんでした。もう一度お試しください。'); assert.equal(button.textContent, '再試行');
  assert.equal(f.document.getElementById('pin-toast').firstChild, text); f.dom.window.close();
});

for (const mobile of [false, true]) test(`ja: native ${mobile ? 'drawer' : 'desktop'} Shop link localizes without changing navigation or post links`, () => {
  const link = `<a href="https://tweet.shop${mobile ? '/' : ''}" target="_blank" rel="noopener noreferrer" id="native-shop"><svg class="lucide-shopping-bag"></svg><span>Shop</span><span class="sr-only"> (opens in a new tab)</span></a>`;
  const f = fixture('ja', (mobile ? `<div role="dialog" aria-label="Account menu">${link}</div>` : `<aside><nav>${link}</nav></aside>`) + '<article><p class="whitespace-pre-wrap"><a href="https://tweet.shop" target="_blank" rel="noopener noreferrer" id="body-shop">Shop</a></p></article>');
  const native = f.document.getElementById('native-shop'), node = native.children[1].firstChild;
  let clicks = 0; native.addEventListener('click', e => { e.preventDefault(); clicks++; }); f.run(); f.run();
  assert.equal(native.children[1].textContent, 'ショップ'); assert.equal(native.children[2].textContent.trim(), '（新しいタブで開きます）');
  assert.equal(native.children[1].firstChild, node); assert.equal(native.href, 'https://tweet.shop/'); assert.equal(native.target, '_blank');
  assert.equal(native.rel, 'noopener noreferrer'); native.click(); assert.equal(clicks, 1); assert.equal(f.text('body-shop'), 'Shop'); f.dom.window.close();
});

test('ja: child safety chrome translates its heading while names and legal body remain exact', () => {
  const f = fixture('ja', '<main><h1 id="safety-title">Child Safety Standards</h1><p id="safety-body">Child Safety Standards</p><article><button class="truncate" id="safety-name">Child Safety Standards</button><p class="whitespace-pre-wrap" id="safety-post">Child Safety Standards</p></article></main>', '/child-safety');
  f.run(); assert.equal(f.text('safety-title'), '児童の安全に関する基準');
  assert.equal(f.text('safety-body'), 'Child Safety Standards'); assert.equal(f.text('safety-name'), 'Child Safety Standards');
  assert.equal(f.text('safety-post'), 'Child Safety Standards'); f.dom.window.close();
});

for (const connector of [false, true]) test(`ja: Tweet 2.3.1 parent thread ${connector ? 'connector' : 'preview'} preserves native links and source content`, () => {
  const f = fixture('ja', `<main><div class="${connector ? 'min-h-0 flex-1 overflow-y-auto' : 'border-b border-tl-app-border'}"><div class="flex w-full items-start gap-3 px-4 pt-3 ${connector ? 'pb-0' : 'pb-2'} text-left">
    <div class="min-w-0 flex-1"><div class="flex min-w-0 flex-wrap items-center gap-1 leading-4">
      <span class="font-semibold truncate" id="parent-name">Active now</span><span class="text-tl-app-text-muted truncate">@alice</span>
      <span class="text-tl-app-text-muted">·</span><span class="shrink-0 text-tl-app-text-muted"><a href="/post/parent-id" aria-label="Open the post by @alice that this replies to" class="hover:underline" id="parent-time">3h</a></span></div>
      <p class="mt-1 line-clamp-3 wrap-break-word" id="parent-body">Poll · 3 choices</p>
      <p class="mt-1 text-tl-app-text-muted" id="parent-summary">Poll · 3 choices</p></div></div><article><p class="whitespace-pre-wrap">Quoted a post</p></article></div></main>`, '/post/reply-id');
  const link = f.document.getElementById('parent-time'); const node = link.firstChild;
  let clicks = 0; link.addEventListener('click', e => { e.preventDefault(); clicks++; });
  f.run(); f.run();
  assert.equal(link.textContent, '3時間前'); assert.equal(link.firstChild, node);
  assert.equal(link.getAttribute('aria-label'), '@aliceへの返信元のツイートを開く');
  assert.equal(link.getAttribute('href'), '/post/parent-id'); link.click(); assert.equal(clicks, 1);
  assert.equal(f.text('parent-name'), 'Active now'); assert.equal(f.text('parent-body'), 'Poll · 3 choices');
  assert.equal(f.text('parent-summary'), '投票 · 3個の選択肢');
  node.nodeValue = 'Sep 27'; f.run(link); assert.equal(link.textContent, '9月27日');
  f.document.getElementById('parent-summary').textContent = 'Quoted a post'; f.run();
  assert.equal(f.text('parent-summary'), '引用ツイート'); f.dom.window.close();
});

test('ja: Tweet 2.3.1 sessions localize status and dates while preserving device labels and native handlers', () => {
  const f = fixture('ja', `<main><section><div class="flex flex-col gap-5"><div><h4 class="font-extrabold">Where you're signed in</h4><p class="leading-relaxed">The devices signed in to your account. Sign out of any you do not recognize.</p></div>
    <div class="divide-y"><div class="flex items-center gap-3 px-4"><svg></svg><div><div><span class="truncate" id="device">Active now</span><span class="shrink-0 rounded-full" id="current">This device</span></div>
    <span class="text-tl-app-text-muted mt-0.5" id="session-time">Active now<!-- --> · Signed in Sep 26, 2026</span></div><button aria-label="Sign out Chrome on macOS" id="session-sign-out">Sign out</button></div>
    <div class="flex items-center gap-3 px-4"><svg></svg><div><span class="truncate" id="unknown-device">Unknown device</span><span class="text-tl-app-text-muted mt-0.5" id="last">Last active Sep 11 · Signed in Sep 11, 2026</span></div></div></div>
    <button id="others">Sign out of all other devices</button><p id="truncated">Showing your 50 most recently active devices. Signing out of all other devices also signs out the ones not shown.</p></div>
    <span class="text-tl-app-text-muted mt-0.5" id="unscoped-session">Active 3h ago · Signed in Sep 26, 2026</span>
    <textarea id="draft">Where you're signed in</textarea></section></main>`, '/settings');
  const time = f.document.getElementById('session-time'); const node = time.firstChild;
  const action = f.document.getElementById('session-sign-out'); let clicks = 0; action.addEventListener('click', () => clicks++);
  f.run(); f.run();
  assert.equal(f.text('device'), 'Active now'); assert.equal(f.text('unknown-device'), '不明な端末'); assert.equal(f.text('current'), 'この端末');
  assert.equal(time.textContent, '現在使用中 · 2026年9月26日にログイン'); assert.equal(time.firstChild, node);
  assert.equal(time.lastChild.nodeValue, ' · 2026年9月26日にログイン');
  time.lastChild.nodeValue = ' · Signed in Feb 29, 2024'; f.run(time);
  assert.equal(time.textContent, '現在使用中 · 2024年2月29日にログイン');
  time.lastChild.remove(); time.childNodes[1]?.remove();
  assert.equal(f.text('last'), '最終使用：9月11日 · 2026年9月11日にログイン');
  assert.equal(action.textContent, 'ログアウト'); assert.equal(action.getAttribute('aria-label'), 'Chrome on macOSからログアウト');
  action.click(); assert.equal(clicks, 1); assert.equal(f.document.getElementById('draft').value, "Where you're signed in");
  assert.equal(f.text('unscoped-session'), 'Active 3h ago · Signed in Sep 26, 2026');
  node.nodeValue = 'Active 3h ago · Signed in Feb 29, 2026'; f.run(time);
  assert.equal(time.textContent, 'Active 3h ago · Signed in Feb 29, 2026');
  node.nodeValue = 'Active 8m ago · Signed in Feb 29, 2024'; f.run(time);
  assert.equal(time.textContent, '8分前に使用 · 2024年2月29日にログイン'); f.dom.window.close();
});

test('ja: session confirmation keeps device text and password input intact', () => {
  const f = fixture('ja', `<div role="dialog"><h3>Sign out this device?</h3><p id="confirm-body">Safari on iOS will be signed out and will need your password to sign back in.</p><input type="password" value="unchanged"><button>Sign out</button></div><p class="whitespace-pre-wrap" id="user-text">Safari on iOS will be signed out and will need your password to sign back in.</p>`, '/settings');
  f.run(); assert.equal(f.text('confirm-body'), 'Safari on iOSからログアウトします。再度ログインするにはパスワードが必要です。');
  assert.equal(f.document.querySelector('input').value, 'unchanged');
  assert.equal(f.text('user-text'), 'Safari on iOS will be signed out and will need your password to sign back in.'); f.dom.window.close();
});

test('ja: native parent media and deleted metadata translate without changing unrelated descriptions', () => {
  const f = fixture('ja', `<main><div class="border-b border-tl-app-border"><div class="flex w-full items-start gap-3 px-4 pt-3 pb-2 text-left"><div class="min-w-0 flex-1"><div class="flex min-w-0 flex-wrap items-center gap-1 leading-4"><span class="font-semibold truncate">Alice</span><span class="text-tl-app-text-muted truncate">@alice</span></div><img id="parent-media" alt="Media in the post this replies to" src="https://images.example/a.png"></div></div><article></article></div>
  <div class="min-h-0 flex-1 overflow-y-auto"><div class="flex w-full items-start gap-3 px-4 pt-3 pb-0 text-left"><span aria-hidden="true" class="h-8 w-8"></span><p class="min-w-0 flex-1 self-center italic leading-5 text-tl-app-text-muted" id="deleted-parent">This post is no longer available</p></div><article><p class="whitespace-pre-wrap" id="deleted-body">This post is no longer available</p></article></div>
  <img id="unscoped-media" alt="Media in the post this replies to" src="https://images.example/b.png"></main>`, '/post/reply-id');
  f.run(); assert.equal(f.document.getElementById('parent-media').alt, '返信先のツイートの写真・動画');
  assert.equal(f.document.getElementById('unscoped-media').alt, 'Media in the post this replies to');
  assert.equal(f.text('deleted-parent'), 'このツイートは表示できません'); assert.equal(f.text('deleted-body'), 'This post is no longer available'); f.dom.window.close();
});

test('en: Tweet 2.3.0 blocked-account settings restore native text when classic appearance is off', () => {
  const native = 'When you block someone, they cannot view your posts or follow you, and you will not see their posts or notifications.';
  const f = fixture('en', `<main><section><div><h4 class="font-extrabold">Blocked accounts</h4><p class="leading-relaxed" id="english-block-help">${native}</p></div>
    <button class="truncate" id="english-block-name">Blocked accounts</button></section></main>`, '/settings');
  const help = f.document.getElementById('english-block-help'); const textNode = help.firstChild;
  f.run(); assert.match(help.textContent, /your Tweets/);
  assert.equal(f.text('english-block-name'), 'Blocked accounts');
  f.dom.window.qaClassic = false; f.qa.ctSyncLocalizationAppearance(); f.run();
  assert.equal(help.textContent, native); assert.equal(help.firstChild, textNode);
  f.dom.window.close();
});

for (const language of ['ja', 'en']) test(`${language}: Tweet 2.5 games summaries and result cards preserve native controls and post content`, () => {
  const f = fixture(language, `<nav><button id="nav-games"><svg></svg><span>Games</span></button></nav><main>
    <section aria-labelledby="feed-games-title" data-testid="todays-games-card"><h2 id="feed-games-title">Today’s games</h2>
      <ul><li><span><span>TWIRDLE 1</span><span id="description">Guess the 5-letter word in 6 tries</span></span>
      <button type="button" id="play" aria-label="Play TWIRDLE 1: not played yet">Play</button></li></ul></section>
    <section aria-labelledby="explore-games"><h2 id="explore-games">Today’s games</h2><button id="all-games">All games</button></section>
    <article><p class="tl-user-text whitespace-pre-wrap break-words" id="game-post">Play TWIRDLE 1: not played yet https://app.tweet.app/games/twirdle</p>
      <div data-testid="game-result-card"><span class="tw-egg" aria-hidden="true"></span><span><span>TWIRDLE 1</span><span id="card-description">Today’s puzzle · new one at midnight ET</span></span>
      <button type="button" id="card-play" aria-label="Play TWIRDLE 1">Play</button></div></article></main>`);
  const button = f.document.getElementById('play'); let clicks = 0; button.onclick = () => clicks++;
  f.run();
  assert.equal(f.text('nav-games'), language === 'ja' ? 'ゲーム' : 'Games');
  assert.equal(f.text('feed-games-title'), language === 'ja' ? '今日のゲーム' : 'Today’s games');
  assert.equal(f.text('description'), language === 'ja' ? '6回以内に5文字の単語を当てましょう' : 'Guess the 5-letter word in 6 tries');
  assert.equal(button.getAttribute('aria-label'), language === 'ja' ? 'TWIRDLE 1を遊ぶ、未プレイ' : 'Play TWIRDLE 1: not played yet');
  assert.equal(f.text('all-games'), language === 'ja' ? 'すべてのゲーム' : 'All games');
  assert.equal(f.text('card-description'), language === 'ja' ? '今日の問題 · 米国東部時間の午前0時に更新' : 'Today’s puzzle · new one at midnight ET');
  assert.equal(f.text('card-play'), language === 'ja' ? '遊ぶ' : 'Play');
  assert.equal(f.text('game-post'), 'Play TWIRDLE 1: not played yet https://app.tweet.app/games/twirdle');
  assert.equal(f.document.getElementById('play'), button); button.click(); assert.equal(clicks, 1);
  f.run(); f.dom.window.qaClassic = false; f.run(); assert.equal(button.getAttribute('aria-label'), language === 'ja' ? 'TWIRDLE 1を遊ぶ、未プレイ' : 'Play TWIRDLE 1: not played yet');
  f.dom.window.close();
});

test('ja: Tweet 2.5 game board and share labels retain letters, native selection, previews and handlers', () => {
  const f = fixture('ja', `<main><div class="animate-fadeIn"><div class="tw-play">
    <div class="tw-board" role="group" aria-label="TWIRDLE 1 board"><div class="tw-row" role="group" aria-label="Guess 1, typing">
      <div class="tw-egg" role="img" data-state="correct" aria-label="Letter 1, A, hatched, right spot"><span aria-hidden="true" id="letter">A</span></div></div></div>
    <p id="message" role="alert">Not enough letters.</p>
    <section aria-labelledby="tw-share-title"><h2 id="tw-share-title">Share your result</h2><div role="radiogroup" aria-labelledby="tw-share-title">
      <label><input type="radio" name="tw-share-audience" value="followers" checked><span id="audience">Post to my followers</span></label></div>
      <p aria-label="Post preview" id="preview">TWIRDLE 1 3/6\nToday’s games\n🟩🟩🟩🟩🟩<span id="preview-user-text">Post preview</span><button type="button" aria-label="Results" id="preview-child">Share</button></p>
      <p id="preview-word">Post preview</p><button type="button" id="share">Share</button></section>
      <p aria-label="Post preview" id="unknown-preview">Share</p><p class="tl-user-text" id="user-preview-word">Post preview</p>
    <div role="group" aria-label="Keyboard"><button type="button" class="tw-key" aria-label="A, hatched" id="key">a</button>
      <button type="button" class="tw-key" aria-label="Enter" id="enter">enter</button></div></div></div></main>`, '/games/twirdle');
  const letter = f.document.getElementById('letter'), radio = f.document.querySelector('input'), share = f.document.getElementById('share');
  const preview = f.text('preview'), previewElement = f.document.getElementById('preview'), body = previewElement.innerHTML;
  let shares = 0; share.onclick = () => shares++;
  f.run();
  assert.equal(f.text('message'), '文字数が足りません。'); assert.equal(f.text('tw-share-title'), '結果を共有'); assert.equal(f.text('audience'), 'フォロワーへ投稿');
  assert.equal(f.text('preview'), preview); assert.equal(f.text('letter'), 'A'); assert.equal(f.text('key'), 'a');
  assert.equal(previewElement.getAttribute('aria-label'), '投稿プレビュー'); assert.equal(previewElement.innerHTML, body);
  assert.equal(f.document.getElementById('preview-child').getAttribute('aria-label'), 'Results');
  for (const id of ['preview-user-text', 'preview-word', 'user-preview-word']) assert.equal(f.text(id), 'Post preview');
  assert.equal(f.document.getElementById('unknown-preview').getAttribute('aria-label'), 'Post preview'); assert.equal(f.text('unknown-preview'), 'Share');
  const previewRecord = { node: previewElement, attribute: 'aria-label', original: 'Post preview' };
  assert.equal(f.qa.ctLocalizationNativeRecordException(previewRecord), true);
  assert.equal(f.qa.ctLocalizationRecordAllowed(previewRecord), true);
  assert.equal(f.qa.ctLocalizationRecordAllowed({ node: previewElement.firstChild, attribute: null }), false);
  assert.equal(f.qa.ctLocalizationRecordAllowed({ node: f.document.getElementById('preview-child'), attribute: 'aria-label' }), false);
  assert.equal(f.document.querySelector('.tw-egg').getAttribute('aria-label'), '1文字目、A、文字と位置が正解');
  assert.equal(f.document.querySelector('.tw-board').getAttribute('aria-label'), 'TWIRDLE 1の盤面');
  assert.equal(f.text('enter'), '回答'); assert.equal(f.document.getElementById('enter').getAttribute('aria-label'), '回答する');
  assert.equal(radio.checked, true); assert.equal(radio.value, 'followers'); assert.equal(f.document.getElementById('letter'), letter);
  share.click(); assert.equal(shares, 1); assert.equal(f.document.querySelectorAll('button').length, 4);
  f.document.getElementById('message').firstChild.nodeValue = 'Hatched in 3!'; f.run(); assert.equal(f.text('message'), '3回で正解！');
  for (const classic of [true, false, true]) {
    f.dom.window.qaClassic = classic; f.run();
    assert.equal(previewElement.getAttribute('aria-label'), '投稿プレビュー'); assert.equal(previewElement.innerHTML, body);
    assert.equal(f.document.getElementById('preview-child').getAttribute('aria-label'), 'Results');
    assert.equal(f.document.getElementById('unknown-preview').getAttribute('aria-label'), 'Post preview');
  }
  previewElement.setAttribute('aria-label', 'Post preview'); f.run(previewElement);
  assert.equal(previewElement.getAttribute('aria-label'), '投稿プレビュー'); assert.equal(previewElement.innerHTML, body);
  f.dom.window.close();
});

test('ja: Tweet 2.5 game help keeps split React text nodes and example letters', () => {
  const f = fixture('ja', `<div role="dialog" aria-modal="true" aria-labelledby="tw-howto-title"><div><h2 id="tw-howto-title">How to play</h2><button type="button" aria-label="Close how to play"></button></div>
    <ul><li id="length">Each word must be a valid <span id="word-length">5</span>-letter word.</li></ul>
    <div role="group" aria-label="Example: WEARY"><div class="tw-egg" role="img" aria-label="Letter 1, W, hatched, right spot"><span aria-hidden="true" id="example">W</span></div></div>
    <p id="caption">W is hatched: it’s in the word, in the right spot.</p><button type="button">Got it</button></div>`);
  const length = f.document.getElementById('word-length'), before = f.document.getElementById('length').firstChild, after = length.nextSibling;
  f.run();
  assert.equal(f.text('tw-howto-title'), '遊び方'); assert.equal(f.text('length'), '入力するのは実在する単語です。文字数は 5文字です。');
  assert.equal(f.document.getElementById('length').firstChild, before); assert.equal(length.nextSibling, after); assert.equal(f.text('example'), 'W');
  length.firstChild.nodeValue = '6'; f.run(); assert.equal(f.text('word-length'), '6');
  assert.equal(f.document.querySelector('button').getAttribute('aria-label'), '遊び方を閉じる'); f.dom.window.close();
});

test('ja: Tweet 2.5 leaderboard/stats preserve matching player names, handle, answer and stat values', () => {
  const f = fixture('ja', `<main><div class="animate-fadeIn"><div class="sticky"><button aria-label="Back"><svg></svg></button><div><h2 class="truncate" id="result-title">TWIRDLE 1 results</h2></div></div>
    <section aria-label="The answer"><p id="answer-label">The word was</p><div role="img" aria-label="BEST"><span id="answer">BEST</span></div></section>
    <div role="tablist" aria-label="Leaderboard"><button role="tab" id="scope">People I follow</button></div>
    <section aria-busy="false"><p id="rank">You’re ranked 2 of everyone. Only you can see your rank.</p><ol><li><button><span class="truncate" id="player">Best</span><span class="truncate" id="handle">@Play</span></button><span>3/6</span></li></ol></section>
    <section aria-labelledby="twirdle-stats"><h2 id="twirdle-stats">Your stats</h2><dl><div><dt id="played">Played</dt><dd id="value">42</dd></div><div><dt id="best">Best</dt><dd>3</dd></div></dl><h3 id="distribution">Guess distribution</h3></section>
    </div></main>`, '/games/twirdle/results');
  f.run();
  assert.equal(f.text('result-title'), 'TWIRDLE 1の結果'); assert.equal(f.text('scope'), 'フォロー中のユーザー'); assert.equal(f.text('rank'), '全体で2位です。順位は自分だけに表示されます。');
  assert.equal(f.text('played'), 'プレイ回数'); assert.equal(f.text('best'), '最長記録'); assert.equal(f.text('value'), '42'); assert.equal(f.text('player'), 'Best'); assert.equal(f.text('handle'), '@Play'); assert.equal(f.text('answer'), 'BEST');
  assert.equal(f.text('answer-label'), '正解の単語'); assert.equal(f.text('distribution'), '正解までの回答回数');
  f.dom.window.qaClassic = false; f.run(); assert.equal(f.text('result-title'), 'TWIRDLE 1の結果');
  f.document.getElementById('result-title').firstChild.nodeValue = 'TWIRDLE 2 results'; f.run(); assert.equal(f.text('result-title'), 'TWIRDLE 2の結果'); f.dom.window.close();
});

test('ja: unknown game lookalikes and editable/profile text do not authorize game localization', () => {
  const f = fixture('ja', `<main><p id="plain">Today’s games</p><h2 class="truncate" id="name">Games</h2><div data-testid="profile-bio" id="bio">Guess the 5-letter word in 6 tries</div>
    <article><p class="tl-user-text" id="post">Share your result</p></article><div data-testid="game-result-card"><span id="fake">Today’s puzzle · new one at midnight ET</span></div>
    <section aria-labelledby="games-today"><p id="fake-section">No puzzle today</p></section><div contenteditable="true" id="draft">Play</div></main>`, '/games');
  const original = Object.fromEntries(['plain','name','bio','post','fake','fake-section','draft'].map(id=>[id,f.text(id)]));
  f.run(); for (const [id, value] of Object.entries(original)) assert.equal(f.text(id), value, id); f.dom.window.close();
});

test('ja: Tweet 2.5 game rollup localizes generated suffixes while preserving actor names and the native row', () => {
  const name = 'Play and Best';
  const f = fixture('ja', `<main><button type="button" data-testid="games-rollup-row" class="w-full flex items-center" id="rollup" aria-label="${name} and 2 others you follow shared today’s TWIRDLE">
    <span><svg></svg></span><span class="truncate" id="rollup-text" title="${name} and 2 others you follow shared today’s TWIRDLE">${name} and 2 others shared TWIRDLE</span><svg></svg></button>
    <article><p class="tl-user-text" id="body">${name} and 2 others shared TWIRDLE</p></article>
    <button data-testid="games-rollup-row"><span class="truncate" id="fake-rollup">Play and Best and 2 others shared TWIRDLE</span></button></main>`);
  const row = f.document.getElementById('rollup'), text = f.document.getElementById('rollup-text'), node = text.firstChild; let opened = 0; row.onclick = () => opened++;
  f.run();
  assert.equal(text.textContent, `${name}さんと、ほか2人がTWIRDLEの結果を共有しました`);
  assert.equal(row.getAttribute('aria-label'), `フォロー中の${name}さんと、ほか2人が今日のTWIRDLEの結果を共有しました`);
  assert.equal(text.title, row.getAttribute('aria-label')); assert.equal(text.firstChild, node); assert.equal(f.text('body'), `${name} and 2 others shared TWIRDLE`);
  assert.equal(f.text('fake-rollup'), `${name} and 2 others shared TWIRDLE`); row.click(); assert.equal(opened, 1);
  f.dom.window.qaClassic = false; f.run(); assert.equal(text.textContent, `${name}さんと、ほか2人がTWIRDLEの結果を共有しました`);
  node.nodeValue = '3 people shared games'; text.title = '3 people shared games'; f.run(); assert.equal(text.textContent, '3人がゲームの結果を共有しました');
  f.dom.window.close();
});

test('ja: Tweet 2.5 empty puzzle sentence keeps three adjacent React nodes and natural Japanese after a date update', () => {
  const f = fixture('ja', `<main><div class="animate-fadeIn"><div class="sticky"><button aria-label="Back"><svg></svg></button><div><h2 class="truncate">TWIRDLE</h2></div></div>
    <p class="p-6 text-center text-tl-app-text-muted" id="empty-puzzle"></p><p id="generic-prefix">There’s no</p></div></main>`, '/games/twirdle');
  const paragraph = f.document.getElementById('empty-puzzle');
  const prefix = f.document.createTextNode('There’s no TWIRDLE ');
  const day = f.document.createTextNode('today');
  const suffix = f.document.createTextNode('. A new one opens at midnight ET.');
  paragraph.append(prefix, day, suffix);
  f.run();
  assert.equal(paragraph.textContent, 'TWIRDLE： 今日の問題はありません。新しい問題は米国東部時間の午前0時に公開されます。');
  assert.deepEqual([...paragraph.childNodes], [prefix, day, suffix]);
  assert.equal(f.text('generic-prefix'), 'There’s no', 'a generic prefix does not authorize inferred translation');
  day.nodeValue = 'for that day'; f.run(day);
  assert.equal(paragraph.textContent, 'TWIRDLE： 指定した日付の問題はありません。新しい問題は米国東部時間の午前0時に公開されます。');
  assert.deepEqual([...paragraph.childNodes], [prefix, day, suffix]);
  f.dom.window.qaClassic = false; f.run();
  assert.equal(paragraph.textContent, 'TWIRDLE： 指定した日付の問題はありません。新しい問題は米国東部時間の午前0時に公開されます。');
  f.dom.window.close();
});

function native26Settings(title, description, content) {
  return `<main><section class="flex sm:flex flex-col flex-1 min-w-0 self-stretch">
    <div class="flex items-center gap-3 px-4 py-3 border-b border-tl-app-border sm:hidden"><button type="button" aria-label="Back to settings"></button><span class="text-sm font-extrabold text-tl-app-text" id="mobile-title">${title}</span></div>
    <div class="p-5"><div class="flex flex-col gap-5"><div><h4 class="text-sm font-extrabold text-tl-app-text" id="heading">${title}</h4><p class="text-tl-app-text-muted mt-0.5 leading-relaxed" id="description">${description}</p></div>${content}</div></div>
  </section></main>`;
}

function native26LanguageSettings() {
  return native26Settings('Language', 'Choose how posts in other languages appear.', `<div class="rounded-2xl border border-tl-app-border">
    <div class="flex items-start justify-between gap-3 px-4 py-3.5"><div class="flex flex-col min-w-0 flex-1"><span id="auto-label" class="font-bold text-tl-app-text-muted uppercase tracking-wide inline-flex">Auto-translate</span><span id="auto-hint" class="text-xs text-tl-app-text mt-0.5 leading-relaxed">Posts and replies that aren’t in your language show translated, marked “Translated from …”. Tap the translate icon on a post to see the original.</span></div><button type="button" role="switch" aria-checked="false" aria-labelledby="auto-label" aria-describedby="auto-hint" id="native-auto"></button></div>
    <div><label for="target-lang" class="font-bold uppercase tracking-wide">Translate into</label><select id="target-lang"><option value="">Browser language (English)</option><option value="zh-CN">Chinese (Simplified)</option><option value="zh-TW">Chinese (Traditional)</option><option value="en" selected>English</option></select></div>
    <div class="flex items-center justify-between gap-3 px-4 py-3.5"><p class="text-tl-app-text-muted leading-relaxed" id="locked">Auto-translate is included with Founder, Fighter and Centurion plans. You can still translate any post with the translate icon.</p><button type="button" id="plans">See plans</button></div></div>
    <div aria-live="polite"><div role="status" aria-live="polite" id="save">Saved.</div></div>`);
}

test('ja: Tweet 2.6 language settings retain switch state, dynamic label relationships and target values', () => {
  const f = fixture('ja', native26LanguageSettings(), '/settings');
  const toggle = f.document.getElementById('native-auto'), select = f.document.getElementById('target-lang');
  const options = [...select.options]; let changes = 0; toggle.onclick = () => changes++;
  for (const classic of [true, false, true]) { f.dom.window.qaClassic = classic; f.run(); }
  assert.equal(f.text('heading'), '言語'); assert.equal(f.text('mobile-title'), '言語');
  assert.equal(f.text('description'), '他の言語のツイートの表示方法を設定します。');
  assert.equal(f.text('auto-label'), '自動翻訳'); assert.match(f.text('auto-hint'), /翻訳アイコン/);
  assert.match(f.text('locked'), /Founder・Fighter・Centurion/); assert.equal(f.text('plans'), 'プランを見る');
  assert.equal(f.text('save'), '保存しました。'); assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(toggle.getAttribute('aria-labelledby'), 'auto-label'); assert.equal(toggle.getAttribute('aria-describedby'), 'auto-hint');
  assert.equal(select.value, 'en'); assert.deepEqual([...select.options], options);
  assert.deepEqual([...select.options].map(o => o.value), ['', 'zh-CN', 'zh-TW', 'en']);
  assert.deepEqual([...select.options].map(o => o.textContent), ['ブラウザの言語（英語）', '中国語（簡体字）', '中国語（繁体字）', '英語']);
  assert.equal(changes, 0); toggle.click(); assert.equal(changes, 1);
  assert.equal(f.document.querySelector('label[for="target-lang"]').textContent, '翻訳先の言語');
  f.dom.window.close();
});

test('ja: Tweet 2.6 native language save errors and redraw preserve disabled state without enabling translation', () => {
  const f = fixture('ja', native26LanguageSettings(), '/settings');
  const toggle = f.document.getElementById('native-auto'); toggle.disabled = true; f.run();
  for (const [source, expected] of [['Couldn’t save. Try again.', '保存できませんでした。もう一度お試しください。'], ['Couldn’t load your language settings. Try again later.', '言語設定を読み込めませんでした。しばらくしてから再度お試しください。']]) {
    f.document.getElementById('save').firstChild.nodeValue = source; f.run(); assert.equal(f.text('save'), expected);
  }
  const label = f.document.getElementById('auto-label'); label.id = 'native-rerender-id'; label.firstChild.nodeValue = 'Auto-translate'; toggle.setAttribute('aria-labelledby', label.id);
  f.run(); assert.equal(label.textContent, '自動翻訳'); assert.equal(toggle.disabled, true); assert.equal(toggle.getAttribute('aria-checked'), 'false');
  f.dom.window.close();
});

test('ja: Tweet 2.6 notified accounts localizes chrome and split counters while retaining names and actions', () => {
  const f = fixture('ja', native26Settings('Notified accounts', 'You get a notification when these accounts post. Turn it on from the bell on a profile you follow, for up to 25 accounts.', `<p class="text-xs text-tl-app-text-muted px-1" id="used"></p>
    <div class="rounded-2xl border"><div class="flex items-center gap-3 px-4 py-3.5"><div class="relative group flex items-center gap-3 min-w-0 flex-1"><button type="button" class="text-xs font-bold truncate" aria-label="View @saved's profile" id="name">Saved.</button><span class="truncate" id="handle">@saved</span></div><button type="button" aria-label="Turn off post notifications for @saved" id="turn-off">Turn off</button></div></div>
    <p class="text-xs text-tl-app-text-muted px-1 py-6 text-center" id="empty">You haven't turned on post notifications for anyone.</p>
    <div role="status" aria-live="polite" id="failed">Could not turn off post notifications for @saved. Please try again.</div>`), '/settings');
  const used = f.document.getElementById('used'); for (const t of ['1', ' of ', '25', ' used']) used.append(f.document.createTextNode(t));
  const nodes = [...used.childNodes], button = f.document.getElementById('turn-off'); let off = 0; button.onclick = () => off++;
  f.run(); f.run(); assert.equal(f.text('heading'), '投稿通知するアカウント'); assert.equal(f.text('mobile-title'), '投稿通知するアカウント');
  assert.match(f.text('description'), /最大25アカウント/); assert.equal(f.text('used'), '1 / 25 アカウントを設定中'); assert.deepEqual([...used.childNodes], nodes);
  assert.equal(f.text('name'), 'Saved.'); assert.equal(f.text('handle'), '@saved');
  assert.equal(button.textContent, 'オフにする'); assert.equal(button.getAttribute('aria-label'), '@savedの投稿通知をオフにする'); assert.equal(off, 0);
  assert.match(f.text('empty'), /オンにしているアカウントはありません/); assert.match(f.text('failed'), /^@savedの投稿通知をオフにできません/);
  nodes[0].nodeValue = '2'; f.run(); assert.equal(f.text('used'), '2 / 25 アカウントを設定中');
  button.setAttribute('aria-label', 'Turning off post notifications for @saved'); button.disabled = true; f.run();
  assert.equal(button.getAttribute('aria-label'), '@savedの投稿通知をオフにしています…'); assert.equal(button.disabled, true);
  button.disabled = false; button.click(); assert.equal(off, 1); f.dom.window.close();
});

function native26TranslationControl(mode = 'idle') {
  return `<span class="inline-flex items-center"><button type="button" class="p-2 rounded-full" data-translate-mode="${mode}" aria-label="Translate post" aria-pressed="${mode === 'active'}" title="${mode === 'active' ? 'Show original' : 'Show translation'}" id="translate"><svg aria-hidden="true"></svg></button><span data-translate-status tabindex="-1" role="status" aria-live="polite" class="sr-only" id="announcement">${mode === 'active' ? 'Showing the translation.' : 'Showing the original post.'}</span></span>`;
}

test('ja: Tweet 2.6 icon translation states and source metadata preserve native handlers, body and state', () => {
  const f = fixture('ja', `<article>${native26TranslationControl()}<div class="mt-0.5"><p class="text-tl-app-text-muted" id="source">Translated from English</p></div><p class="tl-user-text whitespace-pre-wrap break-words" id="body">Translate post\nSaved.</p><button class="font-bold truncate" id="author">Translated</button></article>`);
  const button = f.document.getElementById('translate'), svg = button.firstElementChild; let clicks = 0; button.onclick = () => clicks++;
  for (const [mode, title, announcement, expected] of [
    ['idle', 'Show translation', 'This post is already in your language.', 'このツイートは翻訳先と同じ言語です。'],
    ['busy', 'Translating post…', 'Translating post…', 'ツイートを翻訳中…'],
    ['active', 'Show original', 'Showing the translation.', '訳文を表示しています。'],
    ['original', 'Show translation', 'Showing the original post.', '原文を表示しています。']
  ]) {
    button.dataset.translateMode = mode; button.setAttribute('aria-label', 'Translate post'); button.title = title;
    button.setAttribute('aria-pressed', String(mode === 'active')); button.setAttribute('aria-busy', String(mode === 'busy'));
    f.document.getElementById('announcement').firstChild.nodeValue = announcement; f.run();
    assert.equal(button.getAttribute('aria-label'), 'ツイートを翻訳'); assert.equal(button.getAttribute('aria-pressed'), String(mode === 'active'));
    assert.equal(button.getAttribute('aria-busy'), String(mode === 'busy')); assert.equal(button.firstElementChild, svg);
    assert.equal(f.text('announcement'), expected); assert.equal(clicks, 0);
  }
  assert.equal(f.text('source'), '英語から翻訳'); assert.equal(f.text('body'), 'Translate post\nSaved.'); assert.equal(f.text('author'), 'Translated');
  button.click(); assert.equal(clicks, 1); f.dom.window.close();
});

test('ja: Tweet 2.6 profile bell on, off and busy retain native identity and subscription state', () => {
  const f = fixture('ja', `<main><div><div class="pt-3 shrink-0 flex items-center gap-2"><button type="button" data-icon="bell" aria-label="Turn on post notifications" aria-pressed="false" title="Turn on post notifications" class="inline-flex items-center justify-center rounded-full border p-2 min-w-10 min-h-10" id="bell"><svg></svg></button><button>Follow</button></div><p class="text-rose-500 leading-snug" id="error">Could not update post notifications. Try again.</p></div><h2 id="name">Turn on post notifications</h2><p data-testid="profile-bio" id="bio">Turn off post notifications</p></main>`, '/user/alice');
  const bell = f.document.getElementById('bell'); let clicks = 0; bell.onclick = () => clicks++;
  for (const on of [false, true, false]) {
    const text = on ? 'Turn off post notifications' : 'Turn on post notifications'; bell.dataset.icon = on ? 'bell-ring' : 'bell'; bell.setAttribute('aria-pressed', String(on)); bell.setAttribute('aria-label', text); bell.title = text; f.run();
    assert.equal(bell.getAttribute('aria-label'), `投稿通知を${on ? 'オフ' : 'オン'}にする`); assert.equal(bell.getAttribute('aria-pressed'), String(on)); assert.equal(clicks, 0);
  }
  bell.disabled = true; bell.replaceChildren(f.document.createElement('svg')); f.run(); assert.equal(bell.disabled, true);
  assert.match(f.text('error'), /投稿通知を変更できませんでした/); assert.equal(f.text('name'), 'Turn on post notifications'); assert.equal(f.text('bio'), 'Turn off post notifications');
  bell.disabled = false; bell.click(); assert.equal(clicks, 1); f.dom.window.close();
});

function native26PostNotice(actors, time = '2h', details = '') {
  return `<main><div class="border-b border-tl-app-border"><button type="button" class="w-full flex items-start gap-3 px-4 py-3.5 text-left" aria-expanded="false" id="notice"><div class="mt-0.5 shrink-0"><svg width="28" height="28" class="lucide lucide-bell-ring"></svg></div><div class="flex-1 min-w-0"><div class="flex items-center"></div><p class="text-tl-app-text leading-snug">${actors} <span class="text-tl-app-text-muted" id="posted">posted</span><span class="text-tl-app-text-muted" id="time"> · ${time}</span></p><p class="mt-1 text-tl-app-text-muted leading-snug line-clamp-2" id="preview">posted and Saved.</p></div></button>${details}</div></main>`;
}

test('ja: Tweet 2.6 grouped post notifications preserve actor names, preview and expansion while translating action/time', () => {
  const f = fixture('ja', native26PostNotice('<span class="font-extrabold" id="actor">Saved.</span> and <span class="font-extrabold" id="actor2">posted</span>'), '/notifications');
  // Match React: the separator and relative time are separate text nodes.
  const time = f.document.getElementById('time'); time.textContent = ''; time.append(' · ', '2h');
  const button = f.document.getElementById('notice'); let expands = 0; button.onclick = () => expands++;
  f.run(); f.run(); assert.equal(f.text('actor'), 'Saved.'); assert.equal(f.text('actor2'), 'posted');
  assert.equal(f.text('posted'), 'さんがツイートしました'); assert.equal(f.text('time'), ' · 2時間前'); assert.equal(f.text('preview'), 'posted and Saved.');
  assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(expands, 0); button.click(); assert.equal(expands, 1);
  assert.equal(f.document.querySelector('p.leading-snug').textContent, 'Saved.さんとpostedさんがツイートしました · 2時間前');
  f.dom.window.close();
});

test('ja: Tweet 2.6 expanded post notification times keep user names and previews intact', () => {
  const details = `<div class="pl-12 pr-4"><button class="w-full flex items-start gap-3 py-2.5"><div class="flex-1 min-w-0"><p class="text-tl-app-text leading-snug"><span class="font-extrabold" id="detail-name">October 18</span><span class="text-tl-app-text-muted" id="detail-time"></span></p><p class="text-tl-app-text-muted leading-snug line-clamp-2" id="detail-preview">Translated from English</p></div></button></div>`;
  const f = fixture('ja', native26PostNotice('<span class="font-extrabold">Alice</span>', '1m', details), '/notifications');
  f.document.getElementById('time').replaceChildren(' · ', '1m'); f.document.getElementById('detail-time').append(' · ', 'Oct 18');
  f.run(); assert.equal(f.text('detail-time'), ' · 10月18日'); assert.equal(f.text('detail-name'), 'October 18'); assert.equal(f.text('detail-preview'), 'Translated from English');
  f.dom.window.close();
});

test('ja: unverified 2.6 lookalikes, user text and arbitrary switches remain unchanged', () => {
  const f = fixture('ja', `<article><p class="tl-user-text" id="body">Notified accounts Translate post</p><button data-translate-mode="active" aria-pressed="true" aria-label="Translate post" id="unknown"><svg></svg></button></article><main><section><h4>Language</h4><span class="text-xs leading-relaxed" id="hint">Auto-translate</span><button role="switch" aria-checked="true" id="switch"></button></section><p id="notice">posted</p></main>`);
  f.run(); assert.equal(f.text('body'), 'Notified accounts Translate post'); assert.equal(f.text('hint'), 'Auto-translate');
  assert.equal(f.document.getElementById('unknown').getAttribute('aria-label'), 'Translate post'); assert.equal(f.document.getElementById('switch').getAttribute('aria-checked'), 'true'); assert.equal(f.text('notice'), 'posted'); f.dom.window.close();
});

test('ja: Tweet 2.6 inline reply translation source and errors use native mt-1 metadata without touching reply text', () => {
  const f = fixture('ja', `<article><div class="min-w-0 flex-1"><div class="flex items-center">${native26TranslationControl('active')}</div><p class="tl-user-text whitespace-pre-wrap break-words" id="reply-body">Couldn’t translate. Try again.</p><div class="mt-1"><p class="text-tl-app-text-muted" id="reply-source">Translated from English</p><p class="text-tl-app-text-muted" role="alert" id="reply-error">Couldn’t translate. Try again.</p></div></div></article>`);
  f.run(); f.run(); assert.equal(f.text('reply-source'), '英語から翻訳'); assert.equal(f.text('reply-error'), '翻訳できませんでした。もう一度お試しください。');
  assert.equal(f.text('reply-body'), 'Couldn’t translate. Try again.'); assert.equal(f.document.getElementById('translate').getAttribute('aria-pressed'), 'true');
  f.dom.window.close();
});

test('ja: Tweet 2.6 translated inline reply keeps its native relative age Japanese without fabricating an exact time', () => {
  const f = fixture('ja', `<article><div class="min-w-0 flex-1"><div class="flex items-center gap-1 min-w-0"><button class="font-bold truncate hover:underline" id="reply-name">Alice</button><span class="text-tl-app-text-muted">·</span><span class="text-tl-app-text-muted shrink-0" id="reply-age">2h</span><div class="flex items-center shrink-0 ml-auto">${native26TranslationControl('active')}<div><button><svg class="lucide-ellipsis-vertical"></svg></button></div></div></div><div class="mt-1"><p class="text-[0.8125rem] text-tl-app-text-muted">Translated from English</p></div><p class="tl-user-text whitespace-pre-wrap break-words" id="reply-text">翻訳された本文です。</p></div></article>`);
  f.run(); f.run(); assert.equal(f.text('reply-age'), '2時間前'); assert.equal(f.document.getElementById('reply-age').hasAttribute('title'), false);
  assert.equal(f.text('reply-name'), 'Alice'); assert.equal(f.text('reply-text'), '翻訳された本文です。'); f.dom.window.close();
});

test('ja: verified native translation languages use Japanese labels even with English browser names and preserve codes', () => {
  const f = fixture('ja', native26LanguageSettings() + `<article>${native26TranslationControl('active')}<div class="mt-1"><p class="text-tl-app-text-muted" id="foreign-source">Translated from French</p></div><p class="tl-user-text" id="foreign-body">French / Arabic / German</p></article>`, '/settings');
  const select = f.document.getElementById('target-lang');
  const codes = ['ar','bn','de','en','es','fa','fr','he','hi','id','it','ja','ko','ms','nl','pl','pt','ru','sv','sw','th','tl','tr','uk','ur','vi','zh-CN','zh-TW'];
  const names = ['Arabic','Bengali','German','English','Spanish','Persian','French','Hebrew','Hindi','Indonesian','Italian','Japanese','Korean','Malay','Dutch','Polish','Portuguese','Russian','Swedish','Swahili','Thai','Filipino','Turkish','Ukrainian','Urdu','Vietnamese','Chinese (Simplified)','Chinese (Traditional)'];
  select.replaceChildren();
  const browser = f.document.createElement('option'); browser.value = ''; browser.textContent = 'Browser language (German)'; select.append(browser);
  codes.forEach((code, i) => { const option = f.document.createElement('option'); option.value = code; option.textContent = names[i]; select.append(option); });
  select.value = 'de'; const originalOptions = [...select.options];
  f.run(); f.run(); assert.deepEqual([...select.options], originalOptions); assert.equal(select.value, 'de');
  assert.deepEqual([...select.options].map(o => o.value), ['', ...codes]);
  assert.equal(browser.textContent, 'ブラウザの言語（ドイツ語）'); assert.equal(select.options[1].textContent, 'アラビア語');
  assert.equal(select.options[3].textContent, 'ドイツ語'); assert.equal(select.options[28].textContent, '中国語（繁体字）');
  assert.ok([...select.options].slice(1).every(o => /語/.test(o.textContent))); assert.equal(f.text('foreign-source'), 'フランス語から翻訳'); assert.equal(f.text('foreign-body'), 'French / Arabic / German');
  f.dom.window.close();
});
