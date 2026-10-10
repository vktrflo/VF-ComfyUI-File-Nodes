import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

class Element {
  constructor(tag) {
    this.tag = tag; this.style = {}; this.children = []; this.listeners = new Map();
    this.paused = true; this.currentTime = 0; this.duration = 10;
    this.videoWidth = 1920; this.videoHeight = 1080;
    this.clientWidth = 320; this.clientHeight = 180;
    this.volume = 1; this.muted = false;
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
  getBoundingClientRect() { return { left: 0, top: 0, width: 160, height: 90 }; }
  setAttribute(name, val) { this.attributes = this.attributes || new Map(); this.attributes.set(name, String(val)); }
  getAttribute(name) { return this.attributes?.get(name) ?? null; }
  removeAttribute(name) { this.attributes?.delete(name); }
  load() {}
  pause() { this.paused = true; this.onpause?.(); }
  play() { this.paused = false; this.onplay?.(); return Promise.resolve(); }
  closest() { return null; }
}
function environment() {
  const window = new Element('window');
  let rafCallbacks = [];
  const requestAnimationFrame = fn => {
    rafCallbacks.push(fn);
    return rafCallbacks.length;
  };
  const cancelAnimationFrame = id => {
    if (id > 0 && id <= rafCallbacks.length) rafCallbacks[id - 1] = null;
  };
  const stepRaf = () => {
    const batch = rafCallbacks.slice();
    rafCallbacks = [];
    batch.forEach(fn => fn?.());
  };
  const storage = new Map();
  const localStorage = {
    getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
  };
  const context = vm.createContext({
    window, document: { createElement: tag => new Element(tag), body: new Element('body') },
    createElement: (tag, cls, text) => Object.assign(new Element(tag), { textContent: text }),
    makeModalBackdrop: () => ({ backdrop: new Element('backdrop'), close() {} }),
    openFileBrowserModal() {}, setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
    ResizeObserver: class { observe() {} disconnect() {} }, console,
    requestAnimationFrame, cancelAnimationFrame, localStorage,
    fetch: async url => {
      const parsed = new URL(url, 'http://localhost');
      const path = parsed.searchParams.get('path');
      if (path === 'sixty_fps.mp4') return { ok: true, json: async () => ({ success: true, fps: 60 }) };
      if (path === 'thirty_fps.mp4') return { ok: true, json: async () => ({ success: true, fps: 30 }) };
      return { ok: true, json: async () => ({ success: true, fps: 24 }) };
    },
  });
  const source = readFileSync(new URL('../web/vf_video_scrubber_modal.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\n globalThis.exports = { setupLoadVideoNode, VFVideoScrubberModal, Player: typeof VFVideoScrubber !== "undefined" ? VFVideoScrubber : null };', context);
  const values = { video_path: 'clip.mp4', start_time: 1, segment_duration: 2, playback_speed: 1,
    fps: 24, longest_side: 0, current_frame_offset: 0, crop_x: 0, crop_y: 0, crop_width: 0, crop_height: 0 };
  class Node {
    constructor() { this.size = [260, 440]; this.widgets = Object.entries(values).map(([name, value]) => ({ name, value, type: name === 'video_path' ? 'text' : 'number' })); }
    addWidget(type, name, value, callback) { const w = { type, name, value, callback }; this.widgets.push(w); return w; }
    addDOMWidget(name, type, el, options) { const w = { name, el, options }; this.widgets.push(w); return w; }
    setDirtyCanvas() {}
    setSize(size) { this.size = size; }
  }
  context.exports.setupLoadVideoNode(Node, {});
  const node = new Node(); node.onNodeCreated();
  return { node, window, stepRaf, ...context.exports };
}
const pointer = clientX => ({ clientX, stopPropagation() {}, preventDefault() {} });
function dragBar(player, window, which, from, to) {
  assert.ok(player.timelineHandles?.[which], 'timeline needs draggable in/out bars');
  player.timelineHandles[which].onpointerdown(pointer(from));
  window.listeners.get('pointermove')(pointer(to));
  window.listeners.get('pointerup')();
}
test('inline seeking is preview-only; in-point and crop edits write existing widgets', () => {
  const { node, window } = environment();
  const player = node._vfVideoScrubber;
  assert.ok(player, 'node should have an inline scrubber');
  player.videoEl.onloadedmetadata();
  player.scrubberTrack.onclick({ clientX: 80 });
  assert.equal(player.videoEl.currentTime, 5);
  assert.equal(node.widgets.find(w => w.name === 'start_time').value, 1);
  dragBar(player, window, 'in', 16, 32);
  assert.equal(node.widgets.find(w => w.name === 'start_time').value, 2);
  assert.equal(node.widgets.find(w => w.name === 'segment_duration').value, 1);
  player.cropToggleBtn.onclick();
  assert.equal(node.widgets.find(w => w.name === 'crop_width').value, 1536);
  player.cropToggleBtn.onclick();
  for (const name of ['crop_x', 'crop_y', 'crop_width', 'crop_height'])
    assert.equal(node.widgets.find(w => w.name === name).value, 0);
});
test('numeric edits and workflow restore refresh inline state without serializing preview', () => {
  const { node } = environment();
  assert.ok(node._vfVideoScrubber);
  const speed = node.widgets.find(w => w.name === 'playback_speed');
  speed.value = 2; speed.callback(2);
  assert.equal(node._vfVideoScrubber.videoEl.playbackRate, 2);
  const path = node.widgets.find(w => w.name === 'video_path');
  path.value = 'other.mp4'; node.onConfigure();
  assert.match(node._vfVideoScrubber.videoEl.src, /other.mp4/);
  assert.equal(node.widgets.find(w => w.name === 'video_scrubber').options.serialize, false);
});
test('crop dragging accounts for canvas zoom, clamps coordinates, and cleans up on removal', () => {
  const { node, window } = environment();
  const player = node._vfVideoScrubber;
  assert.ok(player); player.videoEl.onloadedmetadata(); player.cropToggleBtn.onclick();
  player.cropOverlay.onpointerdown({ clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {} });
  window.listeners.get('pointermove')({ clientX: 10000, clientY: 10000 });
  assert.equal(node.widgets.find(w => w.name === 'crop_x').value, 384);
  assert.equal(node.widgets.find(w => w.name === 'crop_y').value, 216);
  node.onRemoved();
  assert.equal(window.listeners.has('pointermove'), false);
  assert.equal(player.videoEl.paused, true);
});
test('modal edits remain staged until Apply, then refresh the inline controls', () => {
  const { node, window, VFVideoScrubberModal } = environment();
  const modal = new VFVideoScrubberModal(node); modal.open();
  modal.player.videoEl.onloadedmetadata();
  dragBar(modal.player, window, 'in', 16, 32);
  assert.equal(node.widgets.find(w => w.name === 'start_time').value, 1);
  modal.applyToNode();
  assert.equal(node._vfVideoScrubber.state.start_time, 2);
  assert.equal(modal.player.videoEl.paused, true);
});
test('portrait crop overlay uses the actual contained video rectangle after resizing', () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  player.videoEl.videoWidth = 1080; player.videoEl.videoHeight = 1920;
  player.videoEl.onloadedmetadata(); player.cropToggleBtn.onclick();
  assert.equal(player.cropOverlay.style.left, '119.5px');
  assert.equal(player.cropOverlay.style.top, '18px');
  player.playerWrapper.clientWidth = 640; player.syncCropBoxToVideo();
  assert.equal(player.cropOverlay.style.left, '279.5px');
});
test('empty and invalid paths disable controls; playback failures are visible', async () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  const path = node.widgets.find(w => w.name === 'video_path');
  path.value = ''; path.callback('');
  assert.equal(player.playBtn.disabled, true);
  assert.match(player.status.textContent, /Select a video/);
  path.value = 'bad.mp4'; path.callback(path.value); player.videoEl.onerror();
  assert.match(player.status.textContent, /Unable to load/);
  assert.equal(player.timelineHandles.in.disabled, true);
  node.onResize();
  assert.match(player.status.textContent, /Unable to load/);
  player.videoEl.onloadedmetadata();
  player.videoEl.play = () => Promise.reject(new Error('unsupported'));
  await player.playBtn.onclick();
  assert.match(player.status.textContent, /Unable to play/);
});
test('multiple nodes keep their preview and values independent', () => {
  const {node:a, window} = environment(), b = environment().node;
  a._vfVideoScrubber.videoEl.onloadedmetadata();
  dragBar(a._vfVideoScrubber, window, 'in', 16, 32);
  assert.equal(b._vfVideoScrubber.state.start_time, 1);
});
test('Nodes 2.0 uses intrinsic preview height while Legacy Canvas fills its overlay', () => {
  const { node, window } = environment(); const player = node._vfVideoScrubber;
  assert.equal(player.root.style.height, '100%');
  window.LiteGraph = { vueNodesMode: true }; node.onResize();
  assert.equal(player.root.style.height, 'auto');
  assert.equal(player.playerWrapper.style.height, '220px');
  window.LiteGraph.vueNodesMode = false; node.onResize();
  assert.equal(player.root.style.height, '100%');
});
test('numeric rows are hidden and widget values stay in order', () => {
  const { node } = environment();
  assert.deepEqual(node.widgets.filter(w => w.type === 'number').map(w => w.name), []);
  assert.deepEqual(node.widgets.slice(0, 11).map(w => w.value), ['clip.mp4', 1, 2, 1, 24, 0, 0, 0, 0, 0, 0]);
  for (const w of node.widgets.filter(w => w.type === 'hidden')) assert.equal(w.computeSize()[1], -4);
});
test('longest side is edited through Advanced, clamps to integer limits, and respects connections', () => {
  const {node}=environment(), player=node._vfVideoScrubber;
  const w=node.widgets.find(w=>w.name==='longest_side');
  assert.ok(player.advancedInputs.longest_side);
  const input=player.advancedInputs.longest_side;
  input.value='1024.6'; input.onchange(); assert.equal(w.value,1025);
  input.value='0'; input.onchange(); assert.equal(w.value,0);
  input.value='20000'; input.onchange(); assert.equal(w.value,16384);
  node.inputs=[{name:'longest_side',link:22}]; node.onConfigure();
  assert.equal(input.disabled,true);
  input.value='512'; input.onchange(); assert.equal(w.value,16384);
  node.inputs=[]; node.onConfigure();
  assert.equal(input.disabled,false);
  input.value=''; input.onblur(); assert.equal(input.value, 0); assert.equal(w.value, 0); assert.equal(player.state.longest_side, 0);
  input.value='720'; input.onchange(); assert.equal(w.value, 720);
  input.value='   '; input.onchange(); assert.equal(input.value, 0); assert.equal(w.value, 0); assert.equal(player.state.longest_side, 0);
});
test('out-point drag changes duration and clamps before the in-point', () => {
  const { node, window } = environment(); const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();
  dragBar(player, window, 'out', 48, 96);
  assert.equal(node.widgets.find(w => w.name === 'segment_duration').value, 5);
  dragBar(player, window, 'out', 96, 0);
  assert.equal(node.widgets.find(w => w.name === 'segment_duration').value, .1);
});
test('crop resize handles update hidden dimensions in source pixels at canvas zoom', () => {
  const { node, window } = environment(); const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata(); player.cropToggleBtn.onclick();
  assert.ok(player.cropHandles?.se, 'crop needs a resize handle');
  player.cropHandles.se.onpointerdown({ clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {} });
  window.listeners.get('pointermove')({ clientX: -8, clientY: -4 });
  assert.equal(node.widgets.find(w => w.name === 'crop_width').value, 1440);
  assert.equal(node.widgets.find(w => w.name === 'crop_height').value, 816);
  assert.equal(node.widgets.find(w => w.name === 'crop_x').value, 192);
});
test('Advanced settings update hidden values and preserve connected input sockets', () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  assert.ok(player.advancedInputs, 'scrubber needs settings inputs');
  assert.equal(player.advancedInputs.playback_speed, undefined, 'Preview speed must be removed');
  player.advancedInputs.fps.value = '30'; player.advancedInputs.fps.onchange();
  assert.equal(node.widgets.find(w => w.name === 'fps').value, 30);
  node.inputs = [{ name: 'fps', link: 12, widget: { name: 'fps' } }];
  node.onConfigure();
  assert.equal(player.advancedInputs.fps.disabled, true);
  assert.equal(node.inputs[0].link, 12);
});
test('expanding Advanced grows the Legacy Canvas panel instead of clipping controls', () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  player.controls.scrollHeight = 240; node.onResize();
  assert.equal(player.minHeight, 422);
  assert.equal(node.widgets.find(w => w.name === 'video_scrubber').options.getMinHeight(), 422);
  assert.ok(node.size[1] >= 562);
});
test('connected crop inputs lock visual edits and converted widgets retain their serialization', () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  const crop = node.widgets.find(w => w.name === 'crop_width');
  crop.type = 'converted-widget'; crop.serializeValue = () => 512;
  node.inputs = [{ name: 'crop_width', widget: { name: 'crop_width' }, link: 10 }];
  node.onConfigure(); player.videoEl.onloadedmetadata(); player.cropToggleBtn.onclick();
  assert.equal(crop.type, 'converted-widget');
  assert.equal(crop.serializeValue(), 512);
  assert.equal(crop.value, 0);
  assert.equal(player.cropToggleBtn.disabled, true);
});
test('modal Advanced edits stay staged and apply all hidden settings together', () => {
  const { node, VFVideoScrubberModal } = environment();
  const modal = new VFVideoScrubberModal(node); modal.open();
  const input = modal.player.advancedInputs.fps;
  input.value = '30'; input.onchange();
  assert.equal(node.widgets.find(w => w.name === 'fps').value, 24);
  modal.applyToNode();
  assert.equal(node.widgets.find(w => w.name === 'fps').value, 30);
});
test('zoom anchors the playhead, fit restores the full clip, and zoom never edits node values', () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata(); player.videoEl.currentTime = 5;
  assert.ok(player.zoomInBtn, 'timeline needs zoom controls');
  const saved = node.widgets.slice(0,11).map(w=>w.value);
  player.zoomInBtn.onclick();
  assert.equal(player.timelineZoom, 2);
  assert.equal(player.timelineViewport.scrollLeft, 160);
  assert.equal(player.scrubberTrack.style.width, '200%');
  player.zoomOutBtn.onclick(); assert.equal(player.timelineZoom, 1);
  player.zoomInBtn.onclick(); player.fitTimelineBtn.onclick();
  assert.equal(player.timelineZoom, 1); assert.equal(player.timelineViewport.scrollLeft, 0);
  assert.deepEqual(node.widgets.slice(0,11).map(w=>w.value), saved);
});
test('zoomed and scrolled timeline coordinates work at canvas zoom', () => {
  const { node, window } = environment(); const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata(); player.videoEl.currentTime = 5;
  assert.ok(player.zoomInBtn); player.zoomInBtn.onclick();
  player.scrubberTrack.getBoundingClientRect = () => ({ left:-80, width:320 });
  player.scrubberTrack.onclick({clientX:80}); assert.equal(player.videoEl.currentTime, 5);
  dragBar(player, window, 'out', 16, 112);
  assert.equal(node.widgets.find(w=>w.name==='segment_duration').value, 5);
});
test('frame offset is removed from Advanced without resetting existing values', () => {
  const { node } = environment(); const player = node._vfVideoScrubber;
  assert.equal(player.advancedInputs.current_frame_offset, undefined);
  const offset=node.widgets.find(w=>w.name==='current_frame_offset'); offset.value=17;
  node.onConfigure(); assert.equal(offset.value, 17);
  assert.equal(player.setStartBtn, undefined); assert.equal(player.setEndBtn, undefined);
});
test('grabbing a trim bar off-center does not jump its time', () => {
  const {node,window}=environment(); const player=node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();
  dragBar(player,window,'in',20,36);
  assert.equal(node.widgets.find(w=>w.name==='start_time').value,2);
});
test('trim bars honor clip bounds, minimum duration, maximum duration, and connected inputs', () => {
  const {node,window}=environment(); const player=node._vfVideoScrubber;
  player.videoEl.duration=1000; player.videoEl.onloadedmetadata();
  dragBar(player,window,'out',.48,160);
  assert.equal(player.state.segment_duration,600);
  node.inputs=[{name:'segment_duration',link:1}]; node.onConfigure();
  const before=player.state.segment_duration;
  assert.equal(player.timelineHandles.in.disabled,true);
  player.timelineHandles.out.onpointerdown(pointer(80));
  assert.equal(player.state.segment_duration,before);
});
test('timeline drag listeners are released on node removal and file changes preserve zoom controls', () => {
  const {node,window}=environment(); const player=node._vfVideoScrubber;
  player.videoEl.onloadedmetadata(); player.zoomInBtn.onclick();
  player.timelineHandles.out.onpointerdown(pointer(48));
  node.onRemoved(); assert.equal(window.listeners.has('pointermove'),false);
  const {node:other}=environment(), preview=other._vfVideoScrubber;
  preview.videoEl.onloadedmetadata(); preview.zoomInBtn.onclick();
  const path=other.widgets.find(w=>w.name==='video_path'); path.value='next.mp4'; path.callback(path.value);
  assert.equal(preview.timelineZoom,2);
});
test('pointer capture, window capture listeners, and button release stop timeline handle dragging outside node', () => {
  const { node, window } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // Test 1: In-handle with pointer capture and buttons: 0 release
  let capturedId = null;
  let releasedId = null;
  const inHandle = player.timelineHandles.in;
  inHandle.setPointerCapture = id => { capturedId = id; };
  inHandle.releasePointerCapture = id => { releasedId = id; };
  inHandle.hasPointerCapture = id => capturedId === id;

  inHandle.onpointerdown({
    pointerId: 42,
    clientX: 16,
    target: inHandle,
    stopPropagation() {},
    preventDefault() {},
  });

  assert.equal(capturedId, 42, 'handle should acquire pointer capture on pointerdown');
  assert.equal(window.listenerOptions.get('pointerup'), true, 'pointerup must use capture phase to beat canvas stopPropagation');
  assert.equal(window.listenerOptions.get('pointermove'), true, 'pointermove must use capture phase');
  assert.equal(window.listenerOptions.get('mouseup'), true, 'mouseup must use capture phase');
  assert.equal(window.listeners.has('pointermove'), true);

  // Moving pointer with buttons === 0 (mouse released outside without pointerup reaching bubble listener)
  window.listeners.get('pointermove')({ clientX: 200, buttons: 0 });
  assert.equal(window.listeners.has('pointermove'), false, 'moving pointer without button held must stop drag');
  assert.equal(releasedId, 42, 'pointer capture must be released on stopDrag');

  // Test 2: Out-handle released via pointerup
  capturedId = null;
  releasedId = null;
  const outHandle = player.timelineHandles.out;
  outHandle.setPointerCapture = id => { capturedId = id; };
  outHandle.releasePointerCapture = id => { releasedId = id; };
  outHandle.hasPointerCapture = id => capturedId === id;

  outHandle.onpointerdown({
    pointerId: 99,
    clientX: 80,
    target: outHandle,
    stopPropagation() {},
    preventDefault() {},
  });

  assert.equal(capturedId, 99, 'out handle should acquire pointer capture');
  assert.equal(window.listeners.has('pointermove'), true);
  window.listeners.get('pointerup')();
  assert.equal(window.listeners.has('pointermove'), false, 'pointerup must stop drag');
  assert.equal(releasedId, 99, 'out handle pointer capture released on pointerup');

  // Test 3: Lost pointer capture event stops drag
  outHandle.onpointerdown({
    pointerId: 101,
    clientX: 80,
    target: outHandle,
    stopPropagation() {},
    preventDefault() {},
  });
  assert.equal(window.listeners.has('pointermove'), true);
  assert.ok(outHandle.listeners.has('lostpointercapture'), 'target must listen to lostpointercapture');
  outHandle.listeners.get('lostpointercapture')();
  assert.equal(window.listeners.has('pointermove'), false, 'lostpointercapture must stop drag');
});

