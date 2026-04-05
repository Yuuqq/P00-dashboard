/**
 * P00 新闻素养学习中枢
 * 任务链引擎 · 模块系统 · 进度追踪 · 数据聚合
 */
const SITE_BASE = "https://yuuqq.github.io";

// ===== 5 大学习模块 =====
const MODULES = [
  {
    id: "mod-ai", emoji: "🤖", name: "AI 内容生产与审核",
    desc: "掌握 AI 辅助内容的识别、核验与合理使用",
    tools: [
      { id: "P01", name: "多模型对比器" }, { id: "P06", name: "提示词构建器" },
      { id: "P09", name: "SSML 语音编辑器" }, { id: "P10", name: "AIGC 检测仪" },
      { id: "P07", name: "微信排版器" }, { id: "P34", name: "聊天式报告" },
      { id: "P04", name: "术语粉碎机" }, { id: "P05", name: "可读性检测" },
      { id: "P03", name: "语音转文字" }, { id: "P41", name: "Agent 门户" }
    ]
  },
  {
    id: "mod-data", emoji: "📊", name: "数据可视化与验证",
    desc: "从数据清洗到可视化呈现的完整素养链",
    tools: [
      { id: "P11", name: "CSV 清洗器" }, { id: "P12", name: "本福特检测" },
      { id: "P13", name: "桑基图" }, { id: "P14", name: "新闻时间轴" },
      { id: "P16", name: "预算树图" }, { id: "P18", name: "竞速柱图" },
      { id: "P20", name: "词云" }, { id: "P15", name: "故事地图" },
      { id: "P47", name: "漏斗计算" }, { id: "P40", name: "S 曲线模拟" }
    ]
  },
  {
    id: "mod-osint", emoji: "🔍", name: "OSINT 开源调查",
    desc: "图片溯源、地理定位、数字取证等调查技术",
    tools: [
      { id: "P21", name: "EXIF 检测" }, { id: "P22", name: "阴影地理验证" },
      { id: "P23", name: "Dork 构建器" }, { id: "P24", name: "反向搜图" },
      { id: "P25", name: "Wayback 时光机" }, { id: "P26", name: "水军雷达" },
      { id: "P28", name: "Deepfake 放大镜" }, { id: "P30", name: "交叉核验" },
      { id: "P50", name: "OSINT 书签" }, { id: "P17", name: "前后对比" }
    ]
  },
  {
    id: "mod-think", emoji: "🧠", name: "批判性思维训练",
    desc: "识别逻辑谬误、对抗信息茧房、培养独立判断",
    tools: [
      { id: "P08", name: "AI 幻觉错题本" }, { id: "P29", name: "谬误连连看" },
      { id: "P35", name: "信息茧房迷宫" }, { id: "P37", name: "沉默螺旋" },
      { id: "P39", name: "打字防御战" }, { id: "P48", name: "闪卡训练" },
      { id: "P33", name: "主编划重点" }, { id: "P19", name: "调色板测试" },
      { id: "P36", name: "视障模式" }, { id: "P38", name: "VR 新闻" }
    ]
  },
  {
    id: "mod-ethics", emoji: "⚖️", name: "新闻伦理与实务",
    desc: "隐私保护、信息公开、伦理决策与职业规范",
    tools: [
      { id: "P31", name: "伦理分叉" }, { id: "P27", name: "隐私条款高亮" },
      { id: "P46", name: "FOIA 生成器" }, { id: "P45", name: "简报引擎" },
      { id: "P42", name: "作品集" }, { id: "P43", name: "播客页面" },
      { id: "P44", name: "翻页杂志" }, { id: "P49", name: "RSS 报纸" },
      { id: "P32", name: "滚动叙事" }, { id: "P02", name: "情感分析" }
    ]
  }
];

