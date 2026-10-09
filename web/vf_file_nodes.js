/**
 * Main Web Extension for VF ComfyUI File Nodes.
 */

import { app } from "../../scripts/app.js";
import { setupCanvasDrop } from "./vf_canvas_drop.js";
import { setupFileExplorerNode } from "./vf_file_explorer_ui.js";
import { setupLoadImageNode } from "./vf_image_preview_ui.js";
import { setupLoadVideoNode } from "./vf_video_scrubber_modal.js";
import { setupLoadAudioNode } from "./vf_audio_preview_ui.js";

const EXTENSION_NAME = "VF.FileNodes";

app.registerExtension({
  name: EXTENSION_NAME,
  async setup() {
    // Register ComfyUI Settings
    app.ui.settings.addSetting({
      id: "VF.FileNodes.EnableCanvasDrop",
      name: "🌀 VF File Nodes: Enable Canvas Drag & Drop Node Creation",
      type: "boolean",
      defaultValue: true,
      tooltip: "When enabled, dragging a file from VF File Explorer onto the canvas creates VF loader nodes (VFLoadImage, VFLoadVideo, VFLoadAudio). When disabled, uses ComfyUI's built-in file drop handler.",
    });

    setupCanvasDrop();
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
