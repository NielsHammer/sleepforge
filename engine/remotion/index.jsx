import { registerRoot, Composition } from "remotion";
import { GreekLibraryScene }       from "./backgrounds/marcus-aurelius-night/GreekLibraryScene.jsx";
import { IntroAnimation }           from "./components/IntroAnimation.jsx";
import { FireplaceParticles }       from "./components/FireplaceParticles.jsx";
import { RipplesAnimation }         from "./components/animations/RipplesAnimation.jsx";
import { CandleAnimation }          from "./components/animations/CandleAnimation.jsx";
import { PathsDivergingAnimation }  from "./components/animations/PathsDivergingAnimation.jsx";
import { HandReleasingAnimation }   from "./components/animations/HandReleasingAnimation.jsx";
import { HourglassAnimation }       from "./components/animations/HourglassAnimation.jsx";

const Root = () => {
  return (
    <>
      <Composition
        id="GreekLibrary"
        component={GreekLibraryScene}
        durationInFrames={30 * 60 * 2}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ images: [], imageDuration: 12 }}
      />
      <Composition
        id="Intro"
        component={IntroAnimation}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ channelName: "Sleepless Philosophers", videoTitle: "" }}
      />
      <Composition
        id="fireplace-particles"
        component={FireplaceParticles}
        durationInFrames={30 * 60}
        fps={30}
        width={1920}
        height={1080}
      />

      {/* ── Philosophy animations (screen-blend overlays) ── */}
      <Composition
        id="RipplesAnimation"
        component={RipplesAnimation}
        durationInFrames={90}   // 3s @ 30fps
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="CandleAnimation"
        component={CandleAnimation}
        durationInFrames={90}   // 3s @ 30fps
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PathsDivergingAnimation"
        component={PathsDivergingAnimation}
        durationInFrames={120}  // 4s @ 30fps
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="HandReleasingAnimation"
        component={HandReleasingAnimation}
        durationInFrames={90}   // 3s @ 30fps
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="HourglassAnimation"
        component={HourglassAnimation}
        durationInFrames={120}  // 4s @ 30fps
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

registerRoot(Root);
