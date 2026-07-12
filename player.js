(() => {
  "use strict";

  const CONFIG = {
    worksheetName: "Radial",
    previewEndpoint: "/api/deezer-preview",
    deezerTrackIdAliases: [
      "deezer_track_id",
      "Deezer Track ID",
      "Deezer Track Id"
    ],
    titleFieldAliases: ["Title", "Title1", "Song Name"],
    artistFieldAliases: ["Artist", "Artist1"],
    eventFieldAliases: ["Event", "Event Name"],
    fadeInMs: 800,
    fadeOutMs: 600
  };

  const audio = document.getElementById("audioPlayer");
  const indicator = document.getElementById("indicator");
  const message = document.getElementById("message");
  const nowPlaying = document.getElementById("nowPlaying");
  const trackTitle = document.getElementById("trackTitle");
  const trackArtist = document.getElementById("trackArtist");
  const enableSound = document.getElementById("enableSound");

  let worksheet = null;
  let pendingTrack = null;
  let fadeTimer = null;
  let requestCounter = 0;
  let currentTrackId = "";

  function setStatus(text, symbol = "○") {
    message.textContent = text;
    indicator.textContent = symbol;
  }

  function normalize(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function fieldMatches(fieldName, aliases) {
    const normalizedField = normalize(fieldName);

    return aliases.some((alias) => {
      const normalizedAlias = normalize(alias);

      return (
        normalizedField === normalizedAlias ||
        normalizedField.startsWith(`${normalizedAlias} (`) ||
        normalizedField.includes(normalizedAlias)
      );
    });
  }

  function getCellValue(row, columns, aliases) {
    const index = columns.findIndex((column) =>
      fieldMatches(column.fieldName, aliases)
    );

    if (index < 0 || !row[index]) {
      return "";
    }

    const cell = row[index];

    return String(
      cell.formattedValue ?? cell.value ?? cell.nativeValue ?? ""
    ).trim();
  }

  function cancelFade() {
    if (fadeTimer !== null) {
      window.clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function fadeVolume(
    element,
    from,
    to,
    durationMs,
    onComplete = () => {}
  ) {
    cancelFade();

    const startTime = performance.now();
    element.volume = Math.max(0, Math.min(1, from));

    fadeTimer = window.setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      element.volume = Math.max(
        0,
        Math.min(1, from + (to - from) * progress)
      );

      if (progress >= 1) {
        cancelFade();
        onComplete();
      }
    }, 30);
  }

  function clearPlayerUi(reason = "Ready") {
    nowPlaying.hidden = true;
    enableSound.hidden = true;
    setStatus(reason, "○");
  }

  function stopAudio(reason = "Ready", fade = true) {
    pendingTrack = null;
    currentTrackId = "";
    requestCounter += 1;

    if (audio.paused || !fade) {
      cancelFade();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.volume = 1;
      clearPlayerUi(reason);
      return;
    }

    fadeVolume(
      audio,
      audio.volume,
      0,
      CONFIG.fadeOutMs,
      () => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        audio.volume = 1;
        clearPlayerUi(reason);
      }
    );
  }

  async function fetchFreshPreview(trackId) {
    const url =
      `${CONFIG.previewEndpoint}?id=${encodeURIComponent(trackId)}`;

    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Preview request failed");
    }

    return payload;
  }

  async function startPlayback(track, previewPayload) {
    const localRequest = ++requestCounter;

    trackTitle.textContent =
      track.title || previewPayload.title || "Unknown title";

    trackArtist.textContent =
      track.artist || previewPayload.artist || "";

    nowPlaying.hidden = false;
    enableSound.hidden = true;
    setStatus("Loading preview…", "◌");

    if (!audio.paused) {
      await new Promise((resolve) => {
        fadeVolume(
          audio,
          audio.volume,
          0,
          CONFIG.fadeOutMs,
          resolve
        );
      });
    }

    if (localRequest !== requestCounter) {
      return;
    }

    audio.pause();
    audio.src = previewPayload.preview_url;
    audio.load();
    audio.volume = 0;
    currentTrackId = track.deezerTrackId;

    try {
      await audio.play();

      if (localRequest !== requestCounter) {
        audio.pause();
        return;
      }

      pendingTrack = null;
      setStatus("Playing", "●");

      fadeVolume(
        audio,
        0,
        1,
        CONFIG.fadeInMs
      );
    } catch (error) {
      pendingTrack = {
        track,
        previewPayload,
      };

      enableSound.hidden = false;
      setStatus("Enable sound", "○");
      console.warn("Playback needs a user click:", error);
    }
  }

  async function playSelectedTrack(track) {
    if (!track.deezerTrackId) {
      stopAudio("No Deezer track ID");
      return;
    }

    if (
      track.deezerTrackId === currentTrackId &&
      !audio.paused
    ) {
      return;
    }

    setStatus("Getting fresh preview…", "◌");

    try {
      const previewPayload = await fetchFreshPreview(
        track.deezerTrackId
      );

      await startPlayback(track, previewPayload);
    } catch (error) {
      console.error(error);
      stopAudio(error.message || "Preview unavailable", false);
    }
  }

  function extractSelectedTracks(markCollection) {
    const tracks = [];

    for (const table of markCollection.data ?? []) {
      const columns = table.columns ?? [];

      for (const row of table.data ?? []) {
        tracks.push({
          deezerTrackId: getCellValue(
            row,
            columns,
            CONFIG.deezerTrackIdAliases
          ),
          title: getCellValue(
            row,
            columns,
            CONFIG.titleFieldAliases
          ),
          artist: getCellValue(
            row,
            columns,
            CONFIG.artistFieldAliases
          ),
          event: getCellValue(
            row,
            columns,
            CONFIG.eventFieldAliases
          ),
        });
      }
    }

    return tracks;
  }

  async function handleSelectionChanged() {
    try {
      const selectedMarks =
        await worksheet.getSelectedMarksAsync();

      const tracks = extractSelectedTracks(selectedMarks);

      console.log("Selected Radial marks:", tracks);

      if (tracks.length === 0) {
        stopAudio("Ready");
        return;
      }

      const selectedTrack =
        tracks.find((track) => track.deezerTrackId) ?? tracks[0];

      await playSelectedTrack(selectedTrack);
    } catch (error) {
      console.error("Could not read selected marks:", error);
      stopAudio("Selection error", false);
    }
  }

  enableSound.addEventListener("click", () => {
    if (!pendingTrack) {
      setStatus("No pending track", "○");
      return;
    }

    const pending = pendingTrack;

    audio.src = pending.previewPayload.preview_url;
    audio.load();
    audio.volume = 0;

    const playPromise = audio.play();

    if (!playPromise) {
      setStatus("Playback unavailable", "○");
      return;
    }

    playPromise
      .then(() => {
        pendingTrack = null;
        enableSound.hidden = true;
        currentTrackId = pending.track.deezerTrackId;
        setStatus("Playing", "●");

        fadeVolume(
          audio,
          0,
          1,
          CONFIG.fadeInMs
        );
      })
      .catch((error) => {
        console.error("Manual audio error:", error);
        setStatus(
          `${error.name}: ${error.message}`,
          "○"
        );
      });
  });

  audio.addEventListener("ended", () => {
    currentTrackId = "";
    audio.volume = 1;
    clearPlayerUi("Preview ended");
  });

  audio.addEventListener("error", () => {
    console.error("Audio element error:", audio.error);
    stopAudio("Preview could not load", false);
  });

async function initialize() {
  const params = new URLSearchParams(window.location.search);

  const trackId =
    params.get("trackId") ||
    params.get("trackid") ||
    params.get("deezerTrackId");

  const audioUrl =
    params.get("audio") ||
    params.get("url") ||
    params.get("preview_url");

  // -----------------------------
  // Standalone-Modus mit Deezer Track ID
  // -----------------------------
  if (trackId) {
    console.log("Standalone URL mode with Deezer Track ID:", trackId);

    try {
      setStatus("Loading preview", "○");

      const payload = await fetchFreshPreview(trackId);

      console.log("Preview payload:", payload);

      const previewUrl =
        payload.preview ||
        payload.previewUrl ||
        payload.preview_url;

      if (!previewUrl) {
        throw new Error("No preview URL returned");
      }

      const audioElement = document.querySelector("audio");

      if (!audioElement) {
        throw new Error("No <audio> element found");
      }

      audioElement.src = previewUrl;
      audioElement.load();

      try {
        await audioElement.play();
        setStatus("Playing", "●");
      } catch (error) {
        console.warn("Autoplay blocked:", error);
        setStatus("Click to play", "○");

        document.addEventListener(
          "click",
          async () => {
            try {
              await audioElement.play();
              setStatus("Playing", "●");
            } catch (playError) {
              console.error("Playback failed:", playError);
              setStatus("Playback failed", "○");
            }
          },
          { once: true }
        );
      }
    } catch (error) {
      console.error("Standalone playback failed:", error);
      setStatus(error.message || "Playback failed", "○");
      message.title = String(error);
    }

    return;
  }

  // -----------------------------
  // Standalone-Modus mit direkter Audio-URL
  // -----------------------------
  if (audioUrl) {
    console.log("Standalone URL mode with audio URL:", audioUrl);

    const audioElement = document.querySelector("audio");

    if (!audioElement) {
      const error = new Error("No <audio> element found");
      console.error(error);
      setStatus(error.message, "○");
      return;
    }

    audioElement.src = audioUrl;
    audioElement.load();

    try {
      await audioElement.play();
      setStatus("Playing", "●");
    } catch (error) {
      console.warn("Autoplay blocked:", error);
      setStatus("Click to play", "○");

      document.addEventListener(
        "click",
        async () => {
          try {
            await audioElement.play();
            setStatus("Playing", "●");
          } catch (playError) {
            console.error("Playback failed:", playError);
            setStatus("Playback failed", "○");
          }
        },
        { once: true }
      );
    }

    return;
  }

  // -----------------------------
  // Tableau Extension-Modus
  // -----------------------------
  try {
    await tableau.extensions.initializeAsync();

    const dashboard =
      tableau.extensions.dashboardContent.dashboard;

    worksheet = dashboard.worksheets.find(
      (sheet) => sheet.name === CONFIG.worksheetName
    );

    if (!worksheet) {
      const available = dashboard.worksheets
        .map((sheet) => sheet.name)
        .join(", ");

      throw new Error(
        `Worksheet "${CONFIG.worksheetName}" not found. Available: ${available}`
      );
    }

    worksheet.addEventListener(
      tableau.TableauEventType.MarkSelectionChanged,
      handleSelectionChanged
    );

    setStatus(`Listening to ${CONFIG.worksheetName}`, "○");
    console.log("Sonic Traces Deezer Player initialized.");

  } catch (error) {
    console.error("Extension initialization failed:", error);
    setStatus(error.message || "Initialization failed", "○");
    message.title = String(error);
  }
}

initialize();
})();
initialize();
})();
