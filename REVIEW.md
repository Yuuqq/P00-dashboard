# P00-Dashboard review notes

This file describes **this tree**, not an earlier snapshot. It is a review record, not a claim that the suite is exceptional.

**Read:** `app.js` (2106 lines), `pm-metrics.js`, `sw.js`, `index.html`, `README.md`, `SPEC.md`, `QA.md`, `TASKS.md`, `scripts/static-check.mjs`, `scripts/regression-check.mjs`.

**Ran:** `npm run check` (syntax + static) passed on this change. Browser regression (`npm run regression`) is separate; this file does not claim a Playwright result until one is recorded on the commit.

**中文摘要：**

本审查对齐当前代码，不沿用上一轮已经过期的结论。

- 工具链接固定为 `https://yuuqq.github.io`。本仓库没有 50 个工具目录，`file://` 和 `localhost` 不能改成相对路径，否则「打开工具」会 404。仪表盘页面可以离线看；工具本体在 GitHub Pages，打开它们需要联网。README 已写明这条边界。
- Service Worker：文档导航改为 network-first，失败才回退缓存；预缓存单个失败会 `console.warn`，安装仍会完成。静态资源仍是 cache-first，并在后台刷新。缓存名是 `journalism-tool-P00-v3`。
- 英雄区仍是 `0/15 章节` 这种写法，冷启动时容易被看成空目录。文案修复留给 PR #1，本分支不改这组标签。
- `SPEC.md` / `QA.md` / `TASKS.md` 改成和真实界面一致的短说明：没有搜索、没有分类筛选，也不再无证据打勾。
- `innerHTML` 还在。导入数据进渲染之前有 allowlist。`escapeHtml` 在 `shared/global-nav.js`，而 `index.html` 没有加载这个文件，不要从 `app.js` 去引用它。
- 仓库没有 GitHub Actions。

---

## 1. Architecture

**[MEDIUM] Monolithic `app.js`**

- **File:** `app.js` (2106 lines)
- **Impact:** Catalog data, storage, and rendering still live in one file.
- **Fix:** Split with classic scripts loaded before `app.js`, or extract data only. Do not switch the onboarding path to `<script type="module">`; `file://` breaks modules, and README still tells teachers to double-click `index.html`.

---

## 2. Security

**[LOW] `innerHTML` template sinks**

- **Files:** `app.js` lines 1515 (`renderMissions`), 1581 (`openMissionModal`), 1777 (`syncCatalogCopy`), 1831 (`renderModules`), 1893 / 1903 / 1924 / 1944 (`renderStats`)
- **Impact:** Values are interpolated into HTML. Import is user-controlled, and it is constrained before render: `normalizeImportedSnapshot` / `sanitizeProgressPayload` allowlist mission ids and boolean `stepN` flags; `extractTrackedProjectId` only returns ids in `VALID_TOOL_IDS`. Current import-to-render path is constrained. The pattern becomes unsafe if a later change interpolates raw import strings.
- **Fix:** Prefer `textContent` / `createElement` for dynamic values. Do not pull in `escapeHtml` from `shared/global-nav.js`; that script is not on the P00 page.

---

## 3. Reliability

**[LOW] Export download bytes are still unasserted**

- **File:** `scripts/regression-check.mjs`
- **Impact:** Export payload, toasts, and failure paths are tested. The bytes behind `a.download` are not.
- **Fix:** Stub `URL.createObjectURL` / the anchor click inside the existing harness and assert `format`, `format_version`, and keys.

**[LOW] Service worker residuals**

- **File:** `sw.js`
- **Status:** Document navigations are network-first with cache fallback (`networkFirstDocument`). A failed precache entry is logged (`[P00-dashboard] Precache miss:`); install still completes so one missing file does not disable the shell. Cache name is `journalism-tool-P00-v3`, so the previous cache-first shell is dropped on activate.
- **Still open:** Same-origin static assets stay cache-first with a background refresh. `skipWaiting` and `clients.claim` are unchanged. A background refresh failure is logged, not surfaced in the page.

---

## 4. Maintainability

**[LOW] Listeners rebound after `innerHTML`**

- **File:** `app.js` lines 1535–1540 (`renderMissions`) and 1597 (`#modalSteps .tool-link`)
- **Impact:** Replacing `innerHTML` drops the old nodes, so this is not a leak. Event delegation would be easier to maintain.
- **Fix:** One listener on the parent, dispatched with `closest`.

**[LOW] Metrics DOM ids are an in-repo contract smell**

- **File:** `pm-metrics.js` lines 229, 238, 731, 760
- **Impact:** `#toastContainer` is created at runtime by `shared/toast.js`. `#status` is not in `index.html`. This file is P00-specific (`PROJECT_ID = "P00-dashboard"`). Reusability is not a goal.
- **Fix:** Stop observing the missing `#status` node. Keep the toast lookup local to this dashboard.

---

## 5. Documentation and classroom behavior

**[OPEN, owned by PR #1] Empty hero stats**

- **Files:** `index.html`, `app.js` `syncCatalogCopy`
- **Impact:** A fresh browser still shows `0/15 章节`, `0/5 任务`, `0/50 涉及工具`. That reads like an empty catalog even though the mission cards are on the page. This branch does not change that copy; PR #1 already has the classroom wording and note.

**[ACCEPTED] `SITE_BASE` stays on production**

- **File:** `app.js` line 7
- **Impact:** Tool links are `https://yuuqq.github.io/<id>-<slug>/` for every host, including `file://` and `localhost`. A relative `"."` 404s, because this repository does not contain the 50 tool directories. The dashboard shell can be used offline; opening a tool needs the network. README states that. `scripts/static-check.mjs` locks the constant, and `interactiveSemanticsCase` asserts the full module and mission-step hrefs.

**[LOW] No CI**

- **Impact:** `npm run check` and the browser suite are local-only. There is no `.github/workflows` file.

**[LOW] Unused shared surface**

- **Impact:** `index.html` loads `pm-metrics.js`, `shared/toast.js`, `app.js`, and `shared/dark-toggle.js`. `shared/vendor/*`, `shared/global-nav.js`, and `modern-styles.css` are not on that path. Do not treat vendor code as part of the P00 XSS surface.

**[CLOSED in README] Metrics privacy**

- **File:** `README.md`
- **Impact:** `pm-metrics` writes `localStorage` keys prefixed with `pm_metrics_` and does not send a beacon. The README now says so.
