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

// ── CryptoPanic ───────────────────────────────────────────────────────────────

async function fetchCryptoPanic(): Promise<NewsItem[]> {
  const token = process.env.CRYPTOPANIC_API_TOKEN
  // Public endpoint works without token (limited but sufficient for headlines)
  const url = token
    ? `https://cryptopanic.com/api/v1/posts/?auth_token=${token}&kind=news&filter=hot&public=true`
    : 'https://cryptopanic.com/api/v1/posts/?kind=news&filter=hot&public=true'
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'SignalEdgeAI/1.0' },
    })
    if (!r.ok) return []
    const json = await r.json() as {
      results?: Array<{
        title: string
        url: string
        source: { title: string }
        published_at: string
        votes?: { negative: number; positive: number; saved: number }
      }>
    }
    return (json.results ?? []).slice(0, 15).map(item => {
      const pos = item.votes?.positive ?? 0
      const neg = item.votes?.negative ?? 0
      const sentiment: NewsItem['sentiment'] =
        pos > neg + 2 ? 'bullish' : neg > pos + 2 ? 'bearish' : 'neutral'
      return {
        title:      item.title,
        url:        item.url,
        source:     item.source?.title ?? 'CryptoPanic',
        publishedAt: item.published_at,
        sentiment,
      }
    })
  } catch {
    return []
  }
}

// ── CoinDesk RSS ──────────────────────────────────────────────────────────────

function parseRssItems(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
    const block = match[1]
    const title = (/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) ??
                   /<title[^>]*>(.*?)<\/title>/.exec(block))?.[1]?.trim() ?? ''
    const link  = (/<link>(.*?)<\/link>/.exec(block) ??
                   /<link[^>]*href="([^"]+)"/.exec(block))?.[1]?.trim() ?? ''
    const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(block))?.[1]?.trim() ?? ''
    if (!title || !link) continue
    items.push({
      title,
      url:         link,
      source:      sourceName,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      sentiment:   'neutral',
    })
  }
  return items
}

async function fetchCoinDeskRSS(): Promise<NewsItem[]> {
  try {
    const r = await fetch('https://www.coindesk.com/arc/outboundfeeds/rss/', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'SignalEdgeAI/1.0' },
    })
    if (!r.ok) return []
    const xml = await r.text()
    return parseRssItems(xml, 'CoinDesk')
  } catch {
    return []
  }
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

  const [fearGreed, cryptoPanic, coinDesk] = await Promise.allSettled([
    fetchFearGreed(),
    fetchCryptoPanic(),
    fetchCoinDeskRSS(),
  ])

  const fg       = fearGreed.status === 'fulfilled' ? fearGreed.value : { fearGreedValue: null, fearGreedLabel: null, fearGreedTs: null }
  const cpItems  = cryptoPanic.status === 'fulfilled' ? cryptoPanic.value : []
  const cdItems  = coinDesk.status === 'fulfilled' ? coinDesk.value : []

  // Merge headlines — CryptoPanic first (has sentiment votes), then CoinDesk RSS
  const allHeadlines = [...cpItems, ...cdItems].slice(0, 20)

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
