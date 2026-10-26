const { ipcMain, dialog, app, shell } = require("electron");
const { execSync } = require("child_process");
const appConfig = require("../shared/app-config");

function getInstallationType() {
  if (process.platform !== 'linux') return process.platform;
  
  if (process.env.APPIMAGE) {
    return 'AppImage';
  }
  
  try {
    execSync('rpm -q HomeSentinel', { stdio: 'ignore' });
    return 'RPM';
  } catch (e) {
    // Not RPM
  }
  
  try {
    execSync('dpkg -l homesentinel', { stdio: 'ignore' });
    return 'DEB';
  } catch (e) {
    // Not DEB
  }
  
  return 'unknown';
}

class IPCHandlers {
  constructor(mainWindow, settingsManager, websocketManager, pipWindowManager, alarmWindowManager, autoStartManager, trayManager, streamPreWarmer, dndScheduler, onQuitCallback) {
    this.mainWindow = mainWindow;
    this.settingsManager = settingsManager;
    this.websocketManager = websocketManager;
    this.pipWindowManager = pipWindowManager;
    this.alarmWindowManager = alarmWindowManager;
    this.autoStartManager = autoStartManager;
    this.trayManager = trayManager;
    this.streamPreWarmer = streamPreWarmer;
    this.dndScheduler = dndScheduler;
    this.onQuitCallback = onQuitCallback;

    this.setupIpcHandlers();
  }

