// Source-shaped Tweet 2.9 ALT widgets. Synthetic values, no API/credentials.
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const altText = 'Home\nLike Close https://example.org/a?q=原文#写真';
function altPopoverMarkup(id = 'native-alt', value = altText) {
  return `<div class="contents"><button type="button" aria-expanded="false" aria-controls="${id}" aria-label="Show alt text" class="absolute z-10 inline-flex min-h-6 min-w-6 bottom-2 left-2">ALT</button>
    <div id="${id}" hidden class="absolute inset-x-2 bottom-10 z-20 max-h-[70%] overflow-y-auto rounded-xl bg-black/90 p-3 pr-10 text-left text-sm leading-5 text-white shadow-lg">
      <p class="whitespace-pre-wrap break-words">${escapeHTML(value)}</p><button type="button" aria-label="Close alt text" class="absolute right-1.5 top-1.5 inline-flex min-h-8 min-w-8"><svg aria-hidden="true"></svg></button></div></div>`;
}
function altEditorMarkup(value = altText) {
  return `<div role="presentation" class="fixed inset-0 z-140 flex items-center justify-center p-4 bg-slate-900/60"><div id="alt-editor" role="dialog" aria-modal="true" aria-labelledby="alt-heading" class="flex max-h-full w-full max-w-lg flex-col rounded-3xl border border-tl-app-border bg-tl-app-card p-5">
    <h3 id="alt-heading" class="text-[0.9375rem] font-bold text-tl-app-text">Describe this image</h3>
    <div class="mt-3 flex min-h-0 justify-center overflow-hidden rounded-2xl bg-black"><img src="https://media.tweet.app/fixture.jpg" alt="" class="max-h-[40vh] w-auto object-contain"></div>
    <label for="alt-heading-text" class="mt-4 text-xs font-bold text-tl-app-text">Alt text</label><textarea id="alt-heading-text" rows="4" aria-describedby="alt-hint alt-count" class="mt-1.5 w-full resize-y rounded-2xl border border-tl-app-border bg-tl-app-bg p-3">${escapeHTML(value)}</textarea>
    <div class="mt-1.5 flex items-start justify-between gap-3"><p id="alt-hint" class="text-xs text-tl-app-text-muted">Describe what's in the image for people who can't see it.</p><p id="alt-count" class="shrink-0 text-xs tabular-nums">20 / 1,000</p></div>
    <p id="alt-limit" class="sr-only" aria-live="polite"></p><div class="mt-4 flex justify-end gap-2"><button type="button" id="alt-cancel">Cancel</button><button type="button" id="alt-save">Save</button></div></div></div>`;
}
function altUploadMarkup(value = altText) {
  return `<section><textarea id="public-tweet-input">Draft Home Like</textarea><div class="w-full mt-3 space-y-3"><div class="relative"><img id="native-upload-image" src="https://media.tweet.app/fixture.jpg" alt="${escapeHTML(value)}" class="w-full h-full object-cover"><button type="button" id="alt-edit" class="absolute bottom-2 right-2" aria-label="Add alt text to image 1">+ALT</button></div><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><input type="file" accept="video/mp4,video/quicktime"></div></section>`;
}
function gallery290Markup(count = 2, id = 'gallery-290', value = altText) {
  return `<div class="mt-3"><div class="relative overflow-hidden rounded-2xl border border-tl-app-border bg-black"><div id="${id}" class="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
    ${Array.from({length:count},(_,i)=>`<div class="relative w-full min-w-full shrink-0 snap-start bg-black" style="aspect-ratio:1.5"><button type="button" class="h-full w-full cursor-pointer"><img src="https://media.tweet.app/${id}-${i}.jpg" alt="${escapeHTML(value)}" class="h-full w-full object-contain"></button>${altPopoverMarkup(`${id}-alt-${i}`,value)}</div>`).join('')}</div>
    <button type="button" aria-label="Previous image" class="absolute left-3"><svg class="lucide-chevron-left"></svg></button><button type="button" aria-label="Next image" class="absolute right-3"><svg class="lucide-chevron-right"></svg></button>
    <div class="absolute bottom-3 left-1/2 flex" aria-label="Choose image">${Array.from({length:count},(_,i)=>`<button type="button" aria-current="${i===0}" aria-label="Show image ${i+1} of ${count}"></button>`).join('')}</div></div></div>`;
}
function altViewerMarkup(value = altText) {
  const {viewerMarkup} = require('./native-media.cjs');
  return viewerMarkup({id:'native-alt-viewer',source:'https://media.tweet.app/gallery-290-0.jpg',count:2})
    .replace('alt="Attached media"',`alt="${escapeHTML(value)}"`)
    .replace(/<\/div>\s*$/,`<p aria-hidden="true" class="mx-auto mb-4 max-h-32 w-full max-w-2xl shrink-0 overflow-y-auto px-4 text-sm leading-5 text-white whitespace-pre-wrap break-words"><span class="mr-1.5 rounded bg-white/20 px-1 py-px font-bold">ALT</span>${escapeHTML(value)}</p></div>`);
}
module.exports = {altText, escapeHTML, altPopoverMarkup, altEditorMarkup, altUploadMarkup, gallery290Markup, altViewerMarkup};
