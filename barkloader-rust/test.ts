import fs from 'fs';
import path from 'path';
import { Blob } from 'buffer';
import { $ } from "bun";

async function postFunctions() {
    const formData = new FormData();

    const file = new File(["This is file content"], "myfile.txt", {
        type: "text/plain",
        lastModified: Date.now()
    });

    formData.append('file', file);

    try {
        const response = await fetch('http://barkloader.local.woofx3.tv/functions', {
            method: 'POST',
            body: formData,
        });

        return await response.json();
    } catch (err) {
        throw new Error("busted");
    }
}

async function uploadZipFileFromPath(filePath: string, endpoint: string): Promise<any> {
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        // Read file as buffer and create a Blob
        const fileBuffer = fs.readFileSync(filePath);
        const fileName = filePath.split('/').pop() || 'upload.zip';

        // Create a Blob from the file buffer (like in browser)
        const blob = new Blob([fileBuffer], { type: 'application/zip' });

        // Use built-in FormData (same as browser)
        const formData = new FormData();
        formData.append('file', blob, fileName);

        // Make request (same as browser)
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
}


async function patchFunctions() {
    try {
        const response = await fetch('http://barkloader.local.woofx3.tv/functions', {
            method: 'patch',
        });

        return await response.json();
    } catch (err) {
        throw new Error("busted");
    }

}

async function makeZipFile() {
    const moduleDirectory = path.join(__dirname, "../boardModule");
    await $`zip -r module.zip .`.cwd(moduleDirectory);

    const zipFilePath = path.join(moduleDirectory, 'module.zip');
    await $`mv ${zipFilePath} .`;
}

async function cleanup() {
    await $`rm module.zip`;
}

// console.log(await postFunctions());

// make the zip file
await makeZipFile();
// upload the zip file
const baseUrl = 'http://localhost:9653'; // 'http://barkloader.local.woofx3.tv'
const response = await uploadZipFileFromPath('module.zip', `${baseUrl}/functions`);
console.log(response);
await cleanup();
