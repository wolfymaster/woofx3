// Now Playing widget for spotify_sr module
//
// Subscribes to the "current_track" storage key. The stored value is a
// JSON string representing the currently playing track, or null/\"null\"
// when nothing is playing.
//
// Storage value shape:
//   {
//     title:      string,
//     artist:     string,
//     albumArt:   string (URL),
//     progressMs: number,
//     durationMs: number,
//     isPlaying:  boolean
//   }

/// <reference types="@woofx3/module-sdk" />

(function () {
  "use strict";

  /** @type {import("@woofx3/module-sdk").WidgetHost} */
  var host = window.widgetHost;
  if (!host) {
    document.body.textContent = "no widgetHost — open this widget through the SDK preview harness or streamware";
    return;
  }

  var rootEl       = document.getElementById("root");
  var nothingEl    = document.getElementById("nothing");
  var albumArtEl   = document.getElementById("albumArt");
  var trackTitleEl = document.getElementById("trackTitle");
  var artistNameEl = document.getElementById("artistName");
  var progressFill = document.getElementById("progressFill");

  var currentTrack   = null;
  var localProgressMs = 0;

  function updateProgressFill() {
    if (!currentTrack || !currentTrack.durationMs) {
      progressFill.style.width = "0%";
      return;
    }
    var pct = (localProgressMs / currentTrack.durationMs) * 100;
    progressFill.style.width = Math.min(pct, 100) + "%";
  }

  function render(track) {
    currentTrack = track;

    if (!track) {
      rootEl.classList.add("hidden");
      rootEl.classList.remove("visible");
      nothingEl.classList.remove("hidden");
      progressFill.style.width = "0%";
      localProgressMs = 0;
      return;
    }

    localProgressMs = typeof track.progressMs === "number" ? track.progressMs : 0;

    albumArtEl.src          = track.albumArt || "";
    trackTitleEl.textContent = track.title   || "";
    artistNameEl.textContent = track.artist  || "";

    updateProgressFill();

    // Trigger fade-in: remove then re-add visible so animation replays.
    rootEl.classList.remove("visible");
    nothingEl.classList.add("hidden");
    // Use a minimal timeout so the browser registers the class removal
    // before we add "visible" back (animation restart).
    setTimeout(function () {
      rootEl.classList.remove("hidden");
      rootEl.classList.add("visible");
    }, 16);
  }

  function tickProgress() {
    if (!currentTrack || !currentTrack.durationMs) {
      return;
    }
    localProgressMs = Math.min(localProgressMs + 1000, currentTrack.durationMs);
    updateProgressFill();
  }

  host.storage.subscribe("current_track", function (raw) {
    var track = null;
    if (raw && raw !== "null") {
      try {
        track = JSON.parse(String(raw));
      } catch (_) {
        track = null;
      }
    }
    render(track);
  });

  // Seed initial state from storage so the widget is not blank on first load.
  Promise.resolve(host.storage.get("current_track"))
    .then(function (raw) {
      var track = null;
      if (raw && raw !== "null") {
        try {
          track = JSON.parse(String(raw));
        } catch (_) {
          track = null;
        }
      }
      render(track);
    })
    .catch(function () {
      render(null);
    });

  setInterval(tickProgress, 1000);
})();
