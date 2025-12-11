import type { ChatMessage, ChatMessageResponse } from "../../../types";
import Govee from './govee';

export default async function main(chatMsg: ChatMessage): Promise<ChatMessageResponse> {
    const text = chatMsg.message;

    console.log(text);

    const govee = new Govee();

    // check for reset
    if (text === 'reset') {
        await govee.reset();
        return {
            type: 'success',
            value: '',
        };
    }

    // parse text for rbg values
    if (text.includes(',')) {
        const rgb = text.split(',');
        if (rgb.length === 3) {
            await govee.setColor(+rgb[0].trim(), +rgb[1].trim(), +rgb[2].trim());
            return {
                type: 'success',
                value: '',
            }
        }
    }

    // lookup color if given color name
    const rgb = govee.lookupColor(text);

    if (rgb) {
        await govee.setColor(rgb[0], rgb[1], rgb[2]);
    }

    return {
        type: 'success',
        value: '',
    };
}