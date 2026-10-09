/**
 * Canvas Embedded File Explorer Widget for 🌀 VF File Explorer.
 */

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { clearDragPayload, setupDragPayload } from "./vf_canvas_drop.js";
import {
  createElement,
  createEmptyMessageEl,
  ensureSpinnerStyles,
  formatDateTime,
  formatDuration,
  getEmptyFolderMessage,
  icon,
  isSupportedMediaFile,
  makeModalBackdrop,
} from "./vf_ui_shared.js";

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
    this.sortBy = "name_asc";
    this.searchQuery = "";
    this.drives = [];
    this.favorites = [];
    this.dirs = [];
    this.files = [];
    this.selectedFile = null;

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
  }

  updateThumbToggleBtn() {
    if (!this.thumbToggleBtn) return;
    this.thumbToggleBtn.style.background = this.showThumbnails ? "#0066cc" : "#282834";
    this.thumbToggleBtn.style.color = this.showThumbnails ? "#fff" : "#888";
    this.thumbToggleBtn.style.borderColor = this.showThumbnails ? "#0077ee" : "#3c3c4c";
    this.thumbToggleBtn.title = this.showThumbnails ? "Thumbnails: ON (click to hide)" : "Thumbnails: OFF (click to show)";
  }

  updateLayoutToggleBtn() {
    if (!this.layoutToggleBtn) return;
    const isMosaic = this.layoutMode === "mosaic";
    this.layoutToggleBtn.innerHTML = isMosaic ? icon("mosaic") : icon("grid");
    this.layoutToggleBtn.style.background = isMosaic ? "#0066cc" : "#282834";
    this.layoutToggleBtn.style.color = isMosaic ? "#fff" : "#888";
    this.layoutToggleBtn.style.borderColor = isMosaic ? "#0077ee" : "#3c3c4c";
    this.layoutToggleBtn.title = isMosaic ? "Layout: Mosaic (click for Grid)" : "Layout: Grid (click for Mosaic)";
  }

  async init() {
    this.renderSkeleton();
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
    label.style.fontSize = "11px";
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
        padding: "2px 8px",
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

  async loadDirectory(dirPath) {
    this.currentPath = dirPath;
    this.pathLabel.textContent = dirPath;
    this.updateFavoriteButton();
    this.renderDrivePills();
    this.renderFavoritesBar();
    this.fileGridEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #888;">Loading...</div>';

    try {
      const url = `/api/vf-file-nodes/list?path=${encodeURIComponent(dirPath)}&filter=${encodeURIComponent(this.activeFilter)}&sort=${encodeURIComponent(this.sortBy)}`;
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

    // 1. Top Bar: Drives + Favorites + Up + Star + Path
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

    this.favoritesBar = createElement("div");
    Object.assign(this.favoritesBar.style, {
      display: "none",
      gap: "6px",
      overflowX: "auto",
      paddingBottom: "2px",
      alignItems: "center",
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
      padding: "4px 8px",
      cursor: "pointer",
      fontSize: "13px",
      lineHeight: "1",
    });
    this.favBtn.title = "Add current folder to favorites";
    this.favBtn.onclick = () => this.toggleCurrentFavorite();

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
    pathRow.appendChild(this.favBtn);
    pathRow.appendChild(this.pathLabel);

    topBar.appendChild(this.driveRow);
    topBar.appendChild(this.favoritesBar);
    topBar.appendChild(pathRow);
    this.container.appendChild(topBar);

    // 2. Filter Bar: Media tabs + Sort dropdown + Search
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

    const rightControls = createElement("div");
    rightControls.style.display = "flex";
    rightControls.style.alignItems = "center";
    rightControls.style.gap = "6px";

    this.sortSelect = createElement("select");
    Object.assign(this.sortSelect.style, {
      background: "#282834",
      color: "#eee",
      border: "1px solid #3c3c4c",
      borderRadius: "3px",
      padding: "3px 6px",
      fontSize: "11px",
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
    searchInput.placeholder = "Search...";
    Object.assign(searchInput.style, {
      width: "110px",
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

    this.thumbToggleBtn = createElement("button", "", "🖼️");
    Object.assign(this.thumbToggleBtn.style, {
      background: this.showThumbnails ? "#0066cc" : "#282834",
      color: this.showThumbnails ? "#fff" : "#888",
      border: `1px solid ${this.showThumbnails ? "#0077ee" : "#3c3c4c"}`,
      borderRadius: "3px",
      padding: "3px 6px",
      fontSize: "12px",
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
      this.renderGrid();
    };

    this.layoutToggleBtn = createElement("button");
    Object.assign(this.layoutToggleBtn.style, {
      background: this.layoutMode === "mosaic" ? "#0066cc" : "#282834",
      color: this.layoutMode === "mosaic" ? "#fff" : "#888",
      border: `1px solid ${this.layoutMode === "mosaic" ? "#0077ee" : "#3c3c4c"}`,
      borderRadius: "3px",
      padding: "3px 6px",
      fontSize: "12px",
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
      this.renderGrid();
    };

    rightControls.appendChild(this.sortSelect);
    rightControls.appendChild(this.thumbToggleBtn);
    rightControls.appendChild(this.layoutToggleBtn);
    rightControls.appendChild(searchInput);

    filterBar.appendChild(tabsContainer);
    filterBar.appendChild(rightControls);
    this.container.appendChild(filterBar);

    // 3. Grid area
    this.fileGridEl = createElement("div");
    Object.assign(this.fileGridEl.style, {
      flex: "1",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "10px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      background: "#14141a",
      boxSizing: "border-box",
    });
    this.container.appendChild(this.fileGridEl);

    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver((entries) => {
        if (this.layoutMode !== "mosaic") return;
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (!w) continue;
          const minColWidth = 120;
          const gap = 8;
          const newCols = Math.max(1, Math.floor((w + gap) / (minColWidth + gap)));
          if (this._currentCols && this._currentCols !== newCols) {
            this.renderGrid();
          }
        }
      });
      this._resizeObserver.observe(this.fileGridEl);
    }

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

    this.delBtn = createElement("button", "", "Delete");
    Object.assign(this.delBtn.style, {
      background: "#3e1818",
      color: "#ff7777",
      border: "1px solid #662626",
      borderRadius: "3px",
      padding: "4px 8px",
      fontSize: "11px",
      cursor: "pointer",
      display: "none",
    });
    this.delBtn.onclick = async () => {
      if (!this.selectedFile || !isSupportedMediaFile(this.selectedFile)) return;
      if (confirm(`Delete ${this.selectedFile.name}?`)) {
        const resp = await api.fetchApi("/api/vf-file-nodes/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: this.selectedFile.path }),
        });
        if (resp.ok) {
          this.selectFile(null);
          this.loadDirectory(this.currentPath);
        }
      }
    };

    btnGroup.appendChild(revealBtn);
    btnGroup.appendChild(this.delBtn);

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
      pill.onclick = () => {
        this.selectFile(null);
        this.loadDirectory(d.path);
      };
      this.driveRow.appendChild(pill);
    });
  }

  renderGrid() {
    this.fileGridEl.innerHTML = "";
    const isMosaic = this.layoutMode === "mosaic";

    // Filter visible items
    const visibleDirs = this.dirs.filter((dirName) => {
      if (this.searchQuery && !dirName.toLowerCase().includes(this.searchQuery)) return false;
      return true;
    });

    const visibleFiles = this.files.filter((file) => {
      if (this.searchQuery && !file.name.toLowerCase().includes(this.searchQuery)) return false;
      return true;
    });

    // 1. Both empty: center the empty state message
    if (visibleDirs.length === 0 && visibleFiles.length === 0) {
      Object.assign(this.fileGridEl.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "10px",
        gap: "0",
        gridTemplateColumns: "",
        gridAutoRows: "",
      });
      const emptyInfo = getEmptyFolderMessage(this.activeFilter, this.searchQuery, false);
      const emptyEl = createEmptyMessageEl(emptyInfo);
      this.fileGridEl.appendChild(emptyEl);
      return;
    }

    // 2. Normal scrollable container layout (vertical flow)
    Object.assign(this.fileGridEl.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: "flex-start",
      gap: "10px",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "10px",
      gridTemplateColumns: "",
      gridAutoRows: "",
    });

    let appendItem;
    if (isMosaic) {
      const minColWidth = 120;
      const gap = 8;
      const availableWidth = this.fileGridEl.clientWidth || (this.container.clientWidth ? this.container.clientWidth - 20 : DEFAULT_WIDTH);
      const numCols = Math.max(1, Math.floor((availableWidth + gap) / (minColWidth + gap)));
      this._currentCols = numCols;

      const mosaicWrapper = createElement("div", "vf-mosaic-wrapper");
      Object.assign(mosaicWrapper.style, {
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: `${gap}px`,
        width: "100%",
        boxSizing: "border-box",
      });

      const cols = [];
      for (let i = 0; i < numCols; i++) {
        const col = createElement("div", "vf-mosaic-col");
        Object.assign(col.style, {
          flex: "1",
          minWidth: "0",
          display: "flex",
          flexDirection: "column",
          gap: `${gap}px`,
        });
        mosaicWrapper.appendChild(col);
        cols.push(col);
      }

      let itemIdx = 0;
      appendItem = (card) => {
        cols[itemIdx % numCols].appendChild(card);
        itemIdx++;
      };

      this.fileGridEl.appendChild(mosaicWrapper);
    } else {
      this._currentCols = null;
      const contentGrid = createElement("div", "vf-grid-content");
      Object.assign(contentGrid.style, {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
        gridAutoRows: this.showThumbnails ? "120px" : "85px",
        gap: "8px",
        width: "100%",
        boxSizing: "border-box",
      });

      appendItem = (card) => {
        contentGrid.appendChild(card);
      };

      this.fileGridEl.appendChild(contentGrid);
    }

    // Folders
    visibleDirs.forEach((dirName) => {
      const card = createElement("div", "vf-card-dir");
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
        boxSizing: "border-box",
        width: "100%",
        minHeight: isMosaic ? "60px" : "",
      });
      card.innerHTML = `<span style="font-size: 24px;">📁</span>
        <span style="font-size: 10px; font-weight: 500; word-break: break-word; line-height: 1.2; max-height: 2.4em; overflow: hidden;">${dirName}</span>`;
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
      card.draggable = isSupported;
      Object.assign(card.style, {
        background: "#1f1f28",
        border: "1px solid #2d2d3c",
        borderRadius: "5px",
        padding: "4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: isMosaic ? "flex-start" : "space-between",
        gap: isMosaic ? "4px" : "0",
        cursor: isSupported ? "grab" : "pointer",
        position: "relative",
        boxSizing: "border-box",
        width: "100%",
        userSelect: "none",
      });

      card.ondragstart = (e) => {
        card.style.opacity = "0.5";
        setupDragPayload(e, file);
      };
      card.ondragend = () => {
        card.style.opacity = "1";
        clearDragPayload();
      };

      const thumb = createElement("div");
      Object.assign(thumb.style, {
        width: "100%",
        height: isMosaic ? (this.showThumbnails ? "auto" : "45px") : (this.showThumbnails ? "70px" : "45px"),
        minHeight: isMosaic && this.showThumbnails ? "40px" : "",
        maxHeight: isMosaic && this.showThumbnails ? "240px" : "",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "3px",
        background: "#14141a",
        overflow: "hidden",
        position: "relative",
      });

      if (this.showThumbnails && (file.media_type === "image" || file.media_type === "video")) {
        const img = document.createElement("img");
        img.draggable = false;
        img.src = `/api/vf-file-nodes/thumbnail?path=${encodeURIComponent(file.path)}`;
        Object.assign(img.style, {
          width: "100%",
          height: isMosaic ? "auto" : "100%",
          maxHeight: isMosaic ? "240px" : "",
          objectFit: isMosaic ? "contain" : "cover",
          display: "block",
        });
        img.onerror = () => {
          thumb.innerHTML = `<span style="font-size: 22px;">${file.media_type === "image" ? "🖼️" : "🎬"}</span>`;
        };
        thumb.appendChild(img);
      } else if (file.media_type === "image") {
        thumb.innerHTML = '<span style="font-size: 22px;">🖼️</span>';
      } else if (file.media_type === "video") {
        thumb.innerHTML = '<span style="font-size: 22px;">🎬</span>';
      } else if (file.media_type === "audio") {
        thumb.innerHTML = '<span style="font-size: 24px;">🎵</span>';
      } else {
        thumb.innerHTML = '<span style="font-size: 24px;">📄</span>';
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
          thumb.appendChild(durBadge);
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
          thumb.appendChild(dimBadge);
        }
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
        this.fileGridEl.querySelectorAll(".vf-card-file").forEach((c) => {
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

      appendItem(card);
    });

    // Friendly empty message if no files to view (placed BELOW the folders!)
    if (visibleFiles.length === 0) {
      const emptyInfo = getEmptyFolderMessage(this.activeFilter, this.searchQuery, visibleDirs.length > 0);
      const emptyEl = createEmptyMessageEl(emptyInfo);
      Object.assign(emptyEl.style, {
        padding: "24px 16px",
      });
      this.fileGridEl.appendChild(emptyEl);
    }
  }

  selectFile(file) {
    this.selectedFile = file;
    const isSupported = isSupportedMediaFile(file);
    if (this.delBtn) {
      this.delBtn.style.display = isSupported ? "inline-block" : "none";
    }
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
    return openPreviewModal(file);
  }
}

