// 彩虹高亮助手 - 弹窗脚本
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

let currentColors = DEFAULT_COLORS.slice();

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

clearBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: "clear-all" }).catch(() => {});
  }
});

openPanelBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    await chrome.tabs.sendMessage(tab.id, { type: "open-keyword-panel" }).catch(() => {});
    window.close();
  }
});
