import { NextRequest, NextResponse } from 'next/server';
import { getAccessContext } from '@/lib/access-control';
import { revokeApiKey } from '@/lib/api-keys';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createLogger('api/keys/[id]');

// DELETE /api/keys/:id — revoke an API key
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getAccessContext(req);

  if (ctx.userId === '00000000-0000-0000-0000-000000000000') {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { id } = params;

  try {
    const revoked = await revokeApiKey(id, ctx.userId);
    if (!revoked) {
      return NextResponse.json(
        { success: false, error: 'Key not found or already revoked' },
        { status: 404 },
      );
    }
    log.info({ userId: ctx.userId, keyId: id }, 'API key revoked');
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to revoke key';
    log.error({ err: msg }, 'Revoke key error');
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
