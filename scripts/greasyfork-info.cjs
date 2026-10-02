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
    ? '昔のTwitter風の表示、星のお気に入り、通知フィルター、写真スライドなどを追加。本文・名前・下書き・サイトのテーマは保持します。'
    : 'Adds classic Twitter styling, star Favorites, notification filters and photo slides. Keeps post text, names, drafts and the site theme intact.';
  const safariFeature = edition.platform === 'safari'
    ? japanese ? '<p>Safari版は写真・動画の長押しで配信ファイル情報も表示します。</p>' : '<p>The Safari edition also shows delivered media file information on a long press.</p>'
    : '';

  return [
    `<h2>${escapeHtml(heading)}</h2>`,
    `<h3>${needs}</h3>`,
    `<ul><li>${escapeHtml(browser)} ${japanese ? '＋' : '+'} ${link(managerUrls[edition.platform], manager)}</li><li>${current}${japanese ? '：' : ': '}<strong>${link(edition.page, name)}</strong></li></ul>`,
    `<h3>${install}</h3><ol>${steps.map(step => `<li>${step}</li>`).join('')}</ol>`,
    platformNote,
    `<h3>${update}</h3><p>${updateText}</p>`,
    `<p><strong>${japanese ? '有効にするのは環境と言語に合う1本だけ。別の版へ切り替えるときは、前の版を無効にしてください。' : 'Enable only one edition for your browser and language. Disable the previous edition when switching.'}</strong></p>`,
    `<h3>${japanese ? '版を選ぶ' : 'Choose an edition'}</h3>`,
    editionTable(edition.locale),
    `<p>${features}</p>`,
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
