from pathlib import Path
import re

targets=[(Path('classic-twitter-ja.user.js'),'6.3.3','ja'),(Path('classic-twitter-ja-safari.user.js'),'6.3.6','ja'),(Path('classic-twitter-en.user.js'),'6.2.9-en','en')]
founder_css='\n      .ct-founder,\n      .ct-profile-founder {\n        display:inline-flex;\n        align-items:center;\n        margin-left:4px;\n        font-size:12px;\n        line-height:18px;\n        font-weight:700;\n        white-space:nowrap;\n        opacity:.72;\n      }\n\n      .ct-profile-founder {\n        font-size:13px;\n        opacity:.78;\n      }\n\n'
patch_article="""  async function patchArticle(article) {
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
    } else {
      badge?.remove();
    }
  }

"""
profile_founder="""  async function patchProfileFounder() {
    const username = routeUser() || ownProfileUser();
    if (!username) return;
    const user = await fetchProfile(username);
    if (!user) return;
    const number = user.foundingMemberNumber;
    if (number === null || number === undefined || number === '') return;
    const displayName = clean(user.displayName || user.name || username);
    const main = document.querySelector('main') || document;
    const nameEl = [...main.querySelectorAll('h1,h2,h3,span,a,div,strong')].find(el => {
      if (!el.isConnected || el.children.length || el.closest('article') || el.classList.contains('ct-profile-founder')) return false;
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

"""
translation_helper="""  function ctTranslationButtonText(el) {
    return clean(el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '');
  }

  function ctTranslationControls(root = document) {
    const scope = root instanceof Element ? root : document;
    const out = [];
    const selector = 'button,[role=\"button\"],a';
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
      const candidates = [...box.querySelectorAll('p,[dir=\"auto\"],[data-testid*=\"text\" i]')]
        .filter(el => !el.closest('button,[role=\"button\"]'))
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
    const s = clean(text).replace(/https?:\\/\\/\\S+/gi,' ').replace(/@[A-Za-z0-9_.-]+/g,' ').replace(/#[^\\s]+/g,' ');
    if (!s) return 'unknown';
    if (/[\\u3040-\\u30ff]/u.test(s)) return 'ja';
    if (/[\\uac00-\\ud7af]/u.test(s)) return 'ko';
    if (/[\\u4e00-\\u9fff]/u.test(s)) return 'zh';
    if (/[\\u0400-\\u04ff]/u.test(s)) return 'ru';
    if (/[\\u0600-\\u06ff]/u.test(s)) return 'ar';
    if (/[\\u0590-\\u05ff]/u.test(s)) return 'he';
    if (/[\\u0900-\\u097f]/u.test(s)) return 'hi';
    if (/[\\u0e00-\\u0e7f]/u.test(s)) return 'th';
    const lowered = ` ${s.toLowerCase()} `;
    const words = s.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
    if (!words.length) return 'unknown';
    const other = ['bonjour','merci','salut','avec','pour','dans','une','des','est','mais','vous','nous','hola','gracias','para','con','una','que','los','las','por','pero','como','muy','ciao','grazie','per','che','gli','della','sono','molto','hallo','danke','und','der','die','das','ist','nicht','mit','für','ein','eine','olá','obrigado','obrigada','não','muito'];
    if (other.some(w => lowered.includes(` ${w} `)) || /[À-ÖØ-öø-ÿ]/u.test(s)) return 'other';
    const english = new Set(['a','an','and','are','as','at','be','been','but','by','can','could','did','do','does','for','from','had','has','have','he','her','here','his','how','i','if','in','is','it','just','me','more','my','no','not','of','on','one','or','our','out','she','so','some','than','that','the','their','them','there','they','this','to','too','up','us','was','we','were','what','when','where','which','who','why','will','with','would','you','your']);
    const hits = words.reduce((n,w) => n + (english.has(w) ? 1 : 0), 0);
    if (hits >= 2 || (words.length <= 4 && hits >= 1)) return 'en';
    if (words.length <= 3 && /^[\\x00-\\x7F\\s.,!?\'\"()\\-:;]+$/u.test(s)) return 'en';
    if (words.length >= 5 && hits / words.length >= 0.12) return 'en';
    return 'other';
  }

  function patchAutoTranslation(root = document, nativeLanguage = 'ja') {
    for (const control of ctTranslationControls(root)) {
      if (!control.isConnected) continue;
      const article = control.closest('article');
      if (!article) continue;
      const text = ctPostTextForTranslation(control);
      const lang = ctLikelyLanguage(text, article);
      const isNative = nativeLanguage === 'ja' ? lang === 'ja' : lang === 'en';
      if (isNative || lang === 'unknown') {
        control.style.setProperty('display','none','important');
        continue;
      }
      control.style.removeProperty('display');
      if (control.dataset.ctAutoTranslated === '1') continue;
      control.dataset.ctAutoTranslated = '1';
      setTimeout(() => {
        if (!control.isConnected) return;
        if (!/^(?:Show translation|Translate|翻訳を表示)$/i.test(ctTranslationButtonText(control))) return;
        control.click();
      }, 40);
    }
  }

"""

