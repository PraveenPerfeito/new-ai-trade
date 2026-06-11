import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

export const runtime     = 'nodejs'
export const dynamic     = 'force-dynamic'
export const maxDuration = 10

const log = createLogger('api/news')

// Redis cache key + TTL (15 min — news doesn't change faster than this)
const CACHE_KEY = 'news:intel:snapshot'
const CACHE_TTL = 900

export interface NewsItem {
  title:      string
  url:        string
  source:     string
  publishedAt: string
  sentiment?: 'bullish' | 'bearish' | 'neutral'
}

export interface NewsSnapshot {
  fearGreedValue:  number | null
  fearGreedLabel:  string | null
  fearGreedTs:     string | null
  headlines:       NewsItem[]
  bullishCount:    number
  bearishCount:    number
  neutralCount:    number
  cachedAt:        string
  // IMPORTANT: informational only — never fed into signal pipeline
  informationalOnly: true
}

// ── Fear & Greed ──────────────────────────────────────────────────────────────

async function fetchFearGreed(): Promise<Pick<NewsSnapshot, 'fearGreedValue' | 'fearGreedLabel' | 'fearGreedTs'>> {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'SignalEdgeAI/1.0' },
    })
    if (!r.ok) return { fearGreedValue: null, fearGreedLabel: null, fearGreedTs: null }
    const json = await r.json() as { data?: Array<{ value: string; value_classification: string; timestamp: string }> }
    const d = json?.data?.[0]
    if (!d) return { fearGreedValue: null, fearGreedLabel: null, fearGreedTs: null }
    return {
      fearGreedValue: parseInt(d.value, 10),
      fearGreedLabel: d.value_classification,
      fearGreedTs:    new Date(parseInt(d.timestamp, 10) * 1000).toISOString(),
    }
  } catch {
    return { fearGreedValue: null, fearGreedLabel: null, fearGreedTs: null }
  }
}

// ── Keyword sentiment classifier ──────────────────────────────────────────────

const BULLISH_WORDS = [
  'rally', 'surge', 'soar', 'gain', 'rise', 'high', 'bull', 'ath', 'all-time',
  'adoption', 'approve', 'launch', 'upgrade', 'institutional', 'inflow',
  'recover', 'breakout', 'growth', 'milestone', 'record', 'etf', 'accumulate',
  'partnership', 'integration', 'boom', 'positive', 'support',
]
const BEARISH_WORDS = [
  'crash', 'dump', 'drop', 'fall', 'decline', 'bear', 'hack', 'exploit', 'ban',
  'sec', 'lawsuit', 'fraud', 'scam', 'collapse', 'fear', 'outflow',
  'liquidat', 'loss', 'concern', 'risk', 'warning', 'penalty', 'fine', 'arrest',
  'suspend', 'delist', 'restrict', 'probe', 'investigat', 'plunge', 'tumble',
]

function classifySentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase()
  const b = BULLISH_WORDS.filter(w => lower.includes(w)).length
  const s = BEARISH_WORDS.filter(w => lower.includes(w)).length
  if (b > s) return 'bullish'
  if (s > b) return 'bearish'
  return 'neutral'
}

// ── RSS feeds (free, no auth) ─────────────────────────────────────────────────

const RSS_FEEDS = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk'      },
  { url: 'https://cointelegraph.com/rss',                   source: 'CoinTelegraph' },
  { url: 'https://decrypt.co/feed',                         source: 'Decrypt'       },
]

function parseRssItems(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
    const block   = match[1]
    const title   = (/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ??
                     /<title[^>]*>(.*?)<\/title>/.exec(block))?.[1]?.trim() ?? ''
    const link    = (/<link>(.*?)<\/link>/.exec(block) ??
                     /<link[^>]*href="([^"]+)"/.exec(block))?.[1]?.trim() ?? ''
    const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(block))?.[1]?.trim() ?? ''
    const desc    = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(block) ??
                     /<description[^>]*>([\s\S]*?)<\/description>/.exec(block))?.[1]
                      ?.replace(/<[^>]+>/g, '').trim().slice(0, 150) ?? ''
    if (!title || !link) continue
    items.push({
      title,
      url:         link,
      source:      sourceName,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      sentiment:   classifySentiment(title + ' ' + desc),
    })
  }
  return items
}

async function fetchAllRss(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const r = await fetch(url, {
        signal:  AbortSignal.timeout(5_000),
        headers: { 'User-Agent': 'SignalEdgeAI/1.0', Accept: 'application/rss+xml, text/xml' },
      })
      if (!r.ok) return [] as NewsItem[]
      return parseRssItems(await r.text(), source)
    }),
  )
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  // Try Redis cache first
  try {
    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    const cached = await redis.get(CACHE_KEY)
    if (cached) {
      return NextResponse.json({ success: true, ...(JSON.parse(cached as string) as NewsSnapshot) })
    }
  } catch {
    // Cache unavailable — fetch fresh
  }

  log.info('fetching fresh news snapshot')

  const [fearGreed, rssResult] = await Promise.allSettled([
    fetchFearGreed(),
    fetchAllRss(),
  ])

  const fg           = fearGreed.status === 'fulfilled' ? fearGreed.value : { fearGreedValue: null, fearGreedLabel: null, fearGreedTs: null }
  const allHeadlines = (rssResult.status === 'fulfilled' ? rssResult.value : []).slice(0, 20)

  const bullishCount = allHeadlines.filter(h => h.sentiment === 'bullish').length
  const bearishCount = allHeadlines.filter(h => h.sentiment === 'bearish').length
  const neutralCount = allHeadlines.filter(h => h.sentiment === 'neutral').length

  const snapshot: NewsSnapshot = {
    ...fg,
    headlines:   allHeadlines,
    bullishCount,
    bearishCount,
    neutralCount,
    cachedAt:    new Date().toISOString(),
    informationalOnly: true,
  }

  // Cache for 15 minutes
  try {
    const { getRedis } = await import('@/lib/redis')
    const redis = getRedis()
    await redis.set(CACHE_KEY, JSON.stringify(snapshot), 'EX', CACHE_TTL)
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ success: true, ...snapshot })
}
