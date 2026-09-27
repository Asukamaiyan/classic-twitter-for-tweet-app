// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese
// @namespace    https://tweet.app/
// @version      6.7.1
// @description  tweet.appのUIを安全に日本語化。投稿本文・名前を保持し、表示名・Founder Number・星のお気に入り、保存検索・投稿保存・任意のキーワード折りたたみに対応。
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
/* @safari-grants */
// @noframes
// @run-at       document-start
// @license      MIT
// @homepageURL  https://github.com/Asukamaiyan/classic-twitter-for-tweet-app
// @supportURL   https://github.com/Asukamaiyan/classic-twitter-for-tweet-app/issues
// ==/UserScript==

(() => {
  'use strict';
  if (document.documentElement?.dataset.ctActiveVersion) return;
  const CT_LOCALE = 'ja';
  /* @include network */
  /* @include enhancements */
  /* @include runtime */
  /* @include presentation */
  /* @include safari */

  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
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
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
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
    ['No replies yet', 'まだ返信はありません'],
    ['No replies yet.', 'まだ返信はありません。'],
    ['No tweets yet.', 'まだツイートはありません。'],
    ['No posts yet.', 'まだツイートはありません。'],
    ['No reposts yet.', 'まだリツイートはありません。'],
    ['No tweets yet. Share your first thought with the community.', 'まだツイートはありません。最初のツイートを投稿してみましょう。'],
    ['No posts yet. Share your first thought with the community.', 'まだツイートはありません。最初のツイートを投稿してみましょう。'],
    ['Be the first to reply.', '最初の返信をしてみましょう。'],
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
    ['No VERA notifications yet.', 'VERAからの通知はまだありません。'],
    ['When someone quotes or mentions you, it will show up here.', 'あなたへの引用や@ツイートがここに表示されます。'],
    ['Nothing to see here yet. Likes, reposts, and follows will show up here.', '通知はまだありません。お気に入り、リツイート、フォローの通知がここに表示されます。'],
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

      [data-testid="tweet-like-action"].ct-is-liked::before,
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

      .ct-detail-post-time {
        font-size:13px;
        opacity:.68;
        font-weight:400;
        padding:10px 0 8px;
        margin:0 0 2px;
        border-bottom:1px solid rgba(127,127,127,.20);
        white-space:nowrap;
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

  // Only localize application chrome. Text matching alone cannot distinguish a
  // label from a person's name, a post, a notification preview, or a translation.
  function localizationScopeNodes(root = document) {
    const host = root instanceof Node ? root : document;
    if (host.nodeType === Node.TEXT_NODE) return [host];
    const nodes = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function isOwnedLocalizationElement(el) {
    return !!el?.closest('[id^="ct-"],[class^="ct-"],[class*=" ct-"],[data-ct-owned],[data-ct-local-ui]');
  }

  function isNativeSettingsNavigation(el) {
    if (!/^\/settings\/?$/.test(location.pathname) || !el?.matches('span.truncate')) return false;
    const button = el.closest('nav button');
    return !!button?.closest('main') && !!button.querySelector('svg') &&
      !button.querySelector('img,a,[data-user-content]') &&
      !/@[A-Za-z0-9_.-]/.test(clean(button.textContent)) &&
      !button.getAttribute('aria-label')?.startsWith('View @');
  }

  function isNativeLocalizationTimestamp(el) {
    if (!el?.matches('span[title]') || !el.closest('article') ||
        el.closest('button,a,[role="button"]') ||
        !el.classList.contains('text-tl-app-text-muted') || !el.classList.contains('hover:underline')) return false;
    const title = el.getAttribute('title');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(title) &&
      Number.isFinite(Date.parse(title));
  }

  function isProtectedLocalizationElement(el) {
    if (!el?.isConnected || isOwnedLocalizationElement(el)) return true;
    if (el.closest(
      'textarea,input,select,option,script,style,code,pre,kbd,samp,svg,' +
      '[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,' +
      '[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],' +
      '.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]'
    )) return true;
    // Native settings navigation also truncates its static labels. Keep the
    // protection for profile names and account values everywhere else.
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications' }[location.pathname.replace(/\/$/, '')];
    const pageTitle = routeTitle && el.matches('h2.truncate') && clean(el.textContent) === routeTitle &&
      el === document.querySelector('main h2') && !el.closest('article');
    return !!el.closest('.truncate') && !isNativeSettingsNavigation(el) && !pageTitle;
  }

  function localizationNotificationRow(el) {
    if (!location.pathname.startsWith('/notifications')) return null;
    const row = el?.closest('button,[role="button"]');
    if (!row?.closest('main') || isOwnedLocalizationElement(row)) return null;
    // Current tweet.app notification rows are border-separated buttons. Do not
    // interpret tab buttons or arbitrary paragraphs as notification content.
    return row.matches('.items-start.border-b,[data-testid="notification-row"]') ? row : null;
  }

  function localizationNotificationAction(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return null;
    const row = localizationNotificationRow(el);
    const paragraph = el?.closest('p');
    if (!row || !paragraph || !row.contains(paragraph)) return null;
    if (el.closest('.font-extrabold,.font-bold,a')) return null;
    if (!(el === paragraph || el.parentElement === paragraph)) return null;
    const text = clean(node.nodeValue);
    if (!/^(?:(?:liked|favorited|reposted|retweeted|quoted) your (?:post|tweet|reply)|followed you|mentioned you(?: in a (?:post|tweet))?|replied to (?:your (?:post|tweet)|you)|flagged your post for review|awarded you a badge|interacted with you|(?:さん)?が?あなた(?:の(?:ツイート|返信)(?:を(?:お気に入りに登録|リツイート|引用)|に返信)|を(?:フォロー|@ツイート)|宛てにツイート|に(?:返信|バッジを贈り))しました)$/i.test(text)) return null;
    return { row, paragraph, element: el };
  }

  function isLocalizationUI(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return false;
    if (localizationNotificationAction(node)) return true;
    if (localizationNotificationRow(el)) return false;
    const text = clean(node.nodeValue);
    const link = el.closest('a[href]');
    if (link) {
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch { return false; }
      if (url.origin !== location.origin || !/^\/(?:feed|explore|notifications|settings|profile|compose|bookmarks)\/?$/.test(url.pathname)) return false;
      return !link.querySelector('img') && !!el.closest('nav,[role="navigation"],header,aside');
    }
    // A reply target is UI, but its handle must remain byte-for-byte unchanged.
    if (/^Replying to$/i.test(text) && el.matches('p,button') &&
        [...el.children].some(child => /^@[A-Za-z0-9_.-]+$/.test(clean(child.textContent)))) return true;
    const control = el.closest('button,[role="button"],[role="tab"],[role="menuitem"],summary');
    if (control) {
      if (control.querySelector('img') || /@[A-Za-z0-9_.-]/.test(clean(control.textContent))) return false;
      // User cards are buttons too. Paragraphs and styled names inside those
      // buttons are data, not labels. Real notification actions are handled above.
      const paragraph = el.closest('p');
      if ((paragraph && control.contains(paragraph)) || control.querySelector('p')) return false;
      if (el.closest('article') && !/^(?:Like|Likes|Liked|Unlike|Reply|Replies|Repost|Reposts|Retweet|Retweets|Quote|Quote Tweet|Quote Retweet|Undo repost|Undo retweet|Translate|Translated|Show translation|Show original|Show more|Show less|Share|Copy link|Edit post|Delete|Report|Mute user|Unmute|Follow|Unfollow)$/i.test(text)) return false;
      return true;
    }
    if (isNativeLocalizationTimestamp(el)) return true;
    if (el.closest('article')) return false;
    if (el.closest('label,legend,[role="status"],[role="alert"]')) return true;
    const inSettings = /^\/settings\/?$/.test(location.pathname);
    const heading = el.closest('h1,h2,h3') || (inSettings && el.closest('main section h4.font-extrabold'));
    if (heading) {
      // Profile headings contain display names; all other static headings are
      // still restricted to exact dictionary entries by translateTextNode.
      if (/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname) && heading.tagName !== 'H1') return false;
      return !heading.querySelector('img');
    }
    // Settings descriptions are static text, but account values in dd/input and
    // profile data are deliberately excluded. Never allow an entire route.
    if (inSettings && el.matches('main section span.uppercase.tracking-wide')) return true;
    if (inSettings && el.matches('p,dt')) {
      if (el.closest('dl') && el.tagName !== 'DT') return false;
      if (el.classList.contains('leading-relaxed')) {
        const title = el.previousElementSibling;
        return !!el.closest('main section') && title?.matches('h4.font-extrabold') &&
          (JP.has(clean(title.textContent)) || [...JP.values()].includes(clean(title.textContent)));
      }
      return !el.closest('a');
    }
    // The mobile account menu's counts are spans, unlike profile buttons.
    if (el.matches('span') && el.closest('[role="dialog"][aria-label="Account menu"]') &&
        /^(?:Following|Followers)$/.test(text) &&
        [...el.children].some(child => child.matches('strong') && /^[\d,]+$/.test(clean(child.textContent)))) return true;
    // Native empty states put text-center on the parent, not the paragraph.
    return el.matches('p.text-center,div.text-center,[aria-busy="true"]') ||
      (el.matches('p.text-tl-app-text-muted') && el.parentElement?.matches('div.text-center'));
  }

  function replaceLocalizationText(node, text) {
    const raw = node.nodeValue || '';
    if (clean(raw) === text) return;
    node.nodeValue = raw.replace(/\S[\s\S]*\S|\S/, () => text);
  }

  function patchUIAttributes(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const controls = [];
    if (host instanceof Element && host.matches('button,[role="tab"],[role="menuitem"],input,textarea')) controls.push(host);
    host?.querySelectorAll?.('button,[role="tab"],[role="menuitem"],input,textarea').forEach(el => controls.push(el));
    for (const el of controls) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]') ||
          el.closest('.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"],.truncate') || el.querySelector('img')) continue;
      for (const attr of ['aria-label', 'title']) {
        const value = el.getAttribute(attr);
        const out = JP.get(value);
        if (out && value !== out) el.setAttribute(attr, out);
      }
    }
  }

  function translateTextNode(node) {
    if (!isLocalizationUI(node)) return;
    const text = clean(node.nodeValue);
    if (!text || text.length > 500) return;
    // Dynamic replacements belong to their specific UI contexts. In particular,
    // never parse actor names or dates from arbitrary text that resembles a UI.
    const relative = isNativeLocalizationTimestamp(node.parentElement) && text.match(/^(\d+)([smhd])$/);
    const units = { s: '秒前', m: '分前', h: '時間前', d: '日前' };
    const out = relative ? relative[1] + units[relative[2]] : JP.get(text);
    if (out && out !== text) replaceLocalizationText(node, out);
  }

  function patchUI(root = document) {
    localizationScopeNodes(root).forEach(translateTextNode);
    patchUIAttributes(root);
  }

  function notificationTextNodes(root = document) {
    return localizationScopeNodes(root).filter(node => localizationNotificationAction(node));
  }

  function nearestUsefulSibling(node, direction) {
    let current = direction < 0 ? node.previousSibling : node.nextSibling;
    while (current && !clean(current.textContent)) current = direction < 0 ? current.previousSibling : current.nextSibling;
    return current;
  }

  function patchNotificationConnectors(root = document) {
    patchNotificationGrammar(root);
  }

  function patchNotificationGrammar(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;
    for (const action of notificationTextNodes(root)) {
      const context = localizationNotificationAction(action);
      const paragraph = context.paragraph;
      // Mentions/quotes have a separate action paragraph and need no actor
      // particles. Never reach into a previous notification to find an actor.
      if (context.element === paragraph) continue;
      if (!/^(?:さん)?が?あなた/.test(clean(action.nodeValue))) continue;
      const actorElements = [...paragraph.children].filter(el => el.matches('span.font-extrabold'));
      if (!actorElements.length) continue;
      const siblings = [...paragraph.childNodes];
      const actionIndex = siblings.indexOf(context.element);
      if (actionIndex < 0) continue;
      const before = siblings.slice(0, actionIndex);
      const directText = before.filter(node => node.nodeType === Node.TEXT_NODE);
      for (const node of directText) {
        const text = clean(node.nodeValue);
        if (!text && node.nodeValue) node.nodeValue = '';
        else if (/^and$/i.test(text)) node.nodeValue = 'さんと';
        else if (text === ',') node.nodeValue = 'さん、';
        else {
          const together = text.match(/^and\s+(\d+)\s+others?$/i);
          if (together) replaceLocalizationText(node, `さんとそのほか${together[1]}人`);
        }
      }
      for (let i = 0; i < before.length; i++) {
        const node = before[i];
        if (node.nodeType !== Node.TEXT_NODE || !/^\d+$/.test(clean(node.nodeValue))) continue;
        const next = before.slice(i + 1).find(sibling => clean(sibling.textContent));
        if (next?.nodeType === Node.TEXT_NODE && /^others?$/i.test(clean(next.nodeValue))) {
          replaceLocalizationText(node, `そのほか${clean(node.nodeValue)}人`);
          next.nodeValue = '';
        }
      }
      const actionText = clean(action.nodeValue);
      if (!/^あなた/.test(actionText)) continue;
      const previous = before.slice().reverse().find(node => clean(node.textContent));
      if (!previous) continue;
      const prefix = previous.nodeType === Node.TEXT_NODE && /そのほか\d+人$/.test(clean(previous.nodeValue)) ? 'が' : 'さんが';
      replaceLocalizationText(action, prefix + actionText);
    }
  }

  function patchNotificationParticles(root = document) {
    patchNotificationGrammar(root);
  }

  function patchNotificationFollowGrammar(root = document) {
    patchNotificationGrammar(root);
  }

  function patchReplyingTo(root = document) {
    for (const node of localizationScopeNodes(root)) {
      if (/^Replying to$/i.test(clean(node.nodeValue)) && isLocalizationUI(node)) {
        replaceLocalizationText(node, '返信先:');
      }
    }
  }

  function patchInputs(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const list = [];
    if (host instanceof Element && host.matches('input[placeholder],textarea[placeholder]')) list.push(host);
    host?.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));
    const placeholders = new Map([
      ["What's happening?", 'いまどうしてる？'], ["What's happening?!", 'いまどうしてる？'],
      ['What’s happening?', 'いまどうしてる？'], ['Post your reply', '返信をツイート'],
      ['Add your thoughts', 'コメントを追加…'], ['Add your thoughts...', 'コメントを追加…'],
      ['Add your thoughts…', 'コメントを追加…'], ['Create a post', 'ツイートを作成'],
      ['Search', '検索'], ['Search Tweet', 'Tweetを検索'], ['Search Twitter', 'Twitterを検索']
    ]);
    for (const el of list) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]')) continue;
      const value = el.getAttribute('placeholder');
      const out = placeholders.get(value) || JP.get(value);
      if (out && out !== value) el.setAttribute('placeholder', out);
    }
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

  function patchRetweetRows(root = document) {
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (isProtectedLocalizationElement(el) || !el.matches('span')) continue;
      const row = el.parentElement;
      // In the current client this metadata row is a direct article child,
      // marked by the repeat icon. Never infer a reposter from post text.
      if (!row?.parentElement?.matches('article') || !row.querySelector('svg.lucide-repeat')) continue;
      const text = clean(node.nodeValue);
      if (text === 'You reposted') replaceLocalizationText(node, 'あなたがリツイートしました');
      else {
        const match = text.match(/^(@?[A-Za-z0-9_.-]{1,80})\s+reposted$/i);
        if (match) replaceLocalizationText(node, `${match[1]}さんがリツイートしました`);
      }
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
        ctIsLiked(button);

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
            ctIsLiked(button);

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

  function notificationLeaves(root = document) {
    return [...new Set(notificationTextNodes(root).map(node => node.parentElement))];
  }

  function patchNotifications(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;
    for (const node of notificationTextNodes(root)) {
      const context = localizationNotificationAction(node);
      translateTextNode(node);
      if (/お気に入りに登録しました/.test(clean(node.nodeValue))) {
        context.row.querySelector('svg')?.parentElement?.classList.add('ct-notification-fav-icon');
      }
    }
    patchNotificationGrammar(root);
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


  function patchComposeJapanese(root = document) {
    for (const node of localizationScopeNodes(root)) {
      if (!isLocalizationUI(node)) continue;
      const text = clean(node.nodeValue);
      const button = node.parentElement.closest('button');
      if (text === '今どうしてる？') replaceLocalizationText(node, 'いまどうしてる？');
      // Change only a composer submit/navigation control, preserving its icon
      // and React-managed children rather than assigning button.textContent.
      if (text === 'ツイート' && button && (
        button.id === 'public-sidebar-compose-btn' ||
        button.closest('form,[role="dialog"]')?.querySelector('textarea')
      )) replaceLocalizationText(node, 'ツイートする');
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


  function patchExactPostTime(root = document) {
    const scope = root instanceof Element ? root : document;
    const articles = [];
    if (scope instanceof Element && scope.matches('article')) articles.push(scope);
    scope.querySelectorAll?.('article').forEach(a => articles.push(a));

    for (const article of articles) {
      if (!article.isConnected) continue;

      // Only add the X-style timestamp to the Tweet detail/conversation view.
      // Feed cards keep their compact relative timestamp.
      const path = location.pathname;
      const isDetail = /\/status\/|\/post\/|\/posts\//i.test(path) ||
        !!article.querySelector('[data-testid*="reply" i] textarea, textarea[placeholder*="reply" i]');
      if (!isDetail) continue;
      if (article.querySelector('.ct-detail-post-time')) continue;

      const timeEl = article.querySelector('time[datetime]');
      let date = timeEl ? new Date(timeEl.getAttribute('datetime') || '') : null;

      if (!date || Number.isNaN(date.getTime())) {
        const candidates = [...article.querySelectorAll('[title],[datetime]')];
        for (const el of candidates) {
          const raw = el.getAttribute('datetime') || el.getAttribute('title') || '';
          const d = new Date(raw);
          if (!Number.isNaN(d.getTime())) { date = d; break; }
        }
      }
      if (!date || Number.isNaN(date.getTime())) continue;

      const stamp = document.createElement('div');
      stamp.className = 'ct-detail-post-time';
      const timeText = new Intl.DateTimeFormat('ja-JP', {
        hour:'2-digit', minute:'2-digit', hour12:false
      }).format(date);
      const dateText = new Intl.DateTimeFormat('ja-JP', {
        year:'numeric', month:'long', day:'numeric'
      }).format(date);
      stamp.textContent = `${dateText} · ${timeText}`;

      // Put it below the Tweet body/media and above the action row when possible.
      const actions = [...article.querySelectorAll('button')].map(b => b.parentElement)
        .find(el => el && /reply|返信|repost|retweet|リツイート|like|お気に入り/i.test(el.textContent || ''));
      if (actions?.parentElement) actions.parentElement.insertBefore(stamp, actions);
      else article.append(stamp);
    }
  }

  function patchProfileJoinedDate(root = document) {
    if (!/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname)) return;
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (isProtectedLocalizationElement(el) || el.closest('article')) continue;
      // The profile metadata uses a calendar icon. Location/bio/name strings
      // resembling "Joined ..." must never be interpreted as metadata.
      if (!el.matches('span.inline-flex') || !el.querySelector('svg.lucide-calendar')) continue;
      const text = clean(node.nodeValue);
      if (/^(?:Joined|参加した人数)$/i.test(text)) replaceLocalizationText(node, '登録日:');
      else if (/^Joined\s+/i.test(text)) replaceLocalizationText(node, text.replace(/^Joined\s+/i, '登録日: '));
    }
  }

  function patchInviteJoinedLabels(root = document) {
    if (!location.pathname.startsWith('/settings')) return;
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (clean(node.nodeValue) !== 'Joined' || isProtectedLocalizationElement(el)) continue;
      if (el.matches('dt') && el.closest('dl')) replaceLocalizationText(node, '参加した人数');
    }
  }


  function scan(
    root =
      document
  ) {
    try {
      installStyle();
      if (typeof installSafariStyle === 'function') installSafariStyle();
      if (typeof patchMediaInfo === 'function') patchMediaInfo(root);

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
      patchComposeJapanese(root);
      patchNotificationFollowGrammar(root);
      patchAutoTranslation(root, 'ja');
      patchExactPostTime(root);
      patchInviteJoinedLabels(root);
      patchProfileJoinedDate(root);

      patchProfileFounder();

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
    '🐦 Classic Twitter JP v6.7.1 loaded'
  );
})();
