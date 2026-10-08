/**
 * UI extension for 🌀 VF Load Image (Browse modal, thumbnail preview, dimension badge).
 */

import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement } from "./vf_ui_shared.js";

export function setupLoadImageNode(nodeType, nodeData) {
  const origOnNodeCreated = nodeType.prototype.onNodeCreated;

  nodeType.prototype.onNodeCreated = function () {
    const res = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
    const node = this;

    setTimeout(() => {
      const imagePathWidget = node.widgets?.find((w) => w.name === "image_path");
      const longestSizeWidget = node.widgets?.find((w) => w.name === "longest_size");

      // 1. Add "Browse Files" button
      if (imagePathWidget && !node.widgets?.some((w) => w._vfBrowseBtn)) {
        const browseBtn = node.addWidget("button", "📁 Browse Images", null, () => {
          openFileBrowserModal(node, imagePathWidget, { filter: "image" });
        }, { serialize: false });
        if (browseBtn) browseBtn._vfBrowseBtn = true;
      }

      // 2. Add preview container widget
      if (!node.widgets?.some((w) => w._vfPreviewWidget)) {
        const previewEl = createElement("div", "vf-image-preview-box");
        Object.assign(previewEl.style, {
          width: "100%",
          minHeight: "140px",
          maxHeight: "240px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#181820",
          borderRadius: "6px",
          border: "1px solid #333342",
          overflow: "hidden",
          padding: "6px",
          boxSizing: "border-box",
        });

        const imgEl = document.createElement("img");
        Object.assign(imgEl.style, {
          maxWidth: "100%",
          maxHeight: "180px",
          objectFit: "contain",
          borderRadius: "4px",
          display: "none",
        });

        const badgeEl = createElement("div", "vf-dimension-badge", "");
        Object.assign(badgeEl.style, {
          fontSize: "11px",
          fontFamily: "monospace",
          color: "#99a",
          marginTop: "6px",
          display: "none",
          background: "#22222c",
          padding: "2px 8px",
          borderRadius: "4px",
        });

        previewEl.appendChild(imgEl);
        previewEl.appendChild(badgeEl);

        const updatePreview = () => {
          const path = imagePathWidget?.value;
          if (!path) {
            imgEl.style.display = "none";
            badgeEl.style.display = "none";
            return;
          }

          imgEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(path)}`;
          imgEl.style.display = "block";
          imgEl.onload = () => {
            const origW = imgEl.naturalWidth;
            const origH = imgEl.naturalHeight;
            const longest = parseInt(longestSizeWidget?.value) || 0;

            if (longest > 0 && Math.max(origW, origH) > longest) {
              const scale = longest / Math.max(origW, origH);
              const scaledW = Math.round(origW * scale);
              const scaledH = Math.round(origH * scale);
              badgeEl.textContent = `${scaledW} × ${scaledH} (orig: ${origW} × ${origH})`;
            } else {
              badgeEl.textContent = `${origW} × ${origH}`;
            }
            badgeEl.style.display = "block";
            node.setDirtyCanvas(true, true);
          };
          imgEl.onerror = () => {
            imgEl.style.display = "none";
            badgeEl.style.display = "none";
          };
        };

        if (imagePathWidget) {
          const origCb = imagePathWidget.callback;
          imagePathWidget.callback = function (v) {
            origCb?.apply(this, arguments);
            updatePreview();
          };
        }

        if (longestSizeWidget) {
          const origLcb = longestSizeWidget.callback;
          longestSizeWidget.callback = function (v) {
            origLcb?.apply(this, arguments);
            updatePreview();
          };
        }

        const domWidget = node.addDOMWidget("image_preview", "preview", previewEl, {
          serialize: false,
          hideOnZoom: false,
        });
        domWidget._vfPreviewWidget = true;

        if (imagePathWidget?.value) {
          updatePreview();
        }
      }
    }, 10);

    return res;
  };
}
