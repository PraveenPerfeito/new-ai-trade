import { NextResponse } from 'next/server';
import { scheduler } from '@/lib/scheduler';

export const runtime = 'nodejs';

export async function POST() {
  scheduler.stop();
  return NextResponse.json({ success: true, status: scheduler.getStatus() });
}
