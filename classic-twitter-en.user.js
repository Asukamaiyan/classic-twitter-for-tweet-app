// ==UserScript==
// @name         Classic Twitter for tweet.app - English
// @namespace    https://tweet.app/
// @version      6.2.6-en
// @description  Classic Twitter-style terminology for tweet.app with display names, Founder Number, star Favorites, Retweets, reply notification fallback, local mute, and a private Favorites tab. Does not touch theme settings.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @connect      api.tweet.app
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    muted: 'classicTwitterEN.mutedUsers',
    favorites: 'classicTwitterEN.favorites',
    replyNotices: 'classicTwitterEN.replyNotifications',
    replySeen: 'classicTwitterEN.replySeenIds',
    replyCounts: 'classicTwitterEN.replyCounts',
    replyInit: 'classicTwitterEN.replyWatcherInitialized'
  };

  const profileCache = new Map();
  const profilePending = new Map();

  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const normUser = v => clean(v).replace(/^@/, '').toLowerCase();
  const validUser = v => {
    const s = clean(v).replace(/^@/, '');
    return /^[A-Za-z0-9_.-]{1,80}$/.test(s) ? s : null;
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  const EN = new Map([
    ['Feed', 'Home'],
    ['Posts', 'Tweets'],
    ['Post', 'Tweet'],
    ['Reposts', 'Retweets'],
    ['Repost', 'Retweet'],
    ['Quote', 'Quote Tweet'],
    ['Undo repost', 'Undo Retweet'],
    ['Like', 'Favorite'],
    ['Likes', 'Favorites'],
    ['Liked', 'Favorited'],
    ['Liked by', 'Favorited by'],
    ['Unlike', 'Unfavorite'],
    ['Report post', 'Report Tweet'],
    ['Delete post', 'Delete Tweet'],
    ['Repost removed', 'Retweet removed'],
    ['Repost added', 'Retweeted'],
    ['Post reposted', 'Retweeted'],
    ['Post liked', 'Favorited'],
    ['Like removed', 'Favorite removed'],
    ['Post deleted', 'Tweet deleted'],
    ['Post posted', 'Tweet sent'],
    ['mentioned you in a post', 'mentioned you in a Tweet'],
    ['mentioned you in a tweet', 'mentioned you in a Tweet'],
    ['replied to your post', 'replied to your Tweet'],
    ['replied to your tweet', 'replied to your Tweet'],
    ['liked your post', 'favorited your Tweet'],
    ['liked your tweet', 'favorited your Tweet'],
    ['favorited your post', 'favorited your Tweet'],
    ['reposted your post', 'retweeted your Tweet'],
    ['reposted your tweet', 'retweeted your Tweet'],
    ['retweeted your post', 'retweeted your Tweet']
  ]);

  function installStyle() {
    if (document.getElementById('ct-en-style')) return;

    const style = document.createElement('style');
    style.id = 'ct-en-style';
    style.textContent = `
      [data-testid="tweet-like-action"] svg { display:none!important; }
      [data-testid="tweet-like-action"]::before {
        content:"☆";
        display:inline-block;
        font:700 23px/18px Arial,sans-serif;
        transform:translateY(-1px);
        transform-origin:center;
      }
      [data-testid="tweet-like-action"][aria-pressed="true"]::before,
      [data-testid="tweet-like-action"].text-pink-500::before {
        content:"★";
        color:#ffac33!important;
      }
      [data-testid="tweet-like-action"][aria-pressed="true"],
      [data-testid="tweet-like-action"].text-pink-500 {
        color:#ffac33!important;
      }
      [data-testid="tweet-like-action"]:hover {
        color:#ffac33!important;
        background:rgba(255,172,51,.12)!important;
      }
      [data-testid="tweet-like-action"].ct-star-pop::before {
        animation:ctStarPop .32s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes ctStarPop {
        0% { transform:translateY(-1px) scale(.72) rotate(-8deg); opacity:.55; }
        48% { transform:translateY(-1px) scale(1.3) rotate(6deg); }
        74% { transform:translateY(-1px) scale(.94) rotate(-2deg); }
        100% { transform:translateY(-1px) scale(1); }
      }
      .ct-founder,
      .ct-profile-founder {
        display:inline-flex;
        align-items:center;
        margin-left:4px;
        font-size:12px;
        line-height:18px;
        font-weight:700;
        white-space:nowrap;
        opacity:.72;
      }
      .ct-profile-founder { font-size:13px; opacity:.78; }
      .ct-twitter-logo {
        width:28px!important;
        height:28px!important;
        object-fit:contain!important;
        display:block!important;
      }
      .ct-profile-mute { margin-left:8px!important; }
      .ct-notification-fav-icon { position:relative!important; }
      .ct-notification-fav-icon > svg { visibility:hidden!important; }
      .ct-notification-fav-icon::after {
        content:"★";
        position:absolute!important;
        left:50%!important;
        top:50%!important;
        transform:translate(-50%,-50%)!important;
        color:#ffac33!important;
        font:700 27px/1 Arial,sans-serif!important;
        pointer-events:none!important;
      }
      #ct-favorites-tab {
        position:relative;
        z-index:3;
        flex:1 1 0!important;
        min-width:0!important;
        border:0;
        border-bottom:2px solid transparent!important;
        background:transparent;
        color:inherit;
        font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;
        cursor:pointer;
        padding:0 10px;
      }
      #ct-favorites-tab:hover { background:rgba(127,127,127,.08); }
      #ct-favorites-tab[data-active="1"] {
        color:#1d9bf0;
        border-bottom-color:#1d9bf0!important;
      }
      #ct-favorites-panel,
      #ct-reply-panel {
        position:fixed;
        z-index:2147482000;
        overflow:auto;
        overscroll-behavior:contain;
        background:inherit;
        color:inherit;
        border:1px solid rgba(127,127,127,.28);
        box-shadow:0 10px 35px rgba(0,0,0,.25);
      }
      #ct-favorites-panel { border-radius:0 0 12px 12px; }
      #ct-reply-panel { border-radius:14px; max-height:min(48vh,460px); }
      .ct-local-head {
        position:sticky;
        top:0;
        z-index:2;
        display:flex;
        justify-content:space-between;
        gap:12px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        background:inherit;
        color:inherit;
      }
      .ct-local-title { font-weight:800; }
      .ct-local-note { font-size:11px; opacity:.6; margin-top:2px; }
      .ct-local-close {
        border:0;
        background:transparent;
        color:inherit;
        cursor:pointer;
        font-size:20px;
        padding:3px 8px;
        border-radius:999px;
      }
      .ct-local-close:hover { background:rgba(127,127,127,.14); }
      .ct-local-card {
        display:flex;
        gap:10px;
        padding:12px 16px;
        border-bottom:1px solid rgba(127,127,127,.28);
        cursor:pointer;
      }
      .ct-local-card:hover { background:rgba(127,127,127,.08); }
      .ct-local-avatar {
        width:40px;
        height:40px;
        border-radius:999px;
        object-fit:cover;
        flex:0 0 auto;
        background:rgba(127,127,127,.25);
      }
      .ct-local-main { min-width:0; flex:1; }
      .ct-local-meta {
        display:flex;
        gap:4px;
        flex-wrap:wrap;
        align-items:center;
        font-size:13px;
        line-height:18px;
      }
      .ct-local-name { font-weight:800; }
      .ct-local-handle,
      .ct-local-time { opacity:.62; }
      .ct-local-text {
        margin-top:3px;
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        font-size:14px;
        line-height:20px;
      }
      .ct-local-empty { padding:28px 18px; text-align:center; opacity:.65; }
      .ct-reply-kicker { font-size:12px; color:#1d9bf0; margin-bottom:3px; }
      #ct-reply-badge {
        position:fixed;
        z-index:2147483000;
        min-width:18px;
        height:18px;
        padding:0 5px;
        border-radius:999px;
        background:#1d9bf0;
        color:#fff;
        font:700 11px/18px Arial;
        text-align:center;
        pointer-events:none;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function classicNotificationText(t) {
    t = clean(t);
    if (!t) return null;

    let m;

    const replacements = [
      [/^(.+?)\s+(?:liked|favorited) your (?:post|tweet)$/i,
        a => `${a} favorited your Tweet`],
      [/^(.+?)\s+(?:reposted|retweeted) your (?:post|tweet)$/i,
        a => `${a} retweeted your Tweet`],
      [/^(.+?)\s+mentioned you(?: in a (?:post|tweet))?$/i,
        a => `${a} mentioned you`],
      [/^(.+?)\s+replied to your (?:post|tweet)$/i,
        a => `${a} replied to your Tweet`],
      [/^(.+?)\s+(?:liked|favorited) your reply$/i,
        a => `${a} favorited your reply`],
      [/^(.+?)\s+(?:reposted|retweeted) your reply$/i,
        a => `${a} retweeted your reply`]
    ];

    for (const [re, fn] of replacements) {
      if ((m = t.match(re))) return fn(m[1]);
    }

    return null;
  }

  function translateTextNode(node) {
    const parent = node?.parentElement;
    if (!parent?.isConnected) return;
    if (parent.closest('textarea,input,[contenteditable="true"],script,style')) return;

    const raw = node.nodeValue || '';
    const t = clean(raw);
    if (!t || t.length > 500) return;

    const out = classicNotificationText(t) || EN.get(t);
    if (out && out !== t) node.nodeValue = raw.replace(t, out);
  }

  function patchUI(root = document) {
    const host = root instanceof Node ? root : document;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(translateTextNode);
  }

  function patchInputs(root = document) {
    const list = [];
    if (root instanceof Element && root.matches('input[placeholder],textarea[placeholder]')) {
      list.push(root);
    }
    root.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));

    for (const el of list) {
      const p = el.getAttribute('placeholder') || '';
      if (/^Post your reply$/i.test(p)) el.placeholder = 'Tweet your reply';
      else if (/^Create a post$/i.test(p)) el.placeholder = 'Compose a Tweet';
    }
  }

  function hideAffiliation() {
    document.querySelectorAll('span,p,div,a,small').forEach(el => {
      if (
        el.isConnected &&
        !el.children.length &&
        /^Not Affiliated with X$/i.test(clean(el.textContent))
      ) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function patchBrand() {
    document.querySelectorAll('img').forEach(img => {
      if (!img.isConnected || img.dataset.ctBrandPatched === '1') return;
      if (img.closest('article')) return;

      const alt = clean(img.getAttribute('alt') || '');
      const title = clean(img.getAttribute('title') || '');
      const rawSrc = img.getAttribute('src') || '';
      let path = '';

      try {
        path = new URL(rawSrc, location.href).pathname;
      } catch {
        path = rawSrc;
      }

      if (/avatar|profile|media|photo|processed|firebase/i.test(`${alt} ${title} ${path}`)) return;

      const isBrandAsset = /\/assets\/brand\/[^/]*(?:bird|logo|twitter|tweet)[^/]*\.(?:svg|png|webp)$/i.test(path);
      const isExplicitBrandAlt = /^(?:twitter|tweet|twitter logo|tweet logo|brand logo|bird logo)$/i.test(`${alt} ${title}`.trim());

      if (!isBrandAsset && !isExplicitBrandAlt) return;

      const r = img.getBoundingClientRect();
      if (r.width > 80 || r.height > 80) return;

      img.src = LOGO;
      img.classList.add('ct-twitter-logo');
      img.dataset.ctBrandPatched = '1';
    });
  }

  function requestJSON(url, headers = {}) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(resolve => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 12000,
          headers: { Accept: 'application/json', ...headers },
          onload: response => {
            try {
              resolve(
                response.status >= 200 && response.status < 300
                  ? JSON.parse(response.responseText)
                  : null
              );
            } catch {
              resolve(null);
            }
          },
          onerror: () => resolve(null),
          ontimeout: () => resolve(null)
        });
      });
    }

    return fetch(url, {
      headers: { Accept: 'application/json', ...headers }
    })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  function fetchProfile(username) {
  const key = normUser(username);
  if (!key) return Promise.resolve(null);
  if (profileCache.has(key)) return Promise.resolve(profileCache.get(key));
  if (profilePending.has(key)) return profilePending.get(key);

  const promise = getAuth()
    .then(auth => {
      if (!auth?.token) return null;
      return requestJSON(
        PROFILE_API + encodeURIComponent(username),
        { Authorization: `Bearer ${auth.token}` }
      );
    })
    .then(json => {
      const user =
        json?.user ??
        json?.profile ??
        json?.data?.user ??
        json?.data?.profile ??
        json?.data ??
        json;

      if (user) profileCache.set(key, user);
      profilePending.delete(key);
      return user || null;
    })
    .catch(() => {
      profilePending.delete(key);
      return null;
    });

  profilePending.set(key, promise);
  return promise;
}

  function userFromHref(href) {
    try {
      const m = new URL(href, location.origin).pathname.match(/^\/user\/([^/?#]+)/i);
      return m ? validUser(decodeURIComponent(m[1])) : null;
    } catch {
      return null;
    }
  }

  function articleAuthor(article) {
    if (!article) return null;

    for (const el of article.querySelectorAll('button[aria-label],a[href],span,div')) {
      let m = (el.getAttribute?.('aria-label') || '').match(/^View @(.+?)'s profile$/i);
      if (m) return validUser(m[1]);

      const user = userFromHref(el.getAttribute?.('href') || '');
      if (user) return user;

      if (!el.children.length && (m = clean(el.textContent).match(/^@([A-Za-z0-9_.-]{1,80})$/))) {
        return validUser(m[1]);
      }
    }

    return null;
  }

  function findAuthorLeaf(article, username) {
    const target = normUser(username);
    return (
      [...article.querySelectorAll('button,span,a,div,strong')].find(el => {
        if (!el.isConnected || el.children.length) return false;
        const t = clean(el.textContent);
        return normUser(t) === target || normUser(t.replace(/^@/, '')) === target;
      }) || null
    );
  }

  let muted = new Set((loadJSON(KEY.muted, []) || []).map(normUser).filter(Boolean));
  const isMuted = username => muted.has(normUser(username));

  function saveMuted() {
    saveJSON(KEY.muted, [...muted].sort());
  }

  function toggleMuted(username) {
    const key = normUser(username);
    if (!key) return;

    if (muted.has(key)) muted.delete(key);
    else muted.add(key);

    saveMuted();
    patchFeed(document);
    patchProfileMute();
  }

  async function patchArticle(article) {
    if (!article?.isConnected) return;

    const username = articleAuthor(article);
    if (!username) return;

    if (isMuted(username)) {
      article.style.setProperty('display', 'none', 'important');
      return;
    }

    article.style.removeProperty('display');

    const user = await fetchProfile(username);
    if (!user || !article.isConnected) return;

    const displayName = clean(user.displayName || user.name || username);
    const leaf = findAuthorLeaf(article, username);
    if (!leaf || !displayName) return;

    leaf.textContent = displayName;
    leaf.classList.add('ct-author-name');

    let badge = leaf.parentElement?.querySelector(':scope > .ct-founder');
    const number = user.foundingMemberNumber;

    if (number !== null && number !== undefined && number !== '') {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ct-founder';
        leaf.after(badge);
      }

      const founder = String(number).padStart(5, '0');
      badge.textContent = `#${founder}`;
      badge.title = `Founder Number #${founder}`;
    }
  }

  function collectArticles(root = document) {
    const set = new Set();

    if (root instanceof Element) {
      if (root.matches('article')) set.add(root);
      const parent = root.closest('article');
      if (parent) set.add(parent);
    }

    root.querySelectorAll?.('article').forEach(article => set.add(article));
    return set;
  }

  function patchFeed(root = document) {
    for (const article of collectArticles(root)) patchArticle(article);
  }

  async function patchRetweetRows(root = document) {
    const leaves = [];
    root.querySelectorAll?.('span,div,p').forEach(el => {
      if (!el.children.length) leaves.push(el);
    });

    for (const el of leaves) {
      const t = clean(el.textContent);
      const m = t.match(/^@?([A-Za-z0-9_.-]{1,80})\s+reposted$/i);
      if (!m) continue;

      const username = validUser(m[1]);
      const user = username ? await fetchProfile(username) : null;
      if (!user || !el.isConnected) continue;

      el.textContent = `${user.displayName || user.name || username} Retweeted`;
    }
  }

  function routeUser() {
    const m = location.pathname.match(/^\/user\/([^/?#]+)/i);
    return m ? validUser(decodeURIComponent(m[1])) : null;
  }

  function ownProfileUser() {
    if (location.pathname !== '/profile') return null;

    for (const el of document.querySelectorAll('main span,main a,main div,main p')) {
      if (el.children.length) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 30 || r.top > 520) continue;
      const m = clean(el.textContent).match(/^@([A-Za-z0-9_.-]{1,80})$/);
      if (m) return validUser(m[1]);
    }

    return null;
  }

  async function patchProfileFounder() {
    const username = routeUser() || ownProfileUser();
    if (!username) return;

    const user = await fetchProfile(username);
    if (!user) return;

    const number = user.foundingMemberNumber;
    if (number === null || number === undefined || number === '') return;

    const displayName = clean(user.displayName || user.name || username);
    const main = document.querySelector('main') || document;

    const nameEl = [...main.querySelectorAll('h1,h2,h3,span,a,div,strong')].find(el => {
      if (
        !el.isConnected ||
        el.children.length ||
        el.closest('article') ||
        el.classList.contains('ct-profile-founder')
      ) {
        return false;
      }

      const r = el.getBoundingClientRect();
      if (r.top < 30 || r.top > 520 || r.width <= 0 || r.height <= 0) return false;

      const t = clean(el.textContent);
      return t === displayName || normUser(t) === normUser(username);
    });

    if (!nameEl) return;
    if (clean(nameEl.textContent) !== displayName) nameEl.textContent = displayName;

    let badge = nameEl.parentElement?.querySelector(':scope > .ct-profile-founder');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ct-profile-founder';
      nameEl.after(badge);
    }

    const founder = String(number).padStart(5, '0');
    badge.textContent = `#${founder}`;
    badge.title = `Founder Number #${founder}`;
  }

  function patchProfileMute() {
    const username = routeUser();
    const main = document.querySelector('main') || document;
    const old = main.querySelector('.ct-profile-mute');

    if (!username) {
      old?.remove();
      return;
    }

    const ref = [...main.querySelectorAll('button')].find(button =>
      !button.closest('article') && /^(Follow|Unfollow)$/i.test(clean(button.textContent))
    );

    if (!ref) {
      old?.remove();
      return;
    }

    const button = old || ref.cloneNode(true);
    if (!old) {
      button.removeAttribute('id');
      button.classList.add('ct-profile-mute');
      ref.parentElement?.appendChild(button);
    }

    button.textContent = isMuted(username) ? 'Unmute' : 'Mute';
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      toggleMuted(username);
    };
  }

  let menuUser = null;

  function isMenuButton(button) {
    const text = [
      button?.getAttribute?.('aria-label'),
      button?.getAttribute?.('title'),
      button?.getAttribute?.('data-testid'),
      button?.textContent
    ]
      .filter(Boolean)
      .join(' ');

    return (
      String(button?.getAttribute?.('aria-haspopup') || '').toLowerCase() === 'menu' ||
      /(^|\s)(more|options|menu)(\s|$)/i.test(text)
    );
  }

  document.addEventListener(
    'click',
    event => {
      const button = event.target.closest?.('button,[role="button"]');
      const article = button?.closest?.('article');
      if (!button || !article || !isMenuButton(button)) return;

      const username = articleAuthor(article);
      if (!username) return;

      menuUser = username;
      [0, 80, 250].forEach(delay => setTimeout(patchOpenMuteMenu, delay));
    },
    true
  );

  function visible(el) {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function patchOpenMuteMenu() {
    if (!menuUser) return;

    const all = [...document.querySelectorAll('[role="menuitem"],button,a,div[role="button"]')];
    const anchor =
      all.find(el => visible(el) && /^(Report post|Report Tweet|Report)$/i.test(clean(el.textContent))) ||
      all.find(el => visible(el) && /^(Follow|Unfollow)(\s+@?.+)?$/i.test(clean(el.textContent)));

    if (!anchor) return;

    const item = anchor.closest('[role="menuitem"],button,a,[role="button"]') || anchor;
    const parent = item.parentElement;
    if (!parent) return;

    let muteItem = parent.querySelector(':scope > [data-ct-mute-menu="1"]');
    if (!muteItem) {
      muteItem = document.createElement(item.tagName.toLowerCase());
      muteItem.className = item.className || '';
      muteItem.setAttribute('role', item.getAttribute('role') || 'menuitem');
      muteItem.dataset.ctMuteMenu = '1';
      parent.insertBefore(muteItem, item);
    }

    muteItem.textContent = isMuted(menuUser) ? `Unmute @${menuUser}` : `Mute @${menuUser}`;
    muteItem.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      toggleMuted(menuUser);
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true
        })
      );
    };
  }

  function articleId(article) {
    for (const el of article.querySelectorAll('a[href]')) {
      const href = el.getAttribute('href') || '';
      const m = href.match(/\/(?:post|status|tweet)\/([^/?#]+)/i);
      if (m) return m[1];
    }

    return article.getAttribute('data-post-id') || article.getAttribute('data-tweet-id') || '';
  }

  function articleText(article) {
    return (
      [...article.querySelectorAll('p,div[dir="auto"],span')]
        .filter(el => !el.children.length)
        .map(el => clean(el.textContent))
        .filter(t => t.length > 2 && !/^@/.test(t) && !/^\d+[smhd]$/.test(t) && !EN.has(t))
        .sort((a, b) => b.length - a.length)[0] ||
      ''
    );
  }

  function articleAvatar(article) {
    return article.querySelector('img[src*="avatar"],img[alt*="profile" i]')?.src || '';
  }

  function snapshotFavorite(article) {
    const id = articleId(article);
    if (!id) return null;

    const username = articleAuthor(article) || '';
    const name = clean(article.querySelector('.ct-author-name,strong')?.textContent) || username;
    const href =
      [...article.querySelectorAll('a[href]')]
        .map(el => el.href)
        .find(h => /(post|status|tweet)\//i.test(h)) ||
      '';

    return {
      id,
      username,
      name,
      text: articleText(article),
      avatar: articleAvatar(article),
      href,
      savedAt: Date.now()
    };
  }

  function loadFavorites() {
    const items = loadJSON(KEY.favorites, []);
    return Array.isArray(items) ? items : [];
  }

  function saveFavorite(item) {
    if (!item?.id) return;
    saveJSON(
      KEY.favorites,
      [item, ...loadFavorites().filter(x => x.id !== item.id)].slice(0, 500)
    );
  }

  function removeFavorite(id) {
    saveJSON(KEY.favorites, loadFavorites().filter(x => x.id !== id));
  }

  document.addEventListener(
    'click',
    event => {
      const button = event.target.closest?.('[data-testid="tweet-like-action"]');
      if (!button) return;

      const article = button.closest('article');
      if (!article) return;

      const snapshot = snapshotFavorite(article);
      const wasLiked = button.getAttribute('aria-pressed') === 'true';

      button.classList.remove('ct-star-pop');
      void button.offsetWidth;
      button.classList.add('ct-star-pop');
      setTimeout(() => button.classList.remove('ct-star-pop'), 380);

      setTimeout(() => {
        const nowLiked = button.getAttribute('aria-pressed') === 'true';

        if (!wasLiked && nowLiked) saveFavorite(snapshot);
        else if (wasLiked && !nowLiked) removeFavorite(snapshot?.id);

        if (favoritesActive) renderFavoritesPanel();
      }, 450);
    },
    true
  );

  function patchFavoriteButtons(root = document) {
    root.querySelectorAll?.('[data-testid="tweet-like-action"]').forEach(button => {
      const liked = button.getAttribute('aria-pressed') === 'true';
      button.title = liked ? 'Unfavorite' : 'Favorite';

      const aria = button.getAttribute('aria-label') || '';
      button.setAttribute(
        'aria-label',
        aria.replace(/^Like,/i, 'Favorite,').replace(/^Unlike,/i, 'Unfavorite,')
      );

      if (liked) {
        const article = button.closest('article');
        const snapshot = article && snapshotFavorite(article);
        if (snapshot) saveFavorite(snapshot);
      }
    });
  }

  let favoritesActive = false;

  function findRetweetTab() {
    if (location.pathname !== '/profile') return null;
    return (
      [...document.querySelectorAll('main a,main button,main [role="tab"]')].find(el =>
        /^(Reposts|Retweets)$/i.test(clean(el.textContent))
      ) || null
    );
  }

  function patchFavoriteProfileTab() {
    let tab = document.getElementById('ct-favorites-tab');

    if (location.pathname !== '/profile') {
      tab?.remove();
      favoritesActive = false;
      closeFavoritesPanel();
      return;
    }

    const ref = findRetweetTab();
    if (!ref) {
      tab?.remove();
      return;
    }

    if (!tab) {
      tab = document.createElement('button');
      tab.id = 'ct-favorites-tab';
      tab.type = 'button';
      tab.textContent = 'Favorites';

      const parent = ref.parentElement;
      if (!parent) return;
      parent.appendChild(tab);

      tab.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        favoritesActive = !favoritesActive;
        tab.dataset.active = favoritesActive ? '1' : '0';
        renderFavoritesPanel();
      };
    }

    tab.dataset.active = favoritesActive ? '1' : '0';
  }

  function centerRect() {
    const main = document.querySelector('main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    return r.width > 280 ? r : null;
  }

  function panelHead(title, note, onClose) {
    const head = document.createElement('div');
    head.className = 'ct-local-head';

    const left = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'ct-local-title';
    titleEl.textContent = title;
    left.appendChild(titleEl);

    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'ct-local-note';
      noteEl.textContent = note;
      left.appendChild(noteEl);
    }

    const close = document.createElement('button');
    close.className = 'ct-local-close';
    close.textContent = '×';
    close.onclick = onClose;

    head.append(left, close);
    return head;
  }

  function localCard(item, reply = false) {
    const row = document.createElement('div');
    row.className = 'ct-local-card';

    if (item.avatar || item.authorAvatar) {
      const img = document.createElement('img');
      img.className = 'ct-local-avatar';
      img.src = item.avatar || item.authorAvatar;
      row.appendChild(img);
    }

    const main = document.createElement('div');
    main.className = 'ct-local-main';

    if (reply) {
      const kicker = document.createElement('div');
      kicker.className = 'ct-reply-kicker';
      kicker.textContent = 'replied to your Tweet';
      main.appendChild(kicker);
    }

    const meta = document.createElement('div');
    meta.className = 'ct-local-meta';

    const name = document.createElement('span');
    name.className = 'ct-local-name';
    name.textContent =
      item.name || item.authorName || item.username || item.authorUsername || '';
    meta.appendChild(name);

    const username = item.username || item.authorUsername;
    if (username) {
      const handle = document.createElement('span');
      handle.className = 'ct-local-handle';
      handle.textContent = `@${username}`;
      meta.appendChild(handle);
    }

    main.appendChild(meta);

    if (item.text) {
      const text = document.createElement('div');
      text.className = 'ct-local-text';
      text.textContent = item.text;
      main.appendChild(text);
    }

    row.appendChild(main);
    return row;
  }

  function closeFavoritesPanel() {
    document.getElementById('ct-favorites-panel')?.remove();
  }

  function renderFavoritesPanel() {
    if (!favoritesActive || location.pathname !== '/profile') {
      closeFavoritesPanel();
      return;
    }

    const r = centerRect();
    if (!r) return;

    let panel = document.getElementById('ct-favorites-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-favorites-panel';
      document.body.appendChild(panel);
    }

    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.max(100, Math.round(r.top + 88))}px`;
    panel.style.width = `${Math.round(r.width)}px`;
    panel.style.maxHeight = `calc(100vh - ${Math.max(110, Math.round(r.top + 100))}px)`;
    panel.innerHTML = '';

    panel.appendChild(
      panelHead('★ Favorites', 'Stored only in this browser', () => {
        favoritesActive = false;
        const tab = document.getElementById('ct-favorites-tab');
        if (tab) tab.dataset.active = '0';
        closeFavoritesPanel();
      })
    );

    const data = loadFavorites();
    if (!data.length) {
      const empty = document.createElement('div');
      empty.className = 'ct-local-empty';
      empty.textContent = 'No Favorites yet.';
      panel.appendChild(empty);
      return;
    }

    for (const item of data) {
      const row = localCard(item, false);
      row.onclick = () => {
        if (item.href) location.href = item.href;
      };
      panel.appendChild(row);
    }
  }

  function notificationLeaves(root = document) {
    const out = [];
    root.querySelectorAll?.('main p,main span,main div').forEach(el => {
      if (!el.children.length) {
        const t = clean(el.textContent);
        if (t && t.length < 500) out.push(el);
      }
    });
    return out;
  }

  function patchNotifications(root = document) {
    if (!location.pathname.startsWith('/notifications')) return;

    for (const el of notificationLeaves(root)) {
      const t = clean(el.textContent);
      if (!t) continue;

      const out = classicNotificationText(t) || EN.get(t);
      if (out && out !== t) el.textContent = out;

      const finalText = out || t;
      if (/favorited/i.test(finalText)) {
        const row = el.closest('button,[role="button"]') || el.parentElement;
        const svg = row?.querySelector('svg');
        if (svg) svg.parentElement?.classList.add('ct-notification-fav-icon');
      }
    }
  }

  function findAuth(value, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return null;
    seen.add(value);

    const token =
      value?.stsTokenManager?.accessToken ||
      value?.accessToken ||
      value?.tokenManager?.accessToken ||
      null;

    const uid = value?.uid || value?.user?.uid || value?.userId || null;

    if (typeof token === 'string' && token.length > 40) return { token, uid };

    let values = [];
    try {
      values = Object.values(value);
    } catch {
      return null;
    }

    for (const child of values) {
      if (child && typeof child === 'object') {
        const hit = findAuth(child, depth + 1, seen);
        if (hit) return hit;
      }
    }

    return null;
  }

  function getAuth() {
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (!done) {
          done = true;
          resolve(value || null);
        }
      };

      try {
        const request = indexedDB.open('firebaseLocalStorageDb');
        request.onerror = () => finish(null);
        request.onsuccess = () => {
          const db = request.result;
          try {
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) return finish(null);

            const tx = db.transaction('firebaseLocalStorage', 'readonly');
            const all = tx.objectStore('firebaseLocalStorage').getAll();
            all.onerror = () => finish(null);
            all.onsuccess = () => {
              for (const row of all.result || []) {
                const hit = findAuth(row?.value ?? row);
                if (hit) return finish(hit);
              }
              finish(null);
            };
          } catch {
            finish(null);
          }
        };

        setTimeout(() => finish(null), 2500);
      } catch {
        finish(null);
      }
    });
  }

  function authJSON(path, auth) {
    if (!auth?.token) return Promise.resolve(null);
    return requestJSON(path.startsWith('http') ? path : API_ORIGIN + path, {
      Authorization: `Bearer ${auth.token}`
    });
  }

  function items(json, keys = []) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return [];

    for (const key of [...keys, 'items', 'notifications', 'posts', 'replies', 'results']) {
      if (Array.isArray(json[key])) return json[key];
    }

    return json.data ? items(json.data, keys) : [];
  }

  const postId = post => String(post?.originalPostId || post?.postId || post?.id || '').trim();
  const replyCount = post =>
    Number(
      post?.replyCount ??
        post?.comments ??
        post?.commentCount ??
        post?.repliesCount ??
        post?.reply_count ??
        0
    ) || 0;
  const author = post =>
    validUser(post?.authorUsername || post?.authorHandle || post?.author?.username || post?.username);
  const postText = post => String(post?.text || post?.body || post?.content || post?.replyText || '');
  const postName = post =>
    String(post?.authorName || post?.actorName || post?.author?.displayName || author(post) || '');
  const postAvatar = post =>
    String(post?.authorAvatar || post?.actorAvatar || post?.author?.avatarUrl || post?.avatarUrl || '');
  const postCreated = post => String(post?.createdAt || post?.created_at || post?.timestamp || '');

  function loadReplyNotices() {
    const list = loadJSON(KEY.replyNotices, []);
    return Array.isArray(list) ? list : [];
  }

  function saveReplyNotice(reply, parentId = '') {
    const id = postId(reply);
    const username = author(reply);
    if (!id || !username) return;

    const list = loadReplyNotices();
    const old = list.find(x => x.id === id);

    const record = {
      id,
      parentId: String(reply?.parentPostId || reply?.parentId || parentId || ''),
      authorUsername: username,
      authorName: postName(reply) || username,
      authorAvatar: postAvatar(reply),
      text: postText(reply),
      createdAt: postCreated(reply) || new Date().toISOString(),
      detectedAt: Date.now(),
      read: old?.read || false
    };

    saveJSON(
      KEY.replyNotices,
      [record, ...list.filter(x => x.id !== id)]
        .sort(
          (a, b) =>
            new Date(b.createdAt || b.detectedAt) - new Date(a.createdAt || a.detectedAt)
        )
        .slice(0, 100)
    );
  }

  function markReplyRead(id) {
    const list = loadReplyNotices();
    list.forEach(item => {
      if (item.id === id) item.read = true;
    });
    saveJSON(KEY.replyNotices, list);
  }

  let replyBusy = false;
  let lastFull = 0;

  async function replyWatchTick() {
    if (replyBusy) return;
    replyBusy = true;

    try {
      const auth = await getAuth();
      if (!auth?.token) return;

      const me = await authJSON('/api/user-profile', auth);
      const myHandle = validUser(
        me?.username || me?.handle || me?.user?.username || me?.profile?.username
      );

      const notificationsJson = await authJSON('/api/notifications?limit=50', auth);

      for (const notification of items(notificationsJson, ['notifications'])) {
        const type = String(
          notification?.type ||
            notification?.eventType ||
            notification?.kind ||
            notification?.notificationType ||
            ''
        ).toUpperCase();

        const message = String(notification?.message || notification?.text || '');
        if (!type.includes('REPLY') && !/replied to/i.test(message)) continue;

        const object = notification?.reply || notification?.post || notification?.tweet || notification;
        const id = postId(object) || String(notification?.postId || notification?.replyPostId || notification?.id || '');
        const username = validUser(
          notification?.actorHandle ||
            notification?.actorUsername ||
            notification?.actor?.username ||
            author(object)
        );

        if (id && username) {
          saveReplyNotice(
            {
              ...object,
              id,
              authorUsername: username,
              authorName:
                notification?.actorName ||
                notification?.actorDisplayName ||
                notification?.actor?.displayName ||
                postName(object) ||
                username,
              authorAvatar:
                notification?.actorAvatar ||
                notification?.actor?.avatarUrl ||
                postAvatar(object),
              text: notification?.replyText || notification?.postText || postText(object),
              createdAt:
                notification?.createdAt || notification?.created_at || postCreated(object)
            },
            notification?.parentPostId || notification?.targetPostId || ''
          );
        }
      }

      if (!myHandle) {
        renderReplyPanel();
        patchReplyBadge();
        return;
      }

      const [postsJson, repliesJson] = await Promise.all([
        authJSON(`/api/users/${encodeURIComponent(myHandle)}/posts?limit=24`, auth),
        authJSON(`/api/users/${encodeURIComponent(myHandle)}/replies`, auth)
      ]);

      const parents = [
        ...items(postsJson, ['posts']),
        ...items(repliesJson, ['replies'])
      ]
        .filter(post => postId(post) && replyCount(post) > 0)
        .sort(
          (a, b) =>
            new Date(postCreated(b) || 0) - new Date(postCreated(a) || 0)
        )
        .slice(0, 24);

      const counts = loadJSON(KEY.replyCounts, {});
      const seen = new Set(loadJSON(KEY.replySeen, []));
      const initialized = localStorage.getItem(KEY.replyInit) === '1';
      const force = Date.now() - lastFull > 10 * 60 * 1000;
      if (force) lastFull = Date.now();

      for (const parent of parents) {
        const pid = postId(parent);
        const count = replyCount(parent);
        if (!force && initialized && counts[pid] === count) continue;

        const replyJson = await authJSON(`/api/posts/${encodeURIComponent(pid)}/replies?limit=50`, auth);

        for (const reply of items(replyJson, ['replies'])) {
          const rid = postId(reply);
          if (!rid || seen.has(rid)) continue;

          const username = author(reply);
          if (!username || normUser(username) === normUser(myHandle)) {
            seen.add(rid);
            continue;
          }

          if (initialized) saveReplyNotice(reply, pid);
          seen.add(rid);
        }

        counts[pid] = count;
      }

      saveJSON(KEY.replyCounts, counts);
      saveJSON(KEY.replySeen, [...seen].slice(-3000));
      localStorage.setItem(KEY.replyInit, '1');

      renderReplyPanel();
      patchReplyBadge();
    } catch (error) {
      console.debug('[Classic Twitter EN reply watcher]', error);
    } finally {
      replyBusy = false;
    }
  }

  function closeReplyPanel() {
    document.getElementById('ct-reply-panel')?.remove();
  }

  function renderReplyPanel() {
    if (!location.pathname.startsWith('/notifications')) {
      closeReplyPanel();
      return;
    }

    const data = loadReplyNotices().filter(item => !item.read);
    if (!data.length) {
      closeReplyPanel();
      return;
    }

    const r = centerRect();
    if (!r) return;

    let panel = document.getElementById('ct-reply-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'ct-reply-panel';
      document.body.appendChild(panel);
    }

    panel.style.left = `${Math.round(r.left + 12)}px`;
    panel.style.top = `${Math.max(90, Math.round(r.top + 80))}px`;
    panel.style.width = `${Math.max(280, Math.round(r.width - 24))}px`;
    panel.innerHTML = '';

    panel.appendChild(
      panelHead('↩ New replies', 'Fallback for replies missing from tweet.app notifications', () => {
        data.forEach(item => markReplyRead(item.id));
        closeReplyPanel();
        patchReplyBadge();
      })
    );

    for (const item of data) {
      const row = localCard(item, true);
      row.onclick = () => {
        markReplyRead(item.id);
        if (item.id) location.href = `/post/${encodeURIComponent(item.id)}`;
        renderReplyPanel();
        patchReplyBadge();
      };
      panel.appendChild(row);
    }
  }

  function patchReplyBadge() {
    const count = loadReplyNotices().filter(item => !item.read).length;
    let badge = document.getElementById('ct-reply-badge');

    const link = [...document.querySelectorAll('a,button')].find(el =>
      /^Notifications$/i.test(clean(el.textContent))
    );

    if (!count || !link) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'ct-reply-badge';
      document.body.appendChild(badge);
    }

    const r = link.getBoundingClientRect();
    badge.textContent = String(count);
    badge.style.left = `${Math.round(r.right - 8)}px`;
    badge.style.top = `${Math.round(r.top + 2)}px`;
  }


  function ctPostHref(href) {
    try {
      const u = new URL(href, location.origin);
      return /\/(?:post|status|tweet)\/[^/?#]+/i.test(u.pathname) ? u.href : '';
    } catch {
      return '';
    }
  }

  function ctUserFromContainer(el) {
    let box = el;
    for (let depth = 0; box && depth < 5; depth++, box = box.parentElement) {
      const links = [...box.querySelectorAll?.('a[href]') || []];
      for (const link of links) {
        const user = userFromHref(link.getAttribute('href') || '');
        if (user) return user;
      }
      const m = clean(box.textContent).match(/@([A-Za-z0-9_.-]{1,80})/);
      if (m) return validUser(m[1]);
    }
    return null;
  }

  async function patchRetweetNavigation(root = document) {
    const scope = root instanceof Element ? root : document;
    const leaves = [];
    if (scope instanceof Element && !scope.children.length) leaves.push(scope);
    scope.querySelectorAll?.('span,div,p,small').forEach(el => {
      if (!el.children.length) leaves.push(el);
    });

    for (const el of leaves) {
      if (!el.isConnected || el.dataset.ctRetweeterLink === '1') continue;
      const t = clean(el.textContent);
      if (!t) continue;
      const isJP = /さんがリツイートしました$/u.test(t);
      const isEN = /\b(?:retweeted|reposted)$/i.test(t);
      if (!isJP && !isEN) continue;

      const username = ctUserFromContainer(el);
      if (!username) continue;

      el.dataset.ctRetweeterLink = '1';
      el.setAttribute('role', 'link');
      el.setAttribute('tabindex', '0');
      el.style.cursor = 'pointer';
      el.title = `@${username}`;

      const go = event => {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        location.href = `/user/${encodeURIComponent(username)}`;
      };

      el.addEventListener('click', go);
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') go(event);
      });
    }
  }

  async function patchQuotedTweets(root = document) {
    const scope = root instanceof Element ? root : document;
    const articles = new Set();

    if (scope instanceof Element) {
      if (scope.matches('article')) articles.add(scope);
      const parent = scope.closest('article');
      if (parent) articles.add(parent);
    }
    scope.querySelectorAll?.('article').forEach(a => articles.add(a));

    for (const article of articles) {
      if (!article.isConnected) continue;
      const mainId = String(articleId(article) || '');
      const postLinks = [...article.querySelectorAll('a[href]')]
        .map(a => ({ a, href: ctPostHref(a.getAttribute('href') || '') }))
        .filter(x => x.href);

      for (const item of postLinks) {
        let id = '';
        try {
          id = new URL(item.href).pathname.match(/\/(?:post|status|tweet)\/([^/?#]+)/i)?.[1] || '';
        } catch {}
        if (!id || (mainId && id === mainId)) continue;

        let card = item.a.closest('[role="link"],blockquote');
        if (!card || card === article) {
          card = item.a.parentElement;
          for (let depth = 0; card && card.parentElement !== article && depth < 4; depth++) {
            const parent = card.parentElement;
            if (!parent) break;
            const userLinks = parent.querySelectorAll('a[href*="/user/"]').length;
            const textLen = clean(parent.textContent).length;
            if (userLinks && textLen >= 8) card = parent;
            else break;
          }
        }
        if (!card || card === article) continue;

        if (card.dataset.ctQuoteCard !== '1') {
          card.dataset.ctQuoteCard = '1';
          card.style.cursor = 'pointer';
          card.addEventListener('click', event => {
            if (event.target.closest('button,input,textarea,select')) return;
            const link = event.target.closest('a[href]');
            if (link && link !== item.a) return;
            event.preventDefault();
            event.stopPropagation();
            location.href = item.href;
          });
        }

        const userLinks = [...card.querySelectorAll('a[href]')];
        for (const userLink of userLinks) {
          const username = userFromHref(userLink.getAttribute('href') || '');
          if (!username) continue;
          const user = await fetchProfile(username);
          if (!user || !card.isConnected) continue;
          const displayName = clean(user.displayName || user.name || username);
          if (!displayName) continue;

          const leaves = [...card.querySelectorAll('span,strong,div,p,a')].filter(el =>
            el.isConnected &&
            !el.children.length &&
            (clean(el.textContent) === `@${username}` || clean(el.textContent) === username)
          );
          for (const leaf of leaves) {
            leaf.textContent = displayName;
            leaf.classList.add('ct-quote-display-name');
          }
        }
      }
    }
  }

  function removeInlineFollowBadges(root = document) {
    const scope = root instanceof Element ? root : document;
    const controls = [];
    if (scope instanceof Element && scope.matches('button,[role="button"]')) controls.push(scope);
    scope.querySelectorAll?.('button,[role="button"]').forEach(el => controls.push(el));

    for (const el of controls) {
      if (!el.isConnected) continue;
      const text = clean(el.textContent);
      const aria = clean(el.getAttribute('aria-label') || '');
      const title = clean(el.getAttribute('title') || '');

      const profileFollowButton =
        !el.closest('article') &&
        /^(?:Follow|Unfollow|フォロー|フォロー解除)$/i.test(text) &&
        (/^\/user\//.test(location.pathname) || location.pathname === '/profile');

      if (profileFollowButton) {
        el.dataset.ctKeepProfileFollow = '1';
        el.style.removeProperty('display');
        continue;
      }

      const followLabel = /^(?:follow|フォロー)(?:\s|@|$)/i.test(`${aria} ${title}`.trim());
      const plusOnly = /^[+＋]$/.test(text);
      const iconOnly = !text || plusOnly;
      const r = el.getBoundingClientRect();
      const small = (!r.width || r.width <= 48) && (!r.height || r.height <= 48);
      const nearAvatar = !!el.parentElement?.querySelector('img');

      if ((followLabel && (iconOnly || small || nearAvatar)) || (plusOnly && small && nearAvatar)) {
        el.dataset.ctInlineFollow = '1';
        el.style.setProperty('display', 'none', 'important');
      }
    }
  }

  function scan(root = document) {
    try {
      installStyle();
      hideAffiliation();
      patchBrand();
      patchUI(root);
      patchInputs(root);
      patchNotifications(root);
      patchFavoriteButtons(root);
      patchFeed(root);
      patchRetweetRows(root);

      patchRetweetNavigation(root);
      patchQuotedTweets(root);
      removeInlineFollowBadges(root);
      patchProfileFounder();
      patchProfileMute();
      patchOpenMuteMenu();
      patchFavoriteProfileTab();

      if (favoritesActive) renderFavoritesPanel();
      renderReplyPanel();
      patchReplyBadge();
    } catch (error) {
      console.debug('[Classic Twitter EN]', error);
    }
  }

  let scanTimer = null;

  const observer = new MutationObserver(mutations => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const roots = new Set();

      for (const mutation of mutations) {
        if (mutation.target instanceof Element) roots.add(mutation.target);
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) roots.add(node);
        }
      }

      roots.forEach(scan);
      scan(document);
    }, 120);
  });

  function startObserver() {
    if (!document.documentElement) {
      setTimeout(startObserver, 0);
      return;
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-checked']
    });
  }

  startObserver();

  let layoutRaf = 0;

  function syncPanels() {
    cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      if (favoritesActive) renderFavoritesPanel();
      renderReplyPanel();
      patchReplyBadge();
    });
  }

  window.addEventListener('resize', syncPanels, { passive: true });
  window.addEventListener('scroll', syncPanels, { passive: true });

  function start() {
    scan(document);
    [300, 800, 1600].forEach(delay => setTimeout(() => scan(document), delay));
    setInterval(() => scan(document), 3000);
    setTimeout(replyWatchTick, 1800);
    setInterval(replyWatchTick, 45000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  console.log('🐦 Classic Twitter EN v6.2.3 loaded');
})();
