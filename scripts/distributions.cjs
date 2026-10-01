// The desktop editions keep their original names; new platform editions have
// distinct names so userscript managers can identify them independently.
module.exports = [
  { locale: 'ja', platform: 'chrome', file: 'classic-twitter-ja.user.js' },
  { locale: 'ja', platform: 'safari', file: 'classic-twitter-ja-safari.user.js' },
  { locale: 'ja', platform: 'android', file: 'classic-twitter-ja-android.user.js', name: 'Classic Twitter for tweet.app - Japanese Android' },
  { locale: 'en', platform: 'chrome', file: 'classic-twitter-en.user.js' },
  { locale: 'en', platform: 'safari', file: 'classic-twitter-en-safari.user.js', name: 'Classic Twitter for tweet.app - English Safari' },
  { locale: 'en', platform: 'android', file: 'classic-twitter-en-android.user.js', name: 'Classic Twitter for tweet.app - English Android' }
];
