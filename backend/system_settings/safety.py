"""
Settings safety layer — hard caps and semantic rule checks.

Two protection tiers run before every patch_group() DB write:

  Tier 1 — SAFETY_CAPS
    Absolute per-field min/max limits, independent of Pydantic Field bounds.
    Guards against accidental bound relaxation in groups.py.
    All violations are 'error'-severity — they block the save.

  Tier 2 — Semantic rules
    Cross-field combination checks that detect operationally dangerous configs.
    'error' violations block the save.
    'warning' violations are logged and returned to the caller for UI display.

Caller contract
---------------
    from backend.system_settings.safety import check_safety, SafetyError

    violations = check_safety(group_name, merged_data)
    errors = [v for v in violations if v.severity == 'error']
    if errors:
        raise SafetyError(errors)
    warnings = [v.message for v in violations if v.severity == 'warning']
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.logging.setup import get_logger

log = get_logger(__name__)


# ── Violation / Error types ───────────────────────────────────────────────────

@dataclass
class Violation:
    code:     str        # machine-readable, e.g. 'LEVERAGE_CAP_EXCEEDED'
    severity: str        # 'error' | 'warning'
    fields:   list[str]  # field names involved
    message:  str        # human-readable explanation


class SafetyError(ValueError):
    """Raised when one or more error-severity violations are detected."""

    def __init__(self, violations: list[Violation]) -> None:
        self.violations = violations
        msgs = '; '.join(v.message for v in violations if v.severity == 'error')
        super().__init__(msgs)


# ── Tier 1 — absolute hard caps ───────────────────────────────────────────────
#
# (lo, hi) — inclusive bounds that cannot be exceeded regardless of Pydantic
# Field definitions. Changing groups.py bounds does NOT loosen these.

SAFETY_CAPS: dict[str, dict[str, tuple[float, float]]] = {
    'risk': {
        'max_leverage_conservative': (1,     10),   # 10× hard ceiling
        'max_leverage_standard':     (1,     25),   # 25× hard ceiling
        'max_leverage_aggressive':   (1,     50),   # 50× hard ceiling
        'max_portfolio_risk_pct':    (0.001, 0.10), # 10% per-trade risk cap
    },
    'signals': {
        'min_rr_ratio': (0.5, 10.0),
        'max_sl_pct':   (0.01, 0.20),   # 20% SL cap
    },
    'scanner': {
        'max_coins_per_run': (10, 200),  # 500 coins would overwhelm workers
        'min_confidence':    (55, 100),
    },
    'infra': {
        'max_scan_concurrency': (1, 20),   # 50 concurrent = resource exhaustion
        'db_pool_max_size':     (2, 50),
        'scanner_timeout_secs': (10, 300), # 600 s tasks starve the worker pool
    },
    'anomaly': {
        'win_rate_drop_crit': (0.05, 0.95),
        'drawdown_crit':      (1.0, 50.0),
        'queue_depth_crit':   (2, 500),
    },
}


def _check_caps(group_name: str, data: dict[str, Any]) -> list[Violation]:
    violations: list[Violation] = []
    for field_name, (lo, hi) in SAFETY_CAPS.get(group_name, {}).items():
        raw = data.get(field_name)
        if raw is None:
            continue
        try:
            num = float(raw)
        except (TypeError, ValueError):
            continue
        if num < lo:
            violations.append(Violation(
                code=f'SAFETY_MIN_{field_name.upper()}',
                severity='error',
                fields=[field_name],
                message=(
                    f'{field_name} = {raw} is below the safety floor of {lo}. '
                    f'This value is hard-capped regardless of model bounds.'
                ),
            ))
        elif num > hi:
            violations.append(Violation(
                code=f'SAFETY_CAP_{field_name.upper()}',
                severity='error',
                fields=[field_name],
                message=(
                    f'{field_name} = {raw} exceeds the safety cap of {hi}. '
                    f'This value is hard-capped regardless of model bounds.'
                ),
            ))
    return violations


# ── Tier 2 — semantic rules ───────────────────────────────────────────────────

def _check_signals(data: dict[str, Any]) -> list[Violation]:
    violations: list[Violation] = []

    rr = float(data.get('min_rr_ratio', 1.5))
    sl = float(data.get('max_sl_pct', 0.08))

    if rr < 1.0:
        violations.append(Violation(
            code='RR_BELOW_BREAKEVEN',
            severity='error',
            fields=['min_rr_ratio'],
            message=(
                f'min_rr_ratio = {rr} is below 1.0 — accepting setups where '
                'maximum loss exceeds maximum gain. A 50% win rate at this RR '
                'is a mathematically losing strategy.'
            ),
        ))
    elif rr < 1.5:
        violations.append(Violation(
            code='RR_LOW',
            severity='warning',
            fields=['min_rr_ratio'],
            message=(
                f'min_rr_ratio = {rr} is below 1.5. You need a win rate above '
                f'{1/(1+rr):.0%} to break even. Ensure your historical win rate '
                'supports this threshold.'
            ),
        ))

    if sl > 0.12 and rr < 1.5:
        violations.append(Violation(
            code='HIGH_SL_LOW_RR',
            severity='warning',
            fields=['max_sl_pct', 'min_rr_ratio'],
            message=(
                f'Wide stop-loss ({sl:.0%}) combined with low RR minimum ({rr}×) '
                'accepts high-risk setups with large potential losses. '
                'Consider raising min_rr_ratio or tightening max_sl_pct.'
            ),
        ))

    return violations


def _check_risk(data: dict[str, Any]) -> list[Violation]:
    violations: list[Violation] = []

    aggressive  = int(data.get('max_leverage_aggressive', 10))
    risk_pct    = float(data.get('max_portfolio_risk_pct', 0.02))
    reject_f    = bool(data.get('reject_f_grade', True))
    quality     = int(data.get('min_quality_score', 40))

    # Catastrophic risk combination: high leverage + large position size
    if aggressive > 20 and risk_pct > 0.05:
        violations.append(Violation(
            code='CATASTROPHIC_RISK_COMBO',
            severity='error',
            fields=['max_leverage_aggressive', 'max_portfolio_risk_pct'],
            message=(
                f'max_leverage_aggressive = {aggressive}× with '
                f'max_portfolio_risk_pct = {risk_pct:.0%} is catastrophically dangerous. '
                'A single 5% adverse move would liquidate the entire position. '
                'Reduce leverage to ≤ 20× or portfolio risk to ≤ 5%.'
            ),
        ))

    # Zero quality filter
    if not reject_f and quality == 0:
        violations.append(Violation(
            code='ZERO_QUALITY_FILTER',
            severity='error',
            fields=['reject_f_grade', 'min_quality_score'],
            message=(
                'reject_f_grade = false with min_quality_score = 0 disables all '
                'signal quality filtering — every signal, regardless of quality, '
                'will be accepted. Set min_quality_score ≥ 1 or enable reject_f_grade.'
            ),
        ))
    elif not reject_f and quality < 20:
        violations.append(Violation(
            code='WEAK_QUALITY_FILTER',
            severity='warning',
            fields=['reject_f_grade', 'min_quality_score'],
            message=(
                f'reject_f_grade = false with min_quality_score = {quality} is a '
                'very permissive quality bar. Grade-F signals are risk-adjusted failures. '
                'Consider enabling reject_f_grade.'
            ),
        ))

    return violations


def _check_scanner(data: dict[str, Any]) -> list[Violation]:
    violations: list[Violation] = []

    confidence = int(data.get('min_confidence', 75))
    coins      = int(data.get('max_coins_per_run', 100))

    if confidence < 65 and coins > 150:
        violations.append(Violation(
            code='LOW_QUALITY_HIGH_VOLUME',
            severity='warning',
            fields=['min_confidence', 'max_coins_per_run'],
            message=(
                f'min_confidence = {confidence} with max_coins_per_run = {coins} '
                'generates a large volume of low-quality signals. '
                'Consider raising min_confidence to at least 70.'
            ),
        ))

    return violations


def _check_paper_trading(data: dict[str, Any]) -> list[Violation]:
    violations: list[Violation] = []

    size  = float(data.get('position_size_pct', 0.10))
    count = int(data.get('max_open_trades', 5))

    if size * count > 1.0:
        violations.append(Violation(
            code='OVERCOMMITTED_CAPITAL',
            severity='warning',
            fields=['position_size_pct', 'max_open_trades'],
            message=(
                f'position_size_pct = {size:.0%} × max_open_trades = {count} = '
                f'{size*count:.0%} — more than 100% of capital would be committed '
                'if all positions are open simultaneously. '
                'Reduce position_size_pct or max_open_trades.'
            ),
        ))

    return violations


def _check_infra(data: dict[str, Any]) -> list[Violation]:
    violations: list[Violation] = []

    concurrency = int(data.get('max_scan_concurrency', 5))
    db_max      = int(data.get('db_pool_max_size', 10))
    timeout     = int(data.get('scanner_timeout_secs', 60))

    if concurrency > db_max * 0.8:
        violations.append(Violation(
            code='CONCURRENCY_EXCEEDS_POOL',
            severity='warning',
            fields=['max_scan_concurrency', 'db_pool_max_size'],
            message=(
                f'max_scan_concurrency = {concurrency} is high relative to '
                f'db_pool_max_size = {db_max}. Concurrent scans may exhaust the '
                'connection pool. Increase db_pool_max_size or reduce concurrency.'
            ),
        ))

    if concurrency * timeout > 1_800:
        violations.append(Violation(
            code='WORKER_STARVATION_RISK',
            severity='warning',
            fields=['max_scan_concurrency', 'scanner_timeout_secs'],
            message=(
                f'max_scan_concurrency = {concurrency} × scanner_timeout_secs = {timeout} '
                f'= up to {concurrency * timeout // 60} min of total worker time per scan. '
                'This may starve other Celery tasks. Reduce concurrency or timeout.'
            ),
        ))

    return violations


# ── Public entry point ────────────────────────────────────────────────────────

_SEMANTIC_RULES = {
    'signals':      _check_signals,
    'risk':         _check_risk,
    'scanner':      _check_scanner,
    'paper_trading': _check_paper_trading,
    'infra':        _check_infra,
}


def check_safety(
    group_name: str,
    data: dict[str, Any],
) -> list[Violation]:
    """
    Run all safety checks for the given group.
    Returns every violation (both 'error' and 'warning').
    Does NOT raise — caller decides whether to block on errors.
    """
    violations  = _check_caps(group_name, data)
    rule_fn     = _SEMANTIC_RULES.get(group_name)
    if rule_fn:
        violations += rule_fn(data)

    for v in violations:
        level = log.error if v.severity == 'error' else log.warning
        level(
            "settings_safety_violation",
            group=group_name,
            severity=v.severity,
            code=v.code,
            fields=v.fields,
            detail=v.message,
        )

    return violations
