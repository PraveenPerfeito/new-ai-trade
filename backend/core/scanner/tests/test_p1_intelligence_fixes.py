"""
P1 intelligence fixes — unit tests.

1. FUNDING.TREND.FIX.1   — classifier no longer degenerate (emits RISING/FALLING)
2. INTEL.PROPAGATE.1     — sector/trend maps built for any mode (pure core)
3. high_confidence retirement flag — default ON (no behavior change on deploy)
4. PHASE.9.1 probability gate — lookup hierarchy + suppress decision + flag defaults
"""
from __future__ import annotations

from backend.core.scanner.futures_intelligence import _classify_funding_trend
from backend.core.scanner.models import CoinData, FundingTrend
from backend.system_settings.groups import FeatureFlags, ScannerSettings


# ── 1. Funding trend classifier ───────────────────────────────────────────────

class TestFundingTrendFix:
    def test_typical_drift_now_classifies_rising(self):
        # 0.0001 → 0.00015 (+50% over the window) was STABLE under the old
        # 0.0002 absolute threshold — the degenerate case from the audit.
        assert _classify_funding_trend([0.0001, 0.00012, 0.00015]) == FundingTrend.RISING

    def test_typical_drift_now_classifies_falling(self):
        assert _classify_funding_trend([0.0001, 0.00007, 0.00005]) == FundingTrend.FALLING

    def test_flat_history_stays_stable(self):
        assert _classify_funding_trend([0.0001, 0.0001, 0.0001]) == FundingTrend.STABLE

    def test_small_noise_stays_stable(self):
        # +10% move is below the 25% relative threshold
        assert _classify_funding_trend([0.0001, 0.000105, 0.00011]) == FundingTrend.STABLE

    def test_relative_guard_at_extreme_levels(self):
        # At an extreme 0.002 base, a 0.0003 move (15%) is noise — needs >25%
        assert _classify_funding_trend([0.002, 0.0022, 0.0023]) == FundingTrend.STABLE
        assert _classify_funding_trend([0.002, 0.0025, 0.0027]) == FundingTrend.RISING

    def test_near_zero_base_uses_absolute_floor(self):
        assert _classify_funding_trend([0.0, 0.00002]) == FundingTrend.STABLE   # below 3e-5
        assert _classify_funding_trend([0.0, 0.00005]) == FundingTrend.RISING   # above 3e-5

    def test_single_reading_stable(self):
        assert _classify_funding_trend([0.0001]) == FundingTrend.STABLE


# ── 2. Intelligence maps for all modes ────────────────────────────────────────

def _coin(symbol: str, change_24h: float = 5.0, volume: float = 5e8, mcap: float = 5e9) -> CoinData:
    return CoinData(
        id=symbol.lower(), symbol=symbol, name=symbol, rank=10, price=1.0,
        market_cap=mcap, volume_24h=volume, price_change_24h=change_24h,
        binance_symbol=f"{symbol}USDT", has_futures=True, image="",
    )


class _FakeStatus:
    def __init__(self, value: str):
        self.value = value


class _FakeAnalysis:
    def __init__(self, status: str):
        self.status = _FakeStatus(status)


class _FakeSectorReport:
    def __init__(self, mapping: dict):
        self._m = {k: _FakeAnalysis(v) for k, v in mapping.items()}

    def get(self, name):
        return self._m.get(name)


class TestIntelligenceMapsCore:
    def test_maps_built_for_plain_coins(self):
        from backend.core.scanner.trending_universe import _intelligence_maps_core
        coins = [_coin("SOL"), _coin("LINK")]
        trend_map, sector_map = _intelligence_maps_core(
            coins,
            trending_raw=[{"symbol": "SOL", "priceChange1h": 1.2}],
            category_symbol_map={"SOL": "Layer 1", "LINK": "Oracles"},
            category_avg_change_map={"SOL": 4.0, "LINK": 1.0},
            sector_report=_FakeSectorReport({"Layer 1": "ACCELERATING", "Oracles": "NEUTRAL"}),
            btc_change_24h=1.0,
        )
        assert sector_map == {"SOL": "ACCELERATING", "LINK": "NEUTRAL"}
        assert set(trend_map) == {"SOL", "LINK"}
        assert all(0 <= v <= 100 for v in trend_map.values())
        # SOL: trending rank + 1h momentum + stronger sector → higher score
        assert trend_map["SOL"] > trend_map["LINK"]

    def test_unknown_sector_omitted_from_sector_map(self):
        from backend.core.scanner.trending_universe import _intelligence_maps_core
        trend_map, sector_map = _intelligence_maps_core(
            [_coin("XYZ")], [], {}, {}, _FakeSectorReport({}), btc_change_24h=0.0,
        )
        assert "XYZ" not in sector_map
        assert "XYZ" in trend_map   # trend score still computes from coin metadata


# ── 3. high_confidence retirement flag ────────────────────────────────────────

class TestHighConfidenceFlag:
    def test_defaults_on_no_behavior_change(self):
        assert FeatureFlags().high_confidence_mode_enabled is True


# ── 4. Probability gate ───────────────────────────────────────────────────────

class TestProbabilityGate:
    def test_flag_defaults_off(self):
        assert FeatureFlags().probability_gate_enabled is False

    def test_threshold_default(self):
        assert ScannerSettings().min_empirical_wr == 45.0

    def test_lookup_hierarchy_most_specific_first(self):
        from backend.analytics.probability import lookup_empirical
        lookup = {
            ("regime|type|breakout", "BEAR_TREND|SELL|CONFIRMED_BREAKOUT"): {"wr": 56.5, "n": 568},
            ("regime|type",          "BEAR_TREND|SELL"):                    {"wr": 59.6, "n": 792},
            ("regime",               "BEAR_TREND"):                          {"wr": 51.4, "n": 992},
        }
        wr, n = lookup_empirical(lookup, "BEAR_TREND", "SELL", "CONFIRMED_BREAKOUT")
        assert (wr, n) == (56.5, 568)
        # Unknown breakout cohort → falls back to regime|type
        wr, n = lookup_empirical(lookup, "BEAR_TREND", "SELL", "HIGH_MOMENTUM_BREAKOUT")
        assert (wr, n) == (59.6, 792)
        # Unknown type → regime level
        wr, n = lookup_empirical(lookup, "BEAR_TREND", "BUY", None)
        assert (wr, n) == (51.4, 992)
        # Nothing known → no data
        wr, n = lookup_empirical(lookup, "BULL_TREND", "BUY", None)
        assert (wr, n) == (None, 0)

    def test_null_labels_match_snapshot_encoding(self):
        from backend.analytics.probability import lookup_empirical
        lookup = {("regime|type|breakout", "BEAR_TREND|SELL|NULL"): {"wr": 63.8, "n": 141}}
        wr, n = lookup_empirical(lookup, "BEAR_TREND", "SELL", None)
        assert (wr, n) == (63.8, 141)

    def test_suppress_decision(self):
        from backend.analytics.probability import should_suppress_send
        assert should_suppress_send(True, 30.0, 45.0) is True     # known-bad cohort
        assert should_suppress_send(True, 60.0, 45.0) is False    # known-good cohort
        assert should_suppress_send(True, None, 45.0) is False    # unknown NEVER gated
        assert should_suppress_send(False, 30.0, 45.0) is False   # flag off = legacy
        assert should_suppress_send(True, 45.0, 45.0) is False    # boundary: < is strict
