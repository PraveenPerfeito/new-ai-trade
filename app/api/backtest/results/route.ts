import { NextRequest, NextResponse } from 'next/server';
import { getBacktestRuns } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '20'), 50);
  const runs  = await getBacktestRuns(limit);
  return NextResponse.json({ success: true, runs });
}
