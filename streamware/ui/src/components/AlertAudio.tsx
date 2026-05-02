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
      onDone({ id, error: true, errorMsg: "url is empty" });
    }
  }, [id, url, onDone]);

  useEffect(() => {
    if (!done) {
      return;
    }
    onDone({ id, error: !!error, errorMsg: error });
  }, [done, error, id, onDone]);

  useEffect(() => {
    let audioTimeout: ReturnType<typeof setTimeout> | null = null;
    const player = audio.current;
    if (!player) {
      return;
    }

    function handleEnded() {
      setDone(true);
      if (audioTimeout) {
        clearTimeout(audioTimeout);
      }
    }

    function handleCanPlayThrough() {
      if (!player) {
        return;
      }
      player
        .play()
        .then(() => {
          if (duration) {
            audioTimeout = setTimeout(() => {
              player.pause();
              setDone(true);
            }, duration * 1000);
          }
        })
        .catch((err) => {
          console.log("error", err);
          setDone(true);
          setError(err instanceof Error ? err.message : String(err));
        });
    }

    player.src = url;
    player.addEventListener("ended", handleEnded);
    player.addEventListener("canplaythrough", handleCanPlayThrough);

    return () => {
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
