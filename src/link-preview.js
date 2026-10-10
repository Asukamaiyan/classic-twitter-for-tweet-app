  // Link cards use anonymous reads of the original public destination. Neither
  // native post text nor its anchors/handlers are replaced.
  const ctLinkPreviewState = { records: new Map(), jobs: new Map(), cache: new Map(), observer: null, observedSources: new Set(),
    context: '', generation: 0, running: 0, enabled: null, style: null, imageBytes: 0, recordImageBytes: 0 };
  const ctLinkPreviewLimits = { text: 512 * 1024, image: 2 * 1024 * 1024, cacheImages: 16 * 1024 * 1024,
    cache: 100, records: 160, timeout: 8000, ttl: 15 * 60 * 1000, failureTTL: 60000 };
  const ctLinkPreviewProtected = '[data-ct-owned],[data-ct-local-ui],[contenteditable]:not([contenteditable="false"]),[role="dialog"],blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"],[data-ct-quote],[aria-live],fieldset,[data-testid="profile-bio"]';
  function ctLinkPreviewText(value, length = 240) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length) : '';
  }
  function ctLinkPreviewURL(value, base = '', metadata = true) {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    try {
      const url = base ? new URL(value, base) : new URL(value);
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      // Public domain names only: this also rejects alternative numeric IPv4
      // spellings normalized by URL, IPv6, LAN suffixes and single-label hosts.
      if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
          !host.includes('.') || /[\[\]:]/.test(host) || /^\d+(?:\.\d+){3}$/.test(host) ||
          /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|invalid|test|onion|arpa)$/.test(host) ||
          /^(?:localhost|metadata\.google\.internal)$/.test(host) || host === location.hostname.toLowerCase() ||
          host === 'tweet.app' || host.endsWith('.tweet.app')) return '';
      if (metadata) for (const key of url.searchParams.keys()) {
        const normalized = key.toLowerCase().replace(/[-_.]/g, '');
        if (/(?:token|secret|password|passwd|signature|credential|session|jwt|saml|authorization|apikey|accesskey|privatekey)/.test(normalized) ||
            /^(?:key|auth|authorization|sig|code|accesskey|apikey|policy|keypairid|session(?:id|key)?|jwt|saml|sso)$/.test(normalized) ||
            normalized.startsWith('xamz') || normalized.startsWith('xgoog')) return '';
      }
      return url.href;
    } catch { return ''; }
  }
  function ctLinkPreviewFirstURL(text) {
    if (typeof text !== 'string' || text.length > 100000) return '';
    const matches = text.match(/https:\/\/[^\s<>"'`]+/gi) || [];
    for (let value of matches.slice(0, 32)) {
      value = value.replace(/[.,!?;:、。！？，；：]+$/, '');
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
        while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
      }
      const url = ctLinkPreviewURL(value, '', false);
      if (url) return url;
    }
    return '';
  }
  function ctLinkPreviewParse(html, finalURL) {
    const base = ctLinkPreviewURL(finalURL);
    if (!base || typeof html !== 'string' || !html || html.length > ctLinkPreviewLimits.text || /<!ENTITY/i.test(html)) return null;
    // Parse only meta/title tokens, never the external body, scripts, images,
    // frames or base element. The detached parser cannot trigger body resources.
    const head = html.slice(0, 128 * 1024)
      .replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
      .split(/<body\b|<\/head\s*>/i)[0];
    const tags = (head.match(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi) || []).slice(0, 128).filter(tag => tag.length <= 8192);
    const rawTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1]?.slice(0, 3000) || '';
    if (!tags.length && !rawTitle && !/<(?:!doctype\s+html|html|head|body)\b/i.test(html)) return null;
    const doc = new DOMParser().parseFromString('<!doctype html><html><head>' + tags.join('') +
      '<title>' + rawTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</title></head></html>', 'text/html');
    const meta = new Map();
    for (const node of doc.querySelectorAll('meta')) {
      const key = (node.getAttribute('property') || node.getAttribute('name') || '').toLowerCase();
      const value = node.getAttribute('content') || '';
      if (!meta.has(key) && value) meta.set(key, value);
    }
    const domain = new URL(base).hostname;
    const title = ctLinkPreviewText(meta.get('og:title') || meta.get('twitter:title') || doc.title) || domain;
    const description = ctLinkPreviewText(meta.get('og:description') || meta.get('twitter:description') || meta.get('description'), 360);
    const site = ctLinkPreviewText(meta.get('og:site_name'), 100) || domain;
    const images = [];
    for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
      const image = ctLinkPreviewURL((meta.get(key) || '').trim(), base);
      if (image && !images.includes(image)) images.push(image);
      if (images.length === 2) break;
    }
    return { title, description, site, domain, images };
  }
  function ctLinkPreviewHeader(headers, name) {
    if (typeof headers !== 'string' || headers.length > 32768) return '';
    const value = headers.split(/\r?\n/).find(line => line.slice(0, line.indexOf(':')).toLowerCase() === name);
    return value ? value.slice(value.indexOf(':') + 1).trim() : '';
  }
  function ctLinkPreviewRequest(value, binary = false) {
    const target = ctLinkPreviewURL(value);
    let current = null, canceled = false;
    const fail = reason => ({ ok: false, reason });
    const abort = () => { canceled = true; current?.abort(); };
    const single = url => new Promise(resolve => {
      let settled = false, handle = null, abortWhenReady = false;
      const limit = binary ? ctLinkPreviewLimits.image : ctLinkPreviewLimits.text;
      const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
      const stop = reason => {
        if (settled) return;
        finish(fail(reason)); abortWhenReady = true;
        try { handle?.abort?.(); } catch {}
      };
      const timer = setTimeout(() => stop('timeout'), ctLinkPreviewLimits.timeout);
      current = { abort: () => stop('canceled') };
      let request = null;
      if (typeof GM_xmlhttpRequest === 'function') request = GM_xmlhttpRequest;
      else { const gm = typeof GM !== 'undefined' ? GM : globalThis.GM;
        if (typeof gm?.xmlHttpRequest === 'function') request = gm.xmlHttpRequest.bind(gm); }
      if (!request) { finish(fail('unavailable')); return; }
      const parse = response => {
        try {
          const status = Number(response?.status);
          const aliases = [response.finalUrl, response.responseURL].filter(Boolean).map(urlValue => ctLinkPreviewURL(urlValue));
          if (aliases.some(urlValue => !urlValue) || aliases.length === 2 && aliases[0] !== aliases[1]) return fail('unsafe');
          const finalURL = aliases[0] || url;
          const headers = response.responseHeaders || '';
          if ([301, 302, 303, 307, 308].includes(status)) {
            const redirect = ctLinkPreviewURL(ctLinkPreviewHeader(headers, 'location'), finalURL);
            return redirect ? { redirect } : fail('unsafe');
          }
          if (!(status >= 200 && status < 300)) return fail(status === 401 || status === 403 ? 'permission' : 'http');
          if (Number(ctLinkPreviewHeader(headers, 'content-length')) > limit) return fail('size');
          const type = ctLinkPreviewHeader(headers, 'content-type').split(';')[0].toLowerCase();
          if (binary) {
            if (!/^image\/(?:jpeg|png|webp|avif)$/.test(type)) return fail('image');
            const data = response.response;
            // Stay serializes arraybuffer responses as ordinary byte arrays.
            // Validate the complete bounded array before allocating a buffer.
            const serialized = Array.isArray(data);
            const length = serialized ? data.length : data?.byteLength;
            if (!Number.isSafeInteger(length) || length < 8 || length > limit || serialized &&
                data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) return fail('image');
            const bytes = serialized ? new Uint8Array(data) : new Uint8Array(data.buffer || data, data.byteOffset || 0, length);
            const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
            const valid = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
              type === 'image/png' ? bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 &&
                bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 :
              type === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' :
              ascii(4, 8) === 'ftyp' && /(?:avif|avis)/.test(ascii(8, 32));
            // Animated image formats cannot autoplay through a preview. GIFs
            // are omitted; reject the animation markers in PNG/WebP/AVIF too.
            let animated = type === 'image/avif' && /avis/.test(ascii(8, 32));
            if (type === 'image/png' || type === 'image/webp') {
              const marker = type === 'image/png' ? 'acTL' : 'ANIM';
              for (let i = 8; i + 4 <= bytes.length; i++) if (bytes[i] === marker.charCodeAt(0) &&
                  bytes[i + 1] === marker.charCodeAt(1) && bytes[i + 2] === marker.charCodeAt(2) &&
                  bytes[i + 3] === marker.charCodeAt(3)) { animated = true; break; }
            }
            return valid && !animated ? { ok: true, blob: new Blob([bytes], { type }), url: finalURL } : fail('image');
          }
          if (type && !/^(?:text\/html|application\/xhtml\+xml)$/.test(type)) return fail('type');
          let html; try { html = response.responseText; } catch {}
          if (typeof html !== 'string') html = response.response;
          return typeof html === 'string' && html.length <= limit ? { ok: true, html, url: finalURL } : fail('size');
        } catch { return fail('response'); }
      };
      try {
        handle = request({ method: 'GET', url, anonymous: true, redirect: 'manual', responseType: binary ? 'arraybuffer' : 'text',
          timeout: ctLinkPreviewLimits.timeout, headers: { Accept: binary ? 'image/avif,image/webp,image/png,image/jpeg' : 'text/html,application/xhtml+xml' },
          onload: response => finish(parse(response)),
          // Stay releases its request message listener only in this callback.
          onloadend: response => finish(parse(response)), onerror: () => finish(fail('permission')),
          ontimeout: () => stop('timeout'), onabort: () => finish(fail('canceled')),
          onprogress: event => { if (Number(event?.loaded) > limit) stop('size'); } });
        if (abortWhenReady) try { handle?.abort?.(); } catch {}
        if (handle && typeof handle.then === 'function') Promise.resolve(handle).then(response => {
          try { if (Number(response?.status) > 0 && (response.readyState == null || Number(response.readyState) === 4)) finish(parse(response)); }
          catch { finish(fail('response')); }
        }, () => finish(fail('permission')));
      } catch { finish(fail('permission')); }
    });
    const promise = (async () => {
      if (!target) return fail('unsafe');
      let url = target; const seen = new Set();
      for (let count = 0; count < 4; count++) {
        if (canceled) return fail('canceled');
        if (seen.has(url)) return fail('redirect');
        seen.add(url); const result = await single(url);
        if (canceled) return fail('canceled');
        if (!result.redirect) return result;
        url = result.redirect;
      }
      return fail('redirect');
    })();
    return { promise, abort };
  }
  function ctLinkPreviewEnabled() { return typeof ctGetLinkPreviewsEnabled !== 'function' || ctGetLinkPreviewsEnabled() !== false; }
  function ctLinkPreviewActive() { return !!globalThis.document && !document.hidden && (typeof ctPageActive === 'undefined' || ctPageActive); }
  function ctLinkPreviewContext() {
    const uid = typeof ctNetworkState === 'undefined' ? '' : ctNetworkState.authUID || '';
    return `${location.pathname}${location.search}\n${uid}`;
  }
  function ctLinkPreviewSource(body) {
    if (!body?.isConnected || body.closest('[hidden],[aria-hidden="true"],[data-ct-profile-timeline-hidden],[data-ct-keyword-hidden],.ct-keyword-collapsed,.ct-links-filter-hidden')) return null;
    const profile = body.matches('p.ct-profile-text[data-ct-link-preview-source="original"]') && body.closest('.ct-profile-row[data-ct-profile-post]');
    if (profile) {
      if (body.parentElement?.matches('.ct-profile-row-main') && body.parentElement.parentElement === profile &&
          profile.closest('section[data-ct-profile-panel][data-ct-local-ui="profile"]')) {
        const url = ctLinkPreviewFirstURL(body.textContent); return url ? { body, post: profile, url, text: body.textContent } : null;
      }
      return null;
    }
    if (!body.matches('p.tl-user-text.whitespace-pre-wrap.break-words') || body.closest(ctLinkPreviewProtected)) return null;
    const post = body.closest('article'), parent = body.parentElement;
    if (!post || !parent?.matches('div.min-w-0.flex-1') || parent.closest('article') !== post) return null;
    const header = body.previousElementSibling;
    if (!header?.matches('div') || !header.querySelector('button.font-bold.truncate') ||
        [...header.querySelectorAll('button')].some(button => /^(?:Show original|原文を表示)$/i.test(button.textContent.trim()))) return null;
    // A nested original body belongs to its own article. Poll labels, quoted
    // line-clamped snippets and live translation paragraphs do not qualify.
    const originals = [...parent.children].filter(node => node.matches('p.tl-user-text.whitespace-pre-wrap.break-words'));
    if (originals.length !== 1) return null;
    for (const anchor of body.querySelectorAll('a[href]')) {
      const url = ctLinkPreviewURL(anchor.getAttribute('href'), '', false);
      if (url && !anchor.closest('button,[role="button"]')) return { body, post, url, text: body.textContent };
    }
    return null;
  }
  function ctLinkPreviewCopy(ja, en) { return typeof CT_LOCALE !== 'undefined' && CT_LOCALE === 'ja' ? ja : en; }
  function ctLinkPreviewEnsureStyle() {
    if (ctLinkPreviewState.style?.isConnected) return;
    const style = document.createElement('style'); style.dataset.ctOwned = 'link-preview';
    style.textContent = `.ct-link-preview{margin:10px 0;max-width:100%;border:1px solid var(--color-tl-app-border,#8b98a544);border-radius:10px;overflow:hidden;background:var(--color-tl-app-bg,#fff);color:var(--color-tl-app-text,#14171a)}.ct-link-preview a{display:block;min-height:44px;color:inherit;text-decoration:none}.ct-link-preview-content{padding:10px 12px;min-width:0}.ct-link-preview-domain{font-size:12px;color:var(--color-tl-app-text-muted,#657786);overflow-wrap:anywhere}.ct-link-preview-title{display:block;margin:3px 0;font-weight:700;font-size:14px;line-height:1.4;overflow-wrap:anywhere}.ct-link-preview-description{margin:0;font-size:13px;line-height:1.4;color:var(--color-tl-app-text-muted,#657786);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.ct-link-preview-image{display:block;width:100%;max-height:260px;object-fit:contain;background:var(--color-tl-app-bg,#fff)}.ct-link-preview-actions{display:flex;flex-wrap:wrap;gap:0 8px;padding:0 8px;border-top:1px solid var(--color-tl-app-border,#8b98a544)}.ct-link-preview button{min-height:44px;padding:6px 4px;border:0;background:none;color:var(--color-tl-app-text,#14171a);font:inherit;font-size:12px;cursor:pointer;transition:transform 120ms ease}.ct-link-preview button:active{transform:scale(.97)}.ct-link-preview button:disabled{opacity:.6;cursor:default}.ct-link-preview a:focus-visible,.ct-link-preview button:focus-visible,.ct-link-preview input:focus-visible{outline:2px solid currentColor;outline-offset:-2px}.ct-link-preview-status{margin:0;padding:0 12px 7px;font-size:12px;line-height:1.45;overflow-wrap:anywhere;color:var(--color-tl-app-text-muted,#657786)}.ct-link-preview-copy-field{display:block;width:calc(100% - 24px);min-height:44px;margin:0 12px 8px;border:1px solid var(--color-tl-app-border,#8b98a544);background:var(--color-tl-app-input-bg,#fff);color:inherit;font:inherit;font-size:13px}.ct-link-preview [hidden]{display:none!important}@media(prefers-reduced-motion:reduce){.ct-link-preview button{transition:none}.ct-link-preview button:active{transform:none}}`;
    document.head?.append(style); ctLinkPreviewState.style = style;
  }
  function ctLinkPreviewValid(record) {
    if (!ctLinkPreviewActive() || record.context !== ctLinkPreviewContext() || !record.card.isConnected ||
        record.card.previousElementSibling !== record.body) return false;
    const source = ctLinkPreviewSource(record.body);
    return !!source && source.post === record.post && source.url === record.url && source.text === record.text;
  }
  function ctLinkPreviewFallback(record, reason = '') {
    record.card.removeAttribute('aria-busy'); record.fetch.disabled = !record.metadataURL;
    record.fetch.hidden = false; record.fetch.textContent = ctLinkPreviewCopy('プレビューを取得', 'Load preview');
    if (!record.metadataURL) record.status.textContent = ctLinkPreviewCopy('認証情報を含むリンクはプレビューを取得しません。', 'Preview is unavailable for links containing credentials.');
    else if (reason === 'permission' || reason === 'unavailable') record.status.textContent = ctLinkPreviewCopy('取得できませんでした。管理アプリのサイト通信許可を確認して再試行できます。', 'Could not load. Check the site permission in your script manager, then retry.');
    else if (reason) record.status.textContent = ctLinkPreviewCopy('プレビューを取得できませんでした。再試行できます。', 'Preview could not be loaded. You can retry.');
    else record.status.textContent = ctLinkPreviewCopy('リンク先のプレビュー', 'Link preview');
  }
  function ctLinkPreviewRender(record, result) {
    if (!ctLinkPreviewValid(record)) return;
    if (!result.ok) { ctLinkPreviewFallback(record, result.reason); return; }
    const meta = result.meta;
    record.title.textContent = meta.title; record.domain.textContent = `${meta.site} · ${meta.domain}`;
    record.description.textContent = meta.description; record.description.hidden = !meta.description;
    record.status.textContent = ''; record.fetch.hidden = true; record.card.removeAttribute('aria-busy');
    ctLinkPreviewReleaseImage(record);
    if (record.visible && meta.blob && ctLinkPreviewState.recordImageBytes + meta.blob.size <= ctLinkPreviewLimits.cacheImages &&
        typeof URL.createObjectURL === 'function') {
      const image = document.createElement('img'); image.className = 'ct-link-preview-image'; image.alt = '';
      image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      try { record.objectURL = URL.createObjectURL(meta.blob); image.src = record.objectURL;
        record.imageBytes = meta.blob.size; ctLinkPreviewState.recordImageBytes += record.imageBytes;
        image.onerror = () => ctLinkPreviewReleaseImage(record);
        image.onload = () => { if (image.naturalWidth > 8192 || image.naturalHeight > 8192 ||
          image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) ctLinkPreviewReleaseImage(record); };
        record.link.prepend(image); } catch {}
    }
  }
  async function ctLinkPreviewClipboard(record, text) {
    if (!ctLinkPreviewValid(record)) return;
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard');
      await navigator.clipboard.writeText(text);
      if (ctLinkPreviewValid(record)) record.status.textContent = ctLinkPreviewCopy('コピーしました。', 'Copied.');
    } catch {
      if (!ctLinkPreviewValid(record)) return;
      let field = record.card.querySelector('.ct-link-preview-copy-field');
      if (!field) { field = document.createElement('input'); field.type = 'text'; field.readOnly = true;
        field.className = 'ct-link-preview-copy-field'; field.setAttribute('aria-label', ctLinkPreviewCopy('コピーするリンク', 'Link to copy')); record.card.append(field); }
      field.value = text; field.focus({ preventScroll: true }); field.select();
      record.status.textContent = ctLinkPreviewCopy('選択したリンクをコピーしてください。', 'Copy the selected link.');
    }
  }
  function ctLinkPreviewCreate(source) {
    const { body, post, url, text } = source;
    const card = document.createElement('section'); card.className = 'ct-link-preview'; card.dataset.ctOwned = 'link-preview';
    card.setAttribute('aria-label', ctLinkPreviewCopy('リンクのプレビュー', 'Link preview'));
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const content = document.createElement('div'); content.className = 'ct-link-preview-content';
    const domain = document.createElement('span'); domain.className = 'ct-link-preview-domain'; domain.textContent = new URL(url).hostname;
    const title = document.createElement('strong'); title.className = 'ct-link-preview-title'; title.textContent = ctLinkPreviewCopy('リンクを開く ↗', 'Open link ↗');
    const description = document.createElement('p'); description.className = 'ct-link-preview-description'; description.hidden = true;
    content.append(domain, title, description); link.append(content);
    const actions = document.createElement('div'); actions.className = 'ct-link-preview-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = ctLinkPreviewCopy('リンクをコピー', 'Copy link');
    const share = document.createElement('button'); share.type = 'button'; share.textContent = ctLinkPreviewCopy('リンクを共有', 'Share link');
    const fetchButton = document.createElement('button'); fetchButton.type = 'button';
    const status = document.createElement('p'); status.className = 'ct-link-preview-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    actions.append(copy, share, fetchButton); card.append(link, actions, status);
    const metadataURL = ctLinkPreviewURL(url);
    const record = { body, post, url, text, metadataURL: metadataURL ? metadataURL.split('#')[0] : '',
      card, link, domain, title, description, fetch: fetchButton, status, context: ctLinkPreviewContext(),
      visible: false, attempted: false, manual: false, job: null, objectURL: '', imageBytes: 0 };
    // Stop only the containing native post's click navigation. Link default
    // navigation and all native body handlers remain intact.
    card.addEventListener('click', event => event.stopPropagation());
    copy.onclick = () => ctLinkPreviewClipboard(record, url);
    share.onclick = async () => {
      if (!ctLinkPreviewValid(record)) return;
      if (typeof navigator.share !== 'function') { ctLinkPreviewClipboard(record, url); return; }
      try { await navigator.share({ url, title: record.title.textContent });
        if (ctLinkPreviewValid(record)) status.textContent = ctLinkPreviewCopy('共有しました。', 'Shared.'); }
      catch (error) { if (error?.name !== 'AbortError') ctLinkPreviewClipboard(record, url); }
    };
    fetchButton.onclick = () => {
      if (!ctLinkPreviewValid(record) || !record.metadataURL || record.job) return;
      ctLinkPreviewDeleteCache(record.metadataURL); record.manual = true; record.attempted = false;
      record.visible = true;
      ctLinkPreviewQueue(record); ctLinkPreviewPump();
    };
    body.after(card); ctLinkPreviewFallback(record); return record;
  }
  function ctLinkPreviewDeleteCache(key) {
    const old = ctLinkPreviewState.cache.get(key);
    if (old?.meta?.blob) ctLinkPreviewState.imageBytes -= old.meta.blob.size;
    ctLinkPreviewState.cache.delete(key);
  }
  function ctLinkPreviewCache(key, result) {
    ctLinkPreviewDeleteCache(key);
    const size = result.meta?.blob?.size || 0;
    while (ctLinkPreviewState.cache.size >= ctLinkPreviewLimits.cache ||
        ctLinkPreviewState.imageBytes + size > ctLinkPreviewLimits.cacheImages) {
      const first = ctLinkPreviewState.cache.keys().next().value;
      if (!first) break; ctLinkPreviewDeleteCache(first);
    }
    ctLinkPreviewState.imageBytes += size;
    ctLinkPreviewState.cache.set(key, { ...result, until: Date.now() + (result.ok ? ctLinkPreviewLimits.ttl : ctLinkPreviewLimits.failureTTL) });
  }
  function ctLinkPreviewDetach(record) {
    const job = record.job; record.job = null;
    if (job) { job.records.delete(record); if (!job.records.size) {
      job.canceled = true; job.request?.abort(); ctLinkPreviewState.jobs.delete(job.key); } }
    if (record.card.hasAttribute('aria-busy')) { record.attempted = false; record.manual = false; ctLinkPreviewFallback(record); }
    if (!record.visible && record.objectURL) { ctLinkPreviewReleaseImage(record); record.attempted = false; }
  }
  function ctLinkPreviewReleaseImage(record) {
    if (record.objectURL) try { URL.revokeObjectURL(record.objectURL); } catch {}
    record.objectURL = ''; ctLinkPreviewState.recordImageBytes -= record.imageBytes || 0; record.imageBytes = 0;
    record.card.querySelectorAll('img').forEach(image => { image.onerror = null; image.onload = null; image.removeAttribute('src'); image.remove(); });
  }
  function ctLinkPreviewDrop(record, keepObserved = false) {
    ctLinkPreviewDetach(record); if (!keepObserved) { ctLinkPreviewState.observer?.unobserve(record.body); ctLinkPreviewState.observedSources.delete(record.body); }
    ctLinkPreviewReleaseImage(record);
    record.card.remove(); ctLinkPreviewState.records.delete(record.body);
  }
  function ctLinkPreviewMakeRoom() {
    if (ctLinkPreviewState.records.size < ctLinkPreviewLimits.records) return true;
    for (const record of ctLinkPreviewState.records.values()) if (!record.visible && !record.job && !record.card.contains(document.activeElement)) {
      // The source remains observed, so returning to an old row recreates its
      // bounded card instead of retaining every feed row indefinitely.
      ctLinkPreviewDrop(record, true); return true;
    }
    return false;
  }
  function ctLinkPreviewQueue(record) {
    if (record.job || record.attempted || !record.visible || !record.metadataURL || !ctLinkPreviewValid(record) ||
        !ctLinkPreviewEnabled() && !record.manual) return;
    const cached = ctLinkPreviewState.cache.get(record.metadataURL);
    if (cached && cached.until > Date.now()) { record.attempted = true; ctLinkPreviewRender(record, cached); return; }
    if (cached) ctLinkPreviewDeleteCache(record.metadataURL);
    let job = ctLinkPreviewState.jobs.get(record.metadataURL);
    if (!job) { job = { key: record.metadataURL, records: new Set(), started: false, canceled: false,
      generation: ctLinkPreviewState.generation, request: null }; ctLinkPreviewState.jobs.set(job.key, job); }
    job.records.add(record); record.job = job; record.attempted = true;
    record.card.setAttribute('aria-busy', 'true'); record.fetch.disabled = true;
    record.status.textContent = ctLinkPreviewCopy('プレビューを取得中…', 'Loading preview…');
  }
  function ctLinkPreviewPump() {
    if (!ctLinkPreviewState.jobs.size || !ctLinkPreviewActive()) return;
    for (const job of ctLinkPreviewState.jobs.values()) {
      if (ctLinkPreviewState.running >= 2) break;
      if (job.started || job.canceled) continue;
      for (const record of [...job.records]) if (!ctLinkPreviewValid(record) || !record.visible) ctLinkPreviewDetach(record);
      if (!job.records.size) continue;
      job.started = true; ctLinkPreviewState.running++;
      const valid = () => !job.canceled && job.generation === ctLinkPreviewState.generation && ctLinkPreviewActive() &&
        [...job.records].some(record => record.visible && ctLinkPreviewValid(record));
      (async () => {
        job.request = ctLinkPreviewRequest(job.key); let result = await job.request.promise;
        if (!valid()) return;
        if (result.ok) {
          const meta = ctLinkPreviewParse(result.html, result.url);
          if (!meta) result = { ok: false, reason: 'metadata' };
          else {
            if (typeof URL.createObjectURL === 'function') for (const imageURL of meta.images) {
              job.request = ctLinkPreviewRequest(imageURL, true); const image = await job.request.promise;
              if (!valid()) return;
              if (image.ok) { meta.blob = image.blob; break; }
            }
            result = { ok: true, meta };
          }
        }
        if (!valid()) return;
        ctLinkPreviewCache(job.key, result);
        for (const record of job.records) { record.job = null; ctLinkPreviewRender(record, result); }
      })().catch(() => {
        if (valid()) for (const record of job.records) { record.job = null; ctLinkPreviewFallback(record, 'response'); }
      }).finally(() => {
        ctLinkPreviewState.running--; if (ctLinkPreviewState.jobs.get(job.key) === job) ctLinkPreviewState.jobs.delete(job.key);
        for (const record of job.records) if (record.job === job) { record.job = null; record.attempted = false; ctLinkPreviewFallback(record); }
        ctLinkPreviewPump();
      });
    }
  }
  function ctLinkPreviewsPatch(root = document) {
    if (!ctLinkPreviewActive()) { ctLinkPreviewsCleanup(); return; }
    const context = ctLinkPreviewContext(), enabled = ctLinkPreviewEnabled();
    if (ctLinkPreviewState.context && ctLinkPreviewState.context !== context) ctLinkPreviewsCleanup();
    ctLinkPreviewState.context = context;
    if (ctLinkPreviewState.enabled !== null && ctLinkPreviewState.enabled !== enabled) {
      ctLinkPreviewState.generation++;
      for (const record of ctLinkPreviewState.records.values()) { ctLinkPreviewDetach(record); record.manual = false; record.attempted = false; }
    }
    ctLinkPreviewState.enabled = enabled;
    for (const body of ctLinkPreviewState.observedSources) if (!body.isConnected) {
      ctLinkPreviewState.observer?.unobserve(body); ctLinkPreviewState.observedSources.delete(body);
    }
    for (const record of [...ctLinkPreviewState.records.values()]) if (!ctLinkPreviewValid(record)) ctLinkPreviewDrop(record);
    if (!ctLinkPreviewState.observer && typeof IntersectionObserver === 'function') {
      ctLinkPreviewState.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.target.isConnected) { ctLinkPreviewState.observer?.unobserve(entry.target);
            ctLinkPreviewState.observedSources.delete(entry.target); continue; }
          let record = ctLinkPreviewState.records.get(entry.target);
          if (!record && entry.isIntersecting && entry.intersectionRatio > 0 && ctLinkPreviewMakeRoom()) {
            const source = ctLinkPreviewSource(entry.target);
            if (source) { ctLinkPreviewEnsureStyle(); record = ctLinkPreviewCreate(source); ctLinkPreviewState.records.set(entry.target, record); }
          }
          if (!record) continue;
          record.visible = entry.isIntersecting && entry.intersectionRatio > 0;
          if (!record.visible) ctLinkPreviewDetach(record);
          else if (!ctLinkPreviewValid(record)) ctLinkPreviewDrop(record);
          else ctLinkPreviewQueue(record);
        }
        ctLinkPreviewPump();
      }, { threshold: 0 });
    }
    const selector = 'p.tl-user-text.whitespace-pre-wrap.break-words,p.ct-profile-text[data-ct-link-preview-source="original"]';
    const bodies = new Set(root.querySelectorAll?.(selector) || []);
    if (root.matches?.(selector)) bodies.add(root);
    const owner = root.closest?.('article,.ct-profile-row');
    if (owner) for (const body of owner.querySelectorAll(selector)) bodies.add(body);
    for (const body of bodies) {
      if (ctLinkPreviewState.records.has(body)) continue;
      const source = ctLinkPreviewSource(body); if (!source) continue;
      if (!ctLinkPreviewMakeRoom()) { if (ctLinkPreviewState.observer) {
        ctLinkPreviewState.observer.observe(body); ctLinkPreviewState.observedSources.add(body); } continue; }
      ctLinkPreviewEnsureStyle(); const record = ctLinkPreviewCreate(source); ctLinkPreviewState.records.set(body, record);
      if (ctLinkPreviewState.observer) { ctLinkPreviewState.observer.observe(body); ctLinkPreviewState.observedSources.add(body); }
      else {
        // Older browsers keep a useful manual card; no unseen automatic reads.
        const rect = body.getBoundingClientRect(); record.visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      }
    }
    for (const record of ctLinkPreviewState.records.values()) ctLinkPreviewQueue(record);
    ctLinkPreviewPump();
  }
  function ctLinkPreviewsCleanup() {
    ctLinkPreviewState.generation++;
    ctLinkPreviewState.observer?.disconnect(); ctLinkPreviewState.observer = null;
    ctLinkPreviewState.observedSources.clear();
    for (const record of [...ctLinkPreviewState.records.values()]) ctLinkPreviewDrop(record);
    for (const job of ctLinkPreviewState.jobs.values()) { job.canceled = true; job.request?.abort(); }
    ctLinkPreviewState.jobs.clear(); ctLinkPreviewState.cache.clear(); ctLinkPreviewState.imageBytes = 0; ctLinkPreviewState.recordImageBytes = 0;
    ctLinkPreviewState.style?.remove(); ctLinkPreviewState.style = null;
    ctLinkPreviewState.context = ''; ctLinkPreviewState.enabled = null;
  }