  setupIpcHandlers() {
    ipcMain.handle("get-settings", () => {
      return this.settingsManager.getSettings();
    });

    ipcMain.handle("save-settings", (event, settings) => {
      return this.handleSaveSettings(settings);
    });

    ipcMain.handle("get-home-assistant-devices", async () => {
      return this.handleGetHomeAssistantDevices();
    });

    ipcMain.handle("test-camera", (event, cameraUrl, cameraSettings, cameraId = null, duration = 5) => {
      return this.pipWindowManager.testCamera(cameraUrl, cameraSettings, cameraId, duration);
    });

    ipcMain.handle("close-pip", (event, windowId) => {
      return this.pipWindowManager.closePiPWindow(windowId);
    });

    ipcMain.handle("get-sensor-status", () => {
      return this.handleGetSensorStatus();
    });

    ipcMain.handle("export-settings", async () => {
      return this.handleExportSettings();
    });

    ipcMain.handle("import-settings", async () => {
      return this.handleImportSettings();
    });

    ipcMain.handle("reset-settings", () => {
      return this.handleResetSettings();
    });

    ipcMain.handle("get-camera-url-with-token", async (event, cameraId) => {
      return this.handleGetCameraUrlWithToken(cameraId);
    });

    ipcMain.handle("set-auto-start", async (event, enabled) => {
      return this.handleSetAutoStart(enabled);
    });

    ipcMain.handle("get-auto-start-status", async () => {
      return this.handleGetAutoStartStatus();
    });

    ipcMain.handle("set-dnd-mode", (event, enabled) => {
      return this.handleSetDndMode(enabled);
    });

    ipcMain.handle("request-stream-url", async (event, { cameraId, preference }) => {
      return this.handleRequestStreamUrl(cameraId, preference);
    });

    ipcMain.handle("get-dnd-status", () => {
      return this.handleGetDndStatus();
    });

    ipcMain.handle("get-alarm-state", () => {
      if (this.websocketManager) {
        return { state: this.websocketManager.getAlarmState() };
      }
      return { state: null };
    });

    ipcMain.handle("hide-window", () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.hide();
      }
    });

    ipcMain.handle("quit-app", () => {
      if (this.onQuitCallback) {
        this.onQuitCallback();
      }
    });

    ipcMain.handle("get-app-version", () => {
      const version = app.getVersion();
      const isBeta = version.includes("-beta");
      return { version, isBeta };
    });

    ipcMain.handle("check-for-updates", async () => {
      return this.handleCheckForUpdates();
    });

    ipcMain.handle("open-release-page", (event, url) => {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    });

    ipcMain.handle("get-connection-status", () => {
      return this.websocketManager ? this.websocketManager.isConnected() : false;
    });

    ipcMain.handle("test-alarm", () => {
      return this.alarmWindowManager.triggerAlarm({
        sensorName: "Test Allarme",
        state: "triggered",
      });
    });

    ipcMain.handle("get-installation-type", () => {
      return getInstallationType();
    });
  }

  async handleSaveSettings(settings) {
    const oldSettings = this.settingsManager.getSettings();
    // Lo stato DnD è gestito dalla tray (anche dalla pianificazione): non sovrascriverlo con una copia vecchia
    const newSettings = { ...settings };
    if (this.trayManager) {
      newSettings.dndMode = this.trayManager.getDndMode();
    }
    this.settingsManager.updateSettings(newSettings);

    if (!(await this.settingsManager.saveSettingsToFile())) {
      throw new Error("Impossibile salvare le impostazioni su file");
    }

    // Gestisci l'avvio automatico se modificato
    const autoStartChanged = oldSettings.autoStart !== newSettings.autoStart;
    if (autoStartChanged && this.autoStartManager) {
      await this.autoStartManager.setAutoStart(newSettings.autoStart);
    }

    this.applySettingsChanges(oldSettings, this.settingsManager.getSettings());
    return true;
  }

  // Riavvia solo i componenti interessati dalle impostazioni modificate
  applySettingsChanges(oldSettings, newSettings) {
    const changed = (key) => JSON.stringify(oldSettings[key]) !== JSON.stringify(newSettings[key]);

    const haSettingsChanged = changed("homeAssistantUrl") || changed("homeAssistantToken");
    const mappingsChanged = changed("sensorCameraMappings") || changed("customCameras");
    const streamingChanged = changed("streamingSettings");

    if (haSettingsChanged) {
      this.websocketManager.closeConnection();
      this.websocketManager.connectToHomeAssistant();
    } else if (mappingsChanged || changed("alarmSettings") || changed("gateSettings")) {
      this.websocketManager.updateSubscriptions();
    }

    if (this.streamPreWarmer && (changed("preWarmerSettings") || mappingsChanged || haSettingsChanged || streamingChanged)) {
      this.streamPreWarmer.restart();
    }

    if (this.dndScheduler && changed("dndSchedule")) {
      this.dndScheduler.restart();
    }
  }

  async handleGetHomeAssistantDevices() {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      return { error: "Home Assistant non configurato" };
    }

    try {
      const response = await fetch(`${this.websocketManager.getBaseUrl()}/api/states`, {
        headers: {
          Authorization: `Bearer ${settings.homeAssistantToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error("Errore nel recupero dei dispositivi");
      }

      const states = await response.json();
      const sensors = states.filter((state) =>
        state.entity_id.startsWith("binary_sensor.") ||
        state.entity_id.startsWith("input_boolean.") ||
        state.entity_id.startsWith("alarm_control_panel.")
      );
      const cameras = states.filter((state) =>
        state.entity_id.startsWith("camera.")
      );
      const locks = states.filter((state) =>
        state.entity_id.startsWith("lock.")
      );
      
      return { sensors, cameras, locks };
    } catch (error) {
      return { error: error.message };
    }
  }

  handleGetSensorStatus() {
    const settings = this.settingsManager.getSettings();
    const sensorStates = this.websocketManager.getSensorStates();

    return (settings.sensorCameraMappings || []).map((mapping) => ({
      sensorId: mapping.sensorId,
      status: sensorStates.get(mapping.sensorId) || "unknown",
    }));
  }

  async handleExportSettings() {
    try {
      // Il file esportato non è cifrato: chiedi se includere token e PIN
      const { response } = await dialog.showMessageBox(this.mainWindow, {
        type: "question",
        buttons: ["Annulla", "Includi token e PIN", "Escludi dati sensibili"],
        defaultId: 2,
        cancelId: 0,
        title: "Esporta impostazioni",
        message: "Includere i dati sensibili nel file esportato?",
        detail: "Il file è in chiaro: chi lo legge vede il token di Home Assistant e il PIN dell'allarme. "
          + "Escludendoli dovrai reinserirli dopo l'importazione.",
      });
      if (response === 0) {
        return { success: false, canceled: true };
      }

      const result = await dialog.showSaveDialog(this.mainWindow, {
        defaultPath: "homesentinel-impostazioni.json",
        filters: [{ name: "JSON Files", extensions: ["json"] }],
      });

      if (!result.canceled && result.filePath) {
        return this.settingsManager.exportSettings(result.filePath, { includeSecrets: response === 1 });
      }
      return { success: false, canceled: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleImportSettings() {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        filters: [{ name: "JSON Files", extensions: ["json"] }],
        properties: ["openFile"],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const oldSettings = this.settingsManager.getSettings();
        const importResult = await this.settingsManager.importSettings(result.filePaths[0]);

        if (importResult.success) {
          if (this.trayManager && importResult.settings.dndMode !== undefined) {
            this.trayManager.setDndMode(!!importResult.settings.dndMode);
          }
          this.applySettingsChanges(oldSettings, importResult.settings);
        }

        return importResult;
      }
      return { success: false, canceled: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleResetSettings() {
    try {
      const oldSettings = this.settingsManager.getSettings();
      this.settingsManager.resetSettings();

      if (!(await this.settingsManager.saveSettingsToFile())) {
        throw new Error("Impossibile salvare le impostazioni predefinite");
      }

      if (this.trayManager) {
        this.trayManager.setDndMode(false);
      }
      this.applySettingsChanges(oldSettings, this.settingsManager.getSettings());

      return { success: true, settings: this.settingsManager.getSettings() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleGetCameraUrlWithToken(cameraId) {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      return { error: "Home Assistant non configurato" };
    }

    if (!cameraId) {
      return { error: "ID camera non fornito" };
    }

    try {
      const useHLS = settings.streamingSettings?.useHLS || false;
      const cameraUrl = await this.websocketManager.getCameraUrlWithToken(
        cameraId,
        settings.homeAssistantUrl,
        settings.homeAssistantToken,
        useHLS
      );

      if (!cameraUrl) {
        return { error: "Impossibile ottenere l'URL della camera" };
      }


      return { url: cameraUrl, useHLS };
    } catch (error) {
      return { error: error.message };
    }
  }

  async handleSetAutoStart(enabled) {
    if (!this.autoStartManager) {
      return { success: false, error: "Auto-start manager non inizializzato" };
    }

    try {
      const result = await this.autoStartManager.setAutoStart(enabled);

      if (result) {
        // Aggiorna anche le impostazioni
        this.settingsManager.updateSettings({ autoStart: enabled });
        await this.settingsManager.saveSettingsToFile();
      }

      return { success: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleGetAutoStartStatus() {
    if (!this.autoStartManager) {
      return { enabled: false };
    }

    try {
      const enabled = await this.autoStartManager.isAutoStartEnabled();
      return { enabled };
    } catch (error) {
      return { enabled: false, error: error.message };
    }
  }

  handleSetDndMode(enabled) {
    if (this.trayManager) {
      this.trayManager.setDndMode(enabled);
      return { success: true };
    }
    return { success: false, error: "Tray manager non inizializzato" };
  }

  handleGetDndStatus() {
    if (this.trayManager) {
      return { enabled: this.trayManager.getDndMode() };
    }
    const settings = this.settingsManager.getSettings();
    return { enabled: settings.dndMode || false };
  }

  async handleCheckForUpdates() {
    try {
      const currentVersion = app.getVersion();
      const isBeta = currentVersion.includes("-beta");
      const url = appConfig.app.updateUrl;
      if (!url) {
        return { error: "URL aggiornamenti non configurato" };
      }

      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const latestRelease = await response.json();
      if (!latestRelease || !latestRelease.tag_name) {
        return { hasUpdate: false, currentVersion };
      }

      const tagName = (latestRelease.tag_name || "").replace(/^v/, "");
      const isUpdateAvailable = this.compareVersions(tagName, currentVersion) > 0;

      let assetUrls = [];
      if (latestRelease.assets && Array.isArray(latestRelease.assets)) {
        assetUrls = latestRelease.assets.map((asset) => ({
          name: asset.name,
          url: asset.browser_download_url,
        }));
      }

      return {
        hasUpdate: isUpdateAvailable,
        currentVersion,
        latestVersion: tagName,
        releaseUrl: latestRelease.url || "",
        releaseDescription: latestRelease.body || "",
        isBeta: isBeta,
        assets: assetUrls,
      };
    } catch (error) {
      return { error: error.message, currentVersion: app.getVersion() };
    }
  }

  compareVersions(a, b) {
    const clean = (v) => v.replace(/^v/, "").split(/[+\-]/)[0];
    const pa = clean(a).split(".").map(Number);
    const pb = clean(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  async handleRequestStreamUrl(cameraId, preference) {
    if (!this.websocketManager || !cameraId) return null;

    const settings = this.settingsManager.getSettings();
    const { homeAssistantUrl, homeAssistantToken } = settings;

    if (!homeAssistantUrl || !homeAssistantToken) return null;

    try {
      const useHLS = preference === "hls";
      const result = await this.websocketManager.getCameraUrlWithToken(
        cameraId,
        homeAssistantUrl,
        homeAssistantToken,
        useHLS
      );

      if (result && result.url) {
        const url = result.url.replace("camera_proxy/", "camera_proxy_stream/");
        return { url, streamType: result.streamType || "mjpeg", friendlyName: result.friendlyName };
      }

      return null;
    } catch (err) {
      console.error("IPCHandlers: errore richiesta stream URL:", err);
      return null;
    }
  }
}

module.exports = IPCHandlers;
