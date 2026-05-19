/**
 * Typed client for the Python FastAPI backend.
 * All calls go through /api/admin/* (Next.js proxy) so BACKEND_URL stays server-side.
 */

const BASE = '/api/admin'

// ── Generic fetchers ──────────────────────────────────────────────────────────

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
  total_calls: number
  success_rate: number
  error_rate: number
  fallback_rate: number
  avg_latency_ms: number | null
  verdicts?: Record<string, number>
  verdict_distribution?: Record<string, number>
  window_hours: number
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

export interface PortfolioMetrics {
  balance: number
  initial_balance?: number
  total_return_pct?: number
  total_trades: number
  open_trades: number
  win_rate: number | null
  total_pnl: number
  unrealized_pnl?: number
  max_drawdown_pct?: number | null
  equity_curve?: number[]
}

export interface HealthReady {
  status: 'ready' | 'degraded'
  checks: Record<string, string>
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
    edgeReport: (hours = 720)       => get<EdgeReport>('/analytics/edge/report', { window_hours: hours }),
    calibration: (hours = 720)      => get<Record<string, unknown>>('/analytics/edge/calibration', { window_hours: hours }),
    claude:    (hours = 720)        => get<Record<string, unknown>>('/analytics/edge/claude', { window_hours: hours }),
    modes:     (hours = 720)        => get<Record<string, unknown>>('/analytics/edge/modes', { window_hours: hours }),
    regime:    (hours = 720)        => get<Record<string, unknown>>('/analytics/edge/regime', { window_hours: hours }),
    coins:     (hours = 720)        => get<Record<string, unknown>>('/analytics/edge/coins', { window_hours: hours }),
    portfolio: ()                   => get<PortfolioMetrics>('/analytics/paper-trading/portfolio'),
    trades:    (limit = 50, status = 'all') =>
      get<{ trades: Record<string, unknown>[]; total: number }>(
        '/analytics/paper-trading/trades', { limit, status },
      ),
  },
  health: {
    liveness: () => get<{ status: string }>('/health'),
    ready:    () => get<HealthReady>('/health/ready'),
  },
  scanner: {
    trigger: (mode: string) => post<{ task_id: string; message: string }>('/scanner/trigger', { mode }),
  },
}
