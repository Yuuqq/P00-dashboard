(() => {
  const PROJECT_ID = "P00-dashboard";
  const PROJECT_CLUSTER = "学习中枢";
  const DEFAULT_TASK = "learning_hub_overview_task";
  const STORAGE_KEY = "pm_metrics_events_" + PROJECT_ID;
  const SESSION_KEY = "pm_metrics_session_" + PROJECT_ID;
  const TASK_START_KEY = "pm_metrics_task_start_" + PROJECT_ID;
  const APP_VERSION = "pm-v1";
  const TASK_DURATION_CAP_MS = 8 * 60 * 60 * 1000;
  const TASK_START_MAX_FUTURE_MS = 5 * 60 * 1000;
  const MAX_STORED_EVENTS = 500;
  const VALID_EVENT_NAMES = new Set([
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
  const SESSION_ID = (() => {
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      const created = PROJECT_ID + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(SESSION_KEY, created);
      if (sessionStorage.getItem(SESSION_KEY) !== created) {
        throw new Error("sessionStorage write verification failed");
      }
      return created;
    } catch (_e) {
      return PROJECT_ID + "-volatile-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }
  })();

  const PAGE_ENTER_TS = Date.now();
  const INITIAL_PAGE_PATH = location.pathname + location.hash;
  const PAGE_VIEW_EVENT_TIME = new Date(PAGE_ENTER_TS).toISOString();
  let pageViewCaptured = false;
  let firstInteractionCaptured = false;
  let firstInteractionElapsedMs = null;
  let firstInteractionPagePath = null;
  const FIRST_INTERACTION_EVENTS = ["pointerdown", "keydown", "change"];
  let statusHostObserver = null;
  let statusSignalObserver = null;
  let toastContainerObserver = null;
  let observedStatusEl = null;
  let observedToastContainer = null;
  let pendingStatusSignals = [];
  let currentStatusSignalSignature = "";
  let currentStatusSignal = null;
  const activeToastSignals = new Map();

  function isValidEventEntry(item) {
    const eventTime = item && typeof item.event_time === "string" ? new Date(item.event_time).getTime() : Number.NaN;
    return !!item
      && typeof item === "object"
      && !Array.isArray(item)
      && typeof item.event_name === "string"
      && item.event_name.length > 0
      && VALID_EVENT_NAMES.has(item.event_name)
      && typeof item.event_time === "string"
      && item.event_time.length > 0
      && !Number.isNaN(eventTime)
      && eventTime <= (Date.now() + TASK_START_MAX_FUTURE_MS);
  }

  function getEventTimeMs(value) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
  }

  function isFreshTaskStartTimestamp(timestamp) {
    if (!Number.isFinite(timestamp)) return false;
    if (timestamp > (Date.now() + TASK_START_MAX_FUTURE_MS)) return false;
    return (Date.now() - timestamp) <= TASK_DURATION_CAP_MS;
  }

  function sortEventsChronologically(events) {
    return events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => {
        const aTime = getEventTimeMs(a.event?.event_time);
        const bTime = getEventTimeMs(b.event?.event_time);
        return (aTime - bTime) || (a.index - b.index);
      })
      .map(item => item.event);
  }

  function readEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortEventsChronologically(parsed.filter(isValidEventEntry)).slice(-MAX_STORED_EVENTS) : [];
    } catch (_e) {
      return [];
    }
  }

  function hasStorageKey(key) {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        if (localStorage.key(index) === key) return true;
      }
    } catch (_e) {}
    return false;
  }

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_e) {}
    return null;
  }

  function isStorageKeyUnreadable(key) {
    return hasStorageKey(key) && safeStorageGet(key) === null;
  }

  function isStoredEventArrayCorrupt(key) {
    if (!hasStorageKey(key)) return false;
    const raw = safeStorageGet(key);
    if (raw === null) return false;
    try {
      const parsed = JSON.parse(raw);
      return !Array.isArray(parsed) || parsed.some(item => !isValidEventEntry(item));
    } catch (_e) {}
    return true;
  }

  function writeEvents(events) {
    try {
      if (isStorageKeyUnreadable(STORAGE_KEY) || isStoredEventArrayCorrupt(STORAGE_KEY)) return false;
      const next = JSON.stringify(sortEventsChronologically(events.filter(isValidEventEntry)).slice(-MAX_STORED_EVENTS));
      localStorage.setItem(STORAGE_KEY, next);
      return safeStorageGet(STORAGE_KEY) === next;
    } catch (_e) {}
    return false;
  }

  function getRetainedEvents(existingEvents, incomingItems) {
    const items = sortEventsChronologically(incomingItems.filter(isValidEventEntry)).slice(-MAX_STORED_EVENTS);
    if (items.length === 0) {
      return sortEventsChronologically(existingEvents).slice(-MAX_STORED_EVENTS);
    }
    const preferredExisting = [];
    const otherExisting = [];
    sortEventsChronologically(existingEvents).forEach(event => {
      if (event && event.session_id === SESSION_ID) {
        preferredExisting.push(event);
      } else {
        otherExisting.push(event);
      }
    });
    const retainedPreferred = preferredExisting.slice(-Math.max(0, MAX_STORED_EVENTS - items.length));
    const retainedOther = otherExisting.slice(-Math.max(0, MAX_STORED_EVENTS - items.length - retainedPreferred.length));
    return sortEventsChronologically(retainedOther.concat(retainedPreferred, items));
  }

  function appendBasePayloads(payloads) {
    const items = payloads.map(payload => basePayload(payload));
    const validItems = items.filter(isValidEventEntry);
    if (validItems.length !== items.length) {
      return { items, persisted: false };
    }
    return {
      items,
      persisted: writeEvents(getRetainedEvents(readEvents(), validItems))
    };
  }

  function hasPersistedCurrentPageView(events) {
    return events.some(event => event
      && event.session_id === SESSION_ID
      && event.event_name === "page_view"
      && event.event_time === PAGE_VIEW_EVENT_TIME
      && event.page_path === INITIAL_PAGE_PATH);
  }

  function hasPersistedCurrentFirstInteraction(events) {
    if (firstInteractionElapsedMs === null) return false;
    return events.some(event => event
      && event.session_id === SESSION_ID
      && event.event_name === "first_interaction"
      && event.event_time === new Date(PAGE_ENTER_TS + firstInteractionElapsedMs).toISOString()
      && event.page_path === (firstInteractionPagePath || INITIAL_PAGE_PATH)
      && Number(event.elapsed_ms) === firstInteractionElapsedMs);
  }

  function isSameStatusSignal(a, b) {
    return !!a
      && !!b
      && a.eventName === b.eventName
      && a.statusText === b.statusText
      && a.eventTime === b.eventTime
      && a.pagePath === b.pagePath;
  }

  function hasPersistedStatusSignal(signal, events) {
    if (!signal) return false;
    return events.some(event => event
      && event.session_id === SESSION_ID
      && event.event_name === signal.eventName
      && event.status_text === signal.statusText
      && event.event_time === signal.eventTime
      && event.page_path === signal.pagePath);
  }

  function collectActiveStatusSignals() {
    const signals = [];
    if (currentStatusSignal) signals.push(currentStatusSignal);
    activeToastSignals.forEach(signal => {
      if (signal) signals.push(signal);
    });
    return signals;
  }

  function rehydrateActiveStatusSources() {
    currentStatusSignalSignature = "";
    currentStatusSignal = null;
    activeToastSignals.clear();

    const statusEl = observedStatusEl && observedStatusEl.isConnected
      ? observedStatusEl
      : document.getElementById("status");
    const statusSignal = classifyStatusText(statusEl);
    if (statusSignal) {
      currentStatusSignalSignature = statusSignal.signature;
      currentStatusSignal = statusSignal;
    }

    const toastContainer = observedToastContainer && observedToastContainer.isConnected
      ? observedToastContainer
      : document.getElementById("toastContainer");
    if (toastContainer instanceof HTMLElement) {
      toastContainer.querySelectorAll("[role='status'], [role='alert']").forEach(toastEl => {
        const toastSignal = classifyStatusText(toastEl);
        if (toastSignal) {
          activeToastSignals.set(toastEl, toastSignal);
        }
      });
    }
  }

  function reconcileStorageState(options) {
    const settings = options && typeof options === "object" ? options : {};
    const events = readEvents();
    pageViewCaptured = hasPersistedCurrentPageView(events);
    firstInteractionCaptured = hasPersistedCurrentFirstInteraction(events);
    if (firstInteractionCaptured) {
      FIRST_INTERACTION_EVENTS.forEach(eventName => {
        window.removeEventListener(eventName, captureFirstInteraction);
      });
    } else {
      FIRST_INTERACTION_EVENTS.forEach(eventName => {
        window.addEventListener(eventName, captureFirstInteraction);
      });
    }
    if (settings.resetPendingStatus === true) {
      pendingStatusSignals = [];
      if (settings.suppressActiveStatus === true) {
        currentStatusSignalSignature = "";
        currentStatusSignal = null;
        activeToastSignals.clear();
      } else {
        rehydrateActiveStatusSources();
      }
    }
    collectActiveStatusSignals().forEach(signal => {
      if (!hasPersistedStatusSignal(signal, events)
        && !pendingStatusSignals.some(queuedSignal => isSameStatusSignal(queuedSignal, signal))) {
        pendingStatusSignals.push(signal);
      }
    });
    return {
      pageViewCaptured,
      firstInteractionCaptured,
      pendingStatusCount: pendingStatusSignals.length
    };
  }

  function basePayload(extra) {
    return Object.assign({
      project_id: PROJECT_ID,
      project_cluster: PROJECT_CLUSTER,
      session_id: SESSION_ID,
      app_version: APP_VERSION,
      event_time: new Date().toISOString(),
      page_path: location.pathname + location.hash
    }, extra || {});
  }

  function appendTrackedEvent(eventName, extra) {
    const result = appendBasePayloads([Object.assign({ event_name: eventName }, extra || {})]);
    return { item: result.items[0] || null, persisted: result.persisted };
  }

  function getPageViewPayload() {
    return {
      event_name: "page_view",
      referrer: document.referrer || "",
      event_time: PAGE_VIEW_EVENT_TIME,
      page_path: INITIAL_PAGE_PATH
    };
  }

  function getFirstInteractionPayload() {
    if (firstInteractionElapsedMs === null) return null;
    return {
      event_name: "first_interaction",
      elapsed_ms: firstInteractionElapsedMs,
      event_time: new Date(PAGE_ENTER_TS + firstInteractionElapsedMs).toISOString(),
      page_path: firstInteractionPagePath || INITIAL_PAGE_PATH
    };
  }

  function getStatusSignalPayload(signal) {
    if (!signal) return null;
    return {
      event_name: signal.eventName,
      status_text: signal.statusText,
      event_time: signal.eventTime,
      page_path: signal.pagePath
    };
  }

  function appendTrackedPayloads(payloads) {
    const pendingPayloads = [];
    const pendingPageView = !pageViewCaptured;
    const pendingFirstInteraction = !firstInteractionCaptured && firstInteractionElapsedMs !== null;
    if (pendingPageView) {
      pendingPayloads.push(getPageViewPayload());
    }
    if (pendingFirstInteraction) {
      pendingPayloads.push(getFirstInteractionPayload());
    }
    pendingStatusSignals.forEach(signal => {
      const statusPayload = getStatusSignalPayload(signal);
      if (statusPayload) pendingPayloads.push(statusPayload);
    });
    const result = appendBasePayloads(pendingPayloads.concat(payloads));
    const persisted = result.persisted;
    if (persisted) {
      if (pendingPageView) pageViewCaptured = true;
      if (pendingFirstInteraction) {
        firstInteractionCaptured = true;
        FIRST_INTERACTION_EVENTS.forEach(eventName => {
          window.removeEventListener(eventName, captureFirstInteraction);
        });
      }
      if (pendingStatusSignals.length > 0) {
        pendingStatusSignals = [];
      }
    }
    return result;
  }

  function flushPendingStatusSignal() {
    while (pendingStatusSignals.length > 0) {
      capturePageView();
      persistFirstInteraction();
      const signal = pendingStatusSignals[0];
      const result = appendTrackedEvent(signal.eventName, getStatusSignalPayload(signal));
      if (!result.persisted) return false;
      pendingStatusSignals.shift();
    }
    return true;
  }

  function hasReadableStoredEvents() {
    return !isStorageKeyUnreadable(STORAGE_KEY) && !isStoredEventArrayCorrupt(STORAGE_KEY);
  }

  function hasPendingTrackedPayloads() {
    return !pageViewCaptured
      || (!firstInteractionCaptured && firstInteractionElapsedMs !== null)
      || pendingStatusSignals.length > 0;
  }

  function track(eventName, extra) {
    if (hasPendingTrackedPayloads()
      && eventName !== "page_view"
      && eventName !== "first_interaction"
      && eventName !== "status_success_signal"
      && eventName !== "status_error_signal") {
      const result = appendTrackedPayloads([Object.assign({ event_name: eventName }, extra || {})]);
      return {
        item: result.items[result.items.length - 1] || null,
        persisted: result.persisted
      };
    }
    if (eventName !== "page_view") {
      capturePageView();
    }
    if (eventName !== "first_interaction") {
      persistFirstInteraction();
    }
    if (pendingStatusSignals.length > 0 && eventName !== "status_success_signal" && eventName !== "status_error_signal") {
      flushPendingStatusSignal();
    }
    return appendTrackedEvent(eventName, extra);
  }

  function setTaskStart(taskName) {
    try {
      const key = TASK_START_KEY + "::" + taskName;
      if (isStorageKeyUnreadable(key)) return false;
      const value = String(Date.now());
      localStorage.setItem(key, value);
      return safeStorageGet(key) === value;
    } catch (_e) {}
    return false;
  }

  function clearTaskStart(taskName) {
    try {
      const key = TASK_START_KEY + "::" + taskName;
      localStorage.removeItem(key);
      return !hasStorageKey(key);
    } catch (_e) {}
    return false;
  }

  function getLatestTaskTerminalTime(taskName, events) {
    let latest = Number.NEGATIVE_INFINITY;
    events.forEach(event => {
      if (!event || event.task_name !== taskName) return;
      if (event.event_name !== "task_complete" && event.event_name !== "task_error") return;
      latest = Math.max(latest, getEventTimeMs(event.event_time));
    });
    return Number.isFinite(latest) ? latest : null;
  }

  function getTaskStartMarkerTimestamp(taskName) {
    try {
      const key = TASK_START_KEY + "::" + taskName;
      const raw = localStorage.getItem(key);
      if (raw) {
        const start = Number(raw);
        if (isFreshTaskStartTimestamp(start)) {
          return start;
        }
      }
    } catch (_e) {}
    return null;
  }

  function getLatestTaskStartTime(taskName, events) {
    let latest = Number.NEGATIVE_INFINITY;
    events.forEach(event => {
      if (!event || event.task_name !== taskName) return;
      if (event.event_name !== "task_start") return;
      latest = Math.max(latest, getEventTimeMs(event.event_time));
    });
    return Number.isFinite(latest) ? latest : null;
  }

  function hasOpenTaskStartEvent(taskName, events) {
    const latestStartTime = getLatestTaskStartTime(taskName, events);
    if (!isFreshTaskStartTimestamp(latestStartTime)) return false;
    const latestTerminalTime = getLatestTaskTerminalTime(taskName, events);
    return !Number.isFinite(latestTerminalTime) || latestStartTime > latestTerminalTime;
  }

  function getLatestOpenTaskStartTime(taskName, events) {
    const latestStartTime = getLatestTaskStartTime(taskName, events);
    if (!isFreshTaskStartTimestamp(latestStartTime)) return null;
    const latestTerminalTime = getLatestTaskTerminalTime(taskName, events);
    return !Number.isFinite(latestTerminalTime) || latestStartTime > latestTerminalTime
      ? latestStartTime
      : null;
  }

  function getBackfillTaskStartPayload(taskName, events) {
    const markerStart = getTaskStartMarkerTimestamp(taskName);
    if (!Number.isFinite(markerStart)) return null;
    const latestTerminalTime = getLatestTaskTerminalTime(taskName, events);
    if (Number.isFinite(latestTerminalTime) && markerStart <= latestTerminalTime) {
      return null;
    }
    const latestOpenStartTime = getLatestOpenTaskStartTime(taskName, events);
    if (Number.isFinite(latestOpenStartTime) && latestOpenStartTime >= markerStart) return null;
    return {
      event_name: "task_start",
      task_name: taskName,
      event_time: new Date(markerStart).toISOString()
    };
  }

  function getTaskStartTimestamp(taskName) {
    const markerStart = getTaskStartMarkerTimestamp(taskName);
    const events = readEvents();
    const latestTerminalTime = getLatestTaskTerminalTime(taskName, events);
    if (Number.isFinite(markerStart) && (!Number.isFinite(latestTerminalTime) || markerStart > latestTerminalTime)) {
      return markerStart;
    }

    const sortedEvents = events.slice().sort((a, b) => getEventTimeMs(b.event_time) - getEventTimeMs(a.event_time));
    for (const event of sortedEvents) {
      if (!event || event.task_name !== taskName) continue;
      if (event.event_name === "task_start") {
        const start = getEventTimeMs(event.event_time);
        return isFreshTaskStartTimestamp(start) ? start : null;
      }
      if (event.event_name === "task_complete" || event.event_name === "task_error") {
        return null;
      }
    }

    return null;
  }

  function getTaskDuration(taskName) {
    const start = getTaskStartTimestamp(taskName);
    if (!Number.isFinite(start)) return null;
    return Math.min(Math.max(0, Date.now() - start), TASK_DURATION_CAP_MS);
  }

  function markTaskStart(taskName) {
    const task = taskName || DEFAULT_TASK;
    const markerSet = setTaskStart(task);
    const result = track("task_start", { task_name: task });
    return {
      markerSet,
      eventPersisted: !!result.persisted
    };
  }

  function markTaskComplete(taskName, extra) {
    const task = taskName || DEFAULT_TASK;
    const events = readEvents();
    const backfill = getBackfillTaskStartPayload(task, events);
    const duration = getTaskDuration(task);
    const payloads = [];
    if (backfill) payloads.push(backfill);
    payloads.push(Object.assign({
      event_name: "task_complete",
      task_name: task,
      task_duration_ms: duration
    }, extra || {}));
    const result = appendTrackedPayloads(payloads);
    const markerCleared = result.persisted ? clearTaskStart(task) : false;
    return {
      persisted: result.persisted,
      markerCleared
    };
  }

  function markTaskError(taskName, reason) {
    const task = taskName || DEFAULT_TASK;
    const events = readEvents();
    const backfill = getBackfillTaskStartPayload(task, events);
    const payloads = [];
    if (backfill) payloads.push(backfill);
    payloads.push({
      event_name: "task_error",
      task_name: task,
      error_reason: String(reason || "unknown")
    });
    const result = appendTrackedPayloads(payloads);
    const markerCleared = result.persisted ? clearTaskStart(task) : false;
    return {
      persisted: result.persisted,
      markerCleared
    };
  }

  function getSummary() {
    if (hasStorageKey(STORAGE_KEY) && !hasReadableStoredEvents()) {
      return {
        project_id: PROJECT_ID,
        total_events: null,
        page_view: null,
        first_interaction: null,
        task_start: null,
        task_complete: null,
        task_error: null,
        cta_click: null,
        storage_readable: false
      };
    }
    const events = readEvents();
    const summary = {
      project_id: PROJECT_ID,
      total_events: events.length,
      page_view: 0,
      first_interaction: 0,
      task_start: 0,
      task_complete: 0,
      task_error: 0,
      cta_click: 0,
      storage_readable: true
    };
    events.forEach(e => {
      const n = e && e.event_name ? e.event_name : "";
      if (Object.prototype.hasOwnProperty.call(summary, n)) {
        summary[n] += 1;
      }
    });
    return summary;
  }

  function exportEvents() {
    if (hasStorageKey(STORAGE_KEY) && !hasReadableStoredEvents()) {
      throw new Error("snapshot_failed");
    }
    return JSON.stringify(readEvents(), null, 2);
  }

  function getStatusTextContent(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (!(node instanceof Element)) return "";
    if (node.getAttribute("aria-hidden") === "true") return "";
    return Array.from(node.childNodes).map(getStatusTextContent).join("");
  }

  function classifyStatusText(statusEl) {
    if (statusEl instanceof HTMLElement && statusEl.dataset.toastTrack === "off") {
      return null;
    }
    const toastType = statusEl instanceof HTMLElement ? String(statusEl.dataset.toastType || "") : "";
    const text = (statusEl instanceof HTMLElement ? String(statusEl.dataset.toastMessage || "") : "").trim()
      || getStatusTextContent(statusEl).trim();
    if (!text) return null;
    if (toastType === "success") {
      return {
        eventName: "status_success_signal",
        statusText: text.slice(0, 120),
        eventTime: new Date().toISOString(),
        signature: `status_success_signal:${text.slice(0, 120)}`,
        pagePath: location.pathname + location.hash
      };
    }
    if (toastType === "error") {
      return {
        eventName: "status_error_signal",
        statusText: text.slice(0, 120),
        eventTime: new Date().toISOString(),
        signature: `status_error_signal:${text.slice(0, 120)}`,
        pagePath: location.pathname + location.hash
      };
    }
    if (/(完成|成功|已生成|已导出|已清除|已重置|渲染完成|done|success)/i.test(text)) {
      return {
        eventName: "status_success_signal",
        statusText: text.slice(0, 120),
        eventTime: new Date().toISOString(),
        signature: `status_success_signal:${text.slice(0, 120)}`,
        pagePath: location.pathname + location.hash
      };
    }
    if (/(失败|错误|error|invalid)/i.test(text)) {
      return {
        eventName: "status_error_signal",
        statusText: text.slice(0, 120),
        eventTime: new Date().toISOString(),
        signature: `status_error_signal:${text.slice(0, 120)}`,
        pagePath: location.pathname + location.hash
      };
    }
    if (toastType === "warn") {
      return {
        eventName: "status_error_signal",
        statusText: text.slice(0, 120),
        eventTime: new Date().toISOString(),
        signature: `status_error_signal:${text.slice(0, 120)}`,
        pagePath: location.pathname + location.hash
      };
    }
    return null;
  }

  function persistStatusSignal(signal) {
    if (!signal) return false;
    if (pendingStatusSignals.length > 0) {
      flushPendingStatusSignal();
    }
    if (pendingStatusSignals.length > 0) {
      pendingStatusSignals.push(signal);
      return false;
    }
    capturePageView();
    persistFirstInteraction();
    const result = appendTrackedEvent(signal.eventName, {
      status_text: signal.statusText,
      event_time: signal.eventTime,
      page_path: signal.pagePath
    });
    if (result.persisted) {
      return true;
    }
    pendingStatusSignals.push(signal);
    return false;
  }

  function bindCtaTracking() {
    if (document.documentElement.dataset.pmCtaBound === "1") return;
    document.documentElement.dataset.pmCtaBound = "1";
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button[id], button[type='button']") : null;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.pmIgnoreMetrics === "1") return;
      track("cta_click", {
        control_id: target.id || "",
        control_text: (target.textContent || "").trim().slice(0, 80)
      });
    });
  }

  function bindStatusObserver() {
    function handleStatusText(statusEl) {
      const signal = classifyStatusText(statusEl);
      if (!signal) {
        currentStatusSignalSignature = "";
        currentStatusSignal = null;
        return;
      }
      if (signal.signature === currentStatusSignalSignature) return;
      currentStatusSignalSignature = signal.signature;
      currentStatusSignal = signal;
      persistStatusSignal(signal);
    }

    const statusEl = document.getElementById("status");
    if (statusEl === observedStatusEl) return;
    if (statusSignalObserver) {
      statusSignalObserver.disconnect();
      statusSignalObserver = null;
    }
    currentStatusSignalSignature = "";
    currentStatusSignal = null;
    observedStatusEl = statusEl;
    if (!statusEl) return;
    statusSignalObserver = new MutationObserver(() => {
      handleStatusText(statusEl);
    });
    statusSignalObserver.observe(statusEl, { childList: true, subtree: true, characterData: true });
    handleStatusText(statusEl);
  }

  function bindToastObserver() {
    function handleToastElement(toastEl) {
      if (!(toastEl instanceof HTMLElement)) return;
      const signal = classifyStatusText(toastEl);
      if (!signal) {
        activeToastSignals.delete(toastEl);
        return;
      }
      activeToastSignals.set(toastEl, signal);
      persistStatusSignal(signal);
    }

    const toastContainer = document.getElementById("toastContainer");
    if (toastContainer === observedToastContainer) return;
    if (toastContainerObserver) {
      toastContainerObserver.disconnect();
      toastContainerObserver = null;
    }
    activeToastSignals.clear();
    observedToastContainer = toastContainer;
    if (!toastContainer) return;
    toastContainer.querySelectorAll("[role='status'], [role='alert']").forEach(handleToastElement);
    toastContainerObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("[role='status'], [role='alert']")) {
            handleToastElement(node);
          }
          node.querySelectorAll?.("[role='status'], [role='alert']").forEach(handleToastElement);
        });
        mutation.removedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            activeToastSignals.delete(node);
          }
        });
      });
    });
    toastContainerObserver.observe(toastContainer, { childList: true, subtree: true });
  }

  function bindStatusObserverHost() {
    if (statusHostObserver) return;
    bindStatusObserver();
    bindToastObserver();
    statusHostObserver = new MutationObserver(() => {
      bindStatusObserver();
      bindToastObserver();
    });
    statusHostObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function capturePageView() {
    if (pageViewCaptured) return true;
    const result = appendTrackedEvent("page_view", {
      referrer: document.referrer || "",
      event_time: PAGE_VIEW_EVENT_TIME,
      page_path: INITIAL_PAGE_PATH
    });
    if (result.persisted) {
      pageViewCaptured = true;
    }
    return result.persisted;
  }

  function persistFirstInteraction() {
    if (firstInteractionCaptured || firstInteractionElapsedMs === null) return false;
    capturePageView();
    const result = appendTrackedEvent("first_interaction", {
      elapsed_ms: firstInteractionElapsedMs,
      event_time: new Date(PAGE_ENTER_TS + firstInteractionElapsedMs).toISOString(),
      page_path: firstInteractionPagePath || INITIAL_PAGE_PATH
    });
    if (result.persisted) {
      firstInteractionCaptured = true;
      FIRST_INTERACTION_EVENTS.forEach(eventName => {
        window.removeEventListener(eventName, captureFirstInteraction);
      });
    }
    return result.persisted;
  }

  function captureFirstInteraction() {
    if (firstInteractionCaptured) return;
    if (firstInteractionElapsedMs === null) {
      firstInteractionElapsedMs = Date.now() - PAGE_ENTER_TS;
      firstInteractionPagePath = location.pathname + location.hash;
    }
    persistFirstInteraction();
  }

  FIRST_INTERACTION_EVENTS.forEach(eventName => {
    window.addEventListener(eventName, captureFirstInteraction);
  });

  window.addEventListener("beforeunload", () => {
    persistFirstInteraction();
    capturePageView();
    flushPendingStatusSignal();
    track("page_unload", {
      dwell_ms: Date.now() - PAGE_ENTER_TS
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistFirstInteraction();
      capturePageView();
      flushPendingStatusSignal();
      track("page_hidden", { dwell_ms: Date.now() - PAGE_ENTER_TS });
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    capturePageView();
    bindCtaTracking();
    bindStatusObserverHost();
  });

  window.addEventListener("storage", event => {
    if (event.storageArea !== localStorage) return;
    if (event.key && event.key !== STORAGE_KEY) return;
    reconcileStorageState();
  });

  window.pmMetrics = {
    track,
    markTaskStart,
    markTaskComplete,
    markTaskError,
    getSummary,
    exportEvents,
    reconcileStorageState
  };
})();
