const { ipcRenderer } = require("electron");

const DEFAULT_DURATION_MS = 120000;
const MJPEG_MAX_RETRIES = 6;
const MJPEG_RETRY_BASE_DELAY = 2000;

let endTime = Date.now() + DEFAULT_DURATION_MS;
let countdownInterval = null;
let hlsInstance = null;
let mjpegRetryCount = 0;
let mjpegRetryTimeout = null;

const cameraBg = document.getElementById("intercom-camera-bg");
const cameraVideo = document.getElementById("intercom-camera-video");
const cameraImg = document.getElementById("intercom-camera-img");

function startCountdown(durationMs) {
  endTime = Date.now() + (durationMs || DEFAULT_DURATION_MS);
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdown, 250);
  updateCountdown();
}

function updateCountdown() {
  const remaining = Math.max(0, endTime - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const countdownEl = document.getElementById("intercom-countdown");
  if (countdownEl) {
    countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  if (remaining <= 0 && countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function init() {
  document.getElementById("intercom-open-btn").addEventListener("click", () => {
    ipcRenderer.send("intercom-open-gate");
  });

  document.getElementById("intercom-close-btn").addEventListener("click", () => {
    ipcRenderer.send("intercom-close");
  });

  ipcRenderer.on("intercom-init", (event, data) => {
    startCountdown(data?.durationMs);
  });

  ipcRenderer.on("intercom-reset-timer", (event, data) => {
    startCountdown(data?.durationMs);
  });

  ipcRenderer.on("intercom-camera", (event, camera) => {
    loadIntercomCamera(camera);
  });

  startCountdown(DEFAULT_DURATION_MS);
}

// Flusso telecamera come sfondo della card citofono
function showCameraBackground() {
  document.body.classList.add("has-camera");
  cameraBg.style.display = "block";
}

function destroyCameraStream() {
  if (mjpegRetryTimeout) {
    clearTimeout(mjpegRetryTimeout);
    mjpegRetryTimeout = null;
  }
  mjpegRetryCount = 0;

  if (hlsInstance) {
    try {
      hlsInstance.destroy();
    } catch (e) {
      // ignore
    }
    hlsInstance = null;
  }

  cameraVideo.pause();
  cameraVideo.removeAttribute("src");
  cameraVideo.load();
  cameraVideo.style.display = "none";
  cameraImg.removeAttribute("src");
  cameraImg.style.display = "none";
}

function loadIntercomCamera(camera) {
  if (!camera || !camera.url) return;

  showCameraBackground();
  destroyCameraStream();

  if ((camera.streamType || "mjpeg") === "hls" && camera.url.includes(".m3u8")) {
    loadHlsBackground(camera.url, camera.mjpegUrl);
  } else if (camera.streamType === "hls") {
    loadHlsBackground(camera.url, camera.mjpegUrl);
  } else {
    loadMjpegBackground(camera.url);
  }
}

function loadHlsBackground(url, mjpegUrl) {
  if (typeof Hls === "undefined" || !Hls.isSupported()) {
    loadMjpegBackground(mjpegUrl || url);
    return;
  }

  cameraVideo.style.display = "block";
  const hls = new Hls({
    debug: false,
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 5,
    maxBufferLength: 6,
    maxMaxBufferLength: 15,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 5,
    maxLiveSyncPlaybackRate: 1.5,
    startLevel: 0,
    startFragPrefetch: true,
    manifestLoadingTimeOut: 4000,
    manifestLoadingMaxRetry: 2,
    levelLoadingTimeOut: 4000,
    levelLoadingMaxRetry: 2,
    fragLoadingTimeOut: 6000,
    fragLoadingMaxRetry: 2,
  });

  hls.attachMedia(cameraVideo);
  hls.loadSource(url);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    cameraVideo.play().catch(() => {});
  });

  hls.on(Hls.Events.ERROR, (event, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    hls.destroy();
    hlsInstance = null;
    if (mjpegUrl) {
      loadMjpegBackground(mjpegUrl);
    }
  });

  hlsInstance = hls;
}

function loadMjpegBackground(url) {
  if (!url) return;

  cameraVideo.style.display = "none";
  cameraImg.style.display = "block";

  const timestamp = Date.now();
  cameraImg.src = `${url}${url.includes("?") ? "&" : "?"}_t=${timestamp}`;

  cameraImg.onerror = () => {
    mjpegRetryCount++;
    if (mjpegRetryCount <= MJPEG_MAX_RETRIES) {
      const delay = MJPEG_RETRY_BASE_DELAY * Math.min(mjpegRetryCount, 5);
      mjpegRetryTimeout = setTimeout(() => {
        const ts = Date.now();
        cameraImg.src = `${url}${url.includes("?") ? "&" : "?"}_t=${ts}`;
      }, delay);
    }
  };

  cameraImg.onload = () => {
    mjpegRetryCount = 0;
  };
}

init();
