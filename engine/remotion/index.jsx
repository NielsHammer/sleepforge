import { registerRoot, Composition } from "remotion";
import { GreekLibraryScene } from "./backgrounds/marcus-aurelius-night/GreekLibraryScene.jsx";
import { IntroAnimation } from "./components/IntroAnimation.jsx";
import { FireplaceParticles } from "./components/FireplaceParticles.jsx";

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
        defaultProps={{
          images: [],
          imageDuration: 12,
        }}
      />
      <Composition
        id="Intro"
        component={IntroAnimation}
        durationInFrames={360} // 12 seconds at 30fps
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          channelName: "Sleepless Philosophers",
          videoTitle: "",
        }}
      />
      <Composition
        id="fireplace-particles"
        component={FireplaceParticles}
        durationInFrames={30 * 60} // 60s loop @ 30fps
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

registerRoot(Root);