function copyToClipboard(text, btn, successLabel = "Copied!") {
  if (!text) return;
  const doFeedback = () => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `✓ ${successLabel}`;
      setTimeout(() => {
        btn.innerHTML = orig;
      }, 1800);
    }
  };
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(doFeedback).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      doFeedback();
    });
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    doFeedback();
  }
}

function buildSummaryText(params) {
  const parts = [];
  if (params.positive_prompt) {
    parts.push(`Positive Prompt:\n${params.positive_prompt.trim()}\n`);
  }
  if (params.negative_prompt) {
    parts.push(`Negative Prompt:\n${params.negative_prompt.trim()}\n`);
  }
  const settings = [];
  if (params.steps != null) settings.push(`Steps: ${params.steps}`);
  if (params.sampler != null) settings.push(`Sampler: ${params.sampler}`);
  if (params.scheduler != null) settings.push(`Scheduler: ${params.scheduler}`);
  if (params.cfg != null) settings.push(`CFG: ${params.cfg}`);
  if (params.seed != null) settings.push(`Seed: ${params.seed}`);
  if (params.denoise != null && params.denoise !== 1.0) settings.push(`Denoise: ${params.denoise}`);
  if (params.models && params.models.length > 0) settings.push(`Model: ${params.models.join(", ")}`);
  if (params.loras && params.loras.length > 0) {
    const loraStrs = params.loras.map((l) => `${l.name} (${l.strength ?? 1.0})`);
    settings.push(`LoRAs: ${loraStrs.join(", ")}`);
  }
  if (settings.length > 0) {
    parts.push(settings.join(", "));
  }
  return parts.join("\n");
}

