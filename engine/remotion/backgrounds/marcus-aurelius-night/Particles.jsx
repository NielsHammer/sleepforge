import React, { useMemo } from "react";
import { AbsoluteFill, interpolate } from "remotion";

// ─── Sparkle Particles ──────────────────────────────────────────────────────
// Floating dust/sparkle particles that drift slowly across the scene.
// Creates a mystical, ancient library atmosphere.
// All particles are white/grey dots — no color.

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const Particles = ({ frame, fps, count = 60 }) => {
  const particles = useMemo(() => {
    const rng = seededRandom(42);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      startX: rng() * 1920,
      startY: rng() * 1080,
      speed: 0.3 + rng() * 0.8, // pixels per frame
      size: 1 + rng() * 2.5,
      opacity: 0.15 + rng() * 0.45,
      phase: rng() * Math.PI * 2,
      drift: (rng() - 0.5) * 0.5, // horizontal drift
      twinkleSpeed: 0.5 + rng() * 2,
    }));
  }, [count]);

  const time = frame / fps;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {particles.map((p) => {
        // Slow upward drift with horizontal sway
        const y = ((p.startY - p.speed * frame * 0.5) % 1200 + 1200) % 1200 - 60;
        const x = p.startX + Math.sin(time * 0.3 + p.phase) * 30 + p.drift * frame * 0.3;
        const wrappedX = ((x % 2040) + 2040) % 2040 - 60;

        // Twinkle effect
        const twinkle = 0.5 + 0.5 * Math.sin(time * p.twinkleSpeed + p.phase);
        const opacity = p.opacity * twinkle;

        return (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: wrappedX,
              top: y,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: `rgba(200, 200, 210, ${opacity})`,
              boxShadow: p.size > 2
                ? `0 0 ${p.size * 2}px rgba(200, 200, 210, ${opacity * 0.5})`
                : "none",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
