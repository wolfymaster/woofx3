/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function poll_current_track(ctx) {
    // Auth: prefer the cached authToken so most ticks make zero token-exchange
    // calls. clientId/authToken/refreshToken come exclusively from the
    // Authorize Spotify button's OAuth-with-PKCE flow — refreshing needs only
    // clientId + refreshToken, never a client secret.
    var accessToken = ctx.module.settings.authToken;
    var reauthed = false;

    function reauth() {
        var refreshToken = ctx.module.settings.refreshToken;
        var clientId = ctx.module.settings.clientId;
        if (!refreshToken || !clientId) {
            return null;
        }
        var tokenResp = ctx.http.request(
            "https://accounts.spotify.com/api/token",
            "POST",
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshToken) +
                    "&client_id=" + encodeURIComponent(clientId)
            }
        );
        if (!tokenResp || tokenResp.status !== 200 || !tokenResp.body || !tokenResp.body.access_token) {
            return null;
        }
        ctx.module.setSetting("authToken", tokenResp.body.access_token);
        if (tokenResp.body.refresh_token) {
            ctx.module.setSetting("refreshToken", tokenResp.body.refresh_token);
        }
        return tokenResp.body.access_token;
    }

    if (!accessToken) {
        accessToken = reauth();
        reauthed = true;
        if (!accessToken) {
            return { error: "Failed to Authenticate to Spotify" };
        }
    }

    var playerResp = ctx.http.request(
        "https://api.spotify.com/v1/me/player/currently-playing",
        "GET",
        { headers: { "Authorization": "Bearer " + accessToken } }
    );

    if (playerResp && playerResp.status === 401 && !reauthed) {
        reauthed = true;
        var newToken = reauth();
        if (!newToken) {
            return { error: "Failed to Authenticate to Spotify" };
        }
        accessToken = newToken;
        playerResp = ctx.http.request(
            "https://api.spotify.com/v1/me/player/currently-playing",
            "GET",
            { headers: { "Authorization": "Bearer " + accessToken } }
        );
    }
    if (playerResp && playerResp.status === 401) {
        return { error: "Failed to Authenticate to Spotify" };
    }

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
