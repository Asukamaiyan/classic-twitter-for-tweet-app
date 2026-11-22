// Source-shaped Tweet 2.9.2 photo widgets. All URLs/text are synthetic.
const { altPopoverMarkup, escapeHTML } = require('./native-alt.cjs');
const photos = [
  { url: 'https://media.tweet.app/test-portrait.svg', altText: 'Portrait Home Close', width: 600, height: 1000 },
  { url: 'https://media.tweet.app/test-landscape.svg', altText: 'Landscape Like', width: 1200, height: 600 },
  { url: 'https://media.tweet.app/test-square.svg', altText: 'Square 原文', width: 800, height: 800 },
  { url: 'https://media.tweet.app/test-panorama.svg', altText: 'Panorama 原文', width: 1800, height: 300 }
];
function frameRatio(photo) { return Math.max(.8, Math.min(2, photo.width / photo.height)) || 1; }
function photoGalleryMarkup(items = photos, id = 'photo-fit-gallery') {
  const ratio = frameRatio(items[0]);
  return `<div class="mt-3"><div class="relative overflow-hidden rounded-2xl border border-tl-app-border bg-black" style="width:min(100%, ${31.875 * ratio}rem);margin-inline:auto"><div id="${id}" class="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
    ${items.map((item, index) => `<div class="relative w-full min-w-full shrink-0 snap-start bg-black" style="aspect-ratio:${ratio}"><button type="button" class="h-full w-full cursor-pointer"><img src="${escapeHTML(item.url)}" alt="${escapeHTML(item.altText || '')}" class="h-full w-full object-contain" loading="${index ? 'lazy' : 'eager'}"></button>${altPopoverMarkup(`${id}-alt-${index}`, item.altText || '')}</div>`).join('')}
    </div><button type="button" data-inline-prev aria-label="Previous image" class="absolute left-3"><svg class="lucide-chevron-left"></svg></button><button type="button" data-inline-next aria-label="Next image" class="absolute right-3"><svg class="lucide-chevron-right"></svg></button><div class="absolute bottom-3 left-1/2 flex" aria-label="Choose image">${items.map((_, index) => `<button type="button" data-inline-page="${index}" aria-current="${index === 0}" aria-label="Show image ${index + 1} of ${items.length}"></button>`).join('')}</div></div></div>`;
}
function singlePhotoMarkup(item = photos[0], { metadata = true, id = 'photo-fit-single' } = {}) {
  const ratio = frameRatio(item);
  return `<div id="${id}" class="${metadata ? 'relative overflow-hidden rounded-2xl border border-tl-app-border bg-black' : 'relative'}" ${metadata ? `style="aspect-ratio:${ratio};width:min(100%, ${31.875 * ratio}rem);margin-inline:auto"` : ''}><button type="button" class="block ${metadata ? 'h-full ' : ''}w-full cursor-pointer"><img src="${escapeHTML(item.url)}" alt="${escapeHTML(item.altText || '')}" class="${metadata ? 'h-full w-full object-contain' : 'w-full max-h-[31.875rem] object-cover'}"></button>${altPopoverMarkup(`${id}-alt`, item.altText || '')}</div>`;
}
module.exports = { photos, photoGalleryMarkup, singlePhotoMarkup };
