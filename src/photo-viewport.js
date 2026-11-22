  // Keep photos in layout coordinates while the browser magnifies and pans
  // them. Refitting to the shrinking visual viewport would cancel the zoom.
  const ctPhotoViewportBounds = new WeakMap();
  function ctPhotoViewportZoomed() {
    const scale = window.visualViewport?.scale;
    return Number.isFinite(scale) && scale > 1.001;
  }
  function ctPhotoViewportFit(dialog, prefix) {
    const viewport = window.visualViewport;
    const zoomed = ctPhotoViewportZoomed();
    let bounds = ctPhotoViewportBounds.get(dialog);
    if (!zoomed || !bounds) {
      const scale = zoomed ? viewport.scale : 1;
      bounds = {
        width: zoomed ? document.documentElement.clientWidth || viewport.width * scale || window.innerWidth : viewport?.width || window.innerWidth,
        height: (viewport?.height || window.innerHeight) * scale,
        top: zoomed ? 0 : viewport?.offsetTop || 0,
        left: zoomed ? 0 : viewport?.offsetLeft || 0
      };
      ctPhotoViewportBounds.set(dialog, bounds);
    }
    let changed = false;
    for (const [name, value] of Object.entries(bounds)) {
      if (!Number.isFinite(value) || value < 0) continue;
      const property = prefix + name, pixels = value + 'px';
      if (dialog.style.getPropertyValue(property) !== pixels) {
        dialog.style.setProperty(property, pixels); changed = true;
      }
    }
    return { zoomed, changed };
  }

  // An inline carousel keeps its native page width, while only the selected
  // photo determines its height. The image's own box follows its decoded
  // dimensions; the unused part of a portrait page has no background/frame.
  const ctPhotoInlineFrames = new Map();
  let ctPhotoInlineResize = null;
  let ctPhotoInlineViewport = null;
  let ctPhotoInlineLifecycleBound = false;
  function ctPhotoInlineBindViewport() {
    if (ctPhotoInlineViewport) return;
    const update = () => { ctPhotoInlinePrune(); for (const current of ctPhotoInlineFrames.values()) current.update(true); };
    const viewport = window.visualViewport;
    ctPhotoInlineViewport = { update, viewport };
    window.addEventListener('resize', update, { passive: true }); viewport?.addEventListener('resize', update, { passive: true });
  }
  function ctPhotoInlineSignature(image) {
    return JSON.stringify(['src', 'srcset', 'sizes'].map(name => image.getAttribute(name) || ''));
  }
  function ctPhotoInlineDimensions(image, resource = null) {
    if (image?.tagName !== 'IMG' || !image.complete) return null;
    const source = image.getAttribute('src');
    if (!source) return null;
    if (resource && (!resource.ready || resource.signature !== ctPhotoInlineSignature(image) || resource.current !== image.currentSrc)) return null;
    // Without srcset currentSrc must be the current src. Responsive candidates
    // legitimately differ from that fallback; their completed load record is
    // tied to all three resource attributes instead.
    try {
      if (!image.getAttribute('srcset')?.trim() && image.currentSrc &&
          new URL(image.currentSrc, location.href).href !== new URL(source, location.href).href) return null;
    } catch { return null; }
    const width = image.naturalWidth, height = image.naturalHeight;
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
  }
  function ctPhotoInlineStyles() {
    if (document.getElementById('ct-photo-inline-style')) return;
    const style = document.createElement('style'); style.id = 'ct-photo-inline-style';
    style.textContent = `
      .ct-photo-fit-shell{box-sizing:border-box!important;width:100%!important;max-width:100%!important;height:var(--ct-photo-inline-height,240px)!important;max-height:none!important;aspect-ratio:auto!important;border:0!important;background:transparent!important;overflow:hidden!important}
      .ct-photo-fit-scroll-shell{overflow-x:auto!important;overflow-y:hidden!important}
      .ct-photo-fit-track{height:100%!important;align-items:flex-start!important;background:transparent!important}
      .ct-photo-fit-slide{box-sizing:border-box!important;height:100%!important;min-height:0!important;aspect-ratio:auto!important;border:0!important;background:transparent!important}
      .ct-photo-fit-opener{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;height:100%!important;min-height:0!important;padding:0!important;border:0!important;background:transparent!important}
      .ct-photo-fit-image{display:block!important;width:auto!important;height:auto!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;margin:0 auto!important;border-radius:12px}
    `;
    document.head.append(style);
  }
  function ctPhotoInlineRemove(state) {
    if (!state) return;
    state.observer.disconnect(); ctPhotoInlineResize?.unobserve?.(state.track);
    if (state.resizeFrame !== null) cancelAnimationFrame(state.resizeFrame);
    if (state.scrollFrame !== null) cancelAnimationFrame(state.scrollFrame);
    state.track.removeEventListener('scroll', state.onScroll);
    for (const image of state.images) {
      image.removeEventListener('load', state.onImage); image.removeEventListener('error', state.onImage);
      image.classList.remove('ct-photo-fit-image');
    }
    for (const slide of state.slides) slide.classList.remove('ct-photo-fit-slide');
    for (const opener of state.openers) opener.classList.remove('ct-photo-fit-opener');
    state.shell.classList.remove('ct-photo-fit-shell', 'ct-photo-fit-scroll-shell'); state.track.classList.remove('ct-photo-fit-track');
    state.shell.style.removeProperty('--ct-photo-inline-height');
    if (!state.shellHadStyle && !state.shell.style.length) state.shell.removeAttribute('style');
    for (const [node, hadClass] of state.classPresence) if (!hadClass && node.getAttribute('class') === '') node.removeAttribute('class');
    ctPhotoInlineFrames.delete(state.track);
    if (!ctPhotoInlineFrames.size && ctPhotoInlineViewport) {
      window.removeEventListener('resize', ctPhotoInlineViewport.update);
      ctPhotoInlineViewport.viewport?.removeEventListener('resize', ctPhotoInlineViewport.update);
      ctPhotoInlineViewport = null;
    }
  }
  function ctPhotoInlinePrune() {
    for (const state of ctPhotoInlineFrames.values()) if (!state.shell.isConnected || !state.track.isConnected ||
        state.images.some(image => !image.isConnected || !state.shell.contains(image))) ctPhotoInlineRemove(state);
  }
  function ctPhotoInlineAltOpen(state) {
    const image = state.images[state.index], slide = state.slides[state.index];
    const scope = slide?.contains(image) && slide !== state.openers[state.index] ? slide : state.shell;
    for (const control of scope.querySelectorAll(':scope > div.contents > button[aria-controls][aria-expanded="true"]')) {
      const panel = document.getElementById(control.getAttribute('aria-controls'));
      if (panel?.parentElement === control.parentElement && !panel.hidden &&
          panel.matches('div.absolute.overflow-y-auto') && panel.querySelector(':scope > p.whitespace-pre-wrap.break-words') &&
          panel.querySelector(':scope > button[type="button"].absolute > svg')) return true;
    }
    return false;
  }
  function ctPhotoInlineFit(shell, track, slides, openers, images, maxHeight = 510) {
    if (!shell?.isConnected || !track?.isConnected || !images.length ||
        images.some(image => image?.tagName !== 'IMG' || !shell.contains(image))) return;
    let state = ctPhotoInlineFrames.get(track);
    if (state && (state.shell !== shell || state.images.length !== images.length ||
        state.images.some((image, index) => image !== images[index]) ||
        state.slides.some((slide, index) => slide !== slides[index]) ||
        state.openers.some((opener, index) => opener !== openers[index]))) { ctPhotoInlineRemove(state); state = null; }
    if (state) { state.update(false); return state; }
    state = { shell, track, slides, openers, images, index: 0, width: 0, pageWidth: 0, maxHeight, resizeFrame: null, scrollFrame: null,
      shellHadStyle: shell.hasAttribute('style'),
      classPresence: new Map([...new Set([shell, track, ...slides, ...openers, ...images])].map(node => [node, node.hasAttribute('class')])),
      resources: new Map(images.map(image => [image, { signature: ctPhotoInlineSignature(image), current: image.currentSrc,
        ready: !!ctPhotoInlineDimensions(image) }])) };
    const selectedIndex = pageWidth => Math.max(0, Math.min(images.length - 1, Math.round(Math.abs(track.scrollLeft) / pageWidth)));
    state.update = preserveIndex => {
      if (!shell.isConnected || !track.isConnected || images.some(image => !image.isConnected || !shell.contains(image))) { ctPhotoInlineRemove(state); return; }
      // Browser pinch zoom must keep the layout-sized photo available to pan.
      if (ctPhotoViewportZoomed()) return;
      const width = track.clientWidth || track.getBoundingClientRect().width;
      if (!(width > 0)) return;
      ctPhotoInlineBindViewport();
      const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
      if (!preserveIndex) state.index = selectedIndex(width + gap);
      else if (state.scrollFrame !== null && state.pageWidth > 0) {
        // If resize/load arrives before the next frame, resolve the pending
        // selection in the old page coordinates before realigning.
        state.index = selectedIndex(state.pageWidth);
      }
      if (state.scrollFrame !== null) {
        cancelAnimationFrame(state.scrollFrame);
        state.scrollFrame = null;
      }
      if (state.resizeFrame !== null) {
        cancelAnimationFrame(state.resizeFrame);
        state.resizeFrame = null;
      }
      const changedWidth = !!state.width && Math.abs(state.width - width) > .5;
      state.width = width; state.pageWidth = width + gap;
      const dimensions = ctPhotoInlineDimensions(images[state.index], state.resources.get(images[state.index]));
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const limit = Math.max(1, Math.min(state.maxHeight, viewportHeight * .70));
      // Unknown and broken resources have a bounded neutral placeholder. Do
      // not claim the first photo's metadata is this photo's decoded size.
      // Keep the actual tiny/panoramic image at its own size while the
      // transparent surrounding opener retains a 44px pointer target.
      let height = Math.max(44, dimensions ? dimensions.height * Math.min(1, width / dimensions.width, limit / dimensions.height) : Math.min(240, limit));
      // The native ALT popup is clipped by the photo page. While it is open,
      // give its unchanged reader enough space; closing returns to photo size.
      if (ctPhotoInlineAltOpen(state)) height = Math.max(height, Math.min(240, limit));
      ctPhotoInlineStyles(); shell.classList.add('ct-photo-fit-shell');
      if (track === shell && images.length > 1) shell.classList.add('ct-photo-fit-scroll-shell');
      if (track !== shell) track.classList.add('ct-photo-fit-track');
      slides.forEach(slide => slide.classList.add('ct-photo-fit-slide'));
      openers.forEach(opener => opener.classList.add('ct-photo-fit-opener'));
      images.forEach(image => image.classList.add('ct-photo-fit-image'));
      const pixels = height + 'px';
      if (shell.style.getPropertyValue('--ct-photo-inline-height') !== pixels) shell.style.setProperty('--ct-photo-inline-height', pixels);
      if (changedWidth && preserveIndex && images.length > 1) {
        const direction = getComputedStyle(track).direction === 'rtl' ? -1 : 1;
        const target = direction * state.index * (width + gap);
        if (Math.abs(track.scrollLeft - target) > 1) track.scrollLeft = target;
      }
    };
    state.onScroll = () => {
      if (state.scrollFrame !== null) return;
      state.scrollFrame = requestAnimationFrame(() => {
        state.scrollFrame = null;
        if (ctPhotoInlineFrames.get(track) !== state || !track.isConnected ||
            !shell.isConnected || ctPhotoViewportZoomed()) return;
        if (!(state.pageWidth > 0)) { state.update(false); return; }
        // Native scroll/snap remains in control. A scroll burst just needs
        // the latest offset; movement within the same page cannot change fit.
        const index = selectedIndex(state.pageWidth);
        if (index === state.index) return;
        state.index = index;
        state.update(true);
      });
    };
    state.scheduleResize = () => {
      if (state.resizeFrame !== null) return;
      state.resizeFrame = requestAnimationFrame(() => {
        state.resizeFrame = null;
        if (ctPhotoInlineFrames.get(track) === state) state.update(true);
      });
    };
    state.onImage = event => {
      const image = event.target;
      state.resources.set(image, { signature: ctPhotoInlineSignature(image), current: image.currentSrc,
        ready: event.type === 'load' && !!ctPhotoInlineDimensions(image) });
      if (images[state.index] === image) state.update(true);
    };
    state.observer = new MutationObserver(records => {
      for (const { target: image } of records) {
        const resource = state.resources.get(image), signature = ctPhotoInlineSignature(image);
        if (resource && resource.signature !== signature) state.resources.set(image, { signature, current: '', ready: false });
      }
      state.update(true);
    });
    for (const image of images) {
      image.addEventListener('load', state.onImage); image.addEventListener('error', state.onImage);
      state.observer.observe(image, { attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'width', 'height'] });
    }
    state.observer.observe(shell, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });
    track.addEventListener('scroll', state.onScroll, { passive: true }); ctPhotoInlineFrames.set(track, state);
    if (!ctPhotoInlineResize && typeof ResizeObserver === 'function') ctPhotoInlineResize = new ResizeObserver(entries => {
      for (const entry of entries) {
        const current = ctPhotoInlineFrames.get(entry.target);
        if (current && Math.abs(current.track.clientWidth - current.width) > .5) current.scheduleResize();
      }
    });
    ctPhotoInlineResize?.observe(track);
    if (!ctPhotoInlineLifecycleBound) {
      ctPhotoInlineLifecycleBound = true;
      window.addEventListener('pagehide', () => { for (const current of ctPhotoInlineFrames.values()) ctPhotoInlineRemove(current); });
    }
    state.update(false);
    return state;
  }
