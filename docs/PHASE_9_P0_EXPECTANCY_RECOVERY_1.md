# PHASE.9.P0.EXPECTANCY.RECOVERY.1

**Date:** 2026-06-11 · **Scope:** P0 items from PHASE.9.ALPHA.MAXIMIZATION.1 only. No probability engine, no confidence recalibration, no RiskGrade 2.0, no Edge Matrix, no monetization (Phase 9.1+).

## Workstream status

| WS | Name | Status |
|---|---|---|
| 1 | REGIME.HARD.GATE.V2 | ✅ Shipped previously (commit `a1771c7`) — flag `regime_hard_gate_v2` OFF, telemetry + Regime card live |
| 2 | OUTPUT.COLLAPSE.ALERT.1 | ✅ Implemented |
| 3 | KLINE.EMPTY.TELEMETRY.1 | ✅ Implemented |
| 4 | EARLY.BREAKOUT.PENALTY.1 | ✅ Implemented |
| 5 | BB.EXPANSION.RETIREMENT.1 | ✅ **Already retired in production code** — locked with regression tests (see note) |
| 6 | ATTRIBUTION.SNAPSHOTS.1 | ✅ Implemented |

**WS5 note:** `breakout_intelligence.py` already classifies pure BB expansion as NONE ("Pure BB expansion has negative expectancy in restored live outcomes; keep BB only as confirmation on a structure break"). The toxic n=68 cohort (WR 20.6%) predates that fix. Adding a re-enable flag would create dead code and a footgun; instead the retirement is **locked** by behavioral + static regression tests (`TestBbExpansionRetired`). Rollback path: git revert of the original retirement (none needed). The `+bb_expansion` HIGH_MOMENTUM combo (WR 81.8%) is untouched and test-protected.

## 1. Files Modified

| File | Workstream |
|---|---|
| `backend/system_settings/groups.py` | Flags (WS2/4/6) |
| `backend/core/scanner/signal_pipeline.py` | WS3 kline gates, WS4 penalty, single per-coin flag read (gate v2 refactored onto it) |
| `backend/core/scanner/market_fetcher.py` | WS3 per-exchange timeout counters |
| `backend/analytics/scan_metrics.py` | WS3 gate keys + aliases |
| `backend/core/scanner/orchestrator.py` | WS3 persisted gate keys |
| `backend/analytics/monitoring.py` | WS2 collapse evaluation + status + snapshot field |
| `backend/core/scanner/telegram_notifier.py` | WS2 `send_output_collapse_alert()` |
| `backend/workers/scan_task.py` | WS2 per-cycle check hook |
| `backend/analytics/outcome_learning.py` (new) | WS6 aggregation |
| `backend/workers/analytics_tasks.py` | WS6 Celery task |
| `backend/workers/beat_schedule.py` | WS6 nightly 00:15 UTC |
| `database/attribution-snapshots-migration.sql` (new) | WS6 |
| `lib/admin-api.ts` | WS2 `MonitorSnapshot.output_collapse` type |
| `app/admin/system/page.tsx` | WS2 collapse banner, WS3 gate grid labels |
| `backend/core/scanner/tests/test_p0_expectancy_recovery.py` (new) | All |

## 2. Functions Modified / Added

- `scan_coin()` — flag read (once per coin, 60s cached), kline EMPTY/PARTIAL classification, `early_breakout_score_adj()` applied to `effective_score` before `validate_signal()`
- `early_breakout_score_adj()` (new, pure) — −8 for flag-ON + BUY + EARLY_BREAKOUT only
- `_record_binance_kline_metric()` / `_flush_binance_metrics()` — per-exchange timeout accumulation → `klineTimeouts:spot|futures` hash fields (same 5s batched pipeline; zero extra Redis ops on the happy path)
- `fetch_spot_klines()` / `fetch_futures_klines()` — `httpx.TimeoutException` branches
- `evaluate_output_collapse()` (new, pure) · `check_output_collapse()` · `read_output_collapse_status()` · `_read_db_signals_7d_avg()`
- `send_output_collapse_alert()` (new)
- `get_monitoring_snapshot()` — `output_collapse` field
- `outcome_learning.aggregate_rows()` / `compute_snapshots()` (new) · `compute_attribution_snapshots` Celery task (new)

## 3. Feature Flags Added

| Flag | Default | Rationale |
|---|---|---|
| `regime_hard_gate_v2` | **OFF** | Changes signal selection (WS1, prior commit) |
| `early_breakout_penalty_v1` | **OFF** | Changes signal scoring |
| `output_collapse_alert` | **ON** | Pure observability — the incident this fixes was *silence*; house precedent: `anomaly_detection` defaults ON |
| `attribution_snapshots` | **ON** | Pure-additive analytics (new table only); precedent: `daily_analytics_snapshot` defaults ON |

