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
const VALID_TOOL_IDS = new Set(MODULES.flatMap(module => module.tools.map(tool => tool.id)));

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
const MISSION_STEP_COUNTS = new Map(MISSIONS.map(mission => [mission.id, mission.steps.length]));

// ===== 进度持久化 =====
const DASHBOARD_PROJECT_ID = "P00";
const DASHBOARD_METRICS_PROJECT_ID = "P00-dashboard";
const PROGRESS_KEY = "p00_mission_progress";
const TOOLS_KEY_PREFIX = "pm_metrics_events_";
const TASK_START_KEY_PREFIX = "pm_metrics_task_start_";
const DASHBOARD_SELF_METRICS_KEY = `${TOOLS_KEY_PREFIX}${DASHBOARD_PROJECT_ID}-dashboard`;
const TASK_START_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const TASK_START_MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_STORED_METRIC_EVENTS = 500;
const EXPORT_FORMAT_VERSION = 2;
const VALID_METRIC_EVENT_NAMES = new Set([
  "page_view",
  "first_interaction",
  "task_start",
  "task_complete",
  "task_error",
  "cta_click",
  "status_success_signal",
  "status_error_signal",
  "page_hidden",
  "page_unload"
]);

function extractTrackedProjectId(storageKey) {
  if (!storageKey || !storageKey.startsWith(TOOLS_KEY_PREFIX)) return null;
  const projectId = storageKey.replace(TOOLS_KEY_PREFIX, "");
  if (!isKnownToolProjectId(projectId)) return null;
  const pid = extractToolIdFromProjectId(projectId);
  return pid && VALID_TOOL_IDS.has(pid) && pid !== DASHBOARD_PROJECT_ID ? pid : null;
}

function extractToolIdFromProjectId(projectId) {
  if (typeof projectId !== "string") return null;
  const match = /^(P\d+)(?:$|[-_].+)/.exec(projectId);
  return match ? match[1] : null;
}

function isKnownToolProjectId(projectId) {
  const toolId = extractToolIdFromProjectId(projectId);
  if (!toolId || !VALID_TOOL_IDS.has(toolId) || toolId === DASHBOARD_PROJECT_ID) return false;
  const expectedSlug = TOOL_SLUGS[toolId];
  return projectId === toolId || projectId === `${toolId}-${expectedSlug}`;
}

function getCanonicalToolProjectId(projectId) {
  const toolId = extractToolIdFromProjectId(projectId);
  if (!toolId || !VALID_TOOL_IDS.has(toolId) || toolId === DASHBOARD_PROJECT_ID) return "";
  const expectedSlug = TOOL_SLUGS[toolId];
  const canonicalId = expectedSlug ? `${toolId}-${expectedSlug}` : toolId;
  return projectId === toolId || projectId === canonicalId ? canonicalId : "";
}

function getCanonicalMetricProjectId(projectId) {
  if (projectId === DASHBOARD_METRICS_PROJECT_ID || projectId === DASHBOARD_PROJECT_ID) {
    return DASHBOARD_METRICS_PROJECT_ID;
  }
  return getCanonicalToolProjectId(projectId) || projectId;
}

function getKnownToolProjectIds(projectId) {
  const toolId = extractToolIdFromProjectId(projectId);
  if (!toolId || !VALID_TOOL_IDS.has(toolId) || toolId === DASHBOARD_PROJECT_ID) return [];
  const ids = new Set([toolId]);
  const canonicalId = getCanonicalToolProjectId(projectId);
  if (canonicalId) ids.add(canonicalId);
  if (isKnownToolProjectId(projectId)) ids.add(projectId);
  return [...ids];
}

function isValidEventTime(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time <= (Date.now() + TASK_START_MAX_FUTURE_MS);
}

function getEventTimeMs(value) {
  return isValidEventTime(value) ? new Date(value).getTime() : Number.NaN;
}

function sortMetricEventsChronologically(events) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const aTime = getEventTimeMs(a.event?.event_time);
      const bTime = getEventTimeMs(b.event?.event_time);
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return a.index - b.index;
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;
      return (aTime - bTime) || (a.index - b.index);
    })
    .map(item => item.event);
}

function getMetricEventSignature(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return "";
  return Object.keys(event)
    .sort()
    .map(key => `${key}:${JSON.stringify(event[key])}`)
    .join("|");
}

function mergeMetricEventCollections(...collections) {
  const seen = new Set();
  const merged = [];
  sortMetricEventsChronologically(collections.flat()).forEach(event => {
    const signature = getMetricEventSignature(event);
    if (!signature || seen.has(signature)) return;
    seen.add(signature);
    merged.push(event);
  });
  return merged.slice(-MAX_STORED_METRIC_EVENTS);
}

function mergeMetricEventCollectionsPreservingAppended(existingEvents, appendedEvents) {
  const protectedSignatures = new Set(appendedEvents.map(getMetricEventSignature).filter(Boolean));
  const unprotectedExisting = sortMetricEventsChronologically(existingEvents)
    .filter(event => !protectedSignatures.has(getMetricEventSignature(event)));
  return sortMetricEventsChronologically(
    unprotectedExisting.slice(-Math.max(0, MAX_STORED_METRIC_EVENTS - appendedEvents.length)).concat(appendedEvents)
  );
}

function normalizeMetricEventsForProject(projectId, events) {
  const canonicalProjectId = getCanonicalMetricProjectId(projectId);
  if (!canonicalProjectId) return events;
  return events.map(event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return event;
    if (event.project_id === canonicalProjectId) return event;
    return Object.assign({}, event, { project_id: canonicalProjectId });
  });
}

function parseMetricEvents(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return sortMetricEventsChronologically(parsed.filter(event =>
      event &&
      typeof event === "object" &&
      !Array.isArray(event) &&
      typeof event.event_name === "string" &&
      event.event_name.length > 0 &&
      VALID_METRIC_EVENT_NAMES.has(event.event_name) &&
      isValidEventTime(event.event_time)
    )).slice(-MAX_STORED_METRIC_EVENTS);
  } catch {
    return [];
  }
}

function getTrackedMetricsEntries() {
  const grouped = new Map();
  for (const key of getStorageKeys()) {
    const pid = extractTrackedProjectId(key);
    if (!pid || !key) continue;
    const projectId = key.replace(TOOLS_KEY_PREFIX, "");
    const events = normalizeMetricEventsForProject(projectId, parseMetricEvents(safeStorageGet(key)));
    if (!events.length) continue;
    grouped.set(pid, mergeMetricEventCollections(grouped.get(pid) || [], events));
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pid, events]) => ({ pid, events }));
}

function getDashboardSelfMetricEvents() {
  return normalizeMetricEventsForProject(DASHBOARD_METRICS_PROJECT_ID, parseMetricEvents(safeStorageGet(DASHBOARD_SELF_METRICS_KEY)));
}

function getMetricEventsForProject(projectId) {
  if (projectId === DASHBOARD_METRICS_PROJECT_ID) {
    return getDashboardSelfMetricEvents();
  }
  if (isKnownToolProjectId(projectId)) {
    return sortMetricEventsChronologically(
      getKnownToolProjectIds(projectId).flatMap(id =>
        normalizeMetricEventsForProject(id, parseMetricEvents(safeStorageGet(`${TOOLS_KEY_PREFIX}${id}`)))
      )
    );
  }
  return [];
}

function isKnownTaskStartProject(projectId) {
  return projectId === DASHBOARD_METRICS_PROJECT_ID || isKnownToolProjectId(projectId);
}

