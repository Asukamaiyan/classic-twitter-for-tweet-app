  function ctSafariText(ja, en) {
    return typeof CT_LOCALE !== 'undefined' && CT_LOCALE === 'en' ? en : ja;
  }

  function ctFormatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return ctSafariText('取得できません', 'Unavailable');
    const units = ['B','KB','MB','GB'];
    let value = n, i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return `${value >= 10 || i === 0 ? value.toFixed(i === 0 ? 0 : 1) : value.toFixed(2)} ${units[i]}`;
  }

  function ctMediaFormat(src, contentType = '') {
    const type = clean(contentType).split(';')[0].toLowerCase();
    if (type.includes('/')) return type.split('/')[1].toUpperCase().replace('QUICKTIME','MOV').replace('JPEG','JPG');
    try {
      const path = decodeURIComponent(new URL(src, location.href).pathname).toLowerCase();
      const m = path.match(/\.([a-z0-9]{2,5})$/);
      if (m) return m[1].toUpperCase();
    } catch {}
    return ctSafariText('不明', 'Unknown');
  }

  function ctHeadMedia(src) {
    const empty = { bytes: null, contentType: '' };
    try {
      const url = new URL(src);
      if (url.protocol !== 'https:' || !['firebasestorage.googleapis.com', 'storage.googleapis.com'].includes(url.hostname) || url.username || url.password) return Promise.resolve(empty);
    } catch { return Promise.resolve(empty); }
    return new Promise(resolve => {
      let settled = false;
      let handle;
      const finish = response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const headers = response?.status >= 200 && response.status < 300 ? String(response.responseHeaders || '') : '';
        const length = headers.match(/^content-length:\s*(\d+)/im)?.[1];
        const contentType = headers.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.trim() || '';
        resolve({ bytes: length ? Number(length) : null, contentType });
      };
      const timer = setTimeout(() => { finish(null); try { handle?.abort?.(); } catch {} }, 8000);
      const manager = typeof GM !== 'undefined' ? GM : globalThis.GM;
      const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest :
        typeof manager?.xmlHttpRequest === 'function' ? manager.xmlHttpRequest.bind(manager) : null;
      if (!gm) return finish(null);
      try {
        handle = gm({ method: 'HEAD', url: src, timeout: 8000, anonymous: true, redirect: 'error',
          onload: finish, onerror: () => finish(null), ontimeout: () => finish(null), onabort: () => finish(null) });
        if (handle && typeof handle.then === 'function') Promise.resolve(handle).then(response => {
          if (response && typeof response === 'object' && 'status' in response) finish(response);
        }, () => finish(null));
      } catch { finish(null); }
    });
  }

  let ctMediaInfoRequest = 0;
  let ctMediaInfoPreviousFocus = null;
  async function ctShowMediaInfo(media) {
    const request = ++ctMediaInfoRequest;
    const previousOverlay = document.getElementById('ct-media-info-panel');
    const previousFocus = previousOverlay?.contains(document.activeElement) && ctMediaInfoPreviousFocus?.isConnected
      ? ctMediaInfoPreviousFocus : document.activeElement;
    ctMediaInfoPreviousFocus = previousFocus;
    previousOverlay?.remove();
    const src = media.currentSrc || media.src || '';
    const isVideo = media instanceof HTMLVideoElement;
    const width = isVideo ? media.videoWidth : media.naturalWidth;
    const height = isVideo ? media.videoHeight : media.naturalHeight;
    const duration = isVideo && Number.isFinite(media.duration) ? media.duration : null;

    const overlay = document.createElement('div');
    overlay.id = 'ct-media-info-panel';
    overlay.setAttribute('data-ct-local-ui', '');
    overlay.setAttribute('role', 'dialog');
    const mediaTitle = isVideo ? ctSafariText('動画情報', 'Video information') : ctSafariText('写真情報', 'Photo information');
    overlay.setAttribute('aria-label', mediaTitle);
    const dark = matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    overlay.style.setProperty('--ct-media-bg', `var(--color-tl-app-card, ${dark ? '#15202b' : '#fff'})`);
    overlay.style.setProperty('--ct-media-fg', `var(--color-tl-app-text, ${dark ? '#f1f5f9' : '#17202a'})`);

    const sheet = document.createElement('div');
    sheet.className = 'ct-media-info-sheet';
    const headRow = document.createElement('div');
    headRow.className = 'ct-media-info-head';
    const title = document.createElement('div');
    title.className = 'ct-media-info-title';
    title.textContent = `${isVideo ? '🎬' : '📸'} ${mediaTitle}`;
    const close = document.createElement('button');
    close.className = 'ct-media-info-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', ctSafariText('閉じる', 'Close'));
    headRow.append(title, close);

    const grid = document.createElement('div');
    grid.className = 'ct-media-info-grid';
    const rows = [
      ['resolution', ctSafariText('実解像度', 'Resolution'), width && height ? `${width} × ${height} px` : ctSafariText('読み込み待ち', 'Waiting for media to load')],
      ['format', ctSafariText('形式', 'Format'), ctMediaFormat(src)],
      ['size', ctSafariText('配信ファイル容量', 'Delivered file size'), src ? ctSafariText('取得中…', 'Loading…') : ctSafariText('取得できません', 'Unavailable')]
    ];
    if (isVideo) rows.push(['duration', ctSafariText('長さ', 'Duration'), duration != null ? `${duration.toFixed(2)} ${ctSafariText('秒', 'seconds')}` : ctSafariText('読み込み待ち', 'Waiting for media to load')]);
    const values = new Map();
    for (const [key, label, value] of rows) {
      const k = document.createElement('div'); k.className = 'ct-media-info-key'; k.textContent = label;
      const v = document.createElement('div'); v.className = 'ct-media-info-value'; v.textContent = value;
      values.set(key, v);
      grid.append(k, v);
    }

    const url = document.createElement('div');
    url.className = 'ct-media-info-url';
    url.textContent = src || ctSafariText('URLを取得できません', 'URL unavailable');

    sheet.append(headRow, grid, url);
    overlay.append(sheet);
    document.body.append(overlay);
    const dismiss = () => {
      const current = request === ctMediaInfoRequest;
      if (current) ctMediaInfoRequest++;
      overlay.remove();
      if (current) {
        ctMediaInfoPreviousFocus = null;
        if (previousFocus?.isConnected) previousFocus.focus?.();
      }
    };
    overlay.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    });
    close.focus();
    close.onclick = dismiss;
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });

    // Show the sheet immediately, then update only this still-open request.
    // Closing it or opening another media item cannot be undone by a late HEAD.
    const head = src ? await ctHeadMedia(src) : { bytes: null, contentType: '' };
    if (request !== ctMediaInfoRequest || !overlay.isConnected) return;
    values.get('format').textContent = ctMediaFormat(src, head.contentType);
    values.get('size').textContent = ctFormatBytes(head.bytes);
  }

  function patchMediaInfo(root = document) {
    const scope = root instanceof Element ? root : document;
    const media = [];
    if (scope instanceof HTMLImageElement || scope instanceof HTMLVideoElement) media.push(scope);
    scope.querySelectorAll?.('article img, article video').forEach(el => media.push(el));

    for (const el of media) {
      if (!el.isConnected || el.dataset.ctMediaInfo === '1') continue;
      if (el instanceof HTMLImageElement) {
        const alt = clean(el.alt || '').toLowerCase();
        const r = el.getBoundingClientRect();
        if (/avatar|profile/.test(alt) || (r.width && r.width <= 96 && r.height <= 96)) continue;
      }

      let timer = null;
      let startX = 0;
      let startY = 0;
      const cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };

      el.addEventListener('touchstart', event => {
        const touch = event.touches?.[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        cancel();
        timer = setTimeout(() => {
          timer = null;
          ctShowMediaInfo(el);
        }, 650);
      }, { passive:true });

      el.addEventListener('touchmove', event => {
        const touch = event.touches?.[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) cancel();
      }, { passive:true });

      el.addEventListener('touchend', cancel, { passive:true });
      el.addEventListener('touchcancel', cancel, { passive:true });
      el.dataset.ctMediaInfo = '1';
    }
  }
  function installSafariStyle() {
    if(document.getElementById("ct-safari-style")) return;
    const style=document.createElement("style"); style.id="ct-safari-style";
    style.textContent="      #ct-media-info-panel {\n        position:fixed;\n        inset:0;\n        z-index:2147483600;\n        display:flex;\n        align-items:flex-end;\n        justify-content:center;\n        padding:16px;\n        background:rgba(0,0,0,.34);\n      }\n\n      .ct-media-info-sheet {\n        box-sizing:border-box;\n        width:min(520px,100%);\n        max-height:72vh;\n        overflow:auto;\n        border-radius:18px;\n        padding:16px;\n        background:var(--ct-media-bg,#fff);\n        color:var(--ct-media-fg,#17202a);\n        box-shadow:0 12px 44px rgba(0,0,0,.34);\n        font:14px/1.55 system-ui,-apple-system,\"Segoe UI\",sans-serif;\n      }\n\n      .ct-media-info-head {\n        display:flex;\n        align-items:center;\n        justify-content:space-between;\n        gap:12px;\n        margin-bottom:12px;\n      }\n\n      .ct-media-info-title { font-size:17px; font-weight:800; }\n      .ct-media-info-close {\n        border:0;\n        border-radius:999px;\n        background:rgba(127,127,127,.15);\n        color:inherit;\n        width:32px;\n        height:32px;\n        font-size:20px;\n      }\n      .ct-media-info-grid {\n        display:grid;\n        grid-template-columns:auto 1fr;\n        gap:7px 12px;\n      }\n      .ct-media-info-key { opacity:.62; }\n      .ct-media-info-value { min-width:0; overflow-wrap:anywhere; font-weight:650; }\n      .ct-media-info-url {\n        margin-top:12px;\n        padding:10px;\n        border-radius:10px;\n        background:rgba(127,127,127,.10);\n        font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;\n        overflow-wrap:anywhere;\n        user-select:text;\n        -webkit-user-select:text;\n      }\n\n";
    (document.head || document.documentElement).append(style);
  }
