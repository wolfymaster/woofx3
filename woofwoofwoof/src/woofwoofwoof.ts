import dotenv from 'dotenv';
import path from 'path';
import NatsClient from './nats';
import TwitchBootstrap from './twitchBootstrap';
import { Commands } from './commands';
import Spotify from './spotify';
import Govee from './govee';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

let channel = process.env.TWITCH_CHANNEL_NAME;
if (!channel) {
    throw new Error('twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.')
}

// new Commands instance
const commander = new Commands();

// bootstrap twitch auth provider
await TwitchBootstrap(channel, commander, {
    databaseURL: process.env.DATABASE_PROXY_URL || "",
});
// create NATS client
const bus = await NatsClient();

commander.add('woof', 'woofwoof');

commander.add('socials', '🐺 FOLLOW WOLFY 🐺 Instagram: https://instagram.com/wolfymaster Twitch: https://twitch.tv/wolfymaster ⠀⠀ YouTube: https://youtube.com/wolfymaster');

commander.add('raid', '🔥🐺 🐺🔥 🐺🔥 🐺 IT\'S RAID O\'CLOCK! 🐺🔥 🐺🔥 🐺🔥WolfyMaster and the unstoppable Wolf Pack are HERE! We DO IT LIVE, MAKE IT EPIC, and BREAK THE INTERNET!💥 PACK ASSEMBLED, HOWL MODE ACTIVATED! Bringing the energy, the chaos, and the HOWLS: AWOOOOOOOOOOOOOOOOOO! 🐺🐺🐺🐺🐺🐺 #WolfPackRaid | wolfym7HYPE wolfym7HYPE wolfym7HYPE | #UnleashThePack');

commander.add('today', 'GOAL: Gift 1 bit, plays a song');

commander.add('fart', '/me @cyburdial farted');

commander.add('lockin', 'Flow State Engaged');

commander.add('skizz', 'WOOOOOOOOOO');

// TODO: FIX - THIS IS MATCHING THE !SONG COMMAND
// commander.add('so', async (text: string) => {
//     // sent request for shoutout with username
//     const username = text.replace('@', '').trim();

//     console.log(username);

//     bus.publish('slobs', JSON.stringify({
//         command: 'shoutout',
//         args: { username }
//     }));

//     return '';
// })

commander.add('follow', async (text: string) => {
    // sent request for shoutout with username
    const username = text.replace('@', '').trim();

    console.log(username);

    bus.publish('slobs', JSON.stringify({
        command: 'follow',
        args: { username }
    }));

    return '';
})

commander.add('song', async (text: string) => {
    // setup spotify client
    const spotify = new Spotify(
        process.env.SPOTIFY_CLIENT_ID || '',
        process.env.SPOTIFY_CLIENT_SECRET || '',
        process.env.SPOTIFY_ACCESS_TOKEN || '',
        process.env.SPOTIFY_REFRESH_TOKEN || ''
    );

    await spotify.refresh();

    const track = await spotify.currentTrack();

    return `Currently Playing: ${track.name} by ${track.artist}`;
})

// SONG REQUESTS
commander.add('sr', async (text: string) => {
    console.log(text);

    // setup spotify client
    const spotify = new Spotify(
        process.env.SPOTIFY_CLIENT_ID || '',
        process.env.SPOTIFY_CLIENT_SECRET || '',
        process.env.SPOTIFY_ACCESS_TOKEN || '',
        process.env.SPOTIFY_REFRESH_TOKEN || ''
    );

    // await spotify.refresh();

    // list devices
    // console.log(await spotify.devices());

    await spotify.refresh();

    // if url, attempt to parse
    if (text.includes('open.spotify.com/track')) {
        const regex = /(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]+)(?:\?|$)/;

        const trackId = text.match(regex)[1];

        console.log('trackId', trackId);

        const song = await spotify.getTrack(trackId);

        await spotify.addToPlaylist(song);

        return `Added to queue: ${song.name} by ${song.artist}`;
    }

    const results = await spotify.search(text);

    // search spotify "smartly"
    const firstResult = results[0];

    // select a song and play it via spotify
    const deviceId = 'bbf76ad22cd4cafc8f15af3376bbfa88fb408dcf' // computer device id
    // await spotify.addToPlaylist(firstResult);
    await spotify.play(firstResult, deviceId);

    return `Added to queue: ${firstResult.name} by ${firstResult.artist}`;
});

// GOVEE CONTROL
commander.add('light', async (text: string) => {
    console.log(text);

    const govee = new Govee();

    // check for reset
    if (text === 'reset') {
        await govee.reset();
        return '';
    }

    // parse text for rbg values
    if (text.includes(',')) {
        const rgb = text.split(',');
        if (rgb.length === 3) {
            await govee.setColor(+rgb[0].trim(), +rgb[1].trim(), +rgb[2].trim());
            return ''
        }
    }

    // lookup color if given color name
    const rgb = govee.lookupColor(text);

    if (rgb) {
        await govee.setColor(rgb[0], rgb[1], rgb[2]);
    }

    return '';
})

// UPDATE STREAM CATEGORY
commander.add('category', async (text: string) => {
    switch (text) {
        case 'sgd':
            bus.publish('twitchapi', JSON.stringify({
                command: 'update_stream',
                args: { category: 'software and game development' }
            }));
            return 'Updating stream category to Software and Game Development';
        case 'jc':
            bus.publish('twitchapi', JSON.stringify({
                command: 'update_stream',
                args: { category: 'just chatting' }
            }));
            return 'Updating stream category to Just Chatting';
        case 'irl':
            bus.publish('twitchapi', JSON.stringify({
                command: 'update_stream',
                args: { category: 'irl' }
            }));
            return 'Updating stream category to IRL';
        case 'apex':
            bus.publish('twitchapi', JSON.stringify({
                command: 'update_stream',
                args: { category: 'apex legends' }
            }));
        default:
            console.error('INVALID TWITCH CATEGORY');
    }

    return '';
});

// UPDATE STREAM TITLE
commander.add('title', async (text: string) => {
    bus.publish('twitchapi', JSON.stringify({
        command: 'update_stream',
        args: { title: text }
    }));

    return `Stream title updated to: ${text}`;
});
