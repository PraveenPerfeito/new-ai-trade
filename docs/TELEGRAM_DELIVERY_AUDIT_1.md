# TELEGRAM.DELIVERY.AUDIT.1

**Date:** 2026-06-12 · **Method:** read-only — live production DB queries (`scripts/telegram_delivery_audit.py`, `scripts/audit_followup.py`), Redis key census, full code-path tracing. **No code was modified.**

---

## 1. Executive Summary

Telegram is not "losing" signals randomly — the funnel is fully explained by data:

- **7d funnel: 208 generated → 198 alert-eligible (conf ≥ 85) → 115 sent (58%).** Of the 83 eligible-but-unsent, **76 (92%) are deduplication shadows**: the same coin+direction firing across overlapping scan modes within the 1-hour cooldown (e.g. TRX SELL fired by high_confidence 00:05 → futures 00:10 → trending 00:20; only the first sent). **This is the designed dedup working — but it is invisible**, so it reads as loss.
- **Operational alerts arrive reliably while signal alerts feel inconsistent** because ops alerts use a synchronous direct POST (`_send_failure_alert`) while signal alerts ride an **in-memory asyncio queue that dies with the scan's event loop** — messages still queued when `asyncio.run()` returns are silently destroyed, *after* `telegram_sent=true` was already recorded.
- **Claude is effectively decorative in delivery**: 95.8% of validator calls fall back to heuristic (setup < 78); of the 82 real Claude calls, **only 5 approved (6%), average stated confidence 65** — zero delivered signals in 7 days carry CLAUDE source. Plus a **live bug**: 3 calls died with `Semaphore is bound to a different event loop`.
- Claude cost is trivial (~**$1.1/month**). Redis keyspace is tiny (87 keys). Neither is the problem the symptoms suggested.
- Low signal volume is **MTF gate + SIDEWAYS regime**: 79.8% of all 7d gate rejections are multi-timeframe confirmation failures — correct behavior in a directionless market.

## 2. Signal Pipeline Flow (7 days, production counts)

| Stage | Count | Notes |
|---|---|---|
| Generated (persisted) | **208** | June 5–9 nearly dead (1–7/day — pre-CMC-fix era); June 10 burst 112 |
| Validated | 208 (100%) | every persisted signal is validated by design |
| Claude-approved | **0** | all 208 HEURISTIC |
| Heuristic-approved | 208 | |
| Alert-eligible (conf ≥ 85) | 198 | |
| telegram_sent = true | **115** | ⚠ means *enqueued*, not delivered (see §3) |
| Eligible but unsent | **83** | 76 dedup shadows + 7 other (rate cap / tail loss) |
| Active (unresolved) | 84 | |

Per-day: 06-05: 6/6 sent · 06-06: 1/1 · 06-07: 2/1 · 06-08: 5/4 · 06-09: 6/4 · **06-10: 109 eligible/58 sent** · 06-11: 55/35 · 06-12: 14/6.

## 3. Telegram Delivery Analysis (code-path truth)

**All conditions that block a send** (each verified in `telegram_notifier.py` / `orchestrator.py`):
1. `confidence < alert_thr` (env 85, floored by `scanner.alert_confidence`)
2. Probability gate (since 2026-06-12): cohort WR < 45 with n≥30
3. `telegram.alerts_enabled` OFF · 4. `features.telegram` OFF · 5. emergency stop · 6. maintenance
7. **Dedup: same symbol+direction within 1h** (`tg:alert:{SYM}:{DIR}`) — *dominant cause, 76/83*
8. **Hourly rate cap 20/hr** (`tg:hourly_count`) — binds on burst days (June 10: 109 eligible in a day)
9. Bot token/chat unconfigured

**Three structural reliability flaws (P0):**
- **F1 — `telegram_sent` is recorded at enqueue.** `send_signal_alert()` returns True after `_enqueue()`; actual delivery happens later in `_drain_queue()` with retry. A send that exhausts retries (`telegram_max_retries_exceeded`) is still `telegram_sent=true` in the DB. **There is no delivery ground truth anywhere.**
- **F2 — the queue dies with the scan's event loop.** The drain worker is a task on the loop created by `asyncio.run()` in `scan_task`. Signals are enqueued in a tight burst at scan end (results loop), rate-limited to 1 msg/1.1s — when `run_scan()` returns moments later, the loop closes and **queued tail messages are destroyed silently**. A 6-signal scan realistically delivers only the first ~2–4. `_QUEUE_MAX=64` drop-oldest adds a second loss path. This precisely matches "ops alerts always arrive (sync POST / long-lived loop), signal alerts inconsistently."
- **F3 — dedup poisoning.** `_is_duplicate_alert()` SETs the 1h cooldown key *at check time* — before the send is even queued. If the send is then lost (F2) or fails (F1), the symbol is still cooldown-locked for an hour, guaranteeing the signal is never re-deliverable.

