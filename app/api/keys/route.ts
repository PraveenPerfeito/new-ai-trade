import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAccessContext } from '@/lib/access-control';
import { createApiKey, listUserApiKeys } from '@/lib/api-keys';
import { parseBody } from '@/lib/validate';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/keys');

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
});

// GET /api/keys — list active API keys for the authenticated user
export async function GET(req: NextRequest) {
  const ctx = await getAccessContext(req);

  if (ctx.userId === '00000000-0000-0000-0000-000000000000') {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const keys = await listUserApiKeys(ctx.userId);
    // Never return key_hash; only safe fields
    const safeKeys = keys.map(({ keyHash: _h, ...rest }) => rest);
    return NextResponse.json({ success: true, data: safeKeys });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to list keys';
    log.error({ err: msg }, 'List keys error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST /api/keys — create a new API key
export async function POST(req: NextRequest) {
  const ctx = await getAccessContext(req);

  if (ctx.userId === '00000000-0000-0000-0000-000000000000') {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { data, error: validationError } = await parseBody(req, createKeySchema);
  if (validationError) return validationError;

  try {
    const result = await createApiKey(ctx.userId, data.name);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Failed to create API key' }, { status: 500 });
    }
    const { apiKey: { keyHash: _h, ...safeKey }, rawKey } = result;
    log.info({ userId: ctx.userId, keyId: safeKey.id }, 'API key created');
    return NextResponse.json({
      success: true,
      data: { ...safeKey, rawKey },  // rawKey shown once only
    }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create key';
    log.error({ err: msg }, 'Create key error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