test('FPS and Resized output size fields sit in button row with tooltips, px suffix, and auto-populate FPS', async () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // 1. Verify inputs exist in advancedInputs and playback_speed is removed
  assert.ok(player.advancedInputs.longest_side, 'longest_side input should exist');
  assert.ok(player.advancedInputs.fps, 'fps input should exist');
  assert.equal(player.advancedInputs.playback_speed, undefined, 'playback_speed input should be removed');

  // 2. Verify labels and tooltips
  const longestInput = player.advancedInputs.longest_side;
  const fpsInput = player.advancedInputs.fps;
  assert.equal(longestInput.getAttribute('aria-label'), 'Resize to');
  assert.match(longestInput.title, /longest dimension/i);
  assert.match(fpsInput.title, /frames per second/i);
  assert.equal(longestInput.style.width, '68px');
  assert.equal(fpsInput.style.width, '54px');

  // 3. Verify initial video selection populates video's FPS
  const pathWidget = node.widgets.find(w => w.name === 'video_path');
  const fpsWidget = node.widgets.find(w => w.name === 'fps');

  pathWidget.value = 'sixty_fps.mp4';
  pathWidget.callback(pathWidget.value);
  // Wait for async fetchVideoFps to complete
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fpsWidget.value, 60, 'initial file selection should populate detected FPS (60)');
  assert.equal(fpsInput.value, 60);

  // 4. Honor user's manual change
  fpsInput.value = '48';
  fpsInput.onchange();
  assert.equal(fpsWidget.value, 48, 'user manual change to 48 should be written');
  assert.equal(player.state.fps, 48);

  // 5. Changing other properties (e.g. start_time, crop) does NOT overwrite FPS
  player.change({ start_time: 2 });
  assert.equal(fpsWidget.value, 48, 'changing timeline does not overwrite FPS');

  // 6. Only update FPS when a NEW file is selected
  pathWidget.value = 'thirty_fps.mp4';
  pathWidget.callback(pathWidget.value);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fpsWidget.value, 30, 'selecting new file updates to new video FPS (30)');
  assert.equal(fpsInput.value, 30);
});