## 4. Signal Loss Analysis (Phase D)

93 validated-unsent: 10 below threshold (correct), 83 eligible:
- **76 dedup shadows** — by mode: trending 67, futures 14, high_confidence 6, spot 6. Trending mode re-detects the same coins every 30 min and is the dominant shadow generator.
- by confidence band: 90-94: 34 · 85-89: 29 · 95-100: 20 — *high-confidence signals are being shadowed as often as low* (dedup is mode-arrival-order, not quality-ranked: the **first** mode to fire wins, even if a later mode scores it 98).
- 7 unexplained — consistent with rate-cap (June 10 burst) and F2 tail loss; cannot be distinguished today because no suppression telemetry exists (§14).

## 5. Claude Usage Analysis (Phase C)

7d, `ai_call_log` (1,943 rows): **82 Claude calls (4.2%) / 1,861 heuristic fallbacks (95.8%, setup < 78) / 9 errors**.
- Claude verdicts: **5 approved / 77 rejected (6% approval), avg confidence 65** — under the 85 floor, so even approvals rarely deliver. ~20 calls/day (daily limit 50 never reached).
- Errors: 6× `json_parse_failed`, **3× `Semaphore … bound to a different event loop`** — the module-level `asyncio.Semaphore(3)` in `ai_validator.py` survives across Celery tasks but each task creates a fresh loop via `asyncio.run()` → crash → fallback. Same bug class as the asyncpg pool fix already in the codebase.
- Today Claude operates purely as a **kill-gate for borderline candidates** (rejects 94%); its filter value is unmeasured because rejected candidates have no outcomes.

## 6. Redis Usage Analysis (Phase E)

**87 keys total** — keyspace is healthy. Census by prefix: providers:metrics 17 (TTL=-1), cache:intel 12, scan:progress 10, settings 11, monitor counters 13, kombu bindings 5, singletons.
- **Dead keys:** `monitor:scan_durations` (writes removed in OPS.CONSOLIDATION R1; orphan, no TTL), legacy `DUPLICATE_SIGNAL` data, `providers:failover:log` (append-only, no TTL — bounded? review).
- Estimated command volume (cadence math, post-OPS.CONSOLIDATION): scans ~190/day × ~8 ops ≈ 1.5k · settings gen-check 120s × 3 procs ≈ 2.2k · dashboard-driven reads (status cache, monitor, telemetry) ≈ 3–6k · kline batches + telegram counters ≈ 0.5k → **~8–10k/day ≈ 250–300k/month** — inside the 500k free tier but with limited headroom.

## 7. Polling Analysis (Phase F)

- **Trading**: 12 endpoints via `useSharedPolling` @120s (deduped across tabs ✓) + SignalsTab `/api/signals/tactical?limit=100` @120s + TacticalTab `?limit=80` @60s — **the same endpoint fetched by 3 consumers with different params**; unify to one shared poll.
- **System**: 7 pollers @60–120s; anomalies + burn-in at 60s could be 120s.
- **Analytics**: 5 @120–300s ✓ · **Intelligence**: 5 @180–900s ✓.
- No runaway polling found. Best win: unify the tactical fetches (−2 req/min when Trading open) and 60→120s on System anomalies.

## 8. Gate Rejection Analysis (7d: 1,248 scans, 55,096 coin-scans)

| Gate | Count | % of rejections |
|---|---|---|
| MTF (incl. legacy alias) | **26,830** | **79.8%** |
| market_structure (7 filters) | 3,481 | 10.4% |
| CONFIDENCE_REJECTION | 951 | 2.8% |
| SIGNAL_COOLDOWN (4h DB) | 770 | 2.3% |
| KLINE_EMPTY | 748 | 2.2% |
| TREND_STRENGTH / RISK / SETUP / BTC_DOWN / TOXIC / REGIME | < 1% each | |

Volume is low because **the 4h timeframe is ranging (SIDEWAYS)** and MTF correctly refuses confirmation. This is the system protecting expectancy, not a malfunction — SIDEWAYS cohort WR is 17–29%.

## 9. Top 10 Waste Sources
1. Dedup shadows discarding the *higher-confidence* duplicate (quality loss, not just noise) 2. Queue tail loss destroying composed messages (F2) 3. 95.8% of validator invocations doing throwaway heuristic work pre-gates 4. 6 json_parse_failed Claude calls/week (~7% of spend) 5. Trending mode re-alert attempts every 30 min (67 shadows) 6. `monitor:scan_durations` orphan key 7. Triple-fetch of `/api/signals/tactical` 8. providers:metrics TTL-less keys 9. Scan summaries enqueued at loop death (spot mode) — sometimes lost like signals 10. `ai:daily_calls` budget (50) sized 2.5× actual usage.

