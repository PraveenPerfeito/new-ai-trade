/**
 * Production startup validation.
 *
 * Call once at app startup (e.g. from lib/scheduler.ts or a Next.js
 * instrumentation hook).  In production, missing critical env vars throw
 * immediately so the process fails loudly rather than silently misbehaving
 * at the first API call.
 *
 * In development, missing vars emit warnings but do NOT throw.
 */
import { createLogger } from './logger';

const log = createLogger('lib/startup-check');

interface CheckResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * REQUIRED in production — absence means a security bypass or total failure.
 */
const PRODUCTION_REQUIRED: Array<{ key: string; reason: string }> = [
  {
    key:    'ADMIN_EMAILS',
    reason: 'Without ADMIN_EMAILS every authenticated Supabase user gets full admin access.',
  },
  {
    key:    'ADMIN_SECRET',
    reason: 'Without ADMIN_SECRET the Python FastAPI backend accepts requests from anyone.',
  },
  {
    key:    'SUPABASE_SERVICE_ROLE_KEY',
    reason: 'Required for server-side database writes that bypass RLS.',
  },
  {
    key:    'NEXT_PUBLIC_SUPABASE_URL',
    reason: 'Required for all Supabase operations.',
  },
  {
    key:    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    reason: 'Required for client-side Supabase auth.',
  },
];

/**
 * RECOMMENDED — missing triggers a warning, not a fatal error.
 */
const RECOMMENDED: Array<{ key: string; reason: string }> = [
  { key: 'REDIS_URL',           reason: 'Provider metrics and caching will use in-memory fallback only.' },
  { key: 'BACKEND_URL',         reason: 'Admin panel cannot reach Python FastAPI backend.' },
  { key: 'ANTHROPIC_API_KEY',   reason: 'AI validation will use heuristic fallback for all signals.' },
  { key: 'TELEGRAM_BOT_TOKEN',  reason: 'Signal alerts and scan failure notifications are disabled.' },
  { key: 'ALLOWED_ORIGINS',     reason: 'All cross-origin API requests are denied in production.' },
];

export function runStartupCheck(): CheckResult {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { key, reason } of PRODUCTION_REQUIRED) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      if (isProduction) {
        errors.push(`${key} is not set. ${reason}`);
      } else {
        warnings.push(`${key} is not set (dev-mode warning). ${reason}`);
      }
    }
  }

  for (const { key, reason } of RECOMMENDED) {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      warnings.push(`${key} is not set. ${reason}`);
    }
  }

  const passed = errors.length === 0;

  for (const w of warnings) {
    log.warn(`startup_warning: ${w}`);
  }

  if (!passed) {
    for (const e of errors) {
      log.error(`startup_error: ${e}`);
    }
    throw new Error(
      `\n\n🚨 STARTUP FAILED — Missing required environment variables:\n` +
      errors.map(e => `  • ${e}`).join('\n') +
      `\n\nSet these in your .env.local (development) or deployment environment (production).\n`,
    );
  }

  log.info({ warnings: warnings.length }, 'startup_check_passed');
  return { passed, errors, warnings };
}
