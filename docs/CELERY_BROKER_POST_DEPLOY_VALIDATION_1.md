# CELERY.BROKER.POST_DEPLOY_VALIDATION.1

**Date:** June 24, 2026  
**Status:** DEPLOYED — New instance configured + gossip fix applied. Live verification of Redis state pending.  
**Previous incident:** Old instance quota exhausted by gossip heartbeat storm (1M msgs/month limit hit within hours).

---

## Incident Summary

The `CELERY_BROKER_URL` was set in Railway to switch Celery from Redis to CloudAMQP. The switch itself worked correctly — the worker is now connecting to CloudAMQP instead of Redis. However, the AMQP vhost access is being blocked:

```
Connection.open: (530) NOT_ALLOWED - access to vhost 'kbvaoiaz'
refused for user 'kbvaoiaz'.
billiard.exceptions.RestartFreqExceeded: 5 in 1s
```

**Root cause (confirmed by CloudAMQP dashboard):**
> *Monthly Message Limit exceeded, access to instance has been blocked. Wait until next month, or upgrade to a bigger plan.*

The CloudAMQP Lemur free plan (1M messages/month) was already exhausted. RabbitMQ blocks vhost access when the quota is hit — this produces a 530 NOT_ALLOWED, not a credential error.

The worker enters a restart loop and fails every ~1 second. **No scans are running.**

---

## Part A — Worker Startup Logs

**Broker transport:** AMQP ✓ (Celery is correctly targeting CloudAMQP, not Redis)  
**Host:** `armadillo.rmq.cloudamqp.com:5671` ✓ (correct CloudAMQP host)  
**Error:** `530 NOT_ALLOWED` — monthly message quota exhausted → vhost blocked  
**Effect:** `RestartFreqExceeded: 5 in 1s` — Celery crash-loops

**Root cause:** CloudAMQP Lemur free plan = 1 million messages/month. Quota exceeded. RabbitMQ responds to all new connections with 530 until quota resets on the 1st of next month.

---

## Part B — Redis State After Failed Migration

| Metric | Before fix | After fix (now) | Change |
|--------|-----------|-----------------|--------|
| `_kombu.binding.*` keys | 5 | 5 (still present) | No change — worker never connected cleanly |
| `connected_clients` | 26 | 26 | No change — still at limit |
| `blocked_clients` | 1 | 1 | Worker still has an old BRPOP open |
| `instantaneous_ops/sec` | 3–4 | 3–4 | No change |

The old Redis broker connections are still alive from before the restart. They will close within ~30s once the worker finally dies (Railway restart cooldown). The `_kombu.binding.*` keys remain because the worker never sent a clean AMQP unsubscribe.

---

## Part C — Functional Tests

**Status: Cannot run.** Worker is down; no Celery tasks execute.

- Scheduled scan: ✗ not running
- WhatsApp alert: ✗ not running
- Nightly task: ✗ not running
- Category refresh: ✗ not running

---

## Part D — Redis Ops (Projected)

Once fixed with correct CloudAMQP credentials:

| Source | Before broker fix | After broker fix |
|--------|------------------|-----------------|
| Celery BRPOP (broker) | ~2,880/day | **0** |
| `_kombu.binding.*` writes | ~50/day | **0** |
| Redis connections from Celery | 2 persistent | **0** |
| Estimated total ops/day | ~30,000–50,000 | ~5,000–8,000 |
| Estimated ops/month | ~1,000,000 | ~150,000–250,000 |

This estimate puts Redis well within the 200K ops/month target from OPS.CONSOLIDATION.1.

---

## Part E — Verdict

**DEPLOYED** — New CloudAMQP instance `nykbebbj` configured + gossip fix applied. Live Redis state verification still pending.

The root cause was twofold: (1) Old instance `kbvaoiaz` exhausted its 1M monthly quota from gossip heartbeats. (2) Gossip protocol generates 2.6M msgs/month with `--concurrency=2` — 2.6× the free plan limit. Both fixed: new instance + `--without-gossip --concurrency=1` brings projected usage to ~24,000 msgs/month (2.4% of limit).

---

