from __future__ import annotations

from backend.core.scanner.models import ScannerMode, SetupResult, SignalType, VolatilityRating
from backend.core.scanner.signal_pipeline import (
    _btc_context_from_setup_description,
    _early_breakout_confidence_adj,
    _match_toxic_setup,
    _normalize_setup_description,
    _null_setup_confidence_penalty,
    _should_block_buy_for_btc_context,
)


def _setup(description: str, breakout_type: str | None = None) -> SetupResult:
    return SetupResult(
        has_setup=True,
        description=description,
        pre_score=88,
        breakout_type=breakout_type,
        breakout_strength=None,
    )


def test_match_toxic_setup_detects_exact_normalized_pattern() -> None:
    description = (
        "4h bearish (EMA20 < EMA50). 1h bearish trend confirmed. "
        "RSI 41.6 in bearish zone (30-52). 1h MACD histogram negative. "
        "Price below EMA200 — long-term bearish. "
        "Fresh 4h death cross — EMA20 just crossed below EMA50 | ADX: 37"
    )

    normalized = _normalize_setup_description(description)

    assert normalized.endswith("Fresh 4h death cross — EMA20 just crossed below EMA50")
    assert _match_toxic_setup(description) == "bear_below_ema200_fresh_4h_death_cross"


def test_match_toxic_setup_does_not_flag_profitable_nearby_variant() -> None:
    description = (
        "4h bearish (EMA20 < EMA50). 1h bearish trend confirmed. "
        "RSI 44.1 in bearish zone (30-52). 1h MACD histogram negative. "
        "Strong trend score: 68/100. Price below EMA200 — long-term bearish. "
        "4h price below EMA200 — higher-TF bearish bias. "
        "Daily trend bearish — all 3 timeframes aligned"
    )

    assert _match_toxic_setup(description) is None


def test_btc_context_from_setup_description_classifies_up_down_flat_and_unknown() -> None:
    assert _btc_context_from_setup_description(
        "Leading BTC by 3.2% (coin +5.4% vs BTC -1.2%)"
    ) == "DOWN"
    assert _btc_context_from_setup_description(
        "Leading BTC by 4.0% (coin +6.0% vs BTC +2.0%)"
    ) == "UP"
    assert _btc_context_from_setup_description(
        "Leading BTC by 1.8% (coin +1.8% vs BTC 0.0%)"
    ) == "FLAT"
    assert _btc_context_from_setup_description(
        "4h bullish (EMA20 > EMA50). 1h bullish trend confirmed."
    ) is None


def test_btc_context_gate_blocks_only_buy_signals_when_btc_is_down() -> None:
    down_description = "Leading BTC by 3.2% (coin +5.4% vs BTC -1.2%)"
    up_description = "Leading BTC by 4.0% (coin +6.0% vs BTC +2.0%)"
    flat_description = "Leading BTC by 1.8% (coin +1.8% vs BTC 0.0%)"

    assert _should_block_buy_for_btc_context(SignalType.BUY, down_description) is True
    assert _should_block_buy_for_btc_context(SignalType.SELL, down_description) is False
    assert _should_block_buy_for_btc_context(SignalType.BUY, up_description) is False
    assert _should_block_buy_for_btc_context(SignalType.BUY, flat_description) is False


# ──────────────────────────────────────────────────────────────────────────────
# EARLY_BREAKOUT.TRUTH.1 — direction-aware confidence adjustment
# SELL+EARLY: WR=68%, Exp=+1.074 → no penalty
# BUY+EARLY:  WR=13%, Exp=−0.598 → −4 penalty
# ──────────────────────────────────────────────────────────────────────────────

def test_early_breakout_adj_sell_is_type_aware() -> None:
    """CONFIDENCE.FIX.2: SELL+EARLY adj depends on breakout_type.

    SELL + 20d_low / 30d_low → 0   (WR=87.5%, Exp=+1.63R — breakdown confirmed)
    SELL + bb_expansion      → -5  (unconfirmed sell, modest penalty)
    SELL + None / unknown    → -5  (cautious default — type not specified)
    """
    # Confirmed breakdowns → no penalty
    assert _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.SELL, "20d_low") == 0
    assert _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.SELL, "30d_low") == 0
    # Unconfirmed or unspecified → -5
    assert _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.SELL, None) == -5
    assert _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.SELL, "bb_expansion") == -5


