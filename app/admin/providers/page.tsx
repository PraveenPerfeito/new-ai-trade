'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  Database, AlertTriangle, CheckCircle2, RefreshCw, Zap,
  Trash2, RotateCcw, Clock, WifiOff, ChevronRight,
  Key, Eye, EyeOff, ChevronDown, Shield,
} from 'lucide-react'
import { adminApi, ProviderHealth, ProviderName, FailoverEvent } from '@/lib/admin-api'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { formatTs } from '@/lib/utils'

// ── Provider metadata ─────────────────────────────────────────────────────────

interface ProviderMeta {
  label:       string
  role:        string
  roleShort:   string
  color:       string
  description: string
  coverage:    string[]
  tier:        'primary' | 'backup' | 'candles' | 'defi'
  freeLabel:   string | null
  needsKey:    boolean
  quotaNote:   string
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  coingecko: {
    label: 'CoinGecko', role: 'Primary Market Data', roleShort: 'PRIMARY',
    color: '#2d9e49',
    description: 'Top-100 coin rankings · price, volume, and market cap data',
    coverage: ['Top 100', 'Price & Volume', 'Market Cap'],
    tier: 'primary', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Unlimited on free tier',
  },
  coinmarketcap: {
    label: 'CoinMarketCap', role: 'Premium Market Data', roleShort: 'PREMIUM',
    color: '#3861fb',
    description: 'High-accuracy quotes · institutional-grade market intelligence',
    coverage: ['Premium Quotes', 'Global Coverage', 'High Accuracy'],
    tier: 'backup', freeLabel: null, needsKey: true,
    quotaNote: '10,000 req/day on Basic plan',
  },
  binance: {
    label: 'Binance', role: 'Price & Candle Data', roleShort: 'CANDLES',
    color: '#f0b90b',
    description: 'OHLCV klines · futures intelligence · order book data',
    coverage: ['OHLCV Candles', 'Futures Data', 'Order Book'],
    tier: 'candles', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Rate-limited by IP address',
  },
  dexscreener: {
    label: 'DexScreener', role: 'DEX Market Data', roleShort: 'DEX',
    color: '#7c3aed',
    description: 'Decentralized exchange tokens · $10M+ market cap floor',
    coverage: ['DEX Tokens', 'DeFi Coverage', 'LP Pools'],
    tier: 'defi', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Unlimited',
  },
  coinpaprika: {
    label: 'CoinPaprika', role: 'Historical Data', roleShort: 'HISTORICAL',
    color: '#06b6d4',
    description: 'Historical OHLCV · on-chain metrics · fundamental data',
    coverage: ['Historical Data', 'On-Chain', 'Fundamentals'],
    tier: 'backup', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Rate-limited',
  },
  geckoterm: {
    label: 'GeckoTerminal', role: 'DEX Pool Liquidity', roleShort: 'DEX POOLS',
    color: '#14b8a6',
    description: 'On-chain DEX pool analytics · liquidity flow · $10M+ floor',
    coverage: ['Pool Liquidity', 'DEX Analytics', 'On-Chain Flows'],
    tier: 'defi', freeLabel: 'Free', needsKey: false,
    quotaNote: 'Unlimited',
  },
}