test('player only plays the selected section and pauses upon reaching out-point', async () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // In-point is 1s, duration is 2s -> out-point is 3s
  assert.equal(player.state.start_time, 1);
  assert.equal(player.state.segment_duration, 2);
  const bounds = player.segmentBounds();
  assert.equal(bounds.inPoint, 1);
  assert.equal(bounds.outPoint, 3);

  // Case 1: playhead starts at 0 (before in-point 1s)
  player.videoEl.currentTime = 0;
  await player.playBtn.onclick();
  assert.equal(player.videoEl.currentTime, 1, 'clicking play before in-point seeks to in-point');
  assert.equal(player.videoEl.paused, false, 'video starts playing');

  // Case 2: advancing playback within segment stays playing
  player.videoEl.currentTime = 2.5;
  player.videoEl.ontimeupdate?.();
  assert.equal(player.videoEl.paused, false, 'video continues playing inside segment');

  // Case 3: reaching or exceeding out-point pauses video at out-point
  player.videoEl.currentTime = 3.2;
  player.videoEl.ontimeupdate?.();
  assert.equal(player.videoEl.paused, true, 'reaching out-point pauses video');
  assert.equal(player.videoEl.currentTime, 3, 'clamps playhead to out-point on pause');
  assert.equal(player.playBtn.textContent, '▶ Play', 'play button resets to Play');

  // Case 4: clicking play when at out-point restarts from in-point
  await player.playBtn.onclick();
  assert.equal(player.videoEl.currentTime, 1, 'clicking play at out-point restarts from in-point');
  assert.equal(player.videoEl.paused, false);

  // Case 5: manual pause within segment resumes from current position
  player.videoEl.currentTime = 1.8;
  await player.playBtn.onclick(); // pause
  assert.equal(player.videoEl.paused, true);
  assert.equal(player.videoEl.currentTime, 1.8);

  await player.playBtn.onclick(); // resume
  assert.equal(player.videoEl.paused, false);
  assert.equal(player.videoEl.currentTime, 1.8, 'resumes from 1.8s without jumping to in-point');

  // Case 6: scrubbing outside selection (e.g. to 7s) and clicking play jumps to in-point
  player.videoEl.pause();
  player.scrubberTrack.onclick({ clientX: 112 }); // 70% of 160 width = 7s
  assert.equal(player.videoEl.currentTime, 7, 'manual scrubbing outside selection is allowed');
  await player.playBtn.onclick();
  assert.equal(player.videoEl.currentTime, 1, 'clicking play outside selection jumps to in-point');
  assert.equal(player.videoEl.paused, false);
});

