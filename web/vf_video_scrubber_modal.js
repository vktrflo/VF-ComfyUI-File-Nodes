/**
 * Interactive Video Scrubber Modal with Visual Crop Box for 🌀 VF Load Video.
 */

import { api } from "../../scripts/api.js";
import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement, makeModalBackdrop } from "./vf_ui_shared.js";

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 440;

export function setupLoadVideoNode(nodeType, nodeData) {
  const origOnNodeCreated = nodeType.prototype.onNodeCreated;

  nodeType.prototype.onNodeCreated = function () {
    const res = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
    const node = this;

    // Set initial size
    node.size = [
      Math.max(node.size?.[0] || 0, DEFAULT_WIDTH),
      Math.max(node.size?.[1] || 0, DEFAULT_HEIGHT),
    ];

    setTimeout(() => {
      const videoPathWidget = node.widgets?.find((w) => w.name === "video_path");

      // 1. Add "Browse Files" button
      if (videoPathWidget && !node.widgets?.some((w) => w._vfBrowseBtn)) {
        const browseBtn = node.addWidget("button", "📁 Browse Videos", null, () => {
          openFileBrowserModal(node, videoPathWidget, { filter: "video" });
        }, { serialize: false });
        if (browseBtn) browseBtn._vfBrowseBtn = true;
      }

      // 2. Add "🎬 Open Interactive Video Scrubber" button
      if (!node.widgets?.some((w) => w._vfScrubberBtn)) {
        const scrubberBtn = node.addWidget("button", "🎬 Open Interactive Video Scrubber", null, () => {
          const getVal = (name, def) => {
            const w = node.widgets?.find((item) => item.name === name);
            return w ? w.value : def;
          };

          const modal = new VFVideoScrubberModal(node, {
            videoPath: getVal("video_path", ""),
            startTime: parseFloat(getVal("start_time", 0.0)),
            segmentDuration: parseFloat(getVal("segment_duration", 2.0)),
            currentFrameOffset: parseInt(getVal("current_frame_offset", 0)),
            playbackSpeed: parseFloat(getVal("playback_speed", 1.0)),
            fps: parseFloat(getVal("fps", 24.0)),
            cropX: parseInt(getVal("crop_x", 0)),
            cropY: parseInt(getVal("crop_y", 0)),
            cropWidth: parseInt(getVal("crop_width", 0)),
            cropHeight: parseInt(getVal("crop_height", 0)),
          });
          modal.open();
        }, { serialize: false });
        if (scrubberBtn) scrubberBtn._vfScrubberBtn = true;
      }

      if (Array.isArray(node.size) && node.size[1] < DEFAULT_HEIGHT) {
        if (typeof node.setSize === "function") {
          node.setSize([Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT]);
        } else {
          node.size = [Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT];
        }
      }
      node.setDirtyCanvas(true, true);
    }, 10);

    return res;
  };

  const origOnConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const res = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
    if (Array.isArray(this.size)) {
      if (this.size[0] < DEFAULT_WIDTH) this.size[0] = DEFAULT_WIDTH;
      if (this.size[1] < DEFAULT_HEIGHT) this.size[1] = DEFAULT_HEIGHT;
    }
    return res;
  };
}

export class VFVideoScrubberModal {
  constructor(node, options = {}) {
    this.node = node;
    this.videoPath = options.videoPath || "";
    this.startTime = options.startTime || 0.0;
    this.segmentDuration = options.segmentDuration || 2.0;
    this.currentFrameOffset = options.currentFrameOffset || 0;
    this.playbackSpeed = options.playbackSpeed || 1.0;
    this.fps = options.fps || 24.0;

    this.cropX = options.cropX || 0;
    this.cropY = options.cropY || 0;
    this.cropW = options.cropWidth || 0;
    this.cropH = options.cropHeight || 0;
    this.cropActive = this.cropW > 0 && this.cropH > 0;

    this.duration = 0.0;
    this.videoWidth = 0;
    this.videoHeight = 0;
  }

  open() {
    if (!this.videoPath) {
      alert("Please select a video file first.");
      return;
    }

    const { backdrop, close } = makeModalBackdrop({
      onClose: () => this.dispose(),
      zIndex: 10060,
    });
    this.backdrop = backdrop;
    this.closeModal = close;

    this.render();
    document.body.appendChild(this.backdrop);
  }

