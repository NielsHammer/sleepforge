import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// Closed fist slowly opens; a bird silhouette rises from the palm and drifts away.
export const HandReleasingAnimation = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const cx = width / 2;
  const palmCy = height * 0.62;
  const palmW = 84;
  const palmH = 72;

  // 0–1.4s: hand opens
  const open = interpolate(t, [0.3, 1.6], [0, 1], { extrapolateRight: 'clamp' });
  // 1.4–3s: bird rises
  const birdP = interpolate(t, [1.3, 3.0], [0, 1], { extrapolateRight: 'clamp' });

  const fingerSpread = open * 44;
  const fingerBaseY  = palmCy - palmH / 2;

  const birdX  = cx + birdP * 220 + Math.sin(birdP * Math.PI) * 70;
  const birdY  = palmCy - 30 - birdP * 380 + Math.sin(birdP * Math.PI * 2) * 20;
  const birdSz = interpolate(birdP, [0, 0.15, 1.0], [0, 20, 10], { extrapolateRight: 'clamp' });
  const birdOp = interpolate(birdP, [0, 0.18, 0.78, 1.0], [0, 1, 1, 0], { extrapolateRight: 'clamp' });

  const chalk = 'rgba(222,216,202,0.88)';
  const sw    = 2.5;

  // Finger positions: x fractions across palm width
  const fingerFracs = [0.12, 0.34, 0.55, 0.76];
  // When closed, fingers curl (negative y offset); open = straight up
  const curlY = (1 - open) * 22;

  return (
    <AbsoluteFill style={{ background: '#080808' }}>
      <svg width={width} height={height}>
        {/* Palm rectangle */}
        <rect
          x={cx - palmW / 2} y={palmCy - palmH / 2}
          width={palmW} height={palmH}
          fill="rgba(210,205,190,0.05)"
          stroke={chalk} strokeWidth={sw} rx={12}
        />

        {/* Thumb (left side, rotates outward) */}
        <path
          d={
            `M${cx - palmW / 2} ${palmCy} ` +
            `Q${cx - palmW / 2 - 18 - open * 20} ${palmCy - 8} ` +
            ` ${cx - palmW / 2 - 24 - open * 24} ${palmCy - 28 - open * 8}`
          }
          fill="none" stroke={chalk} strokeWidth={sw} strokeLinecap="round"
        />

        {/* Four fingers */}
        {fingerFracs.map((frac, i) => {
          const fx     = cx - palmW / 2 + palmW * frac;
          const spread = (frac - 0.44) * fingerSpread;
          const topX   = fx + spread * 0.4;
          const topY   = fingerBaseY - 42 - fingerSpread * 0.3 + curlY;
          return (
            <path
              key={i}
              d={`M${fx} ${fingerBaseY} Q${fx + spread * 0.2} ${fingerBaseY - 22} ${topX} ${topY}`}
              fill="none" stroke={chalk} strokeWidth={sw} strokeLinecap="round"
            />
          );
        })}

        {/* Bird silhouette (M-shape, two wing arcs) */}
        {birdP > 0 && (
          <g opacity={birdOp}>
            <path
              d={
                `M${birdX - birdSz} ${birdY}` +
                ` Q${birdX - birdSz * 0.5} ${birdY - birdSz * 0.85} ${birdX} ${birdY}` +
                ` Q${birdX + birdSz * 0.5} ${birdY - birdSz * 0.85} ${birdX + birdSz} ${birdY}`
              }
              fill="none" stroke={chalk} strokeWidth={2} strokeLinecap="round"
            />
          </g>
        )}
      </svg>
    </AbsoluteFill>
  );
};
