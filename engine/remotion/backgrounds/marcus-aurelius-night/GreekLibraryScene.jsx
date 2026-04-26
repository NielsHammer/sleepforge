import React, { useMemo } from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Particles } from "./Particles.jsx";
import { SmokeWisps } from "./SmokeWisps.jsx";
import { ImagePanel } from "./ImagePanel.jsx";

// ─── Greek Library Background Scene ─────────────────────────────────────────
//
// A dark, lived-in ancient library: stacked recessed columns, scroll shelves
// climbing the walls, a coffered arch overhead, candle-glow halos, drifting
// smoke and slow chalk dust. The center 60% of the frame holds a wooden
// chalkboard frame — the actual scene image is overlaid by FFmpeg later.

export const GreekLibraryScene = ({ images = [], imageDuration = 12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#040404" }}>
      <LibraryBackground frame={frame} fps={fps} />
      <ImagePanel images={images} imageDuration={imageDuration} frame={frame} fps={fps} />
      <Vignette />
      <SmokeWisps frame={frame} fps={fps} />
      <Particles frame={frame} fps={fps} count={90} />
    </AbsoluteFill>
  );
};

// ─── Library Background ─────────────────────────────────────────────────────

const LibraryBackground = ({ frame, fps }) => {
  const time = frame / fps;
  const shadowShift = Math.sin(time * 0.15) * 4;
  const lampFlicker = 0.86 + 0.14 * (
    0.5 * Math.sin(time * 1.7) +
    0.3 * Math.sin(time * 2.9 + 1.3) +
    0.2 * Math.sin(time * 4.3 + 0.7)
  );

  return (
    <AbsoluteFill>
      {/* Base stone wall — warm dark gradient, slightly offset radial for depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse at 50% 35%, #1a1410 0%, #0a0806 55%, #030201 100%),
            linear-gradient(180deg, #0c0a08 0%, #030201 100%)
          `,
        }}
      />

      {/* Subtle masonry texture — stacked horizontal courses */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(
            0deg,
            rgba(40,32,24,0.10) 0px,
            rgba(20,16,12,0.10) 2px,
            transparent 2px,
            transparent 90px
          )`,
          opacity: 0.7,
        }}
      />

      {/* Far back wall vault — coffered arch silhouette */}
      <div
        style={{
          position: "absolute",
          left: 280,
          right: 280,
          top: -60,
          height: 280,
          background: `radial-gradient(ellipse at 50% 100%, rgba(20,16,10,0.55) 0%, transparent 70%)`,
          borderBottom: "1px solid rgba(60,46,30,0.18)",
        }}
      />

      {/* Coffered ceiling tiles (3 across) */}
      {[0, 1, 2].map((i) => (
        <div
          key={`coffer-${i}`}
          style={{
            position: "absolute",
            left: 380 + i * 380,
            top: 30,
            width: 320,
            height: 80,
            background: `linear-gradient(180deg, rgba(30,22,14,0.45) 0%, rgba(10,8,6,0.1) 100%)`,
            border: "1px solid rgba(60,46,30,0.22)",
            borderRadius: "0 0 6px 6px",
          }}
        />
      ))}

      {/* Foreground columns — left side, 3 deep for recession */}
      <Column x={20} height={1080} width={56} tone={0.10} frame={frame} fps={fps} />
      <Column x={130} height={980} width={42} tone={0.08} frame={frame} fps={fps} />
      <Column x={220} height={900} width={32} tone={0.06} frame={frame} fps={fps} />

      {/* Foreground columns — right side, 3 deep */}
      <Column x={1844} height={1080} width={56} tone={0.10} frame={frame} fps={fps} />
      <Column x={1748} height={980} width={42} tone={0.08} frame={frame} fps={fps} />
      <Column x={1668} height={900} width={32} tone={0.06} frame={frame} fps={fps} />

      {/* Scroll shelves climbing the left wall */}
      <ScrollShelf x={10} y={120} width={210} frame={frame} fps={fps} />
      <ScrollShelf x={10} y={300} width={200} frame={frame} fps={fps} />
      <ScrollShelf x={10} y={480} width={210} frame={frame} fps={fps} />
      <ScrollShelf x={10} y={660} width={200} frame={frame} fps={fps} />
      <ScrollShelf x={10} y={840} width={210} frame={frame} fps={fps} />

      {/* Scroll shelves — right wall mirrored */}
      <ScrollShelf x={1700} y={150} width={210} frame={frame} fps={fps} />
      <ScrollShelf x={1700} y={330} width={200} frame={frame} fps={fps} />
      <ScrollShelf x={1700} y={510} width={210} frame={frame} fps={fps} />
      <ScrollShelf x={1700} y={690} width={200} frame={frame} fps={fps} />
      <ScrollShelf x={1700} y={870} width={210} frame={frame} fps={fps} />

      {/* Hanging brazier glows — flickering candle/oil-lamp warmth, NOT visible flames */}
      <BrazierGlow x={300} y={780} radius={260} intensity={lampFlicker} hue="rgba(120,70,30," />
      <BrazierGlow x={1620} y={780} radius={260} intensity={lampFlicker * 0.92} hue="rgba(120,70,30," />
      <BrazierGlow x={960} y={120} radius={340} intensity={0.5 + 0.5 * lampFlicker} hue="rgba(80,55,30," />

      {/* Stone floor with perspective lines */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 200,
          background: `linear-gradient(0deg, #050402 0%, transparent 100%)`,
          borderTop: "1px solid rgba(40,32,22,0.35)",
        }}
      />
      {/* Floor masonry lines */}
      {[40, 80, 130, 185].map((y, i) => (
        <div
          key={`floor-${i}`}
          style={{
            position: "absolute",
            bottom: y,
            left: 200 + i * 30,
            right: 200 + i * 30,
            height: 1,
            background: `rgba(50,40,28,${0.15 - i * 0.025})`,
          }}
        />
      ))}

      {/* Slow drifting shadow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at ${50 + shadowShift}% 40%, transparent 25%, rgba(0,0,0,0.55) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Column Component ───────────────────────────────────────────────────────

const Column = ({ x, height, width = 40, tone = 0.08, frame, fps }) => {
  const shimmer = Math.sin(frame / fps * 0.3 + x * 0.01) * 0.02 + tone;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        bottom: 0,
        width,
        height,
        background: `linear-gradient(90deg,
          rgba(28,22,16,${shimmer}) 0%,
          rgba(48,38,28,${shimmer + 0.06}) 45%,
          rgba(38,30,22,${shimmer + 0.03}) 55%,
          rgba(20,16,12,${shimmer}) 100%)`,
        borderLeft: "1px solid rgba(70,54,36,0.25)",
        borderRight: "1px solid rgba(20,16,12,0.4)",
      }}
    >
      {/* Capital (Doric) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: -10,
          width: width + 20,
          height: 28,
          background: `linear-gradient(180deg, rgba(55,42,28,0.55) 0%, rgba(28,22,16,0.25) 100%)`,
          borderTop: "2px solid rgba(80,62,42,0.4)",
          borderRadius: "3px 3px 0 0",
        }}
      />
      {/* Echinus ring under capital */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: -2,
          width: width + 4,
          height: 6,
          background: `rgba(45,34,22,0.5)`,
        }}
      />
      {/* Vertical fluting */}
      {Array.from({ length: Math.max(3, Math.floor(width / 8)) }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 4 + i * (width / Math.max(3, Math.floor(width / 8))),
            top: 38,
            bottom: 0,
            width: 1,
            background: "rgba(15,11,7,0.35)",
          }}
        />
      ))}
      {/* Base */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: -8,
          width: width + 16,
          height: 18,
          background: `linear-gradient(0deg, rgba(40,30,20,0.5) 0%, rgba(20,16,10,0.25) 100%)`,
          borderBottom: "2px solid rgba(60,46,30,0.3)",
        }}
      />
    </div>
  );
};

