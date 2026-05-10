import { useEffect, useRef, useState } from "react";
import type { OnDoneCallback } from "../types";

type AlertAudioProps = {
  id: string;
  url: string;
  duration?: number;
  onDone: OnDoneCallback;
};

export default function AlertAudio({ id, url, duration, onDone }: AlertAudioProps) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const audio = useRef<HTMLAudioElement | null>(null);
  if (!audio.current) {
    audio.current = new Audio();
  }

  useEffect(() => {
    if (url === "") {
      console.log("[alert:audio] empty url — done immediately", { id });
      onDone({ id, error: true, errorMsg: "url is empty" });
    }
  }, [id, url, onDone]);

  useEffect(() => {
    if (!done) {
      return;
    }
    console.log("[alert:audio] onDone fired", { id, error: !!error, errorMsg: error });
    onDone({ id, error: !!error, errorMsg: error });
  }, [done, error, id, onDone]);

  useEffect(() => {
    let audioTimeout: ReturnType<typeof setTimeout> | null = null;
    const player = audio.current;
    if (!player) {
      return;
    }

    console.log("[alert:audio] mount", { id, url, duration });

    function handleEnded() {
      console.log("[alert:audio] natural ended", { id });
      setDone(true);
      if (audioTimeout) {
        clearTimeout(audioTimeout);
      }
    }

    function handleCanPlayThrough() {
      if (!player) {
        return;
      }
      console.log("[alert:audio] canplaythrough → play()", { id, naturalDuration: player.duration });
      player
        .play()
        .then(() => {
          if (duration !== undefined) {
            // Author specified a duration — that's the hard ceiling
            // for the alert. Truncate audio at duration even when
            // the audio's natural length is longer.
            console.log("[alert:audio] duration cap timer started", { id, duration });
            audioTimeout = setTimeout(() => {
              console.log("[alert:audio] duration cap fired", { id, duration });
              player.pause();
              setDone(true);
            }, duration * 1000);
            return;
          }
          // No duration set → audio plays to natural end via
          // `ended`. Safety net: force completion at the audio's
          // natural length + 500ms in case the browser silently
          // skips dispatching `ended` for this media type.
          const audioLen = Number.isFinite(player.duration) && player.duration > 0
            ? player.duration
            : 60;
          console.log("[alert:audio] safety timer started", { id, audioLen });
          audioTimeout = setTimeout(() => {
            console.log("[alert:audio] safety timer fired", { id });
            player.pause();
            setDone(true);
          }, (audioLen + 0.5) * 1000);
        })
        .catch((err) => {
          console.log("[alert:audio] play() rejected", { id, error: err });
          setDone(true);
          setError(err instanceof Error ? err.message : String(err));
        });
    }

    player.src = url;
    player.addEventListener("ended", handleEnded);
    player.addEventListener("canplaythrough", handleCanPlayThrough);

    return () => {
      console.log("[alert:audio] cleanup", { id });
      if (audioTimeout) {
        clearTimeout(audioTimeout);
      }
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("canplaythrough", handleCanPlayThrough);
      player.pause();
      player.src = "";
    };
  }, [id, url, duration]);

  return null;
}
