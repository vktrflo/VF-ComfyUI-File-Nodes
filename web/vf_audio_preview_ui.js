/**
 * UI extension for 🌀 VF Load Audio (Browse modal and audio player preview).
 */

import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement, ensureSpinnerStyles } from "./vf_ui_shared.js";

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 240;

export function setupLoadAudioNode(nodeType, nodeData) {
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
      ensureSpinnerStyles();

      const audioPathWidget = node.widgets?.find((w) => w.name === "audio_path");

      // 1. Add "Browse Files" button
      if (audioPathWidget && !node.widgets?.some((w) => w._vfBrowseBtn)) {
        const browseBtn = node.addWidget("button", "📁 Browse Audio", null, () => {
          openFileBrowserModal(node, audioPathWidget, { filter: "audio" });
        }, { serialize: false });
        if (browseBtn) browseBtn._vfBrowseBtn = true;
      }

      // 2. Add audio preview player widget
      if (!node.widgets?.some((w) => w._vfAudioPreviewWidget)) {
        const container = createElement("div", "vf-audio-preview-box");
        Object.assign(container.style, {
          width: "100%",
          padding: "8px",
          background: "#181820",
          borderRadius: "6px",
          border: "1px solid #333342",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          boxSizing: "border-box",
        });

        const audioEl = document.createElement("audio");
        audioEl.style.display = "none";

        const playBtn = createElement("button", "", "▶ Play");
        Object.assign(playBtn.style, {
          background: "#2a2a3a",
          color: "#fff",
          border: "1px solid #444",
          borderRadius: "4px",
          padding: "4px 10px",
          fontSize: "11px",
          cursor: "pointer",
        });

        const timeLabel = createElement("div", "", "--:-- / --:--");
        Object.assign(timeLabel.style, {
          fontSize: "11px",
          fontFamily: "monospace",
          color: "#aaa",
          flex: "1",
        });

        playBtn.onclick = () => {
          if (audioEl.paused) {
            audioEl.play();
            playBtn.textContent = "⏸ Pause";
          } else {
            audioEl.pause();
            playBtn.textContent = "▶ Play";
          }
        };

        const formatTime = (secs) => {
          const m = Math.floor(secs / 60);
          const s = Math.floor(secs % 60);
          return `${m}:${s < 10 ? "0" : ""}${s}`;
        };

        audioEl.ontimeupdate = () => {
          const cur = formatTime(audioEl.currentTime || 0);
          const dur = formatTime(audioEl.duration || 0);
          timeLabel.textContent = `${cur} / ${dur}`;
        };

        audioEl.onended = () => {
          playBtn.textContent = "▶ Play";
        };

        const updateAudio = () => {
          const path = audioPathWidget?.value;
          if (path) {
            audioEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(path)}`;
            timeLabel.textContent = "Ready to play";
            playBtn.disabled = false;
          } else {
            audioEl.src = "";
            timeLabel.textContent = "No audio loaded";
            playBtn.disabled = true;
          }
        };

        if (audioPathWidget) {
          const origCb = audioPathWidget.callback;
          audioPathWidget.callback = function (v) {
            origCb?.apply(this, arguments);
            updateAudio();
          };
        }

        container.appendChild(audioEl);
        container.appendChild(playBtn);
        container.appendChild(timeLabel);

        const domWidget = node.addDOMWidget("audio_preview", "preview", container, {
          serialize: false,
          hideOnZoom: false,
          getMinHeight: () => 48,
        });
        domWidget._vfAudioPreviewWidget = true;

        if (domWidget) {
          domWidget.computeLayoutSize = () => ({
            minHeight: 48,
            maxHeight: undefined,
            minWidth: 200,
          });
        }

        if (Array.isArray(node.size) && node.size[1] < DEFAULT_HEIGHT) {
          if (typeof node.setSize === "function") {
            node.setSize([Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT]);
          } else {
            node.size = [Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT];
          }
        }
        node.setDirtyCanvas(true, true);

        if (audioPathWidget?.value) {
          updateAudio();
        }
      }
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

  const origOnResize = nodeType.prototype.onResize;
  nodeType.prototype.onResize = function (size) {
    const res = origOnResize ? origOnResize.apply(this, arguments) : undefined;
    return res;
  };
}