test('requestAnimationFrame loop monitors playback and halts at out-point with cleanup on dispose', async () => {
  const { node, stepRaf } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // In 1s, Out 3s
  player.videoEl.currentTime = 1;
  await player.playBtn.onclick();
  assert.equal(player.videoEl.paused, false);

  // Advancing inside segment
  player.videoEl.currentTime = 2.0;
  stepRaf();
  assert.equal(player.videoEl.paused, false);

  // Advancing past out-point triggers pause and clamps
  player.videoEl.currentTime = 3.05;
  stepRaf();
  assert.equal(player.videoEl.paused, true, 'RAF detects out-point and pauses');
  assert.equal(player.videoEl.currentTime, 3, 'clamped to out-point');
  assert.equal(player.playBtn.textContent, '▶ Play');

  // Dispose cleans up any active monitoring
  await player.playBtn.onclick(); // play again (starts at 1s)
  assert.equal(player.videoEl.paused, false);
  player.dispose();
  assert.equal(player.videoEl.paused, true);
  assert.equal(player._playbackRaf, null);
});

test('once playback gets to the end, clicking play restarts from the starting position even with timestamp rounding or ended event', async () => {
  const { node, stepRaf } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // In 1s, Out 3s
  assert.equal(player.state.start_time, 1);
  assert.equal(player.state.segment_duration, 2);

  // Play until end of segment
  player.videoEl.currentTime = 1;
  await player.playBtn.onclick();
  assert.equal(player.videoEl.paused, false);

  player.videoEl.currentTime = 3.01;
  stepRaf();
  assert.equal(player.videoEl.paused, true, 'reaches end and pauses');

  // Simulate browser decoder keyframe/timestamp rounding (e.g. 2.97s instead of exact 3.00s)
  player.videoEl.currentTime = 2.97;
  await player.playBtn.onclick();
  assert.equal(player.videoEl.currentTime, 1, 'clicking play when stopped at end restarts from in-point (1s)');
  assert.equal(player.videoEl.paused, false);

  // Test with videoEl.ended event (physical end of video stream)
  player.videoEl.ended = true;
  player.videoEl.currentTime = 10;
  player.videoEl.onended();
  assert.equal(player.playBtn.textContent, '▶ Play');

  await player.playBtn.onclick();
  assert.equal(player.videoEl.currentTime, 1, 'clicking play after video ended restarts from in-point (1s)');
  assert.equal(player.videoEl.paused, false);
});

