const { ipcMain, dialog } = require("electron");

class IPCHandlers {
  constructor(mainWindow, settingsManager, websocketManager, pipWindowManager) {
    this.mainWindow = mainWindow;
    this.settingsManager = settingsManager;
    this.websocketManager = websocketManager;
    this.pipWindowManager = pipWindowManager;

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
  }

  async handleSaveSettings(settings) {
    const oldSettings = this.settingsManager.getSettings();
    this.settingsManager.updateSettings(settings);

    if (!this.settingsManager.saveSettingsToFile()) {
      throw new Error("Impossibile salvare le impostazioni su file");
    }

    const haSettingsChanged = oldSettings.homeAssistantUrl !== settings.homeAssistantUrl ||
                           oldSettings.homeAssistantToken !== settings.homeAssistantToken;

    if (haSettingsChanged) {
      this.websocketManager.closeConnection();
      this.websocketManager.connectToHomeAssistant();
    } else {
      const mappingsChanged = JSON.stringify(oldSettings.sensorCameraMappings) !==
                           JSON.stringify(settings.sensorCameraMappings);

      if (mappingsChanged) {
        this.websocketManager.updateSubscriptions();
      }
    }

    return true;
  }

  async handleGetHomeAssistantDevices() {
    const settings = this.settingsManager.getSettings();

    if (!settings.homeAssistantUrl || !settings.homeAssistantToken) {
      return { error: "Home Assistant non configurato" };
    }

    try {
      const response = await fetch(`${settings.homeAssistantUrl}/api/states`, {
        headers: {
          Authorization: `Bearer ${settings.homeAssistantToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Errore nel recupero dei dispositivi");
      }

      const states = await response.json();
      const sensors = states.filter((state) =>
        state.entity_id.startsWith("binary_sensor.") ||
        state.entity_id.startsWith("input_boolean.")
      );
      const cameras = states.filter((state) =>
        state.entity_id.startsWith("camera.")
      );
      
      return { sensors, cameras };
    } catch (error) {
      return { error: error.message };
    }
  }

  handleGetSensorStatus() {
    const settings = this.settingsManager.getSettings();
    const sensorStates = this.websocketManager.getSensorStates();

    return settings.sensorCameraMappings.map((mapping) => ({
      sensorId: mapping.sensorId,
      status: sensorStates.get(mapping.sensorId) || "unknown",
    }));
  }

  async handleExportSettings() {
    try {
      const result = await dialog.showSaveDialog(this.mainWindow, {
        defaultPath: "home-assistant-pip-settings.json",
        filters: [{ name: "JSON Files", extensions: ["json"] }],
      });

      if (!result.canceled && result.filePath) {
        return this.settingsManager.exportSettings(result.filePath);
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
        const importResult = await this.settingsManager.importSettings(result.filePaths[0]);

        if (importResult.success) {
          const oldSettings = this.settingsManager.getSettings();
          const haSettingsChanged = oldSettings.homeAssistantUrl !== importResult.settings.homeAssistantUrl ||
                                 oldSettings.homeAssistantToken !== importResult.settings.homeAssistantToken;

          if (haSettingsChanged) {
            this.websocketManager.closeConnection();
            this.websocketManager.connectToHomeAssistant();
          } else {
            const mappingsChanged = JSON.stringify(oldSettings.sensorCameraMappings) !==
                                   JSON.stringify(importResult.settings.sensorCameraMappings);

            if (mappingsChanged) {
              this.websocketManager.updateSubscriptions();
            }
          }
        }

        return importResult;
      }
      return { success: false, canceled: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  handleResetSettings() {
    try {
      const oldSettings = this.settingsManager.getSettings();
      this.settingsManager.resetSettings();

      if (!this.settingsManager.saveSettingsToFile()) {
        throw new Error("Impossibile salvare le impostazioni predefinite");
      }

      const haSettingsChanged = oldSettings.homeAssistantUrl !== "" ||
                             oldSettings.homeAssistantToken !== "";

      if (haSettingsChanged) {
        this.websocketManager.closeConnection();
        this.websocketManager.connectToHomeAssistant();
      }

      return { success: true, settings: this.settingsManager.getSettings() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleGetCameraUrlWithToken(cameraIdm) {
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

      useHLS = false;





      return { url: cameraUrl, useHLS };
    } catch (error) {
      return { error: error.message };
    }
  }
}

module.exports = IPCHandlers;
