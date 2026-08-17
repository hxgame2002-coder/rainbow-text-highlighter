// 彩虹高亮助手 - 弹窗脚本
// v1.4.1：打开关键词框失败时自动尝试修复（重新注入脚本 / 提示刷新），不再静默失败
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

const list = document.getElementById("color-list");
const toggle = document.getElementById("enabled");
const resetBtn = document.getElementById("reset");
const clearBtn = document.getElementById("clear-page");
const openPanelBtn = document.getElementById("open-panel");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const refreshBtn = document.getElementById("refresh-page");

let currentColors = DEFAULT_COLORS.slice();

function showStatus(text, kind) {
  statusEl.hidden = false;
  statusEl.className = "status" + (kind ? " " + kind : "");
  statusText.textContent = text;
  refreshBtn.hidden = kind !== "refresh";
}

function hideStatus() {
  statusEl.hidden = true;
}

// 浏览器内置页面 / 商店 / PDF 等不允许注入脚本，给用户明确的解释
function describeUnsupported(url) {
  if (!url) return null;
  if (/^(chrome|edge|about|devtools|chrome-untrusted|chrome-extension):/i.test(url)) {
    return "这是浏览器内置页面，不支持扩展。";
  }
  if (/^https:\/\/chrome\.google\.com\//i.test(url)) {
    return "Chrome 应用商店页面不支持扩展。";
  }
  if (/^view-source:/i.test(url)) {
    return "查看源代码页面不支持扩展。";
  }
  if (/^file:/i.test(url)) {
    return "本地文件页面：请在 chrome://extensions 的扩展详情里打开「允许访问文件网址」。";
  }
  return null;
}

// 依次尝试：直接发消息 → 重新注入内容脚本 → 提示刷新页面
async function ensureAndOpen(tabId) {
  // 1) 直接发送（正常情况）
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "open-keyword-panel" });
    if (r && r.ok) return "ok";
  } catch (e) { /* 失败则继续 */ }
  // 2) 尝试注入内容脚本（覆盖"扩展已更新/刚安装但页面没刷新"的情况）
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (e) {
    return "unsupported"; // 页面不允许注入
  }
  // 3) 注入后确认脚本是否响应
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "get-state" });
    if (r && typeof r.enabled === "boolean") {
      await chrome.tabs.sendMessage(tabId, { type: "open-keyword-panel" });
      return "ok";
    }
  } catch (e) { /* 继续 */ }
  // 4) 仍无响应 = 页面里残留着已失效的旧脚本，必须刷新
  return "stale";
}

openPanelBtn.addEventListener("click", async () => {
  hideStatus();
  openPanelBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) {
      showStatus("无法获取当前标签页。", "error");
      return;
    }
    const why = describeUnsupported(tab.url);
    if (why) {
      showStatus(why, "error");
      return;
    }
    const result = await ensureAndOpen(tab.id);
    if (result === "ok") {
      window.close();
      return;
    }
    if (result === "unsupported") {
      showStatus("此页面不允许注入扩展脚本，无法打开关键词框。", "error");
      return;
    }
    // stale：旧脚本失效
    showStatus("当前页面还停留在旧版脚本：请刷新页面后重试。", "refresh");
    refreshBtn.onclick = () => {
      chrome.tabs.reload(tab.id);
      window.close();
    };
  } finally {
    openPanelBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "clear-all" });
    if (r && r.ok) {
      window.close();
      return;
    }
  } catch (e) { /* 继续 */ }
  showStatus("清除失败：页面需要刷新（F5）后重试。", "refresh");
  refreshBtn.onclick = () => {
    chrome.tabs.reload(tab.id);
    window.close();
  };
});

function render(colors) {
  currentColors = colors.map((c) => ({ ...c }));
  list.innerHTML = "";
  colors.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "row";

    const sw = document.createElement("input");
    sw.type = "color";
    sw.value = c.bg;
    sw.title = "点击修改该颜色";
    sw.addEventListener("input", () => patchColor(i, { bg: sw.value }));

    const label = document.createElement("span");
    label.className = "cname";
    label.textContent = `${c.name}色`;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = c.enabled !== false;
    cb.title = "是否在工具条中显示";
    cb.addEventListener("change", () => patchColor(i, { enabled: cb.checked }));

    row.append(sw, label, cb);
    list.appendChild(row);
  });
}

function patchColor(i, patch) {
  const colors = currentColors.map((c) => ({ ...c }));
  Object.assign(colors[i], patch);
  currentColors = colors;
  chrome.storage.sync.set({ rh_colors: colors });
}

chrome.storage.sync.get({ rh_colors: DEFAULT_COLORS, rh_enabled: true }, (data) => {
  toggle.checked = data.rh_enabled !== false;
  const list2 = data.rh_colors && data.rh_colors.length ? data.rh_colors : DEFAULT_COLORS;
  render(list2);
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ rh_enabled: toggle.checked });
});

resetBtn.addEventListener("click", () => {
  chrome.storage.sync.set({ rh_colors: DEFAULT_COLORS }, () => render(DEFAULT_COLORS));
});
