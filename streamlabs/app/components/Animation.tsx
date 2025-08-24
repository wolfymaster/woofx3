import { useEffect, useState } from 'react';
import Lottie from 'react-lottie-player'

export default function Animation({ src, width, loop, path, value }: AnimationProps) {
    const [animation, setAnimation] = useState(null);

    useEffect(() => {
        async function makeRequest() {
            const res = await fetch(src);
            const json = await res.json();
            
            let currentObj = json;
            let currentIdx = 0;

            while(currentIdx < path.length) {
                // read from array
                const property = path[currentIdx];

                // want to stop 1 short of the full path, so that we assign the final property
                if(currentIdx == path.length - 1) {
                    // update value of currentObj
                    currentObj[property] = value;
                } else {
                    // access that next property of json
                    currentObj = currentObj[property];
                }

                // increment the current index
                currentIdx++;
            }            

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
                style={{ width, height: '100%' }}
            />
        </>
    )
}

type pathIndex = string | number;

type AnimationProps = {
    src: string,
    width: string,
    loop: boolean,
    path: pathIndex[],
    value: string
};