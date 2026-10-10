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
    this.clientWidth = 300;
    this.clientHeight = 200;
  }
  appendChild(el) {
    this.children.push(el);
    return el;
  }
  append(...els) {
    els.forEach((el) => this.appendChild(el));
  }
  get textContent() {
    return this._textContent ?? "";
  }
  set textContent(val) {
    this._textContent = String(val);
  }
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners.has(type)) return;
    const list = this.listeners.get(type).filter((f) => f !== fn);
    this.listeners.set(type, list);
  }
  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) fn(event);
  }
  setAttribute(name, val) { this.attributes = this.attributes || new Map(); this.attributes.set(name, String(val)); }
  getAttribute(name) { return this.attributes?.get(name) ?? null; }
  removeAttribute(name) { this.attributes?.delete(name); }
  closest() {
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 300, height: 200 };
  }
}

class EventTargetMock {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners.has(type)) return;
    const list = this.listeners.get(type).filter((f) => f !== fn);
    this.listeners.set(type, list);
  }
  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const fn of list) fn(event);
  }
}

function createEnvironment() {
  const window = new Element('window');
  window.LiteGraph = { vueNodesMode: false };

  const settingsTarget = new EventTargetMock();
  settingsTarget.settings = {};
  settingsTarget.addSetting = (s) => { settingsTarget.settings[s.id] = s; };
  settingsTarget.setSettingValue = function(id, val) {
    this.dispatchEvent({ type: `${id}.change`, detail: { value: val } });
    this.dispatchEvent({ type: "change", detail: { id, value: val } });
  };

  const app = {
    ui: {
      settings: settingsTarget,
    },
    graph: {
      _nodes: [],
    },
    canvas: {
      setDirty: () => {},
    },
    registerExtension: (ext) => {
      app.extension = ext;
    },
  };

  const context = vm.createContext({
    window,
    document: {
      createElement: (tag) => new Element(tag),
      body: new Element('body'),
    },
    createElement: (tag, cls, text) => Object.assign(new Element(tag), { textContent: text }),
    openFileBrowserModal() {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { fn(); return 1; },
    ensureSpinnerStyles() {},
    setupCanvasDrop: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    app,
    console,
  });

  return { context, app, window, settingsTarget };
}

test('Nodes 2.0 toggle handler is registered and recalculates heights on custom nodes', async (t) => {
  const { context, app, window, settingsTarget } = createEnvironment();

  // Load vf_file_nodes.js
  const source = readFileSync(new URL('../web/vf_file_nodes.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

  vm.runInContext(
    `${source}\n globalThis.__ext = app.extension; globalThis.refreshAllVFNodeDimensions = refreshAllVFNodeDimensions;`,
    context
  );

  assert.ok(context.refreshAllVFNodeDimensions, 'refreshAllVFNodeDimensions should be exported');

  // Set up mock nodes
  const nodeImage = {
    type: 'VFLoadImage',
    size: [260, 560], // bloated Nodes 2.0 height
    _vfLegacyHeight: undefined,
    setSize(s) { this.size = s; },
    setDirtyCanvas() { this.dirty = true; },
  };

  const nodeExplorer = {
    type: 'VFFileExplorer',
    size: [640, 850], // bloated Nodes 2.0 height
    _vfLegacyHeight: undefined,
    setSize(s) { this.size = s; },
    setDirtyCanvas() { this.dirty = true; },
  };

  const nodeVideo = {
    type: 'VFLoadVideo',
    size: [320, 680], // bloated Nodes 2.0 height
    _vfLegacyHeight: undefined,
    setSize(s) { this.size = s; },
    setDirtyCanvas() { this.dirty = true; },
  };

  const nodeAudio = {
    type: 'VFLoadAudio',
    size: [260, 420], // bloated Nodes 2.0 height
    _vfLegacyHeight: undefined,
    setSize(s) { this.size = s; },
    setDirtyCanvas() { this.dirty = true; },
  };

  app.graph._nodes = [nodeImage, nodeExplorer, nodeVideo, nodeAudio];

  // Initialize extension setup
  await app.extension.setup();

  // Simulate toggle from Nodes 2.0 (true) to Legacy (false)
  window.LiteGraph.vueNodesMode = true;
  settingsTarget.setSettingValue('Comfy.VueNodes.Enabled', false);

  // Assert all node heights were recalculated and shrunk to remove empty dead space
  assert.equal(nodeImage.size[1], 380, 'VFLoadImage height should shrink to default 380px in legacy mode');
  assert.equal(nodeExplorer.size[1], 680, 'VFFileExplorer height should shrink to default 680px in legacy mode');
  assert.equal(nodeVideo.size[1], 440, 'VFLoadVideo height should shrink to default 440px in legacy mode');
  assert.equal(nodeAudio.size[1], 240, 'VFLoadAudio height should shrink to default 240px in legacy mode');
  assert.ok(nodeImage.dirty, 'Canvas dirty flag should be set for VFLoadImage');
  assert.ok(nodeExplorer.dirty, 'Canvas dirty flag should be set for VFFileExplorer');
  assert.ok(nodeVideo.dirty, 'Canvas dirty flag should be set for VFLoadVideo');
  assert.ok(nodeAudio.dirty, 'Canvas dirty flag should be set for VFLoadAudio');
});

test('Nodes 2.0 toggle restores user custom legacy height if previously set', async (t) => {
  const { context, app, window, settingsTarget } = createEnvironment();

  const source = readFileSync(new URL('../web/vf_file_nodes.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

  vm.runInContext(
    `${source}\n globalThis.__ext = app.extension; globalThis.refreshAllVFNodeDimensions = refreshAllVFNodeDimensions;`,
    context
  );

  await app.extension.setup();

  const nodeImage = {
    type: 'VFLoadImage',
    size: [260, 560],
    _vfLegacyHeight: 420, // user explicitly made it 420px before switching to Nodes 2.0
    setSize(s) { this.size = s; },
    setDirtyCanvas() { this.dirty = true; },
  };

  app.graph._nodes = [nodeImage];

  settingsTarget.setSettingValue('Comfy.VueNodes.Enabled', false);

  assert.equal(nodeImage.size[1], 420, 'Should restore user-defined legacy height rather than bloated Nodes 2.0 height');
});

test('VFLoadImage setupLoadImageNode registers _vfRecalculateDimensions and resets container styling on toggle', async (t) => {
  const { context, app, window, settingsTarget } = createEnvironment();

  // Load vf_image_preview_ui.js
  const imageSource = readFileSync(new URL('../web/vf_image_preview_ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

  vm.runInContext(
    `${imageSource}\n globalThis.setupLoadImageNode = setupLoadImageNode;`,
    context
  );

  // Load vf_file_nodes.js
  const nodesSource = readFileSync(new URL('../web/vf_file_nodes.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

  vm.runInContext(
    `${nodesSource}\n globalThis.__ext = app.extension;`,
    context
  );

  await app.extension.setup();

  class MockNodeType {
    constructor() {
      this.size = [260, 380];
      this.widgets = [
        { name: 'image_path', value: 'sample.png', type: 'text', callback: () => {} },
        { name: 'longest_side', value: 0, type: 'number', callback: () => {} },
        { name: 'crop_x', value: 0, type: 'number', callback: () => {} },
        { name: 'crop_y', value: 0, type: 'number', callback: () => {} },
        { name: 'crop_width', value: 0, type: 'number', callback: () => {} },
        { name: 'crop_height', value: 0, type: 'number', callback: () => {} },
      ];
    }
    addWidget(type, name, value, cb) {
      const w = { type, name, value, callback: cb };
      this.widgets.push(w);
      return w;
    }
    addDOMWidget(name, type, el, opts) {
      const w = { name, type, element: el, options: opts };
      this.widgets.push(w);
      return w;
    }
    setSize(s) { this.size = s; }
    setDirtyCanvas() { this.dirty = true; }
  }

  context.setupLoadImageNode(MockNodeType, { name: 'VFLoadImage' });

  const node = new MockNodeType();
  node.onNodeCreated();

  assert.ok(typeof node._vfRecalculateDimensions === 'function', 'Node should have _vfRecalculateDimensions');

  // Simulate entering Vue nodes mode where height expands
  window.LiteGraph.vueNodesMode = true;
  node.size = [260, 580]; // Nodes 2.0 expanded size
  node._vfRecalculateDimensions(true);

  // In Vue mode, cropper root should have max-height
  assert.equal(node._vfImageCropper.root.style.maxHeight, '280px');
  assert.equal(node._vfImageCropper.wrapper.style.height, '200px');

  // Now toggle back to Legacy mode
  window.LiteGraph.vueNodesMode = false;
  app.graph._nodes = [node];
  settingsTarget.setSettingValue('Comfy.VueNodes.Enabled', false);

  // Assert legacy styles and height reset to 380px without dead space
  assert.equal(node.size[1], 380, 'Node height should shrink back to 380px');
  assert.equal(node._vfImageCropper.root.style.maxHeight, 'none');
  assert.equal(node._vfImageCropper.root.style.height, '100%');
  assert.equal(node._vfImageCropper.wrapper.style.height, 'auto');
  assert.equal(node._vfImageCropper.wrapper.style.flex, '1 1 0');
});

test('onResize records legacy height only when in legacy mode', async (t) => {
  const { context, app, window } = createEnvironment();

  const imageSource = readFileSync(new URL('../web/vf_image_preview_ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');

  vm.runInContext(
    `${imageSource}\n globalThis.setupLoadImageNode = setupLoadImageNode;`,
    context
  );

  class MockNodeType {
    constructor() {
      this.size = [260, 380];
      this.widgets = [
        { name: 'image_path', value: 'sample.png', type: 'text', callback: () => {} },
      ];
    }
    addWidget() { return {}; }
    addDOMWidget() { return {}; }
    setSize(s) { this.size = s; }
    setDirtyCanvas() {}
  }

  context.setupLoadImageNode(MockNodeType, { name: 'VFLoadImage' });
  const node = new MockNodeType();
  node.onNodeCreated();

  // 1. In Legacy mode: resizing to 450 should set _vfLegacyHeight = 450
  window.LiteGraph.vueNodesMode = false;
  node.size = [260, 450];
  node.onResize(node.size);
  assert.equal(node._vfLegacyHeight, 450, '_vfLegacyHeight should be recorded in legacy mode');

  // 2. In Vue mode: resizing should NOT overwrite _vfLegacyHeight
  window.LiteGraph.vueNodesMode = true;
  node.size = [260, 600];
  node.onResize(node.size);
  assert.equal(node._vfLegacyHeight, 450, '_vfLegacyHeight should NOT be overwritten by Vue mode resize');
});

