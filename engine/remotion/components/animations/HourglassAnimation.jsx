import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// Sand flows from upper to lower chamber over 4s. Particles stream through the neck.
export const HourglassAnimation = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const cx  = width / 2;
  const cy  = height / 2;
  const hw  = 110; // half-width at top/bottom edge
  const hh  = 185; // half-height of each chamber
  const nw  = 7;   // half-width of neck

  const fill = interpolate(t, [0.4, 3.6], [0, 1], { extrapolateRight: 'clamp' });

  // Sand surfaces
  const topSandTop = cy - hh + (fill * hh);  // top surface drops
  const botSandTop = cy + hh - (fill * hh);  // bottom surface rises (from the bottom)

  const chalk = 'rgba(222,216,202,0.88)';
  const sw    = 2.5;

  // Hourglass outline paths (two trapezoids, tip-to-tip at neck)
  const topPath  = `M${cx - hw} ${cy - hh * 2} L${cx + hw} ${cy - hh * 2} L${cx + nw} ${cy} L${cx - nw} ${cy} Z`;
  const botPath  = `M${cx - nw} ${cy} L${cx + nw} ${cy} L${cx + hw} ${cy + hh * 2} L${cx - hw} ${cy + hh * 2} Z`;

  // Particles falling through neck
  const particles = [];
  if (fill > 0.02 && fill < 0.98) {
    for (let i = 0; i < 5; i++) {
      const phase = (t * 2.5 + i * 0.22) % 1;
      // Travel from neck top (cy) down through bot chamber
      const py  = cy + phase * (hh * 2 * fill - 4);
      const px  = cx + (Math.sin(i * 2.6) * 2.5);
      particles.push({ x: px, y: py, op: 0.55 + phase * 0.3 });
    }
  }

  return (
    <AbsoluteFill style={{ background: '#080808' }}>
      <svg width={width} height={height}>
        {/* Cap lines */}
        <line x1={cx - hw - 10} y1={cy - hh * 2} x2={cx + hw + 10} y2={cy - hh * 2} stroke={chalk} strokeWidth={3} />
        <line x1={cx - hw - 10} y1={cy + hh * 2} x2={cx + hw + 10} y2={cy + hh * 2} stroke={chalk} strokeWidth={3} />

        {/* Outline (no fill so sand shows through) */}
        <path d={topPath}  fill="none" stroke={chalk} strokeWidth={sw} strokeLinejoin="round" />
        <path d={botPath}  fill="none" stroke={chalk} strokeWidth={sw} strokeLinejoin="round" />

        {/* Top sand (shrinking from below) */}
        <clipPath id="hg-top">
          <path d={topPath} />
        </clipPath>
        <rect
          x={cx - hw} y={topSandTop}
          width={hw * 2} height={cy - topSandTop}
          fill="rgba(205,196,168,0.22)"
          clipPath="url(#hg-top)"
        />

        {/* Bottom sand (growing from below) */}
        <clipPath id="hg-bot">
          <path d={botPath} />
        </clipPath>
        <rect
          x={cx - hw} y={botSandTop}
          width={hw * 2} height={cy + hh * 2 - botSandTop}
          fill="rgba(205,196,168,0.22)"
          clipPath="url(#hg-bot)"
        />

        {/* Falling particles */}
        {particles.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2} fill={chalk} opacity={p.op} />
        ))}
      </svg>
    </AbsoluteFill>
  );
};