function sanitizeMissionProgressRecord(value, missionId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const maxSteps = MISSION_STEP_COUNTS.get(missionId) || 0;
  const sanitized = {};
  let hasStepProgress = false;
  Object.entries(value).forEach(([key, entryValue]) => {
    const match = /^step(\d+)$/.exec(key);
    if (match && typeof entryValue === "boolean") {
      const stepIndex = Number(match[1]);
      if (stepIndex >= 0 && stepIndex < maxSteps) {
        sanitized[key] = entryValue;
        hasStepProgress = hasStepProgress || entryValue;
      }
    }
  });
  const allDone = maxSteps > 0 && Array.from({ length: maxSteps }, (_, index) => sanitized["step" + index] === true).every(Boolean);
  if (value._started === true || hasStepProgress) {
    sanitized._started = true;
  }
  if (allDone) {
    sanitized._completed = true;
  }
  return sanitized;
}

function sanitizeProgressPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const validMissionIds = new Set(MISSIONS.map(mission => mission.id));
  const sanitized = {};
  Object.entries(value).forEach(([missionId, missionValue]) => {
    if (!validMissionIds.has(missionId)) return;
    const record = sanitizeMissionProgressRecord(missionValue, missionId);
    if (Object.keys(record).length > 0) sanitized[missionId] = record;
  });
  return sanitized;
}

function hasDashboardSelfMetrics() {
  return getDashboardSelfMetricEvents().length > 0;
}

function isDashboardSelfMetricsKey(key) {
  return key === DASHBOARD_SELF_METRICS_KEY;
}

function getStorageKeysStatus() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }
    return { keys, readable: true };
  } catch {
    return { keys: [], readable: false };
  }
}

function getStorageKeys() {
  return getStorageKeysStatus().keys;
}

function hasStorageKey(key) {
  return getStorageKeys().includes(key);
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isStructurallyReadableStorageValue(key, value) {
  if (typeof value !== "string") return false;
  if (key === PROGRESS_KEY) {
    try {
      const parsed = JSON.parse(value || "{}");
      return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }
  if (key?.startsWith(TOOLS_KEY_PREFIX)) {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) && parsed.every(event =>
        event &&
        typeof event === "object" &&
        !Array.isArray(event) &&
        typeof event.event_name === "string" &&
        event.event_name.length > 0 &&
        VALID_METRIC_EVENT_NAMES.has(event.event_name) &&
        isValidEventTime(event.event_time)
      );
    } catch {
      return false;
    }
  }
  return true;
}

function isManagedStorageKey(key) {
  return key === PROGRESS_KEY
    || !!extractTrackedProjectId(key)
    || isDashboardSelfMetricsKey(key)
    || key?.startsWith(TASK_START_KEY_PREFIX);
}

function isBackupStorageKey(key) {
  return isManagedStorageKey(key) && !key?.startsWith(TASK_START_KEY_PREFIX);
}

function isClearableStorageKey(key) {
  return key === PROGRESS_KEY
    || key?.startsWith(TOOLS_KEY_PREFIX)
    || key?.startsWith(TASK_START_KEY_PREFIX);
}

function getManagedStorageSnapshot() {
  const snapshotStatus = getManagedStorageSnapshotStatus();
  if (!snapshotStatus.readable || snapshotStatus.unreadable > 0) {
    throw new Error("snapshot_failed");
  }
  return snapshotStatus.snapshot;
}

function getRestorableManagedStorageSnapshotStatus() {
  const snapshot = {};
  let unreadable = 0;
  const keysStatus = getStorageKeysStatus();
  for (const key of keysStatus.keys) {
    if (!key || !isManagedStorageKey(key)) continue;
    const value = safeStorageGet(key);
    if (key.startsWith(TASK_START_KEY_PREFIX)) {
      if (value !== null) snapshot[key] = value;
      continue;
    }
    if (value === null || !isStructurallyReadableStorageValue(key, value)) {
      unreadable += 1;
      continue;
    }
    snapshot[key] = value;
  }
  return { snapshot, unreadable, readable: keysStatus.readable };
}

function getStorageSnapshotStatus(filterKey) {
  const snapshot = {};
  let unreadable = 0;
  const keysStatus = getStorageKeysStatus();
  for (const key of keysStatus.keys) {
    if (!key || !filterKey(key)) continue;
    const value = safeStorageGet(key);
    if (value === null) {
      unreadable += 1;
      continue;
    }
    if (!isStructurallyReadableStorageValue(key, value)) {
      unreadable += 1;
      continue;
    }
    snapshot[key] = value;
  }
  return { snapshot, unreadable, readable: keysStatus.readable };
}

function getManagedStorageSnapshotStatus() {
  return getStorageSnapshotStatus(isManagedStorageKey);
}

function getBackupStorageGroupKey(key) {
  if (key === PROGRESS_KEY) return PROGRESS_KEY;
  if (!key?.startsWith(TOOLS_KEY_PREFIX)) return key;
  const projectId = key.replace(TOOLS_KEY_PREFIX, "");
  const canonicalProjectId = projectId === DASHBOARD_METRICS_PROJECT_ID
    ? DASHBOARD_METRICS_PROJECT_ID
    : getCanonicalToolProjectId(projectId) || projectId;
  return `${TOOLS_KEY_PREFIX}${canonicalProjectId}`;
}

function getBackupStorageSnapshotStatus() {
  const snapshot = {};
  const keysStatus = getStorageKeysStatus();
  const groupStatus = new Map();

  for (const key of keysStatus.keys) {
    if (!key || !isBackupStorageKey(key)) continue;
    const groupKey = getBackupStorageGroupKey(key);
    const group = groupStatus.get(groupKey) || {
      canonicalReadable: false,
      canonicalUnreadable: false,
      readable: 0,
      unreadable: 0
    };
    const value = safeStorageGet(key);
    if (value === null) {
      if (key === groupKey) group.canonicalUnreadable = true;
      group.unreadable += 1;
      groupStatus.set(groupKey, group);
      continue;
    }
    if (!isStructurallyReadableStorageValue(key, value)) {
      if (key === groupKey) group.canonicalUnreadable = true;
      group.unreadable += 1;
      groupStatus.set(groupKey, group);
      continue;
    }
    snapshot[key] = value;
    if (key === groupKey) group.canonicalReadable = true;
    group.readable += 1;
    groupStatus.set(groupKey, group);
  }

  const unreadable = [...groupStatus.values()].filter(group =>
    group.canonicalUnreadable
    || (!group.canonicalReadable && group.readable === 0 && group.unreadable > 0)
  ).length;
  return { snapshot, unreadable, readable: keysStatus.readable };
}

function getClearableStorageKeys() {
  return getStorageKeys().filter(key => key && isClearableStorageKey(key));
}

function getClearableStorageKeysStatus() {
  const keysStatus = getStorageKeysStatus();
  return {
    keys: keysStatus.keys.filter(key => key && isClearableStorageKey(key)),
    readable: keysStatus.readable
  };
}

