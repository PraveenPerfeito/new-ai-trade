# SYSTEM_OPERATIONS_CENTER_1

**Date:** June 2026  
**Branch:** main  
**Objective:** Consolidate all founder operational controls into System → Health tab. Single source of truth.

---

## 1. Components Added

### `FounderOperationsCard` (system/page.tsx)
- Mounted at the TOP of System → Health tab
- **Phase A — Status grid (8 tiles):**
  - Scanner: SCANNING / ACTIVE / DISABLED
  - Claude AI: ACTIVE / DISABLED
  - Telegram: ACTIVE / DISABLED
  - Emergency Stop: ON / OFF
  - Maintenance: ON / OFF
  - Last Scan: X min ago
  - Signals (24h): N
  - Queue: Healthy / Warning / Offline
- **Phase B — Operational Controls (6 buttons):**
  - Scan Now (Phase C)
  - Pause / Enable Scanner
  - Claude AI ON/OFF
  - Telegram ON/OFF
  - Emergency Stop (toggle, red when active)
  - Maintenance Mode (toggle, amber when active)
- **Phase F — Status color logic:**
  - Emergency Stop ON → red border, CRITICAL label
  - Any of: Scanner disabled, Claude disabled, Telegram disabled, Maintenance ON → amber border, WARNING label
  - All nominal → OPERATIONAL

### `AdvancedOperationsAccordion` (system/page.tsx)
- Mounted at BOTTOM of System → Health tab, collapsed by default
- **Phase D — Contains:**
  - Feature Flags: 5 toggleable flags (probability_gate_v1, riskgrade_v2, confidence_calibration_v2, early_breakout_penalty_v1, regime_hard_gate_v2)
  - Provider Diagnostics (ProviderHealthTable)
  - Queue & Scanner Diagnostics (8 metrics from MonitorSnapshot)
  - Gate Rejection Diagnostics (PipelineIntegrityCard + GateRejectionGrid)
  - Redis & Infrastructure Config (InfraConfigSection)

---

## 2. Components Moved (Phase D)

| Component | From | To |
|---|---|---|
| `ProviderHealthTable` | Health tab top-level | Advanced Operations accordion |
| `PipelineIntegrityCard` | Health tab top-level | Advanced Operations accordion |
| `GateRejectionGrid` | Health tab top-level | Advanced Operations accordion |
| `InfraConfigSection` | Health tab top-level | Advanced Operations accordion |

---

## 3. Components Removed (Phase E)

From `app/admin/signals/page.tsx` OverviewTab:
- Scan Now button (was incomplete, never wired to JSX call)
- Pause / Resume scanner button
- Claude AI toggle button
- Unused props: `onPause`, `pausing`, `onScanNow`, `scanning`, `scanDone`, `aiEnabled`, `onToggleAI`, `opLoading`, `opError`

Scanner card in Signals → Overview is now read-only (shows status + last/next scan). No duplicate controls.

---

## 4. APIs Reused (no new backend logic)

| API | Used for |
|---|---|
| `adminApi.scheduler.status()` | Scanner enabled/scanning/last_scan_at |
| `adminApi.scheduler.start()` | Enable Scanner button |
| `adminApi.scheduler.stop()` | Pause Scanner button |
| `adminApi.settings.group('features')` | emergency_stop, maintenance_mode flags |
| `adminApi.settings.group('ai')` | ai.enabled flag |
| `adminApi.settings.group('telegram')` | telegram.alerts_enabled flag |
| `adminApi.settings.patch(group, {key: value})` | All flag toggles |
| `POST /api/scanner/run` | Scan Now button (Phase C) |
| `/health/ready` (already loaded) | Queue status (celery_worker check) |
| MonitorSnapshot (already loaded) | signals_per_day, scan duration, etc. |

---

## 5. User Flow Improvement (Phase G check)

Before: Operational controls scattered across Signals → Overview (incomplete) and Settings tab.

After: Founder can answer all 6 questions within 10 seconds from System → Health:

1. **Is scanner running?** → Scanner tile: ACTIVE / DISABLED / SCANNING
2. **Is Claude running?** → Claude AI tile: ACTIVE / DISABLED
3. **Is Telegram running?** → Telegram tile: ACTIVE / DISABLED
4. **Is queue healthy?** → Queue tile: Healthy / Warning / Offline
5. **Can I run a scan?** → Scan Now button (disabled when emergency_stop or maintenance active)
6. **Any critical controls active?** → Emergency Stop / Maintenance tiles + card border color

---

## 6. Navigation Simplification

- `/admin/signals` (Signals center): pure signals/regime view, no scanner controls
- `/admin/system` → Health tab: single source of truth for all operational controls
- No duplicate controls anywhere in the UI

---

## 7. Risk Assessment

- **Low**: All APIs already existed and are tested (settings service, scheduler, scanner run)
- **Low**: No backend changes — UI only
- **Low**: Advanced Operations accordion is collapsed by default, no behavioral change unless user opens it
- **Medium**: FounderOperationsCard's Emergency Stop button requires careful use (same risk as it had in Settings tab)
- **Mitigated**: Emergency Stop button has no confirmation dialog (same as Settings tab behavior)

---

## 8. Rollback Plan

All changes are in two files:

1. `app/admin/signals/page.tsx` — restore OverviewTab signature to include action props and restore button UI
2. `app/admin/system/page.tsx` — remove FounderOperationsCard, AdvancedOperationsAccordion, their interfaces/helpers, and the new state/handlers from SystemPage; restore the old Health tab structure (ProviderHealthTable, PipelineIntegrityCard, GateRejectionGrid, InfraConfigSection inline)

Git: `git revert HEAD` if committed as a single commit.
