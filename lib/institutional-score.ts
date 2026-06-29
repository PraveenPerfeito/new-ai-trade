import { RiskGrade } from '@/types';
import { VolatilityRating } from './indicators';

interface InstitutionalScoreInput {
  aiConfidence:         number;      // 0-100 from Claude
  riskGrade:            RiskGrade;   // A-F
  trendStrength:        number;      // 0-100 combined 1h+4h
  qualityScore:         number;      // 0-100 from risk engine
  volatility:           VolatilityRating;
  rrRatio:              number;      // e.g. 2.5
  futuresMomentumScore?: number;     // 0-100; undefined for non-futures signals
  regimeAlignmentScore: number;      // flat ±adjustment from scoreRegimeAlignment()
}

const GRADE_SCORE: Record<RiskGrade, number> = {
  'A+': 100, A: 95, 'B+': 80, B: 70, C: 55, D: 35, F: 0,
};

/**
 * Computes a multi-dimensional institutional quality score (0–100).
 *
 * Weighted components (sum = 100%):
 *   AI confidence       25%  — final Claude verdict
 *   Risk grade          20%  — risk engine quality gate
 *   Trend strength      20%  — 1h+4h combined directional strength
 *   Quality score       15%  — risk engine setup quality
 *   Volatility          10%  — NORMAL preferred (reliable stops)
 *   R:R quality          5%  — capped at 3:1 = 100
 *   Futures momentum     5%  — 50 neutral when futures data absent
 *
 * Regime alignment score is added as a flat ±adjustment afterward and
 * is NOT included in the weighted sum (it's an external market condition,
 * not a property of the setup itself). Final value clamped to [0, 100].
 */
export function calcInstitutionalScore(input: InstitutionalScoreInput): number {
  const {
    aiConfidence, riskGrade, trendStrength, qualityScore,
    volatility, rrRatio, futuresMomentumScore, regimeAlignmentScore,
  } = input;

  const volScore =
    volatility === 'NORMAL'  ? 100 :
    volatility === 'LOW'     ?  70 :
    volatility === 'HIGH'    ?  40 :
    0; // EXTREME

  const rrScore      = Math.min((rrRatio / 3) * 100, 100);
  const futuresScore = futuresMomentumScore ?? 50; // neutral when no futures data

  const weighted =
    aiConfidence              * 0.25 +
    GRADE_SCORE[riskGrade]    * 0.20 +
    trendStrength             * 0.20 +
    qualityScore              * 0.15 +
    volScore                  * 0.10 +
    rrScore                   * 0.05 +
    futuresScore              * 0.05;

  return Math.max(0, Math.min(100, Math.round(weighted + regimeAlignmentScore)));
}