function repairManagedStorageInPlace() {
  function safeRemove(key, fallbackValue) {
    try {
      localStorage.removeItem(key);
      if (!hasStorageKey(key)) return true;
    } catch {}
    if (fallbackValue !== undefined) {
      return safeSet(key, fallbackValue);
    }
    return !hasStorageKey(key);
  }

  function safeSet(key, value) {
    try {
      if (safeStorageGet(key) === value) return true;
      localStorage.setItem(key, value);
      return safeStorageGet(key) === value;
    } catch {}
    return false;
  }

  const keys = getStorageKeys();
  const keySet = new Set(keys);

  keys.forEach(key => {
    if (key === PROGRESS_KEY) {
      const raw = safeStorageGet(key);
      if (raw === null) return;
      const sanitized = sanitizeProgressPayload((() => {
        try { return JSON.parse(raw || "{}"); } catch { return {}; }
      })());
      if (Object.keys(sanitized).length === 0) {
        safeRemove(key, "{}");
      } else {
        safeSet(key, JSON.stringify(sanitized));
      }
      return;
    }

    if (key.startsWith(TOOLS_KEY_PREFIX)) {
      if (!extractTrackedProjectId(key) && !isDashboardSelfMetricsKey(key)) {
        safeRemove(key, "[]");
        return;
      }
      const projectId = key.replace(TOOLS_KEY_PREFIX, "");
      const canonicalProjectId = getCanonicalToolProjectId(projectId);
      if (canonicalProjectId && canonicalProjectId !== projectId) {
        const canonicalKey = `${TOOLS_KEY_PREFIX}${canonicalProjectId}`;
        const sourceRaw = safeStorageGet(key);
        if (keySet.has(key) && sourceRaw === null) {
          return;
        }
        const canonicalRaw = safeStorageGet(canonicalKey);
        if (keySet.has(canonicalKey) && canonicalRaw === null) {
          return;
        }
        const merged = mergeMetricEventCollections(
          normalizeMetricEventsForProject(projectId, parseMetricEvents(sourceRaw)),
          normalizeMetricEventsForProject(canonicalProjectId, parseMetricEvents(canonicalRaw))
        );
        if (merged.length === 0) {
          safeRemove(key, "[]");
        } else {
          if (safeSet(canonicalKey, JSON.stringify(merged))) {
            safeRemove(key, "[]");
          }
        }
        return;
      }
      const raw = safeStorageGet(key);
      if (raw === null) return;
      const events = normalizeMetricEventsForProject(projectId, parseMetricEvents(raw));
      if (events.length === 0) {
        safeRemove(key, "[]");
      } else {
        safeSet(key, JSON.stringify(events));
      }
      return;
    }

    if (key.startsWith(TASK_START_KEY_PREFIX)) {
      const raw = safeStorageGet(key);
      if (raw === null) return;
      const timestamp = Number(raw);
      const { projectId, taskName } = parseTaskStartStorageKey(key);
      const canonicalProjectId = getCanonicalToolProjectId(projectId);
      if (canonicalProjectId && canonicalProjectId !== projectId) {
        const canonicalKey = getTaskStartStorageKey(canonicalProjectId, taskName);
        const canonicalRaw = safeStorageGet(canonicalKey);
        if (keySet.has(canonicalKey) && canonicalRaw === null) {
          return;
        }
        const canonicalTimestamp = Number(canonicalRaw);
        const candidates = [timestamp, canonicalTimestamp]
          .filter(candidate => hasUsableTaskStartTimestamp(canonicalProjectId, taskName, candidate));
        if (candidates.length > 0) {
          const nextTimestamp = Math.max(...candidates);
          if (safeSet(canonicalKey, String(nextTimestamp))) {
            safeRemove(key, "NaN");
          }
        } else {
          safeRemove(key, "NaN");
        }
        return;
      }
      if (!Number.isFinite(timestamp)
        || (Date.now() - timestamp) > TASK_START_MAX_AGE_MS
        || !hasUsableTaskStartTimestamp(projectId, taskName, timestamp)) {
        safeRemove(key, "NaN");
      }
    }
  });
}

function getBackupStorageSnapshot() {
  const backupStatus = getBackupStorageSnapshotStatus();
  if (!backupStatus.readable || backupStatus.unreadable > 0) {
    throw new Error("snapshot_failed");
  }
  const snapshot = {};
  const metricSnapshots = new Map();
  const markerSnapshots = new Map();
  for (const key of getStorageKeys()) {
    if (!key || !isBackupStorageKey(key)) continue;
    if (key === PROGRESS_KEY) {
      const progress = loadProgress();
      if (Object.keys(progress).length > 0) {
        snapshot[key] = JSON.stringify(progress);
      }
      continue;
    }
    if (key.startsWith(TOOLS_KEY_PREFIX)) {
      const projectId = key.replace(TOOLS_KEY_PREFIX, "");
      const events = normalizeMetricEventsForProject(projectId, parseMetricEvents(safeStorageGet(key)));
      if (!events.length) continue;
      const canonicalProjectId = projectId === DASHBOARD_METRICS_PROJECT_ID
        ? DASHBOARD_METRICS_PROJECT_ID
        : getCanonicalToolProjectId(projectId) || projectId;
      const targetKey = `${TOOLS_KEY_PREFIX}${canonicalProjectId}`;
      metricSnapshots.set(targetKey, mergeMetricEventCollections(metricSnapshots.get(targetKey) || [], events));
      continue;
    }
    const value = safeStorageGet(key);
    if (value !== null) snapshot[key] = value;
  }
  getStorageKeys().forEach(key => {
    if (!key?.startsWith(TASK_START_KEY_PREFIX)) return;
    const raw = safeStorageGet(key);
    if (raw === null) return;
    const timestamp = Number(raw);
    const { projectId, taskName } = parseTaskStartStorageKey(key);
    const canonicalProjectId = projectId === DASHBOARD_METRICS_PROJECT_ID
      ? DASHBOARD_METRICS_PROJECT_ID
      : getCanonicalToolProjectId(projectId) || projectId;
    if (!hasUsableTaskStartTimestamp(canonicalProjectId, taskName, timestamp)) return;
    const targetKey = `${TOOLS_KEY_PREFIX}${canonicalProjectId}`;
    const markerGroupKey = `${targetKey}::${taskName}`;
    const previous = markerSnapshots.get(markerGroupKey);
    if (!previous || timestamp > previous.timestamp) {
      markerSnapshots.set(markerGroupKey, { targetKey, taskName, timestamp, projectId: canonicalProjectId });
    }
  });
  markerSnapshots.forEach(({ targetKey, taskName, timestamp, projectId }) => {
    const existingEvents = metricSnapshots.get(targetKey) || [];
    const latestStartTime = existingEvents
      .filter(event => event?.event_name === "task_start" && event.task_name === taskName)
      .reduce((latest, event) => Math.max(latest, getEventTimeMs(event.event_time)), Number.NEGATIVE_INFINITY);
    const latestTerminalTime = existingEvents
      .filter(event => (event?.event_name === "task_complete" || event?.event_name === "task_error") && event.task_name === taskName)
      .reduce((latest, event) => Math.max(latest, getEventTimeMs(event.event_time)), Number.NEGATIVE_INFINITY);
    if (latestStartTime > latestTerminalTime && latestStartTime >= timestamp) return;
    if (Number.isFinite(latestTerminalTime) && timestamp <= latestTerminalTime) return;
    const syntheticStart = {
      event_name: "task_start",
      event_time: new Date(timestamp).toISOString(),
      task_name: taskName,
      project_id: projectId
    };
    metricSnapshots.set(targetKey, mergeMetricEventCollectionsPreservingAppended(existingEvents, [syntheticStart]));
  });
  metricSnapshots.forEach((events, key) => {
    if (events.length > 0) snapshot[key] = JSON.stringify(events);
  });
  return snapshot;
}

function clearManagedStorage() {
  const keysStatus = getClearableStorageKeysStatus();
  const keys = keysStatus.keys;
  let removed = 0;
  keys.forEach(key => {
    try {
      localStorage.removeItem(key);
      if (!hasStorageKey(key)) {
        removed += 1;
      }
    } catch {}
  });
  resetMissionStartSync();
  window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true });
  return { found: keys.length, removed, readable: keysStatus.readable };
}

function clearManagedStorageTransactional() {
  const previousState = getRestorableManagedStorageSnapshotStatus();
  if (!previousState.readable || previousState.unreadable > 0) {
    throw new Error("snapshot_failed");
  }
  const cleared = clearManagedStorage();
  if (!cleared.readable) {
    throw new Error("snapshot_failed");
  }
  if (cleared.removed === cleared.found) {
    return cleared;
  }
  const restored = writeStorageEntries(previousState.snapshot);
  const rollbackOk = restored === Object.keys(previousState.snapshot).length;
  resetMissionStartSync();
  window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true });
  throw new Error(rollbackOk ? "clear_failed" : "rollback_failed");
}