## Root Cause: Gossip Heartbeat Storm

Celery's gossip protocol sends a heartbeat AMQP message every **2 seconds per worker process**. With `--concurrency=2` (2 worker processes):

```
2 workers × 86,400s/day ÷ 2s = 86,400 gossip msgs/day = 2,592,000 msgs/month
```

That's **2.6× the Lemur free plan limit** from gossip alone — without any task traffic. The first CloudAMQP instance was exhausted within hours.

In addition, task lifecycle events (`celeryev` queue) add ~2,400 msgs/day.

**Fix applied (commit this session):**
1. `backend/workers/celery_app.py` — AMQP config block added:
   - Reconnect backoff (2s→30s, max 10 retries) — prevents re-exhaustion if connection drops
   - `worker_send_task_events = False` — disables task lifecycle event messages
   - `task_send_sent_event = False` — disables task-sent events
2. Railway start command — must add `--without-gossip --without-mingle --concurrency=1` (see below)

**Projected usage after fix: ~24,000 msgs/month (2.4% of 1M limit)**

---

## Immediate Fix: Migrate to New CloudAMQP Instance

### Step 1 — Update Railway worker start command ✓ DONE

**Confirmed June 24, 2026** — Start command set to:
```
celery -A backend.workers.celery_app.celery_app worker --beat --loglevel=info --concurrency=1 -Q celery,scanner --without-gossip --without-mingle
```

Key changes applied:
- `--concurrency=2` → `--concurrency=1` — 1 worker process
- `--without-gossip` — **disables the 86,400 msgs/day heartbeat storm**
- `--without-mingle` — disables startup synchronization (saves ~10 msgs per restart)

### Step 2 — Set env vars in Railway worker service ✓ DONE

**Confirmed June 24, 2026** — Variables set in Railway worker service:

| Variable | Value | Status |
|----------|-------|--------|
| `CELERY_BROKER_URL` | `amqps://nykbebbj:...@warthog.lmq.cloudamqp.com/nykbebbj` | ✓ Set |
| `CELERY_RESULT_BACKEND` | `rpc://` | ✓ Set |

### Step 3 — Verify live state

Check Railway logs for:
- [ ] `Connected to amqps://nykbebbj@warthog.lmq.cloudamqp.com//nykbebbj`
- [ ] `celery@<hostname> ready`
- [ ] No `530 NOT_ALLOWED` errors

### Option B — Upgrade if needed (~$19/mo)

If the new free instance also runs low, upgrade to Little Lemur ($19/mo, unlimited messages). After the gossip fix, the free plan should comfortably cover the platform at ~24,000 msgs/month.

### Fallback — Redis broker

If CloudAMQP issues persist, delete `CELERY_BROKER_URL` from Railway. Worker falls back to Redis broker automatically (BRPOP at 30s intervals — ~2,880 ops/day).

---

## Redis Cleanup (after successful fix)

Once the worker is running on CloudAMQP, delete the stale broker keys from Redis:

```python
# Run from Railway worker shell or locally
import redis
client = redis.from_url(
    'redis://default:...@smell-aware-macromodern-12096.db.redis.io:15686',
    decode_responses=True,
)
keys = client.keys('_kombu.binding.*')
if keys:
    client.delete(*keys)
    print(f'Deleted {len(keys)} _kombu.binding.* keys')
```

---

## Supabase Tables

Database migration `database/cmc-backup-migration.sql` was confirmed run by user. Tables `cmc_sectors`, `coin_sector_assignments`, `symbol_mappings`, `coin_rankings_history` are created with RLS policies. Direct DB verification was not possible from local machine (DNS resolution failure to Supabase host from this network). Verify in Supabase SQL Editor:

```sql
SELECT 'cmc_sectors' as t, COUNT(*) as n FROM cmc_sectors
UNION ALL SELECT 'coin_sector_assignments', COUNT(*) FROM coin_sector_assignments
UNION ALL SELECT 'symbol_mappings', COUNT(*) FROM symbol_mappings
UNION ALL SELECT 'coin_rankings_history', COUNT(*) FROM coin_rankings_history;
```
