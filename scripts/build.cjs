const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const variants = [
  ['ja', 'classic-twitter-ja.user.js', false],
  ['ja', 'classic-twitter-ja-safari.user.js', true],
  ['en', 'classic-twitter-en.user.js', false]
];
for (const [locale, file, safari] of variants) {
  let source = read(`src/${locale}.js`);
  source = source.replace('/* @safari-grants */', safari ? '// @connect      firebasestorage.googleapis.com\n// @connect      storage.googleapis.com' : '');
  for (const part of ['network', 'enhancements', 'runtime', 'presentation', 'replies', 'navigation', 'badges']) {
    source = source.replace(`/* @include ${part} */`, read(`src/${part}.js`));
  }
  source = source.replace('/* @include safari */', safari ? read('src/safari-extras.js') : '');
  if (/\/\* @include/.test(source)) throw new Error('Unresolved source module');
  fs.writeFileSync(path.join(root, file), source.replace(/[ \t]+$/gm, ''));
}
