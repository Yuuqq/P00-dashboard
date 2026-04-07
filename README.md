# P00 Dashboard

Standalone dashboard for the journalism tools collection.

## Overview

This project is a self-contained learning dashboard with:

- Local mission progress tracking
- Dashboard-side metrics collection and export/import
- PWA shell support for offline reloads
- Browser regression coverage for storage corruption, migration, retry, and retention edge cases

## Local checks

Run JavaScript syntax checks only:

```powershell
npm run syntax
```

Run fast syntax and static asset checks:

```powershell
npm run check
```

Run the fast static contract checks only:

```powershell
npm run static
```

Run the Playwright/browser regression harness only:

```powershell
npm run browser
```

Run the full regression path:

```powershell
npm run regression
```

Notes:

- The browser regression harness lives at `scripts/regression-check.mjs`.
- The fast static check lives at `scripts/static-check.mjs` and validates manifest/index local asset refs, source-level PWA identity fields, catalog integrity/count copy, expected stylesheet/script order, `index.html`/`app.js` DOM-id contracts, tab mapping/startup state and a11y attributes, tab/modal accessibility wiring, shared toast helper exports/usage contracts, theme-color/background-color contracts against design tokens, and duplicate-free `sw.js` `CORE_ASSETS` coverage for those assets.
- `npm run syntax` runs `node --check` across the dashboard entrypoints and shared scripts.
- `npm run static` runs only the static contract checks.
- `npm run browser` runs only the Playwright regression harness.
- `npm run regression` runs the static check first, then the Playwright regression harness.
- It expects `playwright` to be resolvable from this workspace or a parent workspace.

## What The Regression Suite Covers

The combined `npm run regression` path focuses on the failure modes that are easiest to miss in manual testing:

- Storage corruption and unreadable-key handling
- Export/import rollback safety
- Legacy metric/task-marker migration and alias normalization
- Mission start/reset/complete recovery behavior
- Pending metric flush behavior under transient write failure and 500-event retention
- Status signal tracking from both `#status` nodes and real toast notifications
- App-level toast replacement fallback behavior when `window.replaceToasts` is unavailable
- Module badge precedence (`✓ 已用` vs `↺ 已恢复`) and stats-panel empty/positive rendering states
- Catalog integrity checks for duplicate tool ids, missing slugs, and mission/tool reference drift
- Same-page resync after clear, restore, or in-place repair
- Theme-color sync, cross-tab theme preference sync/reset/clear, unrelated-storage ignore behavior, and system-theme follow/ignore behavior across both modern and legacy `matchMedia` listener paths
- Offline shell behavior, service worker cache cleanup, cached shared scripts, and service-worker registration warning fallback
- Static service-worker asset coverage checks so `CORE_ASSETS`, `index.html`, and `manifest.json` stay aligned

## Storage Safety Model

The dashboard is intentionally conservative about browser storage:

- Corrupt or unreadable progress/metrics storage is treated as unsafe for export and destructive clear flows.
- Task-start markers are lower-priority state; unreadable markers block mission resume fidelity but do not block safe restore/clear rollback behavior.
- Public snapshot/export helpers throw `snapshot_failed` when the current storage state is unsafe instead of returning partial data.
- Collector writes refuse to overwrite unreadable or corrupt existing metric logs.

## UI Semantics

Outcome toasts intentionally replace stale visible toasts before showing their own result message:

- Import success, cancel, invalid input, and restore failure
- Export success and export preflight/build failure
- Clear success and clear rollback/failure
- Mission step/reset success and progress-save failure
- Popup-blocked warnings
- Theme persistence warning
- Managed storage safety warnings

This keeps old visible status messages from being rehydrated into later metric events while still preserving the original tracked signal in storage.

Two toast behaviors matter for metrics:

- Outcome toasts shown through `showFreshToast()` replace visible stale toasts and suppress active-status rehydration.
- That replacement behavior is also regression-tested through the internal fallback path used when `window.replaceToasts` is unavailable.
- Some informational outcomes intentionally use `track: false` so the UI still tells the user what happened without creating a new status signal event.

