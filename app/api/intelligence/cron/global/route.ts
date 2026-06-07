import { NextResponse } from 'next/server';
import { tickGlobal } from '@/lib/intelligence/workers';

export const runtime    = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request): Promise<NextResponse> {
  const auth = request.headers.get('Authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await tickGlobal();
  return NextResponse.json({ ok: true });
}