function setupParamsDrawer(drawerEl, params) {
  drawerEl.innerHTML = "";

  // Drawer Header
  const header = createElement("div", "vf-params-drawer-header");
  Object.assign(header.style, {
    padding: "10px 14px",
    background: "#1a1a24",
    borderBottom: "1px solid #282836",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexShrink: "0",
  });

  const title = createElement("span", "", "⚙️ Parameters");
  Object.assign(title.style, {
    fontWeight: "600",
    fontSize: "12px",
    color: "#eee",
  });
  header.appendChild(title);

  const actions = createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  });

  const copySummaryBtn = createElement("button", "", "📋 Copy All");
  Object.assign(copySummaryBtn.style, {
    background: "#252535",
    border: "1px solid #3c3c4c",
    borderRadius: "3px",
    color: "#ccc",
    fontSize: "10px",
    padding: "3px 7px",
    cursor: "pointer",
    fontWeight: "500",
  });
  copySummaryBtn.onclick = () => copyToClipboard(buildSummaryText(params), copySummaryBtn);
  actions.appendChild(copySummaryBtn);

  if (params.has_workflow && params.workflow) {
    const loadWfBtn = createElement("button", "", "📥 Load into Canvas");
    Object.assign(loadWfBtn.style, {
      background: "#0066cc",
      border: "1px solid #0077ee",
      borderRadius: "3px",
      color: "#fff",
      fontSize: "10px",
      padding: "3px 7px",
      cursor: "pointer",
      fontWeight: "500",
    });
    loadWfBtn.onclick = () => {
      try {
        app.loadGraphData(params.workflow);
        const orig = loadWfBtn.textContent;
        loadWfBtn.textContent = "✓ Loaded!";
        setTimeout(() => {
          loadWfBtn.textContent = orig;
        }, 2000);
      } catch (err) {
        console.error("[VF File Nodes] Failed to load workflow:", err);
      }
    };
    actions.appendChild(loadWfBtn);
  }

  header.appendChild(actions);
  drawerEl.appendChild(header);

  // Drawer Body
  const body = createElement("div", "vf-params-drawer-body");
  Object.assign(body.style, {
    flex: "1",
    overflowY: "auto",
    overflowX: "hidden",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    boxSizing: "border-box",
  });

  // 1. Positive Prompt
  if (params.positive_prompt) {
    const section = createElement("div");
    const labelRow = createElement("div");
    Object.assign(labelRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "4px",
    });
    const label = createElement("span", "", "Positive Prompt");
    Object.assign(label.style, {
      fontSize: "11px",
      fontWeight: "600",
      color: "#66bb6a",
    });
    const copyBtn = createElement("button", "", "Copy");
    Object.assign(copyBtn.style, {
      background: "#252535",
      border: "1px solid #3c3c4c",
      borderRadius: "3px",
      color: "#bbb",
      fontSize: "10px",
      padding: "1px 6px",
      cursor: "pointer",
    });
    copyBtn.onclick = () => copyToClipboard(params.positive_prompt, copyBtn);
    labelRow.appendChild(label);
    labelRow.appendChild(copyBtn);

    const textBox = createElement("div", "", params.positive_prompt);
    Object.assign(textBox.style, {
      background: "#0c0c14",
      border: "1px solid #252535",
      borderRadius: "4px",
      padding: "8px 10px",
      fontSize: "11px",
      lineHeight: "1.4",
      color: "#eee",
      maxHeight: "130px",
      overflowY: "auto",
      userSelect: "text",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    });
    section.appendChild(labelRow);
    section.appendChild(textBox);
    body.appendChild(section);
  }

  // 2. Negative Prompt
  if (params.negative_prompt) {
    const section = createElement("div");
    const labelRow = createElement("div");
    Object.assign(labelRow.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "4px",
    });
    const label = createElement("span", "", "Negative Prompt");
    Object.assign(label.style, {
      fontSize: "11px",
      fontWeight: "600",
      color: "#ef5350",
    });
    const copyBtn = createElement("button", "", "Copy");
    Object.assign(copyBtn.style, {
      background: "#252535",
      border: "1px solid #3c3c4c",
      borderRadius: "3px",
      color: "#bbb",
      fontSize: "10px",
      padding: "1px 6px",
      cursor: "pointer",
    });
    copyBtn.onclick = () => copyToClipboard(params.negative_prompt, copyBtn);
    labelRow.appendChild(label);
    labelRow.appendChild(copyBtn);

    const textBox = createElement("div", "", params.negative_prompt);
    Object.assign(textBox.style, {
      background: "#140e10",
      border: "1px solid #381e22",
      borderRadius: "4px",
      padding: "8px 10px",
      fontSize: "11px",
      lineHeight: "1.4",
      color: "#e0bbbb",
      maxHeight: "90px",
      overflowY: "auto",
      userSelect: "text",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    });
    section.appendChild(labelRow);
    section.appendChild(textBox);
    body.appendChild(section);
  }

  // 3. Settings Grid
  const gridItems = [];
  if (params.seed != null) gridItems.push({ label: "Seed", value: String(params.seed), copyable: true });
  if (params.steps != null) gridItems.push({ label: "Steps", value: String(params.steps) });
  if (params.cfg != null) gridItems.push({ label: "CFG", value: String(params.cfg) });
  if (params.sampler != null) gridItems.push({ label: "Sampler", value: String(params.sampler) });
  if (params.scheduler != null) gridItems.push({ label: "Scheduler", value: String(params.scheduler) });
  if (params.denoise != null) gridItems.push({ label: "Denoise", value: String(params.denoise) });

  if (gridItems.length > 0) {
    const gridEl = createElement("div");
    Object.assign(gridEl.style, {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: "6px",
    });

    gridItems.forEach((item) => {
      const cell = createElement("div");
      Object.assign(cell.style, {
        background: "#181824",
        border: "1px solid #282838",
        borderRadius: "4px",
        padding: "6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: "0",
      });
      const lblRow = createElement("div");
      Object.assign(lblRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      });
      const lbl = createElement("span", "", item.label);
      Object.assign(lbl.style, {
        fontSize: "9px",
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "#888",
      });
      lblRow.appendChild(lbl);

      if (item.copyable) {
        const miniCopy = createElement("span", "", "📋");
        miniCopy.title = "Copy Seed";
        Object.assign(miniCopy.style, {
          fontSize: "10px",
          cursor: "pointer",
          opacity: "0.6",
        });
        miniCopy.onmouseenter = () => { miniCopy.style.opacity = "1"; };
        miniCopy.onmouseleave = () => { miniCopy.style.opacity = "0.6"; };
        miniCopy.onclick = (e) => {
          e.stopPropagation();
          copyToClipboard(item.value, miniCopy, "✓");
        };
        lblRow.appendChild(miniCopy);
      }

      const val = createElement("span", "", item.value);
      Object.assign(val.style, {
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#eee",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        userSelect: "text",
      });
      val.title = item.value;

      cell.appendChild(lblRow);
      cell.appendChild(val);
      gridEl.appendChild(cell);
    });
    body.appendChild(gridEl);
  }

  // 4. Models
  if (params.models && params.models.length > 0) {
    const modelSection = createElement("div");
    const mLabel = createElement("div", "", "Model");
    Object.assign(mLabel.style, {
      fontSize: "9px",
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "#888",
      marginBottom: "4px",
    });
    modelSection.appendChild(mLabel);
    params.models.forEach((m) => {
      const pill = createElement("div", "", m);
      Object.assign(pill.style, {
        background: "#181824",
        border: "1px solid #282838",
        borderRadius: "4px",
        padding: "4px 8px",
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#88ccff",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        marginBottom: "4px",
        userSelect: "text",
      });
      pill.title = m;
      modelSection.appendChild(pill);
    });
    body.appendChild(modelSection);
  }

  // 5. LoRAs
  if (params.loras && params.loras.length > 0) {
    const loraSection = createElement("div");
    const lLabel = createElement("div", "", "LoRAs");
    Object.assign(lLabel.style, {
      fontSize: "9px",
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: "#888",
      marginBottom: "4px",
    });
    loraSection.appendChild(lLabel);
    params.loras.forEach((l) => {
      const lRow = createElement("div");
      Object.assign(lRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "#181824",
        border: "1px solid #282838",
        borderRadius: "4px",
        padding: "4px 8px",
        marginBottom: "4px",
        gap: "6px",
      });
      const lName = createElement("span", "", l.name);
      Object.assign(lName.style, {
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#ffcc66",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: "1",
        userSelect: "text",
      });
      lName.title = l.name;
      const lStrength = createElement("span", "", `${l.strength ?? 1.0}`);
      Object.assign(lStrength.style, {
        fontSize: "10px",
        fontFamily: "monospace",
        color: "#aaa",
        background: "rgba(255,255,255,0.06)",
        padding: "1px 5px",
        borderRadius: "3px",
        flexShrink: "0",
      });
      lRow.appendChild(lName);
      lRow.appendChild(lStrength);
      loraSection.appendChild(lRow);
    });
    body.appendChild(loraSection);
  }

  // 6. Raw Data (JSON)
  const details = createElement("details");
  Object.assign(details.style, {
    border: "1px solid #282838",
    borderRadius: "4px",
    padding: "6px 8px",
    background: "#101018",
    marginTop: "2px",
  });
  const summary = createElement("summary", "", "Raw Data (JSON)");
  Object.assign(summary.style, {
    fontSize: "10px",
    fontWeight: "600",
    color: "#888",
    cursor: "pointer",
    outline: "none",
    userSelect: "none",
  });
  details.appendChild(summary);

  const jsonBtnRow = createElement("div");
  Object.assign(jsonBtnRow.style, {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  });

  if (params.workflow) {
    const copyWfBtn = createElement("button", "", "Copy Workflow JSON");
    Object.assign(copyWfBtn.style, {
      background: "#20202e",
      border: "1px solid #38384e",
      borderRadius: "3px",
      color: "#bbb",
      fontSize: "10px",
      padding: "3px 7px",
      cursor: "pointer",
    });
    copyWfBtn.onclick = () => copyToClipboard(JSON.stringify(params.workflow, null, 2), copyWfBtn);
    jsonBtnRow.appendChild(copyWfBtn);
  }

  if (params.prompt) {
    const copyPrBtn = createElement("button", "", "Copy Prompt JSON");
    Object.assign(copyPrBtn.style, {
      background: "#20202e",
      border: "1px solid #38384e",
      borderRadius: "3px",
      color: "#bbb",
      fontSize: "10px",
      padding: "3px 7px",
      cursor: "pointer",
    });
    copyPrBtn.onclick = () => copyToClipboard(JSON.stringify(params.prompt, null, 2), copyPrBtn);
    jsonBtnRow.appendChild(copyPrBtn);
  }

  details.appendChild(jsonBtnRow);
  body.appendChild(details);

  drawerEl.appendChild(body);
}

