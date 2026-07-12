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
    fadeInMs: 450,
    fadeOutMs: 250,
    storageKey: "sonicTracesSoundEnabled"
  };

  const audio = document.getElementById("audioPlayer");
  const playerButton = document.getElementById("playerButton");
  const playerIcon = document.getElementById("playerIcon");
  const playerHint = document.getElementById("playerHint");

  let worksheet = null;
  let currentTrack = null;
  let currentPreviewUrl = "";
  let fadeTimer = null;
  let requestCounter = 0;

  function isSoundEnabled() {
    return localStorage.getItem(CONFIG.storageKey) === "true";
  }

  function setSoundEnabled(enabled) {
    localStorage.setItem(CONFIG.storageKey, String(enabled));
  }

  function setButtonState(state, hint = "") {
    playerButton.classList.remove("is-playing", "is-loading");
    playerIcon.className = "player-icon";

    if (state === "playing") {
      playerButton.classList.add("is-playing");
      playerIcon.classList.add("pause");
      playerButton.setAttribute("aria-label", "Pause sound");
      playerButton.title = "Pause sound";
    } else {
      playerIcon.classList.add("play");
      playerButton.setAttribute("aria-label", "Enable sound");
      playerButton.title = "Enable sound";
    }

    if (state === "loading") {
      playerButton.classList.add("is-loading");
    }

    playerHint.textContent = hint;
  }

  function cancelFade() {
    if (fadeTimer !== null) {
      window.clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function fadeVolume(element, from, to, durationMs, onComplete = () => {}) {
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

  function stopAudio({ disableSound = false } = {}) {
    requestCounter += 1;
    cancelFade();

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.volume = 1;

    currentPreviewUrl = "";

    if (disableSound) {
      setSoundEnabled(false);
      setButtonState("paused", "sound paused");
    } else {
      setButtonState(
        isSoundEnabled() ? "paused" : "paused",
        isSoundEnabled() ? "hover a track" : "enable sound"
      );
    }
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

  async function unlockAudio() {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (AudioContextClass) {
      const context = new AudioContextClass();
      await context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();

      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.03);
    }

    setSoundEnabled(true);
  }

  async function playCurrentPreview() {
    if (!currentPreviewUrl) {
      setButtonState("paused", "hover a track");
      return;
    }

    setButtonState("loading", "");

    audio.src = currentPreviewUrl;
    audio.load();
    audio.volume = 0;

    try {
      await audio.play();
      setButtonState("playing", "");
      fadeVolume(audio, 0, 1, CONFIG.fadeInMs);
    } catch (error) {
      console.warn("Playback needs a user click:", error);
      setSoundEnabled(false);
      setButtonState("paused", "enable sound");
    }
  }

  async function loadAndPlayTrack(trackId, title = "", artist = "") {
    const localRequest = ++requestCounter;
    currentTrack = { trackId, title, artist };

    setButtonState("loading", "");

    try {
      const payload = await fetchFreshPreview(trackId);

      if (localRequest !== requestCounter) {
        return;
      }

      currentPreviewUrl =
        payload.preview_url ||
        payload.previewUrl ||
        payload.preview ||
        "";

      if (!currentPreviewUrl) {
        throw new Error("No preview URL returned");
      }

      if (isSoundEnabled()) {
        await playCurrentPreview();
      } else {
        setButtonState("paused", "enable sound");
      }
    } catch (error) {
      console.error("Could not load preview:", error);
      setButtonState("paused", "preview unavailable");
    }
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
          )
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
      const selectedTrack =
        tracks.find((track) => track.deezerTrackId);

      if (!selectedTrack) {
        return;
      }

      await loadAndPlayTrack(
        selectedTrack.deezerTrackId,
        selectedTrack.title,
        selectedTrack.artist
      );
    } catch (error) {
      console.error("Could not read selected marks:", error);
    }
  }

  playerButton.addEventListener("click", async () => {
  if (isSoundEnabled()) {
    stopAudio({ disableSound: true });
    return;
  }

  try {
    await unlockAudio();

    // Beim Aktivieren niemals den zuletzt geladenen Song starten.
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    currentPreviewUrl = "";
    currentTrack = null;

    setButtonState("paused", "hover a track");
  } catch (error) {
    console.error("Could not enable sound:", error);
    setSoundEnabled(false);
    setButtonState("paused", "try again");
  }
});

  audio.addEventListener("ended", () => {
    audio.volume = 1;
    setButtonState(
      isSoundEnabled() ? "paused" : "paused",
      isSoundEnabled() ? "hover a track" : "enable sound"
    );
  });

  audio.addEventListener("error", () => {
    console.error("Audio element error:", audio.error);
    setButtonState("paused", "preview unavailable");
  });

  async function initialize() {
    const params = new URLSearchParams(window.location.search);

    const unlockMode = params.get("unlock") === "1";
    const trackId =
      params.get("trackId") ||
      params.get("trackid") ||
      params.get("deezerTrackId");

    const audioUrl =
      params.get("audio") ||
      params.get("url") ||
      params.get("preview_url");

    if (unlockMode) {
      setButtonState(
        isSoundEnabled() ? "paused" : "paused",
        isSoundEnabled() ? "hover a track" : "enable sound"
      );
      return;
    }

    if (trackId) {
      await loadAndPlayTrack(trackId);
      return;
    }

    if (audioUrl) {
      currentPreviewUrl = audioUrl;

      if (isSoundEnabled()) {
        await playCurrentPreview();
      } else {
        setButtonState("paused", "enable sound");
      }

      return;
    }

    // Desktop/Extension mode remains available.
    try {
      await tableau.extensions.initializeAsync();

      const dashboard =
        tableau.extensions.dashboardContent.dashboard;

      worksheet = dashboard.worksheets.find(
        (sheet) => sheet.name === CONFIG.worksheetName
      );

      if (!worksheet) {
        throw new Error(
          `Worksheet "${CONFIG.worksheetName}" not found`
        );
      }

      worksheet.addEventListener(
        tableau.TableauEventType.MarkSelectionChanged,
        handleSelectionChanged
      );

      setButtonState(
        isSoundEnabled() ? "paused" : "paused",
        isSoundEnabled() ? "hover a track" : "enable sound"
      );
    } catch (error) {
      console.error("Extension initialization failed:", error);
      setButtonState("paused", "enable sound");
    }
  }

  initialize();
})();
