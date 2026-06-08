"""
Sector Intelligence Engine — Phase 7.3A.5.

Classifies CMC category sectors into four actionable states by combining
the current snapshot with a stored baseline from the previous snapshot.

═══════════════════════════════════════════════════════════════
SECTOR STATES
═══════════════════════════════════════════════════════════════

  STRONGEST     Top absolute performer (avg_change > 7%), stable or accelerating.
                Sustained institutional rotation into this sector.

  ACCELERATING  Sector gaining momentum — delta vs previous snapshot > +3%.
                Often represents EARLY-STAGE sector rotation. Higher premium
                than STRONGEST because entry point is earlier.

  NEUTRAL       Normal market participation. No directional edge.

  WEAKENING     Sector losing momentum — delta < −3%. Still may be positive in
                absolute terms but rotation is exiting. Penalise candidates.

  OVERCROWDED   Parabolic price move (avg_change > 12%) OR marketCapChange
                lagging price change (distribution signature). High reversal risk.
                Penalise candidates even if they look otherwise strong.

═══════════════════════════════════════════════════════════════
DETECTION ALGORITHM
═══════════════════════════════════════════════════════════════

  Priority order (highest wins):
    1. OVERCROWDED   — checked first; overrides all other positive signals
    2. WEAKENING     — declining momentum regardless of absolute level
    3. STRONGEST     — top absolute performer, stable/improving
    4. ACCELERATING  — building momentum from any level
    5. NEUTRAL       — fallback

  OVERCROWDED criteria (any one sufficient):
    avg_change > 12%                  parabolic move
    avg_change > 7% AND mcap_change < avg_change × 0.3
                                      price rising but market cap lagging = distribution

  WEAKENING criteria:
    delta < −3%  AND  history available (prevents false negatives on first run)

  STRONGEST criteria:
    avg_change > 7%  AND  NOT (OVERCROWDED or WEAKENING)

  ACCELERATING criteria:
    delta > +3%  AND  history available  AND  NOT STRONGEST

  NEUTRAL: default

═══════════════════════════════════════════════════════════════
TREND SCORE IMPACT (sector_strength component, max 15 pts)
═══════════════════════════════════════════════════════════════

  Base score is computed from avgPriceChange (same tiers as before).
  Status adjustment applied on top, clamped to [0, 15]:

  ACCELERATING:  +5 pts  (early rotation premium)
  STRONGEST:      0 pts  (already scoring high from avg_change)
  NEUTRAL:        0 pts
  WEAKENING:     −5 pts  (momentum decay penalty)
  OVERCROWDED:   cap to max 5 pts  (reversal risk — override regardless of base)

═══════════════════════════════════════════════════════════════
HISTORICAL DELTA
═══════════════════════════════════════════════════════════════

  Baseline stored in Redis key: cache:intel:sector_baseline (TTL 45 min).
  Written by save_sector_baseline() after each analysis.
  Read by read_sector_baseline() at analysis time.

  delta = current_avg_change − prev_avg_change

  Delta is meaningful only when:
    - A baseline exists
    - The baseline refreshedAt timestamp differs from the current snapshot
      (i.e., at least one 30-min categories refresh has occurred since baseline)

  On first run (no baseline): all sectors default to NEUTRAL.

═══════════════════════════════════════════════════════════════
TELEMETRY
═══════════════════════════════════════════════════════════════

  Prometheus counter: sector_intelligence_status_total{status}
    Incremented once per sector per scan cycle.

  Log event: sector_intelligence_report
    {strongest: [...], accelerating: [...], weakening: [...], overcrowded: [...]}

  SectorIntelligenceReport.as_log_dict() — serialisable summary for structured logging.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from backend.logging.setup import get_logger

log = get_logger(__name__)

# ── Thresholds ────────────────────────────────────────────────────────────────

STRONGEST_THRESHOLD          = 7.0    # avgPriceChange % to qualify as STRONGEST
OVERCROWDED_PARABOLIC        = 12.0   # avgPriceChange above this = parabolic
OVERCROWDED_DISTRIBUTION_K   = 0.30   # mcap_change / avg_change below this = distribution
ACCEL_THRESHOLD              = 3.0    # |delta| threshold for ACCELERATING / WEAKENING

# Redis baseline key (purely Python-owned — TS workers do not touch this)
SECTOR_BASELINE_KEY = "cache:intel:sector_baseline"
SECTOR_BASELINE_TTL = 60 * 60   # 60 minutes — aligned with CMC categories cache TTL


# ── Data models ───────────────────────────────────────────────────────────────

class SectorStatus(str, Enum):
    STRONGEST    = "STRONGEST"
    ACCELERATING = "ACCELERATING"
    NEUTRAL      = "NEUTRAL"
    WEAKENING    = "WEAKENING"
    OVERCROWDED  = "OVERCROWDED"


@dataclass
class SectorAnalysis:
    """Analysis result for a single CMC category sector."""
    name:           str
    status:         SectorStatus
    avg_change:     float         # current avgPriceChange
    prev_avg_change: float        # previous avgPriceChange (0.0 if no history)
    delta:          float         # avg_change − prev_avg_change
    coin_count:     int
    volume_24h:     float
    mcap_change:    float         # marketCapChange
    has_history:    bool          # True if a previous baseline existed

    @property
    def trend_score_adjustment(self) -> float:
        """Additive adjustment to the TrendScore sector_strength base score."""
        if self.status == SectorStatus.ACCELERATING:
            return 5.0
        if self.status == SectorStatus.WEAKENING:
            return -5.0
        return 0.0

    @property
    def is_overcrowded(self) -> bool:
        return self.status == SectorStatus.OVERCROWDED

    def as_dict(self) -> dict:
        return {
            "name":       self.name,
            "status":     self.status.value,
            "avg_change": round(self.avg_change, 2),
            "delta":      round(self.delta,  2),
            "has_history": self.has_history,
        }


@dataclass
class SectorIntelligenceReport:
    """Full sector intelligence for one scan cycle."""
    sectors:        dict[str, SectorAnalysis]  # name → analysis
    strongest:      list[str]                  # sector names
    accelerating:   list[str]
    weakening:      list[str]
    overcrowded:    list[str]
    snapshot_age_s: float                      # age of the categories snapshot

    def get(self, sector_name: str) -> SectorAnalysis | None:
        return self.sectors.get(sector_name)

    def as_log_dict(self) -> dict:
        return {
            "strongest":    self.strongest,
            "accelerating": self.accelerating,
            "weakening":    self.weakening,
            "overcrowded":  self.overcrowded,
            "snapshot_age_s": round(self.snapshot_age_s, 0),
        }


# ── Detection ─────────────────────────────────────────────────────────────────

def _detect_status(
    avg_change:  float,
    mcap_change: float,
    delta:       float,
    has_history: bool,
) -> SectorStatus:
    """Apply detection rules in priority order."""
    # 1. OVERCROWDED — highest risk, checked first
    if avg_change > OVERCROWDED_PARABOLIC:
        return SectorStatus.OVERCROWDED
    if (avg_change > STRONGEST_THRESHOLD
            and mcap_change < avg_change * OVERCROWDED_DISTRIBUTION_K):
        return SectorStatus.OVERCROWDED

    # 2. WEAKENING — declining momentum, penalise regardless of absolute level
    if has_history and delta < -ACCEL_THRESHOLD:
        return SectorStatus.WEAKENING

    # 3. STRONGEST — top absolute performer, not weakening or overcrowded
    if avg_change > STRONGEST_THRESHOLD:
        return SectorStatus.STRONGEST

    # 4. ACCELERATING — building momentum from any level
    if has_history and delta > ACCEL_THRESHOLD:
        return SectorStatus.ACCELERATING

    return SectorStatus.NEUTRAL


# ── Redis baseline persistence ────────────────────────────────────────────────

async def read_sector_baseline() -> dict[str, float] | None:
    """
    Read the stored sector baseline (sector_name → prev_avg_change).
    Returns None if no baseline exists.
    """
    try:
        from backend.cache.redis_cache import get_redis  # noqa: PLC0415
        redis = await get_redis()
        raw = await redis.get(SECTOR_BASELINE_KEY)
        if raw:
            return json.loads(raw)
    except Exception as exc:
        log.warning("sector_baseline_read_failed", error=str(exc))
    return None


async def save_sector_baseline(sectors: list[dict], refreshed_at: str) -> None:
    """
    Persist the current sector snapshot as the next baseline.
    Keyed by sector name, value = avgPriceChange.
    """
    try:
        from backend.cache.redis_cache import get_redis  # noqa: PLC0415
        redis  = await get_redis()
        payload = {
            "_refreshed_at": refreshed_at,
            **{
                cat.get("name", ""): float(cat.get("avgPriceChange") or 0)
                for cat in sectors
                if cat.get("name")
            },
        }
        await redis.setex(SECTOR_BASELINE_KEY, SECTOR_BASELINE_TTL, json.dumps(payload))
    except Exception as exc:
        log.warning("sector_baseline_save_failed", error=str(exc))


# ── Main analysis function ────────────────────────────────────────────────────

async def analyze_sectors(
    categories:  list[dict],
    refreshed_at: str = "",
) -> SectorIntelligenceReport:
    """
    Classify all CMC categories into sector states.

    Parameters
    ----------
    categories   — raw CategoryData list from cache:intel:categories
    refreshed_at — ISO-8601 timestamp of the categories snapshot

    Returns
    -------
    SectorIntelligenceReport with per-sector analysis and aggregated lists.
    """
    # Compute snapshot age
    snapshot_age = 0.0
    if refreshed_at:
        try:
            ts = datetime.fromisoformat(refreshed_at.replace("Z", "+00:00"))
            snapshot_age = (datetime.now(timezone.utc) - ts).total_seconds()
        except Exception:
            pass

    # Load previous baseline for delta computation
    baseline = await read_sector_baseline()
    baseline_refreshed_at = (baseline or {}).get("_refreshed_at", "")
    has_history = bool(baseline and baseline_refreshed_at != refreshed_at)

    # Analyse each sector
    sector_results: dict[str, SectorAnalysis] = {}

    for cat in categories:
        name       = cat.get("name", "")
        avg_change = float(cat.get("avgPriceChange") or 0)
        mcap_chg   = float(cat.get("marketCapChange") or 0)
        coin_cnt   = int(cat.get("coinCount") or 0)
        vol        = float(cat.get("volume24h") or 0)

        if not name:
            continue

        prev_change = float(baseline.get(name, 0)) if (baseline and has_history) else 0.0
        delta       = avg_change - prev_change if has_history else 0.0
        status      = _detect_status(avg_change, mcap_chg, delta, has_history)

        sector_results[name] = SectorAnalysis(
            name            = name,
            status          = status,
            avg_change      = avg_change,
            prev_avg_change = prev_change,
            delta           = round(delta, 2),
            coin_count      = coin_cnt,
            volume_24h      = vol,
            mcap_change     = mcap_chg,
            has_history     = has_history,
        )

    # Persist current as next baseline (after analysis to avoid self-comparison)
    await save_sector_baseline(categories, refreshed_at)

    # Build aggregated lists
    strongest    = [s.name for s in sector_results.values() if s.status == SectorStatus.STRONGEST]
    accelerating = [s.name for s in sector_results.values() if s.status == SectorStatus.ACCELERATING]
    weakening    = [s.name for s in sector_results.values() if s.status == SectorStatus.WEAKENING]
    overcrowded  = [s.name for s in sector_results.values() if s.status == SectorStatus.OVERCROWDED]

    report = SectorIntelligenceReport(
        sectors       = sector_results,
        strongest     = strongest,
        accelerating  = accelerating,
        weakening     = weakening,
        overcrowded   = overcrowded,
        snapshot_age_s= snapshot_age,
    )

    # Prometheus telemetry
    try:
        from backend.metrics.prometheus import sector_intelligence_status_total  # noqa: PLC0415
        for s in sector_results.values():
            sector_intelligence_status_total.labels(status=s.status.value).inc()
    except Exception:
        pass

    log.info("sector_intelligence_report", **report.as_log_dict())
    return report
