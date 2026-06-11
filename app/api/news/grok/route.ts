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

// ── CoinGecko news feed (free, no key, live) ──────────────────────────────────

interface CgNewsItem {
  title:        string
  url:          string
  news_site:    string
  description?: string
  published_at: number
}

async function fetchCoinGeckoNews(): Promise<CgNewsItem[]> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/news?per_page=25&page=1',
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
  )
  if (!res.ok) throw new Error(`CoinGecko news ${res.status}`)
  const json = await res.json() as { data?: CgNewsItem[] }
  return json.data ?? []
}

// ── Grok sentiment analysis ───────────────────────────────────────────────────

async function analyzeWithGrok(apiKey: string, headlines: CgNewsItem[]): Promise<GrokNewsItem[]> {
  const lines = headlines.map(n =>
    `TITLE: ${n.title}\nSOURCE: ${n.news_site}\nURL: ${n.url}\nDESC: ${n.description?.slice(0, 120) ?? ''}\nDATE: ${new Date(n.published_at * 1000).toISOString()}`,
  ).join('\n---\n')

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:    'grok-3-latest',
      messages: [{
        role:    'user',
        content: `You are a crypto market analyst. Analyze these news headlines and classify each as bullish, bearish, or neutral for crypto markets. Write a one-sentence summary focused on market impact.

${lines}

Return ONLY valid JSON (no markdown fences):
{"news":[{"title":"exact title","url":"exact url","source":"news_site","publishedAt":"ISO date","sentiment":"bullish|bearish|neutral","summary":"one sentence market impact"}]}
Include every headline.`,
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text()
    log.error({ status: res.status, body }, 'xai_api_error')
    throw new Error(`xAI API ${res.status}: ${body.slice(0, 200)}`)
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

  // Fallback: return headlines with neutral sentiment if Grok fails to parse
  return headlines.slice(0, 15).map(n => ({
    title:       n.title,
    url:         n.url,
    source:      n.news_site,
    publishedAt: new Date(n.published_at * 1000).toISOString(),
    sentiment:   'neutral' as const,
    summary:     n.description?.slice(0, 120) ?? '',
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
    const headlines = await fetchCoinGeckoNews()
    log.info({ count: headlines.length }, 'coingecko_headlines_fetched')

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
