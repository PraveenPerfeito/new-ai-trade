import { z } from 'zod';
import { createLogger } from './logger';

const log = createLogger('lib/env');

const schema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.coerce.number().int().default(3000),

  // Supabase (required)
  NEXT_PUBLIC_SUPABASE_URL:      z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY:     z.string().min(10, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // Anthropic (optional — heuristic fallback when absent)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Telegram (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID:   z.string().optional(),

  // CoinGecko (optional)
  COINGECKO_API_KEY: z.string().optional(),

  // Scanner tuning
  SCANNER_MIN_CONFIDENCE_ALERT: z.coerce.number().int().min(50).max(100).default(85),
  SCANNER_DELAY_MS:             z.coerce.number().int().min(50).max(10_000).default(300),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Middleware rate limiting (per IP per window)
  RATE_LIMIT_MAX:       z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

  // Redis
  REDIS_URL: z.string().url().optional(), // redis://localhost:6379/0

  // CORS
  ALLOWED_ORIGINS: z.string().optional(), // comma-separated list e.g. "https://app.example.com"

  // Admin auth
  // Comma-separated admin email addresses. MUST be set in production.
  // If unset, all admin routes are blocked (safe default).
  ADMIN_EMAILS: z.string().optional(),

  // Shared secret between the Next.js proxy and the Python FastAPI backend.
  // Generate with: openssl rand -hex 32
  // If unset, the Python backend accepts all proxied requests (fine for local dev).
  ADMIN_SECRET: z.string().optional(),

  // Python backend base URL (used by the /api/admin/* proxy)
  BACKEND_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

let _validated: Env | null = null;

function validate(): Env {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Intentional throw — missing required config is a fatal startup error
    throw new Error(`Environment validation failed:\n${issues}\n\nCheck your .env.local file.`);
  }

  const e = result.data;

  // Warn about optional-but-recommended vars
  if (!e.ANTHROPIC_API_KEY) {
    log.warn('ANTHROPIC_API_KEY not set — AI validation will use heuristic fallback');
  }
  if (!e.TELEGRAM_BOT_TOKEN || !e.TELEGRAM_CHAT_ID) {
    log.warn('Telegram not configured — signal alerts disabled');
  }

  return e;
}

export function getEnv(): Env {
  if (!_validated) _validated = validate();
  return _validated;
}

// Proxy provides direct property access: `env.LOG_LEVEL`
export const env = new Proxy({} as Env, {
  get(_, key: string) {
    return getEnv()[key as keyof Env];
  },
});
