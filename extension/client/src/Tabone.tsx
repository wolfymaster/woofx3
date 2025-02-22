import { id, i, init, InstaQLEntity } from "@instantdb/react";

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";

const schema = i.schema({
  entities: {
    messages: i.entity({
      text: i.string(),
      done: i.boolean(),
      createdAt: i.number(),
    }),
  },
});

const db = init({ appId: APP_ID, schema });

export default function Tabone({ token }: TaboneProps) {

    async function handleClick() {
        const response = await fetch('http://localhost:3001/payload', {
            method: 'post',
            headers: {
                authorization: token,
            }
        });

        const payload = await response.json();
    
        console.log('payload: ', payload);
    }

    return (
        <div id="tab1" className="tab show">
            <p>Tab One</p>

            <button onClick={handleClick}>Press me</button>
        </div>
    )
}

type TaboneProps = {
    token: string;
}