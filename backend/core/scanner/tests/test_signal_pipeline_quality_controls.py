from __future__ import annotations

from backend.core.scanner.models import ScannerMode, SetupResult, SignalType, VolatilityRating
from backend.core.scanner.signal_pipeline import (
    _btc_context_from_setup_description,
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
