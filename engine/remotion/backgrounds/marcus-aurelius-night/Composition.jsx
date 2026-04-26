import { Composition } from "remotion";
import { GreekLibraryScene } from "./GreekLibraryScene.jsx";

export const PhilosophyBackground = () => {
  return (
    <>
      <Composition
        id="GreekLibrary"
        component={GreekLibraryScene}
        durationInFrames={30 * 60 * 2} // 2 hours at 30fps (max, trimmed by renderer)
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          images: [],
          imageDuration: 12, // seconds per image
        }}
      />
    </>
  );
};
