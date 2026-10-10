const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editions = require('../docs/DISTRIBUTIONS.json');
const { version } = require('../package.json');
const readmeUrl = 'https://github.com/Asukamaiyan/classic-twitter-for-tweet-app#readme';
const managerUrls = {
  chrome: 'https://www.tampermonkey.net/index.php?browser=chrome',
  safari: 'https://apps.apple.com/app/id1591620171',
  android: 'https://addons.mozilla.org/en-US/android/addon/tampermonkey/'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function link(url, label) {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

function scriptName(edition) {
  const code = fs.readFileSync(path.join(root, edition.file), 'utf8');
  const match = code.match(/^\/\/ @name\s+(.+)$/m);
  if (!match) throw new Error(`Missing @name: ${edition.file}`);
  return match[1].trim();
}

function editionTable(locale) {
  const labels = locale === 'ja'
    ? { chrome: 'PC Chrome', safari: 'Safari', android: 'Android Firefox' }
    : { chrome: 'Desktop Chrome', safari: 'Safari', android: 'Android Firefox' };
  const rows = Object.entries(labels).map(([platform, label]) => {
    const ja = editions.find(item => item.platform === platform && item.locale === 'ja');
    const en = editions.find(item => item.platform === platform && item.locale === 'en');
    // Greasy Fork may remove inline styles and its table cells have no padding.
    return `<tr><td>${label}&emsp;</td><td>${link(ja.page, '日本語')}&emsp;</td><td>${link(en.page, 'English')}</td></tr>`;
  });
  return `<table><thead><tr><th>${locale === 'ja' ? '環境' : 'Browser'}&emsp;</th><th>日本語&emsp;</th><th>English</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function render(edition) {
  if (!edition || !editions.some(item => item.key === edition.key)) throw new Error('Unknown edition');
  const japanese = edition.locale === 'ja';
  const name = scriptName(edition);
  const manager = edition.platform === 'safari' ? 'Stay for Safari' : 'Tampermonkey';
  const browser = (japanese
    ? { chrome: 'PC版Chrome', safari: 'Safari', android: 'Android版Firefox' }
    : { chrome: 'Desktop Chrome', safari: 'Safari', android: 'Android Firefox' })[edition.platform];
  const heading = japanese
    ? `日本語版 · ${browser} · ${version}`
    : `English edition · ${browser} · ${version}`;
  const needs = japanese ? '必要なもの' : 'What you need';
  const install = japanese ? '初回導入' : 'First installation';
  const update = japanese ? '更新' : 'Update';
  const codeLabel = japanese ? 'このSafari版のコードURL' : 'This Safari edition’s code URL';
  const codeLink = link(edition.codeUrl, codeLabel);
  let steps;
  let updateText;

  if (edition.platform === 'safari') {
    steps = japanese ? [
      `${link(managerUrls.safari, 'Stay for Safari')}を入れ、Safariの「拡張機能」でStayをオンにしてtweet.appへのアクセスを許可。`,
      `${codeLink}のリンクをコピー（コード本文のコピーは不要）。`,
      'Stayの「リンクから追加」に貼り付けて保存し、ライブラリでこのスクリプトを有効化。',
      `Safariで${link('https://app.tweet.app/', 'tweet.app')}を開く／再読み込み。`
    ] : [
      `Install ${link(managerUrls.safari, 'Stay for Safari')}. Enable Stay in Safari’s Extensions settings and allow access to tweet.app.`,
      `Copy the link to ${codeLink}; you do not need to copy the code itself.`,
      'Paste it into Stay’s link import, save it, then enable this script in Library.',
      `Open or reload ${link('https://app.tweet.app/', 'tweet.app')} in Safari.`
    ];
    updateText = japanese
      ? 'Stayでこのスクリプトの<strong>「更新」ボタン</strong>を押す → tweet.appを再読み込み。'
      : 'Press <strong>Update</strong> for this script in Stay, then reload tweet.app.';
  } else {
    const android = edition.platform === 'android';
    const managerLink = link(managerUrls[edition.platform], 'Tampermonkey');
    const first = android
      ? japanese
        ? `Android版${link('https://www.mozilla.org/ja/firefox/browsers/mobile/android/', 'Firefox')}に${managerLink}を追加。`
        : `Install ${link('https://www.mozilla.org/en-US/firefox/browsers/mobile/android/', 'Firefox for Android')}, then add ${managerLink} to Firefox.`
      : japanese ? `PC版Chromeに${managerLink}を追加。` : `Add ${managerLink} to desktop Chrome.`;
    const permission = android
      ? japanese
        ? 'Firefoxの「拡張機能」でTampermonkeyをオンにし、Tampermonkey内でこのスクリプトを有効化。'
        : 'Enable Tampermonkey in Firefox’s Extensions settings, then enable this script inside Tampermonkey.'
      : japanese
        ? 'Chromeの拡張機能 → Tampermonkeyの「詳細」→「ユーザースクリプトを許可」をオン。'
        : 'In Chrome’s Extensions settings, open Tampermonkey’s Details and enable “Allow User Scripts”.';
    steps = japanese ? [
      first,
      'このページ上部の<strong>「スクリプトをインストール」</strong>を押し、Tampermonkeyの確認画面でも<strong>「インストール」</strong>。',
      permission,
      `${link('https://app.tweet.app/', 'tweet.app')}を開く／再読み込み。`
    ] : [
      first,
      'Press <strong>Install this script</strong> at the top of this page, then confirm <strong>Install</strong> in Tampermonkey.',
      permission,
      `Open or reload ${link('https://app.tweet.app/', 'tweet.app')}.`
    ];
    updateText = japanese
      ? 'Tampermonkeyのメニューから<strong>「UserScript の更新を確認」</strong> → 更新があれば案内に従って適用 → tweet.appを再読み込み。'
      : 'Choose <strong>Check for userscript updates</strong> in Tampermonkey’s menu, apply any available update when prompted, then reload tweet.app.';
  }

  const platformNote = edition.platform === 'android'
    ? japanese ? '<p>AndroidではFirefoxを使います。通常のAndroid版Chromeではこの拡張機能は使えません。</p>' : '<p>Use Firefox on Android; standard Android Chrome cannot run this extension.</p>'
    : '';
  const current = japanese ? 'このページのスクリプト' : 'The script on this page';
  const features = japanese
    ? '昔のTwitter風の表示、星のお気に入り、通知フィルターを追加。日本ニュースの「配信元」でYahoo・NHK・日刊スポーツ・ITmediaをジャンルごとに選択できます（最低1つ）。失敗した配信元は名前を表示し、全て失敗したときは元ニュースと「再試行」を表示。任意RSSの追加は未対応です。プロフィールの写真・動画／お気に入りでも拡大写真が指に追従して切り替わります。本文・名前・下書き・サイトのテーマを保持します。'
    : 'Adds classic Twitter styling, star Favorites and notification filters. In Japan news, Publishers selects the existing Yahoo, NHK, Nikkan Sports and ITmedia feeds per topic (at least one). Failures name unavailable publishers; a complete failure keeps native news and Retry. Arbitrary RSS URLs are not supported. Enlarged profile Media/Favorites photos follow horizontal dragging. Preserves post text, names, drafts and the site theme.';
  const safariFeature = edition.platform === 'safari'
    ? japanese ? '<p>Safari版は写真・動画の長押しで配信ファイル情報も表示します。</p>' : '<p>The Safari edition also shows delivered media file information on a long press.</p>'
    : '';
  const safariNewsPermission = edition.platform === 'safari'
    ? japanese
      ? '<p>日本ニュースが出ないとき：Safariのページメニュー → Stay → 表示されたニュースサイトだけを許可 → ニュースの「再試行」。対象は <code>news.yahoo.co.jp</code> / <code>news.web.nhk</code> / <code>www.nikkansports.com</code> / <code>rss.itmedia.co.jp</code>。</p>'
      : '<p>If Japan news does not appear: Safari’s page menu → Stay → allow only the news sites shown → Retry in News. Sites: <code>news.yahoo.co.jp</code> / <code>news.web.nhk</code> / <code>www.nikkansports.com</code> / <code>rss.itmedia.co.jp</code>.</p>'
    : '';

  return [
    `<h2>${escapeHtml(heading)}</h2>`,
    `<h3>${needs}</h3>`,
    `<ul><li>${escapeHtml(browser)} ${japanese ? '＋' : '+'} ${link(managerUrls[edition.platform], manager)}</li><li>${current}${japanese ? '：' : ': '}<strong>${link(edition.page, name)}</strong></li></ul>`,
    `<h3>${install}</h3><ol>${steps.map(step => `<li>${step}</li>`).join('')}</ol>`,
    platformNote,
    `<h3>${update}</h3><p>${updateText}</p>`,
    safariNewsPermission,
    `<p><strong>${japanese ? '有効にするのは環境と言語に合う1本だけ。別の版へ切り替えるときは、前の版を無効にしてください。' : 'Enable only one edition for your browser and language. Disable the previous edition when switching.'}</strong></p>`,
    `<h3>${japanese ? '版を選ぶ' : 'Choose an edition'}</h3>`,
    editionTable(edition.locale),
    `<p>${japanese ? 'URLカード：リンク先のタイトル・説明・画像を表示。「開く」「リンクをコピー」「リンクを共有」が使えます。失敗時も「プレビューを取得」で再試行。便利ツールで自動取得をオフにすると、必要なカードだけ「プレビューを取得」で読み込めます。ホームの「リンク付きのみ」は、読み込み済み投稿の確認範囲も表示します。' : 'URL cards show a link’s title, description and image, with Open, Copy link and Share link. Use Load preview to retry after failure. Turn automatic previews off in Tools to load individual cards with Load preview. The Home links-only filter shows its coverage of loaded posts.'}</p>`,
    `<p>${japanese ? '更新時にリンク先サイトへの接続権限が追加されます。カードは公開HTTPSページと画像を直接読み、プレビュー代行サービスは使いません。Tweetの認証情報・投稿本文は送りません。Stayで画像が出ない場合はリンク先・画像配信先のアクセス許可を確認。取得できないサイトはURLのみ表示します。' : 'This update adds permission to connect to link destinations. Cards read public HTTPS pages and images directly, without a preview service or Tweet credentials/post text. In Stay, check access permission for the destination and image host if previews do not load. Unavailable sites keep a plain URL fallback.'}</p>`,
    `<p>${features}</p>`,
    `<p>${japanese ? 'Tweet 2.3.0に対応。通知のアイコンはそれぞれのプロフィールを開き、標準の返信通知・投票・ブロックを使います。保存したGIFのループ再生と「編集済み」表示も対応。ブロック・ミュート相手の保存投稿は表示しません。' : 'Updated for Tweet 2.3.0. Each notification avatar opens its own profile; native reply notifications, polls and blocking remain in use. Saved GIFs support looping playback and saved edited posts show Edited. Posts from blocked or muted accounts stay hidden.'}</p>`,
    `<p>${japanese ? 'bioの改行を保持。拡大写真の「配信画像を開く」で提供画像を直接開き、写真・動画の読み込んだ解像度を表示します。写真切替の準備は前後だけに限定。配信データ以上の高画質化や4K／HDR保持はできません。' : 'Preserves bio line breaks. Open image in enlarged photos opens the delivered file; loaded image/video dimensions are shown. Swipe preparation is limited to adjacent photos. This cannot increase delivered resolution or guarantee 4K/HDR retention.'}</p>`,
    `<p>${japanese ? '通知は「便利ツール」→「通知数が増えたらお知らせする」をオンにして許可（初期オフ）。ページを開いている間の未読数増加を通知し、名前・本文は表示しません。閉じる・スマホで停止すると届かず、iPhoneの通常Safariなど非対応環境では理由を表示します。' : 'For alerts: Tools → Alert when the unread count increases, then allow notifications (off by default). Alerts use native unread increases while Tweet is open and include no names or post text. Closing or suspending the page stops alerts; unsupported environments, including regular iPhone Safari tabs, show a reason.'}</p>`,
    `<p>${japanese ? '過去のお気に入りは「便利ツール」→「過去の投稿から探す」。画面を開いたまま使い、「続きから探す」で再開できます（1回100ページまで）。返されるタイムラインの範囲で復元するため、全履歴は保証できません。プロフィールの「お気に入り」は件数・期間・確認範囲と保存した投稿を表示し、JSONバックアップができます。写真は中央で拡大し、動画の「全画面表示」は同じプレーヤーを使います。' : 'For older Favorites: Tools → Search older posts, then Continue searching to resume (up to 100 pages per run while visible). Recovery covers returned timelines and cannot guarantee your entire history. Your profile’s Favorites tab shows saved posts, counts, date range and recovery coverage, with JSON backups. Enlarged photos are centered; video fullscreen keeps the same player.'}</p>`,
    safariFeature,
    `<p>${link(readmeUrl, japanese ? '機能・保存データ・対応範囲の詳細' : 'Features, saved data and compatibility details')}</p>`
  ].filter(Boolean).join('\n') + '\n';
}

module.exports = { editions, render, scriptName };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--output-dir' && args.length === 2) {
    const outputDir = path.resolve(args[1]);
    fs.mkdirSync(outputDir, { recursive: true });
    for (const edition of editions) fs.writeFileSync(path.join(outputDir, `${edition.key}.html`), render(edition));
    process.stdout.write(`Wrote ${editions.length} Greasy Fork descriptions to ${outputDir}\n`);
  } else if (args[0] === '--json' && args.length === 1) {
    process.stdout.write(JSON.stringify(editions.map(edition => ({ ...edition, name: scriptName(edition), html: render(edition) })), null, 2) + '\n');
  } else if (args.length === 1 && editions.some(edition => edition.key === args[0])) {
    process.stdout.write(render(editions.find(edition => edition.key === args[0])));
  } else {
    process.stderr.write('Usage: node scripts/greasyfork-info.cjs <edition-key> | --json | --output-dir <directory>\n');
    process.exitCode = 1;
  }
}