function writeStorageEntries(snapshot) {
  let written = 0;
  Object.entries(snapshot).forEach(([key, value]) => {
    try {
      if (safeStorageGet(key) === value) {
        written += 1;
        return;
      }
      localStorage.setItem(key, value);
      if (safeStorageGet(key) === value) {
        written += 1;
      }
    } catch {}
  });
  return written;
}

function buildExportPayload() {
  const snapshotStatus = getBackupStorageSnapshotStatus();
  if (!snapshotStatus.readable || snapshotStatus.unreadable > 0) {
    throw new Error("snapshot_failed");
  }
  const data = getBackupStorageSnapshot();
  return {
    format: "journalism-tools-export",
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    entry_count: Object.keys(data).length,
    source: {
      project_id: "P00-dashboard",
      name: "新闻素养学习中枢"
    },
    data
  };
}

function extractImportPayload(raw) {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return {};
  if (raw.format === "journalism-tools-export" && raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
    return raw.data;
  }
  return raw;
}

function normalizeImportedSnapshot(raw) {
  const source = extractImportPayload(raw);
  if (!source || Array.isArray(source) || typeof source !== "object") return {};
  const normalized = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!isManagedStorageKey(key) || key.startsWith(TASK_START_KEY_PREFIX)) return;
    if (key === PROGRESS_KEY) {
      const parsedProgress = typeof value === "string" ? (() => {
        try { return JSON.parse(value); } catch { return {}; }
      })() : value;
      const progress = sanitizeProgressPayload(parsedProgress);
      if (Object.keys(progress).length > 0) {
        normalized[key] = JSON.stringify(progress);
      }
      return;
    }
    if (key.startsWith(TOOLS_KEY_PREFIX)) {
      const metricSource = typeof value === "string" ? value : JSON.stringify(value);
      const projectId = key.replace(TOOLS_KEY_PREFIX, "");
      const events = normalizeMetricEventsForProject(projectId, parseMetricEvents(metricSource));
      if (!events.length) return;
      const canonicalProjectId = projectId === DASHBOARD_METRICS_PROJECT_ID
        ? DASHBOARD_METRICS_PROJECT_ID
        : getCanonicalToolProjectId(projectId) || projectId;
      const targetKey = `${TOOLS_KEY_PREFIX}${canonicalProjectId}`;
      const existing = parseMetricEvents(normalized[targetKey]);
      normalized[targetKey] = JSON.stringify(mergeMetricEventCollections(existing, events));
      return;
    }
    normalized[key] = typeof value === "string" ? value : JSON.stringify(value);
  });
  return normalized;
}

function restoreManagedStorage(snapshot) {
  const normalized = normalizeImportedSnapshot(snapshot);
  const keys = Object.keys(normalized);
  if (!keys.length) return 0;
  const previousBackupState = getBackupStorageSnapshotStatus();
  if (!previousBackupState.readable || previousBackupState.unreadable > 0) {
    throw new Error("snapshot_failed");
  }
  const previousState = getRestorableManagedStorageSnapshotStatus();
  if (!previousState.readable || previousState.unreadable > 0) {
    throw new Error("snapshot_failed");
  }
  const previous = previousState.snapshot;
  const cleared = clearManagedStorage();
  if (!cleared.readable || cleared.removed !== cleared.found) {
    const restored = writeStorageEntries(previous);
    window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true });
    const error = new Error(restored === Object.keys(previous).length ? "clear_failed" : "rollback_failed");
    throw error;
  }
  const written = writeStorageEntries(normalized);
  if (written === keys.length) {
    window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true });
    return keys.length;
  }

  const rollbackCleared = clearManagedStorage();
  const restored = writeStorageEntries(previous);
  const rollbackOk = rollbackCleared.removed === rollbackCleared.found && restored === Object.keys(previous).length;
  window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true });
  throw new Error(rollbackOk ? "write_failed" : "rollback_failed");
}

