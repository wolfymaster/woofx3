import { useEffect, useRef, useState } from 'react';
import { OnDoneCallback } from '~/types';

export default function AlertAudio({ id, url, duration, onDone }: AlertAudioProps) {
    const [done, setDone] = useState(false);
    const [error, setError] = useState();
    const audio = useRef(new Audio());

    if (url === "") {
        onDone({ id, error: true, errorMsg: 'url is empty' });
        return;
    }

    useEffect(() => {
        if (!done) {
            return;
        }
        onDone({ id, error: !!error, errorMsg: error });
    }, [done]);

    useEffect(() => {
        let audioTimeout: NodeJS.Timeout;
        let player = audio.current

        function handleEnded() {
            setDone(true);
            if (audioTimeout) {
                clearTimeout(audioTimeout);
            }
        }

        function handleCanPlayThrough() {
            player.play()
                .then(() => {
                    if (duration) {
                        audioTimeout = setTimeout(() => {
                            player.pause();
                            setDone(true);
                        }, duration * 1000);
                    }
                })
                .catch(error => {
                    console.log('error', error);
                    setDone(true);
                    setError(error);
                })
        };

        console.log(url);
        player.src = url;
        player.addEventListener('ended', handleEnded);
        player.addEventListener('canplaythrough', handleCanPlayThrough);

        return () => {
            if (audioTimeout) {
                clearTimeout(audioTimeout);
            }
            player.removeEventListener('ended', handleEnded);
            player.removeEventListener('canplaythrough', handleCanPlayThrough);
            player.pause();
            player.src = '';
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