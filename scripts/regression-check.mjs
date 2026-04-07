import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Missing dependency: playwright. Install it in the workspace before running node scripts/regression-check.mjs.");
  process.exit(1);
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};
const DASHBOARD_EVENTS_KEY = "pm_metrics_events_P00-dashboard";
const VISIBLE_TOAST_SELECTOR = "#toastContainer > [role='status'], #toastContainer > [role='alert']";
const ETHICS_STEP_0_PROGRESS = {
  "mission-ethics": { _started: true, step0: true }
};

function extractQuotedArrayConstant(source, constantName) {
  const pattern = new RegExp(`const\\s+${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = source.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Could not locate array constant ${constantName}`);
  }
  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  if (!values.length) {
    throw new Error(`Array constant ${constantName} did not contain any quoted entries`);
  }
  return values;
}

const SERVICE_WORKER_SOURCE = await readFile(path.join(ROOT_DIR, "sw.js"), "utf8");
const OFFLINE_FETCH_ASSETS = extractQuotedArrayConstant(SERVICE_WORKER_SOURCE, "CORE_ASSETS")
  .filter((asset) => asset !== "./" && asset !== "./index.html" && asset !== "./manifest.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThemeUiState(result, { theme, buttonLabel, buttonPressed, storedThemeRaw }, prefix) {
  assert(result.theme === theme, `${prefix} did not update the data-theme attribute: ${JSON.stringify(result)}`);
  assert(result.colorScheme === theme, `${prefix} did not update color-scheme: ${JSON.stringify(result)}`);
  assert(result.buttonLabel === buttonLabel, `${prefix} did not update the dark-toggle button label: ${JSON.stringify(result)}`);
  assert(result.buttonPressed === buttonPressed, `${prefix} did not update the dark-toggle button pressed state: ${JSON.stringify(result)}`);
  assert(result.themeColor === result.bg, `${prefix} did not keep theme-color aligned with the active background token: ${JSON.stringify(result)}`);
  assert(result.themeColorMedia === "", `${prefix} should keep only the active theme-color meta without media after updates: ${JSON.stringify(result)}`);
  if (storedThemeRaw !== undefined) {
    assert(result.storedThemeRaw === storedThemeRaw, `${prefix} did not preserve the expected stored theme preference state: ${JSON.stringify(result)}`);
  }
}

function lightThemeExpectation(storedThemeRaw) {
  return {
    theme: "light",
    buttonLabel: "切换到暗色模式",
    buttonPressed: "false",
    storedThemeRaw
  };
}

function darkThemeExpectation(storedThemeRaw) {
  return {
    theme: "dark",
    buttonLabel: "切换到亮色模式",
    buttonPressed: "true",
    storedThemeRaw
  };
}

function readDashboardEventsExpression() {
  return `JSON.parse(localStorage.getItem("${DASHBOARD_EVENTS_KEY}") || "[]")`;
}

function visibleToastCountExpression() {
  return `document.querySelectorAll("${VISIBLE_TOAST_SELECTOR}").length`;
}

function createStaticServer(rootDir) {
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = path.resolve(rootDir, relativePath);
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream"
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
}

async function startServer() {
  const server = createStaticServer(ROOT_DIR);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

async function createReadyPage(context, origin) {
  const page = await context.newPage();
  const requestFailures = [];
  const consoleErrors = [];
  page.on("requestfailed", request => {
    requestFailures.push(`${request.method()} ${request.url()} -> ${request.failure()?.errorText || "failed"}`);
  });
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
  await page.waitForFunction(() => !!window.pmMetrics && typeof window.ensureMissionStarted === "function");
  assert(requestFailures.length === 0, `Asset request failures: ${requestFailures.join(" | ")}`);
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);
  return page;
}

async function runIsolatedCase(browser, origin, runCase) {
  const context = await browser.newContext();
  try {
    return await runCase(context, origin);
  } finally {
    await context.close();
  }
}

async function setMissionProgress(page, progress) {
  await page.evaluate((nextProgress) => {
    localStorage.setItem("p00_mission_progress", JSON.stringify(nextProgress));
  }, progress);
}

async function waitForStatTools(page, expectedCount) {
  await page.waitForFunction((count) => {
    return document.getElementById("statTools")?.textContent === count;
  }, String(expectedCount));
}

async function focusStatsExportControl(page) {
  await page.click("#tabStats");
  await page.focus("#exportBtn");
}

async function waitForFocusedStatsExportControl(page, expectedToolCount) {
  await page.waitForFunction((count) => {
    return document.getElementById("statTools")?.textContent === count
      && document.activeElement?.id === "exportBtn"
      && document.getElementById("tabStats")?.getAttribute("aria-selected") === "true"
      && document.getElementById("panelStats")?.hidden === false;
  }, String(expectedToolCount));
}

async function readStatsExportFocusState(page) {
  return page.evaluate(() => ({
    activeElementId: document.activeElement?.id || "",
    statsSelected: document.getElementById("tabStats")?.getAttribute("aria-selected") || "",
    statsHidden: document.getElementById("panelStats")?.hidden,
    statTools: document.getElementById("statTools")?.textContent || ""
  }));
}

async function waitForEthicsModalOpen(page, startLabelIncludes = "") {
  await page.waitForFunction((label) => {
    return document.getElementById("missionModal")?.classList.contains("open")
      && (!label || (document.getElementById("modalStartBtn")?.textContent || "").includes(label));
  }, startLabelIncludes);
}

async function openEthicsModal(page, startLabelIncludes = "") {
  await page.click('.mission-card[data-mission="mission-ethics"]');
  await waitForEthicsModalOpen(page, startLabelIncludes);
}

async function readMissionModalState(page) {
  return page.evaluate(() => ({
    modalOpen: document.getElementById("missionModal")?.classList.contains("open") || false,
    activeElementId: document.activeElement?.id || "",
    activeStep: document.activeElement?.getAttribute("data-step") || "",
    activeClass: document.activeElement?.className || "",
    startLabel: document.getElementById("modalStartBtn")?.textContent || "",
    completedStepCount: document.querySelectorAll("#modalSteps .step-done").length,
    firstStepLinkCount: document.querySelectorAll('#modalSteps .tool-link[data-step="0"]').length
  }));
}

async function waitForMissionModalFocusState(page, { activeElementId = "", activeStep = "", startLabelIncludes = "" } = {}) {
  await page.waitForFunction((expected) => {
    const modalOpen = document.getElementById("missionModal")?.classList.contains("open");
    const activeElement = document.activeElement;
    const startLabel = document.getElementById("modalStartBtn")?.textContent || "";
    if (!modalOpen) return false;
    if (expected.activeElementId && activeElement?.id !== expected.activeElementId) return false;
    if (expected.activeStep && activeElement?.getAttribute("data-step") !== expected.activeStep) return false;
    if (expected.startLabelIncludes && !startLabel.includes(expected.startLabelIncludes)) return false;
    return true;
  }, {
    activeElementId,
    activeStep,
    startLabelIncludes
  });
}

async function sleep(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function installSystemThemeMock(context, initialTheme = "light", options = {}) {
  await context.addInitScript(({ initial, legacyListener }) => {
    const media = "(prefers-color-scheme: dark)";
    const listeners = new Set();
    let matches = initial === "dark";
    let addEventListenerCount = 0;
    let addListenerCount = 0;

    const themeQuery = {
      media,
      get matches() {
        return matches;
      },
      onchange: null,
      addListener(listener) {
        addListenerCount += 1;
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      }
    };
    if (!legacyListener) {
      themeQuery.addEventListener = function (type, listener) {
        if (type === "change") {
          addEventListenerCount += 1;
          listeners.add(listener);
        }
      };
      themeQuery.removeEventListener = function (type, listener) {
        if (type === "change") listeners.delete(listener);
      };
    }

    window.__setMockSystemTheme = (theme) => {
      matches = theme === "dark";
      const event = { matches, media };
      listeners.forEach((listener) => {
        if (typeof listener === "function") {
          listener.call(themeQuery, event);
        } else if (listener && typeof listener.handleEvent === "function") {
          listener.handleEvent(event);
        }
      });
      if (typeof themeQuery.onchange === "function") {
        themeQuery.onchange.call(themeQuery, event);
      }
    };
    window.__readMockSystemThemeRegistration = () => ({
      addEventListenerCount,
      addListenerCount
    });

    window.matchMedia = (query) => {
      if (query === media) return themeQuery;
      const fallbackQuery = {
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {}
      };
      if (!legacyListener) {
        fallbackQuery.addEventListener = function () {};
        fallbackQuery.removeEventListener = function () {};
      }
      return fallbackQuery;
    };
  }, { initial: initialTheme, legacyListener: options.legacyListener === true });
}

async function installNoMatchMedia(context) {
  await context.addInitScript(() => {
    window.matchMedia = undefined;
  });
}

async function installUnreadableThemeStorage(context, seedValue = null) {
  await context.addInitScript((initialValue) => {
    const storageKey = "journalism_toolbox_theme";
    if (initialValue !== null) {
      localStorage.setItem(storageKey, initialValue);
    }
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === storageKey) {
        throw new Error("forced theme getItem failure");
      }
      return originalGetItem.call(this, key);
    };
  }, seedValue);
}

async function readThemeState(page) {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    return {
      theme: document.documentElement.getAttribute("data-theme") || "",
      colorScheme: document.documentElement.style.colorScheme || "",
      buttonLabel: document.getElementById("darkToggleBtn")?.getAttribute("aria-label") || "",
      buttonPressed: document.getElementById("darkToggleBtn")?.getAttribute("aria-pressed") || "",
      themeColor: meta?.getAttribute("content") || "",
      themeColorMedia: meta?.getAttribute("media") || "",
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      storedThemeRaw: (() => {
        try {
          return localStorage.getItem("journalism_toolbox_theme");
        } catch {
          return "__unreadable__";
        }
      })()
    };
  });
}

async function assertCurrentThemeState(page, expected, prefix) {
  const result = await readThemeState(page);
  assertThemeUiState(result, expected, prefix);
  return result;
}

async function waitForTheme(page, expectedTheme) {
  await page.waitForFunction((theme) => {
    return document.documentElement.getAttribute("data-theme") === theme;
  }, expectedTheme);
}

async function setStoredTheme(page, value) {
  await page.evaluate((nextValue) => {
    if (nextValue === null) {
      localStorage.removeItem("journalism_toolbox_theme");
      return;
    }
    localStorage.setItem("journalism_toolbox_theme", nextValue);
  }, value);
}

async function setCrossTabStoredTheme(pageA, pageB, storedTheme, expectedTheme = storedTheme === "dark" ? "dark" : "light") {
  await setStoredTheme(pageA, storedTheme);
  await waitForTheme(pageB, expectedTheme);
}

async function emulateAndReload(pages, colorScheme = "light") {
  await Promise.all(pages.map((page) => page.emulateMedia({ colorScheme })));
  await Promise.all(pages.map((page) => page.reload({ waitUntil: "networkidle" })));
}

async function reloadThemePage(page, { colorScheme = null, storedTheme } = {}) {
  if (colorScheme) {
    await page.emulateMedia({ colorScheme });
  }
  if (storedTheme !== undefined) {
    await setStoredTheme(page, storedTheme);
  }
  await page.reload({ waitUntil: "networkidle" });
}

async function seedCrossTabDarkTheme(pageA, pageB, colorScheme = "light") {
  await emulateAndReload([pageA, pageB], colorScheme);
  await setCrossTabStoredTheme(pageA, pageB, "dark");
}

async function createNoMatchMediaPage(context, origin) {
  await installNoMatchMedia(context);
  return createReadyPage(context, origin);
}

async function createNoMatchMediaPagePair(context, origin) {
  await installNoMatchMedia(context);
  return {
    pageA: await createReadyPage(context, origin),
    pageB: await createReadyPage(context, origin)
  };
}

async function createPagePair(context, origin) {
  return {
    pageA: await createReadyPage(context, origin),
    pageB: await createReadyPage(context, origin)
  };
}

async function installThemeUnreadableProbe(page) {
  await page.evaluate(() => {
    const themeKey = "journalism_toolbox_theme";
    const originalGetItem = Storage.prototype.getItem;
    const originalSetAttribute = Element.prototype.setAttribute;
    let themeWriteCount = 0;
    window.__themeUnreadableProbe = {
      read() {
        return { themeWriteCount };
      },
      restore() {
        Storage.prototype.getItem = originalGetItem;
        Element.prototype.setAttribute = originalSetAttribute;
        delete window.__themeUnreadableProbe;
      }
    };
    Storage.prototype.getItem = function (key) {
      if (key === themeKey) {
        throw new Error("forced unreadable theme key");
      }
      return originalGetItem.call(this, key);
    };
    Element.prototype.setAttribute = function (name, value) {
      const isThemeWrite = (this === document.documentElement && name === "data-theme")
        || (this instanceof HTMLButtonElement && this.id === "darkToggleBtn" && (name === "aria-label" || name === "aria-pressed"))
        || (this instanceof HTMLMetaElement && this.getAttribute("name") === "theme-color" && (name === "content" || name === "media"));
      if (isThemeWrite) themeWriteCount += 1;
      return originalSetAttribute.call(this, name, value);
    };
  });
}

async function readAndRestoreThemeUnreadableProbe(page) {
  const probe = await page.evaluate(() => window.__themeUnreadableProbe?.read?.() || { themeWriteCount: -1 });
  const state = await readThemeState(page);
  await page.evaluate(() => window.__themeUnreadableProbe?.restore?.());
  return { probe, state };
}

async function installThemeWriteProbe(page) {
  await page.evaluate(() => {
    const originalSetAttribute = Element.prototype.setAttribute;
    let themeWriteCount = 0;
    window.__themeWriteProbe = {
      read() {
        return { themeWriteCount };
      },
      restore() {
        Element.prototype.setAttribute = originalSetAttribute;
        delete window.__themeWriteProbe;
      }
    };
    Element.prototype.setAttribute = function (name, value) {
      const isThemeWrite = (this === document.documentElement && name === "data-theme")
        || (this instanceof HTMLButtonElement && this.id === "darkToggleBtn" && (name === "aria-label" || name === "aria-pressed"))
        || (this instanceof HTMLMetaElement && this.getAttribute("name") === "theme-color" && (name === "content" || name === "media"));
      if (isThemeWrite) themeWriteCount += 1;
      return originalSetAttribute.call(this, name, value);
    };
  });
}