function getMissionTaskName(missionId) {
  return `dashboard_mission_${String(missionId || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
}

function getMissionTaskStartStorageKey(missionId) {
  return `${TASK_START_KEY_PREFIX}${DASHBOARD_METRICS_PROJECT_ID}::${getMissionTaskName(missionId)}`;
}

function clearMissionTaskStartMarker(missionId) {
  try {
    const key = getMissionTaskStartStorageKey(missionId);
    localStorage.removeItem(key);
    return !hasStorageKey(key);
  } catch {
    return false;
  }
}

function getTaskStartStorageKey(projectId, taskName) {
  return `${TASK_START_KEY_PREFIX}${projectId}::${taskName}`;
}

function getMissionTaskStartTimestamp(missionId) {
  const raw = safeStorageGet(getMissionTaskStartStorageKey(missionId));
  if (raw === null) return null;
  const timestamp = Number(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseTaskStartStorageKey(key) {
  if (typeof key !== "string" || !key.startsWith(TASK_START_KEY_PREFIX)) {
    return { projectId: "", taskName: "" };
  }
  const body = key.slice(TASK_START_KEY_PREFIX.length);
  const separatorIndex = body.indexOf("::");
  if (separatorIndex === -1) {
    return { projectId: body, taskName: "" };
  }
  return {
    projectId: body.slice(0, separatorIndex),
    taskName: body.slice(separatorIndex + 2)
  };
}

function getLatestProjectTaskTerminalTime(projectId, taskName) {
  let latest = Number.NEGATIVE_INFINITY;
  getMetricEventsForProject(projectId).forEach(event => {
    if (!event || event.task_name !== taskName) return;
    if (event.event_name !== "task_complete" && event.event_name !== "task_error") return;
    latest = Math.max(latest, getEventTimeMs(event.event_time));
  });
  return Number.isFinite(latest) ? latest : null;
}

function getLatestProjectTaskStartTime(projectId, taskName) {
  let latest = Number.NEGATIVE_INFINITY;
  getMetricEventsForProject(projectId).forEach(event => {
    if (!event || event.task_name !== taskName) return;
    if (event.event_name !== "task_start") return;
    latest = Math.max(latest, getEventTimeMs(event.event_time));
  });
  return Number.isFinite(latest) ? latest : null;
}

function getLatestOpenProjectTaskStartTime(projectId, taskName) {
  const latestStartTime = getLatestProjectTaskStartTime(projectId, taskName);
  if (!isFreshTaskStartTimestamp(latestStartTime)) return null;
  const latestTerminalTime = getLatestProjectTaskTerminalTime(projectId, taskName);
  return !Number.isFinite(latestTerminalTime) || latestStartTime > latestTerminalTime
    ? latestStartTime
    : null;
}

function isFreshTaskStartTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) return false;
  if (timestamp > (Date.now() + TASK_START_MAX_FUTURE_MS)) return false;
  return (Date.now() - timestamp) <= TASK_START_MAX_AGE_MS;
}

function hasUsableTaskStartTimestamp(projectId, taskName, timestamp) {
  if (!isFreshTaskStartTimestamp(timestamp)) return false;
  if (!isKnownTaskStartProject(projectId) || typeof taskName !== "string" || taskName.length === 0) {
    return false;
  }
  const latestTerminalTime = getLatestProjectTaskTerminalTime(projectId, taskName);
  return !Number.isFinite(latestTerminalTime) || timestamp > latestTerminalTime;
}

function hasMissionTaskStartMarker(missionId) {
  const taskName = getMissionTaskName(missionId);
  const raw = safeStorageGet(getMissionTaskStartStorageKey(missionId));
  const timestamp = Number(raw);
  return raw !== null && hasUsableTaskStartTimestamp(DASHBOARD_METRICS_PROJECT_ID, taskName, timestamp);
}

function hasUnreadableMissionTaskStartMarker(missionId) {
  const key = getMissionTaskStartStorageKey(missionId);
  return hasStorageKey(key) && safeStorageGet(key) === null;
}

function didPersistMissionStart(result) {
  if (result === true) return true;
  if (!result || typeof result !== "object") return false;
  return result.markerSet === true || result.eventPersisted === true;
}

function getLatestMissionStartEventTime(missionId) {
  const taskName = getMissionTaskName(missionId);
  const latestTime = getLatestProjectTaskStartTime(DASHBOARD_METRICS_PROJECT_ID, taskName);
  return Number.isFinite(latestTime) ? new Date(latestTime).toISOString() : "";
}

function hasOpenMissionStartEvent(missionId) {
  const taskName = getMissionTaskName(missionId);
  return Number.isFinite(getLatestOpenProjectTaskStartTime(DASHBOARD_METRICS_PROJECT_ID, taskName));
}

function needsMissionStartEventBackfill(missionId, markerTimestamp) {
  if (!isFreshTaskStartTimestamp(markerTimestamp)) return false;
  const taskName = getMissionTaskName(missionId);
  const latestOpenStartTime = getLatestOpenProjectTaskStartTime(DASHBOARD_METRICS_PROJECT_ID, taskName);
  return !Number.isFinite(latestOpenStartTime) || markerTimestamp > latestOpenStartTime;
}

function getMissionStartSyncToken(missionId) {
  const taskName = getMissionTaskName(missionId);
  return JSON.stringify({
    startEventTime: getLatestMissionStartEventTime(missionId),
    terminalEventTime: getLatestProjectTaskTerminalTime(DASHBOARD_METRICS_PROJECT_ID, taskName) || "",
    marker: safeStorageGet(getMissionTaskStartStorageKey(missionId)) || ""
  });
}

function backfillMissionStartEvent(missionId, timestamp) {
  if (!isFreshTaskStartTimestamp(timestamp)) return false;
  const result = window.pmMetrics?.track?.("task_start", {
    task_name: getMissionTaskName(missionId),
    event_time: new Date(timestamp).toISOString()
  });
  return result?.persisted === true;
}

function resetMissionStartSync() {
  resumedMissionStartSync.clear();
}

function ensureMissionStarted(missionId) {
  const prog = loadProgress();
  const state = getMissionProgressState(prog, missionId, { create: true });
  if (state._started) {
    if (hasMissionTaskStartMarker(missionId)) {
      const markerTimestamp = getMissionTaskStartTimestamp(missionId);
      if (needsMissionStartEventBackfill(missionId, markerTimestamp)) {
        backfillMissionStartEvent(missionId, markerTimestamp);
      }
      resumedMissionStartSync.delete(missionId);
    } else if (hasUnreadableMissionTaskStartMarker(missionId)) {
      return prog;
    } else {
      if (hasOpenMissionStartEvent(missionId)) {
        resumedMissionStartSync.set(missionId, getMissionStartSyncToken(missionId));
        return prog;
      }
      const currentSyncToken = getMissionStartSyncToken(missionId);
      if (resumedMissionStartSync.get(missionId) === currentSyncToken) {
        return prog;
      }
      const startResult = window.pmMetrics?.markTaskStart?.(getMissionTaskName(missionId));
      if (didPersistMissionStart(startResult)) {
        resumedMissionStartSync.set(missionId, getMissionStartSyncToken(missionId));
      }
    }
    return prog;
  }
  state._started = true;
  if (!saveProgress(prog)) return null;
  const startResult = window.pmMetrics?.markTaskStart?.(getMissionTaskName(missionId));
  if (didPersistMissionStart(startResult)) {
    resumedMissionStartSync.set(missionId, getMissionStartSyncToken(missionId));
  }
  return prog;
}

function isMissionCompleteState(mission, state) {
  return !!mission && mission.steps.every((_, index) => state["step" + index]);
}

function syncCompletedMissionMetrics() {
  const progress = loadProgress();
  MISSIONS.forEach(mission => {
    const state = getMissionProgressState(progress, mission.id);
    if (!isMissionCompleteState(mission, state)) return;
    if (!hasMissionTaskStartMarker(mission.id) && !hasOpenMissionStartEvent(mission.id)) return;
    const result = window.pmMetrics?.markTaskComplete?.(getMissionTaskName(mission.id), {
      mission_id: mission.id,
      steps_total: mission.steps.length
    });
    if (result?.persisted) {
      resumedMissionStartSync.delete(mission.id);
    }
  });
}

let refreshQueued = false;
let managedStorageWarningToken = "";

function hasVisibleToastMessage(message) {
  return Array.from(document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']"))
    .some(toast => toast instanceof HTMLElement && toast.dataset.toastMessage === message);
}

function notifyManagedStorageWarning() {
  const managedStatus = getManagedStorageSnapshotStatus();
  const backupStatus = getBackupStorageSnapshotStatus();
  let token = "";
  let message = "";
  if (!backupStatus.readable || backupStatus.unreadable > 0) {
    token = `backup:${backupStatus.readable ? backupStatus.unreadable : "unreadable"}`;
    message = "当前浏览器存储存在异常学习数据，导出与覆盖恢复已停用。";
  } else if (!managedStatus.readable || managedStatus.unreadable > 0) {
    token = `managed:${managedStatus.readable ? managedStatus.unreadable : "unreadable"}`;
    message = "当前浏览器存储存在异常任务标记，任务恢复可能不完整。";
  }
  if (!token) {
    managedStorageWarningToken = "";
    return;
  }
  if (managedStorageWarningToken === token && hasVisibleToastMessage(message)) return;
  managedStorageWarningToken = token;
  showFreshToast(message, "error", 6000, { track: false });
}

function refreshDashboard() {
  repairManagedStorageInPlace();
  window.pmMetrics?.reconcileStorageState?.();
  syncCompletedMissionMetrics();
  const shouldPreservePageFocus = !modal.classList.contains("open");
  const pageFocusToken = shouldPreservePageFocus ? getPageFocusToken() : null;
  renderMissions();
  renderModules();
  renderStats();
  refreshHeroStats();
  if (modal.classList.contains("open") && currentMission) {
    openMissionModal(currentMission.id, { preserveFocus: true });
    return;
  }
  if (shouldPreservePageFocus && pageFocusToken) {
    lastFocusedToken = pageFocusToken;
    restorePageFocus();
  }
  notifyManagedStorageWarning();
}

function scheduleDashboardRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    refreshDashboard();
  });
}

function openExternalTool(url) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    try { opened.opener = null; } catch {}
    return true;
  }
  return false;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("[P00-dashboard] Service worker registration failed.", error);
    window.showToast?.("离线缓存初始化失败，页面仍可在线使用。", "warn", 4000);
  }
}

function loadProgress() {
  try {
    const parsed = JSON.parse(safeStorageGet(PROGRESS_KEY) || "{}");
    return sanitizeProgressPayload(parsed);
  } catch {
    return {};
  }
}
function saveProgress(p) {
  const sanitized = sanitizeProgressPayload(p);
  try {
    if (hasStorageKey(PROGRESS_KEY) && !isStructurallyReadableStorageValue(PROGRESS_KEY, safeStorageGet(PROGRESS_KEY))) {
      return false;
    }
    if (Object.keys(sanitized).length === 0) {
      localStorage.removeItem(PROGRESS_KEY);
      return !hasStorageKey(PROGRESS_KEY);
    }
    const next = JSON.stringify(sanitized);
    localStorage.setItem(PROGRESS_KEY, next);
    return safeStorageGet(PROGRESS_KEY) === next;
  } catch (error) {
    console.warn("[P00-dashboard] Progress persistence failed.", error);
    return false;
  }
}

function notifyProgressSaveFailure() {
  showFreshToast("保存学习进度失败，当前更改未写入浏览器存储。", "error", 4500);
}

function showFreshToast(message, type, duration, options) {
  if (typeof window.replaceToasts === "function") {
    window.replaceToasts(message, type, duration, options);
    return;
  }
  window.clearToasts?.();
  window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true, suppressActiveStatus: true });
  window.showToast?.(message, type, duration, options);
}

function getMissionProgressState(progress, missionId, options) {
  const create = options?.create === true;
  const value = progress[missionId];
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!create) return {};
  progress[missionId] = {};
  return progress[missionId];
}

function formatLocalDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDwellFromEvents(events) {
  if (!Array.isArray(events) || !events.length) return 0;
  const ordered = events.slice().sort((a, b) => {
    const aTime = getEventTimeMs(a?.event_time);
    const bTime = getEventTimeMs(b?.event_time);
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return aTime - bTime;
  });
  let total = 0;
  let visitMax = 0;

  ordered.forEach(event => {
    if (!event || typeof event !== "object") return;
    if (event.event_name === "page_view") {
      total += visitMax;
      visitMax = 0;
      return;
    }
    if ((event.event_name === "page_unload" || event.event_name === "page_hidden") && Number.isFinite(event.dwell_ms)) {
      visitMax = Math.max(visitMax, Math.min(event.dwell_ms, 7200000));
    }
  });

  return total + visitMax;
}

function getProgressDerivedToolIds() {
  const used = new Set();
  const progress = loadProgress();
  MISSIONS.forEach(mission => {
    const state = getMissionProgressState(progress, mission.id);
    mission.steps.forEach((step, index) => {
      if (state["step" + index]) used.add(step.tool);
    });
  });
  return used;
}

function getMetricDerivedToolIds() {
  const used = new Set();
  getTrackedMetricsEntries().forEach(({ pid }) => used.add(pid));
  return used;
}

function getToolsUsed() {
  const used = new Set();
  getMetricDerivedToolIds().forEach(pid => used.add(pid));
  getProgressDerivedToolIds().forEach(pid => used.add(pid));
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
let lastFocusedToken = null;
const resumedMissionStartSync = new Map();

function getPageFocusToken() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active.id) return `#${active.id}`;
  if (active.classList.contains("mission-card") && active.dataset.mission) {
    return `.mission-card[data-mission="${active.dataset.mission}"]`;
  }
  if (active.classList.contains("tool-link") && active.dataset.toolId) {
    return `.tool-link[data-tool-id="${active.dataset.toolId}"]`;
  }
  if (active.tagName === "A" && active.getAttribute("href")) {
    return `a[href="${active.getAttribute("href")}"]`;
  }
  if (active.classList.contains("tab") && active.dataset.tab) {
    return `.tab[data-tab="${active.dataset.tab}"]`;
  }
  return null;
}

