'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  AlertTriangle, CheckCircle2, RefreshCw, Zap,
  Trash2, RotateCcw, Clock, WifiOff, ChevronRight,
  Key, Eye, EyeOff, ChevronDown, Shield,
} from 'lucide-react'
import { adminApi, ProviderHealth, ProviderName, FailoverEvent } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'

// ── Institutional stack definition ────────────────────────────────────────────

const STACK_CORE:     ProviderName[] = ['coinmarketcap', 'binance', 'coingecko', 'dexscreener']
const STACK_LEGACY:   ProviderName[] = ['coinpaprika', 'geckoterm']
const STACK_PRIORITY: Partial<Record<ProviderName, number>> = {
  coinmarketcap: 1, binance: 2, coingecko: 3, dexscreener: 4,
}

// ── Provider metadata ─────────────────────────────────────────────────────────

type ProviderTier = 'intelligence' | 'execution' | 'backup' | 'lowcap' | 'legacy'

interface ProviderMeta {
  label:       string
  role:        string
  roleShort:   string
  color:       string
  description: string
  coverage:    string[]
  tier:        ProviderTier
  freeLabel:   string | null
  needsKey:    boolean
  quotaNote:   string
  stackRole:   string
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  coinmarketcap: {
    label: 'CoinMarketCap', role: 'Market Intelligence Engine', roleShort: 'INTELLIGENCE',
    color: '#3861fb',
    description: 'Rankings · sector analysis · dominance · narrative rotation · ecosystem metadata',
    coverage: ['Rankings', 'Sectors', 'Dominance', 'Metadata', 'Breadth'],
    tier: 'intelligence', freeLabel: null, needsKey: true,
    quotaNote: 'Startup Plan · 10k req/day',
    stackRole: 'Primary Intelligence',
  },
  binance: {
    label: 'Binance', role: 'Tactical Execution Engine', roleShort: 'TACTICAL',
    color: '#f0b90b',
    description: 'OHLCV klines · futures funding rates · open interest · long/short ratios · momentum',
    coverage: ['OHLCV Candles', 'Futures Data', 'Funding Rates', 'Open Interest'],
    tier: 'execution', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Rate-limited by IP',
    stackRole: 'Tactical Execution',
  },
  coingecko: {
    label: 'CoinGecko', role: 'Backup Intelligence Provider', roleShort: 'BACKUP',
    color: '#2d9e49',
    description: 'Failover · redundancy · backup metadata · quota overflow protection',
    coverage: ['Top 100 Fallback', 'Backup Metadata', 'Quota Overflow'],
    tier: 'backup', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Unlimited on free tier',
    stackRole: 'Backup Redundancy',
  },
  dexscreener: {
    label: 'DexScreener', role: 'Low-Cap Intelligence', roleShort: 'LOW-CAP',
    color: '#7c3aed',
    description: 'Meme rotations · low-cap momentum · DEX liquidity · speculative opportunity',
    coverage: ['DEX Tokens', 'Meme Rotation', 'Low-Cap Momentum'],
    tier: 'lowcap', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Unlimited',
    stackRole: 'Optional Low-Cap',
  },
  coinpaprika: {
    label: 'CoinPaprika', role: 'Legacy Provider', roleShort: 'LEGACY',
    color: '#4b5563',
    description: 'Historical data provider — superseded by the institutional stack',
    coverage: ['Historical Data'],
    tier: 'legacy', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Rate-limited',
    stackRole: 'Legacy',
  },
  geckoterm: {
    label: 'GeckoTerminal', role: 'Legacy Provider', roleShort: 'LEGACY',
    color: '#4b5563',
    description: 'DEX pool analytics — superseded by DexScreener in the institutional stack',
    coverage: ['DEX Pools'],
    tier: 'legacy', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Unlimited',
    stackRole: 'Legacy',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)     return 'just now'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

function statusDot(status: string): string {
  switch (status) {
    case 'healthy':         return 'bg-bull-default'
    case 'degraded':        return 'bg-signal-high'
    case 'quota_exhausted': return 'bg-signal-medium'
    default:                return 'bg-terminal-muted/40'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'healthy':         return 'Healthy'
    case 'degraded':        return 'Degraded'
    case 'offline':         return 'Offline'
    case 'quota_exhausted': return 'Quota Full'
    default:                return 'Unknown'
  }
}

function latencyColor(ms: number): string {
  if (ms > 5000) return 'text-bear-default'
  if (ms > 2000) return 'text-signal-high'
  return 'text-bull-default'
}

function errColor(rate: number): string {
  if (rate > 0.15) return 'text-bear-default'
  if (rate > 0.05) return 'text-signal-high'
  return 'text-bull-default'
}

function rateEst(requestsToday: number) {
  const hrs   = Math.max(new Date().getHours() + 1, 1)
  const perHr = Math.round(requestsToday / hrs)
  const perMo = perHr * 24 * 30
  return { perHr, perMo }
}

function exhaustionEst(quota: { dailyLimit: number; remaining: number }, perHr: number): string | null {
  if (quota.dailyLimit === 0 || perHr === 0) return null
  const h = quota.remaining / perHr
  if (h < 1)  return '< 1 hr'
  if (h < 24) return `~${Math.round(h)}h`
  return `~${Math.round(h / 24)}d`
}

function detectPlan(dailyLimit: number): string {
  if (dailyLimit === 0)         return 'Unlimited'
  if (dailyLimit <= 333)        return 'Free Plan'
  if (dailyLimit <= 1_000)      return 'Hobby Plan'
  if (dailyLimit <= 10_000)     return 'Startup Plan'
  if (dailyLimit <= 33_333)     return 'Standard Plan'
  if (dailyLimit <= 100_000)    return 'Professional Plan'
  return 'Enterprise Plan'
}

function scansRemainingEst(quota: { dailyLimit: number; remaining: number }): number | null {
  if (quota.dailyLimit === 0) return null
  return Math.floor(quota.remaining / 2)   // ~2 CMC calls per full scan
}

function trustScore(p: ProviderHealth): { score: number; grade: 'A' | 'B' | 'C' | 'D' } {
  if (!p.enabled) return { score: 0, grade: 'D' }
  const recentOk = p.lastSuccess
    ? Date.now() - new Date(p.lastSuccess).getTime() < 10 * 60_000
    : false
  const score = Math.min(100, Math.round(
    p.healthScore * 0.5 +
    (1 - Math.min(p.errorRate, 1)) * 40 +
    (recentOk ? 10 : 5),
  ))
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D'
  return { score, grade }
}

function isStackActive(providers: ProviderHealth[]): boolean {
  const m = Object.fromEntries(providers.map(p => [p.name, p]))
  return !!(
    m.coinmarketcap?.enabled && m.coinmarketcap?.priority === 1 &&
    m.binance?.enabled       && m.binance?.priority       === 2 &&
    m.coingecko?.enabled     && m.coingecko?.priority     === 3 &&
    m.dexscreener?.enabled   && m.dexscreener?.priority   === 4 &&
    !m.coinpaprika?.enabled  &&
    !m.geckoterm?.enabled
  )
}

// ── Provider Status Board ─────────────────────────────────────────────────────

function ProviderStatusBoard({ providers }: { providers: ProviderHealth[] }) {
  const m = useMemo(() => Object.fromEntries(providers.map(p => [p.name, p])), [providers])

  const slots: { key: string; label: string; meta: ProviderMeta }[] = [
    { key: 'coinmarketcap', label: 'CoinMarketCap', meta: PROVIDER_META.coinmarketcap },
    { key: 'binance',       label: 'Binance',       meta: PROVIDER_META.binance },
    { key: 'coingecko',     label: 'CoinGecko',     meta: PROVIDER_META.coingecko },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {slots.map(({ key, meta }) => {
        const p = m[key]
        const quotaPct = p?.quota?.dailyLimit > 0 ? p.quota.pct : null

        return (
          <div
            key={key}
            className="glass-card rounded-xl border border-terminal-border/50 px-4 py-3 flex flex-col gap-2"
            style={{ minHeight: '120px' }}
          >
            {/* Top row: dot + name + status badge */}
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${p ? statusDot(p.status) : 'bg-terminal-muted/40'}`}
              />
              <span className="text-xs font-semibold text-terminal-text truncate flex-1">{meta.label}</span>
              {p && (
                <span
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded border leading-tight shrink-0"
                  style={{
                    color:           p.enabled ? meta.color : '#6b7280',
                    borderColor:     p.enabled ? meta.color + '55' : 'rgba(255,255,255,0.08)',
                    backgroundColor: p.enabled ? meta.color + '15' : 'transparent',
                  }}
                >
                  {statusLabel(p.status)}
                </span>
              )}
            </div>

            {/* Middle row: latency + health score */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className={`text-sm font-mono font-bold leading-none ${p && p.latencyMs > 0 ? latencyColor(p.latencyMs) : 'text-terminal-muted/40'}`}>
                  {p && p.latencyMs > 0 ? `${p.latencyMs}ms` : '—'}
                </span>
                <span className="text-[8px] text-terminal-muted/40 mt-0.5">Latency</span>
              </div>
              <div className="flex flex-col">
                <span
                  className="text-sm font-mono font-bold leading-none"
                  style={{
                    color: p
                      ? (p.healthScore >= 80 ? '#00d084' : p.healthScore >= 60 ? '#f59e0b' : '#ff3b5c')
                      : '#4b5563',
                  }}
                >
                  {p ? p.healthScore : '—'}
                </span>
                <span className="text-[8px] text-terminal-muted/40 mt-0.5">Health</span>
              </div>
            </div>

            {/* Quota bar — CMC only */}
            {quotaPct !== null && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[8px] font-mono text-terminal-muted/40">
                  <span>Quota</span>
                  <span>{quotaPct.toFixed(0)}% used</span>
                </div>
                <div className="h-1 rounded-full bg-terminal-bright/25 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width:           `${Math.min(quotaPct, 100)}%`,
                      backgroundColor: quotaPct >= 90 ? '#ff3b5c' : quotaPct >= 75 ? '#f97316'
                                     : quotaPct >= 50 ? '#f59e0b' : '#00d084',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Operations Summary ────────────────────────────────────────────────────────

function OperationsSummary({
  providers,
  events,
}: {
  providers: ProviderHealth[]
  events:    FailoverEvent[]
}) {
  const m       = useMemo(() => Object.fromEntries(providers.map(p => [p.name, p])), [providers])
  const cmc     = m.coinmarketcap
  const binance = m.binance
  const gecko   = m.coingecko

  // Primary provider: enabled provider with lowest priority
  const enabledSorted = [...providers].filter(p => p.enabled).sort((a, b) => a.priority - b.priority)
  const primary   = enabledSorted[0]
  const primaryMeta = primary ? (PROVIDER_META[primary.name] ?? null) : null

  // Execution provider (binance)
  const execLabel = binance?.enabled
    ? `Binance · ${statusLabel(binance.status)}`
    : 'Binance (disabled)'

  // Fallback provider (coingecko)
  const fallbackLabel = gecko?.enabled
    ? `CoinGecko · ${statusLabel(gecko.status)}`
    : 'CoinGecko (disabled)'

  // Quota remaining
  const quotaRemaining = cmc?.quota?.dailyLimit > 0
    ? `${cmc.quota.remaining.toLocaleString()} / ${cmc.quota.dailyLimit.toLocaleString()}`
    : cmc ? '∞' : '—'

  // Failovers today
  const now = Date.now()
  const failoversToday = events.filter(e => {
    const ts = new Date(e.occurredAt).getTime()
    return (now - ts) < 86_400_000
  }).length

  const cells: { label: string; value: string; color: string }[] = [
    {
      label: 'Primary Provider',
      value: primaryMeta ? primaryMeta.label : '—',
      color: primary && primary.status === 'healthy' ? '#00d084' : '#f59e0b',
    },
    {
      label: 'Execution Provider',
      value: binance?.enabled ? 'Binance' : '—',
      color: binance?.enabled && binance.status === 'healthy' ? '#f0b90b' : '#6b7280',
    },
    {
      label: 'Fallback Provider',
      value: gecko?.enabled ? 'CoinGecko' : '—',
      color: gecko?.enabled && gecko.status === 'healthy' ? '#2d9e49' : '#6b7280',
    },
    {
      label: 'Quota Remaining',
      value: quotaRemaining,
      color: cmc?.quota?.dailyLimit > 0 && cmc.quota.pct >= 90
        ? '#ff3b5c'
        : cmc?.quota?.dailyLimit > 0 && cmc.quota.pct >= 70
        ? '#f59e0b'
        : '#00d084',
    },
    {
      label: 'Failovers Today',
      value: failoversToday === 0 ? 'Stable' : String(failoversToday),
      color: failoversToday === 0 ? '#00d084' : failoversToday <= 2 ? '#f59e0b' : '#ff3b5c',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
      {cells.map(c => (
        <div
          key={c.label}
          className="glass-card rounded-xl border border-terminal-border/50 px-3.5 py-3"
        >
          <p className="text-[8px] text-terminal-muted/45 uppercase tracking-widest mb-1.5 leading-tight font-mono">
            {c.label}
          </p>
          <p
            className="text-sm font-mono font-bold leading-none truncate"
            style={{ color: c.color }}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Quota Burn Forecast ───────────────────────────────────────────────────────

function QuotaBurnForecast({ providers }: { providers: ProviderHealth[] }) {
  const cmc = useMemo(
    () => providers.find(p => p.name === 'coinmarketcap'),
    [providers],
  )

  if (!cmc || !cmc.quota || cmc.quota.dailyLimit === 0) return null

  const { perHr } = rateEst(cmc.requestsToday)
  const hoursLeft  = perHr > 0 ? cmc.quota.remaining / perHr : null
  const pct        = cmc.quota.pct

  const forecastColor = pct >= 85 ? '#ff3b5c' : pct >= 60 ? '#f59e0b' : '#00d084'
  const forecastLabel = pct >= 85 ? 'High' : pct >= 60 ? 'Moderate' : 'Safe'

  let daysLabel = 'Unknown'
  if (hoursLeft !== null) {
    if (hoursLeft < 1)        daysLabel = '< 1 hr remaining'
    else if (hoursLeft < 24)  daysLabel = `~${Math.round(hoursLeft)}h remaining`
    else                      daysLabel = `~${(hoursLeft / 24).toFixed(1)}d remaining`
  }

  const stats: { label: string; value: string }[] = [
    { label: 'Remaining Calls', value: cmc.quota.remaining.toLocaleString() },
    { label: 'Daily Limit',     value: cmc.quota.dailyLimit.toLocaleString() },
    { label: 'Current Rate',    value: perHr > 0 ? `${perHr}/hr` : '—' },
  ]

  return (
    <div className="glass-card rounded-xl border border-terminal-border/50 px-4 py-3 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">
            Quota Burn Forecast
          </span>
          <span
            className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border leading-tight"
            style={{ color: forecastColor, borderColor: forecastColor + '55', backgroundColor: forecastColor + '15' }}
          >
            {forecastLabel}
          </span>
        </div>
        <span className="text-[10px] font-mono" style={{ color: forecastColor }}>
          {daysLabel}
        </span>
      </div>

      {/* Burn bar */}
      <div className="space-y-1">
        <div className="h-2 rounded-full bg-terminal-bright/25 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width:           `${Math.min(pct, 100)}%`,
              backgroundColor: forecastColor,
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[8px] font-mono text-terminal-muted/40">
          <span>0%</span>
          <span>{pct.toFixed(1)}% consumed</span>
          <span>100%</span>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg bg-terminal-bright/10 px-2.5 py-2 text-center">
            <p className="text-xs font-mono font-bold text-terminal-text leading-none">{s.value}</p>
            <p className="text-[8px] text-terminal-muted/40 mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Compact Provider Card ─────────────────────────────────────────────────────

function CompactProviderCard({
  provider,
  allProviders,
  onToggle,
  onSetPrimary,
  onForceFailover,
  onResetMetrics,
  loading,
}: {
  provider:        ProviderHealth
  allProviders:    ProviderHealth[]
  onToggle:        (name: ProviderName, enabled: boolean) => void
  onSetPrimary:    (name: ProviderName) => void
  onForceFailover: (name: ProviderName) => void
  onResetMetrics:  (name: ProviderName) => void
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const meta = PROVIDER_META[provider.name] ?? {
    label: provider.name, role: 'Data Provider', roleShort: 'PROVIDER',
    color: '#6b7280', description: '', coverage: [], tier: 'legacy' as ProviderTier,
    freeLabel: null, needsKey: false, quotaNote: '', stackRole: '',
  }

  const quotaPct    = provider.quota.dailyLimit > 0 ? provider.quota.pct : null
  const activeColor = provider.enabled ? meta.color : '#374151'

  return (
    <div
      className="glass-card rounded-xl border overflow-hidden transition-all"
      style={{
        borderColor: provider.enabled
          ? (provider.status === 'healthy' ? meta.color + '35' : meta.color + '20')
          : 'rgba(255,255,255,0.07)',
      }}
    >
      {/* Collapsed row (~56px tall) */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(provider.status)}`} />

        {/* Name */}
        <span className="text-sm font-semibold text-terminal-text truncate flex-1 min-w-0">
          {meta.label}
        </span>

        {/* Role badge */}
        <span
          className="text-[8px] font-mono px-1.5 py-0.5 rounded-sm border leading-tight shrink-0"
          style={{ color: activeColor, borderColor: activeColor + '55', backgroundColor: activeColor + '15' }}
        >
          {meta.roleShort}
        </span>

        {/* Latency — hidden on mobile */}
        <span
          className={`hidden sm:block text-xs font-mono w-14 text-right shrink-0 ${
            provider.latencyMs > 0 ? latencyColor(provider.latencyMs) : 'text-terminal-muted/30'
          }`}
        >
          {provider.latencyMs > 0 ? `${provider.latencyMs}ms` : '—'}
        </span>

        {/* Quota bar — hidden on mobile, CMC only */}
        {quotaPct !== null && (
          <div className="hidden sm:flex items-center gap-1.5 w-20 shrink-0">
            <div className="flex-1 h-1 rounded-full bg-terminal-bright/25 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width:           `${Math.min(quotaPct, 100)}%`,
                  backgroundColor: quotaPct >= 90 ? '#ff3b5c' : quotaPct >= 75 ? '#f97316'
                                 : quotaPct >= 50 ? '#f59e0b' : '#00d084',
                }}
              />
            </div>
            <span className="text-[8px] font-mono text-terminal-muted/40 w-7 text-right shrink-0">
              {quotaPct.toFixed(0)}%
            </span>
          </div>
        )}

        {/* Toggle */}
        <button
          onClick={() => onToggle(provider.name, !provider.enabled)}
          disabled={loading}
          title={provider.enabled ? 'Disable provider' : 'Enable provider'}
          className="shrink-0 disabled:opacity-50"
        >
          <div className={`relative w-8 h-4 rounded-full transition-colors ${provider.enabled ? 'bg-bull-default/70' : 'bg-terminal-bright/60'}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${provider.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </div>
        </button>

        {/* Details button */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-terminal-border/40 text-terminal-muted/50 hover:text-terminal-text hover:border-terminal-border font-mono transition-colors shrink-0"
        >
          Details
          <ChevronDown size={10} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Expanded full card */}
      {expanded && (
        <div className="border-t border-terminal-border/30">
          <ProviderCard
            provider={provider}
            allProviders={allProviders}
            onToggle={onToggle}
            onSetPrimary={onSetPrimary}
            onForceFailover={onForceFailover}
            onResetMetrics={onResetMetrics}
            loading={loading}
          />
        </div>
      )}
    </div>
  )
}

// ── Institutional Stack Card ──────────────────────────────────────────────────

function InstitutionalStackCard({
  providers,
  onActivate,
  loading,
}: {
  providers: ProviderHealth[]
  onActivate: () => void
  loading: boolean
}) {
  const m       = useMemo(() => Object.fromEntries(providers.map(p => [p.name, p])), [providers])
  const active  = isStackActive(providers)

  const stackItems = [
    { name: 'coinmarketcap' as ProviderName, role: 'Market Intelligence', emoji: '◈' },
    { name: 'binance'       as ProviderName, role: 'Tactical Execution',  emoji: '⚡' },
    { name: 'coingecko'     as ProviderName, role: 'Backup Redundancy',   emoji: '◇' },
    { name: 'dexscreener'   as ProviderName, role: 'Low-Cap Intelligence',emoji: '◆' },
  ]

  return (
    <div
      className={`glass-card rounded-xl border p-4 transition-all ${
        active
          ? 'border-bull-default/25 bg-bull-default/5'
          : 'border-terminal-border/50'
      }`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-terminal-text">Recommended Institutional Stack</span>
            {active && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-bull-default/35 text-bull-default bg-bull-default/10">
                ACTIVE
              </span>
            )}
          </div>
          <p className="text-[10px] text-terminal-muted/50 mb-3">
            Optimized for signal reliability, quota efficiency, and tactical intelligence quality.
          </p>

          {/* Stack chain */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {stackItems.map((item, i) => {
              const meta     = PROVIDER_META[item.name]
              const provider = m[item.name]
              const isOn     = provider?.enabled && provider?.priority === STACK_PRIORITY[item.name]
              return (
                <div key={item.name} className="flex items-center gap-1.5">
                  <div
                    className="flex flex-col items-start px-2.5 py-1.5 rounded-lg border transition-all"
                    style={{
                      borderColor:     isOn ? meta.color + '50' : 'rgba(255,255,255,0.08)',
                      backgroundColor: isOn ? meta.color + '10' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[10px]" style={{ color: isOn ? meta.color : '#4b5563' }}>
                        {item.emoji}
                      </span>
                      <span className="text-[10px] font-semibold" style={{ color: isOn ? meta.color : '#6b7280' }}>
                        {meta.label}
                      </span>
                      {provider && (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(provider.status)}`} />
                      )}
                    </div>
                    <span className="text-[8px] font-mono" style={{ color: isOn ? meta.color + 'aa' : '#374151' }}>
                      {item.role}
                    </span>
                  </div>
                  {i < stackItems.length - 1 && (
                    <ChevronRight size={11} className="text-terminal-muted/20 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          {active ? (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-bull-default/25 bg-bull-default/8 text-bull-default text-xs font-mono">
              <CheckCircle2 size={12} />
              Stack Active
            </div>
          ) : (
            <button
              onClick={onActivate}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-signal-medium/40 bg-signal-medium/8 text-signal-medium text-xs font-semibold hover:bg-signal-medium/15 hover:border-signal-medium/60 transition-all disabled:opacity-40 font-mono"
            >
              <Zap size={12} />
              Activate Institutional Stack
            </button>
          )}
          <p className="text-[8px] text-terminal-muted/30 font-mono text-right">
            Sets CMC P1 · Binance P2 · CoinGecko P3 · DexScreener P4
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  allProviders,
  onToggle,
  onSetPrimary,
  onForceFailover,
  onResetMetrics,
  loading,
}: {
  provider:       ProviderHealth
  allProviders:   ProviderHealth[]
  onToggle:       (name: ProviderName, enabled: boolean) => void
  onSetPrimary:   (name: ProviderName) => void
  onForceFailover:(name: ProviderName) => void
  onResetMetrics: (name: ProviderName) => void
  loading: boolean
}) {
  const [showMore,     setShowMore]     = useState(false)
  const [showKeyPanel, setShowKeyPanel] = useState(false)
  const [keyInput,     setKeyInput]     = useState('')
  const [showKey,      setShowKey]      = useState(false)
  const [testingKey,   setTestingKey]   = useState(false)
  const [keyStatus,    setKeyStatus]    = useState<'idle' | 'ok' | 'fail'>('idle')

  const meta = PROVIDER_META[provider.name] ?? {
    label: provider.name, role: 'Data Provider', roleShort: 'PROVIDER',
    color: '#6b7280', description: '', coverage: [], tier: 'legacy' as ProviderTier,
    freeLabel: null, needsKey: false, quotaNote: '', stackRole: '',
  }

  const { perHr, perMo }  = rateEst(provider.requestsToday)
  const quotaPct           = provider.quota.dailyLimit > 0 ? provider.quota.pct : 0
  const exhaustion         = exhaustionEst(provider.quota, perHr)
  const { score: ts, grade } = trustScore(provider)
  const minPriority        = Math.min(...allProviders.filter(p => p.enabled).map(p => p.priority))
  const canSetPrimary      = provider.priority !== minPriority && provider.enabled
  const activeColor        = provider.enabled ? meta.color : '#374151'
  const plan               = meta.needsKey && provider.quota.dailyLimit > 0
    ? detectPlan(provider.quota.dailyLimit) : null
  const scansLeft          = provider.quota.dailyLimit > 0
    ? scansRemainingEst(provider.quota) : null

  const gradeColor = grade === 'A' ? '#00d084' : grade === 'B' ? '#3b82f6' : grade === 'C' ? '#f59e0b' : '#ff3b5c'

  const handleTestKey = async () => {
    setTestingKey(true)
    setKeyStatus('idle')
    try {
      const res = await adminApi.providers.list()
      const p   = res.providers.find(x => x.name === provider.name)
      setKeyStatus(p?.status === 'healthy' ? 'ok' : 'fail')
    } catch {
      setKeyStatus('fail')
    } finally {
      setTestingKey(false)
    }
  }

  return (
    <div
      className="relative glass-card rounded-xl overflow-hidden border transition-all"
      style={{
        borderColor: provider.enabled
          ? (provider.status === 'healthy' ? meta.color + '35' : meta.color + '20')
          : 'rgba(255,255,255,0.07)',
      }}
    >
      {/* Left accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl"
        style={{ backgroundColor: provider.enabled && provider.status === 'healthy' ? meta.color : '#1f2937' }}
      />

      <div className="pl-4 pr-4 pt-4 pb-4 space-y-3.5">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className={`mt-[3px] w-2 h-2 rounded-full shrink-0 ${statusDot(provider.status)}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-terminal-text">{meta.label}</span>
                <span
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded-sm border leading-tight"
                  style={{ color: activeColor, borderColor: activeColor + '55', backgroundColor: activeColor + '15' }}
                >
                  {meta.roleShort}
                </span>
                {/* Trust grade */}
                {provider.enabled && (
                  <span
                    className="text-[8px] font-mono font-bold px-1 py-0.5 rounded border leading-tight"
                    style={{ color: gradeColor, borderColor: gradeColor + '50', backgroundColor: gradeColor + '12' }}
                    title={`Reliability score: ${ts}/100`}
                  >
                    {grade}
                  </span>
                )}
                {plan && (
                  <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-signal-medium/10 text-signal-medium/70 border border-signal-medium/20">
                    {plan}
                  </span>
                )}
                {meta.freeLabel && !meta.needsKey && (
                  <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-terminal-bright/30 text-terminal-muted/50 border border-terminal-border/30">
                    {meta.freeLabel}
                  </span>
                )}
                {meta.needsKey && !provider.enabled && (
                  <span className="flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-0.5 rounded border text-signal-high/80 border-signal-high/30 bg-signal-high/5">
                    <Key size={9} />Key Needed
                  </span>
                )}
              </div>
              <p className="text-[10px] text-terminal-muted/50 mt-0.5 leading-snug">{meta.description}</p>
            </div>
          </div>

          {/* Toggle */}
          <button
            onClick={() => onToggle(provider.name, !provider.enabled)}
            disabled={loading}
            title={provider.enabled ? 'Disable provider' : 'Enable provider'}
            className="shrink-0 disabled:opacity-50"
          >
            <div className={`relative w-9 h-5 rounded-full transition-colors ${provider.enabled ? 'bg-bull-default/70' : 'bg-terminal-bright/60'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${provider.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </button>
        </div>

        {/* Health bar + metrics */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-terminal-muted/40 w-11 shrink-0 font-mono">Health</span>
            <div className="flex-1 h-1.5 rounded-full bg-terminal-bright/25 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width:           `${provider.healthScore}%`,
                  backgroundColor: provider.healthScore >= 80 ? '#00d084'
                                 : provider.healthScore >= 60 ? '#f59e0b' : '#ff3b5c',
                }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-terminal-text w-6 text-right">{provider.healthScore}</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg bg-terminal-bright/10 py-1.5 px-1">
              <p className={`text-xs font-mono font-semibold ${latencyColor(provider.latencyMs)}`}>
                {provider.latencyMs > 0 ? `${provider.latencyMs}ms` : '—'}
              </p>
              <p className="text-[8px] text-terminal-muted/40 mt-0.5">Latency</p>
            </div>
            <div className="rounded-lg bg-terminal-bright/10 py-1.5 px-1">
              <p className={`text-xs font-mono font-semibold ${errColor(provider.errorRate)}`}>
                {(provider.errorRate * 100).toFixed(1)}%
              </p>
              <p className="text-[8px] text-terminal-muted/40 mt-0.5">Error Rate</p>
            </div>
            <div className="rounded-lg bg-terminal-bright/10 py-1.5 px-1">
              <p className="text-xs font-mono text-terminal-muted/70">{formatRelative(provider.lastSuccess)}</p>
              <p className="text-[8px] text-terminal-muted/40 mt-0.5">Last OK</p>
            </div>
          </div>
        </div>

        {/* Quota */}
        {provider.quota.dailyLimit > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[9px] font-mono">
              <span className="text-terminal-muted/45">API Quota</span>
              <span className="text-terminal-muted/55">
                {provider.quota.used.toLocaleString()} / {provider.quota.dailyLimit.toLocaleString()} · {quotaPct.toFixed(0)}% used
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-terminal-bright/25 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width:           `${Math.min(quotaPct, 100)}%`,
                  backgroundColor: quotaPct >= 90 ? '#ff3b5c' : quotaPct >= 75 ? '#f97316'
                                 : quotaPct >= 50 ? '#f59e0b' : '#00d084',
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[8px] font-mono text-terminal-muted/40">
              <span>
                {scansLeft != null ? `~${scansLeft.toLocaleString()} scans remaining` : `${provider.quota.remaining.toLocaleString()} calls left`}
              </span>
              {exhaustion && <span>Est. exhaustion {exhaustion}</span>}
            </div>
            {quotaPct >= 75 && (
              <p className="text-[8px] text-signal-high font-mono flex items-center gap-1">
                <AlertTriangle size={8} />
                {quotaPct >= 90 ? 'Critical — quota nearly exhausted' : 'Warning — quota running low'}
              </p>
            )}
          </div>
        )}

        {/* API usage — hidden on mobile to reduce card height */}
        <div className="hidden sm:grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-terminal-border/30 py-2 px-3">
            <p className="text-sm font-mono font-bold text-terminal-text">{provider.requestsToday.toLocaleString()}</p>
            <p className="text-[8px] text-terminal-muted/40 mt-0.5">API Calls Today</p>
          </div>
          <div className="rounded-lg border border-terminal-border/30 py-2 px-3">
            <p className="text-sm font-mono font-bold text-terminal-text">
              {provider.quota.dailyLimit > 0 ? provider.quota.remaining.toLocaleString() : '∞'}
            </p>
            <p className="text-[8px] text-terminal-muted/40 mt-0.5">
              {provider.quota.dailyLimit > 0 ? 'Remaining Today' : 'Unlimited Quota'}
            </p>
          </div>
        </div>

        {provider.requestsToday > 0 && (
          <div className="flex items-center justify-between text-[8px] font-mono text-terminal-muted/35">
            <span>~{perHr}/hr current rate</span>
            <span>~{perMo.toLocaleString()}/mo projected</span>
          </div>
        )}

        {/* Coverage chips — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-1 flex-wrap">
          {meta.coverage.map(c => (
            <span key={c} className="text-[8px] px-1.5 py-0.5 rounded border border-terminal-border/35 text-terminal-muted/45 font-mono">{c}</span>
          ))}
        </div>

        {/* API Key panel */}
        {meta.needsKey && showKeyPanel && (
          <div className="border border-terminal-border/50 rounded-lg p-3 space-y-2 bg-terminal-bright/5">
            <p className="text-[10px] text-terminal-muted/65 leading-relaxed">
              Paste your {meta.label} API key. The key will be stored in the infrastructure settings group and used immediately.
            </p>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={e => { setKeyInput(e.target.value); setKeyStatus('idle') }}
                  placeholder="Paste API key…"
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-2.5 py-1.5 text-xs font-mono text-terminal-text focus:outline-none focus:border-signal-medium/50 pr-7"
                />
                <button
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted/40 hover:text-terminal-muted"
                >
                  {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
              </div>
              <button
                onClick={handleTestKey}
                disabled={!keyInput || testingKey}
                className="text-[10px] px-2.5 py-1.5 rounded border border-terminal-border text-terminal-muted hover:text-terminal-text font-mono transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {testingKey ? '…' : 'Test Connection'}
              </button>
            </div>
            {keyStatus === 'ok'   && <p className="text-[9px] text-bull-default font-mono flex items-center gap-1"><CheckCircle2 size={10} />Connection healthy · {plan ?? 'Plan detected'}</p>}
            {keyStatus === 'fail' && <p className="text-[9px] text-bear-default font-mono">✕ Connection failed — verify key or plan</p>}
            <p className="text-[8px] text-terminal-muted/30 font-mono leading-relaxed">
              Set COINMARKETCAP_API_KEY in .env.local to persist across process restarts.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-0.5 border-t border-terminal-border/25 flex-wrap">
          {canSetPrimary && (
            <button
              onClick={() => onSetPrimary(provider.name)}
              disabled={loading}
              className="text-[10px] px-2.5 py-1.5 rounded border border-terminal-border/50 text-terminal-muted/70 hover:text-terminal-text hover:border-terminal-border font-mono transition-colors disabled:opacity-40"
            >
              Set Primary
            </button>
          )}
          {meta.needsKey && (
            <button
              onClick={() => setShowKeyPanel(v => !v)}
              className={`flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded border font-mono transition-colors ${
                showKeyPanel
                  ? 'border-signal-high/40 text-signal-high bg-signal-high/5'
                  : 'border-terminal-border/50 text-terminal-muted/70 hover:text-terminal-text'
              }`}
            >
              <Key size={9} />{showKeyPanel ? 'Hide' : 'Configure Key'}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowMore(v => !v)}
            className="flex items-center gap-0.5 text-[10px] px-2 py-1.5 rounded border border-terminal-border/30 text-terminal-muted/40 hover:text-terminal-muted font-mono transition-colors"
          >
            More <ChevronDown size={10} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showMore && (
          <div className="space-y-2 pt-0.5">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => onForceFailover(provider.name)}
                disabled={loading || !provider.enabled}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] bg-signal-medium/5 hover:bg-signal-medium/10 text-signal-medium border border-signal-medium/30 rounded-lg font-mono transition-colors disabled:opacity-40"
              >
                <Zap size={10} />Force Failover
              </button>
              <button
                onClick={() => onResetMetrics(provider.name)}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] bg-terminal-bright/15 hover:bg-terminal-bright/30 text-terminal-muted/70 hover:text-terminal-text border border-terminal-border/40 rounded-lg font-mono transition-colors disabled:opacity-40"
              >
                <RotateCcw size={10} />Reset Metrics
              </button>
            </div>
            {provider.lastError && (
              <div className="text-[9px] text-bear-default/80 bg-bear-default/5 border border-bear-default/15 rounded px-2.5 py-2 font-mono break-all leading-relaxed">
                Last error: {provider.lastError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Legacy Providers (collapsed section) ──────────────────────────────────────

function LegacyProvidersSection({
  providers,
  allProviders,
  onToggle,
  onSetPrimary,
  onForceFailover,
  onResetMetrics,
  loading,
}: {
  providers:      ProviderHealth[]
  allProviders:   ProviderHealth[]
  onToggle:       (name: ProviderName, enabled: boolean) => void
  onSetPrimary:   (name: ProviderName) => void
  onForceFailover:(name: ProviderName) => void
  onResetMetrics: (name: ProviderName) => void
  loading: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!providers.length) return null

  const anyEnabled = providers.some(p => p.enabled)

  return (
    <div className="border border-terminal-border/30 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-terminal-bright/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-terminal-muted/35 uppercase tracking-widest font-mono">Legacy Providers</span>
          <span className="text-[9px] text-terminal-muted/30 font-mono">{providers.length} providers · superseded by institutional stack</span>
          {anyEnabled && (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-signal-high/30 text-signal-high/70 bg-signal-high/5">
              {providers.filter(p => p.enabled).length} still active
            </span>
          )}
        </div>
        <ChevronDown size={13} className={`text-terminal-muted/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-terminal-border/25 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {providers.map(p => (
            <ProviderCard
              key={p.name}
              provider={p}
              allProviders={allProviders}
              onToggle={onToggle}
              onSetPrimary={onSetPrimary}
              onForceFailover={onForceFailover}
              onResetMetrics={onResetMetrics}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Routing Events ────────────────────────────────────────────────────────────

function RoutingEvents({ events }: { events: FailoverEvent[] }) {
  if (!events.length) {
    return (
      <div className="text-center py-10 text-terminal-muted/40">
        <CheckCircle2 size={28} className="mx-auto mb-2 opacity-30" />
        <p className="text-xs">No routing events recorded — system stable on primary providers.</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {events.map(e => {
        const fromMeta = PROVIDER_META[e.fromProvider]
        const toMeta   = e.toProvider !== 'auto' ? PROVIDER_META[e.toProvider] : null
        return (
          <div
            key={e.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-terminal-border/25 bg-terminal-bright/5 hover:bg-terminal-bright/10 transition-colors"
          >
            <AlertTriangle size={12} className="text-signal-medium/60 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-terminal-muted/70">
                  <span style={{ color: fromMeta?.color ?? '#6b7280' }}>{fromMeta?.label ?? e.fromProvider}</span>
                  {' '}<span className="text-terminal-muted/30">→</span>{' '}
                  <span style={{ color: toMeta?.color ?? '#00d084' }}>
                    {toMeta?.label ?? (e.toProvider === 'auto' ? 'auto-select' : e.toProvider)}
                  </span>
                </span>
                {e.resolved && <span className="text-[8px] font-mono text-bull-default/60 border border-bull-default/20 px-1 rounded">resolved</span>}
              </div>
              <div className="text-[9px] text-terminal-muted/40 mt-0.5 font-mono">
                {e.reason.replace(/_/g, ' ')}{e.durationMs ? ` · ${e.durationMs}ms` : ''} · {formatTs(e.occurredAt)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type PageData = { providers: ProviderHealth[]; events: FailoverEvent[] }

export default function ProvidersPage() {
  const [actionLoading, setActionLoading] = useState(false)
  const [toast,         setToast]         = useState<{ msg: string; ok: boolean } | null>(null)

  const fetcher = useCallback(async (): Promise<PageData> => {
    const [pRes, eRes] = await Promise.all([
      adminApi.providers.list(),
      adminApi.providers.failoverHistory(20),
    ])
    return { providers: pRes.providers, events: eRes.events }
  }, [])

  const { data, loading, error, lastUpdated, refresh } = useAutoRefresh<PageData>(fetcher, 30_000)

  const allProviders = useMemo(
    () => [...(data?.providers ?? [])].sort((a, b) => a.priority - b.priority),
    [data?.providers],
  )
  const coreProviders   = allProviders.filter(p => STACK_CORE.includes(p.name))
  const legacyProviders = allProviders.filter(p => STACK_LEGACY.includes(p.name))
  const events          = data?.events ?? []

  const totalEnabled = allProviders.filter(p => p.enabled).length
  const healthyCount = allProviders.filter(p => p.enabled && p.status === 'healthy').length

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3_500)
  }

  const withAction = async (fn: () => Promise<void>, msg: string) => {
    setActionLoading(true)
    try { await fn(); showToast(msg); refresh() }
    catch (err) { showToast(err instanceof Error ? err.message : 'Action failed', false) }
    finally { setActionLoading(false) }
  }

  const handleToggle = (name: ProviderName, enabled: boolean) =>
    withAction(
      async () => { await (enabled ? adminApi.providers.enable(name) : adminApi.providers.disable(name)) },
      `${PROVIDER_META[name]?.label ?? name} ${enabled ? 'enabled' : 'disabled'}`,
    )

  const handleSetPrimary = (name: ProviderName) =>
    withAction(
      async () => { await adminApi.providers.setPriority(name, 1) },
      `${PROVIDER_META[name]?.label ?? name} set as primary`,
    )

  const handleForceFailover = (name: ProviderName) =>
    withAction(
      async () => { await adminApi.providers.forceFailover(name) },
      `Failover triggered — routing away from ${PROVIDER_META[name]?.label ?? name}`,
    )

  const handleResetMetrics = (name: ProviderName) =>
    withAction(
      async () => { await adminApi.providers.resetMetrics(name) },
      `Metrics cleared for ${PROVIDER_META[name]?.label ?? name}`,
    )

  const handleClearCache = () =>
    withAction(async () => { await adminApi.providers.clearCache() }, 'Market-data cache cleared')

  const handleActivateStack = () =>
    withAction(async () => {
      await Promise.all([
        adminApi.providers.enable('coinmarketcap').then(() => adminApi.providers.setPriority('coinmarketcap', 1)),
        adminApi.providers.enable('binance').then(() => adminApi.providers.setPriority('binance', 2)),
        adminApi.providers.enable('coingecko').then(() => adminApi.providers.setPriority('coingecko', 3)),
        adminApi.providers.enable('dexscreener').then(() => adminApi.providers.setPriority('dexscreener', 4)),
        adminApi.providers.disable('coinpaprika'),
        adminApi.providers.disable('geckoterm'),
      ])
    }, 'Institutional stack activated — CMC · Binance · CoinGecko · DexScreener')

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-terminal-text text-xl font-semibold">Operations Dashboard</h1>
          <p className="text-terminal-muted text-sm mt-0.5">
            {loading
              ? 'Loading intelligence infrastructure…'
              : `${healthyCount}/${totalEnabled} providers healthy · institutional stack · auto-refresh 30s`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearCache} disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-muted border border-terminal-border hover:text-terminal-text hover:border-terminal-bright rounded-lg transition-colors disabled:opacity-40 font-mono"
          >
            <Trash2 size={12} />Clear Cache
          </button>
          <button
            onClick={refresh} disabled={loading || actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-terminal-muted border border-terminal-border hover:text-terminal-text hover:border-terminal-bright rounded-lg transition-colors disabled:opacity-40 font-mono"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm ${
          toast.ok
            ? 'bg-bull-default/8 border-bull-default/25 text-bull-default'
            : 'bg-bear-default/8 border-bear-default/25 text-bear-default'
        }`}>
          {toast.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-bear-default/5 border border-bear-default/20 rounded-lg text-bear-default text-sm">
          <WifiOff size={14} className="shrink-0" />
          <span>Could not reach provider intelligence service: {error}</span>
          <button onClick={refresh} className="ml-auto text-bear-default/70 hover:text-bear-default text-xs underline font-mono">Retry</button>
        </div>
      )}

      {/* Provider Status Board */}
      {!loading && allProviders.length > 0 && (
        <ProviderStatusBoard providers={allProviders} />
      )}

      {/* Operations Summary */}
      {!loading && allProviders.length > 0 && (
        <OperationsSummary providers={allProviders} events={events} />
      )}

      {/* Quota Burn Forecast */}
      {!loading && allProviders.length > 0 && (
        <QuotaBurnForecast providers={allProviders} />
      )}

      {/* Intelligence Stack — core providers */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Intelligence Stack</span>
          <span className="h-px flex-1 bg-terminal-border/30" />
          <span className="text-[9px] text-terminal-muted/30 font-mono">
            {lastUpdated ? `Updated ${formatRelative(lastUpdated.toISOString())}` : ''}
          </span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-14 skeleton rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {coreProviders.map(p => (
              <CompactProviderCard
                key={p.name}
                provider={p}
                allProviders={allProviders}
                onToggle={handleToggle}
                onSetPrimary={handleSetPrimary}
                onForceFailover={handleForceFailover}
                onResetMetrics={handleResetMetrics}
                loading={actionLoading}
              />
            ))}
          </div>
        )}
      </div>

      {/* Institutional Stack Card */}
      {!loading && allProviders.length > 0 && (
        <InstitutionalStackCard
          providers={allProviders}
          onActivate={handleActivateStack}
          loading={actionLoading}
        />
      )}

      {/* Legacy providers (collapsed) */}
      {!loading && legacyProviders.length > 0 && (
        <LegacyProvidersSection
          providers={legacyProviders}
          allProviders={allProviders}
          onToggle={handleToggle}
          onSetPrimary={handleSetPrimary}
          onForceFailover={handleForceFailover}
          onResetMetrics={handleResetMetrics}
          loading={actionLoading}
        />
      )}

      {/* Routing Events */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Routing Events</span>
            <span className="h-px w-10 bg-terminal-border/30" />
            <span className="text-[9px] text-terminal-muted/30 font-mono">failover + switchover history</span>
          </div>
          {lastUpdated && (
            <div className="flex items-center gap-1 text-[9px] text-terminal-muted/35 font-mono">
              <Clock size={10} />
              {formatRelative(lastUpdated.toISOString())}
            </div>
          )}
        </div>
        <div className="glass-card rounded-xl p-4 border border-terminal-border/50">
          <RoutingEvents events={events} />
        </div>
      </div>

    </div>
  )
}
