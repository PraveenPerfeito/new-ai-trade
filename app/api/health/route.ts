import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckStatus = 'ok' | 'degraded' | 'down';

interface HealthCheck {
  status:      CheckStatus;
  latencyMs?:  number;
  message?:    string;
}

async function checkSupabase(): Promise<HealthCheck> {
  const t0  = Date.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { status: 'down', message: 'Supabase env vars not configured' };
  }

  try {
    const client  = createClient(url, key);
    const { error } = await client.from('coins').select('id').limit(1);
    return {
      status:    error ? 'degraded' : 'ok',
      latencyMs: Date.now() - t0,
      ...(error && { message: error.message }),
    };
  } catch (err) {
    return {
      status:    'down',
      latencyMs: Date.now() - t0,
      message:   err instanceof Error ? err.message : String(err),
    };
  }
}

function checkAnthropicConfig(): HealthCheck {
  return process.env.ANTHROPIC_API_KEY
    ? { status: 'ok' }
    : { status: 'degraded', message: 'API key not set — heuristic fallback active' };
}

function checkWhatsAppConfig(): HealthCheck {
  return process.env.WHATSAPP_TOKEN
    ? { status: 'ok' }
    : { status: 'degraded', message: 'Not configured — WhatsApp alerts disabled' };
}

function checkCoinGeckoConfig(): HealthCheck {
  return process.env.COINGECKO_API_KEY
    ? { status: 'ok' }
    : { status: 'degraded', message: 'No API key — using free tier (lower rate limits)' };
}

export async function GET() {
  const t0 = Date.now();

  const [supabase] = await Promise.all([checkSupabase()]);

  // Fix 5: omit per-service check details from public response to reduce
  // configuration disclosure. Only overall status is returned externally.
  const checks: Record<string, HealthCheck> = {
    supabase,
    anthropic:  checkAnthropicConfig(),
    whatsapp:   checkWhatsAppConfig(),
    coingecko:  checkCoinGeckoConfig(),
  };

  const statuses     = Object.values(checks).map(c => c.status);
  const overallStatus: CheckStatus =
    statuses.includes('down')     ? 'down'     :
    statuses.includes('degraded') ? 'degraded' : 'ok';

  const body = {
    status:      overallStatus,
    version:     process.env.npm_package_version ?? '0.1.0',
    uptime:      Math.round(process.uptime()),
    uptimeHuman: formatUptime(process.uptime()),
    timestamp:   new Date().toISOString(),
    responseMs:  Date.now() - t0,
    // Individual check details intentionally omitted from public response
    // to avoid exposing which external services are configured/absent.
  };

  return NextResponse.json(body, {
    status:  overallStatus === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store, no-cache', 'Content-Type': 'application/json' },
  });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}
