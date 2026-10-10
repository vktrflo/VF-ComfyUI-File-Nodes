/**
 * UI extension for 🌀 VF Load Image (Browse modal, thumbnail preview, visual crop & resize).
 */

import { openFileBrowserModal } from "./vf_file_browser_modal.js";
import { createElement, ensureSpinnerStyles } from "./vf_ui_shared.js";

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 380;
const FIELDS = ["image_path", "longest_side", "longest_size", "crop_x", "crop_y", "crop_width", "crop_height"];
const LONGEST_SIDE_TOOLTIP =
  "Resizes the image output so its longest dimension (width or height) matches this pixel size while preserving aspect ratio. Set to 0 to keep the original resolution.";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const widget = (node, name) => node.widgets?.find((w) => w.name === name);
const isLinked = (node, name) =>
  Boolean(node?.inputs?.some((input) => (input.widget?.name === name || input.name === name) && input.link != null));

function hideImageWidgets(node) {
  for (const name of FIELDS) {
    if (name === "image_path") continue;
    const w = widget(node, name);
    if (!w || w.type?.startsWith("converted-widget")) continue;
    w.type = "hidden";
    w.computeSize = () => [0, -4];
    w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0 });
  }
}

const readState = (node) => Object.fromEntries(FIELDS.map((name) => [name, widget(node, name)?.value]));

function writeState(node, values) {
  for (const [name, value] of Object.entries(values)) {
    const w = widget(node, name);
    if (w && !isLinked(node, name)) w.value = value;
    if (name === "longest_side") {
      const leg = widget(node, "longest_size");
      if (leg && !isLinked(node, "longest_size")) leg.value = value;
    } else if (name === "longest_size") {
      const side = widget(node, "longest_side");
      if (side && !isLinked(node, "longest_side")) side.value = value;
    }
  }
  for (const [name, value] of Object.entries(values)) {
    if (!isLinked(node, name)) widget(node, name)?.callback?.(value);
  }
  node.setDirtyCanvas(true, true);
}

function styled(tag, styles, text = "") {
  const el = createElement(tag, "", text);
  Object.assign(el.style, styles);
  return el;
}

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

