import { useEffect, useState } from "react";
import { OnDoneCallback } from "~/types";
import AlertAudio from "./AlertAudio";
import { Message } from "postcss";
import Animation from "./Animation";

function createMediaComponent(mediaUrl: string, options: MessageOptions = {}) {
    const classnames = [];
    const width = options?.view?.fullScreen ? '100%' : '500';
    options?.media?.transparentBlack && classnames.push('transparentBlack');
    options?.media?.transparentWhite && classnames.push('transparentWhite');

    const ext = mediaUrl.split('.').pop();
    switch (ext) {
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'png':
            return <img className={classnames.join(' ')} src={mediaUrl} width={width} />
        case 'mp4':
            return <video className={classnames.join(' ')} width={width} autoPlay={true} loop={true}>
                <source src={mediaUrl} type="video/mp4"></source>
            </video>
        case 'json':
            if(!options?.animation?.path) {
                return '';
            }
            return <Animation 
                src={mediaUrl} 
                path={options.animation.path} 
                value={options.animation.value} 
                width={width}
                loop={true} 
            />
        default:
            return '';
    }
}

function createFormattedText(textPattern: string): string {
    // Define substitution patterns and their corresponding opening tags
    const substitutions: Record<string, string> = {
        '{primary}': '<span style="color: #EC6758">'
    };

    // Create a map of closing tags for each substitution
    const closingTags: Record<string, string> = {};
    for (const [pattern, openingTag] of Object.entries(substitutions)) {
        // Extract tag name from opening tag
        const tagMatch = openingTag.match(/<([a-z0-9]+)[\s>]/i);
        if (tagMatch && tagMatch[1]) {
            closingTags[pattern] = `</${tagMatch[1]}>`;
        } else {
            // Fallback in case the regex doesn't match
            closingTags[pattern] = '';
        }
    }

    let result = textPattern;

    // Process each substitution pattern
    for (const [pattern, openingTag] of Object.entries(substitutions)) {
        // Split the text by the pattern
        const segments = result.split(pattern);

        // Only process if we have at least one pattern match
        if (segments.length > 1) {
            // Reconstruct the string with proper opening and closing tags
            result = segments.reduce((acc, segment, index) => {
                // If this is the last segment, just append it
                if (index === segments.length - 1) {
                    return acc + segment;
                }

                // For odd indices (inside the pattern), add the opening tag before and closing tag after
                if (index % 2 === 0) {
                    return acc + segment + openingTag;
                } else {
                    return acc + segment + closingTags[pattern];
                }
            }, '');
        }
    }

    return result;
}

export function AlertMessage({ id, textPattern, mediaUrl, audioUrl, duration, options, onDone }: AlertMessageProps) {
    const [done, setDone] = useState([!(textPattern || mediaUrl), !(audioUrl)]);

    useEffect(() => {
        const allDone = done.every(d => d);
        if (!allDone) {
            return;
        }
        onDone({ id, error: false });
    }, [done]);

    // image/text
    useEffect(() => {
        let timer = setTimeout(() => {
            setDone(([_, audioDone]) => [true, audioDone]);
        }, (duration || 5) * 1000);

        return () => clearTimeout(timer);
    }, [])

    // audio callback
    function audioDoneCallback() {
        setDone(([txtDone, _]) => [txtDone, true]);
    }

    // set additional classnames
    const classnames = [];
    options?.view?.fullScreen && classnames.push('fullscreen');
    options?.view?.positionAbsolute && classnames.push('absolute');

    return (
        <div id="alertBox" className={classnames.join(' ')}>
            {mediaUrl && createMediaComponent(mediaUrl, options)}
            {textPattern && <div style={{ fontFamily: 'Roboto', fontWeight: 'bold', color: 'white', fontSize: '48px' }} dangerouslySetInnerHTML={{ __html: createFormattedText(textPattern)}}></div>}
            {audioUrl && <AlertAudio id={id} onDone={audioDoneCallback} url={audioUrl} duration={duration} />}
        </div>
    )
}

type AlertMessageProps = {
    id: string;
    textPattern?: string;
    mediaUrl?: string,
    audioUrl?: string,
    duration?: number;
    options?: MessageOptions;
    onDone: OnDoneCallback;
}

type MessageOptions = {
    view?: {
        fullScreen?: boolean;
        positionAbsolute?: boolean;
    },
    media?: {
        transparentBlack?: boolean;
        transparentWhite?: boolean;
    },
    animation?: {
        path: (string | number)[],
        value: string,
    }
}