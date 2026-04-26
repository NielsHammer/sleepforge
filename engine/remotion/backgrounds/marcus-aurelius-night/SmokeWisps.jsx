import React, { useMemo } from "react";
import { AbsoluteFill } from "remotion";

// ─── Smoke Wisps ────────────────────────────────────────────────────────────
// Drifting smoke / mist plumes.
// Two layers:
//   - Lower: warm sooty plumes rising from off-screen braziers (lower half)
//   - Upper: cool grey atmospheric haze drifting horizontally (upper half)
// Bumped opacity vs the original — was too subtle to register on dark stone.

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const SmokeWisps = ({ frame, fps }) => {
  const lower = useMemo(() => {
    const rng = seededRandom(99);
    return Array.from({ length: 10 }, (_, i) => ({
      id: i,
      startX: rng() * 1920,
      startY: 700 + rng() * 320,
      width: 280 + rng() * 480,
      height: 100 + rng() * 180,
      speed: 0.20 + rng() * 0.45,
      opacity: 0.07 + rng() * 0.10,
      phase: rng() * Math.PI * 2,
      verticalDrift: -(0.05 + rng() * 0.12),
      hue: rng() > 0.4 ? "warm" : "cool",
    }));
  }, []);

  const upper = useMemo(() => {
    const rng = seededRandom(151);
    return Array.from({ length: 7 }, (_, i) => ({
      id: i,
      startX: rng() * 1920,
      startY: 50 + rng() * 380,
      width: 360 + rng() * 520,
      height: 80 + rng() * 140,
      speed: 0.10 + rng() * 0.22,
      opacity: 0.05 + rng() * 0.07,
      phase: rng() * Math.PI * 2,
      verticalDrift: (rng() - 0.5) * 0.04,
    }));
  }, []);

  const time = frame / fps;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Lower warm/cool plumes rising slowly */}
      {lower.map((w) => {
        const x = ((w.startX + w.speed * frame) % (1920 + w.width * 2)) - w.width;
        const y = w.startY + Math.sin(time * 0.22 + w.phase) * 50 + w.verticalDrift * frame;
        const breathe = 0.7 + 0.3 * Math.sin(time * 0.18 + w.phase);
        const opacity = w.opacity * breathe;
        const inner =
          w.hue === "warm"
            ? `rgba(150, 120, 90, ${opacity})`
            : `rgba(140, 138, 135, ${opacity})`;
        const mid =
          w.hue === "warm"
            ? `rgba(90, 70, 50, ${opacity * 0.55})`
            : `rgba(80, 80, 78, ${opacity * 0.55})`;

        return (
          <div
            key={`lo-${w.id}`}
            style={{
              position: "absolute",
              left: x - w.width / 2,
              top: y - w.height / 2,
              width: w.width,
              height: w.height,
              borderRadius: "50%",
              background: `radial-gradient(ellipse at 50% 50%,
                ${inner} 0%,
                ${mid} 40%,
                transparent 75%)`,
              filter: `blur(${24 + w.width * 0.04}px)`,
              transform: `rotate(${Math.sin(time * 0.1 + w.phase) * 8}deg)`,
            }}
          />
        );
      })}

      {/* Upper grey haze drifting across */}
      {upper.map((w) => {
        const x = ((w.startX + w.speed * frame) % (1920 + w.width * 2)) - w.width;
        const y = w.startY + Math.sin(time * 0.12 + w.phase) * 28 + w.verticalDrift * frame;
        const breathe = 0.6 + 0.4 * Math.sin(time * 0.09 + w.phase);
        const opacity = w.opacity * breathe;

        return (
          <div
            key={`up-${w.id}`}
            style={{
              position: "absolute",
              left: x - w.width / 2,
              top: y - w.height / 2,
              width: w.width,
              height: w.height,
              borderRadius: "50%",
              background: `radial-gradient(ellipse at 50% 50%,
                rgba(170, 168, 165, ${opacity}) 0%,
                rgba(110, 108, 105, ${opacity * 0.45}) 45%,
                transparent 75%)`,
              filter: `blur(${30 + w.width * 0.05}px)`,
              transform: `rotate(${Math.sin(time * 0.07 + w.phase) * 6}deg)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
