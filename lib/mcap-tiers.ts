import { McapTier } from '@/types';

export interface TierProfile {
  tier:                    McapTier;
  label:                   string;
  qualityBonus:            number;   // added to qualityScore
  continuationMinimum:     number;   // minimum continuationProbability to proceed
  volumeRequirement:       number;   // volumeSpike multiplier threshold
  institutionalThreshold:  number;   // minimum institutionalScore to surface
}

const TIER_PROFILES: Record<McapTier, Omit<TierProfile, 'tier'>> = {
  mega: {
    label:                  'Mega (T10)',
    qualityBonus:           5,
    continuationMinimum:    35,   // strictest — needs sustained continuation
    volumeRequirement:      1.2,
    institutionalThreshold: 65,
  },
  large: {
    label:                  'Large (T25)',
    qualityBonus:           0,
    continuationMinimum:    30,
    volumeRequirement:      1.3,
    institutionalThreshold: 60,
  },
  mid: {
    label:                  'Mid (T50)',
    qualityBonus:           -5,   // slight penalty for lower liquidity
    continuationMinimum:    28,
    volumeRequirement:      1.5,  // requires stronger volume confirmation
    institutionalThreshold: 55,
  },
  small: {
    label:                  'Small (T100)',
    qualityBonus:           -10,  // stricter false-positive filtering
    continuationMinimum:    32,   // tight: small caps need strong continuation
    volumeRequirement:      1.8,  // high volume bar to cut noise
    institutionalThreshold: 50,
  },
};

export function getMcapTier(rank: number): McapTier {
  if (rank <= 10)  return 'mega';
  if (rank <= 25)  return 'large';
  if (rank <= 50)  return 'mid';
  return 'small';
}

export function getTierProfile(rank: number): TierProfile {
  const tier = getMcapTier(rank);
  return { tier, ...TIER_PROFILES[tier] };
}

export const TIER_COLORS: Record<McapTier, string> = {
  mega:  '#f59e0b',  // gold
  large: '#3b82f6',  // blue
  mid:   '#8b5cf6',  // purple
  small: '#6b7280',  // gray
};
