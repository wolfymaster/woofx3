import fs from 'fs/promises';

const clientId = '6t2yb74purkys2s5int8j5boyqj1oh';
const accessToken = 'g747hrc7gjze2rhgz5zh6ivazkusm7';  // OAuth token
const baseUrl = 'https://api.twitch.tv/helix/';

/**
 * Look up the broadcaster's broadcasterId
 * @param username twitch username
 * @returns broadcaster's broadcasterId
 */
async function getBroadcasterId(username: string): Promise<string> {
    const url = `${baseUrl}users?login=${username}`;
    const response = await fetch(url, {
        headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${accessToken}`,
        }
    });

    const data = await response.json();

    return data.data[0].id;
}

/**
 * Get all the clips which occurr after some cursor
 * @param broadcasterId braodcaster id
 * @param after cursor to retrieve clips after
 * @returns array of clips
 */
async function getClips(broadcasterId: string, after?: string): Promise<any[]> {
    const url = new URL(`${baseUrl}clips`);
    url.searchParams.append('broadcaster_id', broadcasterId);
    url.searchParams.append('first', '100');  // Max limit for page size

    if (after) {
        url.searchParams.append('after', after);  // Pagination token
    }

    const response = await fetch(url.toString(), {
        headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${accessToken}`,
        }
    });

    const data = await response.json();
    const clips = data.data;

    // If there's more data, continue fetching
    if (data.pagination && data.pagination.cursor) {
        const nextPageClips = await getClips(broadcasterId, data.pagination.cursor);
        return clips.concat(nextPageClips);
    }

    return clips;
}

/**
 * Get all the clips for a channel
 * @param username broadcaster username
 * @returns array of clips
 */
async function getAllClipsForChannel(username: string): Promise<any[]> {
    try {
        const broadcasterId = await getBroadcasterId(username);
        const clips = await getClips(broadcasterId);
        return clips;
    } catch (error) {
        console.error('Error fetching clips:', error);
    }

    return [];
}

/**
 * Writes an array to a JSON file.
 * 
 * @param data - The array to write to the JSON file.
 * @param filePath - The local file path where the JSON file should be saved.
 */
async function writeArrayToJsonFile<T>(data: T[], filePath: string): Promise<void> {
    const jsonData = JSON.stringify(data, null, 2); // Convert array to JSON with pretty printing
    await Bun.write(filePath, jsonData); // Write JSON data to the specified file
    console.log(`Array written successfully to ${filePath}`);
}


const channelName = 'jessikah_grace';
const filePath = `./out/${channelName}_clips.json`;


async function run() {
    // get all clips for channel
    let existingClips: any[] = [];
    const newClips = await getAllClipsForChannel(channelName);
    console.log(`${channelName} has ${newClips.length} total clips`);

    // if we have a file, set the existing clips
    if(fs.exists(filePath)) {
        // populate the existing clip ids
        const contents = await fs.readFile(filePath, 'utf-8');
        existingClips = JSON.parse(contents);

        console.log(`Found existing file: ${filePath} with ${existingClips.length} clips`);
    }

    const ids = existingClips.map( (c: any) => c.id);
    const existingClipIds = new Set(ids);
        
    // remove any clips that we alrady have
    const clips = newClips.filter(c => !existingClipIds.has(c.id));

    // append only
    console.log(`Adding ${clips.length} new clips to file`);
    const outclips = existingClips.concat(clips);

    // write or overwrite the existing file
    await writeArrayToJsonFile(outclips, filePath);
    console.log(`Done. ${outclips.length} clips written to file: ${filePath}`);
}

run();
