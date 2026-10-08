/**
 * Reusable Popup File Browser Modal for VF ComfyUI File Nodes.
 */

import { api } from "../../scripts/api.js";
import {
  createElement,
  formatDateTime,
  formatDuration,
  getEmptyFolderMessage,
  icon,
  isSupportedMediaFile,
  makeModalBackdrop,
} from "./vf_ui_shared.js";

export class VFFileBrowserModal {
  constructor(node, targetWidget, options = {}) {
    this.node = node;
    this.targetWidget = targetWidget;
    this.filter = options.filter || "all";
    this.currentPath = options.initialPath || targetWidget?.value || "";
    this.onSelect = options.onSelect || null;
    this.sortBy = "name_asc";
    let savedThumbs = true;
    try {
      savedThumbs = localStorage.getItem("vf_file_nodes_show_thumbnails") !== "false";
    } catch (e) {}
    this.showThumbnails = savedThumbs;
    let savedLayout = "grid";
    try {
      savedLayout = localStorage.getItem("vf_file_nodes_layout_mode") || "grid";
    } catch (e) {}
    this.layoutMode = savedLayout;

    this.favorites = [];
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
    await this.loadFavorites();
    await this.loadDirectory(this.currentPath);
    if (this.selectedFile) {
      this.selectFile(this.selectedFile);
    } else {
      this.selectFile(null);
    }
  }

