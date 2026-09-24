// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese
// @namespace    https://tweet.app/
// @version      6.5.3
// @description  tweet.appを旧Twitter風に日本語化。表示名、Founder Number、★お気に入り、リツイート、通知、返信通知補完、ローカルミュート、自分専用お気に入り一覧に対応。テーマには干渉しません。
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
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
    replyInit: 'classicTwitterJP.replyWatcherInitialized',
    autoTranslate: 'classicTwitterJP.autoTranslate'
  };

  const profileCache = new Map();
  const profilePending = new Map();

  const clean = v =>
    String(v ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  const normUser = v =>
    clean(v)
      .replace(/^@/, '')
      .toLowerCase();

  const validUser = v => {
    const s = clean(v).replace(/^@/, '');

    return /^[A-Za-z0-9_.-]{1,80}$/.test(s)
      ? s
      : null;
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(
        localStorage.getItem(key) || 'null'
      );

      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(value)
      );
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

    // Backup codes / security
    ['Backup codes', 'バックアップコード'],
    ['Generate new codes', '新しいコードを生成'],
    ['codes remaining', '個のコードが残っています'],
    ['code remaining', '個のコードが残っています'],

    // Wing badge / loading states
    ['You earned the Wing badge for inviting 5 friends who joined.', '5人の友だちを招待したので、Wingバッジを獲得しました！'],
    ['awarded you a badge', 'あなたにバッジを贈りました'],
    ['Loading account...', 'アカウント情報を読み込み中…'],
    ['Loading followed hashtags...', 'フォロー中のハッシュタグを読み込み中…'],
    ['Loading more followed hashtags', 'フォロー中のハッシュタグをさらに読み込み中…'],
    ['Loading more muted accounts', 'ミュートしているアカウントをさらに読み込み中…'],
    ['Loading muted accounts...', 'ミュートしているアカウントを読み込み中…'],
    ['Loading more notifications', '通知をさらに読み込み中…'],
    ['Loading more notifications...', '通知をさらに読み込み中…'],
    ['Loading notifications...', '通知を読み込み中…'],
    ['Loading notification...', '通知を読み込み中…'],
    ['Loading profile...', 'プロフィールを読み込み中…'],
    ['Loading posts...', 'ツイートを読み込み中…'],
    ['Loading more posts...', 'ツイートをさらに読み込み中…'],
    ['Loading followers...', 'フォロワーを読み込み中…'],
    ['Loading following...', 'フォロー中のユーザーを読み込み中…'],
    ['Loading more', 'さらに読み込み中…'],
    ['Load more', 'さらに読み込む'],

    // Settings / loading / notifications refinements
    ['See your account information like your username and date of birth.', 'ユーザー名や生年月日などのアカウント情報を確認できます。'],
    ['Founding plan', 'Foundingプラン'],
    ['You have Centurion.', 'Centurionを利用中です。'],
    ['Generating new codes invalidates any unused codes you already have.', '新しいコードを生成すると、現在お持ちの未使用コードはすべて無効になります。'],
    ['Manage two-factor authentication and sign-in protection.', '2要素認証とログイン保護を管理します。'],
    ["You aren't following any hashtags.", 'フォローしているハッシュタグはありません。'],
    ["You haven't muted anyone.", 'ミュートしているアカウントはありません。'],
    ['Loading muted', 'ミュートしているアカウントを読み込み中…'],
    ['Loading notifications', '通知を読み込み中…'],
    ['Loading notification', '通知を読み込み中…'],
    ['No verified account notifications yet.', '認証済みアカウントからの通知はまだありません。'],
    ['quoted your post', 'あなたのツイートを引用しました'],
    ['quoted your tweet', 'あなたのツイートを引用しました'],
    ['posted', 'ツイートしました'],
    ['reposted', 'リツイートしました'],
    ['retweeted', 'リツイートしました'],
    ['removed a repost', 'リツイートを取り消しました'],
    ['removed a retweet', 'リツイートを取り消しました'],
    ['Your post was sent.', 'ツイートしました'],
    ['Repost removed.', 'リツイートを取り消しました'],
    ['Post deleted.', 'ツイートを削除しました'],

    // Invite / referral
    ['Invite', '招待する'],
    ['Invite friends', '友だちを招待しよう！'],
    ['Share your personal invite link with friends by text, email, or anywhere else.', 'あなた専用の招待リンクを、メッセージやメールなどで友だちにシェアしよう！'],
    ['Share invite', '招待リンクをシェア'],
    ['Link opens', 'リンクを開いた人数'],
    ['Signed up', '登録した人数'],
    ['Friends who joined', '参加した友だち'],
    ['Earn a Wing badge!', 'Wingバッジを獲得しよう！'],
    ['How it works:', '仕組み:'],
    ['Share your invite link with friends.', '招待リンクを友だちにシェアします。'],
    ['They sign up. Once they confirm their email, pay, and activate their account, that counts as one friend.', '友だちが登録し、メール認証・支払い・アカウントの有効化を完了すると、1人としてカウントされます。'],
    ['Get 5 friends → get a Wing badge!', '5人の友だちが参加すると、Wingバッジを獲得できます！'],
    ['Share your personal invite link.', 'あなた専用の招待リンクをシェアしよう！'],
    ['Invalid invite link.', 'この招待リンクは無効です'],
    ['Invite link is missing.', '招待リンクが見つかりません'],
    ['Could not validate invite link.', '招待リンクを確認できませんでした'],
    ['Could not redeem invite.', '招待を利用できませんでした'],
    ['Copy link', 'リンクをコピー'],
    ['Share', 'シェア'],
    ['Share post', 'ツイートをシェア'],
    ['Shared post', 'シェアされたツイート'],

    // Post editing
    ['Edit post', 'ツイートを編集'],
    ['Edit your post...', 'ツイートを編集...'],
    ['Edited', '編集済み'],
    ['Post updated.', 'ツイートを更新しました'],
    ['The edit window for this post has closed.', 'このツイートの編集可能時間は終了しました'],
    ['This edit could not be saved. Your post is unchanged.', '編集を保存できませんでした。ツイートは変更されていません'],
    ['Editing is temporarily unavailable. Try again shortly.', '現在、編集機能を利用できません。しばらくしてからもう一度お試しください'],

    // Hashtags
    ['Hashtag', 'ハッシュタグ'],
    ['Hashtag suggestions', 'ハッシュタグ候補'],
    ['Followed hashtags', 'フォロー中のハッシュタグ'],
    ['View and unfollow hashtags you follow.', 'フォローしているハッシュタグを確認・解除できます'],
    ['Posts with these hashtags are boosted in your For You feed. Unfollow one here to stop boosting it.', 'フォローしたハッシュタグのツイートは「おすすめ」に表示されやすくなります。ここからフォローを解除できます。'],
    ['No hashtags found.', 'ハッシュタグが見つかりません'],
    ['Loading followed hashtags...', 'フォロー中のハッシュタグを読み込んでいます…'],
    ['Something went wrong loading hashtags you follow.', 'フォロー中のハッシュタグを読み込めませんでした'],

    // Mute / reports
    ['Mute user', 'ミュートする'],
    ['Unmute', 'ミュートを解除'],
    ['Unmute user', 'ミュートを解除'],
    ['User muted.', 'アカウントをミュートしました'],
    ['View and unmute the accounts you have muted.', 'ミュートしているアカウントを確認・解除できます'],
    ['Muted accounts stay hidden from your For You feed. Unmute one here to see their posts again.', 'ミュートしたアカウントのツイートは「おすすめ」に表示されません。ここからミュートを解除できます。'],
    ['Report', '報告する'],
    ['Submit report', '報告を送信'],
    ['Thanks for your report', 'ご報告ありがとうございます'],
    ['Why are you reporting this?', 'このツイートを報告する理由を選んでください'],
    ['Report submitted.', '報告を送信しました'],
    ['Your report is private. We use it to review and improve safety.', '報告内容が他のユーザーに公開されることはありません。安全性向上のため確認を行います。'],
    ['Only you see this notice. Our team will review the report.', 'このお知らせはあなたにのみ表示されています。運営チームが報告内容を確認します。'],
    ['Manipulated media', '加工・改変されたメディア'],
    ['Likely false claim', '誤解を招く可能性のある情報'],

    // Translation / profile copy
    ['Translate', '翻訳する'],
    ['Translated', '翻訳済み'],
    ["Couldn’t translate. Try again.", '翻訳できませんでした。もう一度お試しください。'],
    ['Manage your public profile, photo, and bio.', 'プロフィール、写真、自己紹介を編集できます'],

    // Official role badge names intentionally remain unchanged
    ['Team Member', 'Team Member'],
    ['Tweet Ambassador', 'Tweet Ambassador'],

    ['Search', '検索'],
    ['Search Twitter', 'Twitterを検索'],

    ['Account', 'アカウント'],
    ['Your account', 'アカウント'],
    ['Account settings', 'アカウント設定'],

    ['Replying to', '返信先:'],
    ['Show translation', '翻訳を表示'],
    ['Show original', '原文を表示'],
    ['See account information like your username and date of birth.', 'ユーザー名や生年月日などのアカウント情報を確認します。'],
    ['Manage your public profile, photo, and more.', '公開プロフィール、プロフィール画像などを管理します。'],
    ['Manage two-factor authentication and security.', '2要素認証などのセキュリティ設定を管理します。'],
    ['Manage two-factor authentication and account security.', '2要素認証などのセキュリティ設定を管理します。'],
    ['Update your public profile. To change your username or email, go to Your account.', '公開プロフィールを編集します。ユーザー名やメールアドレスを変更するには、アカウント設定を開いてください。'],
    ['Help protect your account from unauthorized access by requiring a second authentication method in addition to your password.', 'パスワードに加えて2つ目の認証方法を使用し、不正アクセスからアカウントを保護します。'],
    ['Your username was set when you created your account and cannot be changed here.', 'ユーザー名はアカウント作成時に設定されたため、ここでは変更できません。'],
    ['APPEARANCE', '外観'],
    ['Appearance', '外観'],
    ['System', 'システム'],
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

    ['Repost removed', 'リツイートを取り消しました'],
    ['Repost added', 'リツイートしました'],
    ['Post reposted', 'リツイートしました'],
    ['Retweet removed', 'リツイートを取り消しました'],

    ['Post liked', 'お気に入りに登録しました'],
    ['Like removed', 'お気に入りを解除しました'],

    ['Copied to clipboard', 'クリップボードにコピーしました'],
    ['Post deleted', 'ツイートを削除しました'],
    ['Post posted', 'ツイートしました'],

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
    if (document.getElementById('ct-jp-style')) {
      return;
    }

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
        0% {
          transform:translateY(-1px) scale(.72) rotate(-8deg);
          opacity:.55;
        }

        48% {
          transform:translateY(-1px) scale(1.3) rotate(6deg);
        }

        74% {
          transform:translateY(-1px) scale(.94) rotate(-2deg);
        }

        100% {
          transform:translateY(-1px) scale(1);
        }
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

      #ct-favorites-panel {
        border-radius:0 0 12px 12px;
      }

      #ct-reply-panel {
        border-radius:14px;
        max-height:min(48vh,460px);
      }

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

      .ct-local-title {
        font-weight:800;
      }

      .ct-local-note {
        font-size:11px;
        opacity:.6;
        margin-top:2px;
      }

      .ct-local-close {
        border:0;
        background:transparent;
        color:inherit;
        cursor:pointer;
        font-size:20px;
        padding:3px 8px;
        border-radius:999px;
      }

      .ct-local-close:hover {
        background:rgba(127,127,127,.14);
      }

      .ct-local-card {
        display:flex;
        gap:10px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        cursor:pointer;
      }

      .ct-local-card:hover {
        background:rgba(127,127,127,.08);
      }

      .ct-local-avatar {
        width:40px;
        height:40px;
        border-radius:999px;
        object-fit:cover;
        flex:0 0 auto;
        background:rgba(127,127,127,.25);
      }

      .ct-local-main {
        min-width:0;
        flex:1;
      }

      .ct-local-meta {
        display:flex;
        gap:4px;
        flex-wrap:wrap;
        align-items:center;
        font-size:13px;
        line-height:18px;
      }

      .ct-local-name {
        font-weight:800;
      }

      .ct-local-handle,
      .ct-local-time {
        opacity:.62;
      }

      .ct-local-text {
        margin-top:3px;
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        font-size:14px;
        line-height:20px;
      }

      .ct-local-empty {
        padding:28px 18px;
        text-align:center;
        opacity:.65;
      }

      .ct-reply-kicker {
        font-size:12px;
        color:#1d9bf0;
        margin-bottom:3px;
      }

      .ct-exact-post-time {
        font-size:10px;
        opacity:.48;
        font-weight:400;
        white-space:nowrap;
        margin-left:1px;
      }

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

    (
      document.head ||
      document.documentElement
    ).appendChild(style);
  }

  function dynamicJP(t) {
    let m;

    
    // Notification grammar normalization
    if ((m = t.match(/^(.+?)さんがあなたを@ツイートしました$/))) {
      return `${m[1]}さんがあなた宛てにツイートしました`;
    }

    if ((m = t.match(/^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i))) {
      return `${m[1]}さんがあなた宛てにツイートしました`;
    }

    if ((m = t.match(/^(.+?)\s+quoted your (?:post|tweet)$/i))) {
      return `${m[1]}さんがあなたのツイートを引用しました`;
    }

    if ((m = t.match(/^Replying\s+to\s+(.+)$/i))) {
      const targets = m[1].replace(
        /(@[A-Za-z0-9_.-]{1,80})(?!さん)/g,
        '$1さん'
      );

      return `返信先: ${targets}`;
    }

if (/^just\s+now$/i.test(t)) {
      return 'たった今';
    }

    if ((m = t.match(/^(\d+)s$/))) {
      return `${m[1]}秒`;
    }

    if ((m = t.match(/^(\d+)m$/))) {
      return `${m[1]}分`;
    }

    if ((m = t.match(/^(\d+)h$/))) {
      return `${m[1]}時間`;
    }

    if ((m = t.match(/^(\d+)d$/))) {
      return `${m[1]}日`;
    }

    if ((m = t.match(/^Joined\s+(.+)$/i))) {
      return `${m[1]}からTwitterを利用しています`;
    }

    if ((m = t.match(/^(\d+)\s+codes?\s+remaining$/i))) {
      return `${m[1]}個のコードが残っています`;
    }

    if ((m = t.match(/^参加した人数\s+(.+)$/))) {
      return `${m[1]}からTwitterを利用しています`;
    }

    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Following$/i))) {
      return `${m[1]}人 フォロー中`;
    }

    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Followers?$/i))) {
      return `${m[1]}人 フォロワー`;
    }

    if ((m = t.match(/^([\d,.]+[KMB]?)\s+Tweets?$/i))) {
      return `${m[1]} ツイート`;
    }

    if ((m = t.match(/^Logged in as\s+(.+)$/i))) {
      return `${m[1]}としてログイン中`;
    }

    if ((m = t.match(/^Version\s+(.+)$/i))) {
      return `バージョン ${m[1]}`;
    }

    if ((m = t.match(/^and\s+(\d+)\s+others?$/i))) {
      return `とそのほか${m[1]}人`;
    }

    if ((m = t.match(/^(\d+)\s+others?$/i))) {
      return `そのほか${m[1]}人`;
    }

    return null;
  }

  function actorJP(s) {
    return clean(s)
      .replace(/\s+and\s+/gi, '、')
      .replace(/\s*,\s*/g, '、')
      .split('、')
      .map(x =>
        clean(x).replace(/さん$/, '')
      )
      .filter(Boolean)
      .map(x => `${x}さん`)
      .join('と');
  }

  function translateNotification(t) {
    t = clean(t);

    if (!t) {
      return null;
    }

    let m;

    const many = [
      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+(?:liked|favorited) your (?:post|tweet)$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたのツイートをお気に入りに登録しました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたのツイートをリツイートしました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+followed you$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたをフォローしました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+mentioned you(?: in a (?:post|tweet))?$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたを@ツイートしました`
      ],

      [
        /^(.+?)\s+and\s+(\d+)\s+others?\s+replied to (?:your (?:post|tweet)|you)$/i,
        (a, n) =>
          `${actorJP(a)}、そのほか${n}人があなたのツイートに返信しました`
      ]
    ];

    for (const [re, fn] of many) {
      if ((m = t.match(re))) {
        return fn(
          m[1],
          m[2]
        );
      }
    }

    const one = [
      [
        /^(.+?)\s+(?:liked|favorited) your (?:post|tweet)$/i,
        a =>
          `${actorJP(a)}があなたのツイートをお気に入りに登録しました`
      ],

      [
        /^(.+?)\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        a =>
          `${actorJP(a)}があなたのツイートをリツイートしました`
      ],

      [
        /^(.+?)\s+followed you$/i,
        a =>
          `${actorJP(a)}があなたをフォローしました`
      ],

      [
        /^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i,
        a =>
          `${actorJP(a)}があなたを@ツイートしました`
      ],

      [
        /^(.+?)\s+replied to your (?:post|tweet)$/i,
        a =>
          `${actorJP(a)}があなたのツイートに返信しました`
      ],

      [
        /^(.+?)\s+replied to you$/i,
        a =>
          `${actorJP(a)}があなたに返信しました`
      ],

      [
        /^(.+?)\s+(?:liked|favorited) your reply$/i,
        a =>
          `${actorJP(a)}があなたの返信をお気に入りに登録しました`
      ],

      [
        /^(.+?)\s+(?:reposted|retweeted) your reply$/i,
        a =>
          `${actorJP(a)}があなたの返信をリツイートしました`
      ]
    ];

    for (const [re, fn] of one) {
      if ((m = t.match(re))) {
        return fn(
          m[1]
        );
      }
    }

    return null;
  }

  function translateTextNode(node) {
    const parent =
      node?.parentElement;

    if (!parent?.isConnected) {
      return;
    }

    if (
      parent.closest(
        'textarea,input,[contenteditable="true"],script,style'
      )
    ) {
      return;
    }

    const raw =
      node.nodeValue || '';

    const t =
      clean(raw);

    if (
      !t ||
      t.length > 500
    ) {
      return;
    }

    let out =
      null;

    if (
      location.pathname.startsWith(
        '/notifications'
      )
    ) {
      let m;

      if (/^and$/i.test(t)) {
        out = 'と';
      }

      else if (
        (
          m =
            t.match(
              /^and\s+(\d+)\s+others?$/i
            )
        )
      ) {
        out =
          `とそのほか${m[1]}人`;
      }

      else if (
        (
          m =
            t.match(
              /^(\d+)\s+others?$/i
            )
        )
      ) {
        out =
          `そのほか${m[1]}人`;
      }
    }

    if (!out) {
      out =
        translateNotification(t)
        ||
        JP.get(t)
        ||
        dynamicJP(t);
    }

    if (
      out &&
      out !== t
    ) {
      node.nodeValue =
        raw.replace(
          t,
          out
        );
    }
  }

  function patchUI(
    root =
      document
  ) {
    const host =
      root instanceof Node
        ? root
        : document;

    const walker =
      document.createTreeWalker(
        host,
        NodeFilter.SHOW_TEXT
      );

    const nodes =
      [];

    let node;

    while (
      (
        node =
          walker.nextNode()
      )
    ) {
      nodes.push(
        node
      );
    }

    nodes.forEach(
      translateTextNode
    );
  }

  function notificationTextNodes(
    root =
      document
  ) {
    const main =
      root instanceof Element &&
      root.matches('main')
        ? root
        : root.querySelector?.('main')
          ||
          document.querySelector('main');

    if (!main) {
      return [];
    }

    const walker =
      document.createTreeWalker(
        main,
        NodeFilter.SHOW_TEXT
      );

    const nodes =
      [];

    let node;

    while (
      (
        node =
          walker.nextNode()
      )
    ) {
      const parent =
        node.parentElement;

      if (
        !parent?.isConnected
      ) {
        continue;
      }

      if (
        parent.closest(
          'textarea,input,[contenteditable="true"],script,style'
        )
      ) {
        continue;
      }

      nodes.push(
        node
      );
    }

    return nodes;
  }

  function nearestUsefulSibling(
    node,
    direction
  ) {
    let cur =
      direction < 0
        ? node.previousSibling
        : node.nextSibling;

    while (cur) {
      const text =
        clean(
          cur.textContent
        );

      if (text) {
        return cur;
      }

      cur =
        direction < 0
          ? cur.previousSibling
          : cur.nextSibling;
    }

    return null;
  }

  function patchNotificationConnectors(
    root =
      document
  ) {
    if (
      !location.pathname.startsWith(
        '/notifications'
      )
    ) {
      return;
    }

    const nodes =
      notificationTextNodes(
        root
      );

    for (const node of nodes) {
      const raw =
        node.nodeValue || '';

      const t =
        clean(raw);

      if (
        !t ||
        t.length > 64
      ) {
        continue;
      }

      let out =
        null;

      let m;

      if (/^and$/i.test(t)) {
        out =
          'と';
      }

      else if (
        (
          m =
            t.match(
              /^and\s+(\d+)\s+others?$/i
            )
        )
      ) {
        out =
          `とそのほか${m[1]}人`;
      }

      else if (
        (
          m =
            t.match(
              /^(\d+)\s+others?$/i
            )
        )
      ) {
        out =
          `そのほか${m[1]}人`;
      }

      if (out) {
        node.nodeValue =
          raw.replace(
            t,
            out
          );
      }
    }

    for (const node of nodes) {
      const t =
        clean(
          node.nodeValue || ''
        );

      if (!t) {
        continue;
      }

      if (
        /^others?$/i.test(t)
      ) {
        const prev =
          nearestUsefulSibling(
            node,
            -1
          );

        const pt =
          clean(
            prev?.textContent
          );

        if (
          /^\d+$/.test(pt)
        ) {
          const n = pt;

          if (
            prev.nodeType ===
            Node.TEXT_NODE
          ) {
            prev.nodeValue =
              `そのほか${n}人`;
          }

          else if (
            prev instanceof Element &&
            !prev.children.length
          ) {
            prev.textContent =
              `そのほか${n}人`;
          }

          else {
            node.nodeValue =
              `そのほか${n}人`;
          }

          if (
            clean(
              node.nodeValue || ''
            ) !==
            `そのほか${n}人`
          ) {
            node.nodeValue =
              '';
          }
        }
      }

      if (
        /^\d+$/.test(t)
      ) {
        const next =
          nearestUsefulSibling(
            node,
            1
          );

        const nt =
          clean(
            next?.textContent
          );

        if (
          /^others?$/i.test(nt)
        ) {
          const n =
            t;

          node.nodeValue =
            `そのほか${n}人`;

          if (
            next.nodeType ===
            Node.TEXT_NODE
          ) {
            next.nodeValue =
              '';
          }

          else if (
            next instanceof Element &&
            !next.children.length
          ) {
            next.textContent =
              '';
          }
        }
      }
    }

    const main =
      document.querySelector(
        'main'
      );

    if (!main) {
      return;
    }

    for (
      const el of
      main.querySelectorAll(
        'span,small,strong,a,button,div,p'
      )
    ) {
      if (
        !el.isConnected ||
        el.closest(
          'textarea,input,[contenteditable="true"]'
        )
      ) {
        continue;
      }

      if (
        el.children.length > 1
      ) {
        continue;
      }

      const t =
        clean(
          el.textContent
        );

      if (
        !t ||
        t.length > 64
      ) {
        continue;
      }

      let m;

      if (
        (
          m =
            t.match(
              /^and\s+(\d+)\s+others?$/i
            )
        )
      ) {
        el.textContent =
          `とそのほか${m[1]}人`;
      }

      else if (
        (
          m =
            t.match(
              /^(\d+)\s+others?$/i
            )
        )
      ) {
        el.textContent =
          `そのほか${m[1]}人`;
      }

      else if (
        /^and$/i.test(t)
      ) {
        el.textContent =
          'と';
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

  function patchInputs(
    root =
      document
  ) {
    const list =
      [];

    if (
      root instanceof Element &&
      root.matches(
        'input[placeholder],textarea[placeholder]'
      )
    ) {
      list.push(
        root
      );
    }

    root.querySelectorAll?.(
      'input[placeholder],textarea[placeholder]'
    )
      .forEach(
        el =>
          list.push(
            el
          )
      );

    for (const el of list) {
      const p =
        el.getAttribute(
          'placeholder'
        ) || '';

      if (
        /what'?s happening/i.test(p)
      ) {
        el.placeholder =
          'いまどうしてる？';
      }

      else if (
        /^search/i.test(p)
      ) {
        el.placeholder =
          '検索';
      }

      else if (
        /^post your reply$/i.test(p)
      ) {
        el.placeholder =
          '返信をツイート';
      }

      else if (
        /^add your thoughts/i.test(p)
      ) {
        el.placeholder =
          'コメントを追加…';
      }
    }
  }

  function hideAffiliation() {
    document.querySelectorAll(
      'span,p,div,a,small'
    )
      .forEach(
        el => {
          if (
            el.isConnected &&
            !el.children.length &&
            /^Not Affiliated with X$/i.test(
              clean(
                el.textContent
              )
            )
          ) {
            el.style.setProperty(
              'display',
              'none',
              'important'
            );
          }
        }
      );
  }

  function patchBrand() {
    document.querySelectorAll(
      'img'
    )
      .forEach(
        img => {
          if (
            !img.isConnected ||
            img.dataset.ctBrandPatched ===
              '1'
          ) {
            return;
          }

          if (
            img.closest(
              'article'
            )
          ) {
            return;
          }

          const alt =
            clean(
              img.getAttribute(
                'alt'
              ) || ''
            );

          const title =
            clean(
              img.getAttribute(
                'title'
              ) || ''
            );

          const rawSrc =
            img.getAttribute(
              'src'
            ) || '';

          let path =
            '';

          try {
            path =
              new URL(
                rawSrc,
                location.href
              ).pathname;
          } catch {
            path =
              rawSrc;
          }

          if (
            /avatar|profile|media|photo|processed|firebase/i
              .test(
                `${alt} ${title} ${path}`
              )
          ) {
            return;
          }

          const isBrandAsset =
            /\/assets\/brand\/[^/]*(?:bird|logo|twitter|tweet)[^/]*\.(?:svg|png|webp)$/i
              .test(path);

          const isExplicitBrandAlt =
            /^(?:twitter|tweet|twitter logo|tweet logo|brand logo|bird logo)$/i
              .test(
                `${alt} ${title}`.trim()
              );

          if (
            !isBrandAsset &&
            !isExplicitBrandAlt
          ) {
            return;
          }

          const r =
            img.getBoundingClientRect();

          if (
            r.width > 80 ||
            r.height > 80
          ) {
            return;
          }

          img.src =
            LOGO;

          img.classList.add(
            'ct-twitter-logo'
          );

          img.dataset.ctBrandPatched =
            '1';
        }
      );
  }

  function requestJSON(
    url,
    headers = {}
  ) {
    if (
      typeof GM_xmlhttpRequest ===
      'function'
    ) {
      return new Promise(
        resolve => {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 12000,

            headers: {
              Accept: 'application/json',
              ...headers
            },

            onload: response => {
              try {
                resolve(
                  response.status >= 200 &&
                  response.status < 300
                    ? JSON.parse(
                        response.responseText
                      )
                    : null
                );
              } catch {
                resolve(
                  null
                );
              }
            },

            onerror: () =>
              resolve(null),

            ontimeout: () =>
              resolve(null)
          });
        }
      );
    }

    return fetch(
      url,
      {
        headers: {
          Accept: 'application/json',
          ...headers
        }
      }
    )
      .then(
        r =>
          r.ok
            ? r.json()
            : null
      )
      .catch(
        () =>
          null
      );
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

  function userFromHref(
    href
  ) {
    try {
      const m =
        new URL(
          href,
          location.origin
        )
          .pathname
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

    } catch {
      return null;
    }
  }

  function articleAuthor(
    article
  ) {
    if (!article) {
      return null;
    }

    for (
      const el of
      article.querySelectorAll(
        'button[aria-label],a[href],span,div'
      )
    ) {
      let m =
        (
          el.getAttribute?.(
            'aria-label'
          ) || ''
        )
          .match(
            /^View @(.+?)'s profile$/i
          );

      if (m) {
        return validUser(
          m[1]
        );
      }

      const user =
        userFromHref(
          el.getAttribute?.(
            'href'
          ) || ''
        );

      if (user) {
        return user;
      }

      if (
        !el.children.length &&
        (
          m =
            clean(
              el.textContent
            )
              .match(
                /^@([A-Za-z0-9_.-]{1,80})$/
              )
        )
      ) {
        return validUser(
          m[1]
        );
      }
    }

    return null;
  }

  function findAuthorLeaf(
    article,
    username
  ) {
    const target =
      normUser(
        username
      );

    return (
      [
        ...article.querySelectorAll(
          'button,span,a,div,strong'
        )
      ]
        .find(
          el => {
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
              normUser(t) === target
              ||
              normUser(
                t.replace(
                  /^@/,
                  ''
                )
              ) === target
            );
          }
        )
      ||
      null
    );
  }

  let muted =
    new Set(
      (
        loadJSON(
          KEY.muted,
          []
        ) || []
      )
        .map(
          normUser
        )
        .filter(
          Boolean
        )
    );

  const isMuted =
    username =>
      muted.has(
        normUser(
          username
        )
      );

  function saveMuted() {
    saveJSON(
      KEY.muted,
      [...muted].sort()
    );
  }

  function toggleMuted(
    username
  ) {
    const key =
      normUser(
        username
      );

    if (!key) {
      return;
    }

    if (
      muted.has(
        key
      )
    ) {
      muted.delete(
        key
      );
    } else {
      muted.add(
        key
      );
    }

    saveMuted();

    patchFeed(
      document
    );

    patchProfileMute();
  }

  async function patchArticle(article) {
    if (!article?.isConnected) return;
    const username = articleAuthor(article);
    if (!username) return;
    if (isMuted(username)) {
      article.style.setProperty('display', 'none', 'important');
      return;
    }
    article.style.removeProperty('display');
    const user = await fetchProfile(username);
    if (!user || !article.isConnected) return;
    const displayName = clean(user.displayName || user.name || username);
    const leaf = findAuthorLeaf(article, username);
    if (!leaf || !displayName) return;
    leaf.textContent = displayName;
    leaf.classList.add('ct-author-name');
    let badge = leaf.parentElement?.querySelector(':scope > .ct-founder');
    const number = user.foundingMemberNumber;
    if (number !== null && number !== undefined && number !== '') {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ct-founder';
        leaf.after(badge);
      }
      const founder = String(number).padStart(5, '0');
      badge.textContent = `#${founder}`;
      badge.title = `Founder Number #${founder}`;
    } else {
      badge?.remove();
    }
  }

  function collectArticles(
    root =
      document
  ) {
    const set =
      new Set();

    if (
      root instanceof Element
    ) {
      if (
        root.matches(
          'article'
        )
      ) {
        set.add(
          root
        );
      }

      const parent =
        root.closest(
          'article'
        );

      if (parent) {
        set.add(
          parent
        );
      }
    }

    root.querySelectorAll?.(
      'article'
    )
      .forEach(
        article =>
          set.add(
            article
          )
      );

    return set;
  }

  function patchFeed(
    root =
      document
  ) {
    for (
      const article of
      collectArticles(
        root
      )
    ) {
      patchArticle(
        article
      );
    }
  }

  async function patchRetweetRows(
    root =
      document
  ) {
    const leaves =
      [];

    root.querySelectorAll?.(
      'span,div,p'
    )
      .forEach(
        el => {
          if (
            !el.children.length
          ) {
            leaves.push(
              el
            );
          }
        }
      );

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

      if (!m) {
        continue;
      }

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
          user.displayName
          ||
          user.name
          ||
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
      if (
        el.children.length
      ) {
        continue;
      }

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
    const username = routeUser() || ownProfileUser();
    if (!username) return;
    const user = await fetchProfile(username);
    if (!user) return;
    const number = user.foundingMemberNumber;
    if (number === null || number === undefined || number === '') return;
    const displayName = clean(user.displayName || user.name || username);
    const main = document.querySelector('main') || document;
    const nameEl = [...main.querySelectorAll('h1,h2,h3,span,a,div,strong')].find(el => {
      if (!el.isConnected || el.children.length || el.closest('article') || el.classList.contains('ct-profile-founder')) return false;
      const r = el.getBoundingClientRect();
      if (r.top < 30 || r.top > 520 || r.width <= 0 || r.height <= 0) return false;
      const t = clean(el.textContent);
      return t === displayName || normUser(t) === normUser(username);
    });
    if (!nameEl) return;
    if (clean(nameEl.textContent) !== displayName) nameEl.textContent = displayName;
    let badge = nameEl.parentElement?.querySelector(':scope > .ct-profile-founder');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ct-profile-founder';
      nameEl.after(badge);
    }
    const founder = String(number).padStart(5, '0');
    badge.textContent = `#${founder}`;
    badge.title = `Founder Number #${founder}`;
  }

  function cleanupOldNamedMute() {
    document
      .querySelectorAll(
        '[data-ct-mute-menu="1"]'
      )
      .forEach(
        el =>
          el.remove()
      );
  }

  function patchProfileMute() {
    const username =
      routeUser();

    const main =
      document.querySelector(
        'main'
      )
      ||
      document;

    const existing =
      [
        ...main.querySelectorAll(
          '.ct-profile-mute'
        )
      ];

    const old =
      existing.shift()
      ||
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
            )
            &&
            !button.classList.contains(
              'ct-profile-mute'
            )
            &&
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
      old
      ||
      ref.cloneNode(
        true
      );

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

    button.textContent =
      isMuted(
        username
      )
        ? 'ミュート解除'
        : 'ミュート';

    button.title =
      isMuted(
        username
      )
        ? 'ミュート解除'
        : 'ミュート';

    button.onclick =
      event => {
        event.preventDefault();
        event.stopPropagation();

        toggleMuted(
          username
        );
      };
  }

  function articleId(
    article
  ) {
    for (
      const el of
      article.querySelectorAll(
        'a[href]'
      )
    ) {
      const href =
        el.getAttribute(
          'href'
        ) || '';

      const m =
        href.match(
          /\/(?:post|status|tweet)\/([^/?#]+)/i
        );

      if (m) {
        return m[1];
      }
    }

    return (
      article.getAttribute(
        'data-post-id'
      )
      ||
      article.getAttribute(
        'data-tweet-id'
      )
      ||
      ''
    );
  }

  function articleText(
    article
  ) {
    return (
      [
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
          (a, b) =>
            b.length -
            a.length
        )[0]
      ||
      ''
    );
  }

  function articleAvatar(
    article
  ) {
    return (
      article.querySelector(
        'img[src*="avatar"],img[alt*="profile" i]'
      )
        ?.src
      ||
      ''
    );
  }

  function snapshotFavorite(
    article
  ) {
    const id =
      articleId(
        article
      );

    if (!id) {
      return null;
    }

    const username =
      articleAuthor(
        article
      )
      ||
      '';

    const name =
      clean(
        article.querySelector(
          '.ct-author-name,strong'
        )
          ?.textContent
      )
      ||
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
            /(post|status|tweet)\//i.test(h)
        )
      ||
      '';

    return {
      id,
      username,
      name,
      text: articleText(article),
      avatar: articleAvatar(article),
      href,
      savedAt: Date.now()
    };
  }

  function loadFavorites() {
    const items =
      loadJSON(
        KEY.favorites,
        []
      );

    return Array.isArray(
      items
    )
      ? items
      : [];
  }

  function saveFavorite(
    item
  ) {
    if (
      !item?.id
    ) {
      return;
    }

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

  function removeFavorite(
    id
  ) {
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

      if (!button) {
        return;
      }

      const article =
        button.closest(
          'article'
        );

      if (!article) {
        return;
      }

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

          if (
            favoritesActive
          ) {
            renderFavoritesPanel();
          }
        },
        450
      );
    },
    true
  );

  function patchFavoriteButtons(
    root =
      document
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
            ) || '';

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

  let favoritesActive =
    false;

  function findRepostTab() {
    if (
      location.pathname !==
      '/profile'
    ) {
      return null;
    }

    return (
      [
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
        )
      ||
      null
    );
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

      favoritesActive =
        false;

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

      if (!parent) {
        return;
      }

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

    if (!main) {
      return null;
    }

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
    reply =
      false
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
      item.name
      ||
      item.authorName
      ||
      item.username
      ||
      item.authorUsername
      ||
      '';

    meta.appendChild(
      name
    );

    const username =
      item.username
      ||
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
    )
      ?.remove();
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

    if (!r) {
      return;
    }

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

      document.body.appendChild(
        panel
      );
    }

    panel.style.left =
      `${Math.round(
        r.left
      )}px`;

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
      `${Math.round(
        r.width
      )}px`;

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

    for (const item of data) {
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
    root =
      document
  ) {
    const out =
      [];

    root.querySelectorAll?.(
      'main p,main span,main div'
    )
      .forEach(
        el => {
          if (
            !el.children.length
          ) {
            const t =
              clean(
                el.textContent
              );

            if (
              t &&
              t.length < 500
            ) {
              out.push(
                el
              );
            }
          }
        }
      );

    return out;
  }

  function patchNotifications(
    root =
      document
  ) {
    if (
      !location.pathname.startsWith(
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
      notificationLeaves(
        root
      )
    ) {
      const t =
        clean(
          el.textContent
        );

      if (!t) {
        continue;
      }

      const out =
        translateNotification(t)
        ||
        JP.get(t)
        ||
        dynamicJP(t);

      if (
        out &&
        out !== t
      ) {
        el.textContent =
          out;
      }

      const finalText =
        out || t;

      if (
        /お気に入りに登録しました/
          .test(
            finalText
          )
      ) {
        const row =
          el.closest(
            'button,[role="button"]'
          )
          ||
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
    seen =
      new WeakSet()
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

    seen.add(
      value
    );

    const token =
      value
        ?.stsTokenManager
        ?.accessToken
      ||
      value
        ?.accessToken
      ||
      value
        ?.tokenManager
        ?.accessToken
      ||
      null;

    const uid =
      value?.uid
      ||
      value
        ?.user
        ?.uid
      ||
      value?.userId
      ||
      null;

    if (
      typeof token ===
        'string' &&
      token.length > 40
    ) {
      return {
        token,
        uid
      };
    }

    let values =
      [];

    try {
      values =
        Object.values(
          value
        );
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

        if (hit) {
          return hit;
        }
      }
    }

    return null;
  }

  function getAuth() {
    return new Promise(
      resolve => {
        let done =
          false;

        const finish =
          value => {
            if (!done) {
              done =
                true;

              resolve(
                value || null
              );
            }
          };

        try {
          const request =
            indexedDB.open(
              'firebaseLocalStorageDb'
            );

          request.onerror =
            () =>
              finish(
                null
              );

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
                  tx
                    .objectStore(
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
                      all.result || []
                    ) {
                      const hit =
                        findAuth(
                          row?.value ?? row
                        );

                      if (hit) {
                        return finish(
                          hit
                        );
                      }
                    }

                    finish(
                      null
                    );
                  };

              } catch {
                finish(
                  null
                );
              }
            };

          setTimeout(
            () =>
              finish(
                null
              ),
            2500
          );

        } catch {
          finish(
            null
          );
        }
      }
    );
  }

  function authJSON(
    path,
    auth
  ) {
    if (
      !auth?.token
    ) {
      return Promise.resolve(
        null
      );
    }

    return requestJSON(
      path.startsWith(
        'http'
      )
        ? path
        : API_ORIGIN + path,

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
      Array.isArray(
        json
      )
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
        post?.originalPostId
        ||
        post?.postId
        ||
        post?.id
        ||
        ''
      )
        .trim();

  const replyCount =
    post =>
      Number(
        post?.replyCount
        ??
        post?.comments
        ??
        post?.commentCount
        ??
        post?.repliesCount
        ??
        post?.reply_count
        ??
        0
      )
      ||
      0;

  const author =
    post =>
      validUser(
        post?.authorUsername
        ||
        post?.authorHandle
        ||
        post?.author?.username
        ||
        post?.username
      );

  const postText =
    post =>
      String(
        post?.text
        ||
        post?.body
        ||
        post?.content
        ||
        post?.replyText
        ||
        ''
      );

  const postName =
    post =>
      String(
        post?.authorName
        ||
        post?.actorName
        ||
        post?.author?.displayName
        ||
        author(post)
        ||
        ''
      );

  const postAvatar =
    post =>
      String(
        post?.authorAvatar
        ||
        post?.actorAvatar
        ||
        post?.author?.avatarUrl
        ||
        post?.avatarUrl
        ||
        ''
      );

  const postCreated =
    post =>
      String(
        post?.createdAt
        ||
        post?.created_at
        ||
        post?.timestamp
        ||
        ''
      );

  function loadReplyNotices() {
    const list =
      loadJSON(
        KEY.replyNotices,
        []
      );

    return Array.isArray(
      list
    )
      ? list
      : [];
  }

  function saveReplyNotice(
    reply,
    parentId = ''
  ) {
    const id =
      postId(
        reply
      );

    const username =
      author(
        reply
      );

    if (
      !id ||
      !username
    ) {
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
          reply?.parentPostId
          ||
          reply?.parentId
          ||
          parentId
          ||
          ''
        ),

      authorUsername:
        username,

      authorName:
        postName(reply)
        ||
        username,

      authorAvatar:
        postAvatar(reply),

      text:
        postText(reply),

      createdAt:
        postCreated(reply)
        ||
        new Date()
          .toISOString(),

      detectedAt:
        Date.now(),

      read:
        old?.read || false
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
          (a, b) =>
            new Date(
              b.createdAt ||
              b.detectedAt
            )
            -
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

  function markReplyRead(
    id
  ) {
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

  let replyBusy =
    false;

  let lastFull =
    0;

  async function replyWatchTick() {
    if (replyBusy) {
      return;
    }

    replyBusy =
      true;

    try {
      const auth =
        await getAuth();

      if (
        !auth?.token
      ) {
        return;
      }

      const me =
        await authJSON(
          '/api/user-profile',
          auth
        );

      const myHandle =
        validUser(
          me?.username
          ||
          me?.handle
          ||
          me?.user?.username
          ||
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
          ['notifications']
        )
      ) {
        const type =
          String(
            notification?.type
            ||
            notification?.eventType
            ||
            notification?.kind
            ||
            notification?.notificationType
            ||
            ''
          )
            .toUpperCase();

        const message =
          String(
            notification?.message
            ||
            notification?.text
            ||
            ''
          );

        if (
          !type.includes(
            'REPLY'
          )
          &&
          !/replied to|返信/i.test(
            message
          )
        ) {
          continue;
        }

        const object =
          notification?.reply
          ||
          notification?.post
          ||
          notification?.tweet
          ||
          notification;

        const id =
          postId(
            object
          )
          ||
          String(
            notification?.postId
            ||
            notification?.replyPostId
            ||
            notification?.id
            ||
            ''
          );

        const username =
          validUser(
            notification?.actorHandle
            ||
            notification?.actorUsername
            ||
            notification?.actor?.username
            ||
            author(
              object
            )
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
                notification?.actorName
                ||
                notification?.actorDisplayName
                ||
                notification?.actor?.displayName
                ||
                postName(
                  object
                )
                ||
                username,

              authorAvatar:
                notification?.actorAvatar
                ||
                notification?.actor?.avatarUrl
                ||
                postAvatar(
                  object
                ),

              text:
                notification?.replyText
                ||
                notification?.postText
                ||
                postText(
                  object
                ),

              createdAt:
                notification?.createdAt
                ||
                notification?.created_at
                ||
                postCreated(
                  object
                )
            },

            notification?.parentPostId
            ||
            notification?.targetPostId
            ||
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
        await Promise.all([
          authJSON(
            `/api/users/${
              encodeURIComponent(
                myHandle
              )
            }/posts?limit=24`,
            auth
          ),

          authJSON(
            `/api/users/${
              encodeURIComponent(
                myHandle
              )
            }/replies`,
            auth
          )
        ]);

      const parents =
        [
          ...items(
            postsJson,
            ['posts']
          ),

          ...items(
            repliesJson,
            ['replies']
          )
        ]
          .filter(
            post =>
              postId(post)
              &&
              replyCount(post) > 0
          )
          .sort(
            (a, b) =>
              new Date(
                postCreated(b) || 0
              )
              -
              new Date(
                postCreated(a) || 0
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
        ) === '1';

      const force =
        Date.now()
        -
        lastFull
        >
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
          postId(
            parent
          );

        const count =
          replyCount(
            parent
          );

        if (
          !force &&
          initialized &&
          counts[pid] === count
        ) {
          continue;
        }

        const replyJson =
          await authJSON(
            `/api/posts/${
              encodeURIComponent(
                pid
              )
            }/replies?limit=50`,
            auth
          );

        for (
          const reply of
          items(
            replyJson,
            ['replies']
          )
        ) {
          const rid =
            postId(
              reply
            );

          if (
            !rid ||
            seen.has(
              rid
            )
          ) {
            continue;
          }

          const username =
            author(
              reply
            );

          if (
            !username
            ||
            normUser(
              username
            ) ===
              normUser(
                myHandle
              )
          ) {
            seen.add(
              rid
            );

            continue;
          }

          if (initialized) {
            saveReplyNotice(
              reply,
              pid
            );
          }

          seen.add(
            rid
          );
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

    } catch(error) {
      console.debug(
        '[Classic Twitter JP reply watcher]',
        error
      );

    } finally {
      replyBusy =
        false;
    }
  }

  function closeReplyPanel() {
    document.getElementById(
      'ct-reply-panel'
    )
      ?.remove();
  }

  function renderReplyPanel() {
    if (
      !location.pathname.startsWith(
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

    if (!r) {
      return;
    }

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

      document.body.appendChild(
        panel
      );
    }

    panel.style.left =
      `${Math.round(
        r.left + 12
      )}px`;

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
              `/post/${
                encodeURIComponent(
                  item.id
                )
              }`;
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

      document.body.appendChild(
        badge
      );
    }

    const r =
      link.getBoundingClientRect();

    badge.textContent =
      String(
        count
      );

    badge.style.left =
      `${Math.round(
        r.right - 8
      )}px`;

    badge.style.top =
      `${Math.round(
        r.top + 2
      )}px`;
  }


  function ctPostHref(href) {
    try {
      const u = new URL(href, location.origin);
      return /\/(?:post|status|tweet)\/[^/?#]+/i.test(u.pathname) ? u.href : '';
    } catch {
      return '';
    }
  }

  function ctUserFromContainer(el) {
    let box = el;
    for (let depth = 0; box && depth < 5; depth++, box = box.parentElement) {
      const links = [...box.querySelectorAll?.('a[href]') || []];
      for (const link of links) {
        const user = userFromHref(link.getAttribute('href') || '');
        if (user) return user;
      }
      const m = clean(box.textContent).match(/@([A-Za-z0-9_.-]{1,80})/);
      if (m) return validUser(m[1]);
    }
    return null;
  }

  async function patchRetweetNavigation(root = document) {
    const scope = root instanceof Element ? root : document;
    const leaves = [];
    if (scope instanceof Element && !scope.children.length) leaves.push(scope);
    scope.querySelectorAll?.('span,div,p,small').forEach(el => {
      if (!el.children.length) leaves.push(el);
    });

    for (const el of leaves) {
      if (!el.isConnected || el.dataset.ctRetweeterLink === '1') continue;
      const t = clean(el.textContent);
      if (!t) continue;
      const isJP = /さんがリツイートしました$/u.test(t);
      const isEN = /\b(?:retweeted|reposted)$/i.test(t);
      if (!isJP && !isEN) continue;

      const username = ctUserFromContainer(el);
      if (!username) continue;

      el.dataset.ctRetweeterLink = '1';
      el.setAttribute('role', 'link');
      el.setAttribute('tabindex', '0');
      el.style.cursor = 'pointer';
      el.title = `@${username}`;

      const go = event => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        location.href = `/user/${encodeURIComponent(username)}`;
      };

      el.addEventListener('click', go);
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') go(event);
      });
    }
  }

  async function patchQuotedTweets(root = document) {
    const scope = root instanceof Element ? root : document;
    const articles = new Set();

    if (scope instanceof Element) {
      if (scope.matches('article')) articles.add(scope);
      const parent = scope.closest('article');
      if (parent) articles.add(parent);
    }
    scope.querySelectorAll?.('article').forEach(a => articles.add(a));

    for (const article of articles) {
      if (!article.isConnected) continue;
      const mainId = String(articleId(article) || '');
      const postLinks = [...article.querySelectorAll('a[href]')]
        .map(a => ({ a, href: ctPostHref(a.getAttribute('href') || '') }))
        .filter(x => x.href);

      for (const item of postLinks) {
        let id = '';
        try {
          id = new URL(item.href).pathname.match(/\/(?:post|status|tweet)\/([^/?#]+)/i)?.[1] || '';
        } catch {}
        if (!id || (mainId && id === mainId)) continue;

        let card = item.a.closest('[role="link"],blockquote');
        if (!card || card === article) {
          card = item.a.parentElement;
          for (let depth = 0; card && card.parentElement !== article && depth < 4; depth++) {
            const parent = card.parentElement;
            if (!parent) break;
            const userLinks = parent.querySelectorAll('a[href*="/user/"]').length;
            const textLen = clean(parent.textContent).length;
            if (userLinks && textLen >= 8) card = parent;
            else break;
          }
        }
        if (!card || card === article) continue;

        if (card.dataset.ctQuoteCard !== '1') {
          card.dataset.ctQuoteCard = '1';
          card.style.cursor = 'pointer';
          card.addEventListener('click', event => {
            if (event.target.closest('button,input,textarea,select')) return;
            const link = event.target.closest('a[href]');
            if (link && link !== item.a) return;
            event.preventDefault();
            event.stopPropagation();
            location.href = item.href;
          });
        }

        const userLinks = [...card.querySelectorAll('a[href]')];
        for (const userLink of userLinks) {
          const username = userFromHref(userLink.getAttribute('href') || '');
          if (!username) continue;
          const user = await fetchProfile(username);
          if (!user || !card.isConnected) continue;
          const displayName = clean(user.displayName || user.name || username);
          if (!displayName) continue;

          const leaves = [...card.querySelectorAll('span,strong,div,p,a')].filter(el =>
            el.isConnected &&
            !el.children.length &&
            (clean(el.textContent) === `@${username}` || clean(el.textContent) === username)
          );
          for (const leaf of leaves) {
            leaf.textContent = displayName;
            leaf.classList.add('ct-quote-display-name');
          }
        }
      }
    }
  }

  function removeInlineFollowBadges(root = document) {
    const scope = root instanceof Element ? root : document;
    const controls = [];
    if (scope instanceof Element && scope.matches('button,[role="button"]')) controls.push(scope);
    scope.querySelectorAll?.('button,[role="button"]').forEach(el => controls.push(el));

    for (const el of controls) {
      if (!el.isConnected) continue;
      const text = clean(el.textContent);
      const aria = clean(el.getAttribute('aria-label') || '');
      const title = clean(el.getAttribute('title') || '');

      const profileFollowButton =
        !el.closest('article') &&
        /^(?:Follow|Unfollow|フォロー|フォロー解除)$/i.test(text) &&
        (/^\/user\//.test(location.pathname) || location.pathname === '/profile');

      if (profileFollowButton) {
        el.dataset.ctKeepProfileFollow = '1';
        el.style.removeProperty('display');
        continue;
      }

      const followLabel = /^(?:follow|フォロー)(?:\s|@|$)/i.test(`${aria} ${title}`.trim());
      const plusOnly = /^[+＋]$/.test(text);
      const iconOnly = !text || plusOnly;
      const r = el.getBoundingClientRect();
      const small = (!r.width || r.width <= 48) && (!r.height || r.height <= 48);
      const nearAvatar = !!el.parentElement?.querySelector('img');

      if ((followLabel && (iconOnly || small || nearAvatar)) || (plusOnly && small && nearAvatar)) {
        el.dataset.ctInlineFollow = '1';
        el.style.setProperty('display', 'none', 'important');
      }
    }
  }


  function patchComposeJapanese(root = document) {
    const scope = root instanceof Element ? root : document;
    const leaves = [];
    if (scope instanceof Element && !scope.children.length) leaves.push(scope);
    scope.querySelectorAll?.('button,span,div,p').forEach(el => {
      if (!el.children.length) leaves.push(el);
    });
    for (const el of leaves) {
      if (!el.isConnected) continue;
      const t = clean(el.textContent);
      if (t === '今どうしてる？') el.textContent = 'いまどうしてる？';
    }
    const buttons = [];
    if (scope instanceof Element && scope.matches('button')) buttons.push(scope);
    scope.querySelectorAll?.('button').forEach(el => buttons.push(el));
    for (const button of buttons) {
      if (!button.isConnected) continue;
      if (clean(button.textContent) === 'ツイート') button.textContent = 'ツイートする';
    }
  }

  function notificationRowFor(el) {
    let cur = el;
    for (let depth = 0; cur && depth < 9; depth++, cur = cur.parentElement) {
      const t = clean(cur.textContent);
      if (/(あなたのツイート|あなたをフォロー|お気に入り|リツイート|返信|followed you|favorited|retweeted|replied)/i.test(t)) {
        if ((cur.querySelectorAll?.('img').length || 0) >= 1) return cur;
      }
    }
    return null;
  }

  function patchNotificationAvatarLinks(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;
    const scope = root instanceof Element ? root : document;
    const images = [];
    if (scope instanceof HTMLImageElement) images.push(scope);
    scope.querySelectorAll?.('img').forEach(img => images.push(img));

    const rows = new Set();
    for (const img of images) {
      if (!img.isConnected) continue;
      const row = notificationRowFor(img);
      if (row) rows.add(row);
    }

    for (const row of rows) {
      const avatars = [...row.querySelectorAll('img')].filter(img => {
        const r = img.getBoundingClientRect();
        return (!r.width || r.width <= 64) && (!r.height || r.height <= 64);
      });
      if (!avatars.length) continue;

      const userLinks = [];
      const seen = new Set();
      for (const a of row.querySelectorAll('a[href]')) {
        const username = userFromHref(a.getAttribute('href') || '');
        if (!username) continue;
        const key = normUser(username);
        if (seen.has(key)) continue;
        seen.add(key);
        userLinks.push({ username, href: `/user/${encodeURIComponent(username)}` });
      }
      if (!userLinks.length) continue;

      avatars.forEach((img, index) => {
        const anchor = img.closest('a[href]');
        const anchorUser = anchor ? userFromHref(anchor.getAttribute('href') || '') : null;
        const target = userLinks[index] || (anchorUser ? { username: anchorUser, href: `/user/${encodeURIComponent(anchorUser)}` } : null);
        if (!target) return;

        const clickable = img.closest('a,button,[role="button"]') || img;
        clickable.dataset.ctAvatarTarget = target.username;
        clickable.style.cursor = 'pointer';
        if (clickable.tagName === 'A') clickable.setAttribute('href', target.href);
        if (clickable.dataset.ctAvatarBound === '1') return;
        clickable.dataset.ctAvatarBound = '1';
        clickable.addEventListener('click', event => {
          const username = clickable.dataset.ctAvatarTarget;
          if (!username) return;
          event.preventDefault();
          event.stopPropagation();
          location.href = `/user/${encodeURIComponent(username)}`;
        }, true);
      });
    }
  }

  function ctTranslationButtonText(el) {
    return clean(el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  }

  function ctTranslationControls(root = document) {
    const scope = root instanceof Element ? root : document;
    const out = [];
    const selector = 'button,[role="button"],a';
    if (scope instanceof Element && scope.matches(selector)) out.push(scope);
    scope.querySelectorAll?.(selector).forEach(el => out.push(el));
    return out.filter(el => /^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(el)));
  }

  function ctDeclaredLanguage(container) {
    if (!container) return '';
    const nodes = [container, ...(container.querySelectorAll?.('[lang],[data-lang],[data-language]') || [])];
    for (const el of nodes) {
      const raw = clean(el.getAttribute?.('lang') || el.getAttribute?.('data-lang') || el.getAttribute?.('data-language') || '').toLowerCase();
      const lang = raw.split(/[-_]/)[0];
      if (/^[a-z]{2,3}$/.test(lang)) return lang;
    }
    return '';
  }

  function ctPostTextForTranslation(control) {
    const article = control?.closest?.('article');
    if (!article) return '';
    let box = control.parentElement;
    for (let depth = 0; box && box !== article && depth < 6; depth++, box = box.parentElement) {
      const candidates = [...box.querySelectorAll('p,[dir="auto"],[data-testid*="text" i]')]
        .filter(el => !el.closest('button,[role="button"]'))
        .map(el => clean(el.textContent))
        .filter(t => t && !/^(?:Show translation|Translate|翻訳を表示|Show original|原文を表示)$/i.test(t));
      const text = candidates.sort((a,b) => b.length - a.length)[0] || '';
      if (text.length >= 2) return text;
    }
    if (typeof articleText === 'function') return clean(articleText(article));
    return clean(article.textContent);
  }

  function ctLikelyLanguage(text, container) {
    const declared = ctDeclaredLanguage(container);
    if (declared) return declared;
    const s = clean(text).replace(/https?:\/\/\S+/gi,' ').replace(/@[A-Za-z0-9_.-]+/g,' ').replace(/#[^\s]+/g,' ');
    if (!s) return 'unknown';
    if (/[\u3040-\u30ff]/u.test(s)) return 'ja';
    if (/[\uac00-\ud7af]/u.test(s)) return 'ko';
    if (/[\u4e00-\u9fff]/u.test(s)) return 'zh';
    if (/[\u0400-\u04ff]/u.test(s)) return 'ru';
    if (/[\u0600-\u06ff]/u.test(s)) return 'ar';
    if (/[\u0590-\u05ff]/u.test(s)) return 'he';
    if (/[\u0900-\u097f]/u.test(s)) return 'hi';
    if (/[\u0e00-\u0e7f]/u.test(s)) return 'th';
    const lowered = ` ${s.toLowerCase()} `;
    const words = s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
    if (!words.length) return 'unknown';
    const other = ['bonjour','merci','salut','avec','pour','dans','une','des','est','mais','vous','nous','hola','gracias','para','con','una','que','los','las','por','pero','como','muy','ciao','grazie','per','che','gli','della','sono','molto','hallo','danke','und','der','die','das','ist','nicht','mit','für','ein','eine','olá','obrigado','obrigada','não','muito'];
    if (other.some(w => lowered.includes(` ${w} `)) || /[À-ÖØ-öø-ÿ]/u.test(s)) return 'other';
    const english = new Set(['a','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from','had','has','have','he','her','here','his','how','i','if','in','is','it','just','me','more','my','no','not','of','on','one','or','our','out','she','so','some','than','that','the','their','them','there','they','this','to','too','up','us','was','we','were','what','when','where','which','who','why','will','with','would','you','your']);
    const hits = words.reduce((n,w) => n + (english.has(w) ? 1 : 0), 0);
    if (hits >= 2 || (words.length <= 4 && hits >= 1)) return 'en';
    if (words.length <= 3 && /^[\x00-\x7F\s.,!?'"()\-:;]+$/u.test(s)) return 'en';
    if (words.length >= 5 && hits / words.length >= 0.12) return 'en';
    return 'other';
  }

  function autoTranslationEnabled() {
    return loadJSON(KEY.autoTranslate, true) !== false;
  }

  function patchAutoTranslation(root = document, nativeLanguage = 'ja') {
    const controls = ctTranslationControls(root);

    if (!autoTranslationEnabled()) {
      for (const control of controls) {
        control.style.removeProperty('display');
        delete control.dataset.ctAutoTranslated;
      }
      return;
    }

    for (const control of controls) {
      if (!control.isConnected) continue;
      const article = control.closest('article');
      if (!article) continue;
      const text = ctPostTextForTranslation(control);
      const lang = ctLikelyLanguage(text, article);
      const isNative = nativeLanguage === 'ja' ? lang === 'ja' : lang === 'en';
      if (isNative || lang === 'unknown') {
        control.style.setProperty('display','none','important');
        continue;
      }
      control.style.removeProperty('display');
      if (control.dataset.ctAutoTranslated === '1') continue;
      control.dataset.ctAutoTranslated = '1';
      setTimeout(() => {
        if (!control.isConnected) return;
        if (!/^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(control))) return;
        control.click();
      }, 40);
    }
  }

  function patchExactPostTime(root = document) {
    const scope = root instanceof Element ? root : document;
    const times = [];
    if (scope instanceof HTMLTimeElement && scope.matches('time[datetime]')) times.push(scope);
    scope.querySelectorAll?.('article time[datetime]').forEach(el => times.push(el));

    for (const time of times) {
      if (!time.isConnected || time.dataset.ctExactTime === '1') continue;
      const date = new Date(time.getAttribute('datetime') || '');
      if (Number.isNaN(date.getTime())) continue;

      const exact = document.createElement('span');
      exact.className = 'ct-exact-post-time';
      exact.textContent = ' · ' + new Intl.DateTimeFormat('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date);
      exact.title = new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).format(date);
      time.insertAdjacentElement('afterend', exact);
      time.dataset.ctExactTime = '1';
    }
  }

  function patchProfileJoinedDate(root = document) {
    const scope = root instanceof Element ? root : document;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    const isInviteContext = n => {
      let el = n.parentElement;
      for (let i = 0; el && i < 7; i++, el = el.parentElement) {
        const txt = clean(el.textContent);
        if (/Wing|招待リンク|リンクを開いた人数|登録した人数|参加した友だち|Friends who joined|Signed up|Link opens/i.test(txt)) return true;
      }
      return false;
    };

    // Single text node: "Joined September 2026" / legacy translated form.
    for (const n of nodes) {
      const t = clean(n.nodeValue);
      let m = t.match(/^Joined\s+(.+)$/i);
      if (!m) m = t.match(/^参加した人数\s+(.+)$/);
      if (!m || isInviteContext(n)) continue;
      n.nodeValue = n.nodeValue.replace(t, `${m[1]}からTwitterを利用しています`);
    }

    // tweet.app currently renders "Joined" and the date as separate DOM text nodes.
    // Older versions of this script may already have changed only the label to "参加した人数".
    for (const label of nodes) {
      const labelText = clean(label.nodeValue);
      if (!/^(?:Joined|参加した人数)$/i.test(labelText) || isInviteContext(label)) continue;

      let container = label.parentElement;
      for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
        const allText = clean(container.textContent);
        const dateMatch = allText.match(/(?:Joined|参加した人数)\s+(.+?)(?=\s+(?:Founder|#\d+)|$)/i);
        if (!dateMatch) continue;

        const dateText = clean(dateMatch[1]);
        const dateNode = nodes.find(n => n !== label && container.contains(n) && clean(n.nodeValue) === dateText);
        if (dateNode) {
          label.nodeValue = label.nodeValue.replace(labelText, '');
          dateNode.nodeValue = dateNode.nodeValue.replace(dateText, `${dateText}からTwitterを利用しています`);
        } else {
          label.nodeValue = label.nodeValue.replace(labelText, `${dateText}からTwitterを利用しています`);
        }
        break;
      }
    }
  }

  function patchInviteJoinedLabels(root = document) {
    const scope = root instanceof Element ? root : document;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const n of nodes) {
      if (clean(n.nodeValue) !== 'Joined') continue;
      let el = n.parentElement;
      let inviteContext = false;
      for (let i = 0; el && i < 7; i++, el = el.parentElement) {
        const txt = clean(el.textContent);
        if (/Wing|招待|Link opens|Signed up|Friends who joined/i.test(txt)) {
          inviteContext = true;
          break;
        }
      }
      if (inviteContext) n.nodeValue = n.nodeValue.replace(/Joined/, '参加した人数');
    }
  }

  function patchAutoTranslateSetting() {
    const main = document.querySelector('main');
    const old = document.getElementById('ct-auto-translate-setting');

    if (!main) {
      old?.remove();
      return;
    }

    const inviteLabel = [...main.querySelectorAll('button,a,[role="button"],h1,h2,h3,div,span')]
      .find(el => clean(el.textContent) === '友だちを招待しよう！');

    if (!inviteLabel) {
      old?.remove();
      return;
    }

    if (old?.isConnected) return;

    let host = inviteLabel.parentElement;
    for (let i = 0; host && i < 5; i++, host = host.parentElement) {
      const text = clean(host.textContent);
      if (text.includes('友だちを招待しよう！') && host.parentElement) break;
    }
    host = host?.parentElement || inviteLabel.parentElement || main;

    const section = document.createElement('section');
    section.id = 'ct-auto-translate-setting';
    section.style.cssText = 'margin:14px 0 4px;padding-top:14px;border-top:1px solid rgba(127,127,127,.22);';

    const heading = document.createElement('div');
    heading.textContent = '拡張機能設定';
    heading.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:.02em;margin:0 0 8px;';

    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;cursor:pointer;';

    const copy = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'ツイートを自動翻訳';
    title.style.cssText = 'font-weight:700;font-size:14px;';
    const desc = document.createElement('div');
    desc.textContent = '日本語以外のツイートを自動的に翻訳します。';
    desc.style.cssText = 'font-size:12px;opacity:.65;margin-top:3px;';
    copy.append(title, desc);

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = autoTranslationEnabled();
    toggle.setAttribute('aria-label', 'ツイートの自動翻訳');
    toggle.style.cssText = 'width:20px;height:20px;cursor:pointer;flex:0 0 auto;';
    toggle.addEventListener('change', () => {
      saveJSON(KEY.autoTranslate, toggle.checked);
      document.querySelectorAll('[data-ct-auto-translated]').forEach(el => {
        delete el.dataset.ctAutoTranslated;
        el.style.removeProperty('display');
      });
      scan(document);
    });

    row.append(copy, toggle);
    section.append(heading, row);
    host.append(section);
  }

  function scan(
    root =
      document
  ) {
    try {
      installStyle();

      cleanupOldNamedMute();

      hideAffiliation();

      patchBrand();

      patchUI(
        root
      );

      patchReplyingTo(root);

      patchInputs(
        root
      );

      patchNotifications(
        root
      );

      patchFavoriteButtons(
        root
      );

      patchFeed(
        root
      );

      patchRetweetRows(
        root
      );

      patchRetweetNavigation(root);
      patchQuotedTweets(root);
      removeInlineFollowBadges(root);
      patchComposeJapanese(root);
      patchNotificationAvatarLinks(root);
      patchAutoTranslation(root, 'ja');
      patchExactPostTime(root);
      patchAutoTranslateSetting();
      patchInviteJoinedLabels(root);
      patchProfileJoinedDate(root);

      patchProfileFounder();

      patchProfileMute();

      patchFavoriteProfileTab();

      if (
        favoritesActive
      ) {
        renderFavoritesPanel();
      }

      renderReplyPanel();

      patchReplyBadge();

    } catch(error) {
      console.debug(
        '[Classic Twitter JP]',
        error
      );
    }
  }

  let scanTimer =
    null;

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

              scan(
                document
              );
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
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,

        attributeFilter: [
          'aria-pressed',
          'aria-checked'
        ]
      }
    );
  }

  startObserver();

  let layoutRaf =
    0;

  function syncPanels() {
    cancelAnimationFrame(
      layoutRaf
    );

    layoutRaf =
      requestAnimationFrame(
        () => {
          if (
            favoritesActive
          ) {
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
      passive: true
    }
  );

  window.addEventListener(
    'scroll',
    syncPanels,
    {
      passive: true
    }
  );

  function start() {
    scan(
      document
    );

    [
      300,
      800,
      1600
    ]
      .forEach(
        delay =>
          setTimeout(
            () =>
              scan(
                document
              ),
            delay
          )
      );

    setInterval(
      () =>
        scan(
          document
        ),
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
        once: true
      }
    );

  } else {
    start();
  }

  console.log(
    '🐦 Classic Twitter JP v6.5.3 loaded'
  );
})();
