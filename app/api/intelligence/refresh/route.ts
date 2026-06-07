import { NextResponse } from 'next/server';
import { preloadIntelligence } from '@/lib/intelligence';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api/intelligence/refresh');

/**
 * POST /api/intelligence/refresh
 * Triggered by the Python scan worker (Railway) after each scan cycle to ensure
 * the Redis intelligence cache stays warm on Vercel where setInterval workers
 * stop after Lambda idle timeout (~5 min).
 *
 * Protected by ADMIN_SECRET so only the Python backend can invoke it.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-admin-secret');
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await preloadIntelligence();
    log.info({ refreshed: result.groupsRefreshed, skipped: result.groupsSkipped }, 'intelligence cache refreshed by scan worker');
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ error: message }, 'intelligence refresh failed');
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
