/**
 * Main Web Extension for VF ComfyUI File Nodes.
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { setupCanvasDrop } from "./vf_canvas_drop.js";
import { ensureSpinnerStyles } from "./vf_ui_shared.js";
import { setupFileExplorerNode } from "./vf_file_explorer_ui.js";
import { setupLoadImageNode } from "./vf_image_preview_ui.js";
import { setupLoadVideoNode } from "./vf_video_scrubber_modal.js";
import { setupLoadAudioNode } from "./vf_audio_preview_ui.js";

const EXTENSION_NAME = "VF.FileNodes";

const VF_DEFAULT_SIZES = {
  VFFileExplorer: [640, 680],
  VFLoadImage: [260, 380],
  VFLoadVideo: [320, 440],
  VFLoadAudio: [260, 240],
};

/**
 * Recalculate dimensions and update height on the canvas for all custom nodes in this library.
 * When switching to legacy mode, shrinks nodes back to their default or saved legacy height
 * so empty space at the bottom is removed.
 *
 * @param {boolean} [isVueNodes] Whether Nodes 2.0 (Vue nodes) is active.
 */
export function refreshAllVFNodeDimensions(isVueNodes) {
  const vueMode = typeof isVueNodes === "boolean"
    ? isVueNodes
    : Boolean(window.LiteGraph?.vueNodesMode);

  const graph = app.graph;
  const nodes = graph?._nodes || [];

  for (const node of nodes) {
    if (!node) continue;
    const type = node.type || node.comfyClass;
    const isVFNode = Boolean(VF_DEFAULT_SIZES[type] || node._vfRecalculateDimensions);
    if (!isVFNode) continue;

    if (typeof node._vfRecalculateDimensions === "function") {
      node._vfRecalculateDimensions(vueMode);
    } else {
      // Fallback if node has not registered custom _vfRecalculateDimensions
      if (typeof node._vfUpdateWidgetDimensions === "function") {
        node._vfUpdateWidgetDimensions();
      }
      if (typeof node._vfUpdateImageWidgetDimensions === "function") {
        node._vfUpdateImageWidgetDimensions();
      }
      if (typeof node._vfUpdateAudioWidgetDimensions === "function") {
        node._vfUpdateAudioWidgetDimensions();
      }
      if (node._vfVideoScrubber?.updateLayout) {
        node._vfVideoScrubber.updateLayout();
      }

      if (!vueMode) {
        const defaults = VF_DEFAULT_SIZES[type] || [260, 380];
        const targetWidth = Math.max(node.size?.[0] || defaults[0], defaults[0]);
        const targetHeight = node._vfLegacyHeight
          ? Math.max(node._vfLegacyHeight, defaults[1])
          : defaults[1];

        if (typeof node.setSize === "function") {
          node.setSize([targetWidth, targetHeight]);
        } else if (Array.isArray(node.size)) {
          node.size[0] = targetWidth;
          node.size[1] = targetHeight;
        }
      }
      node.setDirtyCanvas?.(true, true);
    }
  }

  app.canvas?.setDirty(true, true);
}

function extractSettingValue(e) {
  if (e == null) return undefined;
  if (typeof e === "boolean") return e;
  if (typeof e.detail === "boolean") return e.detail;
  if (e.detail && typeof e.detail.value === "boolean") return e.detail.value;
  return undefined;
}

let _toggleHandlerRegistered = false;

/**
 * Register listeners for Nodes 2.0 toggle changes.
 */
export function setupVueNodesToggleHandler() {
  if (_toggleHandlerRegistered) return;
  _toggleHandlerRegistered = true;

  const handleToggle = (enabled) => {
    const isVue = typeof enabled === "boolean" ? enabled : extractSettingValue(enabled);
    refreshAllVFNodeDimensions(isVue);
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => refreshAllVFNodeDimensions(isVue));
    }
    setTimeout(() => refreshAllVFNodeDimensions(isVue), 50);
    setTimeout(() => refreshAllVFNodeDimensions(isVue), 200);
  };

  // 1. Listen on app.ui.settings event targets
  const settings = app.ui?.settings;
  if (settings && typeof settings.addEventListener === "function") {
    settings.addEventListener("Comfy.VueNodes.Enabled.change", handleToggle);
    settings.addEventListener("change", (e) => {
      const id = e?.detail?.id ?? e?.detail?.key;
      if (id === "Comfy.VueNodes.Enabled") {
        handleToggle(e.detail?.value);
      }
    });

    // Hook setSettingValue as well
    const origSetSettingValue = settings.setSettingValue;
    if (typeof origSetSettingValue === "function") {
      settings.setSettingValue = function (id, val) {
        const ret = origSetSettingValue.apply(this, arguments);
        if (id === "Comfy.VueNodes.Enabled") {
          handleToggle(val);
        }
        return ret;
      };
    }
  }

  // 2. Listen on app.extensionManager?.setting if present
  if (app.extensionManager?.setting) {
    const origExtSet = app.extensionManager.setting.set;
    if (typeof origExtSet === "function") {
      app.extensionManager.setting.set = function (id, val) {
        const ret = origExtSet.apply(this, arguments);
        if (id === "Comfy.VueNodes.Enabled") {
          handleToggle(val);
        }
        return ret;
      };
    }
  }

  // 3. Listen on api event target
  if (typeof api !== "undefined" && api?.addEventListener) {
    api.addEventListener("Comfy.VueNodes.Enabled.change", handleToggle);
  }

  // 4. Listen on window
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("Comfy.VueNodes.Enabled.change", handleToggle);
  }

  // 5. Reactive setter on LiteGraph.vueNodesMode
  if (typeof window !== "undefined" && window.LiteGraph) {
    let currentVueMode = window.LiteGraph.vueNodesMode;
    try {
      Object.defineProperty(window.LiteGraph, "vueNodesMode", {
        get() {
          return currentVueMode;
        },
        set(val) {
          const changed = currentVueMode !== val;
          currentVueMode = val;
          if (changed) {
            handleToggle(val);
          }
        },
        configurable: true,
        enumerable: true,
      });
    } catch (_) {}
  }
}

app.registerExtension({
  name: EXTENSION_NAME,
  async setup() {
    ensureSpinnerStyles();
    // Register ComfyUI Settings
    app.ui.settings.addSetting({
      id: "VF.FileNodes.EnableCanvasDrop",
      name: "🌀 VF File Nodes: Enable Canvas Drag & Drop Node Creation",
      type: "boolean",
      defaultValue: true,
      tooltip: "When enabled, dragging a file from VF File Explorer onto the canvas creates VF loader nodes (VFLoadImage, VFLoadVideo, VFLoadAudio). When disabled, uses ComfyUI's built-in file drop handler.",
    });

    setupCanvasDrop();
    setupVueNodesToggleHandler();
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === "VFFileExplorer") {
      setupFileExplorerNode(nodeType, nodeData);
    } else if (nodeData.name === "VFLoadImage") {
      setupLoadImageNode(nodeType, nodeData);
    } else if (nodeData.name === "VFLoadVideo") {
      setupLoadVideoNode(nodeType, nodeData);
    } else if (nodeData.name === "VFLoadAudio") {
      setupLoadAudioNode(nodeType, nodeData);
    }
  },
});
