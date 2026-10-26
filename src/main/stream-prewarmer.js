const appConfig = require("../shared/app-config");

// Il pre-warmer fa due cose:
// - tiene in cache gli URL (con token) delle telecamere, così il PiP si apre senza attendere Home Assistant;
// - per gli stream HLS interroga periodicamente la playlist, così Home Assistant non chiude lo stream
//   e il PiP non deve aspettare l'avvio (connessione RTSP + keyframe).
// Per MJPEG non c'è nulla da tenere caldo: ogni apertura crea comunque una nuova connessione.
// Mentre lo schermo è bloccato o è attivo il Non disturbare nessun PiP può aprirsi, quindi si mette in pausa.
class StreamPreWarmer {
  constructor(settingsManager, websocketManager) {
    this.settingsManager = settingsManager;
    this.websocketManager = websocketManager;
    this.urlCache = new Map();
    this.tokenRefreshTimer = null;
    this.keepAlives = new Map();
    this.pauseReasons = new Set();
    this.isRunning = false;
    this.cacheMaxAge = 300000;
  }

  getIntervalMs() {
    const settings = this.settingsManager.getSettings();
    const seconds = settings.preWarmerSettings?.intervalSeconds || 30;
    return Math.max(10, Math.min(300, seconds)) * 1000;
  }

  isEnabled() {
    const settings = this.settingsManager.getSettings();
    return settings.preWarmerSettings?.enabled ?? true;
  }

  isPaused() {
    return this.pauseReasons.size > 0;
  }

  start() {
    if (this.isRunning) return;
    if (!this.isEnabled()) {
      console.log("StreamPreWarmer: disabilitato dalle impostazioni");
      return;
    }
    if (this.isPaused()) {
      console.log(`StreamPreWarmer: in pausa (${[...this.pauseReasons].join(", ")})`);
      return;
    }
    this.isRunning = true;
    console.log(`StreamPreWarmer: avviato (refresh URL ogni ${this.getIntervalMs() / 1000}s, keep-alive solo per HLS)`);
    this.refreshAllTokens();
    this.scheduleNextTokenRefresh();
  }

