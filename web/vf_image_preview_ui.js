/**
 * UI extension for 🌀 VF Load Image (Browse modal, thumbnail preview, dimension badge).
 */

import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement, ensureSpinnerStyles } from "./vf_ui_shared.js";

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 340;

function cleanupCanvasPreview(node) {
  if (node.widgets) {
    const idx = node.widgets.findIndex((w) => w.name === "$$canvas-image-preview");
    if (idx !== -1) {
      node.widgets[idx].onRemove?.();
      node.widgets.splice(idx, 1);
      if (typeof node.computeSize === "function" && typeof node.setSize === "function") {
        const sz = node.computeSize();
        node.setSize([
          Math.max(node.size?.[0] || DEFAULT_WIDTH, DEFAULT_WIDTH),
          Math.max(sz?.[1] || DEFAULT_HEIGHT, DEFAULT_HEIGHT),
        ]);
      }
      node.setDirtyCanvas(true, true);
    }
  }
}

export function setupLoadImageNode(nodeType, nodeData) {
  // Prevent ComfyUI from injecting $$canvas-image-preview since VFLoadImage has its own DOM preview widget
  const origAddCustomWidget = nodeType.prototype.addCustomWidget;
  nodeType.prototype.addCustomWidget = function (customWidget) {
    if (customWidget?.name === "$$canvas-image-preview") {
      return null;
    }
    return origAddCustomWidget ? origAddCustomWidget.apply(this, arguments) : null;
  };

  // Suppress ComfyUI's default updatePreviews injection on canvas draw
  nodeType.prototype.onDrawBackground = function (ctx) {
    cleanupCanvasPreview(this);
  };

  const origOnNodeCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const res = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
    const node = this;

    cleanupCanvasPreview(node);

    const instanceAddCustomWidget = node.addCustomWidget;
    if (instanceAddCustomWidget) {
      node.addCustomWidget = function (customWidget) {
        if (customWidget?.name === "$$canvas-image-preview") {
          return null;
        }
        return instanceAddCustomWidget.apply(this, arguments);
      };
    }

    // MaskEditor and image preview compatibility properties
    node.previewMediaType = "image";
    node.imageIndex = 0;
    node.imgs = [];

    // Set initial size
    node.size = [
      Math.max(node.size?.[0] || 0, DEFAULT_WIDTH),
      Math.max(node.size?.[1] || 0, DEFAULT_HEIGHT),
    ];

    setTimeout(() => {
      ensureSpinnerStyles();

      const imagePathWidget = node.widgets?.find((w) => w.name === "image_path");
      const longestSizeWidget = node.widgets?.find((w) => w.name === "longest_size");

      // Add hidden "image" widget alias for MaskEditor saver writeback compatibility
      let imageWidget = node.widgets?.find((w) => w.name === "image");
      if (!imageWidget) {
        imageWidget = {
          name: "image",
          type: "hidden",
          value: "",
          options: { serialize: false },
          computeSize: () => [0, -4],
          callback: function (val) {
            setTimeout(() => {
              if (val && imagePathWidget) {
                imagePathWidget.value = val;
                imagePathWidget.callback?.(val);
              }
            }, 0);
          },
        };
        node.widgets = node.widgets || [];
        node.widgets.push(imageWidget);
      }

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
          flex: "1 1 0",
          minHeight: "0px",
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
          flexShrink: "0",
        });

        previewEl.appendChild(imgEl);
        previewEl.appendChild(badgeEl);

        const updateWidgetDimensions = () => {
          const isVueNodes = Boolean(
            window.LiteGraph?.vueNodesMode ||
            previewEl.closest?.("[data-node-id]") ||
            previewEl.closest?.(".lg-node")
          );

          if (!isVueNodes) {
            // Legacy LiteGraph Canvas mode:
            // DOM widget overlay (.dom-widget) is sized by LiteGraph to fit the node body.
            // Container must fill the overlay with 100% height and no fixed pixel constraints.
            previewEl.style.width = "100%";
            previewEl.style.height = "100%";
            previewEl.style.maxHeight = "none";
            previewEl.style.minHeight = "0px";
            imgEl.style.maxHeight = "100%";
          } else {
            // Nodes 2.0 mode (Vue nodes):
            previewEl.style.width = "100%";
            previewEl.style.height = "auto";
            previewEl.style.maxHeight = "240px";
            previewEl.style.minHeight = "140px";
            imgEl.style.maxHeight = "180px";
          }
        };
        node._vfUpdateImageWidgetDimensions = updateWidgetDimensions;
        updateWidgetDimensions();

        const updatePreview = () => {
          const path = imagePathWidget?.value;
          if (!path) {
            imgEl.style.display = "none";
            badgeEl.style.display = "none";
            node.imgs = [];
            if (imageWidget) imageWidget.value = "";
            return;
          }

          const filename = path.split(/[/\\]/).pop() || "image.png";
          imgEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(path)}&filename=${encodeURIComponent(filename)}&type=input`;
          node.imgs = [imgEl];
          node.imageIndex = 0;
          node.previewMediaType = "image";

          // Sync hidden image widget only if it's an annotated/clipspace path
          if (imageWidget) {
            if (path.includes("clipspace") || path.endsWith("[input]") || path.endsWith("[temp]") || path.endsWith("[output]")) {
              imageWidget.value = path;
            } else {
              imageWidget.value = "";
            }
          }

          imgEl.style.display = "block";
          imgEl.onload = () => {
            cleanupCanvasPreview(node);
            node.imgs = [imgEl];
            node.imageIndex = 0;
            node.previewMediaType = "image";

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

            const isVueNodes = Boolean(
              window.LiteGraph?.vueNodesMode ||
              previewEl.closest?.("[data-node-id]") ||
              previewEl.closest?.(".lg-node")
            );
            if (!isVueNodes && Array.isArray(node.size)) {
              if (node.size[1] < DEFAULT_HEIGHT) {
                if (typeof node.setSize === "function") {
                  node.setSize([Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT]);
                } else {
                  node.size = [Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT];
                }
              }
            }
            updateWidgetDimensions();
            node.setDirtyCanvas(true, true);
          };
          imgEl.onerror = () => {
            node.imgs = [];
            imgEl.style.display = "none";
            badgeEl.style.display = "none";
          };
        };

        if (imagePathWidget) {
          const origCb = imagePathWidget.callback;
          imagePathWidget.callback = function (v) {
            node.images = undefined;
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
          getMinHeight: () => 180,
        });
        domWidget._vfPreviewWidget = true;

        if (domWidget) {
          domWidget.computeLayoutSize = () => ({
            minHeight: 180,
            maxHeight: undefined,
            minWidth: 220,
          });
        }

        if (Array.isArray(node.size) && node.size[1] < DEFAULT_HEIGHT) {
          if (typeof node.setSize === "function") {
            node.setSize([Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT]);
          } else {
            node.size = [Math.max(node.size[0], DEFAULT_WIDTH), DEFAULT_HEIGHT];
          }
        }
        updateWidgetDimensions();
        node.setDirtyCanvas(true, true);

        if (typeof ResizeObserver !== "undefined") {
          setTimeout(() => {
            const observer = new ResizeObserver(() => {
              updateWidgetDimensions();
            });
            const nodeWrapper = previewEl.closest?.("[data-node-id]") || previewEl.closest?.(".lg-node");
            if (nodeWrapper) {
              observer.observe(nodeWrapper);
            }
            updateWidgetDimensions();
          }, 100);
        }

        if (imagePathWidget?.value) {
          updatePreview();
        }
      }
    }, 10);

    return res;
  };

  const origOnConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const res = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
    cleanupCanvasPreview(this);
    this.previewMediaType = "image";
    this.imageIndex = 0;
    if (Array.isArray(this.size)) {
      if (this.size[0] < DEFAULT_WIDTH) this.size[0] = DEFAULT_WIDTH;
      if (this.size[1] < DEFAULT_HEIGHT) this.size[1] = DEFAULT_HEIGHT;
    }
    this._vfUpdateImageWidgetDimensions?.();
    return res;
  };

  const origOnResize = nodeType.prototype.onResize;
  nodeType.prototype.onResize = function (size) {
    const res = origOnResize ? origOnResize.apply(this, arguments) : undefined;
    this._vfUpdateImageWidgetDimensions?.();
    return res;
  };

  const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (_, options) {
    const res = origGetExtraMenuOptions ? origGetExtraMenuOptions.apply(this, arguments) : undefined;
    if (this.imgs?.length) {
      const hasMaskEditor = options?.some(
        (opt) => opt && (
          opt.content?.includes("MaskEditor") || 
          opt.content?.includes("Mask Editor") ||
          opt.label?.includes("Mask Editor")
        )
      );
      if (!hasMaskEditor && Array.isArray(options)) {
        options.push({
          content: "Open in MaskEditor | Image Canvas",
          callback: () => {
            if (window.app?.openMaskEditor) {
              window.app.openMaskEditor(this);
            } else if (window.app?.extensionManager?.command?.execute) {
              if (window.app.canvas) {
                window.app.canvas.selected_nodes = { [this.id]: this };
              }
              window.app.extensionManager.command.execute("Comfy.MaskEditor.OpenMaskEditor");
            }
          },
        });
      }
    }
    return res;
  };
}