const TIER_COLORS: Record<string, string> = {
  primary: '#2d9e49', backup: '#3b82f6', candles: '#f0b90b', defi: '#8b5cf6',
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

function statusText(status: string): string {
  switch (status) {
    case 'healthy':         return 'text-bull-default'
    case 'degraded':        return 'text-signal-high'
    case 'quota_exhausted': return 'text-signal-medium'
    default:                return 'text-terminal-muted'
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

// ── Routing Chain ─────────────────────────────────────────────────────────────

function RoutingChain({ providers }: { providers: ProviderHealth[] }) {
  const sorted = useMemo(
    () => [...providers].sort((a, b) => a.priority - b.priority),
    [providers],
  )

  if (!sorted.length) return null

  return (
    <div className="glass-card rounded-xl border border-terminal-border/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] text-terminal-muted/45 uppercase tracking-widest font-mono">Data Routing Chain</span>
        <span className="h-px flex-1 bg-terminal-border/30" />
        <span className="text-[9px] text-terminal-muted/35 font-mono">request waterfall · left = highest priority</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {sorted.map((p, i) => {
          const meta  = PROVIDER_META[p.name]
          const color = p.enabled ? (meta?.color ?? '#6b7280') : '#374151'
          return (
            <div key={p.name} className="flex items-center gap-1">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all"
                style={{
                  borderColor:     p.enabled ? color + '55' : 'rgba(255,255,255,0.07)',
                  backgroundColor: p.enabled ? color + '12' : 'transparent',
                }}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(p.status)}`} />
                <span className="text-[10px] font-semibold" style={{ color: p.enabled ? color : '#4b5563' }}>
                  {meta?.label ?? p.name}
                </span>
                <span
                  className="text-[8px] font-mono px-1 py-0.5 rounded-sm"
                  style={{ color: p.enabled ? color : '#4b5563', backgroundColor: p.enabled ? color + '20' : 'transparent' }}
                >
                  P{p.priority}
                </span>
                {!p.enabled && (
                  <span className="text-[8px] text-terminal-muted/30 font-mono">off</span>
                )}
              </div>
              {i < sorted.length - 1 && (
                <ChevronRight size={12} className="text-terminal-muted/20 shrink-0" />
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[9px] text-terminal-muted/35 font-mono mt-2.5">
        System tries providers left → right. Disabled providers are skipped automatically.
      </p>
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
  provider:     ProviderHealth
  allProviders: ProviderHealth[]
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
    color: '#6b7280', description: '', coverage: [], tier: 'backup' as const,
    freeLabel: null, needsKey: false, quotaNote: '',
  }

  const { perHr, perMo }  = rateEst(provider.requestsToday)
  const quotaPct           = provider.quota.dailyLimit > 0 ? provider.quota.pct : 0
  const exhaustion         = exhaustionEst(provider.quota, perHr)
  const isPrimary          = provider.priority === 1 && provider.enabled
  const minPriority        = Math.min(...allProviders.filter(p => p.enabled).map(p => p.priority))
  const canSetPrimary      = provider.priority !== minPriority && provider.enabled
  const activeColor        = provider.enabled ? meta.color : '#374151'

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
      {/* Left color accent */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl"
        style={{ backgroundColor: provider.enabled && provider.status === 'healthy' ? meta.color : '#1f2937' }}
      />

      <div className="pl-4 pr-4 pt-4 pb-4 space-y-3.5">

        {/* ── Header ── */}
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
                {isPrimary && (
                  <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-bull-default/15 text-bull-default border border-bull-default/30">
                    ACTIVE PRIMARY
                  </span>
                )}
                {meta.freeLabel && (
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

        {/* ── Health + metrics ── */}
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
            <span className="text-xs font-mono font-bold text-terminal-text w-6 text-right">
              {provider.healthScore}
            </span>
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
              <p className="text-xs font-mono text-terminal-muted/70">
                {formatRelative(provider.lastSuccess)}
              </p>
              <p className="text-[8px] text-terminal-muted/40 mt-0.5">Last OK</p>
            </div>
          </div>
        </div>

        {/* ── Quota (if limited) ── */}
        {provider.quota.dailyLimit > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[9px] font-mono">
              <span className="text-terminal-muted/45">API Quota</span>
              <span className="text-terminal-muted/55">
                {provider.quota.used.toLocaleString()} / {provider.quota.dailyLimit.toLocaleString()} used · {quotaPct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-terminal-bright/25 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width:           `${Math.min(quotaPct, 100)}%`,
                  backgroundColor: quotaPct >= 90 ? '#ff3b5c'
                                 : quotaPct >= 75 ? '#f97316'
                                 : quotaPct >= 50 ? '#f59e0b' : '#00d084',
                }}
              />
            </div>
            {quotaPct >= 75 && (
              <p className="text-[8px] text-signal-high font-mono flex items-center gap-1">
                <AlertTriangle size={8} />
                {quotaPct >= 90 ? 'Critical — quota nearly exhausted' : 'Warning — quota running low'}
                {exhaustion ? ` · est. ${exhaustion} remaining` : ''}
              </p>
            )}
            {quotaPct < 75 && exhaustion && (
              <p className="text-[8px] text-terminal-muted/35 font-mono">Est. exhaustion: {exhaustion} at current rate</p>
            )}
          </div>
        )}

        {/* ── API Usage stats ── */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-terminal-border/30 py-2 px-3">
            <p className="text-sm font-mono font-bold text-terminal-text">
              {provider.requestsToday.toLocaleString()}
            </p>
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

        {/* ── Market coverage chips ── */}
        <div className="flex items-center gap-1 flex-wrap">
          {meta.coverage.map(c => (
            <span
              key={c}
              className="text-[8px] px-1.5 py-0.5 rounded border border-terminal-border/35 text-terminal-muted/45 font-mono"
            >
              {c}
            </span>
          ))}
          <span className="text-[8px] px-1.5 py-0.5 rounded border border-terminal-border/20 text-terminal-muted/25 font-mono">
            {meta.quotaNote}
          </span>
        </div>

        {/* ── API Key panel ── */}
        {meta.needsKey && showKeyPanel && (
          <div className="border border-terminal-border/50 rounded-lg p-3 space-y-2 bg-terminal-bright/5">
            <p className="text-[10px] text-terminal-muted/65 leading-relaxed">
              Paste your {meta.label} API key to activate this provider. The key will be stored in the infrastructure settings group.
            </p>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={e => { setKeyInput(e.target.value); setKeyStatus('idle') }}
                  placeholder={`${meta.label} API key…`}
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
                {testingKey ? '…' : 'Test'}
              </button>
            </div>
            {keyStatus === 'ok'   && <p className="text-[9px] text-bull-default  font-mono">✓ Connection healthy</p>}
            {keyStatus === 'fail' && <p className="text-[9px] text-bear-default  font-mono">✕ Connection failed — check key or plan</p>}
            <p className="text-[8px] text-terminal-muted/30 font-mono leading-relaxed">
              Set COINMARKETCAP_API_KEY in .env.local to persist across restarts. The settings system stores a runtime copy.
            </p>
          </div>
        )}

        {/* ── Actions bar ── */}
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
                  : 'border-terminal-border/50 text-terminal-muted/70 hover:text-terminal-text hover:border-terminal-border'
              }`}
            >
              <Key size={9} />
              {showKeyPanel ? 'Hide Key Panel' : 'Configure Key'}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowMore(v => !v)}
            className="flex items-center gap-0.5 text-[10px] px-2 py-1.5 rounded border border-terminal-border/30 text-terminal-muted/40 hover:text-terminal-muted font-mono transition-colors"
          >
            More
            <ChevronDown size={10} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* ── Expanded more actions ── */}
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

// ── Routing Events ────────────────────────────────────────────────────────────

function RoutingEvents({ events }: { events: FailoverEvent[] }) {
  if (!events.length) {
    return (
      <div className="text-center py-10 text-terminal-muted/40">
        <CheckCircle2 size={28} className="mx-auto mb-2 opacity-30" />
        <p className="text-xs">No routing events recorded — system running on primary providers.</p>
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
                  <span style={{ color: fromMeta?.color ?? '#6b7280' }}>
                    {fromMeta?.label ?? e.fromProvider}
                  </span>
                  {' '}
                  <span className="text-terminal-muted/30">→</span>
                  {' '}
                  <span style={{ color: toMeta?.color ?? '#00d084' }}>
                    {toMeta?.label ?? (e.toProvider === 'auto' ? 'auto-select' : e.toProvider)}
                  </span>
                </span>
                {e.resolved && (
                  <span className="text-[8px] font-mono text-bull-default/60 border border-bull-default/20 px-1 rounded">resolved</span>
                )}
              </div>
              <div className="text-[9px] text-terminal-muted/40 mt-0.5 font-mono">
                {e.reason.replace(/_/g, ' ')}
                {e.durationMs ? ` · ${e.durationMs}ms` : ''}
                {' · '}
                {formatTs(e.occurredAt)}
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

  const providers = useMemo(
    () => [...(data?.providers ?? [])].sort((a, b) => a.priority - b.priority),
    [data?.providers],
  )
  const events = data?.events ?? []

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalEnabled  = providers.filter(p => p.enabled).length
  const healthyCount  = providers.filter(p => p.enabled && p.status === 'healthy').length
  const totalCalls    = providers.reduce((s, p) => s + p.requestsToday, 0)
  const enabledWithMs = providers.filter(p => p.enabled && p.latencyMs > 0)
  const avgLatency    = enabledWithMs.length
    ? Math.round(enabledWithMs.reduce((s, p) => s + p.latencyMs, 0) / enabledWithMs.length)
    : 0

  // ── Actions ───────────────────────────────────────────────────────────────

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3_000)
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-terminal-text text-xl font-semibold">Provider Network</h1>
          <p className="text-terminal-muted text-sm mt-0.5">
            {loading
              ? 'Loading provider intelligence…'
              : `${healthyCount} of ${totalEnabled} active providers healthy · auto-refresh 30s`
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

      {/* Status Strip */}
      {!loading && providers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Active Providers', icon: Database,
              value: `${totalEnabled}`,
              sub: `of ${providers.length} total`,
              color: totalEnabled > 0 ? '#00d084' : '#ff3b5c',
            },
            {
              label: 'Data Healthy', icon: Shield,
              value: `${healthyCount}/${totalEnabled}`,
              sub: healthyCount === totalEnabled ? 'Full coverage' : `${totalEnabled - healthyCount} degraded`,
              color: healthyCount === totalEnabled ? '#00d084' : '#f59e0b',
            },
            {
              label: 'API Calls Today', icon: Database,
              value: totalCalls.toLocaleString(),
              sub: `across ${totalEnabled} providers`,
              color: '#3b82f6',
            },
            {
              label: 'Avg Latency', icon: Clock,
              value: avgLatency > 0 ? `${avgLatency}ms` : '—',
              sub: avgLatency > 2000 ? 'Degraded' : avgLatency > 500 ? 'Acceptable' : 'Excellent',
              color: avgLatency > 2000 ? '#ff3b5c' : avgLatency > 500 ? '#f59e0b' : '#00d084',
            },
          ].map(s => (
            <div key={s.label} className="glass-card rounded-xl px-4 py-3 border border-terminal-border/50">
              <p className="text-[9px] text-terminal-muted/45 uppercase tracking-widest mb-1.5">{s.label}</p>
              <p className="text-xl font-mono font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[9px] text-terminal-muted/40 mt-0.5 font-mono">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Routing Chain */}
      {!loading && providers.length > 0 && <RoutingChain providers={providers} />}

      {/* Provider Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Provider Intelligence</span>
          <span className="h-px flex-1 bg-terminal-border/30" />
          <span className="text-[9px] text-terminal-muted/30 font-mono">{providers.length} providers configured</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-64 skeleton rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map(p => (
              <ProviderCard
                key={p.name}
                provider={p}
                allProviders={providers}
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

      {/* Routing Events */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-terminal-muted/40 uppercase tracking-widest font-mono">Routing Events</span>
            <span className="h-px w-12 bg-terminal-border/30" />
            <span className="text-[9px] text-terminal-muted/30 font-mono">failover + switchover history</span>
          </div>
          {lastUpdated && (
            <div className="flex items-center gap-1 text-[9px] text-terminal-muted/35 font-mono">
              <Clock size={10} />
              Updated {formatRelative(lastUpdated.toISOString())}
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
