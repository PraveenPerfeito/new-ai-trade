import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

export const runtime     = 'nodejs'
export const maxDuration = 15
export const dynamic     = 'force-dynamic'

const log = createLogger('api/news/grok')

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GrokNewsItem {
  title:       string
  url:         string
  source:      string
  publishedAt: string
  sentiment:   'bullish' | 'bearish' | 'neutral'
  summary:     string
}

interface GrokNewsResponse {
  news:      GrokNewsItem[]
  fetchedAt: string
  model:     string
}

// ── Module-level cache ────────────────────────────────────────────────────────

let _cache: { data: GrokNewsResponse; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

// ── Keyword sentiment classifier (no API needed) ──────────────────────────────

const BULLISH = [
  'rally', 'surge', 'soar', 'gain', 'rise', 'high', 'bull', 'ath', 'all-time',
  'adoption', 'approve', 'launch', 'upgrade', 'institutional', 'buy', 'inflow',
  'recover', 'breakout', 'growth', 'positive', 'milestone', 'record', 'boom',
  'interest', 'accumulate', 'support', 'partnership', 'integration', 'etf',
]
const BEARISH = [
  'crash', 'dump', 'drop', 'fall', 'decline', 'bear', 'hack', 'exploit', 'ban',
  'sec', 'lawsuit', 'fraud', 'scam', 'collapse', 'fear', 'sell', 'outflow',
  'liquidat', 'loss', 'concern', 'risk', 'warning', 'penalty', 'fine', 'arrest',
  'suspend', 'delist', 'restrict', 'probe', 'investigat', 'plunge', 'tumble',
]

function classifySentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase()
  const b = BULLISH.filter(w => lower.includes(w)).length
  const s = BEARISH.filter(w => lower.includes(w)).length
  if (b > s) return 'bullish'
  if (s > b) return 'bearish'
  return 'neutral'
}

// ── RSS feeds (free, no auth) ─────────────────────────────────────────────────

const RSS_FEEDS = [
  { url: 'https://cointelegraph.com/rss',  source: 'CoinTelegraph' },
  { url: 'https://decrypt.co/feed',        source: 'Decrypt'       },
  { url: 'https://cryptoslate.com/feed/',  source: 'CryptoSlate'   },
]

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return (m?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function parseRss(xml: string, source: string): GrokNewsItem[] {
  const items: GrokNewsItem[] = []
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const body    = m[1]
    const title   = extractTag(body, 'title')
    const url     = extractTag(body, 'link') || extractTag(body, 'guid')
    const pubDate = extractTag(body, 'pubDate') || extractTag(body, 'dc:date')
    const desc    = extractTag(body, 'description').replace(/<[^>]+>/g, '').slice(0, 140)
    if (!title || !url) continue
    items.push({
      title,
      url,
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      sentiment:   classifySentiment(title + ' ' + desc),
      summary:     desc || title,
    })
  }
  return items.slice(0, 10)
}

async function fetchRssNews(): Promise<GrokNewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, text/xml' },
        signal: AbortSignal.timeout(7_000),
      })
      if (!res.ok) throw new Error(`RSS ${source} ${res.status}`)
      return parseRss(await res.text(), source)
    }),
  )
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  log.info({ feeds: RSS_FEEDS.length, items: items.length }, 'rss_fetched')
  return items
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1'

  if (!force && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    log.info({ ageMs: Date.now() - _cache.fetchedAt }, 'grok_news_cache_hit')
    return NextResponse.json({ success: true, ..._cache.data, cached: true })
  }

  log.info({ force }, 'grok_news_fetch_start')
  try {
    const news = await fetchRssNews()
    if (news.length === 0) throw new Error('All RSS feeds failed')

    const data: GrokNewsResponse = {
      news,
      fetchedAt: new Date().toISOString(),
      model:     'rss+keywords',
    }

    _cache = { data, fetchedAt: Date.now() }
    log.info({ count: news.length }, 'grok_news_fetch_complete')
    return NextResponse.json({ success: true, ...data, cached: false })
  } catch (e) {
    log.error({ error: e instanceof Error ? e.message : String(e) }, 'grok_news_fetch_failed')
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Fetch failed' },
      { status: 502 },
    )
  }
}
