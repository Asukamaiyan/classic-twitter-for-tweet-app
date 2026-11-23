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

  const mobileChromeNote = japanese
    ? `<p>スマホのChromeではこのスクリプトは動きません。使う場合はiPhone／iPadならSafari＋Stay、AndroidならFirefox＋Tampermonkeyを選んでください。${link('https://support.google.com/chrome/answer/2664769?hl=ja', 'Chromeの拡張機能ヘルプ')}</p>
<p>スマホのChromeからは${link('https://app.tweet.app/', '公式Web版のTweet')}を利用できます。iPhone／iPadは共有から「ホーム画面に追加」、AndroidはChromeのメニューからホーム画面に追加またはウェブアプリをインストールします。ホーム画面のアイコンで利用できるのは公式Web版の機能です。${link('https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS&hl=ja', 'iPhone／iPadの手順')}・${link('https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=ja', 'Androidの手順')}</p>`
    : `<p>Standard mobile Chrome does not run this script. Use Safari with Stay on iPhone or iPad, or Firefox with Tampermonkey on Android. ${link('https://support.google.com/chrome/answer/2664769?hl=en', 'Chrome extensions help')}</p>
<p>To use Tweet in mobile Chrome, open the ${link('https://app.tweet.app/', 'official Tweet web app')}. On iPhone or iPad, choose Add to Home Screen from Share. On Android, use Chrome’s menu to add it to the home screen or install the web app. The icon opens Tweet’s own web experience. ${link('https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS&hl=en', 'iPhone and iPad instructions')}, ${link('https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en', 'Android instructions')}</p>`;
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
    mobileChromeNote,
    `<h3>${update}</h3><p>${updateText}</p>`,
    safariNewsPermission,
    `<p><strong>${japanese ? '有効にするのは環境と言語に合う1本だけ。別の版へ切り替えるときは、前の版を無効にしてください。' : 'Enable only one edition for your browser and language. Disable the previous edition when switching.'}</strong></p>`,
    `<h3>${japanese ? '版を選ぶ' : 'Choose an edition'}</h3>`,
    editionTable(edition.locale),
    `<p>${japanese ? '6.32.4はネストの通知・管理・招待、フィード設定の通知、テーマ、ミュート期間、招待リンク、アカウントメニューの案内を日本語化しました。' : '6.32.4 expands Japanese localization for Nest controls, feed feedback, theme options, mute durations, referral links, and account navigation.'}</p>`,
    `<p>${japanese ? '6.32.3はネストの作成上限と招待設定、動画、フォロー中のハッシュタグ、ミュートの説明を日本語化しました。' : '6.32.3 completes Japanese localization for Nest limits and invitations, video, followed hashtags, and mute settings.'}</p>`,
    `<p>${japanese ? '6.29.2では独自URLカードをいったん削除しました。リンク先のタイトル・説明・画像の取得とプレビュー操作・自動取得設定を外し、元の投稿本文と通常のURLリンクを保持します。カード用の外部通信は行いません。ホームの「リンク付きのみ」は引き続き使えます。' : 'Version 6.29.2 temporarily removes custom URL cards, metadata/image fetching, preview controls and automatic-preview settings. Original post text and ordinary URL links remain. No custom card requests are made to link destinations. The Home links-only filter remains available.'}</p>`,
    `<p>${japanese ? '6.32.2は写真の横送りで同じ大きさを繰り返し計算する処理を減らしました。' : '6.32.2 reduces repeated photo layout calculation while scrolling a carousel.'}</p>`,
    `<p>${japanese ? '6.32.1はフィード設定（Perch）とホームの固定ネストの操作を日本語化します。' : '6.32.1 updates Japanese labels for the Perch and pinned Nest controls and documents mobile Chrome options.'}</p>`,
    `<p>${japanese ? '6.32.0はTweetのNestsの操作UIを日本語化。便利ツールはTweetの標準ミュート設定へ案内し、ブラウザ内の折りたたみも使えます。' : '6.32.0 integrates Tweet’s native mute settings into Tools and keeps browser-only post collapse available.'}</p>`,
    `<p>${japanese ? '6.31.0は写真ごとの縦横比に合わせて表示領域の高さを調整します。固定の黒い写真枠を外し、横長・縦長・正方形を切り取らず表示。複数写真を切り替えると今の写真に合う高さへ変わり、極端に縦長の写真は画面内の上限へ収めます。小さな写真は拡大せず、透明な操作領域は44px以上を保持。未読込・失敗は実寸が分かるまで中立の仮領域を使います。説明文を開いている間は読める領域を確保し、閉じると写真の高さへ戻ります。元の写真・説明文・操作・保存データを保持します。' : '6.31.0 fits the visible area to each selected photo rather than a fixed black frame. Keep complete portrait, landscape and square photos, update height when changing photos, and bound very tall images by the viewport. Small images are not enlarged, with a transparent minimum 44px pointer target; unknown/error resources keep a neutral placeholder until their own size is known. Native ALT opens in a readable area and returns to fitted photo height when closed. Original photos, descriptions, native actions and saved data remain intact.'}</p>`,
    `<p>${japanese ? '6.30.0はTweet 2.9.0の画像ALTに対応。日本語版は説明文の編集・表示の案内だけを日本語化し、説明文・入力・画像alt・元の操作を保持します。新しい写真構造に追従し、写真・動画／保存お気に入りとJSONバックアップで取得済み説明文をそのまま保持。拡大写真は説明文・画像・配信画像リンクの領域を分けます。独自のALT編集や投稿APIは追加しません。' : '6.30.0 follows Tweet 2.9.0 image ALT. Keep descriptions, editor values, image alt and native actions intact. Follow the new image structure and retain available descriptions in read-only Media/Favorites and JSON backups. Enlarged photos keep separate space for native descriptions and delivered-image controls. No extra ALT editing or post API is added.'}</p>`,
    `<p>${japanese ? '6.29.3では便利ツールの日本語変換中のEscape・未確定の保存を防ぎ、保存一覧の削除後も隣の操作へフォーカスを保ちます。長い名前でも削除ボタンが縮みません。標準GIF検索の操作UIを日本語化し、検索語・GIF名・選択を保持します。' : '6.29.3 keeps Tools open while an IME handles Escape, avoids saving unfinished composition, and keeps focus beside a removed saved item. Remove controls stay usable beside long names. Native GIF search, result names and selection stay native.'}</p>`,
    `<p>${features}</p>`,
    `<p>${japanese ? '6.29.2では、翻訳の処理中などに「いいね」を解除した投稿が、拡張のお気に入り一覧に残る問題を修正しました。復元処理の古い応答が解除した投稿を戻す競合も防ぎます。時間を空けた再登録にも対応します。投稿の同一性と確認済み原文を使って同期し、訳文を原文として保存しません。' : '6.29.2 fixes posts remaining in local Favorites after a native unlike while translation is busy or uncertain, and prevents older recovery results from undoing a newer favorite action. Verified originals remain available for later re-likes on the same post. Synchronization uses verified post identity and original text; a translation is never stored as the original.'}</p>`,
    `<p>${japanese ? '公開HTML・bundleでTweet 2.9.0 / build 1792965394を確認。新しいKLIPYのGIF選択は標準機能を使います。拡張の写真・動画／お気に入りでは新しいklipy_gif専用metadataの再現は未対応。自動翻訳は標準の「設定」→「言語」を使用（Founder・Fighter・Centurionプラン）。拡張独自の自動翻訳は削除し、対応Chromeの端末内翻訳は手動のみ。新しい言語設定・翻訳アイコン・プロフィールの投稿通知ベル・「投稿通知するアカウント」を日本語化。Games／TWIRDLEも標準のカードと操作を保持。固定・入れ替え・一番上への移動と元に戻す案内、ショップを日本語化。標準の操作と本文・名前を保持。ログイン中の端末と返信先の時刻・リンクも日本語化。通知のアイコンはそれぞれのプロフィールを開き、標準の返信通知・投票・ブロックを使います。保存したGIFのループ再生と「編集済み」表示も対応。ブロック・ミュート相手の保存投稿は表示しません。' : 'Public HTML and bundle identify Tweet 2.9.0 / build 1792965394. Keep its KLIPY GIF picker native; extension-owned Media/Favorites do not yet reproduce the new klipy_gif metadata. Use native Settings → Language for automatic translation (Founder, Fighter and Centurion plans). Duplicate automatic translation has been removed; optional Chrome on-device translation is manual only. Native profile notification bells and Settings → Notified accounts remain authoritative. Native Games/TWIRDLE cards and controls remain authoritative. Native profile pinning and its English labels remain authoritative. Authenticated API reads preserve the native device identity. Each notification avatar opens its own profile; native reply notifications, polls and blocking remain in use. Saved GIFs support looping playback and saved edited posts show Edited. Posts from blocked or muted accounts stay hidden.'}</p>`,
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
