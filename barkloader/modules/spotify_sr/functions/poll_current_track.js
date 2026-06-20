/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function poll_current_track(ctx) {
    var clientId = ctx.module.settings.clientId;
    var clientSecret = ctx.module.settings.clientSecret;
    var refreshToken = ctx.module.settings.refreshToken;

    if (!clientId || !clientSecret || !refreshToken) {
        return { error: "missing config" };
    }

    // QuickJS has no btoa — inline a minimal base64 encoder for ASCII strings.
    var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function base64(str) {
        var result = "";
        var i = 0;
        while (i < str.length) {
            var remaining = str.length - i;
            var a = str.charCodeAt(i++);
            var b = remaining > 1 ? str.charCodeAt(i++) : 0;
            var c = remaining > 2 ? str.charCodeAt(i++) : 0;
            var t = (a << 16) | (b << 8) | c;
            result += B64_CHARS[(t >> 18) & 63];
            result += B64_CHARS[(t >> 12) & 63];
            result += remaining > 1 ? B64_CHARS[(t >> 6) & 63] : "=";
            result += remaining > 2 ? B64_CHARS[t & 63] : "=";
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
        return { error: "token refresh failed", status: tokenResp && tokenResp.status };
    }

    var accessToken = tokenResp.body.access_token;
    var authHeader = "Bearer " + accessToken;

    var playerResp = ctx.http.request(
        "https://api.spotify.com/v1/me/player/currently-playing",
        "GET",
        { headers: { "Authorization": authHeader } }
    );

    if (!playerResp) {
        return { error: "no response from player API" };
    }

    // 204 means nothing is currently playing.
    if (playerResp.status === 204) {
        ctx.storage.set("current_track", null);
        return null;
    }

    if (playerResp.status !== 200 || !playerResp.body) {
        return { error: "player API error", status: playerResp.status };
    }

    var item = playerResp.body.item;
    if (!item) {
        ctx.storage.set("current_track", null);
        return null;
    }

    var artist = (item.artists && item.artists.length > 0) ? item.artists[0].name : null;
    var albumArt = (item.album && item.album.images && item.album.images.length > 0)
        ? item.album.images[0].url
        : null;

    var track = {
        title: item.name || null,
        artist: artist,
        albumArt: albumArt,
        progressMs: (playerResp.body.progress_ms !== null && playerResp.body.progress_ms !== undefined)
            ? playerResp.body.progress_ms
            : null,
        durationMs: item.duration_ms || 0,
        isPlaying: playerResp.body.is_playing || false
    };

    ctx.storage.set("current_track", JSON.stringify(track));

    return track;
}
