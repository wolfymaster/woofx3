import { readdir, rename, stat } from 'fs/promises';
import { dirname, join } from 'path';
import fs from 'fs';

type Clip = {
    id: string;
    url: string;
    title: string;
};

async function getAllFilePaths(dirPath: string): Promise<string[]> {
    let filePaths: string[] = [];
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const entryStat = await stat(fullPath);

        if (entryStat.isDirectory()) {
            // Recursively read subdirectories
            const subDirPaths = await getAllFilePaths(fullPath);
            filePaths = filePaths.concat(subDirPaths);
        } else {
            // Add the file path to the list
            filePaths.push(fullPath);
        }
    }

    return filePaths;
}

async function readJsonFile(filePath: string): Promise<Clip[]> {
    try {
        // Read the file content
        const data = await fs.promises.readFile(filePath, 'utf-8');
        // Parse and return the JSON object
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading JSON file: ${error}`);
        throw error;
    }
}


getAllFilePaths('./transcripts')
    .then(async (filePaths) => {
        for(const path of filePaths) {
            const contents = await readJsonFile(path);
            const text = contents.text;
            console.log(text);
        }
    });
