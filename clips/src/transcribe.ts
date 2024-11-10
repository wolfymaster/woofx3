import { exec } from 'child_process';
import { readdir, rename, stat } from 'fs/promises';
import { dirname, join } from 'path';

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

async function moveFileToFolder(srcPath: string, destFolder: string): Promise<void> {
    // Ensure the destination folder path is valid
    if (!destFolder) {
        throw new Error('Destination folder cannot be empty');
    }

    // Get the file name from the source path
    const fileName = srcPath.split('/').pop();
    if (!fileName) {
        throw new Error('Invalid source file path');
    }

    // Construct the new file path in the destination folder
    const destPath = join(destFolder, fileName);

    try {
        // Move the file
        await rename(srcPath, destPath);
        console.log(`File moved to ${destPath}`);
    } catch (error) {
        console.error(`Error moving file: ${error.message}`);
        throw error; // Rethrow error for further handling
    }
}

function transcribeWithWhisper(filePath: string, outDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`whisper ${filePath} --language en --output_format json --output_dir ${outDir}`, (err, stdout, stderr) => {
            if (err) {
                reject(`Error: ${stderr}`);
                return;
            }
            resolve(stdout);
        });
    });
}

// read all the files in downloads, transcribe, then move to processed
getAllFilePaths('./downloads')
    .then(async (filePaths) => {
        for(const path of filePaths) {
            console.log("processing: ", path);
            await transcribeWithWhisper(path, "./transcripts");
            await moveFileToFolder(path, './processed');
        }        
    })
    .then(() => console.log("done"));