async function readAndRestoreThemeWriteProbe(page) {
  const probe = await page.evaluate(() => window.__themeWriteProbe?.read?.() || { themeWriteCount: -1 });
  const state = await readThemeState(page);
  await page.evaluate(() => window.__themeWriteProbe?.restore?.());
  return { probe, state };
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch();
  const results = [];

  try {
    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({ [missionId]: { _started: true } }));

          const originalSetItem = Storage.prototype.setItem;
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };

          Storage.prototype.setItem = function (key, value) {
            if (key === taskKey || key === eventsKey) {
              throw new Error(`forced setItem failure for ${key}`);
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.ensureMissionStarted(missionId);
            window.ensureMissionStarted(missionId);
            return {
              callCount,
              markerRaw: localStorage.getItem(taskKey),
              eventsRaw: localStorage.getItem(eventsKey)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 2, `Dual-failure retry count mismatch: ${result.callCount}`);
        assert(result.markerRaw === null && result.eventsRaw === null, "Dual-failure case persisted unexpected task-start state");
        return { name: "dualFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({ [missionId]: { _started: true } }));

          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };

          try {
            window.ensureMissionStarted(missionId);
            localStorage.removeItem(taskKey);
            localStorage.removeItem(eventsKey);
            localStorage.setItem(progressKey, JSON.stringify({ [missionId]: { _started: true } }));
            window.ensureMissionStarted(missionId);
            return {
              callCount,
              markerRaw: localStorage.getItem(taskKey),
              eventsCount: JSON.parse(localStorage.getItem(eventsKey) || "[]").length
            };
          } finally {
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 2, `Replacement retry count mismatch: ${result.callCount}`);
        assert(!!result.markerRaw && result.eventsCount >= 1, "Replacement case did not recreate task-start state");
        return { name: "replacementCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === eventsKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            const tracked = window.pmMetrics.track("cta_click", { control_id: "probe" });
            return {
              persisted: tracked?.persisted === true,
              eventsRaw: localStorage.getItem(eventsKey)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.persisted === false, `track() did not detect silent event-log write failure: ${JSON.stringify(result)}`);
        assert(result.eventsRaw === null, `Silent event-log write failure unexpectedly changed storage: ${JSON.stringify(result)}`);
        return { name: "metricsSilentWriteFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(eventsKey, "{not-json");
          const tracked = window.pmMetrics.track("cta_click", { control_id: "probe" });
          const summary = window.pmMetrics.getSummary();
          let exportError = "none";
          try {
            window.pmMetrics.exportEvents();
          } catch (error) {
            exportError = error?.message || "unknown";
          }
          return {
            persisted: tracked?.persisted === true,
            rawAfter: localStorage.getItem(eventsKey),
            summary,
            exportError
          };
        });
        assert(result.persisted === false, `track() did not fail when the existing metrics log was structurally corrupt: ${JSON.stringify(result)}`);
        assert(result.rawAfter === "{not-json", `Corrupt existing metrics log was overwritten by a later tracked event: ${JSON.stringify(result)}`);
        assert(result.summary.storage_readable === false && result.summary.total_events === null, `getSummary() did not report corrupt stored events as unreadable: ${JSON.stringify(result.summary)}`);
        assert(result.exportError === "snapshot_failed", `exportEvents() did not stop on corrupt stored events: ${JSON.stringify(result)}`);
        return { name: "metricsCorruptExistingKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify([1]));
          const tracked = window.pmMetrics.track("cta_click", { control_id: "probe" });
          const summary = window.pmMetrics.getSummary();
          let exportError = "none";
          try {
            window.pmMetrics.exportEvents();
          } catch (error) {
            exportError = error?.message || "unknown";
          }
          return {
            persisted: tracked?.persisted === true,
            rawAfter: localStorage.getItem(eventsKey),
            summary,
            exportError
          };
        });
        assert(result.persisted === false, `track() did not fail when the existing metrics log contained invalid array entries: ${JSON.stringify(result)}`);
        assert(result.rawAfter === "[1]", `Invalid existing metrics array was overwritten by a later tracked event: ${JSON.stringify(result)}`);
        assert(result.summary.storage_readable === false && result.summary.total_events === null, `getSummary() did not report invalid metric array entries as unreadable: ${JSON.stringify(result.summary)}`);
        assert(result.exportError === "snapshot_failed", `exportEvents() did not stop on invalid metric array entries: ${JSON.stringify(result)}`);
        return { name: "metricsInvalidArrayExistingKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const originalGetItem = Storage.prototype.getItem;
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "cta_click",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "preexisting",
            app_version: "pm-v1",
            page_path: "/",
            control_id: "before"
          }]));
          window.__pmForceUnreadableMetrics = true;
          Storage.prototype.getItem = function (key) {
            if (key === eventsKey) {
              throw new Error("forced unreadable metrics key");
            }
            return originalGetItem.call(this, key);
          };

          try {
            const tracked = window.pmMetrics.track("cta_click", { control_id: "probe" });
            const summary = window.pmMetrics.getSummary();
            let exportError = "none";
            try {
              window.pmMetrics.exportEvents();
            } catch (error) {
              exportError = error?.message || "unknown";
            }
            return {
              persisted: tracked?.persisted === true,
              rawAfter: originalGetItem.call(localStorage, eventsKey),
              summary,
              exportError
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.persisted === false, `track() did not fail when the existing metrics key was unreadable: ${JSON.stringify(result)}`);
        assert((result.rawAfter || "").includes("\"before\"") && !(result.rawAfter || "").includes("\"probe\""), `Unreadable metrics key should not be overwritten by a later tracked event: ${JSON.stringify(result)}`);
        assert(result.summary.storage_readable === false && result.summary.total_events === null, `getSummary() did not report unreadable stored events as unreadable: ${JSON.stringify(result.summary)}`);
        assert(result.exportError === "snapshot_failed", `exportEvents() did not stop on unreadable stored events: ${JSON.stringify(result)}`);
        return { name: "metricsUnreadableExistingKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === taskKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            const started = window.pmMetrics.markTaskStart("learning_hub_overview_task");
            return {
              markerSet: started?.markerSet === true,
              eventPersisted: started?.eventPersisted === true,
              markerRaw: localStorage.getItem(taskKey),
              eventNames: JSON.parse(localStorage.getItem(eventsKey) || "[]").map(event => event.event_name)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.markerSet === false, `markTaskStart() did not detect silent marker write failure: ${JSON.stringify(result)}`);
        assert(result.eventPersisted === true, `markTaskStart() should still persist the task_start event when only marker write silently fails: ${JSON.stringify(result)}`);
        assert(result.markerRaw === null, `Silent marker write failure unexpectedly changed marker storage: ${JSON.stringify(result)}`);
        assert(result.eventNames.includes("task_start"), `Task-start event was not preserved while marker write silently failed: ${JSON.stringify(result)}`);
        return { name: "taskStartMarkerSilentWriteFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const originalGetItem = Storage.prototype.getItem;
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced unreadable task marker");
            }
            return originalGetItem.call(this, key);
          };

          try {
            const started = window.pmMetrics.markTaskStart("learning_hub_overview_task");
            return {
              markerSet: started?.markerSet === true,
              eventPersisted: started?.eventPersisted === true,
              markerRaw: originalGetItem.call(localStorage, taskKey),
              eventNames: JSON.parse(localStorage.getItem(eventsKey) || "[]").map(event => event.event_name)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.markerSet === false, `markTaskStart() did not fail when the existing marker key was unreadable: ${JSON.stringify(result)}`);
        assert(result.eventPersisted === true, `markTaskStart() should still persist the task_start event when only the existing marker key is unreadable: ${JSON.stringify(result)}`);
        assert(result.markerRaw !== null, `Unreadable task marker should not be overwritten or removed by markTaskStart(): ${JSON.stringify(result)}`);
        assert(result.eventNames.includes("task_start"), `Task-start event was not preserved when the existing marker key was unreadable: ${JSON.stringify(result)}`);
        return { name: "taskStartMarkerUnreadableExistingKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({ [missionId]: { _started: true } }));

          const originalSetItem = Storage.prototype.setItem;
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };

          Storage.prototype.setItem = function (key, value) {
            if (key === taskKey) throw new Error("forced marker failure");
            return originalSetItem.call(this, key, value);
          };

          try {
            window.ensureMissionStarted(missionId);
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            window.ensureMissionStarted(missionId);
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              callCount,
              taskStartEvents: events.filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics").length
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 1, `Unrelated metric retry count mismatch: ${result.callCount}`);
        assert(result.taskStartEvents === 1, `Unrelated metric duplicate task_start count: ${result.taskStartEvents}`);
        return { name: "unrelatedMetricCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();

          const originalSetItem = Storage.prototype.setItem;
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };

          Storage.prototype.setItem = function (key, value) {
            if (key === taskKey) throw new Error("forced marker failure");
            return originalSetItem.call(this, key, value);
          };

          try {
            window.ensureMissionStarted(missionId);
            window.ensureMissionStarted(missionId);
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              callCount,
              progressRaw: localStorage.getItem(progressKey),
              taskStartEvents: events.filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics").length
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 1, `Initial-start retry count mismatch: ${result.callCount}`);
        assert(!!result.progressRaw && result.taskStartEvents === 1, "Initial-start case did not preserve a single task_start");
        return { name: "initialStartCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const otherMissionId = "mission-ai-content";
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({ [missionId]: { _started: true } }));

          const originalSetItem = Storage.prototype.setItem;
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };

          Storage.prototype.setItem = function (key, value) {
            if (key === taskKey) throw new Error("forced marker failure");
            return originalSetItem.call(this, key, value);
          };

          try {
            window.ensureMissionStarted(missionId);
            localStorage.setItem(progressKey, JSON.stringify({
              [missionId]: { _started: true },
              [otherMissionId]: { _started: true }
            }));
            window.ensureMissionStarted(missionId);
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              callCount,
              taskStartEvents: events.filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics").length
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 1, `Unrelated progress retry count mismatch: ${result.callCount}`);
        assert(result.taskStartEvents === 1, `Unrelated progress duplicate task_start count: ${result.taskStartEvents}`);
        return { name: "unrelatedProgressCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const themeKey = "journalism_toolbox_theme";
          localStorage.removeItem(themeKey);

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === themeKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            const beforeTheme = document.documentElement.getAttribute("data-theme") || "";
            document.getElementById("darkToggleBtn")?.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
            const warning = events.find(event => event.event_name === "status_error_signal" && event.status_text === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。");
            return {
              beforeTheme,
              afterTheme: document.documentElement.getAttribute("data-theme") || "",
              storedTheme: localStorage.getItem(themeKey),
              toastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || "",
              warningTracked: !!warning
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.beforeTheme !== result.afterTheme, `Dark toggle did not still update the current page theme after silent preference write failure: ${JSON.stringify(result)}`);
        assert(result.storedTheme === null, `Dark toggle silently persisted theme despite forced no-op write: ${JSON.stringify(result)}`);
        assert(result.toastText === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。", `Dark toggle did not surface the preference write warning toast: ${JSON.stringify(result)}`);
        assert(result.warningTracked === true, `Dark toggle storage warning was not tracked as a status signal: ${JSON.stringify(result)}`);
        return { name: "themePreferenceSilentWriteFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const themeKey = "journalism_toolbox_theme";
          localStorage.removeItem(themeKey);
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === themeKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            document.getElementById("darkToggleBtn")?.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal" || event.event_name === "status_error_signal").map(event => event.status_text),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length,
              visibleToastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || ""
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.statusTexts.filter(text => text === "学习数据已导出").length === 1, `Theme warning should not duplicate a prior tracked toast: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。").length === 1, `Theme warning should record exactly one warning signal: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Theme warning should replace prior visible toasts with a single warning toast: ${JSON.stringify(result)}`);
        assert(result.visibleToastText === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。", `Theme warning did not remain as the only visible toast: ${JSON.stringify(result)}`);
        return { name: "themePreferenceDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const themeKey = "journalism_toolbox_theme";
          localStorage.removeItem(themeKey);
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalReplaceToasts = window.replaceToasts;
          const originalSetItem = Storage.prototype.setItem;
          window.replaceToasts = undefined;
          Storage.prototype.setItem = function (key, value) {
            if (key === themeKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            document.getElementById("darkToggleBtn")?.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal" || event.event_name === "status_error_signal").map(event => event.status_text),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length,
              visibleToastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || ""
            };
          } finally {
            window.replaceToasts = originalReplaceToasts;
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.statusTexts.filter(text => text === "学习数据已导出").length === 1, `Theme warning fallback should not duplicate a prior tracked toast: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。").length === 1, `Theme warning fallback should record exactly one warning signal: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Theme warning fallback should replace prior visible toasts with a single warning toast: ${JSON.stringify(result)}`);
        assert(result.visibleToastText === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。", `Theme warning fallback did not leave the warning as the only visible toast: ${JSON.stringify(result)}`);
        return { name: "themePreferenceFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const themeKey = "journalism_toolbox_theme";
          const originalGetItem = Storage.prototype.getItem;
          localStorage.clear();
          localStorage.setItem(themeKey, "dark");

          Storage.prototype.getItem = function (key) {
            if (key === themeKey) {
              throw new Error("forced unreadable theme key");
            }
            return originalGetItem.call(this, key);
          };

          try {
            const beforeTheme = document.documentElement.getAttribute("data-theme") || "";
            document.getElementById("darkToggleBtn")?.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
            const warning = events.find(event => event.event_name === "status_error_signal" && event.status_text === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。");
            return {
              beforeTheme,
              afterTheme: document.documentElement.getAttribute("data-theme") || "",
              storedThemeRaw: originalGetItem.call(localStorage, themeKey),
              toastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || "",
              warningTracked: !!warning
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.beforeTheme !== result.afterTheme, `Dark toggle did not still update current page theme with unreadable stored preference: ${JSON.stringify(result)}`);
        assert(result.storedThemeRaw === "dark", `Dark toggle overwrote unreadable existing theme storage: ${JSON.stringify(result)}`);
        assert(result.toastText === "主题偏好未写入浏览器存储，刷新后将恢复系统外观。", `Dark toggle did not warn on unreadable existing theme storage: ${JSON.stringify(result)}`);
        assert(result.warningTracked === true, `Unreadable existing theme warning was not tracked as a status signal: ${JSON.stringify(result)}`);
        return { name: "themePreferenceUnreadableExistingKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          function readThemeColorState() {
            const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
            const primary = metas[0];
            return {
              count: metas.length,
              content: primary?.getAttribute("content") || "",
              media: primary?.getAttribute("media") || "",
              bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
              theme: document.documentElement.getAttribute("data-theme") || ""
            };
          }

          const before = readThemeColorState();
          document.getElementById("darkToggleBtn")?.click();
          await new Promise(resolve => setTimeout(resolve, 50));
          const after = readThemeColorState();
          return { before, after };
        });
        assert(result.before.count === 1, `Theme-color init should collapse source meta tags down to one active tag: ${JSON.stringify(result)}`);
        assert(result.before.media === "", `Active theme-color meta should not keep a media attribute after init: ${JSON.stringify(result)}`);
        assert(result.before.content === result.before.bg, `Active theme-color meta did not match the current background token before toggle: ${JSON.stringify(result)}`);
        assert(result.after.count === 1, `Theme-color toggle should keep exactly one active meta tag: ${JSON.stringify(result)}`);
        assert(result.after.media === "", `Active theme-color meta should not regain a media attribute after toggle: ${JSON.stringify(result)}`);
        assert(result.after.theme !== result.before.theme, `Dark toggle did not change the document theme before validating theme-color sync: ${JSON.stringify(result)}`);
        assert(result.after.content === result.after.bg, `Active theme-color meta did not match the current background token after toggle: ${JSON.stringify(result)}`);
        assert(result.after.content !== result.before.content, `Theme-color meta content did not change with the toggled theme: ${JSON.stringify(result)}`);
        return { name: "themeColorMetaSyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        const before = await pageB.locator("#statTools").textContent();
        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);
        await waitForStatTools(pageB, 1);
        const after = await pageB.locator("#statTools").textContent();
        assert(before === "0" && after === "1", `Cross-tab sync mismatch: before=${before} after=${after}`);
        return { name: "crossTabCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await focusStatsExportControl(pageB);
        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);
        await waitForFocusedStatsExportControl(pageB, 1);
        const result = await readStatsExportFocusState(pageB);

        assert(result.activeElementId === "exportBtn", `Cross-tab refresh should restore focus to the previously focused page control: ${JSON.stringify(result)}`);
        assert(result.statsSelected === "true" && result.statsHidden === false, `Cross-tab refresh should preserve the active stats panel while restoring focus: ${JSON.stringify(result)}`);
        assert(result.statTools === "1", `Cross-tab refresh did not apply the incoming storage update before restoring focus: ${JSON.stringify(result)}`);
        return { name: "crossTabFocusRestoreCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);
        await waitForStatTools(pageB, 1);
        await focusStatsExportControl(pageB);

        await pageA.evaluate(() => {
          localStorage.clear();
        });

        await waitForFocusedStatsExportControl(pageB, 0);
        const result = await readStatsExportFocusState(pageB);

        assert(result.activeElementId === "exportBtn", `Cross-tab clear refresh should restore focus to the previously focused page control: ${JSON.stringify(result)}`);
        assert(result.statsSelected === "true" && result.statsHidden === false, `Cross-tab clear refresh should preserve the active stats panel while restoring focus: ${JSON.stringify(result)}`);
        assert(result.statTools === "0", `Cross-tab clear refresh did not apply the null-key storage reset before restoring focus: ${JSON.stringify(result)}`);
        return { name: "crossTabClearFocusRestoreCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await pageB.evaluate(() => {
          const originalRefreshDashboard = window.refreshDashboard;
          let refreshCount = 0;
          window.__refreshProbe = {
            read() {
              return refreshCount;
            },
            restore() {
              window.refreshDashboard = originalRefreshDashboard;
              delete window.__refreshProbe;
            }
          };
          window.refreshDashboard = function (...args) {
            refreshCount += 1;
            return originalRefreshDashboard.apply(this, args);
          };
        });

        await pageA.evaluate(() => {
          localStorage.setItem("unmanaged_probe_key", "1");
        });
        await pageB.waitForTimeout(150);
        const afterUnmanaged = await pageB.evaluate(() => window.__refreshProbe?.read?.() ?? -1);

        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);
        await pageB.waitForFunction(() => (window.__refreshProbe?.read?.() ?? 0) === 1);

        const result = await pageB.evaluate(() => {
          const afterManaged = window.__refreshProbe?.read?.() ?? -1;
          window.__refreshProbe?.restore?.();
          return {
            afterManaged,
            statTools: document.getElementById("statTools")?.textContent || ""
          };
        });

        assert(afterUnmanaged === 0, `Cross-tab storage updates for unrelated keys should not queue a dashboard refresh: ${JSON.stringify({ afterUnmanaged })}`);
        assert(result.afterManaged === 1, `Cross-tab storage updates for managed keys should queue exactly one dashboard refresh: ${JSON.stringify(result)}`);
        assert(result.statTools === "1", `Cross-tab managed-key refresh did not apply the incoming progress update: ${JSON.stringify(result)}`);
        return { name: "crossTabManagedKeyFilterCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const originalRefreshDashboard = window.refreshDashboard;
          let refreshCount = 0;
          window.refreshDashboard = function (...args) {
            refreshCount += 1;
            return originalRefreshDashboard.apply(this, args);
          };

          try {
            window.scheduleDashboardRefresh();
            window.scheduleDashboardRefresh();
            window.dispatchEvent(new Event("focus"));
            document.dispatchEvent(new Event("visibilitychange"));
            await new Promise(resolve => setTimeout(resolve, 50));
            const afterBurst = refreshCount;

            window.scheduleDashboardRefresh();
            await new Promise(resolve => setTimeout(resolve, 50));

            return {
              afterBurst,
              afterSecondFrame: refreshCount
            };
          } finally {
            window.refreshDashboard = originalRefreshDashboard;
          }
        });

        assert(result.afterBurst === 1, `Refresh queue should coalesce same-frame direct, focus, and visibility refresh requests into one render: ${JSON.stringify(result)}`);
        assert(result.afterSecondFrame === 2, `Refresh queue should reset after the queued render so a later refresh can run: ${JSON.stringify(result)}`);
        return { name: "refreshQueueCoalescingCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const originalRefreshDashboard = window.refreshDashboard;
          let refreshCount = 0;
          window.refreshDashboard = function (...args) {
            refreshCount += 1;
            return originalRefreshDashboard.apply(this, args);
          };

          try {
            window.dispatchEvent(new Event("focus"));
            await new Promise(resolve => setTimeout(resolve, 50));
            return { refreshCount };
          } finally {
            window.refreshDashboard = originalRefreshDashboard;
          }
        });

        assert(result.refreshCount === 1, `Focus events should queue exactly one dashboard refresh: ${JSON.stringify(result)}`);
        return { name: "focusRefreshCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const originalRefreshDashboard = window.refreshDashboard;
          let refreshCount = 0;
          let visibilityState = document.visibilityState;
          window.refreshDashboard = function (...args) {
            refreshCount += 1;
            return originalRefreshDashboard.apply(this, args);
          };
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get() {
              return visibilityState;
            }
          });

          try {
            visibilityState = "hidden";
            document.dispatchEvent(new Event("visibilitychange"));
            await new Promise(resolve => setTimeout(resolve, 50));
            const afterHidden = refreshCount;

            visibilityState = "visible";
            document.dispatchEvent(new Event("visibilitychange"));
            await new Promise(resolve => setTimeout(resolve, 50));

            return {
              afterHidden,
              afterVisible: refreshCount
            };
          } finally {
            window.refreshDashboard = originalRefreshDashboard;
            delete document.visibilityState;
          }
        });

        assert(result.afterHidden === 0, `Hidden visibilitychange events should not queue a dashboard refresh: ${JSON.stringify(result)}`);
        assert(result.afterVisible === 1, `Visible visibilitychange events should queue exactly one dashboard refresh: ${JSON.stringify(result)}`);
        return { name: "visibilityRefreshGuardCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const missionsTab = page.locator("#tabMissions");
        await missionsTab.focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Home");
        await page.keyboard.press("End");

        const result = await page.evaluate(() => ({
          activeElementId: document.activeElement?.id || "",
          missionsSelected: document.getElementById("tabMissions")?.getAttribute("aria-selected") || "",
          modulesSelected: document.getElementById("tabModules")?.getAttribute("aria-selected") || "",
          statsSelected: document.getElementById("tabStats")?.getAttribute("aria-selected") || "",
          missionsTabIndex: document.getElementById("tabMissions")?.tabIndex,
          modulesTabIndex: document.getElementById("tabModules")?.tabIndex,
          statsTabIndex: document.getElementById("tabStats")?.tabIndex,
          missionsHidden: document.getElementById("panelMissions")?.hidden,
          modulesHidden: document.getElementById("panelModules")?.hidden,
          statsHidden: document.getElementById("panelStats")?.hidden
        }));
        assert(result.activeElementId === "tabStats", `Tab keyboard navigation should leave focus on the final active tab: ${JSON.stringify(result)}`);
        assert(result.missionsSelected === "false" && result.modulesSelected === "false" && result.statsSelected === "true", `Tab keyboard navigation did not update aria-selected states correctly: ${JSON.stringify(result)}`);
        assert(result.missionsTabIndex === -1 && result.modulesTabIndex === -1 && result.statsTabIndex === 0, `Tab keyboard navigation did not update tabindex states correctly: ${JSON.stringify(result)}`);
        assert(result.missionsHidden === true && result.modulesHidden === true && result.statsHidden === false, `Tab keyboard navigation did not toggle the tab panels correctly: ${JSON.stringify(result)}`);
        return { name: "tabKeyboardNavigationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.focus('.mission-card[data-mission="mission-ethics"]');
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.getElementById("missionModal")?.classList.contains("open"));

        const result = await page.evaluate(async () => {
          const modal = document.getElementById("missionModal");
          const modalClose = document.getElementById("modalClose");
          const modalReset = document.getElementById("modalResetBtn");
          const modalStart = document.getElementById("modalStartBtn");

          const initialFocusId = document.activeElement?.id || "";

          modalClose?.focus();
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey: true }));
          const afterShiftTabId = document.activeElement?.id || "";

          modalReset?.focus();
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
          const afterTabId = document.activeElement?.id || "";

          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
          await new Promise(resolve => setTimeout(resolve, 20));

          return {
            initialFocusId,
            afterShiftTabId,
            afterTabId,
            modalOpenAfterEscape: modal?.classList.contains("open") || false,
            modalAriaHidden: modal?.getAttribute("aria-hidden") || "",
            restoredFocusMission: document.activeElement?.getAttribute("data-mission") || "",
            restoredFocusRole: document.activeElement?.getAttribute("role") || ""
          };
        });
        assert(result.initialFocusId === "modalClose", `Opening the mission modal should focus the close button first: ${JSON.stringify(result)}`);
        assert(result.afterShiftTabId === "modalResetBtn", `Shift+Tab at the first modal control should wrap focus to the last focusable control: ${JSON.stringify(result)}`);
        assert(result.afterTabId === "modalClose", `Tab at the last modal control should wrap focus back to the first focusable control: ${JSON.stringify(result)}`);
        assert(result.modalOpenAfterEscape === false, `Escape should close the mission modal: ${JSON.stringify(result)}`);
        assert(result.modalAriaHidden === "true", `Closing the mission modal should restore aria-hidden=true: ${JSON.stringify(result)}`);
        assert(result.restoredFocusMission === "mission-ethics" && result.restoredFocusRole === "button", `Closing the mission modal should restore focus to the launching mission card: ${JSON.stringify(result)}`);
        return { name: "missionModalFocusManagementCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.focus('.mission-card[data-mission="mission-ethics"]');
        await page.keyboard.press("Space");
        await page.waitForFunction(() => document.getElementById("missionModal")?.classList.contains("open"));
        const result = await page.evaluate(() => ({
          modalOpen: document.getElementById("missionModal")?.classList.contains("open") || false,
          modalAriaHidden: document.getElementById("missionModal")?.getAttribute("aria-hidden") || "",
          modalTitle: document.getElementById("modalTitle")?.textContent || ""
        }));
        assert(result.modalOpen === true && result.modalAriaHidden === "false", `Space activation on a mission card should open the modal: ${JSON.stringify(result)}`);
        assert(result.modalTitle.includes("灾难报道中的伦理抉择"), `Space activation on a mission card opened the wrong mission modal: ${JSON.stringify(result)}`);
        return { name: "missionCardSpaceActivationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.click('.mission-card[data-mission="mission-ethics"]');
        await page.waitForFunction(() => document.getElementById("missionModal")?.classList.contains("open"));
        const closeButtonResult = await page.evaluate(async () => {
          document.getElementById("modalClose")?.click();
          await new Promise(resolve => setTimeout(resolve, 20));
          const modal = document.getElementById("missionModal");
          return {
            modalOpen: modal?.classList.contains("open") || false,
            modalAriaHidden: modal?.getAttribute("aria-hidden") || "",
            restoredFocusMission: document.activeElement?.getAttribute("data-mission") || "",
            restoredFocusRole: document.activeElement?.getAttribute("role") || ""
          };
        });

        await page.click('.mission-card[data-mission="mission-ethics"]');
        await page.waitForFunction(() => document.getElementById("missionModal")?.classList.contains("open"));
        const backdropResult = await page.evaluate(async () => {
          document.getElementById("missionModal")?.click();
          await new Promise(resolve => setTimeout(resolve, 20));
          const modal = document.getElementById("missionModal");
          return {
            modalOpen: modal?.classList.contains("open") || false,
            modalAriaHidden: modal?.getAttribute("aria-hidden") || "",
            restoredFocusMission: document.activeElement?.getAttribute("data-mission") || "",
            restoredFocusRole: document.activeElement?.getAttribute("role") || ""
          };
        });

        assert(closeButtonResult.modalOpen === false && closeButtonResult.modalAriaHidden === "true", `Close button should close the mission modal: ${JSON.stringify(closeButtonResult)}`);
        assert(closeButtonResult.restoredFocusMission === "mission-ethics" && closeButtonResult.restoredFocusRole === "button", `Close button should restore focus to the launching mission card: ${JSON.stringify(closeButtonResult)}`);
        assert(backdropResult.modalOpen === false && backdropResult.modalAriaHidden === "true", `Backdrop click should close the mission modal: ${JSON.stringify(backdropResult)}`);
        assert(backdropResult.restoredFocusMission === "mission-ethics" && backdropResult.restoredFocusRole === "button", `Backdrop click should restore focus to the launching mission card: ${JSON.stringify(backdropResult)}`);
        return { name: "missionModalCloseControlsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const mission = MISSIONS.find((item) => item.id === missionId);
          const buildSnapshot = () => ({
            title: document.getElementById("modalTitle")?.textContent || "",
            desc: document.getElementById("modalDesc")?.textContent || "",
            badge: document.getElementById("modalBadge")?.textContent || "",
            startLabel: document.getElementById("modalStartBtn")?.textContent || ""
          });

          localStorage.clear();
          window.openMissionModal(missionId);
          const notStarted = buildSnapshot();

          window.saveProgress({
            [missionId]: { _started: true, step0: true }
          });
          window.openMissionModal(missionId);
          const inProgress = buildSnapshot();

          const completedState = { _started: true };
          mission?.steps?.forEach((_, index) => {
            completedState["step" + index] = true;
          });
          window.saveProgress({
            [missionId]: completedState
          });
          window.openMissionModal(missionId);
          const completed = buildSnapshot();

          return {
            expectedTitle: `${mission?.emoji || ""} ${mission?.title || ""}`.trim(),
            expectedDesc: mission?.desc || "",
            expectedBadge: `${mission?.difficulty || ""} · ${mission?.time || ""}`.trim(),
            notStarted,
            inProgress,
            completed
          };
        });
        assert(result.notStarted.title === result.expectedTitle && result.inProgress.title === result.expectedTitle && result.completed.title === result.expectedTitle, `Mission modal title drifted from mission metadata across progress states: ${JSON.stringify(result)}`);
        assert(result.notStarted.desc === result.expectedDesc && result.inProgress.desc === result.expectedDesc && result.completed.desc === result.expectedDesc, `Mission modal description drifted from mission metadata across progress states: ${JSON.stringify(result)}`);
        assert(result.notStarted.badge === result.expectedBadge && result.inProgress.badge === result.expectedBadge && result.completed.badge === result.expectedBadge, `Mission modal badge drifted from mission metadata across progress states: ${JSON.stringify(result)}`);
        assert(result.notStarted.startLabel === "🚀 开始任务", `Mission modal should invite the first launch when no steps are complete: ${JSON.stringify(result.notStarted)}`);
        assert(result.inProgress.startLabel === "▶ 继续任务（第 2 步）", `Mission modal should point to the next incomplete step for in-progress missions: ${JSON.stringify(result.inProgress)}`);
        assert(result.completed.startLabel === "↺ 重新打开第 1 步", `Mission modal should offer reopening from step 1 when all steps are complete: ${JSON.stringify(result.completed)}`);
        return { name: "missionModalCopyStatesCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const mission = MISSIONS.find((item) => item.id === missionId);

          localStorage.clear();
          window.saveProgress({
            [missionId]: { _started: true, step0: true }
          });
          window.openMissionModal(missionId);
          const partial = {
            firstStepDone: document.querySelector('#modalSteps .step-item:nth-child(1)')?.classList.contains("step-done") || false,
            firstStepNum: document.querySelector('#modalSteps .step-item:nth-child(1) .step-num')?.textContent?.trim() || "",
            firstStepLinkCount: document.querySelectorAll('#modalSteps .tool-link[data-step="0"]').length,
            secondStepLinkCount: document.querySelectorAll('#modalSteps .tool-link[data-step="1"]').length
          };

          const completeState = { _started: true };
          mission?.steps?.forEach((_, index) => {
            completeState["step" + index] = true;
          });
          window.saveProgress({
            [missionId]: completeState
          });
          window.openMissionModal(missionId);
          const complete = {
            doneCount: document.querySelectorAll('#modalSteps .step-item.step-done').length,
            toolLinkCount: document.querySelectorAll('#modalSteps .tool-link').length
          };

          return {
            totalSteps: mission?.steps?.length || 0,
            partial,
            complete
          };
        });
        assert(result.partial.firstStepDone === true, `Completed steps in the mission modal should render with step-done styling: ${JSON.stringify(result.partial)}`);
        assert(result.partial.firstStepNum === "✓", `Completed steps in the mission modal should replace the step number with a checkmark: ${JSON.stringify(result.partial)}`);
        assert(result.partial.firstStepLinkCount === 0, `Completed mission-modal steps should not keep their open-tool links: ${JSON.stringify(result.partial)}`);
        assert(result.partial.secondStepLinkCount === 1, `Incomplete mission-modal steps should still render their open-tool links: ${JSON.stringify(result.partial)}`);
        assert(result.complete.doneCount === result.totalSteps, `Completed missions should render every mission-modal step as done: ${JSON.stringify(result.complete)}`);
        assert(result.complete.toolLinkCount === 0, `Completed missions should remove all mission-modal tool links: ${JSON.stringify(result.complete)}`);
        return { name: "missionModalStepRenderingCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const originalOpen = window.open;
          let openedUrl = "";
          window.open = (url) => {
            openedUrl = String(url || "");
            return { opener: null };
          };

          try {
            window.saveProgress({
              [missionId]: { _started: true, step0: true }
            });
            window.openMissionModal(missionId);
            const beforeLabel = document.getElementById("modalStartBtn")?.textContent || "";
            document.getElementById("modalStartBtn")?.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            const progress = JSON.parse(localStorage.getItem("p00_mission_progress") || "{}");
            return {
              beforeLabel,
              openedUrl,
              missionState: progress[missionId] || {}
            };
          } finally {
            window.open = originalOpen;
          }
        });
        assert(result.beforeLabel === "▶ 继续任务（第 2 步）", `Mission modal start button should announce the next incomplete step before resuming: ${JSON.stringify(result)}`);
        assert(result.openedUrl.endsWith("/P27-privacy-clause-highlighter/"), `Mission modal start button should open the next incomplete tool, not the first step again: ${JSON.stringify(result)}`);
        assert(result.missionState.step0 === true && result.missionState.step1 === true, `Mission modal start button should mark the resumed step as complete after opening it: ${JSON.stringify(result)}`);
        return { name: "missionModalStartResumesNextStepCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const mission = MISSIONS.find((item) => item.id === missionId);
          const completeState = { _started: true };
          mission?.steps?.forEach((_, index) => {
            completeState["step" + index] = true;
          });

          const originalOpen = window.open;
          let openedUrl = "";
          window.open = (url) => {
            openedUrl = String(url || "");
            return { opener: null };
          };

          try {
            window.saveProgress({
              [missionId]: completeState
            });
            window.openMissionModal(missionId);
            const beforeLabel = document.getElementById("modalStartBtn")?.textContent || "";
            document.getElementById("modalStartBtn")?.click();
            await new Promise(resolve => setTimeout(resolve, 50));
            const progress = JSON.parse(localStorage.getItem("p00_mission_progress") || "{}");
            return {
              beforeLabel,
              openedUrl,
              missionState: progress[missionId] || {}
            };
          } finally {
            window.open = originalOpen;
          }
        });
        assert(result.beforeLabel === "↺ 重新打开第 1 步", `Completed mission modal start button should announce reopening from step 1: ${JSON.stringify(result)}`);
        assert(result.openedUrl.endsWith("/P31-ethics-avg/"), `Completed mission modal start button should reopen the first step tool: ${JSON.stringify(result)}`);
        assert(result.missionState.step0 === true && result.missionState.step1 === true && result.missionState.step2 === true, `Completed mission modal start button should not clear or corrupt the completed mission progress state: ${JSON.stringify(result)}`);
        return { name: "missionModalStartReopensFirstStepCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const mission = MISSIONS.find((item) => item.id === missionId);
          const totalSteps = mission?.steps?.length || 0;

          function snapshot() {
            const card = document.querySelector(`.mission-card[data-mission="${missionId}"]`);
            const metaText = card?.querySelector(".mc-meta")?.textContent || "";
            const progressFill = card?.querySelector(".mc-bar-fill");
            return {
              isComplete: card?.classList.contains("mc-complete") || false,
              progressText: metaText.replace(/\s+/g, " "),
              progressWidth: progressFill instanceof HTMLElement ? progressFill.style.width : ""
            };
          }

          localStorage.clear();
          window.refreshDashboard();
          const empty = snapshot();

          const partialState = { _started: true };
          if (totalSteps > 0) {
            partialState.step0 = true;
          }
          window.saveProgress({ [missionId]: partialState });
          window.refreshDashboard();
          const partial = snapshot();

          const completeState = { _started: true };
          mission?.steps?.forEach((_, index) => {
            completeState["step" + index] = true;
          });
          window.saveProgress({ [missionId]: completeState });
          window.refreshDashboard();
          const complete = snapshot();

          return { totalSteps, empty, partial, complete };
        });
        assert(result.empty.isComplete === false, `Fresh mission card should not render as complete: ${JSON.stringify(result.empty)}`);
        assert(result.empty.progressText.includes(`0/${result.totalSteps} 步骤`), `Fresh mission card should show zero completed steps: ${JSON.stringify(result.empty)}`);
        assert(result.empty.progressWidth === "0%", `Fresh mission card should start at 0% progress width: ${JSON.stringify(result.empty)}`);
        assert(result.partial.isComplete === false, `Partial mission card should not render as complete: ${JSON.stringify(result.partial)}`);
        assert(result.partial.progressText.includes(`1/${result.totalSteps} 步骤`), `Partial mission card should show one completed step: ${JSON.stringify(result.partial)}`);
        assert(result.partial.progressWidth === `${Math.round((1 / result.totalSteps) * 100)}%`, `Partial mission card progress width mismatch: ${JSON.stringify(result.partial)}`);
        assert(result.complete.isComplete === true, `Completed mission card should render with mc-complete styling: ${JSON.stringify(result.complete)}`);
        assert(result.complete.progressText.includes(`${result.totalSteps}/${result.totalSteps} 步骤`), `Completed mission card should show all steps complete: ${JSON.stringify(result.complete)}`);
        assert(result.complete.progressWidth === "100%", `Completed mission card should render 100% progress width: ${JSON.stringify(result.complete)}`);
        return { name: "missionCardProgressStateCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.focus('.mission-card[data-mission="mission-ethics"]');
        const result = await page.evaluate(() => {
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            "mission-ethics": { _started: true, step0: true }
          }));
          window.refreshDashboard();
          return {
            activeMission: document.activeElement?.getAttribute("data-mission") || "",
            activeRole: document.activeElement?.getAttribute("role") || ""
          };
        });
        assert(result.activeMission === "mission-ethics" && result.activeRole === "button", `Dashboard refresh should restore focus to the previously focused mission card: ${JSON.stringify(result)}`);
        return { name: "pageFocusRestoreCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.click("#tabStats");
        await page.focus("#tabStats");
        const result = await page.evaluate(() => {
          window.refreshDashboard();
          return {
            activeElementId: document.activeElement?.id || "",
            statsSelected: document.getElementById("tabStats")?.getAttribute("aria-selected") || "",
            statsTabIndex: document.getElementById("tabStats")?.tabIndex,
            statsHidden: document.getElementById("panelStats")?.hidden
          };
        });
        assert(result.activeElementId === "tabStats", `Dashboard refresh should restore focus to the previously focused active tab: ${JSON.stringify(result)}`);
        assert(result.statsSelected === "true" && result.statsTabIndex === 0 && result.statsHidden === false, `Dashboard refresh should preserve the active stats tab state while restoring focus: ${JSON.stringify(result)}`);
        return { name: "tabFocusRestoreCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.activateTab(document.getElementById("tabModules"));
          await new Promise(resolve => setTimeout(resolve, 0));
          const toolLink = document.querySelector('.tool-link[data-tool-id="P01"]');
          if (toolLink instanceof HTMLElement) {
            toolLink.focus();
          }
          window.refreshDashboard();
          return {
            activeElementToolId: document.activeElement?.getAttribute("data-tool-id") || "",
            activeElementClass: document.activeElement?.className || "",
            modulesSelected: document.getElementById("tabModules")?.getAttribute("aria-selected") || "",
            modulesHidden: document.getElementById("panelModules")?.hidden
          };
        });
        assert(result.activeElementToolId === "P01" && String(result.activeElementClass).includes("tool-link"), `Dashboard refresh should restore focus to the previously focused module tool link: ${JSON.stringify(result)}`);
        assert(result.modulesSelected === "true" && result.modulesHidden === false, `Dashboard refresh should keep the modules panel active while restoring tool-link focus: ${JSON.stringify(result)}`);
        return { name: "toolLinkFocusRestoreCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.click("#tabStats");
        await page.focus("#exportBtn");
        const result = await page.evaluate(() => {
          window.refreshDashboard();
          return {
            activeElementId: document.activeElement?.id || "",
            statsSelected: document.getElementById("tabStats")?.getAttribute("aria-selected") || "",
            statsHidden: document.getElementById("panelStats")?.hidden
          };
        });
        assert(result.activeElementId === "exportBtn", `Dashboard refresh should restore focus to the previously focused id-based control: ${JSON.stringify(result)}`);
        assert(result.statsSelected === "true" && result.statsHidden === false, `Dashboard refresh should keep the stats panel active while restoring export button focus: ${JSON.stringify(result)}`);
        return { name: "idFocusRestoreCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.focus('.footer a[href="https://github.com/Yuuqq"]');
        const result = await page.evaluate(() => {
          window.refreshDashboard();
          return {
            activeTag: document.activeElement?.tagName || "",
            activeHref: document.activeElement?.getAttribute("href") || ""
          };
        });
        assert(result.activeTag === "A" && result.activeHref === "https://github.com/Yuuqq", `Dashboard refresh should restore focus to the previously focused generic anchor: ${JSON.stringify(result)}`);
        return { name: "anchorFocusRestoreCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await openEthicsModal(page);
        await page.evaluate(() => {
          const stepLink = document.querySelector('.tool-link[data-step="0"]');
          if (stepLink instanceof HTMLElement) {
            stepLink.focus();
          }
          window.refreshDashboard();
        });
        await sleep();
        const result = await readMissionModalState(page);
        assert(result.modalOpen === true, `Dashboard refresh should keep the mission modal open when currentMission is active: ${JSON.stringify(result)}`);
        assert(result.activeStep === "0" && String(result.activeClass).includes("tool-link"), `Dashboard refresh should preserve focus within the modal via the step-link token: ${JSON.stringify(result)}`);
        return { name: "modalFocusPreservationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await openEthicsModal(page);
        await page.evaluate(() => {
          const missionId = "mission-ethics";
          const progressKey = "p00_mission_progress";
          const stepLink = document.querySelector('.tool-link[data-step="0"]');
          if (stepLink instanceof HTMLElement) {
            stepLink.focus();
          }
          localStorage.setItem(progressKey, JSON.stringify({
            [missionId]: { _started: true, step0: true }
          }));
          window.refreshDashboard();
        });
        await sleep();
        const result = await readMissionModalState(page);
        assert(result.modalOpen === true, `Dashboard refresh should keep the mission modal open when the focused step link disappears: ${JSON.stringify(result)}`);
        assert(result.activeElementId === "modalClose", `Dashboard refresh should fall back to the modal close button when the focused step link no longer exists: ${JSON.stringify(result)}`);
        assert(result.startLabel.includes("继续任务（第 2 步）"), `Dashboard refresh did not re-render the modal start label after step completion removed the focused link: ${JSON.stringify(result)}`);
        assert(result.completedStepCount === 1, `Dashboard refresh did not update modal step completion before resolving focus fallback: ${JSON.stringify(result)}`);
        assert(result.firstStepLinkCount === 0, `Completed modal step should no longer expose its tool link after refresh: ${JSON.stringify(result)}`);
        return { name: "modalFocusFallbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await openEthicsModal(pageB);
        await pageB.focus('.tool-link[data-step="0"]');

        await pageA.evaluate(() => {
          window.pmMetrics.track("cta_click", { control_id: "probe" });
        });

        await sleep(150);
        await waitForMissionModalFocusState(pageB, { activeStep: "0", startLabelIncludes: "开始任务" });
        const result = await readMissionModalState(pageB);

        assert(result.modalOpen === true, `Cross-tab refresh should keep the mission modal open while a focused step link remains valid: ${JSON.stringify(result)}`);
        assert(result.activeStep === "0" && String(result.activeClass).includes("tool-link"), `Cross-tab refresh should preserve focus within the modal via the step-link token when the link still exists: ${JSON.stringify(result)}`);
        assert(result.startLabel.includes("开始任务"), `Cross-tab refresh should not alter the mission modal progress copy when unrelated managed storage changes: ${JSON.stringify(result)}`);
        return { name: "crossTabModalStepLinkPreservationCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await openEthicsModal(pageB);
        await pageB.focus('.tool-link[data-step="0"]');

        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);

        await waitForMissionModalFocusState(pageB, { activeElementId: "modalClose", startLabelIncludes: "继续任务（第 2 步）" });
        const result = await readMissionModalState(pageB);

        assert(result.modalOpen === true, `Cross-tab refresh should keep the mission modal open when the focused step link disappears: ${JSON.stringify(result)}`);
        assert(result.activeElementId === "modalClose", `Cross-tab refresh should fall back to the modal close button when the focused step link no longer exists after storage sync: ${JSON.stringify(result)}`);
        assert(result.startLabel.includes("继续任务（第 2 步）"), `Cross-tab refresh did not re-render the modal start label after storage sync completed the focused step: ${JSON.stringify(result)}`);
        assert(result.completedStepCount === 1, `Cross-tab refresh did not update modal completion state before resolving focus fallback: ${JSON.stringify(result)}`);
        assert(result.firstStepLinkCount === 0, `Cross-tab refresh should remove the completed step link before resolving modal focus fallback: ${JSON.stringify(result)}`);
        return { name: "crossTabModalStepLinkFallbackCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await openEthicsModal(pageB);
        await pageB.focus("#modalResetBtn");

        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);

        await waitForMissionModalFocusState(pageB, { activeElementId: "modalResetBtn", startLabelIncludes: "继续任务（第 2 步）" });
        const result = await readMissionModalState(pageB);

        assert(result.modalOpen === true, `Cross-tab refresh should keep the mission modal open while currentMission is active: ${JSON.stringify(result)}`);
        assert(result.activeElementId === "modalResetBtn", `Cross-tab refresh should preserve focus within the modal on stable controls: ${JSON.stringify(result)}`);
        assert(result.startLabel.includes("继续任务（第 2 步）"), `Cross-tab refresh did not re-render modal progress state from the incoming storage update: ${JSON.stringify(result)}`);
        assert(result.completedStepCount === 1, `Cross-tab refresh did not update the modal step completion state: ${JSON.stringify(result)}`);
        return { name: "crossTabModalFocusPreservationCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await setMissionProgress(pageA, ETHICS_STEP_0_PROGRESS);
        await waitForStatTools(pageB, 1);
        await openEthicsModal(pageB, "继续任务（第 2 步）");
        await pageB.focus("#modalResetBtn");

        await pageA.evaluate(() => {
          localStorage.clear();
        });

        await waitForMissionModalFocusState(pageB, { activeElementId: "modalResetBtn", startLabelIncludes: "开始任务" });
        const result = await readMissionModalState(pageB);

        assert(result.modalOpen === true, `Cross-tab clear should keep the mission modal open while currentMission is active: ${JSON.stringify(result)}`);
        assert(result.activeElementId === "modalResetBtn", `Cross-tab clear should preserve focus within the modal on stable controls: ${JSON.stringify(result)}`);
        assert(result.startLabel.includes("开始任务"), `Cross-tab clear did not reset the modal start label back to the empty progress state: ${JSON.stringify(result)}`);
        assert(result.completedStepCount === 0, `Cross-tab clear did not remove completed modal steps after storage reset: ${JSON.stringify(result)}`);
        assert(result.firstStepLinkCount === 1, `Cross-tab clear did not restore the first modal tool link after resetting progress: ${JSON.stringify(result)}`);
        return { name: "crossTabModalClearResetCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await setCrossTabStoredTheme(pageA, pageB, "light");
        await setCrossTabStoredTheme(pageA, pageB, "dark");

        await assertCurrentThemeState(pageB, darkThemeExpectation(), "Cross-tab theme sync");
        return { name: "crossTabThemeSyncCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await seedCrossTabDarkTheme(pageA, pageB);

        await setCrossTabStoredTheme(pageA, pageB, null);

        await assertCurrentThemeState(pageB, lightThemeExpectation(), "Cross-tab theme reset");
        return { name: "crossTabThemeResetCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await seedCrossTabDarkTheme(pageA, pageB);

        await pageA.evaluate(() => {
          localStorage.clear();
        });
        await waitForTheme(pageB, "light");

        await assertCurrentThemeState(pageB, lightThemeExpectation(null), "Cross-tab theme clear");
        return { name: "crossTabThemeClearResetCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const pageA = await createReadyPage(context, origin);
      const pageB = await createReadyPage(context, origin);
      try {
        await seedCrossTabDarkTheme(pageA, pageB);

        await setCrossTabStoredTheme(pageA, pageB, "sepia");

        await assertCurrentThemeState(pageB, lightThemeExpectation("sepia"), "Cross-tab invalid theme storage");
        return { name: "crossTabInvalidThemeFallbackCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await reloadThemePage(page, { colorScheme: "light", storedTheme: "sepia" });
        await assertCurrentThemeState(page, lightThemeExpectation("sepia"), "Startup invalid theme storage");
        return { name: "startupInvalidThemeFallbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await reloadThemePage(page, { colorScheme: "light", storedTheme: "dark" });
        await assertCurrentThemeState(page, darkThemeExpectation("dark"), "Startup stored theme");
        return { name: "startupStoredThemeOverrideCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await installUnreadableThemeStorage(context, "dark");
      const page = await createReadyPage(context, origin);
      try {
        await reloadThemePage(page, { colorScheme: "light" });
        await assertCurrentThemeState(page, lightThemeExpectation("__unreadable__"), "Startup unreadable theme storage");
        return { name: "startupUnreadableThemeFallbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createNoMatchMediaPage(context, origin);
      try {
        await assertCurrentThemeState(page, lightThemeExpectation(null), "No-matchMedia startup");
        return { name: "noMatchMediaStartupCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createNoMatchMediaPage(context, origin);
      try {
        await reloadThemePage(page, { storedTheme: "sepia" });
        await assertCurrentThemeState(page, lightThemeExpectation("sepia"), "No-matchMedia invalid theme storage");
        return { name: "noMatchMediaInvalidThemeFallbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await installNoMatchMedia(context);
      await installUnreadableThemeStorage(context, "dark");
      const page = await createReadyPage(context, origin);
      try {
        await page.reload({ waitUntil: "networkidle" });
        await assertCurrentThemeState(page, lightThemeExpectation("__unreadable__"), "No-matchMedia unreadable theme storage");
        return { name: "noMatchMediaUnreadableThemeFallbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createNoMatchMediaPage(context, origin);
      try {
        await reloadThemePage(page, { storedTheme: "dark" });
        await assertCurrentThemeState(page, darkThemeExpectation("dark"), "No-matchMedia pinned theme");
        return { name: "noMatchMediaPinnedThemeCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createNoMatchMediaPagePair(context, origin);
      try {
        await setCrossTabStoredTheme(pageA, pageB, "light");
        await setCrossTabStoredTheme(pageA, pageB, "dark");

        await assertCurrentThemeState(pageB, darkThemeExpectation("dark"), "No-matchMedia cross-tab theme sync");
        return { name: "noMatchMediaCrossTabThemeSyncCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createNoMatchMediaPagePair(context, origin);
      try {
        await setCrossTabStoredTheme(pageA, pageB, "dark");
        await setCrossTabStoredTheme(pageA, pageB, null);

        await assertCurrentThemeState(pageB, lightThemeExpectation(null), "No-matchMedia cross-tab theme reset");
        return { name: "noMatchMediaCrossTabThemeResetCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createNoMatchMediaPagePair(context, origin);
      try {
        await setStoredTheme(pageA, "dark");
        await waitForTheme(pageB, "dark");

        await pageA.evaluate(() => {
          localStorage.clear();
        });
        await waitForTheme(pageB, "light");

        await assertCurrentThemeState(pageB, lightThemeExpectation(null), "No-matchMedia cross-tab theme clear");
        return { name: "noMatchMediaCrossTabClearCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createNoMatchMediaPagePair(context, origin);
      try {
        await setCrossTabStoredTheme(pageA, pageB, "dark");
        await setCrossTabStoredTheme(pageA, pageB, "sepia");

        await assertCurrentThemeState(pageB, lightThemeExpectation("sepia"), "No-matchMedia cross-tab invalid theme storage");
        return { name: "noMatchMediaCrossTabInvalidThemeCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createPagePair(context, origin);
      try {
        await installThemeUnreadableProbe(pageB);
        await setStoredTheme(pageA, "dark");
        await pageB.waitForTimeout(150);

        const { probe, state } = await readAndRestoreThemeUnreadableProbe(pageB);

        assert(probe.themeWriteCount > 0, `Cross-tab unreadable theme storage should still trigger theme reapplication writes in the receiving tab: ${JSON.stringify({ probe, state })}`);
        assertThemeUiState(state, lightThemeExpectation("__unreadable__"), "Cross-tab unreadable theme storage");
        return { name: "crossTabUnreadableThemeFallbackCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createNoMatchMediaPagePair(context, origin);
      try {
        await installThemeUnreadableProbe(pageB);
        await setStoredTheme(pageA, "dark");
        await pageB.waitForTimeout(150);

        const { probe, state } = await readAndRestoreThemeUnreadableProbe(pageB);

        assert(probe.themeWriteCount > 0, `No-matchMedia cross-tab unreadable theme storage should still trigger theme reapplication writes in the receiving tab: ${JSON.stringify({ probe, state })}`);
        assertThemeUiState(state, lightThemeExpectation("__unreadable__"), "No-matchMedia cross-tab unreadable theme storage");
        return { name: "noMatchMediaCrossTabUnreadableThemeCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const { pageA, pageB } = await createPagePair(context, origin);
      try {
        await seedCrossTabDarkTheme(pageA, pageB, "light");

        await installThemeWriteProbe(pageB);

        await pageA.evaluate(() => {
          localStorage.setItem("unrelated_theme_probe_key", "1");
        });
        await pageB.waitForTimeout(150);

        const { probe, state } = await readAndRestoreThemeWriteProbe(pageB);

        assert(probe.themeWriteCount === 0, `Cross-tab unrelated storage updates should not trigger dark-toggle theme writes: ${JSON.stringify({ probe, state })}`);
        assertThemeUiState(state, darkThemeExpectation("dark"), "Cross-tab unrelated storage updates");
        return { name: "crossTabThemeIgnoresUnrelatedStorageCase", status: "passed" };
      } finally {
        await pageA.close();
        await pageB.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await installSystemThemeMock(context, "light");
      const page = await createReadyPage(context, origin);
      try {
        const before = await readThemeState(page);
        await page.evaluate(() => {
          window.__setMockSystemTheme?.("dark");
        });
        await waitForTheme(page, "dark");
        const result = await readThemeState(page);
        assert(before.theme === "light" && before.storedThemeRaw === null, `Mocked system-theme setup should start in light mode without a stored preference: ${JSON.stringify(before)}`);
        assertThemeUiState(result, darkThemeExpectation(null), "System theme changes");
        return { name: "systemThemeFollowCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await installSystemThemeMock(context, "dark");
      const page = await createReadyPage(context, origin);
      try {
        const result = await readThemeState(page);
        assertThemeUiState(result, darkThemeExpectation(null), "Startup system dark theme");
        return { name: "startupSystemDarkThemeCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await installSystemThemeMock(context, "light", { legacyListener: true });
      const page = await createReadyPage(context, origin);
      try {
        const before = await page.evaluate(() => window.__readMockSystemThemeRegistration?.() || null);
        await page.evaluate(() => {
          window.__setMockSystemTheme?.("dark");
        });
        await waitForTheme(page, "dark");
        const result = await readThemeState(page);
        const registration = await page.evaluate(() => window.__readMockSystemThemeRegistration?.() || null);
        assert(before?.addEventListenerCount === 0 && before?.addListenerCount === 1, `Legacy system-theme setup should register exactly one addListener handler and no addEventListener handlers: ${JSON.stringify(before)}`);
        assert(registration?.addEventListenerCount === 0 && registration?.addListenerCount === 1, `Legacy system-theme registration counts drifted after the mocked theme change: ${JSON.stringify(registration)}`);
        assertThemeUiState(result, {
          theme: "dark",
          buttonLabel: "切换到亮色模式",
          buttonPressed: "true",
          storedThemeRaw: null
        }, "Legacy addListener system theme changes");
        return { name: "systemThemeLegacyListenerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await installSystemThemeMock(context, "light");
      const page = await createReadyPage(context, origin);
      try {
        await page.waitForSelector("#darkToggleBtn");
        await page.click("#darkToggleBtn");
        await waitForTheme(page, "dark");
        await page.evaluate(() => {
          window.__setMockSystemTheme?.("light");
        });
        await sleep();
        const result = await readThemeState(page);
        assertThemeUiState(result, {
          theme: "dark",
          buttonLabel: "切换到亮色模式",
          buttonPressed: "true",
          storedThemeRaw: "dark"
        }, "Stored theme preferences");
        return { name: "systemThemeIgnorePinnedCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const mission = MISSIONS.find((item) => item.id === "mission-ethics");
          const stepTool = mission?.steps?.[0]?.tool || "";
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            "mission-ethics": { _started: true, step0: true }
          }));
          window.refreshDashboard();
          const badge = document.querySelector(`.tool-link[data-tool-id="${stepTool}"]`)?.parentElement?.querySelector(".tool-restored, .tool-used");
          return {
            stepTool,
            badgeText: badge?.textContent?.trim() || "",
            badgeClass: badge?.className || "",
            badgeLabel: badge?.getAttribute("aria-label") || "",
            statTools: document.getElementById("statTools")?.textContent || ""
          };
        });
        assert(result.stepTool.length > 0, `Mission step tool lookup failed: ${JSON.stringify(result)}`);
        assert(result.badgeText === "↺ 已恢复", `Progress-only module badge should show restored status: ${JSON.stringify(result)}`);
        assert(result.badgeClass.includes("tool-restored"), `Progress-only module badge should use restored styling: ${JSON.stringify(result)}`);
        assert(result.badgeLabel === "已恢复：状态来自任务进度恢复", `Progress-only module badge aria-label mismatch: ${JSON.stringify(result)}`);
        assert(result.statTools === "1", `Progress-only restored module state should still count the tool in hero stats: ${JSON.stringify(result)}`);
        return { name: "moduleRestoredBadgeCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const mission = MISSIONS.find((item) => item.id === "mission-ethics");
          const stepTool = mission?.steps?.[0]?.tool || "";
          const slug = TOOL_SLUGS[stepTool];
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            "mission-ethics": { _started: true, step0: true }
          }));
          localStorage.setItem(`pm_metrics_events_${stepTool}-${slug}`, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: `${stepTool}-${slug}`,
            project_cluster: "probe",
            session_id: "module-badge",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          const badge = document.querySelector(`.tool-link[data-tool-id="${stepTool}"]`)?.parentElement?.querySelector(".tool-restored, .tool-used");
          return {
            stepTool,
            badgeText: badge?.textContent?.trim() || "",
            badgeClass: badge?.className || "",
            badgeLabel: badge?.getAttribute("aria-label") || "",
            statTools: document.getElementById("statTools")?.textContent || ""
          };
        });
        assert(result.stepTool.length > 0, `Mission step tool lookup failed for metric precedence case: ${JSON.stringify(result)}`);
        assert(result.badgeText === "✓ 已用", `Metric-backed module badge should take precedence over restored status: ${JSON.stringify(result)}`);
        assert(result.badgeClass.includes("tool-used"), `Metric-backed module badge should use used styling: ${JSON.stringify(result)}`);
        assert(result.badgeLabel === "已用：已有工具事件记录", `Metric-backed module badge aria-label mismatch: ${JSON.stringify(result)}`);
        assert(result.statTools === "1", `Metric-backed module badge case should count exactly one tool in hero stats: ${JSON.stringify(result)}`);
        return { name: "moduleUsedBadgePrecedenceCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionCard = document.querySelector('.mission-card[data-mission="mission-ethics"]');
          const moduleLink = document.querySelector('.tool-link[data-tool-id="P01"]');
          return {
            missionRole: missionCard?.getAttribute("role") || "",
            missionTabIndex: missionCard instanceof HTMLElement ? missionCard.tabIndex : null,
            missionHasPopup: missionCard?.getAttribute("aria-haspopup") || "",
            missionLabel: missionCard?.getAttribute("aria-label") || "",
            moduleHref: moduleLink?.getAttribute("href") || "",
            moduleRel: moduleLink?.getAttribute("rel") || "",
            moduleTarget: moduleLink?.getAttribute("target") || "",
            moduleLabel: moduleLink?.getAttribute("aria-label") || "",
            moduleText: moduleLink?.textContent?.trim() || ""
          };
        });
        assert(result.missionRole === "button", `Mission card should expose button semantics: ${JSON.stringify(result)}`);
        assert(result.missionTabIndex === 0, `Mission card should stay keyboard-focusable: ${JSON.stringify(result)}`);
        assert(result.missionHasPopup === "dialog", `Mission card should advertise its dialog behavior via aria-haspopup: ${JSON.stringify(result)}`);
        assert(result.missionLabel === "查看任务：灾难报道中的伦理抉择", `Mission card aria-label drifted from the rendered mission title: ${JSON.stringify(result)}`);
        assert(result.moduleHref.endsWith("/P01-model-compare/"), `Module tool link href drifted from the slugged tool path: ${JSON.stringify(result)}`);
        assert(result.moduleRel === "noopener noreferrer", `Module tool link should preserve rel=noopener noreferrer: ${JSON.stringify(result)}`);
        assert(result.moduleTarget === "_blank", `Module tool link should still open in a new tab: ${JSON.stringify(result)}`);
        assert(result.moduleLabel === "P01 多模型对比器，在新标签页打开", `Module tool link aria-label drifted from the rendered tool metadata: ${JSON.stringify(result)}`);
        assert(result.moduleText === "P01 多模型对比器", `Module tool link text drifted from the rendered tool metadata: ${JSON.stringify(result)}`);
        return { name: "interactiveSemanticsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const moduleName = "新闻伦理与实务";
          const metricToolId = "P27";
          const metricSlug = TOOL_SLUGS[metricToolId];
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true, step0: true }
          }));
          localStorage.setItem(`pm_metrics_events_${metricToolId}-${metricSlug}`, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: `${metricToolId}-${metricSlug}`,
            project_cluster: "probe",
            session_id: "module-progress",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          // Duplicate the restored tool in metrics to verify module counts stay deduped by tool id.
          localStorage.setItem("pm_metrics_events_P31", JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P31",
            project_cluster: "probe",
            session_id: "module-progress-duplicate",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          const card = Array.from(document.querySelectorAll(".module-card")).find((node) => node.querySelector("h3")?.textContent?.includes(moduleName));
          const progressFill = card?.querySelector(".mod-progress-fill");
          return {
            descText: card?.querySelector(".mod-desc")?.textContent?.replace(/\s+/g, " ").trim() || "",
            width: progressFill instanceof HTMLElement ? progressFill.style.width : ""
          };
        });
        assert(result.descText.includes("(2/10 已涉及)"), `Module card should dedupe restored and metric-backed tools when computing the involved count: ${JSON.stringify(result)}`);
        assert(result.width === "20%", `Module card progress width should reflect the deduped involved count within the module: ${JSON.stringify(result)}`);
        return { name: "moduleCardProgressCountCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          window.refreshDashboard();
          return {
            statTools: document.getElementById("statTools")?.textContent || "",
            barText: document.getElementById("barChart")?.textContent?.trim() || "",
            barLabel: document.getElementById("barChart")?.getAttribute("aria-label") || "",
            calText: document.getElementById("calChart")?.textContent?.trim() || "",
            calLabel: document.getElementById("calChart")?.getAttribute("aria-label") || ""
          };
        });
        assert(result.statTools === "0", `Self-metrics-only startup state should not count dashboard events as used tools: ${JSON.stringify(result)}`);
        assert(result.barText === "当前仅记录到学习中枢自身事件，这些事件不会计入工具使用排行。", `Self-metrics-only bar chart empty-state text mismatch: ${JSON.stringify(result)}`);
        assert(result.barLabel === "工具使用排行。当前仅记录到学习中枢自身事件，这些事件不会计入工具使用排行。", `Self-metrics-only bar chart aria-label mismatch: ${JSON.stringify(result)}`);
        assert(result.calText === "当前仅记录到学习中枢自身事件，这些事件不会计入活跃日历。", `Self-metrics-only calendar empty-state text mismatch: ${JSON.stringify(result)}`);
        assert(result.calLabel === "过去 90 天活跃日历。当前仅记录到学习中枢自身事件，这些事件不会计入活跃日历。", `Self-metrics-only calendar aria-label mismatch: ${JSON.stringify(result)}`);
        return { name: "statsSelfMetricsOnlyEmptyStateCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            "mission-ethics": { _started: true, step0: true }
          }));
          window.refreshDashboard();
          return {
            statTools: document.getElementById("statTools")?.textContent || "",
            barText: document.getElementById("barChart")?.textContent?.trim() || "",
            barLabel: document.getElementById("barChart")?.getAttribute("aria-label") || "",
            calText: document.getElementById("calChart")?.textContent?.trim() || "",
            calLabel: document.getElementById("calChart")?.getAttribute("aria-label") || ""
          };
        });
        assert(result.statTools === "1", `Restored-progress state should count tool usage derived from mission progress: ${JSON.stringify(result)}`);
        assert(result.barText === "已恢复任务/工具进度，但暂无工具事件历史；学习中枢自身事件不会计入使用排行。", `Restored-progress bar chart empty-state text mismatch: ${JSON.stringify(result)}`);
        assert(result.barLabel === "工具使用排行。已恢复任务或工具进度，但暂无工具事件历史；学习中枢自身事件不会计入使用排行。", `Restored-progress bar chart aria-label mismatch: ${JSON.stringify(result)}`);
        assert(result.calText === "已恢复进度，但暂无工具事件日期历史；学习中枢自身事件不会计入活跃日历。", `Restored-progress calendar empty-state text mismatch: ${JSON.stringify(result)}`);
        assert(result.calLabel === "过去 90 天活跃日历。已恢复进度，但暂无工具事件日期历史；学习中枢自身事件不会计入活跃日历。", `Restored-progress calendar aria-label mismatch: ${JSON.stringify(result)}`);
        return { name: "statsRestoredProgressEmptyStateCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard") {
            return;
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      await page.waitForFunction(() => !!window.pmMetrics && typeof window.ensureMissionStarted === "function");
      try {
        const result = await page.evaluate(() => {
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            "mission-ethics": { _started: true, step0: true }
          }));
          window.refreshDashboard();
          return {
            statTools: document.getElementById("statTools")?.textContent || "",
            barText: document.getElementById("barChart")?.textContent?.trim() || "",
            barLabel: document.getElementById("barChart")?.getAttribute("aria-label") || "",
            calText: document.getElementById("calChart")?.textContent?.trim() || "",
            calLabel: document.getElementById("calChart")?.getAttribute("aria-label") || ""
          };
        });
        assert(result.statTools === "1", `Restored-progress no-self-metrics state should count tool usage derived from mission progress: ${JSON.stringify(result)}`);
        assert(result.barText === "已恢复任务/工具进度，但暂无工具事件历史，暂时无法生成使用排行。", `Restored-progress no-self-metrics bar chart empty-state text mismatch: ${JSON.stringify(result)}`);
        assert(result.barLabel === "工具使用排行。已恢复任务或工具进度，但暂无工具事件历史，暂时无法生成使用排行。", `Restored-progress no-self-metrics bar chart aria-label mismatch: ${JSON.stringify(result)}`);
        assert(result.calText === "已恢复进度，但暂无带日期的工具事件历史，活跃日历尚无法生成。", `Restored-progress no-self-metrics calendar empty-state text mismatch: ${JSON.stringify(result)}`);
        assert(result.calLabel === "过去 90 天活跃日历。已恢复进度，但暂无带日期的工具事件历史。", `Restored-progress no-self-metrics calendar aria-label mismatch: ${JSON.stringify(result)}`);
        return { name: "statsRestoredProgressWithoutSelfMetricsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const toolId = "P01";
          const slug = TOOL_SLUGS[toolId];
          const projectId = `${toolId}-${slug}`;
          const baseNoon = new Date();
          baseNoon.setHours(12, 0, 0, 0);
          const days = [3, 2, 1].map((offset) => {
            const next = new Date(baseNoon);
            next.setDate(next.getDate() - offset);
            return next;
          });
          localStorage.clear();
          localStorage.setItem(`pm_metrics_events_${projectId}`, JSON.stringify(days.map((date, index) => ({
            event_name: "cta_click",
            control_id: `stats-${index}`,
            event_time: date.toISOString(),
            project_id: projectId,
            project_cluster: "probe",
            session_id: "stats-history",
            app_version: "pm-v1",
            page_path: "/"
          }))));
          window.refreshDashboard();
          const barRows = Array.from(document.querySelectorAll("#barChart .bar-row")).map((row) => row.getAttribute("aria-label") || "");
          const calCells = Array.from(document.querySelectorAll("#calChart .cal-cell")).map((cell) => cell.getAttribute("aria-label") || "");
          return {
            barLabel: document.getElementById("barChart")?.getAttribute("aria-label") || "",
            barRows,
            calLabel: document.getElementById("calChart")?.getAttribute("aria-label") || "",
            calCellCount: calCells.length,
            calCells,
            expectedDays: days.map((date) => formatLocalDateKey(date))
          };
        });
        assert(result.barLabel === "工具使用排行", `Non-empty stats bar chart aria-label mismatch: ${JSON.stringify(result)}`);
        assert(result.barRows.length >= 1 && result.barRows[0].startsWith("P01 "), `Non-empty stats bar chart should expose the top tool row label: ${JSON.stringify(result)}`);
        assert(result.barRows[0].endsWith("，3 次事件"), `Non-empty stats bar chart top row should report the tool event count: ${JSON.stringify(result)}`);
        assert(result.calLabel.startsWith("过去 90 天活跃日历。最近活跃："), `Non-empty stats calendar aria-label summary prefix mismatch: ${JSON.stringify(result)}`);
        result.expectedDays.forEach((day) => {
          assert(result.calLabel.includes(day), `Non-empty stats calendar summary is missing active day ${day}: ${JSON.stringify(result)}`);
          assert(result.calCells.includes(`${day}: 1 次事件`), `Non-empty stats calendar is missing the active-day cell label for ${day}: ${JSON.stringify(result)}`);
        });
        assert(result.calCellCount === 90, `Non-empty stats calendar should still render 90 day cells: ${JSON.stringify(result)}`);
        return { name: "statsPositiveRenderingCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const mission = MISSIONS.find((item) => item.id === "mission-ethics");
          const missionProgress = { _started: true };
          const completedTools = new Set();
          mission?.steps?.forEach((step, index) => {
            missionProgress["step" + index] = true;
            completedTools.add(step.tool);
          });

          const toolId = "P11";
          const slug = TOOL_SLUGS[toolId];
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            "mission-ethics": missionProgress
          }));
          localStorage.setItem("pm_metrics_events_P00-dashboard", JSON.stringify([
            {
              event_name: "page_view",
              event_time: new Date(Date.now() - 5000).toISOString(),
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "hero-self",
              app_version: "pm-v1",
              page_path: "/"
            },
            {
              event_name: "page_hidden",
              event_time: new Date(Date.now() - 4000).toISOString(),
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "hero-self",
              app_version: "pm-v1",
              page_path: "/",
              dwell_ms: 1000
            }
          ]));
          localStorage.setItem(`pm_metrics_events_${toolId}-${slug}`, JSON.stringify([
            {
              event_name: "page_view",
              event_time: new Date(Date.now() - 3000).toISOString(),
              project_id: `${toolId}-${slug}`,
              project_cluster: "probe",
              session_id: "hero-tool",
              app_version: "pm-v1",
              page_path: "/"
            },
            {
              event_name: "page_hidden",
              event_time: new Date(Date.now() - 2000).toISOString(),
              project_id: `${toolId}-${slug}`,
              project_cluster: "probe",
              session_id: "hero-tool",
              app_version: "pm-v1",
              page_path: "/",
              dwell_ms: 2000
            }
          ]));
          window.refreshDashboard();
          return {
            expectedTools: completedTools.size + 1,
            statModules: document.getElementById("statModules")?.textContent || "",
            statTasks: document.getElementById("statTasks")?.textContent || "",
            statTools: document.getElementById("statTools")?.textContent || "",
            statDwell: document.getElementById("statDwell")?.textContent || ""
          };
        });
        assert(result.statModules === "2", `Hero modules-started count drifted from combined progress/metric state: ${JSON.stringify(result)}`);
        assert(result.statTasks === "1", `Hero completed-task count drifted from completed mission state: ${JSON.stringify(result)}`);
        assert(result.statTools === String(result.expectedTools), `Hero used-tools count drifted from combined progress/metric state: ${JSON.stringify(result)}`);
        assert(result.statDwell === "3s", `Hero dwell summary drifted from aggregated dashboard/tool dwell events: ${JSON.stringify(result)}`);
        return { name: "heroStatsAggregationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__pmOldCacheSeeded = false;
        document.addEventListener("DOMContentLoaded", async () => {
          try {
            const cache = await caches.open("journalism-tool-p00-old");
            await cache.put("./stale.txt", new Response("stale"));
            window.__pmOldCacheSeeded = true;
          } catch {}
        }, { once: true });
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          if ("serviceWorker" in navigator) {
            await navigator.serviceWorker.ready;
          }
          await new Promise(resolve => setTimeout(resolve, 200));
          return {
            seeded: window.__pmOldCacheSeeded,
            cacheNames: await caches.keys()
          };
        });
        assert(result.seeded === true, `Old cache seed did not run before service worker activation: ${JSON.stringify(result)}`);
        assert(result.cacheNames.includes("journalism-tool-p00-v2"), `Current service worker cache missing after activation: ${JSON.stringify(result.cacheNames)}`);
        assert(!result.cacheNames.includes("journalism-tool-p00-old"), `Old prefixed cache was not removed on service worker activation: ${JSON.stringify(result.cacheNames)}`);
        return { name: "serviceWorkerCacheCleanupCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const readiness = await page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return { supported: false, active: false };
          const registration = await navigator.serviceWorker.ready;
          return {
            supported: true,
            active: !!registration.active
          };
        });
        assert(readiness.supported && readiness.active, `Service worker did not become active: ${JSON.stringify(readiness)}`);

        await context.setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.querySelector(".hero h1")?.textContent?.includes("新闻素养学习中枢"));
        const result = await page.evaluate(async (assets) => {
          const beforeTheme = document.documentElement.getAttribute("data-theme") || "";
          document.getElementById("darkToggleBtn")?.click();
          const afterTheme = document.documentElement.getAttribute("data-theme") || "";
          window.showToast("离线提示可用", "info", 0);
          const assetFetches = {};
          for (const asset of assets) {
            const response = await fetch(asset);
            assetFetches[asset] = {
              ok: response.ok,
              status: response.status,
              bytes: (await response.arrayBuffer()).byteLength
            };
          }
          const manifestResponse = await fetch("./manifest.json");
          const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
          return {
            title: document.title,
            heroText: document.querySelector(".hero h1")?.textContent || "",
            darkTogglePresent: !!document.getElementById("darkToggleBtn"),
            themeBefore: beforeTheme,
            themeAfter: afterTheme,
            toastPresent: !!document.querySelector("#toastContainer > [role='status']"),
            assetFetches,
            manifestOk: manifestResponse.ok,
            manifestStatus: manifestResponse.status,
            manifestName: manifest?.name || "",
            manifestIcon: manifest?.icons?.[0]?.src || ""
          };
        }, OFFLINE_FETCH_ASSETS);
        assert(result.title === "新闻素养学习中枢", `Offline reload title mismatch: ${result.title}`);
        assert(result.heroText.includes("新闻素养学习中枢"), `Offline reload hero mismatch: ${result.heroText}`);
        assert(result.darkTogglePresent === true, `Offline shell did not initialize shared dark-toggle UI: ${JSON.stringify(result)}`);
        assert(result.themeBefore !== result.themeAfter, `Offline dark-toggle interaction did not update theme state: ${JSON.stringify(result)}`);
        assert(result.toastPresent === true, `Offline toast UI did not render after reload: ${JSON.stringify(result)}`);
        assert(result.manifestOk && result.manifestStatus === 200, `Offline manifest fetch failed: ${JSON.stringify(result)}`);
        assert(result.manifestName === "新闻素养学习中枢" && result.manifestIcon === "./icon-192.png", `Offline manifest contents were not cached correctly: ${JSON.stringify(result)}`);
        OFFLINE_FETCH_ASSETS.forEach((asset) => {
          const info = result.assetFetches?.[asset];
          assert(!!info && info.ok && info.status === 200 && info.bytes > 0, `Offline core asset fetch failed for ${asset}: ${JSON.stringify(result)}`);
        });
        return { name: "offlineShellCase", status: "passed" };
      } finally {
        await context.setOffline(false);
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__pmForcedSwRegisterFailure = false;
        if (!("serviceWorker" in navigator) || !navigator.serviceWorker) return;
        try {
          Object.defineProperty(navigator.serviceWorker, "register", {
            configurable: true,
            writable: true,
            value: async function () {
              window.__pmForcedSwRegisterFailure = true;
              throw new Error("forced service worker registration failure");
            }
          });
        } catch {}
      });
      const requestFailures = [];
      const consoleErrors = [];
      page.on("requestfailed", request => {
        requestFailures.push(`${request.method()} ${request.url()} -> ${request.failure()?.errorText || "failed"}`);
      });
      page.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      await page.waitForFunction(() => !!window.pmMetrics && typeof window.ensureMissionStarted === "function");
      assert(requestFailures.length === 0, `Asset request failures: ${requestFailures.join(" | ")}`);
      assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);
      try {
        const result = await page.evaluate(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            patched: window.__pmForcedSwRegisterFailure === true,
            warningCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "离线缓存初始化失败，页面仍可在线使用。").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length,
            toastText: document.querySelector("#toastContainer")?.textContent || ""
          };
        });
        assert(result.patched === true, `Service worker register override did not run before page init: ${JSON.stringify(result)}`);
        assert(result.warningCount === 1, `Service worker registration failure should record exactly one warning/error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Service worker registration warning should not block later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Service worker registration warning should leave exactly one visible toast: ${JSON.stringify(result)}`);
        assert(result.toastText.includes("离线缓存初始化失败，页面仍可在线使用。"), `Service worker registration warning toast text mismatch: ${JSON.stringify(result)}`);
        return { name: "serviceWorkerRegisterFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true, step0: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "session-check",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          localStorage.setItem(taskKey, String(Date.now()));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) throw new Error("forced task key read failure");
            return originalGetItem.call(this, key);
          };

          try {
            const backupStatus = window.getBackupStorageSnapshotStatus();
            const payload = window.buildExportPayload();
            const restored = window.restoreManagedStorage({
              [progressKey]: JSON.stringify({
                "mission-ai-content": { _started: true, step0: true }
              })
            });
            return {
              backupUnreadable: backupStatus.unreadable,
              backupReadable: backupStatus.readable,
              exportedKeys: Object.keys(payload.data || {}).sort(),
              restored,
              restoredProgressRaw: localStorage.getItem(progressKey)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.backupReadable === true && result.backupUnreadable === 0, `Unreadable task-start key leaked into backup status: ${JSON.stringify(result)}`);
        assert(result.exportedKeys.includes("p00_mission_progress"), `Export payload missing progress after unreadable task-start key: ${JSON.stringify(result.exportedKeys)}`);
        assert(result.restored === 1, `Restore count mismatch with unreadable task-start key: ${result.restored}`);
        assert((result.restoredProgressRaw || "").includes("mission-ai-content"), "Restore did not apply replacement progress with unreadable task-start key present");
        return { name: "unreadableTaskKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));

          const originalBuildExportPayload = window.buildExportPayload;
          window.buildExportPayload = function () {
            throw new Error("snapshot_failed");
          };

          try {
            document.getElementById("exportBtn").click();
            await new Promise(resolve => setTimeout(resolve, 50));
            return {
              toastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || ""
            };
          } finally {
            window.buildExportPayload = originalBuildExportPayload;
          }
        });
        assert(result.toastText === "导出失败：当前浏览器存储状态已变化，请刷新后重试。", `Export button did not surface a toast when buildExportPayload() threw: ${JSON.stringify(result)}`);
        return { name: "exportButtonBuildFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, "{not-json");
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          document.getElementById("exportBtn").click();
          await new Promise(resolve => setTimeout(resolve, 50));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "旧提示").length,
            exportErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导出失败：当前浏览器存储存在不可读数据，无法生成完整备份。").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Export unreadable preflight should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.exportErrorCount === 1, `Export unreadable preflight should record exactly one export error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Export unreadable preflight toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Export unreadable preflight should leave exactly one visible error toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "exportButtonUnreadableDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          document.getElementById("exportBtn").click();
          await new Promise(resolve => setTimeout(resolve, 50));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "旧提示").length,
            exportInfoSignalCount: events.filter(event =>
              (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
              && event.status_text === "暂无可导出的学习数据"
            ).length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Export empty-state info should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.exportInfoSignalCount === 0, `Export empty-state info toast should remain untracked: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Export empty-state info toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Export empty-state info should leave exactly one visible info toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "exportButtonEmptyDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000, { track: false });
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalReplaceToasts = window.replaceToasts;
          window.replaceToasts = undefined;
          try {
            document.getElementById("exportBtn").click();
            await new Promise(resolve => setTimeout(resolve, 50));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "旧提示"
              ).length,
              exportInfoSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "暂无可导出的学习数据"
              ).length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.replaceToasts = originalReplaceToasts;
          }
        });
        assert(result.priorToastCount === 0, `Export empty-state fallback setup should keep the stale visible toast untracked so storage stays empty: ${JSON.stringify(result)}`);
        assert(result.exportInfoSignalCount === 0, `Export empty-state fallback info toast should remain untracked: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Export empty-state fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Export empty-state fallback should leave exactly one visible info toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "exportButtonEmptyFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          document.getElementById("exportBtn").click();
          await new Promise(resolve => setTimeout(resolve, 50));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.statusTexts.filter(text => text === "旧提示").length === 1, `Export success should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "学习数据已导出").length === 1, `Export success should record exactly one export success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Export success toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Export success should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "exportButtonDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalReplaceToasts = window.replaceToasts;
          window.replaceToasts = undefined;
          try {
            document.getElementById("exportBtn").click();
            await new Promise(resolve => setTimeout(resolve, 50));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.replaceToasts = originalReplaceToasts;
          }
        });
        assert(result.statusTexts.filter(text => text === "旧提示").length === 1, `Export success fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "学习数据已导出").length === 1, `Export success fallback should record exactly one export success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Export success fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Export success fallback should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "exportButtonFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          const originalOpen = window.open;
          window.open = () => null;
          try {
            window.openMissionModal("mission-ethics");
            document.getElementById("modalStartBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal" || event.event_name === "status_error_signal").map(event => event.status_text),
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.open = originalOpen;
          }
        });
        assert(result.statusTexts.filter(text => text === "旧提示").length === 1, `Popup warning should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "浏览器拦截了新标签页，请允许弹窗后重试").length === 1, `Popup warning should record exactly one warning signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Popup warning toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Popup warning should leave exactly one visible toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "popupBlockedDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          const originalOpen = window.open;
          const originalReplaceToasts = window.replaceToasts;
          window.open = () => null;
          window.replaceToasts = undefined;
          try {
            window.openMissionModal("mission-ethics");
            document.getElementById("modalStartBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal" || event.event_name === "status_error_signal").map(event => event.status_text),
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.open = originalOpen;
            window.replaceToasts = originalReplaceToasts;
          }
        });
        assert(result.statusTexts.filter(text => text === "旧提示").length === 1, `Popup warning fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "浏览器拦截了新标签页，请允许弹窗后重试").length === 1, `Popup warning fallback should record exactly one warning signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Popup warning fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Popup warning fallback should leave exactly one visible toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "popupBlockedFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === progressKey) {
              throw new Error("forced unreadable progress key");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            return {
              toastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || ""
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.toastText === "当前浏览器存储存在异常学习数据，导出与覆盖恢复已停用。", `Unreadable backup-critical storage warning toast mismatch: ${JSON.stringify(result)}`);
        return { name: "unreadableProgressWarningCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalReplaceToasts = window.replaceToasts;
          const originalGetItem = Storage.prototype.getItem;
          window.replaceToasts = undefined;
          Storage.prototype.getItem = function (key) {
            if (key === progressKey) {
              throw new Error("forced unreadable progress key");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "旧提示").length,
              warningSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "当前浏览器存储存在异常学习数据，导出与覆盖恢复已停用。"
              ).length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.replaceToasts = originalReplaceToasts;
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.priorToastCount === 1, `Unreadable backup-critical warning fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.warningSignalCount === 0, `Unreadable backup-critical warning fallback should keep the warning toast untracked: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Unreadable backup-critical warning fallback should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Unreadable backup-critical warning fallback should leave exactly one visible warning toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "unreadableProgressWarningFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(eventsKey, "{not-json");
          try {
            const managedError = (() => {
              try {
                window.getManagedStorageSnapshot();
                return "none";
              } catch (error) {
                return error?.message || "unknown";
              }
            })();
            const backupError = (() => {
              try {
                window.getBackupStorageSnapshot();
                return "none";
              } catch (error) {
                return error?.message || "unknown";
              }
            })();
            window.clearManagedStorageTransactional();
            return {
              clearError: "none",
              managedError,
              backupError,
              exportError: (() => {
                try {
                  window.buildExportPayload();
                  return "none";
                } catch (error) {
                  return error?.message || "unknown";
                }
              })(),
              managedSnapshotKeys: Object.keys(window.getManagedStorageSnapshotStatus().snapshot || {}),
              backupSnapshotKeys: Object.keys(window.getBackupStorageSnapshotStatus().snapshot || {}),
              managedUnreadable: window.getManagedStorageSnapshotStatus().unreadable,
              backupUnreadable: window.getBackupStorageSnapshotStatus().unreadable
            };
          } catch (error) {
            return {
              clearError: error?.message || "unknown",
              managedError: (() => {
                try {
                  window.getManagedStorageSnapshot();
                  return "none";
                } catch (nextError) {
                  return nextError?.message || "unknown";
                }
              })(),
              backupError: (() => {
                try {
                  window.getBackupStorageSnapshot();
                  return "none";
                } catch (nextError) {
                  return nextError?.message || "unknown";
                }
              })(),
              exportError: (() => {
                try {
                  window.buildExportPayload();
                  return "none";
                } catch (nextError) {
                  return nextError?.message || "unknown";
                }
              })(),
              managedSnapshotKeys: Object.keys(window.getManagedStorageSnapshotStatus().snapshot || {}),
              backupSnapshotKeys: Object.keys(window.getBackupStorageSnapshotStatus().snapshot || {}),
              managedUnreadable: window.getManagedStorageSnapshotStatus().unreadable,
              backupUnreadable: window.getBackupStorageSnapshotStatus().unreadable
            };
          }
        });
        assert(result.managedUnreadable === 1, `Managed snapshot status did not flag corrupt readable metrics as unreadable: ${JSON.stringify(result)}`);
        assert(result.backupUnreadable === 1, `Backup snapshot status did not flag corrupt readable metrics as unreadable: ${JSON.stringify(result)}`);
        assert(result.managedSnapshotKeys.length === 0 && result.backupSnapshotKeys.length === 0, `Corrupt readable metrics should not appear inside status snapshots: ${JSON.stringify(result)}`);
        assert(result.managedError === "snapshot_failed", `getManagedStorageSnapshot() did not stop on corrupt readable metrics: ${JSON.stringify(result)}`);
        assert(result.backupError === "snapshot_failed", `getBackupStorageSnapshot() did not stop on corrupt readable metrics: ${JSON.stringify(result)}`);
        assert(result.clearError === "snapshot_failed", `Transactional clear did not stop on corrupt readable metrics: ${JSON.stringify(result)}`);
        assert(result.exportError === "snapshot_failed", `buildExportPayload() did not stop on corrupt readable metrics: ${JSON.stringify(result)}`);
        return { name: "corruptMetricsSnapshotStatusCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced unreadable mission marker");
            }
            return originalGetItem.call(this, key);
          };

          try {
            const cleared = window.clearManagedStorageTransactional();
            return {
              error: "none",
              cleared,
              keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).sort()
            };
          } catch (error) {
            return {
              error: error?.message || "unknown",
              keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).sort()
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.error === "none", `Transactional clear should not be blocked by an unreadable task-start marker: ${JSON.stringify(result)}`);
        assert(result.keys.length === 0, `Transactional clear did not remove all managed keys with an unreadable task-start marker present: ${JSON.stringify(result)}`);
        return { name: "clearUnreadableTaskKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify([1]));
          return {
            managedUnreadable: window.getManagedStorageSnapshotStatus().unreadable,
            backupUnreadable: window.getBackupStorageSnapshotStatus().unreadable,
            exportError: (() => {
              try {
                window.buildExportPayload();
                return "none";
              } catch (error) {
                return error?.message || "unknown";
              }
            })()
          };
        });
        assert(result.managedUnreadable === 1, `Managed snapshot status did not flag invalid metric array entries as unreadable: ${JSON.stringify(result)}`);
        assert(result.backupUnreadable === 1, `Backup snapshot status did not flag invalid metric array entries as unreadable: ${JSON.stringify(result)}`);
        assert(result.exportError === "snapshot_failed", `buildExportPayload() did not stop on invalid metric array entries: ${JSON.stringify(result)}`);
        return { name: "invalidMetricsSnapshotStatusCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, "{not-json");
          try {
            const managedError = (() => {
              try {
                window.getManagedStorageSnapshot();
                return "none";
              } catch (error) {
                return error?.message || "unknown";
              }
            })();
            const backupError = (() => {
              try {
                window.getBackupStorageSnapshot();
                return "none";
              } catch (error) {
                return error?.message || "unknown";
              }
            })();
            window.clearManagedStorageTransactional();
            return {
              clearError: "none",
              managedError,
              backupError,
              exportError: (() => {
                try {
                  window.buildExportPayload();
                  return "none";
                } catch (error) {
                  return error?.message || "unknown";
                }
              })(),
              managedSnapshotKeys: Object.keys(window.getManagedStorageSnapshotStatus().snapshot || {}),
              backupSnapshotKeys: Object.keys(window.getBackupStorageSnapshotStatus().snapshot || {}),
              managedUnreadable: window.getManagedStorageSnapshotStatus().unreadable,
              backupUnreadable: window.getBackupStorageSnapshotStatus().unreadable
            };
          } catch (error) {
            return {
              clearError: error?.message || "unknown",
              managedError: (() => {
                try {
                  window.getManagedStorageSnapshot();
                  return "none";
                } catch (nextError) {
                  return nextError?.message || "unknown";
                }
              })(),
              backupError: (() => {
                try {
                  window.getBackupStorageSnapshot();
                  return "none";
                } catch (nextError) {
                  return nextError?.message || "unknown";
                }
              })(),
              exportError: (() => {
                try {
                  window.buildExportPayload();
                  return "none";
                } catch (nextError) {
                  return nextError?.message || "unknown";
                }
              })(),
              managedSnapshotKeys: Object.keys(window.getManagedStorageSnapshotStatus().snapshot || {}),
              backupSnapshotKeys: Object.keys(window.getBackupStorageSnapshotStatus().snapshot || {}),
              managedUnreadable: window.getManagedStorageSnapshotStatus().unreadable,
              backupUnreadable: window.getBackupStorageSnapshotStatus().unreadable
            };
          }
        });
        assert(result.managedUnreadable === 1, `Managed snapshot status did not flag corrupt readable progress as unreadable: ${JSON.stringify(result)}`);
        assert(result.backupUnreadable === 1, `Backup snapshot status did not flag corrupt readable progress as unreadable: ${JSON.stringify(result)}`);
        assert(result.managedSnapshotKeys.length === 0 && result.backupSnapshotKeys.length === 0, `Corrupt readable progress should not appear inside status snapshots: ${JSON.stringify(result)}`);
        assert(result.managedError === "snapshot_failed", `getManagedStorageSnapshot() did not stop on corrupt readable progress: ${JSON.stringify(result)}`);
        assert(result.backupError === "snapshot_failed", `getBackupStorageSnapshot() did not stop on corrupt readable progress: ${JSON.stringify(result)}`);
        assert(result.clearError === "snapshot_failed", `Transactional clear did not stop on corrupt readable progress: ${JSON.stringify(result)}`);
        assert(result.exportError === "snapshot_failed", `buildExportPayload() did not stop on corrupt readable progress: ${JSON.stringify(result)}`);
        return { name: "corruptProgressSnapshotStatusCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, "{not-json");
          const started = window.ensureMissionStarted("mission-ethics");
          return {
            started: started !== null,
            progressRaw: localStorage.getItem(progressKey),
            markerRaw: localStorage.getItem(taskKey),
            taskStartCount: JSON.parse(localStorage.getItem(eventsKey) || "[]")
              .filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics")
              .length
          };
        });
        assert(result.started === false, `ensureMissionStarted should not overwrite corrupt progress storage: ${JSON.stringify(result)}`);
        assert(result.progressRaw === "{not-json", `Corrupt progress payload was overwritten by mission start: ${JSON.stringify(result)}`);
        assert(result.markerRaw === null, `Mission start should not create a marker when progress storage is corrupt: ${JSON.stringify(result)}`);
        assert(result.taskStartCount === 0, `Mission start should not emit task_start when progress storage is corrupt: ${JSON.stringify(result)}`);
        return { name: "corruptProgressWriteGuardCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey && String(value).includes("mission-ai-content")) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            try {
              window.restoreManagedStorage({
                [progressKey]: JSON.stringify({
                  "mission-ai-content": { _started: true }
                })
              });
              return { error: "none", progressRaw: localStorage.getItem(progressKey) };
            } catch (error) {
              return {
                error: error?.message || "unknown",
                progressRaw: localStorage.getItem(progressKey)
              };
            }
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.error === "write_failed", `Restore did not detect silent write failure for managed snapshot entry: ${JSON.stringify(result)}`);
        assert((result.progressRaw || "").includes("mission-ethics"), `Restore rollback did not preserve original progress after silent write failure: ${JSON.stringify(result)}`);
        return { name: "restoreSilentWriteFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "clear-rollback",
            app_version: "pm-v1",
            page_path: "/"
          }]));

          const originalConfirm = window.confirm;
          const originalRemoveItem = Storage.prototype.removeItem;
          window.confirm = () => true;
          Storage.prototype.removeItem = function (key) {
            if (key === eventsKey) throw new Error("forced clear remove failure");
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("clearBtn").click();
            return {
              progressRaw: localStorage.getItem(progressKey),
              eventsRaw: localStorage.getItem(eventsKey)
            };
          } finally {
            window.confirm = originalConfirm;
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert((result.progressRaw || "").includes("mission-ethics"), `Clear rollback did not restore progress after partial remove failure: ${JSON.stringify(result)}`);
        assert((result.eventsRaw || "").includes("\"page_view\""), `Clear rollback did not preserve metrics after partial remove failure: ${JSON.stringify(result)}`);
        return { name: "clearRollbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "clear-silent-rollback",
            app_version: "pm-v1",
            page_path: "/"
          }]));

          const originalConfirm = window.confirm;
          const originalRemoveItem = Storage.prototype.removeItem;
          window.confirm = () => true;
          Storage.prototype.removeItem = function (key) {
            if (key === eventsKey) return;
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("clearBtn").click();
            return {
              progressRaw: localStorage.getItem(progressKey),
              eventsRaw: localStorage.getItem(eventsKey)
            };
          } finally {
            window.confirm = originalConfirm;
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert((result.progressRaw || "").includes("mission-ethics"), `Clear rollback did not restore progress after silent removeItem no-op: ${JSON.stringify(result)}`);
        assert((result.eventsRaw || "").includes("\"page_view\""), `Clear rollback did not preserve metrics after silent removeItem no-op: ${JSON.stringify(result)}`);
        return { name: "clearSilentRollbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "before-clear",
            app_version: "pm-v1",
            page_path: "/"
          }]));

          const originalConfirm = window.confirm;
          window.confirm = () => true;
          try {
            document.getElementById("clearBtn").click();
            return {
              keys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).sort(),
              eventsRaw: localStorage.getItem(eventsKey),
              progressRaw: localStorage.getItem(progressKey)
            };
          } finally {
            window.confirm = originalConfirm;
          }
        });
        assert(result.keys.length === 0, `Successful clear should not immediately recreate managed storage entries: ${JSON.stringify(result)}`);
        assert(result.eventsRaw === null && result.progressRaw === null, `Successful clear left managed storage behind: ${JSON.stringify(result)}`);
        return { name: "clearButtonLeavesStorageEmptyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          window.confirm = () => true;
          try {
            document.getElementById("clearBtn").click();
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              eventNames: events.map(event => event.event_name + (event.control_id ? ":" + event.control_id : "")),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
          }
        });
        assert(result.eventNames.join(",") === "page_view,cta_click:probe", `Successful clear should not resurrect pre-clear toast signals on later interaction: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Successful clear should replace prior toasts with exactly one untracked outcome toast: ${JSON.stringify(result)}`);
        return { name: "clearButtonDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          const originalReplaceToasts = window.replaceToasts;
          window.confirm = () => true;
          window.replaceToasts = undefined;
          try {
            document.getElementById("clearBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              eventNames: events.map(event => event.event_name + (event.control_id ? ":" + event.control_id : "")),
              clearSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "学习数据已清除"
              ).length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
            window.replaceToasts = originalReplaceToasts;
          }
        });
        assert(result.eventNames.join(",") === "page_view,cta_click:probe", `Successful clear fallback should not resurrect pre-clear toast signals on later interaction: ${JSON.stringify(result)}`);
        assert(result.clearSignalCount === 0, `Successful clear fallback should keep its outcome toast untracked: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Successful clear fallback should replace prior toasts with exactly one untracked outcome toast: ${JSON.stringify(result)}`);
        return { name: "clearButtonFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000, { track: false });
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          window.confirm = () => true;
          try {
            document.getElementById("clearBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "旧提示"
              ).length,
              clearInfoSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "当前没有可清除的学习数据"
              ).length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
          }
        });
        assert(result.priorToastCount === 0, `Empty clear info setup should keep the stale visible toast untracked so the storage stays empty: ${JSON.stringify(result)}`);
        assert(result.clearInfoSignalCount === 0, `Empty clear info toast should remain untracked: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Empty clear info toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Empty clear should leave exactly one visible info toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "clearButtonEmptyDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000, { track: false });
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          const originalReplaceToasts = window.replaceToasts;
          window.confirm = () => true;
          window.replaceToasts = undefined;
          try {
            document.getElementById("clearBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              eventNames: events.map(event => event.event_name + (event.control_id ? ":" + event.control_id : "")),
              clearInfoSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "当前没有可清除的学习数据"
              ).length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
            window.replaceToasts = originalReplaceToasts;
          }
        });
        assert(result.eventNames.join(",") === "page_view,cta_click:probe", `Empty clear fallback should not resurrect pre-clear toast signals on later interaction: ${JSON.stringify(result)}`);
        assert(result.clearInfoSignalCount === 0, `Empty clear fallback info toast should remain untracked: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Empty clear fallback should leave exactly one visible info toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "clearButtonEmptyFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          const originalRemoveItem = Storage.prototype.removeItem;
          window.confirm = () => true;
          Storage.prototype.removeItem = function (key) {
            if (key === eventsKey) throw new Error("forced clear remove failure");
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("clearBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              clearErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "清除失败：浏览器存储删除不完整，已保留原有数据。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.priorToastCount === 1, `Clear rollback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.clearErrorCount === 1, `Clear rollback should record exactly one clear failure signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Clear rollback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Clear rollback should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "clearRollbackDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, "{not-json");
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          window.confirm = () => true;
          try {
            document.getElementById("clearBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              clearErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "清除失败：当前浏览器存储存在不可读数据，无法安全清除。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
          }
        });
        assert(result.priorToastCount === 1, `Clear snapshot failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.clearErrorCount === 1, `Clear snapshot failure should record exactly one unreadable-storage error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Clear snapshot failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Clear snapshot failure should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "clearSnapshotFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "clear-rollback-failed",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalConfirm = window.confirm;
          const originalRemoveItem = Storage.prototype.removeItem;
          const originalSetItem = Storage.prototype.setItem;
          window.confirm = () => true;
          Storage.prototype.removeItem = function (key) {
            if (key === eventsKey) {
              return;
            }
            return originalRemoveItem.call(this, key);
          };
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey && String(value).includes("mission-ethics")) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            document.getElementById("clearBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              clearErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "清除失败：浏览器存储异常，回滚过程中可能仅部分保留原有数据。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              progressRaw: localStorage.getItem(progressKey),
              eventsRaw: localStorage.getItem(eventsKey),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.confirm = originalConfirm;
            Storage.prototype.removeItem = originalRemoveItem;
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.priorToastCount === 1, `Clear rollback failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.clearErrorCount === 1, `Clear rollback failure should record exactly one rollback-failure error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Clear rollback failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.progressRaw === null, `Clear rollback failure should surface the lost progress state after failed rollback: ${JSON.stringify(result)}`);
        assert((result.eventsRaw || "").includes("\"page_view\""), `Clear rollback failure should preserve the metrics entry that never cleared: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Clear rollback failure should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "clearRollbackFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          const cleared = clearManagedStorage();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            removed: cleared.removed,
            eventNames: events.map(event => event.event_name),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.removed >= 1, `Clear flow did not remove the current metrics snapshot before re-tracking: ${JSON.stringify(result)}`);
        assert(result.eventNames.join(",") === "page_view,first_interaction,cta_click", `Clear flow did not rebuild pending core events after storage reset: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Clear flow did not preserve the later tracked event after rebuilding state: ${JSON.stringify(result)}`);
        return { name: "clearResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          clearManagedStorage();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events
              .filter(event => event.event_name === "page_view" || event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.eventNames.join(",") === "page_view,status_success_signal,cta_click:probe", `Clear flow did not restore the active status element signal after storage reset: ${JSON.stringify(result)}`);
        return { name: "clearStatusResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          clearManagedStorage();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events
              .filter(event => event.event_name === "page_view" || event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.eventNames.join(",") === "page_view,status_success_signal,cta_click:probe", `Clear flow did not restore the active toast status signal after storage reset: ${JSON.stringify(result)}`);
        return { name: "clearToastResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          const restored = restoreManagedStorage({
            [progressKey]: JSON.stringify({
              "mission-ethics": { _started: true }
            })
          });
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            restored,
            progressRaw: localStorage.getItem(progressKey),
            eventNames: events.map(event => event.event_name),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.restored === 1, `Restore flow did not write the imported snapshot: ${JSON.stringify(result)}`);
        assert((result.progressRaw || "").includes("mission-ethics"), `Restore flow did not preserve the imported progress snapshot: ${JSON.stringify(result)}`);
        assert(result.eventNames.join(",") === "page_view,first_interaction,cta_click", `Restore flow did not rebuild pending core events after replacing storage: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Restore flow did not preserve the later tracked event after rebuilding state: ${JSON.stringify(result)}`);
        return { name: "restoreResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          restoreManagedStorage({
            [progressKey]: JSON.stringify({
              "mission-ethics": { _started: true }
            })
          });
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events
              .filter(event => event.event_name === "page_view" || event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.eventNames.join(",") === "page_view,status_success_signal,cta_click:probe", `Restore flow did not restore the active status element signal after replacing storage: ${JSON.stringify(result)}`);
        return { name: "restoreStatusResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          restoreManagedStorage({
            [progressKey]: JSON.stringify({
              "mission-ethics": { _started: true }
            })
          });
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events
              .filter(event => event.event_name === "page_view" || event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.eventNames.join(",") === "page_view,status_success_signal,cta_click:probe", `Restore flow did not restore the active toast status signal after replacing storage: ${JSON.stringify(result)}`);
        return { name: "restoreToastResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          restoreManagedStorage({
            [progressKey]: JSON.stringify({
              "mission-ethics": { _started: true }
            })
          });
          refreshDashboard();
          window.clearToasts?.();
          window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true, suppressActiveStatus: true });
          window.showToast("已导入 1 条学习数据", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            statusTexts: events
              .filter(event => event.event_name === "status_success_signal")
              .map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.statusTexts.join("|") === "已导入 1 条学习数据", `Successful import should replace prior visible toasts with its own success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Successful import toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Successful import should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importSuccessDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.confirm = () => true;
          window.showToast("学习数据已导出", "success", 3000);
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "import.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({
            p00_mission_progress: JSON.stringify({
              "mission-ethics": { _started: true }
            })
          }))
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("已导入 1 条学习数据"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.statusTexts.join("|") === "已导入 1 条学习数据", `Import input handler should replace prior visible toasts with its own success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Import input handler should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Import input handler should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importInputDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.confirm = () => true;
          window.showToast("学习数据已导出", "success", 3000);
          window.__pmOriginalReplaceToasts = window.replaceToasts;
          window.replaceToasts = undefined;
        });
        try {
          await page.waitForFunction(selector => document.querySelectorAll(selector).length === 1, VISIBLE_TOAST_SELECTOR);
          await page.setInputFiles("#importInput", {
            name: "import.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({
              p00_mission_progress: JSON.stringify({
                "mission-ethics": { _started: true }
              })
            }))
          });
          await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("已导入 1 条学习数据"));
          const result = await page.evaluate(() => {
            const eventsKey = "pm_metrics_events_P00-dashboard";
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          });
          assert(result.statusTexts.join("|") === "已导入 1 条学习数据", `Import success fallback should replace the prior tracked toast with the imported success signal after storage restore: ${JSON.stringify(result)}`);
          assert(result.ctaClickCount === 1, `Import success fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
          assert(result.visibleToastCount === 1, `Import success fallback should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
          return { name: "importInputFallbackWithoutReplaceToastsCase", status: "passed" };
        } finally {
          await page.evaluate(() => {
            window.replaceToasts = window.__pmOriginalReplaceToasts;
            delete window.__pmOriginalReplaceToasts;
          });
        }
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.confirm = () => false;
          window.showToast("学习数据已导出", "success", 3000);
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "cancelled-import.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({
            p00_mission_progress: JSON.stringify({
              "mission-ethics": { _started: true }
            })
          }))
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("已取消导入"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
            cancelSignalCount: events.filter(event =>
              (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
              && event.status_text === "已取消导入"
            ).length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            progressRaw: localStorage.getItem("p00_mission_progress"),
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Cancelled import should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.cancelSignalCount === 0, `Cancelled import info toast should remain untracked: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Cancelled import toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.progressRaw === null, `Cancelled import should not modify stored progress: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Cancelled import should leave exactly one visible info toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importCancelDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.confirm = () => false;
          window.showToast("学习数据已导出", "success", 3000);
          window.__pmOriginalReplaceToasts = window.replaceToasts;
          window.replaceToasts = undefined;
        });
        try {
          await page.waitForFunction(selector => document.querySelectorAll(selector).length === 1, VISIBLE_TOAST_SELECTOR);
          await page.setInputFiles("#importInput", {
            name: "cancelled-import.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({
              p00_mission_progress: JSON.stringify({
                "mission-ethics": { _started: true }
              })
            }))
          });
          await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("已取消导入"));
          const result = await page.evaluate(() => {
            const eventsKey = "pm_metrics_events_P00-dashboard";
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              cancelSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "已取消导入"
              ).length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              progressRaw: localStorage.getItem("p00_mission_progress"),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          });
          assert(result.priorToastCount === 1, `Cancelled import fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
          assert(result.cancelSignalCount === 0, `Cancelled import fallback info toast should remain untracked: ${JSON.stringify(result)}`);
          assert(result.ctaClickCount === 1, `Cancelled import fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
          assert(result.progressRaw === null, `Cancelled import fallback should not modify stored progress: ${JSON.stringify(result)}`);
          assert(result.visibleToastCount === 1, `Cancelled import fallback should leave exactly one visible info toast after clearing stale toasts: ${JSON.stringify(result)}`);
          return { name: "importCancelFallbackWithoutReplaceToastsCase", status: "passed" };
        } finally {
          await page.evaluate(() => {
            window.replaceToasts = window.__pmOriginalReplaceToasts;
            delete window.__pmOriginalReplaceToasts;
          });
        }
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.showToast("学习数据已导出", "success", 3000);
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "broken-import.json",
          mimeType: "application/json",
          buffer: Buffer.from("{not-json")
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("导入失败：文件不是有效的 JSON"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
            importErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导入失败：文件不是有效的 JSON").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Invalid import should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.importErrorCount === 1, `Invalid import should record exactly one error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Invalid import toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Invalid import should leave exactly one visible error toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importInvalidJsonDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.showToast("学习数据已导出", "success", 3000);
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.evaluate(() => {
          window.__pmOriginalReplaceToasts = window.replaceToasts;
          window.replaceToasts = undefined;
        });
        try {
          await page.setInputFiles("#importInput", {
            name: "broken-import.json",
            mimeType: "application/json",
            buffer: Buffer.from("{not-json")
          });
          await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("导入失败：文件不是有效的 JSON"));
          const result = await page.evaluate(() => {
            const eventsKey = "pm_metrics_events_P00-dashboard";
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              importErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导入失败：文件不是有效的 JSON").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          });
          assert(result.priorToastCount === 1, `Invalid import fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
          assert(result.importErrorCount === 1, `Invalid import fallback should record exactly one error signal: ${JSON.stringify(result)}`);
          assert(result.ctaClickCount === 1, `Invalid import fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
          assert(result.visibleToastCount === 1, `Invalid import fallback should leave exactly one visible error toast after clearing stale toasts: ${JSON.stringify(result)}`);
          return { name: "importInvalidJsonFallbackWithoutReplaceToastsCase", status: "passed" };
        } finally {
          await page.evaluate(() => {
            window.replaceToasts = window.__pmOriginalReplaceToasts;
            delete window.__pmOriginalReplaceToasts;
          });
        }
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          localStorage.clear();
          window.showToast("学习数据已导出", "success", 3000);
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "empty-import.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({ unrelated_key: true }))
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("导入失败：未找到可恢复的学习数据"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
            importErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导入失败：未找到可恢复的学习数据").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Empty import should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.importErrorCount === 1, `Empty import should record exactly one warning/error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Empty import toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Empty import should leave exactly one visible warning toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importEmptyDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, "{not-json");
          window.confirm = () => true;
          window.showToast("学习数据已导出", "success", 3000);
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "snapshot-failed-import.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({
            p00_mission_progress: JSON.stringify({
              "mission-ai-content": { _started: true }
            })
          }))
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("导入失败：当前浏览器存储存在不可读数据，无法安全覆盖，请先清理后重试"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
            importErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导入失败：当前浏览器存储存在不可读数据，无法安全覆盖，请先清理后重试").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            progressRaw: localStorage.getItem("p00_mission_progress"),
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Import snapshot failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.importErrorCount === 1, `Import snapshot failure should record exactly one snapshot error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Import snapshot failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.progressRaw === "{not-json", `Import snapshot failure should preserve the original unreadable progress state: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Import snapshot failure should leave exactly one visible error toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importSnapshotFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          window.confirm = () => true;
          window.showToast("学习数据已导出", "success", 3000);

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey && String(value).includes("mission-ai-content")) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "restore-write-fail-import.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({
            p00_mission_progress: JSON.stringify({
              "mission-ai-content": { _started: true }
            })
          }))
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("导入失败：浏览器存储写入失败，已保留原有数据"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
            importErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导入失败：浏览器存储写入失败，已保留原有数据").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            progressRaw: localStorage.getItem("p00_mission_progress"),
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Import write failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.importErrorCount === 1, `Import write failure should record exactly one restore error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Import write failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert((result.progressRaw || "").includes("mission-ethics"), `Import write failure should preserve the original progress snapshot after rollback: ${JSON.stringify(result)}`);
        assert(!(result.progressRaw || "").includes("mission-ai-content"), `Import write failure should not leave partially imported progress behind: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Import write failure should leave exactly one visible error toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importWriteFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(progressKey, JSON.stringify({
            "mission-ethics": { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "import-rollback",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.confirm = () => true;
          window.showToast("学习数据已导出", "success", 3000);

          const originalRemoveItem = Storage.prototype.removeItem;
          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.removeItem = function (key) {
            if (key === eventsKey) {
              return;
            }
            return originalRemoveItem.call(this, key);
          };
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey && String(value).includes("mission-ethics")) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };
        });
        await page.waitForFunction(() => document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length === 1);
        await page.setInputFiles("#importInput", {
          name: "rollback-failed-import.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify({
            p00_mission_progress: JSON.stringify({
              "mission-ai-content": { _started: true }
            })
          }))
        });
        await page.waitForFunction(() => document.querySelector("#toastContainer")?.textContent?.includes("导入失败：浏览器存储异常，恢复过程中可能仅部分保留原有数据"));
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
            importErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "导入失败：浏览器存储异常，恢复过程中可能仅部分保留原有数据").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            progressRaw: localStorage.getItem("p00_mission_progress"),
            eventsRaw: localStorage.getItem(eventsKey),
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.priorToastCount === 1, `Import rollback failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.importErrorCount === 1, `Import rollback failure should record exactly one rollback error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Import rollback failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.progressRaw === null, `Import rollback failure should expose partial rollback by leaving the original progress unrestored: ${JSON.stringify(result)}`);
        assert((result.eventsRaw || "").includes("\"page_view\""), `Import rollback failure should preserve the metric snapshot entry that never cleared: ${JSON.stringify(result)}`);
        assert(!(result.progressRaw || "").includes("mission-ai-content"), `Import rollback failure should not leave imported progress behind: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Import rollback failure should leave exactly one visible error toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "importRollbackFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "bogus_event",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "broken",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          refreshDashboard();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events.map(event => event.event_name),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.eventNames.join(",") === "page_view,cta_click", `Dashboard repair did not resync pending core metrics after rewriting invalid storage: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Dashboard repair did not preserve the later tracked event after storage rewrite: ${JSON.stringify(result)}`);
        return { name: "repairResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "bogus_event",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "broken",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          refreshDashboard();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events
              .filter(event => event.event_name === "page_view" || event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.eventNames.join(",") === "page_view,status_success_signal,cta_click:probe", `Dashboard repair did not restore the active status signal after rewriting invalid storage: ${JSON.stringify(result)}`);
        return { name: "repairStatusResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "bogus_event",
            event_time: new Date().toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "broken",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          refreshDashboard();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events
              .filter(event => event.event_name === "page_view" || event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.eventNames.join(",") === "page_view,status_success_signal,cta_click:probe", `Dashboard repair did not restore the active toast status signal after rewriting invalid storage: ${JSON.stringify(result)}`);
        return { name: "repairToastStatusResyncCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskName = "dashboard_mission_mission_ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === taskKey) throw new Error("forced marker failure");
            return originalSetItem.call(this, key, value);
          };

          try {
            window.ensureMissionStarted(missionId);
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }

          window.pmMetrics.markTaskComplete(taskName, { mission_id: missionId });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          const taskComplete = [...events].reverse().find(event => event.event_name === "task_complete" && event.task_name === taskName);
          return {
            taskCompleteDuration: taskComplete ? taskComplete.task_duration_ms : null,
            taskStartCount: events.filter(event => event.event_name === "task_start" && event.task_name === taskName).length
          };
        });
        assert(result.taskStartCount === 1, `Duration fallback case expected one task_start event, got ${result.taskStartCount}`);
        assert(Number.isFinite(result.taskCompleteDuration), `Duration fallback did not recover task duration: ${result.taskCompleteDuration}`);
        return { name: "taskDurationFallbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify([
            {
              event_name: "task_start",
              task_name: taskName,
              event_time: new Date(Date.now() - 5000).toISOString(),
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "later-start",
              app_version: "pm-v1",
              page_path: "/"
            },
            {
              event_name: "task_complete",
              task_name: taskName,
              event_time: new Date(Date.now() - 10000).toISOString(),
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "earlier-complete",
              app_version: "pm-v1",
              page_path: "/"
            }
          ]));
          window.pmMetrics.markTaskComplete(taskName, { mission_id: "mission-ethics" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          const taskComplete = [...events].reverse().find(event => event.event_name === "task_complete" && event.mission_id === "mission-ethics");
          return {
            taskCompleteDuration: taskComplete ? taskComplete.task_duration_ms : null,
            taskCompleteCount: events.filter(event => event.event_name === "task_complete" && event.task_name === taskName).length
          };
        });
        assert(result.taskCompleteCount >= 2, `Out-of-order duration case expected a new task_complete event, got ${result.taskCompleteCount}`);
        assert(Number.isFinite(result.taskCompleteDuration), `Out-of-order duration fallback did not recover task duration: ${result.taskCompleteDuration}`);
        return { name: "outOfOrderTaskDurationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "dashboard_mission_mission_ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const now = Date.now();
          localStorage.clear();
          localStorage.setItem(taskKey, String(now - 60000));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_complete",
            task_name: taskName,
            event_time: new Date(now - 1000).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "stale-terminal",
            app_version: "pm-v1",
            page_path: "/"
          }]));

          window.refreshDashboard();
          const markerAfterRepair = localStorage.getItem(taskKey);
          window.pmMetrics.markTaskComplete(taskName, { mission_id: "mission-ethics" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          const latest = [...events].reverse().find(event => event.event_name === "task_complete" && event.mission_id === "mission-ethics");
          return {
            markerAfterRepair,
            taskCompleteDuration: latest ? latest.task_duration_ms : null
          };
        });
        assert(result.markerAfterRepair === null, `Stale task-start marker was not pruned: ${result.markerAfterRepair}`);
        assert(result.taskCompleteDuration === null, `Stale task-start marker still affected duration: ${result.taskCompleteDuration}`);
        return { name: "staleMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "dashboard_mission_mission_ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const terminalTime = Date.now() - 1000;
          localStorage.clear();
          localStorage.setItem(taskKey, String(terminalTime));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_complete",
            task_name: taskName,
            event_time: new Date(terminalTime).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "equal-terminal",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          const markerAfterRepair = localStorage.getItem(taskKey);
          window.pmMetrics.markTaskComplete(taskName, { mission_id: "mission-ethics" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          const latest = [...events].reverse().find(event => event.event_name === "task_complete" && event.mission_id === "mission-ethics");
          return {
            markerAfterRepair,
            taskCompleteDuration: latest ? latest.task_duration_ms : null
          };
        });
        assert(result.markerAfterRepair === null, `Equal-time task-start marker was not pruned: ${result.markerAfterRepair}`);
        assert(result.taskCompleteDuration === null, `Equal-time task-start marker still affected duration: ${result.taskCompleteDuration}`);
        return { name: "equalTimeMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "dashboard_mission_mission_ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - (9 * 60 * 60 * 1000)));
          window.pmMetrics.markTaskComplete(taskName, { mission_id: "mission-ethics" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          const latest = [...events].reverse().find(event => event.event_name === "task_complete" && event.mission_id === "mission-ethics");
          return {
            taskCompleteDuration: latest ? latest.task_duration_ms : null
          };
        });
        assert(result.taskCompleteDuration === null, `Stale task-start marker without terminal event still affected duration: ${result.taskCompleteDuration}`);
        return { name: "staleActiveMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const eventsKey = "pm_metrics_events_P01-model-compare";
          const now = Date.now();
          localStorage.clear();
          localStorage.setItem(taskKey, String(now - 60000));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_complete",
            task_name: "tool_probe_task",
            event_time: new Date(now - 1000).toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "tool-terminal",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          return {
            markerAfterRepair: localStorage.getItem(taskKey),
            toolEventsCount: JSON.parse(localStorage.getItem(eventsKey) || "[]").length
          };
        });
        assert(result.markerAfterRepair === null, `Tool-project stale marker was not pruned: ${result.markerAfterRepair}`);
        assert(result.toolEventsCount === 1, `Tool-project metrics were unexpectedly modified: ${result.toolEventsCount}`);
        return { name: "toolProjectStaleMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P01::tool_probe_task";
          const eventsKey = "pm_metrics_events_P01-model-compare";
          const now = Date.now();
          localStorage.clear();
          localStorage.setItem(taskKey, String(now - 60000));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_complete",
            task_name: "tool_probe_task",
            event_time: new Date(now - 1000).toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "alias-terminal",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          return {
            markerAfterRepair: localStorage.getItem(taskKey)
          };
        });
        assert(result.markerAfterRepair === null, `Legacy plain task-start key was not reconciled against canonical metrics key: ${result.markerAfterRepair}`);
        return { name: "legacyTaskKeyAliasCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_task_start_P01::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const timestamp = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(plainKey, String(timestamp));
          window.refreshDashboard();
          return {
            plainAfterRepair: localStorage.getItem(plainKey),
            canonicalAfterRepair: localStorage.getItem(canonicalKey)
          };
        });
        assert(result.plainAfterRepair === null, `Legacy plain task-start key was not migrated away: ${result.plainAfterRepair}`);
        assert(result.canonicalAfterRepair !== null, "Canonical task-start key was not created from legacy plain key");
        return { name: "legacyTaskKeyMigrationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_task_start_P01::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const timestamp = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(plainKey, String(timestamp));

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === plainKey) return;
            return originalRemoveItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            return {
              plainAfterRepair: localStorage.getItem(plainKey),
              canonicalAfterRepair: localStorage.getItem(canonicalKey)
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.plainAfterRepair === "NaN", `Silent legacy task-key remove did not neutralize the plain key: ${JSON.stringify(result)}`);
        assert(result.canonicalAfterRepair !== null, "Canonical task-start key was not created while neutralizing a silent plain-key remove");
        return { name: "legacyTaskKeySilentRemoveCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_task_start_P01::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const timestamp = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(plainKey, String(timestamp));
          localStorage.setItem(canonicalKey, String(timestamp));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === canonicalKey) {
              throw new Error("forced canonical task key read failure");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            return {
              plainAfterRepair: localStorage.getItem(plainKey)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.plainAfterRepair !== null, "Readable legacy plain task-start key was lost when canonical alias was unreadable");
        return { name: "legacyTaskKeyUnreadableCanonicalCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_task_start_P01::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const timestamp = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(plainKey, String(timestamp));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === canonicalKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.refreshDashboard();
            return {
              plainAfterRepair: localStorage.getItem(plainKey),
              canonicalAfterRepair: localStorage.getItem(canonicalKey)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.plainAfterRepair !== null, "Legacy plain task-start key was lost after silent canonical migration no-op");
        assert(result.canonicalAfterRepair === null, `Canonical task-start key should not exist after silent migration no-op: ${result.canonicalAfterRepair}`);
        return { name: "legacyTaskKeyMigrationSilentWriteFailCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_task_start_P01::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const freshTimestamp = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(plainKey, String(freshTimestamp));
          localStorage.setItem(canonicalKey, String(Date.now() + (24 * 60 * 60 * 1000)));
          window.refreshDashboard();
          return {
            plainAfterRepair: localStorage.getItem(plainKey),
            canonicalAfterRepair: localStorage.getItem(canonicalKey)
          };
        });
        assert(result.plainAfterRepair === null, `Legacy plain task-start key was not removed after mixed-validity migration: ${result.plainAfterRepair}`);
        assert(result.canonicalAfterRepair !== null, "Canonical task-start key was lost during mixed-validity migration");
        return { name: "legacyTaskKeyMixedValidityCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const sharedEvent = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "migrated-event",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([sharedEvent]));
          localStorage.setItem(canonicalKey, JSON.stringify([sharedEvent]));
          window.refreshDashboard();
          const canonicalEvents = JSON.parse(localStorage.getItem(canonicalKey) || "[]");
          return {
            plainAfterRepair: localStorage.getItem(plainKey),
            canonicalCount: canonicalEvents.length,
            canonicalSessionIds: canonicalEvents.map(event => event.session_id),
            backupKeys: Object.keys(window.buildExportPayload().data || {})
          };
        });
        assert(result.plainAfterRepair === null, `Legacy plain metrics key was not migrated away: ${result.plainAfterRepair}`);
        assert(result.canonicalCount === 1, `Canonical metrics key did not dedupe merged legacy events: ${result.canonicalCount}`);
        assert(result.canonicalSessionIds[0] === "migrated-event", `Canonical metrics key kept unexpected merged data: ${JSON.stringify(result.canonicalSessionIds)}`);
        assert(!result.backupKeys.includes("pm_metrics_events_P01"), `Legacy plain metrics key leaked into export after migration: ${JSON.stringify(result.backupKeys)}`);
        assert(result.backupKeys.includes("pm_metrics_events_P01-model-compare"), `Canonical metrics key missing after migration: ${JSON.stringify(result.backupKeys)}`);
        return { name: "legacyMetricKeyMigrationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const sharedTime = new Date().toISOString();
          const plainEvent = {
            event_name: "page_view",
            event_time: sharedTime,
            project_id: "P01",
            project_cluster: "probe",
            session_id: "legacy-project-id",
            app_version: "pm-v1",
            page_path: "/"
          };
          const canonicalEvent = {
            event_name: "page_view",
            event_time: sharedTime,
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "legacy-project-id",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([plainEvent]));
          localStorage.setItem(canonicalKey, JSON.stringify([canonicalEvent]));
          window.refreshDashboard();
          const canonicalEvents = JSON.parse(localStorage.getItem(canonicalKey) || "[]");
          return {
            plainAfterRepair: localStorage.getItem(plainKey),
            canonicalCount: canonicalEvents.length,
            canonicalProjectIds: canonicalEvents.map(event => event.project_id)
          };
        });
        assert(result.plainAfterRepair === null, `Legacy plain metrics key with legacy project_id was not migrated away: ${result.plainAfterRepair}`);
        assert(result.canonicalCount === 1, `Legacy/canonical event merge did not dedupe on canonicalized project_id: ${result.canonicalCount}`);
        assert(result.canonicalProjectIds.length === 1 && result.canonicalProjectIds[0] === "P01-model-compare", `Canonicalized event retained wrong project_id: ${JSON.stringify(result.canonicalProjectIds)}`);
        return { name: "legacyMetricProjectIdNormalizationCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const plainEvent = {
            event_name: "page_view",
            event_time: new Date(Date.now() - 2000).toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "plain-export",
            app_version: "pm-v1",
            page_path: "/"
          };
          const canonicalEvent = {
            event_name: "cta_click",
            event_time: new Date(Date.now() - 1000).toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "canonical-export",
            app_version: "pm-v1",
            page_path: "/",
            control_id: "probe"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([plainEvent]));
          localStorage.setItem(canonicalKey, JSON.stringify([canonicalEvent]));
          const payload = window.buildExportPayload();
          const normalized = window.normalizeImportedSnapshot({
            [plainKey]: JSON.stringify([plainEvent]),
            [canonicalKey]: JSON.stringify([canonicalEvent])
          });
          return {
            exportKeys: Object.keys(payload.data || {}),
            exportedEvents: JSON.parse(payload.data[canonicalKey] || "[]").map(event => event.session_id),
            normalizedKeys: Object.keys(normalized),
            normalizedEvents: JSON.parse(normalized[canonicalKey] || "[]").map(event => event.session_id)
          };
        });
        assert(!result.exportKeys.includes("pm_metrics_events_P01"), `Export payload still included legacy plain metrics key: ${JSON.stringify(result.exportKeys)}`);
        assert(result.exportKeys.includes("pm_metrics_events_P01-model-compare"), `Export payload missing canonical metrics key: ${JSON.stringify(result.exportKeys)}`);
        assert(result.exportedEvents.join(",") === "plain-export,canonical-export", `Export payload did not merge legacy/canonical metrics correctly: ${JSON.stringify(result.exportedEvents)}`);
        assert(!result.normalizedKeys.includes("pm_metrics_events_P01"), `Import normalization still included legacy plain metrics key: ${JSON.stringify(result.normalizedKeys)}`);
        assert(result.normalizedKeys.includes("pm_metrics_events_P01-model-compare"), `Import normalization missing canonical metrics key: ${JSON.stringify(result.normalizedKeys)}`);
        assert(result.normalizedEvents.join(",") === "plain-export,canonical-export", `Import normalization did not merge legacy/canonical metrics correctly: ${JSON.stringify(result.normalizedEvents)}`);
        return { name: "legacyMetricExportImportCanonicalCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const exportKey = "pm_metrics_events_P01-model-compare";
          const timestamp = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(taskKey, String(timestamp));
          const payload = window.buildExportPayload();
          const events = JSON.parse(payload.data[exportKey] || "[]");
          return {
            exportKeys: Object.keys(payload.data || {}),
            eventNames: events.map(event => event.event_name),
            taskNames: events.map(event => event.task_name)
          };
        });
        assert(result.exportKeys.includes("pm_metrics_events_P01-model-compare"), `Export payload missing canonical metrics key for marker-only task start: ${JSON.stringify(result.exportKeys)}`);
        assert(result.eventNames.join(",") === "task_start", `Export payload did not synthesize task_start from marker-only state: ${JSON.stringify(result)}`);
        assert(result.taskNames.join(",") === "tool_probe_task", `Export payload synthesized task_start for the wrong task: ${JSON.stringify(result)}`);
        return { name: "taskStartExportBackfillCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_task_start_P01::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const olderTimestamp = Date.now() - 4000;
          const newerTimestamp = Date.now() - 2000;
          const exportKey = "pm_metrics_events_P01-model-compare";
          localStorage.clear();
          localStorage.setItem(plainKey, String(olderTimestamp));
          localStorage.setItem(canonicalKey, String(newerTimestamp));
          const payload = window.buildExportPayload();
          const events = JSON.parse(payload.data[exportKey] || "[]");
          return {
            eventNames: events.map(event => event.event_name),
            eventTimes: events.map(event => event.event_time),
            newerEventTime: new Date(newerTimestamp).toISOString()
          };
        });
        assert(result.eventNames.join(",") === "task_start", `Export payload did not synthesize exactly one task_start across alias markers: ${JSON.stringify(result)}`);
        assert(result.eventTimes[0] === result.newerEventTime, `Export payload did not choose the freshest alias marker timestamp: ${JSON.stringify(result)}`);
        return { name: "taskStartExportLatestMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          const exportKey = "pm_metrics_events_P01-model-compare";
          const markerTime = Date.now() - (60 * 60 * 1000);
          const base = Date.now() - (30 * 60 * 1000);
          const filler = Array.from({ length: 500 }, (_, index) => ({
            event_name: "cta_click",
            event_time: new Date(base + (index * 1000)).toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: `fill-${index}`,
            app_version: "pm-v1",
            page_path: "/",
            control_id: `b${index}`
          }));
          localStorage.clear();
          localStorage.setItem(taskKey, String(markerTime));
          localStorage.setItem(exportKey, JSON.stringify(filler));
          const payload = window.buildExportPayload();
          const events = JSON.parse(payload.data[exportKey] || "[]");
          return {
            count: events.length,
            taskEvents: events.filter(event => event.task_name === "tool_probe_task").map(event => event.event_name)
          };
        });
        assert(result.count === 500, `Export retention changed total retained metric count unexpectedly: ${result.count}`);
        assert(result.taskEvents.join(",") === "task_start", `Export retention trimmed away synthesized task_start under 500-event cap: ${JSON.stringify(result)}`);
        return { name: "taskStartExportRetentionCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const event = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "readable-canonical",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([event]));
          localStorage.setItem(canonicalKey, JSON.stringify([event]));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === plainKey) {
              throw new Error("forced plain alias read failure");
            }
            return originalGetItem.call(this, key);
          };

          try {
            const status = window.getBackupStorageSnapshotStatus();
            return {
              unreadable: status.unreadable,
              readable: status.readable,
              exportKeys: Object.keys(window.buildExportPayload().data || {})
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.readable === true && result.unreadable === 0, `Backup status still counted unreadable alias despite canonical readable data: ${JSON.stringify(result)}`);
        assert(result.exportKeys.includes("pm_metrics_events_P01-model-compare"), `Canonical export payload missing under unreadable alias condition: ${JSON.stringify(result.exportKeys)}`);
        return { name: "legacyMetricUnreadableAliasCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const event = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "readable-canonical-repair",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([event]));
          localStorage.setItem(canonicalKey, JSON.stringify([event]));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === plainKey) {
              throw new Error("forced plain alias read failure");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
            return {
              plainExistsAfterRepair: keys.includes(plainKey)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.plainExistsAfterRepair === true, "Unreadable legacy alias key was removed during startup repair");
        return { name: "legacyMetricUnreadableAliasRepairCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const event = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "readable-alias-only",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([event]));
          localStorage.setItem(canonicalKey, JSON.stringify([event]));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === canonicalKey) {
              throw new Error("forced canonical key read failure");
            }
            return originalGetItem.call(this, key);
          };

          try {
            const status = window.getBackupStorageSnapshotStatus();
            return {
              unreadable: status.unreadable,
              readable: status.readable
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.readable === true && result.unreadable === 1, `Backup status did not treat unreadable canonical key as fatal: ${JSON.stringify(result)}`);
        return { name: "legacyMetricUnreadableCanonicalCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const event = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "readable-legacy-under-unreadable-canonical",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([event]));
          localStorage.setItem(canonicalKey, JSON.stringify([event]));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === canonicalKey) {
              throw new Error("forced canonical metrics key read failure");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            return {
              plainAfterRepair: localStorage.getItem(plainKey)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.plainAfterRepair !== null, "Readable legacy plain metrics key was lost when canonical alias was unreadable");
        return { name: "legacyMetricUnreadableCanonicalRepairCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const sharedEvent = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "migration-write-fail",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([sharedEvent]));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === canonicalKey) {
              throw new Error("forced canonical migration failure");
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.refreshDashboard();
            return {
              plainAfterRepair: localStorage.getItem(plainKey),
              canonicalAfterRepair: localStorage.getItem(canonicalKey)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.plainAfterRepair !== null, "Legacy plain metrics key was lost after canonical migration write failure");
        assert(result.canonicalAfterRepair === null, `Canonical metrics key should not exist after forced migration write failure: ${result.canonicalAfterRepair}`);
        return { name: "legacyMetricMigrationWriteFailCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const sharedEvent = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "silent-canonical-migration-failure",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([sharedEvent]));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === canonicalKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.refreshDashboard();
            return {
              plainAfterRepair: localStorage.getItem(plainKey),
              canonicalAfterRepair: localStorage.getItem(canonicalKey)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.plainAfterRepair !== null, "Legacy plain metrics key was lost after silent canonical migration no-op");
        assert(result.canonicalAfterRepair === null, `Canonical metrics key should not exist after silent migration no-op: ${result.canonicalAfterRepair}`);
        return { name: "legacyMetricMigrationSilentWriteFailCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const plainKey = "pm_metrics_events_P01";
          const canonicalKey = "pm_metrics_events_P01-model-compare";
          const sharedEvent = {
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "dedupe-under-write-failure",
            app_version: "pm-v1",
            page_path: "/"
          };
          localStorage.clear();
          localStorage.setItem(plainKey, JSON.stringify([sharedEvent]));
          localStorage.setItem(canonicalKey, JSON.stringify([sharedEvent]));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === canonicalKey) {
              throw new Error("forced canonical migration failure");
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.refreshDashboard();
            return {
              totalEvents: document.getElementById("sTotalEvents")?.textContent || "",
              toolsUsed: document.getElementById("sToolsUsed")?.textContent || "",
              toolCount: MODULES.flatMap((module) => module.tools.map((tool) => tool.id)).length
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.totalEvents === "1", `Grouped metrics entries still double-counted duplicate legacy/canonical events: ${result.totalEvents}`);
        assert(result.toolsUsed === `1/${result.toolCount}`, `Grouped metrics entries changed tool-used counting unexpectedly: ${result.toolsUsed}`);
        return { name: "legacyMetricStatsDedupeCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const unknownTaskKey = "pm_metrics_task_start_P99::bogus_task";
          const malformedTaskKey = "pm_metrics_task_start_P01";
          localStorage.clear();
          localStorage.setItem(unknownTaskKey, String(Date.now()));
          localStorage.setItem(malformedTaskKey, String(Date.now()));
          window.refreshDashboard();
          return {
            unknownAfterRepair: localStorage.getItem(unknownTaskKey),
            malformedAfterRepair: localStorage.getItem(malformedTaskKey)
          };
        });
        assert(result.unknownAfterRepair === null, `Unknown-project task-start key was not pruned: ${result.unknownAfterRepair}`);
        assert(result.malformedAfterRepair === null, `Malformed task-start key was not pruned: ${result.malformedAfterRepair}`);
        return { name: "invalidTaskKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const junkKey = "pm_metrics_task_start_P01-not-real::tool_probe_task";
          const canonicalKey = "pm_metrics_task_start_P01-model-compare::tool_probe_task";
          localStorage.clear();
          localStorage.setItem(junkKey, String(Date.now() - 2000));
          window.refreshDashboard();
          return {
            junkAfterRepair: localStorage.getItem(junkKey),
            canonicalAfterRepair: localStorage.getItem(canonicalKey)
          };
        });
        assert(result.junkAfterRepair === null, `Suffixed junk task-start key was not pruned: ${result.junkAfterRepair}`);
        assert(result.canonicalAfterRepair === null, `Suffixed junk task-start key incorrectly migrated into canonical key: ${result.canonicalAfterRepair}`);
        return { name: "suffixedJunkTaskKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const junkKey = "pm_metrics_events_P01junk";
          localStorage.clear();
          localStorage.setItem(junkKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01",
            project_cluster: "probe",
            session_id: "junk",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          return {
            junkAfterRepair: localStorage.getItem(junkKey),
            statTools: document.getElementById("statTools")?.textContent || "",
            backupKeys: Object.keys(window.buildExportPayload().data || {})
          };
        });
        assert(result.junkAfterRepair === null, `Prefixed junk metric key was not pruned: ${result.junkAfterRepair}`);
        assert(result.statTools === "0", `Prefixed junk metric key still affected used-tool stats: ${result.statTools}`);
        assert(!result.backupKeys.includes("pm_metrics_events_P01junk"), `Prefixed junk metric key leaked into export payload: ${JSON.stringify(result.backupKeys)}`);
        return { name: "junkMetricKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const junkKey = "pm_metrics_events_P01junk";
          localStorage.clear();
          localStorage.setItem(junkKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01",
            project_cluster: "probe",
            session_id: "junk-silent-remove",
            app_version: "pm-v1",
            page_path: "/"
          }]));

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === junkKey) return;
            return originalRemoveItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            return {
              junkAfterRepair: localStorage.getItem(junkKey),
              statTools: document.getElementById("statTools")?.textContent || "",
              backupKeys: Object.keys(window.buildExportPayload().data || {})
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.junkAfterRepair === "[]", `Silent junk-metric remove did not neutralize the key: ${JSON.stringify(result)}`);
        assert(result.statTools === "0", `Neutralized junk metric key still affected used-tool stats: ${result.statTools}`);
        assert(!result.backupKeys.includes("pm_metrics_events_P01junk"), `Neutralized junk metric key leaked into export payload: ${JSON.stringify(result.backupKeys)}`);
        return { name: "junkMetricKeySilentRemoveCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const junkKey = "pm_metrics_events_P01-not-real";
          localStorage.clear();
          localStorage.setItem(junkKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-not-real",
            project_cluster: "probe",
            session_id: "junk-suffixed",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          return {
            junkAfterRepair: localStorage.getItem(junkKey),
            statTools: document.getElementById("statTools")?.textContent || "",
            backupKeys: Object.keys(window.buildExportPayload().data || {})
          };
        });
        assert(result.junkAfterRepair === null, `Suffixed junk metric key was not pruned: ${result.junkAfterRepair}`);
        assert(result.statTools === "0", `Suffixed junk metric key still affected used-tool stats: ${result.statTools}`);
        assert(!result.backupKeys.includes("pm_metrics_events_P01-not-real"), `Suffixed junk metric key leaked into export payload: ${JSON.stringify(result.backupKeys)}`);
        return { name: "suffixedJunkMetricKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const validKey = "pm_metrics_events_P01-model-compare";
          localStorage.clear();
          localStorage.setItem(validKey, JSON.stringify([{
            event_name: "page_view",
            event_time: new Date().toISOString(),
            project_id: "P01-model-compare",
            project_cluster: "probe",
            session_id: "valid-suffixed-project",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.refreshDashboard();
          return {
            valueAfterRepair: localStorage.getItem(validKey),
            statTools: document.getElementById("statTools")?.textContent || "",
            backupKeys: Object.keys(window.buildExportPayload().data || {})
          };
        });
        assert(result.valueAfterRepair !== null, "Valid suffixed metric key was incorrectly pruned");
        assert(result.statTools === "1", `Valid suffixed metric key did not count toward used-tool stats: ${result.statTools}`);
        assert(result.backupKeys.includes("pm_metrics_events_P01-model-compare"), `Valid suffixed metric key was omitted from export payload: ${JSON.stringify(result.backupKeys)}`);
        return { name: "suffixedMetricKeyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const newer = new Date(Date.now() - 1000).toISOString();
          const older = new Date(Date.now() - 10000).toISOString();
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([
            {
              event_name: "task_start",
              task_name: "dashboard_mission_mission_ethics",
              event_time: newer,
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "newer-start",
              app_version: "pm-v1",
              page_path: "/"
            },
            {
              event_name: "task_start",
              task_name: "dashboard_mission_mission_ethics",
              event_time: older,
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "older-start",
              app_version: "pm-v1",
              page_path: "/"
            }
          ]));
          const token = JSON.parse(window.getMissionStartSyncToken(missionId));
          return {
            startEventTime: token.startEventTime,
            newer,
            older
          };
        });
        assert(result.startEventTime === result.newer, `Mission start token did not use newest task_start time: ${JSON.stringify(result)}`);
        return { name: "missionStartTokenCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          const absent = window.getMissionTaskStartTimestamp(missionId);

          localStorage.setItem(taskKey, String(Date.now() - 2000));
          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced unreadable mission marker");
            }
            return originalGetItem.call(this, key);
          };

          try {
            return {
              absent,
              unreadable: window.getMissionTaskStartTimestamp(missionId)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.absent === null, `Missing mission marker should resolve to null timestamp: ${JSON.stringify(result)}`);
        assert(result.unreadable === null, `Unreadable mission marker should resolve to null timestamp: ${JSON.stringify(result)}`);
        return { name: "missionMarkerTimestampNullCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          window.openMissionModal(missionId);
          document.getElementById("modalResetBtn").click();
          const progress = JSON.parse(localStorage.getItem("p00_mission_progress") || "{}");
          const taskEvents = JSON.parse(localStorage.getItem(eventsKey) || "[]")
            .filter(event => event.task_name === "dashboard_mission_mission_ethics")
            .map(event => event.event_name);
          return {
            markerAfter: localStorage.getItem(taskKey),
            progressKeys: Object.keys(progress),
            taskEvents
          };
        });
        assert(result.markerAfter === null, `Mission reset did not clear the open task-start marker: ${JSON.stringify(result)}`);
        assert(!result.progressKeys.includes("mission-ethics"), `Mission reset did not clear mission progress state: ${JSON.stringify(result)}`);
        assert(result.taskEvents.join(",") === "task_start", `Mission reset should preserve prior task history without creating terminal events: ${JSON.stringify(result)}`);
        return { name: "missionResetClearsMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.ensureMissionStarted("mission-ethics");
          window.openMissionModal("mission-ethics");
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          document.getElementById("modalResetBtn").click();
          await new Promise(resolve => setTimeout(resolve, 20));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.statusTexts.filter(text => text === "学习数据已导出").length === 1, `Successful reset should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "任务进度已重置").length === 1, `Successful reset should record exactly one reset success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Successful reset toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Successful reset should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionResetDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.ensureMissionStarted("mission-ethics");
          window.openMissionModal("mission-ethics");
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalReplaceToasts = window.replaceToasts;
          window.replaceToasts = undefined;
          try {
            document.getElementById("modalResetBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.replaceToasts = originalReplaceToasts;
          }
        });
        assert(result.statusTexts.filter(text => text === "学习数据已导出").length === 1, `Successful reset fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "任务进度已重置").length === 1, `Successful reset fallback should record exactly one reset success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Successful reset fallback toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Successful reset fallback should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionResetFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          window.markStepDone("mission-ethics", "0");
          await new Promise(resolve => setTimeout(resolve, 20));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.statusTexts.filter(text => text === "旧提示").length === 1, `Step success should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.filter(text => text === "步骤 1 已标记完成").length === 1, `Step success should record exactly one step-complete success signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Step success toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Step success should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionStepDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const mission = MISSIONS.find(item => item.id === missionId);
          const lastStepIndex = (mission?.steps.length || 1) - 1;
          const progress = {};
          progress[missionId] = { _started: true };
          for (let index = 0; index < lastStepIndex; index += 1) {
            progress[missionId]["step" + index] = true;
          }
          localStorage.clear();
          window.saveProgress(progress);
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          window.markStepDone(missionId, String(lastStepIndex));
          await new Promise(resolve => setTimeout(resolve, 20));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.statusTexts.filter(text => text === "旧提示").length === 1, `Mission completion should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.statusTexts.some(text => text.startsWith("任务完成：")), `Mission completion should record a completion toast signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Mission completion toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Mission completion should leave exactly one visible outcome toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionCompletionDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.markStepDone("mission-ethics", "0");
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              saveErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "保存学习进度失败，当前更改未写入浏览器存储。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              progressRaw: localStorage.getItem(progressKey),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.priorToastCount === 1, `Mission step save failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.saveErrorCount === 1, `Mission step save failure should record exactly one persistence error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Mission step save failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.progressRaw === null, `Mission step save failure should not persist partial progress after silent write failure: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Mission step save failure should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionStepSaveFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          window.saveProgress({
            [missionId]: { _started: true }
          });
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey && String(value).includes("\"step0\":true")) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            window.markStepDone(missionId, "0");
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              saveErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "保存学习进度失败，当前更改未写入浏览器存储。").length,
              taskStartCount: events.filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              progressRaw: localStorage.getItem(progressKey),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.priorToastCount === 1, `Mission step update failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.saveErrorCount === 1, `Mission step update failure should record exactly one persistence error signal: ${JSON.stringify(result)}`);
        assert(result.taskStartCount === 1, `Mission step update failure should still persist the mission start event before the later progress save fails: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Mission step update failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert((result.progressRaw || "").includes("\"_started\":true"), `Mission step update failure should preserve the original started state: ${JSON.stringify(result)}`);
        assert(!(result.progressRaw || "").includes("\"step0\":true"), `Mission step update failure should not persist the failed step update: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Mission step update failure should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionStepUpdateFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const progressKey = "p00_mission_progress";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          window.openMissionModal(missionId);
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === progressKey) {
              return;
            }
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("modalResetBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              saveErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "保存学习进度失败，当前更改未写入浏览器存储。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              progressRaw: localStorage.getItem(progressKey),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.priorToastCount === 1, `Mission reset save failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.saveErrorCount === 1, `Mission reset save failure should record exactly one persistence error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Mission reset save failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert((result.progressRaw || "").includes("mission-ethics"), `Mission reset save failure should preserve the original mission progress after silent removeItem failure: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Mission reset save failure should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionResetSaveFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          window.openMissionModal(missionId);
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === taskKey) throw new Error("forced marker remove failure");
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("modalResetBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              resetErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "任务进度未重置：未能清除该任务的进行中标记，已保留原进度。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              markerAfter: localStorage.getItem(taskKey),
              progressRaw: localStorage.getItem("p00_mission_progress"),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.priorToastCount === 1, `Mission reset rollback warning should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.resetErrorCount === 1, `Mission reset rollback warning should record exactly one rollback-preserved error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Mission reset rollback warning toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.markerAfter !== null, `Mission reset rollback warning case unexpectedly cleared the marker: ${JSON.stringify(result)}`);
        assert((result.progressRaw || "").includes("mission-ethics"), `Mission reset rollback warning case should preserve original progress after rollback: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Mission reset rollback warning should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionResetRollbackDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const progressKey = "p00_mission_progress";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          window.openMissionModal(missionId);
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalRemoveItem = Storage.prototype.removeItem;
          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.removeItem = function (key) {
            if (key === taskKey) throw new Error("forced marker remove failure");
            return originalRemoveItem.call(this, key);
          };
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey && String(value).includes("mission-ethics")) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            document.getElementById("modalResetBtn").click();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "学习数据已导出").length,
              resetErrorCount: events.filter(event => event.event_name === "status_error_signal" && event.status_text === "任务进度重置失败：未能清除进行中标记，且无法恢复原进度。").length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              markerAfter: localStorage.getItem(taskKey),
              progressRaw: localStorage.getItem(progressKey),
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.priorToastCount === 1, `Mission reset rollback failure should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.resetErrorCount === 1, `Mission reset rollback failure should record exactly one rollback-failure error signal: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Mission reset rollback failure toast replacement should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.markerAfter !== null, `Mission reset rollback failure case unexpectedly cleared the marker: ${JSON.stringify(result)}`);
        assert(result.progressRaw === null, `Mission reset rollback failure should surface the lost progress state after failed rollback: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Mission reset rollback failure should leave exactly one visible failure toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "missionResetRollbackFailureDropsPriorToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          window.openMissionModal(missionId);

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === taskKey) throw new Error("forced marker remove failure");
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("modalResetBtn").click();
            const progress = JSON.parse(localStorage.getItem("p00_mission_progress") || "{}");
            return {
              markerAfter: localStorage.getItem(taskKey),
              missionState: progress[missionId] || null
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.markerAfter !== null, `Mission reset rollback case unexpectedly cleared the marker: ${JSON.stringify(result)}`);
        assert(!!result.missionState?._started, `Mission reset rollback did not preserve mission progress after marker-clear failure: ${JSON.stringify(result)}`);
        return { name: "missionResetRollbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          window.openMissionModal(missionId);

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === taskKey) return;
            return originalRemoveItem.call(this, key);
          };

          try {
            document.getElementById("modalResetBtn").click();
            const progress = JSON.parse(localStorage.getItem("p00_mission_progress") || "{}");
            return {
              markerAfter: localStorage.getItem(taskKey),
              missionState: progress[missionId] || null
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.markerAfter !== null, `Mission reset rollback case unexpectedly cleared the marker after silent removeItem no-op: ${JSON.stringify(result)}`);
        assert(!!result.missionState?._started, `Mission reset rollback did not preserve mission progress after silent marker-clear failure: ${JSON.stringify(result)}`);
        return { name: "missionResetSilentRollbackCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        window.__missionCompleteWriteFailures = 0;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"task_complete\"")) {
            failed = true;
            window.__missionCompleteWriteFailures += 1;
            throw new Error("forced mission task_complete write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const mission = MISSIONS.find(item => item.id === missionId);
          const lastStepIndex = (mission?.steps.length || 1) - 1;
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          window.ensureMissionStarted(missionId);
          const progress = loadProgress();
          const state = getMissionProgressState(progress, missionId, { create: true });
          for (let index = 0; index < lastStepIndex; index += 1) {
            state["step" + index] = true;
          }
          saveProgress(progress);
          window.markStepDone(missionId, String(lastStepIndex));
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            writeFailures: window.__missionCompleteWriteFailures || 0,
            markerAfter: localStorage.getItem(taskKey),
            taskEvents: events.filter(event => event.task_name === "dashboard_mission_mission_ethics").map(event => event.event_name),
            progressState: JSON.parse(localStorage.getItem("p00_mission_progress") || "{}")[missionId] || {}
          };
        });
        assert(result.writeFailures === 1, `Mission completion retry case never forced the initial task_complete write failure: ${JSON.stringify(result)}`);
        assert(result.markerAfter === null, `Mission completion recovery did not clear the open task marker after retry: ${JSON.stringify(result)}`);
        assert(result.taskEvents.join(",") === "task_start,task_complete", `Mission completion recovery did not restore the missing terminal event: ${JSON.stringify(result)}`);
        assert(result.progressState._completed === true, `Mission completion recovery did not preserve completed progress state: ${JSON.stringify(result)}`);
        return { name: "missionCompletionRecoveryCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const markerTime = Date.now() - 2000;
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(markerTime));
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let markTaskStartCalls = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            markTaskStartCalls += 1;
            return originalMarkTaskStart.apply(this, args);
          };
          try {
            window.ensureMissionStarted(missionId);
            window.ensureMissionStarted(missionId);
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            const taskStarts = events.filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics");
            return {
              markTaskStartCalls,
              taskStartCount: taskStarts.length,
              taskStartTime: taskStarts[0]?.event_time || "",
              markerRaw: localStorage.getItem(taskKey)
            };
          } finally {
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.markTaskStartCalls === 0, `Marker-backed backfill should not call markTaskStart, got ${result.markTaskStartCalls}`);
        assert(result.taskStartCount === 1, `Marker-backed backfill should create exactly one task_start event, got ${result.taskStartCount}`);
        assert(result.taskStartTime === new Date(Number(result.markerRaw)).toISOString(), `Marker-backed backfill used the wrong event_time: ${result.taskStartTime}`);
        return { name: "markerBackfillCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const older = Date.now() - 60000;
          const newer = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(newer));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_start",
            task_name: "dashboard_mission_mission_ethics",
            event_time: new Date(older).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "older-open-start",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.ensureMissionStarted(missionId);
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            taskStartTimes: events
              .filter(event => event.event_name === "task_start" && event.task_name === "dashboard_mission_mission_ethics")
              .map(event => event.event_time)
          };
        });
        assert(result.taskStartTimes.length === 2, `Dashboard marker backfill did not add newer open task_start: ${JSON.stringify(result)}`);
        return { name: "markerBackfillNewerOpenCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalGetItem = Storage.prototype.getItem;
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let markTaskStartCalls = 0;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced mission marker read failure");
            }
            return originalGetItem.call(this, key);
          };
          window.pmMetrics.markTaskStart = function (...args) {
            markTaskStartCalls += 1;
            return originalMarkTaskStart.apply(this, args);
          };

          try {
            window.ensureMissionStarted(missionId);
            return { markTaskStartCalls };
          } finally {
            Storage.prototype.getItem = originalGetItem;
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.markTaskStartCalls === 0, `Unreadable existing mission marker should suppress new task_start sync, got ${result.markTaskStartCalls}`);
        return { name: "unreadableMissionMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced unreadable mission marker");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            return {
              toastText: document.querySelector("#toastContainer [role='alert'] span[style*='flex: 1']")?.textContent || ""
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.toastText === "当前浏览器存储存在异常任务标记，任务恢复可能不完整。", `Unreadable mission-marker warning toast mismatch: ${JSON.stringify(result)}`);
        return { name: "unreadableMissionMarkerWarningCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(Date.now() - 2000));
          window.showToast("旧提示", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));

          const originalReplaceToasts = window.replaceToasts;
          const originalGetItem = Storage.prototype.getItem;
          window.replaceToasts = undefined;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced unreadable mission marker");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            window.pmMetrics.track("cta_click", { control_id: "probe" });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              priorToastCount: events.filter(event => event.event_name === "status_success_signal" && event.status_text === "旧提示").length,
              warningSignalCount: events.filter(event =>
                (event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
                && event.status_text === "当前浏览器存储存在异常任务标记，任务恢复可能不完整。"
              ).length,
              ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
              visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
            };
          } finally {
            window.replaceToasts = originalReplaceToasts;
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.priorToastCount === 1, `Unreadable mission-marker warning fallback should not duplicate the prior tracked toast on later interaction: ${JSON.stringify(result)}`);
        assert(result.warningSignalCount === 0, `Unreadable mission-marker warning fallback should keep the warning toast untracked: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Unreadable mission-marker warning fallback should not break later tracked events: ${JSON.stringify(result)}`);
        assert(result.visibleToastCount === 1, `Unreadable mission-marker warning fallback should leave exactly one visible warning toast after clearing stale toasts: ${JSON.stringify(result)}`);
        return { name: "unreadableMissionMarkerWarningFallbackWithoutReplaceToastsCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const missionId = "mission-ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) {
              throw new Error("forced unreadable mission marker");
            }
            return originalGetItem.call(this, key);
          };

          try {
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            const beforeClear = Array.from(document.querySelectorAll("#toastContainer > [role='alert'] span[style*='flex: 1']")).map(el => el.textContent || "");
            window.clearToasts?.();
            await new Promise(resolve => setTimeout(resolve, 20));
            window.refreshDashboard();
            await new Promise(resolve => setTimeout(resolve, 50));
            const afterClear = Array.from(document.querySelectorAll("#toastContainer > [role='alert'] span[style*='flex: 1']")).map(el => el.textContent || "");
            return { beforeClear, afterClear };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.beforeClear.join("|") === "当前浏览器存储存在异常任务标记，任务恢复可能不完整。", `Managed storage warning should not duplicate across repeated refreshes while visible: ${JSON.stringify(result)}`);
        assert(result.afterClear.join("|") === "当前浏览器存储存在异常任务标记，任务恢复可能不完整。", `Managed storage warning should reappear after being dismissed while the unsafe state persists: ${JSON.stringify(result)}`);
        return { name: "managedStorageWarningRedisplayCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_start",
            task_name: "dashboard_mission_mission_ethics",
            event_time: new Date(Date.now() - 1000).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "existing-open-start",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };
          try {
            window.ensureMissionStarted(missionId);
            return { callCount };
          } finally {
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 0, `Existing open task_start should suppress a new resume sync, got ${result.callCount}`);
        return { name: "existingOpenStartCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_start",
            task_name: "dashboard_mission_mission_ethics",
            event_time: new Date(Date.now() - (9 * 60 * 60 * 1000)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "stale-open-start",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          const originalMarkTaskStart = window.pmMetrics.markTaskStart;
          let callCount = 0;
          window.pmMetrics.markTaskStart = function (...args) {
            callCount += 1;
            return originalMarkTaskStart.apply(this, args);
          };
          try {
            window.ensureMissionStarted(missionId);
            return { callCount };
          } finally {
            window.pmMetrics.markTaskStart = originalMarkTaskStart;
          }
        });
        assert(result.callCount === 1, `Stale open task_start should allow a fresh resume sync, got ${result.callCount}`);
        return { name: "staleOpenStartCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const missionId = "mission-ethics";
          const taskName = "dashboard_mission_mission_ethics";
          const taskKey = "pm_metrics_task_start_P00-dashboard::dashboard_mission_mission_ethics";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem("p00_mission_progress", JSON.stringify({
            [missionId]: { _started: true }
          }));
          localStorage.setItem(taskKey, String(Date.now() + (24 * 60 * 60 * 1000)));
          window.refreshDashboard();
          const markerAfterRepair = localStorage.getItem(taskKey);
          window.pmMetrics.markTaskComplete(taskName, { mission_id: missionId });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          const latest = [...events].reverse().find(event => event.event_name === "task_complete" && event.mission_id === missionId);
          return {
            markerAfterRepair,
            taskCompleteDuration: latest ? latest.task_duration_ms : null
          };
        });
        assert(result.markerAfterRepair === null, `Future-dated task-start marker was not pruned: ${result.markerAfterRepair}`);
        assert(result.taskCompleteDuration === null, `Future-dated task-start marker still forced a duration value: ${result.taskCompleteDuration}`);
        return { name: "futureTaskMarkerCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const makeEvent = index => ({
            event_name: "page_view",
            event_time: new Date(1700000000000 + (index * 1000)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `seed-${index}`,
            app_version: "pm-v1",
            page_path: "/"
          });
          const newestImported = makeEvent(9999);
          const olderBlock = Array.from({ length: 500 }, (_, index) => makeEvent(index));
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify([newestImported, ...olderBlock]));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: events.length,
            keptNewestImported: events.some(event => event.session_id === newestImported.session_id),
            firstSession: events[0]?.session_id || "",
            lastEventName: events[events.length - 1]?.event_name || ""
          };
        });
        assert(result.count === 500, `Chronological trim count mismatch: ${result.count}`);
        assert(result.keptNewestImported === true, "Chronological trim dropped the newest imported event");
        assert(result.firstSession === "seed-2", `Chronological trim kept the wrong oldest event: ${result.firstSession}`);
        assert(result.lastEventName === "cta_click", `Chronological trim did not keep the newest tracked event: ${result.lastEventName}`);
        return { name: "chronologicalTrimCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const makeEvent = index => ({
            event_name: "page_view",
            event_time: new Date(1700000000000 + (index * 1000)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `oversized-${index}`,
            app_version: "pm-v1",
            page_path: "/"
          });
          const importedEvents = Array.from({ length: 501 }, (_, index) => makeEvent(index));
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify(importedEvents));
          window.refreshDashboard();
          const stored = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: stored.length,
            firstSession: stored[0]?.session_id || "",
            lastSession: stored[stored.length - 1]?.session_id || ""
          };
        });
        assert(result.count === 500, `Oversized metric array was not normalized to 500 events: ${result.count}`);
        assert(result.firstSession === "oversized-1", `Oversized metric array kept the wrong oldest retained event: ${result.firstSession}`);
        assert(result.lastSession === "oversized-500", `Oversized metric array kept the wrong newest retained event: ${result.lastSession}`);
        return { name: "oversizedMetricArrayCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(eventsKey, JSON.stringify([
            {
              event_name: "page_view",
              event_time: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "future-event",
              app_version: "pm-v1",
              page_path: "/"
            },
            {
              event_name: "page_view",
              event_time: new Date(Date.now() - 1000).toISOString(),
              project_id: "P00-dashboard",
              project_cluster: "学习中枢",
              session_id: "current-event",
              app_version: "pm-v1",
              page_path: "/"
            }
          ]));
          window.refreshDashboard();
          const stored = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: stored.length,
            sessionIds: stored.map(event => event.session_id)
          };
        });
        assert(result.count === 1, `Future-dated metric event was not pruned: ${result.count}`);
        assert(result.sessionIds.length === 1 && result.sessionIds[0] === "current-event", `Wrong metric events survived future-event pruning: ${JSON.stringify(result.sessionIds)}`);
        return { name: "futureMetricEventCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await context.addInitScript(() => {
        const originalGetItem = Storage.prototype.getItem;
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (this === window.sessionStorage) {
            throw new Error("forced sessionStorage getItem failure");
          }
          return originalGetItem.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (this === window.sessionStorage) {
            throw new Error("forced sessionStorage setItem failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });

      const pageA = await createReadyPage(context, origin);
      const sessionA = await pageA.evaluate(() => {
        const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
        return [...events].reverse().find(event => event.event_name === "page_view")?.session_id || "";
      });
      await pageA.close();

      const pageB = await createReadyPage(context, origin);
      const sessionB = await pageB.evaluate(() => {
        const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
        return [...events].reverse().find(event => event.event_name === "page_view")?.session_id || "";
      });
      await pageB.close();

      assert(sessionA.startsWith("P00-dashboard-volatile-"), `Fallback session id missing volatile prefix: ${sessionA}`);
      assert(sessionB.startsWith("P00-dashboard-volatile-"), `Fallback session id missing volatile prefix: ${sessionB}`);
      assert(sessionA !== sessionB, `Fallback session ids should differ across loads when sessionStorage is unavailable: ${sessionA}`);
      return { name: "sessionFallbackCase", status: "passed" };
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      await context.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === window.sessionStorage && key === "pm_metrics_session_P00-dashboard") {
            return;
          }
          return originalSetItem.call(this, key, value);
        };
      });

      const pageA = await createReadyPage(context, origin);
      const sessionA = await pageA.evaluate(() => {
        const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
        return [...events].reverse().find(event => event.event_name === "page_view")?.session_id || "";
      });
      await pageA.close();

      const pageB = await createReadyPage(context, origin);
      const sessionB = await pageB.evaluate(() => {
        const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
        return [...events].reverse().find(event => event.event_name === "page_view")?.session_id || "";
      });
      await pageB.close();

      assert(sessionA.startsWith("P00-dashboard-volatile-"), `Silent sessionStorage no-op did not trigger volatile fallback prefix: ${sessionA}`);
      assert(sessionB.startsWith("P00-dashboard-volatile-"), `Silent sessionStorage no-op did not trigger volatile fallback prefix on reload: ${sessionB}`);
      assert(sessionA !== sessionB, `Silent sessionStorage no-op should still produce distinct volatile session ids across loads: ${sessionA}`);
      return { name: "sessionSilentWriteFailureCase", status: "passed" };
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"page_view\"")) {
            failed = true;
            throw new Error("forced page_view write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const requestFailures = [];
      const consoleErrors = [];
      page.on("requestfailed", request => {
        requestFailures.push(`${request.method()} ${request.url()} -> ${request.failure()?.errorText || "failed"}`);
      });
      page.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      assert(requestFailures.length === 0, `Asset request failures: ${requestFailures.join(" | ")}`);
      assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);
      try {
        await page.waitForTimeout(150);
        await page.dispatchEvent("body", "pointerdown");
        const result = await page.evaluate(() => {
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const pageView = events.find(event => event.event_name === "page_view");
          const firstInteraction = events.find(event => event.event_name === "first_interaction");
          return {
            pageViewCount: events.filter(event => event.event_name === "page_view").length,
            firstInteractionCount: events.filter(event => event.event_name === "first_interaction").length,
            pageViewTime: pageView ? new Date(pageView.event_time).getTime() : Number.NaN,
            firstInteractionTime: firstInteraction ? new Date(firstInteraction.event_time).getTime() : Number.NaN,
            firstInteractionElapsed: firstInteraction?.elapsed_ms
          };
        });
        assert(result.pageViewCount === 1, `page_view did not retry after transient write failure: ${JSON.stringify(result)}`);
        assert(result.firstInteractionCount === 1, `first_interaction should still be captured during page_view retry recovery: ${JSON.stringify(result)}`);
        assert(Math.abs((result.firstInteractionTime - result.pageViewTime) - result.firstInteractionElapsed) < 80, `page_view retry did not preserve original event timing: ${JSON.stringify(result)}`);
        return { name: "pageViewRetryCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"page_view\"")) {
            failed = true;
            throw new Error("forced page_view write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            pageViewCount: events.filter(event => event.event_name === "page_view").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.pageViewCount === 1, `Pending page_view did not flush on later tracked event: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Later tracked event was not preserved while flushing page_view: ${JSON.stringify(result)}`);
        return { name: "pageViewFlushCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"page_view\"")) {
            failed = true;
            throw new Error("forced page_view write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const base = Date.now() + 1000;
          const filler = Array.from({ length: 500 }, (_, index) => ({
            event_name: "cta_click",
            event_time: new Date(base + (index * 200)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `fill-${index}`,
            app_version: "pm-v1",
            page_path: "/",
            control_id: `b${index}`
          }));
          localStorage.setItem(eventsKey, JSON.stringify(filler));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: events.length,
            eventNames: events.filter(event => event.event_name === "page_view" || (event.event_name === "cta_click" && event.control_id === "probe")).map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.count === 500, `Pending page_view flush retention changed total retained count unexpectedly: ${result.count}`);
        assert(result.eventNames.join(",") === "page_view,cta_click:probe", `Pending page_view was trimmed away under flush retention cap: ${JSON.stringify(result)}`);
        return { name: "pageViewFlushRetentionCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"page_view\"")) {
            failed = true;
            throw new Error("forced page_view write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const initialPath = location.pathname + location.hash;
          location.hash = "#later";
          const laterPath = location.pathname + location.hash;
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const pageView = events.find(event => event.event_name === "page_view");
          const ctaClick = events.find(event => event.event_name === "cta_click" && event.control_id === "probe");
          return {
            initialPath,
            laterPath,
            pageViewPath: pageView?.page_path || "",
            ctaClickPath: ctaClick?.page_path || ""
          };
        });
        assert(result.pageViewPath === result.initialPath, `Recovered page_view used retry-time page_path instead of initial path: ${JSON.stringify(result)}`);
        assert(result.ctaClickPath === result.laterPath, `Later tracked event did not use current page_path: ${JSON.stringify(result)}`);
        return { name: "pageViewPathRetryCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const button = document.createElement("button");
          button.id = "lateBtn";
          button.type = "button";
          button.textContent = "Late Button";
          document.body.appendChild(button);
          button.click();
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            lateButtonClicksTracked: events.filter(event => event.event_name === "cta_click" && event.control_id === "lateBtn").length
          };
        });
        assert(result.lateButtonClicksTracked === 1, `Late-added button click was not tracked by delegated CTA handler: ${JSON.stringify(result)}`);
        return { name: "delegatedCtaCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            lateStatusSignalsTracked: events.filter(event => event.event_name === "status_success_signal").length
          };
        });
        assert(result.lateStatusSignalsTracked === 1, `Late-added status element was not observed: ${JSON.stringify(result)}`);
        return { name: "lateStatusObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_success_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "学习数据已导出", `Toast success notification did not preserve clean message text: ${JSON.stringify(result)}`);
        return { name: "toastStatusObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast(0, "success", 0);
          await new Promise(resolve => setTimeout(resolve, 250));
          const toast = document.querySelector("#toastContainer > [role='status']");
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_success_signal");
          return {
            toastExists: !!toast,
            toastText: toast?.querySelector("span[style*='flex: 1']")?.textContent || toast?.textContent || "",
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.toastExists === true, `Toast with duration 0 did not remain mounted: ${JSON.stringify(result)}`);
        assert(result.toastText === "0", `Toast numeric message did not render as literal text: ${JSON.stringify(result)}`);
        assert(result.statusText === "0", `Toast numeric message was not preserved in status tracking: ${JSON.stringify(result)}`);
        return { name: "toastZeroMessageStickyCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("<strong>不安全</strong>", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const toast = document.querySelector("#toastContainer > [role='status']");
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_success_signal");
          return {
            hasInjectedStrong: !!toast?.querySelector("strong"),
            toastText: toast?.querySelector("span[style*='flex: 1']")?.textContent || toast?.textContent || "",
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.hasInjectedStrong === false, `Toast message HTML was injected into the DOM: ${JSON.stringify(result)}`);
        assert(result.statusText === "<strong>不安全</strong>", `Toast message markup was not preserved as literal text in metrics: ${JSON.stringify(result)}`);
        return { name: "toastMessageEscapingCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("第一条", "success", 3000);
          window.showToast("第二条", "error", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          window.clearToasts?.();
          await new Promise(resolve => setTimeout(resolve, 20));
          return {
            visibleToastCount: document.querySelectorAll("#toastContainer > [role='status'], #toastContainer > [role='alert']").length
          };
        });
        assert(result.visibleToastCount === 0, `clearToasts() did not remove all visible toast nodes: ${JSON.stringify(result)}`);
        return { name: "clearToastsHelperCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            throw new Error("forced toast status write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          window.clearToasts?.();
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusTexts: events.filter(event => event.event_name === "status_success_signal").map(event => event.status_text),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.statusTexts.length === 0, `clearToasts() did not clear pending toast status state before a later tracked event: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `clearToasts() should not block later tracked events after clearing pending toast state: ${JSON.stringify(result)}`);
        return { name: "clearToastsPendingStatusCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("已导入 3 条学习数据", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_success_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "已导入 3 条学习数据", `Generic success toast was not observed via toast metadata: ${JSON.stringify(result)}`);
        return { name: "toastGenericSuccessObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("任务进度已重置", "warn", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_success_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "任务进度已重置", `Reset success toast was not observed as a success signal: ${JSON.stringify(result)}`);
        return { name: "toastResetSuccessObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("导入失败：文件不是有效的 JSON", "error", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_error_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "导入失败：文件不是有效的 JSON", `Toast error notification did not preserve clean message text: ${JSON.stringify(result)}`);
        return { name: "toastErrorStatusObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("浏览器存储删除不完整，已保留原有数据。", "error", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_error_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "浏览器存储删除不完整，已保留原有数据。", `Generic error toast was not observed via toast metadata: ${JSON.stringify(result)}`);
        return { name: "toastGenericErrorObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("浏览器拦截了新标签页，请允许弹窗后重试", "warn", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_error_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "浏览器拦截了新标签页，请允许弹窗后重试", `Warn failure toast was not observed as an error signal: ${JSON.stringify(result)}`);
        return { name: "toastWarnErrorObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("学习数据已清除", "warn", 3000);
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSignals = events.filter(event => event.event_name === "status_success_signal");
          return {
            count: statusSignals.length,
            statusText: statusSignals[0]?.status_text || ""
          };
        });
        assert(result.count === 1 && result.statusText === "学习数据已清除", `Clear success toast was not observed as a success signal: ${JSON.stringify(result)}`);
        return { name: "toastClearSuccessObserverCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          status.textContent = "操作失败";
          await new Promise(resolve => setTimeout(resolve, 20));
          status.textContent = "操作失败";
          await new Promise(resolve => setTimeout(resolve, 20));
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusNames: events
              .filter(event => event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
              .map(event => `${event.event_name}:${event.status_text}`)
          };
        });
        assert(result.statusNames.join("|") === "status_success_signal:导出成功|status_error_signal:操作失败|status_success_signal:导出成功", `Consecutive duplicate status signals were not deduped correctly: ${JSON.stringify(result)}`);
        return { name: "statusSignalDedupeCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          status.textContent = "处理中";
          await new Promise(resolve => setTimeout(resolve, 20));
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusNames: events
              .filter(event => event.event_name === "status_success_signal")
              .map(event => event.status_text)
          };
        });
        assert(result.statusNames.join("|") === "导出成功|导出成功", `Status signal did not reset after non-signal text: ${JSON.stringify(result)}`);
        return { name: "statusSignalResetCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(async () => {
          const first = document.createElement("div");
          first.id = "status";
          document.body.appendChild(first);
          first.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          first.remove();
          await new Promise(resolve => setTimeout(resolve, 20));
          const second = document.createElement("div");
          second.id = "status";
          document.body.appendChild(second);
          second.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 50));
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusNames: events
              .filter(event => event.event_name === "status_success_signal")
              .map(event => event.status_text)
          };
        });
        assert(result.statusNames.join("|") === "导出成功|导出成功", `Status signal did not reset after status element replacement: ${JSON.stringify(result)}`);
        return { name: "statusSignalReplaceCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            throw new Error("forced toast status_success_signal write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          window.showToast("学习数据已导出", "success", 3000);
          await new Promise(resolve => setTimeout(resolve, 20));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusSuccessCount: events.filter(event => event.event_name === "status_success_signal").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.statusSuccessCount === 1, `Pending toast status signal did not flush on later tracked event: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Later tracked event was not preserved while flushing pending toast status: ${JSON.stringify(result)}`);
        return { name: "toastStatusFlushCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        window.__pmStatusWriteFailures = 0;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            window.__pmStatusWriteFailures += 1;
            throw new Error("forced status_success_signal write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 0));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusSuccessCount: events.filter(event => event.event_name === "status_success_signal").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.statusSuccessCount === 1, `Pending status signal did not flush on later tracked event: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Later tracked event was not preserved while flushing pending status: ${JSON.stringify(result)}`);
        return { name: "statusSignalFlushCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        window.__pmStatusWriteFailures = 0;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            window.__pmStatusWriteFailures += 1;
            throw new Error("forced status_success_signal write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const base = Date.now() + 1000;
          const filler = Array.from({ length: 500 }, (_, index) => ({
            event_name: "cta_click",
            event_time: new Date(base + (index * 200)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `fill-${index}`,
            app_version: "pm-v1",
            page_path: "/",
            control_id: `b${index}`
          }));
          localStorage.setItem(eventsKey, JSON.stringify(filler));
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 20));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: events.length,
            writeFailures: window.__pmStatusWriteFailures || 0,
            eventNames: events
              .filter(event => event.event_name === "status_success_signal" || (event.event_name === "cta_click" && event.control_id === "probe"))
              .map(event => event.event_name + (event.control_id ? ":" + event.control_id : ""))
          };
        });
        assert(result.count === 500, `Pending status flush retention changed total retained count unexpectedly: ${result.count}`);
        assert(result.writeFailures === 1, `Full-log status write never reached storage with the pending signal present: ${JSON.stringify(result)}`);
        assert(result.eventNames.join(",") === "status_success_signal,cta_click:probe", `Pending status signal was trimmed away under flush retention cap: ${JSON.stringify(result)}`);
        return { name: "statusSignalFlushRetentionCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            throw new Error("forced status_success_signal write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          location.hash = "#status";
          const statusPath = location.pathname + location.hash;
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 0));
          location.hash = "#later";
          const laterPath = location.pathname + location.hash;
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const statusSuccess = events.find(event => event.event_name === "status_success_signal");
          const ctaClick = events.find(event => event.event_name === "cta_click" && event.control_id === "probe");
          return {
            statusPath,
            laterPath,
            statusEventPath: statusSuccess?.page_path || "",
            ctaClickPath: ctaClick?.page_path || ""
          };
        });
        assert(result.statusEventPath === result.statusPath, `Recovered status signal used retry-time page_path instead of original status path: ${JSON.stringify(result)}`);
        assert(result.ctaClickPath === result.laterPath, `Later tracked event did not use current page_path after status flush: ${JSON.stringify(result)}`);
        return { name: "statusSignalPathCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            throw new Error("forced first queued status write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 0));
          status.textContent = "操作失败";
          await new Promise(resolve => setTimeout(resolve, 0));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusNames: events
              .filter(event => event.event_name === "status_success_signal" || event.event_name === "status_error_signal")
              .map(event => `${event.event_name}:${event.status_text}`),
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length
          };
        });
        assert(result.statusNames.join("|") === "status_success_signal:导出成功|status_error_signal:操作失败", `Queued status signals did not flush in order: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Later tracked event was not preserved while flushing queued status signals: ${JSON.stringify(result)}`);
        return { name: "statusSignalQueueCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            throw new Error("forced first reset success failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(async () => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 0));
          status.textContent = "处理中";
          await new Promise(resolve => setTimeout(resolve, 0));
          status.textContent = "导出成功";
          await new Promise(resolve => setTimeout(resolve, 0));
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusNames: events
              .filter(event => event.event_name === "status_success_signal")
              .map(event => event.status_text)
          };
        });
        assert(result.statusNames.join("|") === "导出成功|导出成功", `Queued status signal did not reset after non-signal state: ${JSON.stringify(result)}`);
        return { name: "statusSignalQueueResetCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page1 = await context.newPage();
      await page1.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"status_success_signal\"")) {
            failed = true;
            throw new Error("forced status_success_signal write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      await page1.goto(`${origin}/`, { waitUntil: "networkidle" });
      try {
        await page1.evaluate(() => {
          const status = document.createElement("div");
          status.id = "status";
          document.body.appendChild(status);
          status.textContent = "导出成功";
        });
      } finally {
        await page1.close();
      }

      const page2 = await createReadyPage(context, origin);
      try {
        const result = await page2.evaluate(() => {
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            statusSuccessCount: events.filter(event => event.event_name === "status_success_signal").length
          };
        });
        assert(result.statusSuccessCount === 1, `status_success_signal was not recovered on unload after transient write failure: ${JSON.stringify(result)}`);
        return { name: "statusSignalRetryCase", status: "passed" };
      } finally {
        await page2.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"first_interaction\"")) {
            failed = true;
            throw new Error("forced first_interaction write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const requestFailures = [];
      const consoleErrors = [];
      page.on("requestfailed", request => {
        requestFailures.push(`${request.method()} ${request.url()} -> ${request.failure()?.errorText || "failed"}`);
      });
      page.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      assert(requestFailures.length === 0, `Asset request failures: ${requestFailures.join(" | ")}`);
      assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);
      try {
        await page.dispatchEvent("body", "pointerdown");
        await page.waitForTimeout(150);
        await page.dispatchEvent("body", "keydown", { key: "A" });
        const result = await page.evaluate(() => {
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const pageView = events.find(event => event.event_name === "page_view");
          const firstInteraction = events.find(event => event.event_name === "first_interaction");
          return {
            firstInteractionCount: events.filter(event => event.event_name === "first_interaction").length,
            pageViewTime: pageView ? new Date(pageView.event_time).getTime() : Number.NaN,
            firstInteractionTime: firstInteraction ? new Date(firstInteraction.event_time).getTime() : Number.NaN,
            firstInteractionElapsed: firstInteraction?.elapsed_ms
          };
        });
        assert(result.firstInteractionCount === 1, `first_interaction did not retry after transient write failure: ${JSON.stringify(result)}`);
        assert(Math.abs((result.firstInteractionTime - result.pageViewTime) - result.firstInteractionElapsed) < 80, `first_interaction retry did not preserve original event timing: ${JSON.stringify(result)}`);
        return { name: "firstInteractionRetryCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"first_interaction\"")) {
            failed = true;
            throw new Error("forced first_interaction write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        await page.dispatchEvent("body", "pointerdown");
        const result = await page.evaluate(() => {
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const pageView = events.find(event => event.event_name === "page_view");
          const firstInteraction = events.find(event => event.event_name === "first_interaction");
          return {
            firstInteractionCount: events.filter(event => event.event_name === "first_interaction").length,
            ctaClickCount: events.filter(event => event.event_name === "cta_click" && event.control_id === "probe").length,
            pageViewTime: pageView ? new Date(pageView.event_time).getTime() : Number.NaN,
            firstInteractionTime: firstInteraction ? new Date(firstInteraction.event_time).getTime() : Number.NaN,
            firstInteractionElapsed: firstInteraction?.elapsed_ms
          };
        });
        assert(result.firstInteractionCount === 1, `Pending first_interaction did not flush on later tracked event: ${JSON.stringify(result)}`);
        assert(result.ctaClickCount === 1, `Later tracked event was not preserved while flushing first_interaction: ${JSON.stringify(result)}`);
        assert(Math.abs((result.firstInteractionTime - result.pageViewTime) - result.firstInteractionElapsed) < 80, `first_interaction flush did not preserve original event timing: ${JSON.stringify(result)}`);
        return { name: "firstInteractionFlushCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"first_interaction\"")) {
            failed = true;
            throw new Error("forced first_interaction write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          location.hash = "#first";
          const interactionPath = location.pathname + location.hash;
          document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          location.hash = "#later";
          const laterPath = location.pathname + location.hash;
          window.pmMetrics.track("cta_click", { control_id: "probe" });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          const firstInteraction = events.find(event => event.event_name === "first_interaction");
          const ctaClick = events.find(event => event.event_name === "cta_click" && event.control_id === "probe");
          return {
            interactionPath,
            laterPath,
            firstInteractionPath: firstInteraction?.page_path || "",
            ctaClickPath: ctaClick?.page_path || ""
          };
        });
        assert(result.firstInteractionPath === result.interactionPath, `Recovered first_interaction used retry-time page_path instead of interaction path: ${JSON.stringify(result)}`);
        assert(result.ctaClickPath === result.laterPath, `Later tracked event did not use current page_path: ${JSON.stringify(result)}`);
        return { name: "firstInteractionPathCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page1 = await context.newPage();
      await page1.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"first_interaction\"")) {
            failed = true;
            throw new Error("forced first_interaction write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      await page1.goto(`${origin}/`, { waitUntil: "networkidle" });
      try {
        await page1.dispatchEvent("body", "pointerdown");
      } finally {
        await page1.close();
      }

      const page2 = await createReadyPage(context, origin);
      try {
        const result = await page2.evaluate(() => {
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            firstInteractionCount: events.filter(event => event.event_name === "first_interaction").length
          };
        });
        assert(result.firstInteractionCount === 1, `first_interaction was not recovered on unload after transient write failure: ${JSON.stringify(result)}`);
        return { name: "firstInteractionUnloadRetryCase", status: "passed" };
      } finally {
        await page2.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"task_start\"")) {
            failed = true;
            throw new Error("forced task_start event write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          localStorage.clear();
          window.pmMetrics.markTaskStart("learning_hub_overview_task");
          window.pmMetrics.markTaskComplete("learning_hub_overview_task", { done: true });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            eventNames: events.map(event => event.event_name)
          };
        });
        assert(result.eventNames.join(",") === "task_start,task_complete", `Missing task_start backfill before terminal event: ${JSON.stringify(result)}`);
        return { name: "taskStartBackfillCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const older = Date.now() - 60000;
          const newer = Date.now() - 2000;
          localStorage.clear();
          localStorage.setItem(taskKey, String(newer));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_start",
            task_name: taskName,
            event_time: new Date(older).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "older-open-start",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.pmMetrics.markTaskComplete(taskName, { done: true });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            taskEvents: events.filter(event => event.task_name === taskName).map(event => event.event_name)
          };
        });
        assert(result.taskEvents.join(",") === "task_start,task_start,task_complete", `Standalone marker backfill did not add newer open task_start before terminal event: ${JSON.stringify(result)}`);
        return { name: "taskStartBackfillNewerOpenCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"page_view\"")) {
            failed = true;
            throw new Error("forced page_view write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          localStorage.setItem(taskKey, String(Date.now() - 2000));
          window.pmMetrics.markTaskComplete("learning_hub_overview_task", { done: true });
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            eventNames: events.map(event => event.event_name)
          };
        });
        assert(result.eventNames.join(",") === "task_start,page_view,task_complete", `Pending page_view was not flushed alongside terminal payload append: ${JSON.stringify(result)}`);
        return { name: "terminalFlushPendingCoreCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"page_view\"")) {
            failed = true;
            throw new Error("forced page_view write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const base = Date.now() + 1000;
          const filler = Array.from({ length: 500 }, (_, index) => ({
            event_name: "cta_click",
            event_time: new Date(base + (index * 200)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `fill-${index}`,
            app_version: "pm-v1",
            page_path: "/",
            control_id: `b${index}`
          }));
          localStorage.setItem(eventsKey, JSON.stringify(filler));
          localStorage.setItem(taskKey, String(Date.now() - 2000));
          window.pmMetrics.markTaskComplete("learning_hub_overview_task", { done: true });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: events.length,
            eventNames: events.filter(event => event.event_name === "page_view" || event.task_name === "learning_hub_overview_task").map(event => event.event_name)
          };
        });
        assert(result.count === 500, `Pending-core retention changed total retained event count unexpectedly: ${result.count}`);
        assert(result.eventNames.join(",") === "task_start,page_view,task_complete", `Pending page_view was trimmed away under terminal append retention cap: ${JSON.stringify(result)}`);
        return { name: "terminalFlushPendingCoreRetentionCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const progressKey = "p00_mission_progress";
          localStorage.clear();

          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === progressKey) {
              return;
            }
            return originalSetItem.call(this, key, value);
          };

          try {
            const saved = window.saveProgress({
              "mission-ethics": { _started: true }
            });
            return {
              saved,
              progressRaw: localStorage.getItem(progressKey)
            };
          } finally {
            Storage.prototype.setItem = originalSetItem;
          }
        });
        assert(result.saved === false, `saveProgress did not detect silent setItem failure: ${JSON.stringify(result)}`);
        assert(result.progressRaw === null, `saveProgress silently left stale progress state after failed write detection: ${JSON.stringify(result)}`);
        return { name: "saveProgressSilentWriteFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const markerTime = Date.now() - (60 * 60 * 1000);
          const base = Date.now() - (30 * 60 * 1000);
          const filler = Array.from({ length: 500 }, (_, index) => ({
            event_name: "cta_click",
            event_time: new Date(base + (index * 1000)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `fill-${index}`,
            app_version: "pm-v1",
            page_path: "/",
            control_id: `b${index}`
          }));
          localStorage.clear();
          localStorage.setItem(taskKey, String(markerTime));
          localStorage.setItem(eventsKey, JSON.stringify(filler));
          window.pmMetrics.markTaskComplete(taskName, { done: true });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: events.length,
            eventNames: events.filter(event => event.task_name === taskName).map(event => event.event_name)
          };
        });
        assert(result.count === 500, `Backfill retention changed total retained event count unexpectedly: ${result.count}`);
        assert(result.eventNames.join(",") === "task_start,task_complete", `Backfilled task_start was trimmed away under retention cap: ${JSON.stringify(result)}`);
        return { name: "taskStartBackfillRetentionCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"task_start\"")) {
            failed = true;
            throw new Error("forced combined task_start/task_complete write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));
          window.pmMetrics.markTaskComplete(taskName, { done: true });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events.map(event => event.event_name),
            markerAfter: localStorage.getItem(taskKey)
          };
        });
        assert(result.eventNames.length === 0, `Terminal write should not partially persist when backfill append fails: ${JSON.stringify(result)}`);
        assert(result.markerAfter !== null, "Task-start marker should remain after failed combined backfill/terminal write");
        return { name: "taskStartBackfillAtomicityCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === taskKey) throw new Error("forced task marker remove failure");
            return originalRemoveItem.call(this, key);
          };

          try {
            const completion = window.pmMetrics.markTaskComplete(taskName, { done: true });
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              persisted: completion?.persisted === true,
              markerCleared: completion?.markerCleared === true,
              markerAfter: localStorage.getItem(taskKey),
              eventNames: events.filter(event => event.task_name === taskName).map(event => event.event_name)
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.persisted === true, `Terminal write should still persist when marker removal fails: ${JSON.stringify(result)}`);
        assert(result.markerCleared === false, `markTaskComplete reported marker removal success despite removeItem failure: ${JSON.stringify(result)}`);
        assert(result.markerAfter !== null, `Forced marker removal failure unexpectedly cleared the task marker: ${JSON.stringify(result)}`);
        assert(result.eventNames.join(",") === "task_start,task_complete", `Terminal write did not preserve expected task events when marker removal failed: ${JSON.stringify(result)}`);
        return { name: "taskStartMarkerClearFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) throw new Error("forced unreadable task key after remove");
            return originalGetItem.call(this, key);
          };

          try {
            const completion = window.pmMetrics.markTaskComplete(taskName, { done: true });
            const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
            return {
              persisted: completion?.persisted === true,
              markerCleared: completion?.markerCleared === true,
              stillPresent: keys.includes(taskKey)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.persisted === true, `Terminal write should persist when the removed task marker becomes unreadable: ${JSON.stringify(result)}`);
        assert(result.markerCleared === true, `markTaskComplete did not report marker removal success when the key was gone but unreadable via getItem: ${JSON.stringify(result)}`);
        assert(result.stillPresent === false, `Unreadable-after-remove task marker was still present: ${JSON.stringify(result)}`);
        return { name: "taskStartMarkerUnreadableAfterRemoveCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalRemoveItem = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) {
            if (key === taskKey) throw new Error("forced task marker remove failure");
            return originalRemoveItem.call(this, key);
          };

          try {
            const completion = window.pmMetrics.markTaskError(taskName, "boom");
            const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
            return {
              persisted: completion?.persisted === true,
              markerCleared: completion?.markerCleared === true,
              markerAfter: localStorage.getItem(taskKey),
              eventNames: events.filter(event => event.task_name === taskName).map(event => event.event_name)
            };
          } finally {
            Storage.prototype.removeItem = originalRemoveItem;
          }
        });
        assert(result.persisted === true, `Task error write should still persist when marker removal fails: ${JSON.stringify(result)}`);
        assert(result.markerCleared === false, `markTaskError reported marker removal success despite removeItem failure: ${JSON.stringify(result)}`);
        assert(result.markerAfter !== null, `Forced marker removal failure unexpectedly cleared the task marker after task_error: ${JSON.stringify(result)}`);
        assert(result.eventNames.join(",") === "task_start,task_error", `Task error write did not preserve expected task events when marker removal failed: ${JSON.stringify(result)}`);
        return { name: "taskErrorMarkerClearFailureCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));

          const originalGetItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (key) {
            if (key === taskKey) throw new Error("forced unreadable task key after remove");
            return originalGetItem.call(this, key);
          };

          try {
            const completion = window.pmMetrics.markTaskError(taskName, "boom");
            const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
            return {
              persisted: completion?.persisted === true,
              markerCleared: completion?.markerCleared === true,
              stillPresent: keys.includes(taskKey)
            };
          } finally {
            Storage.prototype.getItem = originalGetItem;
          }
        });
        assert(result.persisted === true, `Task error write should persist when the removed task marker becomes unreadable: ${JSON.stringify(result)}`);
        assert(result.markerCleared === true, `markTaskError did not report marker removal success when the key was gone but unreadable via getItem: ${JSON.stringify(result)}`);
        assert(result.stillPresent === false, `Unreadable-after-remove task marker was still present after task_error: ${JSON.stringify(result)}`);
        return { name: "taskErrorMarkerUnreadableAfterRemoveCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const now = Date.now();
          localStorage.clear();
          localStorage.setItem(taskKey, String(now - 60000));
          localStorage.setItem(eventsKey, JSON.stringify([{
            event_name: "task_complete",
            task_name: taskName,
            event_time: new Date(now - 1000).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: "already-complete",
            app_version: "pm-v1",
            page_path: "/"
          }]));
          window.pmMetrics.markTaskComplete(taskName, { done: true });
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events.map(event => event.event_name)
          };
        });
        assert(result.eventNames.join(",") === "task_complete,task_complete", `Closed task incorrectly backfilled a new task_start before terminal event: ${JSON.stringify(result)}`);
        return { name: "taskStartBackfillClosedCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"task_start\"")) {
            failed = true;
            throw new Error("forced task_start event write failure before task_error");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          localStorage.clear();
          window.pmMetrics.markTaskStart("learning_hub_overview_task");
          window.pmMetrics.markTaskError("learning_hub_overview_task", "boom");
          const events = JSON.parse(localStorage.getItem("pm_metrics_events_P00-dashboard") || "[]");
          return {
            eventNames: events.map(event => event.event_name)
          };
        });
        assert(result.eventNames.join(",") === "task_start,task_error", `Missing task_start backfill before task_error event: ${JSON.stringify(result)}`);
        return { name: "taskErrorBackfillCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await createReadyPage(context, origin);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          const markerTime = Date.now() - (60 * 60 * 1000);
          const base = Date.now() - (30 * 60 * 1000);
          const filler = Array.from({ length: 500 }, (_, index) => ({
            event_name: "cta_click",
            event_time: new Date(base + (index * 1000)).toISOString(),
            project_id: "P00-dashboard",
            project_cluster: "学习中枢",
            session_id: `fill-${index}`,
            app_version: "pm-v1",
            page_path: "/",
            control_id: `b${index}`
          }));
          localStorage.clear();
          localStorage.setItem(taskKey, String(markerTime));
          localStorage.setItem(eventsKey, JSON.stringify(filler));
          window.pmMetrics.markTaskError(taskName, "boom");
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            count: events.length,
            eventNames: events.filter(event => event.task_name === taskName).map(event => event.event_name)
          };
        });
        assert(result.count === 500, `task_error backfill retention changed total retained event count unexpectedly: ${result.count}`);
        assert(result.eventNames.join(",") === "task_start,task_error", `Backfilled task_start was trimmed away before task_error under retention cap: ${JSON.stringify(result)}`);
        return { name: "taskErrorBackfillRetentionCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    results.push(await runIsolatedCase(browser, server.origin, async (context, origin) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        let failed = false;
        Storage.prototype.setItem = function (key, value) {
          if (key === "pm_metrics_events_P00-dashboard" && !failed && String(value).includes("\"task_start\"")) {
            failed = true;
            throw new Error("forced combined task_start/task_error write failure");
          }
          return originalSetItem.call(this, key, value);
        };
      });
      const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      assert(response && response.status() === 200, `Unexpected HTTP status: ${response ? response.status() : "none"}`);
      try {
        const result = await page.evaluate(() => {
          const taskName = "learning_hub_overview_task";
          const taskKey = "pm_metrics_task_start_P00-dashboard::learning_hub_overview_task";
          const eventsKey = "pm_metrics_events_P00-dashboard";
          localStorage.clear();
          localStorage.setItem(taskKey, String(Date.now() - 2000));
          window.pmMetrics.markTaskError(taskName, "boom");
          const events = JSON.parse(localStorage.getItem(eventsKey) || "[]");
          return {
            eventNames: events.map(event => event.event_name),
            markerAfter: localStorage.getItem(taskKey)
          };
        });
        assert(result.eventNames.length === 0, `Task error write should not partially persist when backfill append fails: ${JSON.stringify(result)}`);
        assert(result.markerAfter !== null, "Task-start marker should remain after failed combined backfill/task_error write");
        return { name: "taskErrorBackfillAtomicityCase", status: "passed" };
      } finally {
        await page.close();
      }
    }));

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
