import { useState } from 'react';
import { OnDoneCallback } from './types';

export default function Audio({ url }: AudioProps) {
    const [done, setDone] = useState(false);

    return <></>
}

type AudioProps = {
    url: string;
    onDone: OnDoneCallback;
}