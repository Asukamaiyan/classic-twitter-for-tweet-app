// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese
// @namespace    https://tweet.app/
// @version      6.3.2
// @description  tweet.appを旧Twitter風に日本語化。表示名、Founder Number、★お気に入り、リツイート、通知、返信通知補完、ローカルミュート、自分専用お気に入り一覧に対応。テーマには干渉しません。
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    muted: 'classicTwitterJP.mutedUsers',
    favorites: 'classicTwitterJP.favorites',
    replyNotices: 'classicTwitterJP.replyNotifications',
    replySeen: 'classicTwitterJP.replySeenIds',
    replyCounts: 'classicTwitterJP.replyCounts',
    replyInit: 'classicTwitterJP.replyWatcherInitialized'
  };

  const profileCache = new Map();
  const profilePending = new Map();

  // Safari / Stay でも認証付きAPIを再利用できるように短時間キャッシュ。
  let authCache = null;
  let authCacheCheckedAt = 0;
  let authCachePending = null;

  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const normUser = v => clean(v).replace(/^@/, '').toLowerCase();

  const validUser = v => {
    const s = clean(v).replace(/^@/, '');
    return /^[A-Za-z0-9_.-]{1,80}$/.test(s) ? s : null;
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  const JP = new Map([
    ['Home', 'ホーム'],
    ['Feed', 'ホーム'],
    ['Explore', '話題を検索'],
    ['Notifications', '通知'],
    ['Profile', 'プロフィール'],
    ['Settings', '設定'],
    ['For you', 'おすすめ'],
    ['Following', 'フォロー中'],
    ['Trending', 'トレンド'],
    ['Trends for you', 'おすすめのトレンド'],
    ['News', 'ニュース'],
    ['Sports', 'スポーツ'],
    ['Entertainment', 'エンターテインメント'],
    ['Technology', 'テクノロジー'],
    ['Top', '話題'],
    ['Latest', '最新'],
    ['People', 'ユーザー'],
    ['Photos', '画像'],
    ['Hashtags', 'ハッシュタグ'],
    ['All', 'すべて'],
    ['Verified', '認証済み'],
    ['Mentions', '@ツイート'],
    ['Posts', 'ツイート'],
    ['Post', 'ツイート'],
    ['Tweets', 'ツイート'],
    ['Tweet', 'ツイート'],
    ['Replies', '返信'],
    ['Reply', '返信'],
    ['Followers', 'フォロワー'],
    ['Follower', 'フォロワー'],
    ['Edit profile', 'プロフィールを編集'],
    ['Follow', 'フォロー'],
    ['Unfollow', 'フォロー解除'],
    ['Reposts', 'リツイート'],
    ['Repost', 'リツイート'],
    ['Retweets', 'リツイート'],
    ['Retweet', 'リツイート'],
    ['Quote', '引用ツイート'],
    ['Quote Tweet', '引用ツイート'],
    ['Quote Retweet', '引用ツイート'],
    ['Undo repost', 'リツイートを取り消す'],
    ['Undo retweet', 'リツイートを取り消す'],
    ['Like', 'お気に入り'],
    ['Likes', 'お気に入り'],
    ['Liked', 'お気に入り済み'],
    ['Liked by', 'お気に入りしたユーザー'],
    ['Unlike', 'お気に入りを解除'],
    ['Who to follow', 'おすすめユーザー'],
    ['Search', '検索'],
    ['Search Twitter', 'Twitterを検索'],
    ['Account', 'アカウント'],
    ['Your account', 'アカウント'],
    ['Account settings', 'アカウント設定'],

    ['Replying to', '返信先:'],
    ['Account information', 'アカウント情報'],
    ['Manage your account details and password.', 'アカウント情報やパスワードを管理します。'],
    ['Two-factor authentication', '2要素認証'],
    ['Add an extra layer of security to your account.', 'アカウントのセキュリティを強化します。'],
    ['Protect your account with an extra layer of security.', '2要素認証でアカウントのセキュリティを強化します。'],
    ['Display', '表示'],
    ['Manage your theme and appearance.', 'テーマや表示を管理します。'],
    ['AUTHENTICATION APP', '認証アプリ'],
    ['Authentication app', '認証アプリ'],
    ['Use an authentication app like Google Authenticator or Authy to generate verification codes.', 'Google AuthenticatorやAuthyなどの認証アプリを使用して認証コードを生成します。'],
    ['TEXT MESSAGE', 'SMS'],
    ['Text message', 'SMS'],
    ['Receive verification codes via SMS to your phone.', 'SMSで認証コードを受け取ります。'],
    ['Set up', '設定する'],
    ['See your account information like your username, email address, and phone number.', 'ユーザー名、メールアドレス、電話番号などのアカウント情報を確認できます。'],
    ['Phone', '電話番号'],
    ['DATE OF BIRTH', '生年月日'],
    ['Date of birth', '生年月日'],
    ['This information is not public. We use your age to customize your experience, including ads.', 'この情報は公開されません。年齢は、広告を含むTwitterでの表示内容をカスタマイズするために使用されます。'],
    ['Learn more', '詳細はこちら'],
    ['Edit', '編集'],
    ['Bio', '自己紹介'],
    ['Location', '場所'],
    ['Website', 'ウェブサイト'],
    ["This can only be changed a few times. Make sure you enter the age of the person using the account. Even if you're making an account for your business, event, or cat.", '変更できる回数には制限があります。アカウントを利用する本人の生年月日を入力してください。ビジネス、イベント、ペット用のアカウントの場合も同様です。'],
    ['Privacy', 'プライバシー'],
    ['Privacy and safety', 'プライバシーと安全'],
    ['Safety', '安全'],
    ['Security', 'セキュリティ'],
    ['Content', 'コンテンツ'],
    ['Content preferences', 'コンテンツ設定'],
    ['Sensitive content', 'センシティブなコンテンツ'],
    ['Show sensitive content', 'センシティブなコンテンツを表示'],
    ['Hide sensitive content', 'センシティブなコンテンツを非表示'],
    ['Push notifications', 'プッシュ通知'],
    ['Email notifications', 'メール通知'],
    ['Notification settings', '通知設定'],
    ['Language', '言語'],
    ['Languages', '言語'],
    ['Language settings', '言語設定'],
    ['English', '英語'],
    ['Japanese', '日本語'],
    ['Accessibility', 'アクセシビリティ'],
    ['Reduce motion', '動きを減らす'],
    ['Autoplay', '自動再生'],
    ['Autoplay videos', '動画を自動再生'],
    ['Muted accounts', 'ミュートしているアカウント'],
    ['Muted', 'ミュート済み'],
    ['Mute', 'ミュート'],
    ['Data', 'データ'],
    ['Data usage', 'データ利用'],
    ['Help', 'ヘルプ'],
    ['Help Center', 'ヘルプセンター'],
    ['Support', 'サポート'],
    ['Feedback', 'フィードバック'],
    ['Terms of Service', '利用規約'],
    ['Privacy Policy', 'プライバシーポリシー'],
    ['Save', '保存'],
    ['Saved', '保存しました'],
    ['Cancel', 'キャンセル'],
    ['Close', '閉じる'],
    ['Back', '戻る'],
    ['Done', '完了'],
    ['Confirm', '確認'],
    ['Delete', '削除'],
    ['Log out', 'ログアウト'],
    ['Logout', 'ログアウト'],
    ['Sign out', 'ログアウト'],
    ['Delete account', 'アカウントを削除'],
    ['Deactivate account', 'アカウントを停止'],
    ['Username', 'ユーザー名'],
    ['Display name', '表示名'],
    ['Name', '名前'],
    ['Email', 'メールアドレス'],
    ['Password', 'パスワード'],
    ['Change password', 'パスワードを変更'],
    ['On', 'オン'],
    ['Off', 'オフ'],
    ['Enabled', '有効'],
    ['Disabled', '無効'],
    ['Just now', 'たった今'],
    ['just now', 'たった今'],
    ['Report post', 'ツイートを報告'],
    ['Delete post', 'ツイートを削除'],

    // 操作完了ポップアップ
    ['Repost removed', 'リツイートを取り消しました'],
    ['Repost added', 'リツイートしました'],
    ['Post reposted', 'リツイートしました'],
    ['Retweet removed', 'リツイートを取り消しました'],
    ['Post liked', 'お気に入りに登録しました'],
    ['Like removed', 'お気に入りを解除しました'],
    ['Copied to clipboard', 'クリップボードにコピーしました'],
    ['Post deleted', 'ツイートを削除しました'],
    ['Post posted', 'ツイートしました'],

    // 通知アクション
    ['mentioned you', 'あなたを@ツイートしました'],
    ['mentioned you in a post', 'あなたを@ツイートしました'],
    ['mentioned you in a tweet', 'あなたを@ツイートしました'],
    ['replied to your post', 'あなたのツイートに返信しました'],
    ['replied to your tweet', 'あなたのツイートに返信しました'],
    ['replied to you', 'あなたに返信しました'],
    ['liked your post', 'あなたのツイートをお気に入りに登録しました'],
    ['liked your tweet', 'あなたのツイートをお気に入りに登録しました'],
    ['favorited your post', 'あなたのツイートをお気に入りに登録しました'],
    ['favorited your tweet', 'あなたのツイートをお気に入りに登録しました'],
    ['reposted your post', 'あなたのツイートをリツイートしました'],
    ['reposted your tweet', 'あなたのツイートをリツイートしました'],
    ['retweeted your post', 'あなたのツイートをリツイートしました'],
    ['retweeted your tweet', 'あなたのツイートをリツイートしました'],
    ['followed you', 'あなたをフォローしました']
  ]);

  function installStyle() {
    if (document.getElementById('ct-jp-style')) return;

    const style = document.createElement('style');
    style.id = 'ct-jp-style';
    style.textContent = `
      [data-testid="tweet-like-action"] svg {
        display:none!important;
      }

      [data-testid="tweet-like-action"]::before {
        content:"☆";
        display:inline-block;
        font:700 23px/18px Arial,sans-serif;
        transform:translateY(-1px);
        transform-origin:center;
      }

      [data-testid="tweet-like-action"][aria-pressed="true"]::before,
      [data-testid="tweet-like-action"].text-pink-500::before {
        content:"★";
        color:#ffac33!important;
      }

      [data-testid="tweet-like-action"][aria-pressed="true"],
      [data-testid="tweet-like-action"].text-pink-500 {
        color:#ffac33!important;
      }

      [data-testid="tweet-like-action"]:hover {
        color:#ffac33!important;
        background:rgba(255,172,51,.12)!important;
      }

      [data-testid="tweet-like-action"].ct-star-pop::before {
        animation:ctStarPop .32s cubic-bezier(.34,1.56,.64,1);
      }

      @keyframes ctStarPop {
        0% { transform:translateY(-1px) scale(.72) rotate(-8deg); opacity:.55; }
        48% { transform:translateY(-1px) scale(1.3) rotate(6deg); }
        74% { transform:translateY(-1px) scale(.94) rotate(-2deg); }
        100% { transform:translateY(-1px) scale(1); }
      }

      .ct-founder,
      .ct-profile-founder {
        display:inline-flex;
        align-items:center;
        margin-left:4px;
        font-size:12px;
        line-height:18px;
        font-weight:700;
        white-space:nowrap;
        opacity:.72;
      }

      .ct-profile-founder {
        font-size:13px;
        opacity:.78;
      }

      .ct-twitter-logo {
        width:28px!important;
        height:28px!important;
        object-fit:contain!important;
        display:block!important;
      }

      .ct-profile-mute {
        margin-left:8px!important;
      }

      .ct-notification-fav-icon {
        position:relative!important;
      }

      .ct-notification-fav-icon > svg {
        visibility:hidden!important;
      }

      .ct-notification-fav-icon::after {
        content:"★";
        position:absolute!important;
        left:50%!important;
        top:50%!important;
        transform:translate(-50%,-50%)!important;
        color:#ffac33!important;
        font:700 27px/1 Arial,sans-serif!important;
        pointer-events:none!important;
      }

      #ct-favorites-tab {
        position:relative;
        z-index:3;
        flex:1 1 0!important;
        min-width:0!important;
        border:0;
        border-bottom:2px solid transparent!important;
        background:transparent;
        color:inherit;
        font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;
        cursor:pointer;
        padding:0 10px;
      }

      #ct-favorites-tab:hover {
        background:rgba(127,127,127,.08);
      }

      #ct-favorites-tab[data-active="1"] {
        color:#1d9bf0;
        border-bottom-color:#1d9bf0!important;
      }

      #ct-favorites-panel,
      #ct-reply-panel {
        position:fixed;
        z-index:2147482000;
        overflow:auto;
        overscroll-behavior:contain;
        background:inherit;
        color:inherit;
        border:1px solid rgba(127,127,127,.28);
        box-shadow:0 10px 35px rgba(0,0,0,.25);
      }

      #ct-favorites-panel { border-radius:0 0 12px 12px; }
      #ct-reply-panel { border-radius:14px; max-height:min(48vh,460px); }

      .ct-local-head {
        position:sticky;
        top:0;
        z-index:2;
        display:flex;
        justify-content:space-between;
        gap:12px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        background:inherit;
        color:inherit;
      }

      .ct-local-title { font-weight:800; }
      .ct-local-note { font-size:11px; opacity:.6; margin-top:2px; }

      .ct-local-close {
        border:0;
        background:transparent;
        color:inherit;
        cursor:pointer;
        font-size:20px;
        padding:3px 8px;
        border-radius:999px;
      }

      .ct-local-close:hover { background:rgba(127,127,127,.14); }

      .ct-local-card {
        display:flex;
        gap:10px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        cursor:pointer;
      }

      .ct-local-card:hover { background:rgba(127,127,127,.08); }

      .ct-local-avatar {
        width:40px;
        height:40px;
        border-radius:999px;
        object-fit:cover;
        flex:0 0 auto;
        background:rgba(127,127,127,.25);
      }

      .ct-local-main { min-width:0; flex:1; }

      .ct-local-meta {
        display:flex;
        gap:4px;
        flex-wrap:wrap;
        align-items:center;
        font-size:13px;
        line-height:18px;
      }

      .ct-local-name { font-weight:800; }
      .ct-local-handle,.ct-local-time { opacity:.62; }

      .ct-local-text {
        margin-top:3px;
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        font-size:14px;
        line-height:20px;
      }

      .ct-local-empty { padding:28px 18px; text-align:center; opacity:.65; }
      .ct-reply-kicker { font-size:12px; color:#1d9bf0; margin-bottom:3px; }

      #ct-reply-badge {
        position:fixed;
        z-index:2147483000;
        min-width:18px;
        height:18px;
        padding:0 5px;
        border-radius:999px;
        background:#1d9bf0;
        color:#fff;
        font:700 11px/18px Arial;
        text-align:center;
        pointer-events:none;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function dynamicJP(t) {
    let m;

    
    if ((m = t.match(/^Replying\s+to\s+(.+)$/i))) {
      const targets = m[1].replace(
        /(@[A-Za-z0-9_.-]{1,80})(?!さん)/g,
        '$1さん'
      );

      return `返信先: ${targets}`;
    }

if (/^just\s+now$/i.test(t)) return 'たった今';

    if ((m = t.match(/^(\d+)s$/))) return `${m[1]}秒`;
    if ((m = t.match(/^(\d+)m$/))) return `${m[1]}分`;
    if ((m = t.match(/^(\d+)h$/))) return `${m[1]}時間`;
    if ((m = t.match(/^(\d+)d$/))) return `${m[1]}日`;
    if ((m = t.match(/^Joined\s+(.+)$/i))) return `${m[1]}からTwitterを利用しています`;
    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Following$/i))) return `${m[1]}人 フォロー中`;
    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Followers?$/i))) return `${m[1]}人 フォロワー`;
    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Tweets?$/i))) return `${m[1]} ツイート`;
    if ((m = t.match(/^Logged in as\s+(.+)$/i))) return `${m[1]}としてログイン中`;
    if ((m = t.match(/^Version\s+(.+)$/i))) return `バージョン ${m[1]}`;
    if ((m = t.match(/^and\s+(\d+)\s+others?$/i))) return `とそのほか${m[1]}人`;
    if ((m = t.match(/^(\d+)\s+others?$/i))) return `そのほか${m[1]}人`;

    return null;
  }

  function actorJP(s) {
    return clean(s)
      .replace(/\s+and\s+/gi, '、')
      .replace(/\s*,\s*/g, '、')
      .split('、')
      .map(x => clean(x).replace(/さん$/, ''))
      .filter(Boolean)
      .map(x => `${x}さん`)
      .join('と');
  }

  function translateNotification(t) {
    t = clean(t);
    if (!t) return null;

    let m;

    const many = [
      [/^(.+?)\s+and\s+(\d+)\s+others?\s+(?:liked|favorited) your (?:post|tweet)$/i,
        (a,n) => `${actorJP(a)}、そのほか${n}人があなたのツイートをお気に入りに登録しました`],
      [/^(.+?)\s+and\s+(\d+)\s+others?\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        (a,n) => `${actorJP(a)}、そのほか${n}人があなたのツイートをリツイートしました`],
      [/^(.+?)\s+and\s+(\d+)\s+others?\s+followed you$/i,
        (a,n) => `${actorJP(a)}、そのほか${n}人があなたをフォローしました`],
      [/^(.+?)\s+and\s+(\d+)\s+others?\s+mentioned you(?: in a (?:post|tweet))?$/i,
        (a,n) => `${actorJP(a)}、そのほか${n}人があなたを@ツイートしました`],
      [/^(.+?)\s+and\s+(\d+)\s+others?\s+replied to (?:your (?:post|tweet)|you)$/i,
        (a,n) => `${actorJP(a)}、そのほか${n}人があなたのツイートに返信しました`]
    ];

    for (const [re, fn] of many) {
      if ((m = t.match(re))) return fn(m[1], m[2]);
    }

    const one = [
      [/^(.+?)\s+(?:liked|favorited) your (?:post|tweet)$/i,
        a => `${actorJP(a)}があなたのツイートをお気に入りに登録しました`],
      [/^(.+?)\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        a => `${actorJP(a)}があなたのツイートをリツイートしました`],
      [/^(.+?)\s+followed you$/i,
        a => `${actorJP(a)}があなたをフォローしました`],
      [/^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i,
        a => `${actorJP(a)}があなたを@ツイートしました`],
      [/^(.+?)\s+replied to your (?:post|tweet)$/i,
        a => `${actorJP(a)}があなたのツイートに返信しました`],
      [/^(.+?)\s+replied to you$/i,
        a => `${actorJP(a)}があなたに返信しました`],
      [/^(.+?)\s+(?:liked|favorited) your reply$/i,
        a => `${actorJP(a)}があなたの返信をお気に入りに登録しました`],
      [/^(.+?)\s+(?:reposted|retweeted) your reply$/i,
        a => `${actorJP(a)}があなたの返信をリツイートしました`]
    ];

    for (const [re, fn] of one) {
      if ((m = t.match(re))) return fn(m[1]);
    }

    return null;
  }

  function translateTextNode(node) {
    const parent = node?.parentElement;
    if (!parent?.isConnected) return;
    if (parent.closest('textarea,input,[contenteditable="true"],script,style')) return;

    const raw = node.nodeValue || '';
    const t = clean(raw);
    if (!t || t.length > 500) return;

    let out = null;

    if (location.pathname.startsWith('/notifications')) {
      let m;

      if (/^and$/i.test(t)) {
        out = 'と';
      } else if ((m = t.match(/^and\s+(\d+)\s+others?$/i))) {
        out = `とそのほか${m[1]}人`;
      } else if ((m = t.match(/^(\d+)\s+others?$/i))) {
        out = `そのほか${m[1]}人`;
      }
    }

    if (!out) {
      out = translateNotification(t) || JP.get(t) || dynamicJP(t);
    }

    if (out && out !== t) {
      node.nodeValue = raw.replace(t, out);
    }
  }

  function patchUI(root = document) {
    const host = root instanceof Node ? root : document;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;

    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(translateTextNode);
  }

  function notificationTextNodes(root = document) {
    const main = root instanceof Element && root.matches('main')
      ? root
      : root.querySelector?.('main') || document.querySelector('main');

    if (!main) return [];

    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;

    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent?.isConnected) continue;
      if (parent.closest('textarea,input,[contenteditable="true"],script,style')) continue;
      nodes.push(node);
    }

    return nodes;
  }

  function nearestUsefulSibling(node, direction) {
    let cur = direction < 0 ? node.previousSibling : node.nextSibling;

    while (cur) {
      const text = clean(cur.textContent);
      if (text) return cur;
      cur = direction < 0 ? cur.previousSibling : cur.nextSibling;
    }

    return null;
  }

  function patchNotificationConnectors(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;

    const nodes = notificationTextNodes(root);

    for (const node of nodes) {
      const raw = node.nodeValue || '';
      const t = clean(raw);
      if (!t || t.length > 64) continue;

      let out = null;
      let m;

      if (/^and$/i.test(t)) {
        out = 'と';
      } else if ((m = t.match(/^and\s+(\d+)\s+others?$/i))) {
        out = `とそのほか${m[1]}人`;
      } else if ((m = t.match(/^(\d+)\s+others?$/i))) {
        out = `そのほか${m[1]}人`;
      }

      if (out) node.nodeValue = raw.replace(t, out);
    }

    for (const node of nodes) {
      const t = clean(node.nodeValue || '');
      if (!t) continue;

      if (/^others?$/i.test(t)) {
        const parent = node.parentNode;
        if (!parent) continue;

        const prev = nearestUsefulSibling(node, -1);
        const pt = clean(prev?.textContent);

        if (/^\d+$/.test(pt)) {
          const n = pt;

          if (prev.nodeType === Node.TEXT_NODE) {
            prev.nodeValue = `そのほか${n}人`;
          } else if (prev instanceof Element && !prev.children.length) {
            prev.textContent = `そのほか${n}人`;
          } else {
            node.nodeValue = `そのほか${n}人`;
          }

          if (clean(node.nodeValue || '') !== `そのほか${n}人`) {
            node.nodeValue = '';
          }
        }
      }

      if (/^\d+$/.test(t)) {
        const next = nearestUsefulSibling(node, 1);
        const nt = clean(next?.textContent);

        if (/^others?$/i.test(nt)) {
          const n = t;
          node.nodeValue = `そのほか${n}人`;

          if (next.nodeType === Node.TEXT_NODE) {
            next.nodeValue = '';
          } else if (next instanceof Element && !next.children.length) {
            next.textContent = '';
          }
        }
      }
    }

    const main = document.querySelector('main');
    if (!main) return;

    for (const el of main.querySelectorAll('span,small,strong,a,button,div,p')) {
      if (!el.isConnected || el.closest('textarea,input,[contenteditable="true"]')) continue;
      if (el.children.length > 1) continue;

      const t = clean(el.textContent);
      if (!t || t.length > 64) continue;

      let m;

      if ((m = t.match(/^and\s+(\d+)\s+others?$/i))) {
        el.textContent = `とそのほか${m[1]}人`;
      } else if ((m = t.match(/^(\d+)\s+others?$/i))) {
        el.textContent = `そのほか${m[1]}人`;
      } else if (/^and$/i.test(t)) {
        el.textContent = 'と';
      }
    }
  }

  function isMobileSafari() {
    const ua = navigator.userAgent || '';

    return (
      /Safari/i.test(ua) &&
      !/CriOS|Chrome|FxiOS|EdgiOS|OPiOS/i.test(ua) &&
      (
        /iPhone|iPad|iPod/i.test(ua) ||
        (
          navigator.platform === 'MacIntel' &&
          navigator.maxTouchPoints > 1
        )
      )
    );
  }

  function patchSafariTopTitle() {
    if (!isMobileSafari()) return;

    const candidates = [
      ...document.querySelectorAll(
        'header h1,header h2,header span,' +
        'main h1,main h2,' +
        '[role="banner"] h1,' +
        '[role="banner"] h2,' +
        '[role="banner"] span'
      )
    ];

    for (const el of candidates) {
      if (!el.isConnected || el.children.length) continue;

      const rect = el.getBoundingClientRect();

      if (
        rect.top < 0 ||
        rect.top > 140 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      if (clean(el.textContent) === 'ツイート') {
        el.textContent = 'Twitter';
      }
    }
  }

  function patchNotificationParticles(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;

    const main =
      root instanceof Element && root.matches('main')
        ? root
        : root.querySelector?.('main') || document.querySelector('main');

    if (!main) return;

    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent?.isConnected) continue;
      if (parent.closest('textarea,input,[contenteditable="true"],script,style')) continue;
      nodes.push(node);
    }

    const prevUseful = current => {
      const index = nodes.indexOf(current);
      for (let i = index - 1; i >= 0; i--) {
        const t = clean(nodes[i].nodeValue || '');
        if (t) return { node: nodes[i], text: t };
      }
      return null;
    };

    for (const current of nodes) {
      const raw = current.nodeValue || '';
      const t = clean(raw);
      if (!t) continue;

      let out = null;
      if (/^と$/u.test(t)) {
        out = 'さんと';
      } else if (/^とそのほか(\d+)人$/u.test(t)) {
        out = t.replace(/^と/u, 'さんと');
      }

      if (out && out !== t) current.nodeValue = raw.replace(t, out);
    }

    const actionPatterns = [
      /^あなたのツイートをお気に入りに登録しました/u,
      /^あなたのツイートをリツイートしました/u,
      /^あなたをフォローしました/u,
      /^あなたを@ツイートしました/u,
      /^あなたのツイートに返信しました/u,
      /^あなたに返信しました/u,
      /^あなたの返信をお気に入りに登録しました/u,
      /^あなたの返信をリツイートしました/u
    ];

    for (const current of nodes) {
      const raw = current.nodeValue || '';
      const t = clean(raw);
      if (!t || !actionPatterns.some(re => re.test(t))) continue;
      if (/^(?:さん)?が/u.test(t)) continue;

      const prev = prevUseful(current);
      if (!prev) continue;

      const prefix = /人$/u.test(prev.text) || /さん$/u.test(prev.text)
        ? 'が'
        : 'さんが';

      current.nodeValue = raw.replace(t, `${prefix}${t}`);
    }
  }

  function patchReplyingTo(
    root =
      document
  ) {
    const scope =
      root instanceof Element
        ? root
        : document;

    const labels = [];

    if (
      scope instanceof Element &&
      !scope.children.length &&
      /^(?:Replying\s+to|返信先[:：]?)$/i.test(clean(scope.textContent))
    ) {
      labels.push(scope);
    }

    scope.querySelectorAll?.('span,div,p,small').forEach(
      el => {
        if (
          !el.children.length &&
          /^(?:Replying\s+to|返信先[:：]?)$/i.test(clean(el.textContent))
        ) {
          labels.push(el);
        }
      }
    );

    for (const label of labels) {
      if (/^Replying\s+to$/i.test(clean(label.textContent))) {
        label.textContent = '返信先:';
      }

      let box = label.parentElement;

      for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
        const handles = [
          ...box.querySelectorAll('a,span,strong')
        ].filter(
          el =>
            !el.children.length &&
            /^@[A-Za-z0-9_.-]{1,80}(?:さん)?$/.test(clean(el.textContent))
        );

        if (!handles.length) continue;

        handles.forEach(
          el => {
            const handle = clean(el.textContent);
            if (!/さん$/.test(handle)) {
              el.textContent = `${handle}さん`;
            }
          }
        );

        break;
      }
    }
  }

  function patchInputs(root = document) {
    const list = [];

    if (root instanceof Element && root.matches('input[placeholder],textarea[placeholder]')) {
      list.push(root);
    }

    root.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));

    for (const el of list) {
      const p = el.getAttribute('placeholder') || '';

      if (/what'?s happening/i.test(p)) el.placeholder = '今どうしてる？';
      else if (/^search/i.test(p)) el.placeholder = '検索';
      else if (/^post your reply$/i.test(p)) el.placeholder = '返信をツイート';
      else if (/^add your thoughts/i.test(p)) el.placeholder = 'コメントを追加…';
    }
  }

  function hideAffiliation() {
    document.querySelectorAll('span,p,div,a,small').forEach(el => {
      if (
        el.isConnected &&
        !el.children.length &&
        /^Not Affiliated with X$/i.test(clean(el.textContent))
      ) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function patchBrand() {
    document.querySelectorAll('img').forEach(img => {
      if (!img.isConnected || img.dataset.ctBrandPatched === '1') return;
      if (img.closest('article')) return;

      const alt = clean(img.getAttribute('alt') || '');
      const title = clean(img.getAttribute('title') || '');
      const rawSrc = img.getAttribute('src') || '';

      let path = '';

      try {
        path = new URL(rawSrc, location.href).pathname;
      } catch {
        path = rawSrc;
      }

      if (/avatar|profile|media|photo|processed|firebase/i.test(`${alt} ${title} ${path}`)) return;

      const isBrandAsset =
        /\/assets\/brand\/[^/]*(?:bird|logo|twitter|tweet)[^/]*\.(?:svg|png|webp)$/i
          .test(path);

      const isExplicitBrandAlt =
        /^(?:twitter|tweet|twitter logo|tweet logo|brand logo|bird logo)$/i
          .test(`${alt} ${title}`.trim());

      if (!isBrandAsset && !isExplicitBrandAlt) return;

      const r = img.getBoundingClientRect();
      if (r.width > 80 || r.height > 80) return;

      img.src = LOGO;
      img.classList.add('ct-twitter-logo');
      img.dataset.ctBrandPatched = '1';
    });
  }

  function requestJSON(url, headers = {}) {
    const options = {
      method: 'GET',
      url,
      timeout: 12000,
      headers: {
        Accept: 'application/json',
        ...headers
      }
    };

    const runGM = fn => new Promise(resolve => {
      let settled = false;

      const finish = response => {
        if (settled) return;
        settled = true;

        try {
          resolve(
            response &&
            response.status >= 200 &&
            response.status < 300
              ? JSON.parse(response.responseText)
              : null
          );
        } catch {
          resolve(null);
        }
      };

      try {
        const result = fn({
          ...options,
          onload: finish,
          onerror: () => finish(null),
          ontimeout: () => finish(null)
        });

        if (result && typeof result.then === 'function') {
          result.then(finish).catch(() => finish(null));
        }
      } catch {
        finish(null);
      }
    });

    if (typeof GM_xmlhttpRequest === 'function') {
      return runGM(GM_xmlhttpRequest);
    }

    if (typeof globalThis.GM?.xmlHttpRequest === 'function') {
      return runGM(globalThis.GM.xmlHttpRequest.bind(globalThis.GM));
    }

    return fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...headers
      }
    })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }

  async function getCachedAuth(force = false) {
    const now = Date.now();

    if (
      !force &&
      authCacheCheckedAt &&
      now - authCacheCheckedAt < 5 * 60 * 1000
    ) {
      return authCache;
    }

    if (authCachePending) return authCachePending;

    authCachePending = getAuth()
      .then(auth => {
        authCache = auth?.token ? auth : null;
        authCacheCheckedAt = Date.now();
        return authCache;
      })
      .catch(() => {
        authCache = null;
        authCacheCheckedAt = Date.now();
        return null;
      })
      .finally(() => {
        authCachePending = null;
      });

    return authCachePending;
  }

  function fetchProfile(username) {
  const key = normUser(username);
  if (!key) return Promise.resolve(null);
  if (profileCache.has(key)) return Promise.resolve(profileCache.get(key));
  if (profilePending.has(key)) return profilePending.get(key);

  const promise = getAuth()
    .then(auth => {
      if (!auth?.token) return null;
      return requestJSON(
        PROFILE_API + encodeURIComponent(username),
        { Authorization: `Bearer ${auth.token}` }
      );
    })
    .then(json => {
      const user =
        json?.user ??
        json?.profile ??
        json?.data?.user ??
        json?.data?.profile ??
        json?.data ??
        json;

      if (user) profileCache.set(key, user);
      profilePending.delete(key);
      return user || null;
    })
    .catch(() => {
      profilePending.delete(key);
      return null;
    });

  profilePending.set(key, promise);
  return promise;
}

  function userFromHref(href) {
    try {
      const m =
        new URL(href, location.origin)
          .pathname
          .match(/^\/user\/([^/?#]+)/i);

      return m
        ? validUser(
            decodeURIComponent(
              m[1]
            )
          )
        : null;
    } catch {
      return null;
    }
  }

  function articleAuthor(article) {
    if (!article) return null;

    for (const el of article.querySelectorAll(
      'button[aria-label],a[href],span,div'
    )) {
      let m =
        (
          el.getAttribute?.('aria-label') ||
          ''
        )
          .match(/^View @(.+?)'s profile$/i);

      if (m) return validUser(m[1]);

      const user =
        userFromHref(
          el.getAttribute?.('href') ||
          ''
        );

      if (user) return user;

      if (
        !el.children.length &&
        (
          m =
            clean(el.textContent)
              .match(
                /^@([A-Za-z0-9_.-]{1,80})$/
              )
        )
      ) {
        return validUser(m[1]);
      }
    }

    return null;
  }

  function founderValue(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    const raw = String(value).trim();

    if (!/^\d+$/.test(raw)) {
      return null;
    }

    return raw.padStart(5, '0');
  }

  function inspectFounderObject(obj, username) {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    const wanted = normUser(username);

    if (
      normUser(obj.authorUsername) === wanted &&
      (
        obj.authorFoundingMemberNumber !== undefined ||
        obj.authorName !== undefined ||
        obj.authorDisplayName !== undefined
      )
    ) {
      return {
        number:
          founderValue(
            obj.authorFoundingMemberNumber
          ),

        displayName:
          clean(
            obj.authorName ||
            obj.authorDisplayName ||
            ''
          ) || null
      };
    }

    if (
      normUser(obj.username) === wanted &&
      (
        obj.foundingMemberNumber !== undefined ||
        obj.displayName !== undefined ||
        obj.name !== undefined
      )
    ) {
      return {
        number:
          founderValue(
            obj.foundingMemberNumber
          ),

        displayName:
          clean(
            obj.displayName ||
            obj.name ||
            ''
          ) || null
      };
    }

    return null;
  }

  function searchFounderObject(
    root,
    username,
    maxDepth = 4
  ) {
    const seen = new WeakSet();
    let visited = 0;

    function walk(value, depth) {
      if (
        !value ||
        typeof value !== 'object' ||
        depth > maxDepth ||
        visited > 1200 ||
        seen.has(value)
      ) {
        return null;
      }

      seen.add(value);
      visited += 1;

      const direct =
        inspectFounderObject(
          value,
          username
        );

      if (
        direct?.number ||
        direct?.displayName
      ) {
        return direct;
      }

      let entries;

      try {
        entries =
          Object.entries(value);
      } catch {
        return null;
      }

      const priority =
        new Set([
          'tweet',
          'post',
          'user',
          'profile',
          'data',
          'item',
          'notification',
          'parentPost',
          'quotedPost',
          'originalPost'
        ]);

      for (
        const [
          key,
          child
        ] of
        entries
      ) {
        if (
          !priority.has(key) ||
          !child ||
          typeof child !==
            'object'
        ) {
          continue;
        }

        const hit =
          walk(
            child,
            depth + 1
          );

        if (hit) return hit;
      }

      for (
        const [
          key,
          child
        ] of
        entries
      ) {
        if (
          priority.has(key) ||
          !child ||
          typeof child !==
            'object'
        ) {
          continue;
        }

        const hit =
          walk(
            child,
            depth + 1
          );

        if (hit) return hit;
      }

      return null;
    }

    return walk(root, 0);
  }

  function reactFounderData(
    element,
    username
  ) {
    if (
      !element ||
      !username
    ) {
      return null;
    }

    const keys =
      Object.keys(element);

    const propsKey =
      keys.find(
        key =>
          key.startsWith(
            '__reactProps$'
          )
      );

    const fiberKey =
      keys.find(
        key =>
          key.startsWith(
            '__reactFiber$'
          )
      );

    if (propsKey) {
      const hit =
        searchFounderObject(
          element[propsKey],
          username
        );

      if (hit) return hit;
    }

    let fiber =
      fiberKey
        ? element[fiberKey]
        : null;

    for (
      let depth = 0;
      fiber && depth < 16;
      depth += 1,
      fiber = fiber.return
    ) {
      const hit =
        searchFounderObject(
          fiber.memoizedProps,
          username
        ) ||
        searchFounderObject(
          fiber.pendingProps,
          username
        );

      if (hit) return hit;
    }

    return null;
  }

  function findAuthorLeaf(
    article,
    username,
    displayName = ''
  ) {
    const target =
      normUser(username);

    const display =
      clean(displayName);

    return [
      ...article.querySelectorAll(
        'button,span,a,div,strong'
      )
    ]
      .find(el => {
        if (
          !el.isConnected ||
          el.children.length
        ) {
          return false;
        }

        const t =
          clean(
            el.textContent
          );

        return (
          normUser(t) === target ||
          normUser(
            t.replace(/^@/, '')
          ) === target ||
          (
            display &&
            t === display
          )
        );
      }) ||
      null;
  }

  let muted =
    new Set(
      (
        loadJSON(
          KEY.muted,
          []
        ) ||
        []
      )
        .map(normUser)
        .filter(Boolean)
    );

  const isMuted =
    username =>
      muted.has(
        normUser(username)
      );

  function saveMuted() {
    saveJSON(
      KEY.muted,
      [...muted].sort()
    );
  }

  function toggleMuted(username) {
    const key =
      normUser(username);

    if (!key) return;

    if (muted.has(key)) {
      muted.delete(key);
    } else {
      muted.add(key);
    }

    saveMuted();
    patchFeed(document);
    patchProfileMute();
  }

  async function patchArticle(article) {
    if (!article?.isConnected) return;

    const username =
      articleAuthor(article);

    if (!username) return;

    if (isMuted(username)) {
      article.style.setProperty(
        'display',
        'none',
        'important'
      );

      return;
    }

    article.style.removeProperty(
      'display'
    );

    const embedded =
      reactFounderData(
        article,
        username
      );

    let user = null;

    if (
      !embedded?.number ||
      !embedded?.displayName
    ) {
      user =
        await fetchProfile(
          username
        );
    }

    if (!article.isConnected) return;

    const displayName =
      clean(
        embedded?.displayName ||
        user?.displayName ||
        user?.name ||
        username
      );

    const founder =
      embedded?.number ||
      founderValue(
        user?.foundingMemberNumber
      );

    const leaf =
      findAuthorLeaf(
        article,
        username,
        displayName
      );

    if (
      !leaf ||
      !displayName
    ) {
      return;
    }

    if (
      clean(
        leaf.textContent
      ) !== displayName
    ) {
      leaf.textContent =
        displayName;
    }

    leaf.classList.add(
      'ct-author-name'
    );

    let badge =
      leaf.parentElement
        ?.querySelector(
          ':scope > .ct-founder'
        );

    if (founder) {
      if (!badge) {
        badge =
          document.createElement(
            'span'
          );

        badge.className =
          'ct-founder';

        leaf.after(
          badge
        );
      }

      badge.textContent =
        `#${founder}`;

      badge.title =
        `Founder Number #${founder}`;
    }

    else if (badge) {
      badge.remove();
    }
  }

  function collectArticles(
    root = document
  ) {
    const set =
      new Set();

    if (root instanceof Element) {
      if (
        root.matches('article')
      ) {
        set.add(root);
      }

      const parent =
        root.closest('article');

      if (parent) {
        set.add(parent);
      }
    }

    root.querySelectorAll?.(
      'article'
    )
      .forEach(
        article =>
          set.add(article)
      );

    return set;
  }

  function patchFeed(
    root = document
  ) {
    for (
      const article of
      collectArticles(root)
    ) {
      patchArticle(article);
    }
  }

  async function patchRetweetRows(
    root = document
  ) {
    const leaves = [];

    root.querySelectorAll?.(
      'span,div,p'
    )
      .forEach(el => {
        if (!el.children.length) {
          leaves.push(el);
        }
      });

    for (
      const el of
      leaves
    ) {
      const t =
        clean(
          el.textContent
        );

      const m =
        t.match(
          /^@?([A-Za-z0-9_.-]{1,80})\s+(?:reposted|retweeted)$/i
        );

      if (!m) continue;

      const username =
        validUser(
          m[1]
        );

      const user =
        username
          ? await fetchProfile(
              username
            )
          : null;

      if (
        !user ||
        !el.isConnected
      ) {
        continue;
      }

      el.textContent =
        `${
          user.displayName ||
          user.name ||
          username
        }さんがリツイートしました`;
    }
  }

  function routeUser() {
    const m =
      location.pathname
        .match(
          /^\/user\/([^/?#]+)/i
        );

    return m
      ? validUser(
          decodeURIComponent(
            m[1]
          )
        )
      : null;
  }

  function ownProfileUser() {
    if (
      location.pathname !==
      '/profile'
    ) {
      return null;
    }

    for (
      const el of
      document.querySelectorAll(
        'main span,main a,main div,main p'
      )
    ) {
      if (el.children.length) continue;

      const r =
        el.getBoundingClientRect();

      if (
        r.top < 30 ||
        r.top > 520
      ) {
        continue;
      }

      const m =
        clean(
          el.textContent
        )
          .match(
            /^@([A-Za-z0-9_.-]{1,80})$/
          );

      if (m) {
        return validUser(
          m[1]
        );
      }
    }

    return null;
  }

  async function patchProfileFounder() {
    const username =
      routeUser() ||
      ownProfileUser();

    if (!username) return;

    const main =
      document.querySelector(
        'main'
      ) ||
      document;

    const handle =
      [
        ...main.querySelectorAll(
          'p,span,a,div'
        )
      ]
        .find(el =>
          !el.children.length &&
          clean(
            el.textContent
          ) ===
            `@${username}`
        );

    const embedded =
      reactFounderData(
        handle || main,
        username
      ) ||
      reactFounderData(
        main,
        username
      );

    let user = null;

    if (
      !embedded?.number ||
      !embedded?.displayName
    ) {
      user =
        await fetchProfile(
          username
        );
    }

    const founder =
      embedded?.number ||
      founderValue(
        user?.foundingMemberNumber
      );

    if (!founder) return;

    const displayName =
      clean(
        embedded?.displayName ||
        user?.displayName ||
        user?.name ||
        username
      );

    const nameEl =
      [
        ...main.querySelectorAll(
          'h1,h2,h3,span,a,div,strong'
        )
      ]
        .find(el => {
          if (
            !el.isConnected ||
            el.children.length ||
            el.closest(
              'article'
            ) ||
            el.classList.contains(
              'ct-profile-founder'
            )
          ) {
            return false;
          }

          const r =
            el.getBoundingClientRect();

          if (
            r.top < 30 ||
            r.top > 520 ||
            r.width <= 0 ||
            r.height <= 0
          ) {
            return false;
          }

          const t =
            clean(
              el.textContent
            );

          return (
            t === displayName ||
            normUser(t) ===
              normUser(username) ||
            t === `@${username}`
          );
        });

    if (!nameEl) return;

    if (
      displayName &&
      !/^@/.test(
        clean(
          nameEl.textContent
        )
      ) &&
      clean(
        nameEl.textContent
      ) !== displayName
    ) {
      nameEl.textContent =
        displayName;
    }

    let badge =
      nameEl.parentElement
        ?.querySelector(
          ':scope > .ct-profile-founder'
        );

    if (!badge) {
      badge =
        document.createElement(
          'span'
        );

      badge.className =
        'ct-profile-founder';

      nameEl.after(
        badge
      );
    }

    badge.textContent =
      `#${founder}`;

    badge.title =
      `Founder Number #${founder}`;
  }

  function patchProfileMute() {
    const username =
      routeUser();

    const main =
      document.querySelector(
        'main'
      ) ||
      document;

    const existing =
      [
        ...main.querySelectorAll(
          '.ct-profile-mute'
        )
      ];

    const old =
      existing.shift() ||
      null;

    existing.forEach(
      el =>
        el.remove()
    );

    if (!username) {
      old?.remove();
      return;
    }

    const ref =
      [
        ...main.querySelectorAll(
          'button'
        )
      ]
        .find(
          button =>
            !button.closest(
              'article'
            ) &&
            !button.classList.contains(
              'ct-profile-mute'
            ) &&
            /^(Follow|Unfollow|フォロー|フォロー解除)$/i
              .test(
                clean(
                  button.textContent
                )
              )
        );

    if (!ref) {
      old?.remove();
      return;
    }

    const button =
      old ||
      ref.cloneNode(true);

    if (!old) {
      button.removeAttribute(
        'id'
      );

      button.classList.add(
        'ct-profile-mute'
      );

      ref.parentElement
        ?.appendChild(
          button
        );
    }

    const label =
      isMuted(username)
        ? 'ミュート解除'
        : 'ミュート';

    button.textContent =
      label;

    button.title =
      label;

    button.setAttribute(
      'aria-label',
      label
    );

    button.onclick =
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleMuted(
          username
        );
      };
  }

  let menuUser = null;

  function isMenuButton(button) {
    const text =
      [
        button?.getAttribute?.(
          'aria-label'
        ),

        button?.getAttribute?.(
          'title'
        ),

        button?.getAttribute?.(
          'data-testid'
        ),

        button?.textContent
      ]
        .filter(Boolean)
        .join(' ');

    return (
      String(
        button?.getAttribute?.(
          'aria-haspopup'
        ) ||
        ''
      )
        .toLowerCase() ===
        'menu' ||

      /(^|\s)(more|options|menu|もっと|その他)(\s|$)/i
        .test(text)
    );
  }

  document.addEventListener(
    'click',
    event => {
      const button =
        event.target
          .closest?.(
            'button,[role="button"]'
          );

      const article =
        button?.closest?.(
          'article'
        );

      if (
        !button ||
        !article ||
        !isMenuButton(button)
      ) {
        return;
      }

      const username =
        articleAuthor(article);

      if (!username) return;

      menuUser =
        username;

      [
        0,
        80,
        250
      ]
        .forEach(
          delay =>
            setTimeout(
              patchOpenMuteMenu,
              delay
            )
        );
    },
    true
  );

  function visible(el) {
    if (!el?.isConnected) {
      return false;
    }

    const r =
      el.getBoundingClientRect();

    const style =
      getComputedStyle(el);

    return (
      r.width > 0 &&
      r.height > 0 &&
      style.display !==
        'none' &&
      style.visibility !==
        'hidden'
    );
  }

  function patchOpenMuteMenu() {
    if (!menuUser) return;

    const all =
      [
        ...document.querySelectorAll(
          '[role="menuitem"],button,a,div[role="button"]'
        )
      ];

    const isPopupItem =
      el => {
        if (!visible(el)) {
          return false;
        }

        const explicitMenu =
          el.closest(
            '[role="menu"],[data-radix-menu-content],[data-menu-content]'
          );

        return Boolean(
          explicitMenu ||
          !el.closest('main')
        );
      };

    const anchor =
      all.find(el =>
        isPopupItem(el) &&
        /^(Report post|Report Tweet|Report|ツイートを報告|報告)$/i
          .test(
            clean(
              el.textContent
            )
          )
      ) ||
      all.find(el =>
        isPopupItem(el) &&
        /^(Follow|Unfollow|フォロー|フォロー解除)(\s+@?.+)?$/i
          .test(
            clean(
              el.textContent
            )
          )
      );

    if (!anchor) return;

    const item =
      anchor.closest(
        '[role="menuitem"],button,a,[role="button"]'
      ) ||
      anchor;

    const parent =
      item.parentElement;

    if (!parent) return;

    let muteItem =
      parent.querySelector(
        ':scope > [data-ct-mute-menu="1"]'
      );

    if (!muteItem) {
      muteItem =
        document.createElement(
          item.tagName
            .toLowerCase()
        );

      muteItem.className =
        item.className ||
        '';

      muteItem.setAttribute(
        'role',
        item.getAttribute(
          'role'
        ) ||
        'menuitem'
      );

      muteItem.dataset.ctMuteMenu =
        '1';

      parent.insertBefore(
        muteItem,
        item
      );
    }

    const label =
      isMuted(menuUser)
        ? 'ミュート解除'
        : 'ミュート';

    muteItem.textContent =
      label;

    muteItem.title =
      label;

    muteItem.setAttribute(
      'aria-label',
      label
    );

    muteItem.onclick =
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleMuted(
          menuUser
        );

        document.dispatchEvent(
          new KeyboardEvent(
            'keydown',
            {
              key:'Escape',
              code:'Escape',
              bubbles:true
            }
          )
        );
      };
  }

  function articleId(article) {
    for (
      const el of
      article.querySelectorAll(
        'a[href]'
      )
    ) {
      const href =
        el.getAttribute(
          'href'
        ) ||
        '';

      const m =
        href.match(
          /\/(?:post|status|tweet)\/([^/?#]+)/i
        );

      if (m) return m[1];
    }

    return (
      article.getAttribute(
        'data-post-id'
      ) ||
      article.getAttribute(
        'data-tweet-id'
      ) ||
      ''
    );
  }

  function articleText(article) {
    return [
      ...article.querySelectorAll(
        'p,div[dir="auto"],span'
      )
    ]
      .filter(
        el =>
          !el.children.length
      )
      .map(
        el =>
          clean(
            el.textContent
          )
      )
      .filter(
        t =>
          t.length > 2 &&
          !/^@/.test(t) &&
          !/^\d+[smhd]$/.test(t) &&
          !JP.has(t)
      )
      .sort(
        (a,b) =>
          b.length -
          a.length
      )[0] ||
      '';
  }

  function articleAvatar(article) {
    return (
      article.querySelector(
        'img[src*="avatar"],img[alt*="profile" i]'
      )?.src ||
      ''
    );
  }

  function snapshotFavorite(article) {
    const id =
      articleId(article);

    if (!id) return null;

    const username =
      articleAuthor(article) ||
      '';

    const name =
      clean(
        article.querySelector(
          '.ct-author-name,strong'
        )?.textContent
      ) ||
      username;

    const href =
      [
        ...article.querySelectorAll(
          'a[href]'
        )
      ]
        .map(
          el =>
            el.href
        )
        .find(
          h =>
            /(post|status|tweet)\//i
              .test(h)
        ) ||
      '';

    return {
      id,
      username,
      name,
      text:
        articleText(article),
      avatar:
        articleAvatar(article),
      href,
      savedAt:
        Date.now()
    };
  }

  function loadFavorites() {
    const items =
      loadJSON(
        KEY.favorites,
        []
      );

    return Array.isArray(items)
      ? items
      : [];
  }

  function saveFavorite(item) {
    if (!item?.id) return;

    saveJSON(
      KEY.favorites,
      [
        item,
        ...loadFavorites()
          .filter(
            x =>
              x.id !==
              item.id
          )
      ]
        .slice(
          0,
          500
        )
    );
  }

  function removeFavorite(id) {
    saveJSON(
      KEY.favorites,
      loadFavorites()
        .filter(
          x =>
            x.id !== id
        )
    );
  }

  document.addEventListener(
    'click',
    event => {
      const button =
        event.target
          .closest?.(
            '[data-testid="tweet-like-action"]'
          );

      if (!button) return;

      const article =
        button.closest(
          'article'
        );

      if (!article) return;

      const snapshot =
        snapshotFavorite(
          article
        );

      const wasLiked =
        button.getAttribute(
          'aria-pressed'
        ) ===
        'true';

      button.classList.remove(
        'ct-star-pop'
      );

      void button.offsetWidth;

      button.classList.add(
        'ct-star-pop'
      );

      setTimeout(
        () =>
          button.classList.remove(
            'ct-star-pop'
          ),
        380
      );

      setTimeout(
        () => {
          const nowLiked =
            button.getAttribute(
              'aria-pressed'
            ) ===
            'true';

          if (
            !wasLiked &&
            nowLiked
          ) {
            saveFavorite(
              snapshot
            );
          }

          else if (
            wasLiked &&
            !nowLiked
          ) {
            removeFavorite(
              snapshot?.id
            );
          }

          if (favoritesActive) {
            renderFavoritesPanel();
          }
        },
        450
      );
    },
    true
  );

  function patchFavoriteButtons(
    root = document
  ) {
    root.querySelectorAll?.(
      '[data-testid="tweet-like-action"]'
    )
      .forEach(
        button => {
          const liked =
            button.getAttribute(
              'aria-pressed'
            ) ===
            'true';

          button.title =
            liked
              ? 'お気に入りを解除'
              : 'お気に入り';

          const aria =
            button.getAttribute(
              'aria-label'
            ) ||
            '';

          button.setAttribute(
            'aria-label',
            aria
              .replace(
                /^Like,/i,
                'お気に入り,'
              )
              .replace(
                /^Unlike,/i,
                'お気に入りを解除,'
              )
          );

          if (liked) {
            const article =
              button.closest(
                'article'
              );

            const snapshot =
              article &&
              snapshotFavorite(
                article
              );

            if (snapshot) {
              saveFavorite(
                snapshot
              );
            }
          }
        }
      );
  }

  let favoritesActive = false;

  function findRepostTab() {
    if (
      location.pathname !==
      '/profile'
    ) {
      return null;
    }

    return [
      ...document.querySelectorAll(
        'main a,main button,main [role="tab"]'
      )
    ]
      .find(
        el =>
          /^(Reposts|Retweets|リツイート)$/i
            .test(
              clean(
                el.textContent
              )
            )
      ) ||
      null;
  }

  function patchFavoriteProfileTab() {
    let tab =
      document.getElementById(
        'ct-favorites-tab'
      );

    if (
      location.pathname !==
      '/profile'
    ) {
      tab?.remove();
      favoritesActive = false;
      closeFavoritesPanel();
      return;
    }

    const ref =
      findRepostTab();

    if (!ref) {
      tab?.remove();
      return;
    }

    if (!tab) {
      tab =
        document.createElement(
          'button'
        );

      tab.id =
        'ct-favorites-tab';

      tab.type =
        'button';

      tab.textContent =
        'お気に入り';

      const parent =
        ref.parentElement;

      if (!parent) return;

      parent.appendChild(
        tab
      );

      tab.onclick =
        event => {
          event.preventDefault();
          event.stopPropagation();

          favoritesActive =
            !favoritesActive;

          tab.dataset.active =
            favoritesActive
              ? '1'
              : '0';

          renderFavoritesPanel();
        };
    }

    tab.dataset.active =
      favoritesActive
        ? '1'
        : '0';
  }

  function centerRect() {
    const main =
      document.querySelector(
        'main'
      );

    if (!main) return null;

    const r =
      main.getBoundingClientRect();

    return r.width > 280
      ? r
      : null;
  }

  function panelHead(
    title,
    note,
    onClose
  ) {
    const head =
      document.createElement(
        'div'
      );

    head.className =
      'ct-local-head';

    const left =
      document.createElement(
        'div'
      );

    const titleEl =
      document.createElement(
        'div'
      );

    titleEl.className =
      'ct-local-title';

    titleEl.textContent =
      title;

    left.appendChild(
      titleEl
    );

    if (note) {
      const noteEl =
        document.createElement(
          'div'
        );

      noteEl.className =
        'ct-local-note';

      noteEl.textContent =
        note;

      left.appendChild(
        noteEl
      );
    }

    const close =
      document.createElement(
        'button'
      );

    close.className =
      'ct-local-close';

    close.textContent =
      '×';

    close.onclick =
      onClose;

    head.append(
      left,
      close
    );

    return head;
  }

  function localCard(
    item,
    reply = false
  ) {
    const row =
      document.createElement(
        'div'
      );

    row.className =
      'ct-local-card';

    if (
      item.avatar ||
      item.authorAvatar
    ) {
      const img =
        document.createElement(
          'img'
        );

      img.className =
        'ct-local-avatar';

      img.src =
        item.avatar ||
        item.authorAvatar;

      row.appendChild(
        img
      );
    }

    const main =
      document.createElement(
        'div'
      );

    main.className =
      'ct-local-main';

    if (reply) {
      const kicker =
        document.createElement(
          'div'
        );

      kicker.className =
        'ct-reply-kicker';

      kicker.textContent =
        'あなたのツイートに返信しました';

      main.appendChild(
        kicker
      );
    }

    const meta =
      document.createElement(
        'div'
      );

    meta.className =
      'ct-local-meta';

    const name =
      document.createElement(
        'span'
      );

    name.className =
      'ct-local-name';

    name.textContent =
      item.name ||
      item.authorName ||
      item.username ||
      item.authorUsername ||
      '';

    meta.appendChild(
      name
    );

    const username =
      item.username ||
      item.authorUsername;

    if (username) {
      const handle =
        document.createElement(
          'span'
        );

      handle.className =
        'ct-local-handle';

      handle.textContent =
        `@${username}`;

      meta.appendChild(
        handle
      );
    }

    main.appendChild(
      meta
    );

    if (item.text) {
      const text =
        document.createElement(
          'div'
        );

      text.className =
        'ct-local-text';

      text.textContent =
        item.text;

      main.appendChild(
        text
      );
    }

    row.appendChild(
      main
    );

    return row;
  }

  function closeFavoritesPanel() {
    document.getElementById(
      'ct-favorites-panel'
    )?.remove();
  }

  function renderFavoritesPanel() {
    if (
      !favoritesActive ||
      location.pathname !==
      '/profile'
    ) {
      closeFavoritesPanel();
      return;
    }

    const r =
      centerRect();

    if (!r) return;

    let panel =
      document.getElementById(
        'ct-favorites-panel'
      );

    if (!panel) {
      panel =
        document.createElement(
          'section'
        );

      panel.id =
        'ct-favorites-panel';

      document.body
        .appendChild(
          panel
        );
    }

    panel.style.left =
      `${Math.round(r.left)}px`;

    panel.style.top =
      `${
        Math.max(
          100,
          Math.round(
            r.top + 88
          )
        )
      }px`;

    panel.style.width =
      `${Math.round(r.width)}px`;

    panel.style.maxHeight =
      `calc(100vh - ${
        Math.max(
          110,
          Math.round(
            r.top + 100
          )
        )
      }px)`;

    panel.innerHTML =
      '';

    panel.appendChild(
      panelHead(
        '★ お気に入り',
        'このブラウザだけに保存されます',
        () => {
          favoritesActive =
            false;

          const tab =
            document.getElementById(
              'ct-favorites-tab'
            );

          if (tab) {
            tab.dataset.active =
              '0';
          }

          closeFavoritesPanel();
        }
      )
    );

    const data =
      loadFavorites();

    if (!data.length) {
      const empty =
        document.createElement(
          'div'
        );

      empty.className =
        'ct-local-empty';

      empty.textContent =
        'お気に入りはまだありません。';

      panel.appendChild(
        empty
      );

      return;
    }

    for (
      const item of
      data
    ) {
      const row =
        localCard(
          item,
          false
        );

      row.onclick =
        () => {
          if (item.href) {
            location.href =
              item.href;
          }
        };

      panel.appendChild(
        row
      );
    }
  }

  function notificationLeaves(
    root = document
  ) {
    const out = [];

    root.querySelectorAll?.(
      'main p,main span,main div'
    )
      .forEach(
        el => {
          if (!el.children.length) {
            const t =
              clean(
                el.textContent
              );

            if (
              t &&
              t.length < 500
            ) {
              out.push(el);
            }
          }
        }
      );

    return out;
  }

  function patchNotifications(
    root = document
  ) {
    if (
      !location.pathname
        .startsWith(
          '/notifications'
        )
    ) {
      return;
    }

    patchNotificationConnectors(
      root
    );

    patchNotificationParticles(
      root
    );

    for (
      const el of
      notificationLeaves(root)
    ) {
      const t =
        clean(
          el.textContent
        );

      if (!t) continue;

      const out =
        translateNotification(t) ||
        JP.get(t) ||
        dynamicJP(t);

      if (
        out &&
        out !== t
      ) {
        el.textContent =
          out;
      }

      const finalText =
        out ||
        t;

      if (
        /お気に入りに登録しました/
          .test(
            finalText
          )
      ) {
        const row =
          el.closest(
            'button,[role="button"]'
          ) ||
          el.parentElement;

        const svg =
          row?.querySelector(
            'svg'
          );

        if (svg) {
          svg.parentElement
            ?.classList.add(
              'ct-notification-fav-icon'
            );
        }
      }
    }

    patchNotificationConnectors(
      document
    );
  }

  function findAuth(
    value,
    depth = 0,
    seen = new WeakSet()
  ) {
    if (
      !value ||
      typeof value !==
        'object' ||
      depth > 7 ||
      seen.has(value)
    ) {
      return null;
    }

    seen.add(value);

    const token =
      value?.stsTokenManager
        ?.accessToken ||
      value?.accessToken ||
      value?.tokenManager
        ?.accessToken ||
      null;

    const uid =
      value?.uid ||
      value?.user?.uid ||
      value?.userId ||
      null;

    if (
      typeof token === 'string' &&
      token.length > 40
    ) {
      return {
        token,
        uid
      };
    }

    let values = [];

    try {
      values =
        Object.values(value);
    } catch {
      return null;
    }

    for (
      const child of
      values
    ) {
      if (
        child &&
        typeof child ===
          'object'
      ) {
        const hit =
          findAuth(
            child,
            depth + 1,
            seen
          );

        if (hit) return hit;
      }
    }

    return null;
  }

  function getAuth() {
    return new Promise(
      resolve => {
        let done = false;

        const finish =
          value => {
            if (!done) {
              done = true;

              resolve(
                value ||
                null
              );
            }
          };

        for (
          const storage of
          [
            localStorage,
            sessionStorage
          ]
        ) {
          try {
            for (
              let i = 0;
              i < storage.length;
              i += 1
            ) {
              const key =
                storage.key(i);

              if (
                !key ||
                !/firebase|auth/i
                  .test(key)
              ) {
                continue;
              }

              const raw =
                storage.getItem(
                  key
                );

              if (!raw) continue;

              let value = raw;

              try {
                value =
                  JSON.parse(raw);
              } catch {}

              const hit =
                findAuth(value);

              if (hit) {
                return finish(
                  hit
                );
              }
            }
          } catch {}
        }

        try {
          const request =
            indexedDB.open(
              'firebaseLocalStorageDb'
            );

          request.onerror =
            () =>
              finish(null);

          request.onsuccess =
            () => {
              const db =
                request.result;

              try {
                if (
                  !db.objectStoreNames
                    .contains(
                      'firebaseLocalStorage'
                    )
                ) {
                  return finish(
                    null
                  );
                }

                const tx =
                  db.transaction(
                    'firebaseLocalStorage',
                    'readonly'
                  );

                const all =
                  tx.objectStore(
                    'firebaseLocalStorage'
                  )
                    .getAll();

                all.onerror =
                  () =>
                    finish(
                      null
                    );

                all.onsuccess =
                  () => {
                    for (
                      const row of
                      all.result ||
                      []
                    ) {
                      const hit =
                        findAuth(
                          row?.value ??
                          row
                        );

                      if (hit) {
                        return finish(
                          hit
                        );
                      }
                    }

                    finish(null);
                  };
              } catch {
                finish(null);
              }
            };

          setTimeout(
            () =>
              finish(null),
            2500
          );
        } catch {
          finish(null);
        }
      }
    );
  }

  function authJSON(
    path,
    auth
  ) {
    if (!auth?.token) {
      return Promise.resolve(
        null
      );
    }

    return requestJSON(
      path.startsWith('http')
        ? path
        : API_ORIGIN +
          path,

      {
        Authorization:
          `Bearer ${auth.token}`
      }
    );
  }

  function items(
    json,
    keys = []
  ) {
    if (
      Array.isArray(json)
    ) {
      return json;
    }

    if (
      !json ||
      typeof json !==
        'object'
    ) {
      return [];
    }

    for (
      const key of
      [
        ...keys,
        'items',
        'notifications',
        'posts',
        'replies',
        'results'
      ]
    ) {
      if (
        Array.isArray(
          json[key]
        )
      ) {
        return json[key];
      }
    }

    return json.data
      ? items(
          json.data,
          keys
        )
      : [];
  }

  const postId =
    post =>
      String(
        post?.originalPostId ||
        post?.postId ||
        post?.id ||
        ''
      )
        .trim();

  const replyCount =
    post =>
      Number(
        post?.replyCount ??
        post?.comments ??
        post?.commentCount ??
        post?.repliesCount ??
        post?.reply_count ??
        0
      ) ||
      0;

  const author =
    post =>
      validUser(
        post?.authorUsername ||
        post?.authorHandle ||
        post?.author
          ?.username ||
        post?.username
      );

  const postText =
    post =>
      String(
        post?.text ||
        post?.body ||
        post?.content ||
        post?.replyText ||
        ''
      );

  const postName =
    post =>
      String(
        post?.authorName ||
        post?.actorName ||
        post?.author
          ?.displayName ||
        author(post) ||
        ''
      );

  const postAvatar =
    post =>
      String(
        post?.authorAvatar ||
        post?.actorAvatar ||
        post?.author
          ?.avatarUrl ||
        post?.avatarUrl ||
        ''
      );

  const postCreated =
    post =>
      String(
        post?.createdAt ||
        post?.created_at ||
        post?.timestamp ||
        ''
      );

  function loadReplyNotices() {
    const list =
      loadJSON(
        KEY.replyNotices,
        []
      );

    return Array.isArray(list)
      ? list
      : [];
  }

  function saveReplyNotice(
    reply,
    parentId = ''
  ) {
    const id =
      postId(reply);

    const username =
      author(reply);

    if (!id || !username) {
      return;
    }

    const list =
      loadReplyNotices();

    const old =
      list.find(
        x =>
          x.id === id
      );

    const record = {
      id,

      parentId:
        String(
          reply?.parentPostId ||
          reply?.parentId ||
          parentId ||
          ''
        ),

      authorUsername:
        username,

      authorName:
        postName(reply) ||
        username,

      authorAvatar:
        postAvatar(reply),

      text:
        postText(reply),

      createdAt:
        postCreated(reply) ||
        new Date()
          .toISOString(),

      detectedAt:
        Date.now(),

      read:
        old?.read ||
        false
    };

    saveJSON(
      KEY.replyNotices,
      [
        record,
        ...list.filter(
          x =>
            x.id !== id
        )
      ]
        .sort(
          (a,b) =>
            new Date(
              b.createdAt ||
              b.detectedAt
            ) -
            new Date(
              a.createdAt ||
              a.detectedAt
            )
        )
        .slice(
          0,
          100
        )
    );
  }

  function markReplyRead(id) {
    const list =
      loadReplyNotices();

    list.forEach(
      item => {
        if (
          item.id === id
        ) {
          item.read =
            true;
        }
      }
    );

    saveJSON(
      KEY.replyNotices,
      list
    );
  }

  let replyBusy = false;
  let lastFull = 0;

  async function replyWatchTick() {
    if (replyBusy) return;

    replyBusy = true;

    try {
      const auth =
        await getAuth();

      if (!auth?.token) {
        return;
      }

      const me =
        await authJSON(
          '/api/user-profile',
          auth
        );

      const myHandle =
        validUser(
          me?.username ||
          me?.handle ||
          me?.user?.username ||
          me?.profile?.username
        );

      const notificationsJson =
        await authJSON(
          '/api/notifications?limit=50',
          auth
        );

      for (
        const notification of
        items(
          notificationsJson,
          [
            'notifications'
          ]
        )
      ) {
        const type =
          String(
            notification?.type ||
            notification?.eventType ||
            notification?.kind ||
            notification?.notificationType ||
            ''
          )
            .toUpperCase();

        const message =
          String(
            notification?.message ||
            notification?.text ||
            ''
          );

        if (
          !type.includes(
            'REPLY'
          ) &&
          !/replied to|返信/i
            .test(message)
        ) {
          continue;
        }

        const object =
          notification?.reply ||
          notification?.post ||
          notification?.tweet ||
          notification;

        const id =
          postId(object) ||
          String(
            notification?.postId ||
            notification?.replyPostId ||
            notification?.id ||
            ''
          );

        const username =
          validUser(
            notification?.actorHandle ||
            notification?.actorUsername ||
            notification?.actor?.username ||
            author(object)
          );

        if (
          id &&
          username
        ) {
          saveReplyNotice(
            {
              ...object,
              id,

              authorUsername:
                username,

              authorName:
                notification?.actorName ||
                notification?.actorDisplayName ||
                notification?.actor?.displayName ||
                postName(object) ||
                username,

              authorAvatar:
                notification?.actorAvatar ||
                notification?.actor?.avatarUrl ||
                postAvatar(object),

              text:
                notification?.replyText ||
                notification?.postText ||
                postText(object),

              createdAt:
                notification?.createdAt ||
                notification?.created_at ||
                postCreated(object)
            },

            notification
              ?.parentPostId ||
            notification
              ?.targetPostId ||
            ''
          );
        }
      }

      if (!myHandle) {
        renderReplyPanel();
        patchReplyBadge();
        return;
      }

      const [
        postsJson,
        repliesJson
      ] =
        await Promise.all(
          [
            authJSON(
              `/api/users/${encodeURIComponent(myHandle)}/posts?limit=24`,
              auth
            ),

            authJSON(
              `/api/users/${encodeURIComponent(myHandle)}/replies`,
              auth
            )
          ]
        );

      const parents =
        [
          ...items(
            postsJson,
            [
              'posts'
            ]
          ),

          ...items(
            repliesJson,
            [
              'replies'
            ]
          )
        ]
          .filter(
            post =>
              postId(post) &&
              replyCount(post) > 0
          )
          .sort(
            (a,b) =>
              new Date(
                postCreated(b) ||
                0
              ) -
              new Date(
                postCreated(a) ||
                0
              )
          )
          .slice(
            0,
            24
          );

      const counts =
        loadJSON(
          KEY.replyCounts,
          {}
        );

      const seen =
        new Set(
          loadJSON(
            KEY.replySeen,
            []
          )
        );

      const initialized =
        localStorage.getItem(
          KEY.replyInit
        ) ===
        '1';

      const force =
        Date.now() -
        lastFull >
        10 *
        60 *
        1000;

      if (force) {
        lastFull =
          Date.now();
      }

      for (
        const parent of
        parents
      ) {
        const pid =
          postId(parent);

        const count =
          replyCount(parent);

        if (
          !force &&
          initialized &&
          counts[pid] ===
          count
        ) {
          continue;
        }

        const replyJson =
          await authJSON(
            `/api/posts/${encodeURIComponent(pid)}/replies?limit=50`,
            auth
          );

        for (
          const reply of
          items(
            replyJson,
            [
              'replies'
            ]
          )
        ) {
          const rid =
            postId(reply);

          if (
            !rid ||
            seen.has(rid)
          ) {
            continue;
          }

          const username =
            author(reply);

          if (
            !username ||
            normUser(
              username
            ) ===
            normUser(
              myHandle
            )
          ) {
            seen.add(rid);
            continue;
          }

          if (initialized) {
            saveReplyNotice(
              reply,
              pid
            );
          }

          seen.add(rid);
        }

        counts[pid] =
          count;
      }

      saveJSON(
        KEY.replyCounts,
        counts
      );

      saveJSON(
        KEY.replySeen,
        [...seen]
          .slice(
            -3000
          )
      );

      localStorage.setItem(
        KEY.replyInit,
        '1'
      );

      renderReplyPanel();
      patchReplyBadge();
    } catch (error) {
      console.debug(
        '[Classic Twitter JP reply watcher]',
        error
      );
    } finally {
      replyBusy = false;
    }
  }

  function closeReplyPanel() {
    document.getElementById(
      'ct-reply-panel'
    )?.remove();
  }

  function renderReplyPanel() {
    if (
      !location.pathname
        .startsWith(
          '/notifications'
        )
    ) {
      closeReplyPanel();
      return;
    }

    const data =
      loadReplyNotices()
        .filter(
          item =>
            !item.read
        );

    if (!data.length) {
      closeReplyPanel();
      return;
    }

    const r =
      centerRect();

    if (!r) return;

    let panel =
      document.getElementById(
        'ct-reply-panel'
      );

    if (!panel) {
      panel =
        document.createElement(
          'section'
        );

      panel.id =
        'ct-reply-panel';

      document.body
        .appendChild(
          panel
        );
    }

    panel.style.left =
      `${Math.round(r.left + 12)}px`;

    panel.style.top =
      `${
        Math.max(
          90,
          Math.round(
            r.top + 80
          )
        )
      }px`;

    panel.style.width =
      `${
        Math.max(
          280,
          Math.round(
            r.width - 24
          )
        )
      }px`;

    panel.innerHTML =
      '';

    panel.appendChild(
      panelHead(
        '↩ 新しい返信',
        'tweet.app本体で表示されない返信を補完しています',
        () => {
          data.forEach(
            item =>
              markReplyRead(
                item.id
              )
          );

          closeReplyPanel();
          patchReplyBadge();
        }
      )
    );

    for (
      const item of
      data
    ) {
      const row =
        localCard(
          item,
          true
        );

      row.onclick =
        () => {
          markReplyRead(
            item.id
          );

          if (item.id) {
            location.href =
              `/post/${encodeURIComponent(item.id)}`;
          }

          renderReplyPanel();
          patchReplyBadge();
        };

      panel.appendChild(
        row
      );
    }
  }

  function patchReplyBadge() {
    const count =
      loadReplyNotices()
        .filter(
          item =>
            !item.read
        )
        .length;

    let badge =
      document.getElementById(
        'ct-reply-badge'
      );

    const link =
      [
        ...document.querySelectorAll(
          'a,button'
        )
      ]
        .find(
          el =>
            /^(Notifications|通知)$/i
              .test(
                clean(
                  el.textContent
                )
              )
        );

    if (
      !count ||
      !link
    ) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge =
        document.createElement(
          'div'
        );

      badge.id =
        'ct-reply-badge';

      document.body
        .appendChild(
          badge
        );
    }

    const r =
      link.getBoundingClientRect();

    badge.textContent =
      String(count);

    badge.style.left =
      `${Math.round(r.right - 8)}px`;

    badge.style.top =
      `${Math.round(r.top + 2)}px`;
  }

  function scan(
    root = document
  ) {
    try {
      installStyle();
      hideAffiliation();
      patchBrand();
      patchUI(root);

      patchReplyingTo(root);
      patchSafariTopTitle();
      patchInputs(root);
      patchNotifications(root);
      patchFavoriteButtons(root);
      patchFeed(root);
      patchRetweetRows(root);
      patchProfileFounder();
      patchProfileMute();
      patchOpenMuteMenu();
      patchFavoriteProfileTab();

      if (favoritesActive) {
        renderFavoritesPanel();
      }

      renderReplyPanel();
      patchReplyBadge();

    } catch (error) {
      console.debug(
        '[Classic Twitter JP]',
        error
      );
    }
  }

  let scanTimer = null;

  const observer =
    new MutationObserver(
      mutations => {
        clearTimeout(
          scanTimer
        );

        scanTimer =
          setTimeout(
            () => {
              const roots =
                new Set();

              for (
                const mutation of
                mutations
              ) {
                if (
                  mutation.target instanceof
                  Element
                ) {
                  roots.add(
                    mutation.target
                  );
                }

                for (
                  const node of
                  mutation.addedNodes
                ) {
                  if (
                    node.nodeType ===
                    Node.ELEMENT_NODE
                  ) {
                    roots.add(
                      node
                    );
                  }
                }
              }

              roots.forEach(
                scan
              );

              scan(document);
            },
            120
          );
      }
    );

  function startObserver() {
    if (
      !document.documentElement
    ) {
      setTimeout(
        startObserver,
        0
      );

      return;
    }

    observer.observe(
      document.documentElement,
      {
        childList:true,
        subtree:true,
        characterData:true,
        attributes:true,
        attributeFilter:[
          'aria-pressed',
          'aria-checked'
        ]
      }
    );
  }

  startObserver();

  let layoutRaf = 0;

  function syncPanels() {
    cancelAnimationFrame(
      layoutRaf
    );

    layoutRaf =
      requestAnimationFrame(
        () => {
          if (favoritesActive) {
            renderFavoritesPanel();
          }

          renderReplyPanel();
          patchReplyBadge();
        }
      );
  }

  window.addEventListener(
    'resize',
    syncPanels,
    {
      passive:true
    }
  );

  window.addEventListener(
    'scroll',
    syncPanels,
    {
      passive:true
    }
  );

  function start() {
    scan(document);

    [
      300,
      800,
      1600
    ]
      .forEach(
        delay =>
          setTimeout(
            () =>
              scan(document),
            delay
          )
      );

    setInterval(
      () =>
        scan(document),
      3000
    );

    setTimeout(
      replyWatchTick,
      1800
    );

    setInterval(
      replyWatchTick,
      45000
    );
  }

  if (
    document.readyState ===
      'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once:true
      }
    );
  } else {
    start();
  }

  console.log(
    '🐦 Classic Twitter JP v6.2.7 Safari/Stay Founder fix loaded'
  );
})();
