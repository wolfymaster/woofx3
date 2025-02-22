import { useState, useEffect } from 'react';

import Header from "./Header";
import Tabone from "./Tabone";
import Tabtwo from "./Tabtwo";
import Tabthree from "./Tabthree";

import './style.css';

function App() {
  const [token, setToken] = useState('');
  const [activeTab, setActiveTab] = useState(0);

  const tabs = [Tabone, Tabtwo, Tabthree];
  const CurrentTab = tabs[activeTab];

  useEffect(() => {
    window.Twitch.ext.onAuthorized(function (auth) {
      console.log(auth);
      setToken(auth.token);
      console.log('The Helix JWT is ', auth.helixToken);
    });
  })

  return (
    <>
      <Header onClick={setActiveTab} />
      <CurrentTab token={token} />
    </>
  )
}

export default App
