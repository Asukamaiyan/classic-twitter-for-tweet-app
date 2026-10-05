  // Only the verified author header is eligible for display-name enhancement.
  function findAuthorLeaf(article, username) {
    return [...article.querySelectorAll('button.truncate.font-bold,a[data-testid="author-name"],.ct-author-name')]
      .find(el => !el.closest('[aria-label^="Quoted post"],blockquote') &&
        (normUser(el.textContent) === normUser(username) || el.dataset.ctAuthorUser === normUser(username))) || null;
  }

  async function patchArticle(article) {
    if (!article?.isConnected) return;
    const username = articleAuthor(article);
    if (!username) return;
    const leaf = findAuthorLeaf(article, username);
    if (!leaf) return;
    const previousText = leaf.textContent;
    const user = await fetchProfile(username);
    if (!user || !leaf.isConnected || !article.contains(leaf) ||
        articleAuthor(article) !== username || leaf.textContent !== previousText) return;
    const displayName = clean(user.displayName || user.name || username);
    if (!displayName) return;
    if (leaf.textContent !== displayName) leaf.textContent = displayName;
    leaf.classList.add('ct-author-name');
    leaf.dataset.ctAuthorUser = normUser(username);
    let badge = leaf.parentElement?.querySelector(':scope > .ct-founder');
    const number = user.foundingMemberNumber;
    if (number !== null && number !== undefined && /^\d+$/.test(String(number))) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'ct-founder'; leaf.after(badge); }
      const founder = String(number).padStart(5, '0');
      if (badge.textContent !== `#${founder}`) badge.textContent = `#${founder}`;
      if (badge.title !== `Founder Number #${founder}`) badge.title = `Founder Number #${founder}`;
    } else { badge?.remove(); }
  }

  // Tweet renders the stored bio as a text child in a normal-whitespace P.
  // Preserve its existing nodes, links and handlers; only that verified profile
  // field needs a whitespace rule. Reused/hidden headers release our class.
  const ctProfileBioNodes = new Set();
  function ctPatchProfileBio() {
    const path = location.pathname;
    let route = null;
    const userRoute = /^\/user\/([^/]+)\/?$/.exec(path);
    if (userRoute) {
      try { route = decodeURIComponent(userRoute[1]).toLowerCase(); } catch {}
      if (!route || !/^[a-z0-9_.-]{1,80}$/.test(route)) route = null;
    }
    const profileRoute = /^\/profile\/?$/.test(path) || !!route;
    const candidates = [];
    if (profileRoute) {
      for (const bio of document.querySelectorAll('main p.mt-3.text-tl-app-text.leading-relaxed')) {
        if (bio.closest('article,form,[role="dialog"],[data-ct-owned],[data-ct-local-ui],[hidden],.hidden,[aria-hidden="true"],[contenteditable]') ||
            bio.querySelector('input,textarea,select,[contenteditable]')) continue;
        const details = bio.parentElement;
        const header = bio.previousElementSibling;
        const metadata = bio.nextElementSibling;
        const cover = details?.parentElement;
        const tabs = cover?.nextElementSibling;
        if (!details?.matches('div.px-4.pb-4') || !cover?.matches('div.overflow-hidden') ||
            !header?.matches('div.mt-3.flex.flex-col.gap-1') ||
            !header.querySelector(':scope > h2.font-extrabold.text-tl-app-text.leading-tight.min-w-0') ||
            !metadata?.matches('div.mt-3.flex.flex-wrap.items-center.text-tl-app-text-muted') ||
            !tabs?.matches('div[role="tablist"]')) continue;
        const handles = [...header.querySelectorAll(':scope > p.text-tl-app-text-muted')];
        const handle = handles.length === 1 && !handles[0].children.length &&
          /^@([A-Za-z0-9_.-]{1,80})$/.exec(handles[0].textContent.trim())?.[1].toLowerCase();
        const nativeTabs = [...tabs.children].filter(el => el.matches('button[role="tab"]') && !el.id.startsWith('ct-'));
        const labels = nativeTabs.map(el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent).trim());
        if (!handle || (route && route !== handle) || nativeTabs.length !== 3 ||
            !/^(Tweets|Posts|ツイート|呟き)$/.test(labels[0]) || !/^(Replies|リプライ|返信)$/.test(labels[1]) ||
            !/^(Reposts|Retweets|リツイート|リポスト)$/.test(labels[2])) continue;
        candidates.push(bio);
      }
    }
    const bio = candidates.length === 1 ? candidates[0] : null;
    for (const previous of ctProfileBioNodes) {
      if (previous !== bio) { previous.classList.remove('ct-profile-bio-lines'); ctProfileBioNodes.delete(previous); }
    }
    if (!bio) return;
    let style = document.getElementById('ct-profile-bio-style');
    if (style && !style.matches('style[data-ct-owned="profile-bio"]')) return;
    if (!style) {
      style = document.createElement('style');
      style.id = 'ct-profile-bio-style';
      style.dataset.ctOwned = 'profile-bio';
      style.textContent = '.ct-profile-bio-lines{white-space:pre-wrap;overflow-wrap:anywhere}';
      (document.head || document.documentElement).append(style);
    }
    if (!bio.classList.contains('ct-profile-bio-lines')) bio.classList.add('ct-profile-bio-lines');
    ctProfileBioNodes.add(bio);
  }

  let ctProfileFounderRequest = 0;
  function ctClearProfileFounders(keep = null) {
    document.querySelectorAll('.ct-profile-founder').forEach(badge => {
      if (badge !== keep) badge.remove();
    });
  }

  async function patchProfileFounder() {
    ctPatchProfileBio();
    const request = ++ctProfileFounderRequest;
    if (!/^\/(?:profile\/?|user\/[^/]+\/?)$/.test(location.pathname)) {
      ctClearProfileFounders();
      return;
    }
    const path = location.pathname;
    const username = routeUser() || ownProfileUser();
    if (!username) { ctClearProfileFounders(); return; }
    // React may reuse the heading container when a different profile opens.
    // Remove the previous identity's badge before the new request completes.
    document.querySelectorAll('.ct-profile-founder').forEach(badge => {
      if (badge.dataset.ctFounderUser !== normUser(username) || badge.dataset.ctFounderPath !== path) badge.remove();
    });
    const user = await fetchProfile(username);
    if (request !== ctProfileFounderRequest || location.pathname !== path ||
        normUser(routeUser() || ownProfileUser()) !== normUser(username)) return;
    if (!user) return;
    const number = user.foundingMemberNumber;
    if (number == null || !/^\d+$/.test(String(number))) { ctClearProfileFounders(); return; }
    const displayName = clean(user.displayName || user.name || username);
    const heading = [...document.querySelectorAll('main h1,main h2')].find(el =>
      !el.closest('article,[data-ct-owned]') &&
      [displayName, username, `@${username}`].includes(clean(el.textContent)));
    if (!heading) { ctClearProfileFounders(); return; }
    let badge = heading.parentElement.querySelector(':scope > .ct-profile-founder');
    if (!badge) { badge = document.createElement('span'); badge.className = 'ct-profile-founder'; heading.after(badge); }
    ctClearProfileFounders(badge);
    badge.dataset.ctFounderUser = normUser(username);
    badge.dataset.ctFounderPath = path;
    const label = `#${String(number).padStart(5, '0')}`;
    if (badge.textContent !== label) badge.textContent = label;
  }

  function snapshotFavorite(article) {
    const id = articleId(article);
    if (!id) return null;
    const username = articleAuthor(article) || '';
    const name = clean(article.querySelector('.ct-author-name,button.truncate.font-bold')?.textContent) || username;
    const body = [...article.querySelectorAll('p.whitespace-pre-wrap.break-words')].find(el =>
      el.closest('article') === article && !el.closest('[aria-label^="Quoted post"],blockquote,[aria-live]'));
    return { id, username, name, text: body?.textContent || '', avatar: articleAvatar(article),
      href: `${location.origin}/post/${encodeURIComponent(id)}`, savedAt: Date.now() };
  }
