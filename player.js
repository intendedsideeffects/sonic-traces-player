(() => {
  "use strict";

  const CONFIG = {
    previewEndpoint: "/api/deezer-preview",
    fadeInMs: 350,
    storageKey: "sonicTracesSoundEnabled"
  };

  const audio = document.getElementById("audioPlayer");
  const playerButton = document.getElementById("playerButton");
  const playerIcon = document.getElementById("playerIcon");
  const playerHint = document.getElementById("playerHint");

  let currentPreviewUrl = "";
  let currentTrackId = "";
  let fadeTimer = null;
  let isLoading = false;

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
      playerButton.setAttribute("aria-label", "Play sound");
      playerButton.title = "Play sound";
    }

    if (state === "loading") {
      playerButton.classList.add("is-loading");
      playerButton.setAttribute("aria-label", "Loading track");
      playerButton.title = "Loading track";
    }

    playerHint.textContent = hint;
  }

  function cancelFade() {
    if (fadeTimer !== null) {
      window.clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function fadeIn() {
    cancelFade();

    const startTime = performance.now();
    audio.volume = 0;

    fadeTimer = window.setInterval(() => {
      const progress = Math.min(
        1,
        (performance.now() - startTime) / CONFIG.fadeInMs
      );

      audio.volume = progress;

      if (progress >= 1) {
        cancelFade();
      }
    }, 30);
  }

  function stopAudio({ disableSound = false } = {}) {
    cancelFade();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.volume = 1;

    if (disableSound) {
      setSoundEnabled(false);
    }

    setButtonState("paused", currentPreviewUrl ? "play track" : "hover a track");
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

  async function playCurrentPreview({ userInitiated = false } = {}) {
    if (!currentPreviewUrl || isLoading) {
      setButtonState("paused", currentPreviewUrl ? "play track" : "hover a track");
      return;
    }

    try {
      audio.pause();
      audio.src = currentPreviewUrl;
      audio.load();
      audio.volume = 0;

      await audio.play();

      if (userInitiated) {
        setSoundEnabled(true);
      }

      setButtonState("playing", "");
      fadeIn();
    } catch (error) {
      console.warn("Playback needs a user click:", error);
      setSoundEnabled(false);
      setButtonState("paused", "play track");
    }
  }

  async function loadTrack(trackId) {
    currentTrackId = trackId;
    currentPreviewUrl = "";
    isLoading = true;
    setButtonState("loading", "");

    try {
      const payload = await fetchFreshPreview(trackId);

      currentPreviewUrl =
        payload.preview_url ||
        payload.previewUrl ||
        payload.preview ||
        "";

      if (!currentPreviewUrl) {
        throw new Error("No preview URL returned");
      }

      isLoading = false;

      if (isSoundEnabled()) {
        await playCurrentPreview();
      } else {
        setButtonState("paused", "play track");
      }
    } catch (error) {
      isLoading = false;
      console.error("Could not load preview:", error);
      setButtonState("paused", "preview unavailable");
    }
  }

  playerButton.addEventListener("click", async () => {
    if (!audio.paused) {
      stopAudio({ disableSound: true });
      return;
    }

    if (!currentPreviewUrl) {
      setButtonState("paused", "hover a track");
      return;
    }

    await playCurrentPreview({ userInitiated: true });
  });

  audio.addEventListener("ended", () => {
    audio.volume = 1;
    setButtonState("paused", "hover a track");
  });

  audio.addEventListener("error", () => {
    console.error("Audio element error:", audio.error);
    setButtonState("paused", "preview unavailable");
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

    if (trackId) {
      await loadTrack(trackId);
      return;
    }

    if (audioUrl) {
      currentPreviewUrl = audioUrl;

      if (isSoundEnabled()) {
        await playCurrentPreview();
      } else {
        setButtonState("paused", "play track");
      }

      return;
    }

    // Start page: no random/default song is loaded.
    currentTrackId = "";
    currentPreviewUrl = "";
    setButtonState("paused", "hover a track");
  }

  initialize();
})();
