  // Official badge artwork and membership precedence from Tweet's web client.
  // The largest published variant is 96 px; displayed dimensions remain native.
  const ctOfficialBadgeKinds = {
    founder: 'Founder', fighter: 'Fighter', centurion: 'Centurion',
    'team-member': 'Team Member', ambassador: 'Tweet Ambassador', wing: 'Wing', press: 'Press'
  };
  const ctBadgeImageStates = new WeakMap();
  const ctBadgeRequests = new WeakMap();

  function ctBadgeLabel(kind) {
    const labels = { founder: '創設メンバー', fighter: 'ファイター', centurion: 'センチュリオン',
      'team-member': '運営メンバー', ambassador: 'Tweetアンバサダー', wing: 'ウィング', press: 'プレス' };
    return typeof CT_LOCALE !== 'undefined' && CT_LOCALE === 'ja' ? labels[kind] || '' : ctOfficialBadgeKinds[kind] || '';
  }

  function ctBadgeJapaneseDescription(value, kinds) {
    if (typeof CT_LOCALE === 'undefined' || CT_LOCALE !== 'ja' || typeof value !== 'string') return null;
    const names = value.split(' + ');
    const entries = Object.entries(ctOfficialBadgeKinds);
    const selected = names.map(name => entries.find(([, label]) => label === name)?.[0]);
    // Accept complete, known role combinations backed by the current artwork.
    // Display names, custom descriptions and numbered membership labels stay intact.
    return selected.length <= 7 && selected.every(kind => kind && kinds.includes(kind)) &&
      new Set(selected).size === selected.length ? selected.map(ctBadgeLabel).join(' + ') : null;
  }

  function ctBadgeDescriptionProtected(el) {
    return !!el.closest('[data-ct-owned],[data-ct-local-ui],[data-user-content],.tl-user-text,' +
      '[data-testid="tweet-text"],[data-testid="profile-bio"],[translate="no"],.notranslate,' +
      '[contenteditable]:not([contenteditable="false"]),.whitespace-pre-wrap,.break-words,.wrap-break-word');
  }

  function ctPatchNativeBadgeDescriptions(images, root) {
    if (typeof CT_LOCALE === 'undefined' || CT_LOCALE !== 'ja') return;
    const wrappers = new Set();
    const tooltips = new Set();
    for (const img of images) {
      if (!img.matches('img.shrink-0.select-none') || !ctBadgeAsset(img.getAttribute('src')) || ctBadgeDescriptionProtected(img)) continue;
      const wrapper = img.closest('span.relative.inline-flex.shrink-0.items-center.align-middle,' +
        'button.relative.inline-flex.shrink-0.items-center.align-middle');
      if (wrapper) wrappers.add(wrapper);
      const tooltip = img.closest('[role="tooltip"].fixed.pointer-events-none');
      if (tooltip) tooltips.add(tooltip);
    }
    const changedTooltip = root.closest?.('[role="tooltip"].fixed.pointer-events-none');
    if (changedTooltip) tooltips.add(changedTooltip);
    for (const wrapper of wrappers) {
      if (ctBadgeDescriptionProtected(wrapper)) continue;
      const kinds = [...wrapper.querySelectorAll('img.shrink-0.select-none')]
        .map(img => ctBadgeAsset(img.getAttribute('src'))?.kind).filter(Boolean);
      for (const attr of ['aria-label', 'title']) {
        const value = wrapper.getAttribute(attr);
        const out = ctBadgeJapaneseDescription(value, kinds);
        if (out && value !== out) wrapper.setAttribute(attr, out);
      }
    }
    for (const tooltip of tooltips) {
      if (ctBadgeDescriptionProtected(tooltip)) continue;
      const box = tooltip.firstElementChild;
      const artwork = box?.firstElementChild;
      const label = artwork?.nextElementSibling;
      if (!box?.matches('div.bg-tl-app-card.border.flex.flex-col.items-center') ||
          !artwork?.matches('span.inline-flex.flex-wrap.justify-center') ||
          !label?.matches('span.font-bold.text-tl-app-text.text-center.leading-tight') ||
          label.children.length || label.childNodes.length !== 1 || label.firstChild.nodeType !== Node.TEXT_NODE ||
          !artwork.children.length || [...artwork.children].some(img => !img.matches('img.shrink-0.select-none') ||
            !ctBadgeAsset(img.getAttribute('src')))) continue;
      const kinds = [...artwork.children].map(img => ctBadgeAsset(img.getAttribute('src')).kind);
      const out = ctBadgeJapaneseDescription(label.firstChild.nodeValue, kinds);
      if (out && label.firstChild.nodeValue !== out) label.firstChild.nodeValue = out;
    }
  }

  function ctBadgeAsset(value) {
    try {
      const url = new URL(value, location.origin);
      if (!['https://app.tweet.app', 'https://tweet.app'].includes(url.origin) || url.search || url.hash) return null;
      const match = url.pathname.match(/^\/assets\/(founder|fighter|centurion|team-member|ambassador|wing|press)-badge-(18|36|48|96)\.png$/);
      return match ? { kind: match[1], size: Number(match[2]), url: url.href } : null;
    } catch { return null; }
  }

  function ctBadgeSource(kind) {
    return `https://app.tweet.app/assets/${kind}-badge-96.png`;
  }

  function ctUpgradeBadgeImage(img) {
    if (!img.matches('img.shrink-0.select-none') || img.closest('.ct-official-badges')) return;
    const original = ctBadgeAsset(img.getAttribute('src'));
    if (!original) return;
    let state = ctBadgeImageStates.get(img);
    const firstUse = !state;
    if (state?.kind !== original.kind) {
      state = { kind: original.kind, src: img.getAttribute('src'), srcset: img.getAttribute('srcset'), failed: false };
      ctBadgeImageStates.set(img, state);
    }
    if (firstUse) {
      img.addEventListener('error', () => {
        const current = ctBadgeImageStates.get(img);
        if (!current || img.src !== ctBadgeSource(current.kind) || current.failed) return;
        current.failed = true;
        // A failed enhancement must not remove the site's original artwork.
        img.setAttribute('src', current.src);
        if (current.srcset === null) img.removeAttribute('srcset');
        else img.setAttribute('srcset', current.srcset);
      });
    }
    if (state.failed) return;
    const source = ctBadgeSource(original.kind);
    if (img.src !== source) img.src = source;
    // A width-based srcset lets DPR=1 choose the low-resolution 18 px file.
    // Keep layout dimensions, but select the largest artwork explicitly.
    if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
  }

  function ctProfileBadgeKinds(user) {
    const badges = Array.isArray(user?.badges) ? user.badges : [];
    if (badges.includes('team_member')) return ['team-member'];
    const hasCenturion = badges.includes('centurion');
    const hasFighter = hasCenturion || badges.includes('founding_special');
    const hasFounder = hasFighter || badges.includes('founding') ||
      (user?.foundingMemberNumber != null && /^\d+$/.test(String(user.foundingMemberNumber)));
    const result = [];
    if (hasFounder) result.push('founder');
    if (hasFighter) result.push('fighter');
    if (hasCenturion) result.push('centurion');
    if (badges.includes('wing')) result.push('wing');
    if (badges.includes('ambassador')) result.push('ambassador');
    if (badges.includes('press')) result.push('press');
    return result;
  }

  function ctBadgeUsername(value) {
    const username = String(value || '').trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_.-]{1,80}$/.test(username) ? username : null;
  }

  function ctBadgeArticleTarget(article) {
    if (!article?.isConnected || article.closest('[data-ct-owned],[data-ct-local-ui],blockquote,[aria-label^="Quoted post"]')) return null;
    const avatar = [...article.querySelectorAll('button[aria-label]')].find(button =>
      button.closest('article') === article && !button.closest('blockquote,[aria-label^="Quoted post"]') &&
      /^View @[^\s]+'s profile$/i.test(button.getAttribute('aria-label') || ''));
    const username = ctBadgeUsername(avatar?.getAttribute('aria-label')?.match(/^View @(.+)'s profile$/i)?.[1]);
    if (!username) return null;
    const name = [...article.querySelectorAll('button.font-bold.truncate')].find(button =>
      button.closest('article') === article && !button.closest('blockquote,[aria-label^="Quoted post"],p') &&
      (ctBadgeUsername(button.dataset.ctAuthorUser) === username || ctBadgeUsername(button.textContent) === username));
    if (!name) return null;
    return { name, username, host: name.parentElement, kind: 'article', scope: article };
  }

  function ctBadgeAccountTarget(dialog) {
    if (!dialog?.isConnected || !dialog.matches('[role="dialog"][aria-label="Account menu"]')) return null;
    const name = dialog.querySelector('button.block.text-left > p.font-extrabold.truncate');
    const handle = name?.nextElementSibling;
    if (!handle?.matches('p.truncate') || !/^@/.test(handle.textContent.trim())) return null;
    const username = ctBadgeUsername(handle.textContent);
    return username ? { name, username, host: name, kind: 'account', scope: dialog } : null;
  }

  function ctBadgeNativeImages(target) {
    return [...target.host.querySelectorAll('img')].filter(img => !img.closest('.ct-official-badges') && ctBadgeAsset(img.getAttribute('src')));
  }

  function ctBadgeCurrentTarget(target) {
    return target.kind === 'account' ? ctBadgeAccountTarget(target.scope) : ctBadgeArticleTarget(target.scope);
  }

  function ctBadgeGroup(target) {
    return [...target.host.children].find(child => child.classList.contains('ct-official-badges')) || null;
  }

  function ctInstallBadgeStyle() {
    if (document.getElementById('ct-official-badge-style')) return;
    const style = document.createElement('style');
    style.id = 'ct-official-badge-style';
    style.textContent = `
      .ct-official-badges { display:inline-flex; flex-shrink:0; align-items:center; gap:2px; vertical-align:middle; }
      .ct-official-badges img { display:block; width:18px; height:18px; max-width:none; aspect-ratio:1; object-fit:contain; image-rendering:auto; }
      .ct-account-badge-name { white-space:normal !important; overflow:visible !important; overflow-wrap:anywhere; }
      .ct-account-badge-name > .ct-official-badges { margin-inline-start:4px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ctRenderProfileBadges(target, user) {
    const kinds = ctProfileBadgeKinds(user);
    let group = ctBadgeGroup(target);
    if (!kinds.length || ctBadgeNativeImages(target).length) { group?.remove(); return; }
    const signature = `${target.username}:${kinds.join(',')}`;
    if (group?.dataset.ctBadgeSignature === signature) return;
    if (!group) {
      group = document.createElement('span');
      group.className = 'ct-official-badges';
      group.dataset.ctOwned = '';
      if (target.kind === 'account') {
        target.name.classList.add('ct-account-badge-name');
        target.name.appendChild(group);
      } else target.name.after(group);
    }
    group.dataset.ctBadgeUser = target.username;
    group.dataset.ctBadgeSignature = signature;
    group.setAttribute('role', 'img');
    const labelKinds = kinds.filter(kind => !(kind === 'founder' && kinds.includes('fighter')) &&
      !(kind === 'fighter' && kinds.includes('centurion')));
    group.setAttribute('aria-label', labelKinds.map(ctBadgeLabel).join(' + '));
    group.title = group.getAttribute('aria-label');
    group.replaceChildren(...kinds.map(kind => {
      const img = document.createElement('img');
      img.src = ctBadgeSource(kind);
      img.alt = '';
      img.width = 18;
      img.height = 18;
      img.draggable = false;
      img.addEventListener('error', () => {
        img.src = `https://app.tweet.app/assets/${kind}-badge-36.png`;
      }, { once: true });
      return img;
    }));
  }

  async function ctPatchProfileBadges(target) {
    const group = ctBadgeGroup(target);
    if (group && group.dataset.ctBadgeUser !== target.username) group.remove();
    if (ctBadgeNativeImages(target).length) { ctBadgeGroup(target)?.remove(); return; }
    const pending = ctBadgeRequests.get(target.name);
    if (pending?.username === target.username) return pending.promise;
    const request = { username: target.username, promise: null };
    ctBadgeRequests.set(target.name, request);
    request.promise = Promise.resolve().then(() => fetchProfile(target.username)).then(user => {
      const current = ctBadgeCurrentTarget(target);
      if (!user || ctBadgeRequests.get(target.name) !== request || current?.name !== target.name ||
          current.username !== target.username || current.host !== target.host) return;
      const returnedUsername = ctBadgeUsername(user.username || user.handle);
      if (returnedUsername && returnedUsername !== target.username) return;
      ctRenderProfileBadges(current, user);
    }).catch(() => {}).finally(() => {
      if (ctBadgeRequests.get(target.name) === request) ctBadgeRequests.delete(target.name);
    });
    return request.promise;
  }

  function patchOfficialBadges(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const images = [...(host.querySelectorAll?.('img[src]') || [])];
    if (host.matches?.('img[src]')) images.push(host);
    images.forEach(ctUpgradeBadgeImage);
    ctPatchNativeBadgeDescriptions(images, host);
    const scopes = new Set(root.querySelectorAll?.('article,[role="dialog"][aria-label="Account menu"]') || []);
    if (root.matches?.('article,[role="dialog"][aria-label="Account menu"]')) scopes.add(root);
    const parent = root.closest?.('article,[role="dialog"][aria-label="Account menu"]');
    if (parent) scopes.add(parent);
    const requests = [];
    for (const scope of scopes) {
      const target = scope.matches('article') ? ctBadgeArticleTarget(scope) : ctBadgeAccountTarget(scope);
      if (!target) continue;
      ctInstallBadgeStyle();
      requests.push(ctPatchProfileBadges(target));
    }
    return Promise.all(requests);
  }
