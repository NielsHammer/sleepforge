import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

// SleepForge fireplace-room ambience overlay.
//
// Goal (per Niels): "the ambience of a fireplace in the room with us."
// NOT a tight column of sparks rising from a fire. The viewer is sitting in
// a softly-lit room where embers drift through the air around them — so:
//
//   - Sparks are scattered across the FULL frame, not just the bottom half
//   - Each spark has its OWN trajectory, speed, sway, and lifetime — no
//     two move alike. The eye must never read "uniform marching grid".
//   - Lower count (35) so the room feels intimate, not pyrotechnic.
//   - Per-spark sin-driven micro-curl gives each ember a slight orbit-y
//     motion instead of a straight upward line, like air currents in a room.
//   - Three "layers": near (large, bright, slow), mid, far (tiny, dim, fast)
//     — gives parallax depth so the room feels three-dimensional.
//
// Composed downstream with blend=screen, so the black background drops
// out and only the warm glow lands on top of the chalk image.

const SPARK_COUNT = 35;

// Tiny PRNG seeded by index — each spark gets its own deterministic
// "personality" (speed, sway, drift direction, life duration).
function rand(seed, salt) {
  const s = Math.sin(seed * 137.508 + salt * 9301.7) * 43758.5453;
  return s - Math.floor(s);
}

export const FireplaceParticles = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          {/* Soft glow: warm radial gradient — white-hot core fading to dark amber rim */}
          <radialGradient id="emberGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff4d8" stopOpacity="1" />
            <stop offset="35%" stopColor="#ffb070" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#ff7030" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ff4010" stopOpacity="0" />
          </radialGradient>
        </defs>

        {Array.from({ length: SPARK_COUNT }).map((_, i) => {
          // Per-spark personality — varies everything so no two sparks drift alike
          const driftSpeed = 4 + rand(i, 1) * 14;        // 4..18 px/s upward drift
          const swayAmp = 18 + rand(i, 2) * 36;          // 18..54 px horizontal sway range
          const swayFreq = 0.25 + rand(i, 3) * 0.55;     // 0.25..0.8 Hz sway speed
          const lifetime = 4 + rand(i, 4) * 6;           // 4..10s lifetime
          const phase = rand(i, 5) * lifetime;           // birth offset in cycle
          const baseSize = 1.5 + rand(i, 6) * 5;         // 1.5..6.5 px base radius
          const xCurve = rand(i, 7);                     // 0..1 curl direction bias
          const layer = rand(i, 8);                      // 0..1 depth layer

          const age = (t + phase) % lifetime;            // 0..lifetime
          const lifeT = age / lifetime;                  // 0..1 within a single life

          // Spawn position scattered across FULL frame — sparks drift through
          // the whole room, not just rising from the floor.
          const spawnX = rand(i, 9) * width;
          const spawnY = rand(i, 10) * height;

          // Drift: mostly upward, slight horizontal curl per-spark
          const sway = Math.sin(t * swayFreq + i) * swayAmp + (xCurve - 0.5) * 60;
          const x = spawnX + sway;
          const y = spawnY - driftSpeed * age + Math.sin(t * 0.4 + i * 0.7) * 8;

          // Wrap vertically so a spark that exits the top reappears at the
          // bottom in the same column — gives the impression of an endless
          // stream of embers without hard pop-in.
          const wrappedY = ((y % height) + height) % height;

          // Life curve: brightness peaks at half-life via sin pulse, with
          // slight per-spark intensity variation so not all peak together.
          const intensity = 0.4 + rand(i, 11) * 0.6;
          const life = Math.sin(Math.PI * lifeT) * intensity;

          // Layer-based size + opacity — far layer = small + dim, near = big + bright
          const layerDim = 0.5 + layer * 0.5;
          const radius = baseSize * (0.5 + life * 0.7);
          const opacity = life * layerDim;

          if (opacity <= 0.02) return null;

          return (
            <circle
              key={`spark${i}`}
              cx={x}
              cy={wrappedY}
              r={radius}
              fill="url(#emberGlow)"
              opacity={opacity}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