// ─── Scroll Shelf ───────────────────────────────────────────────────────────

const ScrollShelf = ({ x, y, width, frame, fps }) => {
  const glow = Math.sin(frame / fps * 0.2 + y * 0.01) * 0.03 + 0.10;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height: 75,
      }}
    >
      {/* Shelf board */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 5,
          background: `linear-gradient(180deg, rgba(50,38,26,${glow + 0.15}) 0%, rgba(25,18,12,${glow}) 100%)`,
          boxShadow: "0 1px 0 rgba(0,0,0,0.4)",
        }}
      />
      {/* Scrolls + bound codices */}
      {Array.from({ length: Math.floor(width / 22) }, (_, i) => {
        const isCodex = i % 4 === 1;
        const tone = 0.08 + ((i * 7) % 10) * 0.012;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * 22 + 4,
              bottom: 5,
              width: isCodex ? 12 : 14,
              height: 40 + (i % 3) * 10,
              background: isCodex
                ? `linear-gradient(90deg,
                    rgba(60,30,20,${tone + 0.1}) 0%,
                    rgba(30,16,10,${tone}) 100%)`
                : `linear-gradient(90deg,
                    rgba(28,22,16,${tone}) 0%,
                    rgba(50,40,28,${tone + 0.08}) 50%,
                    rgba(28,22,16,${tone}) 100%)`,
              borderRadius: isCodex ? "1px" : "2px",
              borderTop: isCodex ? "1px solid rgba(70,40,24,0.4)" : "1px solid rgba(60,46,30,0.3)",
            }}
          />
        );
      })}
    </div>
  );
};

// ─── Brazier / Lamp Glow ────────────────────────────────────────────────────
// Off-screen warm halo — gives the room a candle/oil-lamp feel without showing flames.

const BrazierGlow = ({ x, y, radius, intensity, hue }) => (
  <div
    style={{
      position: "absolute",
      left: x - radius,
      top: y - radius,
      width: radius * 2,
      height: radius * 2,
      pointerEvents: "none",
      background: `radial-gradient(circle at 50% 50%,
        ${hue}${(0.18 * intensity).toFixed(3)}) 0%,
        ${hue}${(0.08 * intensity).toFixed(3)}) 35%,
        transparent 70%)`,
      filter: "blur(20px)",
    }}
  />
);

// ─── Vignette ───────────────────────────────────────────────────────────────

const Vignette = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: `radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(0,0,0,0.65) 100%)`,
      pointerEvents: "none",
    }}
  />
);
