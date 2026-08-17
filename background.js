// ============================================================
// 彩虹高亮助手 - 后台脚本（右键菜单 + 消息自愈）
// v1.4.1：发送消息失败时自动尝试重新注入脚本；仍失败则自动刷新重开关键词框 / 通知用户
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

// ---------- 消息发送 + 自愈 ----------
// 扩展在 chrome://extensions 点"重新加载"后，已打开页面里的旧脚本会失效（Extension context invalidated）。
// 这里依次尝试：直接发送 → 重新注入内容脚本 → 刷新页面（关键词框场景）/ 通知用户（其他场景）。
async function sendWithRecovery(tabId, msg, { reopenPanel = false } = {}) {
  // 1) 直接发送（正常情况）
  try {
    const r = await chrome.tabs.sendMessage(tabId, msg);
    if (r && r.ok) return true;
  } catch (e) { /* 失败则继续 */ }
  // 2) 尝试重新注入内容脚本（覆盖"扩展已更新/刚安装但页面没刷新"的情况）
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (e) {
    return false; // 页面不允许注入（chrome:// 等）
  }
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "get-state" });
    if (r && typeof r.enabled === "boolean") {
      await chrome.tabs.sendMessage(tabId, msg);
      return true;
    }
  } catch (e) { /* 继续 */ }
  // 3) 仍无响应 = 页面里残留已失效的旧脚本
  if (reopenPanel) {
    await reloadAndReopenPanel(tabId);
    return true;
  }
  notifyNeedRefresh();
  return false;
}

function notifyNeedRefresh() {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon48.png"),
      title: "彩虹高亮助手",
      message: "当前页面还停留在旧版脚本：请刷新页面（F5）后重试。"
    });
  } catch (e) { /* 通知不可用则忽略 */ }
}

// 刷新页面，等加载完成后自动重新打开关键词框
async function reloadAndReopenPanel(tabId) {
  let settled = false;
  const done = new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete" && !settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, 15000);
  });
  try {
    await chrome.tabs.reload(tabId);
  } catch (e) {
    return;
  }
  await done;
  // 等 content script 注入完成
  await new Promise((r) => setTimeout(r, 500));
  try {
    await chrome.tabs.sendMessage(tabId, { type: "open-keyword-panel" });
  } catch (e) { /* 若仍失败，用户可再点一次 */ }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  const id = String(info.menuItemId || "");
  if (id === "rh-keyword-panel") {
    sendWithRecovery(tab.id, { type: "open-keyword-panel" }, { reopenPanel: true });
  } else if (id === "rh-remove") {
    sendWithRecovery(tab.id, { type: "remove-in-selection" });
  } else if (id.startsWith("rh-color-")) {
    const bg = decodeURIComponent(id.slice("rh-color-".length));
    sendWithRecovery(tab.id, { type: "highlight", bg });
  }
});
