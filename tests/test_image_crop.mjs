import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.style = {
      setProperty: (prop, val) => { this.style[prop] = val; },
      removeProperty: (prop) => { delete this.style[prop]; },
    };
    this.children = [];
    this.listeners = new Map();
    this.clientWidth = 260; this.clientHeight = 200;
    this.naturalWidth = 1000; this.naturalHeight = 800;
  }
  appendChild(el) { this._textContent = undefined; this.children.push(el); return el; }
  append(...els) { this._textContent = undefined; els.forEach(el => this.appendChild(el)); }
  get textContent() {
    if (this._textContent !== undefined) return this._textContent;
    return this.children.filter(c => c.style?.display !== "none").map(c => c.textContent).join("");
  }
  set textContent(val) {
    this._textContent = val === undefined || val === null ? "" : String(val);
    this.children = [];
  }
  addEventListener(type, fn, options) {
    this.listeners.set(type, fn);
    this.listenerOptions = this.listenerOptions || new Map();
    this.listenerOptions.set(type, options);
  }
  removeEventListener(type) { this.listeners.delete(type); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 260, height: 200 }; }
  setAttribute(name, val) { this.attributes = this.attributes || new Map(); this.attributes.set(name, String(val)); }
  getAttribute(name) { return this.attributes?.get(name) ?? null; }
  removeAttribute(name) { this.attributes?.delete(name); }
  closest() { return null; }
}

