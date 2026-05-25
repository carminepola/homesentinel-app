const appConfig = require("../shared/app-config");

class StreamPreWarmer {
  constructor(settingsManager, websocketManager) {
    this.settingsManager = settingsManager;
    this.websocketManager = websocketManager;
    this.urlCache = new Map();
    this.tokenRefreshTimer = null;
    this.keepAliveControllers = new Map();
    this.isRunning = false;
    this.cacheMaxAge = 300000;
    this.activeCameraUrls = new Map();
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

  start() {
    if (this.isRunning) return;
    if (!this.isEnabled()) {
      console.log("StreamPreWarmer: disabilitato dalle impostazioni");
      return;
    }
    this.isRunning = true;
    console.log(`StreamPreWarmer: avviato (refresh token ogni ${this.getIntervalMs() / 1000}s, keep-alive persistente)`);
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
        this.isRunning = false;
        console.log("StreamPreWarmer: fermato (disabilitato)");
      }
    }, this.getIntervalMs());
  }

  stop() {
    this.isRunning = false;
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    this.stopAllKeepAlives();
    this.urlCache.clear();
    this.activeCameraUrls.clear();
    console.log("StreamPreWarmer: fermato");
  }

  restart() {
    this.stop();
    this.start();
  }

  async refreshAllTokens() {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      return;
    }

    const mappings = settings.sensorCameraMappings || [];
    const customCameras = settings.customCameras || [];
    const seenIds = new Set();

    const cameraIds = [];
    for (const mapping of mappings) {
      if (mapping.cameraId && !seenIds.has(mapping.cameraId)) {
        seenIds.add(mapping.cameraId);
        cameraIds.push(mapping.cameraId);
      }
    }

    this.pruneRemovedCameras(cameraIds);

    if (cameraIds.length === 0) return;

    console.log(`StreamPreWarmer: refresh token per ${cameraIds.length} camera...`);

    for (const cameraId of cameraIds) {
      try {
        await this.refreshCamera(cameraId, settings, customCameras);
      } catch (err) {
        console.warn(`StreamPreWarmer: refresh fallito per ${cameraId}: ${err.message}`);
      }
    }
  }

  pruneRemovedCameras(currentCameraIds) {
    const currentSet = new Set(currentCameraIds);
    for (const [cameraId, oldUrl] of this.activeCameraUrls.entries()) {
      if (!currentSet.has(cameraId)) {
        this.stopKeepAlive(cameraId);
        this.activeCameraUrls.delete(cameraId);
        this.urlCache.delete(cameraId);
        console.log(`StreamPreWarmer: rimossa camera ${cameraId} (non più mappata)`);
      }
    }
  }

  async refreshCamera(cameraId, settings, customCameras) {
    const isCustom = cameraId.startsWith("custom_");

    let newUrl;
    let streamType;
    let friendlyName;

    if (isCustom) {
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

    this.urlCache.set(cameraId, {
      url: newUrl,
      streamType,
      friendlyName,
      timestamp: Date.now(),
    });

    const oldUrl = this.activeCameraUrls.get(cameraId);
    if (oldUrl !== newUrl) {
      if (oldUrl) {
        this.stopKeepAlive(cameraId);
      }
      this.activeCameraUrls.set(cameraId, newUrl);
      this.startKeepAlive(cameraId, newUrl);
    }
  }

  startKeepAlive(cameraId, url) {
    this.stopKeepAlive(cameraId);

    const controller = new AbortController();
    this.keepAliveControllers.set(cameraId, controller);

    console.log(`StreamPreWarmer: keep-alive avviato per ${cameraId}`);
    this.keepAliveLoop(cameraId, url, controller);
  }

  async keepAliveLoop(cameraId, url, controller) {
    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 206) {
        console.warn(`StreamPreWarmer: keep-alive HTTP ${response.status} per ${cameraId}, retry tra 5s`);
        this.scheduleKeepAliveRetry(cameraId, url, controller, 5000);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        this.scheduleKeepAliveRetry(cameraId, url, controller, 5000);
        return;
      }

      let totalBytes = 0;
      let lastLog = Date.now();

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.length;

        const now = Date.now();
        if (now - lastLog > 60000) {
          console.log(`StreamPreWarmer: ${cameraId} keep-alive attivo (${Math.round(totalBytes / 1024)}KB)`);
          lastLog = now;
        }
      }

      if (!controller.signal.aborted) {
        console.log(`StreamPreWarmer: keep-alive stream terminato per ${cameraId}, riconnessione tra 3s`);
        this.scheduleKeepAliveRetry(cameraId, url, controller, 3000);
      }
    } catch (err) {
      if (err.name === "AbortError") return;

      console.warn(`StreamPreWarmer: keep-alive errore per ${cameraId}: ${err.message}, retry tra 5s`);
      if (!controller.signal.aborted) {
        this.scheduleKeepAliveRetry(cameraId, url, controller, 5000);
      }
    }
  }

  scheduleKeepAliveRetry(cameraId, url, controller, delayMs) {
    if (controller.signal.aborted) return;
    if (!this.activeCameraUrls.has(cameraId)) return;

    setTimeout(() => {
      if (!controller.signal.aborted && this.activeCameraUrls.has(cameraId)) {
        const currentUrl = this.activeCameraUrls.get(cameraId);
        this.keepAliveLoop(cameraId, currentUrl, controller);
      }
    }, delayMs);
  }

  stopKeepAlive(cameraId) {
    const controller = this.keepAliveControllers.get(cameraId);
    if (controller) {
      controller.abort();
      this.keepAliveControllers.delete(cameraId);
    }
  }

  stopAllKeepAlives() {
    for (const controller of this.keepAliveControllers.values()) {
      try {
        controller.abort();
      } catch (e) {}
    }
    this.keepAliveControllers.clear();
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
        keepAliveActive: this.keepAliveControllers.has(cameraId),
      });
    }
    return stats;
  }
}

module.exports = StreamPreWarmer;