for path,version,lang in targets:
    s=path.read_text(encoding='utf-8')
    s=re.sub(r'(?m)^// @version\\s+\\S+', f'// @version      {version}', s, count=1)
    if lang=='ja':
        s=s.replace('tweet.appを旧Twitter風に日本語化。表示名、★お気に入り','tweet.appを旧Twitter風に日本語化。表示名、Founder Number、★お気に入り',1)
        if "['Show translation', '翻訳を表示']" not in s:
            m="    ['Replying to', '返信先:'],\n"
            if m not in s: raise RuntimeError(f'JP map marker missing: {path}')
            s=s.replace(m,m+"    ['Show translation', '翻訳を表示'],\n    ['Show original', '原文を表示'],\n",1)
    else:
        s=s.replace('with display names, star Favorites','with display names, Founder Number, star Favorites',1)
    if '.ct-founder,' not in s:
        m='      .ct-twitter-logo {'
        if m not in s: raise RuntimeError(f'CSS marker missing: {path}')
        s=s.replace(m,founder_css+m,1)
    pat=re.compile(r'  async function patchArticle\\([\\s\\S]*?(?=  function collectArticles\\()')
    if not pat.search(s): raise RuntimeError(f'patchArticle missing: {path}')
    s=pat.sub(patch_article,s,count=1)
    if 'function patchProfileFounder()' not in s:
        m='  function cleanupOldNamedMute() {'
        if m not in s: raise RuntimeError(f'cleanup marker missing: {path}')
        s=s.replace(m,profile_founder+m,1)
    if 'function patchAutoTranslation(' not in s:
        m='  function scan('
        if m not in s: raise RuntimeError(f'scan marker missing: {path}')
        s=s.replace(m,translation_helper+m,1)
    if 'patchProfileFounder();' not in s:
        m='      patchProfileMute();'
        if m not in s: raise RuntimeError(f'profile call marker missing: {path}')
        s=s.replace(m,'      patchProfileFounder();\n\n'+m,1)
    call=f"      patchAutoTranslation(root, '{lang}');"
    if call not in s:
        m='      patchNotificationAvatarLinks(root);' if 'patchNotificationAvatarLinks(root);' in s else '      removeInlineFollowBadges(root);'
        if m not in s: raise RuntimeError(f'translation call marker missing: {path}')
        s=s.replace(m,m+'\n'+call,1)
    if lang=='ja':
        s=re.sub(r"🐦 Classic Twitter JP v[^']+ loaded",f"🐦 Classic Twitter JP v{version} loaded",s)
    else:
        s=re.sub(r"🐦 Classic Twitter EN v[^']+ loaded",f"🐦 Classic Twitter EN v{version} loaded",s)
    path.write_text(s,encoding='utf-8')
