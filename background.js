// ============================================================
// 彩虹高亮助手 - 后台脚本（负责右键菜单）
// ============================================================
const DEFAULT_COLORS = [
  { name: "红", key: "R", bg: "#ff6b6b" },
  { name: "橙", key: "O", bg: "#ffa94d" },
  { name: "黄", key: "Y", bg: "#ffd43b" },
  { name: "绿", key: "G", bg: "#69db7c" },
  { name: "青", key: "C", bg: "#3bc9db" },
  { name: "蓝", key: "B", bg: "#4dabf7" },
  { name: "靛", key: "I", bg: "#748ffc" },
  { name: "紫", key: "P", bg: "#b197fc" }
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ rh_colors: DEFAULT_COLORS }, (data) => {
    if (!data.rh_colors) chrome.storage.sync.set({ rh_colors: DEFAULT_COLORS });
  });
  buildMenus();
});

chrome.runtime.onStartup.addListener(() => buildMenus());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.rh_colors || changes.rh_enabled)) buildMenus();
});

function buildMenus() {
  chrome.storage.sync.get({ rh_colors: DEFAULT_COLORS, rh_enabled: true }, (data) => {
    chrome.contextMenus.removeAll(() => {
      if (data.rh_enabled === false) return;
      const list = Array.isArray(data.rh_colors) && data.rh_colors.length ? data.rh_colors : DEFAULT_COLORS;
      chrome.contextMenus.create({
        id: "rh-keyword-panel",
        title: "🔍 按关键词高亮（打开关键词框）",
        contexts: ["page", "selection"]
      });
      chrome.contextMenus.create({ id: "rh-parent", title: "🌈 彩虹高亮", contexts: ["selection"] });
      list.forEach((c) => {
        if (c.enabled === false) return;
        const swatch = encodeURIComponent(c.bg);
        chrome.contextMenus.create({
          id: "rh-color-" + swatch,
          parentId: "rh-parent",
          title: `${c.name}色高亮`,
          contexts: ["selection"]
        });
      });
      chrome.contextMenus.create({
        id: "rh-remove",
        parentId: "rh-parent",
        title: "移除选中区域的高亮",
        contexts: ["selection"]
      });
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  const id = String(info.menuItemId || "");
  if (id === "rh-keyword-panel") {
    chrome.tabs.sendMessage(tab.id, { type: "open-keyword-panel" }).catch(() => {});
  } else if (id === "rh-remove") {
    chrome.tabs.sendMessage(tab.id, { type: "remove-in-selection" }).catch(() => {});
  } else if (id.startsWith("rh-color-")) {
    const bg = decodeURIComponent(id.slice("rh-color-".length));
    chrome.tabs.sendMessage(tab.id, { type: "highlight", bg }).catch(() => {});
  }
});
