"""
Institutional Breakout Intelligence Engine — Phase 7.4A.1.

Detects breakout setups that the existing scanner missed:
  - SPOT mode had no dedicated breakout engine (audit score: 4.5/10)
  - 20/30-day high breakouts were invisible
  - BB expansion (the actual breakout candle) was unscored
  - High-velocity breakouts were disqualified by the 5% range ceiling

This module is deliberately self-contained — it receives raw candle lists and
returns a BreakoutResult. It does not modify any gate and does not generate
signals. The result is consumed by detect_setup() as a setup score bonus.

═══════════════════════════════════════════════════════════════
BREAKOUT STRENGTH LEVELS
═══════════════════════════════════════════════════════════════

  NONE                 No breakout detected.

  EARLY_BREAKOUT (+5)
    Condition: price broke 20-day high/low OR BB squeeze just ended
    but volume is not yet confirming (< 1.5× average).
    Interpretation: momentum is building; caution warranted.

  CONFIRMED_BREAKOUT (+8)
    Condition: price broke 20-day high/low WITH volume ≥ 1.5×
    OR price broke 30-day high/low (structure-level break).
    Interpretation: institutional money participating.

  HIGH_MOMENTUM_BREAKOUT (+12)
    Condition: 30-day high/low break AND volume ≥ 1.5× AND BB expansion
    (squeeze released into the breakout candle).
    Interpretation: compression → explosive release; highest-quality entry.

═══════════════════════════════════════════════════════════════
DETECTION LOGIC
═══════════════════════════════════════════════════════════════

  Step 1 — Daily structure breakout (uses 1d candles):
    BUY:  close > max(close[-21:-1])  → 20-day high
    BUY:  close > max(close[-31:-1])  → 30-day high
    SELL: close < min(close[-21:-1])  → 20-day low
    SELL: close < min(close[-31:-1])  → 30-day low
    Volume confirmed: latest 1d volume > avg(volume[-21:-1]) × 1.5

  Step 2 — BB expansion (uses 1h candles, 40-candle window):
    Compute rolling 20-period BB widths over last 40 candles.
    bb_expanding = current_width > 20-period avg_width × 1.3
    had_recent_squeeze = any(width < avg_width × 0.7) in prior 5-9 candles
    (excludes current candle — squeeze must have been followed by expansion)

  Step 3 — Classify:
    HIGH_MOMENTUM: (above_30d or above_20d) AND vol_confirmed AND bb_expanding
    CONFIRMED:     (above_20d AND vol_confirmed) OR above_30d
    EARLY:         above_20d (no volume) OR (bb_expanding AND had_squeeze)
    NONE:          nothing detected

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

  NEAR breaks its 30-day high at $6.20 with 2.8× volume, 1h BB just expanded
  after a 3-day squeeze:
    above_30d=True, vol_ratio=2.8 (≥1.5 ✓), bb_expanding=True
    → HIGH_MOMENTUM_BREAKOUT +12 pts

  SOL breaks 20-day high with 1.6× volume, no BB squeeze context:
    above_20d=True, vol_ratio=1.6 (≥1.5 ✓), bb_expanding=False
    → CONFIRMED_BREAKOUT +8 pts

  FIL breaks 20-day high at low volume (1.2×), squeeze just released:
    above_20d=True, vol_ratio=1.2 (<1.5 ✗), bb_expanding=True, had_squeeze=True
    → EARLY_BREAKOUT +5 pts (volume lagging — watch for confirmation)

  DOGE makes new 30-day low with 1.7× volume on SELL signal:
    below_30d=True, vol_ratio=1.7 (≥1.5 ✓)
    → CONFIRMED_BREAKOUT +8 pts (bearish structure break confirmed)

  ETH in sideways 4h range, no structure break:
    above_20d=False, above_30d=False, bb_expanding=False
    → NONE +0 pts
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from statistics import mean

from backend.core.scanner.models import Candle, SignalType

# ── Score bonuses ─────────────────────────────────────────────────────────────

SCORE_EARLY     = 5
SCORE_CONFIRMED = 8
SCORE_HIGH_MOM  = 12

# ── Detection thresholds ──────────────────────────────────────────────────────

VOLUME_CONFIRM_RATIO   = 1.5    # vol ≥ 1.5× 20-day average = confirmed
BB_EXPANSION_RATIO     = 1.3    # current_width > avg × 1.3 = expanding
BB_SQUEEZE_RATIO       = 0.7    # width < avg × 0.7 = squeeze (Phase 7.3A.1 threshold)
BB_WINDOW              = 20     # rolling window for width average
BB_EXPANSION_LOOKBACK  = 40     # candles needed for expansion detection
BB_SQUEEZE_LOOKBACK    = 9      # candles before current to check for prior squeeze
BREAKOUT_DAY_SHORT     = 20     # 20-day high/low
BREAKOUT_DAY_LONG      = 30     # 30-day high/low


class BreakoutStrength(str, Enum):
    NONE                  = "NONE"
    EARLY_BREAKOUT        = "EARLY_BREAKOUT"
    CONFIRMED_BREAKOUT    = "CONFIRMED_BREAKOUT"
    HIGH_MOMENTUM_BREAKOUT = "HIGH_MOMENTUM_BREAKOUT"


@dataclass
class BreakoutResult:
    strength:     BreakoutStrength
    score_bonus:  int     # 0, +5, +8, or +12
    breakout_type: str    # "20d_high" | "30d_high" | "bb_expansion" | etc.
    volume_ratio: float   # latest volume / 20-period average
    details:      str     # human-readable description for signal reason

    @property
    def detected(self) -> bool:
        return self.strength != BreakoutStrength.NONE

    def as_dict(self) -> dict:
        return {
            "strength":      self.strength.value,
            "score_bonus":   self.score_bonus,
            "breakout_type": self.breakout_type,
            "volume_ratio":  round(self.volume_ratio, 2),
        }


_NONE = BreakoutResult(
    strength=BreakoutStrength.NONE,
    score_bonus=0,
    breakout_type="none",
    volume_ratio=1.0,
    details="",
)


# ── BB expansion helper ───────────────────────────────────────────────────────

def _detect_bb_expansion(candles_1h: list[Candle]) -> tuple[bool, bool]:
    """
    Return (bb_expanding, had_recent_squeeze).

    bb_expanding     = current BB width > 20-period average × 1.3
    had_recent_squeeze = any of the 5–9 candles before current had width < avg × 0.7

    Uses pure Python over the last 40 1h candles to compute BB widths.
    Returns (False, False) if insufficient candles.
    """
    if len(candles_1h) < BB_EXPANSION_LOOKBACK:
        return False, False

    recent = candles_1h[-BB_EXPANSION_LOOKBACK:]
    closes = [c.close for c in recent]

    # Compute rolling 20-period BB width for each candle
    widths: list[float] = []
    for i in range(len(closes)):
        start = max(0, i - BB_WINDOW + 1)
        window = closes[start : i + 1]
        if len(window) < 2:
            widths.append(0.0)
            continue
        mu  = mean(window)
        var = mean((x - mu) ** 2 for x in window)
        std = var ** 0.5
        widths.append((4 * std) / mu if mu > 0 else 0.0)  # 2σ band width / mid

    if not widths or widths[-1] == 0.0:
        return False, False

    # 20-period rolling average of widths ending at current candle
    avg_slice = widths[max(0, len(widths) - BB_WINDOW) :]
    avg_width = mean(w for w in avg_slice if w > 0) if avg_slice else 0.0
    if avg_width == 0.0:
        return False, False

    current_width = widths[-1]
    bb_expanding  = current_width > avg_width * BB_EXPANSION_RATIO

    # Check prior candles (exclude current, look back BB_SQUEEZE_LOOKBACK)
    prior_widths = widths[-(BB_SQUEEZE_LOOKBACK + 1) : -1]
    had_squeeze  = any(w < avg_width * BB_SQUEEZE_RATIO for w in prior_widths if w > 0)

    return bb_expanding, had_squeeze


# ── Main detection function ───────────────────────────────────────────────────

def detect_breakout_strength(
    candles_1d:   list[Candle],
    candles_1h:   list[Candle],
    signal_type:  SignalType,
) -> BreakoutResult:
    """
    Detect institutional breakout patterns for a single coin.

    Parameters
    ----------
    candles_1d   — daily candles (need ≥ 31 for 30-day high/low check)
    candles_1h   — 1h candles (need ≥ 40 for BB expansion check)
    signal_type  — BUY or SELL (determines whether we check highs or lows)

    Returns
    -------
    BreakoutResult with strength, score_bonus, and details.
    Never raises — returns NONE on insufficient data.
    """
    is_buy = signal_type == SignalType.BUY

    # ── Step 1: Daily structure breakout ─────────────────────────────────────
    above_20d   = False
    above_30d   = False
    vol_ratio   = 1.0
    vol_confirmed = False
    breakout_label = "none"

    if len(candles_1d) >= BREAKOUT_DAY_SHORT + 1:
        closes_1d = [c.close for c in candles_1d]
        volumes_1d = [c.volume for c in candles_1d]

        current_close = closes_1d[-1]
        current_vol   = volumes_1d[-1]

        # Volume confirmation: latest vs 20-day average (excluding today)
        vol_window = volumes_1d[-(BREAKOUT_DAY_SHORT + 1) : -1]
        avg_vol    = mean(vol_window) if vol_window else 0.0
        vol_ratio  = current_vol / avg_vol if avg_vol > 0 else 1.0
        vol_confirmed = vol_ratio >= VOLUME_CONFIRM_RATIO

        # 20-day high/low
        ref_20 = closes_1d[-(BREAKOUT_DAY_SHORT + 1) : -1]
        if is_buy:
            above_20d = current_close > max(ref_20)
            breakout_label = "20d_high" if above_20d else "none"
        else:
            above_20d = current_close < min(ref_20)
            breakout_label = "20d_low" if above_20d else "none"

        # 30-day high/low
        if len(candles_1d) >= BREAKOUT_DAY_LONG + 1:
            ref_30 = closes_1d[-(BREAKOUT_DAY_LONG + 1) : -1]
            if is_buy:
                above_30d = current_close > max(ref_30)
                if above_30d:
                    breakout_label = "30d_high"
            else:
                above_30d = current_close < min(ref_30)
                if above_30d:
                    breakout_label = "30d_low"

    # ── Step 2: BB expansion check ────────────────────────────────────────────
    bb_expanding, had_squeeze = _detect_bb_expansion(candles_1h)

    # ── Step 3: Classify ──────────────────────────────────────────────────────
    any_structure_break = above_20d or above_30d

    if any_structure_break and vol_confirmed and bb_expanding:
        return BreakoutResult(
            strength      = BreakoutStrength.HIGH_MOMENTUM_BREAKOUT,
            score_bonus   = SCORE_HIGH_MOM,
            breakout_type = f"{breakout_label}+bb_expansion",
            volume_ratio  = vol_ratio,
            details       = (
                f"{'30d' if above_30d else '20d'} {'high' if is_buy else 'low'} break "
                f"with {vol_ratio:.1f}× volume + BB expansion after squeeze"
            ),
        )

    if (above_20d and vol_confirmed) or above_30d:
        return BreakoutResult(
            strength      = BreakoutStrength.CONFIRMED_BREAKOUT,
            score_bonus   = SCORE_CONFIRMED,
            breakout_type = breakout_label,
            volume_ratio  = vol_ratio,
            details       = (
                f"{'30d' if above_30d else '20d'} {'high' if is_buy else 'low'} break"
                + (f" ({vol_ratio:.1f}× volume)" if vol_confirmed else " (structure only)")
            ),
        )

    # Pure BB expansion has negative expectancy in restored live outcomes; keep
    # BB only as confirmation on a structure break.
    if above_20d:
        btype = breakout_label
        return BreakoutResult(
            strength      = BreakoutStrength.EARLY_BREAKOUT,
            score_bonus   = SCORE_EARLY,
            breakout_type = btype,
            volume_ratio  = vol_ratio,
            details       = (
                f"Early 20d {'high' if is_buy else 'low'} break"
                + (" — volume not yet confirming" if not vol_confirmed else "")
            ),
        )

    return _NONE
