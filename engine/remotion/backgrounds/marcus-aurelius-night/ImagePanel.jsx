import React from "react";
import { useVideoConfig } from "remotion";

// ─── Chalkboard Frame ───────────────────────────────────────────────────────
//
// The actual scene image is overlaid onto bg.mp4 by FFmpeg at the same
// rectangle this component reserves (see ffmpeg.js composeVideo). This file
// only paints the *frame* — a rough wooden chalkboard surround with chalk-dust
// trim — that sits in the bg.mp4 underneath and around the image.
//
// Layout:
//   panel   = 60% of screen width, 16:9, centered (slightly above middle)
//   frame   = thick wooden border (~36px) around the panel
//   tray    = chalk ledge below the panel with small chalk pieces
//
// Inside the panel we draw a flat blackboard surface as a placeholder so that
// the bg.mp4 doesn't show the library through the image during the seconds
// before the FFmpeg overlay scales up.

export const ImagePanel = ({ frame }) => {
  const { width, height } = useVideoConfig();

  // Match exactly the rectangle FFmpeg overlays into (see composeVideo)
  const panelW = Math.round(width * 0.60);             // 1152
  const panelH = Math.round(panelW * (9 / 16));        // 648
  const panelX = Math.round((width - panelW) / 2);     // 384
  const panelY = Math.round((height - panelH) / 2) - 20; // 196

  const frameThick = 36;
  const outerX = panelX - frameThick;
  const outerY = panelY - frameThick;
  const outerW = panelW + frameThick * 2;
  const outerH = panelH + frameThick * 2;

  return (
    <>
      {/* Wooden frame back-plate (drop shadow halo) */}
      <div
        style={{
          position: "absolute",
          left: outerX - 6,
          top: outerY - 6,
          width: outerW + 12,
          height: outerH + 12,
          background: "transparent",
          boxShadow:
            "0 12px 40px rgba(0,0,0,0.85), 0 0 80px rgba(0,0,0,0.6)",
          borderRadius: 6,
        }}
      />

      {/* Wooden frame */}
      <div
        style={{
          position: "absolute",
          left: outerX,
          top: outerY,
          width: outerW,
          height: outerH,
          borderRadius: 6,
          background: `
            repeating-linear-gradient(
              90deg,
              rgba(45,32,20,1) 0px,
              rgba(58,40,25,1) 3px,
              rgba(38,26,16,1) 7px,
              rgba(50,34,22,1) 12px
            ),
            linear-gradient(180deg, #3a2818 0%, #1a1208 100%)
          `,
          boxShadow:
            "inset 0 0 14px rgba(0,0,0,0.7), inset 0 0 2px rgba(120,90,55,0.25)",
          border: "1px solid rgba(80,55,32,0.45)",
        }}
      >
        {/* Wood grain knots — top */}
        <div
          style={{
            position: "absolute",
            left: outerW * 0.18,
            top: 8,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 40% 40%, rgba(20,12,6,0.85) 0%, rgba(50,34,20,0.4) 60%, transparent 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: outerW * 0.22,
            top: 6,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 50% 50%, rgba(20,12,6,0.7) 0%, transparent 70%)",
          }}
        />

        {/* Inner bezel — black recess where the chalkboard lives */}
        <div
          style={{
            position: "absolute",
            left: frameThick - 4,
            top: frameThick - 4,
            width: panelW + 8,
            height: panelH + 8,
            borderRadius: 2,
            background: "#050403",
            boxShadow:
              "inset 0 0 24px rgba(0,0,0,0.95), inset 0 0 4px rgba(0,0,0,1)",
            border: "1px solid rgba(0,0,0,0.6)",
          }}
        >
          {/* Chalkboard surface placeholder (FFmpeg overlay covers this exactly) */}
          <div
            style={{
              position: "absolute",
              left: 4,
              top: 4,
              width: panelW,
              height: panelH,
              background: `
                radial-gradient(ellipse at 30% 25%, rgba(30,30,32,0.18) 0%, transparent 60%),
                radial-gradient(ellipse at 75% 70%, rgba(40,40,44,0.12) 0%, transparent 65%),
                #0a0a0c
              `,
            }}
          />

          {/* Chalk dust streaks at the inner corners */}
          {[
            { x: 4, y: 4, w: 80, h: 14, rot: -8 },
            { x: panelW - 90, y: 6, w: 90, h: 12, rot: 6 },
            { x: 6, y: panelH - 18, w: 70, h: 10, rot: 3 },
            { x: panelW - 80, y: panelH - 16, w: 80, h: 12, rot: -5 },
          ].map((s, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: s.x,
                top: s.y,
                width: s.w,
                height: s.h,
                background:
                  "radial-gradient(ellipse at 50% 50%, rgba(220,220,225,0.22) 0%, rgba(200,200,205,0.06) 60%, transparent 100%)",
                filter: "blur(2px)",
                transform: `rotate(${s.rot}deg)`,
                pointerEvents: "none",
              }}
            />
          ))}
        </div>
      </div>

      {/* Chalk ledge / tray under the frame */}
      <div
        style={{
          position: "absolute",
          left: outerX - 8,
          top: outerY + outerH - 4,
          width: outerW + 16,
          height: 22,
          borderRadius: "2px 2px 6px 6px",
          background: `linear-gradient(180deg,
            #2a1c10 0%,
            #1a1208 40%,
            #0e0905 100%)`,
          boxShadow:
            "0 6px 18px rgba(0,0,0,0.7), inset 0 -2px 4px rgba(0,0,0,0.6), inset 0 1px 1px rgba(110,80,50,0.3)",
          border: "1px solid rgba(60,40,24,0.5)",
        }}
      >
        {/* Chalk pieces sitting on the tray */}
        <div
          style={{
            position: "absolute",
            left: 60,
            top: 5,
            width: 64,
            height: 8,
            background:
              "linear-gradient(90deg, #efece4 0%, #d6d2c8 50%, #b8b3a8 100%)",
            borderRadius: 2,
            boxShadow: "0 1px 1px rgba(0,0,0,0.6)",
            transform: "rotate(-2deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 90,
            top: 6,
            width: 38,
            height: 7,
            background:
              "linear-gradient(90deg, #d8d4c8 0%, #b6b1a4 100%)",
            borderRadius: 2,
            boxShadow: "0 1px 1px rgba(0,0,0,0.6)",
            transform: "rotate(3deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: outerW * 0.45,
            top: 5,
            width: 24,
            height: 7,
            background:
              "linear-gradient(90deg, #c8c4b8 0%, #a6a195 100%)",
            borderRadius: 2,
            boxShadow: "0 1px 1px rgba(0,0,0,0.6)",
          }}
        />
      </div>
    </>
  );
};
