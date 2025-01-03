import { Player, Controls } from '@lottiefiles/react-lottie-player';
import { AnimationItem } from 'lottie-web';

import follow from './follow.json';
import { useEffect, useState } from 'react';

function App() {
  let [instance, setInstance] = useState<AnimationItem>();
  let [username, setUsername] = useState<string|null>(null);

  // console.log(follow.layers[1].t.d.k[0].s.t);

  useEffect(() => {
    async function getUsername() {
      const response = await fetch('username.txt');
      const body = await response.text();
      setUsername(body);
      console.log('username', body);
    }
    getUsername();
  }, [])


  if(!username) {
    return <></>
  }

  follow.layers[1].t.d.k[0].s.t  = username;

  return (
    <>
      <div style={{ position:'absolute' }}>
        <video src='images/follow.webm' autoPlay loop></video>
      </div>
      <div style={{ position:'absolute' }}>
        <Player
        lottieRef={lottie => {
          setInstance(lottie)
        }}
          autoplay
          loop
          src={follow}
          style={{ height: '1080px', width: '1920px' }}
        ></Player>
      </div>
    </>
  )
}

export default App
