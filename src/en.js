// ==UserScript==
// @name         Classic Twitter for tweet.app - English
// @namespace    https://tweet.app/
// @version      6.18.1
// @description  Classic Twitter styling and star Favorites, photo slides, notification filters and local tools. Keeps post text, names and drafts intact.
// @match        https://app.tweet.app/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.tweet.app
// @connect      news.yahoo.co.jp
/* @safari-grants */
// @noframes
// @run-at       document-start
// @license      MIT
// @homepageURL  https://github.com/Asukamaiyan/classic-twitter-for-tweet-app
// @supportURL   https://github.com/Asukamaiyan/classic-twitter-for-tweet-app/issues
// ==/UserScript==

(() => {
  'use strict';
  if (document.documentElement?.dataset.ctActiveVersion) return;
  const CT_LOCALE = 'en';
  /* @include network */
  /* @include enhancements */
  /* @include translation */
  /* @include classic */
  /* @include motion */
  /* @include runtime */
  /* @include presentation */
  /* @include timestamps */
  /* @include profile */
  /* @include favorite-capture */
  /* @include reply-times */
  /* @include favorite-history */
  /* @include navigation */
  /* @include notification-filters */
  /* @include badges */
  /* @include media */
  /* @include news */
  /* @include safari */

  const API_ORIGIN = 'https://api.tweet.app';
  const PROFILE_API = `${API_ORIGIN}/api/users/by-username/`;
  const LOGO = 'https://app.tweet.app/assets/brand/bird-blue.svg';

  const KEY = {
    favorites: 'classicTwitterEN.favorites',
    autoTranslate: 'classicTwitterEN.autoTranslate'
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
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const EN = new Map([
    ['Feed', 'Home'],
    ['Nothing to see here yet. Likes, reposts, replies, quotes, mentions, and follows will show up here.', 'Nothing to see here yet. Favorites, Retweets, replies, quotes, mentions, and follows will show up here.'],
    ['quoted your post', 'quoted your Tweet'],
    ['quoted your tweet', 'quoted your Tweet'],
    ['Posts', 'Tweets'],
    ['No posts yet.', 'No Tweets yet.'],
    ['No reposts yet.', 'No Retweets yet.'],
    ['No posts yet. Share your first thought with the community.', 'No Tweets yet. Share your first thought with the community.'],
    ['Nothing to see here yet. Likes, reposts, and follows will show up here.', 'Nothing to see here yet. Favorites, Retweets, and follows will show up here.'],
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

  // Keep the same React nodes and remember only values written by this script.
  // A later native render takes ownership again when it changes the value.
  function ctLocalizationClassicEnabled() {
    return typeof ctFavoritePresentationEnabled === 'function' ? ctFavoritePresentationEnabled() :
      typeof classicAppearanceEnabled === 'function' ? classicAppearanceEnabled() : true;
  }

  function ctLocalizationState() {
    return ctLocalizationState.value ||= { byNode: new WeakMap(), records: new Set() };
  }

  function ctLocalizationNativeRecordException(record) {
    const el = record.attribute ? record.node : record.node.parentElement;
    if (nativeLocalizationAccountMenu(el) || isNativeSettingsNavigation(el)) return true;
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications', '/profile': 'Feed' }[location.pathname.replace(/\/$/, '')];
    if (record.attribute || !routeTitle || clean(record.original) !== routeTitle ||
        !el?.matches('h2.truncate') || el.closest('article')) return false;
    const visibleHeading = [...document.querySelectorAll('main h2')].find(heading => {
      for (let parent = heading; parent; parent = parent.parentElement) {
        if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.style.display === 'none') return false;
      }
      return !heading.closest('article');
    });
    return el === visibleHeading;
  }

  function ctLocalizationRecordAllowed(record) {
    const el = record.attribute ? record.node : record.node.parentElement;
    return !!el && !el.closest('[id^="ct-"],[data-ct-owned],[data-ct-local-ui],[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],[contenteditable]:not([contenteditable="false"]),.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]') &&
      (!el.closest('.truncate') || ctLocalizationNativeRecordException(record)) &&
      !(record.attribute === null && el.closest('textarea,input,select,option'));
  }

  function ctLocalizationRead(record) {
    return record.attribute ? record.node.getAttribute(record.attribute) : record.node.nodeValue;
  }

  function ctLocalizationWrite(record, value) {
    if (ctLocalizationRead(record) !== value) {
      if (record.attribute) record.node.setAttribute(record.attribute, value);
      else record.node.nodeValue = value;
    }
    record.written = value;
  }

  function ctLocalizationForget(record) {
    const state = ctLocalizationState();
    state.records.delete(record);
    state.byNode.get(record.node)?.delete(record.attribute);
  }

  function ctRememberLocalization(node, attribute, classic, regular) {
    const state = ctLocalizationState();
    const current = attribute ? node.getAttribute(attribute) : node.nodeValue;
    let entries = state.byNode.get(node);
    let record = entries?.get(attribute);
    if (record && current !== record.written) {
      ctLocalizationForget(record);
      record = null;
    }
    regular ??= record?.original ?? current;
    if (classic === regular) {
      if (record) ctLocalizationForget(record);
      if (current !== classic) {
        if (attribute) node.setAttribute(attribute, classic);
        else node.nodeValue = classic;
      }
      return;
    }
    if (!record) {
      record = { node, attribute, original: current, classic, regular, written: current };
      if (!entries) state.byNode.set(node, entries = new Map());
      entries.set(attribute, record);
      state.records.add(record);
    } else {
      record.classic = classic;
      record.regular = regular;
    }
    ctLocalizationWrite(record, ctLocalizationClassicEnabled() ? record.classic : record.regular);
  }

  function ctSyncLocalizationAppearance(root = document) {
    const enabled = ctLocalizationClassicEnabled();
    for (const record of ctLocalizationState().records) {
      if (!record.node.isConnected || !ctLocalizationRecordAllowed(record) ||
          ctLocalizationRead(record) !== record.written) {
        ctLocalizationForget(record);
        continue;
      }
      if (root !== document && root !== record.node && !root.contains?.(record.node)) continue;
      ctLocalizationWrite(record, enabled ? record.classic : record.regular);
    }
    if (!enabled) {
      if (root instanceof Element && root.classList.contains('ct-notification-fav-icon')) root.classList.remove('ct-notification-fav-icon');
      root.querySelectorAll?.('.ct-notification-fav-icon').forEach(el => el.classList.remove('ct-notification-fav-icon'));
    }
  }

  function installStyle() {
    if (document.getElementById('ct-en-style')) return;

    const style = document.createElement('style');
    style.id = 'ct-en-style';
    style.textContent = `
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-favorite-button > svg { display:none!important; }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"] > .ct-star {
        display:inline-flex; width:20px; height:20px; align-items:center; justify-content:center;
        transform-origin:center; pointer-events:none;
      }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"] > .ct-star svg {
        display:block!important; width:20px; height:20px; fill:none; stroke:currentColor;
        stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;
      }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-is-liked { color:#ffac33!important; }
      html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-is-liked > .ct-star svg { fill:currentColor; }
      @media (hover:hover) {
        html[data-ct-favorite-classic="on"] [data-testid="tweet-like-action"].ct-favorite-button:hover {
          color:#ffac33!important; background:rgba(255,172,51,.12)!important;
        }
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

      .ct-profile-founder {
        font-size:13px;
        opacity:.78;
      }

.ct-twitter-logo {
        width:28px!important;
        height:28px!important;
        object-fit:contain!important;
        display:block!important;
      }
      .ct-detail-post-time {
        font-size:13px;
        opacity:.68;
        font-weight:400;
        padding:10px 0 8px;
        margin:0 0 2px;
        border-bottom:1px solid rgba(127,127,127,.20);
        white-space:nowrap;
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
      #ct-favorites-panel {
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

  // Only localize application chrome. Text matching alone cannot distinguish a
  // label from a person's name, a post, a notification preview, or a translation.
  function localizationScopeNodes(root = document) {
    const host = root instanceof Node ? root : document;
    if (host.nodeType === Node.TEXT_NODE) return [host];
    const nodes = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function isOwnedLocalizationElement(el) {
    if (el?.closest('[id^="ct-"],[data-ct-owned],[data-ct-local-ui]')) return true;
    // Classic markers decorate native UI; they do not transfer its text ownership.
    // Keep every other extension-owned class protected, including local panels.
    for (let node = el; node; node = node.parentElement) {
      if ([...node.classList].some(name => name.startsWith('ct-') && !name.startsWith('ct-classic-'))) return true;
    }
    return false;
  }

  function isNativeSettingsNavigation(el) {
    if (!/^\/settings\/?$/.test(location.pathname) || !el?.matches('span.truncate')) return false;
    const button = el.closest('nav button');
    return !!button?.closest('main') && !!button.querySelector('svg') &&
      !button.querySelector('img,a,[data-user-content]') &&
      !/@[A-Za-z0-9_.-]/.test(clean(button.textContent)) &&
      !button.getAttribute('aria-label')?.startsWith('View @');
  }

  function isNativeLocalizationTimestamp(el) {
    if (!el?.matches('span[title]') || !el.closest('article') ||
        el.closest('button,a,[role="button"]') ||
        !el.classList.contains('text-tl-app-text-muted') || !el.classList.contains('hover:underline')) return false;
    return !!ctTimestampParse(el.getAttribute('title'));
  }

  // Tweet v2.1.0 keeps user-written poll choices in tl-user-text. Recognize
  // only the surrounding native poll chrome; never treat a whole fieldset as UI.
  function nativeLocalizationPoll(el) {
    if (!el || isOwnedLocalizationElement(el)) return null;
    const compose = el.closest('fieldset.relative.w-full.mt-3.rounded-2xl.border');
    if (compose && /^(?:Poll|投票)$/.test(clean(compose.querySelector(':scope > legend')?.textContent)) &&
        compose.querySelector('input[type="text"][maxlength="25"][id*="-choice-"]') &&
        [...compose.querySelectorAll('select option')].map(option => option.value).join(',') === '1,24,72,168') {
      return { root: compose, compose: true };
    }
    if (!el.closest('article')) return null;
    for (let candidate = el; candidate && candidate.tagName !== 'ARTICLE'; candidate = candidate.parentElement) {
      if (!candidate.matches('div.mt-3')) continue;
      const choices = candidate.querySelector(':scope > fieldset.flex.flex-col');
      const results = candidate.querySelector(':scope > div > ul[aria-label="Poll results"],:scope > div > ul[aria-label="投票結果"]');
      const labels = choices && [...choices.querySelectorAll(':scope > label')];
      if (choices && /^(?:Poll choices|投票の選択肢)$/.test(clean(choices.querySelector(':scope > legend')?.textContent)) &&
          labels.length >= 2 && labels.length <= 5 && labels.every(label =>
            label.querySelector(':scope > input[type="radio"]') && label.querySelector(':scope > span.tl-user-text'))) {
        return { root: candidate, compose: false };
      }
      if (results && results.children.length >= 2 && results.children.length <= 5 &&
          [...results.children].every(row => row.matches('li.relative.overflow-hidden') && row.querySelector('span.tl-user-text'))) {
        return { root: candidate, compose: false };
      }
    }
    return null;
  }

  function isNativeLocalizationPollUI(el) {
    const poll = nativeLocalizationPoll(el);
    if (!poll) return false;
    if (poll.compose) return el.matches('legend,label,button,button span,p[role="status"]');
    return el.matches('legend.sr-only,span.sr-only,p[role="status"],p[role="alert"]') ||
      (el.matches('button') && el.parentElement?.matches('div.mt-2.flex.items-center.justify-between')) ||
      (el.matches('span.text-tl-app-text-muted,p.text-tl-app-text-muted') &&
        (el.parentElement?.matches('div.mt-2.flex.items-center.justify-between') ||
          el.parentElement?.matches('div.flex.flex-col.outline-none')));
  }

  function nativeLocalizationAccountMenu(el) {
    if (!el?.matches('span.min-w-0.truncate') || !el.parentElement?.matches('button[role="menuitem"]') ||
        !el.parentElement.querySelector(':scope > svg') || !el.parentElement.parentElement?.matches('[role="menu"]')) return null;
    const host = el.parentElement.parentElement.parentElement;
    const trigger = host?.querySelector(':scope > button[aria-haspopup="menu"]');
    return trigger && /^(?:Profile options|プロフィールのメニュー)$/.test(trigger.getAttribute('aria-label') || '') ? el : null;
  }

  function nativeLocalizationAccountDialog(el) {
    const dialog = el?.closest('[role="dialog"][aria-modal="true"].bg-tl-app-card.border');
    if (!dialog || !/^(?:Report @[A-Za-z0-9_.-]+|@[A-Za-z0-9_.-]+を報告)$/.test(dialog.getAttribute('aria-label') || '') ||
        !dialog.querySelector('h3.text-sm.font-bold.text-tl-app-text')) return null;
    return dialog;
  }

  function isProtectedLocalizationElement(el) {
    if (!el?.isConnected || isOwnedLocalizationElement(el)) return true;
    if (el.closest(
      'textarea,input,select,option,script,style,code,pre,kbd,samp,svg,' +
      '[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,' +
      '[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"],' +
      '.tl-user-text,.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"]'
    )) return true;
    // Native settings navigation also truncates its static labels. Keep the
    // protection for profile names and account values everywhere else.
    const routeTitle = { '/explore': 'Explore', '/settings': 'Settings', '/notifications': 'Notifications' }[location.pathname.replace(/\/$/, '')];
    const pageTitle = routeTitle && el.matches('h2.truncate') && clean(el.textContent) === routeTitle &&
      el === document.querySelector('main h2') && !el.closest('article');
    return !!el.closest('.truncate') && !nativeLocalizationAccountMenu(el) && !isNativeSettingsNavigation(el) && !pageTitle;
  }

  function localizationNotificationRow(el) {
    if (!location.pathname.startsWith('/notifications')) return null;
    const row = el?.closest('button,[role="button"]');
    if (!row?.closest('main') || isOwnedLocalizationElement(row)) return null;
    // Current tweet.app notification rows are border-separated buttons. Do not
    // interpret tab buttons or arbitrary paragraphs as notification content.
    if (row.matches('.items-start.border-b,[data-testid="notification-row"]')) return row;
    // v2.1.0 moved the separator to a wrapper so the native Follow list can
    // expand below its action. Match its 28px leading icon and direct body.
    const icon = row.firstElementChild;
    const body = icon?.nextElementSibling;
    return row.matches('button.w-full.flex.items-start.text-left') &&
      row.parentElement?.matches('div.border-b.border-tl-app-border') &&
      row.parentElement.firstElementChild === row && icon?.matches('div.mt-0\\.5.shrink-0') &&
      icon.querySelector(':scope > svg[width="28"][height="28"]') &&
      body?.matches('div.flex-1.min-w-0') && body.querySelector(':scope > p') ? row : null;
  }

  function localizationNotificationAction(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return null;
    const row = localizationNotificationRow(el);
    const paragraph = el?.closest('p');
    if (!row || !paragraph || !row.contains(paragraph)) return null;
    if (el.closest('.font-extrabold,.font-bold,a')) return null;
    if (!(el === paragraph || el.parentElement === paragraph)) return null;
    const text = clean(node.nodeValue);
    if (!/^(?:(?:liked|favorited|reposted|retweeted|quoted) your (?:post|tweet|reply)|followed you|mentioned you(?: in a (?:post|tweet))?|replied to (?:your (?:post|tweet)|you)|flagged your post for review|awarded you a badge|interacted with you|(?:さん)?が?あなた(?:の(?:ツイート|返信)(?:を(?:お気に入りに登録|リツイート|引用)|に返信)|を(?:フォロー|@ツイート)|宛てにツイート|に(?:返信|バッジを贈り))しました)$/i.test(text)) return null;
    return { row, paragraph, element: el };
  }

  function isLocalizationUI(node) {
    const el = node?.parentElement;
    if (isProtectedLocalizationElement(el)) return false;
    if (localizationNotificationAction(node)) return true;
    if (localizationNotificationRow(el)) return false;
    if (isNativeLocalizationPollUI(el)) return true;
    if (nativeLocalizationAccountMenu(el)) return node === el.firstChild &&
      /^(?:Report|Mute unavailable|(?:Mute|Unmute) @[A-Za-z0-9_.-]+)$/.test(clean(node.nodeValue));
    if (nativeLocalizationAccountDialog(el) && !el.closest('textarea,input')) return true;
    const text = clean(node.nodeValue);
    const link = el.closest('a[href]');
    if (link) {
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch { return false; }
      if (url.origin !== location.origin || !/^\/(?:feed|explore|notifications|settings|profile|compose|bookmarks)\/?$/.test(url.pathname)) return false;
      return !link.querySelector('img') && !!el.closest('nav,[role="navigation"],header,aside');
    }
    // A reply target is UI, but its handle must remain byte-for-byte unchanged.
    if (/^Replying to$/i.test(text) && el.matches('p,button') &&
        [...el.children].some(child => /^@[A-Za-z0-9_.-]+$/.test(clean(child.textContent)))) return true;
    const control = el.closest('button,[role="button"],[role="tab"],[role="menuitem"],summary');
    if (control) {
      if (control.querySelector('img') || /@[A-Za-z0-9_.-]/.test(clean(control.textContent))) return false;
      // User cards are buttons too. Paragraphs and styled names inside those
      // buttons are data, not labels. Real notification actions are handled above.
      const paragraph = el.closest('p');
      if ((paragraph && control.contains(paragraph)) || control.querySelector('p')) return false;
      if (el.closest('article') && !/^(?:Like|Likes|Liked|Unlike|Favorite|Favorites|Favorited|Unfavorite|Reply|Replies|Repost|Reposts|Retweet|Retweets|Quote|Quote Tweet|Quote Retweet|Undo repost|Undo retweet|Translate|Translated|Show translation|Show original|Show more|Show less|Share|Copy link|Edit post|Delete|Report|Mute user|Unmute|Follow|Unfollow)$/i.test(text)) return false;
      return true;
    }
    if (isNativeLocalizationTimestamp(el)) return true;
    if (el.closest('article')) return false;
    if (el.closest('label,legend,[role="status"],[role="alert"]')) return true;
    const inSettings = /^\/settings\/?$/.test(location.pathname);
    const heading = el.closest('h1,h2,h3') || (inSettings && el.closest('main section h4.font-extrabold'));
    if (heading) {
      // Profile headings contain display names; all other static headings are
      // still restricted to exact dictionary entries by translateTextNode.
      if (/^\/(?:user\/|profile(?:\/|$))/.test(location.pathname) && heading.tagName !== 'H1') return false;
      return !heading.querySelector('img');
    }
    // Settings descriptions are static text, but account values in dd/input and
    // profile data are deliberately excluded. Never allow an entire route.
    if (inSettings && el.matches('main section span.uppercase.tracking-wide')) return true;
    if (inSettings && el.matches('p,dt')) {
      if (el.closest('dl') && el.tagName !== 'DT') return false;
      if (el.classList.contains('leading-relaxed')) {
        const title = el.previousElementSibling;
        return !!el.closest('main section') && title?.matches('h4.font-extrabold') &&
          (EN.has(clean(title.textContent)) || [...EN.values()].includes(clean(title.textContent)));
      }
      return !el.closest('a');
    }
    // The mobile account menu's counts are spans, unlike profile buttons.
    if (el.matches('span') && el.closest('[role="dialog"][aria-label="Account menu"]') &&
        /^(?:Following|Followers)$/.test(text) &&
        [...el.children].some(child => child.matches('strong') && /^[\d,]+$/.test(clean(child.textContent)))) return true;
    // Native empty states put text-center on the parent, not the paragraph.
    return el.matches('p.text-center,div.text-center,[aria-busy="true"]') ||
      (el.matches('p.text-tl-app-text-muted') && el.parentElement?.matches('div.text-center'));
  }

  function replaceLocalizationText(node, text) {
    const raw = node.nodeValue || '';
    if (clean(raw) === text) return;
    ctRememberLocalization(node, null, raw.replace(/\S[\s\S]*\S|\S/, () => text));
  }

  function patchUIAttributes(root = document) {
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const controls = [];
    if (host instanceof Element && host.matches('button,[role="tab"],[role="menuitem"],input,textarea')) controls.push(host);
    host?.querySelectorAll?.('button,[role="tab"],[role="menuitem"],input,textarea').forEach(el => controls.push(el));
    for (const el of controls) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]') ||
          el.closest('.tl-user-text,.whitespace-pre-wrap,.break-words,.wrap-break-word,[class*="line-clamp-"],.truncate') || el.querySelector('img')) continue;
      if (!el.hasAttribute('aria-label') && el.matches('button.absolute.top-4.right-4') &&
          el.querySelector(':scope > svg.lucide-x') &&
          el.parentElement?.matches('div.bg-tl-app-card.border.rounded-3xl.max-w-lg') &&
          el.parentElement.querySelector('textarea#public-modal-tweet-input')) el.setAttribute('aria-label', 'Close');
      for (const attr of ['aria-label', 'title']) {
        const value = el.getAttribute(attr);
        const out = EN.get(value);
        if (out && value !== out) ctRememberLocalization(el, attr, out);
      }
    }
  }

  function translateTextNode(node) {
    if (!isLocalizationUI(node)) return;
    const text = clean(node.nodeValue);
    if (!text || text.length > 500) return;
    // Dynamic replacements belong to their specific UI contexts. In particular,
    // never parse actor names or dates from arbitrary text that resembles a UI.
    const out = EN.get(text);
    if (out && out !== text) replaceLocalizationText(node, out);
  }

  function patchUI(root = document) {
    ctSyncLocalizationAppearance(root);
    localizationScopeNodes(root).forEach(translateTextNode);
    patchUIAttributes(root);
  }

  function patchInputs(root = document) {
    ctSyncLocalizationAppearance(root);
    const host = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const list = [];
    if (host instanceof Element && host.matches('input[placeholder],textarea[placeholder]')) list.push(host);
    host?.querySelectorAll?.('input[placeholder],textarea[placeholder]').forEach(el => list.push(el));
    const placeholders = new Map([
      ['Post your reply', 'Tweet your reply'], ['Create a post', 'Compose a Tweet']
    ]);
    for (const el of list) {
      if (isOwnedLocalizationElement(el) ||
          el.closest('[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,.tl-user-text,[data-user-content],[data-testid="tweet-text"],[data-testid="profile-bio"]')) continue;
      const value = el.getAttribute('placeholder');
      const out = placeholders.get(value);
      if (out && out !== value) ctRememberLocalization(el, 'placeholder', out);
    }
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

  function patchRetweetRows(root = document) {
    ctSyncLocalizationAppearance(root);
    for (const node of localizationScopeNodes(root)) {
      const el = node.parentElement;
      if (isProtectedLocalizationElement(el) || !el.matches('span')) continue;
      const row = el.parentElement;
      // In the current client this metadata row is a direct article child,
      // marked by the repeat icon. Never infer a reposter from post text.
      if (!row?.parentElement?.matches('article') || !row.querySelector('svg.lucide-repeat')) continue;
      const text = clean(node.nodeValue);
      if (text === 'You reposted') replaceLocalizationText(node, 'You Retweeted');
      else {
        const match = text.match(/^(@?[A-Za-z0-9_.-]{1,80})\s+reposted$/i);
        if (match) replaceLocalizationText(node, `${match[1]} Retweeted`);
      }
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


  function loadFavorites() { return ctProfileLoadFavorites(); }

  function saveFavorite(item, uid) { return ctProfileSaveFavorite(item, uid); }

  function removeFavorite(id, uid) { return ctProfileRemoveFavorite(id, uid); }

  let favoritesActive = false;









  function localCard(item) {
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





  function notificationLeaves(root = document) {
    return [...new Set(localizationScopeNodes(root)
      .filter(node => localizationNotificationAction(node)).map(node => node.parentElement))];
  }

  function patchNotifications(root = document) {
    ctSyncLocalizationAppearance(root);
    if (!location.pathname.startsWith('/notifications')) return;
    for (const node of localizationScopeNodes(root)) {
      const context = localizationNotificationAction(node);
      if (!context) continue;
      translateTextNode(node);
      if (ctLocalizationClassicEnabled() && /favorited/i.test(clean(node.nodeValue))) {
        context.row.querySelector('svg')?.parentElement?.classList.add('ct-notification-fav-icon');
      }
    }
  }


  function ctTranslationButtonText(el) {
    return clean(el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  }

  function ctTranslationControls(root = document) {
    const scope = root instanceof Element ? root : document;
    const out = [];
    const selector = 'button,[role="button"],a';
    if (scope instanceof Element && scope.matches(selector)) out.push(scope);
    scope.querySelectorAll?.(selector).forEach(el => out.push(el));
    return out.filter(el => /^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(el)));
  }

  function ctDeclaredLanguage(container) {
    if (!container) return '';
    const nodes = [container, ...(container.querySelectorAll?.('[lang],[data-lang],[data-language]') || [])];
    for (const el of nodes) {
      const raw = clean(el.getAttribute?.('lang') || el.getAttribute?.('data-lang') || el.getAttribute?.('data-language') || '').toLowerCase();
      const lang = raw.split(/[-_]/)[0];
      if (/^[a-z]{2,3}$/.test(lang)) return lang;
    }
    return '';
  }

  function ctPostTextForTranslation(control) {
    const article = control?.closest?.('article');
    if (!article) return '';
    let box = control.parentElement;
    for (let depth = 0; box && box !== article && depth < 6; depth++, box = box.parentElement) {
      const candidates = [...box.querySelectorAll('p,[dir="auto"],[data-testid*="text" i]')]
        .filter(el => !el.closest('button,[role="button"]'))
        .map(el => clean(el.textContent))
        .filter(t => t && !/^(?:Show translation|Translate|翻訳を表示|Show original|原文を表示)$/i.test(t));
      const text = candidates.sort((a,b) => b.length - a.length)[0] || '';
      if (text.length >= 2) return text;
    }
    if (typeof articleText === 'function') return clean(articleText(article));
    return clean(article.textContent);
  }

  function ctLikelyLanguage(text, container) {
    const declared = ctDeclaredLanguage(container);
    if (declared) return declared;
    const s = clean(text).replace(/https?:\/\/\S+/gi,' ').replace(/@[A-Za-z0-9_.-]+/g,' ').replace(/#[^\s]+/g,' ');
    if (!s) return 'unknown';
    if (/[\u3040-\u30ff]/u.test(s)) return 'ja';
    if (/[\uac00-\ud7af]/u.test(s)) return 'ko';
    if (/[\u4e00-\u9fff]/u.test(s)) return 'zh';
    if (/[\u0400-\u04ff]/u.test(s)) return 'ru';
    if (/[\u0600-\u06ff]/u.test(s)) return 'ar';
    if (/[\u0590-\u05ff]/u.test(s)) return 'he';
    if (/[\u0900-\u097f]/u.test(s)) return 'hi';
    if (/[\u0e00-\u0e7f]/u.test(s)) return 'th';
    const lowered = ` ${s.toLowerCase()} `;
    const words = s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
    if (!words.length) return 'unknown';
    const other = ['bonjour','merci','salut','avec','pour','dans','une','des','est','mais','vous','nous','hola','gracias','para','con','una','que','los','las','por','pero','como','muy','ciao','grazie','per','che','gli','della','sono','molto','hallo','danke','und','der','die','das','ist','nicht','mit','für','ein','eine','olá','obrigado','obrigada','não','muito'];
    if (other.some(w => lowered.includes(` ${w} `)) || /[À-ÖØ-öø-ÿ]/u.test(s)) return 'other';
    const english = new Set(['a','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from','had','has','have','he','her','here','his','how','i','if','in','is','it','just','me','more','my','no','not','of','on','one','or','our','out','she','so','some','than','that','the','their','them','there','they','this','to','too','up','us','was','we','were','what','when','where','which','who','why','will','with','would','you','your']);
    const hits = words.reduce((n,w) => n + (english.has(w) ? 1 : 0), 0);
    if (hits >= 2 || (words.length <= 4 && hits >= 1)) return 'en';
    if (words.length <= 3 && /^[\x00-\x7F\s.,!?'"()\-:;]+$/u.test(s)) return 'en';
    if (words.length >= 5 && hits / words.length >= 0.12) return 'en';
    return 'other';
  }


  function patchExactPostTime(root = document) {
    ctTimestampPatchExactPostTime(root);
  }


  function scan(root = document) {
    try {
      installStyle();
      if (typeof installSafariStyle === 'function') installSafariStyle();
      if (typeof patchMediaInfo === 'function') patchMediaInfo(root);
      const classicEnabled = classicAppearanceEnabled();
      patchClassicAppearance(root, classicEnabled);
      patchClassicMotion(root, classicEnabled);
      patchUI(root);
      patchInputs(root);
      patchNotifications(root);
      patchFavoriteButtons(root);
      patchFeed(root);
      patchRetweetRows(root);
      patchAutoTranslation(root, 'en');
      ctReplyTimesEnhance(root);
      patchExactPostTime(root);
      patchProfileFounder();
      patchFavoriteProfileTab();

    patchNavigation(root);
    ctPatchNotificationFilters();
    patchOfficialBadges(root);
    ctMediaEnhance(root);
    patchJapaneseNews(root);
    } catch (error) {
      console.debug('[Classic Twitter EN]', error);
    }
  }

  ctPrepareFavoritePresentation();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  console.log('🐦 Classic Twitter EN v6.18.1 loaded');
})();