  dispose() {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = "";
    }
    this.closeModal?.();
  }

  render() {
    const dialog = createElement("div", "vf-scrubber-dialog");
    Object.assign(dialog.style, {
      width: "900px",
      maxHeight: "90vh",
      background: "#1c1c24",
      borderRadius: "10px",
      border: "1px solid #3c3c4c",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 16px 48px rgba(0,0,0,0.8)",
      overflow: "hidden",
      fontFamily: "Inter, system-ui, sans-serif",
      color: "#ddd",
    });

    // Header
    const header = createElement("div");
    Object.assign(header.style, {
      padding: "12px 18px",
      background: "#242430",
      borderBottom: "1px solid #30303e",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    });
    header.innerHTML = '<div style="font-weight: 600; font-size: 14px;">🎬 Video Scrubber & Crop Tool</div>';

    const closeBtn = createElement("button", "", "✕");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#888",
      fontSize: "16px",
      cursor: "pointer",
    });
    closeBtn.onclick = () => this.dispose();
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Video display area
    const playerWrapper = createElement("div");
    Object.assign(playerWrapper.style, {
      position: "relative",
      width: "100%",
      height: "460px",
      background: "#101014",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    });

    this.videoEl = document.createElement("video");
    this.videoEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(this.videoPath)}`;
    Object.assign(this.videoEl.style, {
      maxWidth: "100%",
      maxHeight: "100%",
      objectFit: "contain",
    });
    this.videoEl.playbackRate = this.playbackSpeed;

    // Visual crop box overlay
    this.cropOverlay = createElement("div");
    Object.assign(this.cropOverlay.style, {
      position: "absolute",
      border: "2px dashed #00aaff",
      background: "rgba(0, 170, 255, 0.15)",
      cursor: "move",
      display: this.cropActive ? "block" : "none",
    });

    this.setupCropDragging();

    this.videoEl.onloadedmetadata = () => {
      this.duration = this.videoEl.duration || 1.0;
      this.videoWidth = this.videoEl.videoWidth;
      this.videoHeight = this.videoEl.videoHeight;
      this.videoEl.currentTime = this.startTime;
      this.updateTimelineUI();
      this.syncCropBoxToVideo();
    };

    playerWrapper.appendChild(this.videoEl);
    playerWrapper.appendChild(this.cropOverlay);
    dialog.appendChild(playerWrapper);

    // Timeline scrubber & Controls
    const controls = createElement("div");
    Object.assign(controls.style, {
      padding: "14px 18px",
      background: "#1e1e28",
      borderTop: "1px solid #2d2d3c",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    });

    // Scrubber track
    this.scrubberTrack = createElement("div");
    Object.assign(this.scrubberTrack.style, {
      position: "relative",
      height: "24px",
      background: "#2a2a38",
      borderRadius: "4px",
      cursor: "pointer",
      overflow: "hidden",
    });

    this.segmentBar = createElement("div");
    Object.assign(this.segmentBar.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      background: "rgba(0, 102, 204, 0.5)",
      borderLeft: "2px solid #0088ff",
      borderRight: "2px solid #0088ff",
    });

    this.playhead = createElement("div");
    Object.assign(this.playhead.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      width: "3px",
      background: "#ffcc00",
      boxShadow: "0 0 4px #ffcc00",
    });

    this.scrubberTrack.appendChild(this.segmentBar);
    this.scrubberTrack.appendChild(this.playhead);

    this.scrubberTrack.onclick = (e) => {
      const rect = this.scrubberTrack.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.videoEl.currentTime = pct * this.duration;
      this.updatePlayhead();
    };

    controls.appendChild(this.scrubberTrack);

    // Button Row: Play/Pause, Start Time, Duration, Crop Toggle, Apply
    const btnRow = createElement("div");
    Object.assign(btnRow.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });

    const leftGroup = createElement("div");
    leftGroup.style.display = "flex";
    leftGroup.style.gap = "8px";
    leftGroup.style.alignItems = "center";

    const playBtn = createElement("button", "", "▶ Play");
    Object.assign(playBtn.style, {
      background: "#2a2a3a",
      color: "#fff",
      border: "1px solid #444",
      borderRadius: "4px",
      padding: "6px 14px",
      cursor: "pointer",
      fontSize: "12px",
    });
    playBtn.onclick = () => {
      if (this.videoEl.paused) {
        this.videoEl.play();
        playBtn.textContent = "⏸ Pause";
      } else {
        this.videoEl.pause();
        playBtn.textContent = "▶ Play";
      }
    };

    const setStartBtn = createElement("button", "", "Set In-Point");
    Object.assign(setStartBtn.style, {
      background: "#2a2a3a",
      color: "#00aaff",
      border: "1px solid #3c4c5c",
      borderRadius: "4px",
      padding: "6px 12px",
      cursor: "pointer",
      fontSize: "12px",
    });
    setStartBtn.onclick = () => {
      this.startTime = parseFloat(this.videoEl.currentTime.toFixed(2));
      this.updateTimelineUI();
    };

    const cropToggleBtn = createElement("button", "", this.cropActive ? "Disable Crop" : "Enable Crop");
    Object.assign(cropToggleBtn.style, {
      background: this.cropActive ? "#3a2a20" : "#2a2a3a",
      color: this.cropActive ? "#ffaa55" : "#aaa",
      border: "1px solid #555",
      borderRadius: "4px",
      padding: "6px 12px",
      cursor: "pointer",
      fontSize: "12px",
    });
    cropToggleBtn.onclick = () => {
      this.cropActive = !this.cropActive;
      this.cropOverlay.style.display = this.cropActive ? "block" : "none";
      cropToggleBtn.textContent = this.cropActive ? "Disable Crop" : "Enable Crop";
      if (this.cropActive && (this.cropW === 0 || this.cropH === 0)) {
        this.cropX = Math.round(this.videoWidth * 0.1);
        this.cropY = Math.round(this.videoHeight * 0.1);
        this.cropW = Math.round(this.videoWidth * 0.8);
        this.cropH = Math.round(this.videoHeight * 0.8);
      }
      this.syncCropBoxToVideo();
    };

    leftGroup.appendChild(playBtn);
    leftGroup.appendChild(setStartBtn);
    leftGroup.appendChild(cropToggleBtn);

    const rightGroup = createElement("div");
    rightGroup.style.display = "flex";
    rightGroup.style.gap = "8px";

    const applyBtn = createElement("button", "", "Apply to Node");
    Object.assign(applyBtn.style, {
      background: "#0066cc",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      padding: "6px 18px",
      cursor: "pointer",
      fontWeight: "600",
      fontSize: "12px",
    });
    applyBtn.onclick = () => this.applyToNode();

    rightGroup.appendChild(applyBtn);

    btnRow.appendChild(leftGroup);
    btnRow.appendChild(rightGroup);
    controls.appendChild(btnRow);

    dialog.appendChild(controls);
    this.backdrop.appendChild(dialog);

    this.videoEl.ontimeupdate = () => this.updatePlayhead();
  }

  updateTimelineUI() {
    if (!this.duration) return;
    const startPct = (this.startTime / this.duration) * 100;
    const widthPct = (this.segmentDuration / this.duration) * 100;

    this.segmentBar.style.left = `${startPct}%`;
    this.segmentBar.style.width = `${Math.min(100 - startPct, widthPct)}%`;
  }

  updatePlayhead() {
    if (!this.duration) return;
    const pct = (this.videoEl.currentTime / this.duration) * 100;
    this.playhead.style.left = `${pct}%`;
  }

  setupCropDragging() {
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    this.cropOverlay.onmousedown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = parseFloat(this.cropOverlay.style.left) || 0;
      initialTop = parseFloat(this.cropOverlay.style.top) || 0;

      const onMouseMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        this.cropOverlay.style.left = `${initialLeft + dx}px`;
        this.cropOverlay.style.top = `${initialTop + dy}px`;
        this.syncVideoToCropBox();
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };
  }

  syncCropBoxToVideo() {
    if (!this.cropActive || !this.videoWidth || !this.videoHeight) return;
    const rect = this.videoEl.getBoundingClientRect();
    const scaleX = rect.width / this.videoWidth;
    const scaleY = rect.height / this.videoHeight;

    this.cropOverlay.style.left = `${this.videoEl.offsetLeft + this.cropX * scaleX}px`;
    this.cropOverlay.style.top = `${this.videoEl.offsetTop + this.cropY * scaleY}px`;
    this.cropOverlay.style.width = `${this.cropW * scaleX}px`;
    this.cropOverlay.style.height = `${this.cropH * scaleY}px`;
  }

  syncVideoToCropBox() {
    if (!this.videoWidth || !this.videoHeight) return;
    const rect = this.videoEl.getBoundingClientRect();
    const scaleX = this.videoWidth / rect.width;
    const scaleY = this.videoHeight / rect.height;

    const relX = (parseFloat(this.cropOverlay.style.left) || 0) - this.videoEl.offsetLeft;
    const relY = (parseFloat(this.cropOverlay.style.top) || 0) - this.videoEl.offsetTop;

    this.cropX = Math.max(0, Math.round(relX * scaleX));
    this.cropY = Math.max(0, Math.round(relY * scaleY));
    this.cropW = Math.max(16, Math.round((parseFloat(this.cropOverlay.style.width) || 0) * scaleX));
    this.cropH = Math.max(16, Math.round((parseFloat(this.cropOverlay.style.height) || 0) * scaleY));
  }

  applyToNode() {
    const setWidgetVal = (name, val) => {
      const w = this.node.widgets?.find((item) => item.name === name);
      if (w) {
        w.value = val;
        w.callback?.(val);
      }
    };

    setWidgetVal("start_time", this.startTime);
    setWidgetVal("segment_duration", this.segmentDuration);
    if (this.cropActive) {
      setWidgetVal("crop_x", this.cropX);
      setWidgetVal("crop_y", this.cropY);
      setWidgetVal("crop_width", this.cropW);
      setWidgetVal("crop_height", this.cropH);
    } else {
      setWidgetVal("crop_x", 0);
      setWidgetVal("crop_y", 0);
      setWidgetVal("crop_width", 0);
      setWidgetVal("crop_height", 0);
    }

    this.node.setDirtyCanvas(true, true);
    this.dispose();
  }
}
