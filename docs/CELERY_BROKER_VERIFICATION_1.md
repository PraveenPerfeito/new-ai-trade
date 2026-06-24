# CELERY.BROKER.VERIFICATION.1

**Date:** June 2026  
**Status:** DEPLOYED — Celery now on CloudAMQP with gossip fix applied. Live verification pending.  
**Root cause (resolved):** `CELERY_BROKER_URL` was not set in Railway worker service → fell back to `REDIS_URL`. Now fixed.

---

## Summary

| Finding | Evidence | Impact |
|---------|---------|--------|
| Celery uses Redis as broker | `_kombu.binding.*` keys present in Redis | ~2,880–27,972 BRPOP ops/day |
| 2 worker nodes registered | 2 pidbox binding entries | Each worker polls Redis every 30s |
| Redis connection pool at limit | `connected_clients: 26`, `max number of clients reached` on inspection | Intermittent connection failures under scan load |
| 9 stale pidbox reply entries | `_kombu.binding.reply.celery.pidbox` | Permanent keys with no TTL |
| `scanner` queue also on Redis | `_kombu.binding.scanner` | Secondary queue also bypassing CloudAMQP |

---

## Part A — Environment Variable Audit

### Local `.env` (development)
```
REDIS_URL=rediss://<masked>@grand-badger-131367.upstash.io:6379
# CELERY_BROKER_URL — NOT SET
# CELERY_RESULT_BACKEND — NOT SET
```

### `backend/config.py` broker fallback logic
```python
@property
def broker_url(self) -> str:
    return self.celery_broker_url or self.redis_url  # ← falls back to REDIS_URL if unset

@property
def result_backend(self) -> str:
    return self.celery_result_backend or self.redis_url  # ← same fallback
```

**Root cause:** `CELERY_BROKER_URL` is not set in the Railway worker service environment. The fallback activates and sends all Celery traffic through Redis.

### Railway worker service (inferred from production Redis state)
```
CELERY_BROKER_URL=<NOT SET>         ← broker falls back to REDIS_URL
CELERY_RESULT_BACKEND=<NOT SET>     ← result backend falls back to REDIS_URL
```

---

## Part B — Live Celery Connection Logs

Evidence captured from production Redis Cloud (`smell-aware-macromodern-12096.db.redis.io:15686`):

```
_kombu.binding.celery              type=set  size=1
  member: "celerycelery"
  → Worker is subscribed to the "celery" queue via Redis transport

_kombu.binding.celery.pidbox       type=set  size=2
  member: "celery@532f14f519f8.celery.pidbox"
  member: "celery@d5cd48d2628e.celery.pidbox"
  → 2 Celery worker nodes connected via Redis broker

_kombu.binding.celeryev            type=set  size=2
  member: "worker.#celeryev.8775d067-7f34-4acd-b1af-eabc0957f10a"
  member: "worker.#celeryev.f7eec3ec-0e4d-4a2f-8eb7-06d940af5d5a"
  → 2 event monitor subscriptions via Redis transport

_kombu.binding.scanner             type=set  size=1
  member: "scannerscanner"
  → "scanner" queue (from -Q celery,scanner start flag) also on Redis

_kombu.binding.reply.celery.pidbox type=set  size=9
  → 9 stale entries from previous celery inspect / pidbox sessions
    (permanent, no TTL — accumulate over time)
```

**Broker host:** `smell-aware-macromodern-12096.db.redis.io:15686`  
**Broker transport:** Redis (kombu `redis://` transport)  
**Intended broker:** `armadillo.rmq.cloudamqp.com` (CloudAMQP AMQP transport)

---

## Part C — Redis Impact Measurement

### Before state (measured live)

| Metric | Value | Notes |
|--------|-------|-------|
| `connected_clients` | 26 | At Redis Essentials 30-connection limit |
| `blocked_clients` | 1 | Active BRPOP long-poll (30s timeout) |
| `instantaneous_ops_per_sec` | 3 | At idle; bursts during scan cycles |
| `celery` queue depth | 0 | Queue is empty (no pending tasks) |
| `_kombu.binding.*` key count | 5 | All permanent (no TTL) |
| `_kombu.binding.reply.*` stale entries | 9 | Accumulated from past inspect sessions |

### Redis BRPOP calculation

```
Worker start command: celery worker --beat --concurrency=2 -Q celery,scanner

blocked_clients = 1 (measured)
BRPOP socket_timeout = 30s (set in celery_app.py broker_transport_options)
BRPOP ops/day per blocked client = 86,400s ÷ 30s = 2,880

Estimated BRPOP/day = 1 × 2,880 = 2,880 ops/day (from this session)
REDIS.PRODUCTION.TRUTH.1 measured = 27,972/day (likely measured during higher activity
  or before socket_timeout=30 was set; worst case with 1s timeout = 86,400/day per worker)
```

**Additional finding:** `max number of clients reached` error observed during inspection. The platform is intermittently hitting the 30-connection Redis Essentials limit because broker connections, scanner connections, and background polling all compete for the same pool.

---

## Part D — Fix Configuration

### Code change: none required

`celery_app.py` already handles AMQP correctly:

```python
# Redis-specific transport options only apply when broker is Redis:
if settings.broker_url.startswith(("redis://", "rediss://")):
    conf["broker_transport_options"] = {
        "socket_timeout": 30,
        "socket_keepalive": True,
    }
    conf["broker_pool_limit"] = 1
# ← When CELERY_BROKER_URL=amqps://..., this block is skipped. CloudAMQP gets defaults.

# SSL for Redis backend is checked independently of broker:
if settings.result_backend and settings.result_backend.startswith("rediss://"):
    conf["redis_backend_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_NONE}
# ← With CELERY_RESULT_BACKEND=rpc://, no SSL config applied. Correct.
```

