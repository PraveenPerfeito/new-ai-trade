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

// ── xAI Agent Tools API fetch ─────────────────────────────────────────────────

async function fetchFromGrok(apiKey: string): Promise<GrokNewsItem[]> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:    'grok-3-latest',
      // Agent Tools API — replaces deprecated search_parameters
      tools: [{ type: 'live_search', live_search: { sources: [{ type: 'news' }, { type: 'web' }] } }],
      messages: [{
        role:    'user',
        content: `Search for the latest cryptocurrency and crypto market news from the last 6 hours.
Return a valid JSON object (no markdown fences, no extra text) with exactly this shape:
{"news":[{"title":"...","url":"...","source":"publication name","publishedAt":"ISO datetime or relative string","sentiment":"bullish|bearish|neutral","summary":"one sentence max"}]}
Find 12-15 real articles from reputable sources (CoinDesk, The Block, Reuters, Bloomberg, Decrypt, CryptoSlate, etc).
Focus on: BTC/ETH price action, regulation, exchange news, major protocol updates, macro impact on crypto.
sentiment rules — bullish: positive price/adoption impact; bearish: negative price/regulatory risk; neutral: informational/mixed.`,
      }],
    }),
    signal: AbortSignal.timeout(25_000),
  })

  if (!res.ok) {
    const body = await res.text()
    log.error({ status: res.status, body }, 'xai_api_error')
    throw new Error(`xAI API ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json() as {
    choices?: Array<{
      message?: {
        content?:    string
        tool_calls?: Array<{
          id:       string
          type:     string
          function: { name: string; arguments: string }
        }>
        citations?: Array<{ url: string; title: string; excerpt?: string }>
      }
      finish_reason?: string
    }>
  }

  const message   = json.choices?.[0]?.message
  const content   = message?.content ?? ''
  const citations = message?.citations ?? []

  // If the model returned tool_calls but no content yet, it means the search
  // step needs a follow-up. For simplicity, fall through to citations fallback.
  if (message?.tool_calls?.length && !content) {
    log.warn({ toolCalls: message.tool_calls.length }, 'grok_tool_calls_no_content')
  }

  // Primary: parse JSON from content
  if (content) {
    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed  = JSON.parse(cleaned) as { news?: GrokNewsItem[] }
      if (Array.isArray(parsed.news) && parsed.news.length > 0) {
        return parsed.news.slice(0, 15)
      }
    } catch {
      log.warn({ contentLength: content.length }, 'grok_json_parse_failed_trying_citations')
    }
  }

  // Fallback: build items from citations
  if (citations.length > 0) {
    return citations.slice(0, 15).map(c => ({
      title:       c.title ?? 'Untitled',
      url:         c.url,
      source:      (() => { try { return new URL(c.url).hostname.replace('www.', '') } catch { return 'Unknown' } })(),
      publishedAt: new Date().toISOString(),
      sentiment:   'neutral' as const,
      summary:     c.excerpt?.slice(0, 120) ?? '',
    }))
  }

  throw new Error('No parseable news in Grok response')
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

  // Return in-process cache if still fresh and not forced
  if (!force && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    log.info({ ageMs: Date.now() - _cache.fetchedAt }, 'grok_news_cache_hit')
    return NextResponse.json({ success: true, ..._cache.data, cached: true })
  }

  log.info({ force }, 'grok_news_fetch_start')
  try {
    const news = await fetchFromGrok(apiKey)

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
