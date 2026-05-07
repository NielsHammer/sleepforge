import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// Candle with flickering flame and wax pool. Chalk-white on black.
// Screen-blend compatible: only the lit areas register.
export const CandleAnimation = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const cx = width / 2;
  const baseY = height * 0.72;
  const candleW = 56;
  const candleH = 200;
  const topY = baseY - candleH;

  // Organic flicker via overlapping sine waves
  const flicker = Math.sin(t * 8.3) * 0.14 + Math.sin(t * 5.1) * 0.09 + Math.sin(t * 13.7) * 0.05;
  const flameH  = 75 + flicker * 28;
  const flameW  = 30 + flicker * 8;
  const lean    = Math.sin(t * 2.8) * 7;

  const fadeIn  = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const chalk   = 'rgba(224,218,204,0.88)';

  return (
    <AbsoluteFill style={{ background: '#080808' }}>
      <svg width={width} height={height} opacity={fadeIn}>
        {/* Ambient glow from flame */}
        <ellipse
          cx={cx + lean} cy={topY - flameH * 0.45}
          rx={flameW * 2.5} ry={flameH * 0.9}
          fill="rgba(255,165,50,0.04)"
        />

        {/* Candle body */}
        <rect
          x={cx - candleW / 2} y={topY}
          width={candleW} height={candleH}
          fill="rgba(220,214,198,0.06)"
          stroke={chalk} strokeWidth={2}
          rx={3}
        />

        {/* Wick */}
        <line
          x1={cx + lean * 0.2} y1={topY}
          x2={cx + lean * 0.2} y2={topY - 14}
          stroke="rgba(170,160,130,0.8)" strokeWidth={2.5} strokeLinecap="round"
        />

        {/* Flame outer glow */}
        <ellipse
          cx={cx + lean} cy={topY - flameH * 0.5}
          rx={flameW * 1.25} ry={flameH * 0.55}
          fill="rgba(255,185,65,0.12)"
        />

        {/* Flame body */}
        <path
          d={
            `M${cx + lean} ${topY - 12}` +
            ` C${cx + lean - flameW * 0.55} ${topY - flameH * 0.5}` +
            `   ${cx + lean - flameW * 0.3} ${topY - flameH * 0.88}` +
            `   ${cx + lean} ${topY - flameH}` +
            ` C${cx + lean + flameW * 0.3} ${topY - flameH * 0.88}` +
            `   ${cx + lean + flameW * 0.55} ${topY - flameH * 0.5}` +
            `   ${cx + lean} ${topY - 12} Z`
          }
          fill="rgba(255,220,155,0.65)"
          stroke="rgba(255,210,120,0.4)"
          strokeWidth={1}
        />

        {/* Wax pool at base */}
        <ellipse
          cx={cx} cy={baseY}
          rx={candleW / 2 + 10} ry={9}
          fill="none" stroke="rgba(220,214,198,0.45)" strokeWidth={2}
        />

        {/* Single drip streak on candle side */}
        <path
          d={`M${cx + candleW / 2 - 8} ${topY + 20} Q${cx + candleW / 2 - 5} ${topY + 55} ${cx + candleW / 2 - 10} ${topY + 80}`}
          fill="none" stroke="rgba(220,214,198,0.3)" strokeWidth={2} strokeLinecap="round"
        />
      </svg>
    </AbsoluteFill>
  );
};
