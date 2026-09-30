# Changelog

Classic Twitter for tweet.app の更新履歴です。

## All distributions v6.8.1 — 2026-09-30

- タブを離れた間に破棄された端末内翻訳を、復帰後に再開。処理の直列実行・結果キャッシュ・手動の原文表示を保持。
- 日本ニュースのキャッシュ期限に更新するタイマーを追加。表示中の日本ニュースだけを更新し、背景・画面離脱・世界選択時に停止。
- 公式クライアントとメディア設定を再取得。6.8.0の写真・通知・バッジ・日本語化との互換性を確認。

## All distributions v6.8.0 — 2026-09-27

- 複数写真の同時選択を既存の添付処理へ順番に渡す仕組みと、投稿写真の横スライド表示を追加。
- 日本語投稿欄を名前なしの「いまどうしてる？」へ変更。
- サイト自動翻訳を逐次処理・重複抑制・エラー時待機へ変更。対応PC向けに明示的なモデル準備を伴う端末内翻訳を追加。
- 日本／世界ニュースを切り替え。公開RSSの記事画像を表示し、取得失敗時は元ニュースを維持。
- 3版共通の生成・構文検査と241件の自動テストが成功。サーバーの投稿制限や翻訳制限の解除、4K HDR維持は未対応。実サイトDOMで本文・下書き保持と投稿欄を確認。日本ニュースRSS4カテゴリ40記事の画像URLを確認。実Tampermonkey／Safari＋Stayと実アップロードは未検証。

## All distributions v6.7.3 — 2026-09-27

- 6.7.2で通知欄以外に残っていたアイコン上の「＋」を修正。プロフィールボタン内の画像／プレースホルダーを認識し、通常のFollowとプロフィール移動は保持。
- 日本語化で設定の操作説明や状態まで翻訳対象外になっていた問題を修正。確認済みのUI構造に限定して翻訳を復元し、アカウント値・名前・投稿・下書きを保持。
- 実際の入れ子構造、後から追加されるアイコン、Reactでの再描画を回帰テストに追加し、3配布版の起動時にも確認。自動テスト177件成功。

## All distributions v6.7.2 — 2026-09-27

- アイコン上の小さなフォロー操作だけを非表示にし、通常のフォロー操作を維持。
- 通知の各アバターに、その人物のプロフィールリンクを追加。通知行全体への誤ったクリック伝播を防止。
- 返信通知の本人取得APIと返信一覧のデータ構造を現行仕様に修正。初回起動時から確認し、通知欄に常設の開閉式履歴を表示。
- 返信履歴をアカウント別に保存。過去の返信は既読、新着は未読とし、再確認・すべて既読・別タブの既読状態保持に対応。
- 公式96pxバッジを利用し、表示サイズを維持。スマホのアカウントメニューと返信の作者名に追加。
- 通知人数が変化した際の日本語の崩れと、アカウント切替直後の返信履歴残留を修正。
- Chrome日本語版・Safari日本語版・英語版を共通の修正から生成。自動テスト166件成功。

## All distributions v6.7.1 — 2026-09-27

- 便利ツールのフォーカス順、入力エラー案内、固定ヘッダーと保存結果表示を改善。
- ネイティブダイアログとの重なり順、44px操作領域、テーマ色、短い表示モーションとReduced Motion対応を追加。
- VisualViewportに基づくキーボード表示時の位置補正を追加。ページのズームや本体の配置は変更しない。
- 別タブの更新・データ削除を検知し、古い保存内容による上書きを防止。
- Founder Numberの古い応答・プロフィール切り替え後の表示残留を修正。
- Safariメディア情報を即時表示し、連続長押し・閉じた後の遅延応答を処理。閉じる際の元の操作位置を維持。
- 回帰テスト98件成功。実サイトの本文20件の保持、キーボード操作、合成画面の幅320pxとテーマを確認。実Tampermonkey／Safari＋Stayの受け入れは引き続き未検証。

## All distributions v6.7.0 — 2026-09-27

- UIに限定した翻訳で投稿・名前・自己紹介・通知プレビュー・入力値を保護。
- 通知の助詞処理を通知単位に限定。設定メニュー・時刻・空状態を明示的なUI構造で翻訳。
- 自動翻訳を明示的なオプトインに変更。手動翻訳・原文表示を維持。
- MutationObserverの自己再実行と定期的な全画面走査を修正。
- Chrome / Stay / English のAPI読み取り処理を共通化し、タイムアウトと失敗時バックオフを追加。
- お気に入り状態を現行DOMに対応。引用リンクを親投稿として保存しないよう修正。
- 保存検索、任意のキーワード折りたたみ、投稿詳細URLのローカル保存を追加。
- 日本語Chrome/Safariを同じ元から生成し、Safariメディア情報機能を保持。
- 生成・回帰テストとAPI調査、検証範囲を追加。

## Japanese Chrome / Stay v6.5.1

- 自動翻訳設定がホーム更新時にも表示される問題を修正
- 「ツイートを自動翻訳」は設定画面の「友だちを招待しよう！」内だけに表示
- 招待項目の下に「拡張機能設定」セクションを追加し、自動翻訳オン/オフを配置
- 招待設定画面以外へ移動した場合は拡張機能設定UIを自動的に削除

## Japanese Chrome / Stay v6.5.0

- Backup codes / Generate new codes / 残りコード数を日本語化
- プロフィールの Joined 表示を「年月からTwitterを利用しています」に戻し、招待統計の Joined と分離
- 各ツイートの相対時刻の横に、小さく24時間表記の時刻（HH:mm）を追加
- 設定画面に「ツイートを自動翻訳」オン/オフを追加
- 自動翻訳設定は localStorage に保存し、オフ時は手動の翻訳ボタンを利用可能

## Japanese Chrome / Stay v6.4.3

- Wingバッジ獲得通知を日本語化
- badge awarded 通知を日本語化
- 最新bundleで確認した Loading account / followed hashtags / muted accounts を日本語化
- notifications / profile / posts / followers / following などのLoading表示も追加対応
- Load more を「さらに読み込む」に統一

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
