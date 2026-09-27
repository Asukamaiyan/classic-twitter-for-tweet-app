/* Optional on-device translation. No post text is sent to another service. */
function createDeviceTranslation({ locale = 'ja', getContext, isActive, isManual = () => false, onStatus, onComplete } = {}) {
  const ja = locale === 'ja';
  const copy = ja ? {
    unsupported: 'このブラウザは端末内翻訳に対応していません。サイトの翻訳をご利用ください。',
    activation: 'モデルの準備ボタンをもう一度押してください。', preparing: '翻訳モデルを準備しています…',
    ready: '端末内翻訳の準備ができました。', unavailable: 'この言語の翻訳モデルを利用できません。',
    failed: '端末内翻訳に失敗しました。原文とサイトの翻訳はそのまま使えます。',
    needModel: 'この言語のモデルを便利ツールで準備してください。', unknown: '言語を確実に判定できませんでした。サイトの翻訳をご利用ください。',
    translate: '端末内で翻訳', hide: '訳文を閉じる', working: '端末内で翻訳中…', label: '端末内の翻訳',
    same: 'ブラウザの表示言語と同じです。', length: 'この投稿は端末内翻訳で扱える長さを超えています。',
  } : {
    unsupported: 'On-device translation is unavailable in this browser. Use site translation.',
    activation: 'Press Prepare model again.', preparing: 'Preparing translation models…',
    ready: 'On-device translation is ready.', unavailable: 'This translation model is unavailable.',
    failed: 'On-device translation failed. The original and site translation remain available.',
    needModel: 'Prepare a model for this language in Tools.', unknown: 'The language could not be identified reliably. Use site translation.',
    translate: 'Translate on device', hide: 'Hide translation', working: 'Translating on device…', label: 'On-device translation',
    same: 'This post already uses the browser’s language.', length: 'This post exceeds the on-device translation input limit.',
  };
  const supported = typeof globalThis.Translator?.availability === 'function' &&
    typeof globalThis.Translator?.create === 'function' &&
    typeof globalThis.LanguageDetector?.availability === 'function' &&
    typeof globalThis.LanguageDetector?.create === 'function';
  // Chrome uses zh-Hant for Traditional Chinese, not the site's zh-TW code.
  const browserLanguage = (navigator.language || locale).toLowerCase();
  const target = /^zh-(?:hant|tw|hk|mo)/.test(browserLanguage) ? 'zh-Hant' : browserLanguage.split(/[-_]/)[0];
  const translators = new Map();
  const cache = new Map();
  const records = new Map();
  const queue = new Map();
  let detector = null;
  let busy = false;
  let preparing = false;
  let generation = 0;
  let style = null;
  const say = message => onStatus?.(message);

  async function prepare(source) {
    if (!supported) { say(copy.unsupported); return false; }
    if (preparing) return false;
    if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(source) || source.toLowerCase() === target.toLowerCase()) {
      say(copy.same); return false;
    }
    if (navigator.userActivation && !navigator.userActivation.isActive) { say(copy.activation); return false; }
    preparing = true;
    say(copy.preparing);
    try {
      const [pair, detection] = await Promise.all([
        Translator.availability({ sourceLanguage: source, targetLanguage: target }),
        LanguageDetector.availability()
      ]);
      if (pair === 'unavailable' || detection === 'unavailable') { say(copy.unavailable); return false; }
      if (navigator.userActivation && !navigator.userActivation.isActive) { say(copy.activation); return false; }
      const monitor = m => m.addEventListener('downloadprogress', event => {
        if (Number.isFinite(event.loaded)) say(`${copy.preparing} ${Math.round(event.loaded * 100)}%`);
      });
      // Start both creations during the same explicit user activation. Do not
      // start the translator after waiting for the detector's model download.
      const results = await Promise.allSettled([
        detector || LanguageDetector.create({ monitor }),
        translators.get(source) || Translator.create({ sourceLanguage: source, targetLanguage: target, monitor })
      ]);
      if (results[0].status === 'fulfilled') detector = results[0].value;
      if (results[1].status === 'fulfilled') translators.set(source, results[1].value);
      if (results.some(result => result.status === 'rejected')) { say(copy.failed); return false; }
      for (const record of records.values()) record.attempted = false;
      say(`${copy.ready} (${source} → ${target})`);
      onComplete?.();
      return true;
    } catch { say(copy.failed); return false; }
    finally { preparing = false; }
  }

  function ensureStyle() {
    if (style?.isConnected) return;
    style = document.createElement('style');
    style.dataset.ctOwned = 'true';
    style.textContent = `.ct-device-translation{margin:8px 0;color:inherit;font:inherit}.ct-device-translation button{color:var(--color-tl-app-primary,#1688d4);background:none;border:0;padding:6px 0;cursor:pointer;font:inherit;font-size:.8125rem}.ct-device-translation button:focus-visible{outline:2px solid currentColor;outline-offset:2px}.ct-device-translation p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.ct-device-translation[hidden],.ct-device-translation [hidden]{display:none!important}`;
    document.head.append(style);
  }

  function stillValid(record, token) {
    return generation === token && isActive() && record.section.isConnected &&
      getContext(record.native)?.text === record.text && !record.dismissed && !isManual(record.article);
  }

  async function process() {
    if (busy) return;
    busy = true;
    let processed = false;
    while (queue.size) {
      const [record, automatic] = queue.entries().next().value;
      queue.delete(record);
      if (!record.section.isConnected || !isActive() || record.dismissed ||
          getContext(record.native)?.text !== record.text) continue;
      if (automatic && record.attempted) continue;
      processed = true;
      record.attempted = true;
      const token = generation;
      record.button.disabled = true;
      record.button.textContent = copy.working;
      try {
        if (!detector) throw new Error(copy.needModel);
        if (record.text.length > 12000) throw new Error(copy.length);
        const key = `${target}:${record.text}`;
        let translated = cache.get(key);
        if (!translated) {
          const [result] = await detector.detect(record.text);
          if (!stillValid(record, token)) continue;
          if (!result || !Number.isFinite(result.confidence) || result.confidence < 0.75 || !result.detectedLanguage || result.detectedLanguage === 'und') throw new Error(copy.unknown);
          const source = result.detectedLanguage;
          if (source.toLowerCase() === target.toLowerCase()) throw new Error(copy.same);
          const translator = translators.get(source);
          if (!translator) throw new Error(`${copy.needModel} (${source} → ${target})`);
          translated = await translator.translate(record.text);
          if (typeof translated !== 'string' || !translated.trim()) throw new Error(copy.failed);
          cache.set(key, translated);
          if (cache.size > 200) cache.delete(cache.keys().next().value);
        }
        if (!stillValid(record, token)) continue;
        record.output.textContent = translated;
        record.output.lang = target;
        record.output.hidden = false;
        record.shown = true;
      } catch (error) {
        if (stillValid(record, token)) {
          const known = Object.values(copy).some(message => error.message?.startsWith(message));
          record.output.textContent = known ? error.message : copy.failed;
          record.output.hidden = false;
        }
      } finally {
        record.button.disabled = false;
        record.button.textContent = record.shown ? copy.hide : copy.translate;
      }
    }
    busy = false;
    if (processed) onComplete?.();
  }

  function patch(root = document, automatic = false) {
    if (!supported || !isActive()) return;
    ensureStyle();
    for (const [article, record] of records) {
      if (!article.isConnected || !record.section.isConnected || getContext(record.native)?.text !== record.text) {
        record.section.remove(); queue.delete(record); records.delete(article);
      }
    }
    for (const native of ctTranslationControls(root)) {
      const context = getContext(native);
      if (!context || isManual(context.article) || !native.closest('[aria-live="polite"]') || ctTranslationDisabled(native)) continue;
      let record = records.get(context.article);
      if (!record) {
        const section = document.createElement('div');
        section.className = 'ct-device-translation';
        section.dataset.ctOwned = 'true';
        section.setAttribute('aria-label', copy.label);
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = copy.translate;
        const output = document.createElement('p'); output.hidden = true;
        output.setAttribute('aria-live', 'polite');
        section.append(button, output);
        section.addEventListener('click', event => event.stopPropagation());
        context.body.insertAdjacentElement('afterend', section);
        record = { ...context, native, section, button, output, attempted: false, dismissed: false, shown: false };
        records.set(context.article, record);
        button.addEventListener('click', () => {
          if (record.shown) {
            record.output.hidden = true; record.shown = false; record.dismissed = true;
            record.button.textContent = copy.translate;
          } else {
            record.dismissed = false; queue.set(record, false); void process();
          }
        });
      }
      if (automatic && detector && !record.attempted && !record.dismissed && queue.size < 40) queue.set(record, true);
    }
    void process();
  }

  function cancel() { generation++; queue.clear(); }
  function hide(article) {
    const record = records.get(article);
    if (!record) return;
    record.dismissed = true; record.output.hidden = true; record.shown = false;
    record.button.textContent = copy.translate; queue.delete(record);
  }
  function clear() {
    if (!records.size) return;
    cancel();
    for (const record of records.values()) record.section.remove();
    records.clear();
  }
  return { supported, prepare, patch, cancel, clear, hide };
}
