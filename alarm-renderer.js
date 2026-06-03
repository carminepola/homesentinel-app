const { ipcRenderer } = require("electron");

let startTime = null;
let durationInterval = null;
let isMuted = false;

function init() {
  setupDismissButton();
  setupPinModal();
  setupDurationTimer();
  setupIpcListeners();
}

function setupDismissButton() {
  const dismissBtn = document.getElementById("alarm-dismiss-btn");
  dismissBtn.addEventListener("click", () => {
    ipcRenderer.invoke("alarm-request-dismiss");
  });
}

function setupPinModal() {
  const pinModal = document.getElementById("alarm-pin-modal");
  const pinInput = document.getElementById("alarm-pin-input");
  const pinSubmit = document.getElementById("alarm-pin-submit");
  const pinCancel = document.getElementById("alarm-pin-cancel");

  function showPinModal() {
    pinModal.classList.add("show");
    pinInput.value = "";
    document.getElementById("alarm-pin-error").textContent = "";
    setTimeout(() => pinInput.focus(), 100);
  }

  function hidePinModal() {
    pinModal.classList.remove("show");
  }

  function submitPin() {
    const pin = pinInput.value;
    if (!pin) return;

    ipcRenderer.invoke("alarm-check-pin", pin).then((result) => {
      if (result.success) {
        ipcRenderer.send("alarm-close");
      } else {
        document.getElementById("alarm-pin-error").textContent = "PIN errato";
        pinInput.value = "";
        pinInput.focus();
      }
    });
  }

  ipcRenderer.on("alarm-show-pin", () => {
    showPinModal();
  });

  pinSubmit.addEventListener("click", submitPin);
  pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitPin();
  });
  pinCancel.addEventListener("click", hidePinModal);

  pinModal.addEventListener("click", (e) => {
    if (e.target === pinModal) hidePinModal();
  });
}

function setupDurationTimer() {
  startTime = Date.now();
  durationInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const seconds = (elapsed % 60).toString().padStart(2, "0");
    document.getElementById("alarm-duration").textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function setupIpcListeners() {
  ipcRenderer.on("alarm-init", (event, data) => {
    if (data.sensorName) {
      document.getElementById("alarm-sensor-name").textContent = data.sensorName;
    }
    if (data.state) {
      document.getElementById("alarm-state").textContent = data.state;
    }
    if (data.startTime) {
      startTime = new Date(data.startTime).getTime();
      const time = new Date(data.startTime).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      document.getElementById("alarm-start-time").textContent = time;
    }
  });

  ipcRenderer.on("alarm-state-update", (event, data) => {
    if (data.state) {
      document.getElementById("alarm-state").textContent = data.state;
    }
  });

  ipcRenderer.on("alarm-camera-add", (event, data) => {
    addCameraFeed(data);
  });

  ipcRenderer.on("alarm-close", () => {
    if (durationInterval) clearInterval(durationInterval);
  });
}

function addCameraFeed(data) {
  const existingFeed = document.getElementById(`camera-feed-${data.cameraId}`);
  if (existingFeed) return;

  const container = document.getElementById("alarm-cameras");

  const card = document.createElement("div");
  card.className = "alarm-camera-card";

  card.innerHTML = `
    <div class="alarm-camera-header">
      <span class="alarm-camera-dot"></span>
      <span>${data.cameraName || "Telecamera"}</span>
    </div>
    <div class="alarm-camera-feed" id="camera-feed-${data.cameraId}">
      <div class="alarm-camera-loading">
        <div class="alarm-camera-loading-spinner"></div>
        <span>Caricamento...</span>
      </div>
    </div>
  `;

  container.appendChild(card);

  const feedContainer = document.getElementById(`camera-feed-${data.cameraId}`);

  if (data.useHLS) {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";

    const Hls = require("hls.js");
    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        startLevel: 0,
      });
      hls.loadSource(data.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          feedContainer.innerHTML = `<div class="alarm-camera-loading"><span>Errore caricamento</span></div>`;
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = data.url;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(() => {});
      });
    }

    feedContainer.innerHTML = "";
    feedContainer.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = data.url;
    img.alt = data.cameraName || "Telecamera";
    img.onerror = () => {
      feedContainer.innerHTML = `<div class="alarm-camera-loading"><span>Errore caricamento</span></div>`;
    };

    feedContainer.innerHTML = "";
    feedContainer.appendChild(img);

    if (data.url) {
      setInterval(() => {
        if (img.parentNode) {
          img.src = data.url + "&t=" + Date.now();
        }
      }, 2000);
    }
  }
}

init();