function restorePageFocus() {
  if (lastFocusedToken) {
    const next = document.querySelector(lastFocusedToken);
    if (next instanceof HTMLElement) {
      next.focus();
      return true;
    }
  }
  if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
    lastFocusedElement.focus();
    return true;
  }
  return false;
}

function getModalFocusToken() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !modal.contains(active)) return null;
  if (active.id) return `#${active.id}`;
  if (active.classList.contains("tool-link") && active.dataset.step !== undefined) {
    return `.tool-link[data-step="${active.dataset.step}"]`;
  }
  return null;
}

function restoreModalFocus(token) {
  if (!token) return false;
  const next = modal.querySelector(token);
  if (!(next instanceof HTMLElement)) return false;
  next.focus();
  return true;
}

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
    const p = getMissionProgressState(progress, m.id);
    const done = m.steps.filter((_, i) => p["step" + i]).length;
    const total = m.steps.length;
    const pct = Math.round((done / total) * 100);
    const complete = done === total;
    return `<div class="mission-card${complete ? " mc-complete" : ""}" data-mission="${m.id}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="查看任务：${m.title}">
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
    card.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openMissionModal(card.dataset.mission);
    });
  });
}

// ===== 任务详情弹窗 =====
function closeMissionModal({ restoreFocus = true } = {}) {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  if (restoreFocus) {
    restorePageFocus();
  }
}

function openMissionModal(missionId, options = {}) {
  const preserveFocus = options.preserveFocus === true;
  currentMission = MISSIONS.find(m => m.id === missionId);
  if (!currentMission) return;
  const focusToken = preserveFocus ? getModalFocusToken() : null;
  if (!modal.classList.contains("open")) {
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lastFocusedToken = getPageFocusToken();
  }
  const progress = loadProgress();
  const p = getMissionProgressState(progress, missionId);
  const nextStepIdx = getNextMissionStepIndex(currentMission, p);
  const completedSteps = currentMission.steps.filter((_, index) => p["step" + index]).length;
  const modalStartBtn = document.getElementById("modalStartBtn");

  document.getElementById("modalTitle").textContent = `${currentMission.emoji} ${currentMission.title}`;
  document.getElementById("modalDesc").textContent = currentMission.desc;
  document.getElementById("modalBadge").textContent = `${currentMission.difficulty} · ${currentMission.time}`;
  if (modalStartBtn) {
    modalStartBtn.textContent = completedSteps === 0
      ? "🚀 开始任务"
      : completedSteps === currentMission.steps.length
      ? "↺ 重新打开第 1 步"
      : `▶ 继续任务（第 ${nextStepIdx + 1} 步）`;
  }

  const stepsEl = document.getElementById("modalSteps");
  stepsEl.innerHTML = currentMission.steps.map((step, i) => {
    const done = p["step" + i];
    return `<div class="step-item${done ? " step-done" : ""}">
      <span class="step-num">${done ? "✓" : i + 1}</span>
      <div class="step-info">
        <span class="step-tool">${step.tool} ${step.name}</span>
        <span class="step-action">${step.action}</span>
        <small style="color:var(--ink-secondary);display:block;margin-top:6px;padding:6px 10px;background:var(--accent-light);border-radius:6px;line-height:1.5;font-size:0.78rem">💡 ${step.hint}</small>
        ${done ? '<span style="color:var(--ok);font-size:0.75rem">✅ 已完成</span>' : `<a href="${SITE_BASE}/${step.tool}-${getToolSlug(step.tool)}/" target="_blank" rel="noopener noreferrer" aria-label="${step.tool} ${step.name}，在新标签页打开" 
          class="tool-link" data-step="${i}" style="display:inline-block;margin-top:8px">
          ▶ 打开工具</a>`}
      </div>
    </div>`;
  }).join("");

  // Click handler for tool links to mark step done
  stepsEl.querySelectorAll(".tool-link").forEach(link => {
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) return;
      const opened = openExternalTool(href);
      if (!opened) {
        showFreshToast("浏览器拦截了新标签页，请允许弹窗后重试", "warn");
        return;
      }
      const stepIdx = link.dataset.step;
      markStepDone(missionId, stepIdx);
    });
  });

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    if (preserveFocus && restoreModalFocus(focusToken)) return;
    modalCloseBtn.focus();
  });
}

function markStepDone(missionId, stepIdx) {
  const prog = ensureMissionStarted(missionId);
  if (!prog) {
    notifyProgressSaveFailure();
    return;
  }
  const state = getMissionProgressState(prog, missionId, { create: true });
  state["step" + stepIdx] = true;
  const mission = MISSIONS.find(item => item.id === missionId);
  const allDone = !!mission && mission.steps.every((_, i) => state["step" + i]);
  if (allDone && !state._completed) {
    state._completed = true;
  }
  if (!saveProgress(prog)) {
    notifyProgressSaveFailure();
    return;
  }
  if (allDone && mission) {
    const completionResult = window.pmMetrics?.markTaskComplete?.(getMissionTaskName(missionId), {
      mission_id: missionId,
      steps_total: mission.steps.length
    });
    if (completionResult?.persisted) {
      resumedMissionStartSync.delete(missionId);
    }
  }
  refreshDashboard();
  if (window.showToast) {
    const message = allDone && mission ? `任务完成：${mission.title}` : `步骤 ${Number(stepIdx) + 1} 已标记完成`;
    showFreshToast(message, "success");
  }
}

function getNextMissionStepIndex(mission, progressState) {
  const nextIdx = mission.steps.findIndex((_, index) => !progressState["step" + index]);
  return nextIdx === -1 ? 0 : nextIdx;
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
  const progress = loadProgress();
  const state = getMissionProgressState(progress, currentMission.id);
  const nextStepIdx = getNextMissionStepIndex(currentMission, state);
  const step = currentMission.steps[nextStepIdx];
  const slug = getToolSlug(step.tool);
  const opened = openExternalTool(`${SITE_BASE}/${step.tool}-${slug}/`);
  if (!opened) {
    showFreshToast("浏览器拦截了新标签页，请允许弹窗后重试", "warn");
    return;
  }
  if (!state["step" + nextStepIdx]) {
    markStepDone(currentMission.id, nextStepIdx);
  }
});

document.getElementById("modalResetBtn").addEventListener("click", () => {
  if (!currentMission) return;
  const prog = loadProgress();
  const previousProgress = JSON.parse(JSON.stringify(prog));
  delete prog[currentMission.id];
  if (!saveProgress(prog)) {
    notifyProgressSaveFailure();
    return;
  }
  const markerCleared = clearMissionTaskStartMarker(currentMission.id);
  if (!markerCleared) {
    const rollbackOk = saveProgress(previousProgress);
    refreshDashboard();
    showFreshToast(
      rollbackOk
        ? "任务进度未重置：未能清除该任务的进行中标记，已保留原进度。"
        : "任务进度重置失败：未能清除进行中标记，且无法恢复原进度。",
      "error",
      4500
    );
    return;
  }
  resumedMissionStartSync.delete(currentMission.id);
  refreshDashboard();
  showFreshToast("任务进度已重置", "warn");
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

function validateCatalogIntegrity() {
  const duplicateToolIds = MODULES
    .flatMap(module => module.tools.map(tool => tool.id))
    .filter((id, index, ids) => ids.indexOf(id) !== index)
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const missingSlugIds = [...VALID_TOOL_IDS].filter(id => !TOOL_SLUGS[id]);
  const unknownMissionToolIds = [...new Set(MISSIONS.flatMap(mission => mission.steps.map(step => step.tool)).filter(id => !VALID_TOOL_IDS.has(id)))];
  const extraSlugIds = Object.keys(TOOL_SLUGS).filter(id => !VALID_TOOL_IDS.has(id));
  if (!duplicateToolIds.length && !missingSlugIds.length && !unknownMissionToolIds.length && !extraSlugIds.length) return;
  console.warn("[P00-dashboard] Catalog integrity warning.", {
    duplicate_tool_ids: duplicateToolIds,
    missing_slug_ids: missingSlugIds,
    unknown_mission_tool_ids: unknownMissionToolIds,
    extra_slug_ids: extraSlugIds
  });
}

// ===== 渲染模块 =====
function renderModules() {
  const grid = document.getElementById("moduleGrid");
  const used = getToolsUsed();
  const metricsUsed = getMetricDerivedToolIds();
  const progressUsed = getProgressDerivedToolIds();
  grid.innerHTML = MODULES.map(mod => {
    const usedCount = mod.tools.filter(t => used.has(t.id)).length;
    const pct = Math.round((usedCount / mod.tools.length) * 100);
    return `<div class="module-card">
      <h3>${mod.emoji} ${mod.name}</h3>
      <p class="mod-desc">${mod.desc} <small>(${usedCount}/${mod.tools.length} 已涉及)</small></p>
      <div class="mod-progress"><div class="mod-progress-fill" style="width:${pct}%"></div></div>
      <ul class="tool-list">${mod.tools.map(t => {
        const slug = getToolSlug(t.id);
        const hasMetrics = metricsUsed.has(t.id);
        const hasProgress = progressUsed.has(t.id);
        const statusBadge = hasMetrics
          ? '<span class="tool-used" title="已记录工具事件" aria-label="已用：已有工具事件记录">✓ 已用</span>'
          : hasProgress
          ? '<span class="tool-restored" title="来自任务进度恢复" aria-label="已恢复：状态来自任务进度恢复">↺ 已恢复</span>'
          : '';
        return `<li>
          <a href="${SITE_BASE}/${t.id}-${slug}/" target="_blank" rel="noopener noreferrer" aria-label="${t.id} ${t.name}，在新标签页打开" class="tool-link" data-tool-id="${t.id}">${t.id} ${t.name}</a>
          ${statusBadge}
        </li>`;
      }).join("")}</ul>
    </div>`;
  }).join("");
}

// ===== 统计面板 =====
function renderStats() {
  const used = getToolsUsed();
  const selfEvents = getDashboardSelfMetricEvents();
  const hasSelfMetrics = selfEvents.length > 0;
  const hasSelfMetricsOnly = used.size === 0 && hasDashboardSelfMetrics();
  let totalEvents = selfEvents.length;
  let totalDwell = getDwellFromEvents(selfEvents);
  const toolStats = {};
  const dailyCounts = {};

  getTrackedMetricsEntries().forEach(({ pid, events }) => {
    if (!toolStats[pid]) toolStats[pid] = { events: 0 };
    totalDwell += getDwellFromEvents(events);
    events.forEach(e => {
      totalEvents++;
      toolStats[pid].events++;
      const day = formatLocalDateKey(e.event_time);
      if (day.length === 10) dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });
  });

  const prog = loadProgress();
  const tasksDone = MISSIONS.filter(m => {
    const p = getMissionProgressState(prog, m.id);
    return m.steps.every((_, i) => p["step" + i]);
  }).length;

  document.getElementById("sTotalEvents").textContent = totalEvents.toLocaleString();
  document.getElementById("sToolsUsed").textContent = Math.min(used.size, 50) + "/50";
  document.getElementById("sTasksDone").textContent = tasksDone;
  document.getElementById("sDwell").textContent = formatDuration(totalDwell);

  // Bar chart
  const entries = Object.entries(toolStats)
    .sort((a, b) => (b[1].events - a[1].events) || a[0].localeCompare(b[0]))
    .slice(0, 15);
  const barEl = document.getElementById("barChart");
  barEl.setAttribute("role", "list");
  if (entries.length === 0) {
    barEl.setAttribute("aria-label",
      hasSelfMetricsOnly
        ? "工具使用排行。当前仅记录到学习中枢自身事件，这些事件不会计入工具使用排行。"
        : hasSelfMetrics && used.size > 0
        ? "工具使用排行。已恢复任务或工具进度，但暂无工具事件历史；学习中枢自身事件不会计入使用排行。"
        : used.size > 0
        ? "工具使用排行。已恢复任务或工具进度，但暂无工具事件历史，暂时无法生成使用排行。"
        : "工具使用排行。暂无数据，请先使用工具。"
    );
    barEl.innerHTML = hasSelfMetricsOnly
      ? '<p class="empty-state">当前仅记录到学习中枢自身事件，这些事件不会计入工具使用排行。</p>'
      : hasSelfMetrics && used.size > 0
      ? '<p class="empty-state">已恢复任务/工具进度，但暂无工具事件历史；学习中枢自身事件不会计入使用排行。</p>'
      : used.size > 0
      ? '<p class="empty-state">已恢复任务/工具进度，但暂无工具事件历史，暂时无法生成使用排行。</p>'
      : '<p class="empty-state">暂无数据，请先使用工具！</p>';
  } else {
    barEl.setAttribute("aria-label", "工具使用排行");
    const maxE = Math.max(...entries.map(e => e[1].events));
    barEl.innerHTML = entries.map(([pid, s]) => {
      const pct = maxE > 0 ? (s.events / maxE * 100) : 0;
      const toolName = TOOL_SLUGS[pid] ? MODULES.flatMap(m => m.tools).find(t => t.id === pid)?.name || pid : pid;
      const label = `${pid} ${toolName}，${s.events} 次事件`;
      return `<div class="bar-row" role="listitem" aria-label="${label}"><span class="bar-label">${pid} ${toolName}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${Math.max(pct,3)}%">${s.events}</div></div></div>`;
    }).join("");
  }

  // Calendar
  const calEl = document.getElementById("calChart");
  calEl.setAttribute("role", "list");
  if (Object.keys(dailyCounts).length === 0) {
    calEl.setAttribute("aria-label",
      hasSelfMetricsOnly
        ? "过去 90 天活跃日历。当前仅记录到学习中枢自身事件，这些事件不会计入活跃日历。"
        : hasSelfMetrics && used.size > 0
        ? "过去 90 天活跃日历。已恢复进度，但暂无工具事件日期历史；学习中枢自身事件不会计入活跃日历。"
        : used.size > 0
        ? "过去 90 天活跃日历。已恢复进度，但暂无带日期的工具事件历史。"
        : "过去 90 天活跃日历。暂无活跃记录。"
    );
    calEl.innerHTML = hasSelfMetricsOnly
      ? '<p class="empty-state">当前仅记录到学习中枢自身事件，这些事件不会计入活跃日历。</p>'
      : hasSelfMetrics && used.size > 0
      ? '<p class="empty-state">已恢复进度，但暂无工具事件日期历史；学习中枢自身事件不会计入活跃日历。</p>'
      : used.size > 0
      ? '<p class="empty-state">已恢复进度，但暂无带日期的工具事件历史，活跃日历尚无法生成。</p>'
      : '<p class="empty-state">暂无活跃记录。</p>';
    return;
  }
  calEl.setAttribute("aria-label", `过去 90 天活跃日历。${buildRecentActivitySummary(dailyCounts)}`);
  const today = new Date();
  const maxC = Math.max(1, ...Object.values(dailyCounts));
  const cells = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = formatLocalDateKey(d);
    const c = dailyCounts[key] || 0;
    const lv = c === 0 ? "" : c <= maxC * 0.25 ? "l1" : c <= maxC * 0.5 ? "l2" : c <= maxC * 0.75 ? "l3" : "l4";
    cells.push(`<div class="cal-cell ${lv}" role="listitem" aria-label="${key}: ${c} 次事件" title="${key}: ${c}"></div>`);
  }
  calEl.innerHTML = cells.join("");
}

