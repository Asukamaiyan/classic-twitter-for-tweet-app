const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
function translationPost(id, text = 'This is a post in English.', mode = 'idle') {
  const title = mode === 'active' ? 'Show original' : mode === 'original' ? 'Show translation' : 'Translate post';
  return `<article id="${id}"><div class="min-w-0 flex-1"><div class="flex items-center"><button class="font-bold truncate">Alice</button><span class="inline-flex items-center"><button class="native" id="${id}-translate" type="button" aria-label="Translate post" title="${title}" aria-pressed="${mode === 'active'}" ${mode === 'busy' ? 'aria-busy="true" aria-disabled="true"' : ''} data-translate-mode="${mode}"><svg aria-hidden="true"></svg></button><span data-translate-status role="status" aria-live="polite" class="sr-only"></span></span></div><p class="tl-user-text whitespace-pre-wrap break-words">${text}</p></div></article>`;
}
function sourceFunctions(file, names) {
  const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
  const functions = new Map();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && names.includes(node.id?.name)) functions.set(node.id.name, source.slice(node.start, node.end));
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(acorn.parse(source, { ecmaVersion:'latest' }));
  return names.map(name => { if (!functions.has(name)) throw new Error('Missing source helper ' + name); return functions.get(name); }).join('\n');
}
const originalContextSource = sourceFunctions('runtime.js', ['ctTranslationDisabled','ctOwnTranslationText']);
const controlsSource = sourceFunctions('ja.js', ['ctTranslationControls']);
module.exports = { translationPost, originalContextSource, controlsSource };
