/** Shared inline and modal video scrubber for VF Load Video. */
import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement, makeModalBackdrop } from "./vf_ui_shared.js";

const MIN_WIDTH = 320;
const PANEL_HEIGHT = 300;
const FIELDS = ["video_path", "start_time", "segment_duration", "current_frame_offset", "playback_speed", "fps", "longest_side", "crop_x", "crop_y", "crop_width", "crop_height"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const widget = (node, name) => node.widgets?.find(w => w.name === name);
const isLinked = (node, name) => Boolean(node?.inputs?.some(input =>
  (input.widget?.name === name || input.name === name) && input.link != null));
function hideScrubberWidgets(node) {
  for (const name of FIELDS) {
    if (name === "video_path") continue;
    const w = widget(node, name);
    // Keep converted widgets intact: ComfyUI manages their input sockets and serialization.
    if (!w || w.type?.startsWith("converted-widget")) continue;
    w.type = "hidden";
    w.computeSize = () => [0, -4];
    w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0 });
  }
}
const readState = node => Object.fromEntries(FIELDS.map(name => [name, widget(node, name)?.value]));
function writeState(node, values) {
  // Set the entire crop before notifying callbacks, so observers never see a partial edit.
  for (const [name, value] of Object.entries(values)) {
    const w = widget(node, name);
    if (w && !isLinked(node, name)) w.value = value;
  }
  for (const [name, value] of Object.entries(values)) if (!isLinked(node, name)) widget(node, name)?.callback?.(value);
  node.setDirtyCanvas(true, true);
}
function styled(tag, styles, text = "") {
  const el = createElement(tag, "", text);
  Object.assign(el.style, styles);
  return el;
}

export function setupLoadVideoNode(nodeType) {
  const created = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    this._vfVideoRemoved = false;
    this._vfVideoInitTimer = setTimeout(() => {
      if (this._vfVideoRemoved || this._vfVideoScrubber) return;
      hideScrubberWidgets(this);
      const path = widget(this, "video_path");
      this.addWidget("button", "📁 Browse Videos", null, () => openFileBrowserModal(this, path, { filter: "video" }), { serialize: false });
      const player = new VFVideoScrubber(readState(this), values => writeState(this, values));
      player.node = this;
      this._vfVideoScrubber = player;
      const dom = this.addDOMWidget("video_scrubber", "preview", player.root, {
        serialize: false, hideOnZoom: false, getMinHeight: () => player.minHeight,
      });
      dom.computeLayoutSize = () => ({ minHeight: player.minHeight, minWidth: MIN_WIDTH, maxHeight: undefined });
      this.addWidget("button", "🎬 Open Interactive Video Scrubber", null, () => {
        this._vfVideoModal?.dispose();
        player.videoEl.pause();
        this._vfVideoModal = new VFVideoScrubberModal(this);
        this._vfVideoModal.open();
      }, { serialize: false });
      for (const name of FIELDS) {
        const w = widget(this, name);
        if (!w) continue;
        const callback = w.callback;
        w.callback = function () {
          const result = callback?.apply(this, arguments);
          player.update(readState(player.node));
          return result;
        };
      }
      this._vfRefreshVideo = () => { hideScrubberWidgets(this); player.update(readState(this)); };
      this._vfRefreshVideo();
      const height = Math.max(this.size?.[1] || 0, this.computeSize?.()[1] || 440);
      this.setSize?.([Math.max(this.size?.[0] || 0, MIN_WIDTH), height]);
      this.setDirtyCanvas(true, true);
    }, 10);
    return result;
  };
  for (const name of ["onConfigure", "onResize"]) {
    const original = nodeType.prototype[name];
    nodeType.prototype[name] = function () {
      const result = original?.apply(this, arguments);
      if (this.size) this.size[0] = Math.max(this.size[0], MIN_WIDTH);
      this._vfRefreshVideo?.();
      this._vfVideoScrubber?.updateLayout();
      this._vfVideoScrubber?.syncCropBoxToVideo();
      return result;
    };
  }
  const removed = nodeType.prototype.onRemoved;
  nodeType.prototype.onRemoved = function () {
    this._vfVideoRemoved = true;
    clearTimeout(this._vfVideoInitTimer);
    this._vfVideoModal?.dispose();
    this._vfVideoScrubber?.dispose();
    return removed?.apply(this, arguments);
  };
}