The shared toast layer exposes three distinct helpers:

- `showToast()` appends a toast without clearing earlier ones.
- `replaceToasts()` clears visible toasts first, then shows the next toast.
- `showFreshToast()` uses `replaceToasts()` when available and falls back to the same clear-and-suppress behavior when it is not.

Managed storage safety warnings are also deduplicated while visible and can reappear later if the unsafe state persists after dismissal.

## Theme Behavior

The shared dark-mode toggle follows a simple contract:

- Without a stored preference, the dashboard follows the current system color scheme and returns to that system theme after cross-tab preference removal or full storage clear.
- If `window.matchMedia` is unavailable, the dashboard falls back to light mode until the user explicitly pins a theme.
- Invalid stored theme values are treated the same as having no stored preference: they are ignored and the dashboard falls back to the current system theme.
- Unreadable stored theme values are also treated as missing, so startup and cross-tab sync fall back to the current system theme instead of breaking the UI state.
- The toggle button icon and ARIA state are initialized from the resolved startup theme, so the control stays aligned with the page theme even before any later theme change events.
- Once the user pins a theme, later system theme changes are ignored until that stored preference is removed.
- Unrelated cross-tab storage writes should not retrigger theme application or disturb the pinned theme UI state.
- The shared toggle keeps both the modern `matchMedia.addEventListener("change", ...)` path and the legacy `matchMedia.addListener(...)` fallback.

## Catalog Copy

Visible catalog counts are intentionally derived from the runtime catalog instead of being maintained as unrelated literals:

- Hero subtitle and hero stat max labels
- Modules panel description
- Footer catalog count
- Page meta description

The fast static check validates the source `index.html`/`manifest.json` copy against the actual module, mission, and tool counts, and the browser regression covers the live DOM rendering.
Those visible counts intentionally follow the rendered module entries, while duplicate ids and other catalog-shape problems are handled by the separate catalog-integrity checks.

## Catalog Integrity

The catalog is treated as a contract, not just loose content:

- Tool ids are expected to stay unique across all modules.
- Every tool id is expected to have a matching slug entry.
- Mission steps are expected to reference only known tool ids.
- The slug map is expected not to contain entries for tools that are no longer in the catalog.

`validateCatalogIntegrity()` still warns at runtime, but the fast static check and regression command now also fail fast on these mismatches so catalog drift is caught before shipping.

## Module And Stats Semantics

Two UI conventions are intentionally stable:

- In the modules panel, `✓ 已用` takes precedence over `↺ 已恢复` when both metric history and restored task progress exist for the same tool.
- In the stats panel, empty-state copy distinguishes between self-metrics-only activity, restored progress without tool history, and fully empty storage.

## Public Helper Contracts

The dashboard exposes a few storage-facing helpers to the page. Their behavior is intentionally fail-fast:

- `getManagedStorageSnapshot()` throws `snapshot_failed` when managed storage is unreadable or structurally unsafe.
- `getBackupStorageSnapshot()` throws `snapshot_failed` when backup/export-critical storage is unreadable or unsafe.
- `buildExportPayload()` throws `snapshot_failed` instead of emitting partial backup data.
- `pmMetrics.getSummary()` reports `storage_readable: false` with `null` counts when the stored event log cannot be trusted.
- `pmMetrics.exportEvents()` throws `snapshot_failed` on corrupt or unreadable event storage.

## PWA Notes

The service worker caches the standalone shell and shared assets needed for offline reload:

- `index.html`
- `styles.css`
- `app.js`
- `pm-metrics.js`
- `shared/dark-toggle.js`
- `shared/toast.js`
- `manifest.json`
- icon assets

The browser regression verifies old same-prefix caches are cleaned up on activation.
The fast static check verifies that `sw.js` `CORE_ASSETS` stays aligned with asset references in `index.html` and icon entries in `manifest.json`.
It also treats manifest `id`, `start_url`, and `scope` as part of the offline contract: they are expected to stay relative so standalone launch and cache coverage remain aligned.
