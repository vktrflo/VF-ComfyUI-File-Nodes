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
  }
  appendChild(el) { this.children.push(el); return el; }
  append(...els) { els.forEach(el => this.appendChild(el)); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 160, height: 90 }; }
  setAttribute() {}
  removeAttribute() {}
  load() {}
  pause() { this.paused = true; this.onpause?.(); }
  play() { this.paused = false; this.onplay?.(); return Promise.resolve(); }
  closest() { return null; }
}
function environment() {
  const window = new Element('window');
  const context = vm.createContext({
    window, document: { createElement: tag => new Element(tag), body: new Element('body') },
    createElement: (tag, cls, text) => Object.assign(new Element(tag), { textContent: text }),
    makeModalBackdrop: () => ({ backdrop: new Element('backdrop'), close() {} }),
    openFileBrowserModal() {}, setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
    ResizeObserver: class { observe() {} disconnect() {} }, console,
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
  return { node, window, ...context.exports };
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
  assert.ok(player.advancedInputs, 'scrubber needs Advanced settings');
  player.advancedInputs.playback_speed.value = '2'; player.advancedInputs.playback_speed.onchange();
  assert.equal(node.widgets.find(w => w.name === 'playback_speed').value, 2);
  assert.equal(player.videoEl.playbackRate, 2);
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
test('timeline drag listeners are released on node removal and file changes reset zoom', () => {
  const {node,window}=environment(); const player=node._vfVideoScrubber;
  player.videoEl.onloadedmetadata(); player.zoomInBtn.onclick();
  player.timelineHandles.out.onpointerdown(pointer(48));
  node.onRemoved(); assert.equal(window.listeners.has('pointermove'),false);
  const {node:other}=environment(), preview=other._vfVideoScrubber;
  preview.videoEl.onloadedmetadata(); preview.zoomInBtn.onclick();
  const path=other.widgets.find(w=>w.name==='video_path'); path.value='next.mp4'; path.callback(path.value);
  assert.equal(preview.timelineZoom,1); assert.equal(preview.timelineViewport.scrollLeft,0);
});
