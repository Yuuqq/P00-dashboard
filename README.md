# P00 Dashboard

Standalone dashboard for the journalism tools collection.

## Overview

This project is a self-contained learning dashboard with:

- Local mission progress tracking
- Dashboard-side metrics collection and export/import
- PWA shell support for offline reloads
- Browser regression coverage for storage corruption, migration, retry, and retention edge cases

## Local checks

Run syntax checks:

```powershell
npm run check
```

Run the browser regression suite:

```powershell
npm run regression
```

Notes:

- The regression harness lives at `scripts/regression-check.mjs`.
- It expects `playwright` to be resolvable from this workspace or a parent workspace.

## What The Regression Suite Covers

The regression suite focuses on the failure modes that are easiest to miss in manual testing:

- Storage corruption and unreadable-key handling
- Export/import rollback safety
- Legacy metric/task-marker migration and alias normalization
- Mission start/reset/complete recovery behavior
- Pending metric flush behavior under transient write failure and 500-event retention
- Status signal tracking from both `#status` nodes and real toast notifications
- App-level toast replacement fallback behavior when `window.replaceToasts` is unavailable
- Same-page resync after clear, restore, or in-place repair
- Offline shell behavior, service worker cache cleanup, cached shared scripts, and service-worker registration warning fallback

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

Managed storage safety warnings are also deduplicated while visible and can reappear later if the unsafe state persists after dismissal.

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

The regression suite also verifies old same-prefix caches are cleaned up on activation.