// ===== 任务链定义 =====
const MISSIONS = [
  {
    id: "mission-fake-video",
    emoji: "🎬",
    title: "核查一条'地震现场'视频",
    desc: "一段声称拍摄于某地地震的视频在社交媒体疯传。你需要使用 OSINT 工具链验证其真伪。这是记者日常面对的最典型虚假信息场景。",
    difficulty: "⭐⭐",
    time: "15-20 分钟",
    category: "OSINT 调查",
    steps: [
      { tool: "P21", name: "EXIF 检测", action: "上传图片，提取 GPS 坐标和拍摄时间", hint: "注意 DateTimeOriginal 和 GPS 经纬度字段" },
      { tool: "P22", name: "阴影地理验证", action: "输入坐标和时间，验证阴影角度是否匹配", hint: "如果声称是上午拍的，但阴影指向东面，说明时间不对" },
      { tool: "P24", name: "反向搜图", action: "截取关键帧，搜索是否为旧图新发", hint: "尝试 Google、Yandex 和 TinEye 三个引擎" },
      { tool: "P08", name: "核查知识测验", action: "完成 Q1 和 Q7 的作答验证你的核查知识", hint: "Q1 考的就是这个场景的最佳第一步" }
    ]
  },
  {
    id: "mission-data-fraud",
    emoji: "📈",
    title: "识别一份造假的财务数据",
    desc: "一家上市公司公布了看起来完美的营收数据。你需要运用数据素养工具检验这些数字是否真实——真实的数据几乎从不完美。",
    difficulty: "⭐⭐⭐",
    time: "20-25 分钟",
    category: "数据验证",
    steps: [
      { tool: "P11", name: "CSV 清洗", action: "导入公司公布的营收 CSV，清洗格式异常", hint: "观察是否有重复行、空值、格式不一致等疑点" },
      { tool: "P12", name: "本福特定律检测", action: "对营收数字做首数字分布检验", hint: "自然数据的首数字遵循本福特定律——不符合可能意味着人为操纵" },
      { tool: "P47", name: "漏斗计算器", action: "计算声称的转化率是否符合行业基准", hint: "如果宣称 80% 转化率但行业平均只有 2%，需要更多证据" },
      { tool: "P18", name: "竞速柱图", action: "将该公司与同行竞品做趋势比较", hint: "如果其他公司都在下滑但这家独自暴涨，需要追问原因" },
      { tool: "P08", name: "核查知识测验", action: "完成 Q15 的数据可视化操纵识别题", hint: "Y轴截断、基数效应、窗口选择都是操纵手法" }
    ]
  },
  {
    id: "mission-ai-content",
    emoji: "🤖",
    title: "审核一篇 AI 生成的新闻稿",
    desc: "编辑部收到一篇疑似 AI 生成的投稿。你的任务是判断其是否为 AI 生成、核验引用真实性、并评估是否达到发稿标准。",
    difficulty: "⭐⭐",
    time: "15-20 分钟",
    category: "AI 审核",
    steps: [
      { tool: "P10", name: "AIGC 检测仪", action: "将全文粘贴进行 AI 生成内容检测", hint: "关注困惑度（Perplexity）和爆发度（Burstiness）指标" },
      { tool: "P05", name: "可读性检测", action: "分析文本的 Flesch 可读性分数和句式多样性", hint: "AI 文本往往过于均匀，句长方差低" },
      { tool: "P04", name: "术语粉碎机", action: "扫描文本中的行话密度和空泛表达", hint: "过多的行话堆砌而缺乏具体事实，是 AI 八股文的特征" },
      { tool: "P08", name: "核查知识测验", action: "完成 Q14 和 Q20 关于 AI 引用核查和 AP 准则的题目", hint: "30-70% 的 AI 引用是虚构的——这是核心知识点" }
    ]
  },
  {
    id: "mission-bot-network",
    emoji: "🕸️",
    title: "揭穿一个水军协同网络",
    desc: "某话题下出现大量同质化评论。你需要使用网络分析工具和行为特征分析来识别这些账号是否为自动化协同水军。",
    difficulty: "⭐⭐⭐",
    time: "20-25 分钟",
    category: "OSINT 调查",
    steps: [
      { tool: "P26", name: "水军雷达", action: "生成模拟网络，调整时间阈值和度数阈值识别 Bot 集群", hint: "Bot 的发帖时间间隔极短（<500ms），且互相关注形成密集拓扑" },
      { tool: "P35", name: "信息茧房迷宫", action: "体验只点击同立场内容后信息多样性如何快速收敛", hint: "观察多样性分数从 100% 到个位数只需几轮" },
      { tool: "P37", name: "沉默螺旋 BBS", action: "模拟在充斥水军评论的环境中少数意见如何被压制", hint: "当水军占多数时，真实用户会减少发言——这就是沉默螺旋" },
      { tool: "P08", name: "核查知识测验", action: "完成 Q8 和 Q16 的 Bot 识别相关题目", hint: "3分钟47条推文远超人类极限" }
    ]
  },
  {
    id: "mission-ethics",
    emoji: "⚖️",
    title: "灾难报道中的伦理抉择",
    desc: "你是刚到灾难现场的记者。在报道与救人之间、在真实与隐私之间，你将面临一系列没有标准答案的伦理困境。",
    difficulty: "⭐",
    time: "10-15 分钟",
    category: "新闻伦理",
    steps: [
      { tool: "P31", name: "伦理分叉", action: "选择故事 A，体验灾难现场的伦理抉择树", hint: "每个选择都会导向不同的结局——没有唯一正确答案" },
      { tool: "P27", name: "隐私条款高亮", action: "分析一份受害者信息发布声明中的隐私条款", hint: "哪些信息可以公开？哪些需要打码？" },
      { tool: "P46", name: "FOIA 生成器", action: "针对此次事故向有关部门起草信息公开申请", hint: "信息公开是记者获取官方数据的法定渠道" }
    ]
  }
];

