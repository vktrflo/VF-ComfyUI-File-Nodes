/** Shared inline and modal video scrubber for VF Load Video. */
import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement, makeModalBackdrop } from "./vf_ui_shared.js";

const MIN_WIDTH = 320;
const PANEL_HEIGHT = 300;
const FIELDS = ["video_path", "start_time", "segment_duration", "current_frame_offset", "playback_speed", "fps", "longest_side", "crop_x", "crop_y", "crop_width", "crop_height"];
const LONGEST_SIDE_TOOLTIP = "Resizes the video output so its longest dimension (width or height) matches this pixel size while preserving aspect ratio. Set to 0 to keep the original resolution.";
const FPS_TOOLTIP = "Frames per second for video decoding and output. Automatically populated from the selected video file, or can be overridden manually.";
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
      this._vfRecalculateDimensions = (isVueNodes) => {
        this._vfRefreshVideo?.();
        this._vfVideoScrubber?.updateLayout();
        const vue = typeof isVueNodes === "boolean"
          ? isVueNodes
          : Boolean(
              window.LiteGraph?.vueNodesMode ||
              this._vfVideoScrubber?.root?.closest?.("[data-node-id]") ||
              this._vfVideoScrubber?.root?.closest?.(".lg-node")
            );
        if (!vue) {
          const minH = this._vfVideoScrubber?.minHeight || PANEL_HEIGHT;
          const baseLegacyHeight = Math.max(440, minH + 80);
          const targetWidth = Math.max(this.size?.[0] || MIN_WIDTH, MIN_WIDTH);
          const targetHeight = this._vfLegacyHeight
            ? Math.max(this._vfLegacyHeight, baseLegacyHeight)
            : baseLegacyHeight;
          if (typeof this.setSize === "function") {
            this.setSize([targetWidth, targetHeight]);
          } else if (Array.isArray(this.size)) {
            this.size[0] = targetWidth;
            this.size[1] = targetHeight;
          }
          this._vfVideoScrubber?.syncCropBoxToVideo();
        }
        this.setDirtyCanvas?.(true, true);
      };
      this._vfRefreshVideo();
      const height = Math.max(this.size?.[1] || 0, this.computeSize?.()[1] || 440);
      this.setSize?.([Math.max(this.size?.[0] || 0, MIN_WIDTH), height]);
      this.setDirtyCanvas(true, true);
    }, 10);
    return result;
  };
  const originalConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    if (this._vfVideoScrubber) this._vfVideoScrubber._isConfiguring = true;
    const result = originalConfigure?.apply(this, arguments);
    if (this.size) this.size[0] = Math.max(this.size[0], MIN_WIDTH);
    this._vfRefreshVideo?.();
    this._vfVideoScrubber?.updateLayout();
    this._vfVideoScrubber?.syncCropBoxToVideo();
    if (this._vfVideoScrubber) this._vfVideoScrubber._isConfiguring = false;
    return result;
  };
  const originalResize = nodeType.prototype.onResize;
  nodeType.prototype.onResize = function () {
    const result = originalResize?.apply(this, arguments);
    const isVue = Boolean(
      window.LiteGraph?.vueNodesMode ||
      this._vfVideoScrubber?.root?.closest?.("[data-node-id]") ||
      this._vfVideoScrubber?.root?.closest?.(".lg-node")
    );
    if (!isVue && Array.isArray(this.size) && this.size[1] > 0) {
      this._vfLegacyHeight = this.size[1];
    }
    if (this.size) this.size[0] = Math.max(this.size[0], MIN_WIDTH);
    this._vfRefreshVideo?.();
    this._vfVideoScrubber?.updateLayout();
    this._vfVideoScrubber?.syncCropBoxToVideo();
    return result;
  };
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
    this._fpsSourcePath = state?.video_path || "";
    this._initialized = false;
    this._resetVideoSettingsOnLoad = false;
    this._fpsNeedsReset = false;
    this.state = {}; this.onChange = onChange; this.duration = 0; this.ready = false; this._atEnd = false;
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
    this.status = styled("div", { fontSize: "11px", color: "#aaa", display: "flex", alignItems: "center" });
    this.status.setAttribute("aria-live", "polite");
    this.statusText = styled("span");
    this.cropResizeHelp = styled("span", {
      display: "none", alignItems: "center", justifyContent: "center",
      width: "14px", height: "14px", borderRadius: "50%",
      background: "#2a2a3e", border: "1px solid #666688",
      color: "#ddd", fontSize: "10px", fontWeight: "bold",
      lineHeight: "14px", textAlign: "center",
      cursor: "help", marginLeft: "6px", verticalAlign: "middle",
      userSelect: "none", flexShrink: "0",
    }, "?");
    this.cropResizeHelp.setAttribute("aria-label", "Resize information");
    this.status.append(this.statusText, this.cropResizeHelp);
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
    const button = text => styled("button", { background: "#2a2a3a", color: "#ddd", border: "1px solid #444", borderRadius: "4px", padding: "5px 8px", cursor: "pointer", fontSize: "12px", height: "26px", boxSizing: "border-box" }, text);
    this.playBtn = button("▶ Play");
    this.playBtn.style.width = "74px";
    this.playBtn.style.textAlign = "center";
    this.cropToggleBtn = button("Enable Crop");
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
        this.startDrag(ev => this.moveTimelineHandle(which, originalTime + this.timelineTimeAtPointer(ev.clientX, false) - grabbedTime), e);
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

    const row = styled("div", { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" });

    const longestField = styled("label", { display: "flex", flexDirection: "column", gap: "2px", fontSize: "11px", color: "#aaa" }, "Resize to");
    longestField.title = LONGEST_SIDE_TOOLTIP;
    const longestBox = styled("div", { display: "inline-flex", alignItems: "center", gap: "4px" });
    const longestInput = styled("input", { width: "68px", boxSizing: "border-box", padding: "3px 5px", background: "#101014", color: "#ddd", border: "1px solid #444", borderRadius: "3px", fontSize: "11px", height: "26px" });
    longestInput.type = "number"; longestInput.min = 0; longestInput.max = 16384; longestInput.step = 1;
    longestInput.setAttribute("aria-label", "Resize to");
    longestInput.title = LONGEST_SIDE_TOOLTIP;
    const pxText = styled("span", { fontSize: "11px", color: "#888", userSelect: "none" }, "px");
    longestBox.append(longestInput, pxText);
    longestField.appendChild(longestBox);

    const fpsField = styled("label", { display: "flex", flexDirection: "column", gap: "2px", fontSize: "11px", color: "#aaa" }, "FPS");
    fpsField.title = FPS_TOOLTIP;
    const fpsInput = styled("input", { width: "54px", boxSizing: "border-box", padding: "3px 5px", background: "#101014", color: "#ddd", border: "1px solid #444", borderRadius: "3px", fontSize: "11px", height: "26px" });
    fpsInput.type = "number"; fpsInput.min = 1; fpsInput.max = 120; fpsInput.step = 0.01;
    fpsInput.setAttribute("aria-label", "FPS");
    fpsInput.title = FPS_TOOLTIP;
    fpsField.appendChild(fpsInput);

    longestInput.onchange = () => {
      if (isLinked(this.node, "longest_side")) { this.refresh(); return; }
      if (longestInput.value.trim() === "" || !Number.isFinite(Number(longestInput.value))) {
        longestInput.value = "0";
        this.change({ longest_side: 0 });
        return;
      }
      const value = Number(longestInput.value);
      this.change({ longest_side: clamp(Math.round(value), 0, 16384) });
    };

    longestInput.onblur = () => {
      if (longestInput.value.trim() === "" || !Number.isFinite(Number(longestInput.value))) {
        longestInput.value = "0";
        if (!isLinked(this.node, "longest_side")) {
          this.change({ longest_side: 0 });
        }
      }
    };

    fpsInput.onchange = () => {
      const value = Number(fpsInput.value);
      if (fpsInput.value.trim() === "" || !Number.isFinite(value) || isLinked(this.node, "fps")) { this.refresh(); return; }
      this.change({ fps: clamp(value, 1, 120) });
    };

    this.advancedInputs = { longest_side: longestInput, fps: fpsInput };

    this.muteBtn = button("🔊");
    this.muteBtn.title = "Mute / Unmute";
    this.muteBtn.setAttribute("aria-label", "Mute audio");

    this.volumeSlider = styled("input", {
      width: "55px", height: "26px", margin: "0", padding: "0",
      cursor: "pointer", accentColor: "#00aaff", verticalAlign: "middle",
    });
    this.volumeSlider.type = "range";
    this.volumeSlider.min = 0;
    this.volumeSlider.max = 1;
    this.volumeSlider.step = 0.05;
    this.volumeSlider.title = "Volume";
    this.volumeSlider.setAttribute("aria-label", "Volume");

    const volumeBox = styled("div", { display: "inline-flex", alignItems: "center", gap: "4px" });
    volumeBox.append(this.muteBtn, this.volumeSlider);

    let savedVol = 1;
    let savedMuted = false;
    try {
      if (typeof localStorage !== "undefined") {
        const v = localStorage.getItem("vf_player_volume");
        if (v != null && !isNaN(Number(v))) savedVol = clamp(Number(v), 0, 1);
        savedMuted = localStorage.getItem("vf_player_muted") === "true";
      }
    } catch {}
    this._lastVolume = savedVol > 0 ? savedVol : 1;
    this.videoEl.volume = savedVol;
    this.videoEl.muted = savedMuted || savedVol === 0;

    this.updateVolumeUI = () => {
      const isMuted = this.videoEl.muted || this.videoEl.volume === 0;
      this.muteBtn.textContent = isMuted ? "🔇" : "🔊";
      this.volumeSlider.value = String(isMuted ? 0 : this.videoEl.volume);
      this.muteBtn.setAttribute("aria-label", isMuted ? "Unmute audio" : "Mute audio");
    };
    this.updateVolumeUI();

    this.muteBtn.onclick = () => {
      this.videoEl.muted = !this.videoEl.muted;
      if (!this.videoEl.muted && this.videoEl.volume === 0) {
        this.videoEl.volume = this._lastVolume || 1;
      }
      this.updateVolumeUI();
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("vf_player_muted", String(this.videoEl.muted));
          localStorage.setItem("vf_player_volume", String(this.videoEl.volume));
        }
      } catch {}
    };

    this.volumeSlider.oninput = () => {
      const val = Number(this.volumeSlider.value);
      this.videoEl.volume = val;
      if (val > 0) {
        this._lastVolume = val;
        this.videoEl.muted = false;
      } else {
        this.videoEl.muted = true;
      }
      this.updateVolumeUI();
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("vf_player_muted", String(this.videoEl.muted));
          localStorage.setItem("vf_player_volume", String(this.videoEl.volume));
        }
      } catch {}
    };
    this.videoEl.onvolumechange = () => this.updateVolumeUI();

    row.append(this.playBtn, this.cropToggleBtn, longestField, fpsField, volumeBox);
    controls.append(this.status, this.timelineViewport, timelineTools, this.selectionLabel, row);
    this.root.append(this.playerWrapper, controls);
    // Keep embedded interactions from moving/selecting the graph node.
    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) this.root.addEventListener(type, e => e.stopPropagation());
    this.playBtn.onclick = async () => {
      if (!this.ready) return;
      if (!this.videoEl.paused) { this.videoEl.pause(); return; }
      const { inPoint, outPoint } = this.segmentBounds();
      const frameDuration = 1 / (Number(this.state.fps) || 24);
      const isAtEnd = this._atEnd ||
                      Boolean(this.videoEl.ended) ||
                      this.videoEl.currentTime >= outPoint - Math.min(0.08, Math.max(0.02, frameDuration));
      const isBeforeStart = this.videoEl.currentTime < inPoint - 0.01;

      if (isAtEnd || isBeforeStart) {
        this._atEnd = false;
        this.videoEl.currentTime = inPoint;
        this.updatePlayhead();
      }
      try { await this.videoEl.play(); } catch { this.setStatus("Unable to play this video in the browser."); }
    };
    this.videoEl.onplay = () => {
      this._atEnd = false;
      this.playBtn.textContent = "⏸ Pause";
      this.startPlaybackMonitoring();
    };
    this.videoEl.onpause = () => {
      this.playBtn.textContent = "▶ Play";
      this.stopPlaybackMonitoring();
    };
    this.videoEl.onended = () => {
      this._atEnd = true;
      this.videoEl.pause();
      this.playBtn.textContent = "▶ Play";
      this.stopPlaybackMonitoring();
    };
    this.cropToggleBtn.onclick = () => {
      if (!this.ready || this.cropLinked()) return;
      this.change(this.cropActive ? { crop_x: 0, crop_y: 0, crop_width: 0, crop_height: 0 } : {
        crop_x: Math.round(this.videoWidth * .1), crop_y: Math.round(this.videoHeight * .1),
        crop_width: Math.round(this.videoWidth * .8), crop_height: Math.round(this.videoHeight * .8),
      });
    };
    const seek = e => {
      if (!this.ready) return;
      this._atEnd = false;
      this.videoEl.currentTime = this.timelineTimeAtPointer(e.clientX);
      this.updatePlayhead();
    };
    this.scrubberTrack.onclick = seek;
    this.scrubberTrack.onpointerdown = e => { if (this.ready) { e.preventDefault(); seek(e); this.startDrag(seek, e); } };
    this.scrubberTrack.onkeydown = e => {
      if (!this.ready || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      this._atEnd = false;
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
      }, e);
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
        }, e);
      };
      this.cropHandles[corner] = handle; this.cropOverlay.appendChild(handle);
    }
    this.videoEl.onloadedmetadata = () => {
      if (this.disposed) return;
      this.duration = Number.isFinite(this.videoEl.duration) ? this.videoEl.duration : 0;
      this.videoWidth = this.videoEl.videoWidth; this.videoHeight = this.videoEl.videoHeight;
      this.ready = this.duration > 0 && this.videoWidth > 0 && this.videoHeight > 0;
      this.errorMessage = this.ready ? "" : "Unable to load video metadata.";
      if (this._resetVideoSettingsOnLoad) {
        this._resetVideoSettingsOnLoad = false;
        if (this.ready) {
          const updates = {};
          if (!isLinked(this.node, "start_time")) {
            updates.start_time = 0;
          }
          if (!isLinked(this.node, "segment_duration")) {
            updates.segment_duration = clamp(Math.round(this.duration * 100) / 100, 0.1, 600);
          }
          if (!isLinked(this.node, "current_frame_offset")) {
            updates.current_frame_offset = 0;
          }
          if (!isLinked(this.node, "playback_speed")) {
            updates.playback_speed = 1.0;
          }
          if (Object.keys(updates).length > 0) {
            this.change(updates);
          }
        }
      }
      this.videoEl.currentTime = clamp(Number(this.state.start_time) || 0, 0, this.duration);
      this.zoomTimeline(this.timelineZoom || 1);
      this.refresh();
    };
    this.videoEl.onerror = () => {
      if (this.disposed) return;
      this.ready = false;
      this._resetVideoSettingsOnLoad = false;
      this.errorMessage = this.state.video_path ? "Unable to load video. Check the path and browser format support." : "";
      this.refresh();
    };
    this.videoEl.ontimeupdate = () => {
      this.checkPlaybackBounds();
      this.updatePlayhead();
    };
    this.videoEl.onseeked = () => this.updatePlayhead();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => { this.updateLayout(); this.syncCropBoxToVideo(); this.updateTimelineRange(); });
      this.observer.observe(this.playerWrapper);
      this.observer.observe(this.controls);
    }
    this.update(state);
    this._initialized = true;
    this.updateLayout();
  }
  segmentBounds() {
    const inPoint = clamp(Number(this.state.start_time) || 0, 0, this.duration || 0);
    const duration = Number(this.state.segment_duration);
    const outPoint = Number.isFinite(duration) && duration > 0
      ? clamp(inPoint + duration, inPoint, this.duration || inPoint)
      : (this.duration || inPoint);
    return { inPoint, outPoint };
  }
  checkPlaybackBounds() {
    if (!this.ready || this.videoEl.paused) return;
    const { inPoint, outPoint } = this.segmentBounds();
    const frameDuration = 1 / (Number(this.state.fps) || 24);
    if (this.videoEl.currentTime >= outPoint - Math.min(0.05, frameDuration / 2) || this.videoEl.ended) {
      this._atEnd = true;
      this.videoEl.pause();
      this.videoEl.currentTime = outPoint;
      this.updatePlayhead();
    }
  }
  startPlaybackMonitoring() {
    this.stopPlaybackMonitoring();
    if (typeof requestAnimationFrame !== "function") return;
    const tick = () => {
      if (this.disposed || this.videoEl.paused || this.videoEl.ended) {
        this._playbackRaf = null;
        return;
      }
      this.checkPlaybackBounds();
      if (!this.videoEl.paused) {
        this._playbackRaf = requestAnimationFrame(tick);
      } else {
        this._playbackRaf = null;
      }
    };
    this._playbackRaf = requestAnimationFrame(tick);
  }
  stopPlaybackMonitoring() {
    if (this._playbackRaf && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._playbackRaf);
    }
    this._playbackRaf = null;
  }
  timelineTimeAtPointer(clientX, bounded = true) {
    const rect = this.scrubberTrack.getBoundingClientRect();
    const fraction = rect.width ? (clientX - rect.left) / rect.width : 0;
    return (bounded ? clamp(fraction, 0, 1) : fraction) * this.duration;
  }
  moveTimelineHandle(which, requestedTime) {
    if (!this.ready || this.timelineHandles[which].disabled) return;
    this._atEnd = false;
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
      if (this._initialized && !this._isConfiguring && state.video_path) {
        this._resetVideoSettingsOnLoad = true;
        this._fpsNeedsReset = true;
      }
      this.errorMessage = "";
      this.stopDrag?.(); this.videoEl.pause(); this.ready = false; this.duration = 0;
      this.scrubberTrack.style.width = `${(this.timelineZoom || 1) * 100}%`;
      this.videoEl.removeAttribute("src");
      if (state.video_path) {
        this.videoEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(state.video_path)}`;
        if (state.video_path !== this._fpsSourcePath) {
          this._fpsSourcePath = state.video_path;
          this.fetchVideoFps(state.video_path);
        }
      } else {
        this._fpsSourcePath = "";
      }
      this.videoEl.load();
    }
    this.videoEl.playbackRate = clamp(Number(state.playback_speed) || 1, .1, 4);
    if (changedStart && this.ready) this.videoEl.currentTime = clamp(Number(state.start_time) || 0, 0, this.duration);
    this.refresh();
  }
  async fetchVideoFps(path) {
    if (!path || isLinked(this.node, "fps")) return;
    try {
      if (typeof fetch !== "function") return;
      const resp = await fetch(`/api/vf-file-nodes/metadata?path=${encodeURIComponent(path)}`);
      if (!resp.ok) {
        if (this.state.video_path === path && this._fpsNeedsReset) {
          this._fpsNeedsReset = false;
          this.change({ fps: 24.0 });
        }
        return;
      }
      const data = await resp.json();
      if (data && Number.isFinite(data.fps) && data.fps > 0) {
        if (this.state.video_path !== path) return;
        this._fpsNeedsReset = false;
        const newFps = Math.round(data.fps * 100) / 100;
        this.change({ fps: newFps });
      } else if (this.state.video_path === path && this._fpsNeedsReset) {
        this._fpsNeedsReset = false;
        this.change({ fps: 24.0 });
      }
    } catch {
      if (this.state.video_path === path && this._fpsNeedsReset) {
        this._fpsNeedsReset = false;
        this.change({ fps: 24.0 });
      }
    }
  }
  refresh() {
    this.cropActive = Number(this.state.crop_width) > 0 && Number(this.state.crop_height) > 0;
    this.cropToggleBtn.textContent = this.cropActive ? "Disable Crop" : "Enable Crop";
    for (const button of [this.playBtn, this.cropToggleBtn]) button.disabled = !this.ready;
    this.cropToggleBtn.disabled ||= this.cropLinked();
    this.cropOverlay.style.cursor = this.cropLinked() ? "default" : "move";
    for (const handle of Object.values(this.cropHandles)) handle.style.display = this.cropLinked() ? "none" : "block";
    for (const [name, input] of Object.entries(this.advancedInputs)) {
      if (!input) continue;
      input.value = this.state[name] ?? "";
      input.disabled = isLinked(this.node, name);
      input.title = input.disabled ? "Controlled by a connected input" : (name === "fps" ? FPS_TOOLTIP : LONGEST_SIDE_TOOLTIP);
    }
    this.playhead.setAttribute("aria-disabled", String(!this.ready));
    this.updateTimelineUI(); this.updatePlayhead(); this.syncCropBoxToVideo(); this.updateTimelineRange();
    if (!this.ready) this.setStatus(this.errorMessage || (this.state.video_path ? "Loading video…" : "Select a video to preview."));
  }
  setStatus(text) {
    this.statusText.textContent = text;
    this.cropResizeHelp.style.display = "none";
    this.cropResizeHelp.title = "";
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
    this.selectionLabel.textContent = `In ${inPoint.toFixed(2)}s → Out ${(inPoint + duration).toFixed(2)}s · Total Duration: ${duration.toFixed(2)}s`;
    this.selectionLabel.title = `Selected range: In ${inPoint.toFixed(2)}s → Out ${(inPoint + duration).toFixed(2)}s (Total Duration: ${duration.toFixed(2)}s)`;
    this.segmentBar.title = this.selectionLabel.title;
  }
  outputDimensions() {
    if (!this.ready || !this.videoWidth || !this.videoHeight) return null;
    const isCropped = Boolean(this.cropActive && Number(this.state.crop_width) > 0 && Number(this.state.crop_height) > 0);
    let w = isCropped ? Number(this.state.crop_width) : this.videoWidth;
    let h = isCropped ? Number(this.state.crop_height) : this.videoHeight;
    const longest = Number(this.state.longest_side) || 0;
    if (longest > 0) {
      const curr = Math.max(w, h);
      if (curr > 0) {
        const scale = longest / curr;
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
    } else {
      w = Math.round(w);
      h = Math.round(h);
    }
    return { width: w, height: h, isCropped };
  }
  updatePlayhead() {
    const time = this.videoEl.currentTime || 0;
    this.playhead.style.left = `${this.duration ? clamp(time / this.duration, 0, 1) * 100 : 0}%`;
    this.playhead.setAttribute("aria-valuemin", "0");
    this.playhead.setAttribute("aria-valuemax", String(this.duration));
    this.playhead.setAttribute("aria-valuenow", String(time));
    if (this.ready) {
      const dims = this.outputDimensions();
      const dimText = dims
        ? (dims.isCropped ? `Crop: ${dims.width} × ${dims.height}` : `${dims.width} × ${dims.height}`)
        : `${this.videoWidth} × ${this.videoHeight}`;
      this.statusText.textContent = `${time.toFixed(2)}s / ${this.duration.toFixed(2)}s · ${dimText}`;
      const longest = Number(this.state.longest_side) || 0;
      if (longest > 0 && dims) {
        if (dims.isCropped) {
          const cropW = Math.round(Number(this.state.crop_width)) || 0;
          const cropH = Math.round(Number(this.state.crop_height)) || 0;
          this.cropResizeHelp.title = `Output resolution: ${dims.width} × ${dims.height}px\nScaled from source crop (${cropW} × ${cropH}px) to fit 'Resize to' longest side (${longest}px).`;
        } else {
          this.cropResizeHelp.title = `Output resolution: ${dims.width} × ${dims.height}px\nScaled from original video (${this.videoWidth} × ${this.videoHeight}px) to fit 'Resize to' longest side (${longest}px).`;
        }
        this.cropResizeHelp.style.display = "inline-flex";
      } else {
        this.cropResizeHelp.style.display = "none";
        this.cropResizeHelp.title = "";
      }
    }
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
  startDrag(move, startEvent) {
    this.stopDrag?.();
    const target = startEvent?.target;
    const pointerId = startEvent?.pointerId;
    if (target?.setPointerCapture && pointerId != null) {
      try { target.setPointerCapture(pointerId); } catch {}
    }
    const onLostCapture = () => this.stopDrag?.();
    target?.addEventListener?.("lostpointercapture", onLostCapture);
    const onMove = ev => {
      if (ev?.buttons !== undefined && (ev.buttons & 1) === 0) {
        this.stopDrag?.();
        return;
      }
      move(ev);
    };
    const stop = () => this.stopDrag?.();
    this.stopDrag = () => {
      this.stopDrag = null;
      target?.removeEventListener?.("lostpointercapture", onLostCapture);
      if (target?.releasePointerCapture && pointerId != null) {
        try {
          if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
        } catch {}
      }
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("mouseup", stop, true);
      window.removeEventListener("blur", stop);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    window.addEventListener("mouseup", stop, true);
    window.addEventListener("blur", stop);
  }
  dispose() {
    this.disposed = true; this.stopPlaybackMonitoring(); this.stopDrag?.(); this.observer?.disconnect(); this.videoEl.pause();
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
