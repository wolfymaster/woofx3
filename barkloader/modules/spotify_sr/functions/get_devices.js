/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function get_devices(ctx) {
    var fallback = [{ value: "", label: "Current Device" }];

    // Auth: prefer the cached authToken so most calls make zero token-exchange
    // calls. clientId/authToken/refreshToken come exclusively from the
    // Authorize Spotify button's OAuth-with-PKCE flow — refreshing needs only
    // clientId + refreshToken, never a client secret. No error message here
    // (this feeds a dropdown, not a chat response) — any auth failure just
    // falls back to the single "Current Device" option.
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
            return fallback;
        }
    }

    var devicesResp = ctx.http.request(
        "https://api.spotify.com/v1/me/player/devices",
        "GET",
        { headers: { "Authorization": "Bearer " + accessToken } }
    );

    if (devicesResp && devicesResp.status === 401 && !reauthed) {
        reauthed = true;
        var newToken = reauth();
        if (!newToken) {
            return fallback;
        }
        accessToken = newToken;
        devicesResp = ctx.http.request(
            "https://api.spotify.com/v1/me/player/devices",
            "GET",
            { headers: { "Authorization": "Bearer " + accessToken } }
        );
    }

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
