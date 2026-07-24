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

    // Auth: prefer the cached authToken (set by the Authorize Spotify button
    // or a prior reauth in this same module) so most invocations make zero
    // token-exchange calls. `clientId`/`authToken`/`refreshToken` come
    // exclusively from that OAuth-with-PKCE flow — refreshing needs only
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
            return ctx.response(false, "Failed to Authenticate to Spotify");
        }
    }

    // Wraps ctx.http.request with a Bearer header and a single automatic
    // reauth-and-retry if the call comes back 401. Centralized here so every
    // Spotify API call below (track lookup, search, queue) gets the same
    // cache-then-reauth-once behavior without duplicating it per call site.
    function authedRequest(url, method, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers["Authorization"] = "Bearer " + accessToken;
        var resp = ctx.http.request(url, method, opts);
        if (resp && resp.status === 401 && !reauthed) {
            reauthed = true;
            var newToken = reauth();
            if (newToken) {
                accessToken = newToken;
                opts.headers["Authorization"] = "Bearer " + accessToken;
                resp = ctx.http.request(url, method, opts);
            }
        }
        return resp;
    }

    // Determine if query is a Spotify track URL or a search term.
    var urlMatch = query.match(/(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
    var song = null;

    if (urlMatch) {
        var trackId = urlMatch[1];
        var trackResp = authedRequest("https://api.spotify.com/v1/tracks/" + trackId, "GET", {});
        if (trackResp && trackResp.status === 401) {
            return ctx.response(false, "Failed to Authenticate to Spotify");
        }
        if (!trackResp || trackResp.status !== 200 || !trackResp.body) {
            return ctx.response(false, "Could not find that track on Spotify.");
        }
        song = {
            name: trackResp.body.name,
            artist: trackResp.body.artists[0].name,
            uri: trackResp.body.uri
        };
    } else {
        var searchResp = authedRequest(
            "https://api.spotify.com/v1/search",
            "GET",
            { query: { q: query, type: "track", limit: "1" } }
        );
        if (searchResp && searchResp.status === 401) {
            return ctx.response(false, "Failed to Authenticate to Spotify");
        }
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

    var queueResp = authedRequest(queueUrl, "POST", {});
    if (queueResp && queueResp.status === 401) {
        return ctx.response(false, "Failed to Authenticate to Spotify");
    }

    // 200 or 204 both indicate success.
    if (!queueResp || (queueResp.status !== 200 && queueResp.status !== 204)) {
        return ctx.response(false, "Failed to queue " + song.name + ".");
    }

    return ctx.response(true, "Added to queue: " + song.name + " by " + song.artist);
}
