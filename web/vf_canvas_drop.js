/**
 * Canvas Drag & Drop Node Creation for VF ComfyUI File Nodes.
 * Dragging a media file from VF File Explorer onto the canvas automatically
 * creates and configures the corresponding VF loader node (VFLoadImage, VFLoadVideo, VFLoadAudio).
 */

import { app } from "../../scripts/app.js";

const MIME_VF_FILE = "application/x-vf-file";

let currentDraggedFile = null;

export function setupDragPayload(event, file) {
  if (!event?.dataTransfer || !file) return;
  currentDraggedFile = file;
  const payload = JSON.stringify({
    path: file.path,
    name: file.name,
    media_type: file.media_type,
  });
  try {
    event.dataTransfer.setData(MIME_VF_FILE, payload);
    event.dataTransfer.setData("text/plain", file.path);
    event.dataTransfer.effectAllowed = "copy";
  } catch (e) {}
}

export function clearDragPayload() {
  currentDraggedFile = null;
}

export function setupCanvasDrop() {
  const isVfDrag = (e) => {
    if (currentDraggedFile) return true;
    try {
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes(MIME_VF_FILE)) return true;
    } catch (_) {}
    return false;
  };

  const getDragData = (e) => {
    if (currentDraggedFile?.path && currentDraggedFile?.media_type) {
      return currentDraggedFile;
    }
    try {
      const raw = e.dataTransfer?.getData(MIME_VF_FILE);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  };

  const onDragOver = (e) => {
    const enabled = app.ui.settings.getSettingValue("VF.FileNodes.EnableCanvasDrop", true);
    if (!enabled) return;

    if (isVfDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    }
  };

  const onDrop = (e) => {
    const enabled = app.ui.settings.getSettingValue("VF.FileNodes.EnableCanvasDrop", true);
    if (!enabled) return;

    if (!isVfDrag(e)) return;

    // Ignore drops inside the embedded explorer widget itself
    if (e.target?.closest?.(".vf-embedded-explorer-container")) {
      clearDragPayload();
      return;
    }

    const data = getDragData(e);
    clearDragPayload();

    if (!data?.path || !data?.media_type) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    let nodeType = "VFLoadImage";
    let widgetName = "image_path";

    if (data.media_type === "video") {
      nodeType = "VFLoadVideo";
      widgetName = "video_path";
    } else if (data.media_type === "audio") {
      nodeType = "VFLoadAudio";
      widgetName = "audio_path";
    } else if (data.media_type !== "image") {
      return;
    }

    try {
      const node = LiteGraph.createNode(nodeType);
      if (!node) {
        console.warn(`[VF File Nodes] Could not create node of type: ${nodeType}`);
        return;
      }

      // Convert event coordinates to canvas offset
      let pos = [100, 100];
      const activeCanvas = app.canvas || window.LGraphCanvas?.active_canvas;
      if (activeCanvas?.convertEventToCanvasOffset) {
        pos = activeCanvas.convertEventToCanvasOffset(e);
      } else if (activeCanvas?.graph_mouse) {
        pos = activeCanvas.graph_mouse;
      }

      // Center node near drop point
      node.pos = [pos[0] - 120, pos[1] - 40];
      app.graph.add(node);

      // Set the path widget immediately
      const targetWidget = node.widgets?.find((w) => w.name === widgetName);
      if (targetWidget) {
        targetWidget.value = data.path;
        targetWidget.callback?.(data.path);
      }

      // Defer slightly in case onNodeCreated has deferred widget setup
      setTimeout(() => {
        const w = node.widgets?.find((item) => item.name === widgetName);
        if (w) {
          w.value = data.path;
          w.callback?.(data.path);
        }
        activeCanvas?.setDirty(true, true);
      }, 50);

      activeCanvas?.selectNode?.(node);
      activeCanvas?.setDirty(true, true);
    } catch (err) {
      console.error("[VF File Nodes] Canvas drop node creation error:", err);
    }
  };

  // Capture drag & drop globally on window so elements layered over canvas don't swallow the event
  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("dragend", clearDragPayload, true);

  // Also bind directly on canvas element
  const canvasEl = app.canvas?.canvas || document.querySelector("canvas");
  if (canvasEl) {
    canvasEl.addEventListener("dragover", onDragOver, false);
    canvasEl.addEventListener("drop", onDrop, false);
  }
}