// ===== 进度持久化 =====
const DASHBOARD_PROJECT_ID = "P00";
const PROGRESS_KEY = "p00_mission_progress";
const TOOLS_KEY_PREFIX = "pm_metrics_events_";
const TASK_START_KEY_PREFIX = "pm_metrics_task_start_";
const TOOLBOX_THEME_KEY = "journalism_toolbox_theme";

function extractTrackedProjectId(storageKey) {
  if (!storageKey || !storageKey.startsWith(TOOLS_KEY_PREFIX)) return null;
  const pid = storageKey.replace(TOOLS_KEY_PREFIX, "").match(/^P\d+/)?.[0];
  return pid && pid !== DASHBOARD_PROJECT_ID ? pid : null;
}

function getTrackedMetricsEntries() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const pid = extractTrackedProjectId(key);
    if (!pid || !key) continue;
    try {
      const events = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(events)) continue;
      entries.push({ key, pid, events });
    } catch {}
  }
  return entries;
}

function isManagedStorageKey(key) {
  return key === PROGRESS_KEY
    || key === TOOLBOX_THEME_KEY
    || !!extractTrackedProjectId(key)
    || key?.startsWith(TASK_START_KEY_PREFIX);
}

function getManagedStorageSnapshot() {
  const snapshot = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isManagedStorageKey(key)) continue;
    snapshot[key] = localStorage.getItem(key);
  }
  return snapshot;
}

function clearManagedStorage() {
  const keys = Object.keys(getManagedStorageSnapshot());
  keys.forEach(key => localStorage.removeItem(key));
  return keys.length;
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); } catch { return {}; }
}
function saveProgress(p) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); }

function getToolsUsed() {
  const used = new Set();
  getTrackedMetricsEntries().forEach(({ pid }) => used.add(pid));
  return used;
}

// ===== Tab 切换 =====
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const modal = document.getElementById("missionModal");
const modalDialog = modal.querySelector(".modal");
const modalCloseBtn = document.getElementById("modalClose");
const tabOrder = Array.from(tabs);
let currentMission = null;
let lastFocusedElement = null;

