import { NextResponse } from 'next/server';
import { generateDailyReport } from '@/lib/daily-report';

export const runtime = 'nodejs';

export async function POST() {
  const result = await generateDailyReport();
  return NextResponse.json({
    success: result.sent,
    dataRows: result.dataRows,
    error: result.error,
  });
}
