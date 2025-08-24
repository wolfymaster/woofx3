import { useEffect, useState } from 'react';
import Lottie from 'react-lottie-player'

export default function Bits() {
    const [animation, setAnimation] = useState(null);

    useEffect(() => {
        async function makeRequest() {
            const res = await fetch('https://streamlabs.local.woofx3.tv/bit_overlay.json');
            const json = await res.json();

            // update number
            json.assets[0].layers[0].t.d.k[0].s.t = '1234 BITS';

            setAnimation(json);
        }

        makeRequest();
    }, [])

    if(!animation) {
        return (
            <></>
        )
    }

    return (
        <>
            <Lottie
                loop
                animationData={animation}
                play
                style={{ width: 1920, height: 1080 }}
            />
        </>
    )
}