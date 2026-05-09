import { useEffect, useState } from "react";
import type { MessageOptions, OnDoneCallback } from "../types";
import AlertAudio from "./AlertAudio";
import Animation from "./Animation";

type AlertMessageProps = {
  id: string;
  textPattern?: string;
  mediaUrl?: string;
  audioUrl?: string;
  duration?: number;
  options?: MessageOptions;
  onDone: OnDoneCallback;
};

function createMediaComponent(mediaUrl: string, options: MessageOptions = {}) {
  const classnames: string[] = [];
  const width = options?.view?.fullScreen ? "100%" : "500";
  if (options?.media?.transparentBlack) classnames.push("transparentBlack");
  if (options?.media?.transparentWhite) classnames.push("transparentWhite");

  const ext = mediaUrl.split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
    case "gif":
    case "png":
      return <img className={classnames.join(" ")} src={mediaUrl} width={width} alt="" />;
    case "mp4":
      return (
        <video className={classnames.join(" ")} width={width} autoPlay loop>
          <source src={mediaUrl} type="video/mp4" />
        </video>
      );
    case "json":
      if (!options?.animation?.path) {
        return null;
      }
      return (
        <Animation
          src={mediaUrl}
          path={options.animation.path}
          value={options.animation.value}
          width={width}
          loop={true}
        />
      );
    default:
      return null;
  }
}

function createFormattedText(textPattern: string): string {
  const substitutions: Record<string, string> = {
    "{primary}": '<span style="color: #EC6758">',
  };
  const closingTags: Record<string, string> = {};
  for (const [pattern, openingTag] of Object.entries(substitutions)) {
    const tagMatch = openingTag.match(/<([a-z0-9]+)[\s>]/i);
    closingTags[pattern] = tagMatch && tagMatch[1] ? `</${tagMatch[1]}>` : "";
  }

  let result = textPattern;
  for (const [pattern, openingTag] of Object.entries(substitutions)) {
    const segments = result.split(pattern);
    if (segments.length > 1) {
      result = segments.reduce((acc, segment, index) => {
        if (index === segments.length - 1) {
          return acc + segment;
        }
        if (index % 2 === 0) {
          return acc + segment + openingTag;
        }
        return acc + segment + closingTags[pattern];
      }, "");
    }
  }
  return result;
}

export function AlertMessage({
  id,
  textPattern,
  mediaUrl,
  audioUrl,
  duration,
  options,
  onDone,
}: AlertMessageProps) {
  const [done, setDone] = useState<[boolean, boolean]>([
    !(textPattern || mediaUrl),
    !audioUrl,
  ]);

  useEffect(() => {
    if (done.every((d) => d)) {
      onDone({ id, error: false });
    }
  }, [done, id, onDone]);

  useEffect(() => {
    // Text/media display window:
    //   - duration set        → text disappears at duration (hard ceiling)
    //   - duration unset, no audio  → fallback to 5s default
    //   - duration unset, with audio → wait for audio's `onDone` to
    //       flip textDone (handled in audioDoneCallback below) so the
    //       alert lasts exactly as long as the audio plays.
    if (duration !== undefined) {
      const timer = setTimeout(() => {
        setDone(([_, audioDone]) => [true, audioDone]);
      }, duration * 1000);
      return () => clearTimeout(timer);
    }
    if (!audioUrl) {
      const timer = setTimeout(() => {
        setDone(([_, audioDone]) => [true, audioDone]);
      }, 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [duration, audioUrl]);

  function audioDoneCallback() {
    setDone(([txtDone, _]) => {
      // No duration set → text/media disappears with the audio so the
      // alert ends in lockstep. With duration set, leave textDone
      // alone — the timer above governs it.
      const nextText = duration !== undefined ? txtDone : true;
      return [nextText, true];
    });
  }

  const classnames: string[] = [];
  if (options?.view?.fullScreen) classnames.push("fullscreen");
  if (options?.view?.positionAbsolute) classnames.push("absolute");

  return (
    <div id="alertBox" className={classnames.join(" ")}>
      {mediaUrl && createMediaComponent(mediaUrl, options)}
      {textPattern && (
        <div
          style={{ fontFamily: "Roboto", fontWeight: "bold", color: "white", fontSize: "48px" }}
          dangerouslySetInnerHTML={{ __html: createFormattedText(textPattern) }}
        />
      )}
      {audioUrl && (
        <AlertAudio id={id} onDone={audioDoneCallback} url={audioUrl} duration={duration} />
      )}
    </div>
  );
}
