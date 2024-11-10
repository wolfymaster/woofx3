import { exec } from 'child_process';
import fs from 'fs/promises';
import { promisify } from 'util';

const execAsync = promisify(exec);

type Clip = {
    id: string;
    url: string;
    title: string;
};

// Function to download a Twitch clip
async function downloadTwitchClip(clip: Clip, outputPath: string): Promise<void> {
    try {
        const filePath = `${outputPath}/${clip.id}.mp4`;
        const command = `streamlink "${clip.url}" best --output "${filePath}"`;

        const { stdout, stderr } = await execAsync(command); 
        if (stderr) {
            console.error(`ffmpeg stderr: ${stderr}`);
            return;
        }
        console.log(`Clip downloaded successfully: ${filePath}`);
    } catch (error) {
        console.error(`Failed to download clip: ${error}`);
    }
}

async function readJsonFile(filePath: string): Promise<Clip[]> {
    try {
        // Read the file content
        const data = await fs.readFile(filePath, 'utf-8');
        // Parse and return the JSON object
        return JSON.parse(data) as Clip[];
    } catch (error) {
        console.error(`Error reading JSON file: ${error}`);
        throw error;
    }
}

const filePath = './out/jessikah_grace_clips.json';
const processedDirectory = './processed';
const downloadDirectory = './downloads';
const processClipLimit = 20;

async function run() {
    // what clips have already been processed or downloaded
    const existingFiles = [].concat(await fs.readdir(processedDirectory), await fs.readdir(downloadDirectory)); 
    console.log(`${existingFiles.length} already processed clips found`);
    // create a set. remove the file extension off the files
    const processedClipids = new Set(existingFiles.map((f: string) => f.replace(/\.[^/.]+$/, "")));

    // get list of all clips
    const clips = await readJsonFile(filePath);

    // filter only the unprocessed clips
    const unprocessedClips = clips.filter(c => !processedClipids.has(c.id));
    console.log(`${unprocessedClips.length} total unprocessed clips to download`);

    // process the unprocessed clips up to limit
    const clipsToProcess = unprocessedClips.slice(0, processClipLimit);

    console.log(`Downloading ${clipsToProcess.length} clips to: ${downloadDirectory}`);

    const counter = { count: clipsToProcess.length };
    const promises = clipsToProcess.map(async (c) => {
        console.log(`Starting clip download: ${c.title}`);
        await downloadTwitchClip(c, downloadDirectory);
        console.log(`Finished clip download: ${c.title}`);
        console.log(`${--counter.count} clips remaining`);
    });

    await Promise.all(promises);
    console.log('Done');
}

run();
