import { useEffect } from 'react';
import { id, i, init, InstaQLEntity } from "@instantdb/react";

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";

const schema = i.schema({
  entities: {
    messages: i.entity({
      type: i.string(),
      url: i.string(),
      text: i.string(),
      createdAt: i.number(),
      done: i.boolean(),
    }),
  },
});

type Message = InstaQLEntity<typeof schema, "messages">;

const db = init({ appId: APP_ID, schema });

function App() {
  const nowminusthirty = '1739146191101';
  console.log(nowminusthirty);

  // get anything that is not completed
  const { isLoading, error, data } = db.useQuery({
    messages: {
      $: {
        where: {
          done: false
        }
      }
    }
  });

  if (isLoading) {
    return;
  }

  if (error) {
    return <div className="text-red-500 p-4">Error: {error.message}</div>;
  }

  const { messages } = data;


  console.log('messages', messages);

  useEffect(() => {
    console.log('useeffect');

    if (data && !data.messages.length) {
      return;
    }

    async function handleMessages(messages: Message[]) {
      for (let i = 0; i < messages.length; ++i) {
        const message = messages[i];

        if (message.type === 'play_audio') {
          const audio = new Audio(message.url);
          audio.play()
            .then(() => {
              console.log('Audio started playing');
            })
            .catch(error => {
              console.error('Error playing audio:', error);
            })
            .finally(() => {
              db.transact(db.tx.messages[message.id].update({
                done: true,
              }))
            })
        }
      }
    }

    handleMessages(data.messages);

    // let sto = setTimeout(() => {
    //   console.log('calling timeout', messages.length, messages[0].id);
    //   if(messages.length === 0) {
    //      return;
    //   }

    //   db.transact(db.tx.messages[messages[0].id].update({
    //     done: true,
    //   }))
    // }, 5 * 1000);

    // return () => {
    //   clearTimeout(sto);
    // }
  }, [data]);


  if (messages.length === 0) {
    return;
  }

  return (
    <div>
      <div style={{ fontSize: '200px', color: 'red', }}>{messages[0].text}</div>
    </div>
  );
}

export default App
