from __future__ import annotations

import pytest

from backend.core.scanner import intelligence_cache
from backend.core.scanner.intelligence_cache import IntelligenceCacheResult


@pytest.mark.asyncio
async def test_cmc_intelligence_disabled_uses_coingecko_fallback(monkeypatch):
    calls = {}

    async def fake_fallback(limit: int, reason: str = "cache_cold"):
        calls["limit"] = limit
        calls["reason"] = reason
        return IntelligenceCacheResult(
            coins=[],
            cache_source="coingecko_fallback",
            cache_hit=False,
            cache_age_seconds=0.0,
            is_fresh=True,
        )

    monkeypatch.setattr(intelligence_cache, "CMC_INTELLIGENCE_ENABLED", False)
    monkeypatch.setattr(intelligence_cache, "_fallback_coingecko", fake_fallback)

    result = await intelligence_cache.read_intelligence_listings(limit=25)

    assert result.cache_source == "coingecko_fallback"
    assert calls == {"limit": 25, "reason": "cmc_disabled_unmeasurable"}
