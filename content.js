// ============================================================
// 彩虹高亮助手 - 内容脚本 v1.4（Chrome / Edge 通用）
// 交互：
//   1) 选中文字 → 弹出工具条：8 个颜色按钮 + 一个长方形文本框
//   2) 点击颜色按钮 → 该颜色成为"当前颜色"，文本框切换到该颜色
//   3) 在文本框输入词汇（空格分隔）→ 全页所有出现位置用当前颜色高亮
//   4) 每个颜色可以分别填不同的词：点红色按钮输入 A 词，点蓝色按钮输入 B 词
//   5) 刷新页面后高亮自动恢复（保存在浏览器本地存储）
// ============================================================
(() => {
  if (window.__RH_INSTALLED__) return;
  window.__RH_INSTALLED__ = true;

  // 默认 8 色：红 → 紫（彩虹顺序，红色固定第一位）
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

  let colors = DEFAULT_COLORS.slice();
  let enabled = true;
  let toolbar = null;
  let savedRange = null;
  let toolbarVisible = false;
  let activeColor = DEFAULT_COLORS[0].bg; // 当前颜色（默认红）
  let colorWords = {}; // { [bg]: "该颜色的词 空格分隔" }
  let keywordTimer = null;
  let keywordInput = null;
  let colorLabel = null;

  // ---------- 持久化（刷新后自动恢复） ----------
  const STORE_KEY = "rh_pages"; // { [url]: { colorWords, selections, t } }
  const MAX_PAGES = 50; // 最多保存 50 个页面，超出自动清理最旧的
  let observer = null;
  let observerTimer = null;

  // ---------- 上下文安全防护 ----------
  // 扩展在 chrome://extensions 里被"重新加载"后，旧页面里的脚本上下文会失效，
  // 继续调用 chrome API 会抛 "Extension context invalidated"。
  // 这里统一检查：失效后所有 chrome API 调用静默忽略，不再报错。
  function isCtxAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }
  function storageSyncGet(defaults, cb) {
    try {
      chrome.storage.sync.get(defaults, (data) => {
        if (isCtxAlive()) cb(data || {});
      });
    } catch (e) { /* 上下文已失效，忽略 */ }
  }
  function storageSyncSet(obj) {
    try { chrome.storage.sync.set(obj); } catch (e) { /* 上下文已失效，忽略 */ }
  }
  function storageLocalGet(key, cb) {
    try {
      chrome.storage.local.get(key, (data) => {
        if (isCtxAlive()) cb(data || {});
      });
    } catch (e) { /* 上下文已失效，忽略 */ }
  }
  function storageLocalSet(obj) {
    try { chrome.storage.local.set(obj); } catch (e) { /* 上下文已失效，忽略 */ }
  }

  // ---------- 配置 ----------
  function normalizeColors(list) {
    const arr = Array.isArray(list) && list.length >= 1 ? list : DEFAULT_COLORS;
    const out = [];
    for (let i = 0; i < DEFAULT_COLORS.length; i++) {
      const def = DEFAULT_COLORS[i];
      const src = arr[i] || def;
      out.push({
        name: typeof src.name === "string" && src.name ? src.name : def.name,
        key: def.key,
        bg: typeof src.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(src.bg) ? src.bg : def.bg,
        enabled: src.enabled !== false
      });
    }
    return out;
  }

  storageSyncGet({ rh_colors: DEFAULT_COLORS, rh_enabled: true }, (data) => {
    colors = normalizeColors(data.rh_colors);
    enabled = data.rh_enabled !== false;
    restoreState(); // 配置加载完成后，恢复本页保存的高亮
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isCtxAlive()) return;
    if (area !== "sync") return;
    if (changes.rh_colors) colors = normalizeColors(changes.rh_colors.newValue);
    if (changes.rh_enabled) enabled = changes.rh_enabled.newValue !== false;
    hideToolbar();
  });

  // ---------- 选区 ----------
  function saveRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0).cloneRange();
    if (!range.toString().trim()) return null;
    if (toolbar && range.intersectsNode(toolbar)) return null;
    return range;
  }

  function getTextNodesInRange(range) {
    const nodes = [];
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (toolbar && toolbar.contains(node)) return NodeFilter.FILTER_REJECT;
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    if (root.nodeType === Node.TEXT_NODE && range.intersectsNode(root)) nodes.push(root);
    return nodes;
  }

  // ---------- 高亮（选中区域） ----------
  function applyHighlight(range, bg, keepToolbar) {
    const nodes = getTextNodesInRange(range);
    let count = 0;
    for (const node of nodes) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (start >= end) continue;
      let mid, tail;
      try {
        mid = node.splitText(start);
        tail = mid.splitText(end - start);
        void tail;
      } catch (err) {
        continue;
      }
      const mark = document.createElement("mark");
      mark.className = "rh-hl";
      mark.style.backgroundColor = bg;
      mark.style.color = "#141414";
      mark.setAttribute("data-rh", bg);
      node.parentNode.insertBefore(mark, mid);
      mark.appendChild(mid);
      count++;
    }
    savedRange = null;
    if (!keepToolbar) {
      if (window.getSelection) window.getSelection().removeAllRanges();
      hideToolbar();
    }
    saveState();
    return count;
  }

  function removeMark(mark) {
    if (!mark || !mark.isConnected) return;
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }

  function removeInRange(range) {
    const marks = new Set();
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.classList && node.classList.contains("rh-hl") && range.intersectsNode(node)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) marks.add(walker.currentNode);
    if (
      root.nodeType === Node.ELEMENT_NODE &&
      root.classList && root.classList.contains("rh-hl") &&
      range.intersectsNode(root)
    ) {
      marks.add(root);
    }
    marks.forEach(removeMark);
    saveState();
  }

  function clearAll() {
    document.querySelectorAll("mark.rh-hl").forEach(removeMark);
    colorWords = {};
    if (keywordInput) keywordInput.value = "";
    savedRange = null;
    hideToolbar();
    saveState();
  }

  // ---------- 关键词高亮（按颜色分组） ----------
  function isExcludedTextNode(node) {
    if (toolbar && toolbar.contains(node)) return true;
    let el = node.parentElement;
    while (el) {
      if (el === toolbar) return true;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TITLE") return true;
      if (el.classList && el.classList.contains("rh-hl")) return true; // 不重复包裹已高亮文字
      el = el.parentElement;
    }
    return false;
  }

  function buildWordRegex(word) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 纯英文/数字词汇按整词匹配，中文等直接按子串匹配
    if (/^[A-Za-z0-9_]+$/.test(word)) return new RegExp(`\\b${esc}\\b`, "gi");
    return new RegExp(esc, "gi");
  }

  function parseWords(text) {
    return (text || "").split(/\s+/).map((s) => s.trim()).filter(Boolean);
  }

  // 把每个颜色的词都包成对应颜色的高亮
  function wrapOccurrences(tokens) {
    if (!enabled || !tokens.length) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isExcludedTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const rules = tokens.map((t) => ({ re: buildWordRegex(t.text), bg: t.bg }));
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const text = node.data;
      const matches = [];
      for (const rule of rules) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(text)) !== null) {
          if (m[0].length === 0) {
            rule.re.lastIndex++;
            continue;
          }
          matches.push([m.index, m.index + m[0].length, rule.bg]);
        }
      }
      if (!matches.length) continue;
      // 排序并合并重叠区间（重叠时保留先出现的词的颜色）
      matches.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const merged = [];
      for (const [s, e, bg] of matches) {
        const last = merged[merged.length - 1];
        if (last && s < last[1]) {
          if (e > last[1]) last[1] = e;
        } else {
          merged.push({ s, e, bg });
        }
      }
      // 从后往前包裹，保证前面偏移量不变
      for (let i = merged.length - 1; i >= 0; i--) {
        const { s, e, bg } = merged[i];
        try {
          const mark = document.createElement("mark");
          mark.className = "rh-hl rh-key";
          mark.style.backgroundColor = bg;
          mark.style.color = "#141414";
          mark.setAttribute("data-rh", bg);
          const mid = node.splitText(s);
          mid.splitText(e - s);
          node.parentNode.insertBefore(mark, mid);
          mark.appendChild(mid);
        } catch (err) {
          // 忽略单个节点的失败
        }
      }
    }
  }

  // 按"每个颜色各自的词"重新渲染全部关键词高亮
  function renderAllKeywords() {
    document.querySelectorAll("mark.rh-key").forEach(removeMark); // 先移除旧的关键词高亮
    const tokens = [];
    colors.forEach((c) => {
      if (c.enabled === false) return;
      const words = parseWords(colorWords[c.bg] || "");
      words.forEach((w) => tokens.push({ text: w, bg: c.bg }));
    });
    wrapOccurrences(tokens);
  }

  // ---------- 持久化（保存 / 恢复 / 动态内容重亮） ----------
  function currentUrlKey() {
    try {
      return location.href.replace(/#.*$/, ""); // 去掉锚点，避免 #xxx 变化丢失
    } catch (e) {
      return "";
    }
  }

  function collectSelections() {
    const selections = [];
    document.querySelectorAll("mark.rh-hl:not(.rh-key)").forEach((mark) => {
      const text = (mark.textContent || "").trim();
      const bg = mark.getAttribute("data-rh") || "";
      if (!text || !bg) return;
      if (!selections.some((k) => k.text === text && k.bg === bg)) selections.push({ text, bg });
    });
    return selections;
  }

  function hasWords() {
    return Object.values(colorWords).some((w) => (w || "").trim());
  }

  function saveState() {
    const url = currentUrlKey();
    if (!url) return;
    const selections = collectSelections();
    storageLocalGet(STORE_KEY, (data) => {
      const pages = data[STORE_KEY] || {};
      if (!selections.length && !hasWords()) {
        delete pages[url];
      } else {
        pages[url] = { colorWords, selections, t: Date.now() };
      }
      // 清理超出上限的最旧页面
      const entries = Object.entries(pages);
      if (entries.length > MAX_PAGES) {
        entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
        const keep = new Set(entries.slice(0, MAX_PAGES).map((e) => e[0]));
        for (const key of Object.keys(pages)) if (!keep.has(key)) delete pages[key];
      }
      storageLocalSet({ [STORE_KEY]: pages });
      if (selections.length || hasWords()) startObserver();
    });
  }

  // 兼容旧版本（v1.3 保存的 keywords 数组）→ 转成按颜色的词表
  function migratePage(page) {
    if (!page.colorWords && Array.isArray(page.keywords) && page.keywords.length) {
      const cw = {};
      page.keywords.forEach((k) => {
        if (!k || !k.bg || !k.text) return;
        cw[k.bg] = (cw[k.bg] ? cw[k.bg] + " " : "") + k.text;
      });
      page.colorWords = cw;
    }
    return page;
  }

  function applyStored(page) {
    if (!page) return;
    page = migratePage(page);
    if (page.colorWords) colorWords = page.colorWords;
    renderAllKeywords();
    if (page.selections && page.selections.length) {
      wrapOccurrences(page.selections.map((s) => ({ text: s.text, bg: s.bg })));
    }
  }

  function restoreState() {
    const url = currentUrlKey();
    if (!url || !enabled) return;
    storageLocalGet(STORE_KEY, (data) => {
      const page = (data[STORE_KEY] || {})[url];
      if (!page) return;
      applyStored(page);
      startObserver();
      // 动态加载的页面：延迟再补一次，覆盖后加载出来的内容
      setTimeout(() => applyStored(page), 900);
    });
  }

  // 监控页面新增内容：有新文字出现时，自动重新应用保存的高亮
  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        let self = false;
        if (m.target === toolbar) self = true;
        if (!self && m.target && m.target.nodeType === 1 && m.target.classList && m.target.classList.contains("rh-hl")) self = true;
        if (!self) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.classList && n.classList.contains("rh-hl")) { self = true; break; }
          }
        }
        if (!self) {
          for (const n of m.removedNodes) {
            if (n.nodeType === 1 && n.classList && n.classList.contains("rh-hl")) { self = true; break; }
          }
        }
        if (self) return; // 我们自己的改动，忽略，避免死循环
      }
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        const url = currentUrlKey();
        storageLocalGet(STORE_KEY, (data) => {
          applyStored((data[STORE_KEY] || {})[url]);
        });
      }, 1000);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- 工具条 ----------
  function activeColorName() {
    const c = colors.find((x) => x.bg === activeColor);
    return c ? c.name : "";
  }

  function buildToolbar() {
    if (toolbar) {
      toolbar.remove();
      toolbar = null;
    }
    toolbar = document.createElement("div");
    toolbar.id = "rh-toolbar";

    // 左侧：8 个颜色按钮
    colors.forEach((c) => {
      if (c.enabled === false) return;
      const dot = document.createElement("span");
      dot.className = "rh-dot" + (c.bg === activeColor ? " rh-active" : "");
      dot.style.backgroundColor = c.bg;
      dot.title = c.name + "色按钮：点击后，文本框输入的词就用这个颜色高亮";
      dot.addEventListener("mousedown", (e) => e.preventDefault());
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveColor(c.bg);
      });
      toolbar.appendChild(dot);
    });

    const sep = document.createElement("span");
    sep.className = "rh-sep";
    toolbar.appendChild(sep);

    // 当前颜色标签
    colorLabel = document.createElement("span");
    colorLabel.className = "rh-cname";
    toolbar.appendChild(colorLabel);

    // 长方形文本框：内容属于"当前颜色"
    keywordInput = document.createElement("input");
    keywordInput.type = "text";
    keywordInput.className = "rh-input";
    keywordInput.spellcheck = false;
    keywordInput.setAttribute("autocomplete", "off");
    keywordInput.addEventListener("mousedown", () => {
      savedRange = null; // 点击文本框后不再对旧选区上色
    });
    keywordInput.addEventListener("input", () => {
      colorWords[activeColor] = keywordInput.value;
      clearTimeout(keywordTimer);
      keywordTimer = setTimeout(() => {
        renderAllKeywords();
        saveState();
      }, 250);
    });
    keywordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        hideToolbar(); // 回车 = 完成，收起工具条，高亮保留
      }
    });
    toolbar.appendChild(keywordInput);

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "rh-btn";
    btnRemove.textContent = "移除选中";
    btnRemove.title = "移除选中区域内的所有高亮";
    btnRemove.addEventListener("mousedown", (e) => e.preventDefault());
    btnRemove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (savedRange) {
        removeInRange(savedRange);
        savedRange = null;
        hideToolbar();
      }
    });
    toolbar.appendChild(btnRemove);

    const btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.className = "rh-btn";
    btnAll.textContent = "全部清除";
    btnAll.title = "移除本页所有高亮";
    btnAll.addEventListener("mousedown", (e) => e.preventDefault());
    btnAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearAll();
    });
    toolbar.appendChild(btnAll);

    (document.body || document.documentElement).appendChild(toolbar);
    syncColorUI();
  }

  // 同步"当前颜色"的界面：按钮高亮圈、颜色标签、文本框内容与提示
  function syncColorUI() {
    if (!toolbar) return;
    toolbar.querySelectorAll(".rh-dot").forEach((d) => {
      d.classList.toggle("rh-active", d.style.backgroundColor === activeColor);
    });
    if (colorLabel) {
      colorLabel.textContent = activeColorName();
      colorLabel.style.backgroundColor = activeColor;
    }
    if (keywordInput) {
      keywordInput.value = colorWords[activeColor] || "";
      keywordInput.placeholder = `在「${activeColorName()}」色中输入要高亮的词，空格分隔`;
      keywordInput.title =
        "这里输入的高亮词使用当前颜色（见左侧按钮）。\n" +
        "多个词用空格分隔。\n" +
        "先点左侧颜色按钮切换颜色，再输入：每个颜色可以分别填不同的词。";
    }
  }

  function setActiveColor(bg) {
    activeColor = bg;
    syncColorUI();
    if (savedRange) {
      const r = savedRange;
      savedRange = null;
      applyHighlight(r, bg, true); // 顺便给当前选中文字上这个颜色，工具条保留
    }
    if (keywordInput) keywordInput.focus();
  }

  function showToolbar(range, opts = {}) {
    buildToolbar();
    toolbar.style.visibility = "hidden";
    toolbar.style.display = "flex";
    const tw = toolbar.offsetWidth;
    const th = toolbar.offsetHeight;
    toolbar.style.visibility = "";
    if (range) {
      // 有选区：显示在选区下方
      const rect = range.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
      let top = rect.bottom + 8;
      if (top + th > window.innerHeight - 8) top = Math.max(8, rect.top - th - 8);
      toolbar.style.left = left + "px";
      toolbar.style.top = top + "px";
    } else {
      // 无选区（点击扩展图标打开关键词框）：固定在右上角
      toolbar.style.left = Math.max(8, window.innerWidth - tw - 16) + "px";
      toolbar.style.top = "16px";
    }
    toolbarVisible = true;
    if (opts.focusInput && keywordInput) keywordInput.focus();
  }

  function hideToolbar() {
    if (toolbar) toolbar.style.display = "none";
    toolbarVisible = false;
  }

  // ---------- 页面事件 ----------
  document.addEventListener(
    "mouseup",
    (e) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      if (toolbar && toolbar.contains(e.target)) return;
      const range = saveRange();
      if (range) {
        savedRange = range;
        showToolbar(range);
      } else {
        hideToolbar();
      }
    },
    true
  );

  // 右键时也记住选区（配合右键菜单高亮）
  document.addEventListener(
    "contextmenu",
    () => {
      savedRange = saveRange();
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (toolbar && !toolbar.contains(e.target)) hideToolbar();
    },
    true
  );

  // 滚动时收起工具条
  window.addEventListener("scroll", () => hideToolbar(), true);

  // 离开页面前兜底保存一次
  window.addEventListener("beforeunload", () => saveState());

  // 仅保留 Esc 关闭；无任何高亮快捷键
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") hideToolbar();
    },
    true
  );

  // ---------- 来自 background / popup 的消息 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isCtxAlive()) return;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "highlight":
        if (enabled) {
          const range = savedRange || saveRange();
          if (range) applyHighlight(range, msg.bg);
        }
        sendResponse({ ok: true });
        break;
      case "remove-in-selection":
        if (enabled) {
          const range = savedRange || saveRange();
          if (range) removeInRange(range);
        }
        sendResponse({ ok: true });
        break;
      case "clear-all":
        clearAll();
        sendResponse({ ok: true });
        break;
      case "open-keyword-panel":
        savedRange = null;
        showToolbar(null, { focusInput: true });
        sendResponse({ ok: true });
        break;
      case "get-state":
        sendResponse({ enabled: !!enabled });
        break;
    }
  });
})();