test('status displays crop dimensions taking into account the Resized value', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  // Video is 1920x1080, duration 10
  player.videoEl.onloadedmetadata();

  // Baseline uncropped, no resize (longest_side = 0)
  assert.match(player.status.textContent, /1920 × 1080/);

  // Enable crop: 960x540
  player.change({ crop_x: 100, crop_y: 100, crop_width: 960, crop_height: 540 });
  assert.match(player.status.textContent, /Crop: 960 × 540/);

  // Apply resize (longest_side = 480):
  // Longest of (960, 540) is 960 -> scale = 480 / 960 = 0.5 -> 480x270
  player.change({ longest_side: 480 });
  assert.match(player.status.textContent, /Crop: 480 × 270/);

  // Disable crop: width & height 0
  player.change({ crop_width: 0, crop_height: 0 });
  // Longest of (1920, 1080) is 1920 -> scale = 480 / 1920 = 0.25 -> 480x270
  assert.match(player.status.textContent, /480 × 270/);
  assert.doesNotMatch(player.status.textContent, /Crop:/);
});

test('player has volume control and mute toggle', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  assert.ok(player.muteBtn, 'mute button should exist');
  assert.ok(player.volumeSlider, 'volume slider should exist');

  // Initial state: unmuted, volume = 1
  assert.equal(player.muteBtn.textContent, '🔊');
  assert.equal(player.videoEl.muted, false);
  assert.equal(player.videoEl.volume, 1);

  // Adjust volume via slider to 0.5
  player.volumeSlider.value = '0.5';
  player.volumeSlider.oninput();
  assert.equal(player.videoEl.volume, 0.5);
  assert.equal(player.videoEl.muted, false);
  assert.equal(player.muteBtn.textContent, '🔊');

  // Toggle mute
  player.muteBtn.onclick();
  assert.equal(player.videoEl.muted, true);
  assert.equal(player.muteBtn.textContent, '🔇');

  // Toggle unmute restores volume 0.5
  player.muteBtn.onclick();
  assert.equal(player.videoEl.muted, false);
  assert.equal(player.videoEl.volume, 0.5);
  assert.equal(player.muteBtn.textContent, '🔊');

  // Setting slider to 0 mutes
  player.volumeSlider.value = '0';
  player.volumeSlider.oninput();
  assert.equal(player.videoEl.muted, true);
  assert.equal(player.muteBtn.textContent, '🔇');

  // Moving slider up unmutes
  player.volumeSlider.value = '0.8';
  player.volumeSlider.oninput();
  assert.equal(player.videoEl.muted, false);
  assert.equal(player.videoEl.volume, 0.8);
  assert.equal(player.muteBtn.textContent, '🔊');
});