export class VFVideoScrubber {
  constructor(state, onChange, { modal = false } = {}) {
    this.modal = modal;
    this.minHeight = PANEL_HEIGHT;
    this.timelineZoom = 1;
    this.state = {}; this.onChange = onChange; this.duration = 0; this.ready = false;
    this.root = styled("div", { width: "100%", height: modal ? "auto" : "100%", minHeight: `${PANEL_HEIGHT}px`, boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden", background: "#181820", color: "#ddd", border: "1px solid #333342", borderRadius: "6px", fontFamily: "system-ui, sans-serif" });
    this.playerWrapper = styled("div", { position: "relative", width: "100%", flex: "1 1 0", minHeight: "180px", height: modal ? "460px" : "auto", background: "#101014", overflow: "hidden" });
    if (modal) this.playerWrapper.style.flex = "none";
    this.videoEl = styled("video", { position: "absolute", width: "100%", height: "100%", objectFit: "contain" });
    this.videoEl.preload = "metadata";
    this.videoEl.playsInline = true;
    this.cropOverlay = styled("div", { position: "absolute", boxSizing: "border-box", border: "2px dashed #00aaff", background: "rgba(0,170,255,.15)", cursor: "move", touchAction: "none", display: "none" });
    this.playerWrapper.append(this.videoEl, this.cropOverlay);
    const controls = styled("div", { padding: "8px", display: "flex", flexDirection: "column", gap: "8px", flexShrink: "0" });
    this.controls = controls;
    this.status = styled("div", { fontSize: "11px", color: "#aaa" });
    this.status.setAttribute("aria-live", "polite");
    this.timelineViewport = styled("div", { width: "100%", overflowX: "auto", overflowY: "hidden", borderRadius: "4px", scrollbarWidth: "thin" });
    this.timelineViewport.title = "Drag the in/out bars to trim. Scroll horizontally when zoomed.";
    this.scrubberTrack = styled("div", { position: "relative", width: "100%", height: "32px", background: "#2a2a38", cursor: "pointer", overflow: "hidden", touchAction: "none" });
    this.scrubberTrack.setAttribute("role", "group");
    this.scrubberTrack.setAttribute("aria-label", "Video timeline");
    this.segmentBar = styled("div", { position: "absolute", top: "0", bottom: "0", background: "rgba(0,102,204,.5)", borderLeft: "2px solid #0088ff", borderRight: "2px solid #0088ff", pointerEvents: "none" });
    this.playhead = styled("div", { position: "absolute", top: "0", bottom: "0", width: "3px", background: "#ffcc00", pointerEvents: "none" });
    this.playhead.tabIndex = 0;
    this.playhead.setAttribute("role", "slider");
    this.playhead.setAttribute("aria-label", "Video position");
    this.scrubberTrack.append(this.segmentBar, this.playhead);
    this.timelineViewport.appendChild(this.scrubberTrack);
    const row = styled("div", { display: "flex", flexWrap: "wrap", gap: "6px" });
    const button = text => styled("button", { background: "#2a2a3a", color: "#ddd", border: "1px solid #444", borderRadius: "4px", padding: "5px 8px", cursor: "pointer", fontSize: "12px" }, text);
    this.playBtn = button("▶ Play"); this.cropToggleBtn = button("Enable Crop");
    row.append(this.playBtn, this.cropToggleBtn);
    const timelineTools = styled("div", { display: "flex", alignItems: "center", gap: "5px" });
    this.timelineRangeLabel = styled("div", { flex: "1", minWidth: "0", color: "#aaa", fontSize: "10px", fontVariantNumeric: "tabular-nums" });
    this.zoomOutBtn = button("−"); this.zoomInBtn = button("+"); this.fitTimelineBtn = button("Fit");
    for (const [control, label] of [[this.zoomOutBtn, "Zoom timeline out"], [this.zoomInBtn, "Zoom timeline in"], [this.fitTimelineBtn, "Fit full video on timeline"]]) {
      control.title = label; control.setAttribute("aria-label", label);
    }
    this.zoomOutBtn.onclick = () => this.zoomTimeline(this.timelineZoom / 2);
    this.zoomInBtn.onclick = () => this.zoomTimeline(this.timelineZoom * 2);
    this.fitTimelineBtn.onclick = () => this.zoomTimeline(1);
    timelineTools.append(this.timelineRangeLabel, this.zoomOutBtn, this.zoomInBtn, this.fitTimelineBtn);
    this.timelineViewport.onscroll = () => this.updateTimelineRange();
    this.timelineHandles = {};
    for (const which of ["in", "out"]) {
      const handle = styled("div", { position: "absolute", top: "0", bottom: "0", width: "12px", background: "#0088cc", border: "1px solid #8bd9ff", boxSizing: "border-box", cursor: "ew-resize", transform: "translateX(-50%)", zIndex: "3", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "10px", fontWeight: "bold", touchAction: "none" }, which === "in" ? "I" : "O");
      handle.tabIndex = 0; handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", which === "in" ? "Segment in-point" : "Segment out-point");
      handle.onclick = e => e.stopPropagation();
      handle.onpointerdown = e => {
        e.stopPropagation(); e.preventDefault();
        if (handle.disabled) return;
        this.videoEl.pause();
        const grabbedTime = this.timelineTimeAtPointer(e.clientX, false);
        const originalTime = Number(this.state.start_time) + (which === "out" ? Number(this.state.segment_duration) : 0);
        this.startDrag(ev => this.moveTimelineHandle(which, originalTime + this.timelineTimeAtPointer(ev.clientX, false) - grabbedTime));
      };
      handle.onkeydown = e => {
        e.stopPropagation();
        if (handle.disabled || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
        e.preventDefault();
        const time = Number(this.state.start_time) + (which === "out" ? Number(this.state.segment_duration) : 0);
        this.moveTimelineHandle(which, time + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : .01));
      };
      this.timelineHandles[which] = handle; this.scrubberTrack.appendChild(handle);
    }
    this.selectionLabel = styled("div", { fontSize: "11px", color: "#8bc8eb", fontVariantNumeric: "tabular-nums" });
    const advanced = styled("details", { fontSize: "11px", color: "#aaa" });
    const summary = styled("summary", { cursor: "pointer", padding: "3px 0" }, "Advanced");
    const advancedRow = styled("div", { display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "6px" });
    this.advancedInputs = {};
    const settings = [
      ["longest_side", "Longest side", 0, 16384, 1],
      ["fps", "Fallback FPS", 1, 120, 1],
      ["playback_speed", "Preview speed", .1, 4, .05],
    ];
    for (const [name, label, min, max, step] of settings) {
      const field = styled("label", { display: "flex", flexDirection: "column", gap: "3px", flex: "1 1 80px" }, label);
      const input = styled("input", { width: "100%", minWidth: "0", boxSizing: "border-box", padding: "4px 6px", background: "#101014", color: "#ddd", border: "1px solid #444", borderRadius: "3px" });
      input.type = "number"; input.min = min; input.max = max; input.step = step;
      input.setAttribute("aria-label", label);
      input.onchange = () => {
        const value = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(value) || isLinked(this.node, name)) { this.refresh(); return; }
        this.change({ [name]: clamp(name === "longest_side" ? Math.round(value) : value, min, max) });
      };
      this.advancedInputs[name] = input;
      field.appendChild(input); advancedRow.appendChild(field);
    }
    advanced.append(summary, advancedRow);
    advanced.ontoggle = () => this.updateLayout();
    controls.append(this.status, this.timelineViewport, timelineTools, this.selectionLabel, row, advanced);
    this.root.append(this.playerWrapper, controls);
    // Keep embedded interactions from moving/selecting the graph node.
    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) this.root.addEventListener(type, e => e.stopPropagation());
    this.playBtn.onclick = async () => {
      if (!this.ready) return;
      if (!this.videoEl.paused) { this.videoEl.pause(); return; }
      try { await this.videoEl.play(); } catch { this.status.textContent = "Unable to play this video in the browser."; }
    };
    this.videoEl.onplay = () => { this.playBtn.textContent = "⏸ Pause"; };
    this.videoEl.onpause = this.videoEl.onended = () => { this.playBtn.textContent = "▶ Play"; };
    this.cropToggleBtn.onclick = () => {
      if (!this.ready || this.cropLinked()) return;
      this.change(this.cropActive ? { crop_x: 0, crop_y: 0, crop_width: 0, crop_height: 0 } : {
        crop_x: Math.round(this.videoWidth * .1), crop_y: Math.round(this.videoHeight * .1),
        crop_width: Math.round(this.videoWidth * .8), crop_height: Math.round(this.videoHeight * .8),
      });
    };
    const seek = e => {
      if (!this.ready) return;
      this.videoEl.currentTime = this.timelineTimeAtPointer(e.clientX);
      this.updatePlayhead();
    };
    this.scrubberTrack.onclick = seek;
    this.scrubberTrack.onpointerdown = e => { if (this.ready) { e.preventDefault(); seek(e); this.startDrag(seek); } };
    this.scrubberTrack.onkeydown = e => {
      if (!this.ready || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      this.videoEl.currentTime = clamp(this.videoEl.currentTime + (e.key === "ArrowLeft" ? -1 : 1) / (Number(this.state.fps) || 24), 0, this.duration);
      this.updatePlayhead();
    };
    this.cropOverlay.onpointerdown = e => {
      e.stopPropagation(); e.preventDefault();
      if (!this.ready || this.cropLinked()) return;
      const x = e.clientX, y = e.clientY, cropX = this.state.crop_x, cropY = this.state.crop_y;
      this.startDrag(ev => {
        const bounds = this.videoBounds();
        const rect = this.playerWrapper.getBoundingClientRect();
        if (!bounds || !rect.width || !rect.height) return;
        // Client deltas include canvas zoom; convert to local pixels, then source pixels.
        const dx = (ev.clientX - x) * this.playerWrapper.clientWidth / rect.width / bounds.scale;
        const dy = (ev.clientY - y) * this.playerWrapper.clientHeight / rect.height / bounds.scale;
        this.change({ crop_x: clamp(Math.round(cropX + dx), 0, Math.max(0, this.videoWidth - this.state.crop_width)),
          crop_y: clamp(Math.round(cropY + dy), 0, Math.max(0, this.videoHeight - this.state.crop_height)) });
      });
    };
    this.cropHandles = {};
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = styled("div", { position: "absolute", width: "10px", height: "10px", background: "#00aaff", border: "1px solid #101014", boxSizing: "border-box", cursor: `${corner}-resize`, touchAction: "none",
        [corner.includes("n") ? "top" : "bottom"]: "-5px", [corner.includes("w") ? "left" : "right"]: "-5px" });
      handle.title = "Drag to resize crop";
      handle.onpointerdown = e => {
        e.stopPropagation(); e.preventDefault();
        if (!this.ready || this.cropLinked()) return;
        const bounds = this.videoBounds();
        if (!bounds) return;
        const minWidth = Math.min(16, this.videoWidth), minHeight = Math.min(16, this.videoHeight);
        const left = clamp(Number(this.state.crop_x), 0, this.videoWidth - minWidth);
        const top = clamp(Number(this.state.crop_y), 0, this.videoHeight - minHeight);
        const right = clamp(left + Number(this.state.crop_width), left + minWidth, this.videoWidth);
        const bottom = clamp(top + Number(this.state.crop_height), top + minHeight, this.videoHeight);
        const x = e.clientX, y = e.clientY;
        this.startDrag(ev => {
          const rect = this.playerWrapper.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const dx = Math.round((ev.clientX - x) * this.playerWrapper.clientWidth / rect.width / bounds.scale);
          const dy = Math.round((ev.clientY - y) * this.playerWrapper.clientHeight / rect.height / bounds.scale);
          const newLeft = corner.includes("w") ? clamp(left + dx, 0, right - minWidth) : left;
          const newTop = corner.includes("n") ? clamp(top + dy, 0, bottom - minHeight) : top;
          const newRight = corner.includes("e") ? clamp(right + dx, left + minWidth, this.videoWidth) : right;
          const newBottom = corner.includes("s") ? clamp(bottom + dy, top + minHeight, this.videoHeight) : bottom;
          this.change({ crop_x: newLeft, crop_y: newTop, crop_width: newRight - newLeft, crop_height: newBottom - newTop });
        });
      };
      this.cropHandles[corner] = handle; this.cropOverlay.appendChild(handle);
    }
    this.videoEl.onloadedmetadata = () => {
      if (this.disposed) return;
      this.duration = Number.isFinite(this.videoEl.duration) ? this.videoEl.duration : 0;
      this.videoWidth = this.videoEl.videoWidth; this.videoHeight = this.videoEl.videoHeight;
      this.ready = this.duration > 0 && this.videoWidth > 0 && this.videoHeight > 0;
      this.errorMessage = this.ready ? "" : "Unable to load video metadata.";
      this.videoEl.currentTime = clamp(Number(this.state.start_time) || 0, 0, this.duration);
      this.zoomTimeline(1);
      this.refresh();
    };
    this.videoEl.onerror = () => {
      if (this.disposed) return;
      this.ready = false;
      this.errorMessage = this.state.video_path ? "Unable to load video. Check the path and browser format support." : "";
      this.refresh();
    };
    this.videoEl.ontimeupdate = this.videoEl.onseeked = () => this.updatePlayhead();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => { this.updateLayout(); this.syncCropBoxToVideo(); this.updateTimelineRange(); });
      this.observer.observe(this.playerWrapper);
      this.observer.observe(this.controls);
    }
    this.update(state);
    this.updateLayout();
  }
  timelineTimeAtPointer(clientX, bounded = true) {
    const rect = this.scrubberTrack.getBoundingClientRect();
    const fraction = rect.width ? (clientX - rect.left) / rect.width : 0;
    return (bounded ? clamp(fraction, 0, 1) : fraction) * this.duration;
  }
  moveTimelineHandle(which, requestedTime) {
    if (!this.ready || this.timelineHandles[which].disabled) return;
    const start = clamp(Number(this.state.start_time) || 0, 0, this.duration);
    const end = clamp(start + Number(this.state.segment_duration), start, this.duration);
    const time = Math.round(requestedTime * 100) / 100;
    if (which === "in") {
      const newStart = clamp(time, Math.max(0, end - 600), Math.max(0, end - .1));
      this.change({ start_time: newStart, segment_duration: Number((end - newStart).toFixed(2)) });
      this.videoEl.currentTime = newStart;
    } else {
      const newEnd = clamp(time, start + .1, Math.min(this.duration, start + 600));
      this.change({ segment_duration: Number((newEnd - start).toFixed(2)) });
      this.videoEl.currentTime = newEnd;
    }
    this.updatePlayhead();
  }
  zoomTimeline(zoom) {
    if (!this.ready) return;
    const width = this.timelineViewport.clientWidth || 1;
    const scroll = this.timelineViewport.scrollLeft || 0;
    const playheadPixel = (this.videoEl.currentTime || 0) / this.duration * width * this.timelineZoom;
    const anchor = playheadPixel >= scroll && playheadPixel <= scroll + width ? playheadPixel : scroll + width / 2;
    const anchorRatio = anchor / (width * this.timelineZoom);
    const anchorOffset = anchor - scroll;
    this.timelineZoom = clamp(zoom, 1, Math.max(1, Math.min(1000, this.duration / .1)));
    this.scrubberTrack.style.width = `${this.timelineZoom * 100}%`;
    this.timelineViewport.scrollLeft = this.timelineZoom === 1 ? 0 : clamp(anchorRatio * width * this.timelineZoom - anchorOffset, 0, width * (this.timelineZoom - 1));
    this.updateTimelineRange();
  }
  updateTimelineRange() {
    const width = this.timelineViewport.clientWidth || 1;
    const start = clamp((this.timelineViewport.scrollLeft || 0) / (width * this.timelineZoom), 0, 1) * this.duration;
    const end = Math.min(this.duration, start + this.duration / this.timelineZoom);
    this.timelineRangeLabel.textContent = `${start.toFixed(2)}–${end.toFixed(2)}s · ${Number(this.timelineZoom.toFixed(1))}×`;
    this.zoomOutBtn.disabled = !this.ready || this.timelineZoom <= 1;
    this.zoomInBtn.disabled = !this.ready || this.timelineZoom >= Math.min(1000, this.duration / .1);
    this.fitTimelineBtn.disabled = !this.ready || this.timelineZoom === 1;
  }
  updateLayout() {
    if (this.modal) return;
    const vue = Boolean(window.LiteGraph?.vueNodesMode || this.root.closest?.("[data-node-id]") || this.root.closest?.(".lg-node"));
    const previousHeight = this.minHeight;
    this.minHeight = Math.max(PANEL_HEIGHT, Math.ceil(this.controls.scrollHeight || 0) + 182);
    this.root.style.minHeight = `${this.minHeight}px`;
    if (!vue && this.node && this.minHeight > previousHeight) {
      this.node.setSize?.([this.node.size[0], Math.max(this.node.computeSize?.()[1] || 0, this.node.size[1] + this.minHeight - previousHeight)]);
      this.node.setDirtyCanvas(true, true);
    }
    this.root.style.height = vue ? "auto" : "100%";
    this.playerWrapper.style.height = vue ? "220px" : "auto";
    this.playerWrapper.style.flex = vue ? "none" : "1 1 0";
  }
  cropLinked() { return ["crop_x", "crop_y", "crop_width", "crop_height"].some(name => isLinked(this.node, name)); }
  change(values) {
    Object.assign(this.state, values);
    this.videoEl.playbackRate = clamp(Number(this.state.playback_speed) || 1, .1, 4);
    this.refresh(); this.onChange?.(values);
  }
  update(state) {
    const changedPath = state.video_path !== this.state.video_path;
    const changedStart = state.start_time !== this.state.start_time;
    this.state = { ...state };
    if (changedPath) {
      this.errorMessage = "";
      this.stopDrag?.(); this.videoEl.pause(); this.ready = false; this.duration = 0;
      this.timelineZoom = 1; this.scrubberTrack.style.width = "100%"; this.timelineViewport.scrollLeft = 0;
      this.videoEl.removeAttribute("src");
      if (state.video_path) this.videoEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(state.video_path)}`;
      this.videoEl.load();
    }
    this.videoEl.playbackRate = clamp(Number(state.playback_speed) || 1, .1, 4);
    if (changedStart && this.ready) this.videoEl.currentTime = clamp(Number(state.start_time) || 0, 0, this.duration);
    this.refresh();
  }
  refresh() {
    this.cropActive = Number(this.state.crop_width) > 0 && Number(this.state.crop_height) > 0;
    this.cropToggleBtn.textContent = this.cropActive ? "Disable Crop" : "Enable Crop";
    for (const button of [this.playBtn, this.cropToggleBtn]) button.disabled = !this.ready;
    this.cropToggleBtn.disabled ||= this.cropLinked();
    this.cropOverlay.style.cursor = this.cropLinked() ? "default" : "move";
    for (const handle of Object.values(this.cropHandles)) handle.style.display = this.cropLinked() ? "none" : "block";
    for (const [name, input] of Object.entries(this.advancedInputs)) {
      input.value = this.state[name] ?? "";
      input.disabled = isLinked(this.node, name);
      input.title = input.disabled ? "Controlled by a connected input" : "";
    }
    this.playhead.setAttribute("aria-disabled", String(!this.ready));
    this.updateTimelineUI(); this.updatePlayhead(); this.syncCropBoxToVideo(); this.updateTimelineRange();
    if (!this.ready) this.status.textContent = this.errorMessage || (this.state.video_path ? "Loading video…" : "Select a video to preview.");
  }
  updateTimelineUI() {
    const start = this.duration ? clamp(Number(this.state.start_time) / this.duration, 0, 1) * 100 : 0;
    const width = this.duration ? clamp(Number(this.state.segment_duration) / this.duration * 100, 0, 100 - start) : 0;
    this.segmentBar.style.left = `${start}%`; this.segmentBar.style.width = `${width}%`;
    const inPoint = Number(this.state.start_time) || 0, duration = Number(this.state.segment_duration) || 0;
    for (const [which, handle] of Object.entries(this.timelineHandles)) {
      const time = which === "in" ? inPoint : inPoint + duration;
      handle.style.left = `clamp(6px, ${this.duration ? clamp(time / this.duration, 0, 1) * 100 : 0}%, calc(100% - 6px))`;
      handle.disabled = !this.ready || this.duration < .1 || isLinked(this.node, "segment_duration") || (which === "in" && isLinked(this.node, "start_time"));
      handle.style.opacity = handle.disabled ? ".4" : "1";
      handle.style.cursor = handle.disabled ? "default" : "ew-resize";
      handle.setAttribute("aria-disabled", String(handle.disabled));
      handle.setAttribute("aria-valuemin", "0"); handle.setAttribute("aria-valuemax", String(this.duration));
      handle.setAttribute("aria-valuenow", String(time)); handle.title = `${which === "in" ? "In" : "Out"}: ${time.toFixed(2)}s`;
    }
    this.selectionLabel.textContent = `In ${inPoint.toFixed(2)}s → Out ${(inPoint + duration).toFixed(2)}s · ${duration.toFixed(2)}s`;
  }
  updatePlayhead() {
    const time = this.videoEl.currentTime || 0;
    this.playhead.style.left = `${this.duration ? clamp(time / this.duration, 0, 1) * 100 : 0}%`;
    this.playhead.setAttribute("aria-valuemin", "0");
    this.playhead.setAttribute("aria-valuemax", String(this.duration));
    this.playhead.setAttribute("aria-valuenow", String(time));
    if (this.ready) this.status.textContent = `${time.toFixed(2)}s / ${this.duration.toFixed(2)}s · ${this.videoWidth} × ${this.videoHeight}`;
  }
  videoBounds() {
    if (!this.ready) return null;
    const width = this.playerWrapper.clientWidth, height = this.playerWrapper.clientHeight;
    const scale = Math.min(width / this.videoWidth, height / this.videoHeight);
    if (!(scale > 0)) return null;
    return { scale, left: (width - this.videoWidth * scale) / 2, top: (height - this.videoHeight * scale) / 2 };
  }
  syncCropBoxToVideo() {
    const bounds = this.videoBounds();
    this.cropOverlay.style.display = bounds && this.cropActive ? "block" : "none";
    if (!bounds || !this.cropActive) return;
    const width = clamp(Number(this.state.crop_width), 0, this.videoWidth);
    const height = clamp(Number(this.state.crop_height), 0, this.videoHeight);
    Object.assign(this.cropOverlay.style, {
      left: `${bounds.left + clamp(Number(this.state.crop_x), 0, this.videoWidth - width) * bounds.scale}px`,
      top: `${bounds.top + clamp(Number(this.state.crop_y), 0, this.videoHeight - height) * bounds.scale}px`,
      width: `${width * bounds.scale}px`, height: `${height * bounds.scale}px`,
    });
  }
  startDrag(move) {
    this.stopDrag?.();
    this.stopDrag = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", this.stopDrag);
      window.removeEventListener("pointercancel", this.stopDrag); window.removeEventListener("blur", this.stopDrag);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", this.stopDrag);
    window.addEventListener("pointercancel", this.stopDrag); window.addEventListener("blur", this.stopDrag);
  }
  dispose() {
    this.disposed = true; this.stopDrag?.(); this.observer?.disconnect(); this.videoEl.pause();
    this.videoEl.onloadedmetadata = this.videoEl.onerror = this.videoEl.ontimeupdate = this.videoEl.onseeked = null;
    this.videoEl.removeAttribute("src"); this.videoEl.load();
  }
}

export class VFVideoScrubberModal {
  constructor(node, options = {}) {
    this.node = node;
    this.state = readState(node);
    const aliases = { videoPath: "video_path", startTime: "start_time", segmentDuration: "segment_duration", currentFrameOffset: "current_frame_offset", playbackSpeed: "playback_speed", fps: "fps", cropX: "crop_x", cropY: "crop_y", cropWidth: "crop_width", cropHeight: "crop_height" };
    for (const [key, name] of Object.entries(aliases)) if (options[key] !== undefined) this.state[name] = options[key];
  }
  open() {
    const { backdrop, close } = makeModalBackdrop({ onClose: () => this.dispose(), zIndex: 10060 });
    this.backdrop = backdrop; this.closeModal = close;
    const dialog = styled("div", { width: "900px", maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", background: "#1c1c24", borderRadius: "10px", color: "#ddd" });
    const header = styled("div", { display: "flex", justifyContent: "space-between", padding: "12px" }, "🎬 Video Scrubber & Crop Tool");
    const closeBtn = createElement("button", "", "✕"); closeBtn.onclick = () => this.dispose(); header.appendChild(closeBtn);
    this.player = new VFVideoScrubber(this.state, values => Object.assign(this.state, values), { modal: true });
    this.player.node = this.node;
    this.player.refresh();
    const apply = styled("button", { margin: "12px", padding: "6px 18px", background: "#0066cc", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }, "Apply to Node");
    apply.onclick = () => this.applyToNode();
    dialog.append(header, this.player.root, apply); backdrop.appendChild(dialog); document.body.appendChild(backdrop);
  }
  applyToNode() {
    const fields = FIELDS.filter(name => name !== "video_path");
    writeState(this.node, Object.fromEntries(fields.map(name => [name, this.state[name]])));
    this.dispose();
  }
  dispose() { this.player?.dispose(); this.closeModal?.(); }
}
