/**
 * Canvas Drag & Drop Node Creation for VF ComfyUI File Nodes.
 * Disabled by default via ComfyUI Settings to prevent overriding native behavior.
 */

import { app } from "../../scripts/app.js";

const MIME_VF_FILE = "application/x-vf-file";

export function setupDragPayload(event, file) {
  if (!event?.dataTransfer || !file) return;
  const payload = JSON.stringify({
    path: file.path,
    name: file.name,
    media_type: file.media_type,
  });
  event.dataTransfer.setData(MIME_VF_FILE, payload);
  event.dataTransfer.setData("text/plain", file.path);
}

export function setupCanvasDrop() {
  const canvas = app.canvas?.canvas || document.querySelector("canvas");
  if (!canvas) return;

  canvas.addEventListener("dragover", (e) => {
    // Only intercept if our setting is enabled
    const enabled = app.ui.settings.getSettingValue("VF.FileNodes.EnableCanvasDrop", false);
    if (!enabled) return;

    if (e.dataTransfer.types.includes(MIME_VF_FILE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });

  canvas.addEventListener("drop", (e) => {
    const enabled = app.ui.settings.getSettingValue("VF.FileNodes.EnableCanvasDrop", false);
    if (!enabled) return;

    const raw = e.dataTransfer.getData(MIME_VF_FILE);
    if (!raw) return;

    try {
      const data = JSON.parse(raw);
      if (!data?.path || !data?.media_type) return;

      e.preventDefault();
      e.stopPropagation();

      let nodeType = "VFLoadImage";
      let widgetName = "image_path";

      if (data.media_type === "video") {
        nodeType = "VFLoadVideo";
        widgetName = "video_path";
      } else if (data.media_type === "audio") {
        nodeType = "VFLoadAudio";
        widgetName = "audio_path";
      }

      const node = LiteGraph.createNode(nodeType);
      if (!node) return;

      // Position node at canvas drop coordinates
      const pos = app.canvas.convertEventToCanvasOffset(e);
      node.pos = [pos[0] - 100, pos[1] - 50];

      app.graph.add(node);

      const targetWidget = node.widgets?.find((w) => w.name === widgetName);
      if (targetWidget) {
        targetWidget.value = data.path;
        targetWidget.callback?.(data.path);
      }

      app.canvas.setDirty(true, true);
    } catch (err) {
      console.error("[VF File Nodes] Drop error:", err);
    }
  });
}