test('play button maintains a fixed width so button state does not shift controls row', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  assert.equal(player.playBtn.style.width, '74px');
});

test('selection label displays total duration of the selected scrubber range', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // In 1s, duration 2s (out 3s)
  player.change({ start_time: 1, segment_duration: 2 });
  assert.match(player.selectionLabel.textContent, /Total Duration: 2\.00s/);
  assert.match(player.selectionLabel.textContent, /In 1\.00s → Out 3\.00s/);

  // Change duration to 4.5s
  player.change({ segment_duration: 4.5 });
  assert.match(player.selectionLabel.textContent, /Total Duration: 4\.50s/);
  assert.match(player.selectionLabel.textContent, /In 1\.00s → Out 5\.50s/);
});

test('node does not include Open Interactive Video Scrubber button', () => {
  const { node } = environment();
  const buttons = node.widgets.filter(w => w.type === 'button');
  const scrubberBtn = buttons.find(b => b.name?.includes('Open Interactive Video Scrubber'));
  assert.equal(scrubberBtn, undefined, 'Open Interactive Video Scrubber button should be removed');
  const browseBtn = buttons.find(b => b.name?.includes('Browse Videos'));
  assert.ok(browseBtn, 'Browse Videos button should remain');
});

test('status bar shows question mark icon and tooltip next to dimensions when Resize to is not 0', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // 1. Initial full video, longest_side = 0: help icon hidden
  assert.equal(player.cropResizeHelp.style.display, 'none');

  // 2. Uncropped video (crop_width = 0, crop_height = 0) with longest_side = 366
  player.change({ crop_width: 0, crop_height: 0, longest_side: 366 });
  assert.equal(player.cropResizeHelp.style.display, 'inline-flex');
  assert.match(player.cropResizeHelp.title, /Output resolution: 366 × 206px/);
  assert.match(player.cropResizeHelp.title, /original video \(1920 × 1080px\)/);
  assert.match(player.cropResizeHelp.title, /'Resize to' longest side \(366px\)/);

  // 3. Crop active (960x540) but longest_side = 0: help icon hidden
  player.change({ crop_width: 960, crop_height: 540, longest_side: 0 });
  assert.equal(player.cropResizeHelp.style.display, 'none');

  // 4. Crop active AND longest_side = 480: help icon visible with explanatory tooltip for crop
  player.change({ longest_side: 480 });
  assert.equal(player.cropResizeHelp.style.display, 'inline-flex');
  assert.match(player.cropResizeHelp.title, /Output resolution: 480 × 270px/);
  assert.match(player.cropResizeHelp.title, /source crop \(960 × 540px\)/);
  assert.match(player.cropResizeHelp.title, /'Resize to' longest side \(480px\)/);

  // 5. Change longest_side to 0: help icon hidden again
  player.change({ longest_side: 0 });
  assert.equal(player.cropResizeHelp.style.display, 'none');

  // 6. Set longest_side back to 320: help icon reappears with updated calculation
  player.change({ longest_side: 320 });
  assert.equal(player.cropResizeHelp.style.display, 'inline-flex');
  assert.match(player.cropResizeHelp.title, /Output resolution: 320 × 180px/);
  assert.match(player.cropResizeHelp.title, /source crop \(960 × 540px\)/);
});

