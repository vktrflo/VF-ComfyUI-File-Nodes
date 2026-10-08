/**
 * Shared UI primitives and SVG icons for VF ComfyUI File Nodes.
 */

export function createElement(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null && text !== "") el.textContent = text;
  return el;
}

const SVG_START = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const SVG_END = '</svg>';

const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  drive: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8"/><circle cx="6" cy="15" r="1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  video: '<path d="m22 7-6 5 6 5V7z"/><rect x="2" y="5" width="14" height="14" rx="2" ry="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  mosaic: '<rect x="3" y="3" width="7" height="11"/><rect x="14" y="3" width="7" height="6"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="17" width="7" height="4"/>',
};

export function icon(name) {
  const path = ICONS[name] || ICONS.folder;
  return `${SVG_START}${path}${SVG_END}`;
}

export function makeModalBackdrop({ onClose, zIndex = 10000 } = {}) {
  const backdrop = createElement("div", "vf-modal-backdrop");
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: String(zIndex),
  });

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      cleanup();
      if (typeof onClose === "function") onClose();
    }
  };

  const onClick = (e) => {
    if (e.target === backdrop) {
      cleanup();
      if (typeof onClose === "function") onClose();
    }
  };

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    backdrop.removeEventListener("click", onClick);
    if (backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  backdrop.addEventListener("click", onClick);

  return { backdrop, close: cleanup };
}

export const SUPPORTED_EXTENSIONS = new Set([
  // Image
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tga", ".exr",
  // Video
  ".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv", ".wmv",
  // Audio
  ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".aiff", ".opus",
  // Text
  ".txt", ".json", ".md", ".yaml", ".yml", ".csv", ".xml", ".html", ".css", ".js", ".py", ".toml",
]);

export function isSupportedMediaFile(file) {
  if (!file) return false;
  if (file.media_type && ["image", "video", "audio", "text"].includes(file.media_type)) {
    return true;
  }
  const name = file.name || file.path || "";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function ensureSpinnerStyles() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("vf-ui-shared-styles")) {
    const style = document.createElement("style");
    style.id = "vf-ui-shared-styles";
    style.textContent = `
      @keyframes vf-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export function formatDateTime(sec) {
  if (!sec || isNaN(sec)) return "";
  const d = new Date(sec * 1000);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const dateStr = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr}, ${timeStr}`;
}

export function formatDuration(sec) {
  if (sec == null || isNaN(sec) || sec <= 0) return "";
  const total = Math.floor(sec);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const sPad = s < 10 ? `0${s}` : `${s}`;
  if (h > 0) {
    const mPad = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mPad}:${sPad}`;
  }
  return `${m}:${sPad}`;
}

export function getEmptyFolderMessage(filter = "all", searchQuery = "", hasDirs = false) {
  if (searchQuery) {
    return {
      title: "No matching files",
      subtitle: `No files found matching "${searchQuery}"`,
      icon: "🔍",
    };
  }
  const typeLabels = {
    all: "files",
    image: "image files",
    video: "video files",
    audio: "audio files",
    text: "text files",
  };
  const label = typeLabels[filter] || "files";
  if (!hasDirs) {
    if (filter === "all") {
      return {
        title: "This folder is empty",
        subtitle: "No files or subfolders found here",
        icon: "📂",
      };
    }
    return {
      title: `No ${label} found`,
      subtitle: `There are no ${label} in this folder`,
      icon: "📂",
    };
  }
  return {
    title: `No ${label} to view`,
    subtitle: `This folder has subfolders, but no ${label}`,
    icon: "📁",
  };
}
