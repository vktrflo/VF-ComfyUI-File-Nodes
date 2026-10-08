/**
 * Reusable Popup File Browser Modal for VF ComfyUI File Nodes.
 */

import { api } from "../../scripts/api.js";
import { createElement, icon, makeModalBackdrop } from "./vf_ui_shared.js";

export class VFFileBrowserModal {
  constructor(node, targetWidget, options = {}) {
    this.node = node;
    this.targetWidget = targetWidget;
    this.filter = options.filter || "all";
    this.currentPath = options.initialPath || targetWidget?.value || "";
    this.onSelect = options.onSelect || null;

    this.drives = [];
    this.dirs = [];
    this.files = [];
    this.searchQuery = "";
  }

  async open() {
    const { backdrop, close } = makeModalBackdrop({
      onClose: () => this.dispose(),
      zIndex: 10050,
    });
    this.backdrop = backdrop;
    this.closeModal = close;

    this.render();
    document.body.appendChild(this.backdrop);

    await this.initStartPath();
    await this.loadDrives();
    await this.loadDirectory(this.currentPath);
  }

  dispose() {
    this.closeModal?.();
  }

  async initStartPath() {
    if (!this.currentPath) {
      try {
        const resp = await api.fetchApi("/api/vf-file-nodes/start");
        if (resp.ok) {
          const data = await resp.json();
          this.currentPath = data.path || "";
        }
      } catch (e) {
        console.error("[VF File Nodes] Start path error:", e);
      }
    } else {
      // Resolve path to ensure it's a directory
      try {
        const resp = await api.fetchApi(`/api/vf-file-nodes/resolve?path=${encodeURIComponent(this.currentPath)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.exists) {
            this.currentPath = data.file ? data.dir : this.currentPath;
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
        this.updateDriveSelect();
      }
    } catch (e) {
      console.error("[VF File Nodes] Drive fetch error:", e);
    }
  }

  async loadDirectory(dirPath) {
    this.currentPath = dirPath;
    this.pathInput.value = dirPath;
    this.fileListEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #888;">Loading...</div>';

    try {
      const url = `/api/vf-file-nodes/list?path=${encodeURIComponent(dirPath)}&filter=${encodeURIComponent(this.filter)}`;
      const resp = await api.fetchApi(url);
      if (resp.ok) {
        const data = await resp.json();
        this.dirs = data.dirs || [];
        this.files = data.files || [];
        this.renderFiles();
      } else {
        this.fileListEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #e66;">Folder inaccessible or not found</div>';
      }
    } catch (e) {
      this.fileListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #e66;">Error: ${e.message}</div>`;
    }
  }

  updateDriveSelect() {
    this.driveSelect.innerHTML = "";
    this.drives.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.path;
      opt.textContent = `${d.name} [${d.type}]`;
      if (this.currentPath && this.currentPath.toUpperCase().startsWith(d.path.toUpperCase())) {
        opt.selected = true;
      }
      this.driveSelect.appendChild(opt);
    });
  }

