import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  staticFile,
  Img,
} from "remotion";

// ─── Seeded pseudo-random ────────────────────────────────────────────────────
// LCG — same seed → same stars every render
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0xffffffff;
  };
}

// ─── Star field layer ────────────────────────────────────────────────────────
function StarLayer({ count, seed, driftX, driftY, minOpacity, maxOpacity, minR, maxR, globalOpacity, frame }) {
  const rng = makeRng(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const baseX = rng() * 1920;
    const baseY = rng() * 1080;
    const r     = minR + rng() * (maxR - minR);
    const op    = minOpacity + rng() * (maxOpacity - minOpacity);
    // Slow twinkle — offset per star so they don't pulse together
    const twinklePhase = rng() * Math.PI * 2;
    const twinkle = 0.85 + 0.15 * Math.sin(twinklePhase + frame * 0.08);

    const x = ((baseX + driftX * frame) % 1920 + 1920) % 1920;
    const y = ((baseY + driftY * frame) % 1080 + 1080) % 1080;

    // Slight blue-purple tint on some stars
    const tint = rng() < 0.25;
    const color = tint ? `rgba(180,170,255,${op * twinkle * globalOpacity})`
                       : `rgba(255,255,255,${op * twinkle * globalOpacity})`;

    stars.push(
      <circle key={i} cx={x} cy={y} r={r} fill={color} />
    );
  }
  return <>{stars}</>;
}

// ─── AstronomerIntro ─────────────────────────────────────────────────────────
// 2 seconds, 60 frames at 30fps.
//
// Timeline:
//   f  0-20: stars fade in (all layers)
//   f 15-30: nebula glow blooms from center
//   f 28-45: logo fades in + scales up (ease-out)
//   f 45-60: logo gold ring gets subtle radial bloom

export const AstronomerIntro = ({ logoPath = null }) => {
  const frame = useCurrentFrame();

  // ── Global star fade-in ──
  const starGlobal = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

  // ── Nebula bloom ──
  const nebulaOp = interpolate(frame, [15, 30, 50, 60], [0, 0.45, 0.38, 0.32], {
    extrapolateRight: "clamp",
  });

  // ── Logo fade + scale ──
  const logoOp = interpolate(frame, [28, 46], [0, 1], {
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3), // ease-out cubic
  });
  const logoScale = interpolate(frame, [28, 46], [0.4, 1.0], {
    extrapolateRight: "clamp",
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  // ── Gold ring bloom ──
  const ringBloom = interpolate(frame, [45, 52, 60], [0, 22, 14], {
    extrapolateRight: "clamp",
  });
  const ringGlow = interpolate(frame, [45, 52, 60], [0, 0.75, 0.55], {
    extrapolateRight: "clamp",
  });

  // ── Vignette opacity ── fades in slowly
  const vignetteOp = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" });

  const logoSize = 320;

  // Determine logo source — static file (from public/) or null (show ring-only placeholder)
  const hasLogo = !!logoPath;
  const logoSrc = hasLogo ? staticFile("astronomer-logo.png") : null;

  return (
    <AbsoluteFill style={{ backgroundColor: "#00000C" }}>

      {/* ── Star SVG layers ── */}
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {/* Layer 1 — distant, very slow */}
        <StarLayer
          count={65}
          seed={0xdeadbeef}
          driftX={0.08}
          driftY={-0.03}
          minOpacity={0.15}
          maxOpacity={0.4}
          minR={0.5}
          maxR={1.2}
          globalOpacity={starGlobal}
          frame={frame}
        />
        {/* Layer 2 — mid distance */}
        <StarLayer
          count={32}
          seed={0xcafebabe}
          driftX={0.18}
          driftY={-0.06}
          minOpacity={0.3}
          maxOpacity={0.65}
          minR={1.0}
          maxR={1.8}
          globalOpacity={starGlobal}
          frame={frame}
        />
        {/* Layer 3 — near, faster, brighter */}
        <StarLayer
          count={14}
          seed={0xfeedfeed}
          driftX={0.38}
          driftY={-0.14}
          minOpacity={0.55}
          maxOpacity={0.9}
          minR={1.5}
          maxR={2.8}
          globalOpacity={starGlobal}
          frame={frame}
        />
      </svg>

      {/* ── Nebula glow — center bloom ── */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 900,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at 50% 50%,
            rgba(75, 35, 140, ${nebulaOp}) 0%,
            rgba(30, 15, 75, ${nebulaOp * 0.5}) 40%,
            rgba(10, 5, 40, ${nebulaOp * 0.15}) 65%,
            transparent 80%)`,
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />

      {/* ── Secondary purple cloud — offset slightly ── */}
      <div
        style={{
          position: "absolute",
          top: "42%",
          left: "48%",
          transform: "translate(-50%, -50%)",
          width: 600,
          height: 400,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at 50% 50%,
            rgba(50, 25, 120, ${nebulaOp * 0.6}) 0%,
            transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      {/* ── Logo container ── */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${logoScale})`,
          opacity: logoOp,
          width: logoSize,
          height: logoSize,
          borderRadius: "50%",
          boxShadow: [
            `0 0 ${ringBloom}px ${ringBloom * 0.5}px rgba(212, 168, 67, ${ringGlow})`,
            `0 0 ${ringBloom * 2.5}px ${ringBloom}px rgba(180, 130, 40, ${ringGlow * 0.4})`,
            `0 0 ${ringBloom * 4}px ${ringBloom * 1.5}px rgba(100, 60, 20, ${ringGlow * 0.15})`,
          ].join(", "),
          border: `3px solid rgba(212, 168, 67, ${logoOp * 0.85})`,
          overflow: "hidden",
          backgroundColor: "#06060f",
        }}
      >
        {hasLogo ? (
          <Img
            src={logoSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: "50%",
            }}
          />
        ) : (
          /* Fallback: text-only logo placeholder */
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
            <div style={{
              color: "rgba(212,168,67,0.9)",
              fontSize: 28,
              fontFamily: "'Georgia', serif",
              textAlign: "center",
              letterSpacing: "3px",
              lineHeight: 1.3,
            }}>
              SLEEPLESS<br/>ASTRONOMER
            </div>
          </div>
        )}
      </div>

      {/* ── Vignette — edges darken toward center-focus ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 50%,
            transparent 30%,
            rgba(0, 0, 8, 0.35) 60%,
            rgba(0, 0, 8, 0.72) 85%,
            rgba(0, 0, 8, 0.88) 100%)`,
          opacity: vignetteOp,
          pointerEvents: "none",
        }}
      />

    </AbsoluteFill>
  );
};
