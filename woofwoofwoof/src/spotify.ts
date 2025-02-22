import { SpotifyApi, Track } from '@spotify/web-api-ts-sdk';

export type Song = {
    id: string;
    name: string;
    artist: string;
    uri: string;
}

export default class Spotify {
    private client: SpotifyApi;

    constructor(private clientId: string, private clientSecret: string, accessToken: string, private refreshToken: string) {
        // this.client = SpotifyApi.withAccessToken(clientId, {
        //     access_token: accessToken,
        //     expires_in: 3600,
        //     refresh_token: refreshToken,
        //     token_type: 'Bearer'
        // });
    }

    async search(query: string): Promise<Song[]> {
        console.log('refreshed in search');

        const result = await this.client.search(query, ["track"]);

        const items: Song[] = result.tracks.items.map(i => {
            return {
                id: i.id,
                name: i.name,
                artist: i.artists[0].name,
                uri: i.uri
            }
        });

        return items;
    }

    async play(song: Song, deviceId?: string): Promise<void> {
        await this.refresh();
        console.log('refreshed in play');

        if(!song.uri) {
            return;
        }

        try {
            await this.client.player.addItemToPlaybackQueue(song.uri, deviceId);
        } catch (err) {
            console.log('erring when adding song to queue');
            console.log(err);
        }
    }

    async devices() {
        const response = await this.client.player.getAvailableDevices();

        return response.devices;
    }

    async addToPlaylist(song: Song) {
        const playlistId = '5s1q5vndWdyWqh9KA39s1E';

        await this.client.playlists.addItemsToPlaylist(playlistId, [song.uri]);
    }

    async refresh() {
        const formData = {
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken
        };

        const urlEncodedData = new URLSearchParams(formData).toString();

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'post',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + (Buffer.from(this.clientId + ':' + this.clientSecret).toString('base64'))
            },
            body: urlEncodedData,  
        });

        const json = await response.json();

        this.client = SpotifyApi.withAccessToken(this.clientId, json);
    }

    async getTrack(trackId): Promise<Song> {
        const track = await this.client.tracks.get(trackId);

        return {
            id: track.id,
            name: track.name,
            artist: track.artists[0].name,
            uri: track.uri,
        }
    }

    async currentTrack(): Promise<Song> {
        const state = await this.client.player.getCurrentlyPlayingTrack();

        const item: Track = state.item as Track;

        return {
            id: item.id,
            artist: item.artists[0].name,
            name: item.name,
            uri: item.uri,
        }
    }
}