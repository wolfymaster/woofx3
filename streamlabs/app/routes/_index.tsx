import { useEffect, useState } from "react";
import type { MetaFunction } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { id, i, init, InstaQLEntity } from "@instantdb/react";
import AlertAudio from '~/components/AlertAudio';
import { AlertMessage } from "~/components/AlertMessage";
import { TaskCompleted } from '~/types';


export const meta: MetaFunction = () => {
  return [
    { title: "woofx x streamlabs" },
    { name: "description", content: "woofx3 x streamlabs" },
  ];
};

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";

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

type Message = InstaQLEntity<typeof schema, "messages">;

const db = init({ appId: APP_ID, schema });

export default function Index() {
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  // get anything that is not completed
  const { isLoading, error, data } = db.useQuery({
    messages: {
      $: {
        where: {
          done: false,
          woofx3Key: searchParams.get('woofx3Key') || '',
        }
      }
    }
  });

  useEffect(() => {
    if (!currentMessageId && data?.messages && data.messages.length > 0) {
      setCurrentMessageId(data.messages[0].id);
    }
  }, [currentMessageId, data]);

  const message: Message|null = data?.messages?.find(msg => msg.id === currentMessageId) || null;

  function onDone(task: TaskCompleted) {
    console.log('all done');
    try {
      if (task.error) {
        console.error(`Error processing message ${task.id}:`, task.errorMsg);
      }
      db.transact(db.tx.messages[task.id].update({
        done: true,
      }));
    } catch (err) {
      console.error("Transaction error:", err);
    } finally {
      setCurrentMessageId(null);
    }
  }

  if (isLoading) {
    return <></>;
  }

  if (error) {
    return <div className="text-red-500 p-4">Error: {error.message}</div>;
  }

  if (!message) {
    return <></>;
  }

  console.log(message.options);

  return (
    <>
    {message.type === 'play_audio' &&
      <AlertAudio
        id={message.id}
        url={message.audioUrl}
        onDone={onDone}
      />}
    {message.type === 'alert_message' &&
      <AlertMessage
        id={message.id}
        onDone={onDone}
        audioUrl={message.audioUrl}
        mediaUrl={message.mediaUrl}
        textPattern={message.text}
        duration={message.duration}
        options={message.options}
      />}
  </>
  );
}
