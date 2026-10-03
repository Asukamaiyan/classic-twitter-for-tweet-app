  // Reuse the native upload UI: it validates and uploads one File at a time.
  // No media quotas, server formats, transcoding settings or post submissions
  // are changed here. In particular, accepting a file does not promise 4K HDR.
  const ctMediaUploads = new WeakMap();
  const ctMediaUploadEvents = new WeakSet();
  const ctMediaCarousels = new Map();
  const ctMediaCenteredViewers = new Map();
  const ctMediaVideos = new Map();
  let ctMediaViewportBound = false;
  let ctMediaTransferSupported;
  let ctMediaPendingViewer = null;
  let ctMediaViewer = null;
  const ctMediaPhotoAccept = 'image/jpeg,image/png,image/webp';

  function ctMediaJapanese() { return CT_LOCALE === 'ja'; }
  function ctMediaCanTransfer() {
    if (ctMediaTransferSupported !== undefined) return ctMediaTransferSupported;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(new File([], 'ct-capability-check.jpg', { type: 'image/jpeg' }));
      const probe = document.createElement('input');
      probe.type = 'file';
      probe.files = transfer.files;
      ctMediaTransferSupported = probe.files.length === 1;
    } catch { ctMediaTransferSupported = false; }
    return ctMediaTransferSupported;
  }
  function ctMediaUploadRoot(input) {
    if (!input.matches(`input[type="file"][accept="${ctMediaPhotoAccept}"]`) ||
        input.closest('[data-ct-local-ui]')) return null;
    const toolbar = input.parentElement;
    const root = toolbar?.parentElement;
    if (!toolbar?.matches('div.flex.items-center') || !root?.matches('div.w-full.mt-3.space-y-3') ||
        ![...toolbar.children].some(el => el.matches('input[type="file"][accept="video/mp4,video/quicktime"]'))) return null;
    const actions = [...toolbar.children].find(el => el.matches('div.flex.items-center'));
    const buttons = actions ? [...actions.children].filter(el => el.tagName === 'BUTTON') : [];
    // Tweet 2.1 adds a poll toggle beside the two media controls. Identify the
    // verified native icons rather than counting buttons or treating poll as video.
    const photos = buttons.filter(el => el.querySelector(':scope > svg.lucide-image'));
    const videos = buttons.filter(el => el.querySelector(':scope > svg.lucide-video'));
    return photos.length === 1 && videos.length === 1
      ? { root, toolbar, photoButton: photos[0], videoButton: videos[0] } : null;
  }
  function ctMediaPreviews(root) { return [...root.querySelectorAll('img[alt="Upload preview"]')]; }
  function ctMediaPreviewReady(image) {
    return [...(image.parentElement?.children || [])].some(el => el.matches('div.absolute.bottom-2.left-2') &&
      el.classList.contains('bg-emerald-500/90'));
  }
  function ctMediaUploadError(root) {
    const error = [...root.children].find(el => el.matches('div.text-red-500'));
    return error?.textContent?.trim() || '';
  }
  function ctMediaUploadStatus(state, text, busy = false) {
    if (!state.status?.isConnected) {
      const status = document.createElement('div');
      status.className = 'ct-media-upload-status';
      status.dataset.ctLocalUi = 'media-upload';
      const label = document.createElement('span');
      label.setAttribute('role', 'status');
      label.setAttribute('aria-live', 'polite');
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = ctMediaJapanese() ? '残りを中止' : 'Stop remaining';
      cancel.addEventListener('click', event => {
        event.stopPropagation();
        state.cancelled = true;
        state.wake?.();
      });
      status.append(label, cancel);
      state.root.append(status);
      state.status = status;
      state.label = label;
      state.cancel = cancel;
    }
    if (state.label.textContent !== text) state.label.textContent = text;
    state.cancel.hidden = !busy;
  }
  function ctMediaWaitForPhoto(state, previousSources) {
    return new Promise(resolve => {
      let complete = false;
      const finish = result => {
        if (complete) return;
        complete = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timeout);
        clearTimeout(initial);
        state.wake = null;
        resolve(result);
      };
      const check = () => {
        if (state.cancelled || !state.input.isConnected || !state.root.isConnected ||
            location.pathname !== state.path) { finish('cancelled'); return; }
        if (ctMediaUploadError(state.root)) { finish('error'); return; }
        const photos = ctMediaPreviews(state.root);
        if (photos.length < previousSources.length) { finish('cancelled'); return; }
        const remaining = previousSources.slice();
        const added = photos.filter(photo => {
          const index = remaining.indexOf(photo.getAttribute('src'));
          if (index < 0) return true;
          remaining.splice(index, 1);
          return false;
        });
        if (remaining.length) { finish('cancelled'); return; }
        if (added.length === 1 && ctMediaPreviewReady(added[0])) finish('ready');
      };
      // Start after the native change handler and React's state update. A stale
      // validation error may still be in the DOM during dispatchEvent itself.
      const observer = new MutationObserver(check);
      observer.observe(state.root, { childList: true, subtree: true, attributes: true, characterData: true });
      const poll = setInterval(check, 100);
      const timeout = setTimeout(() => finish('timeout'), 120000);
      const initial = setTimeout(check, 0);
      state.wake = check;
    });
  }
  async function ctMediaQueuePhotos(input, media, files) {
    const state = ctMediaUploads.get(input);
    if (state.busy) return;
    const existing = ctMediaPreviews(media.root).length;
    const available = Math.max(0, 4 - existing); // The observed native toolbar also caps at four.
    const selected = files.slice(0, available);
    const skipped = files.length - selected.length;
    const ja = ctMediaJapanese();
    if (media.photoButton.disabled || media.root.querySelector('video') || !selected.length) {
      ctMediaUploadStatus(state, ja ? '現在は写真を追加できません。既存の添付とアップロード状態を確認してください。' :
        'Photos cannot be added now. Check existing attachments and upload status.');
      input.value = '';
      return;
    }
    state.busy = true;
    state.cancelled = false;
    state.path = location.pathname;
    let completed = 0;
    let result = 'ready';
    try {
      for (const file of selected) {
        if (state.cancelled || !input.isConnected || location.pathname !== state.path) { result = 'cancelled'; break; }
        const before = ctMediaPreviews(media.root).map(photo => photo.getAttribute('src'));
        ctMediaUploadStatus(state, ja ? `写真を追加中 ${completed + 1} / ${selected.length}` :
          `Adding photos ${completed + 1} / ${selected.length}`, true);
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        const event = new Event('change', { bubbles: true });
        ctMediaUploadEvents.add(event);
        input.dispatchEvent(event);
        result = await ctMediaWaitForPhoto(state, before);
        if (result !== 'ready') break;
        completed++;
      }
    } catch { result = 'error'; }
    finally {
      state.busy = false;
      input.value = '';
      const count = ja ? `${completed}枚を追加しました。` : `${completed} photo(s) added. `;
      const reason = result === 'ready' ? (skipped ? (ja ? `1投稿4枚までのため、残り${skipped}枚は追加していません。` :
        `${skipped} remaining photo(s) were not added because a post accepts four.`) : '') :
        result === 'cancelled' ? (ja ? '残りの追加を中止しました。処理中の1枚は完了する場合があります。' :
          'Remaining photos stopped. The photo already uploading may still finish.') :
        result === 'timeout' ? (ja ? '完了を確認できないため、残りは停止しました。添付の状態を確認してください。' :
          'Completion could not be confirmed. Remaining photos stopped; check the attachments.') :
          (ja ? 'エラーのため残りは停止しました。標準のエラー表示を確認してください。' :
            'Remaining photos stopped after an error. Check the native error message.');
      if (state.root.isConnected) ctMediaUploadStatus(state, count + reason);
    }
  }
  function ctMediaEnhanceInput(input) {
    if (ctMediaUploads.has(input) || !ctMediaCanTransfer()) return;
    const media = ctMediaUploadRoot(input);
    if (!media || input.multiple) return; // A future native multi-file handler owns its own input.
    const state = { input, root: media.root, busy: false, cancelled: false };
    ctMediaUploads.set(input, state);
    input.multiple = true;
    input.addEventListener('change', event => {
      if (ctMediaUploadEvents.has(event)) return;
      const files = [...(input.files || [])];
      if (!state.busy && files.length <= 1) return;
      event.stopImmediatePropagation();
      if (!state.busy) void ctMediaQueuePhotos(input, media, files);
    }, true);
    // Home's submit is in oS.actionRight; modal submit is its sibling and
    // reply composers use a role=form ancestor with a Ctrl/Cmd+Enter handler.
    const replyForm = media.root.closest('[role="form"]');
    const parent = media.root.parentElement;
    const scope = replyForm || (parent?.querySelector('textarea#public-tweet-input,textarea#public-modal-tweet-input') ? parent : media.root);
    scope.addEventListener('click', event => {
      if (!state.busy || event.target.closest('[data-ct-local-ui="media-upload"]')) return;
      const button = event.target.closest('button,input');
      if (button && (media.root.contains(button) || replyForm?.contains(button) ||
          button.matches('#public-tweet-submit-btn,#public-modal-tweet-submit-btn'))) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    scope.addEventListener('keydown', event => {
      if (state.busy && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.matches('textarea')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    scope.addEventListener('submit', event => {
      if (state.busy) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }

  function ctMediaSlides(grid) {
    if (!grid.matches('div.grid.gap-0\\.5.rounded-2xl.overflow-hidden.border') ||
        !grid.closest('main,article') || grid.closest('[data-ct-local-ui],blockquote,[aria-label^="Quoted post"]')) return [];
    const slides = [...grid.children];
    if (slides.length < 2 || slides.some(slide => !slide.matches('div.relative.overflow-hidden') ||
        slide.children.length !== 1 || !slide.firstElementChild.matches('img[alt="Attached media"].cursor-pointer'))) return [];
    return slides;
  }
  function ctMediaCarouselIndex(state) {
    const width = state.grid.clientWidth;
    return width ? Math.max(0, Math.min(state.slides.length - 1, Math.round(state.grid.scrollLeft / width))) : state.index;
  }
  function ctMediaUpdateCarousel(state) {
    state.index = ctMediaCarouselIndex(state);
    const count = `${state.index + 1} / ${state.slides.length}`;
    if (state.count.textContent !== count) state.count.textContent = count;
    if (state.prev.disabled !== (state.index === 0)) state.prev.disabled = state.index === 0;
    if (state.next.disabled !== (state.index === state.slides.length - 1)) state.next.disabled = state.index === state.slides.length - 1;
  }
  function ctMediaMoveCarousel(state, index) {
    state.index = Math.max(0, Math.min(state.slides.length - 1, index));
    const left = state.index * state.grid.clientWidth;
    const behavior = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (typeof state.grid.scrollTo === 'function') state.grid.scrollTo({ left, behavior });
    else state.grid.scrollLeft = left;
    // Native scrolling emits scroll events while moving; keep an immediate
    // update as well for keyboard access and browsers without smooth scrolling.
    const count = `${state.index + 1} / ${state.slides.length}`;
    if (state.count.textContent !== count) state.count.textContent = count;
    state.prev.disabled = state.index === 0;
    state.next.disabled = state.index === state.slides.length - 1;
  }
  function ctMediaRemoveCarousel(state) {
    state.grid.classList.remove('ct-media-carousel');
    for (const [name, value] of state.attributes) {
      if (value === null) state.grid.removeAttribute(name);
      else state.grid.setAttribute(name, value);
    }
    state.grid.removeEventListener('scroll', state.onScroll);
    state.grid.removeEventListener('keydown', state.onKey);
    state.grid.removeEventListener('click', state.onClick, true);
    state.resize?.disconnect();
    state.controls.remove();
    ctMediaCarousels.delete(state.grid);
  }
  function ctMediaApplyCarousel(state) {
    const grid = state.grid;
    if (!grid.classList.contains('ct-media-carousel')) grid.classList.add('ct-media-carousel');
    const attributes = {
      tabindex: '0', role: 'region',
      'aria-label': ctMediaJapanese() ? '投稿の写真' : 'Post photos',
      'aria-roledescription': ctMediaJapanese() ? 'カルーセル' : 'carousel'
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (grid.getAttribute(name) !== value) grid.setAttribute(name, value);
    }
  }
  function ctMediaEnhanceCarousel(grid) {
    const slides = ctMediaSlides(grid);
    if (!slides.length) return;
    const existing = ctMediaCarousels.get(grid);
    if (existing) {
      existing.slides = slides;
      ctMediaApplyCarousel(existing);
      if (!existing.controls.isConnected) grid.after(existing.controls);
      ctMediaUpdateCarousel(existing);
      return;
    }
    const controls = document.createElement('div');
    controls.className = 'ct-media-carousel-controls';
    controls.dataset.ctLocalUi = 'media-carousel';
    const prev = document.createElement('button');
    const next = document.createElement('button');
    const count = document.createElement('span');
    prev.type = next.type = 'button';
    prev.textContent = '‹'; next.textContent = '›';
    prev.setAttribute('aria-label', ctMediaJapanese() ? '前の写真' : 'Previous photo');
    next.setAttribute('aria-label', ctMediaJapanese() ? '次の写真' : 'Next photo');
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    controls.append(prev, count, next);
    controls.addEventListener('click', event => event.stopPropagation());
    const state = { grid, slides, controls, prev, next, count, index: 0,
      attributes: ['tabindex', 'role', 'aria-label', 'aria-roledescription'].map(name => [name, grid.getAttribute(name)]) };
    prev.addEventListener('click', () => ctMediaMoveCarousel(state, state.index - 1));
    next.addEventListener('click', () => ctMediaMoveCarousel(state, state.index + 1));
    state.onScroll = () => ctMediaUpdateCarousel(state);
    state.onKey = event => {
      if (event.target !== grid || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? state.slides.length - 1 :
        state.index + (event.key === 'ArrowRight' ? 1 : -1);
      ctMediaMoveCarousel(state, index);
    };
    grid.addEventListener('scroll', state.onScroll, { passive: true });
    grid.addEventListener('keydown', state.onKey);
    state.onClick = event => {
      const index = state.slides.findIndex(slide => slide.firstElementChild === event.target);
      if (index >= 0) ctMediaPendingViewer = { state, index, at: Date.now(), context: ctMediaPhotoContext() };
    };
    grid.addEventListener('click', state.onClick, true);
    ctMediaApplyCarousel(state);
    grid.after(controls);
    if (typeof ResizeObserver === 'function') {
      state.width = grid.clientWidth;
      state.resize = new ResizeObserver(() => {
        const width = grid.clientWidth;
        if (!width || width === state.width) return;
        state.width = width;
        // Height-only image loads must not restart scrolling or undo a swipe.
        const left = state.index * width;
        if (typeof grid.scrollTo === 'function') grid.scrollTo({ left, behavior: 'auto' });
        else grid.scrollLeft = left;
      });
      state.resize.observe(grid);
    }
    ctMediaCarousels.set(grid, state);
    ctMediaUpdateCarousel(state);
  }
  function ctMediaClearViewer() {
    if (!ctMediaViewer) return;
    const viewer = ctMediaViewer;
    viewer.observer?.disconnect();
    clearTimeout(viewer.requestTimer);
    ctMediaResetPhotoMotion(viewer);
    viewer.stage?.classList.remove('ct-media-swipe-stage');
    viewer.controls.remove();
    document.removeEventListener('keydown', viewer.onKey, true);
    viewer.dialog.removeEventListener('touchstart', viewer.onTouchStart);
    viewer.dialog.removeEventListener('touchmove', viewer.onTouchMove);
    viewer.dialog.removeEventListener('touchend', viewer.onTouchEnd);
    viewer.dialog.removeEventListener('touchcancel', viewer.onCancel);
    for (const [name, handler] of [['pointerdown', viewer.onPointerStart], ['pointermove', viewer.onPointerMove],
        ['pointerup', viewer.onPointerEnd], ['pointercancel', viewer.onCancel], ['lostpointercapture', viewer.onCancel],
        ['click', viewer.onClick]]) if (handler) viewer.dialog.removeEventListener(name, handler, name === 'click');
    document.removeEventListener('visibilitychange', viewer.onVisibility);
    window.removeEventListener('pagehide', viewer.onPageHide);
    viewer.dialog.removeEventListener('dragstart', viewer.onDragStart);
    viewer.reduce?.removeEventListener?.('change', viewer.onReduce);
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
  function ctMediaPhotoLayer(viewer, target) {
    if (viewer.motion) return viewer.motion;
    const image = viewer.dialog.querySelector('img[alt="Media preview"]');
    // Only add presentation inside the verified native stage; React keeps its
    // image, src, click handlers, close button and backdrop throughout.
    if (!viewer.stage || image?.parentElement !== viewer.stage ||
        viewer.reduce?.matches) return null;
    const layer = document.createElement('div');
    layer.className = 'ct-media-photo-layer'; layer.dataset.ctLocalUi = 'photo-motion';
    layer.setAttribute('aria-hidden', 'true');
    const track = document.createElement('div'); track.className = 'ct-media-photo-track';
    const slides = ctMediaSlides(viewer.state.grid);
    for (const index of [target < viewer.index ? target : viewer.index - 1, viewer.index,
        target > viewer.index ? target : viewer.index + 1]) {
      const pane = document.createElement('div'); pane.className = 'ct-media-photo-pane';
      const original = slides[index]?.firstElementChild;
      if (original) {
        const photo = document.createElement('img'); photo.alt = ''; photo.draggable = false;
        photo.referrerPolicy = image.referrerPolicy; photo.src = original.src; pane.append(photo);
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
  function ctMediaFinishPhoto(viewer, index, commit) {
    if (!ctMediaPhotoViewerValid(viewer)) { ctMediaClearViewer(); return; }
    const motion = viewer.motion;
    const oldIndex = viewer.index;
    const image = ctMediaSlides(viewer.state.grid)[index]?.firstElementChild;
    if (commit && image) {
      viewer.requestedIndex = index;
      viewer.prev.disabled = viewer.next.disabled = true;
      viewer.requestTimer = setTimeout(() => {
        if (ctMediaViewer !== viewer) return;
        viewer.requestedIndex = null;
        ctMediaResetPhotoMotion(viewer);
        ctMediaEnhanceViewer();
      }, 1600);
      image.click(); ctMediaEnhanceViewer();
    }
    if (!motion) return;
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
    if (!ctMediaPhotoViewerValid(viewer) || viewer.motion || viewer.requestedIndex != null || window.visualViewport?.scale > 1 ||
        !event.target.matches?.('img[alt="Media preview"]')) return;
    viewer.touch = { x: point.clientX, y: point.clientY, at: performance.now(), dx: 0, locked: false,
      pointer: event.pointerId, width: viewer.stage?.clientWidth || window.innerWidth };
  }
  function ctMediaDragPhoto(viewer, event, point) {
    const touch = viewer.touch;
    if (!touch || !ctMediaPhotoViewerValid(viewer)) { ctMediaResetPhotoMotion(viewer); return; }
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
    const viewport = window.visualViewport;
    const values = {
      '--ct-media-view-top': `${viewport?.offsetTop || 0}px`,
      '--ct-media-view-left': `${viewport?.offsetLeft || 0}px`,
      '--ct-media-view-width': `${viewport?.width || window.innerWidth}px`,
      '--ct-media-view-height': `${viewport?.height || window.innerHeight}px`
    };
    for (const [key, value] of Object.entries(values)) {
      if (dialog.style.getPropertyValue(key) !== value) dialog.style.setProperty(key, value);
    }
  }
  function ctMediaCenterViewers() {
    for (const [dialog, state] of ctMediaCenteredViewers) {
      if (dialog.isConnected && dialog.querySelector('img[alt="Media preview"]')) continue;
      dialog.classList.remove('ct-media-centered-viewer', 'ct-media-viewport-viewer');
      state.stage.classList.remove('ct-media-viewer-stage');
      state.header?.classList.remove('ct-media-viewer-header');
      for (const key of ['top', 'left', 'width', 'height']) dialog.style.removeProperty(`--ct-media-view-${key}`);
      ctMediaCenteredViewers.delete(dialog);
    }
    for (const dialog of document.querySelectorAll('div[role="dialog"][aria-modal="true"][aria-label="Media viewer"]')) {
      const image = dialog.querySelector('img[alt="Media preview"]');
      const stage = image?.parentElement;
      if (!stage || stage.parentElement !== dialog) continue;
      const previous = ctMediaCenteredViewers.get(dialog);
      if (previous && previous.stage !== stage) previous.stage.classList.remove('ct-media-viewer-stage');
      const header = [...dialog.children].find(el => el !== stage && el.querySelector('[aria-label="Close media viewer"]'));
      dialog.classList.add('ct-media-centered-viewer');
      // Contained native viewers remain inside their existing modal. Only the
      // verified fixed viewer follows the visible viewport on mobile browsers.
      dialog.classList.toggle('ct-media-viewport-viewer', dialog.classList.contains('fixed'));
      stage.classList.add('ct-media-viewer-stage');
      header?.classList.add('ct-media-viewer-header');
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
    controls.append(button, status);
    controls.addEventListener('click', event => event.stopPropagation());
    const state = { video, shell, controls, button, status, context: null, pauseGuard: null,
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
    state.onInvalid = () => { if (state.context && !ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true); };
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
    window.addEventListener('pagehide', state.onPageHide);
    state.observer = new MutationObserver(state.onInvalid);
    state.observer.observe(video, { attributes: true, attributeFilter: ['src'], childList: true, subtree: true });
    shell.classList.add('ct-media-video-shell'); video.classList.add('ct-media-enhanced-video'); video.after(controls);
    ctMediaVideos.set(video, state);
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
    window.removeEventListener('pagehide', state.onPageHide);
    state.controls.remove(); state.shell.classList.remove('ct-media-video-shell');
    state.video.classList.remove('ct-media-enhanced-video');
    ctMediaVideos.delete(state.video);
  }
  function ctMediaEnhanceViewer() {
    const active = ctMediaViewer;
    if (active && !ctMediaPhotoViewerValid(active)) ctMediaClearViewer();
    const pending = ctMediaPendingViewer;
    if (!pending || pending.context !== ctMediaPhotoContext() || document.hidden ||
        !pending.state.grid.isConnected || Date.now() - pending.at > 5000) return;
    // Native commits can arrive after our bounded request has expired. With no
    // outstanding request, the native image is the authority for the counter.
    if (ctMediaViewer?.state === pending.state && ctMediaViewer.requestedIndex == null) {
      const source = ctMediaViewer.dialog.querySelector('img[alt="Media preview"]')?.src;
      const actual = ctMediaSlides(pending.state.grid).findIndex(slide => slide.firstElementChild.src === source);
      if (actual >= 0) pending.index = actual;
    }
    const source = pending.state.slides[pending.index]?.firstElementChild?.src;
    if (!source) return;
    const dialog = [...document.querySelectorAll('div[role="dialog"][aria-modal="true"][aria-label="Media viewer"]')]
      .find(el => el.querySelector('img[alt="Media preview"]')?.src === source);
    if (!dialog) return;
    if (ctMediaViewer?.dialog !== dialog || ctMediaViewer?.state !== pending.state) {
      ctMediaClearViewer();
      const controls = document.createElement('div');
      controls.className = 'ct-media-carousel-controls ct-media-viewer-controls';
      controls.dataset.ctLocalUi = 'media-viewer';
      const prev = document.createElement('button');
      const next = document.createElement('button');
      const count = document.createElement('span');
      prev.type = next.type = 'button';
      prev.textContent = '‹'; next.textContent = '›';
      prev.setAttribute('aria-label', ctMediaJapanese() ? '前の写真' : 'Previous photo');
      next.setAttribute('aria-label', ctMediaJapanese() ? '次の写真' : 'Next photo');
      count.setAttribute('role', 'status');
      count.setAttribute('aria-live', 'polite');
      controls.append(prev, count, next);
      controls.addEventListener('click', event => event.stopPropagation());
      const preview = dialog.querySelector('img[alt="Media preview"]');
      const stage = preview?.parentElement !== dialog && preview?.parentElement?.parentElement === dialog ? preview.parentElement : null;
      const viewer = { dialog, state: pending.state, controls, prev, next, count, index: pending.index,
        stage, context: pending.context, sources: ctMediaSlides(pending.state.grid).map(slide => slide.firstElementChild.src).join('\n') };
      viewer.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      viewer.onReduce = () => { if (viewer.reduce.matches) { ctMediaResetPhotoMotion(viewer); ctMediaEnhanceViewer(); } };
      viewer.reduce?.addEventListener?.('change', viewer.onReduce);
      stage?.classList.add('ct-media-swipe-stage');
      const move = index => {
        const slides = ctMediaSlides(viewer.state.grid);
        if (!ctMediaPhotoViewerValid(viewer)) { ctMediaClearViewer(); return; }
        if (viewer.motion || viewer.requestedIndex != null) return;
        index = Math.max(0, Math.min(slides.length - 1, index));
        if (index === viewer.index) return;
        ctMediaResetPhotoMotion(viewer);
        ctMediaPhotoLayer(viewer, index);
        ctMediaFinishPhoto(viewer, index, true);
      };
      prev.addEventListener('click', () => move(viewer.index - 1));
      next.addEventListener('click', () => move(viewer.index + 1));
      viewer.onKey = event => {
        if (!dialog.isConnected || event.altKey || event.ctrlKey || event.metaKey ||
            event.target.closest?.('input,textarea,[contenteditable="true"]') ||
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        move(event.key === 'Home' ? 0 : event.key === 'End' ? viewer.state.slides.length - 1 :
          viewer.index + (event.key === 'ArrowRight' ? 1 : -1));
      };
      viewer.onCancel = () => { if (viewer.touch) ctMediaResetPhotoMotion(viewer); };
      viewer.onVisibility = () => { if (document.hidden) ctMediaResetPhotoMotion(viewer); };
      viewer.onPageHide = () => ctMediaResetPhotoMotion(viewer);
      viewer.onDragStart = event => { if (viewer.touch && event.target.matches?.('img[alt="Media preview"]')) event.preventDefault(); };
      dialog.addEventListener('dragstart', viewer.onDragStart);
      viewer.onClick = event => {
        if (Date.now() < (viewer.suppressClickUntil || 0) &&
            (event.target === viewer.stage || event.target.matches?.('img[alt="Media preview"]'))) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      };
      if (typeof window.PointerEvent === 'function') {
        viewer.onPointerStart = event => {
          if (event.isPrimary === false) { ctMediaResetPhotoMotion(viewer); return; }
          if (event.button === 0) ctMediaStartPhotoGesture(viewer, event, event);
        };
        viewer.onPointerMove = event => { if (viewer.touch?.pointer === event.pointerId) ctMediaDragPhoto(viewer, event, event); };
        viewer.onPointerEnd = event => { if (viewer.touch?.pointer === event.pointerId) ctMediaEndPhotoGesture(viewer, event, event); };
        for (const [name, handler] of [['pointerdown', viewer.onPointerStart], ['pointermove', viewer.onPointerMove],
            ['pointerup', viewer.onPointerEnd], ['pointercancel', viewer.onCancel], ['lostpointercapture', viewer.onCancel]]) dialog.addEventListener(name, handler);
      } else {
        viewer.onTouchStart = event => {
          if (event.touches.length === 1) ctMediaStartPhotoGesture(viewer, event, event.touches[0]);
          else ctMediaResetPhotoMotion(viewer);
        };
        viewer.onTouchMove = event => {
          if (event.touches.length === 1) ctMediaDragPhoto(viewer, event, event.touches[0]);
          else ctMediaResetPhotoMotion(viewer);
        };
        viewer.onTouchEnd = event => { if (event.changedTouches.length === 1) ctMediaEndPhotoGesture(viewer, event, event.changedTouches[0]); };
        dialog.addEventListener('touchstart', viewer.onTouchStart, { passive: true });
        dialog.addEventListener('touchmove', viewer.onTouchMove, { passive: false });
        dialog.addEventListener('touchend', viewer.onTouchEnd, { passive: true });
        dialog.addEventListener('touchcancel', viewer.onCancel);
      }
      dialog.addEventListener('click', viewer.onClick, true);
      document.addEventListener('visibilitychange', viewer.onVisibility);
      window.addEventListener('pagehide', viewer.onPageHide);
      document.addEventListener('keydown', viewer.onKey, true);
      dialog.append(controls);
      ctMediaViewer = viewer;
      // rE reuses its image and React can commit src after click() returns. The
      // shared UI observer intentionally does not watch src, so watch this one
      // verified dialog until it closes, instead of polling or rewriting src.
      viewer.observer = new MutationObserver(() => ctMediaEnhanceViewer());
      viewer.observer.observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
    ctMediaViewer.index = pending.index;
    if (ctMediaViewer.requestedIndex === pending.index) {
      ctMediaViewer.requestedIndex = null;
      clearTimeout(ctMediaViewer.requestTimer);
    }
    const count = `${pending.index + 1} / ${pending.state.slides.length}`;
    if (ctMediaViewer.count.textContent !== count) ctMediaViewer.count.textContent = count;
    const busy = !!ctMediaViewer.motion || ctMediaViewer.requestedIndex != null;
    ctMediaViewer.prev.disabled = busy || pending.index === 0;
    ctMediaViewer.next.disabled = busy || pending.index === pending.state.slides.length - 1;
  }
  function ctMediaStyles() {
    if (document.getElementById('ct-media-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-media-style';
    style.textContent = `
      .ct-media-carousel { display:flex!important; gap:0!important; width:100%; min-width:0; overflow-x:auto!important; overflow-y:hidden!important; scroll-snap-type:x mandatory; overscroll-behavior-x:contain; -webkit-overflow-scrolling:touch; }
      .ct-media-carousel > div { flex:0 0 100%; min-width:0; aspect-ratio:auto!important; scroll-snap-align:start; scroll-snap-stop:always; display:flex; align-items:center; justify-content:center; }
      .ct-media-carousel > div > img { width:100%; height:auto!important; max-height:min(70vh, 510px); object-fit:contain!important; }
      .ct-media-carousel:focus-visible { outline:3px solid var(--color-tl-app-primary,#1688d4); outline-offset:2px; }
      .ct-media-carousel-controls { display:flex; align-items:center; justify-content:center; gap:12px; margin-top:4px; font:13px/1.4 system-ui,sans-serif; color:var(--color-tl-app-text-muted,#657786); }
      .ct-media-carousel-controls button { min-width:44px; min-height:44px; border:0; border-radius:50%; color:inherit; background:transparent; font:26px/1 system-ui,sans-serif; cursor:pointer; }
      .ct-media-carousel-controls button:hover:not(:disabled) { background:var(--color-tl-app-bg,#edf3f8); }
      .ct-media-carousel-controls button:disabled { opacity:.3; cursor:default; }
      .ct-media-carousel-controls button:focus-visible,.ct-media-upload-status button:focus-visible { outline:3px solid var(--color-tl-app-primary,#1688d4); }
      .ct-media-centered-viewer { overflow:hidden!important; }
      .ct-media-viewport-viewer { inset:auto!important; top:var(--ct-media-view-top,0)!important; left:var(--ct-media-view-left,0)!important; width:var(--ct-media-view-width,100vw)!important; height:var(--ct-media-view-height,100dvh)!important; }
      .ct-media-centered-viewer > .ct-media-viewer-header { position:absolute!important; top:0; left:0; right:0; z-index:2; padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 12px max(12px,env(safe-area-inset-left))!important; pointer-events:none; }
      .ct-media-centered-viewer > .ct-media-viewer-header button { pointer-events:auto; min-width:44px; min-height:44px; }
      .ct-media-centered-viewer > .ct-media-viewer-stage { position:absolute!important; inset:0; box-sizing:border-box; width:100%; height:100%; min-height:0; min-width:0; display:flex!important; align-items:center!important; justify-content:center!important; padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-right)) calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left))!important; }
      .ct-media-viewer-stage > img { display:block; width:auto!important; height:auto!important; max-width:100%!important; max-height:100%!important; object-fit:contain!important; }
      .ct-media-swipe-stage { touch-action:pan-y pinch-zoom; }
      .ct-media-photo-covered { opacity:0!important; }
      .ct-media-photo-layer { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
      .ct-media-photo-track { display:flex; width:100%; height:100%; will-change:transform; }
      .ct-media-photo-pane { flex:0 0 100%; min-width:0; height:100%; display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-right)) calc(64px + max(env(safe-area-inset-top),env(safe-area-inset-bottom))) max(12px,env(safe-area-inset-left)); }
      .ct-media-photo-pane img { width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain; user-select:none; }
      .ct-media-viewer-controls { position:absolute; left:0; right:0; bottom:0; z-index:2; flex-shrink:0; margin:0; padding:0 12px max(12px,env(safe-area-inset-bottom)); color:white; }
      .ct-media-viewer-controls button:hover:not(:disabled) { background:#ffffff26; }
      .ct-media-video-shell { position:relative; }
      .ct-media-video-tools { position:absolute; top:4px; right:4px; z-index:1; }
      .ct-media-video-inline-tools { position:relative; top:auto; right:auto; display:flex; justify-content:flex-end; margin-top:-4px; margin-bottom:4px; }
      .ct-media-video-fullscreen { display:flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:#0009; color:#fff; cursor:pointer; opacity:.8; transition:background 120ms ease-out,opacity 120ms ease-out; }
      .ct-media-video-fullscreen:hover,.ct-media-video-fullscreen:focus-visible { opacity:1; background:#000c; }
      .ct-media-video-fullscreen:focus-visible { outline:3px solid #fff; outline-offset:2px; }
      .ct-media-video-fullscreen:disabled { cursor:wait; }
      .ct-media-video-status { position:absolute; top:48px; right:0; box-sizing:border-box; width:min(270px,calc(100vw - 32px)); padding:8px 10px; border-radius:6px; background:#000e; color:#fff; font:13px/1.5 system-ui,sans-serif; }
      .ct-media-video-tools [hidden] { display:none!important; }
      .ct-media-enhanced-video:fullscreen { width:100%!important; height:100%!important; max-width:none!important; max-height:none!important; margin:0!important; object-fit:contain!important; background:#000; }
      @media(hover:hover) and (pointer:fine) { .ct-media-video-shell:not(:hover):not(:focus-within) .ct-media-video-fullscreen { opacity:.45; } }
      @media(max-width:480px) { .ct-media-viewer-controls { gap:24px; } .ct-media-video-fullscreen { opacity:1; } }
      .ct-media-upload-status { display:flex; align-items:center; gap:10px; font:13px/1.5 system-ui,sans-serif; color:var(--color-tl-app-text-muted,#657786); }
      .ct-media-upload-status button { flex-shrink:0; min-height:44px; padding:5px 10px; border:1px solid var(--color-tl-app-border,#b8c5d1); border-radius:8px; color:inherit; background:transparent; cursor:pointer; }
      .ct-media-upload-status [hidden] { display:none!important; }
      @media(prefers-reduced-motion:reduce) { .ct-media-carousel { scroll-behavior:auto!important; } .ct-media-video-fullscreen,.ct-media-centered-viewer,.ct-media-viewer-stage > img { animation:none!important; transition:none!important; } .ct-media-viewer-stage > img { transform:none!important; opacity:1!important; } }
      @media(prefers-reduced-motion:reduce) { .ct-media-photo-track { transition:none!important; } }
    `;
    document.head.append(style);
  }
  function ctMediaEnhance(root = document) {
    ctMediaStyles();
    for (const state of ctMediaVideos.values()) {
      if (!state.video.isConnected) ctMediaRemoveVideo(state);
      else if (state.context && !ctMediaVideoContextMatches(state)) ctMediaVideoEnd(state, true);
    }
    for (const state of ctMediaCarousels.values()) {
      if (!state.grid.isConnected || !ctMediaSlides(state.grid).length) ctMediaRemoveCarousel(state);
    }
    const inputs = [...root.querySelectorAll?.(`input[type="file"][accept="${ctMediaPhotoAccept}"]`) || []];
    if (root.matches?.(`input[type="file"][accept="${ctMediaPhotoAccept}"]`)) inputs.push(root);
    for (const input of inputs) {
      const media = ctMediaUploadRoot(input);
      if (media) {
        for (const [button, label] of [[media.photoButton, ctMediaJapanese() ? '写真を追加' : 'Add photos'],
            [media.videoButton, ctMediaJapanese() ? '動画を追加' : 'Add video']]) {
          // Current native toolbar icons have no accessible name. Preserve a
          // future native label, but keep our own label through React updates.
          const current = button.getAttribute('aria-label');
          if (!current || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(current)) {
            if (current !== label) button.setAttribute('aria-label', label);
            if (!button.title || /^(?:写真を追加|動画を追加|Add photos|Add video)$/.test(button.title)) {
              if (button.title !== label) button.title = label;
            }
          }
        }
      }
      ctMediaEnhanceInput(input);
    }
    const grids = [...root.querySelectorAll?.('div.grid.rounded-2xl.overflow-hidden.border') || []];
    if (root.matches?.('div.grid.rounded-2xl.overflow-hidden.border')) grids.push(root);
    grids.forEach(ctMediaEnhanceCarousel);
    const videos = [...root.querySelectorAll?.('video[controls]') || []];
    if (root.matches?.('video[controls]')) videos.push(root);
    videos.forEach(ctMediaEnhanceVideo);
    ctMediaCenterViewers();
    ctMediaEnhanceViewer();
  }
