import { NextResponse } from 'next/server';
import { scheduler } from '@/lib/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ success: true, status: scheduler.getStatus() });
}