export function openPreviewModal(file) {
  let cleanupListeners = null;
    const { backdrop, close } = makeModalBackdrop({
      zIndex: 10100,
      onClose: () => cleanupListeners?.(),
    });
    const content = createElement("div");
    Object.assign(content.style, {
      maxWidth: "94vw",
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
      gap: "12px",
    });

    const titleGroup = createElement("div");
    Object.assign(titleGroup.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      minWidth: "0",
      flex: "1",
    });

    const titleEl = createElement("div", "", file.name);
    Object.assign(titleEl.style, {
      fontSize: "13px",
      fontWeight: "600",
      color: "#eee",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    titleGroup.appendChild(titleEl);

    const metaRow = createElement("div", "vf-modal-meta-row");
    Object.assign(metaRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "11px",
      color: "#aaa",
      flexWrap: "wrap",
      lineHeight: "1.2",
    });
    titleGroup.appendChild(metaRow);

    const headerActions = createElement("div", "vf-modal-header-actions");
    Object.assign(headerActions.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexShrink: "0",
    });

    const paramsBtn = createElement("button", "vf-modal-params-btn");
    paramsBtn.innerHTML = `⚙️ Parameters`;
    Object.assign(paramsBtn.style, {
      background: "#282834",
      border: "1px solid #3c3c4c",
      borderRadius: "4px",
      color: "#ccc",
      fontSize: "11px",
      fontWeight: "500",
      padding: "4px 9px",
      cursor: "pointer",
      display: "none",
      alignItems: "center",
      gap: "5px",
      transition: "all 0.15s ease",
    });

    const closeBtn = createElement("button", "", "✕");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#aaa",
      fontSize: "16px",
      cursor: "pointer",
      padding: "4px 8px",
      flexShrink: "0",
    });
    closeBtn.onclick = () => {
      cleanupListeners?.();
      close();
    };

    headerActions.appendChild(paramsBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(titleGroup);
    header.appendChild(headerActions);
    content.appendChild(header);

    let currentDimensions = file.dimensions && Array.isArray(file.dimensions) ? file.dimensions : null;
    let currentDuration = file.duration && file.duration > 0 ? file.duration : null;

    const renderMeta = () => {
      metaRow.innerHTML = "";
      const isSupported = isSupportedMediaFile(file);
      if (!isSupported) return;

      // 1. Dimensions badge (e.g. 1920×1080)
      if (currentDimensions && currentDimensions.length === 2 && currentDimensions[0] > 0) {
        const dimBadge = createElement("span", "vf-badge-dimensions", `${currentDimensions[0]}×${currentDimensions[1]}`);
        Object.assign(dimBadge.style, {
          background: "rgba(255, 255, 255, 0.08)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "3px",
          padding: "1px 6px",
          fontSize: "10px",
          fontFamily: "monospace",
          fontWeight: "500",
          color: "#ddd",
        });
        metaRow.appendChild(dimBadge);
      }

      // 2. Duration badge (e.g. 0:05)
      if (currentDuration != null && currentDuration > 0) {
        const durBadge = createElement("span", "vf-badge-duration", formatDuration(currentDuration));
        Object.assign(durBadge.style, {
          background: "rgba(255, 255, 255, 0.08)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "3px",
          padding: "1px 6px",
          fontSize: "10px",
          fontFamily: "monospace",
          fontWeight: "600",
          color: "#ddd",
        });
        metaRow.appendChild(durBadge);
      }

      // 3. Creation date/time
      const timeVal = file.ctime || file.mtime;
      if (timeVal) {
        const timeSpan = createElement("span", "vf-modal-meta-time", formatDateTime(timeVal));
        Object.assign(timeSpan.style, {
          color: "#999",
          fontSize: "11px",
        });
        metaRow.appendChild(timeSpan);
      }

      // 4. File size
      if (file.size != null && file.size > 0) {
        const sizeStr = file.size > 1024 * 1024
          ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
          : `${(file.size / 1024).toFixed(1)} KB`;
        const sizeSpan = createElement("span", "vf-modal-meta-size", `•  ${sizeStr}`);
        Object.assign(sizeSpan.style, {
          color: "#888",
          fontSize: "11px",
        });
        metaRow.appendChild(sizeSpan);
      }
    };

    renderMeta();

    ensureSpinnerStyles();

    const mainContainer = createElement("div", "vf-modal-main-container");
    Object.assign(mainContainer.style, {
      display: "flex",
      flexDirection: "row",
      flex: "1",
      minHeight: "0",
      minWidth: "0",
      overflow: "hidden",
      position: "relative",
    });

    const body = createElement("div");
    Object.assign(body.style, {
      padding: "16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "320px",
      minHeight: "220px",
      position: "relative",
      flex: "1",
      overflow: "hidden",
    });

    const paramsDrawer = createElement("div", "vf-modal-params-drawer");
    Object.assign(paramsDrawer.style, {
      width: "360px",
      maxWidth: "45vw",
      minWidth: "280px",
      background: "#14141c",
      borderLeft: "1px solid #2a2a38",
      display: "none",
      flexDirection: "column",
      flexShrink: "0",
      overflow: "hidden",
      boxSizing: "border-box",
    });

    let currentParams = null;
    let isParamsOpen = true;
    try {
      const saved = localStorage.getItem("vf_file_nodes_show_parameters");
      if (saved !== null) {
        isParamsOpen = saved !== "false";
      }
    } catch (e) {}

    const updateParamsToggleState = () => {
      paramsDrawer.style.display = isParamsOpen ? "flex" : "none";
      paramsBtn.style.background = isParamsOpen ? "#0066cc" : "#282834";
      paramsBtn.style.color = isParamsOpen ? "#fff" : "#ccc";
      paramsBtn.style.borderColor = isParamsOpen ? "#0077ee" : "#3c3c4c";
    };

    paramsBtn.onmouseenter = () => {
      if (!isParamsOpen) paramsBtn.style.background = "#333344";
    };
    paramsBtn.onmouseleave = () => {
      if (!isParamsOpen) paramsBtn.style.background = "#282834";
    };

    paramsBtn.onclick = () => {
      isParamsOpen = !isParamsOpen;
      try {
        localStorage.setItem("vf_file_nodes_show_parameters", isParamsOpen ? "true" : "false");
      } catch (e) {}
      updateParamsToggleState();
    };

    fetch(`/api/vf-file-nodes/comfy-parameters?path=${encodeURIComponent(file.path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.has_parameters) return;
        currentParams = data;
        paramsBtn.style.display = "inline-flex";
        setupParamsDrawer(paramsDrawer, data);
        updateParamsToggleState();
      })
      .catch((err) => {
        console.debug("[VF File Nodes] ComfyUI parameters fetch error:", err);
      });

    const spinner = createElement("div", "vf-modal-spinner");
    Object.assign(spinner.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      color: "#aaa",
      fontSize: "12px",
      zIndex: "5",
      background: "#181820",
      minHeight: "220px",
      minWidth: "320px",
    });
    spinner.innerHTML = `
      <div style="
        width: 36px;
        height: 36px;
        border: 3px solid rgba(255, 255, 255, 0.12);
        border-top-color: #0088ff;
        border-radius: 50%;
        animation: vf-spin 0.8s linear infinite;
      "></div>
      <div style="font-weight: 500; color: #aaa;">Loading preview...</div>
    `;
    body.appendChild(spinner);

    if (file.media_type === "image") {
      const imageContainer = createElement("div", "vf-modal-image-container");
      Object.assign(imageContainer.style, {
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        maxWidth: "100%",
        maxHeight: "75vh",
        borderRadius: "4px",
        opacity: "0",
        transition: "opacity 0.15s ease-in",
      });
      imageContainer.title = "🔍 Use scroll wheel to zoom (up to 4x)";

      const img = document.createElement("img");
      img.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`;
      img.onload = () => {
        spinner.remove();
        imageContainer.style.opacity = "1";
        if (img.naturalWidth && img.naturalHeight) {
          if (!currentDimensions || currentDimensions[0] !== img.naturalWidth || currentDimensions[1] !== img.naturalHeight) {
            currentDimensions = [img.naturalWidth, img.naturalHeight];
            renderMeta();
          }
        }
      };
      img.onerror = () => {
        spinner.innerHTML = `<span style="font-size: 28px;">⚠️</span><span style="color: #e66; font-size: 12px;">Failed to load image preview</span>`;
      };
      Object.assign(img.style, {
        maxWidth: "100%",
        maxHeight: "75vh",
        objectFit: "contain",
        transformOrigin: "center center",
        transition: "transform 0.08s ease-out",
        userSelect: "none",
        pointerEvents: "none",
      });
      img.draggable = false;

      const tooltip = createElement("div", "vf-modal-zoom-tooltip");
      Object.assign(tooltip.style, {
        position: "absolute",
        bottom: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(18, 18, 26, 0.85)",
        color: "#eee",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        backdropFilter: "blur(6px)",
        borderRadius: "20px",
        padding: "5px 14px",
        fontSize: "11px",
        fontWeight: "500",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        pointerEvents: "none",
        boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
        zIndex: "10",
        whiteSpace: "nowrap",
        userSelect: "none",
      });

      let zoom = 1.0;
      const MAX_ZOOM = 4.0;
      const MIN_ZOOM = 1.0;
      let panX = 0;
      let panY = 0;
      let isDragging = false;
      let startX = 0;
      let startY = 0;

      const updateTooltip = () => {
        const zoomText = zoom > 1.0 ? ` (${zoom.toFixed(1)}x)` : "";
        tooltip.innerHTML = `<span style="font-size: 13px;">🔍</span> <span>Use scroll wheel to zoom (up to 4x)${zoomText}</span>`;
      };
      updateTooltip();

      const applyTransform = () => {
        if (zoom <= 1.0) {
          panX = 0;
          panY = 0;
          imageContainer.style.cursor = "default";
        } else {
          imageContainer.style.cursor = isDragging ? "grabbing" : "grab";
        }
        img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      };

      imageContainer.addEventListener("wheel", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const prevZoom = zoom;
        const delta = e.deltaY < 0 ? 0.25 : -0.25;
        zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoom + delta) * 100) / 100));

        if (zoom <= 1.0) {
          panX = 0;
          panY = 0;
        } else if (prevZoom !== zoom) {
          const rect = imageContainer.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - rect.width / 2;
          const mouseY = e.clientY - rect.top - rect.height / 2;
          const factor = (zoom - prevZoom) / prevZoom;
          panX -= (mouseX - panX) * factor;
          panY -= (mouseY - panY) * factor;
        }

        applyTransform();
        updateTooltip();
      }, { passive: false });

      imageContainer.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (zoom > 1.0) {
          isDragging = true;
          startX = e.clientX - panX;
          startY = e.clientY - panY;
          imageContainer.style.cursor = "grabbing";
          e.preventDefault();
          e.stopPropagation();
        }
      });

      const onMouseMove = (e) => {
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        applyTransform();
      };

      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          imageContainer.style.cursor = zoom > 1.0 ? "grab" : "default";
        }
      };

      imageContainer.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoom = 1.0;
        panX = 0;
        panY = 0;
        applyTransform();
        updateTooltip();
      });

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);

      cleanupListeners = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      imageContainer.appendChild(img);
      imageContainer.appendChild(tooltip);
      body.appendChild(imageContainer);
    } else if (file.media_type === "video") {
      const video = document.createElement("video");
      video.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`;
      video.controls = true;
      video.autoplay = true;
      video.style.maxWidth = "100%";
      video.style.maxHeight = "75vh";
      video.style.opacity = "0";
      video.style.transition = "opacity 0.15s ease-in";
      video.onloadeddata = () => {
        spinner.remove();
        video.style.opacity = "1";
        let changed = false;
        if (video.videoWidth && video.videoHeight) {
          if (!currentDimensions || currentDimensions[0] !== video.videoWidth || currentDimensions[1] !== video.videoHeight) {
            currentDimensions = [video.videoWidth, video.videoHeight];
            changed = true;
          }
        }
        if (video.duration && !isNaN(video.duration) && video.duration > 0) {
          if (!currentDuration || Math.abs(currentDuration - video.duration) > 0.5) {
            currentDuration = video.duration;
            changed = true;
          }
        }
        if (changed) renderMeta();
      };
      video.onerror = () => {
        spinner.innerHTML = `<span style="font-size: 28px;">⚠️</span><span style="color: #e66; font-size: 12px;">Failed to load video preview</span>`;
      };
      body.appendChild(video);
    } else if (file.media_type === "audio") {
      const audio = document.createElement("audio");
      audio.src = `/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`;
      audio.controls = true;
      audio.autoplay = true;
      audio.style.opacity = "0";
      audio.style.transition = "opacity 0.15s ease-in";
      audio.onloadeddata = () => {
        spinner.remove();
        audio.style.opacity = "1";
        if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
          if (!currentDuration || Math.abs(currentDuration - audio.duration) > 0.5) {
            currentDuration = audio.duration;
            renderMeta();
          }
        }
      };
      audio.onerror = () => {
        spinner.innerHTML = `<span style="font-size: 28px;">⚠️</span><span style="color: #e66; font-size: 12px;">Failed to load audio preview</span>`;
      };
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
        opacity: "0",
        transition: "opacity 0.15s ease-in",
      });
      fetch(`/api/vf-file-nodes/view?path=${encodeURIComponent(file.path)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then((t) => {
          spinner.remove();
          pre.textContent = t.slice(0, 50000);
          pre.style.opacity = "1";
          const lines = t.split("\n").length;
          const lineSpan = createElement("span", "vf-modal-meta-lines", `•  ${lines} lines`);
          Object.assign(lineSpan.style, { color: "#888", fontSize: "11px" });
          metaRow.appendChild(lineSpan);
        })
        .catch(() => {
          spinner.innerHTML = `<span style="font-size: 28px;">⚠️</span><span style="color: #e66; font-size: 12px;">Failed to load text preview</span>`;
        });
      body.appendChild(pre);
    }

    mainContainer.appendChild(body);
    mainContainer.appendChild(paramsDrawer);
    content.appendChild(mainContainer);
    backdrop.appendChild(content);
    document.body.appendChild(backdrop);
  }