function environment() {
  const window = new Element('window');
  const context = vm.createContext({
    window, document: { createElement: tag => new Element(tag), body: new Element('body') },
    createElement: (tag, cls, text) => Object.assign(new Element(tag), { textContent: text }),
    openFileBrowserModal() {}, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {},
    ensureSpinnerStyles() {},
    ResizeObserver: class { observe() {} disconnect() {} }, console,
  });

  const source = readFileSync(new URL('../web/vf_image_preview_ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\n globalThis.exports = { setupLoadImageNode };', context);

  const values = {
    image_path: 'photo.png',
    longest_side: 0,
    crop_x: 0,
    crop_y: 0,
    crop_width: 0,
    crop_height: 0,
  };

  class Node {
    constructor() {
      this.size = [260, 340];
      this.widgets = Object.entries(values).map(([name, value]) => ({
        name, value, type: name === 'image_path' ? 'text' : 'number',
        callback: () => {},
      }));
    }
    addWidget(type, name, value, callback) {
      const w = { type, name, value, callback };
      this.widgets.push(w);
      return w;
    }
    addDOMWidget(name, type, el, options) {
      const w = { name, el, options };
      this.widgets.push(w);
      return w;
    }
    setDirtyCanvas() {}
    setSize(size) { this.size = size; }
  }

  context.exports.setupLoadImageNode(Node, {});
  const node = new Node();
  node.onNodeCreated();
  return { node, window, ...context.exports };
}

test('longest_side and crop widgets are hidden from the node widget list', () => {
  const { node } = environment();
  const hiddenFields = ['longest_side', 'crop_x', 'crop_y', 'crop_width', 'crop_height'];
  for (const name of hiddenFields) {
    const w = node.widgets.find(w => w.name === name);
    assert.ok(w, `Widget ${name} should exist`);
    assert.equal(w.type, 'hidden', `Widget ${name} should be hidden`);
    assert.equal(w.computeSize()[1], -4);
  }
});

test('image crop controls and resize input are created in preview container', () => {
  const { node } = environment();
  const cropper = node._vfImageCropper;
  assert.ok(cropper, 'Image preview should have an image cropper instance');
  assert.ok(cropper.cropToggleBtn, 'Crop toggle button should exist');
  assert.ok(cropper.advancedInputs?.longest_side, 'Resize to input should exist');
  assert.equal(cropper.cropToggleBtn.textContent, 'Enable Crop');
  assert.equal(cropper.leftControls?.style.alignItems, 'flex-end', 'Controls row should vertically align controls to flex-end');
});

test('toggling crop updates crop_x, crop_y, crop_width, crop_height on node widgets', () => {
  const { node } = environment();
  const cropper = node._vfImageCropper;
  cropper.imgEl.naturalWidth = 1000;
  cropper.imgEl.naturalHeight = 800;
  cropper.imgEl.onload();

  // Enable crop: 80% default centered crop
  cropper.cropToggleBtn.onclick();
  assert.equal(cropper.cropToggleBtn.textContent, 'Disable Crop');
  assert.equal(node.widgets.find(w => w.name === 'crop_x').value, 100);
  assert.equal(node.widgets.find(w => w.name === 'crop_y').value, 80);
  assert.equal(node.widgets.find(w => w.name === 'crop_width').value, 800);
  assert.equal(node.widgets.find(w => w.name === 'crop_height').value, 640);

  // Disable crop: resets to 0
  cropper.cropToggleBtn.onclick();
  assert.equal(cropper.cropToggleBtn.textContent, 'Enable Crop');
  for (const name of ['crop_x', 'crop_y', 'crop_width', 'crop_height']) {
    assert.equal(node.widgets.find(w => w.name === name).value, 0);
  }
});

test('editing Resize to input updates hidden longest_side widget with clamping', () => {
  const { node } = environment();
  const cropper = node._vfImageCropper;
  const input = cropper.advancedInputs.longest_side;
  const w = node.widgets.find(w => w.name === 'longest_side');

  input.value = '1024.4';
  input.onchange();
  assert.equal(w.value, 1024);

  input.value = '20000';
  input.onchange();
  assert.equal(w.value, 16384);

  input.value = '   ';
  input.onchange();
  assert.equal(w.value, 0);
  assert.equal(input.value, 0);
});

test('crop dragging updates crop_x and crop_y with bounds clamping', () => {
  const { node, window } = environment();
  const cropper = node._vfImageCropper;
  cropper.imgEl.naturalWidth = 1000;
  cropper.imgEl.naturalHeight = 800;
  cropper.imgEl.onload();
  cropper.cropToggleBtn.onclick(); // 800x640 at (100, 80)

  cropper.cropOverlay.onpointerdown({ clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {} });
  assert.ok(window.listeners.has('pointermove'));

  window.listeners.get('pointermove')({ clientX: 50, clientY: 40 });
  const newX = node.widgets.find(w => w.name === 'crop_x').value;
  const newY = node.widgets.find(w => w.name === 'crop_y').value;
  assert.ok(newX > 100);
  assert.ok(newY > 80);

  // Exceeding bounds clamps within [0, orig - size]
  window.listeners.get('pointermove')({ clientX: 10000, clientY: 10000 });
  assert.equal(node.widgets.find(w => w.name === 'crop_x').value, 200); // 1000 - 800
  assert.equal(node.widgets.find(w => w.name === 'crop_y').value, 160); // 800 - 640

  window.listeners.get('pointerup')();
  assert.equal(window.listeners.has('pointermove'), false);
});

test('corner resize handle drags update crop width and height', () => {
  const { node, window } = environment();
  const cropper = node._vfImageCropper;
  cropper.imgEl.naturalWidth = 1000;
  cropper.imgEl.naturalHeight = 800;
  cropper.imgEl.onload();
  cropper.cropToggleBtn.onclick();

  assert.ok(cropper.cropHandles.se, 'SE handle should exist');
  cropper.cropHandles.se.onpointerdown({ clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {} });

  window.listeners.get('pointermove')({ clientX: -20, clientY: -10 });
  const w = node.widgets.find(w => w.name === 'crop_width').value;
  const h = node.widgets.find(w => w.name === 'crop_height').value;
  assert.ok(w < 800);
  assert.ok(h < 640);

  window.listeners.get('pointerup')();
});

test('dimension badge and help circle update with crop and Resize to values', () => {
  const { node } = environment();
  const cropper = node._vfImageCropper;
  cropper.imgEl.naturalWidth = 1000;
  cropper.imgEl.naturalHeight = 800;
  cropper.imgEl.onload();

  // Full image, no resize
  assert.match(cropper.statusText.textContent, /1000 × 800/);
  assert.equal(cropper.cropResizeHelp.style.display, 'none');

  // Crop to 600x400
  cropper.change({ crop_x: 50, crop_y: 50, crop_width: 600, crop_height: 400 });
  assert.match(cropper.statusText.textContent, /Crop: 600 × 400/);
  assert.equal(cropper.cropResizeHelp.style.display, 'none');

  // Resize to 300
  cropper.change({ longest_side: 300 });
  // Longest of (600, 400) is 600 -> scaled to 300x200
  assert.match(cropper.statusText.textContent, /Crop: 300 × 200/);
  assert.equal(cropper.cropResizeHelp.style.display, 'inline-flex');
  assert.match(cropper.cropResizeHelp.title, /Output resolution: 300 × 200px/);
  assert.match(cropper.cropResizeHelp.title, /source crop \(600 × 400px\)/);
  assert.match(cropper.cropResizeHelp.title, /'Resize to' longest side \(300px\)/);
});

test('VFFileExplorer Explorer button has descriptive tooltip', () => {
  const context = vm.createContext({
    window: new Element('window'),
    document: { createElement: tag => new Element(tag), body: new Element('body') },
    createElement: (tag, cls, text) => Object.assign(new Element(tag), { textContent: text }),
    ensureSpinnerStyles() {},
    api: { fetchApi: async () => ({ ok: true, json: async () => ({}) }) },
    checkIsLocalClient: async () => true,
    isLikelyLocalHost: () => true,
    isSupportedMediaFile: () => true,
    makeModalBackdrop: () => ({ backdrop: new Element('backdrop'), close() {} }),
    getEmptyFolderMessage: () => ({}),
    createEmptyMessageEl: () => new Element('div'),
    icon: () => '',
    formatDateTime: () => '',
    formatDuration: () => '',
    clearDragPayload() {},
    setupDragPayload() {},
    setTimeout: fn => { fn(); return 1; },
    clearTimeout() {},
  });

  const source = readFileSync(new URL('../web/vf_file_explorer_ui.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s+[^;\r\n]+;?/g, '')
    .replace(/export /g, '');
  vm.runInContext(source + '\n globalThis.exports = { setupFileExplorerNode };', context);

  class Node {
    constructor() {
      this.size = [640, 680];
      this.widgets = [{ name: 'file_path', value: '', type: 'text' }];
    }
    addDOMWidget(name, type, el, options) {
      this.domWidget = { name, el, options };
      return this.domWidget;
    }
    setDirtyCanvas() {}
    setSize(s) { this.size = s; }
  }

  context.exports.setupFileExplorerNode(Node, {});
  const node = new Node();
  node.onNodeCreated();

  const container = node.domWidget.el;
  const buttons = [];
  function collectButtons(el) {
    if (el.tag === 'button') buttons.push(el);
    el.children?.forEach(collectButtons);
  }
  collectButtons(container);

  const explorerBtn = buttons.find(b => b.textContent?.trim() === 'Explorer');
  assert.ok(explorerBtn, 'Explorer button should exist on VFFileExplorer node');
  assert.ok(explorerBtn.title, 'Explorer button should have a tooltip');
  assert.match(explorerBtn.title, /system file explorer/i);
});

test('draggable file cards in VFFileExplorer include drag and drop canvas verbiage in tooltip', () => {
  const context = vm.createContext({
    window: new Element('window'),
    document: { createElement: tag => new Element(tag), body: new Element('body') },
    createElement: (tag, cls, text) => Object.assign(new Element(tag), { textContent: text }),
    ensureSpinnerStyles() {},
    api: { fetchApi: async () => ({ ok: true, json: async () => ({}) }) },
    checkIsLocalClient: async () => true,
    isLikelyLocalHost: () => true,
    isSupportedMediaFile: (f) => f && (f.media_type === 'image' || f.media_type === 'video' || f.media_type === 'audio'),
    makeModalBackdrop: () => ({ backdrop: new Element('backdrop'), close() {} }),
    getEmptyFolderMessage: () => ({}),
    createEmptyMessageEl: () => new Element('div'),
    icon: () => '',
    formatDateTime: () => '',
    formatDuration: () => '',
    clearDragPayload() {},
    setupDragPayload() {},
    setTimeout: fn => { fn(); return 1; },
    clearTimeout() {},
  });

  const source = readFileSync(new URL('../web/vf_file_explorer_ui.js', import.meta.url), 'utf8')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    .replace(/import\s+[^;\r\n]+;?/g, '')
    .replace(/export /g, '');
  vm.runInContext(source + '\n globalThis.exports = { setupFileExplorerNode };', context);

  class Node {
    constructor() {
      this.size = [640, 680];
      this.widgets = [{ name: 'file_path', value: '', type: 'text' }];
    }
    addDOMWidget(name, type, el, options) {
      this.domWidget = { name, el, options };
      return this.domWidget;
    }
    setDirtyCanvas() {}
    setSize(s) { this.size = s; }
  }

  context.exports.setupFileExplorerNode(Node, {});
  const node = new Node();
  node.onNodeCreated();

  const explorer = node._vfExplorer;
  assert.ok(explorer, 'node._vfExplorer should be set');

  const supportedFile = {
    name: 'test_render.png',
    path: '/path/to/test_render.png',
    media_type: 'image',
    size: 1048576,
  };
  const unsupportedFile = {
    name: 'document.pdf',
    path: '/path/to/document.pdf',
    media_type: 'other',
    size: 2048,
  };

  explorer.files = [supportedFile, unsupportedFile];
  explorer.dirs = [];
  explorer.renderGrid();

  const cards = [];
  function collectCards(el) {
    if (el.tag === 'div' && el.draggable !== undefined) cards.push(el);
    el.children?.forEach(collectCards);
  }
  collectCards(explorer.fileGridEl);

  const supportedCard = cards.find(c => c.draggable === true);
  const unsupportedCard = cards.find(c => c.draggable === false);

  assert.ok(supportedCard, 'Draggable card should exist for supported media file');
  assert.ok(supportedCard.title, 'Supported card should have title');
  assert.match(
    supportedCard.title,
    /drag and drop this file onto the canvas to create a loader node/i,
    'Draggable file card tooltip should include proper drag and drop canvas verbiage'
  );

  assert.ok(unsupportedCard, 'Unsupported card should exist');
  assert.doesNotMatch(
    unsupportedCard.title || '',
    /drag and drop/i,
    'Non-draggable file should not have drag and drop canvas verbiage'
  );

  // Test custom styled HTML tooltip on hover
  assert.ok(supportedCard.listeners.get('mouseenter'), 'mouseenter listener should be registered');
  supportedCard.listeners.get('mouseenter')({ clientX: 120, clientY: 150 });

  const tooltipEl = context.document.body.children.find(c => c.className === 'vf-file-card-custom-tooltip');
  assert.ok(tooltipEl, 'Custom tooltip element should be appended to body');
  assert.equal(tooltipEl.style.display, 'block', 'Tooltip should be visible');
  assert.match(tooltipEl.innerHTML, /vf-tooltip-instruction/, 'Tooltip should have highlighted instruction box');
  assert.match(tooltipEl.innerHTML, /💡/, 'Tooltip instruction should include indicator icon');
  assert.match(tooltipEl.innerHTML, /Drag &amp; Drop|Drag & Drop/, 'Tooltip instruction should have Drag & Drop header');
  assert.match(tooltipEl.innerHTML, /Drag and drop this file onto the canvas to create a loader node\./, 'Tooltip should display instruction text');

  // Hovering mouseleave should hide tooltip and restore title
  supportedCard.listeners.get('mouseleave')();
  assert.equal(tooltipEl.style.display, 'none', 'Tooltip should hide on mouseleave');
  assert.match(supportedCard.title, /drag and drop this file onto the canvas to create a loader node/i, 'Title should be restored on mouseleave');

  // Unsupported file card should not have instruction box in tooltip
  unsupportedCard.listeners.get('mouseenter')({ clientX: 120, clientY: 150 });
  assert.doesNotMatch(tooltipEl.innerHTML, /vf-tooltip-instruction/, 'Unsupported file tooltip should not have instruction box');
  unsupportedCard.listeners.get('mouseleave')();
});