function activateTab(tab, { focus = false } = {}) {
  tabs.forEach(t => {
    const isActive = t === tab;
    const panel = document.getElementById("panel" + capitalize(t.dataset.tab));
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
    t.tabIndex = isActive ? 0 : -1;
    if (panel) {
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
    }
  });
  if (focus) tab.focus();
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    activateTab(tab);
  });
  tab.addEventListener("keydown", e => {
    const idx = tabOrder.indexOf(tab);
    let nextIdx = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabOrder.length;
    if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabOrder.length) % tabOrder.length;
    if (e.key === "Home") nextIdx = 0;
    if (e.key === "End") nextIdx = tabOrder.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    activateTab(tabOrder[nextIdx], { focus: true });
  });
});
panels.forEach(panel => { panel.hidden = !panel.classList.contains("active"); });
tabs.forEach(t => t.tabIndex = t.classList.contains("active") ? 0 : -1);
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ===== 渲染任务卡片 =====
function renderMissions() {
  const grid = document.getElementById("missionGrid");
  const progress = loadProgress();
  grid.innerHTML = MISSIONS.map(m => {
    const p = progress[m.id] || {};
    const done = m.steps.filter((_, i) => p["step" + i]).length;
    const total = m.steps.length;
    const pct = Math.round((done / total) * 100);
    const complete = done === total;
    return `<div class="mission-card${complete ? " mc-complete" : ""}" data-mission="${m.id}">
      <span class="mc-emoji">${m.emoji}</span>
      <h3>${m.title}</h3>
      <p class="mc-desc">${m.desc}</p>
      <div class="mc-meta">
        <span>📂 ${m.category}</span>
        <span>${m.difficulty}</span>
        <span>⏱ ${m.time}</span>
        <span>📋 ${done}/${total} 步骤</span>
      </div>
      <div class="mc-progress"><div class="mc-bar"><div class="mc-bar-fill" style="width:${pct}%"></div></div></div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".mission-card").forEach(card => {
    card.addEventListener("click", () => openMissionModal(card.dataset.mission));
  });
}

// ===== 任务详情弹窗 =====
function closeMissionModal({ restoreFocus = true } = {}) {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  if (restoreFocus && lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

function openMissionModal(missionId) {
  currentMission = MISSIONS.find(m => m.id === missionId);
  if (!currentMission) return;
  lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const progress = loadProgress();
  const p = progress[missionId] || {};

  document.getElementById("modalTitle").textContent = `${currentMission.emoji} ${currentMission.title}`;
  document.getElementById("modalDesc").textContent = currentMission.desc;
  document.getElementById("modalBadge").textContent = `${currentMission.difficulty} · ${currentMission.time}`;

  const stepsEl = document.getElementById("modalSteps");
  stepsEl.innerHTML = currentMission.steps.map((step, i) => {
    const done = p["step" + i];
    return `<div class="step-item${done ? " step-done" : ""}">
      <span class="step-num">${done ? "✓" : i + 1}</span>
      <div class="step-info">
        <span class="step-tool">${step.tool} ${step.name}</span>
        <span class="step-action">${step.action}</span>
        <small style="color:var(--ink-secondary);display:block;margin-top:6px;padding:6px 10px;background:var(--accent-light);border-radius:6px;line-height:1.5;font-size:0.78rem">💡 ${step.hint}</small>
        ${done ? '<span style="color:var(--ok);font-size:0.75rem">✅ 已完成</span>' : `<a href="${SITE_BASE}/${step.tool}-${getToolSlug(step.tool)}/" target="_blank" 
          class="tool-link" data-step="${i}" style="display:inline-block;margin-top:8px">
          ▶ 打开工具</a>`}
      </div>
    </div>`;
  }).join("");

  // Click handler for tool links to mark step done
  stepsEl.querySelectorAll(".tool-link").forEach(link => {
    link.addEventListener("click", () => {
      const stepIdx = link.dataset.step;
      markStepDone(missionId, stepIdx);
      setTimeout(() => openMissionModal(missionId), 300);
    });
  });

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => modalCloseBtn.focus());
}

function markStepDone(missionId, stepIdx) {
  const prog = loadProgress();
  if (!prog[missionId]) prog[missionId] = {};
  prog[missionId]["step" + stepIdx] = true;
  saveProgress(prog);
  renderMissions();
  refreshHeroStats();
  if (window.showToast) {
    const allDone = currentMission?.id === missionId && currentMission.steps.every((_, i) => prog[missionId]["step" + i]);
    const message = allDone ? `任务完成：${currentMission.title}` : `步骤 ${Number(stepIdx) + 1} 已标记完成`;
    window.showToast(message, "success");
  }
}

modalCloseBtn.addEventListener("click", () => closeMissionModal());
modal.addEventListener("click", e => { if (e.target === modal) closeMissionModal(); });
document.addEventListener("keydown", e => {
  if (!modal.classList.contains("open")) return;
  if (e.key === "Escape") {
    closeMissionModal();
    return;
  }
  if (e.key !== "Tab") return;
  const focusable = Array.from(modalDialog.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.getElementById("modalStartBtn").addEventListener("click", () => {
  if (!currentMission) return;
  const firstStep = currentMission.steps[0];
  const slug = getToolSlug(firstStep.tool);
  window.open(`${SITE_BASE}/${firstStep.tool}-${slug}/`, "_blank");
  markStepDone(currentMission.id, 0);
  setTimeout(() => openMissionModal(currentMission.id), 300);
});

document.getElementById("modalResetBtn").addEventListener("click", () => {
  if (!currentMission) return;
  const prog = loadProgress();
  delete prog[currentMission.id];
  saveProgress(prog);
  renderMissions();
  refreshHeroStats();
  openMissionModal(currentMission.id);
  if (window.showToast) window.showToast("任务进度已重置", "warn");
});

// ===== Tool slug mapping =====
const TOOL_SLUGS = {
  P01:"model-compare",P02:"offline-sentiment",P03:"webspeech-transcriber",P04:"jargon-crusher",
  P05:"flesch-meter",P06:"prompt-builder",P07:"md-wechat-layout",P08:"hallucination-quiz",
  P09:"ssml-editor",P10:"aigc-detector",P11:"csv-cleaner",P12:"benford-checker",
  P13:"sankey-board",P14:"news-timeline",P15:"story-map",P16:"budget-treemap",
  P17:"before-after-slider",P18:"bar-race",P19:"a11y-palette-tester",P20:"wordcloud-sentiment",
  P21:"exif-inspector",P22:"shadow-geo-validator",P23:"dork-builder",P24:"reverse-search-hub",
  P25:"wayback-launcher",P26:"bot-radar",P27:"privacy-clause-highlighter",P28:"deepfake-magnifier",
  P29:"fallacy-match",P30:"source-cross-check-launcher",P31:"ethics-avg",P32:"scroll-story-kit",
  P33:"editor-swipe",P34:"chat-ui-report",P35:"echo-chamber-maze",P36:"a11y-blind-mode",
  P37:"spiral-silence-bbs",P38:"vr-news-viewer",P39:"typing-defense",P40:"s-curve-simulator",
  P41:"agent-portal",P42:"portfolio",P43:"podcast-page",P44:"zine-flipbook",
  P45:"newsletter-engine",P46:"foia-generator",P47:"funnel-calculator",P48:"flashcard-trainer",
  P49:"rss-paper",P50:"osint-bookmarks"
};
function getToolSlug(pid) { return TOOL_SLUGS[pid] || pid.toLowerCase(); }

// ===== 渲染模块 =====
function renderModules() {
  const grid = document.getElementById("moduleGrid");
  const used = getToolsUsed();
  grid.innerHTML = MODULES.map(mod => {
    const usedCount = mod.tools.filter(t => used.has(t.id)).length;
    const pct = Math.round((usedCount / mod.tools.length) * 100);
    return `<div class="module-card">
      <h3>${mod.emoji} ${mod.name}</h3>
      <p class="mod-desc">${mod.desc} <small>(${usedCount}/${mod.tools.length} 已用)</small></p>
      <div class="mod-progress"><div class="mod-progress-fill" style="width:${pct}%"></div></div>
      <ul class="tool-list">${mod.tools.map(t => {
        const slug = getToolSlug(t.id);
        const isUsed = used.has(t.id);
        return `<li>
          <a href="${SITE_BASE}/${t.id}-${slug}/" target="_blank" class="tool-link">${t.id} ${t.name}</a>
          ${isUsed ? '<span class="tool-used">✓ 已用</span>' : ''}
        </li>`;
      }).join("")}</ul>
    </div>`;
  }).join("");
}

// ===== 统计面板 =====
function renderStats() {
  const used = getToolsUsed();
  let totalEvents = 0;
  let totalDwell = 0;
  const toolStats = {};
  const dailyCounts = {};

  getTrackedMetricsEntries().forEach(({ pid, events }) => {
    if (!toolStats[pid]) toolStats[pid] = { events: 0 };
    events.forEach(e => {
      totalEvents++;
      toolStats[pid].events++;
      if ((e.event_name === "page_unload" || e.event_name === "page_hidden") && e.dwell_ms) {
        // Cap at 2 hours per session to avoid absurd accumulation from idle tabs
        totalDwell += Math.min(e.dwell_ms, 7200000);
      }
      const day = (e.event_time || "").slice(0, 10);
      if (day.length === 10) dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });
  });

  const prog = loadProgress();
  const tasksDone = MISSIONS.filter(m => {
    const p = prog[m.id] || {};
    return m.steps.every((_, i) => p["step" + i]);
  }).length;

  document.getElementById("sTotalEvents").textContent = totalEvents.toLocaleString();
  document.getElementById("sToolsUsed").textContent = Math.min(used.size, 50) + "/50";
  document.getElementById("sTasksDone").textContent = tasksDone;
  document.getElementById("sDwell").textContent = formatDuration(totalDwell);

  // Bar chart
  const entries = Object.entries(toolStats).sort((a, b) => b[1].events - a[1].events).slice(0, 15);
  const barEl = document.getElementById("barChart");
  if (entries.length === 0) {
    barEl.innerHTML = '<p class="empty-state">暂无数据，请先使用工具！</p>';
  } else {
    const maxE = Math.max(...entries.map(e => e[1].events));
    barEl.innerHTML = entries.map(([pid, s]) => {
      const pct = maxE > 0 ? (s.events / maxE * 100) : 0;
      const toolName = TOOL_SLUGS[pid] ? MODULES.flatMap(m => m.tools).find(t => t.id === pid)?.name || pid : pid;
      return `<div class="bar-row"><span class="bar-label">${pid} ${toolName}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(pct,3)}%">${s.events}</div></div></div>`;
    }).join("");
  }

  // Calendar
  const calEl = document.getElementById("calChart");
  const today = new Date();
  const maxC = Math.max(1, ...Object.values(dailyCounts));
  const cells = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const c = dailyCounts[key] || 0;
    const lv = c === 0 ? "" : c <= maxC * 0.25 ? "l1" : c <= maxC * 0.5 ? "l2" : c <= maxC * 0.75 ? "l3" : "l4";
    cells.push(`<div class="cal-cell ${lv}" title="${key}: ${c}"></div>`);
  }
  calEl.innerHTML = cells.join("");
}

