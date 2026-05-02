import { useEffect, useState } from "react";
import Lottie from "react-lottie-player";

type PathIndex = string | number;

type AnimationProps = {
  src: string;
  width: string;
  loop: boolean;
  path: PathIndex[];
  value: string;
};

export default function Animation({ src, width, path, value }: AnimationProps) {
  const [animation, setAnimation] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function makeRequest() {
      const res = await fetch(src);
      const json = (await res.json()) as Record<string, unknown>;

      let currentObj: Record<string, unknown> = json;
      let currentIdx = 0;
      while (currentIdx < path.length) {
        const property = path[currentIdx] as keyof typeof currentObj;
        if (currentIdx === path.length - 1) {
          currentObj[property as string] = value;
        } else {
          currentObj = currentObj[property as string] as Record<string, unknown>;
        }
        currentIdx++;
      }

      if (!cancelled) {
        setAnimation(json);
      }
    }
    makeRequest();
    return () => {
      cancelled = true;
    };
  }, [src, path, value]);

  if (!animation) {
    return null;
  }

  return (
    <Lottie loop animationData={animation} play style={{ width, height: "100%" }} />
  );
}
