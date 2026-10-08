/**
 * Canvas Embedded File Explorer Widget for 🌀 VF File Explorer.
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { setupDragPayload } from "./vf_canvas_drop.js";
import { createElement, icon, makeModalBackdrop } from "./vf_ui_shared.js";

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 680;

function stopCanvasEvents(el) {
  const stop = (e) => {
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  };
  el.addEventListener("mousedown", stop, false);
  el.addEventListener("pointerdown", stop, false);
  el.addEventListener("wheel", stop, { passive: false });
}

export function setupFileExplorerNode(nodeType, nodeData) {
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
      const pathWidget = node.widgets?.find((w) => w.name === "file_path");
      if (pathWidget) {
        pathWidget.type = "hidden";
        pathWidget.computeSize = () => [0, -4];
      }

      const widgetContainer = createElement("div", "vf-embedded-explorer-container");
      Object.assign(widgetContainer.style, {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#181820",
        borderRadius: "6px",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#ddd",
        boxSizing: "border-box",
        border: "1px solid #333342",
      });
      stopCanvasEvents(widgetContainer);

      const explorer = new EmbeddedFileExplorer(node, pathWidget, widgetContainer);
      node.addDOMWidget("embedded_file_explorer", "explorer", widgetContainer, {
        serialize: false,
        hideOnZoom: false,
      });

      explorer.init();
    }, 10);

    return res;
  };
}

class EmbeddedFileExplorer {
  constructor(node, pathWidget, container) {
    this.node = node;
    this.pathWidget = pathWidget;
    this.container = container;
    this.currentPath = pathWidget?.value || "";
    this.activeFilter = "all";
    this.searchQuery = "";
    this.drives = [];
    this.dirs = [];
    this.files = [];
    this.selectedFile = null;
  }

  async init() {
    this.renderSkeleton();
    await this.initStartPath();
    await this.loadDrives();
    await this.loadDirectory(this.currentPath);
  }

  async initStartPath() {
    if (!this.currentPath) {
      try {
        const resp = await api.fetchApi("/api/vf-file-nodes/start");
        if (resp.ok) {
          const data = await resp.json();
          this.currentPath = data.path || "";
        }
      } catch (e) {}
    } else {
      try {
        const resp = await api.fetchApi(`/api/vf-file-nodes/resolve?path=${encodeURIComponent(this.currentPath)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.exists && data.file) {
            this.currentPath = data.dir;
            this.selectedFile = { path: data.file, name: data.filename };
          }
        }
      } catch (e) {}
    }
  }

  async loadDrives() {
    try {
      const resp = await api.fetchApi("/api/vf-file-nodes/drives");
      if (resp.ok) {
        const data = await resp.json();
        this.drives = data.drives || [];
        this.renderDrivePills();
      }
    } catch (e) {}
  }

  async loadDirectory(dirPath) {
    this.currentPath = dirPath;
    this.pathLabel.textContent = dirPath;
    this.fileGridEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #888;">Loading...</div>';

    try {
      const url = `/api/vf-file-nodes/list?path=${encodeURIComponent(dirPath)}&filter=${encodeURIComponent(this.activeFilter)}`;
      const resp = await api.fetchApi(url);
      if (resp.ok) {
        const data = await resp.json();
        this.dirs = data.dirs || [];
        this.files = data.files || [];
        this.renderGrid();
      } else {
        this.fileGridEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #e66;">Directory inaccessible</div>';
      }
    } catch (e) {
      this.fileGridEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #e66;">Error: ${e.message}</div>`;
    }
  }

  renderSkeleton() {
    this.container.innerHTML = "";

    // 1. Top Bar: Drives + Up + Path
    const topBar = createElement("div");
    Object.assign(topBar.style, {
      padding: "8px 12px",
      background: "#20202a",
      borderBottom: "1px solid #2d2d3a",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    });

    this.driveRow = createElement("div");
    Object.assign(this.driveRow.style, {
      display: "flex",
      gap: "6px",
      overflowX: "auto",
      paddingBottom: "2px",
    });

    const pathRow = createElement("div");
    Object.assign(pathRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });

    const upBtn = createElement("button", "", "⬆ Up");
    Object.assign(upBtn.style, {
      background: "#2a2a36",
      color: "#ccc",
      border: "1px solid #444",
      borderRadius: "4px",
      padding: "4px 8px",
      cursor: "pointer",
      fontSize: "11px",
    });
    upBtn.onclick = () => {
      const parts = this.currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length > 1) {
        parts.pop();
        const parent = parts.join("/") + (parts.length === 1 && parts[0].endsWith(":") ? "/" : "");
        this.loadDirectory(parent);
      }
    };

    this.pathLabel = createElement("div", "", this.currentPath);
    Object.assign(this.pathLabel.style, {
      flex: "1",
      fontSize: "11px",
      color: "#aaa",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontFamily: "monospace",
    });

    pathRow.appendChild(upBtn);
    pathRow.appendChild(this.pathLabel);

    topBar.appendChild(this.driveRow);
    topBar.appendChild(pathRow);
    this.container.appendChild(topBar);

    // 2. Filter Bar: Media tabs + Search
    const filterBar = createElement("div");
    Object.assign(filterBar.style, {
      padding: "6px 12px",
      background: "#1c1c24",
      borderBottom: "1px solid #282834",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
    });

    const tabsContainer = createElement("div");
    Object.assign(tabsContainer.style, {
      display: "flex",
      gap: "4px",
    });

    ["all", "image", "video", "audio", "text"].forEach((f) => {
      const tab = createElement("button", "", f.toUpperCase());
      Object.assign(tab.style, {
        background: this.activeFilter === f ? "#0066cc" : "#282834",
        color: this.activeFilter === f ? "#fff" : "#888",
        border: "none",
        borderRadius: "3px",
        padding: "3px 8px",
        fontSize: "10px",
        fontWeight: "600",
        cursor: "pointer",
      });
      tab.onclick = () => {
        this.activeFilter = f;
        tabsContainer.querySelectorAll("button").forEach((b) => {
          b.style.background = "#282834";
          b.style.color = "#888";
        });
        tab.style.background = "#0066cc";
        tab.style.color = "#fff";
        this.loadDirectory(this.currentPath);
      };
      tabsContainer.appendChild(tab);
    });

    const searchInput = createElement("input");
    searchInput.placeholder = "Search...";
    Object.assign(searchInput.style, {
      width: "120px",
      background: "#282834",
      color: "#eee",
      border: "1px solid #3c3c4c",
      borderRadius: "3px",
      padding: "4px 8px",
      fontSize: "11px",
      outline: "none",
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderGrid();
    };

    filterBar.appendChild(tabsContainer);
    filterBar.appendChild(searchInput);
    this.container.appendChild(filterBar);

    // 3. Grid area
    this.fileGridEl = createElement("div");
    Object.assign(this.fileGridEl.style, {
      flex: "1",
      overflowY: "auto",
      padding: "10px",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
      gridAutoRows: "120px",
      gap: "8px",
      background: "#14141a",
    });
    this.container.appendChild(this.fileGridEl);

    // 4. Status / Action bar
    const statusBar = createElement("div");
    Object.assign(statusBar.style, {
      padding: "8px 12px",
      background: "#1e1e28",
      borderTop: "1px solid #2d2d3a",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });

    this.statusText = createElement("div", "", "No file selected");
    Object.assign(this.statusText.style, {
      fontSize: "11px",
      color: "#888",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      maxWidth: "320px",
    });

    const btnGroup = createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "6px";

    const revealBtn = createElement("button", "", "Explorer");
    Object.assign(revealBtn.style, {
      background: "#282834",
      color: "#bbb",
      border: "1px solid #3e3e4e",
      borderRadius: "3px",
      padding: "4px 8px",
      fontSize: "11px",
      cursor: "pointer",
    });
    revealBtn.onclick = () => {
      api.fetchApi("/api/vf-file-nodes/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: this.selectedFile ? this.selectedFile.path : this.currentPath }),
      });
    };

    const delBtn = createElement("button", "", "Delete");
    Object.assign(delBtn.style, {
      background: "#3e1818",
      color: "#ff7777",
      border: "1px solid #662626",
      borderRadius: "3px",
      padding: "4px 8px",
      fontSize: "11px",
      cursor: "pointer",
    });
    delBtn.onclick = async () => {
      if (!this.selectedFile) return;
      if (confirm(`Delete ${this.selectedFile.name}?`)) {
        const resp = await api.fetchApi("/api/vf-file-nodes/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: this.selectedFile.path }),
        });
        if (resp.ok) {
          this.selectedFile = null;
          this.selectFile(null);
          this.loadDirectory(this.currentPath);
        }
      }
    };

    btnGroup.appendChild(revealBtn);
    btnGroup.appendChild(delBtn);

    statusBar.appendChild(this.statusText);
    statusBar.appendChild(btnGroup);
    this.container.appendChild(statusBar);
  }

  renderDrivePills() {
    this.driveRow.innerHTML = "";
    this.drives.forEach((d) => {
      const label = (d.name || "").includes(" ") ? d.name.split(" ")[0] : (d.name || d.path);
      const pill = createElement("button", "", label);
      if (d.remote_path || d.path) {
        pill.title = d.remote_path ? `${label} (${d.remote_path})` : d.path;
      }
      Object.assign(pill.style, {
        background: this.currentPath.toUpperCase().startsWith(d.path.toUpperCase()) ? "#0066cc" : "#2a2a38",
        color: "#eee",
        border: "1px solid #3c3c4c",
        borderRadius: "12px",
        padding: "2px 10px",
        fontSize: "11px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      });
      pill.onclick = () => this.loadDirectory(d.path);
      this.driveRow.appendChild(pill);
    });
  }

  renderGrid() {
    this.fileGridEl.innerHTML = "";

    // Folders
    this.dirs.forEach((dirName) => {
      if (this.searchQuery && !dirName.toLowerCase().includes(this.searchQuery)) return;
      const card = createElement("div");
      Object.assign(card.style, {
        background: "#1f1f28",
        border: "1px solid #2d2d3c",
        borderRadius: "5px",
        padding: "6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        textAlign: "center",
        gap: "4px",
      });
      card.innerHTML = `<span style="font-size: 24px;">📁</span>
        <span style="font-size: 10px; font-weight: 500; word-break: break-word; line-height: 1.2; max-height: 2.4em; overflow: hidden;">${dirName}</span>`;
      card.onclick = () => {
        const next = this.currentPath.replace(/[/\\]$/, "") + "/" + dirName;
        this.loadDirectory(next);
      };
      this.fileGridEl.appendChild(card);
    });

    // Files
    this.files.forEach((file) => {
      if (this.searchQuery && !file.name.toLowerCase().includes(this.searchQuery)) return;
      const card = createElement("div");
      card.draggable = true;
      Object.assign(card.style, {
        background: "#1f1f28",
        border: "1px solid #2d2d3c",
        borderRadius: "5px",
        padding: "4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
        position: "relative",
      });

      card.ondragstart = (e) => {
        setupDragPayload(e, file);
      };

      const thumb = createElement("div");
      Object.assign(thumb.style, {
        width: "100%",
        height: "70px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "3px",
        background: "#14141a",
        overflow: "hidden",
      });

      if (file.media_type === "image" || file.media_type === "video") {
        const img = document.createElement("img");
        img.src = `/api/vf-file-nodes/thumbnail?path=${encodeURIComponent(file.path)}`;
        Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover" });
        img.onerror = () => {
          thumb.innerHTML = `<span style="font-size: 22px;">${file.media_type === "image" ? "🖼️" : "🎬"}</span>`;
        };
        thumb.appendChild(img);
      } else if (file.media_type === "audio") {
        thumb.innerHTML = '<span style="font-size: 24px;">🎵</span>';
      } else {
        thumb.innerHTML = '<span style="font-size: 24px;">📄</span>';
      }

      const label = createElement("div", "", file.name);
      Object.assign(label.style, {
        fontSize: "10px",
        textAlign: "center",
        wordBreak: "break-word",
        maxHeight: "2.2em",
        overflow: "hidden",
        lineHeight: "1.1",
        width: "100%",
      });

      card.appendChild(thumb);
      card.appendChild(label);

      card.onclick = () => {
        this.fileGridEl.querySelectorAll("div").forEach((c) => {
          c.style.borderColor = "#2d2d3c";
          c.style.background = "#1f1f28";
        });
        card.style.borderColor = "#0088ff";
        card.style.background = "#262938";
        this.selectFile(file);
      };

      card.ondblclick = () => {
        this.openPreviewModal(file);
      };

      this.fileGridEl.appendChild(card);
    });
  }

  selectFile(file) {
    this.selectedFile = file;
    if (file) {
      this.statusText.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
      if (this.pathWidget) {
        this.pathWidget.value = file.path;
        this.pathWidget.callback?.(file.path);
      }
      this.node.setDirtyCanvas(true, true);
    } else {
      this.statusText.textContent = "No file selected";
      if (this.pathWidget) {
        this.pathWidget.value = "";
        this.pathWidget.callback?.("");
      }
    }
  }

  openPreviewModal(file) {
    const { backdrop, close } = makeModalBackdrop({ zIndex: 10100 });
    const content = createElement("div");
    Object.assign(content.style, {
      maxWidth: "90vw",
      maxHeight: "90vh",
      background: "#181820",
      borderRadius: "8px",
      border: "1px solid #3c3c4c",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      boxShadow: "0 12px 36px rgba(0,0,0,0.8)",
    });

    const header = createElement("div");
    Object.assign(header.style, {
      padding: "10px 16px",
      background: "#202028",
      borderBottom: "1px solid #2e2e38",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    });
    header.innerHTML = `<span style="font-size: 13px; font-weight: 600;">${file.name}</span>`;

    const closeBtn = createElement("button", "", "✕");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#aaa",
      fontSize: "16px",
      cursor: "pointer",
    });
    closeBtn.onclick = close;
    header.appendChild(closeBtn);
    content.appendChild(header);

    const body = createElement("div");
    Object.assign(body.style, {
      padding: "16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "300px",
      minHeight: "200px",
    });

    if (file.media_type === "image") {
      const img = document.createElement("img");
      img.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`;
      img.style.maxWidth = "80vw";
      img.style.maxHeight = "75vh";
      img.style.objectFit = "contain";
      body.appendChild(img);
    } else if (file.media_type === "video") {
      const video = document.createElement("video");
      video.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`;
      video.controls = true;
      video.autoplay = true;
      video.style.maxWidth = "80vw";
      video.style.maxHeight = "75vh";
      body.appendChild(video);
    } else if (file.media_type === "audio") {
      const audio = document.createElement("audio");
      audio.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`;
      audio.controls = true;
      audio.autoplay = true;
      body.appendChild(audio);
    } else {
      const pre = createElement("pre");
      Object.assign(pre.style, {
        maxHeight: "60vh",
        overflowY: "auto",
        fontSize: "12px",
        fontFamily: "monospace",
        color: "#eee",
        background: "#101014",
        padding: "12px",
        borderRadius: "4px",
      });
      fetch(`/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`)
        .then((r) => r.text())
        .then((t) => { pre.textContent = t.slice(0, 50000); });
      body.appendChild(pre);
    }

    content.appendChild(body);
    backdrop.appendChild(content);
    document.body.appendChild(backdrop);
  }
}
