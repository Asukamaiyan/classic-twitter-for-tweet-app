  // Tweet owns photo selection, uploads, inline carousels and viewer controls.
  // Supplement only the verified viewer's motion, viewport fit and delivered
  // media information; never submit posts or rewrite provided media sources.
  const ctMediaGalleries = new Map();
  const ctMediaCenteredViewers = new Map();
  const ctMediaVideos = new Map();
  const ctMediaPhotoQuality = new Map();
  let ctMediaViewportBound = false;
  let ctMediaPendingViewer = null;
  let ctMediaViewer = null;

  function ctMediaJapanese() { return CT_LOCALE === 'ja'; }
  function ctMediaQualityURL(value) {
    if (typeof value !== 'string' || value.length > 4000) return '';
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  function ctMediaResolution(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      ? `${width} × ${height}` : '';
  }
  function ctMediaReleasePhotoQuality(dialog) {
    const state = ctMediaPhotoQuality.get(dialog);
    if (!state) return;
    state.observer.disconnect();
    state.image.removeEventListener('load', state.update);
    state.image.removeEventListener('error', state.update);
    state.tools.remove(); ctMediaPhotoQuality.delete(dialog);
  }
  function ctMediaAttachPhotoQuality(dialog, image) {
    if (!dialog?.isConnected || image?.tagName !== 'IMG' || !dialog.contains(image)) return;
    const old = ctMediaPhotoQuality.get(dialog);
    if (old?.image === image) { old.update(); return; }
    ctMediaReleasePhotoQuality(dialog); ctMediaStyles();
    const tools = document.createElement('div');
    tools.className = 'ct-media-photo-quality'; tools.dataset.ctLocalUi = 'media-quality';
    const open = document.createElement('a');
    open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
    open.textContent = ctMediaJapanese() ? '配信画像を開く ↗' : 'Open image ↗';
    open.setAttribute('aria-label', ctMediaJapanese() ? '配信画像を新しいタブで開く' : 'Open delivered image in a new tab');
    const resolution = document.createElement('span'); resolution.className = 'ct-media-photo-resolution';
    resolution.title = ctMediaJapanese() ? '読み込んだ画像のサイズ' : 'Size of the loaded image';
    tools.append(open, resolution);
    tools.addEventListener('click', event => event.stopPropagation());
    const state = { image, tools, open, resolution, source: '' };
    state.update = () => {
      const source = ctMediaQualityURL(image.getAttribute('src') || '');
      if (source !== state.source) {
        state.source = source; resolution.textContent = ''; resolution.hidden = true;
      }
      if (source) { if (open.href !== source) open.href = source; }
      else open.removeAttribute('href');
      open.hidden = !source;
      // currentSrc can still describe the previous photo during a native src
      // change. Never attach that earlier photo's dimensions to the new link.
      const current = image.currentSrc;
      const dimensions = source && image.complete && (!current || ctMediaQualityURL(current) === source)
        ? ctMediaResolution(image.naturalWidth, image.naturalHeight) : '';
      if (resolution.textContent !== dimensions) resolution.textContent = dimensions;
      resolution.hidden = !dimensions; tools.hidden = !source;
    };
    state.observer = new MutationObserver(state.update);
    state.observer.observe(image, { attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
    image.addEventListener('load', state.update); image.addEventListener('error', state.update);
    dialog.append(tools); ctMediaPhotoQuality.set(dialog, state); state.update();
  }
  function ctMediaLabelUploadControls(input) {
    if (!input.matches('input[type="file"][accept="image/*"][multiple]') || input.closest('[data-ct-local-ui],[data-ct-owned]')) return;
    const toolbar = input.parentElement;
    if (!toolbar?.matches('div.flex.items-center') || !toolbar.parentElement?.matches('div.w-full.mt-3.space-y-3') ||
        ![...toolbar.children].some(el => el.matches('input[type="file"][accept="video/mp4,video/quicktime"]'))) return;
    const actions = [...toolbar.children].find(el => el.matches('div.flex.items-center'));
    if (!actions) return;
    for (const [icon, label] of [['image', ctMediaJapanese() ? '写真を追加' : 'Add photos'],
        ['video', ctMediaJapanese() ? '動画を追加' : 'Add video']]) {
      const buttons = [...actions.children].filter(el => el.matches('button[type="button"]') &&
        el.querySelector(':scope > svg.lucide-' + icon));
      if (buttons.length !== 1) continue;
      const button = buttons[0], current = button.getAttribute('aria-label');
      // The current compose buttons remain icon-only. Preserve a future native
      // accessible label; naming these controls never changes upload behavior.
      if (!current || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(current)) {
        if (current !== label) button.setAttribute('aria-label', label);
        if ((!button.title || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(button.title)) && button.title !== label) button.title = label;
      }
    }
  }
  function ctMediaSlides(grid) {
    if (!grid?.matches('div.flex.w-full.snap-x.snap-mandatory.overflow-x-auto.overscroll-x-contain') ||
        !grid.closest('main,article') || grid.closest('[data-ct-local-ui],[data-ct-owned]') ||
        !grid.parentElement?.matches('div.relative.overflow-hidden.rounded-2xl.border.bg-black')) return [];
    const slides = [...grid.children];
    if (slides.length < 2 || slides.length > 16 || slides.some(slide =>
        !slide.matches('button[type="button"].relative.w-full.min-w-full.shrink-0.snap-start.bg-black') ||
        slide.children.length !== 1 || !slide.firstElementChild.matches('img.h-full.w-full.object-cover') ||
        !ctMediaQualityURL(slide.firstElementChild.src))) return [];
    const sources = slides.map(slide => slide.firstElementChild.src);
    return new Set(sources).size === sources.length ? slides : [];
  }
  function ctMediaObserveGallery(grid) {
    const slides = ctMediaSlides(grid);
    if (!slides.length) return;
    const existing = ctMediaGalleries.get(grid);
    if (existing) { existing.slides = slides; existing.shell.classList.add('ct-media-native-gallery'); return; }
    // Record the native opener only. Its scroll snap, dots, keyboard/click
    // handlers and counts remain untouched; no second inline carousel is made.
    const state = { grid, slides, shell: grid.parentElement };
    state.shell.classList.add('ct-media-native-gallery');
    state.onClick = event => {
      const button = event.target.closest?.('button');
      const index = ctMediaSlides(grid).indexOf(button);
      if (index >= 0) ctMediaPendingViewer = { state, index, at: Date.now(), context: ctMediaPhotoContext() };
    };
    grid.addEventListener('click', state.onClick, true);
    ctMediaGalleries.set(grid, state);
  }
  function ctMediaRemoveGallery(state) {
    state.shell.classList.remove('ct-media-native-gallery');
    state.grid.removeEventListener('click', state.onClick, true);
    ctMediaGalleries.delete(state.grid);
    if (ctMediaPendingViewer?.state === state) ctMediaPendingViewer = null;
  }
  function ctMediaNativePhotoViewer(dialog) {
    if (!dialog?.matches('div[role="dialog"][aria-modal="true"]:is([aria-label="Media viewer"],[aria-label="写真・動画ビューア"])') ||
        !dialog.classList.contains('flex') || !dialog.classList.contains('flex-col') ||
        dialog.closest('[data-ct-local-ui],[data-ct-owned]')) return null;
    const stage = [...dialog.children].find(el =>
      el.matches('div.relative.flex.flex-1.min-h-0.items-center.justify-center'));
    const image = stage && [...stage.children].find(el => el.matches('img.max-h-full.max-w-full.select-none.object-contain'));
    const prev = stage && [...stage.children].find(el => el.matches('button[type="button"].absolute.left-3') &&
      el.querySelector(':scope > svg.lucide-chevron-left'));
    const next = stage && [...stage.children].find(el => el.matches('button[type="button"].absolute.right-3') &&
      el.querySelector(':scope > svg.lucide-chevron-right'));
    const header = [...dialog.children].find(el => el.matches('div.flex.items-center.justify-between.shrink-0') &&
      el.querySelector(':scope > button[type="button"] > svg.lucide-x') && el.querySelector(':scope > span[aria-live="polite"]'));
    const position = /^(\d+)\s*\/\s*(\d+)$/.exec(header?.querySelector(':scope > span[aria-live="polite"]')?.textContent.trim() || '');
    const index = position ? Number(position[1]) - 1 : -1, total = position ? Number(position[2]) : 0;
    return stage && image && prev && next && header && index >= 0 && index < total && total <= 16
      ? { stage, image, prev, next, header, index, total } : null;
  }
  function ctMediaClearViewer() {
    if (!ctMediaViewer) return;
    const viewer = ctMediaViewer;
    viewer.observer?.disconnect();
    clearTimeout(viewer.requestTimer);
    ctMediaResetPhotoMotion(viewer);
    viewer.stage?.classList.remove('ct-media-swipe-stage');
    viewer.dialog.removeEventListener('click', viewer.onControlClick, true);
    viewer.dialog.removeEventListener('touchstart', viewer.onTouchStart, true);
    viewer.dialog.removeEventListener('touchmove', viewer.onTouchMove, true);
    viewer.dialog.removeEventListener('touchend', viewer.onTouchEnd, true);
    viewer.dialog.removeEventListener('touchcancel', viewer.onCancel, true);
    for (const [name, handler] of [['pointerdown', viewer.onPointerStart], ['pointermove', viewer.onPointerMove],
        ['pointerup', viewer.onPointerEnd], ['pointercancel', viewer.onCancel], ['lostpointercapture', viewer.onCancel],
        ['click', viewer.onClick]]) if (handler) viewer.dialog.removeEventListener(name, handler, name === 'click');
    document.removeEventListener('visibilitychange', viewer.onVisibility);
    window.removeEventListener('pagehide', viewer.onPageHide);
    window.removeEventListener('pageshow', viewer.onPageShow);
    viewer.dialog.removeEventListener('dragstart', viewer.onDragStart);
    viewer.reduce?.removeEventListener?.('change', viewer.onReduce);
    ctMediaClearPhotoDecode(viewer);
    if (ctMediaPendingViewer?.state === viewer.state) ctMediaPendingViewer = null;
    ctMediaViewer = null;
  }
  function ctMediaPhotoContext() {
    return `${location.pathname}${location.search}\n${typeof ctNetworkState !== 'undefined' ? ctNetworkState.authUID || '' : ''}`;
  }
  function ctMediaPhotoViewerValid(viewer) {
    return viewer.dialog.isConnected && viewer.state.grid.isConnected && !document.hidden &&
      viewer.context === ctMediaPhotoContext() && viewer.sources === ctMediaSlides(viewer.state.grid)
        .map(slide => slide.firstElementChild.src).join('\n');
  }
  function ctMediaResetPhotoMotion(viewer) {
    const touch = viewer.touch;
    viewer.touch = null;
    if (touch?.pointer != null) try { touch.capture?.releasePointerCapture(touch.pointer); } catch {}
    const motion = viewer.motion;
    if (motion) {
      cancelAnimationFrame(motion.frame);
      clearTimeout(motion.timer);
      motion.image.removeEventListener('load', motion.loaded);
      motion.image.removeEventListener('error', motion.loaded);
      motion.image.classList.remove('ct-media-photo-covered');
      motion.layer.remove();
      viewer.motion = null;
    }
  }
  function ctMediaCancelPhotoGesture(viewer) {
    if (viewer.touch?.locked || viewer.pinch) viewer.suppressClickUntil = Date.now() + 400;
    ctMediaResetPhotoMotion(viewer);
  }
  function ctMediaClearPhotoDecode(viewer) {
    // Detached decoded images belong only to this visible viewer. A promise
    // completing after close/source/account changes cannot revive that viewer.
    viewer.decodedPhotos?.clear();
  }
  function ctMediaWarmPhotoDecode(viewer) {
    if (!ctMediaPhotoViewerValid(viewer) || viewer.pageActive === false || viewer.reduce?.matches || ctPhotoViewportZoomed()) {
      ctMediaClearPhotoDecode(viewer); return;
    }
    const slides = ctMediaSlides(viewer.state.grid);
    const wanted = new Set([viewer.index - 1, viewer.index, viewer.index + 1].filter(index => slides[index]));
    const photos = viewer.decodedPhotos ||= new Map();
    for (const index of photos.keys()) if (!wanted.has(index)) photos.delete(index);
    const preview = ctMediaNativePhotoViewer(viewer.dialog)?.image;
    for (const index of wanted) {
      const source = slides[index].firstElementChild.src;
      if (photos.get(index)?.source === source) continue;
      const image = document.createElement('img');
      image.alt = ''; image.draggable = false; image.decoding = 'async';
      image.referrerPolicy = preview?.referrerPolicy || ''; image.src = source;
      const entry = { image, source, ready: typeof image.decode !== 'function' };
      photos.set(index, entry);
      if (entry.ready) continue; // Older engines retain the existing behavior.
      try {
        Promise.resolve(image.decode()).then(() => {
          if (photos.get(index) !== entry || !ctMediaPhotoViewerValid(viewer)) return;
          entry.ready = image.complete && image.naturalWidth > 0;
        }, () => {});
      } catch {}
    }
  }
  function ctMediaPhotoLayer(viewer, target) {
    if (viewer.motion) return viewer.motion;
    const image = ctMediaNativePhotoViewer(viewer.dialog)?.image;
    // Only add presentation inside the verified native stage; React keeps its
    // image, src, click handlers, close button and backdrop throughout.
    if (!viewer.stage || image?.parentElement !== viewer.stage ||
        viewer.reduce?.matches) return null;
    ctMediaWarmPhotoDecode(viewer);
    const slides = ctMediaSlides(viewer.state.grid);
    // Do not cover a decoded native photo with a freshly created, still blank
    // image. If preparation is incomplete, the native click remains available.
    if (!viewer.decodedPhotos?.get(viewer.index)?.ready ||
        (slides[target] && !viewer.decodedPhotos.get(target)?.ready)) return null;
    const layer = document.createElement('div');
    layer.className = 'ct-media-photo-layer'; layer.dataset.ctLocalUi = 'photo-motion';
    layer.setAttribute('aria-hidden', 'true');
    const track = document.createElement('div'); track.className = 'ct-media-photo-track';
    for (const index of [target < viewer.index ? target : viewer.index - 1, viewer.index,
        target > viewer.index ? target : viewer.index + 1]) {
      const pane = document.createElement('div'); pane.className = 'ct-media-photo-pane';
      const original = slides[index]?.firstElementChild;
      if (original) {
        const decoded = viewer.decodedPhotos.get(index);
        if (decoded?.ready && decoded.source === original.src) pane.append(decoded.image);
      }
      track.append(pane);
    }
    layer.append(track); viewer.stage.append(layer); image.classList.add('ct-media-photo-covered');
    const motion = { layer, track, image, width: viewer.stage.clientWidth || window.innerWidth, frame: 0, timer: null };
    viewer.motion = motion;
    track.style.transform = 'translate3d(-100%,0,0)';
    return motion;
  }
  function ctMediaPhotoOffset(viewer, offset) {
    const motion = viewer.motion;
    if (!motion) return;
    motion.offset = offset;
    if (motion.frame) return;
    motion.frame = requestAnimationFrame(() => {
      motion.frame = 0;
      if (viewer.motion === motion) motion.track.style.transform = `translate3d(calc(-100% + ${motion.offset}px),0,0)`;
    });
  }
  function ctMediaFinishPhoto(viewer, index, commit, invokeNative = true) {
    if (!ctMediaPhotoViewerValid(viewer)) { ctMediaClearViewer(); return; }
    const motion = viewer.motion;
    const oldIndex = viewer.index;
    const image = ctMediaSlides(viewer.state.grid)[index]?.firstElementChild;
    if (commit && image) {
      viewer.requestedIndex = index;
      if (motion) { motion.startSource = motion.image.src; motion.targetSource = image.src; }
      viewer.requestTimer = setTimeout(() => {
        if (ctMediaViewer !== viewer) return;
        viewer.requestedIndex = null;
        ctMediaResetPhotoMotion(viewer);
        ctMediaEnhanceViewer();
      }, 1600);
      if (invokeNative) {
        viewer.commitAction = true;
        try { (index > oldIndex ? viewer.next : viewer.prev).click(); }
        finally { viewer.commitAction = false; }
        ctMediaEnhanceViewer();
      }
    }
    if (!motion || viewer.motion !== motion) return;
    cancelAnimationFrame(motion.frame); motion.frame = 0;
    if (motion.offset != null) motion.track.style.transform = `translate3d(calc(-100% + ${motion.offset}px),0,0)`;
    // Establish the starting transform once, then let the compositor settle it.
    motion.track.getBoundingClientRect();
    motion.track.style.transition = 'transform 220ms cubic-bezier(.22,.68,0,1)';
    motion.track.style.transform = `translate3d(${commit ? index > oldIndex ? '-200%' : '0%' : '-100%'},0,0)`;
    motion.timer = setTimeout(() => {
      if (viewer.motion !== motion) return;
      if (!commit || !ctMediaPhotoViewerValid(viewer)) { ctMediaResetPhotoMotion(viewer); ctMediaEnhanceViewer(); return; }
      // Keep the already visible destination until the native image loads.
      // A bounded fallback also restores native errors instead of hiding them.
      const release = () => {
        if (viewer.motion !== motion) return;
        ctMediaResetPhotoMotion(viewer);
        ctMediaEnhanceViewer();
      };
      motion.loaded = () => { if (motion.image.src === image.src) release(); };
      if (motion.image.src === image.src && motion.image.complete) motion.loaded();
      else {
        motion.image.addEventListener('load', motion.loaded);
        motion.image.addEventListener('error', motion.loaded);
        motion.timer = setTimeout(release, 1200);
      }
    }, 240);
  }
  function ctMediaStartPhotoGesture(viewer, event, point) {
    if (!ctMediaPhotoViewerValid(viewer) || viewer.motion || viewer.requestedIndex != null || ctPhotoViewportZoomed() || viewer.pinch ||
        event.target !== ctMediaNativePhotoViewer(viewer.dialog)?.image) return;
    viewer.touch = { x: point.clientX, y: point.clientY, at: performance.now(), dx: 0, locked: false,
      pointer: event.pointerId, width: viewer.stage?.clientWidth || window.innerWidth };
  }
  function ctMediaDragPhoto(viewer, event, point) {
    const touch = viewer.touch;
    if (!touch) return;
    if (!ctMediaPhotoViewerValid(viewer)) { ctMediaClearViewer(); return; }
    if (ctPhotoViewportZoomed() || viewer.pinch) { ctMediaCancelPhotoGesture(viewer); return; }
    const dx = point.clientX - touch.x, dy = point.clientY - touch.y;
    if (!touch.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { viewer.touch = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      touch.locked = true;
      ctMediaPhotoLayer(viewer, viewer.index + (dx < 0 ? 1 : -1));
      if (event.pointerId != null) try { event.target.setPointerCapture(event.pointerId); touch.capture = event.target; } catch {}
    }
    touch.dx = dx;
    if (event.cancelable) event.preventDefault();
    const edge = viewer.index === 0 && dx > 0 || viewer.index === viewer.state.slides.length - 1 && dx < 0;
    ctMediaPhotoOffset(viewer, edge ? dx * .22 : Math.max(-touch.width, Math.min(touch.width, dx)));
  }
  function ctMediaEndPhotoGesture(viewer, event, point) {
    const touch = viewer.touch;
    if (!touch) return;
    // Older TouchEvent bridges may omit move; retain their completed swipe.
    ctMediaDragPhoto(viewer, event, point);
    if (viewer.touch !== touch) return;
    viewer.touch = null;
    if (!touch.locked) return;
    const dx = point.clientX - touch.x;
    const fast = Math.abs(dx) >= 24 && Math.abs(dx) / Math.max(1, performance.now() - touch.at) > .55;
    const commit = fast || Math.abs(dx) >= Math.min(90, touch.width * .18);
    const index = Math.max(0, Math.min(viewer.state.slides.length - 1, viewer.index + (dx < 0 ? 1 : -1)));
    viewer.suppressClickUntil = Date.now() + 400;
    ctMediaFinishPhoto(viewer, index, commit && index !== viewer.index);
    if (touch.pointer != null) try { touch.capture?.releasePointerCapture(touch.pointer); } catch {}
  }
  function ctMediaViewport(dialog) {
    const fit = ctPhotoViewportFit(dialog, '--ct-media-view-');
    dialog.classList.toggle('ct-media-photo-zoomed', fit.zoomed);
    if (ctMediaViewer?.dialog === dialog && (fit.zoomed || fit.changed)) {
      ctMediaCancelPhotoGesture(ctMediaViewer); ctMediaEnhanceViewer();
    }
  }
  function ctMediaCenterViewers() {
    for (const [dialog, state] of ctMediaCenteredViewers) {
      if (dialog.isConnected && ctMediaNativePhotoViewer(dialog)) continue;
      dialog.classList.remove('ct-media-centered-viewer', 'ct-media-viewport-viewer', 'ct-media-photo-zoomed');
      state.stage.classList.remove('ct-media-viewer-stage');
      state.header?.classList.remove('ct-media-viewer-header');
      ctMediaReleasePhotoQuality(dialog);
      for (const key of ['top', 'left', 'width', 'height']) dialog.style.removeProperty(`--ct-media-view-${key}`);
      ctMediaCenteredViewers.delete(dialog);
    }
    for (const dialog of document.querySelectorAll('div[role="dialog"][aria-modal="true"]:is([aria-label="Media viewer"],[aria-label="写真・動画ビューア"])')) {
      const native = ctMediaNativePhotoViewer(dialog);
      if (!native) continue;
      const { image, stage, header } = native;
      const previous = ctMediaCenteredViewers.get(dialog);
      if (previous && previous.stage !== stage) previous.stage.classList.remove('ct-media-viewer-stage');
      dialog.classList.add('ct-media-centered-viewer');
      // Contained native viewers remain inside their existing modal. Only the
      // verified fixed viewer follows the visible viewport on mobile browsers.
      dialog.classList.toggle('ct-media-viewport-viewer', dialog.classList.contains('fixed'));
      stage.classList.add('ct-media-viewer-stage');
      header?.classList.add('ct-media-viewer-header');
      ctMediaAttachPhotoQuality(dialog, image);
      ctMediaCenteredViewers.set(dialog, { stage, header });
      ctMediaViewport(dialog);
    }
    if (ctMediaViewportBound) return;
    ctMediaViewportBound = true;
    const update = () => {
      for (const dialog of ctMediaCenteredViewers.keys()) if (dialog.isConnected) ctMediaViewport(dialog);
    };
    window.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('scroll', update, { passive: true });
  }
  function ctMediaVideoContext(video) {
    return { source: video.currentSrc || video.src, path: location.pathname + location.search,
      uid: typeof ctNetworkState === 'undefined' ? null : ctNetworkState.authUID };
  }
  function ctMediaVideoContextMatches(state) {
    const current = ctMediaVideoContext(state.video);
    return state.video.isConnected && current.source === state.context?.source &&
      current.path === state.context?.path && current.uid === state.context?.uid;
  }
  function ctMediaVideoFullscreen(state) {
    return document.fullscreenElement === state.video || state.webkitFullscreen === true ||
      state.video.webkitDisplayingFullscreen === true;
  }
  function ctMediaRestorePause(state) {
    clearInterval(state.guardTimer);
    state.guardTimer = null;
    if (!state.pauseGuard) return;
    // Never overwrite a later page-owned replacement of the instance method.
    if (state.video.pause === state.pauseGuard) {
      if (state.pauseDescriptor) Object.defineProperty(state.video, 'pause', state.pauseDescriptor);
      else delete state.video.pause;
    }
    state.pauseGuard = null;
  }
  function ctMediaVideoEnd(state, invalid = false) {
    const pause = state.originalPause;
    if (invalid) state.invalidatedFullscreen = true;
    ctMediaRestorePause(state);
    state.context = null;
    state.intentPlaying = false;
    state.requesting = false;
    state.requestSequence++;
    state.button.disabled = false;
    if (!ctMediaVideoFullscreen(state) && !state.pendingRequests.size) state.invalidatedFullscreen = false;
    if (!invalid) return;
    // A removed post, another account, or a new route must not leave an old
    // account's media playing in the browser's fullscreen top layer.
    if (pause && !state.video.paused) try { pause.call(state.video); } catch {}
    if (document.fullscreenElement === state.video) {
      try { document.exitFullscreen?.()?.catch?.(() => {}); } catch {}
    } else if (state.webkitFullscreen || state.video.webkitDisplayingFullscreen) {
      try { state.video.webkitExitFullscreen?.(); } catch {}
    }
  }
  function ctMediaGuardVideoPause(state) {
    if (state.pauseGuard || typeof state.video.pause !== 'function') return;
    const video = state.video;
    state.pauseDescriptor = Object.getOwnPropertyDescriptor(video, 'pause');
    state.originalPause = video.pause;
    const original = state.originalPause;
    // Tweet's autoplay manager observes the inline wrapper, which can leave the
    // viewport while this same video is in the fullscreen top layer. Ignore
    // only JavaScript pause calls during that active fullscreen session. Native
    // player controls do not call this method and their pause event is retained.
    state.pauseGuard = function (...args) {
      if (this === video && state.intentPlaying && ctMediaVideoFullscreen(state) &&
          !document.hidden && ctMediaVideoContextMatches(state)) return;
      return original.apply(this, args);
    };
    try { Object.defineProperty(video, 'pause', { configurable: true, writable: true, value: state.pauseGuard }); }
    catch { state.pauseGuard = null; return; }
    state.guardTimer = setInterval(() => {
      if (!ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
      else if (!ctMediaVideoFullscreen(state) && !state.requesting) ctMediaVideoEnd(state);
    }, 500);
  }
  function ctMediaVideoBegin(state) {
    if (document.hidden) { ctMediaVideoEnd(state); return; }
    if (!ctMediaVideoFullscreen(state)) {
      // Fullscreen exit events are queued. An older exit, or a change for
      // another player, must not cancel a valid request still awaiting entry.
      if (state.requesting && ctMediaVideoContextMatches(state)) return;
      ctMediaVideoEnd(state); return;
    }
    if (state.invalidatedFullscreen && !state.context) { ctMediaVideoEnd(state, true); return; }
    if (!state.context && state.pendingRequests.size) { ctMediaVideoEnd(state, true); return; }
    if (!state.context) {
      state.context = ctMediaVideoContext(state.video);
      state.intentPlaying = !state.video.paused && !state.video.ended;
    }
    state.requesting = false;
    state.button.disabled = false;
    ctMediaGuardVideoPause(state);
  }
  function ctMediaVideoStatus(state, text = '') {
    state.status.textContent = text;
    state.status.hidden = !text;
  }
  function ctMediaEnhanceVideo(video) {
    if (video?.tagName !== 'VIDEO' || !video.controls || !video.isConnected ||
        video.closest('[data-ct-local-ui]:not([data-ct-local-ui="profile"])') ||
        video.closest('.w-full.mt-3.space-y-3') ||
        (!video.matches('.ct-profile-video') && (!video.closest('main,article') ||
          !video.playsInline || !video.loop || !video.matches('.w-full.object-contain')))) return;
    const shell = video.parentElement;
    if (!shell || !(video.currentSrc || video.src)) return;
    const existing = ctMediaVideos.get(video);
    if (existing) {
      if (existing.shell !== shell) { ctMediaRemoveVideo(existing); return ctMediaEnhanceVideo(video); }
      shell.classList.add('ct-media-video-shell');
      video.classList.add('ct-media-enhanced-video');
      if (!existing.controls.isConnected) video.after(existing.controls);
      if (existing.context && !ctMediaVideoContextMatches(existing)) ctMediaVideoEnd(existing, true);
      return;
    }
    if (typeof video.requestFullscreen !== 'function' && typeof video.webkitEnterFullscreen !== 'function') return;
    const controls = document.createElement('div');
    controls.className = 'ct-media-video-tools'; controls.dataset.ctLocalUi = 'media-video';
    if (video.matches('.ct-profile-video')) controls.classList.add('ct-media-video-inline-tools');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ct-media-video-fullscreen';
    const label = ctMediaJapanese() ? '動画を全画面で表示' : 'Show video fullscreen';
    button.setAttribute('aria-label', label); button.title = label;
    button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>';
    const status = document.createElement('span');
    status.className = 'ct-media-video-status'; status.setAttribute('role', 'status'); status.hidden = true;
    const resolution = document.createElement('span');
    resolution.className = 'ct-media-video-resolution'; resolution.hidden = true;
    resolution.title = ctMediaJapanese() ? '読み込んだ動画のサイズ' : 'Size of the loaded video';
    controls.append(resolution, button, status);
    controls.addEventListener('click', event => event.stopPropagation());
    const state = { video, shell, controls, button, status, resolution, context: null, pauseGuard: null,
      guardTimer: null, webkitFullscreen: false, requesting: false, requestSequence: 0, pendingRequests: new Set(),
      invalidatedFullscreen: false };
    button.addEventListener('click', () => {
      if (!video.isConnected || state.requesting) return;
      ctMediaVideoStatus(state);
      state.context = ctMediaVideoContext(video);
      state.invalidatedFullscreen = false;
      state.intentPlaying = !video.paused && !video.ended;
      state.requesting = true; button.disabled = true;
      const sequence = ++state.requestSequence;
      ctMediaGuardVideoPause(state);
      const failed = () => {
        state.pendingRequests.delete(sequence);
        if (sequence !== state.requestSequence) {
          if (!state.context && !state.pendingRequests.size && !ctMediaVideoFullscreen(state)) state.invalidatedFullscreen = false;
          return;
        }
        const same = ctMediaVideoContextMatches(state);
        ctMediaVideoEnd(state, !same);
        if (same) ctMediaVideoStatus(state, ctMediaJapanese() ? '全画面表示を開始できませんでした。動画の標準操作も利用できます。' :
          'Fullscreen could not start. You can also use the video player controls.');
      };
      try {
        // Keep this call in the click handler: browsers require user activation.
        // This never clones/reparents media, seeks, changes sound/rate or plays
        // a paused video just because its presentation is enlarged.
        if (typeof video.requestFullscreen === 'function') {
          state.pendingRequests.add(sequence);
          const result = video.requestFullscreen();
          Promise.resolve(result).then(() => {
            state.pendingRequests.delete(sequence);
            if (sequence !== state.requestSequence) {
              // The fullscreen flag can become true before fullscreenchange is
              // dispatched. Keep a cancelled successful request invalid until
              // its top layer has actually exited; a queued entry event must
              // not create a new session for changed media or another account.
              if (!state.context || !ctMediaVideoContextMatches(state)) {
                if (ctMediaVideoFullscreen(state)) ctMediaVideoEnd(state, true);
                else if (!state.pendingRequests.size) state.invalidatedFullscreen = false;
              }
              return;
            }
            if (!ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
            else ctMediaVideoBegin(state);
          }, failed);
        } else { video.webkitEnterFullscreen(); state.requesting = false; button.disabled = false; }
      } catch { failed(); }
    });
    state.onFullscreen = () => ctMediaVideoBegin(state);
    state.onWebkitBegin = () => { state.webkitFullscreen = true; ctMediaVideoBegin(state); };
    state.onWebkitEnd = () => { state.webkitFullscreen = false; ctMediaVideoEnd(state); };
    state.onPause = () => { state.intentPlaying = false; };
    state.onPlay = () => { if (ctMediaVideoFullscreen(state) && ctMediaVideoContextMatches(state)) state.intentPlaying = true; };
    state.onQuality = () => {
      const source = ctMediaQualityURL(video.src);
      const dimensions = source && video.readyState >= 1 &&
        (!video.currentSrc || ctMediaQualityURL(video.currentSrc) === source)
        ? ctMediaResolution(video.videoWidth, video.videoHeight) : '';
      if (resolution.textContent !== dimensions) resolution.textContent = dimensions;
      resolution.hidden = !dimensions;
    };
    state.onQualityReset = () => { resolution.textContent = ''; resolution.hidden = true; };
    state.onInvalid = () => {
      if (state.context && !ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
      state.onQuality();
    };
    state.onPageHide = () => ctMediaVideoEnd(state, true);
    state.onVisibility = () => {
      if (document.hidden) ctMediaVideoEnd(state);
      else if (ctMediaVideoFullscreen(state)) ctMediaVideoBegin(state);
    };
    document.addEventListener('fullscreenchange', state.onFullscreen);
    document.addEventListener('visibilitychange', state.onVisibility);
    video.addEventListener('webkitbeginfullscreen', state.onWebkitBegin);
    video.addEventListener('webkitendfullscreen', state.onWebkitEnd);
    video.addEventListener('pause', state.onPause);
    video.addEventListener('play', state.onPlay);
    video.addEventListener('emptied', state.onInvalid);
    video.addEventListener('loadstart', state.onInvalid);
    video.addEventListener('loadedmetadata', state.onQuality);
    video.addEventListener('resize', state.onQuality);
    video.addEventListener('emptied', state.onQualityReset);
    video.addEventListener('loadstart', state.onQualityReset);
    window.addEventListener('pagehide', state.onPageHide);
    state.observer = new MutationObserver(state.onInvalid);
    state.observer.observe(video, { attributes: true, attributeFilter: ['src'], childList: true, subtree: true });
    shell.classList.add('ct-media-video-shell'); video.classList.add('ct-media-enhanced-video'); video.after(controls);
    ctMediaVideos.set(video, state);
    state.onQuality();
  }
  function ctMediaRemoveVideo(state) {
    ctMediaVideoEnd(state, true);
    state.observer.disconnect();
    document.removeEventListener('fullscreenchange', state.onFullscreen);
    document.removeEventListener('visibilitychange', state.onVisibility);
    state.video.removeEventListener('webkitbeginfullscreen', state.onWebkitBegin);
    state.video.removeEventListener('webkitendfullscreen', state.onWebkitEnd);
    state.video.removeEventListener('pause', state.onPause);
    state.video.removeEventListener('play', state.onPlay);
    state.video.removeEventListener('emptied', state.onInvalid);
    state.video.removeEventListener('loadstart', state.onInvalid);
    state.video.removeEventListener('loadedmetadata', state.onQuality);
    state.video.removeEventListener('resize', state.onQuality);
    state.video.removeEventListener('emptied', state.onQualityReset);
    state.video.removeEventListener('loadstart', state.onQualityReset);
    window.removeEventListener('pagehide', state.onPageHide);
    state.controls.remove(); state.shell.classList.remove('ct-media-video-shell');
    state.video.classList.remove('ct-media-enhanced-video');
    ctMediaVideos.delete(state.video);
  }
  function ctMediaEnhanceViewer() {
    let viewer = ctMediaViewer;
    if (viewer && (!ctMediaPhotoViewerValid(viewer) || !ctMediaNativePhotoViewer(viewer.dialog))) {
      ctMediaClearViewer(); viewer = null;
    }
    if (!viewer) {
      const pending = ctMediaPendingViewer;
      if (!pending || pending.context !== ctMediaPhotoContext() || document.hidden ||
          !pending.state.grid.isConnected || Date.now() - pending.at > 5000) return;
      const slides = ctMediaSlides(pending.state.grid);
      const source = slides[pending.index]?.firstElementChild.src;
      if (!source) return;
      const dialog = [...document.querySelectorAll('div[role="dialog"][aria-modal="true"]:is([aria-label="Media viewer"],[aria-label="写真・動画ビューア"])')]
        .find(el => ctMediaNativePhotoViewer(el)?.image.src === source);
      const native = ctMediaNativePhotoViewer(dialog);
      if (!native || native.total !== slides.length || native.index !== pending.index) return;
      viewer = { dialog, state: pending.state, index: pending.index, ...native,
        pointers: new Set(), pinch: false, context: pending.context,
        sources: slides.map(slide => slide.firstElementChild.src).join('\n') };
      viewer.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      viewer.onReduce = () => {
        if (viewer.reduce.matches) { ctMediaResetPhotoMotion(viewer); ctMediaClearPhotoDecode(viewer); }
        ctMediaEnhanceViewer();
      };
      viewer.reduce?.addEventListener?.('change', viewer.onReduce);
      viewer.stage.classList.add('ct-media-swipe-stage');
      viewer.onControlClick = event => {
        const button = event.target.closest?.('button');
        if (![viewer.prev, viewer.next].includes(button) || viewer.commitAction) return;
        if (viewer.motion || viewer.requestedIndex != null) {
          event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        const index = viewer.index + (button === viewer.next ? 1 : -1);
        if (index < 0 || index >= ctMediaSlides(viewer.state.grid).length) return;
        ctMediaPhotoLayer(viewer, index);
        // The original click continues to React once. Only presentation and
        // late-commit tracking are added; native controls/counters stay native.
        ctMediaFinishPhoto(viewer, index, true, false);
      };
      viewer.onCancel = event => {
        if (event.type === 'lostpointercapture') {
          if (viewer.touch?.pointer === event.pointerId) ctMediaCancelPhotoGesture(viewer);
          return;
        }
        viewer.pointers.delete(event.pointerId);
        if (!viewer.pointers.size) viewer.pinch = false;
        if (viewer.nativeTouch) viewer.nativeTouch.cancelled = true;
        ctMediaCancelPhotoGesture(viewer);
      };
      viewer.onPageHide = () => {
        viewer.pageActive = false;
        ctMediaCancelPhotoGesture(viewer); ctMediaClearPhotoDecode(viewer);
        viewer.pointers.clear(); viewer.pinch = false; viewer.nativeTouch = null;
      };
      viewer.onPageShow = () => { viewer.pageActive = true; ctMediaWarmPhotoDecode(viewer); };
      viewer.onVisibility = () => { if (document.hidden) viewer.onPageHide(); else viewer.onPageShow(); };
      viewer.onDragStart = event => { if (viewer.touch && event.target === viewer.image) event.preventDefault(); };
      viewer.onClick = event => {
        if (Date.now() < (viewer.suppressClickUntil || 0) &&
            (event.target === viewer.stage || event.target === viewer.image)) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      };
      const pointer = typeof window.PointerEvent === 'function';
      if (pointer) {
        viewer.onPointerStart = event => {
          if (event.pointerType !== 'mouse') {
            viewer.pointers.add(event.pointerId);
            if (event.isPrimary === false || viewer.pointers.size > 1) {
              viewer.pinch = true; ctMediaCancelPhotoGesture(viewer); return;
            }
          }
          if (event.button === 0) ctMediaStartPhotoGesture(viewer, event, event);
        };
        viewer.onPointerMove = event => { if (viewer.touch?.pointer === event.pointerId) ctMediaDragPhoto(viewer, event, event); };
        viewer.onPointerEnd = event => {
          viewer.pointers.delete(event.pointerId);
          if (viewer.pinch) ctMediaCancelPhotoGesture(viewer);
          else if (viewer.touch?.pointer === event.pointerId) ctMediaEndPhotoGesture(viewer, event, event);
          if (!viewer.pointers.size) viewer.pinch = false;
        };
        for (const [name, handler] of [['pointerdown', viewer.onPointerStart], ['pointermove', viewer.onPointerMove],
            ['pointerup', viewer.onPointerEnd], ['pointercancel', viewer.onCancel], ['lostpointercapture', viewer.onCancel]]) dialog.addEventListener(name, handler);
      }
      // Native v2.2.3 compares only start/end X, including pinch and vertical
      // gestures. Capture blocks that handler only for a gesture already owned
      // here, or for zoom/pinch/vertical intent, without cancelling browser zoom.
      viewer.onTouchStart = event => {
        const point = event.touches?.[0];
        const cancelled = event.touches?.length !== 1 || ctPhotoViewportZoomed();
        viewer.nativeTouch = { x: point?.clientX, y: point?.clientY, cancelled };
        if (cancelled) { viewer.pinch = true; ctMediaCancelPhotoGesture(viewer); event.stopPropagation(); }
        else if (!pointer) ctMediaStartPhotoGesture(viewer, event, point);
      };
      viewer.onTouchMove = event => {
        const point = event.touches?.[0], gesture = viewer.nativeTouch;
        if (event.touches?.length !== 1 || ctPhotoViewportZoomed()) {
          if (gesture) gesture.cancelled = true;
          viewer.pinch = true; ctMediaCancelPhotoGesture(viewer); event.stopPropagation(); return;
        }
        if (gesture && point && Math.abs(point.clientY - gesture.y) > 10 &&
            Math.abs(point.clientY - gesture.y) >= Math.abs(point.clientX - gesture.x)) gesture.cancelled = true;
        if (!pointer && !gesture?.cancelled) ctMediaDragPhoto(viewer, event, point);
      };
      viewer.onTouchEnd = event => {
        if (!ctMediaPhotoViewerValid(viewer)) { event.stopPropagation(); ctMediaClearViewer(); return; }
        const gesture = viewer.nativeTouch, point = event.changedTouches?.[0];
        const vertical = gesture && point && Math.abs(point.clientY - gesture.y) > 10 &&
          Math.abs(point.clientY - gesture.y) >= Math.abs(point.clientX - gesture.x);
        const blocked = viewer.pinch || gesture?.cancelled || vertical || ctPhotoViewportZoomed();
        if (blocked) ctMediaCancelPhotoGesture(viewer);
        else if (!pointer && point) ctMediaEndPhotoGesture(viewer, event, point);
        if (blocked || Date.now() < (viewer.suppressClickUntil || 0)) event.stopPropagation();
        if (!event.touches?.length) { viewer.nativeTouch = null; viewer.pinch = false; }
      };
      dialog.addEventListener('touchstart', viewer.onTouchStart, { capture: true, passive: true });
      dialog.addEventListener('touchmove', viewer.onTouchMove, { capture: true, passive: false });
      dialog.addEventListener('touchend', viewer.onTouchEnd, { capture: true, passive: true });
      dialog.addEventListener('touchcancel', viewer.onCancel, true);
      dialog.addEventListener('dragstart', viewer.onDragStart);
      dialog.addEventListener('click', viewer.onControlClick, true);
      dialog.addEventListener('click', viewer.onClick, true);
      document.addEventListener('visibilitychange', viewer.onVisibility);
      window.addEventListener('pagehide', viewer.onPageHide);
      window.addEventListener('pageshow', viewer.onPageShow);
      ctMediaViewer = viewer;
      viewer.observer = new MutationObserver(records => {
        // A native keyboard action may leave and return to the old source before
        // this observer runs. Retain that source history to release stale motion.
        const motion = viewer.motion;
        if (motion?.targetSource && records.some(record => record.target === viewer.image &&
            ctMediaQualityURL(record.oldValue) === motion.targetSource)) motion.destinationSeen = true;
        ctMediaEnhanceViewer();
      });
      viewer.observer.observe(dialog, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['src'] });
    }
    const native = ctMediaNativePhotoViewer(viewer.dialog);
    const slides = ctMediaSlides(viewer.state.grid);
    const actual = slides.findIndex(slide => slide.firstElementChild.src === native?.image.src);
    if (actual < 0 || native.total !== slides.length || native.index !== actual || native.stage !== viewer.stage || native.image !== viewer.image ||
        native.prev !== viewer.prev || native.next !== viewer.next) { ctMediaClearViewer(); return; }
    const motion = viewer.motion;
    if (motion?.targetSource) {
      if (native.image.src === motion.targetSource) motion.destinationSeen = true;
      else if (motion.destinationSeen || native.image.src !== motion.startSource) {
        ctMediaResetPhotoMotion(viewer); viewer.requestedIndex = null; clearTimeout(viewer.requestTimer);
      }
    }
    viewer.index = actual;
    ctMediaWarmPhotoDecode(viewer);
    if (viewer.requestedIndex === actual) { viewer.requestedIndex = null; clearTimeout(viewer.requestTimer); }
    // The native index label and disabled states are authoritative.
  }
  function ctMediaStyles() {
    if (document.getElementById('ct-media-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-media-style';
    style.textContent = `
      .ct-media-native-gallery > div.absolute.bottom-3.flex > button { min-width:44px; min-height:44px; }
      .ct-media-centered-viewer { overflow:hidden!important; }
      .ct-media-viewport-viewer { inset:auto!important; top:var(--ct-media-view-top,0)!important; left:var(--ct-media-view-left,0)!important; width:var(--ct-media-view-width,100vw)!important; height:var(--ct-media-view-height,100dvh)!important; }
      .ct-media-centered-viewer > .ct-media-viewer-header { position:absolute!important; top:0; left:0; right:0; z-index:2; padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 12px max(12px,env(safe-area-inset-left))!important; pointer-events:none; }
      .ct-media-centered-viewer > .ct-media-viewer-header button { pointer-events:auto; min-width:44px; min-height:44px; }
      .ct-media-photo-quality { position:absolute; bottom:max(12px,env(safe-area-inset-bottom)); right:max(12px,env(safe-area-inset-right)); z-index:3; display:flex; align-items:center; flex-wrap:wrap; gap:8px; max-width:calc(100% - 88px); color:#fff; font:12px/1.4 system-ui,sans-serif; }
      .ct-media-photo-quality a { display:inline-flex; align-items:center; min-height:44px; padding:0 8px; color:inherit; background:#0009; border-radius:4px; text-decoration:none; }
      .ct-media-photo-quality a:focus-visible { outline:3px solid #fff; outline-offset:2px; }
      .ct-media-photo-resolution { padding:5px 8px; background:#0009; border-radius:4px; white-space:nowrap; }
      .ct-media-photo-quality[hidden],.ct-media-photo-quality [hidden] { display:none!important; }
      .ct-media-centered-viewer > .ct-media-viewer-stage { position:absolute!important; inset:0; box-sizing:border-box; width:100%; height:100%; min-height:0; min-width:0; display:flex!important; align-items:center!important; justify-content:center!important; padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-right)) calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left))!important; }
      .ct-media-viewer-stage > img { display:block; width:auto!important; height:auto!important; max-width:100%!important; max-height:100%!important; object-fit:contain!important; }
      .ct-media-swipe-stage { touch-action:pan-y pinch-zoom; }
      .ct-media-photo-zoomed .ct-media-swipe-stage { touch-action:pan-x pan-y pinch-zoom; }
      .ct-media-photo-covered { opacity:0!important; }
      .ct-media-photo-layer { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
      .ct-media-photo-track { display:flex; width:100%; height:100%; will-change:transform; }
      .ct-media-photo-pane { flex:0 0 100%; min-width:0; height:100%; display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-right)) calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left)); }
      .ct-media-photo-pane img { width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain; user-select:none; }
      .ct-media-video-shell { position:relative; }
      .ct-media-video-tools { position:absolute; top:4px; right:4px; z-index:1; display:flex; align-items:center; gap:4px; }
      .ct-media-video-resolution { padding:5px 7px; border-radius:4px; background:#0009; color:#fff; white-space:nowrap; font:12px/1.4 system-ui,sans-serif; }
      .ct-media-video-inline-tools { position:relative; top:auto; right:auto; display:flex; justify-content:flex-end; margin-top:-4px; margin-bottom:4px; }
      .ct-media-video-fullscreen { display:flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:#0009; color:#fff; cursor:pointer; opacity:.8; transition:background 120ms ease-out,opacity 120ms ease-out; }
      .ct-media-video-fullscreen:hover,.ct-media-video-fullscreen:focus-visible { opacity:1; background:#000c; }
      .ct-media-video-fullscreen:focus-visible { outline:3px solid #fff; outline-offset:2px; }
      .ct-media-video-fullscreen:disabled { cursor:wait; }
      .ct-media-video-status { position:absolute; top:48px; right:0; box-sizing:border-box; width:min(270px,calc(100vw - 32px)); padding:8px 10px; border-radius:6px; background:#000e; color:#fff; font:13px/1.5 system-ui,sans-serif; }
      .ct-media-video-tools [hidden] { display:none!important; }
      .ct-media-enhanced-video:fullscreen { width:100%!important; height:100%!important; max-width:none!important; max-height:none!important; margin:0!important; object-fit:contain!important; background:#000; }
      @media(hover:hover) and (pointer:fine) { .ct-media-video-shell:not(:hover):not(:focus-within) .ct-media-video-fullscreen { opacity:.45; } }
      @media(max-width:480px) { .ct-media-video-fullscreen { opacity:1; } }
      @media(prefers-reduced-motion:reduce) { .ct-media-video-fullscreen,.ct-media-centered-viewer,.ct-media-viewer-stage > img { animation:none!important; transition:none!important; } .ct-media-viewer-stage > img { transform:none!important; opacity:1!important; } }
      @media(prefers-reduced-motion:reduce) { .ct-media-photo-track { transition:none!important; } }
    `;
    document.head.append(style);
  }
  function ctMediaEnhance(root = document) {
    ctMediaStyles();
    for (const [dialog, state] of ctMediaPhotoQuality) {
      if (!dialog.isConnected || !state.image.isConnected || !dialog.contains(state.image)) ctMediaReleasePhotoQuality(dialog);
    }
    for (const state of ctMediaVideos.values()) {
      if (!state.video.isConnected) ctMediaRemoveVideo(state);
      else if (state.context && !ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
    }
    for (const state of ctMediaGalleries.values()) {
      if (!state.grid.isConnected || !ctMediaSlides(state.grid).length) ctMediaRemoveGallery(state);
    }
    const inputs = [...root.querySelectorAll?.('input[type="file"][accept="image/*"][multiple]') || []];
    if (root.matches?.('input[type="file"][accept="image/*"][multiple]')) inputs.push(root);
    inputs.forEach(ctMediaLabelUploadControls);
    const grids = [...root.querySelectorAll?.('div.flex.snap-x.snap-mandatory.overflow-x-auto') || []];
    if (root.matches?.('div.flex.snap-x.snap-mandatory.overflow-x-auto')) grids.push(root);
    grids.forEach(ctMediaObserveGallery);
    const videos = [...root.querySelectorAll?.('video[controls]') || []];
    if (root.matches?.('video[controls]')) videos.push(root);
    videos.forEach(ctMediaEnhanceVideo);
    ctMediaCenterViewers();
    ctMediaEnhanceViewer();
  }
