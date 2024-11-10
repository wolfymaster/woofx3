const clientId = '6t2yb74purkys2s5int8j5boyqj1oh';
const clientSecret  = '405krobjkzvi9757nrhuz410pl2iuk';
const tokenUrl = 'https://id.twitch.tv/oauth2/token';

async function getAccessToken(): Promise<string> {
    const url = `${tokenUrl}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        }
    });

    if (!response.ok) {
        throw new Error('Failed to fetch access token');
    }

    const data = await response.json();
    return data.access_token; // Return the access token
}

async function fetchTwitchAccessToken() {
    try {
        const token = await getAccessToken();
        console.log('Access token:', token);
        // Now you can use this token in your API requests
    } catch (error) {
        console.error('Error fetching access token:', error);
    }
}

// Example usage:
fetchTwitchAccessToken();
