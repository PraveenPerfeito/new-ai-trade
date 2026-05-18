/**
 * Redis-backed rate limiting for Node.js API routes.
 * Falls back to an in-memory counter when Redis is unavailable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from './logger';

const log = createLogger('lib/rate-limit');

interface LimitConfig {
  /** Max requests per window */
  limit:  number;
  /** Window size in seconds */
  window: number;
}

const DEFAULT: LimitConfig = { limit: 60, window: 60 };

// In-memory fallback — single process only, resets on restart
const memStore = new Map<string, { count: number; resetAt: number }>();

async function checkRedis(key: string, cfg: LimitConfig): Promise<{ allowed: boolean; remaining: number }> {
  const { getRedis } = await import('./redis');
  const redis = getRedis();

  const multi = redis.multi();
  multi.incr(key);
  multi.expire(key, cfg.window);
  const results = await multi.exec();

  const count = (results?.[0]?.[1] as number) ?? 1;
  const allowed = count <= cfg.limit;
  return { allowed, remaining: Math.max(0, cfg.limit - count) };
}

function checkMemory(key: string, cfg: LimitConfig): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || entry.resetAt < now) {
    memStore.set(key, { count: 1, resetAt: now + cfg.window * 1000 });
    return { allowed: true, remaining: cfg.limit - 1 };
  }

  entry.count++;
  const allowed = entry.count <= cfg.limit;
  return { allowed, remaining: Math.max(0, cfg.limit - entry.count) };
}

export async function rateLimit(
  req: NextRequest,
  cfg: LimitConfig = DEFAULT,
): Promise<NextResponse | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? 'unknown';
  const key = `rl:${req.nextUrl.pathname}:${ip}`;

  try {
    const { allowed, remaining } = await checkRedis(key, cfg);
    if (!allowed) {
      return new NextResponse(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(cfg.window),
          'X-RateLimit-Limit': String(cfg.limit),
          'X-RateLimit-Remaining': '0',
        },
      });
    }
    return null; // allowed
  } catch (err) {
    log.warn({ err }, 'redis rate-limit unavailable — using in-memory fallback');
    const { allowed } = checkMemory(key, cfg);
    if (!allowed) {
      return new NextResponse(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(cfg.window) },
      });
    }
    return null;
  }
}