No flag alters trading behavior at its default.

## 4. Database Changes

One additive migration — run `database/attribution-snapshots-migration.sql` in Supabase: `attribution_snapshots` table + lookup index. No existing table touched. 90-day retention pruned by the nightly task.

## 5. Telemetry Added

- Gate keys `KLINE_EMPTY` (all timeframes empty — the June 6–9 API-outage signature) and `KLINE_PARTIAL` (<60 candles, thin listing) → `gate_rejections` per scan → `scan_metrics_log` + System grid. Prometheus: `gate_rejections_total{gate="kline_empty:binance_spot|binance_futures"}`.
- `KLINE_TIMEOUT` per exchange: Prometheus `external_api_errors_total{service,error_type="timeout"}` (existed) + new Redis hash fields `klineTimeouts:spot/futures` on the Binance provider meta key. Deviation from spec: timeouts surface as empty candle lists at scan level, so the scan-level gate key would always read 0 — they are tracked at the fetch layer instead, which is where they occur.
- Collapse status keys: `monitor:output_collapse:{breaches,status,alerted}` (TTLs 2h/24h/6h).
- Structured logs: `kline_empty`, `kline_partial`, `spot_klines_timeout`, `futures_klines_timeout`, `early_breakout_buy_penalty_applied`, `output_collapse_breach`, `output_collapse_detected`, `output_collapse_alert_sent`, `attribution_snapshot_window_done`.

## 6. Dashboard Changes

- System → red **Signal Output Collapse** banner when active (signals_24h, baseline, threshold, streak + pointer to KLINE gate rejections).
- System → gate grid: "Kline empty" / "Kline partial" cells (existing `CONTRA_REGIME_REJECTION` cell from WS1).
- No redesigns (explicitly out of scope).

## 7. Testing Plan (executed)

- 28 new tests in `test_p0_expectancy_recovery.py`: collapse boundary math (25% strict, 3/day baseline floor), kline key wiring, penalty function paths (incl. SELL-side EARLY never penalized — it is alpha), bb_expansion behavioral + static regression locks, snapshot aggregation (MIN_CELL_N drop, WR/exp/PF math, NULL-loss PF), flag defaults.
- Full backend suite: **577 passed**. `npx tsc --noEmit`: clean.
- Post-deploy validation: trigger a scan; confirm `output_collapse` field appears in `/api/analytics/monitor`; toggle `early_breakout_penalty_v1` ON and verify `early_breakout_buy_penalty_applied` logs; confirm first nightly snapshot rows after 00:15 UTC.

## 8. Deployment Plan

1. Run `attribution-snapshots-migration.sql` in Supabase (before or after deploy — task no-ops gracefully on missing table until then, then succeeds next night).
2. Deploy Railway (worker + beat pick up new task/schedule) + Vercel.
3. Day 0: confirm collapse status populates and KLINE cells appear (likely 0).
4. Day 1+: enable `early_breakout_penalty_v1` from Founder settings when ready; `regime_hard_gate_v2` per WS1 plan.

## 9. Rollback Plan

- WS2/WS4: flag OFF → identical behavior (WS4 default is already OFF).
- WS3: telemetry only; keys read 0 if reverted. No consumer breaks (grid renders `?? 0`).
- WS6: flag OFF stops writes; table is inert. `DROP TABLE attribution_snapshots` fully reverses the migration.
- No schema or behavior change requires a code rollback.

## 10–12. Expected Impact (validation-bucketed, per audit data)

| Metric | Expected | Basis |
|---|---|---|
| **Win Rate** | +0 immediately (all behavior flags OFF). With `early_breakout_penalty_v1` ON: removes most of the EARLY-BUY cohort (WR ≈17–27%) from delivery → blended +1–2pp. With gate v2 ON at next BULL regime: structurally larger | EARLY BUY n≈53/30d; contra-regime n=200 |
| **Expectancy** | Penalty ON: +0.02–0.04R blended (small cohort, very negative). Collapse alert: prevents ~0-signal days (June 6–9 ≈ 700 missed signals ≈ the entire week's expectancy) | 30d audit |
| **Profit Factor** | Blended 1.20 → ~1.25 with penalty ON; the large PF moves (probability gating → ~2.3) are Phase 9.1, which WS6 unblocks | Audit §18 |

The honest framing: P0 is **floor-raising and instrumentation** — it stops silent failure modes and builds the data foundation. The big expectancy unlocks (probability gating, grade recalibration) consume WS6's snapshots in Phase 9.1.

## 13. GO / NO-GO

**GO.** All items flag-gated or pure-additive; production behavior at defaults is byte-identical for signal selection; 577 tests green; one additive migration; every change independently reversible.