  render() {
    const dialog = createElement("div", "vf-browser-dialog");
    Object.assign(dialog.style, {
      width: "820px",
      height: "620px",
      background: "#1e1e24",
      borderRadius: "10px",
      border: "1px solid #3a3a46",
      boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "Inter, system-ui, sans-serif",
      color: "#e2e2ea",
    });

    // Header
    const header = createElement("div");
    Object.assign(header.style, {
      padding: "12px 16px",
      borderBottom: "1px solid #333340",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "#25252e",
    });
    header.innerHTML = `<div style="font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px;">
      ${icon("folder")} <span>Select File (${this.filter.toUpperCase()})</span>
    </div>`;

    const closeBtn = createElement("button", "", "✕");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#888",
      fontSize: "16px",
      cursor: "pointer",
      padding: "4px 8px",
    });
    closeBtn.onclick = () => this.dispose();
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Nav Bar: Drive selector + Path input + Refresh + Up
    const navBar = createElement("div");
    Object.assign(navBar.style, {
      padding: "10px 16px",
      display: "flex",
      gap: "8px",
      alignItems: "center",
      background: "#1a1a20",
      borderBottom: "1px solid #2a2a36",
    });

    this.driveSelect = createElement("select");
    Object.assign(this.driveSelect.style, {
      background: "#2a2a36",
      color: "#eee",
      border: "1px solid #444",
      borderRadius: "4px",
      padding: "6px 8px",
      fontSize: "12px",
      outline: "none",
    });
    this.driveSelect.onchange = () => this.loadDirectory(this.driveSelect.value);

    const upBtn = createElement("button", "", "⬆ Up");
    Object.assign(upBtn.style, {
      background: "#2a2a36",
      color: "#ccc",
      border: "1px solid #444",
      borderRadius: "4px",
      padding: "6px 10px",
      cursor: "pointer",
      fontSize: "12px",
    });
    upBtn.onclick = () => {
      const parts = this.currentPath.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length > 1) {
        parts.pop();
        const parent = parts.join("/") + (parts.length === 1 && parts[0].endsWith(":") ? "/" : "");
        this.loadDirectory(parent);
      }
    };

    this.pathInput = createElement("input");
    this.pathInput.type = "text";
    Object.assign(this.pathInput.style, {
      flex: "1",
      background: "#262632",
      color: "#fff",
      border: "1px solid #3c3c4c",
      borderRadius: "4px",
      padding: "6px 10px",
      fontSize: "12px",
      outline: "none",
    });
    this.pathInput.onkeydown = (e) => {
      if (e.key === "Enter") this.loadDirectory(this.pathInput.value);
    };

    const searchInput = createElement("input");
    searchInput.placeholder = "Filter files...";
    Object.assign(searchInput.style, {
      width: "140px",
      background: "#262632",
      color: "#fff",
      border: "1px solid #3c3c4c",
      borderRadius: "4px",
      padding: "6px 10px",
      fontSize: "12px",
      outline: "none",
    });
    searchInput.oninput = (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderFiles();
    };

    navBar.appendChild(this.driveSelect);
    navBar.appendChild(upBtn);
    navBar.appendChild(this.pathInput);
    navBar.appendChild(searchInput);
    dialog.appendChild(navBar);

    // File list container
    this.fileListEl = createElement("div");
    Object.assign(this.fileListEl.style, {
      flex: "1",
      overflowY: "auto",
      padding: "12px 16px",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
      gridAutoRows: "140px",
      gap: "10px",
      background: "#16161c",
    });
    dialog.appendChild(this.fileListEl);

    // Footer
    const footer = createElement("div");
    Object.assign(footer.style, {
      padding: "10px 16px",
      borderTop: "1px solid #2a2a36",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "#202028",
    });

    this.selectedLabel = createElement("div", "", "No file selected");
    Object.assign(this.selectedLabel.style, {
      fontSize: "12px",
      color: "#aaa",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      maxWidth: "400px",
    });

    const actions = createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const explorerBtn = createElement("button", "", "Open in Explorer");
    Object.assign(explorerBtn.style, {
      background: "#2a2a36",
      color: "#ccc",
      border: "1px solid #444",
      borderRadius: "4px",
      padding: "6px 12px",
      cursor: "pointer",
      fontSize: "12px",
    });
    explorerBtn.onclick = () => {
      api.fetchApi("/api/vf-file-nodes/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: this.selectedFile ? this.selectedFile.path : this.currentPath }),
      });
    };

    const deleteBtn = createElement("button", "", "Delete");
    Object.assign(deleteBtn.style, {
      background: "#401818",
      color: "#ff8888",
      border: "1px solid #702828",
      borderRadius: "4px",
      padding: "6px 12px",
      cursor: "pointer",
      fontSize: "12px",
    });
    deleteBtn.onclick = async () => {
      if (!this.selectedFile) return;
      if (confirm(`Are you sure you want to permanently delete:\n${this.selectedFile.name}?`)) {
        const resp = await api.fetchApi("/api/vf-file-nodes/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: this.selectedFile.path }),
        });
        if (resp.ok) {
          this.selectedFile = null;
          this.selectedLabel.textContent = "Deleted";
          this.loadDirectory(this.currentPath);
        } else {
          alert("Failed to delete file.");
        }
      }
    };

    const selectBtn = createElement("button", "", "Select");
    Object.assign(selectBtn.style, {
      background: "#0066cc",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      padding: "6px 18px",
      cursor: "pointer",
      fontWeight: "600",
      fontSize: "12px",
    });
    selectBtn.onclick = () => {
      if (this.selectedFile) {
        this.commitSelection(this.selectedFile.path);
      }
    };

    actions.appendChild(explorerBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(selectBtn);

    footer.appendChild(this.selectedLabel);
    footer.appendChild(actions);
    dialog.appendChild(footer);

    this.backdrop.appendChild(dialog);
  }

  commitSelection(filePath) {
    if (this.targetWidget) {
      this.targetWidget.value = filePath;
      this.targetWidget.callback?.(filePath);
    }
    if (typeof this.onSelect === "function") {
      this.onSelect(filePath);
    }
    this.dispose();
  }

  renderFiles() {
    this.fileListEl.innerHTML = "";

    // Folders first
    this.dirs.forEach((dirName) => {
      if (this.searchQuery && !dirName.toLowerCase().includes(this.searchQuery)) return;
      const card = createElement("div", "vf-card-dir");
      Object.assign(card.style, {
        background: "#22222c",
        border: "1px solid #333342",
        borderRadius: "6px",
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        textAlign: "center",
        gap: "6px",
        userSelect: "none",
      });
      card.innerHTML = `<div style="font-size: 28px;">📁</div>
        <div style="font-size: 11px; font-weight: 500; word-break: break-word; line-height: 1.2; max-height: 2.4em; overflow: hidden;">${dirName}</div>`;

      card.onclick = () => {
        const next = this.currentPath.replace(/[/\\]$/, "") + "/" + dirName;
        this.loadDirectory(next);
      };
      this.fileListEl.appendChild(card);
    });

    // Files
    this.files.forEach((file) => {
      if (this.searchQuery && !file.name.toLowerCase().includes(this.searchQuery)) return;
      const card = createElement("div", "vf-card-file");
      Object.assign(card.style, {
        background: "#22222c",
        border: "1px solid #333342",
        borderRadius: "6px",
        padding: "6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
        position: "relative",
        userSelect: "none",
      });

      const previewContainer = createElement("div");
      Object.assign(previewContainer.style, {
        width: "100%",
        height: "85px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "4px",
        background: "#16161c",
      });

      if (file.media_type === "image" || file.media_type === "video") {
        const img = document.createElement("img");
        img.src = `/api/vf-file-nodes/thumbnail?path=${encodeURIComponent(file.path)}`;
        Object.assign(img.style, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
        });
        img.onerror = () => {
          previewContainer.innerHTML = `<span style="font-size: 24px;">${file.media_type === "image" ? "🖼️" : "🎬"}</span>`;
        };
        previewContainer.appendChild(img);
      } else if (file.media_type === "audio") {
        previewContainer.innerHTML = '<span style="font-size: 28px;">🎵</span>';
      } else {
        previewContainer.innerHTML = '<span style="font-size: 28px;">📄</span>';
      }

      const label = createElement("div", "", file.name);
      Object.assign(label.style, {
        fontSize: "11px",
        marginTop: "4px",
        textAlign: "center",
        wordBreak: "break-word",
        maxHeight: "2.4em",
        overflow: "hidden",
        width: "100%",
        lineHeight: "1.2",
      });

      card.appendChild(previewContainer);
      card.appendChild(label);

      card.onclick = () => {
        // Highlight selection
        this.fileListEl.querySelectorAll(".vf-card-file").forEach((c) => {
          c.style.borderColor = "#333342";
          c.style.background = "#22222c";
        });
        card.style.borderColor = "#0088ff";
        card.style.background = "#2a2d3c";
        this.selectedFile = file;
        this.selectedLabel.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
      };

      card.ondblclick = () => {
        this.commitSelection(file.path);
      };

      this.fileListEl.appendChild(card);
    });
  }
}

export function openFileBrowserModal(node, targetWidget, options = {}) {
  const modal = new VFFileBrowserModal(node, targetWidget, options);
  modal.open();
  return modal;
}
