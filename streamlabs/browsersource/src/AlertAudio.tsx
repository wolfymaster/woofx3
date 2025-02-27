import { useEffect, useState } from 'react';
import { OnDoneCallback } from './types';

export default function AlertAudio({ id, url, duration, onDone }: AlertAudioProps) {
    const [done, setDone] = useState(false);
    const [error, setError] = useState();

    if(url === "") {
        onDone({ id, error: true, errorMsg: 'url is empty'});
        return;
    }

    useEffect(() => {
        if (!done) {
            return;
        }
        onDone({ id, error: !!error, errorMsg: error });
    }, [done]);

    useEffect(() => {
        let audioTimeout: number;

        const audio = new Audio(url);
        audio.addEventListener('ended', function () {
            setDone(true);
            if(audioTimeout) {
                clearTimeout(audioTimeout);
            }
        });
        audio.play()
            .then(() => {
                if(duration) {
                    audioTimeout = setTimeout(() => {
                        audio.pause();
                        setDone(true);
                    }, duration * 1000);
                }
            })
            .catch(error => {
                setError(error);
            })

        return () => {
            if(audioTimeout) {
                clearTimeout(audioTimeout);
            }
            audio.pause();
        }
    }, [id]);

    return <></>
}

type AlertAudioProps = {
    id: string;
    url: string;
    duration?: number;
    onDone: OnDoneCallback;
}