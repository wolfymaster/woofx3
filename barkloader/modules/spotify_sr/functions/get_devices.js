/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function get_devices(ctx) {
    var fallback = [{ value: "", label: "Current Device" }];

    var clientId = ctx.env.get("SPOTIFY_CLIENT_ID");
    var clientSecret = ctx.env.get("SPOTIFY_CLIENT_SECRET");
    var refreshToken = ctx.env.get("SPOTIFY_REFRESH_TOKEN");

    if (!clientId || !clientSecret || !refreshToken) {
        return fallback;
    }

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
        return fallback;
    }

    var accessToken = tokenResp.body.access_token;
    var authHeader = "Bearer " + accessToken;

    var devicesResp = ctx.http.request(
        "https://api.spotify.com/v1/me/player/devices",
        "GET",
        { headers: { "Authorization": authHeader } }
    );

    if (!devicesResp || devicesResp.status !== 200 || !devicesResp.body) {
        return fallback;
    }

    var devices = devicesResp.body.devices;
    if (!devices || devices.length === 0) {
        return fallback;
    }

    var options = [{ value: "", label: "Current Device" }];
    for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        if (!d.id) { continue; }
        options.push({ value: d.id, label: d.name });
    }

    return options;
}
