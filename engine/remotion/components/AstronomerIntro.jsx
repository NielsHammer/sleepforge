import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  staticFile,
  Img,
} from "remotion";

// ─── Constants ───────────────────────────────────────────────────────────────
const TOTAL = 143;      // 4.754s @ 30fps
const P1_END = 36;      // Hyperspace streaks dissolve by this frame
const P2_END = 90;      // Logo finishes travelling, arrives at center
const LOGO_FINAL = 340; // px diameter at full size
const CX = 960;         // screen center X
const CY = 540;         // screen center Y

// ─── Seeded LCG RNG — same seed → same layout every render ──────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0xffffffff;
  };
}

// ─── Phase 1: Hyperspace streak layer ────────────────────────────────────────
// Stars as elongated radial lines pointing away from center (warp-speed look).
function StarStreakLayer({ count, seed, frame }) {
  const rng = makeRng(seed);

  // Streak length: zero → peak → zero as hyperspace phase fades out
  const streakLen = interpolate(frame, [0, 12, P1_END, P1_END + 18], [0, 110, 140, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const layerOp = interpolate(frame, [0, 4, P1_END, P1_END + 14], [0, 0.9, 0.9, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (layerOp < 0.01) return null;

  const elements = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    // Stars distributed at varying distances from center — creates depth
    const minDist = 60 + rng() * 100;
    const dist = minDist + rng() * 480;

    // Streak extends radially outward from the star's position
    const x1 = CX + Math.cos(angle) * dist;
    const y1 = CY + Math.sin(angle) * dist;
    // Streak length scales with distance (far stars streak more — parallax)
    const depthMult = 0.3 + (dist / 580) * 0.7;
    const x2 = CX + Math.cos(angle) * (dist + streakLen * depthMult);
    const y2 = CY + Math.sin(angle) * (dist + streakLen * depthMult);

    const starOp = (0.35 + rng() * 0.55) * layerOp;
    const tint = rng() < 0.18;
    const color = tint ? `rgba(180,170,255,${starOp})` : `rgba(255,255,255,${starOp})`;
    const strokeW = 0.6 + rng() * 1.2;

    elements.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
    );
  }
  return <>{elements}</>;
}

// ─── Phase 2-3: Normal parallax drifting star dots ───────────────────────────
function StarDotLayer({ count, seed, driftX, driftY, minOp, maxOp, minR, maxR, globalOp, frame }) {
  const rng = makeRng(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const baseX = rng() * 1920;
    const baseY = rng() * 1080;
    const r = minR + rng() * (maxR - minR);
    const op = minOp + rng() * (maxOp - minOp);
    const twinklePhase = rng() * Math.PI * 2;
    const twinkle = 0.85 + 0.15 * Math.sin(twinklePhase + frame * 0.07);
    const x = ((baseX + driftX * frame) % 1920 + 1920) % 1920;
    const y = ((baseY + driftY * frame) % 1080 + 1080) % 1080;
    const tint = rng() < 0.2;
    const color = tint
      ? `rgba(180,170,255,${op * twinkle * globalOp})`
      : `rgba(255,255,255,${op * twinkle * globalOp})`;
    stars.push(<circle key={i} cx={x} cy={y} r={r} fill={color} />);
  }
  return <>{stars}</>;
}

// ─── AstronomerIntro ─────────────────────────────────────────────────────────
// 4.754s, 143 frames at 30fps. Three phases:
//   f  0-36: Hyperspace — star streaks radiate outward, logo is a tiny distant point
//   f 30-90: Travel    — logo grows, arcs slowly across space, nebula blooms, particle trail
//   f 90-143: Arrival  — logo locks to center, gold ring blooms, stars settle
export const AstronomerIntro = ({ logoPath = null }) => {
  const frame = useCurrentFrame();

  // ── Logo arc drift — sinusoidal sway fades in during travel, dies out on arrival ──
  const driftAmt = interpolate(
    frame,
    [P1_END - 4, P1_END + 8, P2_END - 8, P2_END + 12],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const logoX = Math.sin(frame * 0.055) * 85 * driftAmt;
  const logoY = Math.cos(frame * 0.038) * 42 * driftAmt;

  // ── Logo scale: tiny distant point → full size ──
  const logoScale = interpolate(
    frame,
    [0, 16, 52, P2_END, 108],
    [0.006, 0.018, 0.40, 0.90, 1.0],
    { extrapolateRight: "clamp" }
  );

  // ── Logo opacity — visible from the first few frames ──
  const logoOp = interpolate(frame, [2, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ── Star dots: fade in as hyperspace ends ──
  const dotStarOp = interpolate(frame, [P1_END - 4, P1_END + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ── Nebula: blooms during travel, persists ──
  const nebulaOp = interpolate(
    frame,
    [P1_END, P1_END + 22, P2_END, TOTAL],
    [0, 0.44, 0.50, 0.36],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  // Nebula parallax: follows logo at 28% of drift amplitude
  const nebX = logoX * 0.28;
  const nebY = logoY * 0.28;

  // ── Particle trail — 8 gold dots at past logo positions ──
  const trailActive = interpolate(
    frame,
    [P1_END, P1_END + 10, P2_END - 4, P2_END + 8],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const trail = [];
  for (let i = 0; i < 8; i++) {
    const delay = (i + 1) * 5;
    const pf = Math.max(0, frame - delay);
    const pDrift = interpolate(
      pf,
      [P1_END - 4, P1_END + 8, P2_END - 8, P2_END + 12],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const px = Math.sin(pf * 0.055) * 85 * pDrift;
    const py = Math.cos(pf * 0.038) * 42 * pDrift;
    const particleOp = (1 - i / 8) * 0.55 * trailActive;
    const particleR = 1.5 + (1 - i / 8) * 4;
    trail.push({ px, py, particleOp, particleR });
  }

  // ── Gold ring bloom: activates on arrival ──
  const ringBloom = interpolate(
    frame,
    [P2_END, P2_END + 14, TOTAL - 18, TOTAL],
    [0, 28, 18, 14],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const ringGlow = interpolate(
    frame,
    [P2_END, P2_END + 14, TOTAL],
    [0, 0.82, 0.58],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const ringBorderOp = interpolate(frame, [P2_END, P2_END + 10], [0, 0.88], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ── Vignette ──
  const vigOp = interpolate(frame, [0, 22, TOTAL - 16, TOTAL], [0, 0.88, 0.92, 1.0], {
    extrapolateRight: "clamp",
  });

  const logoSrc = logoPath ? staticFile("astronomer-logo.png") : null;

  return (
    <AbsoluteFill style={{ backgroundColor: "#00000C" }}>

      {/* ── Phase 1: Hyperspace star streaks ── */}
      <svg width={1920} height={1080} style={{ position: "absolute", top: 0, left: 0 }}>
        <StarStreakLayer count={90} seed={0xdeadbeef} frame={frame} />
        <StarStreakLayer count={45} seed={0xcafebabe} frame={frame} />
      </svg>

      {/* ── Phase 2-3: Drifting parallax star dots ── */}
      <svg width={1920} height={1080} style={{ position: "absolute", top: 0, left: 0 }}>
        {/* Distant layer — slowest, dimmest */}
        <StarDotLayer
          count={65} seed={0xdeadbeef}
          driftX={0.06} driftY={-0.02}
          minOp={0.12} maxOp={0.38} minR={0.5} maxR={1.1}
          globalOp={dotStarOp} frame={frame}
        />
        {/* Mid layer */}
        <StarDotLayer
          count={35} seed={0xcafebabe}
          driftX={0.16} driftY={-0.05}
          minOp={0.28} maxOp={0.62} minR={0.9} maxR={1.7}
          globalOp={dotStarOp} frame={frame}
        />
        {/* Near layer — fastest, brightest */}
        <StarDotLayer
          count={16} seed={0xfeedfeed}
          driftX={0.32} driftY={-0.11}
          minOp={0.50} maxOp={0.88} minR={1.4} maxR={2.5}
          globalOp={dotStarOp} frame={frame}
        />
      </svg>

      {/* ── Purple nebula cloud — parallax behind logo ── */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(calc(-50% + ${nebX}px), calc(-50% + ${nebY}px))`,
          width: 1020,
          height: 680,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at 50% 50%,
            rgba(75,35,140,${nebulaOp}) 0%,
            rgba(30,15,75,${nebulaOp * 0.52}) 40%,
            rgba(10,5,40,${nebulaOp * 0.16}) 65%,
            transparent 80%)`,
          filter: "blur(48px)",
          pointerEvents: "none",
        }}
      />

      {/* ── Particle trail — gold dots tracing the arc path ── */}
      {trail.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: p.particleR * 2,
            height: p.particleR * 2,
            borderRadius: "50%",
            transform: `translate(calc(-50% + ${p.px}px), calc(-50% + ${p.py}px))`,
            opacity: p.particleOp,
            backgroundColor: "rgba(212,168,67,0.85)",
            boxShadow: `0 0 ${p.particleR * 2.5}px rgba(212,168,67,0.4)`,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* ── Logo — travels from tiny point to full size ── */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: LOGO_FINAL,
          height: LOGO_FINAL,
          transform: `translate(calc(-50% + ${logoX}px), calc(-50% + ${logoY}px)) scale(${logoScale})`,
          opacity: logoOp,
          borderRadius: "50%",
          boxShadow: ringBloom > 0.5
            ? [
                `0 0 ${ringBloom}px ${ringBloom * 0.5}px rgba(212,168,67,${ringGlow})`,
                `0 0 ${ringBloom * 2.5}px ${ringBloom}px rgba(180,130,40,${ringGlow * 0.4})`,
                `0 0 ${ringBloom * 4}px ${ringBloom * 1.5}px rgba(100,60,20,${ringGlow * 0.15})`,
              ].join(", ")
            : "none",
          border: `3px solid rgba(212,168,67,${ringBorderOp})`,
          overflow: "hidden",
          backgroundColor: "#06060f",
        }}
      >
        {logoSrc ? (
          <Img
            src={logoSrc}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "radial-gradient(circle, #0d0d20 0%, #050510 100%)",
            }}
          >
            <div
              style={{
                color: "rgba(212,168,67,0.9)",
                fontSize: 28,
                fontFamily: "'Georgia', serif",
                textAlign: "center",
                letterSpacing: "3px",
                lineHeight: 1.3,
              }}
            >
              SLEEPLESS
              <br />
              ASTRONOMER
            </div>
          </div>
        )}
      </div>

      {/* ── Vignette — edges darkened throughout ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 50%,
            transparent 28%,
            rgba(0,0,8,0.32) 56%,
            rgba(0,0,8,0.70) 80%,
            rgba(0,0,8,0.88) 100%)`,
          opacity: vigOp,
          pointerEvents: "none",
        }}
      />

    </AbsoluteFill>
  );
};
