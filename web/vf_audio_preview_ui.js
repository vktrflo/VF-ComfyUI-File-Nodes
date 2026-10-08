/**
 * UI extension for 🌀 VF Load Audio (Browse modal and audio player preview).
 */

import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement } from "./vf_ui_shared.js";

export function setupLoadAudioNode(nodeType, nodeData) {
  const origOnNodeCreated = nodeType.prototype.onNodeCreated;

  nodeType.prototype.onNodeCreated = function () {
    const res = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
    const node = this;

    setTimeout(() => {
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
        });
        domWidget._vfAudioPreviewWidget = true;

        if (audioPathWidget?.value) {
          updateAudio();
        }
      }
    }, 10);

    return res;
  };
}
