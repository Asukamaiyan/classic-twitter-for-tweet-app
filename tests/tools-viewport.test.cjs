const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '../src/enhancements.js'), 'utf8');

function setup(t, withViewport = true) {
  const dom = new JSDOM('<html><head></head><body><main></main></body></html>', {
    url: 'https://app.tweet.app/feed', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const viewport = new window.EventTarget();
  Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 });
  window.innerHeight = 844;
  if (withViewport) window.visualViewport = viewport;
  window.eval(source + '\nwindow.installLocalEnhancements = installLocalEnhancements;');
  const controller = window.installLocalEnhancements();
  t.after(() => { controller.destroy(); window.close(); });
  const tick = () => new Promise(resolve => window.setTimeout(resolve, 40));
  return { window, viewport, controller, root: controller.root, tick };
}

test('keyboard viewport changes move only the tools above covered content and recover on close', async t => {
  const { window, viewport, root, tick } = setup(t);
  assert.equal(root.style.getPropertyValue('--ct-view-height'), '844px');
  viewport.height = 400;
  viewport.dispatchEvent(new window.Event('resize'));
  await tick();
  assert.equal(root.style.getPropertyValue('--ct-keyboard-offset'), '444px');
  assert.equal(root.style.getPropertyValue('--ct-root-gap'), '12px');
  assert.equal(root.style.getPropertyValue('--ct-view-height'), '400px');
  // Scrolling the visual viewport reduces the covered bottom area.
  viewport.offsetTop = 60;
  viewport.dispatchEvent(new window.Event('scroll'));
  await tick();
  assert.equal(root.style.getPropertyValue('--ct-keyboard-offset'), '384px');
  viewport.height = 844;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new window.Event('resize'));
  await tick();
  assert.equal(root.style.getPropertyValue('--ct-keyboard-offset'), '0px');
  assert.equal(root.style.getPropertyValue('--ct-root-gap'), '');
  assert.equal(window.document.body.style.cssText, '');
});

test('pinch zoom is not mistaken for keyboard coverage and missing VisualViewport uses CSS fallback', async t => {
  const { window, viewport, root, tick } = setup(t);
  viewport.scale = 2;
  viewport.height = 422;
  viewport.dispatchEvent(new window.Event('resize'));
  await tick();
  assert.equal(root.style.getPropertyValue('--ct-keyboard-offset'), '');
  assert.equal(root.style.getPropertyValue('--ct-view-height'), '');
  const fallback = setup(t, false);
  assert.equal(fallback.root.style.getPropertyValue('--ct-view-height'), '');
});

test('destroy removes viewport listeners and cancels pending layout work', async t => {
  const { window, viewport, root, controller, tick } = setup(t);
  viewport.height = 400;
  viewport.dispatchEvent(new window.Event('resize'));
  controller.destroy();
  const before = root.style.cssText;
  viewport.height = 300;
  viewport.dispatchEvent(new window.Event('scroll'));
  window.dispatchEvent(new window.Event('resize'));
  await tick();
  assert.equal(root.style.cssText, before);
  assert.equal(root.isConnected, false);
});
