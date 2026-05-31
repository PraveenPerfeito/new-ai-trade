/**
 * Typed client for the Python FastAPI backend.
 * All calls go through /api/admin/* (Next.js proxy) so BACKEND_URL stays server-side.
 */

const BASE = '/api/admin'

// ── Generic fetchers ──────────────────────────────────────────────────────────

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `[admin-api] PUT ${path} → HTTP ${res.status}`)
  }
  return res.json()
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `[admin-api] PATCH ${path} → HTTP ${res.status}`)
  }
  return res.json()
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  }
  const res = await fetch(url.pathname + url.search, { cache: 'no-store' })
  if (!res.ok) throw new Error(`[admin-api] GET ${path} → HTTP ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`[admin-api] POST ${path} → HTTP ${res.status}`)
  return res.json()
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { method: 'DELETE', cache: 'no-store' })
  if (!res.ok) throw new Error(`[admin-api] DELETE ${path} → HTTP ${res.status}`)
  return res.json()
}

// ── Response types ────────────────────────────────────────────────────────────

export interface BurninStatus {
  status: 'insufficient_data' | 'early_data' | 'sufficient_data'
  progress_pct: number
  data_coverage: {
    resolved: number
    pending: number
    days: number
    earliest: string | null
    latest: string | null
  }
  min_for_edge: number
  min_for_report: number
  live_metrics: {
    win_rate_7d: number | null
    expectancy_7d: number | null
  }
  anomaly_summary: {
    checked_at: string
    total: number
    critical: number
    warning: number
    ok: boolean
  } | null
  checked_at: string
}

export interface ReadinessComponent {
  score: number
  inputs: Record<string, number | null>
}

export interface ReadinessResult {
  overall_score: number
  verdict: {
    label: 'production_ready' | 'ready_with_monitoring' | 'needs_more_data' | 'not_ready'
    go: boolean
    rationale: string
    score: number
  }
  components: {
    operational_stability: ReadinessComponent & {
      scan_score: number
      ai_score: number
      anomaly_score: number
    }
    signal_edge: ReadinessComponent & {
      wr_score: number
      exp_score: number
      sample_score: number
    }
    calibration: ReadinessComponent & {
      ece_score: number
      mono_score: number
    }
    ai_effectiveness: ReadinessComponent & {
      verdict_score: number
      fallback_score: number
    }
    data_coverage: ReadinessComponent & {
      signal_score: number
      days_score: number
    }
  }
  weights: Record<string, number>
  computed_at: string
  data_source: string
}

export interface AnomalyRecord {
  anomaly_type: string
  severity: 'critical' | 'warning' | 'info'
  description: string
  metric_value: number | null
  threshold: number | null
  detected_at: string
  snapshot_at?: string
}

export interface AiSummaryResponse {
  total_calls:     number
  success_rate:    number
  error_rate:      number
  fallback_rate:   number
  avg_latency_ms:  number | null
  verdicts?:       Record<string, number>
  verdict_distribution?: Record<string, number>
  window_hours:    number
  // Phase 7.2B.9 — validation source breakdown
  claude_calls?:      number
  heuristic_calls?:   number
  // Phase 7.2B.7.4A — cost visibility
  estimated_cost_usd?: number
  last_error?:          string | null
}

export interface ScanSummaryResponse {
  total_scans: number
  success_rate: number
  failure_rate: number
  avg_duration_ms: number | null
  signals_per_scan?: number | null
  by_mode?: Record<string, { total: number; success_rate: number }>
  window_hours: number
}

export interface EdgeBand {
  label: string
  total: number
  win_rate: number | null
  expectancy: number | null
  insufficient_data: boolean
}

export interface IntelligencePerfRow {
  label:              string
  n:                  number
  win_rate:           number | null
  expectancy:         number | null
  avg_rr:             number | null
  avg_pnl_pct:        number | null
  insufficient_data:  boolean
}

export interface IntelligenceSummary {
  total:                    number
  window_hours:             number
  insufficient_data?:       boolean
  best_trend_score_tier:    IntelligencePerfRow | null
  best_sector_status:       IntelligencePerfRow | null
  best_breakout_type:       IntelligencePerfRow | null
  best_breakout_strength:   IntelligencePerfRow | null
  best_oi_interpretation:   IntelligencePerfRow | null
  best_funding_trend:       IntelligencePerfRow | null
  best_positioning_context: IntelligencePerfRow | null
}

export interface EdgeReport {
  overall: {
    total: number
    win_rate: number | null
    expectancy: number | null
    profit_factor: number | null
    max_drawdown_r: number | null
    sharpe: number | null
    insufficient_data: boolean
    win_rate_ci: [number, number] | null
    tp_hits: number
    sl_hits: number
    timeouts: number
  }
  edge_verdict: {
    has_edge: boolean | null
    confidence_level: 'strong' | 'moderate' | 'weak' | 'none' | 'insufficient_data'
    summary: string
  }
  confidence_calibration: {
    bands: EdgeBand[]
    calibration: { ece: number; label: string; is_monotone: boolean | null }
    optimal_threshold: number | null
  }
  claude_effectiveness: {
    verdict: string
    total_with_ai_log: number
    heuristic?: Record<string, number>
  }
  window_hours: number
  generated_at: string
}


export interface HealthReady {
  status: 'ready' | 'degraded'
  checks: Record<string, string>
}

export type SettingDataType = 'bool' | 'int' | 'float' | 'string' | 'enum'

export interface SettingEntry {
  key:              string
  category:         string   // group_name for backward compat
  data_type:        SettingDataType
  label:            string
  description:      string
  value:            boolean | number | string
  default:          boolean | number | string
  min_val:          number | null
  max_val:          number | null
  allowed_values:   string[] | null
  requires_restart: boolean
}

export interface SettingGroupMeta {
  group_name:     string
  schema_version: number
  data_version:   number
  updated_at:     string | null
  updated_by:     string
}

export interface SettingsGroupResponse {
  meta:   SettingGroupMeta
  fields: SettingEntry[]
}

/** Keyed by group_name (e.g. "scanner", "ai", "anomaly") */
export type SettingsData = Record<string, SettingsGroupResponse>

export interface AuditChangedField {
  old: unknown
  new: unknown
}

export interface AuditEntry {
  id:             number
  group_name:     string
  old_version:    number
  new_version:    number
  changed_fields: Record<string, AuditChangedField>
  schema_version: number
  updated_by:     string
  updated_at:     string
}

export interface PatchResult {
  success:      boolean
  data_version: number
  changed:      string[]
  warnings?:    string[]
}

// ── Provider types ────────────────────────────────────────────────────────────

export type ProviderName = 'coingecko' | 'coinmarketcap' | 'binance' | 'dexscreener' | 'coinpaprika' | 'geckoterm'
export type ProviderStatus = 'healthy' | 'degraded' | 'offline' | 'quota_exhausted'

export interface ProviderQuota {
  dailyLimit: number
  used: number
  remaining: number
  pct: number
  resetAt: string | null
}

export interface ProviderHealth {
  name: ProviderName
  enabled: boolean
  priority: number
  status: ProviderStatus
  healthScore: number
  latencyMs: number
  errorRate: number
  requestsToday: number
  lastSuccess: string | null
  lastError: string | null
  quota: ProviderQuota
}

export interface FailoverEvent {
  id: string
  fromProvider: ProviderName
  toProvider: ProviderName | 'auto'
  reason: string
  occurredAt: string
  durationMs: number | null
  resolved: boolean
}

export type ExperimentStatus = 'draft' | 'active' | 'paused' | 'concluded'

export interface Experiment {
  id:             number
  name:           string
  description:    string
  group_name:     string
  overrides:      Record<string, unknown>
  status:         ExperimentStatus
  rollout_pct:    number
  context_filter: Record<string, string | number | boolean>
  dry_run:        boolean
  expires_at:     string | null
  created_by:     string
  created_at:     string
  updated_at:     string
}

export interface ExperimentPreview {
  experiment_id:   number
  name:            string
  group_name:      string
  status:          ExperimentStatus
  would_apply:     boolean
  invalid_keys:    string[]
  diff:            Record<string, { base: unknown; experiment: unknown }>
  base:            Record<string, unknown>
  with_experiment: Record<string, unknown>
}

export interface CreateExperimentBody {
  name:           string
  group_name:     string
  overrides:      Record<string, unknown>
  description?:   string
  rollout_pct?:   number
  context_filter?: Record<string, string | number | boolean>
  dry_run?:       boolean
  expires_at?:    string | null
  created_by?:    string
}

export interface PatchExperimentBody {
  name?:           string
  description?:    string
  overrides?:      Record<string, unknown>
  rollout_pct?:    number
  context_filter?: Record<string, string | number | boolean>
  dry_run?:        boolean
  expires_at?:     string | null
}

// ── Monitoring types ──────────────────────────────────────────────────────────

export type MonitorLevel = 'healthy' | 'warning' | 'critical'

export interface MonitorMetric {
  value: number
  unit:  string
  level: MonitorLevel
}

export interface MonitorAnomaly {
  type:     string
  severity: MonitorLevel
  message:  string
}

export interface MonitorSnapshot {
  date:          string
  overall_level: MonitorLevel
  generated_at:  string
  metrics: {
    signals_per_day:          MonitorMetric
    win_rate_pct:             MonitorMetric
    sl_rate_pct:              MonitorMetric
    scans_today:              MonitorMetric
    coins_scanned_per_run:    MonitorMetric
    scan_duration_s:          MonitorMetric
    claude_calls_per_day:     MonitorMetric
    heuristic_calls_per_day:  MonitorMetric
    claude_fallback_pct:      MonitorMetric
    estimated_cost_usd:       MonitorMetric
    cmc_credits_per_day:      MonitorMetric
    telegram_sends_per_day:   MonitorMetric
    binance_errors_per_day:   MonitorMetric
    resolved_7d:              MonitorMetric
  }
  anomalies:  MonitorAnomaly[]
  thresholds: Record<string, Record<string, number | boolean>>
}

// ── Typed API surface ─────────────────────────────────────────────────────────

export const adminApi = {
  burnin: {
    status:    ()                            => get<BurninStatus>('/burnin/status'),
    readiness: ()                            => get<ReadinessResult>('/burnin/readiness'),
    anomalies: (limit = 48)                  => get<AnomalyRecord[]>('/burnin/anomalies', { limit }),
    snapshots: (type = 'daily_edge', lim = 30) =>
      get<Record<string, unknown>[]>('/burnin/snapshots', { snapshot_type: type, limit: lim }),
  },
  analytics: {
    summary:   (window_hours = 168) => get<Record<string, unknown>>('/analytics/summary', { window_hours }),
    ai:        (window_hours = 24)  => get<AiSummaryResponse>('/analytics/ai', { window_hours }),
    scans:     (window_hours = 24)  => get<ScanSummaryResponse>('/analytics/scans', { window_hours }),
    monitor:   ()                   => get<MonitorSnapshot>('/analytics/monitor'),
    edgeReport:    (hours = 720)  => get<EdgeReport>('/analytics/edge/report', { window_hours: hours }),
    calibration:   (hours = 720)  => get<Record<string, unknown>>('/analytics/edge/calibration', { window_hours: hours }),
    claude:        (hours = 720)  => get<Record<string, unknown>>('/analytics/edge/claude', { window_hours: hours }),
    modes:         (hours = 720)  => get<Record<string, unknown>>('/analytics/edge/modes', { window_hours: hours }),
    regime:        (hours = 720)  => get<Record<string, unknown>>('/analytics/edge/regime', { window_hours: hours }),
    coins:         (hours = 720)  => get<Record<string, unknown>>('/analytics/edge/coins', { window_hours: hours }),
    intelligence:  (hours = 720)  => get<IntelligenceSummary>('/analytics/intelligence', { window_hours: hours }),
  },
  health: {
    liveness: () => get<{ status: string }>('/health'),
    ready:    () => get<HealthReady>('/health/ready'),
  },
  scanner: {
    trigger: (mode: string) => post<{ task_id: string; message: string }>('/scanner/trigger', { mode }),
    status:  ()             => get<{ scan_id: string | null; mode: string | null; status: string; progress: Record<string, unknown> }>('/scanner/status'),
  },
  scheduler: {
    status:  () => get<{ success: boolean; data: { enabled: boolean; scanning: boolean; running_modes: string[]; last_scan_at: number | null } }>('/scheduler/status'),
    start:   () => post<{ success: boolean; message: string }>('/scheduler/start', {}),
    stop:    () => post<{ success: boolean; message: string }>('/scheduler/stop',  {}),
  },
  settings: {
    /** All groups with meta + field definitions */
    all: () =>
      get<SettingsData>('/settings'),

    /** Single group */
    group: (name: string) =>
      get<SettingsGroupResponse>(`/settings/${name}`),

    /** Lightweight ETag — version integer only */
    version: (name: string) =>
      get<{ group_name: string; data_version: number }>(`/settings/${name}/version`),

    /**
     * Merge specific fields into a group, validate, persist.
     * Preferred for single-field UI saves.
     */
    patch: (group: string, fields: Record<string, unknown>, updated_by = 'admin') =>
      patch<PatchResult>(`/settings/${group}`, { fields, updated_by }),

    /** Replace the full group payload */
    replace: (group: string, data: Record<string, unknown>, updated_by = 'admin') =>
      put<PatchResult>(`/settings/${group}`, { data, updated_by }),

    /** Reset one group to model defaults */
    reset: (group: string, updated_by = 'admin') =>
      post<PatchResult>(`/settings/${group}/reset`, { updated_by }),

    /** Reset every group to defaults */
    resetAll: (updated_by = 'admin') =>
      post<{ success: boolean; results: Record<string, PatchResult> }>(
        '/settings/reset/all', { updated_by }
      ),

    /** Audit log — optionally filtered by group */
    audit: (limit = 50, group_name?: string) =>
      get<{ entries: AuditEntry[] }>(
        '/settings/audit',
        group_name ? { limit, group_name } : { limit },
      ),
  },
  providers: {
    /** All providers with live health + metrics */
    list: () =>
      get<{ success: boolean; providers: ProviderHealth[] }>('/providers'),

    failoverHistory: (limit = 20) =>
      get<{ success: boolean; events: FailoverEvent[] }>('/providers/failover-history', { limit }),

    config: () =>
      get<{ success: boolean; config: Record<string, unknown> }>('/providers/config'),

    enable: (name: ProviderName) =>
      post<{ success: boolean; provider: ProviderName; enabled: boolean }>(`/providers/${name}/enable`),

    disable: (name: ProviderName) =>
      post<{ success: boolean; provider: ProviderName; enabled: boolean }>(`/providers/${name}/disable`),

    setPriority: (name: ProviderName, priority: number) =>
      post<{ success: boolean; provider: ProviderName; priority: number }>(
        `/providers/${name}/priority`, { priority },
      ),

    resetMetrics: (name: ProviderName) =>
      post<{ success: boolean; provider: ProviderName }>(`/providers/${name}/reset-metrics`),

    forceFailover: (from_provider: ProviderName) =>
      post<{ success: boolean; disabled: ProviderName; event: FailoverEvent }>(
        '/providers/force-failover', { from_provider },
      ),

    clearCache: () =>
      post<{ success: boolean; keysDeleted: number }>('/providers/clear-cache'),
  },
  experiments: {
    /** List experiments — filterable by group_name and/or status */
    list: (group_name?: string, status?: ExperimentStatus, limit = 100) =>
      get<{ experiments: Experiment[]; total: number }>(
        '/experiments',
        {
          ...(group_name ? { group_name } : {}),
          ...(status     ? { status }     : {}),
          limit,
        },
      ),

    /** Single experiment */
    get: (id: number) =>
      get<Experiment>(`/experiments/${id}`),

    /** Create in draft state */
    create: (body: CreateExperimentBody) =>
      post<Experiment>('/experiments', body),

    /** Update mutable fields (only provided fields change) */
    update: (id: number, body: PatchExperimentBody) =>
      patch<Experiment>(`/experiments/${id}`, body),

    /** Delete — only draft or concluded experiments */
    delete: (id: number) =>
      del<{ deleted: boolean; id: number }>(`/experiments/${id}`),

    activate: (id: number) =>
      post<Experiment>(`/experiments/${id}/activate`),

    pause: (id: number) =>
      post<Experiment>(`/experiments/${id}/pause`),

    conclude: (id: number) =>
      post<Experiment>(`/experiments/${id}/conclude`),

    /**
     * Show what the experiment would change vs current base settings.
     * Pass context as JSON-encoded string, e.g. '{"trading_context":"paper_trading"}'.
     */
    preview: (id: number, context?: Record<string, string | number | boolean>) =>
      get<ExperimentPreview>(
        `/experiments/${id}/preview`,
        context ? { context: JSON.stringify(context) } : undefined,
      ),
  },
}