### Required Railway configuration

**✓ DONE (confirmed June 24, 2026)** — User set these variables in Railway worker service:

```
CELERY_BROKER_URL=amqps://nykbebbj:mt6OsDy-iQUPGGKav3mbfHj3I4_2scZH@warthog.lmq.cloudamqp.com/nykbebbj
CELERY_RESULT_BACKEND=rpc://
```

**✓ Start command also updated** — `--without-gossip --without-mingle --concurrency=1` flags added.

Note: The original URL (`armadillo.rmq.cloudamqp.com/kbvaoiaz`) was the first instance — quota exhausted. Migrated to new instance (`warthog.lmq.cloudamqp.com/nykbebbj`).

### Post-restart Redis cleanup

After the worker restarts on CloudAMQP, delete the stale Redis broker keys:

```python
# Run via Railway shell or locally against production Redis
import redis

REDIS_URL = 'redis://default:...@smell-aware-macromodern-12096.db.redis.io:15686'
client = redis.from_url(REDIS_URL, decode_responses=True)

# Delete all kombu broker binding keys
keys_to_delete = client.keys('_kombu.binding.*')
if keys_to_delete:
    client.delete(*keys_to_delete)
    print(f'Deleted {len(keys_to_delete)} _kombu.binding.* keys')
```

Or from Railway Python shell:
```bash
# Railway shell → worker service → Python
python -c "
from backend.cache.redis_cache import get_redis
import asyncio

async def cleanup():
    r = await get_redis()
    keys = await r.keys('_kombu.binding.*')
    if keys:
        await r.delete(*keys)
        print(f'Deleted {len(keys)} kombu keys')
    else:
        print('No kombu keys found — broker already on CloudAMQP')
asyncio.run(cleanup())
"
```

---

## Part E — Expected After State

### Redis ops reduction

| Source | Before | After | Reduction |
|--------|--------|-------|-----------|
| Celery BRPOP (broker poll) | 2,880–27,972/day | **0** | **100%** |
| `_kombu.binding.*` key writes | ~50+/day (reconnects) | **0** | 100% |
| Broker connection overhead | ~2 persistent connections | **0** | ~2 connections freed |

### Connection pool after fix

| Metric | Before | Expected after |
|--------|--------|---------------|
| `connected_clients` | 26 (at limit) | ~20–22 |
| `blocked_clients` | 1 (BRPOP) | **0** |
| `max clients reached` errors | intermittent | eliminated |

### CloudAMQP traffic (REVISED — gossip fix required)

Without gossip fix (original config, `--concurrency=2`):
- Gossip heartbeats: 2 workers × 86,400/day ÷ 2s = **2,592,000 msgs/month** → exceeds 1M limit

After gossip fix (`--without-gossip --concurrency=1`):
- Task delivery only: ~800 tasks/day × 2 msg/task × 30 days = **~24,000 msgs/month**
- **2.4% of free plan limit** — leaves 97.6% headroom

Required changes (CELERY.CLOUDAMQP.GOSSIP.FIX.1):
1. `celery_app.py` — AMQP config block with reconnect backoff + `worker_send_task_events=False`
2. Railway start command — add `--without-gossip --without-mingle --concurrency=1`

### Verification checklist (post-deploy)

- [x] Worker deployed — new start command + new CloudAMQP URL set in Railway (confirmed June 24, 2026)
- [ ] Worker restarts cleanly — verify Railway logs show `celery@<hostname> ready`, no `530 NOT_ALLOWED`
- [ ] `celery inspect ping` (via Railway shell) returns responses
- [ ] Redis `_kombu.binding.*` keys = 0 after cleanup (run the cleanup script in Part D above)
- [ ] Redis `connected_clients` drops from 26 → ~20–22
- [ ] Redis `blocked_clients` = 0
- [ ] Scans continue running normally (check signal generation in Signals dashboard)
- [ ] Worker heartbeat refreshes (Railway → worker logs show `worker_heartbeat` task firing every 600s)

---

## Timeline

| Event | Date | State |
|-------|------|-------|
| CloudAMQP configured in CLAUDE.md | June 2026 | Architecture decision made |
| `CELERY_BROKER_URL` never set in Railway | — | **Gap: code assumed env var; Railway never got it** |
| REDIS.PRODUCTION.TRUTH.1 audit flags 27,972 BRPOP/day | June 2026 | Root cause identified |
| CELERY.BROKER.VERIFICATION.1 confirms Redis-as-broker | June 2026 | `_kombu.binding.*` keys confirmed live |
| Fix: Set `CELERY_BROKER_URL` + gossip flags in Railway worker | **✓ Done June 24, 2026** | New instance `nykbebbj`, `--without-gossip --concurrency=1` |

---

## Notes

**Why `scanner` queue?** The worker start command includes `-Q celery,scanner`. Both queues are registered on Redis, explaining the `_kombu.binding.scanner` key. After switching to CloudAMQP, both queues move to CloudAMQP automatically — no start command change needed.

**Why `task_ignore_result=True` doesn't save you here:** `task_ignore_result=True` prevents result writes to the result backend (so Redis doesn't get hit for results). But the *broker* (where tasks are queued and polled from) is separate. BRPOP is broker traffic, not result traffic. This is why `CELERY_RESULT_BACKEND=rpc://` was documented but `CELERY_BROKER_URL` is the critical one.

**Beat scheduler:** Celery is started with `--beat`, so the beat scheduler runs in the same process as the worker. It will automatically switch to CloudAMQP for task delivery when `CELERY_BROKER_URL` is set — no separate beat service configuration needed.
