import { i, InstaQLEntity } from "@instantdb/admin";
import { AlertMessage } from "./AlertMessage";
import { OnDoneCallback } from "~/types";

type Message = InstaQLEntity<typeof schema, "messages">;

const schema = i.schema({
  entities: {
    messages: i.entity({
      type: i.string(),
      mediaUrl: i.string(),
      audioUrl: i.string(),
      text: i.string(),
      duration: i.number(),
      options: i.json(),
      createdAt: i.number(),
      done: i.boolean(),
    }),
  },
});

function calculateArraySize<T>(item: T | T[]): number {
    if(item === undefined) {
        return 0;
    }
     return Array.isArray(item) ? item.length : 1;
}

function findIndexOrDefault<T>(arr: T | T[], index: number, defaultValue: T) {
    if(Array.isArray(arr)){
        return arr[index];
    }

    if(index === 0) {
        return arr;
    }

    return defaultValue;
}

export default function AlertWrapper({ message, onDone }: AlertWrapperProps) {

    // check props to see if we should render more than one alert at a time
    let totals = [
        calculateArraySize(message?.mediaUrl),
        calculateArraySize(message?.audioUrl),
        calculateArraySize(message?.text),
    ];
    let max = Math.max(...totals);

    if(!message) {
        return <></>
    }

    if(max > 1) {
        let components = [];
        for(let i = 0; i < max; i++) {         
            components.push(<AlertMessage
                key={i}
                id={message.id}
                onDone={onDone}
                audioUrl={findIndexOrDefault(message.audioUrl, i, undefined)}
                mediaUrl={findIndexOrDefault(message.mediaUrl, i, undefined)}
                textPattern={findIndexOrDefault(message.text, i, undefined)}
                duration={message?.duration}
                options={findIndexOrDefault(message.options, i, undefined)}
            />)
        }
        return components;
    }

    return (
        <AlertMessage
            id={message.id}
            onDone={onDone}
            audioUrl={message.audioUrl}
            mediaUrl={message.mediaUrl}
            textPattern={message.text}
            duration={message.duration}
            options={message.options}
        />
    )
}

type AlertWrapperProps = { 
    message: Message | null, 
    onDone: OnDoneCallback 
};