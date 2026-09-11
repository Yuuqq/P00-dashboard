# 🔍 P00-Dashboard Code Review

This is a comprehensive code review of the `P00-dashboard` repository based on the review goals outlined.

Overall, the repository is an impressive locally-run learning dashboard. The robust fallback mechanisms, metrics resilience, and extremely thorough testing suite stand out as exceptional for a vanilla JavaScript application.

**Files Read / Executed:**
- `app.js` (2104 lines)
- `pm-metrics.js`
- `sw.js`
- `scripts/*` (regression tests)
- `SPEC.md`, `QA.md`, `TASKS.md`

**中文摘要 (Chinese Summary):**
本审查重点关注 P00-Dashboard 的代码架构、可靠性和维护性。应用在测试覆盖和无网降级方面表现出色，但也存在一些维护性（如 app.js 的单体结构、事件监听器管理）及文档与实际功能脱节的问题。提出的修改建议均考虑了当前“双击 index.html 即可运行”的本地优先体验。

---

## 1. Architecture and Code Organization Quality

**[MEDIUM] Monolithic Application Structure in `app.js`**
- **File:** `app.js`
- **Impact:** `app.js` is 2104 lines and tightly couples static data definitions (`MISSIONS`, `MODULES`), local storage management, and UI rendering logic. This reduces maintainability and increases the likelihood of merge conflicts as the application grows.
- **Fix:** Separate concerns into distinct modules. **Note:** To preserve the primary onboarding path ("双击 `index.html`"), do not use standard ES6 `<script type="module">` which breaks over `file://`. Instead, split files but load them as classic scripts (e.g., extract data into `catalog.js` loaded before `app.js`), or keep the monolith and extract data only.

---

## 2. Security Issues

**[LOW] Unsafe HTML Injection via `innerHTML`**
- **Files:** `app.js` (lines 1513, 1579, 1775, 1829, 1891+ within `renderMissions`, `openMissionModal`, `syncCatalogCopy`, `renderModules`, `renderStats`)
- **Impact:** Functions use template literals injected directly into `.innerHTML`. The import functionality is a user-controlled path, however, it is currently constrained by allowlists (e.g., `normalizeImportedSnapshot`, `sanitizeProgressPayload`, `extractTrackedProjectId`) before reaching the render sink. While currently safe, this pattern remains vulnerable if future data sources or import structures change.
- **Fix:** Use safe DOM manipulation APIs like `document.createElement()` and `textContent` for dynamic values, or use a lightweight helper function (like the existing `escapeHtml`) before inserting dynamic HTML strings.

---

## 3. Reliability / Error Handling / Edge Cases

**[LOW] Download Bytes Unasserted (Export)**
- **File:** `scripts/regression-check.mjs`
- **Impact:** While the export flow is well-tested for building the payload and replacing toasts, the actual file download (Blob contents on disk via `a.download`) is not verified.
- **Fix:** Intercept the download or stub `URL.createObjectURL` / `<a>.click` inside the existing evaluate harness and assert the JSON `format`, `format_version`, and keys.

**[LOW] Service Worker Caching and Staleness**
- **File:** `sw.js`
- **Impact:** The service worker uses `skipWaiting` + `clients.claim` + cache-first + stale-while-revalidate on every same-origin GET 200, including HTML. A failed `cache.addAll` is swallowed. Students on GitHub Pages can sit on a stale shell after a deploy.
- **Fix:** Handle failed `cache.addAll` robustly, and reconsider caching strategies for HTML files to prevent stale experiences.

---

## 4. Performance or Maintainability Concerns

**[LOW] Inconsistent Event Listener Management on Re-renders**
- **File:** `app.js` (lines 1533-1540 within `renderMissions`)
- **Impact:** After updating `innerHTML`, event listeners are bound directly to newly created `.mission-card` elements. While not a memory leak (old nodes are GC'd), this approach is less maintainable than event delegation.
- **Fix:** Implement event delegation on the parent container.

**[LOW] Metrics DOM IDs as In-Repo Contract Smells**
- **File:** `pm-metrics.js` (lines 229, 238, 731, 760)
- **Impact:** `pm-metrics.js` explicitly queries for elements using hardcoded IDs like `document.getElementById("status")` (which is dead/doesn't exist in `index.html`) and `document.getElementById("toastContainer")`.
- **Fix:** Remove queries for dead elements and refactor `pm-metrics.js` to accept configuration options for target DOM selectors.

---

## 5. Documentation and Developer-Experience Gaps

**[HIGH] Stale Product Docs Contract Bug**
- **Files:** `SPEC.md`, `QA.md`, `TASKS.md`
- **Impact:** These files are leftover stubs that describe a different app (e.g., search, category filtering) which contradicts the shipping UI. `QA.md` incorrectly checks off features that don't exist, leading to classroom false confidence.
- **Fix:** Remove or rewrite these stubs to reflect the actual dashboard features. See PR #1 regarding empty progress misreads.

**[MEDIUM] `SITE_BASE` Hardcoded to Production**
- **File:** `app.js`
- **Impact:** `SITE_BASE` is hardcoded to "https://yuuqq.github.io". Tool links and `openExternalTool` always leave the local/offline copy for production GH Pages, breaking the "离线可用" (offline-capable) promise in the README.
- **Fix:** Use relative paths or detect local vs GH pages for `SITE_BASE`.

**[LOW] Missing CI**
- **File:** Repository root
- **Impact:** 239 browser cases and `npm run check` exist, but there is no GitHub Actions workflow (`.github/workflows`) to run them automatically.

**[LOW] Metrics Privacy Clarification**
- **File:** `README.md`
- **Impact:** While data never leaves the device (no beacon), it is worth stating explicitly that `pm-metrics` is localStorage-only to clarify the threat model.
