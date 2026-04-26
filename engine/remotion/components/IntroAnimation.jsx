import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
} from "remotion";
import { Particles } from "../backgrounds/marcus-aurelius-night/Particles.jsx";

// ─── Intro Animation ────────────────────────────────────────────────────────
// First 10-12 seconds of every video.
// Dark philosophy chalk themed welcome with subscribe reminder.
//
// Timeline:
//   0-3s:  Channel logo/name fades in with chalk dust particles
//   3-7s:  Video title fades in below
//   7-10s: "Like & Subscribe" text with subtle animation
//   10-12s: Everything fades out to the main content

export const IntroAnimation = ({
  channelName = "Sleepless Philosophers",
  videoTitle = "",
  fps = 30,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const time = frame / fps;

  // === CHANNEL NAME ===
  const nameOpacity = interpolate(frame, [0, 30, 180, 210], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const nameScale = interpolate(frame, [0, 40], [0.85, 1], {
    extrapolateRight: "clamp",
  });

  // === VIDEO TITLE ===
  const titleOpacity = interpolate(frame, [60, 100, 180, 220], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [60, 100], [30, 0], {
    extrapolateRight: "clamp",
  });

  // === SUBSCRIBE LINE ===
  const subOpacity = interpolate(frame, [150, 180, 270, 300], [0, 0.7, 0.7, 0], {
    extrapolateRight: "clamp",
  });

  // === DECORATIVE LINE ===
  const lineWidth = interpolate(frame, [30, 90], [0, 400], {
    extrapolateRight: "clamp",
  });
  const lineOpacity = interpolate(frame, [30, 60, 240, 280], [0, 0.4, 0.4, 0], {
    extrapolateRight: "clamp",
  });

  // === CHALK DUST BURST at start ===
  const dustOpacity = interpolate(frame, [0, 10, 60, 90], [0, 0.3, 0.3, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      {/* Background particles */}
      <Particles frame={frame} fps={fps} count={40} />

      {/* Chalk dust burst effect */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "40%",
          transform: "translate(-50%, -50%)",
          width: 600,
          height: 200,
          borderRadius: "50%",
          background: `radial-gradient(ellipse, rgba(180,175,170,${dustOpacity}) 0%, transparent 70%)`,
          filter: "blur(30px)",
        }}
      />

      {/* Channel name */}
      <div
        style={{
          position: "absolute",
          top: "32%",
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: nameOpacity,
          transform: `scale(${nameScale})`,
        }}
      >
        <span
          style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: 72,
            fontWeight: "normal",
            color: "#d8d4cf",
            letterSpacing: "8px",
            textTransform: "uppercase",
            textShadow: "0 0 40px rgba(200,195,190,0.2), 0 2px 4px rgba(0,0,0,0.8)",
          }}
        >
          {channelName}
        </span>
      </div>

      {/* Decorative line */}
      <div
        style={{
          position: "absolute",
          top: "44%",
          left: "50%",
          transform: "translateX(-50%)",
          width: lineWidth,
          height: 1,
          background: `linear-gradient(90deg, transparent 0%, rgba(150,145,140,${lineOpacity}) 20%, rgba(150,145,140,${lineOpacity}) 80%, transparent 100%)`,
        }}
      />

      {/* Small decorative dots on the line ends */}
      {lineWidth > 100 && (
        <>
          <div
            style={{
              position: "absolute",
              top: "44%",
              left: `calc(50% - ${lineWidth / 2}px)`,
              width: 4,
              height: 4,
              borderRadius: "50%",
              backgroundColor: `rgba(150,145,140,${lineOpacity})`,
              transform: "translate(-50%, -50%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "44%",
              left: `calc(50% + ${lineWidth / 2}px)`,
              width: 4,
              height: 4,
              borderRadius: "50%",
              backgroundColor: `rgba(150,145,140,${lineOpacity})`,
              transform: "translate(-50%, -50%)",
            }}
          />
        </>
      )}

      {/* Video title */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <span
          style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: 42,
            fontWeight: "normal",
            fontStyle: "italic",
            color: "#a09890",
            letterSpacing: "3px",
            textShadow: "0 2px 4px rgba(0,0,0,0.8)",
          }}
        >
          {videoTitle}
        </span>
      </div>

      {/* Subscribe line */}
      <div
        style={{
          position: "absolute",
          bottom: "18%",
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: subOpacity,
        }}
      >
        <span
          style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: 24,
            color: "#706860",
            letterSpacing: "4px",
            textTransform: "uppercase",
          }}
        >
          Like & Subscribe for more wisdom
        </span>
      </div>

      {/* Corner Greek key decorations */}
      <CornerDecoration position="topLeft" opacity={lineOpacity} />
      <CornerDecoration position="topRight" opacity={lineOpacity} />
      <CornerDecoration position="bottomLeft" opacity={lineOpacity} />
      <CornerDecoration position="bottomRight" opacity={lineOpacity} />
    </AbsoluteFill>
  );
};

// ─── Corner Decoration ──────────────────────────────────────────────────────
// Simple Greek key / meander pattern in corners

const CornerDecoration = ({ position, opacity }) => {
  const size = 60;
  const margin = 40;
  const color = `rgba(100,95,90,${opacity * 0.6})`;

  const posStyles = {
    topLeft: { top: margin, left: margin },
    topRight: { top: margin, right: margin, transform: "scaleX(-1)" },
    bottomLeft: { bottom: margin, left: margin, transform: "scaleY(-1)" },
    bottomRight: { bottom: margin, right: margin, transform: "scale(-1,-1)" },
  };

  return (
    <div style={{ position: "absolute", ...posStyles[position], width: size, height: size }}>
      {/* Simple L-shaped corner with step */}
      <div style={{ position: "absolute", top: 0, left: 0, width: size, height: 1, backgroundColor: color }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: 1, height: size, backgroundColor: color }} />
      <div style={{ position: "absolute", top: 10, left: 10, width: size - 20, height: 1, backgroundColor: color }} />
      <div style={{ position: "absolute", top: 10, left: 10, width: 1, height: size - 20, backgroundColor: color }} />
    </div>
  );
};
