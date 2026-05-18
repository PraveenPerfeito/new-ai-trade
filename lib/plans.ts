import type { Plan, PlanId } from '@/types';

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id:                  'free',
    name:                'Free',
    minSignalConfidence: 85,
    dailySignalLimit:    10,
    monthlyApiCalls:     500,
    maxScanTriggers:     3,
    allowedModes:        ['spot'],
    features: [
      'Up to 10 signals/day',
      'Spot mode only',
      'Confidence ≥ 85%',
      '3 manual scans/day',
      '500 API calls/month',
    ],
  },

  pro: {
    id:                  'pro',
    name:                'Pro',
    minSignalConfidence: 75,
    dailySignalLimit:    -1,
    monthlyApiCalls:     10_000,
    maxScanTriggers:     -1,
    allowedModes:        ['spot', 'futures', 'high_confidence', 'trending'],
    features: [
      'Unlimited signals',
      'All scan modes',
      'Confidence ≥ 75%',
      'Unlimited manual scans',
      '10,000 API calls/month',
      'Futures intelligence',
    ],
  },

  enterprise: {
    id:                  'enterprise',
    name:                'Enterprise',
    minSignalConfidence: 70,
    dailySignalLimit:    -1,
    monthlyApiCalls:     -1,
    maxScanTriggers:     -1,
    allowedModes:        ['spot', 'futures', 'high_confidence', 'trending'],
    features: [
      'Unlimited everything',
      'All scan modes',
      'Confidence ≥ 70%',
      'Unlimited API calls',
      'Priority support',
      'Custom integrations',
    ],
  },
};

export function getPlan(planId: PlanId): Plan {
  return PLANS[planId];
}

export function isUnlimited(limit: number): boolean {
  return limit === -1;
}
