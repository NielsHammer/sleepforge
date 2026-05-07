import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// Stone drops into still water at center — 4 chalk rings expand and fade.
// Black background → screen-blend compatible.
export const RipplesAnimation = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const cx = width / 2;
  const cy = height / 2 + 20;
  const maxR = Math.min(width, height) * 0.44;

  const rings = [0, 0.4, 0.8, 1.2];

  return (
    <AbsoluteFill style={{ background: '#080808' }}>
      <svg width={width} height={height}>
        {/* Stone splash (brief dot at center) */}
        {t < 0.3 && (
          <circle
            cx={cx} cy={cy}
            r={interpolate(t, [0, 0.3], [8, 0], { extrapolateRight: 'clamp' })}
            fill="rgba(220,215,200,0.9)"
          />
        )}
        {rings.map((delay, i) => {
          const age = t - delay;
          if (age <= 0) return null;
          const r    = interpolate(age, [0, 2.6], [8, maxR], { extrapolateRight: 'clamp' });
          const op   = interpolate(age, [0, 0.25, 2.3, 2.6], [0, 0.75, 0.35, 0], { extrapolateRight: 'clamp' });
          const sw   = interpolate(age, [0, 2.6], [3.5, 0.8], { extrapolateRight: 'clamp' });
          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="rgba(228,222,205,1)"
              strokeWidth={sw}
              opacity={op}
            />
          );
        })}
        {/* Subtle horizontal water line */}
        <line
          x1={cx - maxR * 0.7} y1={cy}
          x2={cx + maxR * 0.7} y2={cy}
          stroke="rgba(180,175,162,0.15)"
          strokeWidth={1}
        />
      </svg>
    </AbsoluteFill>
  );
};