function formatDuration(ms) {
  if (ms <= 0) return "0s";
  if (ms < 1000) return "< 1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}

function buildRecentActivitySummary(dailyCounts) {
  const entries = Object.entries(dailyCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return "暂无活跃记录";
  const recent = entries.slice(-3).map(([day, count]) => `${day} ${count} 次`).join("；");
  return `最近活跃：${recent}`;
}

// ===== Hero Stats =====
function refreshHeroStats() {
  const used = getToolsUsed();
  const prog = loadProgress();
  const selfEvents = getDashboardSelfMetricEvents();
  const tasksDone = MISSIONS.filter(m => {
    const p = getMissionProgressState(prog, m.id);
    return m.steps.every((_, i) => p["step" + i]);
  }).length;
  const modulesStarted = MODULES.filter(mod => mod.tools.some(t => used.has(t.id))).length;

  document.getElementById("statModules").textContent = modulesStarted;
  document.getElementById("statTasks").textContent = tasksDone;
  document.getElementById("statTools").textContent = Math.min(used.size, 50);

  // Dwell time for hero
  let totalDwell = getDwellFromEvents(selfEvents);
  getTrackedMetricsEntries().forEach(({ events }) => {
    totalDwell += getDwellFromEvents(events);
  });
  document.getElementById("statDwell").textContent = formatDuration(totalDwell);
}

// ===== Export / Clear =====
const importBtn = document.getElementById("importBtn");
const importInput = document.getElementById("importInput");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
if (importBtn && importInput) {
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const [file] = Array.from(importInput.files || []);
    importInput.value = "";
    if (!file) {
      importBtn.focus();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showFreshToast("导入失败：文件不是有效的 JSON", "error");
      importBtn.focus();
      return;
    }
    const normalized = normalizeImportedSnapshot(parsed);
    const count = Object.keys(normalized).length;
    if (!count) {
      showFreshToast("导入失败：未找到可恢复的学习数据", "warn");
      importBtn.focus();
      return;
    }
    if (!confirm(`将导入 ${count} 条学习数据并覆盖当前记录，是否继续？`)) {
      showFreshToast("已取消导入", "info");
      importBtn.focus();
      return;
    }
    try {
      restoreManagedStorage(normalized);
      refreshDashboard();
      showFreshToast(`已导入 ${count} 条学习数据`, "success");
    } catch (error) {
      console.warn("[P00-dashboard] Import restore failed.", error);
      const message = error?.message === "snapshot_failed"
        ? "导入失败：当前浏览器存储存在不可读数据，无法安全覆盖，请先清理后重试"
        : error?.message === "rollback_failed"
        ? "导入失败：浏览器存储异常，恢复过程中可能仅部分保留原有数据"
        : "导入失败：浏览器存储写入失败，已保留原有数据";
      showFreshToast(message, "error", 4500);
    }
    importBtn.focus();
  });
}
if (exportBtn) {
  exportBtn.addEventListener("click", () => {
    const backupStatus = getBackupStorageSnapshotStatus();
    if (!backupStatus.readable || backupStatus.unreadable > 0) {
      showFreshToast("导出失败：当前浏览器存储存在不可读数据，无法生成完整备份。", "error", 4500);
      return;
    }
    let payload;
    try {
      payload = buildExportPayload();
    } catch (error) {
      console.warn("[P00-dashboard] Export snapshot build failed.", error);
      showFreshToast("导出失败：当前浏览器存储状态已变化，请刷新后重试。", "error", 4500);
      return;
    }
    if (!Object.keys(payload.data).length) {
      showFreshToast("暂无可导出的学习数据", "info");
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `journalism-tools-data-${formatLocalDateKey(new Date())}.json`;
    a.click(); URL.revokeObjectURL(url);
    showFreshToast("学习数据已导出", "success");
  });
}
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (confirm("确定清除全部学习数据？此操作不可撤销。")) {
      try {
        const result = clearManagedStorageTransactional();
        refreshDashboard();
        if (result.found > 0) {
          showFreshToast("学习数据已清除", "warn", 3000, { track: false });
        } else {
          showFreshToast("当前没有可清除的学习数据", "info", 3000, { track: false });
        }
      } catch (error) {
        refreshDashboard();
        const message = error?.message === "snapshot_failed"
          ? "清除失败：当前浏览器存储存在不可读数据，无法安全清除。"
          : error?.message === "rollback_failed"
          ? "清除失败：浏览器存储异常，回滚过程中可能仅部分保留原有数据。"
          : "清除失败：浏览器存储删除不完整，已保留原有数据。";
        showFreshToast(message, "error", 4500);
      }
      clearBtn.focus();
    }
  });
}

window.addEventListener("storage", e => {
  if (e.storageArea !== localStorage) return;
  if (e.key && !isManagedStorageKey(e.key)) return;
  resetMissionStartSync();
  scheduleDashboardRefresh();
});
window.addEventListener("focus", () => scheduleDashboardRefresh());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleDashboardRefresh();
});

// ===== Init =====
validateCatalogIntegrity();
refreshDashboard();
registerServiceWorker();
