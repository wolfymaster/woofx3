/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function song_request(ctx) {
    // ctx.event is shaped by buildModuleInvokeEvent in workflow/actions.go:
    //   { parameters: {}, id, type, source, time, data: ChatCommandEventData }
    // ChatCommandEventData: { command, args, rawMessage, chatter, platform }
    var data = (ctx.event && ctx.event.data) ? ctx.event.data : {};
    var rawMessage = data.rawMessage || "";

    // Strip "!sr " prefix to get the query
    var query = rawMessage.replace(/^!sr\s+/i, "").trim();
    if (!query) {
        if (ctx.chat) { ctx.chat.sendMessage("Usage: !sr <song name or Spotify URL>"); }
        return { sent: false, error: "empty query" };
    }

    var clientId = ctx.module.settings.clientId;
    var clientSecret = ctx.module.settings.clientSecret;
    var refreshToken = ctx.module.settings.refreshToken;

    if (!clientId || !clientSecret || !refreshToken) {
        if (ctx.chat) { ctx.chat.sendMessage("Spotify is not configured. Set clientId, clientSecret, and refreshToken in the module settings."); }
        return { sent: false, error: "missing config" };
    }

    // Refresh access token (Spotify OAuth2 refresh grant).
    // QuickJS has no btoa — inline a minimal base64 encoder for ASCII strings.
    var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function base64(str) {
        var result = "";
        var i = 0;
        while (i < str.length) {
            var a = str.charCodeAt(i++);
            var b = (i < str.length) ? str.charCodeAt(i++) : 0;
            var c = (i < str.length) ? str.charCodeAt(i++) : 0;
            var t = (a << 16) | (b << 8) | c;
            result += B64_CHARS[(t >> 18) & 63];
            result += B64_CHARS[(t >> 12) & 63];
            result += (i - 2 < str.length) ? B64_CHARS[(t >> 6) & 63] : "=";
            result += (i - 1 < str.length) ? B64_CHARS[t & 63] : "=";
        }
        return result;
    }

    var tokenResp = ctx.http.request(
        "https://accounts.spotify.com/api/token",
        "POST",
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": "Basic " + base64(clientId + ":" + clientSecret)
            },
            body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshToken)
        }
    );

    if (!tokenResp || tokenResp.status !== 200 || !tokenResp.body || !tokenResp.body.access_token) {
        if (ctx.chat) { ctx.chat.sendMessage("Failed to connect to Spotify."); }
        return { sent: false, error: "token refresh failed", status: tokenResp && tokenResp.status };
    }

    var accessToken = tokenResp.body.access_token;
    var authHeader = "Bearer " + accessToken;

    // Determine if query is a Spotify track URL or a search term.
    var urlMatch = query.match(/(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
    var song = null;

    if (urlMatch) {
        var trackId = urlMatch[1];
        var trackResp = ctx.http.request(
            "https://api.spotify.com/v1/tracks/" + trackId,
            "GET",
            { headers: { "Authorization": authHeader } }
        );
        if (!trackResp || trackResp.status !== 200 || !trackResp.body) {
            if (ctx.chat) { ctx.chat.sendMessage("Could not find that track on Spotify."); }
            return { sent: false, error: "track lookup failed", status: trackResp && trackResp.status };
        }
        song = {
            name: trackResp.body.name,
            artist: trackResp.body.artists[0].name,
            uri: trackResp.body.uri
        };
    } else {
        var searchResp = ctx.http.request(
            "https://api.spotify.com/v1/search",
            "GET",
            {
                headers: { "Authorization": authHeader },
                query: { q: query, type: "track", limit: "1" }
            }
        );
        var tracks = searchResp && searchResp.body && searchResp.body.tracks && searchResp.body.tracks.items;
        if (!tracks || tracks.length === 0) {
            if (ctx.chat) { ctx.chat.sendMessage("No results found for: " + query); }
            return { sent: false, error: "no results", query: query };
        }
        var track = tracks[0];
        song = {
            name: track.name,
            artist: track.artists[0].name,
            uri: track.uri
        };
    }

    // Add to Spotify playback queue.
    var params = (ctx.event && ctx.event.parameters) || {};
    var deviceId = (params.deviceId != null && params.deviceId !== "")
        ? params.deviceId
        : ctx.env.get("SPOTIFY_DEVICE_ID");
    var queueUrl = "https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(song.uri);
    if (deviceId) { queueUrl += "&device_id=" + encodeURIComponent(deviceId); }

    var queueResp = ctx.http.request(queueUrl, "POST", {
        headers: { "Authorization": authHeader }
    });

    // 200 or 204 both indicate success.
    if (!queueResp || (queueResp.status !== 200 && queueResp.status !== 204)) {
        if (ctx.chat) { ctx.chat.sendMessage("Failed to queue " + song.name + "."); }
        return { sent: false, error: "queue failed", status: queueResp && queueResp.status };
    }

    var msg = "Added to queue: " + song.name + " by " + song.artist;
    if (ctx.chat) { ctx.chat.sendMessage(msg); }

    return { sent: true, song: song.name, artist: song.artist };
}