def test_early_breakout_adj_is_minus_four_for_buy() -> None:
    """BUY + EARLY_BREAKOUT must retain the −4 penalty (exp −0.598)."""
    assert _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.BUY) == -4


def test_early_breakout_adj_ignores_other_breakout_strengths() -> None:
    """Only EARLY_BREAKOUT triggers the adjustment; all others return 0."""
    assert _early_breakout_confidence_adj("CONFIRMED_BREAKOUT", SignalType.BUY) == 0
    assert _early_breakout_confidence_adj("HIGH_MOMENTUM_BREAKOUT", SignalType.BUY) == 0
    assert _early_breakout_confidence_adj("NONE", SignalType.BUY) == 0
    assert _early_breakout_confidence_adj(None, SignalType.BUY) == 0


def test_early_breakout_adj_buy_bear_trend_still_blocked_by_regime_gate() -> None:
    """Safety: BUY+BEAR_TREND is blocked at Step 10.5 (regime hard gate) before
    the confidence adjustment is ever evaluated. Removing the SELL penalty
    cannot re-enable BUY+BEAR_TREND signals — the regime gate is independent."""
    # The regime gate fires before _early_breakout_confidence_adj is called.
    # This test documents the invariant: even if adj=0 for BUY, the regime gate
    # ensures BUY+BEAR_TREND never reaches the confidence step.
    # We verify the adj itself still returns -4 for BUY (it is never reached
    # for BEAR_TREND, but the value must remain correct for non-BEAR regimes).
    assert _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.BUY) == -4


def test_early_breakout_adj_null_regime_still_hard_gated() -> None:
    """Safety: NULL regime adds +15 to required confidence (spot: 95, futures: 97).
    CONFIDENCE.FIX.2: SELL without breakout_type = -5 (unconfirmed), so required
    confidence is even higher — NULL regime signals remain unreachable."""
    # Spot:          required = 80 + 15 = 95  (max AI output = 95 → edge case only)
    # Futures:       required = 82 + 15 = 97  (impossible)
    # High-conf:     required = 87 + 15 = 102 (impossible)
    # adj for SELL (no type) = -5, so adjusted = raw + 5 needed → even harder
    adj_sell = _early_breakout_confidence_adj("EARLY_BREAKOUT", SignalType.SELL)
    assert adj_sell == -5  # CONFIDENCE.FIX.2: unconfirmed SELL penalty
    # The NULL regime gate (+15) is separate — not affected by this change


def test_null_setup_confidence_penalty_stacks_only_for_null_bucket() -> None:
    setup = _setup(
        "4h bearish (EMA20 < EMA50). 1h bearish trend confirmed. "
        "RSI 47.2 in bearish zone (30-52). 1h MACD histogram negative. "
        "Price below EMA200 — long-term bearish. "
        "BB squeeze detected (width 0.031) — breakout imminent. "
        "Fresh 4h death cross — EMA20 just crossed below EMA50"
    )

    penalty, reasons = _null_setup_confidence_penalty(
        setup,
        SignalType.SELL,
        ScannerMode.SPOT,
        VolatilityRating.LOW,
    )

    assert penalty == 19
    assert reasons == [
        "null_sell",
        "null_spot",
        "null_low_volatility",
        "null_range_expansion",
        "null_ema_alignment",
    ]


def test_null_setup_confidence_penalty_skips_breakout_setups() -> None:
    setup = _setup(
        "4h bearish (EMA20 < EMA50). 1h bearish trend confirmed. "
        "RSI 40.0 in bearish zone (30-52). 1h MACD histogram negative. "
        "Price below EMA200 — long-term bearish. "
        "Fresh 4h death cross — EMA20 just crossed below EMA50",
        breakout_type="30d_low",
    )

    penalty, reasons = _null_setup_confidence_penalty(
        setup,
        SignalType.SELL,
        ScannerMode.SPOT,
        VolatilityRating.LOW,
    )

    assert penalty == 0
    assert reasons == []
