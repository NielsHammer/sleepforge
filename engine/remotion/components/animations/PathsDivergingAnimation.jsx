import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// A single chalk path rises from the bottom, reaches a fork, and splits
// into two diverging roads. Animated as if drawn by hand.
export const PathsDivergingAnimation = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps; // 0–4s

  const progress = interpolate(t, [0.2, 3.6], [0, 1], { extrapolateRight: 'clamp' });

  const sx = width / 2;
  const sy = height * 0.88;
  const fx = width / 2;
  const fy = height * 0.46; // fork point
  const lx = width * 0.18; const ly = height * 0.1;
  const rx = width * 0.82; const ry = height * 0.1;

  // Phase 0–0.45: draw stem
  const stemP = interpolate(progress, [0, 0.45], [0, 1], { extrapolateRight: 'clamp' });
  // Phase 0.45–1.0: draw branches
  const branchP = interpolate(progress, [0.45, 1.0], [0, 1], { extrapolateRight: 'clamp' });

  const curStemY = sy + (fy - sy) * stemP;
  const curLx = fx + (lx - fx) * branchP;
  const curLy = fy + (ly - fy) * branchP;
  const curRx = fx + (rx - fx) * branchP;
  const curRy = fy + (ry - fy) * branchP;

  const stroke = 'rgba(222,216,202,0.88)';
  const sw = 3.5;

  return (
    <AbsoluteFill style={{ background: '#080808' }}>
      <svg width={width} height={height}>
        {/* Stem */}
        <line
          x1={sx} y1={sy} x2={sx} y2={curStemY}
          stroke={stroke} strokeWidth={sw} strokeLinecap="round"
        />

        {/* Branches (only once stem reaches fork) */}
        {stemP >= 1 && branchP > 0 && (
          <>
            <line
              x1={fx} y1={fy} x2={curLx} y2={curLy}
              stroke={stroke} strokeWidth={sw} strokeLinecap="round"
            />
            <line
              x1={fx} y1={fy} x2={curRx} y2={curRy}
              stroke={stroke} strokeWidth={sw} strokeLinecap="round"
            />
          </>
        )}

        {/* Fork dot */}
        {stemP >= 1 && (
          <circle cx={fx} cy={fy} r={5} fill={stroke} opacity={0.9} />
        )}

        {/* End-point dots */}
        {branchP >= 1 && (
          <>
            <circle cx={lx} cy={ly} r={4.5} fill={stroke} opacity={0.75} />
            <circle cx={rx} cy={ry} r={4.5} fill={stroke} opacity={0.75} />
          </>
        )}

        {/* Subtle label at fork */}
        {stemP >= 1 && (
          <text
            x={fx + 18} y={fy + 26}
            fill="rgba(180,174,162,0.45)"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize={20}
            fontStyle="italic"
          >
            choose
          </text>
        )}
      </svg>
    </AbsoluteFill>
  );
};
