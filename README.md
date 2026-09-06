# 🐦 Classic Twitter for tweet.app

`tweet.app` を、昔のTwitterらしい見た目・言葉・使い方に近づけるユーザースクリプトです。

日本語版 🇯🇵 と English version 🌎 を用意しています。

> 非公式プロジェクトです。Twitter / X / tweet.app とは関係ありません。

## ✨ できること

- 👤 タイムラインをユーザーIDではなく表示名に
- #️⃣ Founder Number を表示
- ⭐ ハートを昔のTwitter風の「お気に入り」に
- 🔁 Repost を Retweet / リツイート表記に
- 🔔 通知表示をわかりやすく調整
- ↩️ 表示されない返信通知を補完
- 🔇 ローカルミュート
- ⭐ 自分専用の Favorites / お気に入り一覧
- 🇯🇵 日本語版では tweet.app の英語UIを日本語化
- 🌎 English version では Classic Twitter の英語表記に変更
- 🎨 tweet.app のテーマ設定には干渉しません

## 💻 パソコンで使う

### Chrome + Tampermonkey

使うファイル: `classic-twitter-ja.user.js`

日本語版バージョン: **v6.2.4**

1. Chrome に **Tampermonkey** を入れます。
2. Greasy Fork のインストールページを開きます。
3. **「このスクリプトをインストール」** を押します。
4. Tampermonkey の画面で **「インストール」** を押します。
5. `tweet.app` を開きます。

**おわり！ 🎉**

> Greasy Fork の公開リンクは準備中です。

## 📱 iPhone / iPadで使う

### Safari + Stay

使うファイル: `classic-twitter-ja-safari.user.js`

日本語版バージョン: **v6.2.5**

1. App Store から **Stay for Safari** を入れます。
2. iPhone / iPad の **設定 → Safari → 拡張機能** で Stay をONにします。
3. Stay に Safari版ユーザースクリプトを追加します。
4. Safari で `tweet.app` を開きます。

**おわり！ 📱🐦**

> Safari版だけ、画面上部の「ツイート」を「Twitter」に変更します。本文・返信・投稿操作の日本語表記はそのままです。

## 🇯🇵 日本語版

### Chrome + Tampermonkey

**v6.2.4**

- `Just now` → `たった今`
- プロフィールのミュート表示を `ミュート / ミュート解除` に整理
- `and` / `others` を含む通知の日本語表示を改善
- 表示名 + Founder Number
- ★ お気に入り
- リツイート表記

### Safari + Stay

**v6.2.5**

v6.2.4の機能に加えて:

- 画面上部の `ツイート` → `Twitter`
- iPhone / iPad向けにローカルパネルの横幅を調整

## 🌎 English version

現在の公開準備版: **v6.2.3-en**

Classic Twitter-style wording:

- Post → Tweet
- Repost → Retweet
- Like → Favorite
- Likes → Favorites
- ★ Favorite button
- Display names + Founder Number
- Local mute
- Reply notification fallback

## 🔒 安全について

このスクリプトは、機能のために `tweet.app` と `api.tweet.app` を利用します。

- パスワードを取得する機能はありません。
- あなたのログイン情報を作者のサーバーへ送る処理はありません。
- ミュート一覧やローカルお気に入りは、基本的にそのブラウザ内へ保存されます。

コードはこのGitHubですべて公開します。

## 🐛 バグを見つけたら

GitHub の **Issues** から教えてください。

できれば次の3つがあると直しやすいです。

1. 日本語版 / English version のどちらか
2. Chrome + Tampermonkey / Safari + Stay のどちらか
3. 何が起きたかのスクリーンショット

## 📦 ファイル

- `classic-twitter-ja.user.js` 日本語版 / Chrome + Tampermonkey / v6.2.4
- `classic-twitter-ja-safari.user.js` 日本語版 / Safari + Stay / v6.2.5
- `classic-twitter-en.user.js` English version / v6.2.3-en
- `CHANGELOG.md` 更新履歴
- `LICENSE` MIT License

## 📜 License

MIT License
