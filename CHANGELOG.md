# Changelog

Classic Twitter for tweet.app の更新履歴です。

## Japanese Chrome / Stay v6.4.2

- Settings の Founding plan / Centurion / 2要素認証説明を追加日本語化
- ハッシュタグ・ミュートの空状態と Loading 表示を改善
- 認証済みアカウント通知の空状態を日本語化
- quoted / posted / reposted / repost removed など投稿・通知文言を追加対応
- 「さんがあなたを@ツイートしました」の不自然な通知文を「さんがあなた宛てにツイートしました」に修正

## Japanese Chrome / Stay v6.4.1

- 招待画面の残っていた英語を追加日本語化
- Share invite / Link opens / Signed up / Joined / Friends who joined に対応
- Wingバッジ獲得条件と「How it works」説明文を日本語化
- 招待リンク共有の説明文を日本語化

## Japanese Chrome / Stay v6.4.0

- tweet.app の新しい招待機能を日本語化
- `Invite friends` を「友だちを招待しよう！」に変更
- 招待リンクの共有・検証・エラー表示を日本語化
- 投稿編集（30分編集UI）、フォロー中ハッシュタグ、ミュート管理、通報UIの新文言に対応
- 翻訳・プロフィール周辺の追加文言に対応
- Team Member / Tweet Ambassador は公式Role badge名として英語表記を維持
- Chrome版とStay / Safari版の翻訳内容を同期

## Japanese notification grammar fix

- 通知欄の分割DOMで抜けていた「さん」「と」「が」を補完
- `A と そのほか5人 あなたのツイートを…` を `Aさんとそのほか5人があなたのツイートを…` の形に修正
- 2人表示でも `AさんとBさんが…` になるよう調整
- 単独通知でも `Aさんがあなたのツイートを…` になるよう補完

## Founder Number authentication fix

- tweet.app の `/api/users/by-username/` が認証必須になった変更に対応
- Chrome 日本語版 / Stay・Safari 日本語版 / 英語版で Bearer token 付きプロフィール取得へ変更
- Founder Number と表示名の取得復旧を目的とした互換性修正
- 3版共通のプロフィール取得処理を更新

## Japanese Safari v6.2.5

- Safari + Stay 専用ビルドとして分離
- 画面上部の `ツイート` を `Twitter` に変更
- 投稿本文や通常の日本語表記には影響しないように調整
- iPhone / iPad向けにローカルパネルの横幅を調整
- Chrome版 v6.2.4 の機能を引き継ぎ

## Japanese Chrome v6.2.4

- Chrome + Tampermonkey 用ビルド
- `Just now` を `たった今` に変更
- プロフィールのミュート表示が重複する問題を修正
- ミュート表示を `ミュート / ミュート解除` に統一
- `and` / `others` が分割DOMになっている通知にも対応
- テーマ設定には干渉しない仕様を維持

## Japanese v6.2.3

- 通知の `and` / `2 others` などの表示を改善
- DOMが分割されている通知への対応を強化
- 表示名 + Founder Number の処理を改善

## Japanese v6.2.2

- 通知欄の英語断片の日本語化を改善

## Japanese v6.2.1

- ブランドロゴ判定を安全化
- アバターや投稿画像が青い鳥に置き換わる問題を修正
- 独自のダークモード / テーマ固定処理を削除

## English v6.2.3-en

- Classic Twitter terminology
- Post → Tweet
- Repost → Retweet
- Like → Favorite
- ★ Favorites
- Display names + Founder Number
- Local mute
- Reply notification fallback
- Does not modify tweet.app theme settings
