/**
 * SETTINGS.CENTER.2 — founder-facing settings classification.
 *
 * Single source of truth for which settings appear where:
 *   daily       → Founder Settings page, always visible (Quick Controls / Signal Quality / Feature Flags)
 *   occasional  → Advanced Settings accordion (tuning-phase knobs)
 *   engineering → System → Infrastructure Configuration, READ-ONLY
 *   dead        → hidden from all UI (backend support preserved — UI only)
 *
 * Wiring verified June 2026 (SETTINGS.WIRE.1): only features/ai/telegram/anomaly
 * and scanner.trending_watchlist are read at runtime; scanner numerics apply as
 * flag-gated floors; signals/risk/infra have no backend consumers yet.
 */

export type SettingTier = 'daily' | 'occasional' | 'engineering' | 'dead'

/** Per-group default tier (field overrides below take precedence). */
const GROUP_TIER: Record<string, SettingTier> = {
  features: 'daily',
  scanner:  'occasional',
  signals:  'occasional',
  ai:       'occasional',
  telegram: 'occasional',
  risk:     'occasional',
  anomaly:  'occasional',
  infra:    'engineering',
  paper_trading: 'dead',
}

const FIELD_TIER: Record<string, SettingTier> = {
  // ── Daily (Quick Controls / Signal Quality) ────────────────────────────────
  'ai.enabled':                        'daily',
  'telegram.alerts_enabled':           'daily',
  'scanner.min_confidence':            'daily',
  'scanner.alert_confidence':          'daily',
  'scanner.max_coins_per_run':         'daily',
  'signals.min_rr_ratio':              'daily',

  // ── Engineering (set-once / env-adjacent — read-only in System) ───────────
  'scanner.delay_ms':                  'engineering',
  'ai.max_tokens':                     'engineering',
  'ai.temperature':                    'engineering',
  'ai.timeout_secs':                   'engineering',
  'ai.max_retries':                    'engineering',
  'ai.fallback_on_error':              'engineering',
  'telegram.max_alerts_per_hour':      'engineering',
  'telegram.daily_summary_hour_utc':   'engineering',
  'telegram.include_ai_analysis':      'engineering',

  // ── Dead (no consumer anywhere — cosmetic leftovers) ──────────────────────
  'signals.confidence_high':           'dead',
  'signals.confidence_medium':         'dead',
}

export function settingTier(group: string, key: string): SettingTier {
  return FIELD_TIER[`${group}.${key}`] ?? GROUP_TIER[group] ?? 'occasional'
}

/** Flags whose state changes are dangerous enough to surface in the Safety card. */
export const DANGEROUS_FLAGS: Record<string, { dangerousWhen: boolean; label: string; detail: string }> = {
  'features.emergency_stop':    { dangerousWhen: true,  label: 'Emergency Stop ACTIVE',   detail: 'All scans, signals, and Telegram output are halted.' },
  'features.maintenance_mode':  { dangerousWhen: true,  label: 'Maintenance Mode ACTIVE', detail: 'Scans and Telegram sends are blocked.' },
  'features.telegram':          { dangerousWhen: false, label: 'Telegram master switch OFF', detail: 'No alerts are being delivered.' },
  'features.ai_validation':     { dangerousWhen: false, label: 'AI validation flag OFF',  detail: 'All signals validate via heuristics only.' },
  'ai.enabled':                 { dangerousWhen: false, label: 'Claude validation OFF',   detail: 'Signals show as Screened, never AI Approved.' },
  'telegram.alerts_enabled':    { dangerousWhen: false, label: 'Signal alerts OFF',       detail: 'Accepted signals are not sent to Telegram.' },
}