  dispose() {
    this._resizeObserver?.disconnect();
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

  normPath(p) {
    return (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }

  isCurrentFavorite() {
    const cur = this.normPath(this.currentPath);
    return this.favorites.some((f) => this.normPath(f.path) === cur);
  }

  async loadFavorites() {
    try {
      const resp = await api.fetchApi("/api/vf-file-nodes/favorites");
      if (resp.ok) {
        const data = await resp.json();
        this.favorites = data.favorites || [];
        this.renderFavoritesBar();
        this.updateFavoriteButton();
      }
    } catch (e) {
      console.error("[VF File Nodes] Favorites fetch error:", e);
    }
  }

  updateFavoriteButton() {
    if (!this.favBtn) return;
    const isFav = this.isCurrentFavorite();
    this.favBtn.innerHTML = isFav ? "★" : "☆";
    this.favBtn.style.color = isFav ? "#f5c518" : "#888";
    this.favBtn.title = isFav ? "Remove folder from favorites" : "Add current folder to favorites";
  }

  async toggleCurrentFavorite() {
    if (!this.currentPath) return;
    const isFav = this.isCurrentFavorite();
    const endpoint = isFav ? "/api/vf-file-nodes/favorites/remove" : "/api/vf-file-nodes/favorites/add";
    try {
      const resp = await api.fetchApi(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: this.currentPath }),
      });
      if (resp.ok) {
        const data = await resp.json();
        this.favorites = data.favorites || [];
        this.renderFavoritesBar();
        this.updateFavoriteButton();
      }
    } catch (e) {
      console.error("[VF File Nodes] Toggle favorite error:", e);
    }
  }

  async removeFavorite(pathToRemove) {
    try {
      const resp = await api.fetchApi("/api/vf-file-nodes/favorites/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathToRemove }),
      });
      if (resp.ok) {
        const data = await resp.json();
        this.favorites = data.favorites || [];
        this.renderFavoritesBar();
        this.updateFavoriteButton();
      }
    } catch (e) {
      console.error("[VF File Nodes] Remove favorite error:", e);
    }
  }

  renderFavoritesBar() {
    if (!this.favoritesBar) return;
    this.favoritesBar.innerHTML = "";
    if (!this.favorites || this.favorites.length === 0) {
      this.favoritesBar.style.display = "none";
      return;
    }
    this.favoritesBar.style.display = "flex";

    const label = createElement("span", "", "⭐");
    label.style.fontSize = "12px";
    label.style.alignSelf = "center";
    label.style.opacity = "0.7";
    label.title = "Favorite folders";
    this.favoritesBar.appendChild(label);

    const cur = this.normPath(this.currentPath);

    this.favorites.forEach((fav) => {
      const isSelected = this.normPath(fav.path) === cur;
      const pill = createElement("div");
      Object.assign(pill.style, {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        background: isSelected ? "#0066cc" : "#282838",
        color: isSelected ? "#fff" : "#ddd",
        border: "1px solid #3c3c4e",
        borderRadius: "12px",
        padding: "3px 9px",
        fontSize: "11px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: "0",
      });
      pill.title = fav.path;

      const nameSpan = createElement("span", "", fav.name || fav.path);
      nameSpan.onclick = () => {
        this.selectFile(null);
        this.loadDirectory(fav.path);
      };

      const delSpan = createElement("span", "", "×");
      Object.assign(delSpan.style, {
        marginLeft: "2px",
        cursor: "pointer",
        opacity: "0.6",
        fontWeight: "bold",
        fontSize: "12px",
      });
      delSpan.title = `Remove ${fav.name} from favorites`;
      delSpan.onmouseenter = () => (delSpan.style.opacity = "1");
      delSpan.onmouseleave = () => (delSpan.style.opacity = "0.6");
      delSpan.onclick = (e) => {
        e.stopPropagation();
        this.removeFavorite(fav.path);
      };

      pill.appendChild(nameSpan);
      pill.appendChild(delSpan);
      this.favoritesBar.appendChild(pill);
    });
  }

  selectFile(file) {
    this.selectedFile = file;
    const isSupported = isSupportedMediaFile(file);
    if (this.deleteBtn) {
      this.deleteBtn.style.display = isSupported ? "inline-block" : "none";
    }
    if (file) {
      this.selectedLabel.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    } else {
      this.selectedLabel.textContent = "No file selected";
    }
  }

  updateThumbToggleBtn() {
    if (!this.thumbToggleBtn) return;
    this.thumbToggleBtn.style.background = this.showThumbnails ? "#0066cc" : "#262632";
    this.thumbToggleBtn.style.color = this.showThumbnails ? "#fff" : "#888";
    this.thumbToggleBtn.style.borderColor = this.showThumbnails ? "#0077ee" : "#3c3c4c";
    this.thumbToggleBtn.title = this.showThumbnails ? "Thumbnails: ON (click to hide)" : "Thumbnails: OFF (click to show)";
  }

  updateLayoutToggleBtn() {
    if (!this.layoutToggleBtn) return;
    const isMosaic = this.layoutMode === "mosaic";
    this.layoutToggleBtn.innerHTML = isMosaic ? icon("mosaic") : icon("grid");
    this.layoutToggleBtn.style.background = isMosaic ? "#0066cc" : "#262632";
    this.layoutToggleBtn.style.color = isMosaic ? "#fff" : "#888";
    this.layoutToggleBtn.style.borderColor = isMosaic ? "#0077ee" : "#3c3c4c";
    this.layoutToggleBtn.title = isMosaic ? "Layout: Mosaic (click for Grid)" : "Layout: Grid (click for Mosaic)";
  }

  async loadDirectory(dirPath) {
    this.currentPath = dirPath;
    this.pathInput.value = dirPath;
    this.updateFavoriteButton();
    this.renderFavoritesBar();
    if (this.driveSelect) {
      for (let i = 0; i < this.driveSelect.options.length; i++) {
        const opt = this.driveSelect.options[i];
        if (dirPath.toUpperCase().startsWith(opt.value.toUpperCase())) {
          this.driveSelect.selectedIndex = i;
          break;
        }
      }
    }
    this.fileListEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #888;">Loading...</div>';

    try {
      const url = `/api/vf-file-nodes/list?path=${encodeURIComponent(dirPath)}&filter=${encodeURIComponent(this.filter)}&sort=${encodeURIComponent(this.sortBy)}`;
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
      const label = (d.name || "").includes(" ") ? d.name.split(" ")[0] : (d.name || d.path);
      opt.textContent = `${label} [${d.type}]`;
      if (d.remote_path) {
        opt.title = d.remote_path;
      }
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

    // Nav Bar: Drive selector + Up + Favorite + Path input + Sort dropdown + Search
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
    this.driveSelect.onchange = () => {
      this.selectFile(null);
      this.loadDirectory(this.driveSelect.value);
    };

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
        this.selectFile(null);
        this.loadDirectory(parent);
      }
    };

    this.favBtn = createElement("button", "", "☆");
    Object.assign(this.favBtn.style, {
      background: "#2a2a36",
      color: "#888",
      border: "1px solid #444",
      borderRadius: "4px",
      padding: "6px 10px",
      cursor: "pointer",
      fontSize: "14px",
      lineHeight: "1",
    });
    this.favBtn.title = "Add current folder to favorites";
    this.favBtn.onclick = () => this.toggleCurrentFavorite();

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

    this.sortSelect = createElement("select");
    Object.assign(this.sortSelect.style, {
      background: "#262632",
      color: "#fff",
      border: "1px solid #3c3c4c",
      borderRadius: "4px",
      padding: "6px 8px",
      fontSize: "12px",
      outline: "none",
      cursor: "pointer",
    });
    const sortOptions = [
      { value: "name_asc", text: "Name (A-Z)" },
      { value: "name_desc", text: "Name (Z-A)" },
      { value: "mtime_desc", text: "Date (Newest)" },
      { value: "mtime_asc", text: "Date (Oldest)" },
      { value: "size_desc", text: "Size (Largest)" },
      { value: "size_asc", text: "Size (Smallest)" },
    ];
    sortOptions.forEach((opt) => {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.text;
      if (opt.value === this.sortBy) el.selected = true;
      this.sortSelect.appendChild(el);
    });
    this.sortSelect.onchange = () => {
      this.sortBy = this.sortSelect.value;
      this.loadDirectory(this.currentPath);
    };

    const searchInput = createElement("input");
    searchInput.placeholder = "Filter files...";
    Object.assign(searchInput.style, {
      width: "120px",
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

    this.thumbToggleBtn = createElement("button", "", "🖼️");
    Object.assign(this.thumbToggleBtn.style, {
      background: this.showThumbnails ? "#0066cc" : "#262632",
      color: this.showThumbnails ? "#fff" : "#888",
      border: `1px solid ${this.showThumbnails ? "#0077ee" : "#3c3c4c"}`,
      borderRadius: "4px",
      padding: "5px 8px",
      fontSize: "13px",
      lineHeight: "1.2",
      cursor: "pointer",
    });
    this.updateThumbToggleBtn();
    this.thumbToggleBtn.onclick = () => {
      this.showThumbnails = !this.showThumbnails;
      try {
        localStorage.setItem("vf_file_nodes_show_thumbnails", this.showThumbnails ? "true" : "false");
      } catch (e) {}
      this.updateThumbToggleBtn();
      this.renderFiles();
    };

    this.layoutToggleBtn = createElement("button");
    Object.assign(this.layoutToggleBtn.style, {
      background: this.layoutMode === "mosaic" ? "#0066cc" : "#262632",
      color: this.layoutMode === "mosaic" ? "#fff" : "#888",
      border: `1px solid ${this.layoutMode === "mosaic" ? "#0077ee" : "#3c3c4c"}`,
      borderRadius: "4px",
      padding: "5px 8px",
      fontSize: "13px",
      lineHeight: "1.2",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
    });
    this.updateLayoutToggleBtn();
    this.layoutToggleBtn.onclick = () => {
      this.layoutMode = this.layoutMode === "grid" ? "mosaic" : "grid";
      try {
        localStorage.setItem("vf_file_nodes_layout_mode", this.layoutMode);
      } catch (e) {}
      this.updateLayoutToggleBtn();
      this.renderFiles();
    };

    navBar.appendChild(this.driveSelect);
    navBar.appendChild(upBtn);
    navBar.appendChild(this.favBtn);
    navBar.appendChild(this.pathInput);
    navBar.appendChild(this.sortSelect);
    navBar.appendChild(this.thumbToggleBtn);
    navBar.appendChild(this.layoutToggleBtn);
    navBar.appendChild(searchInput);
    dialog.appendChild(navBar);

    this.favoritesBar = createElement("div");
    Object.assign(this.favoritesBar.style, {
      padding: "6px 16px",
      display: "none",
      gap: "6px",
      alignItems: "center",
      background: "#16161f",
      borderBottom: "1px solid #252532",
      overflowX: "auto",
    });
    dialog.appendChild(this.favoritesBar);

    // File list container
    this.fileListEl = createElement("div");
    Object.assign(this.fileListEl.style, {
      flex: "1",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "12px 16px",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
      gridAutoRows: "145px",
      gap: "10px",
      background: "#16161c",
      boxSizing: "border-box",
    });
    dialog.appendChild(this.fileListEl);

    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver((entries) => {
        if (this.layoutMode !== "mosaic") return;
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (!w) continue;
          const minColWidth = 140;
          const gap = 10;
          const newCols = Math.max(1, Math.floor((w + gap) / (minColWidth + gap)));
          if (this._currentCols && this._currentCols !== newCols) {
            this.renderFiles();
          }
        }
      });
      this._resizeObserver.observe(this.fileListEl);
    }

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

    this.deleteBtn = createElement("button", "", "Delete");
    Object.assign(this.deleteBtn.style, {
      background: "#401818",
      color: "#ff8888",
      border: "1px solid #702828",
      borderRadius: "4px",
      padding: "6px 12px",
      cursor: "pointer",
      fontSize: "12px",
      display: "none",
    });
    this.deleteBtn.onclick = async () => {
      if (!this.selectedFile || !isSupportedMediaFile(this.selectedFile)) return;
      if (confirm(`Are you sure you want to permanently delete:\n${this.selectedFile.name}?`)) {
        const resp = await api.fetchApi("/api/vf-file-nodes/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: this.selectedFile.path }),
        });
        if (resp.ok) {
          this.selectFile(null);
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
    actions.appendChild(this.deleteBtn);
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
    const isMosaic = this.layoutMode === "mosaic";

    let cols = null;
    let numCols = 1;
    let itemIdx = 0;

    if (isMosaic) {
      const minColWidth = 140;
      const gap = 10;
      const availableWidth = this.fileListEl.clientWidth || 780;
      numCols = Math.max(1, Math.floor((availableWidth + gap) / (minColWidth + gap)));
      this._currentCols = numCols;

      this.fileListEl.style.display = "flex";
      this.fileListEl.style.flexDirection = "row";
      this.fileListEl.style.alignItems = "flex-start";
      this.fileListEl.style.gap = `${gap}px`;
      this.fileListEl.style.overflowY = "auto";
      this.fileListEl.style.overflowX = "hidden";
      this.fileListEl.style.gridTemplateColumns = "";
      this.fileListEl.style.gridAutoRows = "";

      cols = [];
      for (let i = 0; i < numCols; i++) {
        const col = createElement("div", "vf-mosaic-col");
        Object.assign(col.style, {
          flex: "1",
          minWidth: "0",
          display: "flex",
          flexDirection: "column",
          gap: `${gap}px`,
        });
        this.fileListEl.appendChild(col);
        cols.push(col);
      }
    } else {
      this._currentCols = null;
      this.fileListEl.style.display = "grid";
      this.fileListEl.style.gridTemplateColumns = "repeat(auto-fill, minmax(130px, 1fr))";
      this.fileListEl.style.gridAutoRows = this.showThumbnails ? "145px" : "105px";
      this.fileListEl.style.flexDirection = "";
      this.fileListEl.style.alignItems = "";
      this.fileListEl.style.gap = "10px";
      this.fileListEl.style.overflowY = "auto";
      this.fileListEl.style.overflowX = "hidden";
    }

    const appendItem = (card) => {
      if (isMosaic && cols) {
        cols[itemIdx % numCols].appendChild(card);
        itemIdx++;
      } else {
        this.fileListEl.appendChild(card);
      }
    };

    // Filter visible items
    const visibleDirs = this.dirs.filter((dirName) => {
      if (this.searchQuery && !dirName.toLowerCase().includes(this.searchQuery)) return false;
      return true;
    });

    const visibleFiles = this.files.filter((file) => {
      if (this.searchQuery && !file.name.toLowerCase().includes(this.searchQuery)) return false;
      return true;
    });

    // Folders first
    visibleDirs.forEach((dirName) => {
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
        boxSizing: "border-box",
        width: "100%",
        minHeight: isMosaic ? "65px" : "",
      });
      card.innerHTML = `<div style="font-size: 28px;">📁</div>
        <div style="font-size: 11px; font-weight: 500; word-break: break-word; line-height: 1.2; max-height: 2.4em; overflow: hidden;">${dirName}</div>`;

      card.onclick = () => {
        const next = this.currentPath.replace(/[/\\]$/, "") + "/" + dirName;
        this.selectFile(null);
        this.loadDirectory(next);
      };
      appendItem(card);
    });

    // Files
    visibleFiles.forEach((file) => {
      const isSupported = isSupportedMediaFile(file);
      const card = createElement("div", "vf-card-file");
      Object.assign(card.style, {
        background: "#22222c",
        border: "1px solid #333342",
        borderRadius: "6px",
        padding: "6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: isMosaic ? "flex-start" : "space-between",
        gap: isMosaic ? "6px" : "0",
        cursor: "pointer",
        position: "relative",
        userSelect: "none",
        boxSizing: "border-box",
        width: "100%",
      });

      const previewContainer = createElement("div");
      Object.assign(previewContainer.style, {
        width: "100%",
        height: isMosaic ? (this.showThumbnails ? "auto" : "55px") : (this.showThumbnails ? "85px" : "55px"),
        minHeight: isMosaic && this.showThumbnails ? "45px" : "",
        maxHeight: isMosaic && this.showThumbnails ? "260px" : "",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "4px",
        background: "#16161c",
        position: "relative",
      });

      if (this.showThumbnails && (file.media_type === "image" || file.media_type === "video")) {
        const img = document.createElement("img");
        img.src = `/api/vf-file-nodes/thumbnail?path=${encodeURIComponent(file.path)}`;
        Object.assign(img.style, {
          width: "100%",
          height: isMosaic ? "auto" : "100%",
          maxHeight: isMosaic ? "260px" : "",
          objectFit: isMosaic ? "contain" : "cover",
          display: "block",
        });
        img.onerror = () => {
          previewContainer.innerHTML = `<span style="font-size: 24px;">${file.media_type === "image" ? "🖼️" : "🎬"}</span>`;
        };
        previewContainer.appendChild(img);
      } else if (file.media_type === "image") {
        previewContainer.innerHTML = '<span style="font-size: 26px;">🖼️</span>';
      } else if (file.media_type === "video") {
        previewContainer.innerHTML = '<span style="font-size: 26px;">🎬</span>';
      } else if (file.media_type === "audio") {
        previewContainer.innerHTML = '<span style="font-size: 28px;">🎵</span>';
      } else {
        previewContainer.innerHTML = '<span style="font-size: 28px;">📄</span>';
      }

      // Metadata Badges on Thumbnail (only for supported files)
      if (isSupported) {
        if (file.duration != null && file.duration > 0) {
          const durBadge = createElement("span", "vf-badge-duration", formatDuration(file.duration));
          Object.assign(durBadge.style, {
            position: "absolute",
            bottom: "3px",
            right: "3px",
            background: "rgba(0, 0, 0, 0.75)",
            color: "#fff",
            padding: "1px 4px",
            borderRadius: "3px",
            fontSize: "9px",
            fontWeight: "600",
            lineHeight: "1.1",
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: "2",
          });
          previewContainer.appendChild(durBadge);
        }

        if (file.dimensions && Array.isArray(file.dimensions) && file.dimensions.length === 2) {
          const dimBadge = createElement("span", "vf-badge-dimensions", `${file.dimensions[0]}×${file.dimensions[1]}`);
          Object.assign(dimBadge.style, {
            position: "absolute",
            top: "3px",
            left: "3px",
            background: "rgba(0, 0, 0, 0.75)",
            color: "#ddd",
            padding: "1px 4px",
            borderRadius: "3px",
            fontSize: "9px",
            fontWeight: "500",
            lineHeight: "1.1",
            fontFamily: "monospace",
            pointerEvents: "none",
            zIndex: "2",
          });
          previewContainer.appendChild(dimBadge);
        }
      }

      const label = createElement("div", "", file.name);
      Object.assign(label.style, {
        fontSize: "11px",
        marginTop: isMosaic ? "0" : "4px",
        textAlign: "center",
        wordBreak: "break-word",
        maxHeight: "2.4em",
        overflow: "hidden",
        width: "100%",
        lineHeight: "1.2",
      });

      card.appendChild(previewContainer);
      card.appendChild(label);

      // Metadata Subtitle Line (creation date/time, dimensions, duration)
      if (isSupported) {
        const metaRow = createElement("div", "vf-card-meta");
        Object.assign(metaRow.style, {
          fontSize: "9px",
          color: "#888",
          marginTop: "2px",
          width: "100%",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: "1.2",
        });
        const metaParts = [];
        if (file.ctime) metaParts.push(formatDateTime(file.ctime));
        if (file.dimensions && Array.isArray(file.dimensions)) metaParts.push(`${file.dimensions[0]}×${file.dimensions[1]}`);
        if (file.duration) metaParts.push(formatDuration(file.duration));
        metaRow.textContent = metaParts.join(" • ");
        card.appendChild(metaRow);

        const tipParts = [`Name: ${file.name}`];
        if (file.ctime) tipParts.push(`Created: ${new Date(file.ctime * 1000).toLocaleString()}`);
        if (file.dimensions) tipParts.push(`Dimensions: ${file.dimensions[0]}×${file.dimensions[1]}`);
        if (file.duration) tipParts.push(`Duration: ${formatDuration(file.duration)}`);
        if (file.size) tipParts.push(`Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
        card.title = tipParts.join("\n");
      }

      card.onclick = () => {
        // Highlight selection
        this.fileListEl.querySelectorAll(".vf-card-file").forEach((c) => {
          c.style.borderColor = "#333342";
          c.style.background = "#22222c";
        });
        card.style.borderColor = "#0088ff";
        card.style.background = "#2a2d3c";
        this.selectFile(file);
      };

      card.ondblclick = () => {
        this.commitSelection(file.path);
      };

      appendItem(card);
    });

    // Friendly empty message if no files to view
    if (visibleFiles.length === 0) {
      const emptyInfo = getEmptyFolderMessage(this.filter, this.searchQuery, visibleDirs.length > 0);
      const emptyEl = createElement("div", "vf-empty-folder-message");
      Object.assign(emptyEl.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        color: "#888",
        textAlign: "center",
        width: "100%",
        boxSizing: "border-box",
        userSelect: "none",
        gridColumn: isMosaic ? "" : "1 / -1",
      });
      emptyEl.innerHTML = `
        <div style="font-size: 32px; margin-bottom: 8px; opacity: 0.5;">${emptyInfo.icon}</div>
        <div style="font-size: 13px; font-weight: 500; color: #bbb;">${emptyInfo.title}</div>
        <div style="font-size: 11px; margin-top: 4px; color: #777;">${emptyInfo.subtitle}</div>
      `;
      if (isMosaic && visibleDirs.length === 0) {
        this.fileListEl.style.display = "flex";
        this.fileListEl.style.flexDirection = "column";
        this.fileListEl.style.alignItems = "center";
        this.fileListEl.style.justifyContent = "center";
      }
      this.fileListEl.appendChild(emptyEl);
    }
  }
}

export function openFileBrowserModal(node, targetWidget, options = {}) {
  const modal = new VFFileBrowserModal(node, targetWidget, options);
  modal.open();
  return modal;
}