export class VFImageCropper {
  constructor(node, onChange) {
    this.node = node;
    this.onChange = onChange;
    this.ready = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.state = {};

    this.root = styled("div", {
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
      fontFamily: "Inter, system-ui, sans-serif",
    });

    this.wrapper = styled("div", {
      position: "relative",
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#101014",
      overflow: "hidden",
      borderRadius: "4px",
      minHeight: "140px",
      flex: "1 1 0",
    });

    this.imgEl = document.createElement("img");
    Object.assign(this.imgEl.style, {
      maxWidth: "100%",
      maxHeight: "100%",
      objectFit: "contain",
      borderRadius: "4px",
      display: "none",
      userSelect: "none",
    });

    this.cropOverlay = styled("div", {
      position: "absolute",
      boxSizing: "border-box",
      border: "2px dashed #00aaff",
      background: "rgba(0,170,255,.15)",
      cursor: "move",
      touchAction: "none",
      display: "none",
    });

    this.wrapper.append(this.imgEl, this.cropOverlay);

    // Corner resize handles
    this.cropHandles = {};
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = styled("div", {
        position: "absolute",
        width: "10px",
        height: "10px",
        background: "#00aaff",
        border: "1px solid #101014",
        boxSizing: "border-box",
        cursor: `${corner}-resize`,
        touchAction: "none",
        [corner.includes("n") ? "top" : "bottom"]: "-5px",
        [corner.includes("w") ? "left" : "right"]: "-5px",
      });
      handle.title = "Drag to resize crop";
      handle.onpointerdown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!this.ready || this.cropLinked()) return;
        const bounds = this.imageBounds();
        if (!bounds) return;
        const minW = Math.min(16, this.naturalWidth), minH = Math.min(16, this.naturalHeight);
        const left = clamp(Number(this.state.crop_x) || 0, 0, this.naturalWidth - minW);
        const top = clamp(Number(this.state.crop_y) || 0, 0, this.naturalHeight - minH);
        const right = clamp(left + (Number(this.state.crop_width) || this.naturalWidth), left + minW, this.naturalWidth);
        const bottom = clamp(top + (Number(this.state.crop_height) || this.naturalHeight), top + minH, this.naturalHeight);
        const x = e.clientX, y = e.clientY;
        this.startDrag((ev) => {
          const rect = this.wrapper.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const dx = Math.round(((ev.clientX - x) * this.wrapper.clientWidth) / rect.width / bounds.scale);
          const dy = Math.round(((ev.clientY - y) * this.wrapper.clientHeight) / rect.height / bounds.scale);
          const newLeft = corner.includes("w") ? clamp(left + dx, 0, right - minW) : left;
          const newTop = corner.includes("n") ? clamp(top + dy, 0, bottom - minH) : top;
          const newRight = corner.includes("e") ? clamp(right + dx, left + minW, this.naturalWidth) : right;
          const newBottom = corner.includes("s") ? clamp(bottom + dy, top + minH, this.naturalHeight) : bottom;
          this.change({
            crop_x: newLeft,
            crop_y: newTop,
            crop_width: newRight - newLeft,
            crop_height: newBottom - newTop,
          });
        }, e);
      };
      this.cropHandles[corner] = handle;
      this.cropOverlay.appendChild(handle);
    }

    // Drag crop overlay
    this.cropOverlay.onpointerdown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.ready || this.cropLinked()) return;
      const x = e.clientX, y = e.clientY;
      const cropX = Number(this.state.crop_x) || 0, cropY = Number(this.state.crop_y) || 0;
      this.startDrag((ev) => {
        const bounds = this.imageBounds();
        const rect = this.wrapper.getBoundingClientRect();
        if (!bounds || !rect.width || !rect.height) return;
        const dx = ((ev.clientX - x) * this.wrapper.clientWidth) / rect.width / bounds.scale;
        const dy = ((ev.clientY - y) * this.wrapper.clientHeight) / rect.height / bounds.scale;
        this.change({
          crop_x: clamp(Math.round(cropX + dx), 0, Math.max(0, this.naturalWidth - (Number(this.state.crop_width) || 0))),
          crop_y: clamp(Math.round(cropY + dy), 0, Math.max(0, this.naturalHeight - (Number(this.state.crop_height) || 0))),
        });
      }, e);
    };

    // Controls container
    this.controls = styled("div", {
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      marginTop: "6px",
      flexShrink: "0",
    });

    const row = styled("div", {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      alignItems: "flex-end",
      justifyContent: "space-between",
      width: "100%",
    });

    const leftControls = styled("div", {
      display: "inline-flex",
      alignItems: "flex-end",
      gap: "8px",
    });
    this.leftControls = leftControls;

    const button = (text) =>
      styled(
        "button",
        {
          background: "#2a2a3a",
          color: "#ddd",
          border: "1px solid #444",
          borderRadius: "4px",
          padding: "5px 8px",
          cursor: "pointer",
          fontSize: "12px",
          height: "26px",
          boxSizing: "border-box",
        },
        text
      );

    this.cropToggleBtn = button("Enable Crop");
    this.cropToggleBtn.onclick = () => {
      if (!this.ready || this.cropLinked()) return;
      if (this.cropActive) {
        this.change({ crop_x: 0, crop_y: 0, crop_width: 0, crop_height: 0 });
      } else {
        const w = this.naturalWidth, h = this.naturalHeight;
        this.change({
          crop_x: Math.round(w * 0.1),
          crop_y: Math.round(h * 0.1),
          crop_width: Math.round(w * 0.8),
          crop_height: Math.round(h * 0.8),
        });
      }
    };

    const longestField = styled(
      "label",
      {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        fontSize: "11px",
        color: "#aaa",
      },
      "Resize to"
    );
    longestField.title = LONGEST_SIDE_TOOLTIP;

    const longestBox = styled("div", { display: "inline-flex", alignItems: "center", gap: "4px" });
    const longestInput = styled("input", {
      width: "68px",
      boxSizing: "border-box",
      padding: "3px 5px",
      background: "#101014",
      color: "#ddd",
      border: "1px solid #444",
      borderRadius: "3px",
      fontSize: "11px",
      height: "26px",
    });
    longestInput.type = "number";
    longestInput.min = 0;
    longestInput.max = 16384;
    longestInput.step = 1;
    longestInput.setAttribute("aria-label", "Resize to");
    longestInput.title = LONGEST_SIDE_TOOLTIP;
    const pxText = styled("span", { fontSize: "11px", color: "#888", userSelect: "none" }, "px");
    longestBox.append(longestInput, pxText);
    longestField.appendChild(longestBox);

    longestInput.onchange = () => {
      if (isLinked(this.node, "longest_side") || isLinked(this.node, "longest_size")) {
        this.refresh();
        return;
      }
      if (longestInput.value.trim() === "" || !Number.isFinite(Number(longestInput.value))) {
        longestInput.value = "0";
        this.change({ longest_side: 0, longest_size: 0 });
        return;
      }
      const val = clamp(Math.round(Number(longestInput.value)), 0, 16384);
      this.change({ longest_side: val, longest_size: val });
    };

    longestInput.onblur = () => {
      if (longestInput.value.trim() === "" || !Number.isFinite(Number(longestInput.value))) {
        longestInput.value = "0";
        if (!isLinked(this.node, "longest_side") && !isLinked(this.node, "longest_size")) {
          this.change({ longest_side: 0, longest_size: 0 });
        }
      }
    };

    this.advancedInputs = { longest_side: longestInput };
    leftControls.append(this.cropToggleBtn, longestField);

    // Dimension badge + status with help circle
    this.badgeEl = styled("div", {
      fontSize: "11px",
      fontFamily: "monospace",
      color: "#99a",
      background: "#22222c",
      padding: "3px 8px",
      borderRadius: "4px",
      display: "none",
      alignItems: "center",
      gap: "4px",
      whiteSpace: "nowrap",
      height: "26px",
      boxSizing: "border-box",
    });
    this.statusText = styled("span");
    this.cropResizeHelp = styled(
      "span",
      {
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        background: "#2a2a3e",
        border: "1px solid #666688",
        color: "#ddd",
        fontSize: "10px",
        fontWeight: "bold",
        lineHeight: "14px",
        textAlign: "center",
        cursor: "help",
        userSelect: "none",
        flexShrink: "0",
      },
      "?"
    );
    this.cropResizeHelp.setAttribute("aria-label", "Resize information");
    this.badgeEl.append(this.statusText, this.cropResizeHelp);

    row.append(leftControls, this.badgeEl);
    this.controls.appendChild(row);

    this.root.append(this.wrapper, this.controls);

    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }

    this.imgEl.onload = () => {
      cleanupCanvasPreview(this.node);
      this.naturalWidth = this.imgEl.naturalWidth || 0;
      this.naturalHeight = this.imgEl.naturalHeight || 0;
      this.ready = this.naturalWidth > 0 && this.naturalHeight > 0;
      this.imgEl.style.display = "block";
      this.node.imgs = [this.imgEl];
      this.node.imageIndex = 0;
      this.node.previewMediaType = "image";
      this.refresh();
      this.node.setDirtyCanvas(true, true);
    };

    this.imgEl.onerror = () => {
      this.ready = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.imgEl.style.display = "none";
      this.node.imgs = [];
      this.refresh();
    };

    this.update(readState(node));
  }

  cropLinked() {
    return ["crop_x", "crop_y", "crop_width", "crop_height"].some((name) => isLinked(this.node, name));
  }

  change(values) {
    Object.assign(this.state, values);
    this.refresh();
    this.onChange?.(values);
  }

  update(state) {
    const changedPath = state.image_path !== this.state.image_path;
    this.state = { ...state };
    if (changedPath) {
      this.stopDrag?.();
      this.ready = false;
      this.imgEl.removeAttribute("src");
      if (state.image_path) {
        const path = state.image_path;
        const filename = path.split(/[/\\]/).pop() || "image.png";
        this.imgEl.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(path)}&filename=${encodeURIComponent(filename)}&type=input`;
      } else {
        this.imgEl.style.display = "none";
        this.node.imgs = [];
      }
    }
    this.refresh();
  }

  outputDimensions() {
    if (!this.ready || !this.naturalWidth || !this.naturalHeight) return null;
    const isCropped = Boolean(this.cropActive && Number(this.state.crop_width) > 0 && Number(this.state.crop_height) > 0);
    let w = isCropped ? Number(this.state.crop_width) : this.naturalWidth;
    let h = isCropped ? Number(this.state.crop_height) : this.naturalHeight;
    const longest = Number(this.state.longest_side ?? this.state.longest_size) || 0;
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

  imageBounds() {
    if (!this.ready || !this.naturalWidth || !this.naturalHeight) return null;
    const width = this.wrapper.clientWidth, height = this.wrapper.clientHeight;
    const scale = Math.min(width / this.naturalWidth, height / this.naturalHeight);
    if (!(scale > 0)) return null;
    return {
      scale,
      left: (width - this.naturalWidth * scale) / 2,
      top: (height - this.naturalHeight * scale) / 2,
    };
  }

  syncCropBoxToImage() {
    const bounds = this.imageBounds();
    this.cropOverlay.style.display = bounds && this.cropActive ? "block" : "none";
    if (!bounds || !this.cropActive) return;
    const width = clamp(Number(this.state.crop_width) || 0, 0, this.naturalWidth);
    const height = clamp(Number(this.state.crop_height) || 0, 0, this.naturalHeight);
    Object.assign(this.cropOverlay.style, {
      left: `${bounds.left + clamp(Number(this.state.crop_x) || 0, 0, this.naturalWidth - width) * bounds.scale}px`,
      top: `${bounds.top + clamp(Number(this.state.crop_y) || 0, 0, this.naturalHeight - height) * bounds.scale}px`,
      width: `${width * bounds.scale}px`,
      height: `${height * bounds.scale}px`,
    });
  }

  refresh() {
    this.cropActive = Number(this.state.crop_width) > 0 && Number(this.state.crop_height) > 0;
    this.cropToggleBtn.textContent = this.cropActive ? "Disable Crop" : "Enable Crop";
    this.cropToggleBtn.disabled = !this.ready || this.cropLinked();
    this.cropOverlay.style.cursor = this.cropLinked() ? "default" : "move";
    for (const handle of Object.values(this.cropHandles)) {
      handle.style.display = this.cropLinked() ? "none" : "block";
    }

    const longestInput = this.advancedInputs?.longest_side;
    if (longestInput) {
      longestInput.value = this.state.longest_side ?? this.state.longest_size ?? "";
      longestInput.disabled = isLinked(this.node, "longest_side") || isLinked(this.node, "longest_size");
      longestInput.title = longestInput.disabled ? "Controlled by a connected input" : LONGEST_SIDE_TOOLTIP;
    }

    this.syncCropBoxToImage();
    this.updateBadge();
  }

  updateBadge() {
    if (!this.ready) {
      this.badgeEl.style.display = "none";
      return;
    }
    const dims = this.outputDimensions();
    if (!dims) {
      this.badgeEl.style.display = "none";
      return;
    }
    const dimText = dims.isCropped ? `Crop: ${dims.width} × ${dims.height}` : `${dims.width} × ${dims.height}`;
    this.statusText.textContent = dimText;

    const longest = Number(this.state.longest_side ?? this.state.longest_size) || 0;
    if (longest > 0) {
      if (dims.isCropped) {
        const cropW = Math.round(Number(this.state.crop_width)) || 0;
        const cropH = Math.round(Number(this.state.crop_height)) || 0;
        this.cropResizeHelp.title = `Output resolution: ${dims.width} × ${dims.height}px\nScaled from source crop (${cropW} × ${cropH}px) to fit 'Resize to' longest side (${longest}px).`;
      } else {
        this.cropResizeHelp.title = `Output resolution: ${dims.width} × ${dims.height}px\nScaled from original image (${this.naturalWidth} × ${this.naturalHeight}px) to fit 'Resize to' longest side (${longest}px).`;
      }
      this.cropResizeHelp.style.display = "inline-flex";
    } else {
      this.cropResizeHelp.style.display = "none";
      this.cropResizeHelp.title = "";
    }
    this.badgeEl.style.display = "inline-flex";
  }

  startDrag(move, startEvent) {
    this.stopDrag?.();
    const target = startEvent?.target;
    const pointerId = startEvent?.pointerId;
    if (target?.setPointerCapture && pointerId != null) {
      try {
        target.setPointerCapture(pointerId);
      } catch {}
    }
    const onLostCapture = () => this.stopDrag?.();
    target?.addEventListener?.("lostpointercapture", onLostCapture);
    const onMove = (ev) => {
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
    this.disposed = true;
    this.stopDrag?.();
    this.imgEl.onload = this.imgEl.onerror = null;
    this.imgEl.removeAttribute("src");
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
      hideImageWidgets(node);

      const imagePathWidget = widget(node, "image_path");

      // Add hidden "image" widget alias for MaskEditor saver writeback compatibility
      let imageWidget = widget(node, "image");
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
        const browseBtn = node.addWidget(
          "button",
          "📁 Browse Images",
          null,
          () => {
            openFileBrowserModal(node, imagePathWidget, { filter: "image" });
          },
          { serialize: false }
        );
        if (browseBtn) browseBtn._vfBrowseBtn = true;
      }

      // 2. Add cropper and preview container widget
      if (!node.widgets?.some((w) => w._vfPreviewWidget)) {
        const cropper = new VFImageCropper(node, (values) => writeState(node, values));
        node._vfImageCropper = cropper;

        const updateWidgetDimensions = () => {
          const isVueNodes = Boolean(
            window.LiteGraph?.vueNodesMode ||
              cropper.root.closest?.("[data-node-id]") ||
              cropper.root.closest?.(".lg-node")
          );

          if (!isVueNodes) {
            cropper.root.style.width = "100%";
            cropper.root.style.height = "100%";
            cropper.root.style.maxHeight = "none";
            cropper.root.style.minHeight = "0px";
            cropper.wrapper.style.height = "auto";
            cropper.wrapper.style.flex = "1 1 0";
          } else {
            cropper.root.style.width = "100%";
            cropper.root.style.height = "auto";
            cropper.root.style.maxHeight = "280px";
            cropper.root.style.minHeight = "160px";
            cropper.wrapper.style.height = "200px";
            cropper.wrapper.style.flex = "none";
          }
        };
        node._vfUpdateImageWidgetDimensions = updateWidgetDimensions;
        node._vfRecalculateDimensions = (isVueNodes) => {
          updateWidgetDimensions();
          const vue = typeof isVueNodes === "boolean"
            ? isVueNodes
            : Boolean(
                window.LiteGraph?.vueNodesMode ||
                cropper.root.closest?.("[data-node-id]") ||
                cropper.root.closest?.(".lg-node")
              );
          if (!vue) {
            const targetWidth = Math.max(node.size?.[0] || DEFAULT_WIDTH, DEFAULT_WIDTH);
            const targetHeight = node._vfLegacyHeight
              ? Math.max(node._vfLegacyHeight, DEFAULT_HEIGHT)
              : DEFAULT_HEIGHT;
            if (typeof node.setSize === "function") {
              node.setSize([targetWidth, targetHeight]);
            } else if (Array.isArray(node.size)) {
              node.size[0] = targetWidth;
              node.size[1] = targetHeight;
            }
            cropper.syncCropBoxToImage?.();
          }
          node.setDirtyCanvas?.(true, true);
        };
        updateWidgetDimensions();

        // Listen for external widget updates (e.g. connections or inspector changes)
        for (const name of FIELDS) {
          const w = widget(node, name);
          if (!w) continue;
          const origCb = w.callback;
          w.callback = function (v) {
            const ret = origCb?.apply(this, arguments);
            if (name === "image_path") {
              node.images = undefined;
              if (imageWidget) {
                if (
                  v &&
                  (v.includes("clipspace") ||
                    v.endsWith("[input]") ||
                    v.endsWith("[temp]") ||
                    v.endsWith("[output]"))
                ) {
                  imageWidget.value = v;
                } else {
                  imageWidget.value = "";
                }
              }
            }
            cropper.update(readState(node));
            return ret;
          };
        }

        const domWidget = node.addDOMWidget("image_preview", "preview", cropper.root, {
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
              cropper.syncCropBoxToImage();
            });
            const nodeWrapper = cropper.root.closest?.("[data-node-id]") || cropper.root.closest?.(".lg-node");
            if (nodeWrapper) {
              observer.observe(nodeWrapper);
            }
            updateWidgetDimensions();
          }, 100);
        }

        cropper.update(readState(node));
      }
    }, 10);

    return res;
  };

  const origOnConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const res = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
    cleanupCanvasPreview(this);
    hideImageWidgets(this);
    this.previewMediaType = "image";
    this.imageIndex = 0;
    if (Array.isArray(this.size)) {
      if (this.size[0] < DEFAULT_WIDTH) this.size[0] = DEFAULT_WIDTH;
      if (this.size[1] < DEFAULT_HEIGHT) this.size[1] = DEFAULT_HEIGHT;
    }
    this._vfUpdateImageWidgetDimensions?.();
    this._vfImageCropper?.update(readState(this));
    this._vfImageCropper?.syncCropBoxToImage();
    return res;
  };

  const origOnResize = nodeType.prototype.onResize;
  nodeType.prototype.onResize = function (size) {
    const res = origOnResize ? origOnResize.apply(this, arguments) : undefined;
    const isVue = Boolean(
      window.LiteGraph?.vueNodesMode ||
      this._vfImageCropper?.root?.closest?.("[data-node-id]") ||
      this._vfImageCropper?.root?.closest?.(".lg-node")
    );
    if (!isVue && Array.isArray(this.size) && this.size[1] > 0) {
      this._vfLegacyHeight = this.size[1];
    }
    this._vfUpdateImageWidgetDimensions?.();
    this._vfImageCropper?.syncCropBoxToImage();
    return res;
  };

  const origOnRemoved = nodeType.prototype.onRemoved;
  nodeType.prototype.onRemoved = function () {
    this._vfImageCropper?.dispose();
    return origOnRemoved ? origOnRemoved.apply(this, arguments) : undefined;
  };

  const origGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (_, options) {
    const res = origGetExtraMenuOptions ? origGetExtraMenuOptions.apply(this, arguments) : undefined;
    if (this.imgs?.length) {
      const hasMaskEditor = options?.some(
        (opt) =>
          opt &&
          (opt.content?.includes("MaskEditor") ||
            opt.content?.includes("Mask Editor") ||
            opt.label?.includes("Mask Editor"))
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
