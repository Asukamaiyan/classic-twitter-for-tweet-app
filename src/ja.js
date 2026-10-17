// ==UserScript==
// @name         Classic Twitter for tweet.app - Japanese
// @namespace    https://tweet.app/
// @version      6.28.0
// @description  昔のTwitter風の表示と星のお気に入り。日本語UI・写真スライド・通知フィルター・保存ツール。本文や名前は保持。
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
// @connect      news.yahoo.co.jp
// @connect      news.web.nhk
// @connect      www.nikkansports.com
// @connect      rss.itmedia.co.jp
// @connect      *
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
  /* @platform */
  /* @include network */
  /* @include browser-notifications */
  /* @include enhancements */
  /* @include translation */
  /* @include classic */
  /* @include motion */
  /* @include runtime */
  /* @include presentation */
  /* @include timestamps */
  /* @include photo-viewport */
  /* @include profile */
  /* @include favorite-capture */
  /* @include reply-times */
  /* @include favorite-history */
  /* @include navigation */
  /* @include notification-filters */
  /* @include badges */
  /* @include media */
  /* @include news */
  /* @include link-preview */
  /* @include safari */

  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    favorites: 'classicTwitterJP.favorites',
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
    ['Follow back', 'フォローバック'],
    ['Profile options', 'プロフィールのメニュー'],
    ['More options', 'メニューを開く'],
    ['Mute', 'ミュート'],
    ['Mute unavailable', 'ミュートを利用できません'],
    ['Muted', 'ミュート済み'],
    ['Muting...', 'ミュート中…'],
    ['Block', 'ブロック'],
    ['Unblock', 'ブロックを解除'],
    ['Blocked accounts', 'ブロックしているアカウント'],
    ['View and unblock the accounts you have blocked.', 'ブロックしているアカウントを確認・解除できます。'],
    ['When you block someone, they cannot view your posts or follow you, and you will not see their posts or notifications.', 'ブロックした相手はあなたのツイートの表示やフォローができなくなります。相手のツイートや通知も表示されません。'],
    ["Couldn't load your blocked accounts.", 'ブロックしているアカウントを読み込めませんでした。'],
    ['Retry loading blocked accounts', 'ブロックしているアカウントを再読み込み'],
    ['Loading blocked accounts...', 'ブロックしているアカウントを読み込み中…'],
    ["You aren't blocking anyone", 'ブロックしているアカウントはありません'],
    ["When you block someone, they'll show up here.", 'ブロックしたアカウントがここに表示されます。'],
    ["They won't be able to follow you, or reply to, quote, repost or like your posts, and neither of you will see the other's posts or get notifications from each other. Any follows between you are removed, and unblocking won't restore them.", '相手はあなたのフォロー、ツイートへの返信、引用、リツイート、お気に入りができなくなります。お互いのツイートや通知も表示されません。相互のフォロー関係は解除され、ブロックを解除しても元には戻りません。'],
    ["Your block is removed. Follows that were removed when you blocked them won't come back.", 'ブロックを解除します。ブロック時に解除されたフォロー関係は元には戻りません。'],
    ["Couldn't block that account. Try again.", 'このアカウントをブロックできませんでした。もう一度お試しください。'],
    ["Couldn't unblock that account. Try again.", 'このアカウントのブロックを解除できませんでした。もう一度お試しください。'],
    ["You're blocked", 'ブロックされています'],
    ['You are not seeing their posts or replies.', '相手のツイートや返信は表示されません。'],
    ['Working…', '処理中…'],
    ['Confirm', '確認'],
    ['Retry', '再試行'],
    ['Poll', '投票'],
    ['Add poll', '投票を追加'],
    ['Remove poll', '投票を削除'],
    ['Add choice', '選択肢を追加'],
    ['Poll length', '投票期間'],
    ['Poll choices', '投票の選択肢'],
    ['Poll results', '投票結果'],
    ['Vote', '投票する'],
    ['Change vote', '投票を変更'],
    ['Update vote', '投票を更新'],
    ['Final results', '最終結果'],
    ['Closing…', '終了処理中…'],
    ['(your vote)', '（あなたの投票）'],
    ['Vote recorded.', '投票を記録しました。'],
    ['Your vote could not be recorded. Try again.', '投票を記録できませんでした。もう一度お試しください。'],
    ['A poll needs at least 2 choices.', '選択肢は2つ以上必要です。'],
    ['A poll can have at most 5 choices.', '選択肢は5つまで追加できます。'],
    ['Poll choices cannot be empty.', '選択肢を入力してください。'],
    ['Poll choices must be 25 characters or fewer.', '選択肢は25文字以内で入力してください。'],
    ['Poll choices must be different from each other.', '選択肢にはそれぞれ異なる内容を入力してください。'],
    ['Poll length must be 1 hour, 1 day, 3 days, or 7 days.', '投票期間は1時間、1日、3日、7日から選択してください。'],
    ['A poll post cannot include media. Remove the media or the poll.', '投票と写真・動画は同時に投稿できません。どちらかを削除してください。'],
    ['Nothing to see here yet. Likes, reposts, replies, quotes, mentions, and follows will show up here.', '通知はまだありません。お気に入り、リツイート、返信、引用、@ツイート、フォローの通知がここに表示されます。'],
    ['When someone quotes or mentions you, it will show up here.', 'あなたへの引用や@ツイートがここに表示されます。'],
    ['Why are you reporting this account?', 'このアカウントを報告する理由は何ですか？'],
    ['Why are you reporting this?', '報告する理由は何ですか？'],
    ['Your report is private. We use it to review and improve safety.', '報告内容は公開されません。安全性の確認・改善に使用されます。'],
    ['Additional details (optional)', '補足事項（任意）'],
    ['Add context that helps our review team.', '確認に役立つ補足事項を入力してください。'],
    ['Submit report', '報告を送信'],
    ['Submitting...', '送信中…'],
    ['Thanks for your report', '報告ありがとうございます'],
    ['Our moderation team will review this account. You can also mute them so their posts no longer appear in your feed.', '運営がこのアカウントを確認します。ミュートすると、このアカウントのツイートがタイムラインに表示されなくなります。'],
    ['Please sign in to report an account.', 'アカウントを報告するにはログインしてください。'],
    ['Please choose a reason before submitting.', '送信する前に理由を選択してください。'],
    ['Unable to submit your report right now. Please try again.', '現在、報告を送信できません。もう一度お試しください。'],
    ['Unable to mute this account right now. Please try again.', '現在、このアカウントをミュートできません。もう一度お試しください。'],
    ['Harassment or bullying', '嫌がらせ・いじめ'],
    ['Impersonation', 'なりすまし'],
    ['Spam or fake account', 'スパム・偽アカウント'],
    ['Something else', 'その他'],
    ['Reason', '理由'],
    ['Done', '完了'],
    ['Back', '戻る'],
    ['Home', 'ホーム'],
    ['Feed', 'ホーム'],
    ['Explore', '話題を検索'],
    ['Notifications', '通知'],
    ['Profile', 'プロフィール'],
    ['Settings', '設定'],
    ['Terms', '利用規約'],
    ['Rules', 'ルール'],
    ['About', 'サービスについて'],
    ['Change', '変更'],
    ['Turn off', 'オフにする'],
    ['Show more', 'さらに表示'],
    ['Show less', '表示を減らす'],
    ['Loading...', '読み込み中…'],
    ['Loading more...', 'さらに読み込み中…'],
    ['No unused codes', '未使用のコードはありません'],
    ['How the Wing badge works', 'Wingバッジの獲得方法'],
    ['Copied', 'コピーしました'],
    ['No people found.', 'ユーザーが見つかりません。'],
    ['No photos found.', '画像が見つかりません。'],
    ['No posts to explore yet.', '表示できるツイートはまだありません。'],
    ['flagged your post for review', 'あなたのツイートを確認対象にしました'],
    ['interacted with you', 'あなたに反応しました'],
    ['Post options', 'ツイートのメニュー'],
    ['Open profile menu', 'プロフィールメニューを開く'],
    ['Compose tweet', 'ツイートを作成'],

    ['For you', 'おすすめ'],
    ['Following', 'フォロー中'],

    ['Trending', 'トレンド'],
    ['Trends for you', 'おすすめのトレンド'],
    ['News', 'ニュース'],
    ['Sports', 'スポーツ'],
    ['Entertainment', 'エンターテインメント'],
    ['Technology', 'テクノロジー'],
    ['Games', 'ゲーム'],

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
    ['Loading replies...', '返信を読み込み中…'],
    ['This post is no longer available', 'このツイートは表示できません'],
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
    ['Edit', '編集'],
    ['Compose New', 'ツイートを作成'],
    ['Compose New Tweet', 'ツイートを作成'],
    ['Processing...', '処理中…'],
    ['Add photo or GIF', '写真・GIFを追加'],
    ['Add video', '動画を追加'],
    ['Add Photo', '写真を追加'],
    ['Add Video', '動画を追加'],
    ['Remove Image', '写真を削除'],
    ['Remove Video', '動画を削除'],
    ['Remove GIF', 'GIFを削除'],
    ['Discard changes?', '変更を破棄しますか？'],
    ['Your edits will be lost.', '編集した内容は保存されません。'],
    ['Discard', '破棄する'],
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
    ['Something went wrong loading hashtags you follow.', 'フォロー中のハッシュタグを読み込めませんでした'],

    // Mute / reports
    ['Mute user', 'ミュートする'],
    ['Unmute', 'ミュートを解除'],
    ['Unmute user', 'ミュートを解除'],
    ['User muted.', 'アカウントをミュートしました'],
    ['View and unmute the accounts you have muted.', 'ミュートしているアカウントを確認・解除できます'],
    ['Muted accounts stay hidden from your For You feed. Unmute one here to see their posts again.', 'ミュートしたアカウントのツイートは「おすすめ」に表示されません。ここからミュートを解除できます。'],
    ['Report', '報告する'],
    ['Report submitted.', '報告を送信しました'],
    ['Only you see this notice. Our team will review the report.', 'このお知らせはあなたにのみ表示されています。運営チームが報告内容を確認します。'],
    ['Manipulated media', '加工・改変されたメディア'],
    ['Likely false claim', '誤解を招く可能性のある情報'],

    // Translation / profile copy
    ['Translate', '翻訳する'],
    ['Translating', '翻訳中'],
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
    ['Manage two-factor authentication and where you\'re signed in.', '2要素認証とログイン中の端末を管理します。'],
    ['Where you\'re signed in', 'ログイン中の端末'],
    ['The devices signed in to your account. Sign out of any you do not recognize.', 'このアカウントにログインしている端末です。心当たりのない端末からはログアウトできます。'],
    ['Loading devices...', '端末を読み込み中…'],
    ['This device', 'この端末'],
    ['Active now', '現在使用中'],
    ['Unknown device', '不明な端末'],
    ['Sign out of all other devices', '他のすべての端末からログアウト'],
    ['Sign out this device?', 'この端末からログアウトしますか？'],
    ['Sign out of all other devices?', '他のすべての端末からログアウトしますか？'],
    ['Every device except this one will be signed out and will need your password to sign back in.', 'この端末以外はすべてログアウトされます。再度ログインするにはパスワードが必要です。'],
    ['Signed out of that device.', 'その端末からログアウトしました。'],
    ['Signed out of all other devices.', '他のすべての端末からログアウトしました。'],
    ['Could not sign out that device. Please try again.', 'その端末からログアウトできませんでした。もう一度お試しください。'],
    ['Could not sign out other devices. Please try again.', '他の端末からログアウトできませんでした。もう一度お試しください。'],
    ['Could not load your devices.', '端末を読み込めませんでした。'],
    ['Could not refresh your devices. Showing the last list we loaded.', '端末を更新できませんでした。前回取得した一覧を表示しています。'],
    ['Device list isn\'t available right now.', '現在、端末一覧を利用できません。'],
    ['Enter your password to sign out other devices.', '他の端末からログアウトするにはパスワードを入力してください。'],
    ['Confirm your password to manage your devices from this tab.', 'このタブで端末を管理するには、パスワードを確認してください。'],
    ['Confirm password', 'パスワードを確認'],
    ['Showing your 50 most recently active devices. Signing out of all other devices also signs out the ones not shown.', '最近使用した50台を表示しています。「他のすべての端末からログアウト」では、表示されていない端末からもログアウトします。'],
    ['Enter your password to manage your devices.', '端末を管理するにはパスワードを入力してください。'],
    ['Could not confirm it\'s you. Please try again.', '本人確認ができませんでした。もう一度お試しください。'],
    ['You were signed out from another device.', '別の端末からの操作でログアウトされました。'],
    ['Quoted a post', '引用ツイート'],
    ['Media in the post this replies to', '返信先のツイートの写真・動画'],
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

    ['Data', 'データ'],
    ['Data usage', 'データ利用'],

    ['Help', 'ヘルプ'],
    ['Help Center', 'ヘルプセンター'],
    ['Support', 'サポート'],
    ['Feedback', 'フィードバック'],

    ['Terms of Service', '利用規約'],
    ['Privacy Policy', 'プライバシーポリシー'],
    ['Child Safety Standards', '児童の安全に関する基準'],

    ['Save', '保存'],
    ['Saved', '保存しました'],
    ['Cancel', 'キャンセル'],
    ['Close', '閉じる'],
    ['Close media viewer', '写真・動画を閉じる'],
    ['Previous image', '前の画像'],
    ['Next image', '次の画像'],
    ['Media viewer', '写真・動画ビューア'],
    ['Choose image', '画像を選択'],
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
    ['liked your reply', 'あなたの返信をお気に入りに登録しました'],
    ['favorited your reply', 'あなたの返信をお気に入りに登録しました'],
    ['favorited your post', 'あなたのツイートをお気に入りに登録しました'],
    ['favorited your tweet', 'あなたのツイートをお気に入りに登録しました'],

    ['reposted your post', 'あなたのツイートをリツイートしました'],
    ['reposted your tweet', 'あなたのツイートをリツイートしました'],
    ['retweeted your post', 'あなたのツイートをリツイートしました'],
    ['retweeted your tweet', 'あなたのツイートをリツイートしました'],

    ['followed you', 'あなたをフォローしました']
  ]);

  function ctLocalizationRegularText(text) {
    const native = ctLocalizationRegularText.values ||= new Map([
      ['お気に入り', 'いいね'], ['お気に入り済み', 'いいね済み'],
      ['お気に入りを解除', 'いいねを取り消す'], ['お気に入りしたユーザー', 'いいねしたユーザー'],
      ['お気に入りに登録しました', 'いいねしました'], ['お気に入りを解除しました', 'いいねを取り消しました'],
      ['お気に入りはまだありません。', 'いいねはまだありません。'],
      ['通知はまだありません。お気に入り、リツイート、フォローの通知がここに表示されます。', '通知はまだありません。いいね、リツイート、フォローの通知がここに表示されます。'],
      ['通知はまだありません。お気に入り、リツイート、返信、引用、@ツイート、フォローの通知がここに表示されます。', '通知はまだありません。いいね、リツイート、返信、引用、@ツイート、フォローの通知がここに表示されます。'],
      ['あなたのツイートをお気に入りに登録しました', 'あなたのツイートにいいねしました'],
      ['あなたの返信をお気に入りに登録しました', 'あなたの返信にいいねしました'],
      ['相手はあなたのフォロー、ツイートへの返信、引用、リツイート、お気に入りができなくなります。お互いのツイートや通知も表示されません。相互のフォロー関係は解除され、ブロックを解除しても元には戻りません。', '相手はあなたのフォロー、ツイートへの返信、引用、リツイート、いいねができなくなります。お互いのツイートや通知も表示されません。相互のフォロー関係は解除され、ブロックを解除しても元には戻りません。']
    ]);
    if (native.has(text)) return native.get(text);
    const action = text.match(/^((?:さん)?が?)(あなたの(?:ツイート|返信)をお気に入りに登録しました)$/);
    if (action) return action[1] + native.get(action[2]);
    const count = text.match(/^(\d+)件のお気に入りを表示$/);
    return count ? `${count[1]}件のいいねを表示` : text;
  }

  function ctLocalizationClassicText(text) {
    ctLocalizationRegularText('');
    for (const [classic, regular] of ctLocalizationRegularText.values) {
      if (text === regular) return classic;
    }
    const action = text.match(/^((?:さん)?が?)(あなたの(?:ツイート|返信)にいいねしました)$/);
    if (action) return action[1] + action[2].replace(/にいいねしました$/, 'をお気に入りに登録しました');
    const count = text.match(/^(\d+)件のいいねを表示$/);
    return count ? `${count[1]}件のお気に入りを表示` : text;
  }

  // Keep the same React nodes and remember only values written by this script.
  // A later native render takes ownership again when it changes the value.
  function ctLocalizationClassicEnabled() {
    return typeof ctFavoritePresentationEnabled === 'function' ? ctFavoritePresentationEnabled() :
      typeof classicAppearanceEnabled === 'function' ? classicAppearanceEnabled() : true;
  }

  function ctLocalizationState() {
    return ctLocalizationState.value ||= { byNode: new WeakMap(), records: new Set() };
  }

  function ctLocalizationNativeRecordException(record) {
    const el = record.attribute ? record.node : record.node.parentElement;
    if (nativeLocalizationAccountMenu(el) || nativeLocalizationBlockMenu(el) || isNativeSettingsNavigation(el) || isNativeSettingsValue(el)) return true;
    if (el?.matches('span.truncate') && el.parentElement?.matches('button[data-testid="games-rollup-row"]') && nativeGameJapaneseText(el, record.original, record.attribute)) return true;
    if (el?.matches('h2.truncate') && nativeLocalizationGameContext(el) && /^TWIRDLE(?: \d+)? results$/.test(clean(record.original))) return true;
    if (record.attribute === null && isNativeNotificationTimestamp(el) && record.node === el.lastChild) return true;
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications', '/profile': 'Feed' }[location.pathname.replace(/\/$/, '')] ||
      (/^\/(?:user\/[A-Za-z0-9_.-]+|post\/[A-Za-z0-9_-]{1,160})\/?$/.test(location.pathname) && el?.matches('h2.truncate') && el.closest('.sticky') ? 'Feed' : null);
    if (record.attribute || !routeTitle || clean(record.original) !== routeTitle ||
        !el?.matches('h2.truncate') || el.closest('article')) return false;
    const visibleHeading = [...document.querySelectorAll('main h2')].find(heading => {
      for (let parent = heading; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.style.display === 'none') return false;
      }
      return !heading.closest('article');
    });
    return el === visibleHeading;
  }

  function ctLocalizationRecordAllowed(record) {
    const el = record.attribute ? record.node : record.node.parentElement;
    return !!el && !el.closest('[id^="ct-"],[data-ct-owned],[data-ct-local-ui],[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],[contenteditable]:not([contenteditable="false"]),.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]') &&
      (!el.closest('.truncate') || ctLocalizationNativeRecordException(record)) &&
      !(record.attribute === null && el.closest('textarea,input,select,option'));
  }

  function ctLocalizationRead(record) {
    return record.attribute ? record.node.getAttribute(record.attribute) : record.node.nodeValue;
  }

  function ctLocalizationWrite(record, value) {
    if (ctLocalizationRead(record) !== value) {
      if (record.attribute) record.node.setAttribute(record.attribute, value);
      else record.node.nodeValue = value;
    }
    record.written = value;
  }

  function ctLocalizationForget(record) {
    const state = ctLocalizationState();
    state.records.delete(record);
    state.byNode.get(record.node)?.delete(record.attribute);
  }

  function ctRememberLocalization(node, attribute, classic, regular) {
    const state = ctLocalizationState();
    const current = attribute ? node.getAttribute(attribute) : node.nodeValue;
    let entries = state.byNode.get(node);
    let record = entries?.get(attribute);
    if (record && current !== record.written) {
      ctLocalizationForget(record);
      record = null;
    }
    regular ??= attribute ? ctLocalizationRegularText(classic) :
      classic.replace(/\S[\s\S]*\S|\S/, text => ctLocalizationRegularText(text));
    if (classic === regular) {
      if (record) ctLocalizationForget(record);
      if (current !== classic) {
        if (attribute) node.setAttribute(attribute, classic);
        else node.nodeValue = classic;
      }
      return;
    }
    if (!record) {
      record = { node, attribute, original: current, classic, regular, written: current };
      if (!entries) state.byNode.set(node, entries = new Map());
      entries.set(attribute, record);
      state.records.add(record);
    } else {
      record.classic = classic;
      record.regular = regular;
    }
    ctLocalizationWrite(record, ctLocalizationClassicEnabled() ? record.classic : record.regular);
  }

  function ctSyncLocalizationAppearance(root = document) {
    const enabled = ctLocalizationClassicEnabled();
    for (const record of ctLocalizationState().records) {
      if (!record.node.isConnected || !ctLocalizationRecordAllowed(record) ||
          ctLocalizationRead(record) !== record.written) {
        ctLocalizationForget(record);
        continue;
      }
      if (root !== document && root !== record.node && !root.contains?.(record.node)) continue;
      ctLocalizationWrite(record, enabled ? record.classic : record.regular);
    }
    if (!enabled) {
      if (root instanceof Element && root.classList.contains('ct-notification-fav-icon')) root.classList.remove('ct-notification-fav-icon');
      root.querySelectorAll?.('.ct-notification-fav-icon').forEach(el => el.classList.remove('ct-notification-fav-icon'));
    }
  }

  function installStyle() {
    if (document.getElementById('ct-jp-style')) {
      return;
    }

    const style = document.createElement('style');

    style.id = 'ct-jp-style';

    style.textContent = `
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-favorite-button > svg { display:none!important; }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"] > .ct-star {
        display:inline-flex; width:20px; height:20px; align-items:center; justify-content:center;
        transform-origin:center; pointer-events:none;
      }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"] > .ct-star svg {
        display:block!important; width:20px; height:20px; fill:none; stroke:currentColor;
        stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;
      }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-is-liked { color:#ffac33!important; }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-is-liked > .ct-star svg { fill:currentColor; }
      @media (hover:hover) {
        html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-favorite-button:hover {
          color:#ffac33!important; background:rgba(255,172,51,.12)!important;
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

      #ct-favorites-panel {
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


      .ct-detail-post-time {
        font-size:13px;
        opacity:.68;
        font-weight:400;
        padding:10px 0 8px;
        margin:0 0 2px;
        border-bottom:1px solid rgba(127,127,127,.20);
        white-space:nowrap;
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
      return `${m[1]}からTweetを利用しています`;
    }

    if ((m = t.match(/^(\d+)\s+codes?\s+remaining$/i))) {
      return `${m[1]}個のコードが残っています`;
    }

    if ((m = t.match(/^参加した人数\s+(.+)$/))) {
      return `${m[1]}からTweetを利用しています`;
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
    if (el?.closest('[id^="ct-"],[data-ct-owned],[data-ct-local-ui]')) return true;
    // Classic markers decorate native UI; they do not transfer its text ownership.
    // Keep every other extension-owned class protected, including local panels.
    for (let node = el; node; node = node.parentElement) {
      if ([...node.classList].some(name => name.startsWith('ct-') && !name.startsWith('ct-classic-'))) return true;
    }
    return false;
  }

  function isNativeSettingsNavigation(el) {
    if (!/^\/settings\/?$/.test(location.pathname) || !el?.matches('span.truncate')) return false;
    const button = el.closest('nav button');
    return !!button?.closest('main') && !!button.querySelector('svg') &&
      !button.querySelector('img,a,[data-user-content]') &&
      !/@[A-Za-z0-9_.-]/.test(clean(button.textContent)) &&
      !button.getAttribute('aria-label')?.startsWith('View @');
  }

  function isNativeSettingsValue(el) {
    if (!/^\/settings\/?$/.test(location.pathname) ||
        !el?.matches('main section span.truncate')) return false;
    const label = el.previousElementSibling;
    if (!label?.matches('span.uppercase.tracking-wide')) return false;
    const name = clean(label.textContent);
    return /^(?:Backup codes|バックアップコード)$/.test(name) ||
      (/^(?:Authentication app|認証アプリ|Text message|SMS)$/.test(name) && /^(?:On|Off|オン|オフ)$/.test(clean(el.textContent)));
  }

  function isNativeLocalizationHelp(el) {
    return !!el?.matches('p,li') &&
      !!el.closest('[role="region"][aria-label="How the Wing badge works"]') &&
      !el.closest('article,button,a,[data-user-content]');
  }

  function nativeLocalizationSessionContext(el) {
    if (!/^\/settings\/?$/.test(location.pathname) || !el ||
        el.closest('article,a,input,textarea,[data-user-content],[data-ct-owned]')) return null;
    const dialog = el.closest('[role="dialog"]');
    if (dialog && [...dialog.querySelectorAll('h2,h3,h4')].some(title =>
      /^(?:Sign out this device\?|Sign out of all other devices\?|この端末からログアウトしますか？|他のすべての端末からログアウトしますか？)$/.test(clean(title.textContent)))) return { dialog };
    const section = el.closest('main section');
    const title = section && [...section.querySelectorAll('h4.font-extrabold')].find(title =>
      /^(?:Where you're signed in|ログイン中の端末)$/.test(clean(title.textContent)));
    const container = title?.parentElement?.parentElement;
    if (!container?.matches('div.flex.flex-col.gap-5') || !container.contains(el)) return null;
    const row = el.closest('div.flex.items-center.gap-3.px-4');
    return { container, row: row && container.contains(row) && row.querySelector(':scope > svg') ? row : null };
  }

  function nativeSessionJapaneseText(el, text) {
    const context = nativeLocalizationSessionContext(el);
    if (!context) return null;
    if (context.dialog && el.matches('p')) {
      const confirmation = text.match(/^(.{1,160}) will be signed out and will need your password to sign back in\.$/);
      if (confirmation) return `${confirmation[1]}からログアウトします。再度ログインするにはパスワードが必要です。`;
    }
    if (!context.row) return JP.get(text);
    if (el.matches('span.truncate')) return text === 'Unknown device' ? JP.get(text) : null;
    if (el.matches('span.shrink-0.rounded-full')) return text === 'This device' ? JP.get(text) : null;
    if (!el.matches('span.text-tl-app-text-muted.mt-0\\.5')) return JP.get(text);
    // React renders activity and the prefixed sign-in date as separate text
    // nodes. Translate each in place without merging nodes React still owns.
    const prefixedDate = /^· Signed in /.test(text);
    const parts = (prefixedDate ? text.slice(2) : text).split(' · ');
    if (parts.length > 2) return null;
    const convert = part => {
      if (part === 'Active now') return '現在使用中';
      const age = part.match(/^Active (\d+)([mhd]) ago$/);
      if (age) return `${age[1]}${{ m: '分', h: '時間', d: '日' }[age[2]]}前に使用`;
      const last = part.match(/^Last active ([A-Za-z]+\.?) (\d{1,2})$/);
      if (last) {
        const month = nativeLocalizationMonthNumber(last[1]);
        const day = Number(last[2]);
        if (month && day >= 1 && day <= [31,29,31,30,31,30,31,31,30,31,30,31][month-1]) return `最終使用：${month}月${day}日`;
      }
      const joined = part.match(/^Signed in ([A-Za-z]+\.?) (\d{1,2}), (\d{4})$/);
      if (joined) {
        const month = nativeLocalizationMonthNumber(joined[1]);
        const day = Number(joined[2]);
        const year = Number(joined[3]);
        const date = month && ctTimestampParse(`${joined[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00Z`);
        if (date && year >= 1000) return `${year}年${month}月${day}日にログイン`;
      }
      return null;
    };
    const converted = parts.map(convert);
    return converted.every(Boolean) ? (prefixedDate ? '· ' : '') + converted.join(' · ') : null;
  }

  function isNativeNotificationTimestamp(el) {
    const row = el?.matches('span.text-tl-app-text-soft') && localizationNotificationRow(el);
    if (!row) return false;
    const paragraph = el.parentElement;
    // Mention/quote notifications put @handle, the separator and relative
    // time in one truncated span. Only its final text node is UI metadata.
    if (row.tagName === 'DIV' && paragraph?.matches('p.truncate')) {
      const parts = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && clean(node.nodeValue));
      return !!paragraph.querySelector(':scope > span.font-extrabold') &&
        parts.length === 4 && clean(parts[0].nodeValue) === '@' &&
        /^[A-Za-z0-9_.-]{1,80}$/.test(clean(parts[1].nodeValue)) && clean(parts[2].nodeValue) === '·' &&
        parts[3] === el.lastChild && /^(?:Just now|\d+[smhd]|[A-Za-z]+\.? \d{1,2}|たった今|\d+(?:秒前|分前|時間前|日前)|\d{1,2}月\d{1,2}日)$/.test(clean(parts[3].nodeValue));
    }
    return paragraph?.matches('p') && [...paragraph.childNodes].some(node =>
      node.nodeType === Node.TEXT_NODE ? !!localizationNotificationAction(node) :
        [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && localizationNotificationAction(child))
    );
  }

  function isNativeLocalizationTimestamp(el) {
    if (!el?.matches('span[title]') || !el.closest('article') ||
        el.closest('button,a,[role="button"]') ||
        !el.classList.contains('text-tl-app-text-muted') || !el.classList.contains('hover:underline')) return false;
    return !!ctTimestampParse(el.getAttribute('title'));
  }

  function isNativeReplyTimestamp(el) {
    if (!el?.matches('span.text-tl-app-text-muted.shrink-0') ||
        el.hasAttribute('title') || !el.closest('article') ||
        el.closest('button,a,[role="button"]')) return false;
    // Inline replies omit the main tweet's ISO title. Their timestamp has a
    // fixed position between the author separator and the native action menu.
    const header = el.parentElement;
    const separator = el.previousElementSibling;
    const author = header?.firstElementChild;
    const separatorIndex = [...(header?.children || [])].indexOf(separator);
    const decorations = [...(header?.children || [])].slice(1, separatorIndex);
    return !!header?.matches('div.flex.items-center.gap-1.min-w-0') &&
      separatorIndex >= 1 && decorations.every(marker =>
        marker.matches('span.ct-official-badges[data-ct-owned][role="img"]') && marker.children.length &&
        [...marker.children].every(img => img.matches('img') &&
          /^https:\/\/app\.tweet\.app\/assets\/(?:founder|fighter|centurion|team-member|ambassador|wing|press)-badge-(?:36|96)\.png$/.test(img.getAttribute('src') || '')) ||
        marker.matches('span.ct-founder') && !marker.children.length && /^#\d{5,}$/.test(clean(marker.textContent)) &&
          marker.getAttribute('title') === `Founder Number ${clean(marker.textContent)}`) &&
      !!author?.matches('button.font-bold.truncate.hover\\:underline') &&
      !!separator?.matches('span.text-tl-app-text-muted') && clean(separator.textContent) === '·' &&
      !!header.querySelector(':scope > div.flex.items-center.shrink-0.ml-auto') &&
      !!header.nextElementSibling?.matches('p.tl-user-text.whitespace-pre-wrap');
  }

  function isNativeReplyOptionsButton(el) {
    return !!el?.matches('button.p-2.rounded-full.text-tl-app-text-muted') && !!el.closest('article') &&
      !!el.parentElement?.matches('div.relative') &&
      !!el.querySelector(':scope > svg.lucide-ellipsis-vertical[width="18"][height="18"]');
  }

  function nativeLocalizationParentPostPreview(el) {
    const button = el?.closest('button.flex.w-full.items-start.gap-3.px-4.pt-3.pb-2.text-left,div.flex.w-full.items-start.gap-3.px-4.pt-3.text-left');
    const parent = button?.parentElement;
    const wrapper = parent?.matches('div.border-b.border-tl-app-border') ||
      button?.matches('div.pb-0') && parent?.matches('div.min-h-0.flex-1.overflow-y-auto') &&
      !!parent.closest('main') && /^\/post\/[A-Za-z0-9_-]{1,160}\/?$/.test(location.pathname);
    if (!wrapper ||
        button !== button.parentElement.firstElementChild ||
        !button.nextElementSibling?.matches('article')) return null;
    if (button.tagName === 'DIV' && !button.matches('.pb-2,.pb-0')) return null;
    const body = button.querySelector(':scope > div.min-w-0.flex-1');
    if (!body && button.tagName === 'DIV' && button.querySelector('span[aria-hidden="true"].h-8.w-8') &&
        el.matches('p.min-w-0.flex-1.self-center.italic.leading-5.text-tl-app-text-muted') && el.parentElement === button) return { button, deleted: true };
    const header = body?.firstElementChild;
    return header?.matches('div.flex.min-w-0.flex-wrap.items-center.gap-1.leading-4') &&
      header.firstElementChild?.matches('span.font-semibold.truncate') &&
      header.children[1]?.matches('span.text-tl-app-text-muted.truncate') &&
      /^@[A-Za-z0-9_.-]+$/.test(clean(header.children[1].textContent)) ? { button, body, header } : null;
  }

  function isNativeParentPostTimestamp(el) {
    const preview = nativeLocalizationParentPostPreview(el);
    const time = el?.matches('a.hover\\:underline') ? el.parentElement : el;
    if (!preview || !time?.matches('span.shrink-0.text-tl-app-text-muted') || time.hasAttribute('title') ||
        time.parentElement !== preview.header || time !== preview.header.lastElementChild ||
        !time.previousElementSibling?.matches('span.text-tl-app-text-muted') ||
        clean(time.previousElementSibling.textContent) !== '·') return false;
    if (el === time) return !time.children.length;
    const handle = clean(preview.header.children[1].textContent);
    return el === time.firstElementChild && time.children.length === 1 &&
      /^\/post\/[A-Za-z0-9_-]{1,160}$/.test(el.getAttribute('href') || '') &&
      [ `Open the post by ${handle} that this replies to`, `${handle}への返信元のツイートを開く` ].includes(el.getAttribute('aria-label'));
  }

  function isNativeTranslationMetadata(el) {
    if (!el?.matches('p.text-tl-app-text-muted[aria-live="polite"]') || !el.closest('article') ||
        !el.parentElement?.matches('div.mt-0\\.5') ||
        !el.querySelector(':scope > span.select-none')) return false;
    return [...el.children].some(child => child.matches('button.text-sky-500,button.text-tl-app-text-muted') &&
      /^(?:Show translation|Show original|Translating…|翻訳を表示|原文を表示|翻訳中…)$/.test(clean(child.textContent)));
  }

  function nativeLocalizationMonthNumber(value) {
    const month = value.toLowerCase().replace(/\.$/, '');
    return ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'].findIndex(name =>
      name === month || name.slice(0, 3) === month || name === 'september' && month === 'sept') + 1;
  }

  function nativeTimestampJapaneseText(el, text) {
    if (!isNativeLocalizationTimestamp(el) && !isNativeReplyTimestamp(el) && !isNativeParentPostTimestamp(el) &&
        !isNativeNotificationTimestamp(el)) return null;
    const relative = text.match(/^(\d+)([smhd])$/);
    if (relative) return relative[1] + { s: '秒前', m: '分前', h: '時間前', d: '日前' }[relative[2]];
    // The native relative-time formatter uses an English month after a week.
    const date = text.match(/^([A-Za-z]+\.?) (\d{1,2})$/);
    const month = date && nativeLocalizationMonthNumber(date[1]);
    const day = date && Number(date[2]);
    return month && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?
      `${month}月${day}日` : null;
  }

  function isNativeEditedIndicator(el) {
    if (!el?.matches('span.text-tl-app-text-muted[title]') ||
        !el.closest('article') || el.closest('button,a,[role="button"]') ||
        !/^(?:edited|編集済み)$/i.test(clean(el.textContent))) return false;
    if (!ctTimestampParse(el.getAttribute('title'))) return false;
    // Both native tweet and inline-reply headers place the indicator directly
    // after a separator, alongside their author button and creation timestamp.
    const header = el.parentElement;
    return !!header?.matches('div.flex.items-center') &&
      clean(el.previousElementSibling?.textContent) === '·' &&
      !!header.querySelector('button.font-bold.truncate') &&
      [...header.children].some(sibling => sibling !== el &&
        sibling.matches('span.text-tl-app-text-muted') &&
        (isNativeLocalizationTimestamp(sibling) || sibling.classList.contains('shrink-0')));
  }

  function isNativeTweetCount(el) {
    if (!el?.matches('span.text-tl-app-text-muted') || el.closest('article,[data-user-content]')) return false;
    const parent = el.parentElement;
    const strong = el.firstElementChild;
    if (/^\/(?:profile\/?|user\/[^/]+\/?)$/.test(location.pathname) &&
        strong?.matches('strong.font-extrabold.text-tl-app-text') && /^[\d,.]+[KMB]?$/.test(clean(strong.textContent)) &&
        parent?.querySelector(':scope > button')) return true;
    return !!el.closest('aside') && el.classList.contains('mt-0.5') && parent?.matches('button.group') &&
      parent.children.length === 2 && parent.lastElementChild === el &&
      parent.firstElementChild.matches('span.truncate[title^="#"]') && /^#[^\s]+$/.test(clean(parent.firstElementChild.textContent));
  }

  // Tweet v2.1.0 keeps user-written poll choices in tl-user-text. Recognize
  // only the surrounding native poll chrome; never treat a whole fieldset as UI.
  function nativeLocalizationPoll(el) {
    if (!el || isOwnedLocalizationElement(el)) return null;
    const compose = el.closest('fieldset.relative.w-full.mt-3.rounded-2xl.border');
    if (compose && /^(?:Poll|投票)$/.test(clean(compose.querySelector(':scope > legend')?.textContent)) &&
        compose.querySelector('input[type="text"][maxlength="25"][id*="-choice-"]') &&
        [...compose.querySelectorAll('select option')].map(option => option.value).join(',') === '1,24,72,168') {
      return { root: compose, compose: true };
    }
    if (!el.closest('article')) return null;
    for (let candidate = el; candidate && candidate.tagName !== 'ARTICLE'; candidate = candidate.parentElement) {
      if (!candidate.matches('div.mt-3')) continue;
      const choices = candidate.querySelector(':scope > fieldset.flex.flex-col');
      const results = candidate.querySelector(':scope > div > ul[aria-label="Poll results"],:scope > div > ul[aria-label="投票結果"]');
      const labels = choices && [...choices.querySelectorAll(':scope > label')];
      if (choices && /^(?:Poll choices|投票の選択肢)$/.test(clean(choices.querySelector(':scope > legend')?.textContent)) &&
          labels.length >= 2 && labels.length <= 5 && labels.every(label =>
            label.querySelector(':scope > input[type="radio"]') && label.querySelector(':scope > span.tl-user-text'))) {
        return { root: candidate, compose: false };
      }
      if (results && results.children.length >= 2 && results.children.length <= 5 &&
          [...results.children].every(row => row.matches('li.relative.overflow-hidden') && row.querySelector('span.tl-user-text'))) {
        return { root: candidate, compose: false };
      }
    }
    return null;
  }

  function isNativeLocalizationPollUI(el) {
    const poll = nativeLocalizationPoll(el);
    if (!poll) return false;
    if (poll.compose) return el.matches('legend,label,button,button span,p[role="status"]');
    return el.matches('legend.sr-only,span.sr-only,p[role="status"],p[role="alert"]') ||
      (el.matches('button') && el.parentElement?.matches('div.mt-2.flex.items-center.justify-between')) ||
      (el.matches('span.text-tl-app-text-muted,p.text-tl-app-text-muted') &&
        (el.parentElement?.matches('div.mt-2.flex.items-center.justify-between') ||
          el.parentElement?.matches('div.flex.flex-col.outline-none')));
  }

  function nativeLocalizationAccountMenu(el) {
    if (!el?.matches('span.min-w-0.truncate') || !el.parentElement?.matches('button[role="menuitem"]') ||
        !el.parentElement.querySelector(':scope > svg') || !el.parentElement.parentElement?.matches('[role="menu"]')) return null;
    const host = el.parentElement.parentElement.parentElement;
    const trigger = host?.querySelector(':scope > button[aria-haspopup="menu"]');
    return trigger && /^(?:Profile options|プロフィールのメニュー)$/.test(trigger.getAttribute('aria-label') || '') ? el : null;
  }

  function nativeLocalizationAccountDialog(el) {
    const dialog = el?.closest('[role="dialog"][aria-modal="true"].bg-tl-app-card.border');
    if (!dialog || !/^(?:Report @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+を報告)$/.test(dialog.getAttribute('aria-label') || '') ||
        !dialog.querySelector('h3.text-sm.font-bold.text-tl-app-text')) return null;
    return dialog;
  }

  // v2.3.0 supplies blocking itself. Translate only its native chrome and
  // preserve account handles, user text, and the existing action handlers.
  function nativeLocalizationBlockMenu(el) {
    if (!el?.matches('span.min-w-0.truncate,button') ||
        !/^(?:(?:Block|Unblock) @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+(?:をブロック|のブロックを解除))$/.test(clean(el.textContent))) return null;
    const button = el.matches('button') ? el : el.parentElement;
    const menu = button?.parentElement;
    const trigger = menu?.parentElement?.querySelector(':scope > button[aria-label]');
    if (!menu?.matches('div.absolute.right-0.top-full.bg-tl-app-card.border.rounded-xl') || !trigger) return null;
    if (el.matches('button')) return button.matches('button.w-full.flex.items-center.text-left') &&
      button.querySelector(':scope > svg.lucide-ban') && menu.parentElement.matches('div.relative.shrink-0') &&
      /^(?:More options|メニューを開く)$/.test(trigger.getAttribute('aria-label') || '') &&
      trigger.getAttribute('aria-haspopup') === 'true' ? el : null;
    return button?.matches('button.text-red-500') && button.querySelector(':scope > svg') &&
      /^(?:Profile options|Post options|Reply options|プロフィールのメニュー|ツイートのメニュー|返信のメニュー)$/.test(trigger.getAttribute('aria-label') || '') ? el : null;
  }

  function nativeLocalizationBlockDialog(el) {
    const dialog = el?.closest('[role="dialog"][aria-modal="true"][aria-labelledby="app-confirm-title"].bg-tl-app-card.border');
    const title = dialog?.querySelector(':scope > h3#app-confirm-title');
    return title && /^(?:(?:Block|Unblock) @[A-Za-z0-9_.-]+\?|@[A-Za-z0-9_.-]+(?:をブロック|のブロックを解除)しますか？)$/.test(clean(title.textContent)) &&
      dialog.querySelector(':scope > p.mt-2.leading-relaxed.text-tl-app-text-muted') &&
      dialog.querySelectorAll(':scope > div.mt-5 > button').length === 2 ? dialog : null;
  }

  function nativeLocalizationBlockProfile(el) {
    if (!el?.matches('p') || !/^\/(?:profile|user\/[A-Za-z0-9_.-]+)\/?$/.test(location.pathname) || !el.closest('main')) return null;
    const panel = el.parentElement;
    const title = panel?.firstElementChild;
    if (!title?.matches('p') || panel.children.length !== 2 || !panel.lastElementChild.matches('p.text-tl-app-text-muted')) return null;
    if (panel.matches('div.flex.flex-col.items-start.justify-center.py-12.px-8') &&
        /^(?:You're blocked|ブロックされています)$/.test(clean(title.textContent))) return panel;
    return panel.matches('div.flex.flex-col.items-center.justify-center.py-20.px-4.text-center') &&
      /^(?:You blocked @|ブロック済み: @)[A-Za-z0-9_.-]+$/.test(clean(title.textContent)) ? panel : null;
  }

  function nativeBlockJapaneseText(el, text) {
    const menu = nativeLocalizationBlockMenu(el);
    const dialog = nativeLocalizationBlockDialog(el);
    const profile = nativeLocalizationBlockProfile(el);
    let match;
    if (menu && (match = text.match(/^(Block|Unblock) (@[A-Za-z0-9_.-]+)$/))) return match[1] === 'Block' ? `${match[2]}をブロック` : `${match[2]}のブロックを解除`;
    if (dialog && el.matches('h3') && (match = text.match(/^(Block|Unblock) (@[A-Za-z0-9_.-]+)\?$/))) return match[1] === 'Block' ? `${match[2]}をブロックしますか？` : `${match[2]}のブロックを解除しますか？`;
    if (profile && el === profile.firstElementChild && text === 'You blocked @') return 'ブロック済み: @';
    if (profile && (match = text.match(/^(@[A-Za-z0-9_.-]+) has blocked you, so you can't follow them or see their posts\.$/))) return `${match[1]}さんにブロックされているため、フォローやツイートの表示ができません。`;
    if (el?.closest('[role="status"],[role="alert"]') &&
        (match = text.match(/^Couldn't (block|unblock) (@[A-Za-z0-9_.-]+)\. Try again\.$/))) return match[1] === 'block' ? `${match[2]}をブロックできませんでした。もう一度お試しください。` : `${match[2]}のブロックを解除できませんでした。もう一度お試しください。`;
    return null;
  }

  function isNativeBlockedAccountError(el) {
    if (!el?.matches('div.text-red-500.border') || !el.classList.contains('bg-red-500/10') ||
        !el.classList.contains('border-red-500/20') || !/^\/settings\/?$/.test(location.pathname) || !el.closest('main section')) return false;
    const panel = el.closest('div.flex.flex-col.gap-5');
    const title = panel?.querySelector(':scope > div > h4.font-extrabold');
    return !!title && /^(?:Blocked accounts|ブロックしているアカウント)$/.test(clean(title.textContent));
  }

  // Tweet owns pin state, ordering, replacement and undo. Only the verified
  // controls/metadata are UI; replacement choices contain original post text.
  function nativeLocalizationPinContext(el) {
    if (!el?.isConnected || isOwnedLocalizationElement(el) || el.closest(
      'textarea,input,select,option,[contenteditable]:not([contenteditable="false"]),' +
      '[translate="no"],.notranslate,[data-user-content],.tl-user-text,[data-testid="tweet-text"],' +
      '[data-testid="profile-bio"],.whitespace-pre-wrap,.break-words,.wrap-break-word,blockquote,[aria-label^="Quoted post"]'
    )) return null;
    const shop = el.matches('span') ? el.parentElement : null;
    if (shop?.matches('a:is([href="https://tweet.shop"],[href="https://tweet.shop/"])[target="_blank"][rel~="noopener"][rel~="noreferrer"]') &&
        shop.querySelector(':scope > svg.lucide-shopping-bag') &&
        (shop.closest('aside nav') || shop.closest('[role="dialog"][aria-label="Account menu"]')) &&
        shop.children.length === 3 && shop.children[1].matches('span:not(.sr-only)') &&
        shop.children[2].matches('span.sr-only') && !el.children.length) return { kind: 'shop', root: shop };
    const menu = el.matches('span') && el.parentElement?.matches('button[type="button"]') ? el.parentElement.parentElement : null;
    const trigger = menu?.parentElement?.querySelector(':scope > button[data-post-menu-trigger][aria-label]');
    if (menu?.matches('div.absolute.right-0.top-full.bg-tl-app-card.border.rounded-xl') &&
        menu.parentElement?.matches('div.relative') && menu.closest('article') && trigger &&
        /^[A-Za-z0-9_-]{1,160}$/.test(trigger.getAttribute('data-post-menu-trigger') || '') &&
        /^(?:Post options|Reply options|ツイートのメニュー|返信のメニュー)$/.test(trigger.getAttribute('aria-label') || '') &&
        !el.children.length && el.parentElement.children.length === 2 &&
        el.parentElement.firstElementChild.matches('svg.lucide-pin,svg.lucide-pin-off,svg.lucide-arrow-up')) return { kind: 'menu', root: menu };
    const dialog = el.closest('div[role="dialog"][aria-modal="true"][aria-labelledby="replace-pin-title"][aria-describedby="replace-pin-body"]');
    if (dialog?.matches('.bg-tl-app-card.border.overflow-hidden') &&
        dialog.querySelector(':scope > div > h3#replace-pin-title > svg.lucide-pin') &&
        dialog.querySelector(':scope > div > p#replace-pin-body') &&
        dialog.querySelectorAll(':scope > div > div[role="radiogroup"][aria-labelledby="replace-pin-title"] > label > input[type="radio"][name="replace-pin"]').length === 3) {
      // Do not infer whether a choice's words are body text or the native
      // "Post with media" fallback: those two sources have identical DOM.
      if (!el.closest('label,[role="radiogroup"]') &&
          (el.matches('h3#replace-pin-title,p#replace-pin-body,button[type="button"]'))) return { kind: 'dialog', root: dialog };
    }
    const toast = el.closest('div[role="status"][aria-live="polite"].pointer-events-auto.flex.items-center.gap-3.rounded-full.bg-sky-500');
    if (toast?.parentElement?.matches('div.pointer-events-none.fixed.inset-x-0.bottom-6.flex.justify-center') &&
        toast.firstElementChild?.matches('span') && !toast.firstElementChild.children.length &&
        toast.children.length <= 2 && (el === toast.firstElementChild ||
          el.matches('button[type="button"].shrink-0.font-bold.underline') && el.parentElement === toast)) return { kind: 'toast', root: toast };
    if (!/^\/(?:profile|user\/[A-Za-z0-9_.-]+)\/?$/.test(location.pathname) || !el.closest('main') || el.closest('article')) return null;
    const section = el.closest('section[aria-label="Pinned posts"],section[aria-label="固定されたツイート"]');
    if (section) {
      if (el === section && section.querySelector('article')) return { kind: 'section', root: section };
      const parent = el.parentElement;
      if (el.matches('span') && parent?.matches('p.flex.items-center.font-bold.text-tl-app-text-muted') &&
          parent.querySelector(':scope > svg.lucide-pin') && parent.children.length === 2 &&
          parent.parentElement?.matches('div') && parent.parentElement.closest('section') === section &&
          parent.parentElement.querySelector(':scope > article')) return { kind: 'label', root: section };
      const button = el.matches('span') ? el.parentElement : null;
      const target = button?.getAttribute('aria-controls');
      const panel = target && section.ownerDocument.getElementById(target);
      if (button?.matches('button[type="button"][aria-expanded][aria-controls].w-full.flex.items-center.border-b') &&
          button.parentElement === section && button.children.length === 2 && button.firstElementChild.matches('svg') &&
          panel?.matches('div') && panel.parentElement === section && panel.querySelector('article')) return { kind: 'expand', root: section };
    }
    const hint = el.parentElement;
    if (hint?.matches('div.mx-4.my-3.flex.items-start.gap-3.rounded-2xl.border.bg-tl-app-card.px-4.py-3') &&
        hint.children.length === 3 && hint.firstElementChild.matches('svg.lucide-pin') &&
        hint.children[1].matches('p.min-w-0.flex-1.text-tl-app-text') &&
        hint.lastElementChild.matches('button[type="button"][aria-label]') && hint.lastElementChild.querySelector(':scope > svg.lucide-x') &&
        (el === hint.children[1] || el === hint.lastElementChild)) return { kind: 'hint', root: hint };
    return null;
  }

  function nativePinJapaneseText(el, text, attr = null) {
    // Most timeline text is user content. Avoid walking its ancestors for
    // labels that cannot be one of the new native UI strings.
    if (typeof text !== 'string' || !attr && !/^(?:Pin|Unpin|Move|Show [1-2] more pinned|Hide [1-2] pinned|You have 3 pinned|Choose one to replace|Replace$|Cancel$|Undo$|Retry$|Couldn't (?:pin|unpin|move)|This post can't be pinned|Your pins|Too many pin|That change couldn't be made|Shop$|\(opens in a new tab\)$)/.test(text)) return null;
    const context = nativeLocalizationPinContext(el);
    if (!context) return null;
    const { kind, root } = context;
    if (attr) {
      if (attr !== 'aria-label') return null;
      if (kind === 'section' && text === 'Pinned posts') return '固定されたツイート';
      if (kind === 'hint' && text === 'Dismiss') return '閉じる';
      return kind === 'dialog' && text === 'Cancel' ? 'キャンセル' : null;
    }
    if (kind === 'shop') return new Map([['Shop', 'ショップ'], ['(opens in a new tab)', '（新しいタブで開きます）']]).get(text) || null;
    if (kind === 'menu') return new Map([
      ['Pin to profile', 'プロフィールに固定'], ['Unpin from profile', 'プロフィールの固定を解除'], ['Move to top', '一番上に移動']
    ]).get(text) || null;
    if (kind === 'label') {
      const match = /^Pinned · ([1-3]) of ([2-3])$/.exec(text);
      return text === 'Pinned' ? '固定されたツイート' : match && Number(match[1]) <= Number(match[2]) ? `固定 · ${match[2]}件中${match[1]}件目` : null;
    }
    if (kind === 'expand') {
      const show = /^Show ([1-2]) more pinned posts?$/.exec(text);
      const hide = /^Hide ([1-2]) pinned posts?$/.exec(text);
      return show ? `ほかの固定ツイート${show[1]}件を表示` : hide ? `固定ツイート${hide[1]}件を折りたたむ` : null;
    }
    if (kind === 'hint') return text === 'Pin up to 3 posts so visitors see your best work first. Use ··· on any of your posts.' ?
      'ツイートは3件までプロフィールに固定できます。自分のツイートの「···」から設定できます。' : null;
    if (kind === 'dialog') return new Map([
      ['You have 3 pinned posts', 'ツイートを3件固定しています'],
      ["Choose one to replace. It stays on your profile; it just won't be pinned.", '固定を解除するツイートを選んでください。ツイートはプロフィールに残ります。'],
      ['Replace', '入れ替える'], ['Cancel', 'キャンセル']
    ]).get(text) || null;
    if (kind === 'toast') {
      const messages = new Map([
        ['Pinned to your profile.', 'プロフィールに固定しました。'], ['Unpinned from your profile.', 'プロフィールの固定を解除しました。'],
        ["Unpinned. It's further down your Tweets, by its date.", '固定を解除しました。投稿日時の順にツイート一覧に表示されます。'],
        ['Moved to the top.', '一番上に移動しました。'], ["Couldn't pin. Try again.", '固定できませんでした。もう一度お試しください。'],
        ["Couldn't unpin. Try again.", '固定を解除できませんでした。もう一度お試しください。'],
        ["Couldn't move it. Try again.", '移動できませんでした。もう一度お試しください。'],
        ["This post can't be pinned.", 'このツイートは固定できません。'],
        ['Your pins are updating. Use ··· to try again in a moment.', '固定を更新中です。少し待ってから「···」でお試しください。'],
        ['Too many pin changes. Try again in a few minutes.', '固定の変更が多いため、数分待ってからお試しください。'],
        ['Your pins changed elsewhere. Showing the latest.', '別の画面で固定が変更されました。最新の状態を表示しています。'],
        ["That change couldn't be made.", '変更できませんでした。']
      ]);
      const message = clean(root.firstElementChild.textContent);
      if (!messages.has(message) && ![...messages.values()].includes(message)) return null;
      return el === root.firstElementChild ? messages.get(text) || null : new Map([['Undo', '元に戻す'], ['Retry', '再試行']]).get(text) || null;
    }
    return null;
  }

  // Tweet 2.5 owns puzzles, results, keyboard and result sharing. Localize
  // only its verified chrome, never game words, player names or post previews.
  function nativeLocalizationGameContext(el) {
    if (!el || isOwnedLocalizationElement(el) || el.closest(
      'textarea,input,select,option,svg,code,pre,[contenteditable]:not([contenteditable="false"]),' +
      '[translate="no"],.notranslate,[data-user-content],.tl-user-text,[data-testid="tweet-text"],' +
      '[data-testid="profile-bio"],[aria-label="Post preview"],[aria-label="投稿プレビュー"]')) return null;
    const summary = el.closest('section[aria-labelledby="games-today"],section[aria-labelledby="games-settings"],' +
      'section[aria-labelledby="explore-games"],section[aria-labelledby="feed-games-title"]');
    if (summary && summary.querySelector(`:scope h2#${summary.getAttribute('aria-labelledby')}`)) return { root: summary, kind: 'summary' };
    const rollup = el.closest('button[data-testid="games-rollup-row"]');
    if (rollup?.matches('button.w-full.flex.items-center') &&
        rollup.querySelector(':scope > span > svg') && rollup.querySelector(':scope > svg') &&
        rollup.querySelector(':scope > span.truncate[title]')) return { root: rollup, kind: 'rollup' };
    const card = el.closest('div[data-testid="game-result-card"]');
    if (card?.querySelector(':scope > span.tw-egg[aria-hidden="true"]') &&
        card.querySelector(':scope > button[type="button"][aria-label]')) return { root: card, kind: 'card' };
    const howto = el.closest('div[role="dialog"][aria-modal="true"][aria-labelledby="tw-howto-title"]');
    if (howto?.querySelector('h2#tw-howto-title') && howto.querySelector('div.tw-egg[role="img"]')) return { root: howto, kind: 'help' };
    const share = el.closest('section[aria-labelledby="tw-share-title"]');
    if (share?.querySelector(':scope > h2#tw-share-title') &&
        share.querySelector('div[role="radiogroup"] input[type="radio"][name="tw-share-audience"]')) return { root: share, kind: 'share' };
    const play = el.closest('div.tw-play');
    if (play?.querySelector(':scope > div.tw-board[role="group"]') &&
        play.querySelector('div[role="group"][aria-label="Keyboard"],div[role="group"][aria-label="キーボード"]')) return { root: play, kind: 'play' };
    // Games can open in a native navigation stack without changing /feed.
    // The actual board/results/settings markers, rather than the route alone,
    // identify that stack and keep unrelated profile/timeline text protected.
    const page = el.closest('main div.animate-fadeIn');
    if (!page) return null;
    const title = page.querySelector(':scope > div.sticky > div > h2.truncate');
    const header = title?.parentElement?.parentElement;
    const gameHeader = header?.querySelector(':scope > button[aria-label="Back"],:scope > button[aria-label="戻る"]') &&
      /^TWIRDLE(?: \d+)?(?: results|の結果)?$/.test(clean(title.textContent));
    if (!gameHeader && !page.querySelector('section[aria-labelledby="games-today"],div.tw-play > div.tw-board,' +
      '[role="tablist"][aria-label="Leaderboard"],[role="tablist"][aria-label="ランキング"],section[aria-labelledby="twirdle-stats"]')) return null;
    if (el.closest('ol li button,ul li button')?.querySelector('.truncate')) return null;
    if (el.closest('ol li') && !el.closest('section[aria-labelledby="twirdle-stats"]')) return null;
    return { root: page, kind: 'page' };
  }

  function nativeGameJapaneseText(el, text, attr = null) {
    if (typeof text !== 'string' || text.length > 500) return null;
    const words = nativeGameJapaneseText.words ||= new Map([
      ['Games', 'ゲーム'], ['Today’s games', '今日のゲーム'], ['All games', 'すべてのゲーム'], ['See all games', 'すべてのゲームを見る'],
      ['Today', '今日'], ['· new puzzles at midnight ET', '· 米国東部時間の午前0時に更新'],
      ['Today’s puzzle · new one at midnight ET', '今日の問題 · 米国東部時間の午前0時に更新'],
      ['Closed · see how everyone did', '終了 · みんなの結果を見る'], ['No puzzle today', '今日の問題はありません'],
      ['Loading…', '読み込み中…'], ['Couldn’t load today’s games.', '今日のゲームを読み込めませんでした。'],
      ['Couldn’t load your game settings.', 'ゲームの設定を読み込めませんでした。'], ['Couldn’t save that. Try again.', '保存できませんでした。もう一度お試しください。'],
      ['Settings', '設定'], ['Appear on leaderboards', 'ランキングに表示する'],
      ['Your name, handle and score on each game’s Results page', '各ゲームの結果ページに名前・ユーザー名・スコアを表示します'],
      ['Play', '遊ぶ'], ['Continue', '続ける'], ['View', '見る'], ['Results', '結果'], ['Retry', '再試行'],
      ['There’s no TWIRDLE', 'TWIRDLEの問題はありません。'], ['There’s no', '問題はありません：'],
      ['for that day', 'その日付'], ['today', '今日'], ['. A new one opens at midnight ET.', '。新しい問題は米国東部時間の午前0時に公開されます。'],
      ['How to play', '遊び方'], ['How to play TWIRDLE', 'TWIRDLEの遊び方'], ['Close how to play', '遊び方を閉じる'],
      ['Guess the hidden word', '隠れた単語を当てましょう'], ['Examples', '例'], ['Each word must be a valid', '入力するのは実在する単語です。文字数は'],
      ['-letter word.', '文字です。'], ['After each guess, the eggs change to show how close you are.', '回答すると卵が変化し、正解にどれだけ近いかを示します。'],
      ['W is hatched: it’s in the word, in the right spot.', 'Wは孵化：文字と位置の両方が正解です。'],
      ['E is cracked: it’s in the word, but in another spot.', 'Eはひび割れ：文字は正解ですが、位置が違います。'],
      ['K stays a plain egg: it isn’t in the word at all.', 'Kは卵のまま：正解の単語には含まれません。'],
      ['A new TWIRDLE opens every day at midnight ET. Solve it each day to build your streak; a missed or unsolved day ends it.', 'TWIRDLEは毎日、米国東部時間の午前0時に更新されます。毎日正解して連続記録を伸ばしましょう。参加しなかった日や正解できなかった日があると記録は途切れます。'],
      ['Got it', 'わかりました'], ['Couldn’t load TWIRDLE. Try again.', 'TWIRDLEを読み込めませんでした。もう一度お試しください。'],
      ['Not enough letters.', '文字数が足りません。'], ['Not in the word list.', '単語リストにない単語です。'],
      ['You’ve already finished this puzzle.', 'この問題はすでに終了しています。'],
      ['Today’s puzzle was replaced with a new one. Your word is kept and no attempt was used.', '今日の問題が差し替えられました。入力した単語は保持され、回答回数は消費されていません。'],
      ['This puzzle has closed.', 'この問題は終了しました。'], ['This puzzle isn’t available any more.', 'この問題は利用できなくなりました。'],
      ['Too many guesses at once. Wait a moment, then try again.', '回答が集中しています。少し待ってからお試しください。'],
      ['Couldn’t send your guess. Your word is kept and no attempt was used. Try again.', '回答を送信できませんでした。入力と回答回数は保持されています。もう一度お試しください。'],
      ['Checking whether your guess went through…', '回答が送信されたか確認中…'],
      ['Your guess didn’t go through. Your word is kept; try again.', '回答は送信されていません。入力は保持されています。もう一度お試しください。'],
      ['Couldn’t check whether your guess went through. Reopen the puzzle before trying again.', '回答が送信されたか確認できませんでした。問題を開き直してからお試しください。'],
      ['Not this time. The answer is revealed after midnight ET.', '今回は残念。正解は米国東部時間の午前0時以降に公開されます。'],
      ['Share your result', '結果を共有'], ['Results page only', '結果ページのみ'], ['Post to my followers', 'フォロワーへ投稿'],
      ['Marked shared on your row of today’s Results page, which only you see. It won’t appear in anyone’s feed.', '今日の結果ページの自分の行に共有済みと表示します。この表示は自分だけに見え、誰かのタイムラインに投稿されることはありません。'],
      ['Your own post, with a card they can play from. Several at once fold into one row.', '遊べるカードを添えて、自分のツイートとして投稿します。複数の結果は1つの行にまとめられます。'],
      ['Only today’s puzzle can be posted.', '投稿できるのは今日の問題だけです。'], ['Post preview', '投稿プレビュー'], ['Not now', '今はしない'],
      ['Sharing…', '共有中…'], ['Share', '共有'], ['You’ve already posted this result.', 'この結果はすでに投稿しています。'],
      ['Posting to followers isn’t available for this puzzle.', 'この問題の結果はフォロワーへ投稿できません。'],
      ['Finish the puzzle to share your result.', '問題を終えると結果を共有できます。'],
      ['Couldn’t reach Tweet. Try again.', 'Tweetに接続できませんでした。もう一度お試しください。'], ['Couldn’t share that. Try again.', '共有できませんでした。もう一度お試しください。'],
      ['Couldn’t check whether that went through. Reopen the puzzle before trying again.', '処理が完了したか確認できませんでした。問題を開き直してからお試しください。'],
      ['Posted to your followers.', 'フォロワーへ投稿しました。'], ['Shared on the Results page.', '結果ページで共有しました。'], ['View post', 'ツイートを見る'],
      ['See results', '結果を見る'], ['See today’s results', '今日の結果を見る'], ['Play today’s TWIRDLE', '今日のTWIRDLEで遊ぶ'],
      ['Keyboard', 'キーボード'], ['Delete letter', '文字を削除'], ['Enter', '回答する'], ['Leaderboard', 'ランキング'],
      ['People I follow', 'フォロー中のユーザー'], ['Everyone', 'すべてのユーザー'], ['Your stats', 'あなたの成績'],
      ['Played', 'プレイ回数'], ['Hatched', '正解率'], ['Streak', '連続正解'], ['Best', '最長記録'],
      ['Guess distribution', '正解までの回答回数'], ['Hatched puzzles by number of guesses', '正解までの回答回数別の問題数'],
      ['You haven’t played this one yet.', 'この問題はまだプレイしていません。'], ['You didn’t play this one.', 'この問題には参加しませんでした。'],
      ['You’re still playing. Finish to get a rank.', 'プレイ中です。終了すると順位が表示されます。'],
      ['Not this time. Only hatched eggs are ranked.', '今回は残念。正解した場合のみランキングに表示されます。'],
      ['No one you follow has hatched this one yet.', 'フォロー中のユーザーはまだ誰も正解していません。'], ['No one has hatched this one yet.', 'まだ誰も正解していません。'],
      ['Not this time', '今回は残念'], ['Couldn’t load results.', '結果を読み込めませんでした。'], ['The answer', '正解'], ['The word was', '正解の単語'],
      ['Games page', 'ゲームページ'], ['Ranked by guesses, then time from your first guess. Turn off “Appear on leaderboards” on the', '回答回数が少ない順、同じ場合は最初の回答からの所要時間順に表示します。自分を非表示にするには、'],
      ['to hide yourself.', 'で「ランキングに表示する」をオフにしてください。']
    ]);
    // Most timeline nodes are user text. Reject non-game strings before any
    // structural queries so the new module does not add a page scan per word.
    if (!words.has(text) && !/^(?:Guess |Hatched in |[1-9]\d?(?: of |[0-9]{0,3}-day streak)|You hatched |TWIRDLE|You’re ranked |Not this time\. The word was |Play TWIRDLE|Continue TWIRDLE|View TWIRDLE|Letter |[A-Z], |enter$|[\s\S]+ shared (?:games|TWIRDLE|today’s (?:games|TWIRDLE))$)/.test(text)) return null;
    const context = nativeLocalizationGameContext(el);
    if (!context) return null;
    if (context.kind === 'rollup') {
      // Display names are supplied by Tweet. Preserve the complete captured
      // name; parse only the generated suffix inside this exact native row.
      let actor;
      if ((actor = /^([\s\S]{1,200}) and (\d+) others? shared (games|TWIRDLE)$/.exec(text))) return `${actor[1]}さんと、ほか${actor[2]}人が${actor[3] === 'games' ? 'ゲーム' : actor[3]}の結果を共有しました`;
      if ((actor = /^(\d+) people shared (games|TWIRDLE)$/.exec(text))) return `${actor[1]}人が${actor[2] === 'games' ? 'ゲーム' : actor[2]}の結果を共有しました`;
      if ((actor = /^([\s\S]{1,200}) and (\d+) others? you follow shared today’s (games|TWIRDLE)$/.exec(text))) return `フォロー中の${actor[1]}さんと、ほか${actor[2]}人が今日の${actor[3] === 'games' ? 'ゲーム' : actor[3]}の結果を共有しました`;
      return null;
    }
    // Truncation is used for leaderboard identities. Never reinterpret names
    // as a static label, even when their text happens to match the dictionary.
    const title = el.matches('h2.truncate') && el.parentElement?.parentElement?.matches('div.sticky') &&
      /^TWIRDLE(?: \d+)?(?: results|の結果)?$/.test(clean(el.textContent));
    if (el.closest('.truncate') && !title || el.closest('dd') || !attr && el.closest('[role="img"],.tw-egg') || el.matches('input,textarea,select,option')) return null;
    if (words.has(text)) return words.get(text);
    let match;
    if ((match = /^Guess the ([1-9]\d?)-letter word in ([1-9]\d?) tries$/.exec(text))) return `${match[2]}回以内に${match[1]}文字の単語を当てましょう`;
    if ((match = /^Hatched in ([1-9]\d?)(!)?$/.exec(text))) return `${match[1]}回で正解${match[2] ? '！' : ''}`;
    if ((match = /^([1-9]\d?) of ([1-9]\d?) guesses$/.exec(text))) return `${match[2]}回中${match[1]}回答済み`;
    if ((match = /^([1-9]\d{0,4})-day streak$/.exec(text))) return `${match[1]}日連続正解`;
    if ((match = /^You hatched (TWIRDLE(?: \d+)?) in ([1-9]\d?)$/.exec(text))) return `${match[1]}に${match[2]}回で正解`;
    if ((match = /^(TWIRDLE(?: \d+)?): not this time$/.exec(text))) return `${match[1]}：今回は残念`;
    if ((match = /^You’re ranked (\d+) (among people you follow|of everyone)\.( Only you can see your rank\.)?$/.exec(text))) return `${match[2] === 'of everyone' ? '全体' : 'フォロー中のユーザー'}で${match[1]}位です。${match[3] ? '順位は自分だけに表示されます。' : ''}`;
    if (/^You hatched it\.(?: Only you can see your rank\.)?$/.test(text)) return `正解しました。${text.endsWith(' Only you can see your rank.') ? '順位は自分だけに表示されます。' : ''}`;
    if ((match = /^Not this time\. The word was ([A-Z]{1,25})\.$/.exec(text))) return `今回は残念。正解は${match[1]}でした。`;
    if ((match = /^(TWIRDLE(?: \d+)?) results$/.exec(text))) return `${match[1]}の結果`;
    if (el.matches('button.tw-key') && text === 'enter') return '回答';
    if (!attr) return null;
    if ((match = /^(TWIRDLE(?: \d+)?) (board|results)$/.exec(text))) return `${match[1]}の${match[2] === 'board' ? '盤面' : '結果'}`;
    if ((match = /^Guess ([1-9]\d?)(, typing)?$/.exec(text))) return `${match[1]}回目の回答${match[2] ? '、入力中' : ''}`;
    if ((match = /^(Play|Continue|View) (TWIRDLE(?: \d+)?)(: (not played yet|in progress, ([1-9]\d?) of ([1-9]\d?) guesses|Hatched in ([1-9]\d?)|not this time))?$/.exec(text))) {
      const action = `${match[2]}を${{ Play: '遊ぶ', Continue: '続ける', View: '見る' }[match[1]]}`;
      return action + (!match[3] ? '' : match[4] === 'not played yet' ? '、未プレイ' : match[5] ? `、${match[6]}回中${match[5]}回答済み` : match[7] ? `、${match[7]}回で正解` : '、今回は残念');
    }
    if ((match = /^Letter ([1-9]\d?), (empty|([A-Z])(?:, (hatched, right spot|cracked, in the word but in another spot|not in the word))?)$/.exec(text))) {
      const state = { 'hatched, right spot': '文字と位置が正解', 'cracked, in the word but in another spot': '文字は正解、位置が違います', 'not in the word': '単語に含まれません' }[match[4]];
      return `${match[1]}文字目、${match[2] === 'empty' ? '空欄' : match[3]}${state ? '、' + state : ''}`;
    }
    if ((match = /^([A-Z]), (hatched|cracked|not in the word)$/.exec(text))) return `${match[1]}、${{ hatched: '文字と位置が正解', cracked: '文字は正解、位置が違います', 'not in the word': '単語に含まれません' }[match[2]]}`;
    return null;
  }

  function patchNativeGamesUI(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const selector = 'button[aria-label],div[role="group"][aria-label],div[role="tablist"][aria-label],section[aria-label],ol[aria-label],.tw-egg[role="img"][aria-label],button[data-testid="games-rollup-row"] > span.truncate[title]';
    const elements = host instanceof Element && host.matches(selector) ? [host] : [];
    host?.querySelectorAll?.(selector).forEach(el => elements.push(el));
    for (const el of elements) {
      for (const attr of ['aria-label', 'title']) {
        const value = el.getAttribute(attr);
        const out = nativeGameJapaneseText(el, value, attr);
        if (out && value !== out) ctRememberLocalization(el, attr, out);
      }
    }
  }

  function isProtectedLocalizationElement(el) {
    if (!el?.isConnected || isOwnedLocalizationElement(el)) return true;
    if (el.closest(
      'textarea,input,select,option,script,style,code,pre,kbd,samp,svg,' +
      '[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,' +
      '[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],' +
      '.tl-user-text,.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]'
    )) return true;
    // Native settings navigation also truncates its static labels. Keep the
    // protection for profile names and account values everywhere else.
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications', '/profile': 'Feed' }[location.pathname.replace(/\/$/, '')] ||
      (/^\/(?:user\/[A-Za-z0-9_.-]+|post\/[A-Za-z0-9_-]{1,160})\/?$/.test(location.pathname) && el?.matches('h2.truncate') && el.closest('.sticky') ? 'Feed' : null);
    const pageTitle = routeTitle && el.matches('h2.truncate') && clean(el.textContent) === routeTitle &&
      el === [...document.querySelectorAll('main h2')].find(heading => {
        for (let parent = heading; parent; parent = parent.parentElement) {
          if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.style.display === 'none') return false;
        }
        return !heading.closest('article');
      }) && !el.closest('article');
    const gameRollup = el.matches('span.truncate') && el.parentElement?.matches('button[data-testid="games-rollup-row"]') && nativeGameJapaneseText(el, clean(el.textContent));
    const gameTitle = el.matches('h2.truncate') && nativeLocalizationGameContext(el) && /^TWIRDLE(?: \d+)?(?: results|の結果)$/.test(clean(el.textContent));
    const unknownDevice = el.matches('span.truncate') && clean(el.textContent) === 'Unknown device' && nativeLocalizationSessionContext(el)?.row;
    return !!el.closest('.truncate') && !unknownDevice && !nativeLocalizationAccountMenu(el) && !nativeLocalizationBlockMenu(el) && !isNativeNotificationTimestamp(el) && !isNativeSettingsNavigation(el) && !isNativeSettingsValue(el) && !pageTitle && !gameTitle && !gameRollup;
  }

  function localizationNotificationRow(el) {
    if (!location.pathname.startsWith('/notifications')) return null;
    const modern = el?.closest('main div.relative.w-full.flex.items-start.gap-3');
    if (modern && ctIsNativeNotificationRow(modern)) return modern;
    const row = el?.closest('button,[role="button"]');
    if (!row?.closest('main') || isOwnedLocalizationElement(row)) return null;
    // Current tweet.app notification rows are border-separated buttons. Do not
    // interpret tab buttons or arbitrary paragraphs as notification content.
    if (row.matches('.items-start.border-b,[data-testid="notification-row"]')) return row;
    // v2.1.0 moved the separator to a wrapper so the native Follow list can
    // expand below its action. Match its 28px leading icon and direct body.
    const icon = row.firstElementChild;
    const body = icon?.nextElementSibling;
    return row.matches('button.w-full.flex.items-start.text-left') &&
      row.parentElement?.matches('div.border-b.border-tl-app-border') &&
      row.parentElement.firstElementChild === row && icon?.matches('div.mt-0\\.5.shrink-0') &&
      icon.querySelector(':scope > svg[width="28"][height="28"]') &&
      body?.matches('div.flex-1.min-w-0') && body.querySelector(':scope > p') ? row : null;
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
    if (!/^(?:(?:liked|favorited|reposted|retweeted|quoted) your (?:post|tweet|reply)|followed you|mentioned you(?: in a (?:post|tweet))?|replied to (?:your (?:post|tweet)|you)|flagged your post for review|awarded you a badge|interacted with you|(?:さん)?が?あなた(?:の(?:ツイート|返信)(?:を(?:お気に入りに登録|リツイート|引用)|に(?:いいね|返信))|を(?:フォロー|@ツイート)|宛てにツイート|に(?:返信|バッジを贈り))しました)$/i.test(text)) return null;
    return { row, paragraph, element: el };
  }

  function nativeLocalizationMediaUpload(el) {
    if (!el || el.closest('[data-ct-local-ui],[id^="ct-"],[data-user-content],blockquote,[aria-label^="Quoted post"]')) return null;
    const upload = el.closest('div.w-full.space-y-3');
    if (!upload || !(upload.classList.contains('mt-3') || upload.classList.contains('mt-2')) ||
        !upload.querySelector('input[type="file"][accept="image/*"][multiple],input[type="file"][accept="image/jpeg,image/png,image/webp,image/gif"][multiple]') ||
        !upload.querySelector('input[type="file"][accept="video/mp4,video/quicktime"]') ||
        !(upload.parentElement?.querySelector('textarea#public-tweet-input,textarea#public-modal-tweet-input') ||
          upload.closest('form[role="form"]')?.querySelector('textarea'))) return null;
    return upload;
  }

  function nativeMediaUploadJapaneseText(el, text) {
    const upload = nativeLocalizationMediaUpload(el);
    if (!upload) return null;
    const error = el?.parentElement;
    // Uploading and transcoding each use separate React text nodes for the
    // label and progress. Change their label only; retain the native counter.
    const progress = el.matches('div.text-white.font-mono.font-bold,div.font-sans') &&
      el.parentElement?.matches('div.absolute.inset-0.flex.flex-col.items-center.justify-center');
    if (progress) return new Map([
      ['Optimizing…', '最適化中…'], ['Uploading…', 'アップロード中…'], ['Processing…', '処理中…'],
      ['Preparing GIF loop…', 'GIFのループ再生を準備中…'],
      ['Transcoding to H.264. This can take a moment.', '動画をH.264に変換中です。しばらくお待ちください。']
    ]).get(clean(text)) || null;
    if (el.matches('span') && el.parentElement?.matches('div.absolute.bottom-2.left-2') &&
        el.parentElement.querySelector(':scope > svg') && clean(text) === 'Ready') return '準備完了';
    if (!error?.matches('div.p-3.border.text-red-500.flex.items-center.gap-2') ||
        !error.classList.contains('bg-red-500/10') || !error.classList.contains('border-red-500/15') ||
        error.children.length !== 2 || !error.firstElementChild.matches('svg.lucide-circle-alert') ||
        !el.matches('span') || error.parentElement !== upload) return null;
    let match;
    if ((match = text.match(/^Maximum of (\d{1,2}) images allowed per post\.$/))) return `写真は1ツイートに${match[1]}枚まで追加できます。`;
    if ((match = text.match(/^Images must be (\d{1,3}) MB or smaller\.$/))) return `写真は1枚${match[1]}MB以下にしてください。`;
    if ((match = text.match(/^GIFs must be (\d{1,3}) MB or smaller\.$/))) return `GIFは${match[1]}MB以下にしてください。`;
    if ((match = text.match(/^Videos must be (\d{1,3}) MB or smaller\.$/))) return `動画は${match[1]}MB以下にしてください。`;
    if ((match = text.match(/^Videos must be (\d{1,4}) seconds or shorter\.$/))) return `動画は${match[1]}秒以内にしてください。`;
    const staticError = new Map([
      ['GIFs cannot be combined with other media assets.', 'GIFと他の写真・動画は同時に投稿できません。'],
      ['Videos cannot be combined with other media assets.', '動画と他の写真・動画は同時に投稿できません。'],
      ['Cannot mix images and videos in the same post.', '写真と動画は同時に投稿できません。'],
      ['Unsupported file type. Please select an image, GIF, or video.', '対応していないファイル形式です。写真、GIF、動画を選択してください。']
    ]).get(text);
    if (staticError) return staticError;
    // The native suffix contains user file names. Keep it byte-for-byte intact.
    if ((match = text.match(/^(\d{1,3}) (?:image was|images were) not added\.(?: ([\s\S]*))?$/))) return `${match[1]}枚の写真を追加できませんでした。${match[2] == null ? '' : ' ' + match[2]}`;
    return null;
  }

  function nativeLocalizationGIFMedia(el) {
    const root = el?.matches('video,button') ? el.parentElement : null;
    if (!root?.matches('div.relative') || root.closest('[data-ct-local-ui],[id^="ct-"],[data-user-content],blockquote,[aria-label^="Quoted post"]')) return null;
    const video = root.querySelector(':scope > video[loop][playsinline]');
    const button = root.querySelector(':scope > button.absolute.bottom-2.right-2');
    const badge = root.querySelector(':scope > span.pointer-events-none[aria-hidden="true"]');
    return video && (video.muted || video.defaultMuted) &&
      /^(?:Animated GIF|GIFアニメーション)$/.test(video.getAttribute('aria-label') || '') &&
      button && /^(?:Play GIF|Pause GIF|GIFを再生|GIFを一時停止)$/.test(button.getAttribute('aria-label') || '') &&
      button.querySelector(':scope > svg[aria-hidden="true"]') && clean(badge?.textContent) === 'GIF' ? root : null;
  }

  function isLocalizationUI(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return false;
    if (nativePinJapaneseText(el, clean(node.nodeValue))) return true;
    if (nativeGameJapaneseText(el, clean(node.nodeValue))) return true;
    if (nativeMediaUploadJapaneseText(el, node.nodeValue)) return true;
    if (nativeLocalizationBlockMenu(el) || nativeLocalizationBlockDialog(el)) return true;
    const blockedProfile = nativeLocalizationBlockProfile(el);
    if (blockedProfile) return el !== blockedProfile.firstElementChild || node === el.firstChild;
    if (isNativeBlockedAccountError(el)) return true;
    if (isNativeNotificationTimestamp(el)) return !el.closest('.truncate') || node === el.lastChild;
    if (localizationNotificationAction(node)) return true;
    if (localizationNotificationRow(el)) return false;
    if (isNativeParentPostTimestamp(el)) return true;
    const parentPreview = nativeLocalizationParentPostPreview(el);
    if (parentPreview && el.matches('p.mt-1.text-tl-app-text-muted') &&
        /^(?:Quoted a post|Poll · [2-5] choices)$/.test(clean(node.nodeValue))) return true;
    if (nativeLocalizationParentPostPreview(el) && el.matches('p.italic.leading-5.text-tl-app-text-muted') &&
        clean(node.nodeValue) === 'This post is no longer available') return true;
    if (isNativeTranslationMetadata(el) && node === el.firstChild &&
        /^(?:Translated|Translated from .{1,80})$/.test(clean(node.nodeValue))) return true;
    if (isNativeLocalizationPollUI(el)) return true;
    if (nativeLocalizationAccountMenu(el)) return node === el.firstChild &&
      /^(?:Report|Mute unavailable|(?:Mute|Unmute) @[A-Za-z0-9_.-]+)$/.test(clean(node.nodeValue));
    if (nativeLocalizationAccountDialog(el) && !el.closest('textarea,input')) return true;
    if (isNativeSettingsValue(el) || isNativeLocalizationHelp(el)) return true;
    if (nativeLocalizationSessionContext(el) && nativeSessionJapaneseText(el, clean(node.nodeValue))) return true;
    if (isNativeTweetCount(el)) return true;
    const text = clean(node.nodeValue);
    if (text === 'Games') {
      const navigation = el.closest('nav button,[role="navigation"] button');
      return !!navigation?.querySelector(':scope > svg') && !navigation.querySelector('img');
    }
    const link = el.closest('a[href]');
    if (link) {
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch { return false; }
      if (url.origin !== location.origin || !/^\/(?:feed|explore|notifications|settings|profile|compose|bookmarks|games)\/?$/.test(url.pathname)) return false;
      return !link.querySelector('img') && !!el.closest('nav,[role="navigation"],header,aside');
    }
    // A reply target is UI, but its handle must remain byte-for-byte unchanged.
    if (/^Replying to$/i.test(text) && el.matches('p,button') &&
        [...el.children].some(child => /^@[A-Za-z0-9_.-]+$/.test(clean(child.textContent)))) return true;
    const control = el.closest('button,[role="button"],[role="tab"],[role="menuitem"],summary');
    if (control) {
      if (control.querySelector('img') || /@[A-Za-z0-9_.-]/.test(clean(control.textContent))) return false;
      if (text === 'Translating' && el === control && control.matches('button.text-tl-app-text-muted[aria-busy="true"]') &&
          control.parentElement?.matches('p.text-tl-app-text-muted[aria-live="polite"]') &&
          control.parentElement.parentElement?.matches('div.mt-0\\.5') && control.closest('article')) return true;
      // User cards are buttons too. Paragraphs and styled names inside those
      // buttons are data, not labels. Real notification actions are handled above.
      const paragraph = el.closest('p');
      if ((paragraph && control.contains(paragraph)) || control.querySelector('p')) return false;
      if (el.closest('article') && !/^(?:Like|Likes|Liked|Unlike|Favorite|Favorites|Favorited|Unfavorite|お気に入り|お気に入り済み|お気に入りを解除|いいね|いいね済み|いいねを取り消す|Reply|Replies|Repost|Reposts|Retweet|Retweets|Quote|Quote Tweet|Quote Retweet|Undo repost|Undo retweet|Translate|Translated|Show translation|Show original|Show more|Show less|Share|Copy link|Edit|Edit post|Delete|Report|Mute user|Unmute|Follow|Unfollow)$/i.test(text)) return false;
      return true;
    }
    if (isNativeLocalizationTimestamp(el) || isNativeReplyTimestamp(el) || isNativeEditedIndicator(el)) return true;
    if (el.closest('[role="status"],[role="alert"]')) return true;
    if (el.closest('article')) return false;
    if (el.closest('label,legend')) return true;
    const inSettings = /^\/settings\/?$/.test(location.pathname);
    const heading = el.closest('h1,h2,h3') || (inSettings && el.closest('main section h4.font-extrabold')) ||
      (inSettings && el.matches('main section h4.font-bold') && /^(?:Friends who joined|参加した友だち)$/.test(text) && el);
    if (heading) {
      // Profile headings contain display names; all other static headings are
      // still restricted to exact dictionary entries by translateTextNode.
      if (/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname) && heading.tagName !== 'H1' &&
          !(heading.matches('aside h3.font-semibold.text-tl-app-text.shrink-0') &&
            heading.parentElement?.matches('div.bg-tl-app-card.border.border-tl-app-border') &&
            /^(?:Who to follow|Trends for you|おすすめユーザー|おすすめのトレンド)$/.test(text)) &&
          !(/^\/(?:profile|user\/[A-Za-z0-9_.-]+)\/?$/.test(location.pathname) && heading.matches('h2.truncate') &&
            heading.closest('.sticky') && /^(?:Feed|プロフィール)$/.test(text)) &&
          !(heading.matches('h3.text-xs.font-bold.uppercase.tracking-wider') &&
            /^(?:Compose New(?: Tweet)?|Edit post)$/.test(text) &&
            heading.closest('div.bg-tl-app-card.border.rounded-3xl.max-w-lg')?.querySelector('textarea#public-modal-tweet-input'))) return false;
      return !heading.querySelector('img');
    }
    // Settings descriptions are static text, but account values in dd/input and
    // profile data are deliberately excluded. Never allow an entire route.
    if (inSettings && el.matches('main section span.uppercase.tracking-wide')) return true;
    if (inSettings && el.matches('p,dt')) {
      if (el.closest('dl') && el.tagName !== 'DT') return false;
      if (el.classList.contains('leading-relaxed')) {
        const title = el.previousElementSibling;
        if (!el.closest('main section')) return false;
        const label = title?.matches('h4.font-extrabold,span.uppercase.tracking-wide') ? title :
          title?.matches('div') && el.matches('.px-4.py-3.text-tl-app-text-muted') ?
            title.querySelector('span.uppercase.tracking-wide') : null;
        return !!label && (JP.has(clean(label.textContent)) || [...JP.values()].includes(clean(label.textContent)));
      }
      return !el.closest('a');
    }
    // Native loading text is paired with a spinner; ordinary adjacent text is not UI.
    if (el.matches('span.text-xs.font-semibold') && el.parentElement?.matches('div.flex.items-center.justify-center') &&
        el.parentElement.querySelector('svg.animate-spin') && /^Loading(?:[ .]|$)/.test(text)) return true;
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
    text = ctLocalizationClassicText(text);
    if (clean(raw) === text) return;
    ctRememberLocalization(node, null, raw.replace(/\S[\s\S]*\S|\S/, () => text));
  }

  function patchNativePollAndAccountUI(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const candidates = [];
    if (host instanceof Element) candidates.push(host);
    host?.querySelectorAll?.('fieldset,ul[aria-label],span.truncate,[role="dialog"]').forEach(el => candidates.push(el));
    for (const el of candidates) {
      if (isOwnedLocalizationElement(el) || el.closest('[translate="no"],.notranslate,[data-user-content],.tl-user-text')) continue;
      const poll = nativeLocalizationPoll(el);
      if (el.matches('fieldset') && poll?.compose && poll.root === el) {
        const durations = new Map([['1', '1時間'], ['24', '1日'], ['72', '3日'], ['168', '7日']]);
        for (const option of el.querySelectorAll('select option')) {
          const out = durations.get(option.value);
          // Preserve both option nodes and values, including the selection.
          if (out && /^(?:1 hour|1 day|3 days|7 days|1時間|1日|3日|7日)$/.test(clean(option.textContent))) {
            for (const node of localizationScopeNodes(option)) replaceLocalizationText(node, out);
          }
        }
      }
      if (el.matches('ul[aria-label="Poll results"]') && poll) el.setAttribute('aria-label', '投票結果');
      if (nativeLocalizationAccountMenu(el)) {
        const title = el.getAttribute('title');
        const match = title?.match(/^(Report|Mute|Unmute) (@[A-Za-z0-9_.-]+)$/);
        if (match) el.setAttribute('title', match[1] === 'Report' ? `${match[2]}を報告` : match[1] === 'Mute' ? `${match[2]}をミュート` : `${match[2]}のミュートを解除`);
      }
      if (el.matches('[role="dialog"]') && nativeLocalizationAccountDialog(el)) {
        const match = el.getAttribute('aria-label')?.match(/^Report (@[A-Za-z0-9_.-]+)$/);
        if (match) el.setAttribute('aria-label', `${match[1]}を報告`);
      }
    }
  }

  function nativePollJapaneseText(el, text) {
    if (!isNativeLocalizationPollUI(el)) return null;
    const footer = text.match(/^(?:(\d+) votes? · )?(Final results|Closing…|\d+ (?:min|h|d) left)$/);
    if (footer) {
      const remaining = footer[2].match(/^(\d+) (min|h|d) left$/);
      const units = { min: '分', h: '時間', d: '日' };
      const end = remaining ? `残り${remaining[1]}${units[remaining[2]]}` : JP.get(footer[2]);
      return footer[1] ? `${footer[1]}票 · ${end}` : end;
    }
    if (nativeLocalizationPoll(el)?.compose && el.matches('label.sr-only')) {
      return text === 'Choice' ? '選択肢' : /^Choice (\d+)$/.test(text) ? `選択肢 ${text.match(/\d+$/)[0]}` : null;
    }
    return JP.get(text);
  }

  function patchUIAttributes(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const controls = [];
    const selector = 'button,[role="tab"],[role="menuitem"],input,textarea,video[aria-label],[role="dialog"][aria-modal="true"][aria-label="Media viewer"],div[aria-label="Choose image"],a[aria-label^="Open the post by @"],img[alt="Media in the post this replies to"],section[aria-label="Pinned posts"]';
    if (host instanceof Element && host.matches(selector)) controls.push(host);
    host?.querySelectorAll?.(selector).forEach(el => controls.push(el));
    // Tweet 2.2.3 owns these photo controls. Match their actual structure so an
    // image caption, quoted post or unrelated image button cannot become UI.
    const nativePhotoUI = el => {
      if (el.closest('[data-ct-local-ui],[id^="ct-"],[data-user-content],blockquote,[aria-label^="Quoted post"]')) return null;
      const dialog = el.closest('[role="dialog"][aria-modal="true"]');
      if (dialog && /^(?:Media viewer|写真・動画ビューア)$/.test(dialog.getAttribute('aria-label') || '') &&
          dialog.matches('div.fixed.inset-0.flex.flex-col') &&
          dialog.querySelector(':scope > div > button > svg.lucide-x') &&
          dialog.querySelector(':scope > div.flex-1.min-h-0 > img.object-contain[draggable="false"]')) {
        if (el === dialog || el.matches('button') && (el.querySelector(':scope > svg.lucide-x,:scope > svg.lucide-chevron-left,:scope > svg.lucide-chevron-right'))) return { count: 0 };
      }
      const gallery = el.closest('div.relative.overflow-hidden.rounded-2xl.border.bg-black');
      const track = gallery?.querySelector(':scope > div.snap-x.snap-mandatory.overflow-x-auto');
      if (!track || !gallery.closest('article')) return null;
      const photos = [...track.children];
      if (photos.length < 2 || photos.length > 5 || !photos.every(button => button.matches('button.w-full.min-w-full.shrink-0.snap-start') &&
          button.children.length === 1 && button.firstElementChild.matches('img.h-full.w-full.object-cover'))) return null;
      if (el.parentElement === track) return { count: photos.length, index: photos.indexOf(el) + 1, open: true };
      if (el.parentElement === gallery && el.matches('button') && el.querySelector(':scope > svg.lucide-chevron-left,:scope > svg.lucide-chevron-right')) return { count: photos.length };
      const dots = [...gallery.children].find(child => /^(?:Choose image|画像を選択)$/.test(child.getAttribute('aria-label') || '') &&
        child.children.length === photos.length && [...child.children].every(button => button.matches('button[aria-current]')));
      if (el === dots) return { count: photos.length };
      return el.parentElement === dots ? { count: photos.length, index: [...dots.children].indexOf(el) + 1, show: true } : null;
    };
    for (const el of controls) {
      const photo = nativePhotoUI(el);
      const pin = nativeLocalizationPinContext(el);
      if (!photo && isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]') ||
          el.closest('.tl-user-text,.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"],.truncate') || !photo && !pin && el.querySelector('img')) continue;
      if (!el.hasAttribute('aria-label') && el.matches('button.absolute.top-4.right-4') &&
          el.querySelector(':scope > svg.lucide-x') &&
          el.parentElement?.matches('div.bg-tl-app-card.border.rounded-3xl.max-w-lg') &&
          el.parentElement.querySelector('textarea#public-modal-tweet-input')) el.setAttribute('aria-label', '閉じる');
      for (const attr of ['aria-label', 'title', ...(el.matches('img') && nativeLocalizationParentPostPreview(el) ? ['alt'] : [])]) {
        const value = el.getAttribute(attr);
        const parent = attr === 'aria-label' && isNativeParentPostTimestamp(el) &&
          value?.match(/^Open the post by (@[A-Za-z0-9_.-]+) that this replies to$/);
        const session = attr === 'aria-label' && nativeLocalizationSessionContext(el)?.row &&
          value?.match(/^Sign out (.{1,160})$/);
        const gif = nativeLocalizationGIFMedia(el) && new Map([
          ['Animated GIF', 'GIFアニメーション'], ['Play GIF', 'GIFを再生'], ['Pause GIF', 'GIFを一時停止']
        ]).get(value);
        const unblock = el.matches('button') && value?.match(/^(Unblock|Unblocking) (@[A-Za-z0-9_.-]+)$/) &&
          (el.classList.contains('bg-red-500') || /^\/settings\/?$/.test(location.pathname) && el.closest('main section'));
        const unblockLabel = unblock && value.match(/^(Unblock|Unblocking) (@[A-Za-z0-9_.-]+)$/);
        const action = el.matches('[data-testid="tweet-open-comment-action"],[data-testid="tweet-comment-action"]') &&
          value?.match(/^Comment, (\d+) comments?$/);
        const repost = el.matches('[data-testid="tweet-repost-action"]') &&
          value?.match(/^Retweet, (\d+) retweets?$/);
        const likers = el.matches('[data-testid="tweet-like-action-count"]') &&
          value?.match(/^View (\d+) likes?$/);
        const choice = nativeLocalizationPoll(el)?.compose && value?.match(/^Remove choice (\d+)$/);
        const image = photo && value?.match(/^(Open|Show) image ([1-5]) of ([2-5])$/);
        const imageLabel = image && Number(image[2]) === photo.index && Number(image[3]) === photo.count &&
          (image[1] === 'Open' ? photo.open : photo.show) ? `${image[3]}枚中${image[2]}枚目の画像を${image[1] === 'Open' ? '開く' : '表示'}` : null;
        const out = nativePinJapaneseText(el, value, attr) || (parent ? `${parent[1]}への返信元のツイートを開く` : null) ||
          (session ? `${session[1]}からログアウト` : null) || gif || (unblockLabel ? unblockLabel[1] === 'Unblocking' ? `${unblockLabel[2]}のブロックを解除中…` : `${unblockLabel[2]}のブロックを解除` : null) || imageLabel || (value === 'Reply options' ? isNativeReplyOptionsButton(el) ? '返信のメニュー' : null :
          choice ? `選択肢 ${choice[1]}を削除` : action ? `返信、${action[1]}件の返信` :
          repost ? `リツイート、${repost[1]}件のリツイート` :
          likers ? `${likers[1]}件のお気に入りを表示` : JP.get(value));
        if (out && value !== out) ctRememberLocalization(el, attr, out);
      }
    }
  }

  function translateTextNode(node) {
    if (!isLocalizationUI(node)) return;
    const text = clean(node.nodeValue);
    if (!text || text.length > 500) return;
    // Dynamic replacements belong to their specific UI contexts. In particular,
    // never parse actor names or dates from arbitrary text that resembles a UI.
    const el = node.parentElement;
    const timestamp = nativeTimestampJapaneseText(el, text);
    const sourceLanguage = isNativeTranslationMetadata(el) && node === el.firstChild && text.match(/^Translated from (.{1,80})$/);
    const remaining = isNativeSettingsValue(el) && text.match(/^(\d+) codes? remaining$/);
    const accountAction = nativeLocalizationAccountMenu(el) && text.match(/^(Mute|Unmute) (@[A-Za-z0-9_.-]+)$/);
    const parentPoll = nativeLocalizationParentPostPreview(el) && el.matches('p.mt-1.text-tl-app-text-muted') && text.match(/^Poll · ([2-5]) choices$/);
    let out = nativePinJapaneseText(el, text) || nativeGameJapaneseText(el, text) || nativeSessionJapaneseText(el, text) || (parentPoll ? `投票 · ${parentPoll[1]}個の選択肢` : null) || nativeMediaUploadJapaneseText(el, node.nodeValue) || nativeBlockJapaneseText(el, text) || nativePollJapaneseText(el, text) || (accountAction ? accountAction[1] === 'Mute' ? `${accountAction[2]}をミュート` : `${accountAction[2]}のミュートを解除` : null) || timestamp ||
      (sourceLanguage ? `${JP.get(sourceLanguage[1]) || sourceLanguage[1]}から翻訳` : null) ||
      (remaining ? `${remaining[1]}個のコードが残っています` :
      isNativeEditedIndicator(el) ? '編集済み' :
      isNativeTweetCount(el) && /^([\d,.]+[KMB]?) tweets?$/i.test(text) ? `${text.match(/^([\d,.]+[KMB]?)/)[1]}件のツイート` :
      isNativeTweetCount(el) && /^Tweets?$/i.test(text) ? 'ツイート' :
      /^\/(?:profile|user\/[A-Za-z0-9_.-]+)\/?$/.test(location.pathname) && el.matches('h2.truncate') &&
        el.closest('.sticky') && text === 'Feed' ? 'プロフィール' :
      /^\/post\/[A-Za-z0-9_-]{1,160}\/?$/.test(location.pathname) && el.matches('h2.truncate') &&
        el.closest('.sticky') && text === 'Feed' ? 'ツイート' : JP.get(text) ||
        (ctLocalizationClassicText(text) !== text ? ctLocalizationClassicText(text) : null));
    // The native help list splits this sentence around a React-owned counter.
    // Keep its text nodes and the counter so later updates still work.
    if (isNativeLocalizationHelp(el) && el.matches('li')) {
      if (text === 'Get') out = '友だちが';
      if (text === 'friends → get a Wing badge!') out = '人参加すると、Wingバッジを獲得できます！';
    }
    if (out && out !== text) replaceLocalizationText(node, out);
  }

  function patchUI(root = document) {
    ctSyncLocalizationAppearance(root);
    patchNativePollAndAccountUI(root);
    patchNativeGamesUI(root);
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
      const tail = before.slice(before.lastIndexOf(actorElements[actorElements.length - 1]) + 1);
      const directText = before.filter(node => node.nodeType === Node.TEXT_NODE);
      for (const node of directText) {
        const text = clean(node.nodeValue);
        if (!text && node.nodeValue) node.nodeValue = '';
        else if (/^and$/i.test(text)) node.nodeValue = 'さんと';
        else if (text === ',') node.nodeValue = 'さん、';
        else {
          const together = text.match(/^and\s+(\d+)\s+others?$/i);
          if (together) replaceLocalizationText(node, `さんとそのほか${together[1]}人`);
          else if (tail.includes(node) && /^さんと\d+$/.test(text)) {
            replaceLocalizationText(node, text.replace(/^さんと(\d+)$/, 'さんとそのほか$1人'));
          }
        }
      }
      for (let i = 0; i < tail.length; i++) {
        const node = tail[i];
        if (node.nodeType !== Node.TEXT_NODE || !/^\d+$/.test(clean(node.nodeValue))) continue;
        const next = tail.slice(i + 1).find(sibling => clean(sibling.textContent));
        const previous = tail.slice(0, i).reverse().find(sibling => clean(sibling.textContent));
        const otherWord = next?.nodeType === Node.TEXT_NODE && /^others?$/i.test(clean(next.nodeValue));
        // React may update only the numeric text node after our previous pass.
        // Its unchanged "others" sibling then remains empty; the scoped native
        // connector still identifies this as the grouped-actor count.
        const translatedGroup = previous?.nodeType === Node.TEXT_NODE && /^さんと$/.test(clean(previous.nodeValue));
        if (otherWord || translatedGroup) {
          replaceLocalizationText(node, `そのほか${clean(node.nodeValue)}人`);
          if (otherWord) next.nodeValue = '';
        }
      }
      const actionText = clean(action.nodeValue).replace(/^(?:さん)?が?(?=あなた)/, '');
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
    ctSyncLocalizationAppearance(root);
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
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]')) continue;
      const value = el.getAttribute('placeholder');
      const composerPrompt = el.matches('textarea#public-tweet-input,textarea#public-modal-tweet-input') &&
        (/^What['’]s happening(?:, [\s\S]+)?[?!]+$/.test(value || '') ||
          /^(?:[\s\S]+、)?いまどうしてる？$/.test(value || ''));
      const choice = nativeLocalizationPoll(el)?.compose && value?.match(/^Choice (\d+)$/);
      const out = choice ? `選択肢 ${choice[1]}` : composerPrompt ? 'いまどうしてる？' : placeholders.get(value) || JP.get(value);
      if (out && out !== value) ctRememberLocalization(el, 'placeholder', out);
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


  function loadFavorites() { return ctProfileLoadFavorites(); }

  function saveFavorite(item, uid) { return ctProfileSaveFavorite(item, uid); }

  function removeFavorite(id, uid) { return ctProfileRemoveFavorite(id, uid); }

  let favoritesActive =
    false;









  function localCard(item) {
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





  function notificationLeaves(root = document) {
    return [...new Set(notificationTextNodes(root).map(node => node.parentElement))];
  }

  function patchNotifications(root = document) {
    ctSyncLocalizationAppearance(root);
    if (!location.pathname.startsWith('/notifications')) return;
    for (const node of notificationTextNodes(root)) {
      const context = localizationNotificationAction(node);
      translateTextNode(node);
      if (ctLocalizationClassicEnabled() && /お気に入りに登録しました/.test(clean(node.nodeValue))) {
        context.row.querySelector('svg')?.parentElement?.classList.add('ct-notification-fav-icon');
      }
    }
    patchNotificationGrammar(root);
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
    ctTimestampPatchExactPostTime(root);
  }


  function patchProfileJoinedDate(root = document) {
    if (!/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname)) return;
    const metadata = new Set();
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (isProtectedLocalizationElement(el) || el.closest('article')) continue;
      // The profile metadata uses a calendar icon. Location/bio/name strings
      // resembling "Joined ..." must never be interpreted as metadata.
      if (el.matches('span.inline-flex') && el.querySelector(':scope > svg.lucide-calendar') &&
          [...el.children].every(child => child.matches('svg.lucide-calendar'))) metadata.add(el);
    }
    for (const el of metadata) {
      // React renders Joined, a spacer and the localized month as separate
      // nodes. Keep every node and the calendar icon for subsequent renders.
      const nodes = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
      const text = clean(nodes.map(node => node.nodeValue).join(''))
        .replace(/^(?:Joined|登録日\s*[:：]|参加した人数)\s*/i, '')
        .replace(/から(?:Tweet|Twitter)を利用しています$/, '');
      const english = text.match(/^([A-Za-z]+\.?)\s+(\d{4})$/);
      const japanese = text.match(/^(\d{4})年\s*(\d{1,2})月$/);
      const numeric = text.match(/^(\d{4})[/-](\d{1,2})$/) || text.match(/^(\d{1,2})[/.](\d{4})$/);
      const year = english ? Number(english[2]) : japanese ? Number(japanese[1]) :
        numeric ? Number(numeric[1].length === 4 ? numeric[1] : numeric[2]) : 0;
      const month = english ? nativeLocalizationMonthNumber(english[1]) : japanese ? Number(japanese[2]) :
        numeric ? Number(numeric[1].length === 4 ? numeric[2] : numeric[1]) : 0;
      if (year < 1000 || month < 1 || month > 12) continue;
      const output = `${year}年${month}月からTweetを利用しています`;
      const last = nodes[nodes.length - 1];
      for (const node of nodes) ctRememberLocalization(node, null, node === last ? output : '');
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
      const classicEnabled = classicAppearanceEnabled();
      patchClassicAppearance(root, classicEnabled);
      patchClassicMotion(root, classicEnabled);

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
      ctReplyTimesEnhance(root);
      patchExactPostTime(root);
      patchInviteJoinedLabels(root);
      patchProfileJoinedDate(root);

      patchProfileFounder();

      patchFavoriteProfileTab();



    patchNavigation(root);
    ctPatchNotificationFilters();
    patchOfficialBadges(root);
    ctMediaEnhance(root);
    patchJapaneseNews(root);
    ctLinkPreviewsPatch(root);

    } catch(error) {
      console.debug(
        '[Classic Twitter JP]',
        error
      );
    }
  }

  ctPrepareFavoritePresentation();

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
    '🐦 Classic Twitter JP v6.26.0 loaded'
  );
})();
