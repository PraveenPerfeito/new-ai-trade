import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

export const runtime     = 'nodejs'
export const maxDuration = 30
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

// ── Module-level cache (no Redis — in-process only, resets on restart) ────────

let _cache: { data: GrokNewsResponse; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 min

// ── RSS feeds (free, no auth) ─────────────────────────────────────────────────

const RSS_FEEDS = [
  { url: 'https://cointelegraph.com/rss',   source: 'CoinTelegraph' },
  { url: 'https://decrypt.co/feed',         source: 'Decrypt'       },
  { url: 'https://cryptoslate.com/feed/',   source: 'CryptoSlate'   },
]

interface RawItem { title: string; url: string; source: string; pubDate: string; desc: string }

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return (m?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function parseRss(xml: string, source: string): RawItem[] {
  const items: RawItem[] = []
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const body    = m[1]
    const title   = extractTag(body, 'title')
    const url     = extractTag(body, 'link') || extractTag(body, 'guid')
    const pubDate = extractTag(body, 'pubDate') || extractTag(body, 'dc:date')
    const desc    = extractTag(body, 'description').replace(/<[^>]+>/g, '').slice(0, 150)
    if (title && url) items.push({ title, url, source, pubDate, desc })
  }
  return items.slice(0, 10)
}

async function fetchRssNews(): Promise<RawItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/rss+xml, application/xml, text/xml' },
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

// ── Grok sentiment analysis ───────────────────────────────────────────────────

async function analyzeWithGrok(apiKey: string, headlines: RawItem[]): Promise<GrokNewsItem[]> {
  const lines = headlines.map(n =>
    `TITLE: ${n.title}\nSOURCE: ${n.source}\nURL: ${n.url}\nDESC: ${n.desc}\nDATE: ${n.pubDate}`,
  ).join('\n---\n')

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:    'grok-3-latest',
      messages: [{
        role:    'user',
        content: `You are a crypto market analyst. For each headline below, classify sentiment (bullish/bearish/neutral for crypto prices) and write a one-sentence market impact summary.

${lines}

Return ONLY valid JSON (no markdown fences):
{"news":[{"title":"exact title","url":"exact url","source":"source name","publishedAt":"ISO date string","sentiment":"bullish|bearish|neutral","summary":"one sentence"}]}
Include every headline.`,
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text()
    log.warn({ status: res.status, body: body.slice(0, 200) }, 'xai_api_error_fallback_neutral')
    // Return headlines with neutral sentiment rather than failing the whole tab
    return headlines.slice(0, 15).map(n => ({
      title:       n.title,
      url:         n.url,
      source:      n.source,
      publishedAt: n.pubDate ? new Date(n.pubDate).toISOString() : new Date().toISOString(),
      sentiment:   'neutral' as const,
      summary:     n.desc,
    }))
  }

  const json    = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content ?? ''

  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed  = JSON.parse(cleaned) as { news?: GrokNewsItem[] }
    if (Array.isArray(parsed.news) && parsed.news.length > 0) return parsed.news.slice(0, 20)
  } catch {
    log.warn({ contentLength: content.length }, 'grok_json_parse_failed')
  }

  // Fallback: return headlines without sentiment if Grok fails
  return headlines.slice(0, 15).map(n => ({
    title:       n.title,
    url:         n.url,
    source:      n.source,
    publishedAt: n.pubDate ? new Date(n.pubDate).toISOString() : new Date().toISOString(),
    sentiment:   'neutral' as const,
    summary:     n.desc,
  }))
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const force  = new URL(req.url).searchParams.get('force') === '1'
  const apiKey = process.env.XAI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'XAI_API_KEY not configured — add it to Vercel env vars' },
      { status: 503 },
    )
  }

  if (!force && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    log.info({ ageMs: Date.now() - _cache.fetchedAt }, 'grok_news_cache_hit')
    return NextResponse.json({ success: true, ..._cache.data, cached: true })
  }

  log.info({ force }, 'grok_news_fetch_start')
  try {
    const headlines = await fetchRssNews()
    if (headlines.length === 0) throw new Error('All RSS feeds failed')

    const news = await analyzeWithGrok(apiKey, headlines)

    const data: GrokNewsResponse = {
      news,
      fetchedAt: new Date().toISOString(),
      model:     'grok-3-latest',
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