  scheduleNextTokenRefresh() {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }
    this.tokenRefreshTimer = setTimeout(() => {
      if (this.isRunning && this.isEnabled()) {
        this.refreshAllTokens();
        this.scheduleNextTokenRefresh();
      } else {
        this.stop();
      }
    }, this.getIntervalMs());
  }

  stop() {
    const wasRunning = this.isRunning;
    this.isRunning = false;
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    this.stopAllKeepAlives();
    this.urlCache.clear();
    if (wasRunning) {
      console.log("StreamPreWarmer: fermato");
    }
  }

  restart() {
    this.stop();
    this.start();
  }

  // Mette in pausa (o riprende) il pre-warmer per un motivo specifico, es. "locked" o "dnd".
  // Riprende solo quando non resta nessun motivo di pausa.
  setPaused(reason, paused) {
    const wasPaused = this.isPaused();
    if (paused) {
      this.pauseReasons.add(reason);
    } else {
      this.pauseReasons.delete(reason);
    }

    if (!wasPaused && this.isPaused()) {
      console.log(`StreamPreWarmer: pausa (${reason})`);
      this.stop();
    } else if (wasPaused && !this.isPaused()) {
      console.log(`StreamPreWarmer: ripresa (${reason})`);
      this.start();
    }
  }

  async refreshAllTokens() {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      return;
    }

    const mappings = settings.sensorCameraMappings || [];
    const customCameras = settings.customCameras || [];
    const cameraIds = [...new Set(mappings.map((m) => m.cameraId).filter(Boolean))];

    this.pruneRemovedCameras(cameraIds);

    if (cameraIds.length === 0) return;

    await Promise.all(cameraIds.map(async (cameraId) => {
      try {
        await this.refreshCamera(cameraId, settings, customCameras);
      } catch (err) {
        console.warn(`StreamPreWarmer: refresh fallito per ${cameraId}: ${err.message}`);
      }
    }));
  }

  pruneRemovedCameras(currentCameraIds) {
    const currentSet = new Set(currentCameraIds);
    for (const cameraId of [...this.urlCache.keys(), ...this.keepAlives.keys()]) {
      if (!currentSet.has(cameraId)) {
        this.stopKeepAlive(cameraId);
        this.urlCache.delete(cameraId);
      }
    }
  }

  resolveCustomStreamType(customCamera, settings) {
    const streamType = customCamera.streamType || "auto";
    if (streamType !== "auto") return streamType;
    return settings.streamingSettings?.useHLS ? "hls" : "mjpeg";
  }

  async refreshCamera(cameraId, settings, customCameras) {
    let newUrl;
    let streamType;
    let friendlyName;

    if (cameraId.startsWith("custom_")) {
      const customCamera = customCameras.find(c => c.id === cameraId);
      if (!customCamera || !customCamera.url) return;
      newUrl = customCamera.url;
      streamType = this.resolveCustomStreamType(customCamera, settings);
      friendlyName = customCamera.name || cameraId;
    } else {
      const useHLS = settings.streamingSettings?.useHLS || false;
      const result = await this.websocketManager.getCameraUrlWithToken(
        cameraId,
        settings.homeAssistantUrl,
        settings.homeAssistantToken,
        useHLS
      );
      if (!result) return;
      newUrl = result.url;
      streamType = result.streamType;
      friendlyName = result.friendlyName;
    }

    // Il refresh può terminare dopo una pausa: non riattivare nulla
    if (!this.isRunning) return;

    this.urlCache.set(cameraId, {
      url: newUrl,
      streamType,
      friendlyName,
      timestamp: Date.now(),
    });

    if (streamType === "hls") {
      this.startKeepAlive(cameraId, newUrl);
    } else {
      this.stopKeepAlive(cameraId);
    }
  }

  // Interroga la playlist HLS a intervalli regolari: basta perché Home Assistant
  // consideri lo stream in uso, senza scaricare i segmenti video
  startKeepAlive(cameraId, url) {
    const existing = this.keepAlives.get(cameraId);
    if (existing) {
      existing.url = url;
      return;
    }

    const keepAlive = { url, timer: null, controller: null };
    this.keepAlives.set(cameraId, keepAlive);

    const poll = async () => {
      if (this.keepAlives.get(cameraId) !== keepAlive) return;
      keepAlive.controller = new AbortController();
      try {
        const response = await fetch(keepAlive.url, {
          signal: AbortSignal.any([
            keepAlive.controller.signal,
            AbortSignal.timeout(appConfig.preWarmer.requestTimeout),
          ]),
        });
        await response.arrayBuffer();
        if (!response.ok) {
          console.warn(`StreamPreWarmer: keep-alive HLS HTTP ${response.status} per ${cameraId}`);
        }
      } catch (err) {
        if (keepAlive.controller.signal.aborted) return;
        console.warn(`StreamPreWarmer: keep-alive HLS fallito per ${cameraId}: ${err.message}`);
      }
      if (this.keepAlives.get(cameraId) === keepAlive) {
        keepAlive.timer = setTimeout(poll, appConfig.preWarmer.hlsKeepAliveInterval);
      }
    };

    console.log(`StreamPreWarmer: keep-alive HLS avviato per ${cameraId}`);
    poll();
  }

  stopKeepAlive(cameraId) {
    const keepAlive = this.keepAlives.get(cameraId);
    if (!keepAlive) return;
    this.keepAlives.delete(cameraId);
    clearTimeout(keepAlive.timer);
    if (keepAlive.controller) keepAlive.controller.abort();
  }

  stopAllKeepAlives() {
    for (const cameraId of [...this.keepAlives.keys()]) {
      this.stopKeepAlive(cameraId);
    }
  }

  getCachedUrl(cameraId) {
    const cached = this.urlCache.get(cameraId);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.cacheMaxAge) {
      this.urlCache.delete(cameraId);
      return null;
    }

    return {
      url: cached.url,
      streamType: cached.streamType,
      friendlyName: cached.friendlyName,
    };
  }

  invalidateCache(cameraId) {
    this.urlCache.delete(cameraId);
  }

  getCacheStats() {
    const stats = [];
    for (const [cameraId, cached] of this.urlCache.entries()) {
      stats.push({
        cameraId,
        age: Date.now() - cached.timestamp,
        streamType: cached.streamType,
        keepAliveActive: this.keepAlives.has(cameraId),
      });
    }
    return stats;
  }
}

module.exports = StreamPreWarmer;
