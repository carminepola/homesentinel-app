const { ipcRenderer } = require("electron");

const DEFAULT_DURATION_MS = 120000;

let endTime = Date.now() + DEFAULT_DURATION_MS;
let countdownInterval = null;

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

  startCountdown(DEFAULT_DURATION_MS);
}

init();
