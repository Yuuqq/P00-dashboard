(() => {
  const PROJECT_ID = "P00-dashboard";
  const PROJECT_CLUSTER = "AI 内容生产";
  const DEFAULT_TASK = "dashboard_core_task";
  const STORAGE_KEY = "pm_metrics_events_" + PROJECT_ID;
  const SESSION_KEY = "pm_metrics_session_" + PROJECT_ID;
  const TASK_START_KEY = "pm_metrics_task_start_" + PROJECT_ID;
  const APP_VERSION = "pm-v1";
  const SESSION_ID = (() => {
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      const created = PROJECT_ID + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(SESSION_KEY, created);
      return created;
    } catch (_e) {
      return PROJECT_ID + "-fallback";
    }
  })();

  const PAGE_ENTER_TS = Date.now();
  let firstInteractionCaptured = false;

  function readEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }

  function writeEvents(events) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-500)));
    } catch (_e) {}
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

  function track(eventName, extra) {
    const events = readEvents();
    const item = basePayload(Object.assign({ event_name: eventName }, extra || {}));
    events.push(item);
    writeEvents(events);
    return item;
  }

  function setTaskStart(taskName) {
    try {
      const key = TASK_START_KEY + "::" + taskName;
      localStorage.setItem(key, String(Date.now()));
    } catch (_e) {}
  }

  function getTaskDuration(taskName) {
    try {
      const key = TASK_START_KEY + "::" + taskName;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const start = Number(raw);
      if (!Number.isFinite(start)) return null;
      return Math.max(0, Date.now() - start);
    } catch (_e) {
      return null;
    }
  }

  function markTaskStart(taskName) {
    const task = taskName || DEFAULT_TASK;
    setTaskStart(task);
    track("task_start", { task_name: task });
  }

  function markTaskComplete(taskName, extra) {
    const task = taskName || DEFAULT_TASK;
    const duration = getTaskDuration(task);
    track("task_complete", Object.assign({
      task_name: task,
      task_duration_ms: duration
    }, extra || {}));
  }

  function markTaskError(taskName, reason) {
    const task = taskName || DEFAULT_TASK;
    track("task_error", {
      task_name: task,
      error_reason: String(reason || "unknown")
    });
  }

  function getSummary() {
    const events = readEvents();
    const summary = {
      project_id: PROJECT_ID,
      total_events: events.length,
      page_view: 0,
      first_interaction: 0,
      task_start: 0,
      task_complete: 0,
      task_error: 0,
      cta_click: 0
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
    return JSON.stringify(readEvents(), null, 2);
  }

  function bindCtaTracking() {
    const buttons = Array.from(document.querySelectorAll("button[id], button[type='button']"));
    buttons.forEach(btn => {
      if (btn.dataset.pmBound === "1") return;
      btn.dataset.pmBound = "1";
      btn.addEventListener("click", () => {
        track("cta_click", {
          control_id: btn.id || "",
          control_text: (btn.textContent || "").trim().slice(0, 80)
        });
      });
    });
  }

  function bindStatusObserver() {
    const statusEl = document.getElementById("status");
    if (!statusEl) return;
    const observer = new MutationObserver(() => {
      const text = (statusEl.textContent || "").trim();
      if (!text) return;
      if (/(完成|成功|已生成|已导出|渲染完成|done|success)/i.test(text)) {
        track("status_success_signal", { status_text: text.slice(0, 120) });
      } else if (/(失败|错误|error|invalid)/i.test(text)) {
        track("status_error_signal", { status_text: text.slice(0, 120) });
      }
    });
    observer.observe(statusEl, { childList: true, subtree: true, characterData: true });
  }

  function captureFirstInteraction() {
    if (firstInteractionCaptured) return;
    firstInteractionCaptured = true;
    track("first_interaction", {
      elapsed_ms: Date.now() - PAGE_ENTER_TS
    });
  }

  ["pointerdown", "keydown", "change"].forEach(evt => {
    window.addEventListener(evt, captureFirstInteraction, { once: true, passive: true });
  });

  window.addEventListener("beforeunload", () => {
    track("page_unload", {
      dwell_ms: Date.now() - PAGE_ENTER_TS
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      track("page_hidden", { dwell_ms: Date.now() - PAGE_ENTER_TS });
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    track("page_view", {
      referrer: document.referrer || ""
    });
    bindCtaTracking();
    bindStatusObserver();
  });

  window.pmMetrics = {
    track,
    markTaskStart,
    markTaskComplete,
    markTaskError,
    getSummary,
    exportEvents
  };
})();
