import { getRejectionStats } from '@/lib/rejection-tracker';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Returns the rejection stats from the most recent scan run. */
export async function GET() {
  const stats = getRejectionStats();
  return NextResponse.json({ success: true, stats });
}
