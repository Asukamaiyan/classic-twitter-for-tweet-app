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