function formatDuration(ms) {
  if (ms < 1000) return "< 1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}

// ===== Hero Stats =====
function refreshHeroStats() {
  const used = getToolsUsed();
  const prog = loadProgress();
  const tasksDone = MISSIONS.filter(m => {
    const p = prog[m.id] || {};
    return m.steps.every((_, i) => p["step" + i]);
  }).length;
  const modulesStarted = MODULES.filter(mod => mod.tools.some(t => used.has(t.id))).length;

  document.getElementById("statModules").textContent = modulesStarted;
  document.getElementById("statTasks").textContent = tasksDone;
  document.getElementById("statTools").textContent = Math.min(used.size, 50);

  // Dwell time for hero
  let totalDwell = 0;
  getTrackedMetricsEntries().forEach(({ events }) => {
    events.forEach(e => {
      if ((e.event_name === "page_unload" || e.event_name === "page_hidden") && e.dwell_ms) {
        totalDwell += Math.min(e.dwell_ms, 7200000);
      }
    });
  });
  document.getElementById("statDwell").textContent = formatDuration(totalDwell);
}

// ===== Export / Clear =====
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    const data = getManagedStorageSnapshot();
    if (!Object.keys(data).length) {
      window.showToast?.("暂无可导出的学习数据", "info");
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `journalism-tools-data-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    window.showToast?.("学习数据已导出", "success");
  });
}
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (confirm("确定清除全部学习数据？此操作不可撤销。")) {
      const removed = clearManagedStorage();
      renderMissions(); renderModules(); renderStats(); refreshHeroStats();
      if (removed > 0) {
        window.showToast?.("学习数据已清除", "warn");
      } else {
        window.showToast?.("当前没有可清除的学习数据", "info");
      }
    }
  });
}

// ===== Init =====
renderMissions();
renderModules();
renderStats();
refreshHeroStats();