test('scrubber defaults to span entire length of current video after selecting a different video file', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  const startWidget = node.widgets.find(w => w.name === 'start_time');
  const durationWidget = node.widgets.find(w => w.name === 'segment_duration');
  const pathWidget = node.widgets.find(w => w.name === 'video_path');

  // 1. Initial creation / workflow restore keeps initial in-point and duration
  assert.equal(startWidget.value, 1);
  assert.equal(durationWidget.value, 2);
  player.videoEl.duration = 15;
  player.videoEl.onloadedmetadata();
  assert.equal(startWidget.value, 1);
  assert.equal(durationWidget.value, 2);

  // 2. Workflow configure (onConfigure) also preserves values
  pathWidget.value = 'workflow_video.mp4';
  startWidget.value = 3.5;
  durationWidget.value = 4.2;
  node.onConfigure();
  player.videoEl.duration = 20;
  player.videoEl.onloadedmetadata();
  assert.equal(startWidget.value, 3.5);
  assert.equal(durationWidget.value, 4.2);

  // 3. User selects a different video file -> scrubber resets to span entire duration
  pathWidget.value = 'different_video.mp4';
  pathWidget.callback('different_video.mp4');
  player.videoEl.duration = 18.75;
  player.videoEl.onloadedmetadata();

  assert.equal(startWidget.value, 0);
  assert.equal(durationWidget.value, 18.75);
  assert.equal(player.state.start_time, 0);
  assert.equal(player.state.segment_duration, 18.75);
  assert.match(player.selectionLabel.textContent, /In 0\.00s → Out 18\.75s · Total Duration: 18\.75s/);

  // 4. User selects another video longer than 600s -> duration is clamped to 600s
  pathWidget.value = 'long_video.mp4';
  pathWidget.callback('long_video.mp4');
  player.videoEl.duration = 900;
  player.videoEl.onloadedmetadata();

  assert.equal(startWidget.value, 0);
  assert.equal(durationWidget.value, 600);
  assert.equal(player.state.start_time, 0);
  assert.equal(player.state.segment_duration, 600);

  // 5. If segment_duration socket is linked, it does not overwrite the linked widget
  node.inputs = [{ name: 'segment_duration', link: 99, widget: { name: 'segment_duration' } }];
  pathWidget.value = 'linked_test.mp4';
  pathWidget.callback('linked_test.mp4');
  durationWidget.value = 5.0; // custom input value
  player.videoEl.duration = 25;
  player.videoEl.onloadedmetadata();

  assert.equal(startWidget.value, 0);
  assert.equal(durationWidget.value, 5.0); // preserved because linked
});

