import { Composition } from "remotion";
import { TourVideo } from "./TourVideo";

const STEPS = [
  "welcome",
  "dashboard",
  "patients",
  "collections",
  "dataAnalysis",
  "feedback",
  "moreFeatures",
  "myActivity",
  "apiTokens",
  "sessions",
  "notifications",
  "theme",
  "language",
  "admin",
  "finish",
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {STEPS.map((key) => (
        <Composition
          key={key}
          id={key}
          component={TourVideo}
          durationInFrames={180}
          fps={30}
          width={640}
          height={360}
          defaultProps={{ stepKey: key }}
        />
      ))}
    </>
  );
};
