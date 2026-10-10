const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const distributions = require('./distributions.cjs');
for (const { locale, file, platform, name } of distributions) {
  const safari = platform === 'safari';
  let source = read(`src/${locale}.js`);
  source = source.replace('/* @platform */', `const CT_PLATFORM = '${platform}';`);
  if (name) source = source.replace(/^\/\/ @name\s+.*$/m, `// @name         ${name}`);
  source = source.replace('/* @safari-grants */', safari ? '// @connect      firebasestorage.googleapis.com\n// @connect      storage.googleapis.com' : '');
  for (const part of ['timestamps', 'network', 'browser-notifications', 'enhancements', 'translation', 'classic', 'motion', 'runtime', 'presentation', 'photo-viewport', 'profile', 'favorite-capture', 'reply-times', 'favorite-history', 'navigation', 'notification-filters', 'badges', 'media', 'news', 'link-preview']) {
    source = source.replace(`/* @include ${part} */`, read(`src/${part}.js`));
  }
  source = source.replace('/* @include safari */', safari ? read('src/safari-extras.js') : '');
  if (/\/\* @include/.test(source)) throw new Error('Unresolved source module');
  fs.writeFileSync(path.join(root, file), source.replace(/[ \t]+$/gm, ''));
}
