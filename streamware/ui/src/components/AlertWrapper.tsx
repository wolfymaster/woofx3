import type { AlertPayload, MessageOptions, OnDoneCallback } from "../types";
import { AlertMessage } from "./AlertMessage";

type AlertWrapperProps = {
  message: AlertPayload | null;
  onDone: OnDoneCallback;
};

function calculateArraySize<T>(item: T | T[] | undefined): number {
  if (item === undefined) {
    return 0;
  }
  return Array.isArray(item) ? item.length : 1;
}

function findIndexOrDefault<T>(arr: T | T[] | undefined, index: number, defaultValue: T | undefined): T | undefined {
  if (Array.isArray(arr)) {
    return arr[index];
  }
  if (index === 0) {
    return arr;
  }
  return defaultValue;
}

export default function AlertWrapper({ message, onDone }: AlertWrapperProps) {
  if (!message) {
    return null;
  }

  const totals = [
    calculateArraySize(message.mediaUrl),
    calculateArraySize(message.audioUrl),
    calculateArraySize(message.text),
  ];
  const max = Math.max(...totals);

  if (max > 1) {
    const components = [];
    for (let i = 0; i < max; i++) {
      const audioUrl = findIndexOrDefault(message.audioUrl, i, undefined);
      const mediaUrl = findIndexOrDefault(message.mediaUrl, i, undefined);
      const textPattern = findIndexOrDefault(message.text, i, undefined);
      const options = findIndexOrDefault(
        message.options as MessageOptions | MessageOptions[] | undefined,
        i,
        undefined,
      );
      components.push(
        <AlertMessage
          key={i}
          id={message.id}
          onDone={onDone}
          audioUrl={audioUrl}
          mediaUrl={mediaUrl}
          textPattern={textPattern}
          duration={message.duration}
          options={options}
        />,
      );
    }
    return <>{components}</>;
  }

  return (
    <AlertMessage
      id={message.id}
      onDone={onDone}
      audioUrl={Array.isArray(message.audioUrl) ? message.audioUrl[0] : message.audioUrl}
      mediaUrl={Array.isArray(message.mediaUrl) ? message.mediaUrl[0] : message.mediaUrl}
      textPattern={message.text}
      duration={message.duration}
      options={message.options}
    />
  );
}
