/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function song_request(ctx) {
    // ChatCommandEventData (shared/common/typescript/cloudevents/Chat/commands.ts):
    //   { command, args, rawMessage, text, variables, chatter, platform }
    // `text` is rawMessage with the command token already stripped; `variables`
    // holds named argument_pattern captures (this command's pattern is
    // "{songTitle}", so variables.songTitle is the query when configured).
    // ctx.event.parameters is reserved for workflow-step-authored config
    // (e.g. deviceId below) and is never used for command-derived data.
    // Every exit point below uses ctx.response(success, message) instead of
    // ctx.chat.sendMessage — one mechanism instead of two, and it works
    // whether or not the chat extension happens to be bound.
    var data = (ctx.event && ctx.event.data) ? ctx.event.data : {};

    var variables = data.variables || {};
    var query = (variables.songTitle || data.text || "").trim();
    if (!query) {
        return ctx.response(false, "Usage: !sr <song name or Spotify URL>");
    }

    var clientId = ctx.module.settings.clientId;
    var clientSecret = ctx.module.settings.clientSecret;
    var refreshToken = ctx.module.settings.refreshToken;

    if (!clientId || !clientSecret || !refreshToken) {
        return ctx.response(false, "Spotify is not configured. Set clientId, clientSecret, and refreshToken in the module settings.");
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
        return ctx.response(false, "Failed to connect to Spotify.");
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
            return ctx.response(false, "Could not find that track on Spotify.");
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
            return ctx.response(false, "No results found for: " + query);
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
        return ctx.response(false, "Failed to queue " + song.name + ".");
    }

    return ctx.response(true, "Added to queue: " + song.name + " by " + song.artist);
}
