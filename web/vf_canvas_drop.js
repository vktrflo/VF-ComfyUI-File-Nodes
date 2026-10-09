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

function getMimeType(filename = "", mediaType = "") {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  };
  if (map[ext]) return map[ext];
  if (mediaType === "image") return "image/png";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "audio") return "audio/mpeg";
  return "application/octet-stream";
}

function getCanvasCoordinates(e, activeCanvas) {
  let canvasX = 100;
  let canvasY = 100;
  if (!activeCanvas) return [canvasX, canvasY];

  try {
    activeCanvas.adjustMouseEvent?.(e);
  } catch (_) {}

  if (typeof e.canvasX === "number" && typeof e.canvasY === "number") {
    canvasX = e.canvasX;
    canvasY = e.canvasY;
  } else if (activeCanvas.convertEventToCanvasOffset) {
    const pos = activeCanvas.convertEventToCanvasOffset(e);
    canvasX = pos[0];
    canvasY = pos[1];
  } else if (activeCanvas.graph_mouse) {
    canvasX = activeCanvas.graph_mouse[0];
    canvasY = activeCanvas.graph_mouse[1];
  }

  if (activeCanvas.graph_mouse) {
    activeCanvas.graph_mouse[0] = canvasX;
    activeCanvas.graph_mouse[1] = canvasY;
  }

  return [canvasX, canvasY];
}

function handleVfNodeCreation(e, data) {
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

    const activeCanvas = app.canvas || window.LGraphCanvas?.active_canvas;
    const pos = getCanvasCoordinates(e, activeCanvas);

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
}

async function handleBuiltinDrop(e, data) {
  const activeCanvas = app.canvas || window.LGraphCanvas?.active_canvas;
  const [canvasX, canvasY] = getCanvasCoordinates(e, activeCanvas);

  document.body.style.cursor = "wait";
  try {
    const fileUrl = `/api/vf-file-nodes/view?path=${encodeURIComponent(data.path)}`;
    const res = await fetch(fileUrl);
    if (!res.ok) {
      console.error(`[VF File Nodes] Failed to fetch file for built-in drop: ${res.statusText}`);
      return;
    }
    const blob = await res.blob();
    const fileName = data.name || data.path.split(/[/\\]/).pop() || "file";
    const mimeType = blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : getMimeType(fileName, data.media_type);
    const fileObj = new File([blob], fileName, { type: mimeType });

    // 1. If dropped directly onto an existing node that accepts pasted/dropped files
    if (activeCanvas?.graph) {
      const targetNode = activeCanvas.graph.getNodeOnPos?.(canvasX, canvasY);
      if (targetNode) {
        if (typeof targetNode.pasteFiles === "function") {
          try {
            const accepted = await targetNode.pasteFiles([fileObj]);
            if (accepted) {
              activeCanvas.setDirty(true, true);
              return;
            }
          } catch (_) {}
        } else if (typeof targetNode.pasteFile === "function") {
          try {
            const accepted = await targetNode.pasteFile(fileObj);
            if (accepted) {
              activeCanvas.setDirty(true, true);
              return;
            }
          } catch (_) {}
        }
      }
    }

    // 2. Delegate to ComfyUI's standard drop handler
    if (activeCanvas?.graph_mouse) {
      activeCanvas.graph_mouse[0] = canvasX;
      activeCanvas.graph_mouse[1] = canvasY;
    }

    if (typeof app.handleFile === "function") {
      await app.handleFile(fileObj, "file_drop");
    } else if (typeof app.handleFileList === "function" && data.media_type === "image") {
      await app.handleFileList([fileObj]);
    } else {
      console.warn("[VF File Nodes] No built-in ComfyUI file drop handler found on app.");
    }
    activeCanvas?.setDirty(true, true);
  } catch (err) {
    console.error("[VF File Nodes] Error handling built-in canvas drop:", err);
  } finally {
    document.body.style.cursor = "";
  }
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
    if (currentDraggedFile?.path) {
      return currentDraggedFile;
    }
    try {
      const raw = e.dataTransfer?.getData(MIME_VF_FILE);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  };

  const onDragOver = (e) => {
    if (isVfDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    }
  };

  const onDrop = async (e) => {
    if (!isVfDrag(e)) return;

    // Ignore drops inside the embedded explorer widget itself
    if (e.target?.closest?.(".vf-embedded-explorer-container")) {
      clearDragPayload();
      return;
    }

    const data = getDragData(e);
    clearDragPayload();

    if (!data?.path) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    const enabled = app.ui.settings.getSettingValue("VF.FileNodes.EnableCanvasDrop", true);
    if (enabled) {
      handleVfNodeCreation(e, data);
    } else {
      await handleBuiltinDrop(e, data);
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