test('after selection of a new video file, it resets all video settings except zoom controls, audio settings, and crop', () => {
  const { node } = environment();
  const player = node._vfVideoScrubber;
  player.videoEl.onloadedmetadata();

  // Set custom video settings
  player.change({
    start_time: 4.5,
    segment_duration: 3.0,
    longest_side: 720,
    playback_speed: 1.5,
    current_frame_offset: 12,
    crop_x: 100,
    crop_y: 50,
    crop_width: 800,
    crop_height: 600,
  });

  // Set zoom controls and audio settings
  player.zoomInBtn.onclick(); // zoom to 2x
  assert.equal(player.timelineZoom, 2);
  player.volumeSlider.value = '0.35';
  player.volumeSlider.oninput();
  player.muteBtn.onclick(); // mute
  assert.equal(player.videoEl.muted, true);
  assert.equal(player.videoEl.volume, 0.35);

  // Now select a new video file
  const pathWidget = node.widgets.find(w => w.name === 'video_path');
  pathWidget.value = 'another_clip.mp4';
  pathWidget.callback(pathWidget.value);

  // Load new video metadata with duration 22s
  player.videoEl.duration = 22.0;
  player.videoEl.onloadedmetadata();

  // 1. Timeline trim, speed, and offset ARE RESET:
  assert.equal(node.widgets.find(w => w.name === 'start_time').value, 0);
  assert.equal(node.widgets.find(w => w.name === 'segment_duration').value, 22.0);
  assert.equal(node.widgets.find(w => w.name === 'playback_speed').value, 1.0);
  assert.equal(node.widgets.find(w => w.name === 'current_frame_offset').value, 0);
  assert.equal(player.state.start_time, 0);
  assert.equal(player.state.segment_duration, 22.0);
  assert.equal(player.state.playback_speed, 1.0);
  assert.equal(player.state.current_frame_offset, 0);

  // 2. Resize to (longest_side) IS RETAINED:
  assert.equal(node.widgets.find(w => w.name === 'longest_side').value, 720);
  assert.equal(player.state.longest_side, 720);

  // 3. Crop IS PRESERVED ("actually, not the crop"):
  assert.equal(node.widgets.find(w => w.name === 'crop_x').value, 100);
  assert.equal(node.widgets.find(w => w.name === 'crop_y').value, 50);
  assert.equal(node.widgets.find(w => w.name === 'crop_width').value, 800);
  assert.equal(node.widgets.find(w => w.name === 'crop_height').value, 600);
  assert.equal(player.state.crop_x, 100);
  assert.equal(player.state.crop_y, 50);
  assert.equal(player.state.crop_width, 800);
  assert.equal(player.state.crop_height, 600);
  assert.equal(player.cropActive, true);

  // 4. Zoom controls ARE PRESERVED ("except for the zoom controls"):
  assert.equal(player.timelineZoom, 2);

  // 5. Audio settings ARE PRESERVED ("and the audio settings"):
  assert.equal(player.videoEl.volume, 0.35);
  assert.equal(player.videoEl.muted, true);
});












