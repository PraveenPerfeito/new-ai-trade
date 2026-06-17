"""
Market Data Provider management API.

Endpoints:
  GET  /api/providers                  list all providers with health stats
  GET  /api/providers/failover-history list recent failover events
  POST /api/providers/{name}/enable    enable a provider
  POST /api/providers/{name}/disable   disable a provider
  POST /api/providers/{name}/priority  update provider priority
  POST /api/providers/{name}/reset-metrics  clear Redis metrics for a provider
  POST /api/providers/force-failover   force failover away from a provider
  POST /api/providers/clear-cache      clear the market-data Redis cache key

Provider health is read from Redis (written by the TypeScript ProviderManager).
Control commands write to the `settings:d:providers` Redis key which the
TypeScript ProviderManager reads on every fetchTopCoins() call.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.cache.redis_cache import get_redis
from backend.logging.setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/providers", tags=["providers"])

PROVIDER_NAMES = frozenset({
    "coingecko", "coinmarketcap", "binance", "dexscreener", "coinpaprika", "geckoterm"
})
METRICS_PREFIX      = "providers:metrics:"
FAILOVER_LOG_KEY    = "providers:failover:log"
CONFIG_KEY          = "settings:d:providers"
COINS_CACHE_PAT     = "cache:market-data:*"
HEALTH_SNAPSHOT_KEY = "providers:health:snapshot"
HEALTH_SNAPSHOT_TTL = 30  # seconds — reduces ~37,440 Redis ops/day to ~1,440

_DEFAULT_PRIORITY: dict[str, int] = {
    "coinmarketcap": 1, "coingecko": 2, "binance": 3,
    "dexscreener": 4, "coinpaprika": 5, "geckoterm": 6,
}
_DEFAULT_ENABLED: dict[str, bool] = {
    "coinmarketcap": True, "coingecko": True, "binance": True,
    "dexscreener": True, "coinpaprika": True, "geckoterm": True,
}


def _validate_name(name: str) -> None:
    if name not in PROVIDER_NAMES:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {name}")


async def _read_config() -> dict[str, Any]:
    redis = await get_redis()
    raw = await redis.get(CONFIG_KEY)
    return json.loads(raw) if raw else {}


async def _write_config(cfg: dict[str, Any]) -> None:
    redis = await get_redis()
    await redis.setex(CONFIG_KEY, 7 * 24 * 60 * 60, json.dumps(cfg))


async def _get_metrics(redis, name: str) -> dict[str, Any]:
    prefix = f"{METRICS_PREFIX}{name}"
    pipe = redis.pipeline()
    pipe.hgetall(f"{prefix}:meta")
    pipe.lrange(f"{prefix}:latency", 0, 99)
    pipe.lrange(f"{prefix}:errors", 0, 99)
    pipe.hgetall(f"{prefix}:quota")
    meta, latency_raw, errors_raw, quota_raw = await pipe.execute()

    # Latency p95
    latencies = [float(v) for v in latency_raw if v]
    p95 = sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0.0

    # Error rate over last 5 minutes
    five_min_ago = (time.time() - 300) * 1000
    recent_errors = sum(1 for t in errors_raw if float(t) > five_min_ago)
    requests_today = int(meta.get("requestsToday", 0) or 0)
    error_rate = min(recent_errors / max(requests_today, recent_errors + 1), 1.0) if requests_today > 0 else 0.0

    # Quota
    daily_limit = int(quota_raw.get("dailyLimit", 0) or 0)
    used = int(quota_raw.get("used", 0) or 0)
    remaining = max(daily_limit - used, 0) if daily_limit > 0 else -1
    pct = min((used / daily_limit) * 100, 100.0) if daily_limit > 0 else 0.0

    # Health score
    health_score = 100
    health_score -= min(int(error_rate * 50), 50)
    health_score -= 20 if p95 > 5000 else (10 if p95 > 2000 else 0)
    health_score -= 20 if pct > 90 else (10 if pct > 75 else 0)
    health_score = max(0, round(health_score))

    if daily_limit > 0 and remaining == 0:
        status = "quota_exhausted"
    elif health_score < 40:
        status = "offline"
    elif health_score < 70:
        status = "degraded"
    else:
        status = "healthy"

    return {
        "latencyMs": round(p95),
        "errorRate": round(error_rate, 4),
        "requestsToday": requests_today,
        "healthScore": health_score,
        "status": status,
        "lastSuccess": meta.get("lastSuccess") or None,
        "lastError": meta.get("lastError") or None,
        "quota": {
            "dailyLimit": daily_limit,
            "used": used,
            "remaining": remaining,
            "pct": round(pct, 1),
            "resetAt": meta.get("resetAt") or None,
        },
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

async def _invalidate_snapshot() -> None:
    try:
        redis = await get_redis()
        await redis.delete(HEALTH_SNAPSHOT_KEY)
    except Exception as exc:
        log.debug("invalidate_snapshot_redis_error", error=str(exc))


@router.get("")
async def list_providers() -> dict:
    """All providers with live health metrics and current config."""
    redis = await get_redis()

    # 30s snapshot cache — reduces 37K Redis ops/day to ~1.4K on dashboard polls
    try:
        cached = await redis.get(HEALTH_SNAPSHOT_KEY)
        if cached:
            return json.loads(cached)
    except Exception as exc:
        log.debug("list_providers_cache_read_error", error=str(exc))

    cfg = await _read_config()

    providers = []
    for name in PROVIDER_NAMES:
        prov_cfg = cfg.get(name, {})
        metrics = await _get_metrics(redis, name)
        enabled = prov_cfg.get("enabled", _DEFAULT_ENABLED.get(name, True))
        priority = prov_cfg.get("priority", _DEFAULT_PRIORITY.get(name, 99))

        if not enabled:
            metrics["status"] = "offline"
            metrics["healthScore"] = 0

        # ── CMC: replace MarketDataService quota counter with actual intelligence credits ──
        # providers:metrics:coinmarketcap:quota tracks fetchTopCoins() calls (reads from cache).
        # The real CMC API credit usage lives in intel:quota:used (written by intelligence workers).
        # dailyLimit was never set → pct always 0 → misleading "0% used" display.
        if name == "coinmarketcap":
            intel_used  = int((await redis.get("intel:quota:used")) or 0)
            intel_reset = await redis.get("intel:quota:reset_at")
            monthly_budget = 300_000
            metrics["quota"] = {
                "dailyLimit": monthly_budget,
                "used":       intel_used,
                "remaining":  max(0, monthly_budget - intel_used),
                "pct":        round(min(intel_used / monthly_budget * 100, 100.0), 1),
                "resetAt":    intel_reset or None,
            }

        # ── Binance: never-used-for-top-coins today = healthy ───────────────────────────
        # BinanceProvider.fetchTopCoins() is a 3rd-fallback that rarely runs and may fail
        # (geo-block 451, large payload). Scanner uses Binance for klines via Python backend
        # — that path is never reflected in providers:metrics:binance. If requestsToday == 0
        # the stored errors are stale; report healthy so the card reflects klines reality.
        if name == "binance" and enabled and metrics["requestsToday"] == 0:
            metrics["healthScore"] = 100
            metrics["status"] = "healthy"

        providers.append({"name": name, "enabled": enabled, "priority": priority, **metrics})

    providers.sort(key=lambda p: p["priority"])
    result = {"success": True, "providers": providers}
    try:
        await redis.setex(HEALTH_SNAPSHOT_KEY, HEALTH_SNAPSHOT_TTL, json.dumps(result))
    except Exception as exc:
        log.debug("list_providers_cache_write_error", error=str(exc))
    return result


@router.get("/failover-history")
async def failover_history(limit: int = 20) -> dict:
    redis = await get_redis()
    raw = await redis.lrange(FAILOVER_LOG_KEY, 0, min(limit, 100) - 1)
    events = []
    for r in raw:
        try:
            events.append(json.loads(r))
        except Exception as exc:
            log.warning("failover_history_json_parse_error", error=str(exc))
    return {"success": True, "events": events}


@router.get("/config")
async def get_config() -> dict:
    cfg = await _read_config()
    return {"success": True, "config": cfg}


class PriorityBody(BaseModel):
    priority: int


@router.post("/{name}/enable")
async def enable_provider(name: str) -> dict:
    _validate_name(name)
    cfg = await _read_config()
    cfg.setdefault(name, {})["enabled"] = True
    await _write_config(cfg)
    await _invalidate_snapshot()
    log.info("provider_enabled", provider=name)
    return {"success": True, "provider": name, "enabled": True}


@router.post("/{name}/disable")
async def disable_provider(name: str) -> dict:
    _validate_name(name)
    cfg = await _read_config()
    cfg.setdefault(name, {})["enabled"] = False
    await _write_config(cfg)
    await _invalidate_snapshot()
    log.info("provider_disabled", provider=name)
    return {"success": True, "provider": name, "enabled": False}


@router.post("/{name}/priority")
async def set_priority(name: str, body: PriorityBody) -> dict:
    _validate_name(name)
    if not (1 <= body.priority <= 6):
        raise HTTPException(status_code=422, detail="priority must be 1-6")
    cfg = await _read_config()
    cfg.setdefault(name, {})["priority"] = body.priority
    await _write_config(cfg)
    await _invalidate_snapshot()
    log.info("provider_priority_set", provider=name, priority=body.priority)
    return {"success": True, "provider": name, "priority": body.priority}


@router.post("/{name}/reset-metrics")
async def reset_metrics(name: str) -> dict:
    _validate_name(name)
    redis = await get_redis()
    prefix = f"{METRICS_PREFIX}{name}"
    keys = [f"{prefix}:latency", f"{prefix}:errors", f"{prefix}:meta", f"{prefix}:quota"]
    if keys:
        await redis.delete(*keys)
    log.info("provider_metrics_reset", provider=name)
    return {"success": True, "provider": name}


class ForceFailoverBody(BaseModel):
    from_provider: str


@router.post("/force-failover")
async def force_failover(body: ForceFailoverBody) -> dict:
    _validate_name(body.from_provider)
    cfg = await _read_config()
    cfg.setdefault(body.from_provider, {})["enabled"] = False
    await _write_config(cfg)

    redis = await get_redis()
    event = {
        "id": str(uuid.uuid4())[:8],
        "fromProvider": body.from_provider,
        "toProvider": "auto",
        "reason": "manual_force_failover",
        "occurredAt": datetime.now(timezone.utc).isoformat(),
        "durationMs": None,
        "resolved": False,
    }
    await redis.lpush(FAILOVER_LOG_KEY, json.dumps(event))
    await redis.ltrim(FAILOVER_LOG_KEY, 0, 49)

    log.warning("provider_force_failover", from_provider=body.from_provider)
    return {"success": True, "disabled": body.from_provider, "event": event}


@router.post("/clear-cache")
async def clear_cache() -> dict:
    redis = await get_redis()
    keys = [k async for k in redis.scan_iter(match=COINS_CACHE_PAT, count=100)]
    if keys:
        await redis.delete(*keys)
    log.info("provider_cache_cleared", keys_deleted=len(keys))
    return {"success": True, "keysDeleted": len(keys)}
