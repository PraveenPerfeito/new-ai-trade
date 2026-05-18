'use client';

import { useMemo } from 'react';

interface Props {
  data:        number[];   // cumulative equity curve (starts at 0)
  height?:     number;
  showLabels?: boolean;
}

export function EquityChart({ data, height = 130, showLabels = true }: Props) {
  const W  = 560;
  const H  = height;
  const PL = showLabels ? 42 : 6;
  const PR = 6;
  const PT = 8;
  const PB = showLabels ? 18 : 6;
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const { linePts, areaPath, zeroY, minV, maxV, lastV } = useMemo(() => {
    if (!data || data.length < 2) {
      return { linePts: '', areaPath: '', zeroY: PT + cH / 2, minV: 0, maxV: 0, lastV: 0 };
    }

    const min = Math.min(...data, 0);
    const max = Math.max(...data, 0);
    const rng = max - min || 1;

    const toY = (v: number) => PT + cH - ((v - min) / rng) * cH;
    const toX = (i: number) => PL + (i / (data.length - 1)) * cW;
    const zY  = toY(0);

    const pts = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

    // Area path: from (first x, zeroY) → trace line → back to (last x, zeroY)
    const lineSeg = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
    const area    = `${lineSeg} L ${(PL + cW).toFixed(1)} ${zY.toFixed(1)} L ${PL.toFixed(1)} ${zY.toFixed(1)} Z`;

    return { linePts: pts, areaPath: area, zeroY: zY, minV: min, maxV: max, lastV: data[data.length - 1] };
  }, [data, cH, cW, PL, PT]);

  const positive  = lastV >= 0;
  const lineColor = positive ? '#00d084' : '#ff3b5c';

  // Tick marks along X axis (5 evenly spaced)
  const xTicks = useMemo(() => {
    if (!data || data.length < 2) return [];
    const n = Math.min(5, data.length - 1);
    return Array.from({ length: n + 1 }, (_, i) => {
      const idx = Math.round((i / n) * (data.length - 1));
      const x   = PL + (idx / (data.length - 1)) * cW;
      return { x: x.toFixed(1), label: `T${idx + 1}` };
    });
  }, [data, cW, PL]);

  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-terminal-muted text-xs" style={{ height }}>
        No trade data
      </div>
    );
  }

  const gradId  = `eq-${positive ? 'pos' : 'neg'}`;
  const fillClr = positive ? '#00d084' : '#ff3b5c';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height, display: 'block' }}
      aria-label="Equity curve"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={fillClr} stopOpacity={positive ? 0.22 : 0.04} />
          <stop offset="100%" stopColor={fillClr} stopOpacity={positive ? 0.02 : 0.22} />
        </linearGradient>
        <clipPath id="eq-clip">
          <rect x={PL} y={PT} width={cW} height={cH} />
        </clipPath>
      </defs>

      {/* Grid lines (3 horizontal) */}
      {[0.25, 0.5, 0.75].map(f => {
        const y = (PT + f * cH).toFixed(1);
        return (
          <line key={f}
            x1={PL} y1={y} x2={PL + cW} y2={y}
            stroke="#1e2d3d" strokeWidth="1"
          />
        );
      })}

      {/* Zero baseline */}
      <line
        x1={PL} y1={zeroY.toFixed(1)} x2={PL + cW} y2={zeroY.toFixed(1)}
        stroke="#334155" strokeWidth="1" strokeDasharray="4 3"
      />

      {/* Area fill */}
      <path d={areaPath} fill={`url(#${gradId})`} clipPath="url(#eq-clip)" />

      {/* Equity line */}
      <polyline
        points={linePts}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath="url(#eq-clip)"
      />

      {/* End dot */}
      {data.length > 1 && (() => {
        const lx = PL + cW;
        const ly = PT + cH - ((lastV - Math.min(...data, 0)) / ((Math.max(...data, 0) - Math.min(...data, 0)) || 1)) * cH;
        return (
          <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="3"
            fill={lineColor} stroke="#060d16" strokeWidth="1.5" />
        );
      })()}

      {/* Y-axis labels */}
      {showLabels && (
        <>
          <text x={PL - 4} y={(PT + 5).toFixed(1)}           fill="#64748b" fontSize="9" textAnchor="end">{maxV.toFixed(1)}%</text>
          <text x={PL - 4} y={(zeroY + 3).toFixed(1)}         fill="#64748b" fontSize="9" textAnchor="end">0%</text>
          <text x={PL - 4} y={(PT + cH + 4).toFixed(1)}       fill="#64748b" fontSize="9" textAnchor="end">{minV.toFixed(1)}%</text>
        </>
      )}

      {/* X-axis trade count ticks */}
      {showLabels && xTicks.map(t => (
        <text key={t.label} x={t.x} y={(H - 3).toFixed(1)} fill="#475569" fontSize="8" textAnchor="middle">
          {t.label}
        </text>
      ))}

      {/* Border */}
      <rect x={PL} y={PT} width={cW} height={cH}
        fill="none" stroke="#1e2d3d" strokeWidth="1" />
    </svg>
  );
}
