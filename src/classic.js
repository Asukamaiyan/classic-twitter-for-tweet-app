  // Classic styling is applied only to the authenticated client structure
  // checked against Tweet's public bundle. Native nodes and handlers stay put.
  const ctClassicAppearanceStates = new WeakMap();
  const ctClassicExcluded = '[data-ct-owned],[data-user-content],blockquote,[aria-label^="Quoted post"],[data-testid="quote-tweet"]';

  function ctClassicDocument(root) {
    return root?.nodeType === 9 ? root : root?.ownerDocument || null;
  }

  function ctClassicOwn(element, article) {
    return element?.closest('article') === article && !element.closest(ctClassicExcluded);
  }

  function ctClassicStyle(doc, state) {
    if (state.style?.isConnected) return true;
    // An unrelated element claiming this ID must not be replaced.
    if (doc.getElementById('ct-classic-appearance-style')) return false;
    const style = doc.createElement('style');
    style.id = 'ct-classic-appearance-style';
    style.dataset.ctOwned = 'classic-appearance';
    const composerAvatar = sizes => `:is(${sizes.map(size =>
      `img[width="${size}"][height="${size}"],[role="img"][style*="width: ${size}px"][style*="height: ${size}px"]`).join(',')}).border.object-cover.shrink-0:first-child:not([data-ct-owned] *,[data-user-content] *,blockquote *,[aria-label^="Quoted post"] *,[data-testid="quote-tweet"] *)`;
    style.textContent = `
      .ct-classic-shell {
        --ct-classic-blue:#55acee;
        --ct-classic-blue-hover:#2795e9;
        --ct-classic-border:var(--tl-app-border);
        --ct-classic-surface:var(--tl-app-card);
        --ct-classic-hover:var(--tl-app-bg);
        --ct-classic-compose:var(--tl-app-card);
        font-family:"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
      }
      .ct-classic-shell[data-app-theme="light"] {
        --ct-classic-border:#e1e8ed;
        --ct-classic-hover:#f5f8fa;
        --ct-classic-compose:#e8f5fd;
        background:#f5f8fa!important;
      }
      .ct-classic-shell[data-app-theme="dark"] {
        --ct-classic-hover:rgba(255,255,255,.035);
      }
      .ct-classic-shell .ct-classic-timeline {
        background:var(--ct-classic-surface)!important;
        border-color:var(--ct-classic-border)!important;
      }
      .ct-classic-shell .ct-classic-tweet {
        border-bottom-color:var(--ct-classic-border)!important;
        border-radius:0;
        box-shadow:none;
      }
      @media (hover:hover) {
        .ct-classic-shell .ct-classic-tweet:hover {
          background:var(--ct-classic-hover)!important;
        }
      }
      .ct-classic-shell .ct-classic-avatar {
        border-radius:4px!important;
      }
      .ct-classic-composer-avatar {
        border-radius:4px!important;
      }
      @supports selector(:has(*)) {
        /* These native rows keep replacement avatars square before a scan. */
        #root-container[data-app-theme] div.flex.gap-3:has(textarea#public-tweet-input) > ${composerAvatar([40])},
        div.bg-tl-app-card.border.rounded-3xl.max-w-lg > div.flex.gap-4.mt-2:has(textarea#public-modal-tweet-input) > ${composerAvatar([48])},
        #root-container[data-app-theme] [role="form"].flex.items-start.gap-3:has(textarea[maxlength="280"]) > ${composerAvatar([32,40])},
        #root-container[data-app-theme] [role="form"] > div.flex.items-start.gap-3:has(textarea[maxlength="280"]) > ${composerAvatar([32,40])} {
          border-radius:4px!important;
        }
      }
      .ct-classic-shell .ct-classic-top-tabs {
        padding-top:0!important;
        padding-bottom:0!important;
        background:var(--ct-classic-surface)!important;
        border-bottom-style:solid!important;
        border-bottom-color:var(--ct-classic-border)!important;
        backdrop-filter:none;
      }
      .ct-classic-shell .ct-classic-tabs-list {
        gap:0!important;
        min-height:46px;
      }
      .ct-classic-shell .ct-classic-tab {
        padding:11px 12px 8px!important;
        border:0!important;
        border-bottom:3px solid transparent!important;
        border-radius:0!important;
        background:transparent!important;
        color:var(--tl-app-text-muted)!important;
        font-size:13px;
        line-height:20px;
      }
      .ct-classic-shell .ct-classic-tab.bg-sky-500 {
        color:var(--ct-classic-blue)!important;
        border-bottom-color:var(--ct-classic-blue)!important;
        font-weight:700;
      }
      .ct-classic-shell .ct-classic-tab:hover {
        color:var(--ct-classic-blue)!important;
        background:var(--ct-classic-hover)!important;
      }
      .ct-classic-shell .ct-classic-nav-item {
        border-radius:4px!important;
      }
      .ct-classic-shell .ct-classic-nav-item.text-sky-500,
      .ct-classic-shell .ct-classic-nav-item[aria-current="page"] {
        color:var(--ct-classic-blue)!important;
      }
      .ct-classic-shell .ct-classic-nav-desktop {
        background:var(--ct-classic-surface);
        border:1px solid var(--ct-classic-border);
        border-radius:5px;
        padding:6px;
      }
      .ct-classic-shell .ct-classic-side-panel {
        border-radius:5px!important;
        border-color:var(--ct-classic-border)!important;
        box-shadow:none!important;
      }
      .ct-classic-shell .ct-classic-header,
      .ct-classic-shell .ct-classic-nav-mobile {
        background:var(--ct-classic-surface)!important;
        border-color:var(--ct-classic-border)!important;
        backdrop-filter:none;
      }
      .ct-classic-shell .ct-classic-composer {
        background:var(--ct-classic-compose)!important;
        border-bottom-color:var(--ct-classic-border)!important;
      }
      .ct-classic-shell .ct-classic-submit {
        border-radius:4px!important;
        background:var(--ct-classic-blue)!important;
        box-shadow:none!important;
      }
      .ct-classic-shell .ct-classic-submit:not(:disabled):hover {
        background:var(--ct-classic-blue-hover)!important;
      }
      .ct-classic-shell .ct-classic-mobile-compose {
        background:var(--ct-classic-blue)!important;
        box-shadow:none!important;
      }
      .ct-classic-shell .ct-classic-actions > div > button,
      .ct-classic-shell .ct-classic-actions > button {
        border-radius:4px;
      }
      .ct-classic-shell .ct-classic-favorite-group.text-pink-500,
      .ct-classic-shell .ct-classic-favorite-group.text-pink-500 > span,
      .ct-classic-shell .ct-classic-favorite-group.text-pink-500 > [data-testid="tweet-like-action-count"],
      .ct-classic-shell .ct-classic-favorite-group:hover > span,
      .ct-classic-shell .ct-classic-favorite-group:hover > [data-testid="tweet-like-action-count"] {
        color:#ffac33!important;
      }
      @supports selector(:has(*)) {
        .ct-classic-shell .ct-classic-favorite-group:has(> [data-testid="tweet-like-action"].ct-is-liked) > span,
        .ct-classic-shell .ct-classic-favorite-group:has(> [data-testid="tweet-like-action"].ct-is-liked) > [data-testid="tweet-like-action-count"] {
          color:#ffac33!important;
        }
      }
      @media (min-width:1024px) {
        .ct-classic-shell .ct-classic-layout { max-width:1200px; }
        .ct-classic-shell .ct-classic-grid { column-gap:24px!important; }
        .ct-classic-shell .ct-classic-timeline {
          border-top:1px solid var(--ct-classic-border);
          border-radius:5px 5px 0 0;
        }
      }
      @media (max-width:1023px) {
        .ct-classic-shell .ct-classic-tabs-list { min-height:44px; }
        .ct-classic-shell .ct-classic-tab {
          padding:10px 11px 7px!important;
          min-height:44px;
        }
        .ct-classic-shell .ct-classic-mobile-compose {
          min-width:44px;
          min-height:44px;
        }
        .ct-classic-shell .ct-classic-actions {
          flex-wrap:wrap;
          column-gap:0;
          row-gap:0;
        }
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-like-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-open-comment-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-repost-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-comment-action"],
        .ct-classic-shell .ct-classic-actions [data-testid="tweet-up-arrow-action"] {
          min-width:44px;
          min-height:44px;
        }
      }
    `;
    (doc.head || doc.documentElement).append(style);
    state.style = style;
    return true;
  }

  function ctClassicMarkArticles(articles, mark) {
    for (const article of articles) {
      if (article.closest(ctClassicExcluded) || !article.classList.contains('py-3')) continue;
      // The current client renders this paragraph even for media-only Tweets.
      const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')]
        .find(element => ctClassicOwn(element, article));
      const actions = [...article.querySelectorAll('[data-testid="tweet-action-bar"]')]
        .find(element => ctClassicOwn(element, article) &&
          ['tweet-like-action', 'tweet-open-comment-action', 'tweet-repost-action'].every(id =>
            [...element.querySelectorAll(`[data-testid="${id}"]`)]
              .some(control => control.tagName === 'BUTTON' && ctClassicOwn(control, article))));
      if (!body || !actions) continue;
      const author = [...article.querySelectorAll('button.font-bold.truncate')]
        .find(element => ctClassicOwn(element, article));
      if (!author) continue;
      const row = [...article.children].find(element => element.classList.contains('flex') &&
        element.classList.contains('items-start') && element.classList.contains('gap-3'));
      const avatar = row?.firstElementChild;
      const profile = avatar?.matches('button[aria-label^="View @"]') ? avatar :
        avatar?.querySelector(':scope > button[aria-label^="View @"]');
      if (!profile || !ctClassicOwn(profile, article)) continue;
      const wrapper = profile.firstElementChild;
      const visuals = wrapper?.matches('div.relative.inline-flex.shrink-0.isolate') ? wrapper.children : profile.children;
      const visual = [...visuals].find(element =>
        element.classList.contains('rounded-full') && (element.tagName === 'IMG' || element.getAttribute('role') === 'img'));
      if (!visual) continue;
      mark(article, 'ct-classic-tweet');
      mark(actions, 'ct-classic-actions');
      mark(profile, 'ct-classic-avatar');
      mark(visual, 'ct-classic-avatar');
      const favorite = [...actions.querySelectorAll('[data-testid="tweet-like-action"]')]
        .find(element => ctClassicOwn(element, article));
      const group = favorite?.parentElement;
      const count = group?.children[1];
      if (group?.parentElement === actions && group.firstElementChild === favorite &&
          ['group', 'flex', 'items-center', 'gap-0.5'].every(name => group.classList.contains(name)) &&
          group.children.length <= 2 && (!count || (count.children.length === 0 &&
            /^[\d,.]+$/.test(count.textContent.trim()) &&
            (count.matches('span.text-xs.tabular-nums') || count.matches('button[data-testid="tweet-like-action-count"]'))))) {
        mark(group, 'ct-classic-favorite-group');
      }
    }
  }

  function ctClassicDesired(shell) {
    const wanted = new Map();
    const mark = (element, name) => {
      if (!element || element.closest(ctClassicExcluded)) return;
      if (!wanted.has(element)) wanted.set(element, new Set());
      wanted.get(element).add(name);
    };
    const markComposerAvatar = (input, scope, rowMatches, sizes) => {
      if (!input || input.closest(ctClassicExcluded)) return;
      for (let row = input.parentElement; row && row !== scope; row = row.parentElement) {
        if (!rowMatches(row)) continue;
        const avatar = row.firstElementChild;
        if (!avatar?.matches('img.border.object-cover.shrink-0,[role="img"].border.object-cover.shrink-0') ||
            !avatar.classList.contains('rounded-full')) continue;
        const width = Number(avatar.getAttribute('width') || parseFloat(avatar.style.width));
        const height = Number(avatar.getAttribute('height') || parseFloat(avatar.style.height));
        if (width !== height || !sizes.includes(width)) continue;
        mark(avatar, 'ct-classic-composer-avatar');
        return;
      }
    };
    const main = [...shell.querySelectorAll('main')].find(element =>
      element.classList.contains('lg:col-span-6') &&
      element.classList.contains('bg-tl-app-card') &&
      element.parentElement?.classList.contains('lg:grid-cols-12') &&
      !element.closest(ctClassicExcluded));
    if (!main) return wanted;
    mark(shell, 'ct-classic-shell');
    mark(main, 'ct-classic-timeline');
    const grid = main.parentElement;
    mark(grid, 'ct-classic-grid');
    const layout = grid.parentElement;
    if (layout?.parentElement === shell && layout.classList.contains('max-w-7xl')) {
      mark(layout, 'ct-classic-layout');
    }

    for (const aside of [...grid.children].filter(element =>
      element.tagName === 'ASIDE' && element.classList.contains('lg:col-span-3'))) {
      const nav = [...aside.children].find(element => element.tagName === 'NAV' &&
        element.classList.contains('flex-col') && element.classList.contains('gap-1'));
      if (nav) {
        mark(nav, 'ct-classic-nav');
        mark(nav, 'ct-classic-nav-desktop');
        for (const control of nav.children) {
          if (control.matches('button.rounded-2xl') && control.querySelector('svg') &&
              !control.hasAttribute('data-ct-owned')) mark(control, 'ct-classic-nav-item');
        }
        const submit = nav.querySelector('button#public-sidebar-compose-btn');
        if (submit?.parentElement === nav) mark(submit, 'ct-classic-submit');
      }
      for (const panel of aside.children) {
        if (panel.matches('div.border.bg-tl-app-card') && panel.querySelector(':scope > h3')) {
          mark(panel, 'ct-classic-side-panel');
        }
      }
    }

    for (const header of shell.children) {
      if (header.tagName === 'HEADER' && header.classList.contains('lg:hidden') &&
          header.classList.contains('sticky') && header.querySelector('button[aria-expanded]')) {
        mark(header, 'ct-classic-header');
      }
    }
    for (const nav of shell.querySelectorAll('nav')) {
      if (!nav.classList.contains('lg:hidden') || !nav.classList.contains('bottom-0') ||
          !nav.classList.contains('border-t')) continue;
      const row = nav.firstElementChild;
      if (!row?.classList.contains('justify-around')) continue;
      mark(nav, 'ct-classic-nav');
      mark(nav, 'ct-classic-nav-mobile');
      for (const control of row.children) {
        if (!control.matches('button') || !control.querySelector('svg')) continue;
        if (control.id === 'public-mobile-compose-btn') mark(control, 'ct-classic-mobile-compose');
        else if (control.hasAttribute('aria-label')) mark(control, 'ct-classic-nav-item');
      }
    }

    for (const container of main.querySelectorAll('div.sticky')) {
      if (!container.classList.contains('top-app-header') ||
          !container.classList.contains('border-dashed') ||
          container.closest('article,[data-ct-owned]')) continue;
      const list = container.firstElementChild;
      const controls = list ? [...list.children] : [];
      if (!list?.classList.contains('overflow-x-auto') || controls.length < 2 ||
          !controls.every(element => element.matches('button.rounded-full.text-xs'))) continue;
      mark(container, 'ct-classic-top-tabs');
      mark(list, 'ct-classic-tabs-list');
      controls.forEach(control => mark(control, 'ct-classic-tab'));
    }

    const input = main.querySelector('textarea#public-tweet-input');
    if (input && !input.closest('article,[data-ct-owned]')) {
      let composer = input.parentElement;
      while (composer && composer !== main && !composer.classList.contains('border-b')) {
        composer = composer.parentElement;
      }
      const submit = composer !== main && composer?.querySelector('button#public-tweet-submit-btn');
      if (submit && !composer.closest('article,[data-ct-owned]')) {
        mark(composer, 'ct-classic-composer');
        mark(submit, 'ct-classic-submit');
        markComposerAvatar(input, composer, row => row.classList.contains('flex') && row.classList.contains('gap-3'), [40]);
      }
    }

    const modalInput = shell.ownerDocument.querySelector('textarea#public-modal-tweet-input');
    markComposerAvatar(modalInput, shell.ownerDocument.body, row =>
      ['flex', 'gap-4', 'mt-2'].every(name => row.classList.contains(name)) &&
      row.parentElement?.matches('div.bg-tl-app-card.border.rounded-3xl.max-w-lg'), [48]);
    for (const form of shell.querySelectorAll('[role="form"]')) {
      if (form.closest(ctClassicExcluded)) continue;
      const replyInput = form.querySelector('textarea[maxlength="280"]');
      if (!replyInput || replyInput.closest('[role="form"]') !== form ||
          replyInput.getAttribute('autocomplete') !== 'off') continue;
      markComposerAvatar(replyInput, form.parentElement, row =>
        ['flex', 'items-start', 'gap-3'].every(name => row.classList.contains(name)) &&
        (row === form || row.parentElement === form), [32, 40]);
    }

    ctClassicMarkArticles(main.querySelectorAll('article'), mark);
    return wanted;
  }

  function ctClassicRemoveClasses(element, record, keep = new Set()) {
    for (const name of [...record.added]) {
      if (keep.has(name)) continue;
      if (element.classList.contains(name)) element.classList.remove(name);
      record.added.delete(name);
    }
    if (record.added.size) return;
    const originalTokens = (record.originalClass || '').trim().split(/\s+/).filter(Boolean).sort().join(' ');
    const currentTokens = [...element.classList].sort().join(' ');
    // Restore the original spelling when native classes have stayed the same;
    // otherwise retain classes changed by React while the theme was enabled.
    if (originalTokens === currentTokens && element.getAttribute('class') !== record.originalClass) {
      if (record.originalClass === null) element.removeAttribute('class');
      else element.setAttribute('class', record.originalClass);
    }
  }

  function patchClassicAppearance(root = document, enabled = true) {
    const doc = ctClassicDocument(root);
    if (!doc) return;
    let state = ctClassicAppearanceStates.get(doc);
    if (!state) {
      state = { marked: new Map(), style: null };
      ctClassicAppearanceStates.set(doc, state);
    }
    const shell = doc.getElementById('root-container');
    const scope = root?.nodeType === 1 ? root.closest('article') : null;
    const main = state.main;
    // A native card update cannot alter the surrounding layout. Keep its
    // markers current without traversing every older card in the timeline.
    const partial = enabled && state.enabled === enabled && scope?.isConnected &&
      shell === state.shell && shell?.getAttribute('data-app-theme') === state.theme &&
      main?.isConnected && main.classList.contains('lg:col-span-6') &&
      main.classList.contains('bg-tl-app-card') && main.parentElement?.classList.contains('lg:grid-cols-12') &&
      main.closest('#root-container') === shell && main.contains(scope) && !main.closest(ctClassicExcluded);
    const wanted = new Map();
    if (partial) {
      ctClassicMarkArticles([scope, ...scope.querySelectorAll('article')], (element, name) => {
        if (!element || element.closest(ctClassicExcluded)) return;
        if (!wanted.has(element)) wanted.set(element, new Set());
        wanted.get(element).add(name);
      });
    } else if (enabled) {
      const shell = doc.querySelector('#root-container[data-app-theme="light"],#root-container[data-app-theme="dark"]');
      if (shell && !shell.closest(ctClassicExcluded)) {
        for (const [element, names] of ctClassicDesired(shell)) wanted.set(element, names);
      }
    }
    if (!partial) {
      state.shell = shell;
      state.theme = shell?.getAttribute('data-app-theme');
      state.main = [...wanted].find(([, names]) => names.has('ct-classic-timeline'))?.[0] || null;
      state.enabled = enabled;
    }
    if (wanted.size && !ctClassicStyle(doc, state)) wanted.clear();
    for (const [element, record] of state.marked) {
      if (partial && element.isConnected && record.article !== scope && !scope.contains(element)) continue;
      ctClassicRemoveClasses(element, record, wanted.get(element));
      if (!record.added.size) state.marked.delete(element);
    }
    for (const [element, names] of wanted) {
      let record = state.marked.get(element);
      if (record) record.article = element.closest('article');
      for (const name of names) {
        if (element.classList.contains(name)) continue;
        if (!record) {
          record = { originalClass: element.getAttribute('class'), added: new Set(), article: element.closest('article') };
          state.marked.set(element, record);
        }
        element.classList.add(name);
        record.added.add(name);
      }
    }
    if (!partial && !wanted.size && state.style) {
      state.style.remove();
      state.style = null;
    }
  }