## 10. Top 10 Reliability Fixes (= TELEGRAM.RELIABILITY.1, §14)
See §14 — ordered there.

## 11. Top 10 Cost Savings
Claude is $1.1/month and Redis is in free tier — **there is no meaningful dollar cost to cut today.** Savings are headroom: (1) settings gen-check 120→300s (~40k cmd/mo) (2) delete dead keys (3) System 60→120s polls (4) unify tactical fetches (5) skip `scan:latest` write when unchanged (6) batch telegram counters (7) drop legacy `mtf` alias double-write (8) TTL on providers metrics (9) suppress per-request HTTP INFO logs in worker (log volume) (10) fix json_parse failures (6 wasted Claude calls/wk).

## 12. Claude Optimization Plan (CLAUDE.OPTIMIZATION.1)
Quality-preserving only: (1) **fix the semaphore event-loop bug** (per-loop semaphore, mirroring the asyncpg pool pattern) (2) **fix json_parse_failed** (stricter prompt/JSON instruction or tool-call structured output) (3) add `symbol` + `setup_score` columns to `ai_call_log` so Claude's kill-gate value becomes measurable against outcomes (4) leave AI_MIN_SETUP_SCORE=78 unchanged (it is the cost control; raising it would change selection) (5) defer any Claude-confidence changes to the Probability Engine era — empirical WR already supersedes stated confidence.

## 13. Redis Optimization Plan (REDIS.OPTIMIZATION.2)
(1) one-time DEL of dead keys (2) gen-check 300s (3) System anomaly/burn-in polls 120s (4) telegram hourly counter: INCR only after all other checks pass (currently correct order) — no change (5) skip unchanged `scan:latest` writes. **Est. savings ≈ 60–100k commands/month; dollar savings $0 (already free tier) — the value is headroom against the next quota incident.**

## 14. Telegram Reliability Plan (TELEGRAM.RELIABILITY.1) — recommended, NOT implemented
P0-1 **Drain before death**: `await queue.join()` (bounded, e.g. ≤15s) at the end of `run_scan()` — eliminates F2 tail loss.
P0-2 **Delivery receipt**: queue items carry `signal_id`; `_send_with_retry` success → best-effort `UPDATE signals SET telegram_delivered=true` (+ additive migration). Dashboard funnel becomes Generated → Eligible → Sent → **Delivered**.
P0-3 **Dedup after delivery**: move the cooldown SETEX to post-send success (or clear it on failure) — fixes F3 poisoning.
P0-4 **Fix the validator semaphore bug** (also CLAUDE.OPTIMIZATION.1 #1).
P1-5 **Suppression telemetry**: counters for dedup / rate-cap / prob-gate suppressions in the monitor snapshot + Trading overview chips ("Sent 6 · Shadowed 9 · Gated 2") — makes the 76 shadows visible instead of looking like loss.
P1-6 **Quality-aware dedup**: on duplicate within cooldown, if new confidence ≥ old + 5, send an UPDATE message instead of dropping (founder decision — changes alert volume).
P1-7 Rate-cap headroom on burst days or per-mode caps (June 10: 109 eligible vs 20/hr cap).
P1-8 Scan summary moved before signal sends or same join fix (P0-1 covers it).

## 15. P0 Fixes (proven bugs)
1. Queue tail loss (F2) — `queue.join()` 2. Dedup poisoning (F3) 3. `telegram_sent`-at-enqueue + no delivered status (F1) 4. Validator semaphore event-loop crash.

## 16. P1 Fixes
Suppression counters + funnel UI · quality-aware dedup policy · `ai_call_log.symbol` traceability · dead Redis keys · tactical fetch unification · System poll cadence.

## 17. Expected Impact
- P0-1..3: every alert-worthy signal either *delivered* or *visibly accounted for*; recovered tail messages on multi-signal scans (June-10-type days: est. +10–20 delivered alerts/day in bursts).
- P1-5: founder sees "9 shadowed" instead of perceiving loss — trust restored without volume change.
- Claude fixes: ~7% of Claude calls recovered; kill-gate value measurable within 30d.
- Redis/polling: headroom only.

## 18. GO / NO-GO
**GO** for TELEGRAM.RELIABILITY.1 P0 set (small, surgical, testable; no behavior loosening). **NO-GO** for any Claude budget increase, dedup removal, or MTF gate loosening — the data shows those gates are doing their job; the problem was reliability + visibility, not strictness.
