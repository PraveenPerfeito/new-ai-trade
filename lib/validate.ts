import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';

type ValidationOk<T>  = { data: T;    error: null };
type ValidationErr    = { data: null; error: NextResponse };

function buildError(message: string, errors: { field: string; message: string }[], status: number): NextResponse {
  return NextResponse.json({ success: false, error: message, errors }, { status });
}

function toFieldErrors(zodError: z.ZodError): { field: string; message: string }[] {
  return zodError.issues.map(i => ({
    field:   i.path.join('.') || 'root',
    message: i.message,
  }));
}

export function parseQuery<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): ValidationOk<z.infer<S>> | ValidationErr {
  const raw    = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(raw);

  if (!result.success) {
    return { data: null, error: buildError('Invalid query parameters', toFieldErrors(result.error), 400) };
  }
  return { data: result.data, error: null };
}

export async function parseBody<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<ValidationOk<z.infer<S>> | ValidationErr> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { data: null, error: buildError('Invalid JSON body', [], 400) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return { data: null, error: buildError('Invalid request body', toFieldErrors(result.error), 400) };
  }
  return { data: result.data, error: null };
}

// ─── Common schemas ───────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const scannerModeSchema = z.enum(['spot', 'futures', 'high_confidence', 'trending']);

export const scanBodySchema = z.object({
  mode:  scannerModeSchema.default('spot'),
  // Optional list of coin symbols to restrict scan to (e.g. single/multi/watchlist modes)
  coins: z.array(z.string().min(1).max(20).toUpperCase()).max(100).optional(),
});

export const signalsQuerySchema = z.object({
  limit:         z.coerce.number().int().min(1).max(200).default(50),
  minConfidence: z.coerce.number().int().min(0).max(100).default(70),
});

export const backtestBodySchema = z.object({
  mode:           scannerModeSchema.default('spot'),
  lookbackDays:   z.coerce.number().int().min(1).max(90).default(14),
  maxHoldCandles: z.coerce.number().int().min(1).max(200).default(48),
  strategyName:   z.string().min(1).max(100).default('Default Strategy'),
  minRRRatio:     z.coerce.number().min(0.5).max(10).default(2.0),
  maxCoins:       z.coerce.number().int().min(1).max(50).default(20),
});

export const schedulerStartSchema = z.object({
  mode:            scannerModeSchema.optional(),
  intervalMinutes: z.coerce.number().int().min(1).max(60).optional(),
  intervalMs:      z.coerce.number().int().min(60_000).max(3_600_000).optional(),
});

// ─── Phase 7 schemas ──────────────────────────────────────────────────────────

export const scannerControlSchema = z.object({
  action: z.enum(['start', 'stop', 'pause', 'resume', 'emergency_stop', 'reset', 'configure']),
  config: z.object({
    mode:          scannerModeSchema.optional(),
    intervalMs:    z.coerce.number().int().min(60_000).max(3_600_000).optional(),
    minConfidence: z.coerce.number().int().min(50).max(100).optional(),
    minVolume:     z.coerce.number().min(0).optional(),
    minMarketCap:  z.coerce.number().min(0).optional(),
    rrMinimum:     z.coerce.number().min(0.5).max(10).optional(),
    maxCoins:      z.coerce.number().int().min(1).max(200).optional(),
    coins:         z.array(z.string().min(1).max(20).toUpperCase()).max(200).optional(),
  }).optional(),
});

export const tacticalQuerySchema = z.object({
  limit:          z.coerce.number().int().min(1).max(200).default(100),
  minConfidence:  z.coerce.number().int().min(0).max(100).default(70),
  lifecycleStage: z.enum([
    'VALIDATED', 'AI_APPROVED', 'TELEGRAM_SENT', 'ACTIVE',
    'STALE', 'TP_HIT', 'SL_HIT', 'CLOSED', 'ANALYZED', 'all',
  ]).default('all'),
  type:  z.enum(['BUY', 'SELL', 'all']).default('all'),
  mode:  z.enum(['spot', 'futures', 'high_confidence', 'trending', 'all']).default('all'),
});
